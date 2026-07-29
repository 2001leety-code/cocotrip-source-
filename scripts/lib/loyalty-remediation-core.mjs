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


/** 이 보정이 만드는 correction 원장의 스키마 식별자 (신규 문서에만 들어간다). */
export const POLLUTION_CORRECTION_SCHEMA = 'ai-plan-pollution-correction/v1';

/** 운영에 이미 생성된 4건(2026-07-29)은 schema 필드가 없다. 설명 접두사로 식별한다. */
export const LEGACY_CORRECTION_DESC_PREFIX =
  'Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture';

/** 허용 보정 방식 — 이 둘이 아니면 우리 도구가 만든 것이 아니다. */
const ALLOWED_CORRECTION_MODES = new Set(['recompute_from_ledger', 'subtract_pollution_only']);

/**
 * 🔴 FAIL-8: `type === 'correction'` 이라는 이유만으로 "이미 제거된 오염분" 으로 세면 안 된다.
 *
 * pointHistory 의 correction 은 다른 목적(운영자 수동 조정, 다른 보정 도구, 향후 기능)으로도
 * 생길 수 있다. 그걸 오염 제거분으로 합산하면 **아직 안 뺀 오염분이 숨겨져** 보정이 덜 된다.
 *
 * 그래서 이 보정이 만든 것만 인정한다. 아래를 **전부** 통과해야 한다.
 *   · 문서 ID 가 `correction_<planHash>` 와 정확히 일치
 *   · correction.planHash 존재 + 문서 ID 의 해시와 일치
 *   · mode 가 허용 목록에 있음
 *   · schema 식별자(신규) 또는 정확한 설명 접두사 + `(plan <hash>)`(레거시 4건)
 *   · 금액·예약·코인 차감값이 숫자이고 방향이 맞음(줄어드는 쪽)
 *   · rolledBack !== true
 *
 * 하나라도 어긋나면 인정하지 않고 `ambiguous correction` 으로 세어 보고한다(자동 반영 금지).
 *
 * @returns {{accepted: true, planHash: string, removedUSD: number, removedBookings: number,
 *            removedCoins: number, removedEntries: number, legacy: boolean}
 *          | {accepted: false, reason: string}}
 */
export function identifyPollutionCorrection(docId, data) {
  const d = data || {};
  if (d.type !== 'correction') return { accepted: false, reason: 'not_correction' };
  if (d.rolledBack === true) return { accepted: false, reason: 'rolled_back' };

  const meta = d.correction;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { accepted: false, reason: 'no_correction_metadata' };
  }
  const planHash = String(meta.planHash || '');
  if (!planHash) return { accepted: false, reason: 'no_plan_hash' };
  if (String(docId) !== `correction_${planHash}`) {
    return { accepted: false, reason: 'doc_id_plan_hash_mismatch' };
  }
  if (!ALLOWED_CORRECTION_MODES.has(String(meta.mode || ''))) {
    return { accepted: false, reason: 'mode_not_allowed' };
  }

  const desc = String(d.description || '');
  const schemaOk = meta.schema === POLLUTION_CORRECTION_SCHEMA;
  const legacyOk = desc.startsWith(LEGACY_CORRECTION_DESC_PREFIX)
    && desc.includes(`(plan ${planHash})`);
  if (!schemaOk && !legacyOk) return { accepted: false, reason: 'schema_or_description_unrecognized' };

  const nums = [meta.spentUSDBefore, meta.spentUSDAfter, meta.bookingCountBefore,
    meta.bookingCountAfter, meta.pollutedEntries, d.amount];
  if (nums.some((v) => !Number.isFinite(Number(v)))) {
    return { accepted: false, reason: 'incomplete_numeric_metadata' };
  }
  const removedUSD = round2(Number(meta.spentUSDBefore) - Number(meta.spentUSDAfter));
  const removedBookings = Number(meta.bookingCountBefore) - Number(meta.bookingCountAfter);
  const removedCoins = -Number(d.amount);
  const removedEntries = Number(meta.pollutedEntries);
  if (removedUSD < 0 || removedBookings < 0 || removedCoins < 0 || removedEntries < 0) {
    return { accepted: false, reason: 'negative_removal' };
  }
  return {
    accepted: true, planHash, removedUSD, removedBookings, removedCoins, removedEntries,
    legacy: !schemaOk,
  };
}

