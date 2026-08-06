/**
 * 위저드가 **실제로 화면에 보였는지** 1회 기록한다 (2026-08-06).
 *
 * 왜 필요한가
 *   6월 광고 코호트 109명이 `/planner` 에 도착했고 플랜 생성은 0 이었다. 오류는 0건,
 *   체류 시간 중앙값은 **10초**(49% 가 10초 미만). 그런데 그때 우리는
 *   **"보고도 안 썼다" 와 "아예 못 봤다" 를 구분할 수단이 없었다.** 둘은 처방이 정반대다
 *   — 전자는 위저드 자체를 고쳐야 하고, 후자는 그냥 위로 올리면 된다.
 *
 *   실측(운영 모바일): 첫 질문이 y=1369px, 화면 높이 844px → **1.6 화면 아래**.
 *   10초 안에 거기까지 스크롤할 이유가 없다. 그래서 이 신호를 남긴다.
 *
 * 판독법
 *   `wizard_seen` / `$pageview(/planner)` 비율이 낮다 = 못 본 것(배치 문제).
 *   비율이 높은데 `wizard_step_advanced` 가 없다 = 보고도 안 쓴 것(위저드 문제).
 *
 * 구현 메모
 *   - IntersectionObserver 미지원 환경(구형·프리렌더 puppeteer)에서는 조용히 아무것도 안 한다.
 *     계측은 절대 화면을 깨면 안 된다.
 *   - 관찰 대상은 **자식이 실제로 차지하는 영역**이라 래퍼 div 를 쓴다. `display:contents`
 *     로 하면 박스가 없어져 IntersectionObserver 가 영원히 발화하지 않는다.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { track as posthogTrack } from '@/lib/posthog';

export function WizardSeenProbe({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || firedRef.current) continue;
          firedRef.current = true;
          void posthogTrack('wizard_seen', {
            // 처음 보였을 때 손님이 얼마나 스크롤한 상태였나. 0 이면 첫 화면에 있었다는 뜻.
            scroll_y: Math.round(window.scrollY),
            viewport_h: Math.round(window.innerHeight),
          });
          io.disconnect();
        }
      },
      // 살짝이라도 보이면 본 것으로 친다. 위저드 카드는 화면보다 길 수 있어
      // threshold 를 높게 잡으면 "봤는데 안 봤다" 로 샌다.
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <div ref={ref} className={className}>{children}</div>;
}
