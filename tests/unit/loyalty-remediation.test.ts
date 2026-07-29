/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore 모킹 스캐폴딩. */
/**
 * 충성도 원장 오염 보정 — dry-run 판별·실행 계약 (2026-07-29).
 *
 * 🔴 원인: planPersister 가 플랜 생성만으로 users/{uid} 의 지출·예약수·코인을 올리고
 *   pointHistory 에 `AI Plan: … ($942.86)` 를 남겼다. 더해진 금액은 손님이 낸 $9.90 이
 *   아니라 **AI 추정 여행 경비**였다.
 *
 * 이 테스트는 **가짜 Firestore** 만 쓴다. 운영 데이터를 건드리는 자동 테스트는 없다.
 */
import { describe, it, expect } from 'vitest';
import { createFakeFirestore, FieldValue } from '../helpers/fake-firestore.js';
import {
  classifyBooking, classifyHistoryEntry, guardFirestore, loadAccount, planHashOf,
} from '../../scripts/lib/loyalty-remediation-core.mjs';
import { executeRemediation, correctionDocId } from '../../scripts/loyalty-remediation-execute.mjs';
import { calculateLoyaltyTier } from '../../api/_shared/loyalty-policy.js';

const UID = 'u-test-1';

/** 실제 형태를 최대한 따른 계정 하나를 만든다. */
function seedAccount(over: Record<string, any> = {}) {
  const seed: Record<string, any> = {
    [`users/${UID}`]: {
      tripCoins: 756986, totalSpentUSD: 205925.12, bookingCount: 260, tier: 'Platinum',
    },
    // ① 진짜 결제 — AI 플래너 $9.90
    [`bookings/PAY-REAL-1`]: {
      uid: UID, orderID: 'PAY-REAL-1', captureID: 'CAP-1', currency: 'USD',
      amountUSD: 9.9, paymentVerified: true, status: 'CONFIRMED',
    },
    // ② 전액 환불된 결제 — 지출·예약·코인에서 빠져야 한다
    [`bookings/PAY-REFUNDED`]: {
      uid: UID, orderID: 'PAY-REFUNDED', captureID: 'CAP-2', currency: 'USD',
      amountUSD: 100, paymentVerified: true, status: 'REFUNDED', refundedUSDTotal: 100,
    },
    // ③ 부분환불 — 남은 금액만 인정
    [`bookings/PAY-PARTIAL`]: {
      uid: UID, orderID: 'PAY-PARTIAL', captureID: 'CAP-3', currency: 'USD',
      amountUSD: 200, paymentVerified: true, status: 'PARTIALLY_REFUNDED', refundedUSDTotal: 50,
    },
    // ④ 관리자 우회 — 0원·0코인·0예약
    [`bookings/ADMIN-BYPASS-9`]: {
      uid: UID, orderID: 'ADMIN-BYPASS-9', captureID: 'CAP-4', currency: 'USD',
      amountUSD: 500, paymentVerified: true, status: 'CONFIRMED',
    },
    // ⑤ 무료 쿠폰 플랜 — 증가 없음
    [`bookings/FREE-1`]: {
      uid: UID, orderID: 'FREE-1', captureID: 'CAP-5', currency: 'USD',
      amountUSD: 0, paymentVerified: true, status: 'CONFIRMED', isFreeCoupon: true,
    },
    // ── pointHistory ──
    [`users/${UID}/pointHistory/earn_PAY-REAL-1`]: {
      type: 'earn', amount: 30, ledgerKey: 'PAY-REAL-1', captureId: 'CAP-1',
      amountUSD: 9.9, description: 'Tour completed: $9.9', createdAt: 1,
    },
    // 오염 — 결제 원장 없는 AI 추정 경비
    [`users/${UID}/pointHistory/ai-1`]: {
      type: 'earn', amount: 2829, description: 'AI Plan: seoul 5d ($942.86)', createdAt: 2,
    },
    [`users/${UID}/pointHistory/ai-2`]: {
      type: 'earn', amount: 2121, description: 'AI Plan: busan 3d ($707.14)', createdAt: 3,
    },
    // 애매 — 결제 링크가 없다(추측 금지)
    [`users/${UID}/pointHistory/legacy-1`]: {
      type: 'earn', amount: 40, description: 'Manual bonus', createdAt: 4,
    },
    // 정상 코인 사용 — 쿠폰 2장 = 교환 2건
    [`users/${UID}/pointHistory/spend-1`]: {
      type: 'spend', amount: -2000, description: 'Redeemed 2000 coins → 15% off', createdAt: 5,
    },
    [`users/${UID}/pointHistory/spend-2`]: {
      type: 'spend', amount: -2000, description: 'Redeemed 2000 coins → 15% off', createdAt: 6,
    },
    // ── coupons ──
    [`users/${UID}/coupons/c-used`]: {
      source: 'coin_redemption', coinsSpent: 2000, isUsed: true, value: 15, createdAt: 5,
    },
    [`users/${UID}/coupons/c-unused`]: {
      source: 'coin_redemption', coinsSpent: 2000, isUsed: false, value: 15, createdAt: 6,
    },
  };
  return createFakeFirestore({ ...seed, ...over });
}

