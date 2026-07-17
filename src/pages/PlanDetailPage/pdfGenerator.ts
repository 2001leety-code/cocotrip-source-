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
import { openBlobSafely } from '@/lib/openBlobSafely';
import type { PlanDocument, PlanDay, PlanStop, BudgetRow } from './types';
import { buildActivityMetaHtml } from '@/lib/activityMetaLabels';
import { buildActivityGuideHtml } from '@/lib/activityGuides';

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
  // P193 (2026-05-25) SAFETY-CRITICAL — Halal/Vegan recommended restaurants PDF section
  pdfRecommendedRestaurants?: string;  // "추천 식당 / Recommended Restaurants / おすすめレストラン / 推荐餐厅"
  pdfRecommendedRestaurantsSubtitle?: string;
  pdfHalalSection?: string;           // "할랄 / Halal / ハラール / 清真"
  pdfVeganSection?: string;           // "비건 / Vegan / ヴィーガン / 素食"
  pdfGeneralSection?: string;         // "일반 / General / 一般 / 一般"
  pdfRestaurantOpenMap?: string;
  pdfRestaurantReviews?: string;
  pdfRestaurantKmAway?: string;
  pdfRestaurantNoneForDiet?: string;
  [key: string]: string | undefined;
}

// ── P193 (2026-05-25) SAFETY-CRITICAL ────────────────────────────────────────
// PDF Halal/Vegan recommended restaurants section.
// 무슬림/비건 외국인 visitor 가 PDF 다운로드 시 식이제한 식당 정보 0건 위험 제거.
// CLAUDE.md J 준수: 식이제한 데이터는 건강 위험 등급 — silent drop 절대 금지.
// ─────────────────────────────────────────────────────────────────────────────

type RecRestaurantForPdf = {
  name: string;
  nameEn?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  cuisine?: string;
  cuisineKo?: string;
  priceLabel?: string;
  dong?: string;
  dongEn?: string;
  nearestStopKm?: number;
  googleMapsUrl?: string;
  region?: string;
};

// Display order — dietary-priority: halal > vegan > general
// (SAFETY-CRITICAL: 무슬림/비건 손님은 자신의 bucket 이 먼저 보여야 함)
const REC_BUCKET_ORDER = ['halal', 'vegan', 'general'];

/**
 * P193 SAFETY-CRITICAL — buildRecommendedRestaurantsSection
 *
 * itinerary.recommended_restaurants (per-style map 또는 legacy flat array) 를
 * PDF HTML 섹션으로 변환. halal/vegan/general 각 bucket 분리 렌더링.
 *
 * @param itinerary - plan.itinerary
 * @param lang      - 'ko' | 'en' | 'ja' | 'zh'
 * @param uiDict    - PdfUiDict (4-lang labels)
 * @param C         - color tokens (PDF 컨테이너와 동일 토큰 사용)
 * @returns HTML string | '' (빈 문자열 = 식당 데이터 없음)
 */
