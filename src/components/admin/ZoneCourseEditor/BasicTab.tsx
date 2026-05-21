// BasicTab — 탭 ① 기본정보 (id / city / zone / theme / intensity / duration)
import type {
  ZoneCourseCity, ZoneCourseIntensity,
} from '@/data/zone_courses/types';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';
import { I18nField } from '@/components/admin/ProductEditor/I18nField';

const CITY_OPTIONS: ZoneCourseCity[] = [
  'seoul', 'busan', 'jeju', 'gyeongju', 'jeonju',
  'gangneung', 'sokcho', 'andong', 'suwon',
];

const INTENSITY_OPTIONS: { value: ZoneCourseIntensity; label: string }[] = [
  { value: 'relaxed',  label: '느긋 (Relaxed)' },
  { value: 'standard', label: '표준 (Standard)' },
  { value: 'packed',   label: '빡빡 (Packed)' },
];

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
  /** 신규 작성인지 (id 편집 가능 여부) */
  isNew: boolean;
}

const ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function BasicTab({ draft, onChange, isNew }: Props) {
  const idValid = !draft.id || ID_PATTERN.test(draft.id);

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
          블록 ID <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={draft.id || ''}
          onChange={(e) => onChange({
            id: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
          })}
          disabled={!isNew}
          placeholder="SEOUL_DAY_JONGNO_STANDARD"
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] ${
            !idValid ? 'border-red-300' : 'border-gray-200'
          } ${!isNew ? 'bg-gray-50 text-gray-400' : ''}`}
        />
        <p className="mt-1 text-[10px] text-gray-400">
          대문자 + 숫자 + underscore. 패턴: {`<CITY>_DAY_<ZONE>_<INTENSITY>`}
          {!isNew && ' (편집 불가 — 신규 등록 후 ID 변경 X)'}
        </p>
        {!idValid && (
          <p className="mt-1 text-[10px] text-red-500">대문자 + 숫자 + _ 만 사용 (소문자/공백 X)</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">도시</label>
          <select
            value={draft.city || ''}
            onChange={(e) => onChange({ city: e.target.value as ZoneCourseCity })}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          >
            <option value="">선택</option>
            {CITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">존 (zone)</label>
          <input
            type="text"
            value={draft.zone || ''}
            onChange={(e) => onChange({ zone: e.target.value })}
            placeholder="Jongno / Gangnam / Haeundae ..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
          한국어 테마 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={draft.theme || ''}
          onChange={(e) => onChange({ theme: e.target.value })}
          placeholder="전통 + 시장 + 카페"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
        />
        <p className="mt-1 text-[10px] text-gray-400">UI 카드 라벨 — 사용자에게 노출 (한국어).</p>
      </div>

      <I18nField
        label="다국어 테마"
        value={draft.theme_i18n}
        onChange={(v) => onChange({ theme_i18n: v })}
        hint="ko 비워두면 위의 한국어 테마를 사용. en/ja/zh 채우면 AI 플래너의 다국어 응답에 사용."
        translateContext="zone course 테마"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">강도</label>
          <div className="flex gap-2">
            {INTENSITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ intensity: opt.value })}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold ${
                  draft.intensity === opt.value
                    ? 'bg-[#7C5CFC] text-white'
                    : 'bg-gray-50 text-gray-600 border border-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">총 소요 시간 (분)</label>
          <input
            type="number"
            value={draft.duration_min || ''}
            onChange={(e) => onChange({
              duration_min: e.target.value ? parseInt(e.target.value, 10) : undefined,
            })}
            placeholder="자동 계산 (Stops 탭의 stay_min + transit 합계)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
          <p className="mt-1 text-[10px] text-gray-400">Stops + Transit Matrix 가 변경되면 자동 갱신.</p>
        </div>
      </div>
    </div>
  );
}
