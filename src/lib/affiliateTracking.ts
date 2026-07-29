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

function markSeen(p: AffiliatePayload): boolean {
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
 * 카드가 **실제로 화면에 보였을 때** 1회 기록한다.
 * 컨테이너가 아니라 카드 하나마다 호출해야 허위 노출이 안 생긴다.
 */
export function trackAffiliateImpression(p: AffiliatePayload): void {
  if (!markSeen(p)) return;
  const props = toProps(p);
  trackEvent('affiliate_impression', props);
  posthogTrack('affiliate_impression', props);
}

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
