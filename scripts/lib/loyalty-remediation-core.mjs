/**
 * 충성도 원장 오염 보정 — **순수 로직** (판별·집계·보고서 생성).
 *
 * CLI(scripts/loyalty-remediation.mjs)와 테스트가 함께 쓴다.
 * 이 파일에는 셰뱅·env 로딩·Firestore 초기화가 없다 — 그래서 테스트에서 그대로 import 된다.
 * Firestore 쓰기 코드도 없다(실행부는 loyalty-remediation-execute.mjs).
 */

import { createHash } from 'crypto';

// ── 판별 기준 (돈으로 인정할 수 있는가) ─────────────────────────────────────
const NON_MONEY_ORDER_PREFIX = /^(TEST-|ADMIN-BYPASS-)/;
/** planPersister 가 남기던 문구 — 결제 원장 없이 만들어진 적립. */
const AI_PLAN_DESC = /^AI Plan:/;
/** 전액 환불로 볼 하한 (수수료·잔돈 흡수) — api/_shared/refund-ledger.js 와 동일 비율. */
const FULL_REFUND_RATIO = 0.99;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 등급표 — api/_shared/loyalty-policy.js 와 같은 기준을 쓴다(중복 정의 금지). */
export async function loadTierPolicy() {
  const mod = await import('../../api/_shared/loyalty-policy.js');
  return mod.calculateLoyaltyTier;
}

/**
 * 🔴 쓰기 차단 래퍼 — dry-run 에서 Firestore 쓰기가 **구조적으로 불가능**하게 만든다.
 *   "쓰기 코드를 안 넣었다" 가 아니라 "호출하면 던진다" 가 증거다.
 */
export function guardFirestore(db, { allowWrites }) {
  const stats = { reads: 0, writeAttempts: 0, writesAllowed: 0 };
  const WRITE_METHODS = new Set(['set', 'update', 'delete', 'create', 'add']);

  const wrapDoc = (ref) => new Proxy(ref, {
    get(target, prop) {
      const orig = target[prop];
      if (prop === 'get') {
        return async (...a) => { stats.reads += 1; return orig.apply(target, a); };
      }
      if (prop === 'collection') {
        return (...a) => wrapCollection(orig.apply(target, a));
      }
      if (WRITE_METHODS.has(prop)) {
        return (...a) => {
          stats.writeAttempts += 1;
          if (!allowWrites) {
            throw new Error(`DRY_RUN_WRITE_BLOCKED: ${String(prop)} on ${target.path}`);
          }
          stats.writesAllowed += 1;
          return orig.apply(target, a);
        };
      }
      return typeof orig === 'function' ? orig.bind(target) : orig;
    },
  });

  const wrapQuery = (q) => new Proxy(q, {
    get(target, prop) {
      const orig = target[prop];
      if (prop === 'get') {
        return async (...a) => { stats.reads += 1; return orig.apply(target, a); };
      }
      if (['where', 'orderBy', 'limit', 'startAfter', 'select'].includes(prop)) {
        return (...a) => wrapQuery(orig.apply(target, a));
      }
      if (prop === 'doc') return (...a) => wrapDoc(orig.apply(target, a));
      return typeof orig === 'function' ? orig.bind(target) : orig;
    },
  });
  const wrapCollection = wrapQuery;

  return {
    stats,
    collection: (name) => wrapCollection(db.collection(name)),
    runTransaction: (fn, opts) => {
      stats.writeAttempts += 1;
      if (!allowWrites) throw new Error('DRY_RUN_WRITE_BLOCKED: runTransaction');
      stats.writesAllowed += 1;
      return db.runTransaction(fn, opts);
    },
    batch: () => {
      stats.writeAttempts += 1;
      if (!allowWrites) throw new Error('DRY_RUN_WRITE_BLOCKED: batch');
      stats.writesAllowed += 1;
      return db.batch();
    },
    raw: db,
  };
}

