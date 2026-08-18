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

// P1 이중 전송(운영자 2026-07-11): 퍼널 이벤트는 GA4(광고 귀속) + PostHog(퍼널 조회) 둘 다.
// posthog.ts 는 lazy-init(키 없으면 no-op)이라 이 import 가 번들/부팅에 SDK 를 당기지 않음.
import { track as posthogTrack, type PostHogEventName } from './posthog';
import { hasAnalyticsConsent, onConsentChange, type ConsentState } from './consent';
import { stripUnsafeProps, safePagePath, safePageLocation, safeReferrer } from './analyticsProps';
import { queuePending, drainPending, clearPending } from './analyticsQueue';

/** 대기열 도착지 이름 — GA4. */
const GA_SINK = 'ga4';

/** GA4 page_view 이벤트 이름 — 대기열 flush 가 특별 취급해야 해서 상수로 묶는다. */
const PAGE_VIEW_EVENT = 'page_view';

/**
 * 전송 옵션.
 * `noQueue` — 동의 전이면 **담지 말고 그냥 버린다.** 호출부가 이미 자기만의 재시도를 가진
 *   경우에만 쓴다(charter 퍼널: "수락 시점의 **현재 단계**만 보낸다" 는 의도가 있어서,
 *   지나온 단계를 전부 되보내는 전역 대기열과 의미가 다르다). 기본은 담는다.
 */
export interface TrackOptions { noQueue?: boolean }

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

/**
 * GA4 로 보내도 되는가. **모든 전송 지점의 유일한 관문.**
 *
 * 🔴 이전에는 `!GA_ID || !window.gtag` 만 봤다. 부팅 시 동의가 없으면 `initGA` 가 안 돌아
 * `window.gtag` 가 없으니 우연히 안전했지만, **수락 뒤 철회하면** gtag 는 이미 있으므로
 * 전송이 계속됐다. PostHog 와 같은 종류의 결함이다 — 게이트는 켜지는 지점과 보내는 지점
 * 양쪽에 있어야 한다.
 */
function canSendToGA(): boolean {
  return !!GA_ID && typeof window !== 'undefined' && !!window.gtag && hasAnalyticsConsent();
}

export function initGA() {
  if (_initialized || !GA_ID || typeof window === 'undefined') return;
  // main.tsx 가 이미 동의 후에만 부르지만, 진입점이 늘어나도 안전하도록 여기서도 막는다.
  if (!hasAnalyticsConsent()) return;

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
    // 🔴 2026-08-01 (Preview 실측): page_path 만 깨끗하게 보내도 gtag 는 `dl`/`dr` 을 스스로
    //   window.location.href / document.referrer 에서 채운다. 이미 동의한 재방문자가
    //   `/s/xxx?token=…` 로 바로 들어오면 그 토큰이 그대로 나갔다. 여기서 덮어쓴다.
    page_location: safePageLocation(),
    page_referrer: safeReferrer(),
  });

  _initialized = true;
  // GA 가 **이제** 준비됐다 — 동의 전에 담아 둔 것을 여기서 흘려보낸다. 동의 구독 쪽은
  // 이 함수보다 먼저 돌기 때문에(main.tsx 부팅 순서) 그때는 아직 보낼 수 없었다.
  flushGaQueue();
}

