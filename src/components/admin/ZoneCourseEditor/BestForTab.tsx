// BestForTab — 탭 ④ Best For / Unsuitable chips
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';

const BEST_FOR_PRESETS = [
  'first_time_visitor',
  'family',
  'history_lover',
  'k_pop_fan',
  'foodie',
  'photographer',
  'shopper',
  'nature_lover',
  'couple',
  'solo_traveler',
];

const UNSUITABLE_PRESETS = [
  'wheelchair_user',
  'infant_stroller',
  'pregnancy',
  'severe_mobility_limitation',
  'fasting_traveler',
  'night_owl',
];

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

function ChipsEditor({
  label, items, presets, onChange, hint, accent,
}: {
  label: string;
  items: string[];
  presets: string[];
  onChange: (next: string[]) => void;
  hint?: string;
  accent: 'positive' | 'negative';
}) {
  const baseChip = accent === 'positive'
    ? { active: 'bg-[#7C5CFC]/10 text-[#7C5CFC] border-[#7C5CFC]/30', idle: 'bg-gray-50 text-gray-600 border-gray-200' }
    : { active: 'bg-red-50 text-red-700 border-red-200', idle: 'bg-gray-50 text-gray-600 border-gray-200' };

  const toggle = (preset: string) => {
    const cur = items;
    onChange(cur.includes(preset) ? cur.filter((x) => x !== preset) : [...cur, preset]);
  };

  const addCustom = () => {
    const v = window.prompt(`${label} 에 추가할 값 (영문 snake_case):`);
    if (!v) return;
    const normalized = v.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!normalized) return;
    if (items.includes(normalized)) return;
    onChange([...items, normalized]);
  };

  const removeCustom = (val: string) => onChange(items.filter((x) => x !== val));

  return (
    <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
      <h3 className="text-sm font-bold text-gray-800 mb-1.5">{label}</h3>
      {hint && <p className="text-[10px] text-gray-400 mb-3">{hint}</p>}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {presets.map((p) => {
          const checked = items.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={`px-2.5 py-1 rounded-full text-[11px] border ${
                checked ? baseChip.active : baseChip.idle
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>

      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase text-gray-500">커스텀</span>
          <button
            type="button"
            onClick={addCustom}
            className="text-[10px] font-bold text-[#7C5CFC] hover:underline"
          >
            + 커스텀 추가
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.filter((it) => !presets.includes(it)).map((it) => (
            <span
              key={it}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-white border border-gray-200"
            >
              {it}
              <button
                type="button"
                onClick={() => removeCustom(it)}
                className="text-gray-400 hover:text-red-500"
              >
                ✕
              </button>
            </span>
          ))}
          {items.filter((it) => !presets.includes(it)).length === 0 && (
            <span className="text-[10px] text-gray-400">없음</span>
          )}
        </div>
      </div>
    </section>
  );
}

export function BestForTab({ draft, onChange }: Props) {
  return (
    <div className="space-y-5">
      <ChipsEditor
        label="잘 맞는 그룹 (best_for)"
        items={draft.best_for || []}
        presets={BEST_FOR_PRESETS}
        onChange={(v) => onChange({ best_for: v })}
        hint="이 zone block 을 추천할 사용자 그룹 — AI 플래너 matching 신호."
        accent="positive"
      />

      <ChipsEditor
        label="비추천 그룹 (unsuitable_for)"
        items={draft.unsuitable_for || []}
        presets={UNSUITABLE_PRESETS}
        onChange={(v) => onChange({ unsuitable_for: v })}
        hint="이 그룹의 plan 에서는 이 block 을 제외 — SAFETY 우선 (휠체어/임산부 등)."
        accent="negative"
      />
    </div>
  );
}