/** 이 예약이 **실제 돈**으로 인정되는가? 하나라도 어긋나면 인정하지 않는다. */
export function classifyBooking(docId, d) {
  const data = d || {};
  const orderID = String(data.orderID || docId || '');
  if (!orderID) return { verdict: 'not_money', reason: 'no-orderID' };
  if (NON_MONEY_ORDER_PREFIX.test(orderID)) return { verdict: 'not_money', reason: 'admin-or-test-order' };
  if (data.isFreeCoupon === true) return { verdict: 'not_money', reason: 'free-coupon' };
  if (data.paymentSource === 'ai-coupon') return { verdict: 'not_money', reason: 'free-ai-coupon' };
  if (data.isFreeOrder === true) return { verdict: 'not_money', reason: 'free-order' };
  if (data.freeReason) return { verdict: 'not_money', reason: 'free-verified' };

  // 🔴 "필드가 없다" 와 "명시적으로 false" 는 다르다.
  //   paymentVerified·uid 는 2026-07-29 PR 에서 추가된 필드다. 그 이전 결제 문서에는 없다.
  //   없는 것을 '검증 실패'로 취급하면 **과거 실제 결제가 전부 0원으로 밀린다.**
  //   근거가 없으면 차감하지 않는다 → ambiguous 로 분리해 사람이 판단하게 한다.
  if (data.paymentVerified === false) return { verdict: 'not_money', reason: 'payment-verified-false' };
  if (data.paymentVerified !== true) return { verdict: 'ambiguous', reason: 'payment-verified-field-missing' };
  if (!data.captureID) return { verdict: 'ambiguous', reason: 'no-captureID' };

  const currency = String(data.currency || '').toUpperCase();
  if (currency && currency !== 'USD') return { verdict: 'ambiguous', reason: `currency-${currency}` };
  if (!currency) return { verdict: 'ambiguous', reason: 'currency-missing' };

  const amountUSD = Number(data.amountUSD);
  if (!Number.isFinite(amountUSD) || amountUSD <= 0) {
    return { verdict: 'ambiguous', reason: 'amount-invalid' };
  }

  const status = String(data.status || '');
  const refunded = Math.max(0, num(data.refundedUSDTotal));
  const fullyRefunded = status === 'REFUNDED'
    || status === 'CANCELED'
    || refunded >= amountUSD * FULL_REFUND_RATIO;

  const netUSD = fullyRefunded ? 0 : round2(Math.max(0, amountUSD - refunded));
  return {
    verdict: 'money',
    orderID,
    amountUSD: round2(amountUSD),
    refundedUSD: round2(refunded),
    netUSD,
    fullyRefunded,
    partiallyRefunded: !fullyRefunded && refunded > 0,
    countsAsBooking: !fullyRefunded,
  };
}

/** pointHistory 항목 분류. 결제 원장과 대조 가능한 것만 정상 적립으로 본다. */
export function classifyHistoryEntry(entry, moneyOrders) {
  const d = entry || {};
  const type = String(d.type || '');
  const coins = num(d.amount);

  if (type === 'spend') return { kind: 'spend', coins: Math.abs(coins) };
  if (type === 'correction') return { kind: 'correction', coins };
  if (type !== 'earn') return { kind: 'other', coins };

  const desc = String(d.description || '');
  if (AI_PLAN_DESC.test(desc)) {
    const m = desc.match(/\$([0-9]+(?:\.[0-9]+)?)/);
    return { kind: 'polluted', coins, usd: m ? Number(m[1]) : 0, reason: 'ai-plan-estimate' };
  }
  const key = String(d.ledgerKey || d.bookingRef || '');
  if (!key || !d.captureId) {
    return { kind: 'ambiguous', coins, reason: 'no-order-or-capture-link' };
  }
  if (NON_MONEY_ORDER_PREFIX.test(key)) {
    return { kind: 'polluted', coins, usd: num(d.amountUSD), reason: 'admin-or-test-order' };
  }
  const order = moneyOrders.get(key);
  if (!order) return { kind: 'ambiguous', coins, reason: 'order-not-found-or-not-money' };
  return { kind: 'legit', coins, orderID: key };
}