// ── 동의 철회 반영 ───────────────────────────────────────────────────────
// gtag.js 는 우리 호출 없이도 자체적으로 요청을 만든다(config·자동 수집). 그래서 전송 함수만
// 막는 것으로는 부족하고, GA4 공식 킬 스위치인 `window['ga-disable-<ID>']` 를 세운다.
function applyConsentToGA(state: ConsentState): void {
  if (!GA_ID || typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = state !== 'accepted';
}

if (typeof window !== 'undefined') {
  onConsentChange(applyConsentToGA);
  // 동의 전에 밀어 둔 이벤트를 수락하는 순간 흘려보낸다. 거절·철회면 버린다.
  // (배너가 1.5초 뒤에 뜨는 탓에 첫 화면 계측이 통째로 유실되던 문제 — analyticsQueue.ts 주석)
  onConsentChange(() => {
    if (!hasAnalyticsConsent()) { clearPending(GA_SINK); return; }
    // GA 가 이미 켜져 있으면 여기서 흘려보낸다. 아직이면 `flushGaQueue` 가 아무것도 안 하고,
    // 곧 도는 `initGA()` 끝에서 같은 flush 가 다시 시도한다(아래 함수 주석 참조).
    flushGaQueue();
  });
}

/**
 * 대기열 → GA. **동의와 gtag 가 둘 다 갖춰졌을 때만** 비운다.
 *
 * 🔴 2026-08-08: 예전에는 동의 구독이 조건 없이 `drainPending` 을 불렀다. 그런데 `main.tsx` 는
 *   ① `import … from './lib/analytics'`(= 이 파일의 동의 구독 등록)를 먼저 하고 ② 그 **뒤에**
 *   `initGA()` 를 부를 구독을 건다. 첫 방문자가 배너에서 수락하면 ①이 먼저 도는데 그 시점엔
 *   아직 `window.gtag` 가 없다 → `drainPending` 이 **큐를 비운 뒤** `canSendToGA()` 가 false 라
 *   한 건도 못 보내고, 되돌릴 큐도 이미 없었다. 첫 방문자의 랜딩 `page_view` 와 그 전에 쌓인
 *   일반 이벤트가 통째로 사라졌다.
 *
 *   그래서 **꺼내기 전에** 보낼 수 있는지 본다. 못 보내면 담긴 채로 두고, 준비되는 쪽
 *   (`initGA` 끝 / 다음 동의 변화)에서 다시 시도한다. 두 신호 중 **나중에 오는 쪽**이
 *   비우게 되므로 등록 순서에 의존하지 않는다.
 */
function flushGaQueue(): void {
  if (!canSendToGA()) return;
  for (const e of drainPending(GA_SINK)) {
    if (e.name === PAGE_VIEW_EVENT) {
      // 🔴 page_view 는 담을 때 캡처한 값(page_path·page_location·page_referrer)을
      //   그대로 보낸다 — sendToGA 를 태우면 허용목록이 location 계열을 거르고
      //   gaUrlParams() 가 **지금** URL 로 덮어써, 수락 시점 화면의 주소가 랜딩
      //   page_view 에 실린다 (#1241 후속).
      window.gtag!('event', PAGE_VIEW_EVENT, e.props);
    } else {
      sendToGA(e.name, e.props as GtagEvent | undefined);
    }
  }
}

// ── Track Page View (SPA navigation) ────────────────────────────────────
/**
 * 🔴 2026-07-30 (P1-2): 이전에는 `pathname + search` 를 그대로 보냈다. 우리 쿼리에는 공유
 *   토큰(`?token=`)·플래너 사전입력(`prefillHotel`·`prefillDiet`·`allergies`)·자유 입력
 *   (`revisionNote`·`freeText`)이 들어간다. 이제 **경로만** 보낸다.
 *   `page_title`(document.title)도 뺐다 — 공유 플랜 제목에 손님이 쓴 문장이 섞일 수 있다.
 */
export function trackPageView(path?: string) {
  if (typeof window === 'undefined' || !GA_ID) return;
  // 값은 담는 **지금** 확정한다 — 대기열을 비울 때는 이미 다른 화면일 수 있다
  // (posthog.ts capturePageView 와 같은 규칙).
  const payload: GtagEvent = {
    page_path: safePagePath(path),
    // gtag 가 스스로 채우는 `dl`/`dr` 을 매 이벤트마다 덮어쓴다 — config 값은 SPA 이동 후 낡는다.
    page_location: safePageLocation(path),
    ...(safeReferrer() ? { page_referrer: safeReferrer() } : {}),
  };
  if (!canSendToGA()) {
    // 🔴 #1241 후속 (2026-08-07): PostHog capturePageView 는 담는데 GA4 만 버려서
    //   신규 방문자 랜딩 page_view 가 GA4 에서만 영구 유실됐다 — 발화부(App.tsx)는
    //   deps [location.pathname] 이라 수락으로 재발화하지 않고, initGA 는
    //   send_page_view:false 라 수락 시점에도 만들지 않는다. 수락하면 위 구독이
    //   담은 값 그대로 흘려보낸다.
    // 🔴 2026-08-08: 판정 기준을 `hasAnalyticsConsent()` 에서 `canSendToGA()` 로 넓혔다.
    //   **동의는 있는데 gtag 가 아직 없는 순간**(부팅 중·수락 직후)에는 담지 않고 버렸는데,
    //   그것도 "지금은 못 보낸다, 나중엔 보낼 수 있다" 인 건 똑같다. flushGaQueue 가 챙긴다.
    queuePending(GA_SINK, PAGE_VIEW_EVENT, payload as Record<string, unknown>);
    return;
  }
  window.gtag!('event', PAGE_VIEW_EVENT, payload);
}

// ── Track Custom Event ──────────────────────────────────────────────────
/**
 * gtag 가 **모든 이벤트에** 스스로 붙이는 URL 계열(`dl`·`dr`)을 덮어쓰는 값.
 * page_view 뿐 아니라 일반 이벤트에도 붙으므로 전송 지점마다 함께 넘긴다.
 */
function gaUrlParams(): { page_location: string; page_referrer?: string } {
  const ref = safeReferrer();
  return { page_location: safePageLocation(), ...(ref ? { page_referrer: ref } : {}) };
}

/**
 * 모든 GA4 속성은 허용 목록 관문(analyticsProps)을 지난다 — 이벤트마다 따로 챙기지 않는다.
 *
 * 반환값 = **실제로 gtag 에 넘겼는지**. 동의 미결정·거부, GA 키 없음, gtag 미로드면 false.
 * "한 번만 보낸다" 를 관리하는 호출부는 이 값을 봐야 한다 — 버려진 호출을 보냈다고
 * 표시해 두면 사용자가 나중에 동의해도 영영 재시도하지 않는다 (2026-08-01 리뷰 지적).
 */
export function trackEvent(
  eventName: string,
  params?: GtagEvent,
  opts?: TrackOptions,
): boolean {
  if (typeof window === 'undefined' || !GA_ID) return false;
  if (!canSendToGA()) {
    // 🔴 버리지 않는다. 동의 배너가 1.5초 뒤에 뜨는 탓에 첫 화면 계측이 통째로 사라지던
    //   문제(analyticsQueue.ts 주석). 수락하면 위 구독이 흘려보낸다.
    //   ⚠️ 예외: 호출부가 **자기만의 재시도**를 이미 가진 경우(charter 퍼널)는 담지 않는다.
    //      담으면 수락 순간 대기열과 호출부가 각각 보내 **이중 전송**이 된다.
    // 🔴 2026-08-08: 판정을 `hasAnalyticsConsent()` → `canSendToGA()` 로 넓혔다. **동의는
    //   있는데 gtag 가 아직 없는 순간**(부팅 중·수락 직후 다른 구독이 발화)에는 담지도 않고
    //   버렸다 — trackPageView 와 같은 이유로 담는다. flushGaQueue 가 챙긴다.
    if (!opts?.noQueue) {
      queuePending(GA_SINK, eventName, params as Record<string, unknown> | undefined);
    }
    return false;
  }
  sendToGA(eventName, params);
  return true;
}

/** 실제 gtag 호출 — 대기열 flush 와 즉시 전송이 같은 경로를 쓰게 한다. */
function sendToGA(eventName: string, params?: GtagEvent): void {
  if (!canSendToGA()) return;
  window.gtag!('event', eventName, {
    ...stripUnsafeProps({ ...getStoredUtm(), ...params }),
    ...gaUrlParams(),
  });
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

// One delegated listener covers desktop, mobile, and footer links even when
// those layouts change independently.
let blogTrackingAttached = false;
export function initBlogTracking() {
  if (typeof document === 'undefined' || blogTrackingAttached) return;
  blogTrackingAttached = true;
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    const link = el && el.closest
      ? (el.closest('a[href*="cocotripkr.blogspot.com"]') as HTMLAnchorElement | null)
      : null;
    if (!link) return;
    trackEvent('blog_click', {
      page_path: window.location.pathname,
      target_url: link.href,
      link_text: (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    });
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
// ⚠️ PII 최소화: 수집 필드는 utm 5종 + 시각뿐이며, 값도 아래 휴리스틱으로 이메일·전화형을
//    걸러낸다. URL 파라미터는 임의 입력이라 "완전 차단"은 불가 — 정확한 차단 범위는
//    tests/unit/utm-attribution-p1.test.ts 가 명세한다. (서버측 동일 규칙: api/_shared/attribution.js)
const UTM_FIRST_STORE = 'cocotrip_utm_first';
const UTM_LAST_STORE = 'cocotrip_utm_last';
const UTM_VALUE_MAX = 120;
// PII 의심 값 휴리스틱 (client/server 동일 규칙 유지):
//  ① '@' 포함 = 이메일류  ② URL(http 시작·'://'·www.) = 임의 링크/토큰 유입
//  ③ '+' 시작 + 숫자 8자↑ = 국제전화  ④ 0 시작 순수 숫자 9~11자 = 한국 전화
//  ⑤ 전체가 숫자·구분자(공백/-/괄호/.)뿐 + 숫자 9자↑ = 구분자 전화
//  순수 숫자(0 미시작)는 광고 ID(Meta 등)일 수 있어 허용.
function isSuspectPiiValue(v: string): boolean {
  if (v.includes('@')) return true;
  if (/^https?:/i.test(v) || v.includes('://') || /^www\./i.test(v)) return true;
  const digits = (v.match(/\d/g) || []).length;
  if (/^\+/.test(v) && digits >= 8) return true;
  if (/^0\d{8,10}$/.test(v)) return true;
  if (/^[\d\s\-().]+$/.test(v) && /[\s\-().]/.test(v) && digits >= 9) return true;
  return false;
}
function sanitizeUtmValue(v: string | null): string | null {
  if (!v) return null;
  // 개행·제어문자 제거(저장 오염·로그 인젝션 방지) → trim → 길이 컷
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, UTM_VALUE_MAX);
  if (!t || isSuspectPiiValue(t)) return null;
  return t;
}

function readUrlUtm(): Record<string, string> {
  const p = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) { const v = sanitizeUtmValue(p.get(k)); if (v) utm[k] = v; }
  return utm;
}

/**
 * 🔴 2026-07-30 (P1-2): UTM 은 **동의 전에는 저장하지 않는다.**
 *
 * 이전 구현은 랜딩 즉시 sessionStorage·localStorage 에 썼다. 쿠키 배너에 "동의하면" 이라고
 * 적어 놓고, 선택하기도 전에 마케팅용 식별 정보를 기기에 남기고 있었던 것이다(그 값은 이후
 * 가입·예약·결제 문서에도 스냅샷으로 붙는다).
 *
 * 지금 계약:
 *   - 미선택(unset)  → **메모리에만** 들고 있는다. 이번 방문의 유입을 잃지 않으면서 기기에는
 *                      아무것도 안 남긴다.
 *   - accepted       → 메모리 값을 그때 저장한다(다음 방문 귀속용).
 *   - dismissed/revoked → 메모리도 비우고 **이미 저장돼 있던 값도 지운다**.
 */
let memoryUtm: Record<string, string> = {};

/** 저장돼 있던 비필수 UTM 값을 전부 제거. 철회·거부 시 호출. */
function purgeStoredUtm(): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(UTM_STORE); } catch { /* 접근 차단 환경 */ }
  try { localStorage.removeItem(UTM_FIRST_STORE); } catch { /* 접근 차단 환경 */ }
  try { localStorage.removeItem(UTM_LAST_STORE); } catch { /* 접근 차단 환경 */ }
}

