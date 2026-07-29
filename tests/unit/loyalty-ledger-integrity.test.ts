/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 회귀 잠금 (2026-07-28) — 포인트·지출 원장 오염.
 *
 * 사고: 플랜을 **만들기만 해도** planPersister.js 가 users/{uid} 의
 *   totalSpentUSD / bookingCount / tripCoins / tier 를 직접 올렸고, 더한 금액이
 *   손님이 낸 $9.90 이 아니라 **차량 대절 추정 여행가**($707 등)였다.
 *   운영 계정 실측: 총지출 $253,205 / 코인 756,986 / 예약 260건.
 *   코인은 loyalty redeem 표(500=5% / 1000=10% / 2000=15%)로 할인쿠폰이 되므로
 *   그대로 실 금전 손실이다.
 *
 * 이 파일이 잠그는 것:
 *  1. 플랜 생성 경로는 원장을 **쓰지 않는다** (소스 가드)
 *  2. 결제 1회 = 실제 결제금액만큼 1회 적립
 *  3. 같은 결제 재호출은 두 번째부터 0 (멱등)
 *  4. 운영자 테스트/우회 주문은 원장 변화 0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── 1. 플랜 생성 경로가 원장을 건드리지 않는지 (소스 가드) ────────────────────
describe('planPersister — 원장 미기록', () => {
  const src = readFileSync(join(process.cwd(), 'api/_ai_core/planPersister.js'), 'utf8');
  // 주석은 제거하고 실행 코드만 본다 (제거 사유를 적은 주석에 단어가 남아 있음).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('users 문서의 코인·지출·예약수·등급을 쓰지 않는다', () => {
    for (const field of ['tripCoins', 'totalSpentUSD', 'bookingCount', 'tierUpdatedAt']) {
      expect(code, `planPersister 가 ${field} 를 다시 쓰고 있다`).not.toContain(field);
    }
  });

  it('pointHistory 에 직접 쓰지 않는다', () => {
    expect(code).not.toContain('pointHistory');
  });
});

// ── 2~4. 결제 경로(loyalty.js earn) 동작 ──────────────────────────────────────
const userHolder: { d: any } = { d: {} };
const bookingHolder: { d: any; exists: boolean } = { d: {}, exists: true };
const historyHolder: { existing: Set<string> } = { existing: new Set() };
const userUpdate = vi.fn();
const historySet = vi.fn();

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: async () => ({ ok: true, uid: 'u1' }),
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TS', increment: (n: number) => ({ _inc: n }) },
}));

function docHandle(path: string) {
  return {
    path,
    get: async () => {
      if (path.startsWith('users/u1/pointHistory/')) {
        const id = path.split('/').pop() as string;
        return { exists: historyHolder.existing.has(id), data: () => ({ amount: 123 }) };
      }
      if (path.startsWith('bookings/')) {
        return { exists: bookingHolder.exists, data: () => ({ ...bookingHolder.d }) };
      }
      return { exists: true, data: () => ({ ...userHolder.d }) };
    },
    update: (...a: any[]) => userUpdate(path, ...a),
    set: (...a: any[]) => historySet(path, ...a),
  };
}

function makeDb() {
  const collection = (name: string) => ({
    doc: (id: string) => ({
      ...docHandle(`${name}/${id}`),
      collection: (sub: string) => ({
        doc: (subId?: string) => docHandle(`${name}/${id}/${sub}/${subId || 'auto'}`),
      }),
    }),
  });
  return {
    collection,
    runTransaction: async (fn: any) => fn({
      get: (ref: any) => ref.get(),
      update: (ref: any, data: any) => ref.update(data),
      set: (ref: any, data: any) => ref.set(data),
    }),
  };
}
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => makeDb() }));

