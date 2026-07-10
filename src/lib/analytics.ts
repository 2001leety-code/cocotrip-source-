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
  window.gtag('event', eventName, { ...getStoredUtm(), ...params });
}

// ── 전역 WhatsApp 클릭 추적 ──────────────────────────────────────────────
// 16곳에 흩어진 wa.me 링크를 위임 리스너 1개로 GA4에 잡는다. PostHog는 autocapture로
// 이미 잡지만 GA4(=Google Ads 광고 귀속 채널)엔 없어 추가 — WhatsApp 문의가 어느
// 캠페인에서 왔는지 측정해 광고 최적화. idempotent(여러 번 호출돼도 리스너 1개).
let waTrackingAttached = false;
export function initWhatsAppTracking() {
  if (typeof document === 'undefined' || waTrackingAttached) return;
  waTrackingAttached = true;
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    const link = el && el.closest ? (el.closest('a[href*="wa.me"]') as HTMLAnchorElement | null) : null;
    if (link) trackEvent('whatsapp_click', { page_path: window.location.pathname });
  }, { capture: true });
}

// ── UTM 보존 (광고 귀속) ──────────────────────────────────────────────
// 광고 랜딩 시 utm_* 를 sessionStorage 에 저장 → SPA 내비게이션 후에도 유지된다.
// getStoredUtm 을 모든 trackEvent 에 자동 첨부해 GA4/Google Ads 가 어느 캠페인에서
// 온 전환인지 측정한다 (GA4 세션 소스 자동귀속의 보강 — SPA 이동 후 누락 방지).
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const UTM_STORE = 'cocotrip_utm';
// P1 (2026-07-11 마케팅 지시서): 장기 유입 귀속 — sessionStorage 는 탭 닫으면 소실되어
// 며칠 뒤 결제 시 최초 유입이 끊겼다. localStorage 에 first(최초 1회 고정)/last(매 유입 갱신)
// 분리 보존 → 가입·예약·결제 문서에 스냅샷으로 저장(getAttributionSnapshot).
// ⚠️ PII 금지: utm 5필드 + 시각만. 이메일·전화·주소 절대 미포함.
const UTM_FIRST_STORE = 'cocotrip_utm_first';
const UTM_LAST_STORE = 'cocotrip_utm_last';
// 값 방어: 비정상 길이/PII 의심('@' 포함) 값은 저장 자체를 스킵 (광고 UTM 값엔 @ 없음)
const UTM_VALUE_MAX = 120;
function sanitizeUtmValue(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim().slice(0, UTM_VALUE_MAX);
  if (!t || t.includes('@')) return null; // 이메일 유입 방지 (PII 최소수집)
  return t;
}

function readUrlUtm(): Record<string, string> {
  const p = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) { const v = sanitizeUtmValue(p.get(k)); if (v) utm[k] = v; }
  return utm;
}

/** 매 랜딩 시 호출 — 세션(기존 GA 첨부용) + first/last(장기 귀속) 보존. */
export function initUtmCapture() {
  if (typeof window === 'undefined') return;
  let utm: Record<string, string> = {};
  try { utm = readUrlUtm(); } catch { return; }

  // 기존 동작 유지: 세션 내 첫 UTM 을 sessionStorage 에 (모든 trackEvent 자동 첨부용)
  try {
    if (!sessionStorage.getItem(UTM_STORE) && Object.keys(utm).length > 0) {
      sessionStorage.setItem(UTM_STORE, JSON.stringify(utm));
    }
  } catch { /* sessionStorage 차단 환경 무시 */ }

  // P1: first = 최초 1회만 기록(이후 절대 덮지 않음), last = UTM 있는 유입마다 갱신
  if (Object.keys(utm).length === 0) return;
  try {
    const stamped = { ...utm, ts: new Date().toISOString() };
    if (!localStorage.getItem(UTM_FIRST_STORE)) {
      localStorage.setItem(UTM_FIRST_STORE, JSON.stringify(stamped));
    }
    localStorage.setItem(UTM_LAST_STORE, JSON.stringify(stamped));
  } catch { /* localStorage 차단(시크릿 등) — 추적 실패가 앱을 막으면 안 됨 */ }
}

function getStoredUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { const raw = sessionStorage.getItem(UTM_STORE); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function readStore(key: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // 허용 키만 통과 (utm 5종 + ts) — 저장소 오염 방어
    const out: Record<string, string> = {};
    for (const k of [...UTM_KEYS, 'ts']) {
      if (typeof parsed[k] === 'string') out[k] = parsed[k].slice(0, UTM_VALUE_MAX);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch { return null; }
}

/**
 * 유입 스냅샷 (가입·예약·결제 문서 저장용) — { first?, last? }.
 * PII 없음(UTM 5필드+ts). 유입 기록이 전혀 없으면 null (필드 자체 생략용).
 * 어떤 경우에도 throw 하지 않는다 — 추적 실패가 로그인·예약·결제를 막으면 안 됨.
 */
export function getAttributionSnapshot(): { first?: Record<string, string>; last?: Record<string, string> } | null {
  if (typeof window === 'undefined') return null;
  try {
    const first = readStore(UTM_FIRST_STORE);
    const last = readStore(UTM_LAST_STORE);
    if (!first && !last) return null;
    return { ...(first ? { first } : {}), ...(last ? { last } : {}) };
  } catch { return null; }
}

/** 채팅 위젯 열림 — 문의 의향 신호. */
export function trackChatOpen(page?: string) {
  trackEvent('chat_open', { page_path: page || (typeof window !== 'undefined' ? window.location.pathname : '') });
}
/** Book Now CTA 클릭. */
export function trackBookNow(productType?: string) {
  trackEvent('book_now_click', { product_type: productType || '' });
}
/** 예약 날짜 선택 완료. */
export function trackDateSelect(productType?: string) {
  trackEvent('date_select', { product_type: productType || '' });
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

// ── P1 전환 퍼널 이벤트 (2026-07-11 마케팅 지시서) ─────────────────────────
// 프로모션 배너·가입혜택·플래너의 노출/클릭/완료를 GA4 로 측정 — 무료→유료 전환
// 퍼널(PR-C 운영자 화면)의 데이터 기반. PostHog 는 autocapture 로 행동 분석 담당
// (역할 중복 금지 — 여기 이벤트는 GA4 광고 귀속 전용).

/** 프로모 배너 노출 (마운트 후 표시 시 1회). */
export function trackPromoView(placement: string) {
  trackEvent('promo_view', { placement });
}
/** 프로모 배너 CTA 클릭. */
export function trackPromoClick(placement: string, targetHref?: string) {
  trackEvent('promo_click', { placement, target_url: targetHref });
}
/** 프로모 배너 닫기(X). */
export function trackPromoDismiss(placement: string) {
  trackEvent('promo_dismiss', { placement });
}
/** 가입 웰컴 쿠폰 발급 성공 (firebase.js — issued>0 일 때). */
export function trackWelcomeCouponIssued(issuedCount: number) {
  trackEvent('welcome_coupon_issued', { issued_count: issuedCount });
}
/** 가입 웰컴 모달 노출. */
export function trackWelcomeCouponModalView() {
  trackEvent('welcome_coupon_modal_view', {});
}
/** AI 플랜 생성 완료 (planner_start 는 WizardForm 에서 기존 발화). */
export function trackPlannerComplete(params?: { durationDays?: number; freeCoupon?: boolean }) {
  trackEvent('planner_complete', {
    duration_days: params?.durationDays,
    free_coupon: params?.freeCoupon ? 'true' : 'false',
  });
}
/** 가입 무료 AI 플랜 쿠폰으로 플랜 생성 (무료→유료 전환 퍼널 시작점). */
export function trackFreePlanRedeemed(durationDays?: number) {
  trackEvent('free_plan_redeemed', { duration_days: durationDays });
}
/** 차터 견적 시작/완료. */
export function trackCharterQuoteStart() {
  trackEvent('charter_quote_start', {});
}
export function trackCharterQuoteComplete(params?: { vehicleType?: string; priceUSD?: number }) {
  trackEvent('charter_quote_complete', { vehicle_type: params?.vehicleType, value: params?.priceUSD });
}
