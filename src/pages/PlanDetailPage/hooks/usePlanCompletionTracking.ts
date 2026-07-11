// P1 보완 (운영자 2026-07-11): planner_complete / free_plan_redeemed 를
// Firestore plan.status 가 실제 확정된 시점에 정확히 1회 발화.
//   - usePlannerHandlers 가 API 수락 시 심은 pending marker(sessionStorage)와
//     이 페이지의 planId 가 일치할 때만 동작 (옛/타인 플랜 열람 = 무시).
//   - status 'ready' → 발화, 'error'(스트리밍 최종 실패) → 발화 없이 marker 폐기,
//     'streaming' → 대기. 발화 전 marker 제거라 onSnapshot 다중 호출에도 1회.
//   - legacy 무상태 doc(옛 비스트리밍 플랜)은 저장 완료 상태이므로 'ready' 로 정규화.
import { useEffect } from 'react';
import { trackPlannerOutcomeFromStatus } from '@/lib/analytics';

export function usePlanCompletionTracking(
  planId: string | undefined,
  status: 'ready' | 'streaming' | 'error' | undefined,
  hasPlan: boolean,
) {
  useEffect(() => {
    if (!planId || !hasPlan) return;
    try {
      trackPlannerOutcomeFromStatus(planId, status || 'ready');
    } catch { /* analytics 실패는 렌더에 영향 없음 */ }
  }, [planId, status, hasPlan]);
}
