// PDF download generator. LOCKED region — extracted verbatim from
// src/pages/PlanDetailPage.tsx (L155-348) during P2 Lock release.
//
// Critical invariants (do not touch — PDF went blank when we broke these before):
//   1. container position MUST be on-screen (position:absolute; top:0; left:0).
//      Off-screen placement (left:-9999px) or display:none makes html2canvas render blank.
//   2. overlay (z-index:99998) over container (z-index:99997) hides the white sheet from
//      the user while html2canvas draws it.
//   3. CJK font-family fallback chain must stay intact so Korean/Japanese/Chinese glyphs
//      render instead of tofu boxes.
//   4. document.fonts.ready wait + 500ms settle + force reflow are required for first-run
//      font loading (esp. Korean).
//   5. iOS Safari path opens a blob in a new tab (worker.save() is often blocked).
//   6. Template literals stay ASCII-only — do not re-introduce emoji that could mojibake.
import { toast } from 'sonner';
import { formatKRW } from './constants';
import { normalizeRecommendedItem } from '@/types/plan';
import { track as posthogTrack } from '@/lib/posthog';
import type { PlanDocument, PlanDay, PlanStop, BudgetRow } from './types';

// Sprint 1 Step 4 — 카테고리별 카드 좌측 accent bar 색 (web `CAT_COLORS.bar` parity, #136).
// PDF는 dark theme 토큰을 못 쓰므로 web bar gradient의 진한 쪽 hex 만 추출.
const PDF_CATEGORY_BAR: Record<string, string> = {
  food: '#EA580C',
  culture: '#6366F1',
  shopping: '#EC4899',
  nature: '#059669',
  landmark: '#3B82F6',
  kpop: '#C026D3',
  default: '#7C5CFC',
};

function pdfCategoryBar(category: string | undefined): string {
  return PDF_CATEGORY_BAR[category || 'default'] || PDF_CATEGORY_BAR.default;
}

/** Optional i18n labels for PDF — pass planDetail.ui dict for current language */
export interface PdfUiDict {
  generatingPdf?: string;
  pdfDefaultTitle?: string;
  pdfArrivalGuide?: string;
  pdfDepartureGuide?: string;
  pdfBudgetSummary?: string;
  pdfOpenNaverMap?: string;
  pdfTip?: string;
  pdfReservationRequired?: string;
  pdfRecommended?: string;
  pdfFree?: string;
  pdfGeneratedBy?: string;
  budgetDay?: string;
  budgetTransport?: string;
  budgetEntry?: string;
  budgetMeals?: string;
  budgetTotal?: string;
  minUnit?: string;
  [key: string]: string | undefined;
}

/**
 * Phase 3 (2026-04-27): server-side Puppeteer PDF 시도 → 실패 시 client html2pdf fallback.
 * `VITE_USE_SERVER_PDF=true` env로 활성화. plan에 `id` 필요.
 * Firebase ID token으로 인증, plan 소유자만 다운로드 가능.
 */
async function tryServerPdf(plan: PlanDocument): Promise<Blob | null> {
  if (import.meta.env.VITE_USE_SERVER_PDF !== 'true') return null;
  const planId = (plan as { id?: string }).id;
  if (!planId) return null;
  try {
    const { auth } = await import('@/lib/firebase');
    const user = auth.currentUser;
    if (!user) return null;
    const idToken = await user.getIdToken();
    const res = await fetch('/api/pdf/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ planId }),
    });
    if (!res.ok) {
      console.warn('[PDF] server endpoint returned', res.status, '— falling back to client');
      return null;
    }
    const blob = await res.blob();
    if (blob.size < 1024) {
      console.warn('[PDF] server returned blob <1KB — falling back to client');
      return null;
    }
    return blob;
  } catch (e) {
    console.warn('[PDF] server request failed — falling back to client:', e);
    return null;
  }
}

