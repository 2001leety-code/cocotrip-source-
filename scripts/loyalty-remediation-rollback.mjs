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
      initializeApp({ credential: cert({ projectId: pid, clientEmail: email, privateKey: key }) });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
      const parsed = JSON.parse(raw);
      credentialProject = parsed.project_id || '';
      initializeApp({ credential: cert(parsed) });
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
      await db.runTransaction(async (tx) => {
        const correctionRef = userRef.collection('pointHistory').doc(correctionDocId(planHash));
        const correctionSnap = await tx.get(correctionRef);
        const couponEntries = [];
        for (const c of changed) {
          const ref = userRef.collection('coupons').doc(c.id);
          couponEntries.push({ ref, snap: await tx.get(ref), prior: c.prior });
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
        // 🔴 이번 plan 이 실제로 바꾼 쿠폰만, 그리고 그 쿠폰이 아직 이 plan 상태일 때만 복원.
        for (const { ref, snap: cs, prior } of couponEntries) {
          if (!cs.exists) continue;
          const cd = cs.data() || {};
          if (cd.revokedPlan !== planHash) continue;   // 다른 이유로 바뀐 쿠폰은 건드리지 않는다
          tx.set(ref, buildCouponRestorePatch(prior, FieldValue), { merge: true });
        }
      });
      results.restored.push(label);
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
  // 🔴 FAIL-6: 부분 실패를 명령 성공으로 보이게 하지 않는다.
  if (results.failed.length > 0) {
    console.error(`[중단] 되돌리기 실패 ${results.failed.length}건 — 전체 성공이 아니다.`);
    process.exit(6);
  }
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('loyalty-remediation-rollback.mjs');
if (isDirectRun) {
  main().catch((e) => {
    console.error('[rollback] 실패:', e && e.message);
    process.exit(1);
  });
}