/** 메모리에 들고 있던 UTM 을 저장소로 넘긴다. 동의(accepted) 상태에서만 호출된다. */
function persistUtm(utm: Record<string, string>): void {
  if (Object.keys(utm).length === 0) return;
  try {
    if (!sessionStorage.getItem(UTM_STORE)) sessionStorage.setItem(UTM_STORE, JSON.stringify(utm));
  } catch { /* sessionStorage 차단 환경 무시 */ }
  try {
    const stamped = { ...utm, ts: new Date().toISOString() };
    if (!localStorage.getItem(UTM_FIRST_STORE)) {
      localStorage.setItem(UTM_FIRST_STORE, JSON.stringify(stamped));
    }
    localStorage.setItem(UTM_LAST_STORE, JSON.stringify(stamped));
  } catch { /* localStorage 차단(시크릿 등) — 추적 실패가 앱을 막으면 안 됨 */ }
}

/** 매 랜딩 시 호출 — 동의 상태에 따라 메모리 보관 또는 저장. */
export function initUtmCapture() {
  if (typeof window === 'undefined') return;
  let utm: Record<string, string> = {};
  try { utm = readUrlUtm(); } catch { return; }
  if (Object.keys(utm).length > 0) memoryUtm = utm;
  if (!hasAnalyticsConsent()) {
    // 아직 동의가 없다 — 기기에는 아무것도 남기지 않는다. 이미 남아 있던 값도 지운다.
    purgeStoredUtm();
    return;
  }
  persistUtm(memoryUtm);
}

