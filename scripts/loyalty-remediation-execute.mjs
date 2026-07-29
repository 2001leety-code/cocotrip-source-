/**
 * 충성도 원장 보정 — **실행부**. (2026-07-29)
 *
 * 🔴 이 모듈은 스스로 실행되지 않는다. scripts/loyalty-remediation.mjs 가
 *   `--execute` + `--confirm=<planHash>` + env 승인 + **Production 대상 확인**을 모두
 *   통과하고, 실행 직전 dry-run 을 다시 돌려 planHash 가 같을 때만 호출한다.
 *
 * 설계 원칙:
 *   · 사용자 1명 = transaction 1개. 지갑·등급·누적지출·예약수·보정원장·쿠폰·복구스냅샷을
 *     같이 커밋한다 → 부분 성공 상태가 남지 않는다.
 *   · 멱등: 보정 원장 문서 ID 를 `correction_<planHash>` 로 고정한다.
 *   · 기존 pointHistory 를 **삭제하지 않는다.** 역분개 항목만 추가한다.
 *   · 미사용 오염 쿠폰은 삭제하지 않고 **결제 경로가 실제로 보는 `isRevoked: true`** 로 막는다.
 *   · 이미 사용된 오염 쿠폰은 회수·재청구하지 않는다.
 *   · 계정 하나가 실패해도 다른 계정 결과를 가리지 않는다.
 */

const SNAPSHOT_COLLECTION = 'admin_loyalty_remediation_snapshots';

/**
 * 🔴 FAIL-1: 쿠폰을 실제로 막는 필드는 `isRevoked` 다.
 *   결제 경로 5곳(api/applyPromoCode.js · api/capturePaypalOrder.js ·
 *   api/_ai_core/paymentGate.js · api/_shared/coupon-charge.js ·
 *   api/_shared/refund-ledger.js)이 전부 `isRevoked === true` 를 본다.
 *   `status:'revoked'` 만 쓰면 "회수했다"고 보고되지만 쿠폰은 계속 쓰인다.
 *   감사 가독성을 위해 status 도 함께 쓰되, **isRevoked 가 진짜 차단 스위치**다.
 */
export const COUPON_REVOKE_FIELDS = ['isRevoked', 'status', 'revokedReason', 'revokedPlan', 'revokedAt'];

/** 보정 원장 문서 ID — 사용자 + 감사 실행 ID 기반, 결정적. */
export function correctionDocId(planHash) {
  return `correction_${planHash}`;
}

/**
 * 🔴 FAIL-3: dry-run 이후 실행 직전 사이에 정상 결제·코인 사용·관리자 수정이 생기면
 *   미리 계산한 after 로 그 정상 변경을 덮어쓴다. 실행 transaction 안에서 현재 값을
 *   dry-run 의 before 와 다시 대조하고, 하나라도 다르면 이 사용자는 건드리지 않는다.
 */
export function detectStaleUser(before, current) {
  const diffs = [];
  // 금액은 부동소수 합이라 원문이 253204.5400000001 처럼 남는다. dry-run 의 before 는
  // 이미 2자리로 반올림한 값이므로, 비교도 **같은 반올림**으로 해야 한다.
  // 그러지 않으면 정상 계정이 전부 stale_plan 으로 막혀 보정이 한 건도 안 된다.
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const cmpNum = (k, a, b) => { if (Number(a || 0) !== Number(b || 0)) diffs.push(k); };
  if (round2(before.totalSpentUSD) !== round2(current.totalSpentUSD)) diffs.push('totalSpentUSD');
  cmpNum('bookingCount', before.bookingCount, current.bookingCount);
  cmpNum('tripCoins', before.tripCoins, current.tripCoins);
  if (String(before.tier || 'Bronze') !== String(current.tier || 'Bronze')) diffs.push('tier');
  return diffs;
}

/** 이번 plan 이 실제로 바꿀 쿠폰만 고른다(이미 회수됐거나 그 사이 사용된 것은 제외). */
export function selectCouponsToRevoke(couponEntries) {
  const willChange = [];
  const skipped = [];
  for (const { ref, snap } of couponEntries) {
    if (!snap.exists) { skipped.push({ id: ref.id, reason: 'missing' }); continue; }
    const c = snap.data() || {};
    if (c.isUsed === true) { skipped.push({ id: ref.id, reason: 'used_meanwhile' }); continue; }
    if (c.isRevoked === true) { skipped.push({ id: ref.id, reason: 'already_revoked' }); continue; }
    willChange.push({ ref, snap, data: c });
  }
  return { willChange, skipped };
}

/**
 * 🔴 FAIL-4: rollback 이 "삭제"가 아니라 **이전 상태 그대로 복원**할 수 있도록,
 *   이번 작업이 건드리는 모든 필드의 **이전 존재 여부와 값**을 저장한다.
 */
export function captureCouponPriorState(id, data) {
  const prior = {};
  for (const f of COUPON_REVOKE_FIELDS) {
    prior[f] = Object.prototype.hasOwnProperty.call(data, f)
      ? { existed: true, value: data[f] === undefined ? null : data[f] }
      : { existed: false, value: null };
  }
  return { id, prior };
}

/**
 * @param {{db: object, accounts: object[], planHash: string}} args
 * @returns {Promise<{planHash: string, applied: object[], skipped: object[], failed: object[]}>}
 */
