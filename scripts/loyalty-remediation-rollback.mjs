#!/usr/bin/env node
/**
 * 충성도 원장 보정 **되돌리기** (2026-07-29).
 *
 * executeRemediation 이 같은 transaction 안에 남긴 복구 스냅샷
 * (`admin_loyalty_remediation_snapshots/{planHash}/users/{uid}`) 을 읽어
 * 지갑·등급·누적지출·예약수를 보정 **이전 값**으로 되돌리고, 회수했던 쿠폰을 살린다.
 *
 * 🔴 이 도구도 기본값은 dry-run 이다. 실제 쓰기는 셋이 동시에 있어야 열린다:
 *     --execute
 *     --confirm=<planHash>
 *     env LOYALTY_ROLLBACK_APPROVAL=I-APPROVE-LOYALTY-ROLLBACK
 *
 * ⚠️ 스냅샷에는 uid 가 문서 ID 로 들어간다. 이 스크립트는 **uid 를 출력하지 않는다.**
 *    복구 대상은 user-1, user-2 … 순번으로만 표시한다.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { correctionDocId, SNAPSHOT_COLLECTION } from './loyalty-remediation-execute.mjs';

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

async function main() {
  if (!planHash) {
    console.error('사용법: node scripts/loyalty-remediation-rollback.mjs --confirm=<planHash> [--execute]');
    process.exit(1);
  }
  if (wantExecute && (process.env.LOYALTY_ROLLBACK_APPROVAL || '').trim() !== REQUIRED_APPROVAL) {
    console.error(`🚫 --execute 거부: env LOYALTY_ROLLBACK_APPROVAL=${REQUIRED_APPROVAL} 필요`);
    process.exit(3);
  }

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const pid = process.env.FIREBASE_PROJECT_ID;
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (pid && email && key) {
      initializeApp({ credential: cert({ projectId: pid, clientEmail: email, privateKey: key }) });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
      initializeApp({ credential: cert(JSON.parse(raw)) });
    } else {
      console.error('[rollback] Firebase 자격증명 없음');
      process.exit(1);
    }
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
    if (!wantExecute) {
      console.log(`  ${label}: 지출 $${s.before.totalSpentUSD} · 예약 ${s.before.bookingCount} `
        + `· 코인 ${s.before.tripCoins} · 등급 ${s.before.tier} 로 복구 예정 `
        + `(쿠폰 ${(s.couponsRevoked || []).length}장 되살림)`);
      continue;
    }
    try {
      const userRef = db.collection('users').doc(snap.id);
      await db.runTransaction(async (tx) => {
        const correctionRef = userRef.collection('pointHistory').doc(correctionDocId(planHash));
        const correctionSnap = await tx.get(correctionRef);
        const couponEntries = [];
        for (const c of (s.couponsRevoked || [])) {
          const ref = userRef.collection('coupons').doc(c.id);
          couponEntries.push({ ref, snap: await tx.get(ref) });
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
        for (const { ref, snap: cs } of couponEntries) {
          if (!cs.exists) continue;
          tx.set(ref, {
            status: FieldValue.delete(),
            revokedReason: FieldValue.delete(),
            revokedPlan: FieldValue.delete(),
            revokedAt: FieldValue.delete(),
          }, { merge: true });
        }
      });
      results.restored.push(label);
    } catch (e) {
      results.failed.push({ label, error: String(e && e.message).slice(0, 200) });
    }
  }

  if (!wantExecute) {
    console.log('');
    console.log('⚠️ 되돌리지 않았다. 실제 복구는 --execute + env 승인이 있어야 한다.');
    console.log('');
    return;
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('[rollback] 실패:', e && e.message);
  process.exit(1);
});
