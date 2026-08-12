// Each tab owns one full-width document section.
// Keyboard: Left/Right arrow keys for desktop a11y.
import { useRef, useEffect, type ReactNode } from 'react';

interface SwipeContainerProps {
  children: ReactNode[];
  current: number;
  onSlideChange: (idx: number) => void;
  editMode: boolean;
}

export function SwipeContainer({ children, current, onSlideChange, editMode }: SwipeContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const totalSlides = children.length;

  // Keyboard navigation (desktop a11y)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editMode) return;
      if (e.key === 'ArrowLeft') onSlideChange(Math.max(current - 1, 0));
      if (e.key === 'ArrowRight') onSlideChange(Math.min(current + 1, totalSlides - 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, editMode, totalSlides, onSlideChange]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{ touchAction: editMode ? 'auto' : 'pan-y' }}
    >
      <div
        className="flex items-start"
        style={{ transform: `translateX(-${current * 100}%)` }}
      >
        {children.map((child, i) => {
          const isActive = i === current;
          return (
          <div
            key={i}
            // w-full + flex-shrink-0 만으로 충분 — 인라인 width:100%/minWidth:100% 제거
            // (Tailwind 클래스와 중복 + style 우선순위 충돌 가능성).
            className="w-full flex-shrink-0"
            // 🔴 2026-07-28 (탭 빈 공간 + 접근성):
            //   ① flex 컨테이너 높이는 가장 긴 슬라이드를 따라간다. 그래서 짧은 탭을 보면
            //      아래에 빈 공간이 남았다(실측 Day1 ~1,464px / Day3 ~1,456px).
            //      선택 안 된 슬라이드를 height:0 + overflow:hidden 으로 접어 부모 높이가
            //      **선택된 탭 높이만** 따라가게 한다.
            //   ② 숨은 슬라이드의 버튼·링크에 키보드 초점이 들어가던 것도 함께 차단한다
            //      (aria-hidden + inert). 화면에 안 보이는 컨트롤에 Tab 이 멈추면 안 된다.
            //   translateX 캐러셀은 유지 — 좌우 이동 애니메이션이 그대로 동작한다.
            style={isActive ? undefined : { height: 0, overflow: 'hidden' }}
            aria-hidden={isActive ? undefined : true}
            inert={!isActive}
          >
            <div
              // 2026-06-23 (운영자 #2): 슬라이드 안쪽 max-h + overflow-y-auto 제거.
              // 기존엔 슬라이드별 고정높이(100dvh-200px) 스크롤 컨테이너가 페이지(body) 스크롤
              // 위에 중첩 → 세로 스크롤바 2개 + 스크롤 혼란. 캐러셀은 가로 translateX 라
              // 슬라이드 높이에 의존하지 않으므로(좌우 탭 네비 영향 0) 안쪽 스크롤을 없애
              // 콘텐츠가 자연히 흐르게 함 → 페이지 스크롤 하나로 일원화.
              className="px-4 pb-8"
            >
              {child}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
