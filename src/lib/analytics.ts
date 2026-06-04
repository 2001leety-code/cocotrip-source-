/**
 * GA4 Analytics Utility — CocoTrip
 *
 * Usage:
 *   import { trackEvent, trackPageView } from '@/lib/analytics';
 *   trackEvent('ad_click', { ad_type: 'hotel', placement: 'plan_detail' });
 *
 * GA4 Measurement ID is read from VITE_GA_MEASUREMENT_ID env var.
 * If not set, all tracking calls are silently no-ops.
 */

// ── Types ───────────────────────────────────────────────────────────────
interface GtagEvent {
  [key: string]: string | number | boolean | undefined;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

// ── GA4 Measurement ID ──────────────────────────────────────────────────
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || '';

// ── Init: inject gtag.js script ─────────────────────────────────────────
let _initialized = false;

export function initGA() {
  if (_initialized || !GA_ID || typeof window === 'undefined') return;

  // gtag.js script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  // dataLayer + gtag function
  // ⚠️ gtag.js 는 dataLayer 에 push 된 "arguments 객체"만 gtag 명령으로 인식한다. 실제 배열(`args`)을
  //    push 하면 명령으로 처리되지 않아 collect 요청이 전혀 안 나가고 GA4 데이터가 0이 된다(2026-06-04 발견:
  //    gtag.js 는 로드되나 google-analytics 요청 0건). Google 공식 스니펫(`function gtag(){dataLayer.push(arguments)}`)과 동일하게.
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    send_page_view: false, // we send manually for SPA
  });

  _initialized = true;
}

// ── Track Page View (SPA navigation) ────────────────────────────────────
export function trackPageView(path?: string) {
  if (!GA_ID || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_path: path || window.location.pathname + window.location.search,
    page_title: document.title,
  });
}

// ── Track Custom Event ──────────────────────────────────────────────────
export function trackEvent(eventName: string, params?: GtagEvent) {
  if (!GA_ID || !window.gtag) return;
  window.gtag('event', eventName, params);
}

// ── Predefined Events ───────────────────────────────────────────────────

/** Ad impression (viewed) */
export function trackAdImpression(adType: string, placement: string) {
  trackEvent('ad_impression', { ad_type: adType, placement });
}

/** Ad click */
export function trackAdClick(adType: string, placement: string, targetUrl?: string) {
  trackEvent('ad_click', { ad_type: adType, placement, target_url: targetUrl });
}

/** eSIM deeplink click */
export function trackEsimClick(provider: string) {
  trackEvent('esim_click', { provider });
}

/** Social share */
export function trackShare(method: string, planId: string) {
  trackEvent('share_click', { method, content_type: 'plan', item_id: planId });
}

/** Shared plan visit (from ?shared=1 URL) */
export function trackShareVisit(planId: string) {
  trackEvent('share_visit', { plan_id: planId });
}

/** Planner flow */
export function trackPlannerStep(step: string, details?: GtagEvent) {
  trackEvent('planner_step', { step, ...details });
}

/** Recalc transit */
export function trackRecalcTransit(success: boolean, elapsedMs?: number) {
  trackEvent('recalc_transit', { success: success ? 'true' : 'false', elapsed_ms: elapsedMs });
}

// ── GA4 Ecommerce Events ────────────────────────────────────────────────

/** User views a tour detail page */
export function trackViewItem(itemId: string, itemName: string, price?: number) {
  trackEvent('view_item', {
    currency: 'USD',
    value: price,
    items_id: itemId,
    items_name: itemName,
  });
}

/** User opens the booking form */
export function trackBeginCheckout(tourId: string, tourName: string, partySize: number, price?: number) {
  trackEvent('begin_checkout', {
    currency: 'USD',
    value: price,
    items_id: tourId,
    items_name: tourName,
    quantity: partySize,
  });
}

/** Booking successfully submitted */
export function trackPurchase(tourId: string, tourName: string, partySize: number, price?: number) {
  trackEvent('purchase', {
    currency: 'USD',
    value: price,
    items_id: tourId,
    items_name: tourName,
    quantity: partySize,
    transaction_id: `${tourId}_${Date.now()}`,
  });
}

/** User adds a tour to wishlist */
export function trackAddToWishlist(itemId: string, itemName: string) {
  trackEvent('add_to_wishlist', { items_id: itemId, items_name: itemName });
}

/**
 * 유료 전환(결제 완료) — GA4 표준 'purchase' 이벤트 (AI 플랜 / 차터 / 투어 공통).
 * 홍보 실행안 1순위: PayPal capture 성공 시 발화 → GA4 'purchase' 를 Google Ads 가
 *   전환으로 import(value+currency+transaction_id 로 중복 제거). UTM 은 GA4 세션 소스로 자동 귀속.
 * trackEvent(GtagEvent=primitive-only)로는 items[] 배열을 못 보내므로 gtag 직접 호출.
 * GA_ID 미설정 시 no-op(빌드/preview 무해). transactionId=PayPal orderID(거래당 유니크, dedup 안전).
 */
export function trackPaidConversion(params: {
  transactionId: string;
  productType: string;
  value: number;
  currency: string;
}) {
  if (!GA_ID || typeof window === 'undefined' || !window.gtag) return;
  // 결제 성공 경로에서 호출됨 — analytics 가 절대 결제 흐름을 깨면 안 됨(방어적 try/catch).
  try {
    window.gtag('event', 'purchase', {
      transaction_id: params.transactionId,
      value: params.value,
      currency: params.currency,
      items: [{
        item_id: params.productType,
        item_name: params.productType,
        price: params.value,
        quantity: 1,
      }],
    });
  } catch { /* analytics 실패는 결제에 영향 없음 */ }
}

/** User signs up / first login */
export function trackSignUp(method: string) {
  trackEvent('sign_up', { method });
}
