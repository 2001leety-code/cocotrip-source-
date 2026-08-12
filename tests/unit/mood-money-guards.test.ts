/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩 (auth-idor-pr418.test.ts 동일 패턴). */
/**
 * MOOD 돈 코어 가드 회귀 슬롯 (2026-06-12 적대 리뷰 fix).
 *
 * 적대 리뷰(65 에이전트)가 잡은 HIGH 결함들이 재발하면 이 테스트가 터진다:
 *   1. mood-book IDOR — 비-admin 직원이 타 회사 clientId 로 예약(잔액 차감) → 403 차단
 *   2. mood-book email_verified — 미검증 이메일 토큰으로 돈 변경 → 403 차단
 *   3. mood-route 응답 봉투 — { ok, data:{ km, tollKRW, durationMin } } (프론트 파싱 계약)
 *   4. mood-data ledger — runningBalanceKRW 키(신규=값, 레거시=null. 프론트 소비 키와 일치)
 *
 * 패턴 출처: tests/unit/auth-idor-pr418.test.ts (핸들러 + 모킹).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks ------------------------------------------------------------------
const verifyUserTokenMock = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: verifyUserTokenMock,
  default: verifyUserTokenMock,
}));

// allowlist: staff(비-admin) + admin, 자기 회사 clientId='COMPANY_A'.
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({ emails: ['staff@x.com', 'admin@x.com'], admins: ['admin@x.com'], clientId: 'COMPANY_A' }),
  isAllowedEmail: (al: any, email: string) => al.emails.includes(email),
  isAdminEmail: (al: any, email: string) => al.admins.includes(email),
  normEmail: (e: string) => String(e || '').toLowerCase().trim(),
}));

const initAdminDbMock = vi.fn(() => ({}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: (...a: any[]) => initAdminDbMock(...a),
}));

const computeRouteMock = vi.fn();
vi.mock('../../api/_shared/mood-route.js', () => ({
  computeRoute: (...a: any[]) => computeRouteMock(...a),
}));

// 부수효과 모듈 — 가드 통과 전 차단 케이스에선 도달 안 하지만 import 격리.
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn() }));
vi.mock('../../api/_shared/mood-receipt.js', () => ({ buildMoodReceiptEmail: () => ({ subject: '', html: '', text: '' }) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn() }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

// --- helpers ----------------------------------------------------------------
type MockRes = {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers?: Record<string, string>) => MockRes;
  setHeader: (k: string, v: string) => void;
  end: (s?: string | Buffer) => MockRes;
};
function makeRes(): MockRes {
  const res = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
      return res;
    },
    setHeader(k: string, v: string) { res.headers[k] = v; },
    end(s?: string | Buffer) {
      if (s != null) res.body = typeof s === 'string' ? s : s.toString('utf8');
      return res;
    },
  };
  return res;
}
function req(method: string, opts: { body?: object; query?: Record<string, string>; auth?: string } = {}) {
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
  return {
    method,
    url: `/api/_unit_test${qs}`,
    headers: { host: 'unit.test', ...(opts.auth ? { authorization: opts.auth } : {}) },
    query: opts.query || {},
    body: opts.body || {},
  };
}

// mood-data 용 fake db — mood_clients(doc) + mood_bookings(query).
function fakeDbForData() {
  const bookingsDocs = [
    { id: 'b_new', data: () => ({ date: '2026-06-12', startTime: '10:00', durationHours: 2, serviceType: 'vehicle', amountKRW: 66000, balanceAfterKRW: -1000, breakdown: { baseKRW: 66000, distanceSurchargeKRW: 0, tollKRW: 0, km: 0 }, status: 'confirmed', createdByEmail: 'staff@x.com', createdAt: 2 }) },
    { id: 'b_legacy', data: () => ({ date: '2026-06-11', startTime: '09:00', durationHours: 3, serviceType: 'manager', amountKRW: 132000, status: 'confirmed', createdByEmail: 'staff@x.com', createdAt: 1 }) }, // balanceAfterKRW 없음 = 레거시
  ];
  const clientSnap = { exists: true, data: () => ({ name: 'Company A', balanceKRW: -1000 }) };
  const bookingsQuery: any = {
    where() { return bookingsQuery; },
    orderBy() { return bookingsQuery; },
    limit() { return bookingsQuery; },
    get: async () => ({ docs: bookingsDocs }),
  };
  return {
    collection(name: string) {
      if (name === 'mood_bookings') return bookingsQuery;
      return { doc: () => ({ get: async () => clientSnap }) }; // mood_clients
    },
  };
}

const VALID_BOOK = {
  date: '2026-06-12',
  startTime: '10:00',
  durationHours: 2,
  serviceType: 'vehicle',
  idempotencyKey: 'mood-money-guards-book',
};

// --- tests ------------------------------------------------------------------
describe('MOOD 돈 코어 가드 (적대 리뷰 fix 회귀)', () => {
  beforeEach(() => {
    verifyUserTokenMock.mockReset();
    initAdminDbMock.mockReset();
    initAdminDbMock.mockReturnValue({});
    computeRouteMock.mockReset();
  });

  it('mood-book IDOR: 비-admin 이 타 회사 clientId 예약 시도 → 403 (본인 회사만)', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'staff@x.com', uid: 'u', emailVerified: true });
    const handler = (await import('../../api/mood-book.js')).default;
    const res = makeRes();
    await handler(req('POST', { auth: 'Bearer t', body: { clientId: 'COMPANY_B', ...VALID_BOOK } }) as any, res as any);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain('본인 회사');
  });

  it('mood-book: admin 은 임의 clientId 예약 IDOR 차단에 안 걸림 (403 본인회사 아님)', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'admin@x.com', uid: 'u', emailVerified: true });
    // 경로 없이 진행 → computeMoodTotalKRW(base) → 트랜잭션. fake db 로 client 없음 → CLIENT_NOT_FOUND(404).
    initAdminDbMock.mockReturnValue({
      collection: () => ({ doc: () => ({ id: 'x', get: async () => ({ exists: false }) }) }),
      runTransaction: async (fn: any) => fn({ get: async () => ({ exists: false }), set: () => {}, update: () => {} }),
    });
    const handler = (await import('../../api/mood-book.js')).default;
    const res = makeRes();
    await handler(req('POST', { auth: 'Bearer t', body: { clientId: 'COMPANY_B', ...VALID_BOOK } }) as any, res as any);
    // admin 이라 IDOR 403 은 안 뜨고 트랜잭션까지 진입 → CLIENT_NOT_FOUND(404). 즉 403(본인회사)이 아니어야 함.
    expect(res.statusCode).not.toBe(403);
  });

  it('mood-book email_verified: 미검증 토큰 → 403 (이메일 미검증)', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'staff@x.com', uid: 'u', emailVerified: false });
    const handler = (await import('../../api/mood-book.js')).default;
    const res = makeRes();
    await handler(req('POST', { auth: 'Bearer t', body: { clientId: 'COMPANY_A', ...VALID_BOOK } }) as any, res as any);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain('이메일');
  });

  it('mood-route 응답 봉투: { ok, data:{ km, tollKRW, durationMin } } (프론트 파싱 계약)', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'staff@x.com', uid: 'u', emailVerified: true });
    computeRouteMock.mockResolvedValueOnce({ ok: true, km: 60, tollKRW: 3000, durationMin: 50 });
    const handler = (await import('../../api/mood-route.js')).default;
    const res = makeRes();
    await handler(req('GET', { auth: 'Bearer t', query: { origin: '서울역', destination: '부산역' } }) as any, res as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    // km 등은 반드시 data 안에 중첩 (프론트가 json.data.km 로 읽음 — 평면이면 견적 0원 버그).
    expect(body.data).toMatchObject({ km: 60, tollKRW: 3000, durationMin: 50 });
    expect(body.km).toBeUndefined();
  });

  it('mood-data ledger: runningBalanceKRW 키 — 신규=값, 레거시=null (프론트 소비 키와 일치)', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'staff@x.com', uid: 'u', emailVerified: true });
    initAdminDbMock.mockReturnValue(fakeDbForData());
    const handler = (await import('../../api/mood-data.js')).default;
    const res = makeRes();
    await handler(req('GET', { auth: 'Bearer t' }) as any, res as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const byId: Record<string, any> = Object.fromEntries(body.data.bookings.map((b: any) => [b.id, b]));
    // 키 이름이 'runningBalanceKRW' 여야 함 (프론트 MoodPortal.tsx 가 이 키를 읽음).
    expect(byId.b_new.runningBalanceKRW).toBe(-1000);
    expect(byId.b_legacy.runningBalanceKRW).toBeNull(); // 레거시(balanceAfterKRW 없음) = null
  });
});