/** 애매한 이력이 없는 시드 — 원장 재계산 모드를 검증한다. */
function seedClean() {
  const db = seedAccount();
  db.__set(`users/${UID}/pointHistory/legacy-1`, { type: 'earn', amount: 40, ledgerKey: 'PAY-REAL-1', captureId: 'CAP-1', createdAt: 4 });
  return db;
}

async function analyze(db: any) {
  const guarded = guardFirestore(db, { allowWrites: false });
  const usersSnap = await guarded.collection('users').get();
  const accounts: any[] = [];
  for (const d of usersSnap.docs) accounts.push(await loadAccount(guarded, d, calculateLoyaltyTier));
  return { accounts, stats: guarded.stats };
}

describe('돈으로 인정하는 기준', () => {
  it('검증된 USD capture 만 돈이다', () => {
    const ok = classifyBooking('O1', {
      orderID: 'O1', captureID: 'C1', currency: 'USD', amountUSD: 9.9, paymentVerified: true,
    });
    expect(ok.verdict).toBe('money');
    expect(ok.netUSD).toBe(9.9);
  });

  it('🔴 ADMIN-BYPASS / TEST 주문은 돈이 아니다', () => {
    expect(classifyBooking('ADMIN-BYPASS-1', { captureID: 'C', currency: 'USD', amountUSD: 500, paymentVerified: true }).verdict)
      .toBe('not_money');
    expect(classifyBooking('TEST-1', { captureID: 'C', currency: 'USD', amountUSD: 500, paymentVerified: true }).verdict)
      .toBe('not_money');
  });

  it('무료 쿠폰·무료 주문은 돈이 아니다', () => {
    for (const free of [{ isFreeCoupon: true }, { paymentSource: 'ai-coupon' }, { isFreeOrder: true }, { freeReason: 'promo' }]) {
      const c = classifyBooking('O', { orderID: 'O', captureID: 'C', currency: 'USD', amountUSD: 9.9, paymentVerified: true, ...free });
      expect(c.verdict).toBe('not_money');
    }
  });

  it('명시적 미검증은 돈이 아니고, 필드 부재는 ambiguous 다', () => {
    // 🔴 "필드가 없다" 와 "false" 는 다르다. paymentVerified·uid 는 2026-07-29 에 추가된 필드라
    //   그 이전 결제 문서에는 없다. 없는 것을 미검증으로 취급하면 과거 결제가 전부 0원으로 밀린다.
    expect(classifyBooking('O', { orderID: 'O', captureID: 'C', currency: 'USD', amountUSD: 9.9, paymentVerified: false }).verdict)
      .toBe('not_money');
    const legacy = classifyBooking('O', { orderID: 'O', captureID: 'C', currency: 'USD', amountUSD: 9.9 });
    expect(legacy.verdict).toBe('ambiguous');
    expect(legacy.reason).toBe('payment-verified-field-missing');
    expect(classifyBooking('O', { orderID: 'O', currency: 'USD', amountUSD: 9.9, paymentVerified: true }).verdict)
      .toBe('ambiguous');
  });

  it('🔴 통화·금액이 불완전하면 ambiguous — 임의 차감하지 않는다', () => {
    expect(classifyBooking('O', { orderID: 'O', captureID: 'C', amountUSD: 9.9, paymentVerified: true }).verdict)
      .toBe('ambiguous');
    expect(classifyBooking('O', { orderID: 'O', captureID: 'C', currency: 'KRW', amountUSD: 9.9, paymentVerified: true }).verdict)
      .toBe('ambiguous');
    expect(classifyBooking('O', { orderID: 'O', captureID: 'C', currency: 'USD', amountUSD: NaN, paymentVerified: true }).verdict)
      .toBe('ambiguous');
  });

  it('전액 환불은 0원·예약 미포함, 부분환불은 잔액만', () => {
    const full = classifyBooking('O', { orderID: 'O', captureID: 'C', currency: 'USD', amountUSD: 100, paymentVerified: true, status: 'REFUNDED', refundedUSDTotal: 100 });
    expect(full.netUSD).toBe(0);
    expect(full.countsAsBooking).toBe(false);

    const part = classifyBooking('O', { orderID: 'O', captureID: 'C', currency: 'USD', amountUSD: 200, paymentVerified: true, refundedUSDTotal: 50 });
    expect(part.netUSD).toBe(150);
    expect(part.countsAsBooking).toBe(true);
  });

  it('🔴 PayPal 주문 링크 없는 적립을 실제 결제로 인정하지 않는다', () => {
    const orders = new Map();
    expect(classifyHistoryEntry({ type: 'earn', amount: 2829, description: 'AI Plan: x ($942.86)' }, orders).kind)
      .toBe('polluted');
    expect(classifyHistoryEntry({ type: 'earn', amount: 40, description: 'Manual bonus' }, orders).kind)
      .toBe('ambiguous');
    expect(classifyHistoryEntry({ type: 'earn', amount: 30, ledgerKey: 'X', captureId: 'C' }, orders).kind)
      .toBe('ambiguous');   // 주문을 못 찾으면 추측하지 않는다
  });
});

