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
import { hasAnalyticsConsent, onConsentChange, consentGeneration, type ConsentState } from './consent';
import { stripUnsafeProps, sanitizeCaptureProperties, safePagePath } from './analyticsProps';
import { queuePending, drainPending, clearPending } from './analyticsQueue';

/** 대기열 도착지 이름 — PostHog. */
const PH_SINK = 'posthog';

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

/**
 * 🔴 2026-07-30 (P1-2): PII 필드 **차단 목록**을 `analyticsProps` 의 **허용 목록**으로 바꿨다.
 *   차단 목록은 "우리가 미리 떠올린 이름" 만 막는다 — `revisionNote`·`allergies`·`token` 처럼
 *   나중에 생긴 필드는 그대로 통과했다. 기본 거부여야 새 필드가 샐 자리가 없다.
 */
function sanitize(props: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return stripUnsafeProps(props);
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
          // 🔴 2026-07-30 (P0-3·P1-2): 자동 pageview/pageleave 를 끈다.
          //   ① 자동 이벤트는 `$current_url` 에 **쿼리·해시를 통째로** 싣는다. 우리 URL 의
          //      쿼리에는 공유 토큰·알레르기·자유 입력이 들어간다.
          //   ② pageleave 는 `pagehide` 에서 발화한다 — 철회 직후 탭을 닫으면 우리 코드가
          //      개입할 틈 없이 나간다. 끄는 것이 유일하게 확실한 차단이다.
          //   대신 동의 상태에서 `capturePageView(pathname)` 로 **경로만** 수동 전송한다.
          capture_pageview: false,
          capture_pageleave: false,
          // Defer autocapture — manual `track()` calls are the source of truth.
          // Autocapture would log every click/input, which inflates event volume
          // and risks logging form values (PII).
          autocapture: false,
          disable_session_recording: true,
          // 🔴 2026-08-04 (운영자 승인): 이전엔 true 였다. SDK 의 respect_dnt 는 브라우저 DNT
          //   신호가 있으면 **우리 배너에서 수락을 누른 방문자까지** opt-out 으로 되돌린다
          //   (posthog-js ConsentManager 는 DNT 면 저장된 opt-in 을 무시하고 '거부' 를 돌려준다).
          //   그러면 capture() 가 is_capturing() 관문에서 끊겨 before_send 조차 돌지 않고
          //   네트워크 요청 자체가 생기지 않는다.
          //   동의의 단일 권위는 우리 쿠키 배너다 — consent.ts 에는 DNT 를 읽는 코드가 0줄이라
          //   "배너 수락 + DNT 켠" 방문자만 PostHog 에서 통째로 사라지고 GA4 와 수치가 갈렸다.
          //   비동의 방문자는 이 값과 무관하게 다른 관문들이 그대로 막는다
          //   (ensureInit 의 hasAnalyticsConsent 검사 2곳 · 세대값 · before_send).
          respect_dnt: false,
          // SDK 가 스스로 붙이는 속성 중 URL·레퍼러 계열을 원천 차단한다.
          property_denylist: ['$current_url', '$referrer', '$referring_domain', '$initial_current_url', '$initial_referrer', '$initial_referring_domain'],
          /**
           * 🔴 마지막 관문. `capture()` 를 우리 코드가 부르지 않는 경우(SDK 내부 큐 flush,
           *   재시도, 서베이·플래그 부수 이벤트)까지 여기를 지난다.
           *   - 동의가 없으면 **null 을 돌려 이벤트를 버린다** → 철회 후 pagehide·새로고침·
           *     탭 종료 시점의 잔여 전송이 0 이 된다.
           *   - 속성은 허용 목록으로 다시 한 번 거른다(누가 어디서 넣었든).
           */
          before_send: (event) => {
            if (!event) return null;
            if (!hasAnalyticsConsent()) return null;
            event.properties = sanitizeCaptureProperties(event.properties as Record<string, unknown> | undefined);
            return event;
          },
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
 *
 * 🔴🔴 순서가 전부다 (2026-07-30, posthog-js **1.404.0** 소스 확인):
 *   `posthog.reset()` 은 첫 줄에서 `this.consent.reset()` 을 부르고, 그 구현은 opt-in/out 을
 *   저장한 항목(`__ph_opt_in_out_<token>`)을 **지운다**. 지워지면 `consent` 는 -1(미선택)이 되고
 *   `has_opted_out_capturing()` 은 다시 false 가 된다.
 *   → 즉 예전 순서(opt_out → reset)는 **방금 건 opt-out 을 스스로 취소**하고 있었다.
 *     화면상 "철회함" 인데 SDK 는 "미선택" 이라 다음 세션부터 다시 수집되는 상태였다.
 *
 * 그래서 지금 순서는:
 *   1) `set_config({ advanced_disable_flags: true })` — reset 이 새 distinct_id 로 `/flags/` 를
 *      다시 부르는 것을 먼저 막는다(2026-07-30 운영 실측으로 확인한 1건).
 *   2) `reset()` — distinct_id·사람 속성 폐기. (여기서 opt-out 기록이 지워진다.)
 *   3) `opt_out_capturing()` — **마지막**에 걸어 최종 상태를 opted-out 으로 확정한다.
 *
 * 검증은 문자열이 아니라 실제 SDK 상태로 한다:
 *   `tests/unit/posthog-optout-real-sdk.test.ts` 가 진짜 posthog-js 를 띄워
 *   `has_opted_out_capturing() === true` 와 네트워크 0건을 확인한다.
 */
