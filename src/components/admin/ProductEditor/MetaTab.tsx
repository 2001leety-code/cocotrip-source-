// MetaTab — 탭 ⑨ 메타·QA (적합성/준비물/중요정보/상태/SEO)
import type { Tour, Suitability, TourStatus } from '@/data/tours';
import { I18nTextarea, I18nField } from './I18nField';

interface Props {
  draft: Partial<Tour>;
  onChange: (patch: Partial<Tour>) => void;
}

export function MetaTab({ draft, onChange }: Props) {
  const suit: Suitability = draft.suitability ?? {};
  const updateSuit = (patch: Partial<Suitability>) => {
    onChange({ suitability: { ...suit, ...patch } });
  };

  return (
    <div className="space-y-5">
      <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
        <h3 className="text-sm font-bold text-gray-800 mb-3">적합성 / 제약</h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">최소 연령</label>
            <input
              type="number"
              value={suit.min_age ?? ''}
              onChange={(e) => updateSuit({ min_age: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              placeholder="없음"
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">최대 연령</label>
            <input
              type="number"
              value={suit.max_age ?? ''}
              onChange={(e) => updateSuit({ max_age: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              placeholder="없음"
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">체력 요구</label>
            <select
              value={suit.fitness_level ?? ''}
              onChange={(e) => updateSuit({ fitness_level: (e.target.value || undefined) as Suitability['fitness_level'] })}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
            >
              <option value="">선택 안 함</option>
              <option value="easy">쉬움</option>
              <option value="moderate">보통</option>
              <option value="challenging">도전적</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {([
            { k: 'wheelchair_accessible', label: '♿ 휠체어' },
            { k: 'stroller_friendly', label: '🚼 유모차' },
            { k: 'pregnancy_safe', label: '🤰 임산부' },
            { k: 'infant_seat_available', label: '🚸 카시트' },
          ] as const).map((opt) => (
            <label
              key={opt.k}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={!!suit[opt.k]}
                onChange={(e) => updateSuit({ [opt.k]: e.target.checked } as Partial<Suitability>)}
              />
              {opt.label}
            </label>
          ))}
        </div>

        <I18nField
          label="추가 안내 (선택)"
          value={suit.notes}
          onChange={(v) => updateSuit({ notes: v })}
          optional
          hint="예: 이동량이 많지 않아 어르신 동반에도 적합"
        />
      </section>

      <section>
        <I18nTextarea
          label="준비물"
          value={draft.what_to_bring}
          onChange={(v) => onChange({ what_to_bring: v })}
          rows={3}
          optional
          placeholder="편한 신발, 양산, 작은 가방 등"
        />
      </section>

      <section>
        <I18nTextarea
          label="중요 정보"
          value={draft.important_info}
          onChange={(v) => onChange({ important_info: v })}
          rows={4}
          optional
          placeholder="- 출발 30분 전 미팅 포인트 도착 권장\n- 비/눈에도 정상 운영"
        />
      </section>

      <section className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">운영 / SEO</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">상태</label>
            <div className="flex gap-2">
              {([
                { v: 'draft', label: 'Draft' },
                { v: 'published', label: 'Published' },
                { v: 'archived', label: 'Archived' },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onChange({ status: opt.v as TourStatus })}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold ${
                    (draft.status ?? 'draft') === opt.v ? 'bg-[#7C5CFC] text-white' : 'bg-gray-50 text-gray-600 border border-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-1.5 mt-6">
              <input
                type="checkbox"
                checked={!!draft.do_not_delete}
                onChange={(e) => onChange({ do_not_delete: e.target.checked })}
              />
              cleanup cron 보호 (do_not_delete)
            </label>
            <p className="text-[10px] text-gray-400 ml-6">PDF golden fixture 같은 보호 대상에 체크</p>
          </div>
        </div>
      </section>
    </div>
  );
}
