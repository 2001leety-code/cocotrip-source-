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
      type="button"
      data-testid="plan-edit-toggle"
      onClick={onToggle}
      aria-pressed={editMode}
      className={`ec-btn ${editMode ? 'ec-btn-primary' : 'ec-btn-secondary'}`}
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