describe('계정 집계 — 결제 원장이 기준', () => {
  it('원장이 완전하면 검증된 결제 기준으로 재계산한다', async () => {
    const { accounts } = await analyze(seedClean());
    const a = accounts[0];
    expect(a.mode).toBe('recompute_from_ledger');

    // $9.90 유지 + 부분환불 $150 = $159.90. 전액환불·ADMIN-BYPASS·무료는 0.
    expect(a.after.totalSpentUSD).toBe(159.9);
    // 예약 수 = 검증된 유료 주문 중 전액환불 제외 = 2건
    expect(a.after.bookingCount).toBe(2);
    expect(a.orders.verifiedPaidOrders).toBe(3);        // 전액환불 포함 3건이 '돈' 판정
    expect(a.orders.fullyRefundedOrders).toBe(1);
    expect(a.orders.notMoneyOrders).toBe(2);            // ADMIN-BYPASS + 무료
    // 코인 = 정상 적립(30+40) − 사용 4000 → 음수 → 0, 소진분은 따로 기록
    expect(a.after.tripCoins).toBe(0);
    expect(a.grandfatheredCoinDebt).toBe(3930);
    expect(a.after.tier).toBe('Bronze');
  });

  it('오염 이력은 집계되고 정상 적립은 보존된다', async () => {
    const { accounts } = await analyze(seedAccount());
    const a = accounts[0];
    expect(a.ledger.pollutedEntries).toBe(2);
    expect(a.ledger.pollutedCoins).toBe(2829 + 2121);
    expect(a.ledger.pollutedUSD).toBe(942.86 + 707.14);
    expect(a.ledger.legitEarnCoins).toBe(30);           // 정상 적립 보존
    expect(a.ledger.spendCoins).toBe(4000);             // 정상 사용 보존
  });

  it('🔴 애매한 이력은 오염으로 세지 않고 따로 보고된다', async () => {
    const { accounts } = await analyze(seedAccount());
    expect(accounts[0].ledger.ambiguousEntries).toBe(1);
    expect(accounts[0].ledger.ambiguousCoins).toBe(40);
  });

  it('🔴 근거가 불완전하면 전체 재계산 대신 오염분만 뺀다', async () => {
    const { accounts } = await analyze(seedAccount());   // 애매 이력 1건 있음
    const a = accounts[0];
    expect(a.mode).toBe('subtract_pollution_only');
    // 현재값에서 오염분만 차감 — 근거 없는 잔액은 건드리지 않는다.
    expect(a.after.totalSpentUSD).toBe(205925.12 - 1650);
    expect(a.after.tripCoins).toBe(756986 - 4950);
    expect(a.after.bookingCount).toBe(258);
    // 원장 기준이었다면 나왔을 값은 참고로만 남긴다.
    expect(a.ledgerBasedIfComplete.totalSpentUSD).toBe(159.9);
  });

  it('🔴 귀속 가능한 검증 주문이 0건이면 재계산하지 않는다 (0원으로 밀지 않음)', async () => {
    const db = createFakeFirestore({
      [`users/${UID}`]: { tripCoins: 1435, totalSpentUSD: 717.39, bookingCount: 1, tier: 'Gold' },
      [`users/${UID}/pointHistory/ai-1`]: {
        type: 'earn', amount: 1435, description: 'AI Plan: seoul ($717.39)', createdAt: 1,
      },
    });
    const { accounts } = await analyze(db);
    expect(accounts[0].orders.verifiedPaidOrders).toBe(0);
    expect(accounts[0].mode).toBe('subtract_pollution_only');
    expect(accounts[0].after.totalSpentUSD).toBe(0);   // 오염분이 전액이라 결과적으로 0
  });

  it('🔴 사용된 오염 쿠폰은 유지, 미사용만 회수 대상', async () => {
    const { accounts } = await analyze(seedAccount());
    const c = accounts[0].coupons;
    expect(c.pollutedUsed).toBe(1);      // 이미 할인 받음 — 재청구 없음
    expect(c.pollutedUnused).toBe(1);    // 사용 불가 전환 대상
    expect(c.grandfatheredDiscountPercentSum).toBe(15);
  });

  it('정상 결제로 발급된 쿠폰은 건드리지 않는다', async () => {
    // 정상 적립이 충분하면 오염 귀속분이 0 이다.
    const db = seedAccount({
      [`users/${UID}/pointHistory/earn_BIG`]: {
        type: 'earn', amount: 5000, ledgerKey: 'PAY-REAL-1', captureId: 'CAP-1', createdAt: 0,
      },
    });
    const { accounts } = await analyze(db);
    expect(accounts[0].coupons.pollutedUnused).toBe(0);
    expect(accounts[0].coupons.pollutedUsed).toBe(0);
  });

  it('출처 불명 쿠폰은 보류한다', async () => {
    const db = seedAccount({ [`users/${UID}/coupons/c-unknown`]: { isUsed: false, value: 10 } });
    const { accounts } = await analyze(db);
    expect(accounts[0].coupons.ambiguous).toBe(1);
  });

  it('예약 수는 검증된 유료 주문 수와 일치한다 (재계산 모드)', async () => {
    const { accounts } = await analyze(seedClean());
    const a = accounts[0];
    expect(a.after.bookingCount).toBe(a.orders.verifiedPaidOrders - a.orders.fullyRefundedOrders);
  });
});

