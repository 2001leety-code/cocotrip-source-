// PricingTab — 탭 ⑤ 가격·예약 (기본가 / 슬롯)
import { Plus, Trash2 } from 'lucide-react';
import type { Tour, TourSlot } from '@/data/tours';
import { I18nField } from './I18nField';

const KRW_PER_USD = 1430;

interface Props {
  draft: Partial<Tour>;
  onChange: (patch: Partial<Tour>) => void;
}

function genSlotId(): string {
  return `slot_${Math.random().toString(36).slice(2, 8)}`;
}

export function PricingTab({ draft, onChange }: Props) {
  const slots = draft.slots ?? [];
  const setSlots = (next: TourSlot[]) => onChange({ slots: next });

  const addSlot = () => {
    const newSlot: TourSlot = {
      id: genSlotId(),
      start_time: '09:00',
      is_active: true,
    };
    setSlots([...slots, newSlot]);
  };
  const removeSlot = (id: string) => {
    setSlots(slots.filter((s) => s.id !== id));
  };
  const updateSlot = (id: string, patch: Partial<TourSlot>) => {
    setSlots(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const priceUsd = draft.priceFrom ?? 0;
  const priceKrw = Math.round(priceUsd * KRW_PER_USD);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">기본 가격</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">가격 단위</label>
            <div className="flex gap-2">
              {([
                { v: 'group', label: '차량 1대 (그룹)' },
                { v: 'per_person', label: '1인당' },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onChange({ priceUnit: opt.v })}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold ${
                    (draft.priceUnit ?? 'group') === opt.v ? 'bg-[#7C5CFC] text-white' : 'bg-gray-50 text-gray-600 border border-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">통화</label>
            <select
              value={draft.currency ?? 'USD'}
              onChange={(e) => onChange({ currency: e.target.value as 'USD' })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">기본 가격 (USD)</label>
            <input
              type="number"
              value={draft.priceFrom ?? 0}
              onChange={(e) => onChange({ priceFrom: parseFloat(e.target.value || '0') })}
              min={0}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">≈ ₩{priceKrw.toLocaleString()} ({KRW_PER_USD} KRW/USD)</p>
          </div>
        </div>

        <div className="mt-4">
          <I18nField
            label="가격 표시 안내"
            value={draft.price_display_note}
            onChange={(v) => onChange({ price_display_note: v })}
            optional
            hint="예: 성인 1인 기준 가격 / 차량 1대 그룹 (인원 무관)"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-gray-800">시간 슬롯</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">슬롯 없으면 사용자 다이얼로그에서 시간 picker 미노출.</p>
          </div>
          <button
            type="button"
            onClick={addSlot}
            className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10"
          >
            <Plus className="w-3.5 h-3.5" />
            슬롯 추가
          </button>
        </div>

        {slots.length === 0 && (
          <div className="text-center py-6 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
            등록된 슬롯 없음
          </div>
        )}

        {slots.map((slot) => (
          <div key={slot.id} className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50/50">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-start">
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">시각</label>
                <input
                  type="text"
                  value={slot.start_time}
                  onChange={(e) => updateSlot(slot.id, { start_time: e.target.value })}
                  placeholder="09:00"
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
                />
              </div>
              <div className="sm:col-span-2">
                <I18nField
                  label="라벨"
                  value={slot.label}
                  onChange={(v) => updateSlot(slot.id, { label: v })}
                  optional
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">정원</label>
                <input
                  type="number"
                  value={slot.capacity ?? ''}
                  onChange={(e) => updateSlot(slot.id, { capacity: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                  placeholder="기본=maxPax"
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">가산 (KRW)</label>
                <input
                  type="number"
                  value={slot.price_modifier_krw ?? 0}
                  onChange={(e) => updateSlot(slot.id, { price_modifier_krw: parseInt(e.target.value || '0', 10) || undefined })}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={slot.is_active}
                  onChange={(e) => updateSlot(slot.id, { is_active: e.target.checked })}
                />
                활성
              </label>
              <button
                type="button"
                onClick={() => removeSlot(slot.id)}
                className="p-1.5 rounded hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
