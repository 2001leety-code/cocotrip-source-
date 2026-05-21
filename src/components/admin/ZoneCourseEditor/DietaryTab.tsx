// DietaryTab — 탭 ⑤ Dietary options (SAFETY-CRITICAL — CLAUDE.md J)
import type { ZoneCourseDietary } from '@/data/zone_courses/types';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';

const DIETARY_OPTIONS: { value: ZoneCourseDietary; label: string; emoji: string; desc: string }[] = [
  { value: 'vegan',      label: 'Vegan',      emoji: '🌱', desc: '동물성 식품 0 (육류/계란/유제품/꿀 제외)' },
  { value: 'halal',      label: 'Halal',      emoji: '🕌', desc: '돼지 + 알코올 제외, 인증 매장 우선' },
  { value: 'vegetarian', label: 'Vegetarian', emoji: '🥗', desc: '육류 제외 (유제품/계란 허용)' },
];

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

export function DietaryTab({ draft, onChange }: Props) {
  const dietary = draft.dietary_options || [];
  const toggle = (d: ZoneCourseDietary) => {
    const next = dietary.includes(d) ? dietary.filter((x) => x !== d) : [...dietary, d];
    onChange({ dietary_options: next });
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">⚠️</span>
          <h3 className="text-sm font-bold text-amber-800">SAFETY-CRITICAL</h3>
        </div>
        <p className="text-[11px] text-amber-700 leading-relaxed">
          이 zone block 의 Stops 가 해당 식이 제약을 모두 만족할 때만 체크. AI 플래너는
          체크된 dietary 만 활성화된 사용자에게 block 을 추천. <strong>오체크 = 사용자 건강
          위험</strong> — placeholder stops (verified_lunch 등) 매칭 시 _food_index.json 의
          dietary 일치 식당만 채워짐.
        </p>
      </div>

      <div className="space-y-2">
        {DIETARY_OPTIONS.map((opt) => {
          const checked = dietary.includes(opt.value);
          return (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt.value)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{opt.emoji}</span>
                  <span className="text-sm font-bold text-gray-800">{opt.label}</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
