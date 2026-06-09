/**
 * CocoTripKR — 일일 모닝 리포트 (Vercel Cron)
 *
 * 매일 오전 7:00 KST (= UTC 22:00 전날) 실행
 *
 * 데이터 소스:
 *  - Firestore api_stats → 카운터 (배포 후부터 카운트)
 *  - Google Sheets → 예약 매출
 *  - Exchange Rate API → 환율
 */

import { getYesterdayBookings, getTodayTours, getWeekSummary } from '../_google-sheets.js';
import { sendLongMessage, sendErrorAlert } from '../_telegram.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { USD_TO_KRW } from '../_shared/exchange-rate.js';

// ── API 가격 정보 (2026-04 기준) ─────────────────────────────────────
const PRICING = {
  gemini: {
    freeRPD: 1500,              // 무료 한도: 1,500 requests/day
    freeRPM: 15,                // 15 requests/분
    inputPer1M:  0.15,          // $0.15 / 1M input tokens
    outputPer1M: 0.60,          // $0.60 / 1M output tokens
    thinkPer1M:  0.70,          // $0.70 / 1M thinking tokens
    // 호출당 평균 토큰 추정
    quickTokens: { input: 500, output: 2000, think: 0 },
    fullTokens:  { input: 3000, output: 20000, think: 1000 },
  },
  naver: { note: '대표계정 무료 (월 단위)', costPerCall: 0 },
  odsay: { note: '개인/스타트업 무료 (일 단위)', costPerCall: 0 },
};

// Gemini 호출당 비용 계산
function geminiCostPerCall(type) {
  const t = type === 'quick' ? PRICING.gemini.quickTokens : PRICING.gemini.fullTokens;
  return (t.input / 1e6 * PRICING.gemini.inputPer1M) +
         (t.output / 1e6 * PRICING.gemini.outputPer1M) +
         (t.think / 1e6 * PRICING.gemini.thinkPer1M);
}

// ── Firebase Admin 초기화 ────────────────────────────────────────────
async function getFirestoreAdmin() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    let credential = null;
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
    let rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();

    if (projectId && clientEmail && rawKey) {
      const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
      if (pemMatch) {
        const b = pemMatch[1].replace(/\s+/g, '');
        rawKey = '-----BEGIN PRIVATE KEY-----\n' + (b.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n';
      }
      credential = cert({ projectId, clientEmail, privateKey: rawKey });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      credential = cert(JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8')));
    }

    if (!credential) return null;
    initializeApp({ credential });
  }
  return getFirestore();
}

// ── 환율 (공통 유틸 사용 — 메타데이터 포함) ──────────────────────────
async function getUSDKRWRate() {
  try {
    const { getExchangeRate } = await import('../_exchange-rate.js');
    const info = await getExchangeRate();
    return {
      rate: info.krwPerUsd,
      source: info.source,
      fetchedAt: info.fetchedAt,
    };
  } catch (e) {
    console.warn('[daily-report] exchange rate fetch failed:', e.message);
    return { rate: USD_TO_KRW, source: 'fallback-hardcoded', fetchedAt: new Date() };
  }
}

// 환율 갱신 시각 → 한국어 상대 표현 ("6시간 전", "방금 전")
function describeFetchedAge(fetchedAt) {
  if (!fetchedAt) return '시각 미상';
  const diffMs = Date.now() - new Date(fetchedAt).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return '방금 전 갱신';
  if (diffMin < 60) return `${diffMin}분 전 갱신`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전 갱신`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}일 전 갱신`;
}

