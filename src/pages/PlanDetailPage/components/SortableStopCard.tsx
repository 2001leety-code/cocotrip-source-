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

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={stop._userAdded ? { opacity: 0, y: -10 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="relative group"
    >
      {editMode && (
        <div className="absolute -left-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10">
          <button
            {...attributes}
            {...listeners}
            className="p-1 rounded-md bg-white/5 hover:bg-white/10 cursor-grab active:cursor-grabbing transition-colors touch-none"
            title={t.a11y?.dragToReorder ||'Drag to reorder'}
          >
            <GripVertical className="w-4 h-4 text-white/30" />
          </button>
        </div>
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
  );
}
