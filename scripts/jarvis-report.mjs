/**
 * jarvis-report.mjs — 디스코드 자비스 "실시간 회사 현황" (읽기 전용, AI 0%).
 *
 * 디스코드 봇이 사장님의 `/현황` 명령에 이 고정 스크립트를 직접 실행해 결과를 돌려준다.
 * (claude 에게 셸을 주지 않음 = 프롬프트 주입으로도 다른 명령 실행 불가 — 봇 코드에 박힌 단일 명령.)
 *
 * 모닝 브리핑과 "동일한 집계 모듈"(morningBriefingAggregate)을 재사용 → 숫자 일치(SSOT).
 * 출력: 오늘(지금까지)·어제·이번주·이번달 매출, 오늘 오류, 오늘 문의, 대기 결정, DB 규모.
 *
 * 사용: node scripts/jarvis-report.mjs   (repo 루트 cwd, .env / .env.local 자격 필요)
 * READ-ONLY: .get()/.count() 만 — 쓰기·수정 일절 없음.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import {
  toMs, kstYesterdayWindow, kstWeekStartMs, kstMonthStartMs,
  aggregateMorningBriefing, aggregateErrors,
} from '../api/_shared/morningBriefingAggregate.js';
import { isAdminBypassBooking, isOperatorTestEmail } from '../api/_shared/admin-bypass-detector.js';
import { aggregateDecisionSummary, DECISION_COLLECTION } from '../api/_shared/decisionQueue.js';

// ── .env 로더 (multi-line PEM 처리, dotenv 의존성 없이) — audit-transit.mjs 패턴 ──
for (const file of ['.env', '.env.local', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* optional */ }
}

// Firebase 초기화 — 자격증명 누락/PEM 파싱 실패 시 cert() 가 동기 throw → try/catch 로 친절한 메시지(봇이 relay).
let db;
try {
  const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/^﻿/, '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
  const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
  let privateKey = rawKey;
  if (pemMatch) {
    const base64Clean = pemMatch[1].replace(/\s+/g, '');
    const lines = base64Clean.match(/.{1,64}/g) || [];
    privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(),
        clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
        privateKey,
      }),
    });
  }
  db = getFirestore();
} catch (e) {
  console.log(`현황 조회 실패: Firebase 연결 오류 — ${e.message}\n(.env / .env.local 의 FIREBASE_* 자격증명 확인 필요)`);
  process.exit(1);
}

const now = new Date();
const { yStartMs, todayStartMs } = kstYesterdayWindow(now);
const weekStartMs = kstWeekStartMs(now);
const monthStartMs = kstMonthStartMs(now);
const nowMs = now.getTime();
const trendStartMs = Math.min(weekStartMs, monthStartMs, yStartMs);