export async function generatePDF(
  plan: PlanDocument,
  uiDict?: PdfUiDict,
  transitDict?: Record<string, string | undefined>,
  lang: string = 'en',
): Promise<void> {
  if (!plan) return;

  const pdfStartTs = Date.now();
  const planIdForTrack = (plan as { id?: string }).id;

  // Phase 3: server-side PDF 우선 시도 (활성화 시). 실패하면 기존 클라이언트 경로로.
  const serverPdf = await tryServerPdf(plan);
  if (serverPdf) {
    const url = URL.createObjectURL(serverPdf);
    const titleSlug = ((plan.itinerary?.tour_title as string) || 'korea-trip')
      .replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'korea-trip';
    const filename = `cocotrip-${titleSlug}-${plan.input?.startDate || 'undated'}.pdf`;
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    console.log('[PDF] server-side generation succeeded');
    void posthogTrack('plan_downloaded', {
      planId: planIdForTrack,
      format: 'pdf-server',
      durationMs: Date.now() - pdfStartTs,
    });
    return;
  }

  // 다국어 concat sanitization — 백엔드 누락 시 display-time 안전망.
  // 사용자 PDF 보고: "Pig Co... 강남 돼지상회 ... 明洞..." 같은 3+ language 누수.
  try {
    const { sanitizeStopName } = await import('@/lib/sanitizeName');
    const lng = (lang as 'ko'|'en'|'ja'|'zh') || 'ko';
    const days = (plan.itinerary?.days as Array<{stops?: Array<Record<string, unknown>>}>) || [];
    for (const day of days) {
      for (const stop of (day.stops || [])) {
        for (const f of ['name', 'display_name']) {
          if (typeof stop[f] === 'string') stop[f] = sanitizeStopName(stop[f] as string, lng);
        }
      }
    }
  } catch (e) { console.warn('[PDF] sanitize fail:', (e as Error).message); }

  const it = plan.itinerary || {};
  const days = it.days || [];
  const arrival = it.arrival_guide;
  const departure = it.departure_guide;
  const budget = it.daily_budget_summary || [];
  const input = plan.input || {};

  // === Sprint 1 Step 4: header QR — 사용자가 모바일로 plan 재방문할 수 있게 ===
  // route: /my-plans/:planId.  plan.id가 없으면 (드물지만 legacy) QR skip.
  // qrcode lib는 dataURL 반환 → <img> 로 그대로 박을 수 있다.
  const planIdForQr = (plan as { id?: string }).id;
  let headerQrDataUrl = '';
  if (planIdForQr) {
    try {
      const QR = (await import('qrcode')).default;
      headerQrDataUrl = await QR.toDataURL(`https://cocotripkr.com/my-plans/${planIdForQr}`, {
        margin: 1,
        width: 200,
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });
    } catch (e) {
      console.warn('[PDF] QR generation failed:', (e as Error).message);
    }
  }

  // create render container - MUST be on-screen & fully expanded for html2canvas
  // Overlay (z-index:99998) sits on top to hide the white container from the user
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99998;background:#0a0e1a;display:flex;align-items:center;justify-content:center;color:white;font-size:18px;font-family:system-ui;';
  const loadingText = uiDict?.generatingPdf || 'Generating PDF...';
  overlay.innerHTML = `<div style="text-align:center"><div style="width:40px;height:40px;border:3px solid #7C5CFC;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px"></div>${loadingText}</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
  document.body.appendChild(overlay);

  const container = document.createElement('div');
  // position:absolute (not fixed) so container can expand beyond viewport height
  // left:0 (not -9999px) so html2canvas can actually render the content
  // CJK fallback chain: Noto Sans (Google Fonts preloaded) -> OS built-in -> generic
  // Noto Sans KR/JP/SC are preloaded in index.html for reliable CJK rendering
  // 2026-05-09 (B9-30): font-display:block 인라인 강제 — index.html 의 stylesheet
  // 가 lazy chunk 로 분리될 가능성 대비. PDF 컨테이너 한정으로 swap 차단.
  container.style.cssText = 'position:absolute;top:0;left:0;width:800px;background:#ffffff;color:#1a1a2e;padding:40px;font-family:"Noto Sans KR","Noto Sans JP","Noto Sans SC","Apple SD Gothic Neo","Malgun Gothic","맑은 고딕","Hiragino Sans","Yu Gothic","Microsoft JhengHei","Microsoft YaHei","Segoe UI",system-ui,sans-serif;font-display:block;line-height:1.6;z-index:99997;';
  document.body.appendChild(container);

  // Color tokens for light PDF
  const C = {
    heading: '#1a1a2e',
    sub: '#555',
    muted: '#888',
    accent: '#7C5CFC',
    pink: '#EA537E',
    border: '#e0e0e0',
    cardBg: '#f8f9fc',
    transitBg: '#f0edff',
    budgetHead: '#7C5CFC',
  };

  // Title
  const L = {
    defaultTitle: uiDict?.pdfDefaultTitle || 'Your Korea Itinerary',
    arrivalGuide: uiDict?.pdfArrivalGuide || 'Airport Arrival Guide',
    departureGuide: uiDict?.pdfDepartureGuide || 'Departure Guide',
    budgetSummary: uiDict?.pdfBudgetSummary || 'Daily Budget Summary',
    openNaverMap: uiDict?.pdfOpenNaverMap || 'Open in Naver Map',
    tip: uiDict?.pdfTip || 'Tip',
    reservation: uiDict?.pdfReservationRequired || 'Reservation required',
    recommended: uiDict?.pdfRecommended || 'Recommended',
    free: uiDict?.pdfFree || 'Free',
    generatedBy: uiDict?.pdfGeneratedBy || 'Generated by CocoTrip AI',
    day: uiDict?.budgetDay || 'Day',
    transport: uiDict?.budgetTransport || 'Transport',
    entry: uiDict?.budgetEntry || 'Entry',
    meals: uiDict?.budgetMeals || 'Meals',
    total: uiDict?.budgetTotal || 'Total',
    min: uiDict?.minUnit || 'min',
    adults: uiDict?.adultsLabel || 'adults',
    pax: uiDict?.paxLabel || 'pax',
  };
  let html = `<div style="text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid ${C.accent};">
    <h1 style="font-size:26px;font-weight:800;color:${C.accent};margin:0 0 6px;">${it.tour_title || L.defaultTitle}</h1>
    <p style="color:${C.muted};font-size:13px;margin:0;">
      ${input.startDate || ''} | ${input.adults ? `${input.adults} ${L.adults}` : `${input.pax || '-'} ${L.pax}`}
      ${it.t_money_recommended_load ? ` | T-money: ${formatKRW(it.t_money_recommended_load)}` : ''}
    </p>
    <p style="color:${C.muted};font-size:10px;margin:4px 0 0;">${L.generatedBy} \u00B7 cocotripkr.com</p>
  </div>`;

  // === Sprint 1 Step 4: QR header overlay ===
  // text-align:center인 header div 위에 우측 QR을 absolute 박스로 overlay.
  if (headerQrDataUrl) {
    const qrLabel = uiDict?.pdfQrLabel || 'Scan to open on mobile';
    html = `<div style="position:relative;">
      <div style="position:absolute;top:0;right:0;text-align:center;z-index:1;">
        <img src="${headerQrDataUrl}" style="width:72px;height:72px;display:block;" alt="QR" />
        <p style="font-size:8px;color:${C.muted};margin:2px 0 0;line-height:1.2;width:72px;">${qrLabel}</p>
      </div>
      ${html}
    </div>`;
  }

  // Arrival Guide
  if (arrival) {
    const ag = arrival as Record<string, unknown>;
    const route = ag.route_to_hotel as Record<string, unknown> | undefined;
    const rec = route?.recommended_option as Record<string, string> | undefined;
    const recReason = rec
      ? ((lang === 'ko' && rec.reason_ko) || (lang === 'ja' && rec.reason_ja) || (lang === 'zh' && rec.reason_zh) || rec.reason_en || '')
      : '';

    html += `<div style="background:${C.cardBg};border:1px solid ${C.border};border-radius:10px;padding:16px;margin-bottom:16px;">
      <h3 style="font-size:15px;font-weight:700;color:${C.heading};margin:0 0 10px;">${L.arrivalGuide} \u2014 ${arrival.airport || ''}</h3>`;

    // Hero: recommended option (charter cross-sell or transit)
    if (rec) {
      if (rec.key === 'cocotrip_charter') {
        // Charter cross-sell card — branded gradient, with reason
        html += `<div style="background:linear-gradient(135deg,rgba(124,92,252,0.12),rgba(234,83,126,0.08));border:1px solid ${C.accent};border-radius:8px;padding:12px;margin-bottom:12px;">
          <p style="font-size:9px;font-weight:700;color:#FBBC05;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">★ ${uiDict?.pdfRecommended || 'Recommended'}</p>
          <p style="font-size:13px;font-weight:700;color:${C.accent};margin:0 0 4px;">${uiDict?.charterRecTitle || 'CocoTrip Private Charter'}</p>
          <p style="font-size:10px;color:${C.sub};margin:0 0 6px;">${uiDict?.charterRecSub || 'Door-to-door · driver loads all luggage · English-speaking'}</p>
          <p style="font-size:10px;color:${C.heading};background:#fff;border:1px solid ${C.border};border-radius:4px;padding:6px 8px;margin:0;">⚠ ${recReason}</p>
        </div>`;
      } else if (route) {
        // Transit recommendation — show summary line
        const labels: Record<string, string> = {
          arex_express: 'AREX Express',
          arex_all_stop: 'AREX All Stop',
          limousine_bus: 'Limousine Bus',
        };
        const recLabel = labels[rec.key] || rec.key;
        html += `<div style="background:linear-gradient(135deg,rgba(124,92,252,0.10),rgba(234,83,126,0.06));border:1px solid ${C.accent};border-radius:8px;padding:12px;margin-bottom:12px;">
          <p style="font-size:9px;font-weight:700;color:#FBBC05;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">★ ${uiDict?.pdfRecommended || 'Recommended'}</p>
          <p style="font-size:13px;font-weight:700;color:${C.heading};margin:0 0 2px;">${recLabel}</p>
          <p style="font-size:10px;color:${C.muted};margin:0 0 6px;">${(route.est_min as number) || '?'}${L.min}${(route.est_fare_krw as number) ? ' \u00B7 ' + formatKRW((route.est_fare_krw as number) || 0) : ''}${(route.transfers as number) ? ' \u00B7 ' + (route.transfers as number) + ' transfer' : ''}</p>
          ${recReason ? `<p style="font-size:10px;color:${C.sub};margin:0;">\uD83D\uDCA1 ${recReason}</p>` : ''}
        </div>`;
      }
    }

    (arrival.steps || []).forEach((step: { step: number; title: string; description?: string; est_min?: number; transport_to_hotel?: Record<string, { price_krw?: number; est_price_krw?: number; duration_min?: number } | null>; t_money_recommended_load_krw?: number; options?: Array<{ name: string; price_krw?: number }> }) => {
      html += `<div style="margin:6px 0;padding:8px 0;border-bottom:1px solid ${C.border};">
        <p style="font-size:12px;color:${C.heading};margin:0;"><strong>${uiDict?.pdfStep || 'Step'} ${step.step}: ${step.title}</strong></p>
        <p style="font-size:11px;color:${C.sub};margin:2px 0 0;">${step.description || ''}</p>
        ${(step.est_min || 0) > 0 ? `<p style="font-size:10px;color:${C.accent};margin:2px 0 0;">~${step.est_min} ${L.min}</p>` : ''}`;

      // Sub-options (SIM/Wi-Fi etc.)
      if (step.options && step.options.length > 0) {
        html += `<div style="margin-top:6px;">`;
        step.options.forEach((opt) => {
          // display:flex on <p> \uAE68\uC9D0 \uBC29\uC9C0 \u2014 html2canvas flex \uB0B4 <p> \uB808\uC774\uC544\uC6C3 \uBD88\uC548\uC815.
          // <table> 1-row \uB85C \uAD50\uCCB4 (html2canvas table \uC9C0\uC6D0\uC774 \uB354 \uC548\uC815\uC801).
          html += `<table style="width:100%;font-size:10px;color:${C.sub};margin:2px 0;"><tr><td>\u00B7 ${opt.name}</td><td style="text-align:right;"><strong style="color:${C.accent};">${formatKRW(opt.price_krw || 0)}</strong></td></tr></table>`;
        });
        html += `</div>`;
      }

      // Transport-to-hotel comparison grid (Step 5)
      if (step.transport_to_hotel) {
        const TRANSPORT_LABELS: Record<string, string> = {
          arex_express: 'AREX Express',
          arex_all_stop: 'AREX All Stop',
          limousine_bus: 'Limousine Bus',
          taxi: 'Taxi',
        };
        const opts = Object.entries(step.transport_to_hotel).filter(([, v]) => v != null);
        if (opts.length > 0) {
          html += `<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:10px;">`;
          opts.forEach(([key, val]) => {
            const isRec = rec?.key === key;
            const bg = isRec ? '#fff8e0' : '#fff';
            const labelText = TRANSPORT_LABELS[key] || key.replace(/_/g, ' ');
            html += `<tr style="background:${bg};border-bottom:1px solid ${C.border};">
              <td style="padding:4px 6px;${isRec ? 'font-weight:700;color:#B45309;' : 'color:' + C.heading + ';'}">${isRec ? '\u2605 ' : ''}${labelText}</td>
              <td style="padding:4px 6px;text-align:right;color:${C.heading};font-weight:600;">${formatKRW(val?.price_krw || val?.est_price_krw || 0)}</td>
              <td style="padding:4px 6px;text-align:right;color:${C.muted};">${val?.duration_min || '?'}${L.min}</td>
            </tr>`;
          });
          html += `</table>`;
        }
      }

      // T-money load chip
      if ((step.t_money_recommended_load_krw ?? 0) > 0) {
        html += `<p style="font-size:10px;color:${C.accent};margin:6px 0 0;background:rgba(124,92,252,0.08);border:1px solid ${C.accent};border-radius:4px;padding:4px 8px;display:inline-block;font-weight:700;">\uD83D\uDCB3 ${uiDict?.tmoneyLoad || 'Load'} ${formatKRW(step.t_money_recommended_load_krw ?? 0)}</p>`;
      }

      html += `</div>`;
    });
    html += '</div>';
  }

  // All days
  // 2026-04-28: page-break-inside:avoid 를 day 전체에서 제거.
  // 7 stops/day는 한 페이지 안 들어감 → 브라우저가 무시하고 임의 위치에서 split (사용자 보고).
  // 대신 각 stop card + transit block 단위로 break-inside:avoid 적용 (아래).
  // 2026-05-09 (B9-34): Day 시작 시 명시적 page break — 사용자 신고 "카드 가운데 잘림, 끝부분 누락".
  //   - di>0 day wrapper 에 `pdf-day-break` 클래스 → pagebreak.before 로 새 페이지에서 시작.
  //   - day header / day summary 에도 명시적 클래스 추가 (avoid 셀렉터 매칭 강화).
  //   - 첫 번째 day 는 break 안 함 (intro 직후 자연 흐름).
  days.forEach((day: PlanDay, di: number) => {
    // B9-34: di>0 day wrapper 에 pdf-day-break 클래스 → pagebreak.before 새 페이지.
    // B9-39: 다도시 plan 의 도시 chip 라벨 — 헤더에 표시.
    const dayBreakClass = di > 0 ? ' pdf-day-break' : '';
    const cityChip = day.city
      ? `<span style="font-size:10px;background:rgba(234,83,126,0.18);border:1px solid rgba(234,83,126,0.40);color:#FF8AAA;padding:2px 6px;border-radius:4px;margin-left:8px;font-weight:600;vertical-align:middle;">${day.city}</span>`
      : '';
    html += `<div class="pdf-day-wrapper${dayBreakClass}" style="margin-bottom:24px;">
      <div class="pdf-day-header" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;page-break-inside:avoid;break-inside:avoid;page-break-after:avoid;break-after:avoid;">
        <div style="width:32px;height:32px;border-radius:50%;background:${C.accent};color:white;text-align:center;line-height:32px;font-size:14px;font-weight:700;flex-shrink:0;">${day.day || di + 1}</div>
        <div>
          <h2 style="font-size:16px;font-weight:700;color:${C.heading};margin:0;">${day.theme || `Day ${day.day || di + 1}`}${cityChip}</h2>
          ${day.date ? `<p style="font-size:10px;color:${C.muted};margin:0;">${day.date}</p>` : ''}
        </div>
      </div>`;

    // B9-39 (2026-05-09): 도시 간 이동 카드 (KTX/SRT/Air/Bus) — 다도시 plan.
    // intercity_transit 가 있을 때만 노출. page-break-inside:avoid 로 카드 단위 보존.
    const ic = day.intercity_transit as Record<string, unknown> | undefined;
    if (ic && ic.mode) {
      const icLabels = (uiDict as { intercity?: Record<string, string> } | undefined)?.intercity || {};
      const modeStr = String(ic.mode);
      const titleTpl = icLabels.title || 'Intercity Transit — {{mode}}';
      const departTpl = icLabels.depart || 'Depart {{time}}';
      const arriveTpl = icLabels.arrive || 'Arrive {{time}}';
      const durationTpl = icLabels.duration || '~{{min}} min';
      const fareTpl = icLabels.fare || 'KRW {{krw}} / pax';
      const bookTpl = icLabels.book || 'Book';
      const titleText = titleTpl.replace('{{mode}}', modeStr);
      const fromCity = String(ic.from_city_display || ic.from_city || '');
      const toCity = String(ic.to_city_display || ic.to_city || '');
      const departText = ic.recommended_depart ? departTpl.replace('{{time}}', String(ic.recommended_depart)) : '';
      const arriveText = ic.arrival_at ? arriveTpl.replace('{{time}}', String(ic.arrival_at)) : '';
      const durationText = ic.est_min ? durationTpl.replace('{{min}}', String(ic.est_min)) : '';
      const fareText = ic.est_fare_krw ? fareTpl.replace('{{krw}}', Number(ic.est_fare_krw).toLocaleString()) : '';
      const instruction = ic.instruction ? `<p style="font-size:10.5px;color:${C.muted};margin:6px 0 0;line-height:1.4;">${String(ic.instruction)}</p>` : '';
      const bookLink = ic.booking_url
        ? `<a href="${String(ic.booking_url)}" style="display:inline-block;margin-top:6px;font-size:10px;color:${C.accent};font-weight:600;text-decoration:none;">${bookTpl} →</a>`
        : '';
      html += `<div style="margin-bottom:14px;background:rgba(124,92,252,0.10);border:1px solid rgba(124,92,252,0.30);border-radius:6px;padding:10px 12px;page-break-inside:avoid;break-inside:avoid;">
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${C.accent};margin:0 0 4px;">${titleText}</p>
        <p style="font-size:13px;font-weight:700;color:${C.heading};margin:0;">${fromCity} → ${toCity}</p>
        <p style="font-size:11px;color:${C.muted};margin:4px 0 0;">
          ${[departText, arriveText, durationText, fareText].filter(Boolean).join('  ·  ')}
        </p>
        ${instruction}
        ${bookLink}
      </div>`;
    }

    // === Sprint 1 Step 4: 일별 요약 박스 ===
    // 사용자 요청: 총 거리, 추정 비용, 추천 photo.
    //  - totalWalkM: 모든 stops의 transit_from_prev.total_walk_m 합 (없으면 skip).
    //  - totalTransitMin: 모든 stops의 transit_from_prev.est_min 합 (이동 시간).
    //  - totalStayMin: 모든 stops의 stay_min 합 (관광 시간).
    //  - dayCostKRW: daily_budget_summary[day-1].total_krw (있으면).
    //  - heroPhoto: 첫 stop의 photo_ref → /api/place-photo proxy.
    const stopsArr = day.stops || [];
    const dayNum = day.day || di + 1;
    let totalWalkM = 0;
    let totalTransitMin = 0;
    let totalStayMin = 0;
    for (const s of stopsArr) {
      const tprev = s.transit_from_prev as { total_walk_m?: number; est_min?: number } | undefined;
      if (tprev?.total_walk_m) totalWalkM += tprev.total_walk_m;
      if (tprev?.est_min) totalTransitMin += tprev.est_min;
      if (s.stay_min) totalStayMin += s.stay_min;
    }
    const dayBudget = budget.find((b: BudgetRow) => b.day === dayNum);
    const dayCost = dayBudget?.total_krw || 0;
    const heroPhotoRef = stopsArr.find((s) => s.photo_ref)?.photo_ref;
    const heroPhotoUrl = heroPhotoRef
      ? `/api/place-photo?ref=${encodeURIComponent(heroPhotoRef)}&w=400`
      : '';

    const summaryLabels = {
      walk: uiDict?.pdfDailyWalk || 'Walking',
      transit: uiDict?.pdfDailyTransit || 'Transit',
      stay: uiDict?.pdfDailyStay || 'Sightseeing',
      cost: uiDict?.pdfDailyCost || 'Est. cost',
    };
    const km = totalWalkM > 0 ? (totalWalkM / 1000).toFixed(1) + ' km' : '—';
    const transitTxt = totalTransitMin > 0 ? `${totalTransitMin}${L.min}` : '—';
    const stayTxt = totalStayMin > 0 ? `${(totalStayMin / 60).toFixed(1)} h` : '—';
    const costTxt = dayCost > 0 ? formatKRW(dayCost) : '—';

    const photoHtml = heroPhotoUrl
      ? `<img src="${heroPhotoUrl}" style="width:90px;height:60px;object-fit:cover;border-radius:4px;flex-shrink:0;" alt="" />`
      : '';

    // display:flex → table 레이아웃으로 교체. html2canvas flex 내 stretch/wrap 불안정.
    // 2026-05-09 (B9-34): pdf-day-summary 클래스 — pagebreak.avoid 매칭 + day header 와 함께 keep.
    html += `<table class="pdf-day-summary" style="width:100%;background:${C.cardBg};border:1px solid ${C.border};border-left:4px solid ${C.accent};border-radius:6px;padding:0;margin-bottom:14px;page-break-inside:avoid;break-inside:avoid;border-collapse:collapse;">
      <tr>
        ${photoHtml ? `<td style="width:90px;padding:10px 6px 10px 10px;vertical-align:middle;">${photoHtml}</td>` : ''}
        <td style="padding:10px;vertical-align:middle;">
          <table style="width:100%;font-size:11px;border-collapse:collapse;">
            <tr>
              <td style="padding:2px 8px 2px 0;"><strong style="color:${C.heading};">${summaryLabels.walk}</strong>: <span style="color:${C.accent};font-weight:600;">${km}</span></td>
              <td style="padding:2px 8px 2px 0;"><strong style="color:${C.heading};">${summaryLabels.transit}</strong>: <span style="color:${C.accent};font-weight:600;">${transitTxt}</span></td>
            </tr>
            <tr>
              <td style="padding:2px 8px 2px 0;"><strong style="color:${C.heading};">${summaryLabels.stay}</strong>: <span style="color:${C.accent};font-weight:600;">${stayTxt}</span></td>
              <td style="padding:2px 0;"><strong style="color:${C.heading};">${summaryLabels.cost}</strong>: <span style="color:${C.accent};font-weight:700;">${costTxt}</span></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;

    (day.stops || []).forEach((stop: PlanStop) => {
      // Transit arrow (rich: uses steps_detail when available, falls back to step_by_step for legacy plans)
      if (stop.transit_from_prev) {
        const t = stop.transit_from_prev;
        const stepsDetail = (t.steps_detail as Array<Record<string, unknown>> | undefined) || [];
        const tr = {
          exit: transitDict?.exit || 'Exit',
          toward: transitDict?.toward || 'toward',
          stops: transitDict?.stops || 'stops',
          every: transitDict?.every || 'every',
          transfer: transitDict?.transfer || 'transfer',
          walk: transitDict?.walk || 'Walk',
          totalWalk: transitDict?.totalWalk || 'Total walk',
          finalArrival: transitDict?.finalArrival || 'Arrival',
          min: L.min,
        };
        const transfers = (t as { transfers?: number }).transfers || 0;
        const totalWalk = (t as { total_walk_m?: number }).total_walk_m || 0;

        const summary = `${t.method} \u00B7 ${t.est_min || '?'}${tr.min}${(t.est_fare_krw || 0) > 0 ? ` \u00B7 ${formatKRW(t.est_fare_krw || 0)}` : ''}${transfers > 0 ? ` \u00B7 ${transfers} ${tr.transfer}` : ''}${t.source === 'odsay' ? ' [live]' : ''}`;

        let stepsHtml = '';
        if (stepsDetail.length > 0) {
          stepsHtml = stepsDetail.map((s) => {
            if (s.mode === 'subway') {
              // ja/zh: 한국어 + 한자 번역 병기 ("강남 (江南)", "2호선 (2号線)").
              // 한국어 primary는 현지 직원에게 보여줄 때 실용적, 괄호 안 한자는 사용자 이해용.
              // translate-plan API가 lineJa/lineZh/fromJa/... 를 채움. 없으면 lineEn/fromRoman으로 폴백.
              const trSuffix = lang === 'ja' ? 'Ja' : lang === 'zh' ? 'Zh' : '';
              const pickTr = (key: string): string | undefined =>
                trSuffix ? ((s as Record<string, unknown>)[`${key}${trSuffix}`] as string | undefined) : undefined;
              const lineKoStr = (s.lineKo as string) || '';
              const lineEnStr = (s.lineEn as string) || '';
              const lineTrStr = pickTr('line') || '';
              const lineLabel = lang === 'ko'
                ? (lineKoStr || (s.line as string) || '')
                : (lang === 'ja' || lang === 'zh')
                  ? (lineKoStr && (lineTrStr || lineEnStr) && lineKoStr !== (lineTrStr || lineEnStr)
                      ? `${lineKoStr} (${lineTrStr || lineEnStr})`
                      : (lineKoStr || lineTrStr || lineEnStr || (s.line as string) || ''))
                  : (lineEnStr || lineKoStr || (s.line as string) || '');
              // For ja/zh prefer translated Hanja; for en use roman; for ko show Korean only.
              const bilang = (ko: unknown, key: string, roman: unknown) => {
                const k = (ko as string) || '';
                if (!k) return '';
                if (lang === 'ko') return k;
                const tr = pickTr(key);
                const paren = tr || (roman as string | undefined);
                // Skip parens when paren equals Korean (Gemini sometimes returns input unchanged for short station names).
                return paren && paren !== k ? `${k} (${paren})` : k;
              };
              const wayLabel = s.way ? bilang(s.way, 'way', s.wayRoman) : '';
              const fromLabel = bilang(s.from, 'from', s.fromRoman);
              const toLabel = bilang(s.to, 'to', s.toRoman);
              const head = `<b style="color:${C.accent};">${lineLabel}</b>${wayLabel ? ` <span style="color:${C.muted};font-weight:400;">(${tr.toward} ${wayLabel})</span>` : ''}`;
              const route = `<span style="color:#16a34a;">\u25CF ${fromLabel}${s.fromExit ? ` ${tr.exit} ${s.fromExit}` : ''}</span> \u2192 <span style="color:#db2777;">\u25CF ${toLabel}${s.toExit ? ` ${tr.exit} ${s.toExit}` : ''}</span>`;
              const meta = [
                s.stationCount ? `${s.stationCount} ${tr.stops}` : '',
                s.intervalMin ? `${tr.every} ${s.intervalMin}${tr.min}` : '',
                `${s.duration || '?'}${tr.min}`,
              ].filter(Boolean).join(' \u00B7 ');
              // Enrichment lines: transfer lines + accessibility + lost&found
              const fromInfo = s.fromStationInfo as { transferLines?: { lineKo: string; lineEn: string; lineKoJa?: string; lineKoZh?: string }[] } | undefined;
              const toInfo = s.toStationInfo as { hasElevator?: boolean; hasWheelchairLift?: boolean; lostCenterPhone?: string | null; address?: string | null } | undefined;
              const transferList = (fromInfo?.transferLines || []).map(l => {
                if (lang === 'ko') return l.lineKo;
                const trLine = lang === 'ja' ? l.lineKoJa : lang === 'zh' ? l.lineKoZh : undefined;
                if ((lang === 'ja' || lang === 'zh') && l.lineKo && trLine && l.lineKo !== trLine) {
                  return `${l.lineKo} (${trLine})`;
                }
                return l.lineEn || l.lineKo;
              }).filter(Boolean);
              const transferHtml = transferList.length > 0
                ? `<p style="font-size:8px;color:${C.muted};margin:2px 0 0;">\u21BB ${transitDict?.alsoTransfers || 'Also transfers'}: ${transferList.join(', ')}</p>`
                : '';
              const accessibleHtml = (toInfo?.hasElevator || toInfo?.hasWheelchairLift)
                ? `<p style="font-size:8px;color:#16a34a;margin:2px 0 0;">\u267F ${transitDict?.accessibleExit || 'Accessible exit available'}</p>`
                : '';
              const lostHtml = toInfo?.lostCenterPhone
                ? `<p style="font-size:8px;color:${C.muted};margin:2px 0 0;">${transitDict?.lostAndFound || 'Lost & found'}: ${toInfo.lostCenterPhone}</p>`
                : '';
              // First/last train: pick the direction matching this leg's `way`,
              // else fall back to whichever has data.
              const tt = s.fromTimetable as { up?: { first?: string; last?: string; lastDest?: string } | null; down?: { first?: string; last?: string; lastDest?: string } | null } | undefined;
              let chosenTrains: { first?: string; last?: string } | null = null;
              if (tt) {
                const way = s.way as string | undefined;
                const m = (t: { lastDest?: string } | null | undefined) => !!(t?.lastDest && way && (t.lastDest.includes(way) || way.includes(t.lastDest)));
                chosenTrains = m(tt.up) ? tt.up || null : m(tt.down) ? tt.down || null : (tt.up || tt.down || null);
              }
              const trainHtml = chosenTrains && (chosenTrains.first || chosenTrains.last)
                ? `<p style="font-size:8px;margin:2px 0 0;">${chosenTrains.first ? `<span style="color:${C.muted};">${transitDict?.firstTrain || 'First train'} ${chosenTrains.first}</span>` : ''}${chosenTrains.first && chosenTrains.last ? ' \u00B7 ' : ''}${chosenTrains.last ? `<span style="color:#db2777;font-weight:600;">${transitDict?.lastTrain || 'Last train'} ${chosenTrains.last}</span>` : ''}</p>`
                : '';
              return `<div style="margin:3px 0 3px 8px;padding:4px 8px;background:#ffffff;border:1px solid ${C.border};border-radius:4px;">
                <p style="font-size:10px;color:${C.heading};margin:0;">${head}</p>
                <p style="font-size:9px;color:${C.sub};margin:1px 0 0;">${route}</p>
                <p style="font-size:9px;color:${C.muted};margin:1px 0 0;">${meta}</p>
                ${trainHtml}${transferHtml}${accessibleHtml}${lostHtml}
              </div>`;
            }
            if (s.mode === 'bus') {
              // ja/zh 번역이 있으면 한국어 + 한자 병기. 없으면 한국어 그대로 (ODsay는 bus에 roman 미제공).
              const trSuffix = lang === 'ja' ? 'Ja' : lang === 'zh' ? 'Zh' : '';
              const sx = s as Record<string, unknown>;
              const bilangBus = (ko: string | undefined, key: string): string => {
                const k = ko || '';
                if (!k || lang === 'ko' || !trSuffix) return k;
                const tr = sx[`${key}${trSuffix}`] as string | undefined;
                return tr && tr !== k ? `${k} (${tr})` : k;
              };
              const busTypeLabel = bilangBus(s.busType as string | undefined, 'busType');
              const fromBus = bilangBus(s.from as string | undefined, 'from');
              const toBus = bilangBus(s.to as string | undefined, 'to');
              const head = `<b style="color:#16a34a;">${busTypeLabel ? `${busTypeLabel} ` : ''}${s.busNo || ''}</b>`;
              const route = `<span style="color:#16a34a;">\u25CF ${fromBus}${s.fromArs ? ` <span style="font-family:monospace;color:${C.muted};">#${s.fromArs}</span>` : ''}</span> \u2192 <span style="color:#db2777;">\u25CF ${toBus}${s.toArs ? ` <span style="font-family:monospace;color:${C.muted};">#${s.toArs}</span>` : ''}</span>`;
              const meta = [
                s.stationCount ? `${s.stationCount} ${tr.stops}` : '',
                s.intervalMin ? `${tr.every} ${s.intervalMin}${tr.min}` : '',
                `${s.duration || '?'}${tr.min}`,
              ].filter(Boolean).join(' \u00B7 ');
              return `<div style="margin:3px 0 3px 8px;padding:4px 8px;background:#ffffff;border:1px solid ${C.border};border-radius:4px;">
                <p style="font-size:10px;color:${C.heading};margin:0;">${head}</p>
                <p style="font-size:9px;color:${C.sub};margin:1px 0 0;">${route}</p>
                <p style="font-size:9px;color:${C.muted};margin:1px 0 0;">${meta}</p>
              </div>`;
            }
            // walk
            return `<p style="font-size:9px;color:${C.muted};margin:2px 0 2px 10px;">${tr.walk} ${s.duration || '?'}${tr.min}${(s.distance as number) > 0 ? ` (${s.distance}m)` : ''}</p>`;
          }).join('');
          // Final-arrival callout — extracts last subway/bus exit + last walk distance
          // and renders "Exit X → walk Ymin → DESTINATION" so the PDF reader knows
          // which exit gets them closest to where they're going.
          const lastTransit = [...stepsDetail].reverse().find(s => s.mode === 'subway' || s.mode === 'bus') as { toExit?: string | number } | undefined;
          const lastWalk = [...stepsDetail].reverse().find(s => s.mode === 'walk') as { distance?: number; duration?: number } | undefined;
          const arrExit = lastTransit?.toExit;
          const arrWalkM = lastWalk?.distance || totalWalk || 0;
          const arrWalkMin = lastWalk?.duration || (arrWalkM > 0 ? Math.max(1, Math.round(arrWalkM / 70)) : 0);
          const destName = stop.display_name || stop.name_en || stop.name || stop.name_ko || '';
          if (destName && (arrExit || arrWalkM > 0)) {
            stepsHtml += `<div style="margin:6px 0 0;padding:6px 8px;border-radius:4px;background:linear-gradient(135deg,rgba(52,211,153,0.10),rgba(124,92,252,0.06));border:1px solid rgba(52,211,153,0.30);">
              <p style="font-size:8px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:1px;margin:0 0 3px;">★ ${tr.finalArrival}</p>
              <p style="font-size:10px;color:${C.heading};margin:0;font-weight:600;">${arrExit ? `${tr.exit} ${arrExit} → ` : ''}${arrWalkM > 0 ? `${tr.walk} ${arrWalkMin}${tr.min} (${arrWalkM}m) → ` : ''}<span style="color:#10b981;">${destName}</span></p>
            </div>`;
          } else if (totalWalk > 0) {
            stepsHtml += `<p style="font-size:8px;color:${C.muted};margin:3px 0 0 10px;">${tr.totalWalk}: ${totalWalk}m</p>`;
          }
        } else if (t.step_by_step?.length) {
          // Legacy plans generated before steps_detail existed — plain text fallback
          stepsHtml = t.step_by_step.map((s: string) => `<p style="font-size:9px;color:${C.sub};margin:1px 0 0 10px;">\u00B7 ${s}</p>`).join('');
        }

        // Walk 정당화: 짧은 거리는 도보가 지하철보다 빠르다 (사용자 신고 대응)
        const walkNote = (t.method === 'walk' && (t.est_min || 0) <= 15)
          ? `<p style="font-size:9px;color:#10b981;margin:2px 0 0;font-style:italic;">${transitDict?.walkFasterNote || '🚶 이 거리는 지하철보다 도보가 빠릅니다 (대기·환승 시간 포함)'}</p>`
          : '';
        html += `<div class="pdf-transit-block" style="margin:4px 0 6px 16px;padding:6px 12px;background:${C.transitBg};border-left:3px solid ${C.accent};border-radius:4px;page-break-inside:avoid;break-inside:avoid;">
          <p style="font-size:10px;color:${C.accent};font-weight:700;margin:0;">${summary}</p>
          ${walkNote}
          ${stepsHtml}
        </div>`;
      }

      // Stop card — 페이지 중간에서 절대 잘리지 않게 break-inside:avoid (사용자 신고: 17:43 문제제빵 카드가 페이지 경계에서 분할).
      // class="pdf-stop-card"는 html2pdf의 pagebreak.avoid selector 와 짝.
      // Sprint 1 Step 4: 카테고리별 좌측 accent bar (web #136 parity).
      const catBar = pdfCategoryBar(stop.category);
      // display:flex justify-content:space-between \u2192 table \uB808\uC774\uC544\uC6C3\uC73C\uB85C \uAD50\uCCB4.
      // html2canvas flex space-between\uC774 \uC77C\uBD80 \uD658\uACBD\uC5D0\uC11C \uC624\uB978\uCABD \uC694\uC18C\uB97C \uC798\uB77C\uB0C4.
      html += `<div class="pdf-stop-card" style="background:${C.cardBg};border:1px solid ${C.border};border-left:4px solid ${catBar};border-radius:8px;padding:12px;margin-bottom:6px;page-break-inside:avoid;break-inside:avoid;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:top;padding:0;">
              <p style="font-size:13px;font-weight:700;color:${C.heading};margin:0;"><span style="color:${catBar};font-size:12px;">${stop.start_time || ''}</span> \u00B7 ${stop.display_name || stop.name_en || stop.name || stop.name_ko || ''}</p>
              ${(stop.name || stop.name_ko) && (stop.display_name || stop.name_en) && (stop.name || stop.name_ko) !== (stop.display_name || stop.name_en) ? `<p style="font-size:10px;color:${C.muted};margin:2px 0 0;">${stop.name || stop.name_ko}</p>` : ''}
            </td>
            <td style="vertical-align:top;text-align:right;padding:0 0 0 8px;white-space:nowrap;">
              <span style="font-size:10px;color:${(stop.entry_fee_krw || 0) > 0 ? C.pink : '#22c55e'};font-weight:600;">${(stop.entry_fee_krw || 0) > 0 ? formatKRW(stop.entry_fee_krw || 0) : L.free}</span>
            </td>
          </tr>
        </table>
        <p style="font-size:10px;color:${C.muted};margin:4px 0 0;">${stop.stay_min || '?'}min${stop.address ? ` | ${stop.address}` : ''}</p>
        ${stop.naverMapUrl ? `<p style="font-size:10px;margin:3px 0 0;"><a href="${stop.naverMapUrl}" style="color:${C.accent};text-decoration:underline;">${L.openNaverMap}</a></p>` : ''}
        ${(stop.tip || stop.tip_en) ? `<p style="font-size:10px;color:${C.sub};margin:4px 0 0;font-style:italic;">${L.tip}: ${stop.tip || stop.tip_en}</p>` : ''}
        ${stop.reservation_required ? `<p style="font-size:10px;color:#f97316;margin:4px 0 0;">${L.reservation}${stop.reservation_phone ? ` \u00B7 ${stop.reservation_phone}` : ''}</p>` : ''}
        ${stop.recommended_items?.length ? (() => {
          const parts = stop.recommended_items
            .map((raw: unknown) => normalizeRecommendedItem(raw))
            .filter((item) => !!item.name)
            .map((item) => `${item.name}${(item.price_krw || 0) > 0 ? ` (${formatKRW(item.price_krw!)})` : ''}`);
          return parts.length ? `<p style="font-size:10px;color:${C.sub};margin:4px 0 0;">${L.recommended}: ${parts.join(', ')}</p>` : '';
        })() : ''}
      </div>`;
    });
    html += '</div>';
  });

  // Budget table
  if (budget.length > 0) {
    html += `<div style="margin-bottom:20px;page-break-inside:avoid;">
      <h3 style="font-size:15px;font-weight:700;color:${C.heading};margin:0 0 10px;">${L.budgetSummary}</h3>
      <table style="width:100%;font-size:11px;border-collapse:collapse;border:1px solid ${C.border};">
        <tr style="background:${C.accent};color:white;">
          <th style="text-align:left;padding:8px;">${L.day}</th><th style="text-align:right;padding:8px;">${L.transport}</th><th style="text-align:right;padding:8px;">${L.entry}</th><th style="text-align:right;padding:8px;">${L.meals}</th><th style="text-align:right;padding:8px;">${L.total}</th>
        </tr>`;
    budget.forEach((row: BudgetRow, i: number) => {
      html += `<tr style="background:${i % 2 === 0 ? '#fff' : C.cardBg};border-bottom:1px solid ${C.border};">
        <td style="padding:6px 8px;font-weight:600;">${L.day} ${row.day}</td>
        <td style="text-align:right;padding:6px 8px;">${formatKRW(row.transport_krw || 0)}</td>
        <td style="text-align:right;padding:6px 8px;">${formatKRW(row.entry_fees_krw || 0)}</td>
        <td style="text-align:right;padding:6px 8px;">${formatKRW(row.meals_krw || 0)}</td>
        <td style="text-align:right;padding:6px 8px;font-weight:700;color:${C.accent};">${formatKRW(row.total_krw || 0)}</td>
      </tr>`;
    });
    const grandTotal = budget.reduce((s: number, r: BudgetRow) => s + (r.total_krw || 0), 0);
    html += `<tr style="background:${C.accent};color:white;font-weight:700;">
      <td style="padding:8px;" colspan="4">${L.total}</td>
      <td style="text-align:right;padding:8px;">${formatKRW(grandTotal)}</td>
    </tr>`;
    html += '</table></div>';
  }

  // Departure Guide
  if (departure) {
    const dg = departure as Record<string, unknown>;
    const depRoute = dg.route_to_airport as Record<string, unknown> | undefined;
    html += `<div style="background:${C.cardBg};border:1px solid ${C.pink};border-radius:10px;padding:16px;margin-bottom:16px;">
      <h3 style="font-size:15px;font-weight:700;color:${C.pink};margin:0 0 10px;">\u2708 ${L.departureGuide} \u2014 ${departure.airport || ''}</h3>`;

    // Hero: ODsay route hotel→airport (preferred)
    if (depRoute) {
      html += `<div style="background:linear-gradient(135deg,rgba(234,83,126,0.10),rgba(251,146,60,0.06));border:1px solid ${C.pink};border-radius:8px;padding:10px 12px;margin-bottom:10px;">
        <p style="font-size:12px;font-weight:700;color:${C.pink};margin:0 0 2px;">${uiDict?.toAirport || 'To Airport'}</p>
        <p style="font-size:10px;color:${C.muted};margin:0 0 6px;">${(depRoute.est_min as number) || '?'}${L.min}${(depRoute.est_fare_krw as number) ? ' \u00B7 ' + formatKRW((depRoute.est_fare_krw as number) || 0) : ''}${(depRoute.transfers as number) ? ' \u00B7 ' + (depRoute.transfers as number) + ' transfer' : ''}</p>`;
      // Step-by-step (text fallback for PDF; full transit detail is on web)
      const stepsArr = depRoute.step_by_step as string[] | undefined;
      if (stepsArr && stepsArr.length > 0) {
        stepsArr.forEach((s: string) => {
          html += `<p style="font-size:10px;color:${C.sub};margin:1px 0 0 8px;">\u00B7 ${s}</p>`;
        });
      }
      html += `</div>`;
    }

    // Fallback: simple to_airport line if no ODsay route
    if (!depRoute && departure.to_airport) {
      html += `<p style="font-size:11px;color:${C.sub};margin:0 0 6px;">${departure.to_airport.method} \u00B7 ${departure.to_airport.instruction || ''} (${departure.to_airport.duration_min || '?'}${L.min}, ${formatKRW(departure.to_airport.cost_krw || 0)})</p>`;
    }

    // Tip cards
    const dgFull = departure as Record<string, unknown> & { luggage_storage?: { available?: boolean; location?: string } };
    if (dgFull.luggage_storage?.available) {
      html += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;"><strong>\uD83D\uDCBC ${uiDict?.luggageStorage || 'Luggage Storage'}:</strong> ${dgFull.luggage_storage.location || ''}</p>`;
    }
    if (departure.tax_refund) {
      html += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;"><strong>\uD83D\uDCB0 ${uiDict?.taxRefund || 'Tax Refund'}:</strong> ${departure.tax_refund.location || ''} (${uiDict?.minPurchase || 'Min.'} ${formatKRW(departure.tax_refund.threshold_krw || 30000)})</p>`;
    }
    if (departure.last_minute_shopping) {
      html += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;"><strong>\uD83D\uDED2 ${uiDict?.lastMinuteShopping || 'Last-minute shopping'}:</strong> ${departure.last_minute_shopping}</p>`;
    }
    html += '</div>';
  }

  // Footer
  html += `<div style="text-align:center;border-top:1px solid ${C.border};padding-top:16px;margin-top:20px;">
    <p style="font-size:11px;color:${C.muted};margin:0;">WhatsApp: +82-10-8714-0611 | cocotripkr.com</p>
    <p style="font-size:9px;color:#bbb;margin:4px 0 0;">\u00A9 CocoTrip \u00B7 Korea Private Tour Specialist</p>
  </div>`;

  container.innerHTML = html;

  // === 빈 콘텐츠 방지: 최소 높이/텍스트 검증 ===
  if (container.scrollHeight < 100 || container.innerText.trim().length < 50) {
    console.error('[PDF] Empty content detected — aborting PDF generation');
    document.body.removeChild(container);
    document.body.removeChild(overlay);
    toast.error('PDF content is empty. Please wait for the plan to fully load.');
    return;
  }

  // === Explicit font preload — kick the loader BEFORE waiting on fonts.ready ===
  // Without explicit load(), fonts.ready may resolve with 0 CJK faces loaded
  // (Noto Sans KR/JP/SC are CSS-declared but not network-requested until first
  // glyph render). First-run fail mode: ready resolves, layout uses tofu boxes.
  const fontsApi = (document as Document & {
    fonts?: { ready?: Promise<unknown>; load?: (s: string) => Promise<unknown> };
  }).fonts;
  if (fontsApi?.load) {
    await Promise.allSettled([
      fontsApi.load('14px "Noto Sans KR"'),
      fontsApi.load('14px "Noto Sans JP"'),
      fontsApi.load('14px "Noto Sans SC"'),
    ]);
  }

  // After explicit load, fonts.ready is reliable. 8s cap as safety net.
  // 2026-05-09 (B9-30): 5s → 8s. 모바일 4G 환경에서 Noto Sans KR (~120KB) 다운로드 + 파싱
  // 5s 안에 못 끝내는 사례 보고됨. block display 변경과 함께 첫 방문자 안정성 강화.
  await Promise.race([
    fontsApi?.ready || Promise.resolve(),
    new Promise(resolve => setTimeout(resolve, 8000)),
  ]);

  // === CJK 폰트 렌더 검증: 더미 문자로 실제 렌더 확인 + 1회 재시도 ===
  const fontTest = document.createElement('span');
  fontTest.style.cssText = 'position:absolute;top:-9999px;font-size:16px;font-family:inherit;';
  fontTest.textContent = '\uD55C\uAE00\u30C6\u30B9\u30C8\u4E2D\u6587';
  container.appendChild(fontTest);
  await new Promise(resolve => setTimeout(resolve, 200));
  if (fontTest.offsetWidth === 0) {
    // 1차 재시도: Safari 등 느린 환경 대응
    await new Promise(resolve => setTimeout(resolve, 400));
    if (fontTest.offsetWidth === 0 && fontsApi?.load) {
      // 2차 재시도: explicit fontsApi.load 다시 호출 + 더 긴 대기
      await Promise.allSettled([
        fontsApi.load('14px "Noto Sans KR"'),
        fontsApi.load('14px "Noto Sans JP"'),
        fontsApi.load('14px "Noto Sans SC"'),
      ]);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (fontTest.offsetWidth === 0) {
      // 3회 실패 — system font fallback 시 tofu 박스 가능. abort + toast.
      // Phase 1 (2026-04-27): 이전엔 silent warn → 그대로 진행해 백지/tofu PDF 다운로드.
      console.error('[PDF] CJK font load failed after 3 retries — aborting to prevent tofu-box PDF');
      fontTest.remove();
      document.body.removeChild(container);
      document.body.removeChild(overlay);
      const fontPlanId = (typeof window !== 'undefined'
        ? (window.location.pathname.match(/my-plans\/([^/?#]+)/)?.[1] || '')
        : '');
      const fontFailMsg = `Hi CocoTrip! Korean font failed to load for my PDF${fontPlanId ? ` (plan ${fontPlanId})` : ''}. Could you send it manually?`;
      const fontFailUrl = `https://wa.me/821087140611?text=${encodeURIComponent(fontFailMsg)}`;
      toast.error('PDF font load failed', {
        description: 'Korean fonts did not load in time. Try again in a moment, or request a manual PDF via WhatsApp.',
        action: { label: 'Open WhatsApp', onClick: () => window.open(fontFailUrl, '_blank') },
        duration: 12000,
      });
      return;
    }
  }
  fontTest.remove();

  // === Phase 2 (2026-04-27): 이미지 base64 inline preload ===
  // html2canvas는 CORS 실패한 이미지를 빈 영역으로 렌더 → 부분 백지 PDF.
  // container 내 모든 <img>를 fetch + FileReader로 base64 변환해 inline.
  // 안전장치: 5초 timeout, fail 시 해당 이미지만 포기 (전체 abort X).
  const imgs = Array.from(container.querySelectorAll('img'));
  if (imgs.length > 0) {
    await Promise.allSettled(imgs.map(async (img) => {
      const src = img.src;
      // 이미 data: URL이면 스킵
      if (!src || src.startsWith('data:')) return;
      try {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(src, { signal: ctrl.signal, mode: 'cors' });
        clearTimeout(timeoutId);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        img.src = dataUrl;
      } catch (e) {
        console.warn('[PDF] image preload failed for', src, e);
      }
    }));
    // 이미지 src 변경 후 layout settle 대기
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Additional settle time for layout recalculation
  await new Promise(resolve => setTimeout(resolve, 300));
  void container.offsetHeight; // force reflow

  // === 백지 root cause fix (2026-04-27): explicit height 명시 ===
  // 사용자 신고 → empty canvas h=0 진단. html2canvas/html2pdf는 element clone 시
  // measurement를 다시 하는데, position:absolute 컨테이너의 height 측정에 실패하면
  // 0px canvas 생성 → 백지 PDF. scrollHeight를 explicit height로 박아서 확실히 측정되게 함.
  const measuredHeight = container.scrollHeight;
  if (measuredHeight > 0) {
    container.style.height = `${measuredHeight}px`;
    container.style.minHeight = `${measuredHeight}px`;
  } else {
    console.error('[PDF] container.scrollHeight=0 — content not rendered. Aborting.');
    document.body.removeChild(container);
    document.body.removeChild(overlay);
    toast.error('PDF content failed to render', {
      description: 'Try refreshing the page and download again.',
      duration: 8000,
    });
    return;
  }

  // === Phase 2 (2026-04-27, rev 2026-05-08): adaptive scale로 긴 일정도 PDF 가능 ===
  // 메모리 = 800 × scrollHeight × scale^2 × 4byte. iOS OOM 한계 ~50MB.
  // 2026-05-08 개선: 기본 scale 1.5 (레티나 디스플레이 선명도 개선, 텍스트 흐림 해결).
  //   devicePixelRatio를 직접 쓰지 않는 이유: 3배 레티나(iPhone)에서 scale=3이면 OOM.
  //   대신 1.5 고정으로 선명도 vs 메모리 균형 유지.
  //   메모리 기준(1.5): 800 × H × 2.25 × 4byte
  //   ≤ 8000px: scale 1.5 (~43MB)
  //   8000-12000px: scale 1.0 (~38MB)
  //   12000-18000px: scale 0.85 (~41MB)
  //   18000-24000px: scale 0.7 (~38MB)
  //   > 24000px: abort + WhatsApp 안내
  const scrollH = container.scrollHeight;
  let pdfScale = scrollH <= 8000 ? 1.5 : 1.0;
  if (scrollH > 12000 && scrollH <= 18000) pdfScale = 0.85;
  else if (scrollH > 18000 && scrollH <= 24000) pdfScale = 0.7;
  else if (scrollH > 24000) {
    const tooLongPlanId = (typeof window !== 'undefined'
      ? (window.location.pathname.match(/my-plans\/([^/?#]+)/)?.[1] || '')
      : '');
    const tooLongMsg = `Hi CocoTrip! My plan${tooLongPlanId ? ` (${tooLongPlanId})` : ''} is too long for in-browser PDF (${scrollH}px). Could you send it manually?`;
    const tooLongUrl = `https://wa.me/821087140611?text=${encodeURIComponent(tooLongMsg)}`;
    document.body.removeChild(container);
    document.body.removeChild(overlay);
    toast.warning('Itinerary too long for in-browser PDF', {
      description: 'Very long plans (15+ days) hit mobile memory limits. We can send a manually-rendered PDF via WhatsApp.',
      action: { label: 'Request via WhatsApp', onClick: () => window.open(tooLongUrl, '_blank') },
      duration: 12000,
    });
    return;
  }
  console.log('[PDF] adaptive scale:', pdfScale, 'for scrollHeight:', scrollH);

  // Build WhatsApp fallback URL once — reused on failure.
  const planIdFromUrl = (typeof window !== 'undefined'
    ? (window.location.pathname.match(/my-plans\/([^/?#]+)/)?.[1] || '')
    : '');
  const fallbackMsg = `Hi CocoTrip! PDF download failed for my plan${planIdFromUrl ? ` (${planIdFromUrl})` : ''}. Could you send it manually?`;
  const whatsappFallback = `https://wa.me/821087140611?text=${encodeURIComponent(fallbackMsg)}`;
  // Replaces blocking confirm() — sonner toast with action button feels modern
  // and doesn't yank focus / require modal dismissal.
  const offerWhatsapp = (reason: string) => {
    toast.error(reason, {
      description: 'We can send the PDF manually via WhatsApp.',
      action: { label: 'Open WhatsApp', onClick: () => window.open(whatsappFallback, '_blank') },
      duration: 10000,
    });
  };

  try {
    const html2pdf = (await import('html2pdf.js')).default;
    const titleSlug = (it.tour_title || 'korea-trip').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'korea-trip';
    const dateStr = input.startDate || 'undated';
    const filename = `cocotrip-${titleSlug}-${dateStr}.pdf`;

    // 2026-04-27 사용자 신고: 빈 PDF (3KB, /XObject 없음) → scale 0.7 시도가 실패.
    // 백지 PDF는 html2canvas가 빈 canvas 반환 OR html2pdf의 jpeg embed 실패 시 발생.
    // 즉시 안전 기본값 복구 (scale 1.0, jpeg 0.92), pagebreak 단순화.
    // windowHeight 명시 — html2canvas가 cloned element를 측정할 때 viewport 추정에 사용.
    // 안 주면 일부 환경(특히 dev preview)에서 0으로 떨어짐.
    const worker = html2pdf().set({
      margin: [8, 8, 8, 8],
      filename,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: {
        scale: pdfScale,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        // 2026-05-09 (B9-30) 한글 깨짐 방지 강화:
        // - letterRendering: true → 글자별 렌더링 (느리지만 폭/메트릭 정확)
        // - foreignObjectRendering: false → SVG-foreignObject 비활성 (Safari iOS 깨짐 보고)
        // - allowTaint: false → 취약한 이미지 차단 (CORS 우회 안전성)
        letterRendering: true,
        foreignObjectRendering: false,
        allowTaint: false,
        windowWidth: 800,
        windowHeight: measuredHeight,
        height: measuredHeight,
        width: 800,
        scrollX: 0,
        scrollY: 0,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
      // 2026-05-03 사용자 신고: PDF 페이지 사이 큰 빈 공간 (Day 2→Day 3 사이).
      // 원인: 'avoid-all' 모드가 ALL element에 page-break-inside:avoid를 강제로
      // 적용 → day wrapper 같은 큰 div도 분할 금지 → 한 페이지에 다음 day 전체가
      // 안 들어가면 통째로 다음 페이지로 밀림 (CSS에서 day wrapper의 page-break를
      // 명시적으로 제거했지만 'avoid-all'이 무시함).
      // 'css' + 'legacy'만 유지 — 명시적 .pdf-stop-card / .pdf-transit-block만
      // 분할 금지, 그 외는 자연스러운 페이지 흐름.
      // 2026-05-09 (B9-34): Day 경계에서 명시적 page-break-before — 사용자 신고
      // "카드 가운데 잘림, 끝부분 누락" 대응. 각 day 의 wrapper 에 .pdf-day-break
      // 클래스(첫 day 제외) 부여 + before 셀렉터 매칭 → Day 2/3/4... 새 페이지 시작.
      // .pdf-day-header 와 .pdf-day-summary 도 avoid 추가 — header 만 페이지 끝에
      // 남고 본문이 다음 페이지로 밀리는 고아(orphan) header 방지.
      pagebreak: {
        mode: ['css', 'legacy'],
        avoid: ['.pdf-stop-card', '.pdf-transit-block', '.pdf-day-header', '.pdf-day-summary'],
        before: ['.pdf-day-break'],
      },
    } as Record<string, unknown>).from(container);

    // === 캔버스 픽셀 검사: blob 크기 가드만으론 못 잡음 (3KB 백지 PDF 발생 사례) ===
    // html2pdf 파이프라인을 toCanvas 단계에서 일시 중단해 canvas pixel 샘플링.
    // 픽셀이 99% 이상 흰색(R=G=B=255)이면 백지로 판정 → toast + abort.
    const canvas: HTMLCanvasElement = await worker.toCanvas().get('canvas');
    // DEV-only debug: expose canvas to window for /dev/transit-test 미리보기
    if (import.meta.env.DEV) {
      (window as unknown as { __pdfDebugCanvas?: HTMLCanvasElement }).__pdfDebugCanvas = canvas;
    }
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      console.error('[PDF] empty canvas — w=', canvas?.width, 'h=', canvas?.height);
      offerWhatsapp('PDF capture failed (empty canvas).');
      return;
    }
    // 캔버스 9개 점(코너 4개 + 변 중앙 4개 + 정중앙)에서 픽셀 샘플링
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const W = canvas.width, H = canvas.height;
      const points = [[0,0],[W-1,0],[0,H-1],[W-1,H-1],[W>>1,0],[W>>1,H-1],[0,H>>1],[W-1,H>>1],[W>>1,H>>1]];
      let nonWhite = 0;
      for (const [x, y] of points) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        // R=G=B=255 (white) 또는 alpha=0(투명)이 아니면 콘텐츠 픽셀
        if (!(d[0] === 255 && d[1] === 255 && d[2] === 255) && d[3] !== 0) nonWhite++;
      }
      if (nonWhite === 0) {
        console.error('[PDF] all-white canvas detected — w=', W, 'h=', H, 'samples=', points.length);
        offerWhatsapp('PDF capture failed (blank canvas).');
        return;
      }
    }
    // 캔버스 검증 통과 → PDF blob 생성
    const pdf = await worker.outputPdf('blob');
    if (pdf.size < 1024) {
      console.error('[PDF] blank blob detected, size =', pdf.size, 'scrollHeight =', container.scrollHeight);
      offerWhatsapp('PDF capture failed (empty file).');
      return;
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      // iOS Safari: direct .save() often blocked -> open blob in new tab
      const url = URL.createObjectURL(pdf);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      // 안드로이드 / 데스크톱: blob을 a[download] 트리거로 저장 (worker.save() 우회)
      const url = URL.createObjectURL(pdf);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    void posthogTrack('plan_downloaded', {
      planId: planIdForTrack,
      format: 'pdf-client',
      durationMs: Date.now() - pdfStartTs,
    });
  } catch (err) {
    console.error('[PDF] generation failed:', err, 'scrollHeight=', container.scrollHeight);
    offerWhatsapp('PDF generation failed.');
  } finally {
    document.body.removeChild(container);
    document.body.removeChild(overlay);
  }
}
