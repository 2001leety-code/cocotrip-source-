#!/usr/bin/env node
/**
 * 포인트·지출 원장 오염 감사 — **읽기 전용**. (2026-07-28)
 *
 * 배경: planPersister.js 가 플랜을 만들기만 해도 users/{uid} 의
 *   totalSpentUSD / bookingCount / tripCoins / tier 를 올리고
 *   pointHistory 에 `AI Plan: … ($707.14)` 를 남겼다. 더한 금액은 손님이 낸
 *   $9.90 이 아니라 차량 대절 추정 여행가였다. 코인은 할인쿠폰이 되므로 실 손실.
 *
 * 🔴 이 스크립트는 **아무것도 쓰지 않는다.** Firestore write 호출이 없다.
 *    보정·회수는 이 결과를 보고 별도 승인 후 별도 스크립트로 한다.
 *
 * 실행:
 *   node scripts/audit-loyalty-pollution.mjs            # 요약만
 *   node scripts/audit-loyalty-pollution.mjs --json     # 기계 판독용 JSON
 *   node scripts/audit-loyalty-pollution.mjs --limit 50 # 계정 수 제한(시험 실행)
 *
 * 필요 env (.env / .env.admin.local 자동 로드):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   (또는 GOOGLE_SERVICE_ACCOUNT_KEY)
 *
 * ⚠️ 개인정보: 이메일·전화·예약번호를 출력하지 않는다. 계정은 uid 앞 6자만 표시한다.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── .env 로드 (collect-kto 스크립트와 동일 방식) ────────────────────────────
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
const asJson = args.includes('--json');
const limitIdx = args.indexOf('--limit');
const accountLimit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;

/** AI 플랜 생성으로 잘못 적립된 이력인지 — planPersister 가 쓰던 문구. */
const POLLUTED_DESC = /^AI Plan:/;

/** 코인 → 쿠폰 교환표 (api/loyalty.js REDEEM 과 동일). 노출 규모 환산용. */
const REDEEM_TABLE = [
  { coins: 2000, percent: 15 },
  { coins: 1000, percent: 10 },
  { coins: 500, percent: 5 },
];

function couponEquivalent(coins) {
  // 가장 큰 단위부터 몇 장까지 바꿀 수 있는지 (상한 추정 — 실제 교환은 손님 선택).
  const best = REDEEM_TABLE[0];
  return { maxCoupons: Math.floor(coins / best.coins), percent: best.percent };
}

async function main() {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

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
      console.error('[audit] Firebase 자격증명 없음 — FIREBASE_* 또는 GOOGLE_SERVICE_ACCOUNT_KEY 설정 필요');
      process.exit(1);
    }
  }
  const db = getFirestore();

  const usersSnap = await db.collection('users').get();
  const accounts = [];
  let scanned = 0;

  for (const userDoc of usersSnap.docs) {
    if (accountLimit && scanned >= accountLimit) break;
    scanned += 1;

    // pointHistory 는 계정당 문서 수가 적다(적립/사용 이력). 전량 읽어 분류.
    const histSnap = await userDoc.ref.collection('pointHistory').get();
    const polluted = [];
    let legitEarnCoins = 0;
    for (const h of histSnap.docs) {
      const d = h.data() || {};
      if (d.type !== 'earn') continue;
      if (POLLUTED_DESC.test(String(d.description || ''))) {
        // 설명에 박힌 금액을 뽑는다 — 그게 잘못 더해진 totalSpentUSD 증가분이다.
        const m = String(d.description).match(/\$([0-9]+(?:\.[0-9]+)?)/);
        polluted.push({ coins: Number(d.amount) || 0, usd: m ? Number(m[1]) : 0 });
      } else {
        legitEarnCoins += Number(d.amount) || 0;
      }
    }
    if (!polluted.length) continue;

    const u = userDoc.data() || {};
    const badCoins = polluted.reduce((s, p) => s + p.coins, 0);
    const badUsd = polluted.reduce((s, p) => s + p.usd, 0);

    // 보유 쿠폰 — 미사용/사용 분리 (회수 정책 판단 자료)
    const couponSnap = await userDoc.ref.collection('coupons').get();
    let couponsUnused = 0, couponsUsed = 0;
    for (const c of couponSnap.docs) {
      const cd = c.data() || {};
      if (cd.isUsed) couponsUsed += 1; else couponsUnused += 1;
    }

    accounts.push({
      uid: `${userDoc.id.slice(0, 6)}…`,          // ⚠️ PII 최소화 — 전체 uid 미출력
      currentCoins: Number(u.tripCoins) || 0,
      currentSpentUSD: Number(u.totalSpentUSD) || 0,
      currentBookingCount: Number(u.bookingCount) || 0,
      currentTier: u.tier || 'Bronze',
      pollutedEntries: polluted.length,
      pollutedCoins: badCoins,
      pollutedUSD: Math.round(badUsd * 100) / 100,
      legitEarnCoins,
      couponsUnused,
      couponsUsed,
    });
  }

  accounts.sort((a, b) => b.pollutedCoins - a.pollutedCoins);

  const totals = accounts.reduce((t, a) => ({
    accounts: t.accounts + 1,
    coins: t.coins + a.pollutedCoins,
    usd: t.usd + a.pollutedUSD,
    entries: t.entries + a.pollutedEntries,
    couponsUnused: t.couponsUnused + a.couponsUnused,
    couponsUsed: t.couponsUsed + a.couponsUsed,
  }), { accounts: 0, coins: 0, usd: 0, entries: 0, couponsUnused: 0, couponsUsed: 0 });

  const exposure = couponEquivalent(totals.coins);

  if (asJson) {
    console.log(JSON.stringify({ scannedUsers: scanned, totals, exposure, accounts }, null, 2));
    return;
  }

  console.log('');
  console.log('════════ 포인트·지출 원장 오염 감사 (읽기 전용) ════════');
  console.log(`스캔한 계정            : ${scanned}`);
  console.log(`오염된 계정            : ${totals.accounts}`);
  console.log(`잘못 적립된 이력 건수  : ${totals.entries}`);
  console.log(`잘못 발급된 코인 합계  : ${totals.coins.toLocaleString()}`);
  console.log(`잘못 더해진 지출 합계  : $${totals.usd.toLocaleString()}`);
  console.log(`  └ 15% 쿠폰 환산 상한 : ${exposure.maxCoupons}장`);
  console.log(`보유 쿠폰(미사용/사용) : ${totals.couponsUnused} / ${totals.couponsUsed}`);
  console.log('');
  console.log('상위 20 계정 (uid 앞 6자만):');
  console.log('  uid       코인(오염)   지출(오염)  건수  현재등급  쿠폰 미사용/사용');
  for (const a of accounts.slice(0, 20)) {
    console.log(
      `  ${a.uid.padEnd(9)} ${String(a.pollutedCoins).padStart(10)} ${('$' + a.pollutedUSD).padStart(11)}`
      + ` ${String(a.pollutedEntries).padStart(5)}  ${String(a.currentTier).padEnd(9)} ${a.couponsUnused}/${a.couponsUsed}`
    );
  }
  console.log('');
  console.log('⚠️ 이 스크립트는 아무것도 수정하지 않았다. 보정·쿠폰 회수는 별도 승인 후 진행.');
  console.log('');
}

main().catch((e) => {
  console.error('[audit] 실패:', e && e.message);
  process.exit(1);
});
