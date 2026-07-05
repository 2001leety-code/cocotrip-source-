/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩 (mood-money-guards 동일 패턴). */
/**
 * mood-cancel 돈 가드 잠금 (2026-07-05).
 *
 * 재발 시 터지는 것:
 *   1. IDOR — 비-admin 직원이 타사 예약 취소(남의 돈 환불) → 403
 *   2. 멱등 — cancelled 재취소(중복 환불) → 409
 *   3. completed(정산 끝) 취소 → 409 (환불 대상 아님)
 *   4. 정상 취소 — 환불액 = 예약 doc amountKRW (SSOT), 잔액 += 환불, status='cancelled'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyUserTokenMock = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: verifyUserTokenMock,
  default: verifyUserTokenMock,
}));

vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({ emails: ['staff@x.com', 'admin@x.com'], admins: ['admin@x.com'], clientId: 'COMPANY_A' }),
  isAllowedEmail: (al: any, email: string) => al.emails.includes(email),
  isAdminEmail: (al: any, email: string) => al.admins.includes(email),
  normEmail: (e: string) => String(e || '').toLowerCase().trim(),
}));

let bookingData: any;
let clientData: any;
const bookingUpdate = vi.fn();
const clientUpdate = vi.fn();
const dbMock = {
  collection: vi.fn((name: string) => ({
    doc: vi.fn((id: string) => ({ __col: name, __id: id })),
  })),
  runTransaction: async (fn: any) => fn({
    get: async (ref: any) => {
      if (ref.__col === 'mood_bookings') return { exists: !!bookingData, data: () => bookingData };
      return { exists: !!clientData, data: () => clientData };
    },
    update: (ref: any, patch: any) => {
      if (ref.__col === 'mood_bookings') bookingUpdate(patch);
      else clientUpdate(patch);
    },
  }),
};
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn() }));

type MockRes = { statusCode?: number; body: string; writeHead: (c: number, h?: any) => void; end: (b?: string) => void };
function makeRes(): MockRes {
  const res: MockRes = { body: '', writeHead(c) { res.statusCode = c; }, end(b) { res.body = b || ''; } };
  return res;
}
async function call(req: any) {
  const { default: handler } = await import('../../api/mood-cancel.js');
  const res = makeRes();
  await handler(req, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

beforeEach(() => {
  verifyUserTokenMock.mockReset();
  bookingUpdate.mockReset();
  clientUpdate.mockReset();
  bookingData = { clientId: 'COMPANY_A', status: 'confirmed', amountKRW: 352200, date: '2026-07-15', startTime: '09:00', serviceType: 'vehicle' };
  clientData = { balanceKRW: 100000, name: 'MOOD' };
});

describe('mood-cancel 돈 가드', () => {
  it('IDOR — 직원이 타사 예약 취소 → 403, 돈 안 움직임', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', emailVerified: true });
    bookingData.clientId = 'COMPANY_B';
    const { res } = await call({ method: 'POST', body: { bookingId: 'b1' }, headers: {} });
    expect(res.statusCode).toBe(403);
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(clientUpdate).not.toHaveBeenCalled();
  });

  it('멱등 — 이미 취소된 예약 재취소 → 409 (중복 환불 차단)', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', emailVerified: true });
    bookingData.status = 'cancelled';
    const { res, json } = await call({ method: 'POST', body: { bookingId: 'b1' }, headers: {} });
    expect(res.statusCode).toBe(409);
    expect(json.error).toContain('이미 취소');
    expect(clientUpdate).not.toHaveBeenCalled();
  });

  it('completed(정산 끝) 취소 → 409', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', emailVerified: true });
    bookingData.status = 'completed';
    const { res } = await call({ method: 'POST', body: { bookingId: 'b1' }, headers: {} });
    expect(res.statusCode).toBe(409);
    expect(clientUpdate).not.toHaveBeenCalled();
  });

  it('정상 취소 — 환불액=amountKRW(SSOT), 잔액 환원, status=cancelled', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', emailVerified: true });
    const { res, json } = await call({ method: 'POST', body: { bookingId: 'b1' }, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(json.refundKRW).toBe(352200);
    expect(json.balanceKRW).toBe(452200); // 100,000 + 352,200
    expect(bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', refundKRW: 352200, cancelledByEmail: 'staff@x.com' }));
    expect(clientUpdate).toHaveBeenCalledWith({ balanceKRW: 452200 });
  });

  it('admin 은 타사 예약도 취소 가능', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', emailVerified: true });
    bookingData.clientId = 'COMPANY_B';
    const { res } = await call({ method: 'POST', body: { bookingId: 'b1' }, headers: {} });
    expect(res.statusCode).toBe(200);
  });
});
