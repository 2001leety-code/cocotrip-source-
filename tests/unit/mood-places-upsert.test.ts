/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩 (mood-notes-gate 동일 패턴). */
/**
 * mood-places 한글 이름 upsert (2026-07-27 실측 버그).
 *
 * 재발 시 터지는 것:
 *   1. 한글 전용 이름을 같은 이름으로 다시 저장 → 새 문서가 아니라 기존 문서 수정
 *      (옛 makeDocId 는 slug 가 비면 Math.random() 이라 저장할 때마다 중복이 쌓였다)
 *   2. 랜덤 id 로 저장돼 있던 레거시 문서도 이름으로 찾아 그 id 를 고침
 *      (좌표 비어 있던 '유진집' 을 재저장하면 고쳐져야지 2벌이 되면 안 된다)
 *   3. "엘스 동문앞" 과 "엘스동문앞" 은 서로 다른 항목 (공백은 접기만, 제거 아님)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyUserTokenMock = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: verifyUserTokenMock,
  default: verifyUserTokenMock,
}));

vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({ emails: ['admin@x.com'], admins: ['admin@x.com'], clientId: 'mood' }),
  isAllowedEmail: (al: any, email: string) => al.emails.includes(email),
  isAdminEmail: (al: any, email: string) => al.admins.includes(email),
  normEmail: (e: string) => String(e || '').toLowerCase().trim(),
}));

vi.mock('../../api/_shared/mood-route.js', () => ({
  geocodeAddress: async () => ({ ok: true, lat: 37.5, lng: 127.0 }),
}));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

/** 인메모리 Firestore — id → 문서 데이터. */
const docs = new Map<string, any>();

const dbMock = {
  collection: () => ({
    where: (field: string, _op: string, value: any) => {
      const matched = () => {
        const found = [...docs.entries()].filter(([, d]) => d[field] === value);
        return { empty: found.length === 0, docs: found.map(([id, d]) => ({ id, data: () => d })) };
      };
      return { limit: () => ({ get: async () => matched() }), get: async () => matched() };
    },
    doc: (id: string) => ({ id }),
  }),
  runTransaction: async (fn: any) => fn({
    get: async (ref: any) => ({ exists: docs.has(ref.id), data: () => docs.get(ref.id) }),
    set: (ref: any, data: any, opts?: any) => {
      docs.set(ref.id, opts?.merge ? { ...(docs.get(ref.id) || {}), ...data } : data);
    },
    update: (ref: any, patch: any) => docs.set(ref.id, { ...(docs.get(ref.id) || {}), ...patch }),
  }),
};
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));

type MockRes = {
  statusCode?: number;
  body: string;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (b?: string) => void;
};
function makeRes(): MockRes {
  const res: MockRes = {
    body: '',
    writeHead(code) { res.statusCode = code; },
    end(b) { res.body = b || ''; },
  };
  return res;
}

async function post(body: any) {
  const { default: handler } = await import('../../api/mood-places.js');
  const res = makeRes();
  await (handler as any)({ method: 'POST', headers: {}, body }, res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

beforeEach(() => {
  docs.clear();
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', emailVerified: true });
});

describe('mood-places 한글 이름 upsert', () => {
  it('같은 한글 이름 재저장 = 수정 (중복 생성 없음)', async () => {
    const first = await post({ name: '유진집', address: '서울시 영등포구 국제금융로 108-6' });
    expect(first.status).toBe(200);
    expect(first.json.data.updated).toBe(false);

    const second = await post({ name: '유진집', address: '서울시 영등포구 여의대로 108' });
    expect(second.status).toBe(200);
    expect(second.json.data.id).toBe(first.json.data.id); // 같은 이름 = 같은 문서
    expect(second.json.data.updated).toBe(true);
    expect(docs.size).toBe(1);
    expect(docs.get(first.json.data.id).address).toBe('서울시 영등포구 여의대로 108');
  });

  it('랜덤 id 로 저장된 레거시 문서도 이름으로 찾아 고친다', async () => {
    docs.set('place-zafi5oi3', { name: '정유진', address: '서울시 영등포구 국제금융로 108-6', createdAt: 1 });

    const r = await post({ name: '정유진', address: '서울시 영등포구 국제금융로 108-6' });
    expect(r.json.data.id).toBe('place-zafi5oi3');
    expect(r.json.data.updated).toBe(true);
    expect(docs.size).toBe(1);
    expect(docs.get('place-zafi5oi3').lat).toBe(37.5); // 비어 있던 좌표가 채워짐
  });

  it('공백 다른 별칭은 별개 항목 ("엘스 동문앞" ≠ "엘스동문앞")', async () => {
    const a = await post({ name: '엘스 동문앞', address: '서울특별시 송파구 올림픽로 99' });
    const b = await post({ name: '엘스동문앞', address: '서울특별시 송파구 올림픽로 99' });
    expect(a.json.data.id).not.toBe(b.json.data.id);
    expect(docs.size).toBe(2);
  });

  it('영문 이름은 기존 slug id 유지', async () => {
    const r = await post({ name: 'Hosan Tower', address: '서울특별시 서초구 서초대로 72' });
    expect(r.json.data.id).toBe('hosan-tower');
  });
});
