import { useEffect, useRef } from 'react';
import { trackCharterQuoteStart, trackCharterQuoteComplete, trackCharterStep } from '@/lib/analytics';
import { onConsentChange } from '@/lib/consent';

/**
 * 차터 견적 퍼널 계측 — 시작 / 단계 도달 / 완료.
 *
 * 🔴 2026-08-01 (리뷰 지적으로 재작성): 예전 구현은 "보냈다" 표시를 **전송 성공과 무관하게**
 *   먼저 찍었다. 쿠키 동의가 미결정이면 분석 함수는 이벤트를 조용히 버리는데 ref 는 이미
 *   true 라, 사용자가 곧바로 수락해도 다시 보내지 않았다. 첫 진입에 배너를 보는 신규 방문자
 *   — 우리가 세려던 바로 그 사람들 — 이 통째로 누락되는 구조였다.
 *
 * 지금 규칙:
 *   · track* 함수가 **실제 전송 시도 여부**를 돌려주고, true 일 때만 완료로 표시한다.
 *   · 동의가 `accepted` 로 바뀌면 현재 견적 시작·현재 단계를 각각 정확히 1회 보낸다.
 *   · `dismissed` / `revoked` 에서는 보내지도, 표시하지도 않는다.
 *   · 단계는 최초 도달 1회만 — 뒤로 갔다 와도 재발화하지 않는다(이탈 지점을 단조 퍼널로 읽기 위함).
 *
 * CharterWizard 본체에서 분리한 이유: 위저드를 통째로 마운트하면 firebase·지오코딩까지
 * 끌려와 테스트가 환경 문제로 죽는다(`buildTourJsonLd` 를 분리한 것과 같은 이유).
 * 동의 상태별 동작은 `tests/unit/charter-funnel-consent.test.ts` 가 이 훅을 직접 검증한다.
 */
export function useCharterFunnelTracking(params: {
  currentStep: number;
  /** step 6 에서 유효한 견적이 나왔는가. 아직이면 완료 이벤트를 보내지 않는다. */
  quoteReady: boolean;
  vehicleType: string;
  /**
   * 이어하기(ResumeWizardModal) 결정을 기다리는 중인가.
   *
   * 🔴 2026-08-02 (리뷰 지적): 24시간 내 스냅샷이 있으면 위저드는 `currentStep` 을 1 로 둔 채
   *   이어하기 모달을 먼저 띄운다. 그 1 을 그대로 기록하면, 5단계를 이어받은 세션에 1단계와
   *   5단계가 **둘 다** 찍혀 단계별 이탈률이 부풀려진다(화면에는 1단계를 보여준 적도 없다).
   *   그래서 결정이 끝날 때까지 보류하고, 복원된 단계부터 보낸다.
   */
  paused?: boolean;
}): void {
  const { currentStep, quoteReady, vehicleType, paused = false } = params;
  const startSent = useRef(false);
  const stepsSent = useRef<Set<number>>(new Set());
  const completeSent = useRef(false);

  useEffect(() => {
    if (paused) return;
    const flush = () => {
      if (!startSent.current && trackCharterQuoteStart()) startSent.current = true;
      if (!stepsSent.current.has(currentStep) && trackCharterStep(currentStep)) {
        stepsSent.current.add(currentStep);
      }
    };
    flush();
    // 수락 전이라 버려졌다면 수락 시점에 한 번 더. (dismissed/revoked 는 그대로 둔다.)
    return onConsentChange((s) => { if (s === 'accepted') flush(); });
  }, [currentStep, paused]);

  useEffect(() => {
    if (paused || !quoteReady) return;
    const send = () => {
      if (completeSent.current) return;
      if (trackCharterQuoteComplete({ vehicleType })) completeSent.current = true;
    };
    send();
    return onConsentChange((s) => { if (s === 'accepted') send(); });
  }, [paused, quoteReady, vehicleType]);
}
