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
import { hasAnalyticsConsent, onConsentChange, type ConsentState } from './consent';

/** 전송이 허용된 SDK. 동의가 없으면 항상 null — 이 변수 자체가 "보내도 된다" 는 신호다. */
let client: PostHog | null = null;
/**
 * 한 번 로드된 SDK. 동의 철회 뒤에도 남긴다 — 이미 켜진 SDK 를 **끄기 위해**(opt-out/reset)
 * 참조가 필요하다. 여기 값이 있는 것은 전송 허가가 아니다(허가는 `client`).
 */
let sdk: PostHog | null = null;
let initPromise: Promise<PostHog | null> | null = null;
/** `ph.init` 을 이미 호출했는가. 재수락 시 중복 init 대신 opt-in 으로 되돌린다. */
let didInit = false;

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
  if (!KEY) return null;
  if (typeof window === 'undefined') return null;
  // 🔴 2026-07-30 (#1192): 동의 검사를 **여기**에 둔다. main.tsx 에서 bootPostHog 만 막았더니
  //   운영에서 여전히 posthog.com 요청이 나갔다. 원인은 이 함수가 lazy-init 이라
  //   `track()` 이 한 번이라도 불리면(App 의 trackPageView 등) 그 경로로 SDK 가 켜졌기 때문이다.
  //   부팅 경로만 막는 것으로는 부족하다 — SDK 가 켜지는 문은 이 함수 하나뿐이므로 여기서 막는다.
  //
  // 🔴 이번 라운드: 그 검사가 `if (client) return client` **아래**에 있었다. 수락 후 철회하면
  //   저장된 client 가 그대로 반환돼 track·identify 가 계속 전송됐다. 동의 검사는 어떤
  //   조기 반환보다도 앞에 있어야 한다 — 그래서 이 줄이 함수의 첫 관문이다.
  if (!hasAnalyticsConsent()) return null;
  if (client) return client;
  if (initPromise) return initPromise;   // 동시 track() 다발 → init 1회

  const pending = (async (): Promise<PostHog | null> => {
    try {
      const mod = await import('posthog-js');
      const ph = mod.default;
      sdk = ph;
      // import 를 기다리는 사이 철회됐을 수 있다 — 켜기 직전에 다시 확인한다.
      if (!hasAnalyticsConsent()) return null;
      if (didInit) {
        // 재수락: init 을 두 번 부르지 않는다. 철회 때 걸어 둔 것(opt-out·플래그 차단)만 되돌린다.
        try { ph.set_config({ advanced_disable_flags: false }); } catch { /* 구버전 SDK 대비 */ }
        ph.opt_in_capturing({ captureEventName: false });
      } else {
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
        didInit = true;
        // 이전 방문에서 철회했다면 opt-out 이 저장소에 남아 있다. init 만으로는 다시 켜지지
        // 않으므로(조용히 전송 0건) 수락 상태에서는 명시적으로 되돌린다. `$opt_in` 이벤트는
        // 만들지 않는다(captureEventName: false) — 동의 직후 정체불명 이벤트 방지.
        ph.opt_in_capturing({ captureEventName: false });
      }
      client = ph;
      return ph;
    } catch (e) {
      console.warn('[posthog] init failed:', (e as Error).message);
      return null;
    }
  })();

  initPromise = pending;
  try {
    return await pending;
  } finally {
    // 실패·철회로 끝난 경우 다음 호출이 다시 시도할 수 있게 비운다.
    if (initPromise === pending) initPromise = null;
  }
}

/**
 * 동의가 사라지면(거부·철회) 이미 켜진 SDK 를 끈다.
 *   - `client = null` → 이후 track·identify 는 ensureInit 첫 관문에서 막힌다.
 *   - `opt_out_capturing()` → SDK 내부 큐·pageleave 등 우리 코드를 거치지 않는 전송까지 중단.
 *   - `reset()` → distinct_id·저장된 사람 속성 폐기.
 */
function applyConsent(state: ConsentState): void {
  if (state === 'accepted') return;
  client = null;
  initPromise = null;
  if (!sdk) return;
  try { sdk.opt_out_capturing(); } catch { /* SDK 내부 상태 문제는 무시 */ }
  // 🔴 운영 실측(2026-07-30): opt-out + reset 만 하면 철회 직후 `us.i.posthog.com/flags/` 요청이
  //   **1건 나갔다.** 원인은 우리 `reset()` 이다 — 새 distinct_id 가 만들어지면 SDK 가 그 id 로
  //   플래그를 다시 평가하려 한다. capture 는 아니지만 철회한 사람의 식별자를 실어 보내는 요청이다.
  //   → reset 전에 플래그 엔드포인트 자체를 끈다. (재수락 시 아래에서 되돌린다.)
  try { sdk.set_config({ advanced_disable_flags: true }); } catch { /* 구버전 SDK 대비 */ }
  try { sdk.reset(); } catch { /* 위와 동일 */ }
}

if (typeof window !== 'undefined') {
  // 앱 수명 전체 구독 — 배너 수락/철회, 다른 탭 변경 모두 여기로 들어온다.
  onConsentChange(applyConsent);
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

// 로그아웃 등에서 신원만 지운다. 🔴 이전 구현은 `ensureInit()` 를 불러서, 아직 켜지지도 않은
// SDK 를 **초기화하려고** 했다("끄는 동작" 이 켜는 동작이 되는 모순). 로드된 SDK 가 있을 때만 지운다.
export async function reset(): Promise<void> {
  if (!sdk) return;
  try {
    sdk.reset();
  } catch { /* ignore */ }
}