// ── rollback 사전 검증 (FAIL-14 · FAIL-15) ────────────────────────────────
/**
 * 보정이 쿠폰에 남기는 필드. rollback 은 이 필드들만 **이전 상태 그대로** 되돌린다.
 * (실행부·rollback 이 같은 정의를 봐야 "썼는데 못 되돌리는" 필드가 안 생긴다.)
 */
export const COUPON_REVOKE_FIELDS = ['isRevoked', 'status', 'revokedReason', 'revokedPlan', 'revokedAt'];

/** 이 보정이 쓴 회수 사유. 다른 이유로 회수된 쿠폰을 되돌리면 안 된다. */
export const POLLUTION_REVOKE_REASON = 'issued_from_unverified_ai_plan_coins';

/** 보정 원장 문서 ID — 사용자별로 결정적(같은 plan 은 한 번만). */
export function correctionDocId(planHash) {
  return `correction_${planHash}`;
}

/**
 * 🔴 FAIL-15: rollback 이 되돌려도 되는 쿠폰인지 **전체 상태**를 확인한다.
 *
 * 이전에는 revokedPlan·isRevoked·isUsed 만 봤다. 그 사이 다른 작업이
 * status 나 revokedReason 을 바꿨어도 통과해, rollback 이 남의 상태를 지웠다.
 *
 * @returns {string|null} 어긋난 이유. null 이면 되돌려도 안전하다.
 */
export function validateCouponForRollback(planHash, exists, data) {
  if (!exists) return 'missing';
  const c = data || {};
  if (c.isRevoked !== true) return 'already_unrevoked';
  if (String(c.status || '') !== 'revoked') return 'status_changed';
  if (String(c.revokedReason || '') !== POLLUTION_REVOKE_REASON) return 'reason_changed';
  if (String(c.revokedPlan || '') !== String(planHash)) return 'revoked_plan_changed';
  if (c.revokedAt === undefined || c.revokedAt === null) return 'revoked_at_missing';
  if (c.isUsed === true) return 'used_after_revoke';
  return null;
}

/**
 * 🔴 FAIL-14 + FAIL-15: dry-run 과 execute 가 **같은 판정 함수**를 쓴다.
 *
 * 예전 dry-run 은 스냅샷 목록만 출력했다. 실제로 되돌릴 수 있는지 아무것도 확인하지
 * 않고 "복구 예정" 이라고 찍었으니 허수 검사였다. 이제 같은 입력·같은 규칙으로
 * 판정하므로 dry-run 이 `ready` 라고 한 계정만 execute 에서도 통과한다.
 *
 * @param {{planHash: string, correctionExists: boolean, correctionData: object,
 *          userExists: boolean, userData: object,
 *          coupons: Array<{id: string, exists: boolean, data: object}>}} input
 * @returns {{ready: true} | {ready: false, reason: string, detail: string[]|null}}
 */
