// Sortable wrapper for StopCard with drag handle and delete button.
// Only active when editMode = true.
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { StopCard } from './StopCard';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanStop } from '../types';
import { getPlanDetailDict } from '../types';

interface SortableStopCardProps {
  stop: PlanStop;
  stopId: string;
  editMode: boolean;
  onDelete: () => void;
}

export function SortableStopCard({ stop, stopId, editMode, onDelete }: SortableStopCardProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ed = pd.editor || {};

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: stopId,
    disabled: !editMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto' as string | number,
  };

  // Outer wrapper: dnd-kit OWNS transform/opacity/zIndex (drag positioning).
  // Inner motion.div: framer-motion OWNS layout/enter/exit (list animations).
  // Splitting prevents the two libraries from fighting over the same element's
  // transform — previously caused 30fps drag jank on mobile (PR #76 analysis).
  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <motion.div
        layout
        initial={stop._userAdded ? { opacity: 0, y: -10 } : false}
        animate={{ opacity: 1, y: 0 }}
        // height/marginBottom 애니메이션 제거 — repaint 유발 (60fps 깨짐).
        // layout prop이 부모 reflow를 자동 처리하므로 transform 기반 exit만으로 충분.
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        {editMode && (
          <div className="absolute -left-8 top-1/2 -translate-y-1/2 hidden sm:flex flex-col items-center gap-1 z-10">
            <button
              {...attributes}
              {...listeners}
              className="p-1 rounded-md bg-white/5 hover:bg-white/10 cursor-grab active:cursor-grabbing transition-colors touch-none"
              title={t.a11y?.dragToReorder ||'Drag to reorder'}
            >
              <GripVertical className="w-4 h-4 text-white/55" />
            </button>
          </div>
        )}

        {/* Mobile drag handle — top-left, on-card (off-screen -left-8 didn't work on narrow viewports) */}
        {editMode && (
          <button
            {...attributes}
            {...listeners}
            className="sm:hidden absolute left-2 top-2 z-10 p-1.5 rounded-md bg-white/8 hover:bg-white/15 cursor-grab active:cursor-grabbing transition-colors touch-none"
            title={t.a11y?.dragToReorder ||'Drag to reorder'}
          >
            <GripVertical className="w-4 h-4 text-white/50" />
          </button>
        )}

        {editMode && (
          <button
            onClick={onDelete}
            className="absolute -right-2 -top-2 z-10 p-1.5 rounded-full bg-red-500/80 hover:bg-red-500 text-white shadow-lg transition-all hover:scale-110"
            title={ed.deleteButton || 'Remove'}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}

        {stop._userAdded && (
          <div className="absolute -right-1 top-8 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#7C5CFC]/20 border border-[#7C5CFC]/30">
            <Sparkles className="w-2.5 h-2.5 text-[#7C5CFC]" />
            <span className="text-[9px] text-[#7C5CFC] font-medium">{ed.userAdded || 'Added by you'}</span>
          </div>
        )}

        <div className={editMode ? 'border border-dashed border-white/10 rounded-xl transition-colors' : ''}>
          <StopCard stop={stop} />
        </div>
      </motion.div>
    </div>
  );
}