// createdAt 타입: bookings/users/cs_tickets = Firestore Timestamp / plans = createdAtMs(number) / error_log = number(Date.now()).
//   ⚠️ Firestore 부등호(>=)는 같은 타입끼리만 매칭 — cs_tickets 는 serverTimestamp(Timestamp)이라 number 로 쿼리하면 0건.
const [bk, pl, us, er, cs, dq] = await Promise.allSettled([
  db.collection('bookings').where('createdAt', '>=', Timestamp.fromMillis(trendStartMs)).get(),
  db.collection('plans').where('createdAtMs', '>=', yStartMs).get(),
  db.collection('users').where('createdAt', '>=', Timestamp.fromMillis(yStartMs)).get(),
  db.collection('error_log').where('createdAt', '>=', yStartMs).get(),
  db.collection('cs_tickets').where('createdAt', '>=', Timestamp.fromMillis(yStartMs)).get(),
  db.collection(DECISION_COLLECTION).where('status', '==', 'pending').limit(50).get(),
]);
const toArr = (r) => (r.status === 'fulfilled' ? r.value.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
const bookingDocs = toArr(bk), planDocs = toArr(pl), userDocs = toArr(us);
const errorDocs = toArr(er), cstDocs = toArr(cs), decisionDocs = toArr(dq);

// 어제 + 주/월 추세 — 브리핑과 동일 집계(parity).
const agg = aggregateMorningBriefing({ bookingDocs, planDocs, userDocs, errorDocs, cstDocs }, { now });
const decisions = aggregateDecisionSummary(decisionDocs);

// 오늘(지금까지) 실매출 — 브리핑 isRealRevenueBooking 로직 복제(같은 detector 임포트).
const isReal = (b) => !isAdminBypassBooking(b)
  && !isOperatorTestEmail(b.userEmail || b.payerEmail)
  && String(b.status || '').toUpperCase() !== 'CANCELED';
let todayUsd = 0, todayCount = 0;
for (const b of bookingDocs) {
  const ms = toMs(b.createdAt);
  if (ms == null || ms < todayStartMs || ms > nowMs) continue;
  if (!isReal(b)) continue;
  todayUsd += parseFloat(b.amountUSD) || 0;
  todayCount++;
}
const todayErrors = aggregateErrors(errorDocs, todayStartMs, nowMs + 1);
let todayTickets = 0;
for (const c of cstDocs) {
  const ms = toMs(c.createdAt);
  if (ms != null && ms >= todayStartMs && ms <= nowMs) todayTickets++;
}

// DB 규모 — 전체 플랜 수(count 집계, 효율적).
let totalPlans = '?';
try { const c = await db.collection('plans').count().get(); totalPlans = c.data().count; } catch { /* ignore */ }

// 환율 — live (실패 시 1450 폴백).
let rate = 1450;
try {
  const { getUsdToKrwRaw } = await import('../api/_exchange-rate.js');
  const r = await getUsdToKrwRaw();
  if (Number.isFinite(r) && r > 0) rate = r;
} catch { /* fallback */ }

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const krw = (n) => `₩${Math.round((Number(n) || 0) * rate).toLocaleString()}`;
const k = new Date(nowMs + 9 * 3600 * 1000);
const pad = (x) => String(x).padStart(2, '0');
const stamp = `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())} KST`;

const out = [
  `📊 코코트립 실시간 현황 · ${stamp}`,
  '',
  '💰 매출',
  `· 오늘(지금까지): ${usd(todayUsd)} · ${todayCount}건 (${krw(todayUsd)})`,
  `· 어제: ${usd(agg.revenue.usd)} · ${agg.revenue.count}건`,
  `· 이번주(어제까지 누적): ${usd(agg.trends.week.usd)} · ${agg.trends.week.count}건`,
  `· 이번달(어제까지 누적): ${usd(agg.trends.month.usd)} · ${agg.trends.month.count}건`,
  `· AI 플래너 유료(어제): ${agg.aiPlanner.paidCount}건 · 수수료 ${usd(agg.aiPlanner.feeUsd)}`,
  '',
  '🛠️ 운영',
  `· 오늘 오류: ${todayErrors.total}건${todayErrors.total ? ` (심각 ${todayErrors.bySeverity.critical}·높음 ${todayErrors.bySeverity.high})` : ' ✅'}`,
  ...(todayErrors.top.length ? todayErrors.top.map((t) => `   - ${t.key} ${t.count}회`) : []),
  '',
  '💬 고객',
  `· 오늘 신규 문의: ${todayTickets}건`,
  '',
  `📥 결정 대기: ${decisions.total}건${decisions.total ? ' (cocotripkr.com/admin/decisions)' : ' ✅'}`,
  ...(decisions.top && decisions.top.length ? decisions.top.map((d) => `   - ${d.title}`) : []),
  '',
  `📦 DB: 전체 플랜 ${totalPlans}건 · 환율 ₩${rate.toLocaleString()}/$`,
];
console.log(out.join('\n'));
process.exit(0);