/** 동의 상태 변화 반영 — 수락하면 그때 저장하고, 거부·철회면 저장값을 지운다. */
function applyConsentToUtm(state: ConsentState): void {
  if (state === 'accepted') {
    persistUtm(memoryUtm);
    return;
  }
  memoryUtm = {};
  purgeStoredUtm();
}

if (typeof window !== 'undefined') {
  onConsentChange(applyConsentToUtm);
}

function getStoredUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  // 전송 자체가 동의 상태에서만 일어나므로(canSendToGA), 여기서는 메모리 → 저장소 순으로 읽는다.
  if (Object.keys(memoryUtm).length > 0) return memoryUtm;
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
 * PII 최소화(UTM 5필드+ts만, 값은 isSuspectPiiValue 휴리스틱 통과분).
 * 유입 기록이 전혀 없으면 null (필드 자체 생략용).
 * 어떤 경우에도 throw 하지 않는다 — 추적 실패가 로그인·예약·결제를 막으면 안 됨.
 */
export function getAttributionSnapshot(): { first?: Record<string, string>; last?: Record<string, string> } | null {
  if (typeof window === 'undefined') return null;
  // 🔴 2026-07-30 (P1-2): 동의 없이는 **서버에도** 남기지 않는다. 이 값은 가입·예약·결제 문서에
  //   영구 저장되므로, 저장소에 안 쓰는 것만으로는 부족하다.
  if (!hasAnalyticsConsent()) return null;
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

// eSIM 클릭 측정은 lib/affiliateTracking.ts 로 통합했다 (2026-07-30).
//   기존 trackEsimClick 은 정의만 있고 **호출처가 0건**이었다 — 만든 측정이 배선되지
//   않아 eSIM 퍼널이 통째로 비어 있었다. 죽은 함수를 남기면 다음 사람이 '측정된다'고 믿는다.

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
  if (!canSendToGA()) return;
  // 결제 성공 경로에서 호출됨 — analytics 가 절대 결제 흐름을 깨면 안 됨(방어적 try/catch).
  try {
    window.gtag!('event', 'purchase', {
      transaction_id: params.transactionId,
      value: params.value,
      currency: params.currency,
      items: [{
        item_id: params.productType,
        item_name: params.productType,
        price: params.value,
        quantity: 1,
      }],
      // 결제 완료 화면 URL 에도 공유 토큰·사전입력이 붙을 수 있다 — 여기도 덮어쓴다.
      ...gaUrlParams(),
    });
  } catch { /* analytics 실패는 결제에 영향 없음 */ }
}