export async function loadAccount(db, userDoc, calculateLoyaltyTier) {
  const u = userDoc.data() || {};

  // 🔴 userDoc.ref 는 **래핑되지 않은** 원본 참조다. 그걸로 읽으면 읽기 수가 안 세지고
  //   (더 중요하게) 쓰기 차단 가드도 우회한다. 항상 래핑된 db 로 다시 잡는다.
  const userRef = db.collection('users').doc(userDoc.id);
  const [histSnap, couponSnap, bookingSnap] = await Promise.all([
    userRef.collection('pointHistory').get(),
    userRef.collection('coupons').get(),
    db.collection('bookings').where('uid', '==', userDoc.id).get(),
  ]);

  // ── 1. 결제 원장 (진실의 기준) — 같은 orderID 는 한 번만 센다 ──
  const moneyOrders = new Map();
  const notMoney = [];
  const ambiguousBookings = [];
  for (const b of bookingSnap.docs) {
    const c = classifyBooking(b.id, b.data());
    if (c.verdict === 'money') {
      if (!moneyOrders.has(c.orderID)) moneyOrders.set(c.orderID, c);
      continue;
    }
    if (c.verdict === 'ambiguous') ambiguousBookings.push(c.reason);
    else notMoney.push(c.reason);
  }
  let expectedSpentUSD = 0;
  let expectedBookingCount = 0;
  let refundedOrders = 0;
  let partialRefundOrders = 0;
  for (const o of moneyOrders.values()) {
    expectedSpentUSD = round2(expectedSpentUSD + o.netUSD);
    if (o.countsAsBooking) expectedBookingCount += 1;
    if (o.fullyRefunded) refundedOrders += 1;
    if (o.partiallyRefunded) partialRefundOrders += 1;
  }

  // ── 2. pointHistory 분류 ──
  let legitEarnCoins = 0;
  let pollutedCoins = 0;
  let pollutedUSD = 0;
  let pollutedEntries = 0;
  let legitEntries = 0;
  let ambiguousEntries = 0;
  let ambiguousCoins = 0;
  let spendCoins = 0;
  let correctionCoins = 0;
  let correctionEntries = 0;
  // 지난 보정이 이미 제거한 오염분 — 이번 계산에서 중복 차감하지 않기 위한 값.
  let alreadyRemovedUSD = 0;
  let alreadyRemovedCoins = 0;
  let alreadyRemovedBookings = 0;
  let alreadyRemovedEntries = 0;
  for (const h of histSnap.docs) {
    const c = classifyHistoryEntry(h.data(), moneyOrders);
    if (c.kind === 'legit') { legitEarnCoins += c.coins; legitEntries += 1; }
    else if (c.kind === 'polluted') {
      pollutedCoins += c.coins; pollutedUSD += num(c.usd); pollutedEntries += 1;
    } else if (c.kind === 'ambiguous') { ambiguousEntries += 1; ambiguousCoins += c.coins; }
    else if (c.kind === 'spend') spendCoins += c.coins;
    else if (c.kind === 'correction') {
      correctionCoins += c.coins; correctionEntries += 1;
      // 🔴 이미 보정으로 **빼낸 오염분**을 기록해 둔다.
      //   오염 이력(pointHistory)은 감사 목적상 삭제하지 않으므로, 다음 실행에서 다시 계산된다.
      //   그걸 그대로 또 빼면 같은 금액을 두 번 차감해 정상 잔액까지 0 으로 만든다.
      const meta = (h.data() || {}).correction || {};
      alreadyRemovedUSD += Math.max(0, num(meta.spentUSDBefore) - num(meta.spentUSDAfter));
      alreadyRemovedBookings += Math.max(0, num(meta.bookingCountBefore) - num(meta.bookingCountAfter));
      alreadyRemovedCoins += Math.max(0, -c.coins);
      alreadyRemovedEntries += num(meta.pollutedEntries);
    }
  }

  // ── 3. 기대 코인 = 정상 적립 − 사용 ──
  //   🔴 correction 항목은 **더하지 않는다.** 그것은 독립적인 코인 이동이 아니라
  //   "목표값으로 맞춘 기록"이다. 다시 더하면 재실행 때마다 값이 또 깎여 수렴하지 않는다.
  //   (감사용으로 개수·합계만 보고한다.)
  //   음수가 되면 이미 오염 코인으로 할인을 받은 것 → 0 으로 두고 규모를 따로 기록한다
  //   (고객에게 재청구하지 않는다는 정책).
  const rawExpectedCoins = legitEarnCoins - spendCoins;
  const expectedCoins = Math.max(0, rawExpectedCoins);
  const grandfatheredCoinDebt = Math.max(0, -rawExpectedCoins);

  // ── 4. 쿠폰 — 오염 코인으로 교환된 몫을 최신순으로 귀속 ──
  const redemptionCoupons = [];
  let otherCoupons = 0;
  let ambiguousCoupons = 0;
  let couponsTotal = 0;
  let couponsUsedTotal = 0;
  for (const c of couponSnap.docs) {
    const cd = c.data() || {};
    couponsTotal += 1;
    if (cd.isUsed === true) couponsUsedTotal += 1;
    if (cd.source === 'coin_redemption' && Number.isFinite(Number(cd.coinsSpent))) {
      redemptionCoupons.push({
        id: c.id, coinsSpent: num(cd.coinsSpent), isUsed: cd.isUsed === true,
        createdAt: num(cd.createdAt), percent: num(cd.value),
        // 이미 회수된 쿠폰은 다시 회수 대상으로 세지 않는다(재실행 수렴).
        // 🔴 실제 차단 스위치는 isRevoked 다. status 는 감사용 보조 표시.
        alreadyRevoked: cd.isRevoked === true || cd.status === 'revoked',
      });
    } else if (cd.source) otherCoupons += 1;
    else ambiguousCoupons += 1;   // 출처 불명 — 오염 여부 판단 불가 → 보류
  }
  redemptionCoupons.sort((a, b) => b.createdAt - a.createdAt);   // 최신 교환부터 오염 귀속
  const pollutionFundedCoins = Math.max(0, spendCoins - legitEarnCoins);
  let attributed = 0;
  const pollutedCouponsUnused = [];
  const pollutedCouponsUsed = [];
  let alreadyRevokedCoupons = 0;
  for (const c of redemptionCoupons) {
    if (attributed >= pollutionFundedCoins) break;
    attributed += c.coinsSpent;
    if (c.alreadyRevoked) { alreadyRevokedCoupons += 1; continue; }   // 이미 처리됨
    if (c.isUsed) pollutedCouponsUsed.push(c);
    else pollutedCouponsUnused.push(c);
  }
  const legitCoupons = redemptionCoupons.length
    - pollutedCouponsUnused.length - pollutedCouponsUsed.length - alreadyRevokedCoupons;

  const currentSpentUSDRaw = num(u.totalSpentUSD);
  const currentSpentUSD = round2(currentSpentUSDRaw);
  const currentBookingCount = num(u.bookingCount);
  const currentCoins = num(u.tripCoins);
  const currentTier = String(u.tier || 'Bronze');

  // ── 5. 보정 방식 결정 ──────────────────────────────────────────────────
  // 🔴 결제 원장이 완전할 때만 "전부 다시 계산" 이 안전하다.
  //   근거가 불완전한 주문(레거시 필드 누락 등)이 하나라도 있으면 전체 재계산은
  //   **근거 없는 차감**이 된다. 그럴 땐 명백한 오염분만 빼고 나머지는 손대지 않는다.
  //   🔴 귀속 가능한 검증 주문이 **0건인데 현재 지출이 남아 있는** 계정도 재계산하면 안 된다.
  //     "근거를 못 찾았다" 는 "결제가 없었다" 가 아니다. 실제로 bookings 문서에 uid 필드가
  //     없던 시기의 결제는 계정에 붙지 않는다 → 재계산하면 전액이 0 으로 밀린다.
  const attributable = moneyOrders.size > 0 || currentSpentUSDRaw === 0;
  const ledgerComplete = ambiguousBookings.length === 0 && ambiguousEntries === 0 && attributable;
  const mode = ledgerComplete ? 'recompute_from_ledger' : 'subtract_pollution_only';

  // 🔴 아직 빼지 않은 오염분만 뺀다. 지난 보정이 제거한 몫은 제외한다(재실행 수렴).
  const remainingPollutedUSD = round2(Math.max(0, pollutedUSD - alreadyRemovedUSD));
  const remainingPollutedCoins = Math.max(0, pollutedCoins - alreadyRemovedCoins);
  const remainingPollutedEntries = Math.max(0, pollutedEntries - alreadyRemovedEntries);
  const subtractSpent = round2(Math.max(0, currentSpentUSD - remainingPollutedUSD));
  const subtractBookings = Math.max(0, currentBookingCount - remainingPollutedBookings());
  const subtractCoins = Math.max(0, currentCoins - remainingPollutedCoins);
  function remainingPollutedBookings() {
    return Math.max(0, pollutedEntries - alreadyRemovedBookings);
  }

  const afterSpent = ledgerComplete ? expectedSpentUSD : subtractSpent;
  const afterBookings = ledgerComplete ? expectedBookingCount : subtractBookings;
  const afterCoins = ledgerComplete ? expectedCoins : subtractCoins;
  const expectedTier = calculateLoyaltyTier(afterSpent, afterBookings).name;

  const changed = currentSpentUSD !== afterSpent
    || currentBookingCount !== afterBookings
    || currentCoins !== afterCoins
    || currentTier !== expectedTier
    || pollutedCouponsUnused.length > 0;

  return {
    uid: userDoc.id,                                  // ⚠️ 보고서에는 절대 넣지 않는다
    changed,
    mode,
    before: { totalSpentUSD: currentSpentUSD, bookingCount: currentBookingCount, tripCoins: currentCoins, tier: currentTier },
    after: { totalSpentUSD: afterSpent, bookingCount: afterBookings, tripCoins: afterCoins, tier: expectedTier },
    delta: {
      totalSpentUSD: round2(afterSpent - currentSpentUSD),
      bookingCount: afterBookings - currentBookingCount,
      tripCoins: afterCoins - currentCoins,
    },
    // 원장이 완전했다면 나왔을 값 — 참고용(자동 적용하지 않는다).
    ledgerBasedIfComplete: {
      totalSpentUSD: expectedSpentUSD, bookingCount: expectedBookingCount, tripCoins: expectedCoins,
    },
    ledger: {
      pollutedEntries, pollutedCoins, pollutedUSD: round2(pollutedUSD),
      legitEntries, legitEarnCoins,
      ambiguousEntries, ambiguousCoins,
      spendCoins, correctionEntries, correctionCoins,
      alreadyRemovedUSD: round2(alreadyRemovedUSD),
      alreadyRemovedCoins,
      alreadyRemovedEntries,
      remainingPollutedUSD, remainingPollutedCoins, remainingPollutedEntries,
    },
    orders: {
      verifiedPaidOrders: moneyOrders.size,
      countedBookings: expectedBookingCount,
      fullyRefundedOrders: refundedOrders,
      partiallyRefundedOrders: partialRefundOrders,
      notMoneyOrders: notMoney.length,
      ambiguousOrders: ambiguousBookings.length,
      ambiguousOrderReasons: [...new Set(ambiguousBookings)].sort(),
    },
    coupons: {
      couponsTotal,
      couponsUsedTotal,
      redemptionTotal: redemptionCoupons.length,
      legitRedemption: Math.max(0, legitCoupons),
      pollutedUnused: pollutedCouponsUnused.length,
      pollutedUsed: pollutedCouponsUsed.length,
      ambiguous: ambiguousCoupons,
      otherSource: otherCoupons,
      grandfatheredDiscountPercentSum: pollutedCouponsUsed.reduce((s, c) => s + c.percent, 0),
      pollutionFundedCoins,
    },
    grandfatheredCoinDebt,
    // 🔴 FAIL-2: 실행 시 이 계정에서 바뀔 문서 수.
    //   복구 스냅샷 1 + 사용자 문서 1 + correction 원장 1 + 회수 쿠폰 N.
    //   이전 계산은 복구 스냅샷을 빠뜨려 계정마다 1건씩 적게 보고했다.
    docsToWrite: changed ? 3 + pollutedCouponsUnused.length : 0,
    docsBreakdown: changed
      ? { snapshot: 1, user: 1, correction: 1, coupons: pollutedCouponsUnused.length }
      : { snapshot: 0, user: 0, correction: 0, coupons: 0 },
    _pollutedUnusedCouponIds: pollutedCouponsUnused.map((c) => c.id),   // 실행 전용, 보고서 제외
  };
}