// ── Firestore 카운터 읽기 ────────────────────────────────────────────
async function getApiStats(db) {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthKey = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}`;
  const yesterday = new Date(kst); yesterday.setDate(yesterday.getDate() - 1);
  const dayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const s = {
    yesterday: { quick: 0, full: 0, fullRevenue: 0, chat: 0 },
    month:     { quick: 0, full: 0, fullRevenue: 0, chat: 0 },
    totalUsers: 0, totalPlans: 0,
  };

  try {
    const mDoc = await db.collection('api_stats').doc(monthKey).get();
    if (mDoc.exists) { const m = mDoc.data(); s.month = { quick: m.quickCount||0, full: m.fullCount||0, fullRevenue: m.fullRevenue||0, chat: m.chatCount||0 }; }

    const dDoc = await db.collection('api_stats').doc(monthKey).collection('daily').doc(dayKey).get();
    if (dDoc.exists) { const d = dDoc.data(); s.yesterday = { quick: d.quickCount||0, full: d.fullCount||0, fullRevenue: d.fullRevenue||0, chat: d.chatCount||0 }; }

    try { s.totalUsers = (await db.collection('users').count().get()).data().count || 0; } catch {}
    try { s.totalPlans = (await db.collection('plans').count().get()).data().count || 0; } catch {}
  } catch (e) { console.warn('[daily-report] Firestore error:', e.message); }

  return s;
}

// ── 상품별 집계 ──────────────────────────────────────────────────────
function aggregateByProduct(rows) {
  const p = { '픽업': { c: 0, u: 0 }, '전세': { c: 0, u: 0 }, '셔틀': { c: 0, u: 0 }, 'AI': { c: 0, u: 0 } };
  rows.forEach(r => {
    const prod = r[4] || '', amt = parseFloat(r[10]) || 0;
    if (prod.match(/픽업|pickup/i)) { p['픽업'].c++; p['픽업'].u += amt; }
    else if (prod.match(/셔틀|shuttle/i)) { p['셔틀'].c++; p['셔틀'].u += amt; }
    else if (prod.match(/planner|ai/i)) { p['AI'].c++; p['AI'].u += amt; }
    else { p['전세'].c++; p['전세'].u += amt; }
  });
  return p;
}

// ── 메인 ─────────────────────────────────────────────────────────────
const dailyReportTask = async () => {
  console.log('[daily-report] 모닝 리포트 시작');
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const dayName = ['일','월','화','수','목','금','토'][kst.getDay()];
  const monthStr = kst.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });

  try {
    const db = await getFirestoreAdmin();
    const [yRows, tTours, wSum, rateInfo, fs] = await Promise.allSettled([
      getYesterdayBookings(), getTodayTours(), getWeekSummary(), getUSDKRWRate(),
      db ? getApiStats(db) : Promise.resolve(null),
    ]);

    const yesterday = yRows.status === 'fulfilled' ? yRows.value : [];
    const today = tTours.status === 'fulfilled' ? tTours.value : [];
    const week = wSum.status === 'fulfilled' ? wSum.value : { totalUSD: 0, count: 0 };
    const rate = rateInfo.status === 'fulfilled' ? rateInfo.value : { rate: USD_TO_KRW, source: 'fallback-hardcoded', fetchedAt: new Date() };
    const f = fs.status === 'fulfilled' ? fs.value : null;

    const totalUSD = yesterday.reduce((s, r) => s + (parseFloat(r[10]) || 0), 0);
    const totalKRW = Math.round(totalUSD * rate.rate);
    const bp = aggregateByProduct(yesterday);

    const todayList = today.length > 0
      ? today.map((r, i) => `  ${i+1}. ${r[5]||'-'} | ${r[1]||'-'} | ${r[4]||'-'} | ${r[8]||'-'}명`).join('\n')
      : '  📭 없음';

    // ── 메시지 조립 ──
    let msg = `☀️ <b>코코트립 모닝 리포트</b>\n📅 ${dateStr} (${dayName}) 오전 7:00`;

    if (f) {
      // ── 어제 AI 플래너 ──
      const yTotal = f.yesterday.quick + f.yesterday.full + f.yesterday.chat;
      const AI_FEE_USD = 9.90; // AI 플래너 정책가(launch promo, KRW 13,300. 쿠폰 불가라 고정). priceUSD=추정 여행가와 별개.
      msg += `\n\n━━━ 🤖 AI 플래너 (어제) ━━━`;
      msg += `\n🆓 무료 Quick: <b>${f.yesterday.quick}회</b>`;
      msg += `\n💰 유료 Full: <b>${f.yesterday.full}건</b> (수수료 $${(f.yesterday.full * AI_FEE_USD).toFixed(2)})`;
      msg += `\n💬 채팅: <b>${f.yesterday.chat}회</b>`;
      msg += `\n📊 Gemini 총 호출: ${yTotal}회 / 1,500회 무료한도 (${((yTotal/1500)*100).toFixed(1)}%)`;

      // ── 무료한도 경고 ──
      if (yTotal > 1200) {
        msg += `\n\n⚠️ <b>주의: 어제 Gemini 무료한도 ${((yTotal/1500)*100).toFixed(0)}% 소진!</b>`;
        msg += `\n→ 1,500회 초과 시 유료 전환됩니다`;
      }

      // ── 이번달 누적 ──
      const mTotal = f.month.quick + f.month.full + f.month.chat;
      const convRate = (f.month.quick + f.month.full) > 0 ? ((f.month.full / (f.month.quick + f.month.full)) * 100).toFixed(1) : '0.0';

      // 비용 계산: 1,500회/일 무료 → 초과분만 과금
      const daysInMonth = new Date(kst.getFullYear(), kst.getMonth() + 1, 0).getDate();
      const daysPassed = kst.getDate();
      const totalFreeQuota = daysPassed * PRICING.gemini.freeRPD; // 이번달까지 총 무료 한도
      const overQuota = Math.max(0, mTotal - totalFreeQuota);
      
      // 초과분 비용
      const overCostQuick = overQuota > 0 ? Math.min(overQuota, f.month.quick) * geminiCostPerCall('quick') : 0;
      const overCostFull = overQuota > 0 ? Math.min(overQuota, f.month.full) * geminiCostPerCall('full') : 0;
      const geminiActualCost = overCostQuick + overCostFull;

      // 만약 전부 무료 한도 내라면
      const geminiEstCost = (f.month.quick * geminiCostPerCall('quick')) + (f.month.full * geminiCostPerCall('full'));

      msg += `\n\n━━━ 📊 ${monthStr} 누적 ━━━`;
      msg += `\n🆓 무료 Quick: <b>${f.month.quick}회</b>`;
      msg += `\n💰 유료 Full: <b>${f.month.full}건</b>`;
      msg += `\n💬 채팅: <b>${f.month.chat}회</b>`;
      const aiFeeRevenue = f.month.full * AI_FEE_USD;
      msg += `\n💵 AI 플래너 매출(실수령): <b>$${aiFeeRevenue.toFixed(2)}</b> (₩${Math.round(aiFeeRevenue * rate.rate).toLocaleString()}) · ${f.month.full}건×$${AI_FEE_USD}`;
      msg += `\n💎 플랜 추정 여행가치: $${f.month.fullRevenue.toFixed(2)} (참고용 · 실매출 아님)`;
      msg += `\n📈 전환율: <b>${convRate}%</b> (무료→유료)`;

      // ── API 비용 ──
      msg += `\n\n━━━ 💸 API 비용 (${monthStr}) ━━━`;
      msg += `\n📍 Gemini 총 호출: ${mTotal}회`;
      msg += `\n📍 무료 한도: ${totalFreeQuota.toLocaleString()}회 (${daysPassed}일 × 1,500회/일)`;
      
      if (overQuota > 0) {
        msg += `\n⚠️ <b>초과분: ${overQuota}회 → 예상 과금 $${geminiActualCost.toFixed(3)}</b>`;
      } else {
        msg += `\n✅ <b>무료 한도 내 (과금 $0)</b>`;
        msg += `\n   (유료였다면 ~$${geminiEstCost.toFixed(3)})`;
      }
      msg += `\nNaver Maps / ODsay: 무료`;

      // ── 순이익 ──
      const profit = aiFeeRevenue - geminiActualCost;
      msg += `\n\n💰 <b>AI 순이익(수수료-API): $${profit.toFixed(2)} (₩${Math.round(profit * rate.rate).toLocaleString()})</b>`;
      // (호출당 Gemini 단가 섹션 제거 2026-06-09 — 매일 볼 정보 아님, 리포트 슬림화)
    } else {
      msg += `\n\n⚠️ Firestore 연결 안 됨`;
    }

    // ── 예약 매출 ──
    msg += `\n\n━━━ 📋 어제 예약 매출 ━━━`;
    msg += `\n건수: ${yesterday.length}건 | 매출: <b>$${totalUSD.toFixed(2)}</b> (₩${totalKRW.toLocaleString()})`;
    msg += `\n  🚐 픽업 ${bp['픽업'].c}건 $${bp['픽업'].u.toFixed(2)}`;
    msg += `\n  🚗 전세 ${bp['전세'].c}건 $${bp['전세'].u.toFixed(2)}`;
    msg += `\n  🚌 셔틀 ${bp['셔틀'].c}건 $${bp['셔틀'].u.toFixed(2)}`;
    msg += `\n  🤖 AI ${bp['AI'].c}건 $${bp['AI'].u.toFixed(2)}`;

    // ── 오늘 일정 + 주간 ──
    msg += `\n\n━━━ 🗓 오늘 투어 ━━━\n${todayList}`;
    msg += `\n\n💱 환율: ₩${Math.round(rate.rate).toLocaleString()} / $1 (출처: ${rate.source} · ${describeFetchedAge(rate.fetchedAt)})`;
    msg += `\n📈 이번주: <b>$${week.totalUSD}</b> (${week.count}건)`;

    if (f) {
      msg += `\n👥 회원: ${f.totalUsers}명 | 플랜: ${f.totalPlans}개`;
    }

    msg += `\n\n🌐 cocotripkr.com`;

    await sendLongMessage(msg);
    console.log('[daily-report] 전송 완료');
    return { statusCode: 200, body: '모닝 리포트 전송 완료' };
  } catch (err) {
    console.error('[daily-report] 오류:', err.message);
    // K Tier 2-E (PR #266) — throttled. cron 반복 실패 시 dedup.
    throttledTelegramAlert({
      key: 'daily-report-fail',
      channel: 'error',
      message: `🔴 [daily-report] cron 실패: ${err.message || 'unknown'}`,
      severity: 'medium',
      context: { errorMessage: (err.message || '').slice(0, 200) },
    }).catch(() => {});
    return { statusCode: 500, body: err.message };
  }
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const r = await dailyReportTask();
    return res.status(r.statusCode || 200).json(r);
  } catch (e) { return res.status(500).json({ error: e.message }); }
}