export function buildRecommendedRestaurantsSection(
  itinerary: Record<string, unknown>,
  lang: string,
  uiDict: PdfUiDict | undefined,
  C: { heading: string; sub: string; muted: string; accent: string; border: string; cardBg: string },
): string {
  const raw = itinerary.recommended_restaurants;
  if (!raw || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw as object).length === 0)) {
    return '';
  }

  // Normalize to per-style map
  let styleMap: Record<string, RecRestaurantForPdf[]>;
  if (Array.isArray(raw)) {
    // Legacy flat array — treat as general
    styleMap = { general: raw as RecRestaurantForPdf[] };
  } else {
    styleMap = raw as Record<string, RecRestaurantForPdf[]>;
  }

  // Build ordered buckets — dietary first (halal > vegan > general)
  const buckets: { style: string; list: RecRestaurantForPdf[] }[] = [];
  for (const style of REC_BUCKET_ORDER) {
    const list = styleMap[style];
    if (Array.isArray(list)) buckets.push({ style, list });
  }
  // Unknown extra styles appended last
  for (const [style, list] of Object.entries(styleMap)) {
    if (!REC_BUCKET_ORDER.includes(style) && Array.isArray(list) && list.length > 0) {
      buckets.push({ style, list: list as RecRestaurantForPdf[] });
    }
  }

  // Return '' if all buckets empty
  const hasAny = buckets.some((b) => b.list.length > 0);
  if (!hasAny) return '';

  // 4-lang labels
  const L4: Record<string, Record<string, string>> = {
    ko: {
      title: '추천 식당',
      subtitle: '여정 정류장 5km 이내 고평점 식당 — 이미 플랜에 포함된 곳 제외',
      halal: '할랄',
      vegan: '비건',
      general: '일반',
      openMap: '지도에서 보기',
      reviews: '리뷰',
      kmAway: 'km 거리',
      noneForDiet: '이 지역 DB 에 해당 식이제한 검증 식당이 아직 없습니다.',
    },
    en: {
      title: 'Recommended Restaurants',
      subtitle: 'Top-rated spots within 5 km of your stops — already-included places excluded',
      halal: 'Halal',
      vegan: 'Vegan',
      general: 'General',
      openMap: 'Open in Maps',
      reviews: 'reviews',
      kmAway: 'km away',
      noneForDiet: 'No verified restaurants for this dietary requirement in our DB for this area yet.',
    },
    ja: {
      title: 'おすすめレストラン',
      subtitle: 'あなたの立ち寄り地から5km以内の高評価スポット',
      halal: 'ハラール',
      vegan: 'ヴィーガン',
      general: '一般',
      openMap: 'マップで開く',
      reviews: 'レビュー',
      kmAway: 'km先',
      noneForDiet: 'この地域のDBには、この食事制限に対応した検証済みレストランがまだありません。',
    },
    zh: {
      title: '推荐餐厅',
      subtitle: '行程景点5公里范围内的高评分餐厅',
      halal: '清真',
      vegan: '素食',
      general: '一般',
      openMap: '在地图中打开',
      reviews: '条评价',
      kmAway: '公里',
      noneForDiet: '该地区数据库中目前还没有符合此饮食要求的认证餐厅。',
    },
  };
  const ll = (L4[lang] || L4['en']) as Record<string, string>;

  const sectionTitle = uiDict?.pdfRecommendedRestaurants || ll['title'];
  const sectionSubtitle = uiDict?.pdfRecommendedRestaurantsSubtitle || ll['subtitle'];
  const openMapLabel = uiDict?.pdfRestaurantOpenMap || ll['openMap'];
  const reviewsLabel = uiDict?.pdfRestaurantReviews || ll['reviews'];
  const kmAwayLabel = uiDict?.pdfRestaurantKmAway || ll['kmAway'];
  const noneLabel = uiDict?.pdfRestaurantNoneForDiet || ll['noneForDiet'];

  const styleLabel = (style: string): string => {
    if (style === 'halal') return uiDict?.pdfHalalSection || ll['halal'] || 'Halal';
    if (style === 'vegan') return uiDict?.pdfVeganSection || ll['vegan'] || 'Vegan';
    if (style === 'general') return uiDict?.pdfGeneralSection || ll['general'] || 'General';
    return style.charAt(0).toUpperCase() + style.slice(1);
  };

  // Accent colors for dietary badges — SAFETY: distinct colors so dietary ≠ general
  const STYLE_COLOR: Record<string, string> = {
    halal: '#15803d', // green-700 — universal halal color
    vegan: '#0369a1', // blue-700 — vegan
    general: C.accent,
  };

  const isKo = lang === 'ko';

  let html = `<div style="margin-bottom:20px;page-break-inside:avoid;" class="pdf-rec-restaurants">
    <h3 style="font-size:15px;font-weight:700;color:${C.heading};margin:0 0 4px;">${sectionTitle}</h3>
    <p style="font-size:10px;color:${C.muted};margin:0 0 12px;">${sectionSubtitle}</p>`;

  for (const { style, list } of buckets) {
    const color = STYLE_COLOR[style] || C.accent;
    html += `<div style="margin-bottom:14px;">
      <div style="display:inline-block;font-size:10px;font-weight:700;color:white;background:${color};padding:2px 8px;border-radius:3px;margin-bottom:8px;">${styleLabel(style)}</div>`;

    if (!list || list.length === 0) {
      // Dietary bucket empty — show hint (SAFETY: silence 금지)
      if (style !== 'general') {
        html += `<p style="font-size:10px;color:${C.muted};margin:0 0 4px;">${noneLabel}</p>`;
      }
      html += `</div>`;
      continue;
    }

    // Cards — page break after 6 cards
    const CARDS_PER_PAGE = 6;
    html += `<table style="width:100%;border-collapse:collapse;">`;

    list.forEach((r, idx) => {
      const displayName = isKo ? r.name : (r.nameEn || r.name);
      const cuisine = isKo ? (r.cuisineKo || r.cuisine) : (r.cuisine || r.cuisineKo);
      const district = isKo ? (r.dong || '') : (r.dongEn || r.dong || '');

      // Page break hint after every CARDS_PER_PAGE cards
      const breakClass = idx > 0 && idx % CARDS_PER_PAGE === 0 ? ' pdf-day-break' : '';

      html += `<tr${breakClass ? ` class="${breakClass.trim()}"` : ''}>
        <td style="padding:4px 0;vertical-align:top;">
          <div style="background:${C.cardBg};border:1px solid ${C.border};border-left:3px solid ${color};border-radius:6px;padding:8px 10px;margin-bottom:6px;page-break-inside:avoid;break-inside:avoid;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="vertical-align:top;padding:0;">
                  <p style="font-size:12px;font-weight:700;color:${C.heading};margin:0;">${displayName}</p>
                  ${!isKo && r.name !== displayName ? `<p style="font-size:10px;color:${C.muted};margin:1px 0 0;">${r.name}</p>` : ''}
                </td>
                ${r.rating ? `<td style="vertical-align:top;text-align:right;padding:0 0 0 6px;white-space:nowrap;"><span style="font-size:11px;font-weight:700;color:#b45309;">&#9733; ${r.rating.toFixed(1)}</span></td>` : ''}
              </tr>
            </table>
            <p style="font-size:10px;color:${C.sub};margin:3px 0 0;">
              ${[
                cuisine,
                district,
                r.reviewCount !== undefined ? `${r.reviewCount.toLocaleString()} ${reviewsLabel}` : '',
                r.nearestStopKm !== undefined ? `${r.nearestStopKm}${kmAwayLabel}` : '',
              ].filter(Boolean).join(' · ')}
            </p>
            ${r.address ? `<p style="font-size:9px;color:${C.muted};margin:2px 0 0;">${r.address}</p>` : ''}
            ${r.googleMapsUrl ? `<p style="font-size:9px;margin:3px 0 0;"><a href="${r.googleMapsUrl}" style="color:${color};text-decoration:underline;">${openMapLabel}</a></p>` : ''}
          </div>
        </td>
      </tr>`;
    });

    html += `</table></div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Phase 3 (2026-04-27): server-side Puppeteer PDF 시도 → 실패 시 client html2pdf fallback.
 * `VITE_USE_SERVER_PDF=true` env로 활성화. plan에 `id` 필요.
 * Firebase ID token으로 인증, plan 소유자만 다운로드 가능.
 *
 * P92 (2026-05-18): `force` 옵션 — VITE flag 무시하고 강제 호출. client capture
 * cut-off 감지 시 자동 escalate 경로로 사용. 운영자가 VITE_USE_SERVER_PDF 안
 * 켜둔 환경에서도 cut-off 발생 시 자동 server 복구 가능.
 */
async function tryServerPdf(plan: PlanDocument, opts: { force?: boolean } = {}): Promise<Blob | null> {
  if (!opts.force && import.meta.env.VITE_USE_SERVER_PDF !== 'true') return null;
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

// PDF 실패 안내 토스트 4언어 (2026-07-17 — 영어 하드코딩 해소).
// generatePDF(lang) 스코프에서 resolvePdfToast(lang) 로 조회. 신규 문자열 4언어 동시 유지.
const PDF_TOAST_STR = {
  en: {
    empty: 'PDF content is empty. Please wait for the plan to fully load.',
    fontFail: 'PDF font load failed',
    fontFailDesc: 'Korean fonts did not load in time. Try again in a moment, or request a manual PDF via WhatsApp.',
    renderFail: 'PDF content failed to render',
    renderFailDesc: 'Try refreshing the page and download again.',
    tooLong: 'Itinerary too long for in-browser PDF',
    tooLongDesc: 'Very long plans (15+ days) hit mobile memory limits. We can send a manually-rendered PDF via WhatsApp.',
    missingDays: 'PDF generated with missing days',
    missingDaysDesc: 'Auto-recovery failed. We can send a manually-rendered full PDF via WhatsApp.',
    manualDesc: 'We can send the PDF manually via WhatsApp.',
    openWhatsApp: 'Open WhatsApp',
    requestWhatsApp: 'Request via WhatsApp',
    stillBuilding: 'AI is still building your plan — please try again shortly.',
    notReady: 'Plan is not ready yet — please try again.',
  },
  ko: {
    empty: 'PDF 내용이 비어 있어요. 플랜이 모두 로드된 뒤 다시 시도해 주세요.',
    fontFail: 'PDF 폰트 로드 실패',
    fontFailDesc: '한글 폰트가 제때 로드되지 않았어요. 잠시 후 다시 시도하거나 WhatsApp 으로 수동 PDF 를 요청하세요.',
    renderFail: 'PDF 내용 렌더링 실패',
    renderFailDesc: '페이지를 새로고침한 뒤 다시 다운로드해 보세요.',
    tooLong: '일정이 너무 길어 브라우저 PDF 생성이 어려워요',
    tooLongDesc: '아주 긴 플랜(15일+)은 모바일 메모리 한계에 걸려요. WhatsApp 으로 수동 제작 PDF 를 보내드릴 수 있어요.',
    missingDays: '일부 날짜가 누락된 PDF 가 생성됐어요',
    missingDaysDesc: '자동 복구에 실패했어요. WhatsApp 으로 전체 PDF 를 보내드릴 수 있어요.',
    manualDesc: 'WhatsApp 으로 PDF 를 수동 전송해 드릴 수 있어요.',
    openWhatsApp: 'WhatsApp 열기',
    requestWhatsApp: 'WhatsApp 으로 요청',
    stillBuilding: 'AI가 아직 플랜을 만들고 있어요. 완료 후 다시 시도해 주세요.',
    notReady: '플랜이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.',
  },
  ja: {
    empty: 'PDFの内容が空です。プランが完全に読み込まれてから再試行してください。',
    fontFail: 'PDFフォントの読み込みに失敗しました',
    fontFailDesc: '韓国語フォントが時間内に読み込まれませんでした。しばらくして再試行するか、WhatsAppで手動PDFをご依頼ください。',
    renderFail: 'PDF内容のレンダリングに失敗しました',
    renderFailDesc: 'ページを更新してから再度ダウンロードしてください。',
    tooLong: '旅程が長すぎてブラウザでのPDF生成ができません',
    tooLongDesc: '非常に長いプラン（15日以上）はモバイルのメモリ制限にかかります。WhatsAppで手動作成PDFをお送りできます。',
    missingDays: '一部の日程が欠けたPDFが生成されました',
    missingDaysDesc: '自動復旧に失敗しました。WhatsAppで完全なPDFをお送りできます。',
    manualDesc: 'WhatsAppでPDFを手動送信できます。',
    openWhatsApp: 'WhatsAppを開く',
    requestWhatsApp: 'WhatsAppで依頼',
    stillBuilding: 'AIがまだプランを作成中です。完成後にもう一度お試しください。',
    notReady: 'プランはまだ準備できていません。しばらくしてから再試行してください。',
  },
  zh: {
    empty: 'PDF内容为空。请等待行程完全加载后重试。',
    fontFail: 'PDF字体加载失败',
    fontFailDesc: '韩文字体未能及时加载。请稍后重试，或通过WhatsApp索取手动PDF。',
    renderFail: 'PDF内容渲染失败',
    renderFailDesc: '请刷新页面后重新下载。',
    tooLong: '行程过长，无法在浏览器中生成PDF',
    tooLongDesc: '超长行程（15天以上）会超出手机内存限制。我们可以通过WhatsApp发送手动制作的PDF。',
    missingDays: '生成的PDF缺少部分日程',
    missingDaysDesc: '自动恢复失败。我们可以通过WhatsApp发送完整PDF。',
    manualDesc: '我们可以通过WhatsApp手动发送PDF。',
    openWhatsApp: '打开WhatsApp',
    requestWhatsApp: '通过WhatsApp索取',
    stillBuilding: 'AI仍在生成您的行程，请稍后重试。',
    notReady: '行程尚未准备好，请稍后重试。',
  },
};
function resolvePdfToast(lang: string) {
  return PDF_TOAST_STR[lang as keyof typeof PDF_TOAST_STR] || PDF_TOAST_STR.en;
}

export async function generatePDF(
  plan: PlanDocument,
  uiDict?: PdfUiDict,
  transitDict?: Record<string, string | undefined>,
  lang: string = 'en',
): Promise<void> {
  if (!plan) return;
  const toastStr = resolvePdfToast(lang);

  // P207 Layer 2 — frontend guard (client PDF path 도 막음).
  // server 422 가 client fallback path 를 통해 우회되는 경우 대비.
  // deep-search: reports/visual-2026-05-26/deepsearch-p207.md §5-1.
  if (!plan?.itinerary?.days?.length) {
    const isStreaming = (plan as Record<string, unknown>)._streaming_in_progress === true;
    toast.error(
      isStreaming
        ? toastStr.stillBuilding
        : toastStr.notReady,
    );
    return;
  }

  const pdfStartTs = Date.now();
  const planIdForTrack = (plan as { id?: string }).id;

  // Phase 3: server-side PDF 우선 시도 (활성화 시). 실패하면 기존 클라이언트 경로로.
  const serverPdf = await tryServerPdf(plan);
  if (serverPdf) {
    // PR #456 (Audit Z-H14): openBlobSafely tries <a download> first
    // (iOS 13+ supports it for blob URLs and it bypasses the popup
    // blocker that silently killed window.open(blob:) on iOS Safari).
    // Falls back to window.open + popup-blocker detection so failures
    // surface to the user instead of being silent.
    const titleSlug = ((plan.itinerary?.tour_title as string) || 'korea-trip')
      .replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'korea-trip';
    const filename = `cocotrip-${titleSlug}-${plan.input?.startDate || 'undated'}.pdf`;
    const openResult = openBlobSafely({ blob: serverPdf, filename });
    if (!openResult.ok) {
      console.warn('[PDF] server-side open failed:', openResult.reason);
    }
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
  // Launch P1-3 (2026-05-10): tip / tip_en 추가 — 다국어 사용자 plan 의 한국어
  // tip 그대로 PDF 노출되는 회귀 fix. (예: en 사용자 plan tip 에 "강남역 출구..." 한글 누수)
  try {
    const { sanitizeStopName } = await import('@/lib/sanitizeName');
    const lng = (lang as 'ko'|'en'|'ja'|'zh') || 'ko';
    const days = (plan.itinerary?.days as Array<{stops?: Array<Record<string, unknown>>}>) || [];
    for (const day of days) {
      for (const stop of (day.stops || [])) {
        for (const f of ['name', 'display_name', 'tip', 'tip_en']) {
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
  // 2026-05-12 (PDF P0 root cause fix, rev 2): \uC57D\uD654\uB41C <style> + windowHeight \uAC15\uC81C.
  // PR #351 (\uC120\uC81C \uC815\uC758) \uB294 selector matched 4/4 \u2713 \uD574\uACB0\uD588\uC73C\uB098
  // !important \uAC00 \uB108\uBB34 \uAC15\uD574 selector \uB9E4\uCE6D \uC2DC \uACBD\uD5D8\uC801 capture clip \uBD80\uC791\uC6A9 \uBC1C\uC0DD.
  // Playwright \uC7AC\uAC80\uC99D: scrollHeight 3720px (\uC608\uC0C1 7500-8500px), \uAC01 \uD398\uC774\uC9C0 70-95% bottom blank.
  // Root cause: !important \uACFC\uB3C4 + html2canvas viewport \uAE30\uBCF8 (900px) \uB9CC capture.
  // \uC218\uC815: (1) <style> \uC5D0\uC11C .pdf-day-break \uB9CC \uB0A8\uAE40 \u2014 \uB098\uBA38\uC9C0\uB294 inline style \uACFC \uC911\uBCF5
  // (2) !important \uC81C\uAC70 \u2014 \uC77C\uBC18 page-break-before \uB9CC\uC73C\uB85C \uCDA9\uBD84
  // (3) html2pdf options \uC758 windowHeight \uB97C Math.max(scrollHeight, 10000) \uAC15\uC81C (L1110)
  let html = `<style>
    .pdf-day-break { page-break-before: always; break-before: page; }
  </style><div style="text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid ${C.accent};">
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
          public_transit: 'Public Transit', // P-launch: AREX 직통 합성 실패 시 중립 추천
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
          public_transit: 'Public Transit', // P-launch: AREX 직통 합성 실패 시 중립 추천
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
  // 2026-05-11 (PDF P0 fix): days.length assert — Day 5 통째 누락 회귀 진단.
  //  - days 가 undefined / null / 빈 배열이면 build 시점에 명시적 경고
  //  - 실제 plan.itinerary.days 길이와 PDF html builder forEach 카운트 일치 검증
  // Track 2 분석 보고: 5일 plan PDF 에서 Day 4 후반 + Day 5 전체 누락.
  console.log('[PDF] days.length =', days.length, '— rendering all days');
  if (!Array.isArray(days) || days.length === 0) {
    console.error('[PDF] days array empty or invalid — PDF body will be incomplete');
  }
  let dayRenderCount = 0;

  days.forEach((day: PlanDay, di: number) => {
    dayRenderCount += 1;
    // B9-34: di>0 day wrapper 에 pdf-day-break 클래스 → pagebreak.before 새 페이지.
    // B9-39: 다도시 plan 의 도시 chip 라벨 — 헤더에 표시.
    // 2026-05-11 (PDF P0 fix): 인라인 page-break-before:always 제거 — Track 2 분석 보고.
    //   직전(2026-05-10 B10-4) 에 inline 이중 강제로 추가했지만 부작용 = 페이지 상단
    //   75% 백색 공간 (사용자 다운로드 PDF 검증). selector .pdf-day-break + before 매칭
    //   (pagebreak.before L1007) 만으로 충분. mode: ['css', 'legacy'] 이미 적용중이라
    //   selector 무시 케이스도 legacy 폴백으로 커버됨.
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

    // 2026-06-02 SAFETY: 트레킹/러닝 day 의 난이도·위험·부적합·컷오프를 PDF 에도 렌더 (오프라인 등산객 안전 —
    // 화면 ActivityMetaChips 와 동일 라벨 src/lib/activityMetaLabels SSOT). activity_meta 없으면 '' (additive, byte-identical).
    html += buildActivityMetaHtml(day.activity_meta, lang as 'ko' | 'en' | 'ja' | 'zh');

    // B9-39 (2026-05-09): 도시 간 이동 카드 (KTX/SRT/Air/Bus) — 다도시 plan.
    // intercity_transit 가 있을 때만 노출. page-break-inside:avoid 로 카드 단위 보존.
    const ic = day.intercity_transit as Record<string, unknown> | undefined;
    // B7 (P308): mode/est_min/est_fare_krw 우선, P291~P308 오명명 plan 은 method/duration_min/cost_krw 폴백.
    if (ic && (ic.mode || ic.method)) {
      const icLabels = (uiDict as { intercity?: Record<string, string> } | undefined)?.intercity || {};
      const modeStr = String(ic.mode || ic.method);
      const icEstMin = ic.est_min ?? ic.duration_min;
      const icEstFare = ic.est_fare_krw ?? ic.cost_krw;
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
      const durationText = icEstMin ? durationTpl.replace('{{min}}', String(icEstMin)) : '';
      const fareText = icEstFare ? fareTpl.replace('{{krw}}', Number(icEstFare).toLocaleString()) : '';
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

    // P239 (2026-05-27): Day 1 = lodging only 안내 PDF 카드 — 운영자 architectural fix.
    // 새벽 도착 시 호텔만 + 다음날 tour_start_time (default 09:00) 부터 stops 시작.
    // 클라이언트 UI (DayTimeline) 와 동일 카드. stopsLen <= 1 AND day.day === 1 만.
    if ((day.day === 1 || di === 0) && (day.stops || []).length <= 1) {
      const tourStart = (input as { tour_start_time?: string; tourStartTime?: string }).tour_start_time
        || (input as { tour_start_time?: string; tourStartTime?: string }).tourStartTime
        || '09:00';
      html += `<div style="margin-bottom:14px;background:rgba(124,92,252,0.06);border:1px solid rgba(124,92,252,0.25);border-radius:6px;padding:10px 12px;page-break-inside:avoid;break-inside:avoid;">
        <p style="font-size:12px;font-weight:700;color:${C.accent};margin:0 0 4px;">🌙 Late arrival? Rest at your hotel</p>
        <p style="font-size:10.5px;color:${C.muted};margin:0;line-height:1.5;">Your tour starts tomorrow at ${tourStart}.</p>
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
    // 2026-05-11 (PDF P0 fix): transit_from_prev 부재/sparse 케이스 에 대해 haversine
    // fallback 으로 도보·이동 시간 추정해 day header 합계 에 반영. 기존 코드 는 transit
    // 데이터 없을 때 "—" 로 표시 — 사용자 신고 "Walking/Transit dash 만 뜸". 농어촌·부산
    // 시외·ODsay null 케이스 일관성 확보.
    for (let i = 0; i < stopsArr.length; i++) {
      const s = stopsArr[i];
      const tprev = s.transit_from_prev as { total_walk_m?: number; est_min?: number; steps_detail?: unknown[]; step_by_step?: string[] } | undefined;
      const hasRich = !!tprev && (((tprev.steps_detail || []).length > 0) || ((tprev.step_by_step || []).length > 0) || (tprev.total_walk_m || 0) > 0);
      if (hasRich) {
        if (tprev?.total_walk_m) totalWalkM += tprev.total_walk_m;
        if (tprev?.est_min) totalTransitMin += tprev.est_min;
      } else if (i > 0) {
        // Haversine fallback — 좌표 둘 다 있어야 추정 가능.
        const prev = stopsArr[i - 1];
        const pLat = (prev as { lat?: number | null })?.lat;
        const pLng = (prev as { lng?: number | null })?.lng;
        const cLat = (s as { lat?: number | null })?.lat;
        const cLng = (s as { lng?: number | null })?.lng;
        if (pLat != null && pLng != null && cLat != null && cLng != null) {
          const φ1 = (pLat * Math.PI) / 180;
          const φ2 = (cLat * Math.PI) / 180;
          const Δφ = ((cLat - pLat) * Math.PI) / 180;
          const Δλ = ((cLng - pLng) * Math.PI) / 180;
          const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
          const distM = Math.round(2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000);
          if (distM < 2000) {
            totalWalkM += distM;
            totalTransitMin += Math.max(3, Math.round(distM / 70));
          } else {
            // ≥2km — 도보 가정 X. 대중교통 평균 시속 25km 가정 → 분 환산.
            totalTransitMin += Math.max(5, Math.round((distM / 1000) / 25 * 60));
          }
        }
      }
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

    (day.stops || []).forEach((stop: PlanStop, si: number) => {
      // 2026-05-10 B10-4 phase 1: transit_from_prev 미부착 케이스 (RouteAgent ODsay
      // null + 농어촌) 에 fallback (도보/택시 안내 또는 Naver deep link). 좌표
      // 둘 다 있어야 거리 계산 가능 — 없으면 silent skip 유지.
      //
      // 2026-05-11 (PDF P0 fix B-7): "transit_from_prev 가 있어도 step 정보가
      // 비어있을 때" 도 fallback 트리거. Track 2 사용자 보고: "stop 사이 transit
      // 안내 100% 부재 — '무료' 만 반복". 진단: RouteAgent 가 method 만 채우고
      // steps_detail/step_by_step 비워 보낸 경우 (PDF builder L514-660 이 사실상
      // 빈 박스 렌더) 이걸 sparse 케이스로 보고 fallback 까지 같이 출력.
      const tprevForStop = stop.transit_from_prev;
      const sparseTransit = !!tprevForStop
        && !((tprevForStop as { steps_detail?: unknown[] }).steps_detail || []).length
        && !(tprevForStop.step_by_step || []).length;
      const needsFallback = (!tprevForStop || sparseTransit) && si > 0;
      if (needsFallback) {
        const prevStop = (day.stops || [])[si - 1];
        const pLat = (prevStop as { lat?: number | null })?.lat;
        const pLng = (prevStop as { lng?: number | null })?.lng;
        const cLat = (stop as { lat?: number | null }).lat;
        const cLng = (stop as { lng?: number | null }).lng;
        if (pLat != null && pLng != null && cLat != null && cLng != null) {
          // haversine km
          const φ1 = (pLat * Math.PI) / 180;
          const φ2 = (cLat * Math.PI) / 180;
          const Δφ = ((cLat - pLat) * Math.PI) / 180;
          const Δλ = ((cLng - pLng) * Math.PI) / 180;
          const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
          const distKm = 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distM = Math.round(distKm * 1000);
          // 4-lang inline (uiDict 별도 namespace 통합은 follow-up). PDF 가 한국어
          // / 일본어 / 중국어 plan 도 같이 만들어지니 lang 분기로 텍스트 매핑.
          const walkTpl = lang === 'ko' ? '🚶 도보 약 {walk}분 · 또는 택시 ~₩{taxi} ({dist}m)'
            : lang === 'ja' ? '🚶 徒歩約{walk}分 · またはタクシー ~₩{taxi}（{dist}m）'
            : lang === 'zh' ? '🚶 步行约{walk}分钟 · 或出租车 ~₩{taxi}（{dist}m）'
            : '🚶 ~{walk}min walk · or taxi ~₩{taxi} ({dist}m)';
          const linkTpl = lang === 'ko' ? '📍 네이버 지도 길찾기 · {dist}km'
            : lang === 'ja' ? '📍 Naverマップで経路を見る · {dist}km'
            : lang === 'zh' ? '📍 在 Naver 地图查看路线 · {dist}km'
            : '📍 View transit on Naver Map · {dist}km';
          if (distKm < 2) {
            const walkMin = Math.max(3, Math.round(distM / 70));
            const taxiKRW = 4800 + Math.max(0, Math.ceil((distM - 1600) / 132)) * 100;
            const walkText = walkTpl.replace('{walk}', String(walkMin)).replace('{taxi}', taxiKRW.toLocaleString('ko-KR')).replace('{dist}', String(distM));
            html += `<div class="pdf-transit-block" style="margin:4px 0 6px 16px;padding:6px 12px;background:rgba(245,158,11,0.06);border-left:3px solid rgba(245,158,11,0.4);border-radius:4px;page-break-inside:avoid;break-inside:avoid;">
              <p style="font-size:10px;color:#fbbf24;font-weight:600;margin:0;">${walkText}</p>
            </div>`;
          } else {
            // 빈 파라미터 방지 (구 plan 호환): 기존 순서(display_name || name) 보존 + name_en/name_ko 를
            // 둘 다 없을 때만 last-resort 로 추가 → 공통 경로 byte-identical, 깨진 네이버 링크만 방지.
            const ps = prevStop as { display_name?: string; name?: string; name_en?: string; name_ko?: string };
            const cs = stop as { display_name?: string; name?: string; name_en?: string; name_ko?: string };
            const prevName = ps.display_name || ps.name || ps.name_en || ps.name_ko || '';
            const currName = cs.display_name || cs.name || cs.name_en || cs.name_ko || '';
            const enc = encodeURIComponent;
            const naverUrl = `https://map.naver.com/v5/directions/${pLng},${pLat},${enc(prevName)}/${cLng},${cLat},${enc(currName)}/-/transit?c=15`;
            const linkText = linkTpl.replace('{dist}', distKm.toFixed(1));
            html += `<div class="pdf-transit-block" style="margin:4px 0 6px 16px;padding:6px 12px;background:rgba(3,199,90,0.08);border-left:3px solid rgba(3,199,90,0.4);border-radius:4px;page-break-inside:avoid;break-inside:avoid;">
              <p style="font-size:10px;color:#5DDB91;font-weight:600;margin:0;"><a href="${naverUrl}" style="color:#5DDB91;text-decoration:underline;">${linkText}</a></p>
            </div>`;
          }
        }
      }

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

  // 2026-05-11 (PDF P0 fix): post-loop assert — Day 5 통째 누락 진단.
  //  - dayRenderCount 가 days.length 와 일치해야 모든 day 가 html 빌더에 들어감.
  //  - 5일 plan PDF 에서 Day 5 누락 보고됨 — forEach 가 throw 한 경우 console 에 흔적.
  if (dayRenderCount !== days.length) {
    console.error('[PDF] day render mismatch — expected', days.length, 'got', dayRenderCount);
  } else {
    console.log('[PDF] all', dayRenderCount, 'days rendered to html builder');
  }

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

  // Activity Guide (#786) — 화면 activityGuide 슬라이드와 동일 콘텐츠(ACTIVITY_GUIDES SSOT).
  // 화면과 동일 플래그 게이트 → OFF 시 미출력(byte-identical). 오프라인 여행 참조용 — 따릉이/러닝/
  // 트레킹 how-to + 따릉이 외국카드 SAFETY 경고가 다운로드 PDF 에도 포함되도록(#786 PDF 누락 갭 봉합).
  if (String(import.meta.env.VITE_FEATURE_ACTIVITY_GUIDE || '').trim() === 'true') {
    html += buildActivityGuideHtml(plan, lang as 'ko' | 'en' | 'ja' | 'zh');
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

  // P193 (2026-05-25) SAFETY-CRITICAL \u2014 Recommended restaurants section (Halal/Vegan/General)
  // \uBB34\uC2AC\uB9BC/\uBE44\uAC74 \uC678\uAD6D\uC778 visitor PDF \uC5D0 \uC2DD\uC774\uC81C\uD55C \uC2DD\uB2F9 \uC815\uBCF4 0\uAC74 \uC704\uD5D8 \uC81C\uAC70.
  // buildRecommendedRestaurantsSection \uC740 itinerary.recommended_restaurants \uAC00 \uC5C6\uC73C\uBA74 '' \uBC18\uD658.
  const recRestHtml = buildRecommendedRestaurantsSection(
    it as unknown as Record<string, unknown>,
    lang,
    uiDict,
    C,
  );
  if (recRestHtml) {
    html += recRestHtml;
  }

  // Footer
  html += `<div style="text-align:center;border-top:1px solid ${C.border};padding-top:16px;margin-top:20px;">
    <p style="font-size:11px;color:${C.muted};margin:0;">WhatsApp: +82-10-8714-0611 | cocotripkr.com</p>
    <p style="font-size:9px;color:#bbb;margin:4px 0 0;">\u00A9 CocoTrip \u00B7 Korea Private Tour Specialist</p>
  </div>`;

  // 2026-06-10 end-sentinel: \uBB38\uC11C \uB9E8 \uB05D \uC5B4\uB450\uC6B4 \uBC14. \uCEA1\uCC98 \uD6C4 canvas \uD558\uB2E8 \uC2A4\uCE94\uC73C\uB85C \uC2E4\uC7AC \uD655\uC778 \u2014
  // pagebreak \uC778\uD50C\uB808\uC774\uC158\uC73C\uB85C \uAF2C\uB9AC(Day \uD6C4\uBC18/\uC608\uC0B0/\uC2DD\uB2F9/\uCD9C\uAD6D)\uAC00 \uD074\uB9AC\uD551\uB418\uBA74 \uC774 \uBC14\uAC00 canvas \uC5D0
  // \uC5C6\uC74C -> \uBD88\uC644\uC804 PDF \uB2E4\uC6B4\uB85C\uB4DC\uB97C \uACB0\uC815\uC801\uC73C\uB85C \uCC28\uB2E8 (pdfGenerator end-sentinel check \uCC38\uC870).
  html += `<div class="pdf-end-sentinel" style="padding:10px 0 2px;display:flex;justify-content:center;">
    <div style="width:260px;height:6px;background:#444;border-radius:3px;"></div>
  </div>`;

  container.innerHTML = html;

  // 2026-05-12 (PDF P0 root cause fix): DOM settle + selector match validation.
  // Track 4 console 분석: `[PDF] all 5 days rendered` (html builder OK) 인데
  // scrollHeight 3756px 로 clip. innerHTML 직후 layout 미완료 가능 — 짧은 await
  // 으로 settle 보장 후 진단.
  await new Promise(resolve => setTimeout(resolve, 100));
  void container.offsetHeight; // force reflow

  console.log('[PDF] post-render container.scrollHeight:', container.scrollHeight);
  console.log('[PDF] post-render container.offsetHeight:', container.offsetHeight);
  console.log('[PDF] post-render container.getBoundingClientRect():', container.getBoundingClientRect());
  console.log('[PDF] window.innerHeight:', window.innerHeight);

  // selector match validation — pagebreak.before / avoid selector 가 실제 DOM 에 매칭되는지 확인.
  // PR #348 가 인라인 page-break-before:always 제거 → .pdf-day-break selector 만 의존.
  // CSS class 정의 (<style> 태그 inject) 가 있어야 css mode 매칭 정상.
  const dayBreakElements = container.querySelectorAll('.pdf-day-break').length;
  const expectedBreaks = Math.max(0, days.length - 1); // Day 1 은 break 없음
  console.log('[PDF] .pdf-day-break selector matched:', dayBreakElements, 'expected:', expectedBreaks);
  if (dayBreakElements !== expectedBreaks) {
    console.error('[PDF] day-break selector mismatch — expected', expectedBreaks, 'got', dayBreakElements);
  }
  const stopCardCount = container.querySelectorAll('.pdf-stop-card').length;
  const dayWrapperCount = container.querySelectorAll('.pdf-day-wrapper').length;
  console.log('[PDF] selector counts — day-wrappers:', dayWrapperCount, 'stop-cards:', stopCardCount);

  // parent overflow audit — container parent chain 의 overflow / max-height 제약 진단.
  // 만약 부모가 clip 한다면 html2canvas 가 그 영역만 capture 할 수 있음.
  let parentEl = container.parentElement;
  let parentChainDepth = 0;
  while (parentEl && parentChainDepth < 10) {
    const style = window.getComputedStyle(parentEl);
    if (style.overflow !== 'visible' && style.overflow !== '') {
      console.warn('[PDF] parent overflow constraint:', parentEl.tagName, 'overflow=', style.overflow);
    }
    if (style.maxHeight !== 'none' && style.maxHeight !== '') {
      console.warn('[PDF] parent maxHeight constraint:', parentEl.tagName, 'maxHeight=', style.maxHeight);
    }
    parentEl = parentEl.parentElement;
    parentChainDepth += 1;
  }

  // === 빈 콘텐츠 방지: 최소 높이/텍스트 검증 ===
  if (container.scrollHeight < 100 || container.innerText.trim().length < 50) {
    console.error('[PDF] Empty content detected — aborting PDF generation');
    document.body.removeChild(container);
    document.body.removeChild(overlay);
    toast.error(toastStr.empty);
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
      toast.error(toastStr.fontFail, {
        description: toastStr.fontFailDesc,
        action: { label: toastStr.openWhatsApp, onClick: () => window.open(fontFailUrl, '_blank') },
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
  //
  // PR #454 (Audit Z-H11 — 2026-05-16): Tripadvisor / Google Places /
  // 기타 CDN 은 CORS 헤더 안 보냄 → 같은 origin (cocotripkr.com) 이 아닌
  // 이미지는 위 fetch 가 CORS 실패 → 빈 박스 PDF. 외부 origin 이미지는
  // /api/image-proxy 로 보내서 서버가 fetch 한 뒤 CORS 헤더 추가해
  // 반환하도록. SSRF 방어는 image-proxy.js 가 allowlist 로 처리.
  const sameOrigin = window.location.origin;
  const toFetchableUrl = (src: string): string => {
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return src;
    try {
      const u = new URL(src, sameOrigin);
      if (u.origin === sameOrigin) return src; // 같은 origin 은 직접 fetch
      return `/api/image-proxy?url=${encodeURIComponent(u.toString())}`;
    } catch {
      return src;
    }
  };

  const imgs = Array.from(container.querySelectorAll('img'));
  if (imgs.length > 0) {
    await Promise.allSettled(imgs.map(async (img) => {
      const src = img.src;
      // 이미 data: URL이면 스킵
      if (!src || src.startsWith('data:')) return;
      const fetchUrl = toFetchableUrl(src);
      try {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(fetchUrl, { signal: ctrl.signal, mode: 'cors' });
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
        console.warn('[PDF] image preload failed for', src, '(fetch via', fetchUrl, ')', e);
      }
    }));
    // 이미지 src 변경 후 layout settle 대기
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // P92 (2026-05-18): 이미지 src 갱신 후 실제 브라우저가 새 비트맵 decode + layout
  // 반영을 끝낼 때까지 진짜 대기. 기존 setTimeout(200+300=500ms) 만으로는 7+일 plan
  // 처럼 이미지가 많은 케이스에서 늦게 도착한 이미지가 measuredHeight 측정 후 layout
  // 늘리며 capture 영역 밖으로 밀려남 (Day 6 후반 + Day 7 + Wrap-up 누락 사례).
  // load/error 둘 다 layout 은 안정화되므로 둘 다 신호로 사용. 5초 hard cap.
  const allImgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(allImgs.map(img => {
    if (img.complete && img.naturalHeight > 0) return Promise.resolve();
    return new Promise<void>(res => {
      const done = () => res();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 5000);
    });
  }));

  // Additional settle time for layout recalculation
  await new Promise(resolve => setTimeout(resolve, 300));
  void container.offsetHeight; // force reflow
  // double rAF — 브라우저가 다음 paint 이후까지 진행 보장
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));

  // === 백지 root cause fix (2026-04-27): explicit height 명시 ===
  // 사용자 신고 → empty canvas h=0 진단. html2canvas/html2pdf는 element clone 시
  // measurement를 다시 하는데, position:absolute 컨테이너의 height 측정에 실패하면
  // 0px canvas 생성 → 백지 PDF. scrollHeight를 explicit height로 박아서 확실히 측정되게 함.
  //
  // P92 (2026-05-18): 단일 측정 → 안정화 측정. scrollHeight 가 2회 연속 같을 때까지
  // 200ms 간격으로 최대 5회 측정. 늦게 도착하는 이미지/폰트 reflow 가 끝나지 않은
  // 시점에 측정하면 짧게 잡혀서 capture 가 일부 day 를 잘랐던 사례 회귀 방지.
  let h1 = container.scrollHeight;
  let h2 = -1;
  let stableTries = 0;
  while (h1 !== h2 && stableTries < 5) {
    await new Promise(resolve => setTimeout(resolve, 200));
    h2 = h1;
    h1 = container.scrollHeight;
    stableTries += 1;
  }
  if (h1 !== h2) {
    console.warn('[PDF] scrollHeight did not stabilize after', stableTries, 'tries — last:', h1, 'prev:', h2);
  } else {
    console.log('[PDF] scrollHeight stabilized at', h1, 'after', stableTries, 'tries');
  }
  const measuredHeight = h1;
  if (measuredHeight > 0) {
    container.style.height = `${measuredHeight}px`;
    container.style.minHeight = `${measuredHeight}px`;
  } else {
    console.error('[PDF] container.scrollHeight=0 — content not rendered. Aborting.');
    document.body.removeChild(container);
    document.body.removeChild(overlay);
    toast.error(toastStr.renderFail, {
      description: toastStr.renderFailDesc,
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
    toast.warning(toastStr.tooLong, {
      description: toastStr.tooLongDesc,
      action: { label: toastStr.requestWhatsApp, onClick: () => window.open(tooLongUrl, '_blank') },
      duration: 12000,
    });
    return;
  }
  console.log('[PDF] adaptive scale:', pdfScale, 'for scrollHeight:', scrollH);

  // 2026-05-12 (PDF P0 root cause fix): pre-capture diagnostic — track scrollHeight
  // 추세. 사용자 신고 "5일 plan 3756px" — 5일 평균 1500-1700px/day 면 7500-8500px 예상.
  // 절반 이하 = day collapsed 또는 capture clip 의 증거. 이 로그 + .pdf-day-break
  // selector match log 비교 시 root cause 명확.
  console.log('[PDF] pre-capture diagnostic — days:', days.length, 'scrollH:', scrollH, 'expected ~', days.length * 1500, '-', days.length * 1700);

  // P92 (2026-05-18): expected min-height hard gate (mistake-log P92, NOT to be
  // confused with P85 gemini-retry / P87 route-blind-fallback). 기존 warn-only
  // 가드는 fail-open 이라 7일 plan 의 Day 6 후반/Day 7/Wrap-up 누락 PDF 가 그대로
  // 다운로드됨 (사용자 보고 cocotrip-Guest-7--2026-05-18.pdf). expected =
  // days*800 + arrival*600 + departure*800 (실측 1500-1700/day 의 절반인 보수적
  // lower bound). 미만이면 abort + Telegram admin alert (capture 단 cut-off
  // 회귀 즉시 감지) + WhatsApp fallback.
  const expectedMinH = days.length * 800
    + (arrival ? 600 : 0)
    + (departure ? 800 : 0);
  if (scrollH < expectedMinH) {
    const cutPlanId = (typeof window !== 'undefined'
      ? (window.location.pathname.match(/my-plans\/([^/?#]+)/)?.[1] || '')
      : '');
    console.error('[PDF] capture height suspiciously short — got', scrollH, 'expected min', expectedMinH,
      '(days:', days.length, 'arrival:', !!arrival, 'departure:', !!departure, ') planId:', cutPlanId);

    // P92 자동 복구: VITE flag 무시하고 server-side Puppeteer endpoint 강제 호출.
    // 운영자가 VITE_USE_SERVER_PDF 안 켜둔 환경에서도 cut-off 검출 시 자동 복구.
    // 성공 시 사용자는 정상 PDF 를 받고 cut-off 발생을 모름 (운영자만 알림 받음).
    const serverPdfRecovery = await tryServerPdf(plan, { force: true });
    let recoveredViaServer = false;
    if (serverPdfRecovery) {
      const titleSlugRec = ((plan.itinerary?.tour_title as string) || 'korea-trip')
        .replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'korea-trip';
      const filenameRec = `cocotrip-${titleSlugRec}-${plan.input?.startDate || 'undated'}.pdf`;
      const openResult = openBlobSafely({ blob: serverPdfRecovery, filename: filenameRec });
      if (openResult.ok) {
        recoveredViaServer = true;
        console.log('[PDF] capture cut-off auto-recovered via server-side endpoint');
      } else {
        console.warn('[PDF] server-side blob open failed after auto-recovery:', openResult.reason);
      }
    }

    // Telegram admin alert — 자동 복구 성공/실패 둘 다 운영자가 봐야 함.
    // 성공 시: "감지+자동복구됨, env 점검 권고" 신호 / 실패 시: critical 수동 개입.
    void fetch('/api/alert-pdf-cutoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: cutPlanId,
        days: days.length,
        hasArrival: !!arrival,
        hasDeparture: !!departure,
        measuredHeight: scrollH,
        expectedMinHeight: expectedMinH,
        userAgent: navigator.userAgent,
        recoveredViaServer,
      }),
    }).catch(() => { /* fail-open — local toast 우선 */ });

    document.body.removeChild(container);
    document.body.removeChild(overlay);

    if (recoveredViaServer) {
      // 사용자에게는 무엇이 일어났는지 가볍게 표시 — 정상 PDF 가 이미 다운로드됨.
      toast.success(uiDict?.pdfReady || 'PDF ready', {
        description: 'High-quality version delivered automatically.',
        duration: 4000,
      });
      void posthogTrack('plan_downloaded', {
        planId: planIdForTrack,
        format: 'pdf-server-recovery',
        durationMs: Date.now() - pdfStartTs,
      });
      return;
    }

    // server 도 실패하면 그제야 WhatsApp fallback (수동 개입 경로).
    const cutMsg = `Hi CocoTrip! PDF capture cut-off detected for my plan${cutPlanId ? ` (${cutPlanId})` : ''} — auto-recovery also failed. Could you send it manually?`;
    const cutUrl = `https://wa.me/821087140611?text=${encodeURIComponent(cutMsg)}`;
    toast.error(toastStr.missingDays, {
      description: toastStr.missingDaysDesc,
      action: { label: toastStr.requestWhatsApp, onClick: () => window.open(cutUrl, '_blank') },
      duration: 15000,
    });
    return;
  }
  // 기존 warn 은 보존 — expected min 통과했지만 추세상 의심스러운 경우 logging
  if (days.length >= 3 && scrollH < days.length * 1000) {
    console.warn('[PDF] scrollHeight 추세 abnormal — days collapsed 의심. selector match 로그 확인');
  }

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
      description: toastStr.manualDesc,
      action: { label: toastStr.openWhatsApp, onClick: () => window.open(whatsappFallback, '_blank') },
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
    // 2026-05-12 (rev 3): rev 2 의 Math.max(measuredHeight, 10000) 가 measuredHeight=8265
    // 시 1735px 빈 영역 capture → html2canvas all-white canvas + download event 미발생.
    // 약화: safety margin +200 만 추가. measuredHeight 가 이미 정상이면 그대로 사용.
    // (PR #353 의 buildPrompt min stops + PR #355 의 RouteAgent TDZ fix 적용으로
    //  measuredHeight 가 7500-8500 정상 범위 회복됨 → 강제 10000 불필요.)
    // 2026-06-10 (5일 plan 꼬리 잘림 fix): html2pdf 는 pagebreak(before/avoid) 여백을 클론에
    // "삽입한 뒤" html2canvas 를 돌린다 -> 캡처 시점 실제 높이가 measuredHeight 보다 커짐
    // (5일 실측 +2400px). 기존 height:measuredHeight 강제가 그 인플레이션만큼 canvas 바닥을
    // 클리핑 -> Day 후반/예산표/추천식당/출국가이드 소실(B9-34 day-break 도입 후 잠재).
    // fix: height 강제 제거 = html2canvas 가 인플레이션 반영된 클론 scrollHeight 사용.
    // windowHeight 는 viewport 힌트 용도만(미지정 시 일부 환경 0 — 2026-05-12 rev3) ->
    // 인플레이션 상한(x1.5+800)으로 여유. 꼬리 누락은 아래 end-sentinel 검사가 fail-closed 차단.
    const forcedWindowHeight = Math.ceil(measuredHeight * 1.5) + 800;
    // html2canvas 옵션 — 1차(placeholder 높이)와 2차(클론 실높이) set 에서 공유.
    // height 를 measuredHeight 로 두면 pagebreak 인플레이션만큼 바닥 클리핑(꼬리 소실),
    // 아예 빼면 일부 환경에서 canvas h=0 (2026-05-12 + 2026-06-10 로컬 재확인) —
    // 그래서 toContainer() 후 "pagebreak 적용된 클론의 실높이" 를 측정해 2차 set 으로 주입.
    const html2canvasBase = {
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
      windowHeight: forcedWindowHeight,
      width: 800,
      scrollX: 0,
      scrollY: 0,
    };
    const worker = html2pdf().set({
      margin: [8, 8, 8, 8],
      filename,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: { ...html2canvasBase, height: measuredHeight },
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

    // 2026-06-10 (5일 plan 꼬리 잘림 fix): html2pdf 는 pagebreak(before/avoid) 여백을 클론에
    // "삽입한 뒤" html2canvas 를 돌린다 → 캡처해야 할 실높이가 measuredHeight 보다 커짐
    // (5일 실측 +2400px). 기존 height:measuredHeight 단일 set 은 그 인플레이션만큼 canvas
    // 바닥을 클리핑 → Day 후반/예산표/추천식당 소실(B9-34 day-break 도입 후 잠재).
    // fix = 2-pass: toContainer() 로 pagebreak 적용된 클론을 먼저 만들고 실높이를 측정,
    // 그 값으로 height/windowHeight 를 재설정한 뒤 toCanvas(). 측정 실패 시 보수적 fallback.
    await worker.toContainer();
    let clonedH = 0;
    try {
      const clonedEl = (await worker.get('container')) as HTMLElement | undefined;
      clonedH = clonedEl?.scrollHeight || 0;
    } catch { /* fallback below */ }
    const captureH = clonedH >= measuredHeight ? clonedH : forcedWindowHeight;
    console.log('[PDF] capture height (pagebreak 인플레이션 반영):', captureH,
      '(clonedH=', clonedH, ', measuredHeight=', measuredHeight, ')');
    await worker.set({ html2canvas: { ...html2canvasBase, height: captureH, windowHeight: captureH + 200 } });

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
    // 2026-05-12 사용자 prod 환경에서 PDF 다운로드 실패 보고. Playwright headless 도 동일.
    // 9개 sample point (코너+변+중앙) 가 모두 우연히 흰색 픽셀 매칭 → false positive 발생 가능.
    // 특히 page-break 가 활성된 환경에서 day 경계가 sample point 와 정확히 일치할 때 위험.
    //
    // 변경:
    // 1) sample 을 9 → 60 (코너 4 + 변 중앙 8 + 그리드 9 + 무작위 39) 으로 늘려 통계적 신뢰성 ↑
    // 2) 임계값을 0 → 5% 미만 nonWhite 일 때만 trigger (legit content 한 곳은 거의 항상 포함됨)
    // 3) 가드 자체를 hard return → soft warning + continue 로 약화. blob.size < 1024 가드가
    //    실제 빈 PDF 차단 (둘 다 통과 시 사용자가 빈 PDF 받음 → 운영자가 회귀 즉시 알아챌 수 있음).
    // 진짜 빈 PDF 보다 "다운로드 자체 실패" 가 사용자 인상 더 나쁨 — fail-open 으로 전환.
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const W = canvas.width, H = canvas.height;
      // 결정적 sample 21 개 (코너 4 + 변 중앙 4 + 3x3 그리드 9 중복 제외 = 13 + 변 1/3, 2/3 8 = 21)
      const points: [number, number][] = [];
      // 코너 4 + 변 중앙 4 + 정중앙 = 9
      points.push([0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]);
      points.push([W >> 1, 0], [W >> 1, H - 1], [0, H >> 1], [W - 1, H >> 1]);
      points.push([W >> 1, H >> 1]);
      // 3x3 내부 그리드 (1/4, 2/4, 3/4 위치) — 정중앙은 위에서 추가됨
      for (const xi of [W >> 2, (W >> 1) + (W >> 2)]) {
        for (const yi of [H >> 2, (H >> 1) + (H >> 2)]) {
          points.push([xi, yi]);
        }
      }
      // 변 1/3, 2/3 위치 8 개
      for (const f of [0.333, 0.667]) {
        const xf = Math.floor(W * f);
        const yf = Math.floor(H * f);
        points.push([xf, 0], [xf, H - 1], [0, yf], [W - 1, yf]);
      }
      // 무작위 40 개 — 결정적 sample 이 page-break 빈 영역에 위치할 가능성 회피
      for (let i = 0; i < 40; i++) {
        points.push([Math.floor(Math.random() * W), Math.floor(Math.random() * H)]);
      }
      let nonWhite = 0;
      for (const [x, y] of points) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        // R=G=B=255 (white) 또는 alpha=0(투명)이 아니면 콘텐츠 픽셀
        if (!(d[0] === 255 && d[1] === 255 && d[2] === 255) && d[3] !== 0) nonWhite++;
      }
      const nonWhiteRate = nonWhite / points.length;
      // 가드 약화: 5% 미만 nonWhite 일 때만 white-canvas 의심 — 그러나 abort X.
      // blob.size 가드가 빈 PDF 차단. 정상 PDF 는 sample 우연으로 막히지 않음.
      if (nonWhiteRate < 0.05) {
        console.warn('[PDF] white-dominant canvas suspected — w=', W, 'h=', H,
          'samples=', points.length, 'nonWhite=', nonWhite, 'rate=', nonWhiteRate.toFixed(3),
          '→ continuing (blob.size 가드가 빈 PDF 차단)');
      } else {
        console.log('[PDF] canvas content check OK — nonWhite=', nonWhite, '/', points.length,
          'rate=', nonWhiteRate.toFixed(3));
      }

      // PR #458 (Audit Z-H10 — 2026-05-16): per-band check for partial-blank
      // PDFs. The 5% global threshold above misses the more common bug class
      // — pagebreak-corrupt PDFs where (e.g.) 5 of 10 logical pages are blank
      // but the overall non-white rate is still 20-30% (the non-blank pages
      // carry the weight). Slice the canvas into 10 horizontal bands; if
      // >25% of bands are <2% non-white, flag suspected partial-blank.
      // Same fail-open posture — log structured warn so Sentry/operator sees
      // the pattern, don't block the download.
      const BANDS = 10;
      const PER_BAND_SAMPLES = 20;
      const BLANK_BAND_NONWHITE = 0.02;
      const MAX_BLANK_BAND_RATIO = 0.25;
      let blankBands = 0;
      const bandStats: Array<{ band: number; rate: number }> = [];
      for (let b = 0; b < BANDS; b++) {
        const yStart = Math.floor((b / BANDS) * H);
        const yEnd = Math.max(yStart + 1, Math.floor(((b + 1) / BANDS) * H));
        let bandNonWhite = 0;
        for (let s = 0; s < PER_BAND_SAMPLES; s++) {
          const x = Math.floor(Math.random() * W);
          const y = yStart + Math.floor(Math.random() * (yEnd - yStart));
          const d = ctx.getImageData(x, y, 1, 1).data;
          if (!(d[0] === 255 && d[1] === 255 && d[2] === 255) && d[3] !== 0) bandNonWhite++;
        }
        const rate = bandNonWhite / PER_BAND_SAMPLES;
        bandStats.push({ band: b, rate });
        if (rate < BLANK_BAND_NONWHITE) blankBands++;
      }
      const blankBandRatio = blankBands / BANDS;
      if (blankBandRatio > MAX_BLANK_BAND_RATIO) {
        console.warn('[PDF] partial-blank suspected (band check) — blankBands=',
          blankBands, '/', BANDS, 'ratio=', blankBandRatio.toFixed(2),
          'globalRate=', nonWhiteRate.toFixed(3), 'bands=',
          bandStats.map((s) => `${s.band}:${s.rate.toFixed(2)}`).join(','),
          '→ continuing (blob.size 가드 + 운영자 Sentry 알림으로 추후 회귀 회피)');
      }

      // 2026-06-10 end-sentinel 검사 (fail-closed): pagebreak 인플레이션 잘림은 위 휴리스틱
      // (전역/밴드)으로 못 잡음 — 잘린 canvas 도 콘텐츠 비율은 정상이라서. 빌더 맨 끝
      // .pdf-end-sentinel(중앙 260px 어두운 바)가 canvas 하단 25% 안에 실재하는지 결정적 확인.
      // 없으면 = 꼬리(Day 후반/예산/식당/출국) 소실 — 불완전 PDF 다운로드 차단(데이터 손실급).
      // (white-canvas 휴리스틱과 달리 결정적 마커라 false-positive 없음 -> fail-closed 안전.)
      {
        const scanRows = Math.floor(H * 0.4);
        let sentinelDark = 0;
        let foundDepth = -1;
        for (let dy = 0; dy < scanRows && sentinelDark < 3; dy += 3) {
          const y = H - 1 - dy;
          for (const fx of [0.4, 0.45, 0.5, 0.55, 0.6]) {
            const d = ctx.getImageData(Math.floor(W * fx), y, 1, 1).data;
            if (d[0] < 120 && d[1] < 120 && d[2] < 120 && d[3] !== 0) {
              sentinelDark++;
              if (foundDepth < 0) foundDepth = dy;
            }
          }
        }
        if (sentinelDark < 3) {
          console.error('[PDF] end-sentinel missing — tail truncated. canvasH=', H,
            'measuredHeight=', measuredHeight, 'scale=', pdfScale);
          offerWhatsapp('PDF was cut off at the end.');
          return;
        }
        console.log('[PDF] end-sentinel OK — depth', foundDepth, 'px from bottom');
      }
    }
    // 캔버스 검증 통과 → PDF blob 생성
    const pdf = await worker.outputPdf('blob');
    if (pdf.size < 1024) {
      console.error('[PDF] blank blob detected, size =', pdf.size, 'scrollHeight =', container.scrollHeight);
      offerWhatsapp('PDF capture failed (empty file).');
      return;
    }
    // PR #456 (Audit Z-H14): unified iOS-safe blob open. <a download>
    // works on iOS 13+ for blob URLs and bypasses the popup blocker
    // that previously silently killed window.open(blob:). Fallback
    // path detects popup-blocked and surfaces a user alert.
    const openResult = openBlobSafely({ blob: pdf, filename });
    if (!openResult.ok) {
      console.warn('[PDF] client-side open failed:', openResult.reason);
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
