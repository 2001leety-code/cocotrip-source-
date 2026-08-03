/**
 * 동의 전에 발생한 분석 이벤트를 **잃지 않고 모아 두는 대기열**. (2026-08-03)
 *
 * 🔴 왜 필요한가 — 반복해서 같은 사고가 났다.
 *   쿠키 배너는 `CookieBanner.tsx` 에서 **1.5초 뒤에** 뜬다. 그런데 첫 화면에서 자동으로
 *   나가는 계측(pageview·wizard_started·promo_view·ad_impression·plan_generated …)은
 *   그보다 먼저 발화한다. 그때 `trackEvent`/`track()` 은 동의가 없다고 조용히 버린다.
 *   호출부 대부분은 "한 번만 보낸다" 를 위해 도장(sessionStorage·ref)을 **전송보다 먼저**
 *   찍어 두므로, 손님이 나중에 수락해도 그 이벤트는 그 세션에서 영영 안 나간다.
 *
 *   호출부를 하나씩 고치는 방식은 이미 두 번 실패했다(제휴 노출 2026-08-02, 차터 2026-07-xx).
 *   새 계측이 추가될 때마다 같은 실수가 재발한다. 그래서 **보내는 지점 한 곳**에서 막는다:
 *   동의가 없으면 버리지 말고 여기 담아 두었다가, 수락하는 순간 흘려보낸다.
 *
 * 담기는 값은 각 전송 함수가 이미 정리한 속성뿐이다(허용목록 통과 후). 메모리에만 두며
 * 거절·철회하면 통째로 버린다. localStorage 에 쓰지 않는다 — 동의 없이 저장하지 않기 위해서.
 */

/** 대기열 상한. 넘으면 **가장 오래된 것부터** 버린다(최근 행동이 더 가치 있다). */
const MAX_PENDING = 60;

export interface PendingEvent {
  name: string;
  props?: Record<string, unknown>;
}

/** 도착지별 대기열 — GA4 와 PostHog 는 게이트가 달라 따로 관리한다. */
const queues = new Map<string, PendingEvent[]>();

/**
 * 동의 전 이벤트를 담아 둔다.
 * @param sink 도착지 이름 ('ga4' | 'posthog')
 */
export function queuePending(sink: string, name: string, props?: Record<string, unknown>): void {
  const q = queues.get(sink) || [];
  q.push({ name, props });
  while (q.length > MAX_PENDING) q.shift();
  queues.set(sink, q);
}

/**
 * 담아 둔 것을 꺼내 비운다. 호출자가 실제 전송을 맡는다.
 * 꺼낸 뒤 비우므로 같은 이벤트가 두 번 나가지 않는다.
 */
export function drainPending(sink: string): PendingEvent[] {
  const q = queues.get(sink);
  if (!q || q.length === 0) return [];
  queues.set(sink, []);
  return q;
}

/** 거절·철회 시 통째로 버린다. */
export function clearPending(sink?: string): void {
  if (sink) queues.set(sink, []);
  else queues.clear();
}

/** 테스트·진단용 — 지금 몇 개가 밀려 있는가. */
export function pendingCount(sink: string): number {
  return (queues.get(sink) || []).length;
}
