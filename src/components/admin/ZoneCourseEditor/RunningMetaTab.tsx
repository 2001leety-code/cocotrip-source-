// RunningMetaTab — block_type === 'running_route' 일 때 활성화되는 메타 입력.
// 사용자 매칭 (페이스/난이도/시간대/조명) + buildPrompt 시각화 데이터.
//
// TrekkingMetaTab 패턴 100% 재활용 (label + input + 도움말 + 1초 throttle autosave 는
// 부모 (AdminZoneCourseEditor) 가 담당).
//
// 주의: nullish coalescing 연산자 금지 (mojibake hook 대상). || 사용.
import type { RunningMeta } from '@/data/zone_courses/types';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';

const SURFACE_OPTIONS: { value: RunningMeta['surface_type']; label: string; desc: string }[] = [
  { value: 'asphalt', label: 'Asphalt (아스팔트)', desc: '도로 / 공원 보행로' },
  { value: 'dirt',    label: 'Dirt (흙길)',         desc: '하천 산책로 / 흙 트레일' },
  { value: 'mixed',   label: 'Mixed (혼합)',        desc: '아스팔트 + 흙 + 보도블럭' },
  { value: 'track',   label: 'Track (트랙)',        desc: '학교 / 공식 육상 트랙' },
];

const LOOP_OPTIONS: { value: RunningMeta['loop_or_out_and_back']; label: string; desc: string }[] = [
  { value: 'loop',           label: 'Loop (순환)',                desc: '출발점 = 도착점, 동일 경로 X' },
  { value: 'out_and_back',   label: 'Out & Back (왕복)',           desc: 'turn-back 후 같은 길 복귀' },
  { value: 'point_to_point', label: 'Point to Point (편도)',       desc: '출발점 != 도착점' },
];

const RECOMMENDED_TIME_OPTIONS: {
  value: NonNullable<RunningMeta['recommended_time']>[number];
  label: string;
  emoji: string;
}[] = [
  { value: 'dawn',    label: '새벽 (Dawn)',    emoji: '🌅' },
  { value: 'morning', label: '아침 (Morning)', emoji: '☀️' },
  { value: 'evening', label: '저녁 (Evening)', emoji: '🌆' },
  { value: 'night',   label: '밤 (Night)',     emoji: '🌙' },
];

const LIGHTING_OPTIONS: { value: RunningMeta['lighting_quality']; label: string; desc: string }[] = [
  { value: 'well_lit', label: 'Well-lit (밝음)',  desc: '야간 안전 — 가로등/공원등 충분' },
  { value: 'partial',  label: 'Partial (부분)',   desc: '구간별 어둠 — 저녁/밤 주의' },
  { value: 'dark',     label: 'Dark (어두움)',    desc: '야간 비추천 — 새벽/낮 한정' },
];

const DIFFICULTY_OPTIONS: { value: RunningMeta['difficulty']; label: string; desc: string }[] = [
  { value: 'beginner',     label: 'Beginner',     desc: '초보 — 평지 + 짧음 (3-5km)' },
  { value: 'intermediate', label: 'Intermediate', desc: '중급 — 약간의 고도 + 5-10km' },
  { value: 'advanced',     label: 'Advanced',     desc: '상급 — 고도 변화 + 10km+' },
];

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

function defaultRunningMeta(): RunningMeta {
  return {
    total_km: 0,
    surface_type: 'asphalt',
    elevation_gain_m: 0,
    loop_or_out_and_back: 'out_and_back',
    recommended_time: [],
    lighting_quality: 'well_lit',
    difficulty: 'beginner',
  };
}

