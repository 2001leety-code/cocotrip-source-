#!/usr/bin/env node
/**
 * 충성도 원장 보정 **되돌리기** (2026-07-29).
 *
 * executeRemediation 이 같은 transaction 안에 남긴 복구 스냅샷
 * (`admin_loyalty_remediation_snapshots/{planHash}/users/{uid}`) 을 읽어
 * 지갑·등급·누적지출·예약수를 보정 **이전 값**으로 되돌리고,
 * 이번 plan 이 **실제로 바꾼 쿠폰만** 이전 상태 그대로 복원한다.
 *
 * 🔴 기본값은 dry-run 이다. 실제 쓰기는 셋이 동시에 있어야 열린다:
 *     --execute
 *     --confirm=<planHash>
 *     env LOYALTY_ROLLBACK_APPROVAL=I-APPROVE-LOYALTY-ROLLBACK
 *   그리고 Production 대상 확인(명시 ID = Admin 앱 ID = 자격증명 ID)을 통과해야 한다.
 *
 * ⚠️ 스냅샷 문서 ID 는 uid 다. 이 스크립트는 **uid 를 출력하지 않는다.**
 *    복구 대상은 user-1, user-2 … 순번으로만 표시한다.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { correctionDocId, SNAPSHOT_COLLECTION, COUPON_REVOKE_FIELDS } from './loyalty-remediation-execute.mjs';
import { checkProductionTarget } from './lib/loyalty-remediation-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

for (const f of ['.env', '.env.admin.local', '.env.local']) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if (!v || v.startsWith('#')) continue;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\n/g, '\n');
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const args = process.argv.slice(2);
const wantExecute = args.includes('--execute');
const confirmArg = args.find((a) => a.startsWith('--confirm='));
const planHash = confirmArg ? confirmArg.slice('--confirm='.length) : '';
const REQUIRED_APPROVAL = 'I-APPROVE-LOYALTY-ROLLBACK';

/**
 * 🔴 FAIL-4: rollback 은 "삭제"가 아니라 **이전 상태 그대로 복원**이다.
 *   실행 당시 존재하지 않던 필드만 지우고, 존재했던 필드는 원래 값으로 되돌린다.
 */
export function buildCouponRestorePatch(prior, FieldValue) {
  const patch = {};
  for (const f of COUPON_REVOKE_FIELDS) {
    const p = prior && prior[f];
    if (!p || p.existed !== true) patch[f] = FieldValue.delete();
    else patch[f] = p.value;
  }
  return patch;
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
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const diffs = [];
  if (round2(meta.spentUSDAfter) !== round2(currentUser.totalSpentUSD)) diffs.push('totalSpentUSD');
  if (Number(meta.bookingCountAfter || 0) !== Number(currentUser.bookingCount || 0)) diffs.push('bookingCount');
  if (Number((correctionData || {}).balance || 0) !== Number(currentUser.tripCoins || 0)) diffs.push('tripCoins');
  if (String(meta.tierAfter || '') !== String(currentUser.tier || '')) diffs.push('tier');
  return diffs;
}

/** 이 plan 이 회수한 쿠폰이 그 뒤 다른 작업으로 바뀌었는지. 하나라도 바뀌면 전체 중단. */
export function detectCouponDrift(entries, planHash) {
  const drifted = [];
  for (const { ref, snap } of entries) {
    if (!snap.exists) { drifted.push({ id: ref.id, reason: 'missing' }); continue; }
    const c = snap.data() || {};
    if (c.revokedPlan !== planHash) { drifted.push({ id: ref.id, reason: 'revoked_plan_changed' }); continue; }
    if (c.isRevoked !== true) { drifted.push({ id: ref.id, reason: 'already_unrevoked' }); continue; }
    if (c.isUsed === true) { drifted.push({ id: ref.id, reason: 'used_after_revoke' }); }
  }
  return drifted;
}

