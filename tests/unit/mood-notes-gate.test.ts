/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩 (mood-money-guards 동일 패턴). */
/**
 * mood-notes 게이트 (2026-07-05 PR2 → 2026-07-27 무드 공개로 변경).
 *
 * 운영자 요구(2026-07-27): "내 스케줄을 무드에게도 노출" — 무드가 '이 날 예약 잡지 말 것'
 * 을 봐야 그날을 피한다. 대신 쓰기는 여전히 운영자만.
 * 재발 시 터지는 것:
 *   1. 무드(allowlist 직원, 비-admin) GET → 200 (읽기 허용 — 이게 기능의 핵심)
 *   2. 무드 POST → 403 (쓰기는 운영자만 — 무드가 운영자 스케줄을 못 고침)
 *   3. allowlist 밖 계정 → GET/POST 모두 403
 *   4. 운영자 POST → upsert (month 필드 파생 저장), 빈 text → delete
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyUserTokenMock = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: verifyUserTokenMock,
  default: verifyUserTokenMock,
}));

vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({ emails: ['staff@x.com', 'admin@x.com'], admins: ['admin@x.com'], clientId: 'mood' }),
  isAllowedEmail: (al: any, email: string) => al.emails.includes(email),
  isAdminEmail: (al: any, email: string) => al.admins.includes(email),
  normEmail: (e: string) => String(e || '').toLowerCase().trim(),
}));

const setMock = vi.fn();
const deleteMock = vi.fn();
const getMock = vi.fn();
const dbMock = {
  collection: vi.fn(() => ({
    where: vi.fn(() => ({ get: getMock })),
    doc: vi.fn(() => ({ set: setMock, delete: deleteMock })),
  })),
};
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => dbMock,
}));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

type MockRes = {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (b?: string) => void;
};
function makeRes(): MockRes {
  const res: MockRes = {
    headers: {},
    body: '',
    writeHead(code, headers) { res.statusCode = code; Object.assign(res.headers, headers || {}); },
    end(b) { res.body = b || ''; },
  };
  return res;
}

async function call(req: any) {
  const { default: handler } = await import('../../api/mood-notes.js');
  const res = makeRes();
  await handler(req, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

beforeEach(() => {
  verifyUserTokenMock.mockReset();
  setMock.mockReset().mockResolvedValue(undefined);
  deleteMock.mockReset().mockResolvedValue(undefined);
  getMock.mockReset();
});

describe('mood-notes 게이트 — 읽기=전원, 쓰기=운영자', () => {
  it('무드(비-admin) 계정 GET → 200 + canEdit:false (공개 읽기)', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', emailVerified: true });
    getMock.mockResolvedValue({
      forEach: (cb: any) => { cb({ id: '2026-07-15', data: () => ({ text: '이 날 예약 잡지 말 것' }) }); },
    });
    const { res, json } = await call({ method: 'GET', query: { month: '2026-07' }, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(json.notes).toEqual({ '2026-07-15': '이 날 예약 잡지 말 것' });
    expect(json.canEdit).toBe(false);
  });

  it('무드(비-admin) 계정 POST → 403 (쓰기는 운영자만)', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', emailVerified: true });
    const { res } = await call({ method: 'POST', body: { date: '2026-07-15', text: 'x' }, headers: {} });
    expect(res.statusCode).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('allowlist 밖 계정 → GET/POST 모두 403', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'stranger@x.com', emailVerified: true });
    const g = await call({ method: 'GET', query: { month: '2026-07' }, headers: {} });
    expect(g.res.statusCode).toBe(403);
    expect(getMock).not.toHaveBeenCalled();
    const p = await call({ method: 'POST', body: { date: '2026-07-15', text: 'x' }, headers: {} });
    expect(p.res.statusCode).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('운영자 GET → month 노트 맵 반환 + canEdit:true', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', emailVerified: true });
    getMock.mockResolvedValue({
      forEach: (cb: any) => {
        cb({ id: '2026-07-15', data: () => ({ text: '오후 병원' }) });
        cb({ id: '2026-07-18', data: () => ({ text: '' }) }); // 빈 텍스트는 제외
      },
    });
    const { res, json } = await call({ method: 'GET', query: { month: '2026-07' }, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(json.notes).toEqual({ '2026-07-15': '오후 병원' });
    expect(json.canEdit).toBe(true);
  });

  it('운영자 POST → upsert (month 파생 저장), 빈 text → delete', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', emailVerified: true });

    const up = await call({ method: 'POST', body: { date: '2026-07-15', text: '저녁 미팅' }, headers: {} });
    expect(up.res.statusCode).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '저녁 미팅', month: '2026-07', byEmail: 'admin@x.com' }),
      { merge: true },
    );

    const del = await call({ method: 'POST', body: { date: '2026-07-15', text: '  ' }, headers: {} });
    expect(del.res.statusCode).toBe(200);
    expect(del.json.deleted).toBe(true);
    expect(deleteMock).toHaveBeenCalled();
  });

  it('잘못된 month/date 형식 → 400', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', emailVerified: true });
    const g = await call({ method: 'GET', query: { month: '2026-7' }, headers: {} });
    expect(g.res.statusCode).toBe(400);
    const p = await call({ method: 'POST', body: { date: '7월15일', text: 'x' }, headers: {} });
    expect(p.res.statusCode).toBe(400);
  });
});
