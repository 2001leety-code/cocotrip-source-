#!/usr/bin/env node
/**
 * 충성도 원장 오염 보정 — **기본값은 읽기 전용 dry-run** (2026-07-29).
 *
 * 배경: planPersister.js 가 플랜을 만들기만 해도 users/{uid} 의
 *   totalSpentUSD / bookingCount / tripCoins / tier 를 올리고 pointHistory 에
 *   `AI Plan: … ($942.86) +2829` 를 남겼다. 더해진 금액은 손님이 낸 $9.90 이 아니라
 *   **AI 가 추정한 여행 경비**였다. 코인은 할인쿠폰이 되므로 실 손실이다.
 *   (신규 결제 경로는 PR #1187 에서 PayPal orderID 멱등으로 고쳤다. 이 도구는 과거 데이터용.)
 *
 * 🔴 이 스크립트의 기본 동작은 **쓰기 0건**이다. 그것을 코드로 강제한다:
 *   Firestore 인스턴스를 감싸서 dry-run 모드에서는 set/update/delete/add/batch/
 *   runTransaction 호출 자체가 예외를 던진다. 시도 횟수도 센다(보고서에 기록).
 *
 * ── 실행 ────────────────────────────────────────────────────────────────
 *   node scripts/loyalty-remediation.mjs                    # dry-run (기본)
 *   node scripts/loyalty-remediation.mjs --report           # dry-run + 보고서 파일 생성
 *   node scripts/loyalty-remediation.mjs --limit 50         # 계정 수 제한(시험)
 *
 *   실제 쓰기는 아래 **셋이 동시에** 있어야만 열린다:
 *     --execute
 *     --confirm=<dry-run 이 출력한 planHash>
 *     env LOYALTY_REMEDIATION_APPROVAL=I-APPROVE-LOYALTY-WRITES
 *   셋 중 하나라도 없으면 즉시 중단한다. `--execute` 하나로는 절대 열리지 않는다.
 *
 * ⚠️ 개인정보: 이메일·전화·예약번호·uid·PayPal ID 를 콘솔과 보고서에 출력하지 않는다.
 *    계정은 user-1, user-2 … 순번으로만 표시한다.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── .env 로드 (기존 감사 스크립트와 동일 방식) ──────────────────────────────
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
const hasFlag = (f) => args.includes(f);
const valueOf = (prefix) => {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};
const wantExecute = hasFlag('--execute');
const confirmToken = valueOf('--confirm=');
const approvalEnv = (process.env.LOYALTY_REMEDIATION_APPROVAL || '').trim();
const REQUIRED_APPROVAL = 'I-APPROVE-LOYALTY-WRITES';
const writeReport = hasFlag('--report');
const limitIdx = args.indexOf('--limit');
const accountLimit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;

import {
  classifyBooking, classifyHistoryEntry, guardFirestore, loadAccount, assignAccountLabels,
  planHashOf, buildReport, toMarkdown, loadTierPolicy, checkProductionTarget,
} from './lib/loyalty-remediation-core.mjs';

async function main() {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const prodProject = (process.env.FIREBASE_PRODUCTION_PROJECT_ID || '').trim();
  // 자격증명 안에 들어 있는 프로젝트 ID (쓰기 모드 대상 확인용). 값 자체는 출력하지 않는다.
  let credentialProject = projectId || '';

  if (!getApps().length) {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (projectId && email && key) {
      initializeApp({ projectId, credential: cert({ projectId, clientEmail: email, privateKey: key }) });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
      const parsed = JSON.parse(raw);
      credentialProject = parsed.project_id || '';
      initializeApp({ projectId: credentialProject, credential: cert(parsed) });
    } else {
      console.error('[remediation] Firebase 자격증명 없음 — FIREBASE_* 또는 GOOGLE_SERVICE_ACCOUNT_KEY 필요');
      process.exit(1);
    }
  }

  // ── 실행 대상 표시 + Preview/Production 혼용 즉시 중단 ──
  const target = getFirestore().databaseId || '(default)';
  const maskedProject = projectId ? `${String(projectId).slice(0, 4)}…` : '(불명)';
  console.log('');
  console.log('════════ 충성도 원장 오염 보정 ════════');
  console.log(`모드            : ${wantExecute ? 'EXECUTE 요청됨' : 'DRY-RUN (읽기 전용)'}`);
  console.log(`대상 프로젝트   : ${maskedProject} / db=${target}`);
  if (prodProject && projectId && prodProject !== projectId) {
    console.log(`⚠️ 운영 프로젝트가 아니다 (FIREBASE_PRODUCTION_PROJECT_ID 와 다름)`);
  }
  if (!prodProject) {
    console.log('ℹ️ FIREBASE_PRODUCTION_PROJECT_ID 미설정 — 환경 판별 보류(읽기 전용이라 진행)');
  }
  const previewMarkers = [process.env.VERCEL_ENV, process.env.PAYPAL_ENV].filter(Boolean).join(',');
  if (prodProject && projectId === prodProject && /preview|sandbox/i.test(previewMarkers)) {
    console.error('🚨 Preview/Sandbox 설정이 운영 Firebase 를 가리킨다 — 즉시 중단');
    process.exit(2);
  }

  // ── 쓰기 게이트 ──
  let allowWrites = false;
  if (wantExecute) {
    if (approvalEnv !== REQUIRED_APPROVAL) {
      console.error(`🚫 --execute 거부: env LOYALTY_REMEDIATION_APPROVAL=${REQUIRED_APPROVAL} 필요`);
      process.exit(3);
    }
    if (!confirmToken) {
      console.error('🚫 --execute 거부: --confirm=<dry-run 의 planHash> 필요');
      process.exit(3);
    }
    // FAIL-5: Production 대상 확인 fail-closed. ID 는 출력하지 않고 일치 여부만 본다.
    const apps = getApps();
    const verdict = checkProductionTarget({
      declaredProdId: prodProject,
      credentialProjectId: credentialProject,
      appProjectId: apps[0] && apps[0].options && apps[0].options.projectId,
      previewMarkers: [process.env.VERCEL_ENV, process.env.PAYPAL_ENV, process.env.NODE_ENV]
        .filter(Boolean).join(','),
      forWrite: true,
    });
    if (!verdict.ok) {
      console.error(`[중단] --execute 거부: Production 대상 확인 실패 (${verdict.reason})`);
      console.error('       명시 Production ID · Admin 앱 연결 ID · 자격증명 ID 가 모두 같아야 한다.');
      process.exit(5);
    }
    console.log('Production 대상 : 세 값 일치 확인됨 (ID 는 출력하지 않음)');
    allowWrites = true;   // 실제 쓰기는 planHash 재확인 후 executeRemediation 에서만 일어난다
  }

  const db = guardFirestore(getFirestore(), { allowWrites });
  const calculateLoyaltyTier = await loadTierPolicy();

  const usersSnap = await db.collection('users').get();
  const accounts = [];
  let scanned = 0;
  for (const userDoc of usersSnap.docs) {
    if (accountLimit && scanned >= accountLimit) break;
    scanned += 1;
    accounts.push(await loadAccount(db, userDoc, calculateLoyaltyTier));
  }
  // 🔴 FAIL-17: 익명 순번을 여기서 확정한다. 실행부·스냅샷·보고서가 같은 번호를 쓴다.
  assignAccountLabels(accounts);

  // 전역: 계정에 귀속되지 않는 예약(레거시 uid 누락) 현황 — 재계산 가능 여부의 근거.
  const allBookings = await db.collection('bookings').get();
  let bookingsTotal = 0;
  let bookingsWithUid = 0;
  let bookingsPaymentVerified = 0;
  for (const b of allBookings.docs) {
    const bd = b.data() || {};
    bookingsTotal += 1;
    if (bd.uid) bookingsWithUid += 1;
    if (bd.paymentVerified === true) bookingsPaymentVerified += 1;
  }
  const planHash = planHashOf(accounts);
  const report = buildReport({ accounts, scanned, stats: db.stats, projectId, planHash });
  report.bookingLedger = {
    total: bookingsTotal,
    withUid: bookingsWithUid,
    paymentVerified: bookingsPaymentVerified,
    unattributable: bookingsTotal - bookingsWithUid,
    note: 'uid·paymentVerified 는 2026-07-29 PR 에서 추가된 필드다. 그 이전 결제 문서에는 없어 계정에 귀속되지 않는다.',
  };

  if (wantExecute) {
    if (confirmToken !== planHash) {
      console.error(`🚫 실행 중단: --confirm 값이 현재 계획과 다르다 (현재 planHash=${planHash})`);
      console.error('   대상·합계가 바뀌었다는 뜻이다. dry-run 을 다시 검토하고 새 승인을 받아라.');
      process.exit(4);
    }
    const { executeRemediation } = await import('./loyalty-remediation-execute.mjs');
    const result = await executeRemediation({ db, accounts, planHash });
    console.log(JSON.stringify({ executed: true, planHash, result }, null, 2));
    console.log(`성공 ${result.applied.length} / 건너뜀 ${result.skipped.length} / 실패 ${result.failed.length}`);
    // FAIL-6: 부분 실패를 명령 성공으로 보이게 하지 않는다.
    if (result.failed.length > 0) {
      console.error(`[중단] 실패한 계정 ${result.failed.length}건 — 전체 성공이 아니다. 실패 계정만 다시 실행하라(멱등).`);
      process.exit(6);
    }
    if (result.skipped.some((sk) => sk.reason === 'stale_plan')) {
      console.error('[중단] dry-run 이후 값이 바뀐 계정이 있어 건너뛰었다 — 새 dry-run 후 재승인 필요.');
      process.exit(7);
    }
    return;
  }

  // ── dry-run 출력 ──
  // 🔴 FAIL-17: "전체 현재 사실" 과 "이번 실행 대상" 을 절대 한 숫자로 섞지 않는다.
  //   대상 0 건일 때 "오염 이력 0건" 으로 찍히면 오염이 없었던 것처럼 읽힌다.
  const A = report.totals.allScanned;
  const P = report.totals.plannedTargets;
  console.log('');
  console.log('── 전체 스캔 결과 (현재 사실) ──');
  console.log(`스캔 계정       : ${A.scannedUsers} (오염 이력 보유 ${A.accountsWithPollutionHistory})`);
  console.log(`현재 지출       : $${A.current.totalSpentUSD.toLocaleString()}`);
  console.log(`현재 예약       : ${A.current.bookingCount}`);
  console.log(`현재 코인       : ${A.current.tripCoins.toLocaleString()}`);
  console.log(`역사적 오염 이력: ${A.historicalPollution.entries}건 (코인 ${A.historicalPollution.coins.toLocaleString()} / 지출 $${A.historicalPollution.usd.toLocaleString()})`);
  console.log(`이미 제거된 몫  : ${A.alreadyRemoved.entries}건 (코인 ${A.alreadyRemoved.coins.toLocaleString()} / 지출 $${A.alreadyRemoved.usd.toLocaleString()}) · 인정 correction ${A.acceptedCorrections}건`);
  console.log(`남은 미보정 오염: ${A.remainingPollution.entries}건 (코인 ${A.remainingPollution.coins.toLocaleString()} / 지출 $${A.remainingPollution.usd.toLocaleString()})`);
  console.log(`보류(애매)      : 이력 ${A.ambiguous.entries} · 계정내 주문 ${A.ambiguous.ordersInAccounts} · 쿠폰 ${A.ambiguous.coupons} · correction ${A.ambiguous.corrections}`);
  console.log(`전역 귀속불가   : 레거시 주문 ${report.bookingLedger.unattributable}건 (계정에 안 붙어 검증 불가 — 위 '계정내 주문' 과 별개)`);
  console.log(`현재 잔액 근거  : 있음 $${A.backedUSD.toLocaleString()} / 없음 $${A.unbackedUSD.toLocaleString()}`);
  console.log(`예약 귀속       : ${report.bookingLedger.withUid}/${report.bookingLedger.total} (귀속 불가 ${report.bookingLedger.unattributable})`);
  console.log(`manual_review   : ${A.manualReviewAccounts}계정 (인정되지 않은 correction 존재 — 자동 보정 제외)`);
  console.log('');
  console.log('── 이번 실행 대상 ──');
  console.log(`보정 대상 계정  : ${P.accountsToFix}`);
  console.log(`지출  ${('$' + P.before.totalSpentUSD.toLocaleString()).padStart(14)} → ${('$' + P.after.totalSpentUSD.toLocaleString()).padStart(10)}`);
  console.log(`예약  ${String(P.before.bookingCount).padStart(14)} → ${String(P.after.bookingCount).padStart(10)}`);
  console.log(`코인  ${P.before.tripCoins.toLocaleString().padStart(14)} → ${P.after.tripCoins.toLocaleString().padStart(10)}`);
  console.log(`쿠폰            : 회수 대상 ${P.couponsToRevoke}장 / 이미 사용 ${P.couponsGrandfathered}장(유지)`);
  console.log(`보정 방식       : ${JSON.stringify(P.modes)}`);
  console.log(`실행 시 문서 수 : ${P.docsToWrite}`);
  if (P.accountsToFix === 0) {
    console.log('ℹ️ 대상 0 건은 오염이 없었다는 뜻이 아니다 — 위 역사적 오염 이력을 함께 읽어라.');
  }
  for (const a of report.manualReviewAccounts) {
    console.log(`   🟡 user-${a.no}: 인정 안 된 correction ${a.unrecognizedCorrections}건 (${a.unrecognizedReasons.join(', ')}) — 자동 보정 제외`);
  }
  console.log('');
  console.log(`Firestore       : 읽기 ${db.stats.reads} / 쓰기 시도 ${db.stats.writeAttempts} / 실제 쓰기 ${db.stats.writesAllowed}`);
  console.log(`계획 해시       : ${planHash}`);
  console.log('');
  console.log('⚠️ 운영 데이터는 수정하지 않았다.');
  console.log('');

  if (writeReport) {
    // 감사 문서(01~05)를 덮어쓰지 않도록 "최신 실행" 전용 경로에 쓴다.
    const outDir = join(ROOT, 'docs', 'loyalty-remediation');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'latest-dryrun.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(join(outDir, 'latest-dryrun.md'), `${toMarkdown(report)}\n`, 'utf8');
    console.log('보고서: docs/loyalty-remediation/latest-dryrun.json / .md');
  }
}

// 다른 모듈에서 순수 함수만 재사용할 수 있게 (테스트용). 직접 실행할 때만 main().
const isDirectRun = process.argv[1] && process.argv[1].endsWith('loyalty-remediation.mjs');
if (isDirectRun) {
  main().catch((e) => {
    console.error('[remediation] 실패:', e && e.message);
    process.exit(1);
  });
}

export {
  classifyBooking, classifyHistoryEntry, guardFirestore,
  planHashOf, buildReport, toMarkdown, loadAccount,
};
