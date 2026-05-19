// IncludedExcludedTab — 탭 ⑥ 포함 / 미포함 (TourHighlight[] 두 array)
import { Plus, Trash2 } from 'lucide-react';
import type { Tour, TourHighlight } from '@/data/tours';
import { I18nField } from './I18nField';

interface Props {
  draft: Partial<Tour>;
  onChange: (patch: Partial<Tour>) => void;
}

const ICON_OPTIONS = ['Car', 'User', 'Fuel', 'Heart', 'Utensils', 'Ticket', 'Plane', 'ShoppingBag', 'Landmark', 'Sunset', 'Shield', 'CheckCircle2'];

function HighlightList({
  title, hint, value, onChange,
}: {
  title: string;
  hint: string;
  value: TourHighlight[];
  onChange: (next: TourHighlight[]) => void;
}) {
  const add = () => onChange([...value, { icon: 'CheckCircle2', text: { ko: '', en: '', ja: '', zh: '' } }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<TourHighlight>) =>
    onChange(value.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));

  return (
    <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>
        </div>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-white px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10 border border-gray-200"
        >
          <Plus className="w-3.5 h-3.5" />
          항목 추가
        </button>
      </div>

      {value.length === 0 && (
        <p className="text-center py-3 text-xs text-gray-400">투어별 추가 항목 없음 (글로벌만 표시)</p>
      )}

      {value.map((h, i) => (
        <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 mb-2">
          <div className="flex items-start gap-2">
            <div className="w-24 shrink-0">
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">아이콘</label>
              <select
                value={h.icon}
                onChange={(e) => update(i, { icon: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
              >
                {ICON_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <I18nField label="텍스트" value={h.text} onChange={(v) => update(i, { text: v })} />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1.5 mt-5 rounded hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

export function IncludedExcludedTab({ draft, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-[11px] text-blue-700">
        ℹ️ 모든 투어에 글로벌 기본값 (전용 차량·영어 기사·연료/통행료 포함 / 식사·입장료 별도) 이 자동 적용됩니다. 이 탭에서는 <strong>투어별 추가</strong>만 등록하세요.
      </div>

      <HighlightList
        title="추가 포함"
        hint="이 투어에만 포함되는 항목 (예: 한복 무료 대여, 특정 패스)"
        value={draft.included ?? []}
        onChange={(v) => onChange({ included: v })}
      />

      <HighlightList
        title="추가 미포함"
        hint="이 투어 특이사항 (예: 케이블카 별도, 야간 식사 별도)"
        value={draft.excluded ?? []}
        onChange={(v) => onChange({ excluded: v })}
      />
    </div>
  );
}