export async function executeRemediation({ db, accounts, planHash }) {
  const { FieldValue } = await import('firebase-admin/firestore');
  const targets = accounts.filter((a) => a.changed);
  const applied = [];
  const skipped = [];
  const failed = [];

  for (let i = 0; i < targets.length; i += 1) {
    const acct = targets[i];
    const label = `user-${i + 1}`;   // 로그·결과에 uid 를 쓰지 않는다
    try {
      const outcome = await applyOneAccount({ db, FieldValue, acct, planHash });
      if (outcome.skipped) skipped.push({ label, reason: outcome.reason, diffs: outcome.diffs || null });
      else applied.push({ label, docsWritten: outcome.docsWritten, couponsRevoked: outcome.couponsRevoked });
    } catch (e) {
      // 한 계정 실패가 나머지를 숨기지 않는다. 이 계정만 다시 실행하면 된다(멱등).
      failed.push({ label, error: String(e && e.message).slice(0, 200) });
    }
  }
  return { planHash, applied, skipped, failed };
}

async function applyOneAccount({ db, FieldValue, acct, planHash }) {
  const userRef = db.collection('users').doc(acct.uid);
  const correctionRef = userRef.collection('pointHistory').doc(correctionDocId(planHash));
  const snapshotRef = db.collection(SNAPSHOT_COLLECTION).doc(planHash)
    .collection('users').doc(acct.uid);
  const couponRefs = acct._pollutedUnusedCouponIds.map((id) => userRef.collection('coupons').doc(id));

  return db.runTransaction(async (tx) => {
    // ── 읽기 (Firestore 규칙: 쓰기 전에 읽기를 전부) ──
    const correctionSnap = await tx.get(correctionRef);
    if (correctionSnap.exists) {
      // 이미 이 보정이 반영됐다 — 값이 두 번 빠지지 않게 그대로 둔다.
      return { skipped: true, reason: 'already_corrected' };
    }
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return { skipped: true, reason: 'user_missing' };
    const u = userSnap.data() || {};

    const couponEntries = [];
    for (const ref of couponRefs) couponEntries.push({ ref, snap: await tx.get(ref) });

    // ── FAIL-3: dry-run 이후 값이 바뀌었으면 덮어쓰지 않는다 ──
    const diffs = detectStaleUser(acct.before, {
      totalSpentUSD: u.totalSpentUSD, bookingCount: u.bookingCount,
      tripCoins: u.tripCoins, tier: u.tier,
    });
    if (diffs.length > 0) {
      return { skipped: true, reason: 'stale_plan', diffs };
    }

    // ── FAIL-4: 실제로 바꿀 쿠폰만 고르고, 그 쿠폰의 이전 상태를 그대로 보존 ──
    const { willChange, skipped: couponSkipped } = selectCouponsToRevoke(couponEntries);

    // ── 쓰기 ──
    let docsWritten = 0;

    // 1) 복구용 스냅샷 (제한 컬렉션 — 규칙에서 관리자만 읽게 둔다)
    tx.set(snapshotRef, {
      planHash,
      capturedAt: FieldValue.serverTimestamp(),
      before: {
        totalSpentUSD: Number(u.totalSpentUSD) || 0,
        bookingCount: Number(u.bookingCount) || 0,
        tripCoins: Number(u.tripCoins) || 0,
        tier: String(u.tier || 'Bronze'),
      },
      // 이번 plan 이 **실제로 바꾼** 쿠폰만. 건드리지 않은 쿠폰은 rollback 도 건드리지 않는다.
      couponsChanged: willChange.map((c) => captureCouponPriorState(c.ref.id, c.data)),
      couponsSkipped: couponSkipped,
    }, { merge: false });
    docsWritten += 1;

    // 2) 지갑·등급·누적지출·예약수
    tx.set(userRef, {
      totalSpentUSD: acct.after.totalSpentUSD,
      bookingCount: acct.after.bookingCount,
      tripCoins: acct.after.tripCoins,
      tier: acct.after.tier,
      loyaltyCorrectedAt: FieldValue.serverTimestamp(),
      loyaltyCorrectionPlan: planHash,
    }, { merge: true });
    docsWritten += 1;

    // 3) 역분개 원장 — 기존 기록은 지우지 않고 차이만 남긴다
    tx.set(correctionRef, {
      type: 'correction',
      amount: acct.delta.tripCoins,
      balance: acct.after.tripCoins,
      description: `Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan ${planHash})`,
      correction: {
        planHash,
        mode: acct.mode,
        spentUSDBefore: acct.before.totalSpentUSD,
        spentUSDAfter: acct.after.totalSpentUSD,
        bookingCountBefore: acct.before.bookingCount,
        bookingCountAfter: acct.after.bookingCount,
        tierBefore: acct.before.tier,
        tierAfter: acct.after.tier,
        pollutedEntries: acct.ledger.pollutedEntries,
        ambiguousEntriesHeld: acct.ledger.ambiguousEntries,
        grandfatheredCoinDebt: acct.grandfatheredCoinDebt,
      },
      createdAt: Date.now(),
    }, { merge: false });
    docsWritten += 1;

    // 4) 미사용 오염 쿠폰 — 삭제하지 않고 **결제 경로가 보는 isRevoked** 로 막는다
    for (const c of willChange) {
      tx.set(c.ref, {
        isRevoked: true,                 // 🔴 실제 차단 스위치 (결제 5경로 공통)
        status: 'revoked',               // 감사 가독성용
        revokedReason: 'issued_from_unverified_ai_plan_coins',
        revokedPlan: planHash,
        revokedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      docsWritten += 1;
    }
    return { skipped: false, docsWritten, couponsRevoked: willChange.length };
  });
}

export { SNAPSHOT_COLLECTION };
