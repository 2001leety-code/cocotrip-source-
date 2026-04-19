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
const DRAG_THRESHOLD = 50;

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
        className="flex"
        animate={controls}
        drag={editMode ? false : 'x'}
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
            className="w-full flex-shrink-0"
            style={{ width: '100%', minWidth: '100%' }}
          >
            <div
              className="overflow-y-auto px-4 pb-8"
              style={{ maxHeight: 'calc(100vh - 180px)' }}
            >
              {child}
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
