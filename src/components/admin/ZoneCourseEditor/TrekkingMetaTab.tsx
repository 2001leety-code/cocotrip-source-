// TrekkingMetaTab — block_type === 'trekking' 일 때 활성화되는 메타 입력.
// 사용자 매칭 + 안전 안내 + buildPrompt 시각화 데이터의 모든 field 입력 가능.
//
// 기존 BasicTab / StopsTab / DietaryTab 패턴 100% 재활용 (label + input + 도움말).
// 1초 throttle autosave 는 부모 (AdminZoneCourseEditor) 가 담당.
//
// 주의: nullish coalescing 연산자 금지 (mojibake hook 대상). || 사용.
import { Plus, X } from 'lucide-react';
import type { TrekkingMeta } from '@/data/zone_courses/types';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';

const DIFFICULTY_OPTIONS: { value: TrekkingMeta['difficulty']; label: string; desc: string }[] = [
  { value: 'easy',     label: 'Easy',     desc: '평탄·짧음 (1-2시간, 고도 200m 이하)' },
  { value: 'moderate', label: 'Moderate', desc: '일반 등산 (3-4시간, 고도 200-500m)' },
  { value: 'hard',     label: 'Hard',     desc: '난이도 높음 (5시간+, 고도 500m+)' },
  { value: 'expert',   label: 'Expert',   desc: '전문가 (암벽·동계·롱코스)' },
];

const TRAIL_TYPE_OPTIONS: { value: TrekkingMeta['trail_type']; label: string }[] = [
  { value: 'forest',   label: 'Forest (숲길)' },
  { value: 'ridge',    label: 'Ridge (능선)' },
  { value: 'coastal',  label: 'Coastal (해안)' },
  { value: 'urban',    label: 'Urban (도심)' },
  { value: 'mountain', label: 'Mountain (산악)' },
];

const SEASON_OPTIONS: { value: NonNullable<TrekkingMeta['seasons_recommended']>[number]; label: string; emoji: string }[] = [
  { value: 'spring', label: '봄 (Spring)',   emoji: '🌸' },
  { value: 'summer', label: '여름 (Summer)', emoji: '☀️' },
  { value: 'autumn', label: '가을 (Autumn)', emoji: '🍁' },
  { value: 'winter', label: '겨울 (Winter)', emoji: '❄️' },
];

const GEAR_PRESETS = [
  'trekking_pole',
  'water_2L',
  'hat',
  'gloves',
  'wind_breaker',
  'rain_jacket',
  'ankle_support_shoes',
  'crampons',
  'headlamp',
  'first_aid_kit',
  'snacks',
  'sunscreen',
];

const HAZARD_PRESETS = [
  'steep_rock_climb',
  'iron_railing_section',
  'icy_winter',
  'summer_heatstroke',
  'weekend_overcrowding',
  'falling_rock',
  'wild_animal',
  'no_cellular_signal',
  'sudden_weather_change',
  'river_crossing',
];

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

function defaultTrekkingMeta(): TrekkingMeta {
  return {
    total_distance_km: 0,
    elevation_gain_m: 0,
    difficulty: 'moderate',
    trail_type: 'mountain',
    estimated_duration_min: 0,
    recommended_gear: [],
    hazards: [],
    trailhead_address: '',
  };
}