export function RunningMetaTab({ draft, onChange }: Props) {
  const meta: RunningMeta = draft.running_meta || defaultRunningMeta();

  const updateMeta = (patch: Partial<RunningMeta>) => {
    onChange({ running_meta: { ...meta, ...patch } });
  };

  const updatePace = (patch: Partial<NonNullable<RunningMeta['pace_target']>>) => {
    const cur = meta.pace_target || { easy_min_per_km: 0, tempo_min_per_km: 0 };
    updateMeta({ pace_target: { ...cur, ...patch } });
  };

  const clearPace = () => {
    updateMeta({ pace_target: undefined });
  };

  const toggleTime = (t: NonNullable<RunningMeta['recommended_time']>[number]) => {
    const cur = meta.recommended_time || [];
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    updateMeta({ recommended_time: next });
  };

  const paceActive = !!meta.pace_target;

  return (
    <div className="space-y-5">
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-sky-800 mb-1.5">🏃 러닝 메타</h3>
        <p className="text-[11px] text-sky-700 leading-relaxed">
          block_type === 'running_route' 일 때 필수. 거리·노면·난이도·시간대/조명은
          사용자 매칭 + 안전 안내에 사용됨. 입력 후 자동 저장 (1초 throttle).
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
              value={meta.total_km || 0}
              onChange={(e) => updateMeta({ total_km: parseFloat(e.target.value || '0') || 0 })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">왕복/순환 총 거리.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">누적 고도 (m)</label>
            <input
              type="number"
              value={meta.elevation_gain_m || 0}
              onChange={(e) => updateMeta({ elevation_gain_m: parseInt(e.target.value || '0', 10) || 0 })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">0 = 평지 (한강변 등).</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">물 보충 가능 지점 수</label>
            <input
              type="number"
              value={meta.water_stations_count === undefined ? '' : meta.water_stations_count}
              onChange={(e) => updateMeta({
                water_stations_count: e.target.value === '' ? undefined : parseInt(e.target.value, 10) || 0,
              })}
              placeholder="(선택)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">음수대 + 카페 합산.</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">노면 + 코스 형태</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">노면 종류 (surface_type)</label>
            <div className="space-y-2">
              {SURFACE_OPTIONS.map((opt) => {
                const checked = meta.surface_type === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${
                      checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="run-surface"
                      checked={checked}
                      onChange={() => updateMeta({ surface_type: opt.value })}
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
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              코스 형태 (loop_or_out_and_back)
            </label>
            <div className="space-y-2">
              {LOOP_OPTIONS.map((opt) => {
                const checked = meta.loop_or_out_and_back === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${
                      checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="run-looptype"
                      checked={checked}
                      onChange={() => updateMeta({ loop_or_out_and_back: opt.value })}
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
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">난이도 + 조명</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">난이도 (difficulty)</label>
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
                      name="run-difficulty"
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
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              야간 조명 품질 (lighting_quality)
            </label>
            <div className="space-y-2">
              {LIGHTING_OPTIONS.map((opt) => {
                const checked = meta.lighting_quality === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${
                      checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="run-lighting"
                      checked={checked}
                      onChange={() => updateMeta({ lighting_quality: opt.value })}
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
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">권장 시간대 (recommended_time)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {RECOMMENDED_TIME_OPTIONS.map((opt) => {
            const checked = (meta.recommended_time || []).includes(opt.value);
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
                  onChange={() => toggleTime(opt.value)}
                />
                <span className="text-lg">{opt.emoji}</span>
                <span className="text-xs font-semibold text-gray-700">{opt.label}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-gray-400">선택 안 하면 모든 시간대 권장.</p>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-800">페이스 목표 (선택)</h3>
          {paceActive && (
            <button
              type="button"
              onClick={clearPace}
              className="text-[10px] text-red-500 hover:underline"
            >
              페이스 제거
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Easy 페이스 (분/km)</label>
            <input
              type="number"
              step="0.1"
              value={meta.pace_target?.easy_min_per_km || ''}
              onChange={(e) => updatePace({
                easy_min_per_km: parseFloat(e.target.value || '0') || 0,
              })}
              placeholder="예: 7.0"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">초보자 회복 페이스.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Tempo 페이스 (분/km)</label>
            <input
              type="number"
              step="0.1"
              value={meta.pace_target?.tempo_min_per_km || ''}
              onChange={(e) => updatePace({
                tempo_min_per_km: parseFloat(e.target.value || '0') || 0,
              })}
              placeholder="예: 5.0"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
            <p className="mt-1 text-[10px] text-gray-400">tempo (편안한 빠름).</p>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-gray-400">
          운영자 권장치 — 사용자 수준 표기에 사용. 비워두면 사용자 본인 페이스 적용.
        </p>
      </section>
    </div>
  );
}
