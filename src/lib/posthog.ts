// PostHog product-analytics wrapper.
// Coexists with GA4 (`src/lib/analytics.ts`):
//   - GA4: marketing/ad attribution, ecommerce events.
//   - PostHog: product behavior, A/B test cohorts, plan-quality metrics.
// Why this layer:
//   1. Lazy-init: SDK loads only when `VITE_POSTHOG_KEY` is set, so builds
//      without the key (CI / preview / public forks) compile to no-ops.
//   2. PII guard: `sanitize()` strips known sensitive fields before send.
//   3. Typed event union: tsc rejects new events without an entry, so the
//      schema in `docs/ROADMAP.md` Sprint 2 #7 stays in sync with code.

import type { PostHog } from 'posthog-js';

let client: PostHog | null = null;
let initPromise: Promise<PostHog | null> | null = null;

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

const PII_FIELDS = new Set([
  'email', 'phone', 'address', 'hotel_address', 'name',
  'first_name', 'last_name', 'guest_email', 'paypal_email', 'full_name',
]);

function sanitize(props: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (PII_FIELDS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

async function ensureInit(): Promise<PostHog | null> {
  if (client) return client;
  if (!KEY) return null;
  if (typeof window === 'undefined') return null;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await import('posthog-js');
      const ph = mod.default;
      ph.init(KEY, {
        api_host: HOST,
        capture_pageview: true,
        capture_pageleave: true,
        // Defer autocapture — manual `track()` calls are the source of truth.
        // Autocapture would log every click/input, which inflates event volume
        // and risks logging form values (PII).
        autocapture: false,
        disable_session_recording: true,
        respect_dnt: true,
        loaded: (instance) => {
          if (import.meta.env.DEV) {
            console.info('[posthog] ready');
            instance.debug();
          }
        },
      });
      client = ph;
      return ph;
    } catch (e) {
      console.warn('[posthog] init failed:', (e as Error).message);
      return null;
    }
  })();

  return initPromise;
}

// Eager-trigger init on app boot so first event isn't delayed by SDK load.
export function bootPostHog(): void {
  void ensureInit();
}

export type PostHogEventName =
  // 깔때기 상단(funnel top): 플래너 위저드 진입. 이게 없으면 시작→생성→결제 전환율의
  // 분모(시작)가 안 보임. WizardForm 첫 마운트 1회 발화 (2026-06-12).
  | 'wizard_started'
  | 'plan_generated'
  | 'plan_downloaded'
  | 'transit_clicked'
  | 'language_switched'
  | 'payment_started'
  | 'payment_completed'
  | 'payment_failed'
  // P1 마케팅 퍼널 (2026-07-11 운영자 보완 지시): GA4(광고 귀속)와 이중 전송.
  // PostHog = 제품 퍼널 조회(admin-posthog-funnel) 데이터 소스. PII 없는 속성만.
  | 'promo_view'
  | 'promo_click'
  | 'promo_dismiss'
  | 'welcome_coupon_issued'
  | 'welcome_coupon_modal_view'
  | 'planner_complete'
  | 'free_plan_redeemed'
  | 'charter_quote_start'
  | 'charter_quote_complete'
  // 제휴 링크 퍼널 (2026-07-30). 그동안 ad_impression/ad_click 은 GA4 로만 갔고
  // PostHog 에는 없어서 관리자 퍼널에서 제휴 구간이 통째로 비어 있었다.
  // 속성은 product·placement·language·city·link_key 다섯 개뿐 — URL·uid·planId 금지.
  | 'affiliate_impression'
  | 'affiliate_click';

export async function track(event: PostHogEventName, props?: Record<string, unknown>): Promise<void> {
  const ph = await ensureInit();
  if (!ph) return;
  try {
    ph.capture(event, sanitize(props));
  } catch (e) {
    console.warn('[posthog] capture failed:', (e as Error).message);
  }
}

// Identify caller — typically Firebase uid (NOT email).
export async function identify(distinctId: string, props?: Record<string, unknown>): Promise<void> {
  const ph = await ensureInit();
  if (!ph || !distinctId) return;
  try {
    ph.identify(distinctId, sanitize(props));
  } catch (e) {
    console.warn('[posthog] identify failed:', (e as Error).message);
  }
}

export async function reset(): Promise<void> {
  const ph = await ensureInit();
  if (!ph) return;
  try {
    ph.reset();
  } catch { /* ignore */ }
}
