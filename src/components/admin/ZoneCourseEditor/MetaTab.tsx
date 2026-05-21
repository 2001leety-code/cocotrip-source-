// MetaTab — 탭 ⑨ Meta·QA (source / verified_at / verified_by / last_review_date / notes / status)
import type {
  ZoneCourseSource,
} from '@/data/zone_courses/types';
import type { ZoneCourseDoc, ZoneCourseStatus } from '@/lib/zone-courses-firestore';

const SOURCE_OPTIONS: { value: ZoneCourseSource; label: string; desc: string }[] = [
  { value: 'cocotrip_curated',  label: 'CocoTrip Curated',  desc: '운영자가 직접 설계 + 검증' },
  { value: 'operator_verified', label: 'Operator Verified', desc: '외부 제안 → 운영자 현장 검증 완료' },
  { value: 'user_validated',    label: 'User Validated',    desc: '실제 사용자 plan 결과 + 후기 누적 검증' },
];

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MetaTab({ draft, onChange }: Props) {
  return (
    <div className="space-y-5">
      <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
        <h3 className="text-sm font-bold text-gray-800 mb-3">출처 / 검증 등급</h3>
        <div className="space-y-2">
          {SOURCE_OPTIONS.map((opt) => {
            const checked = (draft.source || 'cocotrip_curated') === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${
                  checked ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name="source"
                  checked={checked}
                  onChange={() => onChange({ source: opt.value })}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800">{opt.label}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{opt.desc}</p>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-3">검증 audit trail</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">검증일 (verified_at)</label>
            <input
              type="date"
              value={draft.verified_at || ''}
              onChange={(e) => onChange({ verified_at: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => onChange({ verified_at: today() })}
              className="mt-1 text-[10px] text-[#7C5CFC] hover:underline"
            >
              오늘로 설정
            </button>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">검증자 email (verified_by)</label>
            <input
              type="email"
              value={draft.verified_by || ''}
              onChange={(e) => onChange({ verified_by: e.target.value })}
              placeholder="2001leety@gmail.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">마지막 점검일 (last_review_date)</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={draft.last_review_date || ''}
              onChange={(e) => onChange({ last_review_date: e.target.value })}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => onChange({ last_review_date: today() })}
              className="px-3 py-2 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10"
            >
              오늘로
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-400">월 1회 점검 권장.</p>
        </div>
      </section>

      <section>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
          운영자 메모 (markdown)
        </label>
        <textarea
          value={draft.notes || ''}
          onChange={(e) => onChange({ notes: e.target.value || undefined })}
          rows={6}
          placeholder="- ODsay API key 없어 mock transit (재빌드 권장)&#10;- 평일 16시 이후 광장시장 혼잡 — packed 강도로 분류"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
        />
        <p className="mt-1 text-[10px] text-gray-400">검증 필요 사항·운영 액션·외부 참고 링크.</p>
      </section>

      <section className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">상태</h3>
        <div className="flex gap-2">
          {([
            { v: 'draft',     label: 'Draft' },
            { v: 'published', label: 'Published' },
            { v: 'archived',  label: 'Archived' },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => onChange({ status: opt.v as ZoneCourseStatus })}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold ${
                (draft.status || 'draft') === opt.v
                  ? 'bg-[#7C5CFC] text-white'
                  : 'bg-gray-50 text-gray-600 border border-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-gray-400">
          Published 가 AI 플래너 후보. Draft 는 admin only. Archived 는 후보 제외.
        </p>
      </section>
    </div>
  );
}