/** 보고서·확인 토큰의 기준이 되는 계획 해시 — 대상과 합계가 바뀌면 값이 달라진다. */
export function planHashOf(accounts) {
  const normalized = accounts
    .filter((a) => a.changed)
    .map((a) => [a.uid, a.after.totalSpentUSD, a.after.bookingCount, a.after.tripCoins, a.after.tier,
      a._pollutedUnusedCouponIds.slice().sort().join(',')].join('|'))
    .sort();
  return createHash('sha256').update(normalized.join('\n')).digest('hex').slice(0, 16);
}

export function buildReport({ accounts, scanned, stats, projectId, planHash }) {
  const targets = accounts.filter((a) => a.changed);
  const sum = (fn) => targets.reduce((s, a) => s + fn(a), 0);
  const totals = {
    scannedUsers: scanned,
    accountsToFix: targets.length,
    before: {
      totalSpentUSD: round2(sum((a) => a.before.totalSpentUSD)),
      bookingCount: sum((a) => a.before.bookingCount),
      tripCoins: sum((a) => a.before.tripCoins),
    },
    after: {
      totalSpentUSD: round2(sum((a) => a.after.totalSpentUSD)),
      bookingCount: sum((a) => a.after.bookingCount),
      tripCoins: sum((a) => a.after.tripCoins),
    },
    pollutedEntries: sum((a) => a.ledger.pollutedEntries),
    pollutedCoins: sum((a) => a.ledger.pollutedCoins),
    pollutedUSD: round2(sum((a) => a.ledger.pollutedUSD)),
    ambiguousEntries: sum((a) => a.ledger.ambiguousEntries),
    // 🔴 FAIL-7: "계정 안에서 애매한 주문" 과 "아예 계정에 붙지 않는 레거시 주문" 은 다르다.
    //   전자만 0 이라고 보고하면 후자 29건이 정상 검증된 것처럼 보인다.
    ambiguousOrdersInAccounts: sum((a) => a.orders.ambiguousOrders),
    ambiguousCoupons: sum((a) => a.coupons.ambiguous),
    couponsHeldTotal: sum((a) => a.coupons.couponsTotal),
    couponsUsedTotal: sum((a) => a.coupons.couponsUsedTotal),
    couponsToRevoke: sum((a) => a.coupons.pollutedUnused),
    couponsGrandfathered: sum((a) => a.coupons.pollutedUsed),
    grandfatheredDiscountPercentSum: sum((a) => a.coupons.grandfatheredDiscountPercentSum),
    grandfatheredCoinDebt: sum((a) => a.grandfatheredCoinDebt),
    // 🔴 보정 후에도 **검증된 결제로 뒷받침되지 않는** 잔액. 이 값이 크면 결제 원장이
    //   계정에 붙지 않는다는 뜻이다(레거시 bookings 에 uid 필드가 없던 시기).
    afterUnbackedUSD: round2(sum((a) => Math.max(0, a.after.totalSpentUSD - a.ledgerBasedIfComplete.totalSpentUSD))),
    afterBackedUSD: round2(sum((a) => a.ledgerBasedIfComplete.totalSpentUSD)),
    preservedLegitCoins: sum((a) => a.ledger.legitEarnCoins),
    preservedVerifiedOrders: sum((a) => a.orders.verifiedPaidOrders),
    docsToWrite: sum((a) => a.docsToWrite),
    modes: targets.reduce((m, a) => { m[a.mode] = (m[a.mode] || 0) + 1; return m; }, {}),
  };

  return {
    _note: '읽기 전용 dry-run 결과. 개인정보(uid·이메일·예약번호·PayPal ID) 미포함. 계정은 순번만.',
    generatedForProject: projectId ? `${projectId.slice(0, 4)}…(마스킹)` : 'unknown',
    planHash,
    firestore: {
      reads: stats.reads,
      writeAttempts: stats.writeAttempts,
      writesAllowed: stats.writesAllowed,
      guard: 'dry-run 에서는 set/update/delete/add/batch/runTransaction 호출이 예외를 던진다',
    },
    totals,
    accounts: targets.map((a, i) => ({
      no: i + 1,
      mode: a.mode,
      before: a.before,
      after: a.after,
      delta: a.delta,
      ledger: a.ledger,
      orders: a.orders,
      coupons: {
        couponsTotal: a.coupons.couponsTotal,
        couponsUsedTotal: a.coupons.couponsUsedTotal,
        redemptionTotal: a.coupons.redemptionTotal,
        legitRedemption: a.coupons.legitRedemption,
        toRevoke: a.coupons.pollutedUnused,
        grandfathered: a.coupons.pollutedUsed,
        ambiguous: a.coupons.ambiguous,
      },
      grandfatheredCoinDebt: a.grandfatheredCoinDebt,
      ledgerBasedIfComplete: a.ledgerBasedIfComplete,
      docsToWrite: a.docsToWrite,
      docsBreakdown: a.docsBreakdown,
    })),
  };
}

