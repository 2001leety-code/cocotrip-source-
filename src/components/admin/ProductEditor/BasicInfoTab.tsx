// BasicInfoTab — 탭 ① 기본정보 (제목/설명/슬러그/지역/소요시간/차량/기사언어/카테고리)
import type { Tour, TourTag, TourRegion, VehicleType, DriverLanguage, GuideType } from '@/data/tours';
import { I18nField, I18nTextarea } from './I18nField';

const TAG_OPTIONS: TourTag[] = ['Popular', 'AI-Curated', 'Best Value', 'New', 'Multi-City', 'Night Tour', 'Nature', 'History'];
const REGION_OPTIONS: TourRegion[] = ['Seoul', 'Busan', 'Jeju', 'Danyang', 'Ganghwa', 'DMZ', 'Chuncheon', 'Gyeongju', 'Incheon', 'Multi-City'];
const VEHICLE_OPTIONS: VehicleType[] = ['Staria', 'Sprinter', 'SprinterMid', 'Bus'];
const DRIVER_LANG_OPTIONS: DriverLanguage[] = ['en', 'ja', 'zh'];
const GUIDE_TYPE_OPTIONS: { value: GuideType; label: string }[] = [
  { value: 'driver_only', label: '기사만' },
  { value: 'live_guide', label: '라이브 가이드' },
  { value: 'audio', label: '오디오 가이드' },
  { value: 'self_guided', label: '셀프 투어' },
];

interface Props {
  draft: Partial<Tour>;
  onChange: (patch: Partial<Tour>) => void;
}

export function BasicInfoTab({ draft, onChange }: Props) {
  return (
    <div className="space-y-5">
      <I18nField
        label="제목"
        value={draft.title}
        onChange={(v) => onChange({ title: v })}
        required
      />

      <I18nTextarea
        label="요약 (1~2줄)"
        value={draft.summary}
        onChange={(v) => onChange({ summary: v })}
        rows={2}
        required
        hint="투어 목록 카드 + 검색결과에 노출됨"
      />

      <I18nTextarea
        label="상세 설명"
        value={draft.description}
        onChange={(v) => onChange({ description: v })}
        rows={5}
        required
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            슬러그 (URL) <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={draft.slug ?? ''}
            onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
            placeholder="seoul-city-full-day"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
          <p className="mt-1 text-[10px] text-gray-400">소문자/숫자/하이픈만 — /tours/{draft.slug || 'slug'}</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">지역</label>
          <select
            value={draft.region ?? ''}
            onChange={(e) => onChange({ region: e.target.value as TourRegion })}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          >
            <option value="">선택</option>
            {REGION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">기간 (일)</label>
          <input
            type="number"
            value={draft.durationDays ?? 1}
            onChange={(e) => onChange({ durationDays: Math.max(1, parseInt(e.target.value || '1', 10)) })}
            min={1}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">시간 (시간)</label>
          <input
            type="number"
            value={draft.durationHours ?? ''}
            onChange={(e) => onChange({ durationHours: e.target.value ? parseInt(e.target.value, 10) : undefined })}
            min={0}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-1.5">
            <input
              type="checkbox"
              checked={!!draft.isNightTour}
              onChange={(e) => onChange({ isNightTour: e.target.checked })}
              className="rounded"
            />
            야간 투어
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">차량</label>
          <select
            value={draft.vehicleType ?? 'Staria'}
            onChange={(e) => onChange({ vehicleType: e.target.value as VehicleType })}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          >
            {VEHICLE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">최대 인원</label>
          <input
            type="number"
            value={draft.maxPax ?? 7}
            onChange={(e) => onChange({ maxPax: Math.max(1, parseInt(e.target.value || '1', 10)) })}
            min={1}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">최소 인원</label>
          <input
            type="number"
            value={draft.minPax ?? ''}
            onChange={(e) => onChange({ minPax: e.target.value ? parseInt(e.target.value, 10) : undefined })}
            min={1}
            placeholder="없음"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">기사 가능 언어</label>
        <div className="flex gap-2 flex-wrap">
          {DRIVER_LANG_OPTIONS.map((l) => {
            const checked = (draft.driverLanguages ?? []).includes(l);
            return (
              <label
                key={l}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs cursor-pointer ${
                  checked ? 'bg-[#7C5CFC]/10 text-[#7C5CFC] border border-[#7C5CFC]/30' : 'bg-gray-50 text-gray-600 border border-gray-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const cur = draft.driverLanguages ?? [];
                    const next = e.target.checked ? [...cur, l] : cur.filter((x) => x !== l);
                    onChange({ driverLanguages: next });
                  }}
                  className="hidden"
                />
                {l.toUpperCase()}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">가이드 종류</label>
        <div className="flex gap-2 flex-wrap">
          {GUIDE_TYPE_OPTIONS.map((g) => {
            const checked = draft.guide_type === g.value;
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => onChange({ guide_type: checked ? undefined : g.value })}
                className={`px-3 py-1.5 rounded-full text-xs ${
                  checked ? 'bg-[#7C5CFC] text-white' : 'bg-gray-50 text-gray-600 border border-gray-200'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">카테고리 / 태그</label>
        <div className="flex gap-2 flex-wrap">
          {TAG_OPTIONS.map((t) => {
            const checked = (draft.tags ?? []).includes(t);
            return (
              <label
                key={t}
                className={`px-3 py-1.5 rounded-full text-xs cursor-pointer ${
                  checked ? 'bg-[#B668FC]/10 text-[#B668FC] border border-[#B668FC]/30' : 'bg-gray-50 text-gray-600 border border-gray-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const cur = draft.tags ?? [];
                    const next = e.target.checked ? [...cur, t] : cur.filter((x) => x !== t);
                    onChange({ tags: next });
                  }}
                  className="hidden"
                />
                {t}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
