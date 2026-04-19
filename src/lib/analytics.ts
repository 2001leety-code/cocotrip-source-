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
  window.dataLayer = window.dataLayer || [];
  window.gtag = function (...args: unknown[]) {
    window.dataLayer!.push(args);
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
  trackEvent('share', { method, content_type: 'plan', item_id: planId });
}

/** Planner flow */
export function trackPlannerStep(step: string, details?: GtagEvent) {
  trackEvent('planner_step', { step, ...details });
}

/** Recalc transit */
export function trackRecalcTransit(success: boolean, elapsedMs?: number) {
  trackEvent('recalc_transit', { success: success ? 'true' : 'false', elapsed_ms: elapsedMs });
}