/** User signs up / first login */
export function trackSignUp(method: string) {
  trackEvent('sign_up', { method });
}

// ── P1 전환 퍼널 이벤트 (2026-07-11 마케팅 지시서 + 운영자 보완) ─────────────
// 프로모션 배너·가입혜택·플래너의 노출/클릭/완료 측정 — 무료→유료 전환 퍼널
// (PR-C 운영자 화면)의 데이터 기반.
// 데이터 소스 결정(운영자 2026-07-11): GA4 = 광고 귀속(Google Ads import),
// PostHog = 제품 퍼널 조회(admin-posthog-funnel 이 PostHog 를 읽음, autocapture:false
// 라 수동 track 만 잡힘) → PII 없는 퍼널 이벤트는 두 곳에 이중 전송한다.
//
// 반환값 = **이 호출로 어느 한 곳이라도 실제 전송을 시도했는지**. 동의가 없으면 두 경로 모두
// 대기열로 가거나(기본) 버려지므로(noQueue) false 다. "정확히 1회" 를 지켜야 하는 호출부는
// 이 값으로 완료 표시를 한다.
function trackFunnel(eventName: PostHogEventName, params?: GtagEvent, opts?: TrackOptions): boolean {
  const gaSent = trackEvent(eventName, params, opts);     // GA4 (광고 귀속)
  // 🔴 #1219 (2026-08-07): 예전엔 여기서 동의를 미리 보고 posthogTrack 호출 자체를 막았다.
  //   그러면 posthog.track() 내부의 동의-전 대기열(queuePending)에 도달하지 못해, 같은
  //   이벤트가 GA4 대기열엔 담기고 PostHog 엔 영영 안 남는 반쪽 유실이 됐다(배너 1.5초
  //   지연 + promo_view 마운트 즉시 발화라 상시 발생). 이제 항상 호출하고 — 대기열 처리는
  //   posthog.track() 이 알아서 한다 — phSent(=지금 실제 전송을 시도했는지)만 동의로 판정한다.
  // ⚠️ noQueue(차터 퍼널)는 호출부가 자체 재시도를 가진다 — posthog track() 엔 opts 가
  //   없으므로 여기서 걸러야 담김/이중전송을 막는다(GA4 쪽 trackEvent 의 noQueue 와 대칭).
  let phSent = false;
  if (!opts?.noQueue || hasAnalyticsConsent()) {
    try { void posthogTrack(eventName, params); phSent = hasAnalyticsConsent(); } catch { /* 분석 실패 무해 */ }
  }
  return gaSent || phSent;
}

