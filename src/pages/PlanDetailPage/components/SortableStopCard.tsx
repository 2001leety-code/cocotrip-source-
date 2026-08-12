// Sortable wrapper for StopCard with drag handle and delete button.
// Only active when editMode = true.
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Sparkles } from 'lucide-react';
import { StopCard, type LodgingRole } from './StopCard';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanStop } from '../types';
import { getPlanDetailDict } from '../types';

interface SortableStopCardProps {
  stop: PlanStop;
  stopId: string;
  editMode: boolean;
  onDelete: () => void;
  /** P116: lodging bookend role 라벨링 — 호텔 카드 첫/마지막/중간 구분. */
  lodgingRole?: LodgingRole;
  /** plan 소유자 여부 — StopCard 의 즐겨찾기/공유 버튼 노출 게이트. */
  isOwner?: boolean;
}

export function SortableStopCard({ stop, stopId, editMode, onDelete, lodgingRole, isOwner }: SortableStopCardProps) {
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
    <div ref={setNodeRef} style={style} className="relative group">
      <div>
        {editMode && (
          <div className="absolute -left-12 top-1/2 z-10 hidden -translate-y-1/2 flex-col items-center gap-1 sm:flex">
            <button
              {...attributes}
              {...listeners}
              className="flex h-11 w-11 touch-none cursor-grab items-center justify-center rounded-ec-sm border border-ec-line bg-ec-raised text-ec-ink-2 transition-colors hover:border-ec-line-2 hover:text-ec-ink active:cursor-grabbing"
              title={t.a11y?.dragToReorder ||'Drag to reorder'}
              aria-label={t.a11y?.dragToReorder || 'Drag to reorder'}
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {/* Mobile edit controls stay in normal flow so they never cover stop details. */}
        {editMode && (
          <div data-testid="plan-stop-mobile-edit-controls" className="mb-2 flex items-center justify-between sm:hidden">
            <button
              {...attributes}
              {...listeners}
              className="flex h-11 w-11 touch-none cursor-grab items-center justify-center rounded-ec-sm border border-ec-line bg-ec-raised text-ec-ink-2 transition-colors hover:border-ec-line-2 hover:text-ec-ink active:cursor-grabbing"
              title={t.a11y?.dragToReorder || 'Drag to reorder'}
              aria-label={t.a11y?.dragToReorder || 'Drag to reorder'}
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex h-11 w-11 items-center justify-center rounded-ec-sm border border-ec-critical bg-ec-raised text-ec-critical transition-colors hover:bg-ec-sunken"
              title={ed.deleteButton || 'Remove'}
              aria-label={ed.deleteButton || 'Remove'}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {editMode && (
          <button
            type="button"
            onClick={onDelete}
            className="absolute right-1 top-1 z-10 hidden h-11 w-11 items-center justify-center rounded-ec-sm border border-ec-critical bg-ec-raised text-ec-critical transition-colors hover:bg-ec-sunken sm:flex"
            title={ed.deleteButton || 'Remove'}
            aria-label={ed.deleteButton || 'Remove'}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}

        {stop._userAdded && (
          <div data-testid="plan-stop-user-added" className={`z-10 flex items-center gap-1 rounded-full border border-ec-line-2 bg-ec-brand-wash px-2 py-1 ${editMode ? 'relative mb-2 ml-auto w-fit sm:absolute sm:right-2 sm:top-12 sm:mb-0' : 'absolute right-2 top-12'}`}>
            <Sparkles className="h-2.5 w-2.5 text-ec-brand" aria-hidden />
            <span className="text-[10px] font-medium text-ec-brand">{ed.userAdded || 'Added by you'}</span>
          </div>
        )}

        <div className={editMode ? 'rounded-ec-md border border-dashed border-ec-line-2 transition-colors' : ''}>
          <StopCard stop={stop} lodgingRole={lodgingRole} isOwner={isOwner} />
        </div>
      </div>
    </div>
  );
}
