/**
 * CocoTripKR — 일일 매출 리포트 (스케줄 함수)
 *
 * 매일 오전 7:00 KST (= UTC 22:00 전날) 실행
 * Netlify Scheduled Functions 사용
 *
 * 실행 내용:
 *  1. Google Sheets에서 어제 예약 데이터 읽기
 *  2. 이번 주 누적 매출 계산
 *  3. 오늘 투어 일정 확인
 *  4. 환율 조회
 *  5. Gemini 1호 → 리포트 메시지 생성
 *  6. 텔레그램 → 태연님께 전송
 *
 * CONTEXT: CocoTripKR 자동화 스케줄 함수
 * SCHEDULE: 0 22 * * * (UTC) = 매일 KST 07:00
 */

import { getYesterdayBookings, getTodayTours, getWeekSummary } from '../_google-sheets.js';
import { sendLongMessage, sendErrorAlert } from '../_telegram.js';
import { generateDailyReport } from '../_ai-employees.js';

// ── 환율 조회 ─────────────────────────────────────────────────────────
async function getUSDKRWRate() {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    const rate = data.rates?.KRW || 1380;
    const prevRate = 1380; // 전일 기준 (실제로는 Sheets에 저장하거나 다른 API 사용)
    return { rate, change: (((rate - prevRate) / prevRate) * 100).toFixed(2) };
  } catch {
    return { rate: 1380, change: '0.00' };
  }
}

// ── 예약 행 → 상품별 집계 ────────────────────────────────────────────
function aggregateByProduct(rows) {
  const byProduct = {
    '공항 픽업':  { count: 0, totalUSD: 0 },
    '전세차량':   { count: 0, totalUSD: 0 },
    '셔틀':       { count: 0, totalUSD: 0 },
  };

  rows.forEach((row) => {
    const product = row[4] || '';
    const amount  = parseFloat(row[10]) || 0;

    if (product.includes('픽업') || product.includes('pickup') || product.includes('Pickup')) {
      byProduct['공항 픽업'].count += 1;
      byProduct['공항 픽업'].totalUSD += amount;
    } else if (product.includes('셔틀') || product.includes('shuttle') || product.includes('Shuttle')) {
      byProduct['셔틀'].count += 1;
      byProduct['셔틀'].totalUSD += amount;
    } else {
      byProduct['전세차량'].count += 1;
      byProduct['전세차량'].totalUSD += amount;
    }
  });

  return byProduct;
}

// ── 핸들러 ────────────────────────────────────────────────────────────
const dailyReportTask = async () => {
  console.log('[daily-report] 일일 리포트 생성 시작');

  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kstNow.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  try {
    // 병렬로 데이터 수집
    const [yesterdayRows, todayTours, weekSummary, rateInfo] = await Promise.allSettled([
      getYesterdayBookings(),
      getTodayTours(),
      getWeekSummary(),
      getUSDKRWRate(),
    ]);

    const yesterday = yesterdayRows.status === 'fulfilled' ? yesterdayRows.value : [];
    const today     = todayTours.status    === 'fulfilled' ? todayTours.value    : [];
    const week      = weekSummary.status   === 'fulfilled' ? weekSummary.value   : { totalUSD: 0, count: 0 };
    const rate      = rateInfo.status      === 'fulfilled' ? rateInfo.value      : { rate: 1380, change: '0.00' };

    const totalUSD = yesterday.reduce((sum, row) => sum + (parseFloat(row[10]) || 0), 0);
    const totalKRW = Math.round(totalUSD * rate.rate);
    const byProduct = aggregateByProduct(yesterday);

    // 오늘 일정 텍스트 생성
    const todayBookingsList = today.length > 0
      ? today.map((row, i) =>
          `  ${i + 1}. ${row[5] || '-'} | ${row[1] || '-'} | ${row[4] || '-'} | ${row[8] || '-'}명`
        ).join('\n')
      : '  오늘 예약 없음';

    const reportData = {
      date: dateStr,
      yesterday: {
        count: yesterday.length,
        totalUSD: totalUSD.toFixed(2),
        totalKRW: totalKRW.toLocaleString(),
        byProduct,
      },
      todaySchedule: todayBookingsList,
      rate: {
        usdkrw: rate.rate,
        change: rate.change,
      },
      weekTotal: {
        totalUSD: week.totalUSD,
        count: week.count,
      },
    };

    // Gemini 1호로 리포트 메시지 생성
    let reportMsg;
    try {
      reportMsg = await generateDailyReport(reportData);
    } catch (aiErr) {
      console.warn('[daily-report] AI 리포트 생성 실패, 기본 형식 사용:', aiErr.message);
      // 기본 리포트 형식
      reportMsg = `📊 코코트립 일일 리포트
${dateStr} 오전 7:00

━━━ 어제 매출 ━━━
총 예약: ${yesterday.length}건
총 매출: $${totalUSD.toFixed(2)} USD (₩${totalKRW.toLocaleString()})

상품별:
  공항 픽업: ${byProduct['공항 픽업'].count}건 · $${byProduct['공항 픽업'].totalUSD.toFixed(2)}
  전세차량: ${byProduct['전세차량'].count}건 · $${byProduct['전세차량'].totalUSD.toFixed(2)}
  셔틀: ${byProduct['셔틀'].count}건 · $${byProduct['셔틀'].totalUSD.toFixed(2)}

━━━ 오늘 일정 ━━━
${todayBookingsList}

━━━ 환율 ━━━
USD/KRW: ₩${rate.rate} (${rate.change}%)

━━━ 이번 주 누적 ━━━
총 매출: $${week.totalUSD} USD (${week.count}건)`;
    }

    await sendLongMessage(reportMsg);
    console.log('[daily-report] 리포트 전송 완료');

    return { statusCode: 200, body: 'Daily report sent' };
  } catch (err) {
    console.error('[daily-report] 오류:', err.message);
    try {
      await sendErrorAlert('daily-report', err);
    } catch {}
    return { statusCode: 500, body: err.message };
  }
};

// Netlify Scheduled Function: 매일 UTC 22:00 (KST 07:00)
const originalHandler = dailyReportTask;

// --- Vercel Native Wrapper ---
export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    path: req.url.split('?')[0],
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || ''),
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };
  
  try {
    const result = await originalHandler(event, {});
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
        res.setHeader(key, val);
      }
    }
    if (result && result.statusCode) {
      let finalBody = result.body;
      if (typeof finalBody === 'string') {
        try { finalBody = JSON.parse(finalBody); } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
  