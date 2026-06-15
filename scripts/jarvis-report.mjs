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

const pad = (x) => String(x).padStart(2, '0');
const kstYmd = (ms) => { const d = new Date(ms + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const todayISO = kstYmd(todayStartMs);
const plus3ISO = kstYmd(todayStartMs + 3 * 86400000);

// createdAt 타입(writer 검증 2026-06-15): Timestamp = bookings/users/cs_tickets/charter_inquiries/plan_complaints /
//   number = error_log/mood_bookings/mood_clients/reviews / createdAtMs(number) = plans. ⚠️ 부등호는 같은 타입끼리만 매칭(틀리면 0건).
const Q = await Promise.allSettled([
  db.collection('bookings').where('createdAt', '>=', Timestamp.fromMillis(trendStartMs)).get(),                    // 0 bk
  db.collection('plans').where('createdAtMs', '>=', yStartMs).get(),                                              // 1 pl
  db.collection('users').where('createdAt', '>=', Timestamp.fromMillis(yStartMs)).get(),                          // 2 us
  db.collection('error_log').where('createdAt', '>=', yStartMs).get(),                                            // 3 er (number)
  db.collection('cs_tickets').where('createdAt', '>=', Timestamp.fromMillis(yStartMs)).get(),                     // 4 cs
  db.collection(DECISION_COLLECTION).where('status', '==', 'pending').limit(50).get(),                            // 5 dq
  db.collection('pending_bookings').where('status', '==', 'AWAITING_VERIFICATION').limit(100).get(),              // 6 입금대기
  db.collection('charter_inquiries').where('status', 'in', ['pending', 'NEW']).limit(100).get(),                  // 7 차터문의
  db.collection('plans').where('status', '==', 'streaming').limit(100).get(),                                     // 8 streaming
  db.collection('bookings').where('tourDate', '>=', todayISO).where('tourDate', '<=', plus3ISO).limit(300).get(), // 9 배차(D-0~D-3)
  db.collection('mood_bookings').where('createdAt', '>=', todayStartMs).limit(300).get(),                         // 10 MOOD예약(number)
  db.collection('mood_clients').limit(500).get(),                                                                 // 11 MOOD잔액
  db.collection('plan_complaints').where('status', '==', 'open').limit(100).get(),                                // 12 품질신고
  db.collection('reviews').where('status', '==', 'reported').limit(100).get(),                                    // 13 리뷰신고
  db.collection('bookings').where('refundedAt', '>=', Timestamp.fromMillis(todayStartMs)).limit(100).get(),       // 14 오늘환불
  db.collection('bookings').where('refundRequestedAt', '>=', Timestamp.fromMillis(0)).limit(100).get(),           // 15 환불요청
]);
const arr = (i) => (Q[i].status === 'fulfilled' ? Q[i].value.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
const bookingDocs = arr(0), planDocs = arr(1), userDocs = arr(2), errorDocs = arr(3), cstDocs = arr(4), decisionDocs = arr(5);
const pendingDocs = arr(6), charterDocs = arr(7), streamingDocs = arr(8), dispatchDocs = arr(9);
const moodBookDocs = arr(10), moodClientDocs = arr(11), complaintDocs = arr(12), reviewDocs = arr(13);
const refundDocs = arr(14), refundReqDocs = arr(15);

// 어제 + 주/월 추세 — 브리핑과 동일 집계(parity).
const agg = aggregateMorningBriefing({ bookingDocs, planDocs, userDocs, errorDocs, cstDocs }, { now });
const decisions = aggregateDecisionSummary(decisionDocs);

// 오늘(지금까지) 실매출 — 브리핑 isRealRevenueBooking 로직 복제.
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

// 💳 입금 확인 대기(들어올 돈) — 운영자 테스트 제외.
let pendingCount = 0, pendingUsd = 0;
for (const b of pendingDocs) {
  if (isAdminBypassBooking(b) || isOperatorTestEmail(b.userEmail || b.payerEmail)) continue;
  pendingCount++; pendingUsd += parseFloat(b.priceUSD) || 0;
}
// 💸 환불(오늘 완료 + 미처리 요청).
let refundCount = 0, refundUsd = 0;
for (const b of refundDocs) { refundCount++; refundUsd += parseFloat(b.amountUSD) || 0; }
let refundReqOpen = 0;
for (const b of refundReqDocs) { if (!b.refundedAt) refundReqOpen++; }
// 🎯 차터 견적 문의 미응답(이미 status in [pending,NEW] 로 필터됨).
const charterPending = charterDocs.length;
// 🔧 플랜 장애 — streaming 멈춤(30분+) + error(어제~오늘).
let streamingStuck = 0;
const STUCK_MS = 30 * 60 * 1000;
for (const p of streamingDocs) {
  const raw = (p._streaming_started_at != null) ? p._streaming_started_at : p.createdAtMs;
  const started = (typeof raw === 'number') ? raw : toMs(raw);
  if (started != null && (nowMs - started) > STUCK_MS) streamingStuck++;
}
let errorPlans = 0;
for (const p of planDocs) {
  if (String(p.status) !== 'error') continue;
  const ms = (typeof p.createdAtMs === 'number') ? p.createdAtMs : toMs(p.createdAt);
  if (ms != null && ms >= yStartMs && ms <= nowMs) errorPlans++;
}
// 🚐 미배차 — D-0~D-3 CONFIRMED 중 기사 미배정(4필드 전부 비어야 미배차).
//   false alarm 방지: 운영자 테스트·admin bypass 제외 + 고객 이메일 있어야(실제 결제 손님만 — 이메일 없는 시드/테스트 제외).
const isUnassigned = (b) => String(b.status || '').toUpperCase() === 'CONFIRMED'
  && !!(b.payerEmail || b.userEmail)
  && !isAdminBypassBooking(b) && !isOperatorTestEmail(b.userEmail || b.payerEmail)
  && !(b.driver && String(b.driver).trim()) && !b.driverChatId && !b.acceptedAt
  && String(b.dispatchStatus || '') !== 'accepted';
let unassigned = 0;
for (const b of dispatchDocs) { if (isUnassigned(b)) unassigned++; }
// 🏢 MOOD — 오늘 신규 예약 + 고객 선불잔액 합계.
let moodCount = 0, moodKrw = 0;
for (const b of moodBookDocs) { moodCount++; moodKrw += Number(b.amountKRW) || 0; }
let moodBalance = 0;
for (const c of moodClientDocs) moodBalance += Number(c.balanceKRW) || 0;
const moodClientCount = moodClientDocs.length;
// 💬 고객/품질.
const complaintsOpen = complaintDocs.length;
const reviewsReported = reviewDocs.length;

// DB 규모 — 전체 플랜 수.
let totalPlans = '?';
try { const c = await db.collection('plans').count().get(); totalPlans = c.data().count; } catch { /* ignore */ }
// 환율 — live (실패 시 1450 폴백).
let rate = 1450;
try {
  const { getUsdToKrwRaw } = await import('../api/_exchange-rate.js');
  const r = await getUsdToKrwRaw();
  if (Number.isFinite(r) && r > 0) rate = r;
} catch { /* fallback */ }
// 📣 방문자(PostHog) — 로컬 env 없으면 graceful skip.
let visitors = null;
try {
  const { fetchMarketingMetrics } = await import('../api/_shared/morningBriefingMarketing.js');
  const mk = await fetchMarketingMetrics(yStartMs, todayStartMs);
  if (mk && !mk.skipped) visitors = mk;
} catch { /* skip */ }

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const krw = (n) => `₩${Math.round((Number(n) || 0) * rate).toLocaleString()}`;
const krwAmt = (n) => `₩${Math.round(Number(n) || 0).toLocaleString()}`;
const stamp = `${todayISO} ${pad(new Date(nowMs + 9 * 3600 * 1000).getUTCHours())}:${pad(new Date(nowMs + 9 * 3600 * 1000).getUTCMinutes())} KST`;
const productLines = Object.entries(agg.byProduct || {})
  .filter((e) => e[1] && e[1].count > 0)
  .map((e) => `   - ${e[0]} ${e[1].count}건 ${usd(e[1].usd)}`);

const out = [
  `📊 코코트립 실시간 현황 · ${stamp}`,
  '',
  '💰 매출/돈',
  `· 오늘(지금까지): ${usd(todayUsd)} · ${todayCount}건 (${krw(todayUsd)})`,
  `· 어제: ${usd(agg.revenue.usd)} · ${agg.revenue.count}건`,
  `· 이번주(어제까지): ${usd(agg.trends.week.usd)} · ${agg.trends.week.count}건 · 이번달: ${usd(agg.trends.month.usd)} · ${agg.trends.month.count}건`,
  ...(productLines.length ? ['· 어제 상품별:', ...productLines] : []),
  `· AI 플래너 유료(어제): ${agg.aiPlanner.paidCount}건 · 수수료 ${usd(agg.aiPlanner.feeUsd)}`,
  `· 💳 입금 확인 대기: ${pendingCount}건${pendingCount ? ` (${usd(pendingUsd)})` : ' ✅'}`,
  `· 💸 오늘 환불: ${refundCount}건${refundCount ? ` (${usd(refundUsd)})` : ''}${refundReqOpen ? ` · ⚠️ 미처리 환불요청 ${refundReqOpen}건` : ''}`,
  '',
  '🚐 운영',
  `· ${unassigned ? '🔴' : '✅'} 미배차(오늘~D-3 투어 기사 없음): ${unassigned}건`,
  `· ${(streamingStuck || errorPlans) ? '⚠️' : '✅'} 플랜 장애: streaming 멈춤 ${streamingStuck}건 · error(어제~오늘) ${errorPlans}건`,
  `· 오늘 오류: ${todayErrors.total}건${todayErrors.total ? ` (심각 ${todayErrors.bySeverity.critical}·높음 ${todayErrors.bySeverity.high})` : ' ✅'}`,
  ...(todayErrors.top.length ? todayErrors.top.map((t) => `   - ${t.key} ${t.count}회`) : []),
  '',
  '🎯 리드/고객',
  `· 차터 견적 문의 미응답: ${charterPending}건${charterPending ? ' ⚠️' : ' ✅'}`,
  `· 오늘 신규 문의: ${todayTickets}건 · 신규 가입(어제): ${agg.newUsers}명`,
  `· 플랜 품질신고 미응답: ${complaintsOpen}건 · 리뷰 모더레이션 대기: ${reviewsReported}건`,
  '',
  '🏢 MOOD (B2B)',
  `· 오늘 신규 예약: ${moodCount}건${moodCount ? ` (${krwAmt(moodKrw)})` : ''} · 고객 선불잔액: ${krwAmt(moodBalance)} (${moodClientCount}개사)`,
  '',
  '📣 마케팅',
  visitors
    ? `· 어제 방문자: ${(visitors.visitors || 0).toLocaleString()}명 · 전환 ${visitors.conversions || 0}건`
    : '· 방문자/전환: 수집 중 (PostHog 키 미설정 — 봇 로컬)',
  '',
  `📥 결정 대기: ${decisions.total}건${decisions.total ? ' (cocotripkr.com/admin/decisions)' : ' ✅'}`,
  ...(decisions.top && decisions.top.length ? decisions.top.map((d) => `   - ${d.title}`) : []),
  '',
  `📦 DB: 전체 플랜 ${totalPlans}건 · 환율 ₩${rate.toLocaleString()}/$`,
];
console.log(out.join('\n'));
process.exit(0);