const { default: handler } = await import('../../api/loyalty.js');

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; }, setHeader() {} };
}
async function earn(body: object) {
  const res = mockRes();
  await handler({
    method: 'POST', url: '/api/loyalty',
    headers: { host: 'unit.test', 'x-internal-token': 'tok' },
    body: { action: 'earn', userId: 'u1', ...body },
  } as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

beforeEach(() => {
  process.env.INTERNAL_API_TOKEN = 'tok';
  userHolder.d = { tripCoins: 0, totalSpentUSD: 0, bookingCount: 0 };
  bookingHolder.exists = true;
  bookingHolder.d = {
    paymentVerified: true,
    uid: 'u1',
    captureID: 'CAP-1',
    currency: 'USD',
    amountUSD: 9.9,
    refundedUSDTotal: 0,
    status: 'CONFIRMED',
  };
  historyHolder.existing = new Set();
  userUpdate.mockClear(); historySet.mockClear();
});

describe('loyalty earn — 실결제만 원장에 반영', () => {
  it('$9.90 결제 1회 → 지출 $9.90 · 예약 1 · 코인 1회', async () => {
    const r = await earn({ amountUSD: 9.9, bookingRef: 'CT-20260728-001' });
    expect(r.statusCode).toBe(200);
    const written = (userUpdate.mock.calls[0] as any[])[1];
    expect(written.totalSpentUSD).toBeCloseTo(9.9, 5);
    expect(written.bookingCount).toBe(1);
    // Bronze 1% → round(9.9 * 100 * 0.01) = 10
    expect(written.tripCoins).toBe(10);
    expect(r.json.data.earnedCoins).toBe(10);
  });

  it('같은 결제 2회 처리 → 두 번째는 반영 0', async () => {
    await earn({ amountUSD: 9.9, bookingRef: 'CT-20260728-001' });
    userUpdate.mockClear();
    // 첫 호출이 남긴 이력 문서가 존재하는 상태를 재현
    historyHolder.existing.add('earn_CT-20260728-001');
    const r2 = await earn({ amountUSD: 9.9, bookingRef: 'CT-20260728-001' });
    expect(r2.statusCode).toBe(200);
    expect(r2.json.data.duplicate).toBe(true);
    expect(r2.json.data.earnedCoins).toBe(0);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('운영자 테스트·우회 주문 → 원장 변화 0', async () => {
    for (const ref of ['TEST-abc123', 'ADMIN-BYPASS-xyz']) {
      userUpdate.mockClear();
      const r = await earn({ amountUSD: 707.14, bookingRef: ref });
      expect(r.statusCode).toBe(200);
      expect(r.json.data.earnedCoins).toBe(0);
      expect(userUpdate).not.toHaveBeenCalled();
    }
  });

  it('실입금(MANUAL-)은 정상 적립 — 제외 대상이 아니다', async () => {
    const r = await earn({ amountUSD: 9.9, bookingRef: 'MANUAL-001' });
    expect(r.json.data.earnedCoins).toBe(10);
    expect(userUpdate).toHaveBeenCalled();
  });

  it('내부 토큰 없으면 403 — 외부에서 코인 발급 불가', async () => {
    const res = mockRes();
    await handler({
      method: 'POST', url: '/api/loyalty', headers: { host: 'unit.test' },
      body: { action: 'earn', userId: 'u1', amountUSD: 100 },
    } as any, res as any);
    expect(res.out.statusCode).toBe(403);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('원결제 뒤 부분환불이 먼저 반영됐으면 남은 실결제액만 적립한다', async () => {
    bookingHolder.d.refundedUSDTotal = 5;
    bookingHolder.d.status = 'PARTIALLY_REFUNDED';
    const r = await earn({
      amountUSD: 999,
      bookingRef: 'CT-1',
      ledgerKey: 'ORDER-1',
      captureId: 'CAP-1',
    });
    expect(r.statusCode).toBe(200);
    const written = (userUpdate.mock.calls[0] as any[])[1];
    expect(written.totalSpentUSD).toBe(4.9);
    expect(r.json.data.earnedCoins).toBe(5);
  });

  it('전액환불이 먼저 끝났으면 뒤늦은 적립을 만들지 않는다', async () => {
    bookingHolder.d.refundedUSDTotal = 9.9;
    bookingHolder.d.status = 'REFUNDED';
    const r = await earn({
      amountUSD: 9.9,
      bookingRef: 'CT-1',
      ledgerKey: 'ORDER-1',
      captureId: 'CAP-1',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json.data.skipped).toBe('fully-refunded');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });
});