function applyConsent(state: ConsentState): void {
  if (state === 'accepted') return;
  client = null;
  initPromise = null;
  if (!sdk) return;
  try { sdk.set_config({ advanced_disable_flags: true }); } catch { /* 구버전 SDK 대비 */ }
  try { sdk.reset(); } catch { /* 위와 동일 */ }
  try { sdk.opt_out_capturing(); } catch { /* SDK 내부 상태 문제는 무시 */ }
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
  // 2026-08-06: `wizard_started` 는 **마운트 시** 발화한다 — 즉 "/planner 에 도착"이지
  //   "위저드를 시작"이 아니다(실측: 6월 광고 코호트에서 pageview 107 ≈ wizard_started 109,
  //   사실상 1:1). 그 109명 중 `plan_generated` 는 **0** 이었는데 **5단계 중 어디서 나갔는지
  //   볼 수단이 전혀 없었다.** 그래서 아래 둘을 추가한다.
  //   ⚠️ `wizard_started` 의 의미는 바꾸지 않는다 — `api/admin-posthog-funnel.js` 와 과거
  //      데이터의 분모가 그 정의에 묶여 있다. 새 신호는 **추가**로만 만든다.
  //
  // 손님이 실제로 다음 단계로 나아갔을 때. 되돌아가기·이어서하기 점프는 세지 않는다
  // (도달 최대 단계가 올라갈 때만) — 왕복이 진행으로 잡히면 이탈 지점이 흐려진다.
  | 'wizard_step_advanced'
  // 위저드가 화면에 실제로 보인 순간 1회. 도착 수 대비 이 값이 낮으면
  // **"보고도 안 썼다"가 아니라 "못 봤다"** 는 뜻이다 — 둘은 처방이 완전히 다르다.
  | 'wizard_seen'
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
  // 2026-08-01: 위저드 단계 도달(step 1~6). 시작·완료 두 지점만 있던 탓에
  // ⚠️ 2026-08-02 정정: 계기였던 "시작 14명" 은 주간 자동 테스트 오염분이다(analytics.ts 주석).
  // 에서 어느 단계가 사람을 떨구는지 볼 수 없었다. 속성은 step 하나.
  | 'charter_step'
  | 'charter_quote_complete'
  // 제휴 링크 퍼널 (2026-07-30). 그동안 ad_impression/ad_click 은 GA4 로만 갔고
  // PostHog 에는 없어서 관리자 퍼널에서 제휴 구간이 통째로 비어 있었다.
  // 속성은 product·placement·language·city·link_key 다섯 개뿐 — URL·uid·planId 금지.
  | 'affiliate_impression'
  | 'affiliate_click'
  // 투어 예약창 단계 (2026-08-19 퍼널 감사 2번): CTA 클릭(book_now_click)과 결제 시작
  // (payment_started) 사이가 통째로 비어 어느 단계가 사람을 떨구는지 볼 수 없었다.
  // start=다이얼로그 열림 · step 2=연락처 단계 진입 · step 3=필수 입력 완료(결제 버튼 노출).
  // 결제 시작/완료/실패는 기존 payment_* 를 그대로 쓴다 — 중복 정의하지 않는다.
  | 'tour_booking_start'
  | 'tour_step'
  // 상세 페이지 크로스셀 카드 클릭 (MRT 벤치마킹 P4, 2026-08-19). 속성은 target_tour_id 하나뿐.
  | 'tour_related_click'
  // 커뮤니티 → 자체 상품(플래너·차터) 이동 (2026-08-02). 커뮤니티에 들어온 사람이
  // 우리 상품을 못 보고 나가던 구간을 메운다. 속성은 product·placement·language 셋뿐
  // — 글 id·uid·URL 은 넣지 않는다(누가 어느 글에서 눌렀는지까지 알 필요가 없다).
  | 'community_product_click';

/**
 * `ensureInit()` 의 `await` 를 사이에 두고 동의가 바뀌지 않았는지 확인한다.
 *
 * 🔴 왜 필요한가 (P0-3): SDK 로드는 네트워크 작업이라 수백 ms 걸린다. 그 사이에 사용자가
 *   철회하면, 깨어난 코드는 "허가받던 시절의 세계" 를 믿고 그대로 전송한다. `hasAnalyticsConsent()`
 *   재확인만으로는 accepted→revoked→accepted 왕복을 못 잡으므로 **세대값**을 쓴다.
 */
function consentUnchanged(gen: number): boolean {
  return consentGeneration() === gen && hasAnalyticsConsent();
}

export async function track(event: PostHogEventName, props?: Record<string, unknown>): Promise<void> {
  if (typeof window === 'undefined' || !KEY) return;
  if (!hasAnalyticsConsent()) {
    // 🔴 버리지 않는다 — 배너가 1.5초 뒤에 뜨는 탓에 첫 화면 계측이 통째로 사라지던 문제.
    //   수락하는 순간 아래 구독이 흘려보낸다. (src/lib/analyticsQueue.ts 주석 참조)
    queuePending(PH_SINK, event, props);
    return;
  }
  await sendNow(event, props);
}

/** 실제 capture — 즉시 전송과 대기열 flush 가 같은 경로를 쓰게 한다. */
async function sendNow(event: string, props?: Record<string, unknown>): Promise<void> {
  const gen = consentGeneration();
  const ph = await ensureInit();
  if (!ph) return;
  if (!consentUnchanged(gen)) return;   // 로드를 기다리는 사이 철회됨 → 보내지 않는다
  try {
    ph.capture(event, sanitize(props));
  } catch (e) {
    console.warn('[posthog] capture failed:', (e as Error).message);
  }
}

// 동의 전에 밀어 둔 이벤트를 수락하는 순간 흘려보낸다. 거절·철회면 버린다.
onConsentChange(() => {
  if (!hasAnalyticsConsent()) { clearPending(PH_SINK); return; }
  for (const e of drainPending(PH_SINK)) void sendNow(e.name, e.props);
});

/**
 * SPA 화면 전환 1건 — **경로만** 보낸다(쿼리·해시 없음).
 * 자동 pageview 를 끈 대신 우리가 직접 부른다(init 설정의 주석 참조).
 */
export async function capturePageView(pathname?: string): Promise<void> {
  if (typeof window === 'undefined' || !KEY) return;
  // 경로는 **지금** 확정한다 — 나중에 대기열을 비울 때는 이미 다른 화면일 수 있다.
  const path = safePagePath(pathname);
  if (!hasAnalyticsConsent()) {
    // 🔴 랜딩 페이지 pageview 가 신규 방문자에게서 통째로 사라지던 자리.
    //   관리자 방문자 집계와 전환 퍼널 1단계의 **분모**라 유실 영향이 가장 크다.
    queuePending(PH_SINK, '$pageview', { $pathname: path, page_path: path });
    return;
  }
  await sendNow('$pageview', { $pathname: path, page_path: path });
}

// Identify caller — typically Firebase uid (NOT email).
export async function identify(distinctId: string, props?: Record<string, unknown>): Promise<void> {
  const gen = consentGeneration();
  const ph = await ensureInit();
  if (!ph || !distinctId) return;
  if (!consentUnchanged(gen)) return;
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