async function main() {
  if (!planHash) {
    console.error('사용법: node scripts/loyalty-remediation-rollback.mjs --confirm=<planHash> [--execute]');
    process.exit(1);
  }
  if (wantExecute && (process.env.LOYALTY_ROLLBACK_APPROVAL || '').trim() !== REQUIRED_APPROVAL) {
    console.error(`[중단] --execute 거부: env LOYALTY_ROLLBACK_APPROVAL=${REQUIRED_APPROVAL} 필요`);
    process.exit(3);
  }

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const pid = process.env.FIREBASE_PROJECT_ID;
  let credentialProject = pid || '';
  if (!getApps().length) {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (pid && email && key) {
      initializeApp({ projectId: pid, credential: cert({ projectId: pid, clientEmail: email, privateKey: key }) });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
      const parsed = JSON.parse(raw);
      credentialProject = parsed.project_id || '';
      initializeApp({ projectId: credentialProject, credential: cert(parsed) });
    } else {
      console.error('[rollback] Firebase 자격증명 없음');
      process.exit(1);
    }
  }

  // 🔴 FAIL-5: rollback 쓰기도 같은 fail-closed 확인을 거친다. ID 는 출력하지 않는다.
  if (wantExecute) {
    const apps = getApps();
    const verdict = checkProductionTarget({
      declaredProdId: (process.env.FIREBASE_PRODUCTION_PROJECT_ID || '').trim(),
      credentialProjectId: credentialProject,
      appProjectId: apps[0] && apps[0].options && apps[0].options.projectId,
      previewMarkers: [process.env.VERCEL_ENV, process.env.PAYPAL_ENV, process.env.NODE_ENV]
        .filter(Boolean).join(','),
      forWrite: true,
    });
    if (!verdict.ok) {
      console.error(`[중단] rollback --execute 거부: Production 대상 확인 실패 (${verdict.reason})`);
      process.exit(5);
    }
    console.log('Production 대상 : 세 값 일치 확인됨 (ID 는 출력하지 않음)');
  }

  const db = getFirestore();
  const snapSnap = await db.collection(SNAPSHOT_COLLECTION).doc(planHash).collection('users').get();
  if (snapSnap.empty) {
    console.error(`[rollback] planHash=${planHash} 스냅샷이 없다 — 되돌릴 대상 없음`);
    process.exit(4);
  }

  console.log('');
  console.log(`════════ 보정 되돌리기 (${wantExecute ? 'EXECUTE' : 'DRY-RUN'}) ════════`);
  console.log(`planHash        : ${planHash}`);
  console.log(`복구 대상 계정  : ${snapSnap.size}`);

  const results = { restored: [], skipped: [], failed: [] };
  let i = 0;
  for (const snap of snapSnap.docs) {
    i += 1;
    const label = `user-${i}`;
    const s = snap.data() || {};
    const changed = s.couponsChanged || [];
    if (!wantExecute) {
      console.log(`  ${label}: 지출 $${s.before.totalSpentUSD} · 예약 ${s.before.bookingCount} `
        + `· 코인 ${s.before.tripCoins} · 등급 ${s.before.tier} 로 복구 예정 `
        + `(이번 plan 이 바꾼 쿠폰 ${changed.length}장만 원래 상태로 복원)`);
      continue;
    }
    try {
      const userRef = db.collection('users').doc(snap.id);
      const outcome = await db.runTransaction(async (tx) => {
        // ── 읽기 (쓰기 전에 전부) ──
        const correctionRef = userRef.collection('pointHistory').doc(correctionDocId(planHash));
        const correctionSnap = await tx.get(correctionRef);
        const userSnap = await tx.get(userRef);
        const couponEntries = [];
        for (const c of changed) {
          const ref = userRef.collection('coupons').doc(c.id);
          couponEntries.push({ ref, snap: await tx.get(ref), prior: c.prior });
        }

        // ── 사전 검증 — 하나라도 어긋나면 이 사용자는 아무것도 쓰지 않는다 ──
        if (!correctionSnap.exists) return { skipped: 'correction_missing' };
        const cd = correctionSnap.data() || {};
        if (cd.rolledBack === true) return { skipped: 'already_rolled_back' };
        if (!userSnap.exists) return { skipped: 'user_missing' };
        const u = userSnap.data() || {};
        if (String(u.loyaltyCorrectionPlan || '') !== planHash) return { skipped: 'plan_mismatch' };

        const diffs = detectStaleRollback(cd, u);
        if (diffs.length > 0) return { skipped: 'stale_rollback', diffs };

        const drifted = detectCouponDrift(couponEntries, planHash);
        if (drifted.length > 0) {
          return { skipped: 'coupon_drift', drifted: drifted.map((x) => x.reason) };
        }

        tx.set(userRef, {
          totalSpentUSD: s.before.totalSpentUSD,
          bookingCount: s.before.bookingCount,
          tripCoins: s.before.tripCoins,
          tier: s.before.tier,
          loyaltyCorrectedAt: FieldValue.delete(),
          loyaltyCorrectionPlan: FieldValue.delete(),
        }, { merge: true });
        // 감사 흔적은 남기되 되돌렸음을 표시한다(원장 항목을 물리 삭제하지 않는다).
        if (correctionSnap.exists) {
          tx.set(correctionRef, {
            rolledBack: true,
            rolledBackAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        // 위 detectCouponDrift 가 통과했으므로 전부 이 plan 이 만든 상태 그대로다.
        for (const { ref, prior } of couponEntries) {
          tx.set(ref, buildCouponRestorePatch(prior, FieldValue), { merge: true });
        }
        return { restored: true, coupons: couponEntries.length };
      });
      if (outcome.skipped) results.skipped.push({ label, reason: outcome.skipped, detail: outcome.diffs || outcome.drifted || null });
      else results.restored.push({ label, coupons: outcome.coupons });
    } catch (e) {
      results.failed.push({ label, error: String(e && e.message).slice(0, 200) });
    }
  }

  if (!wantExecute) {
    console.log('');
    console.log('⚠️ 되돌리지 않았다. 실제 복구는 --execute + env 승인 + Production 대상 확인이 있어야 한다.');
    console.log('');
    return;
  }
  console.log(JSON.stringify(results, null, 2));
  console.log(`복구 ${results.restored.length} / 건너뜀 ${results.skipped.length} / 실패 ${results.failed.length}`);
  // 🔴 FAIL-6: 부분 실패를 명령 성공으로 보이게 하지 않는다.
  if (results.failed.length > 0) {
    console.error(`[중단] 되돌리기 실패 ${results.failed.length}건 — 전체 성공이 아니다.`);
    process.exit(6);
  }
  // 🔴 FAIL-9: 보정 이후 정상 변경이 있어 건너뛴 사용자가 있으면 성공으로 끝내지 않는다.
  if (results.skipped.length > 0) {
    console.error(`[중단] 되돌리지 못한 계정 ${results.skipped.length}건 — 보정 이후 값이 바뀌었거나 correction 이 없다.`);
    process.exit(8);
  }
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('loyalty-remediation-rollback.mjs');
if (isDirectRun) {
  main().catch((e) => {
    console.error('[rollback] 실패:', e && e.message);
    process.exit(1);
  });
}
