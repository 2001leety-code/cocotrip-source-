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
import { SNAPSHOT_COLLECTION } from './loyalty-remediation-execute.mjs';
import {
  checkProductionTarget, correctionDocId, COUPON_REVOKE_FIELDS, guardFirestore,
  evaluateRollbackTarget, detectStaleRollback, validateCouponForRollback,
} from './lib/loyalty-remediation-core.mjs';

export { evaluateRollbackTarget, detectStaleRollback, validateCouponForRollback };

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


/** 이 plan 이 회수한 쿠폰이 그 뒤 다른 작업으로 바뀌었는지. 하나라도 바뀌면 전체 중단. */
export function detectCouponDrift(entries, planHash) {
  const drifted = [];
  for (const { ref, snap } of entries) {
    const why = validateCouponForRollback(planHash, snap.exists, snap.data ? snap.data() : null);
    if (why) drifted.push({ id: ref.id, reason: why });
  }
  return drifted;
}

/**
 * 🔴 FAIL-14: dry-run 과 execute 가 **같은 읽기·판정**을 쓴다.
 *
 * 읽기만 하는 reader 를 받아 대상 하나를 판정한다. dry-run 은 일반 `.get()` 을 넘기고,
 * execute 는 transaction 의 `tx.get` 을 넘긴다. 그래서 dry-run 이 `ready` 라고 한 계정만
 * execute 에서도 통과한다(판정이 두 벌이면 dry-run 은 허수가 된다).
 *
 * @param {{read: (ref: object) => Promise<object>, userRef: object,
 *          snapshotData: object, planHash: string}} args
 */
export async function readAndEvaluate({ read, userRef, snapshotData, planHash }) {
  const changed = (snapshotData || {}).couponsChanged || [];
  const correctionRef = userRef.collection('pointHistory').doc(correctionDocId(planHash));
  const correctionSnap = await read(correctionRef);
  const userSnap = await read(userRef);
  const couponEntries = [];
  for (const c of changed) {
    const ref = userRef.collection('coupons').doc(c.id);
    couponEntries.push({ ref, snap: await read(ref), prior: c.prior });
  }
  const verdict = evaluateRollbackTarget({
    planHash,
    correctionExists: correctionSnap.exists,
    correctionData: correctionSnap.exists ? correctionSnap.data() : null,
    userExists: userSnap.exists,
    userData: userSnap.exists ? userSnap.data() : null,
    coupons: couponEntries.map((e) => ({
      id: e.ref.id, exists: e.snap.exists, data: e.snap.exists ? e.snap.data() : null,
    })),
  });
  return { verdict, correctionRef, correctionSnap, userSnap, couponEntries };
}

/** 스냅샷 문서 하나를 익명 순번으로. 옛 스냅샷에는 accountNo 가 없어 순서로 대체한다. */
export function rollbackLabel(snapshotData, index) {
  return `user-${(snapshotData || {}).accountNo || index + 1}`;
}

/**
 * 🔴 FAIL-14: **읽기 전용** 판정. dry-run 이 이 함수를 쓴다.
 *   execute 와 같은 readAndEvaluate 를 부르므로 판정이 두 벌이 될 수 없다.
 */
export async function evaluateRollbackAccount({ db, snapshotData, uid, planHash }) {
  const userRef = db.collection('users').doc(uid);
  const { verdict } = await readAndEvaluate({
    read: (ref) => ref.get(), userRef, snapshotData, planHash,
  });
  return verdict;
}

/**
 * 되돌리기 한 계정 — 사용자·correction 원장·쿠폰을 **하나의 transaction** 으로 복원한다.
 * 판정이 어긋나면 아무것도 쓰지 않는다(부분 복원 상태가 남지 않는다).
 */
