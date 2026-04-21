// Edit mode toggle button -- placed in PlanDetailPage header area.
import { Pencil, Check } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';

interface EditModeToggleProps {
  editMode: boolean;
  onToggle: () => void;
}

export function EditModeToggle({ editMode, onToggle }: EditModeToggleProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ed = pd.editor || {};

  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
        editMode
          ? 'bg-[#7C5CFC] text-white shadow-lg shadow-[#7C5CFC]/25'
          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
      }`}
    >
      {editMode ? (
        <>
          <Check className="w-3.5 h-3.5" />
          <span>{ed.doneEditing || 'Done'}</span>
        </>
      ) : (
        <>
          <Pencil className="w-3.5 h-3.5" />
          <span>{ed.editMode || 'Edit'}</span>
        </>
      )}
    </button>
  );
}