describe('dry-run 은 쓰기가 구조적으로 불가능하다', () => {
  it('set/update/delete/batch/runTransaction 호출이 예외를 던진다', async () => {
    const guarded = guardFirestore(seedAccount(), { allowWrites: false });
    expect(() => guarded.collection('users').doc(UID).set({ x: 1 })).toThrow(/DRY_RUN_WRITE_BLOCKED/);
    expect(() => guarded.collection('users').doc(UID).update({ x: 1 })).toThrow(/DRY_RUN_WRITE_BLOCKED/);
    expect(() => guarded.collection('users').doc(UID).delete()).toThrow(/DRY_RUN_WRITE_BLOCKED/);
    expect(() => guarded.batch()).toThrow(/DRY_RUN_WRITE_BLOCKED/);
    expect(() => guarded.runTransaction(async () => {})).toThrow(/DRY_RUN_WRITE_BLOCKED/);
  });

  it('전체 분석을 돌려도 실제 쓰기 0건', async () => {
    const db = seedAccount();
    const before = JSON.stringify(db.__dump());
    const { stats } = await analyze(db);
    expect(stats.writesAllowed).toBe(0);
    expect(stats.reads).toBeGreaterThan(0);
    expect(JSON.stringify(db.__dump())).toBe(before);   // 문서가 한 글자도 안 바뀜
  });
});