/** 프로모 배너 노출 (마운트 후 표시 시 1회). */
export function trackPromoView(placement: string) {
  trackFunnel('promo_view', { placement });
}
/** 프로모 배너 CTA 클릭. */
export function trackPromoClick(placement: string, targetHref?: string) {
  trackFunnel('promo_click', { placement, target_url: targetHref });
}
/** 프로모 배너 닫기(X). */
export function trackPromoDismiss(placement: string) {
  trackFunnel('promo_dismiss', { placement });
}
/** 가입 웰컴 쿠폰 발급 성공 (firebase.js — issued>0 일 때). */
export function trackWelcomeCouponIssued(issuedCount: number) {
  trackFunnel('welcome_coupon_issued', { issued_count: issuedCount });
}
/** 가입 웰컴 모달 노출. */
export function trackWelcomeCouponModalView() {
  trackFunnel('welcome_coupon_modal_view', {});
}
/** 차터 견적 시작/완료. 반환값 = 실제 전송 시도 여부(동의 없으면 false → 호출부가 재시도). */
export function trackCharterQuoteStart(): boolean {
  // charter 퍼널은 useCharterFunnelTracking 이 자체 재시도를 가진다 → 전역 대기열 제외(이중 전송 방지).
  return trackFunnel('charter_quote_start', {}, { noQueue: true });
}
export function trackCharterQuoteComplete(params?: { vehicleType?: string; priceUSD?: number }): boolean {
  // charter 퍼널은 useCharterFunnelTracking 이 자체 재시도를 가진다 → 전역 대기열 제외(이중 전송 방지).
  return trackFunnel('charter_quote_complete', { vehicle_type: params?.vehicleType, value: params?.priceUSD }, { noQueue: true });
}
/**
 * 차터 위저드 단계 도달 (2026-08-01).
 *
 * 왜: 시작·완료 두 지점만으로는 어느 단계가 사람을 떨구는지 볼 수 없었다.
 *
 * ⚠️ 2026-08-02 정정: 이 계기로 인용했던 "견적 시작 14명" 은 실제 고객이 아니었다.
 *   GA4 `/charter` 세션을 날짜×시각으로 쪼개니 8주 연속 월요일마다 정확히 9세션
 *   (= 3개 언어 × 3개 기기) — `weekly-i18n-audit` 이 운영 사이트를 도는 값이다.
 *   단계 계측의 필요성은 그대로지만 **수치를 고객으로 읽지 말 것**. 오염을 걷어내기 전의
 *   실제 고객 수는 알 수 없다. 차단 = `tests/e2e/fixtures/analytics-guard.ts`.
 * 시작·완료 두 지점만 있어서 **1~5단계 중 어디서 전원이 떠나는지 볼 수 없었다**.
 * 단계별 이벤트가 있어야 다음 방문자들이 데이터가 된다(추측으로 고치면 엉뚱한 데를 고친다).
 * 단계당 1회만 — 뒤로 갔다 다시 와도 중복 발화하지 않는다(호출부 ref 로 관리).
 * 속성은 `step` 하나. 허용목록(`analyticsProps`)이 기본 거부라 없는 키는 어차피 버려지고,
 * "어디서 떠나나" 에 답하는 데는 단계 번호면 충분하다.
 *
 * 반환값 = 실제 전송 시도 여부. 동의 미결정 상태의 호출은 버려지므로 false 를 돌려주고,
 * 호출부는 수락 이후 다시 시도해야 한다.
 */
