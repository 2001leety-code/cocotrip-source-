import { useEffect, useState } from 'react';
import { readAiPlanNotices, subscribeAiPlanNotices, isAiCheckoutHeldInThisTab } from '../lib/aiPlanIssuanceNotice';
/**
 * version state + subscribe effect. getter 가 매번 새 배열이라 useSyncExternalStore 미사용.
 * 매 render 마다 read → uid 가 바뀌면 그 uid 의 notice 만 즉시 표시.
 */
export function useAiPlanNotices(uid: string | null | undefined) {
  const [, setVersion] = useState(0);
  useEffect(() => subscribeAiPlanNotices(() => setVersion((v) => v + 1)), []);
  return { ...readAiPlanNotices(uid || null), tabHold: isAiCheckoutHeldInThisTab() };
}