function ChipList({
  label, items, presets, onChange, hint, placeholder,
}: {
  label: string;
  items: string[];
  presets: string[];
  onChange: (next: string[]) => void;
  hint?: string;
  placeholder: string;
}) {
  const toggle = (preset: string) => {
    const next = items.includes(preset) ? items.filter((x) => x !== preset) : [...items, preset];
    onChange(next);
  };
  const addCustom = () => {
    const v = window.prompt(`${label} 에 추가할 값 (영문 snake_case, 예: ${placeholder}):`);
    if (!v) return;
    const normalized = v.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!normalized || items.includes(normalized)) return;
    onChange([...items, normalized]);
  };
  const remove = (val: string) => onChange(items.filter((x) => x !== val));

  return (
    <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
      <h4 className="text-xs font-bold text-gray-800 mb-1.5">{label}</h4>
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
                checked
                  ? 'bg-[#7C5CFC]/10 text-[#7C5CFC] border-[#7C5CFC]/30'
                  : 'bg-white text-gray-600 border-gray-200'
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
            className="flex items-center gap-1 text-[10px] font-bold text-[#7C5CFC] hover:underline"
          >
            <Plus className="w-3 h-3" /> 커스텀 추가
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
                onClick={() => remove(it)}
                className="text-gray-400 hover:text-red-500"
              >
                <X className="w-3 h-3" />
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

export function TrekkingMetaTab({ draft, onChange }: Props) {
  const meta: TrekkingMeta = draft.trekking_meta || defaultTrekkingMeta();

  const updateMeta = (patch: Partial<TrekkingMeta>) => {
    onChange({ trekking_meta: { ...meta, ...patch } });
  };
  const updateAccess = (patch: Partial<NonNullable<TrekkingMeta['trailhead_access']>>) => {
    const cur = meta.trailhead_access || {};
    updateMeta({ trailhead_access: { ...cur, ...patch } });
  };
  const toggleSeason = (s: NonNullable<TrekkingMeta['seasons_recommended']>[number]) => {
    const cur = meta.seasons_recommended || [];
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    updateMeta({ seasons_recommended: next.length > 0 ? next : undefined });
  };

  return (
    <div className="space-y-5">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-emerald-800 mb-1.5">🥾 트레킹 메타</h3>
        <p className="text-[11px] text-emerald-700 leading-relaxed">
          block_type === 'trekking' 일 때 필수. 거리·난이도·트레일헤드 등은 사용자 매칭 + 안전 안내에 사용됨.
          입력 후 자동 저장 (1초 throttle).
        </p>
      </div>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">기본 수치</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">총 거리 (km)</label>
            <input
              type="number"
              step="0.1"
              value={meta.total_distance_km || 0}
              onChange={(e) => updateMeta({ total_distance_km: parseFloat(e.target.value || '0') || 0 })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">등정 + 하산 합산.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">누적 고도 (m)</label>
            <input
              type="number"
              value={meta.elevation_gain_m || 0}
              onChange={(e) => updateMeta({ elevation_gain_m: parseInt(e.target.value || '0', 10) || 0 })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">등정 누적 고도 합 (descent 제외).</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">예상 소요 시간 (분)</label>
            <input
              type="number"
              value={meta.estimated_duration_min || 0}
              onChange={(e) => updateMeta({ estimated_duration_min: parseInt(e.target.value || '0', 10) || 0 })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">식사·휴식 제외 순수 걷기.</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">난이도 + 트레일 유형</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">난이도</label>
            <div className="space-y-2">
              {DIFFICULTY_OPTIONS.map((opt) => {
                const checked = meta.difficulty === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${
                      checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="trek-difficulty"
                      checked={checked}
                      onChange={() => updateMeta({ difficulty: opt.value })}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <p className="text-xs font-bold text-gray-800">{opt.label}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">트레일 유형</label>
            <div className="space-y-2">
              {TRAIL_TYPE_OPTIONS.map((opt) => {
                const checked = meta.trail_type === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer ${
                      checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="trek-trailtype"
                      checked={checked}
                      onChange={() => updateMeta({ trail_type: opt.value })}
                    />
                    <span className="text-xs font-semibold text-gray-700">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">고도 (선택)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">출발 지점 고도 (m)</label>
            <input
              type="number"
              value={meta.starting_elevation_m === undefined ? '' : meta.starting_elevation_m}
              onChange={(e) => updateMeta({
                starting_elevation_m: e.target.value === '' ? undefined : parseInt(e.target.value, 10) || 0,
              })}
              placeholder="(선택)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">최고 지점 고도 (m)</label>
            <input
              type="number"
              value={meta.highest_point_m === undefined ? '' : meta.highest_point_m}
              onChange={(e) => updateMeta({
                highest_point_m: e.target.value === '' ? undefined : parseInt(e.target.value, 10) || 0,
              })}
              placeholder="(선택)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
          </div>
        </div>
      </section>

      <ChipList
        label="권장 장비 (recommended_gear)"
        items={meta.recommended_gear || []}
        presets={GEAR_PRESETS}
        onChange={(v) => updateMeta({ recommended_gear: v })}
        hint="사용자에게 사전 준비 안내. snake_case 영문 (UI 가 4-lang 으로 번역)."
        placeholder="water_2L"
      />

      <ChipList
        label="위험 요소 (hazards)"
        items={meta.hazards || []}
        presets={HAZARD_PRESETS}
        onChange={(v) => updateMeta({ hazards: v })}
        hint="안전 경고 — 사용자 매칭 차단 + buildPrompt 가 prominent 표시."
        placeholder="iron_railing_section"
      />

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">트레일헤드 (시작 지점)</h3>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            트레일헤드 주소 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={meta.trailhead_address || ''}
            onChange={(e) => updateMeta({ trailhead_address: e.target.value })}
            placeholder="서울특별시 강북구 우이동 도선사 입구"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
          <p className="mt-1 text-[10px] text-gray-400">Naver Geocoding 입력값. 시작 stop 의 주소와 다를 수 있음 (예: 진입 게이트).</p>
        </div>

        <div className="mt-4 border-t border-gray-200 pt-4">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">접근 정보 (trailhead_access)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">지하철 가이드</label>
              <input
                type="text"
                value={meta.trailhead_access?.subway || ''}
                onChange={(e) => updateAccess({ subway: e.target.value || undefined })}
                placeholder="우이신설선 북한산우이역 → 마을버스 1212"
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">버스 가이드</label>
              <input
                type="text"
                value={meta.trailhead_access?.bus || ''}
                onChange={(e) => updateAccess({ bus: e.target.value || undefined })}
                placeholder="우이동 종점"
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">도심 택시 비용 (KRW)</label>
              <input
                type="number"
                value={meta.trailhead_access?.taxi_from_city_center_krw === undefined ? '' : meta.trailhead_access.taxi_from_city_center_krw}
                onChange={(e) => updateAccess({
                  taxi_from_city_center_krw: e.target.value === '' ? undefined : parseInt(e.target.value, 10) || 0,
                })}
                placeholder="15000"
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-[11px] text-gray-700">
                <input
                  type="checkbox"
                  checked={!!meta.trailhead_access?.parking_available}
                  onChange={(e) => updateAccess({ parking_available: e.target.checked })}
                />
                주차 가능
              </label>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">권장 시즌 (선택)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SEASON_OPTIONS.map((opt) => {
            const checked = (meta.seasons_recommended || []).includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                  checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSeason(opt.value)}
                />
                <span className="text-lg">{opt.emoji}</span>
                <span className="text-xs font-semibold text-gray-700">{opt.label}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-gray-400">선택 안 하면 사계절 모두 권장.</p>
      </section>
    </div>
  );
}
