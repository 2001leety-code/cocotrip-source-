// Vercel serverless function — server-side PDF generation via Puppeteer + Chromium.
// Replaces client html2canvas pipeline 5대 root cause:
//   1. CJK 폰트 timing: 서버 컨테이너에 Noto Sans 사전 로드 → 100% 보장
//   2. scrollHeight > 12000px: Chromium은 메모리 1GB+ → 수십 페이지 OK
//   3. 모바일 OOM: 클라이언트 메모리 무관
//   4. 이미지 CORS: 서버에서 직접 fetch
//   5. iOS 백그라운드 throttle: 서버는 throttle 없음
//
// Auth: Firebase ID token으로 plan 소유자만 접근 (다른 사람 plan PDF 생성 차단).
// Vercel Pro 플랜 한정 — Hobby의 50MB function size 제한으로 Chromium 안 들어감.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { Buffer } from 'buffer';
import { initAdminDb } from '../_shared/firebase-admin.js';
import { sendErrorAlert } from '../_telegram.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
// PR #421 (CZ2): consolidate escapeHtml — same impl as the inline one below,
// now sourced from api/_shared/escape.js to share with _send-email.js etc.
import { escapeHtml } from '../_shared/escape.js';

// 일반 사용자 ID token 검증 (admin 비교 X — 본인 plan 소유자만 통과)
// firebase-admin.js의 initAdminDb를 재사용해 multi-source env credential 지원:
//   - FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (개별)
//   - GOOGLE_SERVICE_ACCOUNT_KEY (base64 encoded JSON, fallback)
// 한 가지만 설정돼 있어도 Firebase Admin SDK 초기화 가능.
async function verifyUserToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m) return { ok: false, status: 401, error: 'Bearer token required' };
  try {
    // initAdminDb 호출로 firebase-admin app init (Firestore + Auth 공유)
    const db = initAdminDb('pdf-auth');
    if (!db) {
      return { ok: false, status: 500, error: 'Firebase Admin SDK init failed — check FIREBASE_* / GOOGLE_SERVICE_ACCOUNT_KEY env vars' };
    }
    const { getAuth } = await import('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(m[1], true);
    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch (err) {
    return { ok: false, status: 401, error: `Token verification failed: ${err.code || err.message}` };
  }
}

export const config = {
  // Vercel Pro: 최대 60초. cold start 5-10s + render 10-30s + output 5s
  maxDuration: 60,
  // memory 설정은 Active CPU billing에서 무시됨 (Vercel 2025 변경) — 자동 할당.
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // === Auth: Firebase ID token으로 사용자 식별 ===
  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: 'unauthorized', detail: auth.error });
  }
  const uid = auth.uid;

  // === Plan ID 검증 ===
  const { planId } = req.body || {};
  if (!planId || typeof planId !== 'string') {
    return res.status(400).json({ error: 'invalid_plan_id' });
  }

  // === Firestore에서 plan 가져오기 + 소유권 검증 ===
  let plan;
  try {
    const db = initAdminDb();
    const doc = await db.collection('plans').doc(planId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'plan_not_found' });
    }
    plan = doc.data();
    if (plan.userId !== uid && plan.uid !== uid) {
      return res.status(403).json({ error: 'forbidden', detail: 'Plan owned by another user' });
    }
  } catch (e) {
    console.error('[PDF] Firestore fetch failed:', e);
    // K Tier 2-E (PR #266) — throttled. Firestore 일시 장애 시 dedup.
    throttledTelegramAlert({
      key: 'pdf-generate-firestore',
      channel: 'error',
      message: `🔴 [pdf-generate] Firestore fetch 실패: ${e.message || 'unknown'}`,
      severity: 'high',
      context: { errorMessage: (e.message || '').slice(0, 200) },
    }).catch(() => {});
    return res.status(500).json({ error: 'firestore_error', detail: e.message });
  }

  // === P207: 빈 plan 검증 — Puppeteer 호출 전 Guard ===
  // 5/26 시각 검증: days=0 plan 도 "성공" PDF 생성 (16KB / "Your Korea Itinerary"만). 결제 사용자 충격.
  // deep-search: reports/visual-2026-05-26/deepsearch-p207.md — 422 선택 근거 + Puppeteer 커뮤니티 패턴.
  const _daysArr = plan?.itinerary?.days;
  const _isStreaming = plan?._streaming_in_progress === true;
  if (!Array.isArray(_daysArr) || _daysArr.length === 0) {
    const reason = _isStreaming ? 'streaming_in_progress' : 'itinerary_empty';
    const detail = _isStreaming
      ? 'Plan is still being generated — retry after streaming completes'
      : 'Plan itinerary has no days — cannot generate PDF';
    console.warn(`[PDF P207] 빈 plan guard 발동: planId=${planId} reason=${reason}`);
    throttledTelegramAlert({
      key: `pdf-generate-empty-plan-${planId}`,
      channel: 'error',
      message: `🟡 [pdf-generate P207] 빈 plan PDF 요청 차단: planId=${planId} reason=${reason}`,
      severity: 'medium',
      context: { planId, reason, isStreaming: _isStreaming },
    }).catch(() => {});
    return res.status(422).json({
      error: 'plan_not_ready',
      reason,
      detail,
      streaming: _isStreaming,
    });
  }

  // === Puppeteer + @sparticuz/chromium 으로 PDF 생성 ===
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      defaultViewport: { width: 800, height: 1200, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    // HTML 템플릿 — 클라이언트 pdfGenerator.ts와 동일한 구조 (간소화).
    // 추후 별도 모듈로 추출해 클라이언트/서버 공유 (Phase 3 후속).
    const html = buildPlanHtml(plan);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // 폰트 로드 대기 — Chromium 컨테이너에 Noto Sans 사전 설치되어 있어 빠름
    await page.evaluateHandle('document.fonts.ready');

    const pdfRaw = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
      preferCSSPageSize: false,
    });

    await browser.close();
    browser = null;

    // P99 (2026-05-19): Puppeteer 21+ `page.pdf()` returns `Uint8Array`
    // (not Buffer). Vercel serverless `res.send(Uint8Array)` 는 그 객체를
    // JSON-serialize 해서 `{"0":37,"1":80,...}` 응답 → content-type 은
    // PDF 인데 body 는 JSON → 사용자 다운로드 파일 PDF reader 에서 안 열림.
    // 명시적 `Buffer.from()` + `res.end()` (lower-level binary) 로 raw bytes
    // 응답 강제. PDF magic bytes `%PDF-` (37 80 68 70 45) 그대로 binary 전송.
    const pdfBuffer = Buffer.from(pdfRaw);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cocotrip-${planId}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.statusCode = 200;
    return res.end(pdfBuffer);
  } catch (e) {
    console.error('[PDF] generation failed:', e);
    // K Tier 2-E (PR #266) — throttled. Puppeteer 일시 장애 시 dedup.
    throttledTelegramAlert({
      key: 'pdf-generate-puppeteer',
      channel: 'error',
      message: `🔴 [pdf-generate] Puppeteer 실패: ${e.message || 'unknown'}`,
      severity: 'high',
      context: { errorMessage: (e.message || '').slice(0, 200) },
    }).catch(() => {});
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    return res.status(500).json({ error: 'pdf_generation_failed', detail: e.message });
  }
}

