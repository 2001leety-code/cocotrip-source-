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
  | 'plan_generated'
  | 'plan_downloaded'
  | 'transit_clicked'
  | 'language_switched'
  | 'payment_started'
  | 'payment_completed'
  | 'payment_failed';

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