export async function rollbackOneAccount({ db, FieldValue, snapshotData, uid, planHash }) {
  const s = snapshotData || {};
  const userRef = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    // ── 읽기 + 판정 (dry-run 과 같은 함수) ──
    const { verdict, correctionRef, couponEntries } = await readAndEvaluate({
      read: (ref) => tx.get(ref), userRef, snapshotData: s, planHash,
    });
    if (!verdict.ready) return { skipped: verdict.reason, detail: verdict.detail };

    tx.set(userRef, {
      totalSpentUSD: s.before.totalSpentUSD,
      bookingCount: s.before.bookingCount,
      tripCoins: s.before.tripCoins,
      tier: s.before.tier,
      loyaltyCorrectedAt: FieldValue.delete(),
      loyaltyCorrectionPlan: FieldValue.delete(),
    }, { merge: true });
    // 감사 흔적은 남기되 되돌렸음을 표시한다(원장 항목을 물리 삭제하지 않는다).
    // verdict.ready 는 correction 이 존재하고 이 보정이 만든 것임을 이미 확인했다.
    tx.set(correctionRef, {
      rolledBack: true,
      rolledBackAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    // 위 판정이 통과했으므로 전부 이 plan 이 만든 상태 그대로다.
    for (const { ref, prior } of couponEntries) {
      tx.set(ref, buildCouponRestorePatch(prior, FieldValue), { merge: true });
    }
    return { restored: true, coupons: couponEntries.length };
  });
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

  // 🔴 FAIL-14: dry-run 의 쓰기 0건을 **코드로 강제**한다. 읽기 수도 함께 센다.
  const db = guardFirestore(getFirestore(), { allowWrites: wantExecute });
  const snapSnap = await db.collection(SNAPSHOT_COLLECTION).doc(planHash).collection('users').get();
  if (snapSnap.empty) {
    console.error(`[rollback] planHash=${planHash} 스냅샷이 없다 — 되돌릴 대상 없음`);
    process.exit(4);
  }

  console.log('');
  console.log(`════════ 보정 되돌리기 (${wantExecute ? 'EXECUTE' : 'DRY-RUN'}) ════════`);
  console.log(`planHash        : ${planHash}`);
  console.log(`스냅샷 계정     : ${snapSnap.size}`);

  const results = { restored: [], skipped: [], failed: [] };
  for (let i = 0; i < snapSnap.docs.length; i += 1) {
    const snap = snapSnap.docs[i];
    const s = snap.data() || {};
    const label = rollbackLabel(s, i);
    const changed = s.couponsChanged || [];

    if (!wantExecute) {
      // 🔴 FAIL-14: 예전에는 스냅샷만 찍고 "복구 예정" 이라 했다(허수 검사).
      //   이제 execute 와 **같은 판정 함수**로 읽기 전용 검증한다.
      try {
        const verdict = await evaluateRollbackAccount({ db, snapshotData: s, uid: snap.id, planHash });
        if (verdict.ready) {
          results.restored.push({ label, coupons: changed.length });
          console.log(`  ${label}: ✅ 복구 가능 — 지출 $${s.before.totalSpentUSD} · 예약 ${s.before.bookingCount} `
            + `· 코인 ${s.before.tripCoins} · 등급 ${s.before.tier} 로 복구, 쿠폰 ${changed.length}장 원상복원`);
        } else {
          results.skipped.push({ label, reason: verdict.reason, detail: verdict.detail });
          console.log(`  ${label}: ⛔ 복구 불가 — ${verdict.reason}`
            + `${verdict.detail ? ` (${verdict.detail.join(', ')})` : ''}`);
        }
      } catch (e) {
        results.failed.push({ label, error: String(e && e.message).slice(0, 200) });
        console.log(`  ${label}: ⛔ 검증 실패 — ${String(e && e.message).slice(0, 120)}`);
      }
      continue;
    }
    try {
      const outcome = await rollbackOneAccount({ db, FieldValue, snapshotData: s, uid: snap.id, planHash });
      if (outcome.skipped) results.skipped.push({ label, reason: outcome.skipped, detail: outcome.detail || null });
      else results.restored.push({ label, coupons: outcome.coupons });
    } catch (e) {
      results.failed.push({ label, error: String(e && e.message).slice(0, 200) });
    }
  }

  if (!wantExecute) {
    console.log('');
    console.log(`복구 가능 ${results.restored.length} / 복구 불가 ${results.skipped.length} / 검증 실패 ${results.failed.length}`);
    const reasons = results.skipped.reduce((m, s) => { m[s.reason] = (m[s.reason] || 0) + 1; return m; }, {});
    if (results.skipped.length > 0) console.log(`복구 불가 사유  : ${JSON.stringify(reasons)}`);
    console.log(`Firestore       : 읽기 ${db.stats.reads} / 쓰기 시도 ${db.stats.writeAttempts} / 실제 쓰기 ${db.stats.writesAllowed}`);
    console.log('');
    console.log('⚠️ 되돌리지 않았다. 실제 복구는 --execute + env 승인 + Production 대상 확인이 있어야 한다.');
    console.log('   위 "복구 가능" 은 execute 와 **같은 판정 함수**로 읽기 전용 검증한 결과다.');
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