// === Plan → HTML 변환 ===
// 클라이언트 pdfGenerator.ts의 HTML build 로직을 단순화한 server-side 버전.
// P208 (2026-05-26): @sparticuz/chromium v147 = Open Sans 1개만 번들
//   (CJK 자동 fallback 없음 — 기존 주석이 거짓). fonts/ 디렉토리 OTF 직접 번들.
// P209 (2026-05-26): arrival_guide + departure_guide 섹션 추가 (Pattern A Pure HTML Port).
//   charter cross-sell 광고 카드 제외 (server PDF는 핵심 가이드만).
//   escapeHtml 모든 동적 텍스트 적용 (XSS 방어).
// 추후 shared module로 통합 권장 (Phase 3 — Pattern C api/_shared/pdf-sections.js).
function buildPlanHtml(plan) {
  const it = plan.itinerary || {};
  const days = it.days || [];
  const input = plan.input || {};
  const arrival = it.arrival_guide || null;
  const departure = it.departure_guide || null;

  // P209: 색상 팔레트 (client pdfGenerator.ts의 C 객체 동등)
  const C = {
    accent: '#7C5CFC',
    pink: '#EA536E',
    heading: '#1a1a2e',
    sub: '#555',
    muted: '#888',
    cardBg: '#f8f9fc',
    border: '#e0e0e0',
  };

  // P209: formatKRW 헬퍼 (client와 동일)
  function formatKRW(n) {
    if (!n || typeof n !== 'number') return '₩0';
    return '₩' + n.toLocaleString('ko-KR');
  }

  // P208: @sparticuz/chromium 에 CJK 폰트 없음 → file:// URL 로 직접 로드.
  // Vercel /var/task = project root → fonts/NotoSansKR-*.otf 번들됨.
  const fontFaceDecl = `
    @font-face {
      font-family: 'Noto Sans KR';
      font-weight: 400;
      font-style: normal;
      src: url('file:///var/task/fonts/NotoSansKR-Regular.otf') format('opentype');
    }
    @font-face {
      font-family: 'Noto Sans KR';
      font-weight: 700;
      font-style: normal;
      src: url('file:///var/task/fonts/NotoSansKR-Bold.otf') format('opentype');
    }
  `;

  const css = `
    ${fontFaceDecl}
    body { font-family: 'Noto Sans KR', system-ui, sans-serif; line-height: 1.6; color: #1a1a2e; padding: 0; margin: 0; }
    .container { padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 26px; color: #7C5CFC; margin: 0 0 6px; text-align: center; }
    h2 { font-size: 18px; color: #1a1a2e; margin: 16px 0 8px; }
    h3 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #7C5CFC; margin-bottom: 28px; }
    .meta { color: #888; font-size: 13px; }
    .day { margin-bottom: 24px; }
    .day-title { background: #f0edff; padding: 10px 14px; border-radius: 8px; font-weight: 700; font-size: 16px; color: #7C5CFC; page-break-inside: avoid; break-inside: avoid; }
    /* 2026-04-28: stop card 페이지 중간 분할 차단 (사용자 신고: 17:43 카드 잘림). */
    .stop { padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px; margin-top: 8px; background: #f8f9fc; page-break-inside: avoid; break-inside: avoid; }
    .stop-time { font-weight: 700; color: #7C5CFC; font-size: 14px; }
    .stop-name { font-weight: 700; font-size: 15px; margin: 2px 0; }
    .stop-desc { font-size: 13px; color: #555; }
    .stop-tip { font-size: 12px; color: #888; font-style: italic; margin-top: 4px; }
    /* P209: arrival/departure guide 섹션 카드 스타일 */
    .guide-card { background: #f8f9fc; border: 1px solid #e0e0e0; border-radius: 10px; padding: 16px; margin-bottom: 20px; page-break-inside: avoid; break-inside: avoid; }
    .guide-step { margin: 6px 0; padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
    .guide-hero { border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #888; }
  `;

  let body = `<div class="container">`;
  body += `<div class="header">
    <h1>${escapeHtml(it.tour_title || 'Your Korea Itinerary')}</h1>
    <p class="meta">${escapeHtml(input.startDate || '')} | ${input.adults || input.pax || '-'} pax</p>
    <p class="meta">Generated by CocoTrip AI · cocotripkr.com</p>
  </div>`;

  // ── P209: Arrival Guide 섹션 ─────────────────────────────────────────────────
  // client pdfGenerator.ts L484-573 의 Pure HTML Port.
  // charter cross-sell 카드 (cocotrip_charter) 제외 — server PDF 핵심만.
  // 위치: header 와 days loop 사이 (입국 가이드가 일정 전에 나와야 함).
  if (arrival && arrival.steps) {
    const route = arrival.route_to_hotel || null;
    const rec = route && route.recommended_option ? route.recommended_option : null;

    body += `<div class="guide-card" style="border-color:${C.accent};">
      <h3 style="color:${C.accent};">✈ Arrival Guide — ${escapeHtml(arrival.airport || '')}</h3>`;

    // Hero: transit 추천 카드 (charter cross-sell 제외)
    if (rec && rec.key !== 'cocotrip_charter' && route) {
      const TRANSIT_LABELS = {
        arex_express: 'AREX Express',
        arex_all_stop: 'AREX All Stop',
        limousine_bus: 'Limousine Bus',
      };
      const recLabel = TRANSIT_LABELS[rec.key] || rec.key;
      const estMin = (route.est_min || 0) > 0 ? ` · ~${route.est_min} min` : '';
      const estFare = route.est_fare_krw ? ` · ${formatKRW(route.est_fare_krw)}` : '';
      const transfers = route.transfers ? ` · ${route.transfers} transfer` : '';
      const recReason = rec.reason_en || rec.reason_ko || '';

      body += `<div class="guide-hero" style="background:linear-gradient(135deg,rgba(124,92,252,0.10),rgba(234,83,126,0.06));border:1px solid ${C.accent};">
        <p style="font-size:9px;font-weight:700;color:#FBBC05;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">★ Recommended</p>
        <p style="font-size:13px;font-weight:700;color:${C.heading};margin:0 0 2px;">${escapeHtml(recLabel)}</p>
        <p style="font-size:10px;color:${C.muted};margin:0 0 6px;">${escapeHtml(estMin + estFare + transfers)}</p>
        ${recReason ? `<p style="font-size:10px;color:${C.sub};margin:0;">💡 ${escapeHtml(recReason)}</p>` : ''}
      </div>`;
    }

    // Steps loop
    const steps = Array.isArray(arrival.steps) ? arrival.steps : [];
    for (const step of steps) {
      body += `<div class="guide-step">
        <p style="font-size:12px;color:${C.heading};margin:0;"><strong>Step ${step.step || ''}: ${escapeHtml(step.title || '')}</strong></p>
        ${step.description ? `<p style="font-size:11px;color:${C.sub};margin:2px 0 0;">${escapeHtml(step.description)}</p>` : ''}
        ${(step.est_min || 0) > 0 ? `<p style="font-size:10px;color:${C.accent};margin:2px 0 0;">~${step.est_min} min</p>` : ''}`;

      // Sub-options (SIM/Wi-Fi 등)
      if (step.options && step.options.length > 0) {
        body += `<div style="margin-top:6px;">`;
        for (const opt of step.options) {
          body += `<table style="width:100%;font-size:10px;color:${C.sub};margin:2px 0;"><tr><td>· ${escapeHtml(opt.name || '')}</td><td style="text-align:right;"><strong style="color:${C.accent};">${formatKRW(opt.price_krw || 0)}</strong></td></tr></table>`;
        }
        body += `</div>`;
      }

      // transport_to_hotel 비교표 (Step 5)
      if (step.transport_to_hotel) {
        const TRANSPORT_LABELS = {
          arex_express: 'AREX Express',
          arex_all_stop: 'AREX All Stop',
          limousine_bus: 'Limousine Bus',
          taxi: 'Taxi',
        };
        const opts = Object.entries(step.transport_to_hotel).filter(([, v]) => v != null);
        if (opts.length > 0) {
          body += `<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:10px;">`;
          for (const [key, val] of opts) {
            const isRec = rec && rec.key === key;
            const bg = isRec ? '#fff8e0' : '#fff';
            const labelText = TRANSPORT_LABELS[key] || key.replace(/_/g, ' ');
            body += `<tr style="background:${bg};border-bottom:1px solid ${C.border};">
              <td style="padding:4px 6px;${isRec ? 'font-weight:700;color:#B45309;' : 'color:' + C.heading + ';'}">${isRec ? '★ ' : ''}${escapeHtml(labelText)}</td>
              <td style="padding:4px 6px;text-align:right;color:${C.heading};font-weight:600;">${formatKRW((val && val.price_krw) || (val && val.est_price_krw) || 0)}</td>
              <td style="padding:4px 6px;text-align:right;color:${C.muted};">${(val && val.duration_min) || '?'} min</td>
            </tr>`;
          }
          body += `</table>`;
        }
      }

      // T-money load chip
      if ((step.t_money_recommended_load_krw || 0) > 0) {
        body += `<p style="font-size:10px;color:${C.accent};margin:6px 0 0;background:rgba(124,92,252,0.08);border:1px solid ${C.accent};border-radius:4px;padding:4px 8px;display:inline-block;font-weight:700;">💳 Load ${formatKRW(step.t_money_recommended_load_krw)}</p>`;
      }

      body += `</div>`;
    }

    body += `</div>`;
  }

  // ── Days loop ────────────────────────────────────────────────────────────────
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    body += `<div class="day"><div class="day-title">Day ${day.day || di + 1}: ${escapeHtml(day.theme || '')}</div>`;
    const stops = day.stops || [];
    for (const stop of stops) {
      const name = stop.display_name || stop.name || stop.name_ko || stop.name_en || '';
      body += `<div class="stop">
        <div class="stop-time">${escapeHtml(stop.time || stop.start_time || '')}</div>
        <div class="stop-name">${escapeHtml(name)}</div>
        ${stop.description ? `<div class="stop-desc">${escapeHtml(stop.description)}</div>` : ''}
        ${stop.tip ? `<div class="stop-tip">Tip: ${escapeHtml(stop.tip)}</div>` : ''}
      </div>`;
    }
    body += `</div>`;
  }

  // ── P209: Departure Guide 섹션 ──────────────────────────────────────────────
  // client pdfGenerator.ts L1030-1066 의 Pure HTML Port.
  // 위치: days loop 후 + footer 전.
  if (departure) {
    const depRoute = departure.route_to_airport || null;

    body += `<div class="guide-card" style="border-color:${C.pink};">
      <h3 style="color:${C.pink};">✈ Departure Guide — ${escapeHtml(departure.airport || '')}</h3>`;

    // Hero: ODsay route hotel→airport (우선)
    if (depRoute) {
      const depMin = (depRoute.est_min || 0) > 0 ? `~${depRoute.est_min} min` : '';
      const depFare = depRoute.est_fare_krw ? ` · ${formatKRW(depRoute.est_fare_krw)}` : '';
      const depTransfers = depRoute.transfers ? ` · ${depRoute.transfers} transfer` : '';

      body += `<div class="guide-hero" style="background:linear-gradient(135deg,rgba(234,83,126,0.10),rgba(251,146,60,0.06));border:1px solid ${C.pink};">
        <p style="font-size:12px;font-weight:700;color:${C.pink};margin:0 0 2px;">To Airport</p>
        <p style="font-size:10px;color:${C.muted};margin:0 0 6px;">${escapeHtml(depMin + depFare + depTransfers)}</p>`;

      // Step-by-step
      const stepsArr = Array.isArray(depRoute.step_by_step) ? depRoute.step_by_step : [];
      for (const s of stepsArr) {
        body += `<p style="font-size:10px;color:${C.sub};margin:1px 0 0 8px;">· ${escapeHtml(String(s))}</p>`;
      }
      body += `</div>`;
    }

    // Fallback: simple to_airport 1-liner (ODsay route 없을 때)
    if (!depRoute && departure.to_airport) {
      const ta = departure.to_airport;
      body += `<p style="font-size:11px;color:${C.sub};margin:0 0 6px;">${escapeHtml(ta.method || '')} · ${escapeHtml(ta.instruction || '')} (${ta.duration_min || '?'} min, ${formatKRW(ta.cost_krw || 0)})</p>`;
    }

    // Tip cards: luggage storage / tax refund / last-minute shopping
    if (departure.luggage_storage && departure.luggage_storage.available) {
      body += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;"><strong>🧳 Luggage Storage:</strong> ${escapeHtml(departure.luggage_storage.location || '')}</p>`;
    }
    if (departure.tax_refund) {
      const threshold = departure.tax_refund.threshold_krw || 30000;
      body += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;"><strong>💰 Tax Refund:</strong> ${escapeHtml(departure.tax_refund.location || '')} (Min. ${formatKRW(threshold)})</p>`;
    }
    if (departure.last_minute_shopping) {
      body += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;"><strong>🛒 Last-minute shopping:</strong> ${escapeHtml(String(departure.last_minute_shopping))}</p>`;
    }

    body += `</div>`;
  }

  body += `<div class="footer">CocoTrip · cocotripkr.com · WhatsApp: +82-10-8714-0611</div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

// escapeHtml moved to api/_shared/escape.js (PR #421 CZ2).
