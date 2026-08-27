/* eslint-disable @typescript-eslint/no-explicit-any -- API 핸들러와 Firestore 트랜잭션 경계 목. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIMARY_MOOD_ADMIN_EMAIL } from '../../api/_shared/mood-allowlist.js';

const verifyUserTokenMock = vi.fn();
const auditWrites: Array<Record<string, unknown>> = [];
let allowlist: {
  emails: string[];
  admins: string[];
  settlementApproverEmails: string[];
  clientId: string;
};
let transactionAllowlist: typeof allowlist | null;

const runTransactionMock = vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
  get: async () => ({ exists: true, data: () => ({ ...(transactionAllowlist || allowlist) }) }),
  set: (ref: { kind: string }, patch: Record<string, unknown>) => {
    if (ref.kind === 'allowlist') {
      allowlist = { ...allowlist, ...patch } as typeof allowlist;
    } else if (ref.kind === 'audit') {
      auditWrites.push({ ...patch });
    }
  },
}));

const dbMock = {
  collection(name: string) {
    const kind = name === 'mood_config' ? 'allowlist' : 'audit';
    return {
      doc: () => ({
        kind,
        get: async () => ({ exists: true, data: () => ({ ...allowlist }) }),
      }),
    };
  },
  runTransaction: (...args: any[]) => runTransactionMock(...args),
};

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
}));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

function responseMock() {
  const response = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { response.statusCode = status; return response; },
    setHeader() {},
    end(body = '') { response.body = String(body); return response; },
  };
  return response;
}

async function call(method: 'GET' | 'POST', body?: Record<string, unknown>) {
  const { default: handler } = await import('../../api/mood-allowlist-admin.js');
  const response = responseMock();
  await handler({
    method,
    body,
    headers: { host: 'unit.test', authorization: 'Bearer token' },
  } as any, response as any);
  return { status: response.statusCode, json: JSON.parse(response.body || '{}') };
}

beforeEach(() => {
  allowlist = {
    emails: [PRIMARY_MOOD_ADMIN_EMAIL, 'mood1@x.com', 'mood2@x.com'],
    admins: [PRIMARY_MOOD_ADMIN_EMAIL],
    settlementApproverEmails: ['mood1@x.com'],
    clientId: 'COMPANY_A',
  };
  transactionAllowlist = null;
  auditWrites.length = 0;
  runTransactionMock.mockClear();
  verifyUserTokenMock.mockReset();
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: PRIMARY_MOOD_ADMIN_EMAIL, emailVerified: true });
});

describe('mood-allowlist-admin 금액 승인 권한 경계', () => {
  it('GET은 MOOD 확인 담당자 목록까지 운영자에게만 반환한다', async () => {
    const result = await call('GET');
    expect(result.status).toBe(200);
    expect(result.json.data).toEqual({ ...allowlist, primaryAdminEmail: PRIMARY_MOOD_ADMIN_EMAIL });

    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'mood1@x.com', emailVerified: true });
    expect((await call('GET')).status).toBe(403);
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: PRIMARY_MOOD_ADMIN_EMAIL, emailVerified: false });
    expect((await call('GET')).status).toBe(403);
  });

  it('확인 담당자는 조회·예약 권한을 먼저 가져야 하고 고정 관리자와 겹칠 수 없다', async () => {
    expect((await call('POST', { action: 'add', list: 'settlementApproverEmails', email: 'new@x.com' })).status).toBe(409);
    expect((await call('POST', { action: 'add', list: 'settlementApproverEmails', email: PRIMARY_MOOD_ADMIN_EMAIL })).status).toBe(409);
    expect(auditWrites).toHaveLength(0);
  });

  it('고정 관리자 외 계정은 admins 추가 요청과 멱등 재추가 요청을 모두 거부한다', async () => {
    expect((await call('POST', { action: 'add', list: 'admins', email: 'mood2@x.com' })).status).toBe(409);

    allowlist.admins.push('mood2@x.com');
    const replay = await call('POST', { action: 'add', list: 'admins', email: 'mood2@x.com' });
    expect(replay.status).toBe(409);
    expect(auditWrites).toHaveLength(0);
  });

  it('고정 관리자 제거는 거부하고 과거에 남은 비고정 관리자 항목은 제거한다', async () => {
    expect((await call('POST', { action: 'remove', list: 'admins', email: PRIMARY_MOOD_ADMIN_EMAIL })).status).toBe(409);

    allowlist.emails.push('legacy@x.com');
    allowlist.admins.push('legacy@x.com');
    const cleanup = await call('POST', { action: 'remove', list: 'admins', email: 'legacy@x.com' });
    expect(cleanup.status).toBe(200);
    expect(cleanup.json.data).toMatchObject({ changed: true, list: 'admins', action: 'remove' });
    expect(allowlist.admins).toEqual([PRIMARY_MOOD_ADMIN_EMAIL]);
    expect(auditWrites).toEqual([expect.objectContaining({
      actorEmail: PRIMARY_MOOD_ADMIN_EMAIL,
      targetEmail: 'legacy@x.com',
      action: 'remove',
      list: 'admins',
    })]);
  });

  it('금액 역할을 가진 이메일은 역할을 먼저 제거해야 기본 접근을 제거할 수 있다', async () => {
    expect((await call('POST', { action: 'remove', list: 'emails', email: PRIMARY_MOOD_ADMIN_EMAIL })).status).toBe(409);
    expect((await call('POST', { action: 'remove', list: 'emails', email: 'mood1@x.com' })).status).toBe(409);
    expect(auditWrites).toHaveLength(0);
  });

  it('이메일을 정규화하고 멱등 추가를 유지하며 실제 변경만 트랜잭션 감사 기록을 남긴다', async () => {
    allowlist.emails.push('MOOD2@X.COM');
    const added = await call('POST', { action: 'add', list: 'settlementApproverEmails', email: '  MOOD2@X.COM ' });
    expect(added.status).toBe(200);
    expect(added.json.data).toMatchObject({ changed: true, list: 'settlementApproverEmails' });
    expect(allowlist.settlementApproverEmails).toEqual(['mood1@x.com', 'mood2@x.com']);
    expect(auditWrites).toEqual([expect.objectContaining({
      actorEmail: PRIMARY_MOOD_ADMIN_EMAIL,
      targetEmail: 'mood2@x.com',
      action: 'add',
      list: 'settlementApproverEmails',
      beforeIncluded: false,
      afterIncluded: true,
    })]);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);

    const replay = await call('POST', { action: 'add', list: 'settlementApproverEmails', email: 'mood2@x.com' });
    expect(replay.status).toBe(200);
    expect(replay.json.data.changed).toBe(false);
    expect(auditWrites).toHaveLength(1);

    const removed = await call('POST', { action: 'remove', list: 'settlementApproverEmails', email: 'mood2@x.com' });
    expect(removed.status).toBe(200);
    expect(allowlist.settlementApproverEmails).toEqual(['mood1@x.com']);
    expect(auditWrites.at(-1)).toEqual(expect.objectContaining({
      targetEmail: 'mood2@x.com',
      action: 'remove',
      beforeIncluded: true,
      afterIncluded: false,
    }));
  });

  it('허용되지 않은 목록 이름을 쓰기 전에 거부한다', async () => {
    const result = await call('POST', { action: 'add', list: 'owners', email: 'mood2@x.com' });
    expect(result.status).toBe(400);
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it('트랜잭션 직전 권한이 회수되면 멱등 분기와 실제 쓰기 분기 모두 403으로 막는다', async () => {
    transactionAllowlist = { ...allowlist, admins: [] };

    const idempotent = await call('POST', { action: 'add', list: 'emails', email: 'mood1@x.com' });
    const write = await call('POST', { action: 'add', list: 'emails', email: 'new@x.com' });

    expect(idempotent.status).toBe(403);
    expect(write.status).toBe(403);
    expect(allowlist.emails).not.toContain('new@x.com');
    expect(auditWrites).toHaveLength(0);
    expect(runTransactionMock).toHaveBeenCalledTimes(2);
  });
});