export function trackCharterStep(step: number): boolean {
  // charter 퍼널은 useCharterFunnelTracking 이 자체 재시도를 가진다 → 전역 대기열 제외(이중 전송 방지).
  return trackFunnel('charter_step', { step }, { noQueue: true });
}

// ── 투어 예약창 단계 (2026-08-19 퍼널 감사 2번) ─────────────────────────
// charter_step 과 동일 컨벤션 — 속성은 step 하나. 차터와 달리 호출부에 자체 재시도가
// 없으므로 전역 대기열 기본값을 쓴다(동의 전 발화는 수락 시 flush — promo_view 와 동일).
// 중복 방지는 호출부 ref(도달 최대 단계 상승 시만)가 담당한다.
/** 투어 예약 다이얼로그 열림 (마운트당 1회 — 호출부 ref 가드). */
export function trackTourBookingStart() {
  trackFunnel('tour_booking_start', {});
}
/** 투어 예약 단계 도달: 2=연락처 단계 진입, 3=필수 입력 완료(결제 버튼 노출). */
export function trackTourStep(step: number) {
  trackFunnel('tour_step', { step });
}

// ── 플랜 완료 이벤트 — Firestore 상태 확정 시점에 정확히 1회 (운영자 보완 지시) ──
// 이전 구현은 API 가 streaming 을 수락한 시점(usePlannerHandlers navigate 직전)에 발화
// → 스트리밍이 최종 실패(status:'error')해도 planner_complete 가 잡히는 오류.
// 지금 구조:
//   1) usePlannerHandlers: API 수락 시 sessionStorage 에 pending marker 만 심음 (이벤트 X)
//   2) PlanDetailPage(usePlanCompletionTracking): plan.status 관찰 —
//      'ready' 확정 → 발화 + marker 제거 (정확히 1회)
//      'error'(스트리밍 최종 실패) → 발화 없이 marker 제거
//      'streaming' → 대기. marker 의 planId 불일치(다른/옛 플랜 열람) → 무시.
const PENDING_COMPLETE_KEY = 'coco_planner_pending_complete';

export function markPlannerPendingComplete(planId: string, meta: { durationDays?: number; freeCoupon?: boolean }) {
  if (!planId || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PENDING_COMPLETE_KEY, JSON.stringify({ planId, ...meta }));
  } catch { /* 저장 차단 환경 — 이벤트 유실만, 흐름 무영향 */ }
}

/**
 * plan.status 확정에 따라 완료 이벤트 발화. 반환값은 테스트/디버깅용.
 * marker 를 발화 전에 제거하므로 onSnapshot 이 여러 번 와도 정확히 1회.
 */
export function trackPlannerOutcomeFromStatus(
  planId: string | undefined,
  status: 'ready' | 'streaming' | 'error' | undefined,
): 'completed' | 'failed' | null {
  if (!planId || typeof window === 'undefined') return null;
  let marker: { planId?: string; durationDays?: number; freeCoupon?: boolean } | null = null;
  try {
    const raw = sessionStorage.getItem(PENDING_COMPLETE_KEY);
    marker = raw ? JSON.parse(raw) : null;
  } catch { return null; }
  if (!marker || marker.planId !== planId) return null;
  if (status === 'streaming') return null; // 아직 미확정 — marker 유지
  try { sessionStorage.removeItem(PENDING_COMPLETE_KEY); } catch { /* noop */ }
  if (status === 'error') return 'failed'; // 스트리밍 최종 실패 — 완료 이벤트 금지
  // 'ready' (legacy 무상태 doc 은 호출부가 'ready' 로 정규화) → 발화
  trackFunnel('planner_complete', {
    duration_days: marker.durationDays,
    free_coupon: marker.freeCoupon ? 'true' : 'false',
  });
  if (marker.freeCoupon) {
    trackFunnel('free_plan_redeemed', { duration_days: marker.durationDays });
  }
  return 'completed';
}
