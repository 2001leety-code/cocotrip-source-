// Horizontal swipe carousel using framer-motion drag.
// Each slide is a full-width panel. Snap-to-slide on drag release.
// Edit mode: drag={false} to prevent conflict with dnd-kit (Pillar B).
// Keyboard: Left/Right arrow keys for desktop a11y.
import { useRef, useEffect, type ReactNode } from 'react';
import { motion, useAnimation } from 'framer-motion';

interface SwipeContainerProps {
  children: ReactNode[];
  current: number;
  onSlideChange: (idx: number) => void;
  editMode: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };
// 80px (was 50): a tap on StopCard with slight finger drift no longer triggers
// a slide change. Velocity check (500 px/s) still catches deliberate swipes.
const DRAG_THRESHOLD = 80;

export function SwipeContainer({ children, current, onSlideChange, editMode }: SwipeContainerProps) {
  const controls = useAnimation();
  const containerRef = useRef<HTMLDivElement>(null);
  const totalSlides = children.length;

  // Animate to current slide
  useEffect(() => {
    controls.start({ x: `-${current * 100}%`, transition: SPRING });
  }, [current, controls]);

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
      <motion.div
        // items-start: 안쪽 스크롤 제거(운영자 #2) 후 슬라이드 래퍼가 세로로 stretch 되지
        // 않도록 상단 정렬 — 짧은 슬라이드가 불필요하게 늘어나지 않게.
        className="flex items-start"
        animate={controls}
        // 2026-05-03 사용자 결정: 좌우 드래그 제거, 탭 클릭만으로 네비게이션.
        // 키보드 ←/→ 화살표 useEffect는 그대로 유지 (a11y).
        drag={false}
        dragElastic={0.2}
        dragConstraints={{ left: 0, right: 0 }}
        dragDirectionLock
        onDragEnd={(_e, info) => {
          if (editMode) return;
          const offset = info.offset.x;
          const velocity = info.velocity.x;
          // Swipe left (next) or right (prev)
          if (offset < -DRAG_THRESHOLD || velocity < -500) {
            onSlideChange(Math.min(current + 1, totalSlides - 1));
          } else if (offset > DRAG_THRESHOLD || velocity > 500) {
            onSlideChange(Math.max(current - 1, 0));
          } else {
            // Snap back
            controls.start({ x: `-${current * 100}%`, transition: SPRING });
          }
        }}
        style={{ x: 0 }}
      >
        {children.map((child, i) => (
          <div
            key={i}
            // w-full + flex-shrink-0 만으로 충분 — 인라인 width:100%/minWidth:100% 제거
            // (Tailwind 클래스와 중복 + style 우선순위 충돌 가능성).
            className="w-full flex-shrink-0"
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
        ))}
      </motion.div>
    </div>
  );
}
