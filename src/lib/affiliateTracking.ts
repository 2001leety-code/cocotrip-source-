/**
 * 제휴 링크 익명 측정 — **단일 규격** (2026-07-30).
 *
 * 왜 새로 만드나
 *   기존 `trackAdImpression`/`trackAdClick` 은 ① GA4 에만 가고 ② 클릭 이벤트에
 *   전체 URL(`target_url`)을 실어 보냈다. URL 에는 도시·키워드·제휴 ID 가 들어 있어
 *   분석 도구에 남길 값이 아니다. 그리고 노출은 컨테이너 단위로 한 번에 기록돼
 *   화면에 실제로 보이지 않은 카드까지 "봤다" 로 세어졌다.
 *
 * 이 모듈이 보내는 값은 다섯 개뿐이다.
 *   product   — hotel · flight · esim · train · car · attraction
 *   placement — 어느 화면의 어느 자리인가
 *   language  — ko · en · ja · zh
 *   city      — 도시 키(seoul·busan…). 모르면 생략
 *   linkKey   — 같은 자리의 링크를 구분하는 짧은 식별자(호텔 3장 중 몇 번째 등)
 *
 * 🔴 절대 담지 않는다: 전체 URL · 이메일 · uid · planId · 예약번호 · 제휴 ID.
 *   URL 을 담지 않아도 product+placement+city+linkKey 면 어느 링크인지 특정된다.
 *
 * 도착지: GA4(광고 귀속)와 PostHog(퍼널) **양쪽**. 한쪽만 보내면 관리자 퍼널에서
 *   제휴 데이터가 비는데, 그게 지금 상태다.
 */
import { trackEvent } from './analytics';
import { track as posthogTrack } from './posthog';
import { hasAnalyticsConsent, onConsentChange } from './consent';

export type AffiliateProduct =
  | 'hotel' | 'flight' | 'esim' | 'train' | 'car' | 'attraction';

export interface AffiliatePayload {
  product: AffiliateProduct;
  /** 화면·자리. 예: `home_mobile_essentials`, `plan_pretrip`, `tour_detail_hotels` */
  placement: string;
  language: string;
  /** 도시 키(lowercase). 없으면 생략 — 빈 문자열을 보내지 않는다. */
  city?: string;
  /** 같은 자리 안에서 링크를 구분하는 짧은 키. 예: `slot1`, `lotte`, `zone-myeongdong` */
  linkKey?: string;
}

/** 분석 도구로 나가는 실제 속성. 여기 없는 필드는 나가지 않는다. */
function toProps(p: AffiliatePayload): Record<string, string> {
  const out: Record<string, string> = {
    product: p.product,
    placement: p.placement,
    language: p.language || 'en',
  };
  if (p.city) out.city = p.city;
  if (p.linkKey) out.link_key = p.linkKey;
  return out;
}

/** 세션 중복 방지 키 — 같은 카드를 스크롤로 여러 번 지나가도 노출은 1회다. */
function seenKey(p: AffiliatePayload): string {
  return `aff_seen:${p.product}:${p.placement}:${p.linkKey || '-'}:${p.city || '-'}`;
}

/**
 * "이미 보냈다" 도장. **실제로 보낸 뒤에만** 찍는다.
 *
 * 🔴 2026-08-02 이전에는 이 도장을 전송보다 **먼저** 찍었다. 동의 배너를 누르기 전에
 *   카드가 보이면 도장만 남고 전송은 `trackEvent`/`posthogTrack` 안에서 조용히 버려졌다.
 *   게다가 `observeAffiliateImpression` 은 첫 노출에서 `io.disconnect()` 하므로 다시
 *   불릴 일도 없다 → 나중에 동의해도 그 카드는 그 세션 내내 영영 안 나갔다.
 *   그래서 관리자 제휴 성과판의 노출이 구조적으로 0이었다(PostHog 에 이벤트 정의조차 없음).
 */
function markSent(p: AffiliatePayload): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const k = seenKey(p);
    if (window.sessionStorage.getItem(k)) return false;
    window.sessionStorage.setItem(k, '1');
    return true;
  } catch {
    // 사파리 프라이빗 모드 등에서 sessionStorage 가 막히면 중복 방지를 포기하고
    // 노출은 기록한다 — 측정이 0이 되는 것보다 중복이 낫다.
    return true;
  }
}

/**
 * 동의 전에 화면에 보인 카드. 동의하는 순간 한 번에 내보낸다.
 * 메모리에만 두며 담기는 값은 `toProps` 가 내보내는 것과 같다 — 개인정보 없음.
 * 거절/철회하면 통째로 버린다.
 */
const pendingImpressions = new Map<string, AffiliatePayload>();

/** 실제 전송 — 도착지는 GA4·PostHog 양쪽. */
function sendImpression(p: AffiliatePayload): void {
  const props = toProps(p);
  trackEvent('affiliate_impression', props);
  void posthogTrack('affiliate_impression', props);
}

/**
 * 카드가 **실제로 화면에 보였을 때** 1회 기록한다.
 * 컨테이너가 아니라 카드 하나마다 호출해야 허위 노출이 안 생긴다.
 *
 * 동의 전이면 보내지 않고 대기열에만 넣는다 — 도장을 찍지 않으므로 동의 후 다시 나간다.
 */
export function trackAffiliateImpression(p: AffiliatePayload): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) {
    // 같은 카드를 여러 번 지나가도 키가 같아 하나로 합쳐진다.
    pendingImpressions.set(seenKey(p), p);
    return;
  }
  if (!markSent(p)) return;
  sendImpression(p);
}

// 동의하는 순간 대기분을 흘려보낸다. 거절·철회면 버린다.
// (analytics.ts·posthog.ts 도 같은 방식으로 모듈 로드 시 1회 구독한다.)
onConsentChange(() => {
  if (!hasAnalyticsConsent()) {
    pendingImpressions.clear();
    return;
  }
  for (const p of pendingImpressions.values()) {
    if (markSent(p)) sendImpression(p);
  }
  pendingImpressions.clear();
});

/** 테스트 전용 — 모듈 상태(대기열)를 비운다. 제품 코드에서 부르지 않는다. */
export const __testing = {
  clearPendingImpressions: () => pendingImpressions.clear(),
  pendingCount: () => pendingImpressions.size,
};

/** 제휴 링크 클릭. URL 은 보내지 않는다. */
export function trackAffiliateClick(p: AffiliatePayload): void {
  const props = toProps(p);
  trackEvent('affiliate_click', props);
  posthogTrack('affiliate_click', props);
}

/**
 * 카드 하나를 관찰해 화면에 절반 이상 들어오면 노출을 1회 기록한다.
 *
 * `IntersectionObserver` 가 없는 환경(구형 브라우저·테스트)에서는 조용히 아무것도
 * 하지 않는다 — 노출을 "일단 기록" 해버리면 보이지 않은 카드가 봤다고 남는다.
 *
 * @returns 정리 함수. useEffect 에서 그대로 반환하면 된다.
 */
export function observeAffiliateImpression(
  el: Element | null,
  p: AffiliatePayload,
): () => void {
  if (!el || typeof IntersectionObserver === 'undefined') return () => {};
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      trackAffiliateImpression(p);
      io.disconnect();
      return;
    }
  }, { threshold: 0.5 });
  io.observe(el);
  return () => io.disconnect();
}
