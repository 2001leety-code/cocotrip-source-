/**
 * 제휴 카드 껍데기 — 이 안에 들어온 내용이 화면에 보이면 노출 1회를 기록한다. (2026-07-30)
 *
 * 훅이 ref 를 돌려주는 방식을 쓰지 않는 이유:
 *   `const aff = useAffiliateCard(...)` 처럼 ref 를 밖으로 넘기면 호출부가 렌더 도중
 *   `aff.ref` 를 읽게 된다. 렌더가 언제 몇 번 실행될지 모르는 React 에서 ref 를 렌더
 *   중에 만지는 것은 금지돼 있다(react-hooks/refs). 그래서 ref 는 이 컴포넌트 밖으로
 *   나가지 않고, 관찰도 여기서만 한다.
 *
 * 클릭은 `trackAffiliateClick` 을 직접 부른다 — 클릭 핸들러는 렌더 중이 아니라
 * 사용자가 누를 때 실행되므로 ref 문제와 무관하다.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { observeAffiliateImpression, type AffiliatePayload } from '@/lib/affiliateTracking';

interface Props {
  payload: AffiliatePayload;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function AffiliateCard({ payload, className, style, children }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 객체를 그대로 의존성에 넣으면 매 렌더 새 참조라 관찰이 계속 재설정된다.
  const { product, placement, language, city, linkKey } = payload;

  useEffect(() => {
    return observeAffiliateImpression(ref.current, {
      product, placement, language, city, linkKey,
    });
  }, [product, placement, language, city, linkKey]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