export function toMarkdown(r) {
  const L = [];
  L.push('# 충성도 원장 오염 보정 — dry-run 보고서', '');
  L.push('> 읽기 전용 실행 결과. 운영 데이터는 **수정하지 않았다.**');
  L.push('> 개인정보(uid·이메일·예약번호·PayPal ID)는 담지 않는다. 계정은 순번으로만 표시.', '');
  L.push(`- 계획 해시(planHash): \`${r.planHash}\``);
  L.push(`- Firestore 읽기: ${r.firestore.reads}회 / **쓰기 시도: ${r.firestore.writeAttempts}회 / 실제 쓰기: ${r.firestore.writesAllowed}회**`);
  L.push(`- 쓰기 차단 방식: ${r.firestore.guard}`, '');

  L.push('## 전체 합계', '');
  L.push('| 항목 | 수정 전 | 수정 후 | 차이 |');
  L.push('|---|---:|---:|---:|');
  L.push(`| 누적 지출(USD) | $${r.totals.before.totalSpentUSD.toLocaleString()} | $${r.totals.after.totalSpentUSD.toLocaleString()} | ${round2(r.totals.after.totalSpentUSD - r.totals.before.totalSpentUSD).toLocaleString()} |`);
  L.push(`| 예약 수 | ${r.totals.before.bookingCount} | ${r.totals.after.bookingCount} | ${r.totals.after.bookingCount - r.totals.before.bookingCount} |`);
  L.push(`| 코인 | ${r.totals.before.tripCoins.toLocaleString()} | ${r.totals.after.tripCoins.toLocaleString()} | ${(r.totals.after.tripCoins - r.totals.before.tripCoins).toLocaleString()} |`);
  L.push('');
  L.push(`- 보정 대상 계정: **${r.totals.accountsToFix}** (스캔 ${r.totals.scannedUsers})`);
  L.push(`- 오염 적립 이력: ${r.totals.pollutedEntries}건 / 코인 ${r.totals.pollutedCoins.toLocaleString()} / 지출 $${r.totals.pollutedUSD.toLocaleString()}`);
  const br = r.accounts.reduce((t, a) => ({
    snapshot: t.snapshot + a.docsBreakdown.snapshot,
    user: t.user + a.docsBreakdown.user,
    correction: t.correction + a.docsBreakdown.correction,
    coupons: t.coupons + a.docsBreakdown.coupons,
  }), { snapshot: 0, user: 0, correction: 0, coupons: 0 });
  L.push(`- 실행 시 바뀔 문서 수: **${r.totals.docsToWrite}**`);
  L.push(`  (복구 스냅샷 ${br.snapshot} + 사용자 ${br.user} + correction 원장 ${br.correction} + 회수 쿠폰 ${br.coupons})`, '');

  L.push('## 🔴 보정 방식 (계정별)', '');
  L.push('| 방식 | 계정 수 | 뜻 |');
  L.push('|---|---:|---|');
  L.push(`| \`subtract_pollution_only\` | ${r.totals.modes.subtract_pollution_only || 0} | 명백한 오염분만 차감. 나머지는 손대지 않음 |`);
  L.push(`| \`recompute_from_ledger\` | ${r.totals.modes.recompute_from_ledger || 0} | 결제 원장으로 전부 재계산(원장이 완전할 때만) |`);
  L.push('');
  if (r.bookingLedger) {
    L.push('### 결제 원장 귀속 현황', '');
    L.push(`- bookings 총 ${r.bookingLedger.total}건 중 **uid 필드가 있는 것 ${r.bookingLedger.withUid}건**, \`paymentVerified===true\` ${r.bookingLedger.paymentVerified}건`);
    L.push(`- 계정에 귀속 불가: **${r.bookingLedger.unattributable}건**`);
    L.push(`- ${r.bookingLedger.note}`);
    L.push('- 그래서 이번 보정은 **전체 재계산을 쓰지 않는다.** 근거가 확실한 오염분만 뺀다.', '');
  }
  L.push(`- 보정 후 잔액 중 **검증된 결제로 뒷받침되는 금액: $${r.totals.afterBackedUSD.toLocaleString()}**`);
  L.push(`- 보정 후 잔액 중 **근거를 붙이지 못한 금액: $${r.totals.afterUnbackedUSD.toLocaleString()}** (건드리지 않음)`, '');

  L.push('## 정상으로 보존할 데이터', '');
  L.push(`- 검증된 유료 주문: ${r.totals.preservedVerifiedOrders}건`);
  L.push(`- 정상 적립 코인: ${r.totals.preservedLegitCoins.toLocaleString()}`);
  L.push('- 기존 pointHistory 는 **삭제하지 않는다.** 역분개(correction) 항목만 추가한다.', '');

  L.push('## 애매하여 보류한 데이터 (자동 수정 안 함)', '');
  L.push(`- 결제 근거가 불완전한 적립 이력: ${r.totals.ambiguousEntries}건`);
  L.push(`- **계정 내부** 애매 주문(통화·금액 불완전): ${r.totals.ambiguousOrdersInAccounts}건`);
  if (r.bookingLedger) {
    L.push(`- **전역 귀속 불가 레거시 주문: ${r.bookingLedger.unattributable}건** — 계정에 붙지 않아 검증 자체가 불가능하다. "애매 주문 0건" 과 별개 항목이다.`);
  }
  L.push(`- 출처 불명 쿠폰: ${r.totals.ambiguousCoupons}장`, '');

  L.push('## 쿠폰 처리 계획', '');
  L.push(`- 회수(사용 불가 전환) 대상 **미사용** 오염 쿠폰: ${r.totals.couponsToRevoke}장 — 삭제하지 않고 \`revoked\` 상태로 변경`);
  L.push(`- **이미 사용된** 오염 쿠폰: ${r.totals.couponsGrandfathered}장 — 회수·재청구 없음, \`grandfathered\` 감사 표시만`);
  L.push(`- 이미 제공된 할인 규모(사용된 오염 쿠폰 할인율 합): ${r.totals.grandfatheredDiscountPercentSum}%p`);
  L.push(`- 이미 소진된 오염 코인(재청구하지 않음): ${r.totals.grandfatheredCoinDebt.toLocaleString()}`, '');

  L.push('## 계정별 (익명 순번)', '');
  L.push('| # | 지출 전→후 | 예약 전→후 | 코인 전→후 | 등급 전→후 | 오염 이력 | 보류 | 쿠폰 회수/유지 | 문서 |');
  L.push('|---|---|---|---|---|---:|---:|---|---:|');
  for (const a of r.accounts) {
    L.push(`| user-${a.no} | $${a.before.totalSpentUSD.toLocaleString()} → $${a.after.totalSpentUSD.toLocaleString()} `
      + `| ${a.before.bookingCount} → ${a.after.bookingCount} `
      + `| ${a.before.tripCoins.toLocaleString()} → ${a.after.tripCoins.toLocaleString()} `
      + `| ${a.before.tier} → ${a.after.tier} `
      + `| ${a.ledger.pollutedEntries} | ${a.ledger.ambiguousEntries} `
      + `| ${a.coupons.toRevoke}/${a.coupons.grandfathered} | ${a.docsToWrite} |`);
  }
  L.push('');
  L.push('## 실행 방법 (별도 승인 후)', '');
  L.push('```');
  L.push('LOYALTY_REMEDIATION_APPROVAL=I-APPROVE-LOYALTY-WRITES \\');
  L.push(`node scripts/loyalty-remediation.mjs --execute --confirm=${r.planHash}`);
  L.push('```');
  L.push('- 셋(`--execute` + `--confirm` + env)이 모두 없으면 실행되지 않는다.');
  L.push('- 실행 직전 dry-run 을 다시 돌려 planHash 가 다르면 중단한다.');
  L.push('- 되돌리기: `node scripts/loyalty-remediation-rollback.mjs --confirm=<runId>` (별도 승인 필요)');
  return L.join('\n');
}