export function evaluateRollbackTarget({
  planHash, correctionExists, correctionData, userExists, userData, coupons,
}) {
  if (!correctionExists) return { ready: false, reason: 'correction_missing', detail: null };
  const cd = correctionData || {};
  if (cd.rolledBack === true) return { ready: false, reason: 'already_rolled_back', detail: null };
  if (!userExists) return { ready: false, reason: 'user_missing', detail: null };
  const u = userData || {};
  if (String(u.loyaltyCorrectionPlan || '') !== String(planHash)) {
    return { ready: false, reason: 'plan_mismatch', detail: null };
  }

  // 🔴 이 보정이 만든 correction 인지 같은 엄격 판별기로 확인한다(FAIL-8 과 동일 기준).
  const verdict = identifyPollutionCorrection(correctionDocId(planHash), cd);
  if (!verdict.accepted) {
    return { ready: false, reason: 'correction_invalid', detail: [verdict.reason] };
  }
  // 되돌릴 목표값(코인·등급)이 원장에 없으면 되돌릴 수 없다 — 추측으로 채우지 않는다.
  const missing = [];
  if (!Number.isFinite(Number(cd.balance))) missing.push('balance');
  if (!String((cd.correction || {}).tierAfter || '')) missing.push('tierAfter');
  if (missing.length > 0) {
    return { ready: false, reason: 'correction_invalid', detail: missing.map((m) => `missing_${m}`) };
  }

  const diffs = detectStaleRollback(cd, u);
  if (diffs.length > 0) return { ready: false, reason: 'stale_rollback', detail: diffs };

  const drifted = [];
  for (const c of coupons || []) {
    const why = validateCouponForRollback(planHash, c.exists, c.data);
    if (why) drifted.push(why);
  }
  if (drifted.length > 0) {
    return { ready: false, reason: 'coupon_drift', detail: [...new Set(drifted)].sort() };
  }
  return { ready: true };
}

/**
 * 🔴 FAIL-9: rollback 이 정상 후속 변경을 덮어쓰지 않게 한다.
 *
 * 현재 사용자 값이 **그 correction 의 보정 후 값과 정확히 같을 때만** 되돌린다.
 * 보정 뒤에 정상 결제·코인 사용·등급 변경이 있었다면 그것까지 지워버리기 때문이다.
 *
 * 기대값은 snapshot 이 아니라 **correction 원장** 에서 읽는다.
 * 운영에 이미 생성된 스냅샷에는 after 가 없기 때문이다.
 *
 * @returns {string[]} 어긋난 필드 목록. 빈 배열이면 되돌려도 안전하다.
 */