describe('실행 — transaction · 멱등 · 부분 성공 없음', () => {
  async function runExecute(db: any) {
    const { accounts } = await analyze(db);
    const planHash = planHashOf(accounts);
    const writable = guardFirestore(db, { allowWrites: true });
    const result = await executeRemediation({ db: writable, accounts, planHash });
    return { result, planHash, accounts };
  }

  it('보정 후 값이 기대치와 같고 원장·쿠폰·스냅샷이 남는다', async () => {
    const db = seedClean();
    const { result, planHash } = await runExecute(db);
    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);

    const u = db.__get(`users/${UID}`)!;
    expect(u.totalSpentUSD).toBe(159.9);
    expect(u.bookingCount).toBe(2);
    expect(u.tripCoins).toBe(0);
    expect(u.tier).toBe('Bronze');

    // 기존 이력은 그대로 있고 역분개만 추가됐다
    expect(db.__get(`users/${UID}/pointHistory/ai-1`)).toBeTruthy();
    const corr = db.__get(`users/${UID}/pointHistory/${correctionDocId(planHash)}`)!;
    expect(corr.type).toBe('correction');
    expect(corr.correction.spentUSDBefore).toBe(205925.12);

    // 미사용 오염 쿠폰만 revoked, 사용된 것은 그대로
    expect(db.__get(`users/${UID}/coupons/c-unused`)!.status).toBe('revoked');
    expect(db.__get(`users/${UID}/coupons/c-used`)!.status).toBeUndefined();
    expect(db.__get(`users/${UID}/coupons/c-used`)!.isUsed).toBe(true);

    // 복구 스냅샷
    const snap = db.__get(`admin_loyalty_remediation_snapshots/${planHash}/users/${UID}`)!;
    expect(snap.before.tripCoins).toBe(756986);
  });

  it('🔴 같은 보정을 두 번 실행해도 값이 변하지 않는다', async () => {
    const db = seedClean();
    const { planHash } = await runExecute(db);
    const after1 = JSON.stringify(db.__dump());

    const { accounts: acc2 } = await analyze(db);
    const writable = guardFirestore(db, { allowWrites: true });
    const second = await executeRemediation({ db: writable, accounts: acc2, planHash });

    expect(second.applied).toHaveLength(0);
    // 두 번째 실행에서 바뀐 값이 없다
    const u = db.__get(`users/${UID}`)!;
    expect(u.totalSpentUSD).toBe(159.9);
    expect(u.tripCoins).toBe(0);
    expect(JSON.parse(after1)[`users/${UID}`].tier).toBe('Bronze');
  });

  it('🔴 transaction 중간 실패 시 모든 값이 불변', async () => {
    const db = seedAccount();
    const before = JSON.stringify(db.__dump());
    const { accounts } = await analyze(db);
    const planHash = planHashOf(accounts);

    const writable = guardFirestore(db, { allowWrites: true });
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    const result = await executeRemediation({ db: writable, accounts, planHash });
    db.__beforeCommit = null;

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(JSON.stringify(db.__dump())).toBe(before);
  });

  it('실행 후 다시 dry-run 하면 더 바꿀 것이 없다', async () => {
    const db = seedClean();
    await runExecute(db);
    const { accounts } = await analyze(db);
    const a = accounts[0];
    expect(a.changed).toBe(false);                 // 수렴
    expect(a.after.totalSpentUSD).toBe(a.before.totalSpentUSD);
    expect(a.after.tripCoins).toBe(a.before.tripCoins);
  });

  it('계정 하나가 실패해도 다른 계정 결과를 가리지 않는다', async () => {
    const db = seedAccount({ 'users/u-other': { tripCoins: 0, totalSpentUSD: 0, bookingCount: 0, tier: 'Bronze' } });
    const { accounts } = await analyze(db);
    const planHash = planHashOf(accounts);
    const writable = guardFirestore(db, { allowWrites: true });
    // 대상 계정 목록에 존재하지 않는 uid 를 하나 섞어 실패를 만든다.
    const withBroken = [...accounts.filter((x: any) => x.changed), {
      ...accounts[0], uid: 'ghost', changed: true, _pollutedUnusedCouponIds: [],
    }];
    const result = await executeRemediation({ db: writable, accounts: withBroken, planHash });
    expect(result.applied.length + result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped.some((s: any) => s.reason === 'user_missing')).toBe(true);
  });

  it('계획 해시는 대상·합계가 바뀌면 달라진다', async () => {
    const { accounts: a1 } = await analyze(seedClean());
    const { accounts: a2 } = await analyze(seedAccount({
      [`bookings/PAY-REAL-2`]: {
        uid: UID, orderID: 'PAY-REAL-2', captureID: 'CAP-9', currency: 'USD',
        amountUSD: 50, paymentVerified: true, status: 'CONFIRMED',
      },
    }));
    expect(planHashOf(a1)).not.toBe(planHashOf(a2));
    expect(planHashOf(a1)).toBe(planHashOf((await analyze(seedClean())).accounts));  // 같은 입력 = 같은 해시
  });
});

describe('보고서에 개인정보가 없다', () => {
  it('계정은 순번만, uid·이메일·PayPal ID 미포함', async () => {
    const { accounts, stats } = await analyze(seedAccount());
    const { buildReport } = await import('../../scripts/lib/loyalty-remediation-core.mjs');
    const report = buildReport({
      accounts, scanned: 1, stats, projectId: 'planning-with-ai-a0801', planHash: 'abc123',
    });
    const raw = JSON.stringify(report);
    expect(raw).not.toContain(UID);
    expect(raw).not.toContain('PAY-REAL-1');
    expect(raw).not.toContain('CAP-1');
    expect(raw).not.toMatch(/@/);
    expect(raw).not.toContain('planning-with-ai-a0801');
    expect(report.accounts[0].no).toBe(1);
    expect((report.accounts[0] as any).uid).toBeUndefined();
  });

  it('FieldValue 는 실제 admin SDK 것을 쓴다 (테스트 가짜와 혼동 금지)', () => {
    expect(typeof FieldValue.serverTimestamp).toBe('function');
  });
});