/**
 * FAIL-5: 쓰기 모드에서는 Production 대상 확인이 **fail-closed** 여야 한다.
 *
 * dry-run 은 프로젝트가 불명확해도 읽기만 하므로 진행할 수 있다.
 * 그러나 `--execute` 와 rollback `--execute` 는 아래가 **전부 같지 않으면** 즉시 중단한다.
 *   · 명시한 Production 프로젝트 ID (FIREBASE_PRODUCTION_PROJECT_ID)
 *   · Firebase Admin 앱이 실제로 연결한 프로젝트 ID
 *   · 자격증명 안에 들어 있는 프로젝트 ID
 * Preview·Sandbox 표식이 있으면 Production 쓰기를 금지한다.
 *
 * 프로젝트 ID·비밀값은 출력하지 않는다. **일치 여부만** 돌려준다.
 */
export function checkProductionTarget({
  declaredProdId, credentialProjectId, appProjectId, previewMarkers, forWrite,
}) {
  if (!forWrite) return { ok: true, mode: 'read-only' };
  if (!declaredProdId) return { ok: false, reason: 'production_project_id_not_declared' };
  if (!credentialProjectId) return { ok: false, reason: 'credential_project_unknown' };
  if (!appProjectId) return { ok: false, reason: 'app_project_unknown' };
  if (String(declaredProdId) !== String(credentialProjectId)) {
    return { ok: false, reason: 'credential_project_mismatch' };
  }
  if (String(declaredProdId) !== String(appProjectId)) {
    return { ok: false, reason: 'app_project_mismatch' };
  }
  if (/preview|sandbox|development/i.test(String(previewMarkers || ''))) {
    return { ok: false, reason: 'preview_or_sandbox_markers_present' };
  }
  return { ok: true, mode: 'production-write' };
}