export function detectStaleRollback(correctionData, currentUser) {
  const meta = (correctionData || {}).correction || {};
  const diffs = [];
  if (round2(meta.spentUSDAfter) !== round2(currentUser.totalSpentUSD)) diffs.push('totalSpentUSD');
  if (num(meta.bookingCountAfter) !== num(currentUser.bookingCount)) diffs.push('bookingCount');
  if (num((correctionData || {}).balance) !== num(currentUser.tripCoins)) diffs.push('tripCoins');
  if (String(meta.tierAfter || '') !== String(currentUser.tier || '')) diffs.push('tier');
  return diffs;
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
  let acceptedCorrections = 0;
  let ambiguousCorrections = 0;
  const ambiguousCorrectionReasons = [];
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
      //   오염 이력(pointHistory)은 감사 목적상 삭제하지 않으므로 다음 실행에서 다시 계산된다.
      //   그걸 그대로 또 빼면 같은 금액을 두 번 차감해 정상 잔액까지 0 으로 만든다.
      //   단, **이 보정이 만든 correction 만** 인정한다(FAIL-8). 다른 correction 을 인정하면
      //   아직 안 뺀 오염분이 숨겨져 보정이 덜 된다.
      const verdict = identifyPollutionCorrection(h.id, h.data());
      if (verdict.accepted) {
        acceptedCorrections += 1;
        alreadyRemovedUSD += verdict.removedUSD;
        alreadyRemovedBookings += verdict.removedBookings;
        alreadyRemovedCoins += verdict.removedCoins;
        alreadyRemovedEntries += verdict.removedEntries;
      } else {
        ambiguousCorrections += 1;
        ambiguousCorrectionReasons.push(verdict.reason);
      }
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

  const wouldChange = currentSpentUSD !== afterSpent
    || currentBookingCount !== afterBookings
    || currentCoins !== afterCoins
    || currentTier !== expectedTier
    || pollutedCouponsUnused.length > 0;

  // 🔴 FAIL-16: 인정되지 않은 correction 이 하나라도 있으면 **자동 보정하지 않는다.**
  //   그 correction 이 무엇을 이미 뺐는지 모르기 때문에, 현재값에서 오염분을 다시 빼면
  //   같은 금액을 두 번 차감할 수 있다. 계산 결과는 "예상 영향"으로만 보고하고
  //   실행 대상(changed)과 planHash 에서 제외해 운영자 판단으로 넘긴다.
  const manualReview = ambiguousCorrections > 0;
  const changed = wouldChange && !manualReview;

  return {
    uid: userDoc.id,                                  // ⚠️ 보고서에는 절대 넣지 않는다
    changed,
    manualReview,
    manualReviewReason: manualReview ? 'unrecognized_correction_present' : null,
    // 보정을 막지 않았다면 바뀌었을 것인가 — 보고서의 "예상 영향" 표시용.
    wouldChange,
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
      acceptedCorrections,
      ambiguousCorrections,
      ambiguousCorrectionReasons: [...new Set(ambiguousCorrectionReasons)].sort(),
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

/**
 * 🔴 FAIL-17: 같은 계정은 사전·실행·사후 문서에서 **같은 user-N** 이어야 한다.
 *
 * 예전에는 "보정 대상(changed)만" 순번을 매겼다. 그래서 보정이 끝나 대상이 줄면
 * 남은 계정 번호가 통째로 밀려, 같은 사람이 문서마다 다른 번호로 나왔다.
 *
 * 정렬 기준은 보정으로 **바뀌지 않는 값**이어야 한다. 오염 이력은 감사 목적상
 * 삭제하지 않으므로 오염 코인·금액·건수가 그 조건을 만족한다.
 * (uid 는 마지막 동점 처리에만 쓰고 출력하지 않는다.)
 */
export function assignAccountLabels(accounts) {
  const ofInterest = accounts.filter(
    (a) => a.ledger.pollutedEntries > 0 || a.changed || a.manualReview,
  );
  ofInterest.sort((a, b) => (
    b.ledger.pollutedCoins - a.ledger.pollutedCoins
    || b.ledger.pollutedUSD - a.ledger.pollutedUSD
    || b.ledger.pollutedEntries - a.ledger.pollutedEntries
    || String(a.uid).localeCompare(String(b.uid))
  ));
  ofInterest.forEach((a, i) => { a.no = i + 1; });
  for (const a of accounts) if (!a.no) a.no = null;
  return ofInterest;
}

/** 보고서·확인 토큰의 기준이 되는 계획 해시 — 대상과 합계가 바뀌면 값이 달라진다. */
export function planHashOf(accounts) {
  const normalized = accounts
    // 🔴 FAIL-16: manual_review 계정은 changed=false 라 여기서도 자동 제외된다.
    .filter((a) => a.changed)
    .map((a) => [a.uid, a.after.totalSpentUSD, a.after.bookingCount, a.after.tripCoins, a.after.tier,
      a._pollutedUnusedCouponIds.slice().sort().join(',')].join('|'))
    .sort();
  return createHash('sha256').update(normalized.join('\n')).digest('hex').slice(0, 16);
}

/** 보고서용 계정 요약 — uid 없이 순번만. */
function accountView(a) {
  return {
    no: a.no,
    mode: a.mode,
    manualReview: a.manualReview === true,
    manualReviewReason: a.manualReviewReason || null,
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
  };
}

/**
 * 🔴 FAIL-17: 합계를 **두 범위로 나눈다.**
 *
 * 예전에는 모든 합계가 `changed` 계정만 더했다. 보정이 끝나 대상이 0 이 되면
 * "오염 이력 0건 / 인정 correction 0건 / 지출 $0" 처럼 찍혔다.
 * 실제로는 과거 오염 이력 209건이 그대로 남아 있고(감사 목적상 삭제하지 않는다),
 * 인정된 correction 도 4건 있다. 대상이 없다는 것과 오염이 없었다는 것은 다르다.
 *
 *   · `allScanned`     — 스캔한 전 계정의 현재 사실. 대상 0 이어도 값이 나온다.
 *   · `plannedTargets` — 이번 실행이 실제로 바꿀 것.
 */
export function buildReport({ accounts, scanned, stats, projectId, planHash }) {
  const labeled = assignAccountLabels(accounts);
  const targets = accounts.filter((a) => a.changed);
  const manualReview = accounts.filter((a) => a.manualReview);
  const sumAll = (fn) => accounts.reduce((s, a) => s + fn(a), 0);
  const sum = (fn) => targets.reduce((s, a) => s + fn(a), 0);

  const allScanned = {
    scannedUsers: scanned,
    accountsWithPollutionHistory: accounts.filter((a) => a.ledger.pollutedEntries > 0).length,
    // 현재(보정 반영 후) 전체 합계 — 대상 0 건이어도 반드시 값이 나온다.
    current: {
      totalSpentUSD: round2(sumAll((a) => a.before.totalSpentUSD)),
      bookingCount: sumAll((a) => a.before.bookingCount),
      tripCoins: sumAll((a) => a.before.tripCoins),
    },
    // 역사적 오염 — pointHistory 를 삭제하지 않으므로 보정 뒤에도 그대로 남는다.
    historicalPollution: {
      entries: sumAll((a) => a.ledger.pollutedEntries),
      coins: sumAll((a) => a.ledger.pollutedCoins),
      usd: round2(sumAll((a) => a.ledger.pollutedUSD)),
    },
    // 지난 보정이 이미 제거한 몫.
    acceptedCorrections: sumAll((a) => a.ledger.acceptedCorrections),
    alreadyRemoved: {
      usd: round2(sumAll((a) => a.ledger.alreadyRemovedUSD)),
      coins: sumAll((a) => a.ledger.alreadyRemovedCoins),
      entries: sumAll((a) => a.ledger.alreadyRemovedEntries),
    },
    // 아직 안 뺀 오염 — 이 값이 0 이어야 수렴한 것이다.
    remainingPollution: {
      entries: sumAll((a) => a.ledger.remainingPollutedEntries),
      coins: sumAll((a) => a.ledger.remainingPollutedCoins),
      usd: round2(sumAll((a) => a.ledger.remainingPollutedUSD)),
    },
    ambiguous: {
      entries: sumAll((a) => a.ledger.ambiguousEntries),
      // 🔴 FAIL-7: "계정 안에서 애매한 주문" 과 "아예 계정에 붙지 않는 레거시 주문" 은 다르다.
      //   전자만 0 이라고 보고하면 후자 29건이 정상 검증된 것처럼 보인다.
      ordersInAccounts: sumAll((a) => a.orders.ambiguousOrders),
      coupons: sumAll((a) => a.coupons.ambiguous),
      corrections: sumAll((a) => a.ledger.ambiguousCorrections),
    },
    coupons: {
      heldTotal: sumAll((a) => a.coupons.couponsTotal),
      usedTotal: sumAll((a) => a.coupons.couponsUsedTotal),
    },
    preserved: {
      legitCoins: sumAll((a) => a.ledger.legitEarnCoins),
      verifiedOrders: sumAll((a) => a.orders.verifiedPaidOrders),
    },
    // 🔴 현재 잔액 중 **검증된 결제로 뒷받침되지 않는** 몫. 이 값이 크면 결제 원장이
    //   계정에 붙지 않는다는 뜻이다(레거시 bookings 에 uid 필드가 없던 시기).
    backedUSD: round2(sumAll((a) => a.ledgerBasedIfComplete.totalSpentUSD)),
    unbackedUSD: round2(sumAll(
      (a) => Math.max(0, a.before.totalSpentUSD - a.ledgerBasedIfComplete.totalSpentUSD),
    )),
    manualReviewAccounts: manualReview.length,
  };

  const plannedTargets = {
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
    delta: {
      totalSpentUSD: round2(sum((a) => a.delta.totalSpentUSD)),
      bookingCount: sum((a) => a.delta.bookingCount),
      tripCoins: sum((a) => a.delta.tripCoins),
    },
    couponsToRevoke: sum((a) => a.coupons.pollutedUnused),
    couponsGrandfathered: sum((a) => a.coupons.pollutedUsed),
    grandfatheredDiscountPercentSum: sum((a) => a.coupons.grandfatheredDiscountPercentSum),
    grandfatheredCoinDebt: sum((a) => a.grandfatheredCoinDebt),
    afterBackedUSD: round2(sum((a) => a.ledgerBasedIfComplete.totalSpentUSD)),
    afterUnbackedUSD: round2(sum(
      (a) => Math.max(0, a.after.totalSpentUSD - a.ledgerBasedIfComplete.totalSpentUSD),
    )),
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
    totals: { allScanned, plannedTargets },
    // 순번은 보정으로 바뀌지 않는 기준으로 매겨 사전·실행·사후 문서에서 같은 사람이 같은 번호다.
    accounts: labeled.map(accountView),
    // 🔴 FAIL-16: 자동 보정에서 제외한 계정 — 예상 영향만 표시하고 운영자가 판단한다.
    manualReviewAccounts: manualReview.map((a) => ({
      ...accountView(a),
      wouldChange: a.wouldChange === true,
      expectedImpactIfApproved: a.wouldChange ? a.delta : null,
      unrecognizedCorrections: a.ledger.ambiguousCorrections,
      unrecognizedReasons: a.ledger.ambiguousCorrectionReasons,
    })),
  };
}

export function toMarkdown(r) {
  const A = r.totals.allScanned;
  const P = r.totals.plannedTargets;
  const L = [];
  L.push('# 충성도 원장 오염 보정 — dry-run 보고서', '');
  L.push('> 읽기 전용 실행 결과. 운영 데이터는 **수정하지 않았다.**');
  L.push('> 개인정보(uid·이메일·예약번호·PayPal ID)는 담지 않는다. 계정은 순번으로만 표시.', '');
  L.push(`- 계획 해시(planHash): \`${r.planHash}\``);
  L.push(`- Firestore 읽기: ${r.firestore.reads}회 / **쓰기 시도: ${r.firestore.writeAttempts}회 / 실제 쓰기: ${r.firestore.writesAllowed}회**`);
  L.push(`- 쓰기 차단 방식: ${r.firestore.guard}`, '');

  // 🔴 FAIL-17: "지금 전체가 어떤가" 와 "이번에 무엇을 바꾸는가" 를 절대 섞지 않는다.
  L.push('## 1. 전체 스캔 결과 (현재 사실)', '');
  L.push(`스캔 계정 ${A.scannedUsers} · 오염 이력이 있는 계정 ${A.accountsWithPollutionHistory}`, '');
  L.push('| 항목 | 현재 값 |');
  L.push('|---|---:|');
  L.push(`| 누적 지출(USD) | $${A.current.totalSpentUSD.toLocaleString()} |`);
  L.push(`| 예약 수 | ${A.current.bookingCount} |`);
  L.push(`| 코인 | ${A.current.tripCoins.toLocaleString()} |`);
  L.push('');
  L.push('| 오염 구분 | 건수 | 코인 | 지출 |');
  L.push('|---|---:|---:|---:|');
  L.push(`| 역사적 오염 이력(삭제하지 않음) | ${A.historicalPollution.entries} | ${A.historicalPollution.coins.toLocaleString()} | $${A.historicalPollution.usd.toLocaleString()} |`);
  L.push(`| 지난 보정이 이미 제거 | ${A.alreadyRemoved.entries} | ${A.alreadyRemoved.coins.toLocaleString()} | $${A.alreadyRemoved.usd.toLocaleString()} |`);
  L.push(`| **남은 미보정 오염** | **${A.remainingPollution.entries}** | **${A.remainingPollution.coins.toLocaleString()}** | **$${A.remainingPollution.usd.toLocaleString()}** |`);
  L.push('');
  L.push(`- 인정된 correction: ${A.acceptedCorrections}건 / 인정되지 않은 correction: ${A.ambiguous.corrections}건`);
  L.push(`- 현재 잔액 중 검증 결제로 뒷받침: $${A.backedUSD.toLocaleString()} / 근거 없음: $${A.unbackedUSD.toLocaleString()}`);
  L.push(`- 자동 보정에서 제외한(manual_review) 계정: ${A.manualReviewAccounts}`, '');

  L.push('## 2. 이번 실행 대상 (plannedTargets)', '');
  L.push('| 항목 | 수정 전 | 수정 후 | 차이 |');
  L.push('|---|---:|---:|---:|');
  L.push(`| 누적 지출(USD) | $${P.before.totalSpentUSD.toLocaleString()} | $${P.after.totalSpentUSD.toLocaleString()} | ${P.delta.totalSpentUSD.toLocaleString()} |`);
  L.push(`| 예약 수 | ${P.before.bookingCount} | ${P.after.bookingCount} | ${P.delta.bookingCount} |`);
  L.push(`| 코인 | ${P.before.tripCoins.toLocaleString()} | ${P.after.tripCoins.toLocaleString()} | ${P.delta.tripCoins.toLocaleString()} |`);
  L.push('');
  L.push(`- 보정 대상 계정: **${P.accountsToFix}**`);
  const br = r.accounts.reduce((t, a) => ({
    snapshot: t.snapshot + a.docsBreakdown.snapshot,
    user: t.user + a.docsBreakdown.user,
    correction: t.correction + a.docsBreakdown.correction,
    coupons: t.coupons + a.docsBreakdown.coupons,
  }), { snapshot: 0, user: 0, correction: 0, coupons: 0 });
  L.push(`- 실행 시 바뀔 문서 수: **${P.docsToWrite}**`);
  L.push(`  (복구 스냅샷 ${br.snapshot} + 사용자 ${br.user} + correction 원장 ${br.correction} + 회수 쿠폰 ${br.coupons})`, '');
  if (P.accountsToFix === 0) {
    L.push('> 대상 0 건은 **오염이 없었다는 뜻이 아니다.** 위 1절의 역사적 오염 이력과');
    L.push('> 남은 미보정 오염을 함께 읽어야 한다.', '');
  }

  L.push('## 🔴 보정 방식 (계정별)', '');
  L.push('| 방식 | 계정 수 | 뜻 |');
  L.push('|---|---:|---|');
  L.push(`| \`subtract_pollution_only\` | ${P.modes.subtract_pollution_only || 0} | 명백한 오염분만 차감. 나머지는 손대지 않음 |`);
  L.push(`| \`recompute_from_ledger\` | ${P.modes.recompute_from_ledger || 0} | 결제 원장으로 전부 재계산(원장이 완전할 때만) |`);
  L.push('');
  if (r.bookingLedger) {
    L.push('### 결제 원장 귀속 현황', '');
    L.push(`- bookings 총 ${r.bookingLedger.total}건 중 **uid 필드가 있는 것 ${r.bookingLedger.withUid}건**, \`paymentVerified===true\` ${r.bookingLedger.paymentVerified}건`);
    L.push(`- 계정에 귀속 불가: **${r.bookingLedger.unattributable}건**`);
    L.push(`- ${r.bookingLedger.note}`);
    L.push('- 그래서 이번 보정은 **전체 재계산을 쓰지 않는다.** 근거가 확실한 오염분만 뺀다.', '');
  }
  L.push(`- 실행 대상의 보정 후 잔액 중 **검증된 결제로 뒷받침되는 금액: $${P.afterBackedUSD.toLocaleString()}**`);
  L.push(`- 실행 대상의 보정 후 잔액 중 **근거를 붙이지 못한 금액: $${P.afterUnbackedUSD.toLocaleString()}** (건드리지 않음)`, '');

  L.push('## 정상으로 보존할 데이터 (전체 스캔 기준)', '');
  L.push(`- 검증된 유료 주문: ${A.preserved.verifiedOrders}건`);
  L.push(`- 정상 적립 코인: ${A.preserved.legitCoins.toLocaleString()}`);
  L.push('- 기존 pointHistory 는 **삭제하지 않는다.** 역분개(correction) 항목만 추가한다.', '');

  L.push('## 애매하여 보류한 데이터 (자동 수정 안 함 · 전체 스캔 기준)', '');
  L.push(`- 결제 근거가 불완전한 적립 이력: ${A.ambiguous.entries}건`);
  L.push(`- **계정 내부** 애매 주문(통화·금액 불완전): ${A.ambiguous.ordersInAccounts}건`);
  if (r.bookingLedger) {
    L.push(`- **전역 귀속 불가 레거시 주문: ${r.bookingLedger.unattributable}건** — 계정에 붙지 않아 검증 자체가 불가능하다. "애매 주문 0건" 과 별개 항목이다.`);
  }
  L.push(`- 출처 불명 쿠폰: ${A.ambiguous.coupons}장`);
  L.push(`- 인정되지 않은 correction: ${A.ambiguous.corrections}건 (이 보정이 만든 것이 아니므로 '이미 제거된 오염분' 으로 세지 않는다)`, '');

  L.push('## 쿠폰 처리 계획 (실행 대상)', '');
  L.push(`- 보유 전체 ${A.coupons.heldTotal}장 / 이미 사용 ${A.coupons.usedTotal}장 (전체 스캔 기준)`);
  L.push(`- 회수(사용 불가 전환) 대상 **미사용** 오염 쿠폰: ${P.couponsToRevoke}장 — 삭제하지 않고 \`isRevoked\` 로 차단`);
  L.push(`- **이미 사용된** 오염 쿠폰: ${P.couponsGrandfathered}장 — 회수·재청구 없음, \`grandfathered\` 감사 표시만`);
  L.push(`- 이미 제공된 할인 규모(사용된 오염 쿠폰 할인율 합): ${P.grandfatheredDiscountPercentSum}%p`);
  L.push(`- 이미 소진된 오염 코인(재청구하지 않음): ${P.grandfatheredCoinDebt.toLocaleString()}`, '');

  L.push('## 계정별 (익명 순번 — 사전·실행·사후 문서에서 같은 번호)', '');
  L.push('| # | 상태 | 지출 전→후 | 예약 전→후 | 코인 전→후 | 등급 전→후 | 오염 이력 | 남은 오염 | 인정/보류 correction | 쿠폰 회수/유지 | 문서 |');
  L.push('|---|---|---|---|---|---|---:|---:|---|---|---:|');
  for (const a of r.accounts) {
    let state = '변경 없음';
    if (a.manualReview) state = '🟡 manual_review';
    else if (a.docsToWrite > 0) state = '보정 대상';
    L.push(`| user-${a.no} | ${state} `
      + `| $${a.before.totalSpentUSD.toLocaleString()} → $${a.after.totalSpentUSD.toLocaleString()} `
      + `| ${a.before.bookingCount} → ${a.after.bookingCount} `
      + `| ${a.before.tripCoins.toLocaleString()} → ${a.after.tripCoins.toLocaleString()} `
      + `| ${a.before.tier} → ${a.after.tier} `
      + `| ${a.ledger.pollutedEntries} | $${a.ledger.remainingPollutedUSD.toLocaleString()} `
      + `| ${a.ledger.acceptedCorrections}/${a.ledger.ambiguousCorrections} `
      + `| ${a.coupons.toRevoke}/${a.coupons.grandfathered} | ${a.docsToWrite} |`);
  }
  L.push('');
  if (r.manualReviewAccounts && r.manualReviewAccounts.length > 0) {
    L.push('## 🟡 자동 보정에서 제외한 계정 (운영자 판단 필요)', '');
    L.push('인정되지 않은 correction 이 있어 **자동으로 쓰지 않는다.** 아래는 예상 영향일 뿐이다.', '');
    L.push('| # | 인정 안 된 correction | 사유 | 예상 지출 변화 | 예상 코인 변화 |');
    L.push('|---|---:|---|---:|---:|');
    for (const a of r.manualReviewAccounts) {
      const d = a.expectedImpactIfApproved;
      L.push(`| user-${a.no} | ${a.unrecognizedCorrections} | ${a.unrecognizedReasons.join(', ') || '-'} `
        + `| ${d ? `$${d.totalSpentUSD.toLocaleString()}` : '없음'} `
        + `| ${d ? d.tripCoins.toLocaleString() : '없음'} |`);
    }
    L.push('');
  }
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
