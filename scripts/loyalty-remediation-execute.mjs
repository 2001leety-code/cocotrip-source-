/**
 * 충성도 원장 보정 — **실행부**. (2026-07-29)
 *
 * 🔴 이 모듈은 스스로 실행되지 않는다. scripts/loyalty-remediation.mjs 가
 *   `--execute` + `--confirm=<planHash>` + env 승인 셋을 모두 확인하고,
 *   실행 직전 dry-run 을 다시 돌려 planHash 가 같을 때만 호출한다.
 *
 * 설계 원칙:
 *   · 사용자 1명 = transaction 1개. 지갑·등급·누적지출·예약수·보정원장·쿠폰을 같이 커밋한다.
 *     → 부분 성공 상태가 남지 않는다.
 *   · 멱등: 보정 원장 문서 ID 를 `correction_<planHash>` 로 고정한다. 같은 보정을 여러 번
 *     실행해도 두 번째부터는 이미 존재하는 것을 보고 아무것도 하지 않는다.
 *   · 기존 pointHistory 를 **삭제하지 않는다.** 역분개 항목만 추가해 감사 흔적을 남긴다.
 *   · 미사용 오염 쿠폰은 삭제하지 않고 `revoked` 상태로만 바꾼다.
 *   · 이미 사용된 오염 쿠폰은 회수·재청구하지 않는다. `grandfathered` 표시만 남긴다.
 *   · 실행 전 복구용 스냅샷을 제한 컬렉션에 저장한다(같은 transaction 안).
 *   · 계정 하나가 실패해도 다른 계정 결과를 가리지 않는다 — 계정별로 성패를 나눠 돌려준다.
 */

const SNAPSHOT_COLLECTION = 'admin_loyalty_remediation_snapshots';

/** 보정 원장 문서 ID — 사용자 + 감사 실행 ID 기반, 결정적. */
export function correctionDocId(planHash) {
  return `correction_${planHash}`;
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
      if (outcome.skipped) skipped.push({ label, reason: outcome.reason });
      else applied.push({ label, docsWritten: outcome.docsWritten });
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

    const couponSnaps = [];
    for (const ref of couponRefs) couponSnaps.push({ ref, snap: await tx.get(ref) });

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
      couponsRevoked: couponSnaps
        .filter((c) => c.snap.exists)
        .map((c) => ({ id: c.ref.id, isUsedBefore: (c.snap.data() || {}).isUsed === true })),
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

    // 4) 미사용 오염 쿠폰 — 삭제하지 않고 사용 불가로 전환
    for (const { ref, snap } of couponSnaps) {
      if (!snap.exists) continue;
      const cd = snap.data() || {};
      if (cd.isUsed === true) continue;              // 그 사이 사용됐다면 건드리지 않는다
      if (cd.status === 'revoked') continue;         // 멱등
      tx.set(ref, {
        status: 'revoked',
        revokedReason: 'issued_from_unverified_ai_plan_coins',
        revokedPlan: planHash,
        revokedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      docsWritten += 1;
    }
    return { skipped: false, docsWritten };
  });
}

export { SNAPSHOT_COLLECTION };
