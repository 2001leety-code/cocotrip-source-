// CancellationTab — 탭 ⑦ 취소 정책
//
// 2026-07-14 운영자 확정: 전 상품 **24시간 바이너리** (24h 이상 전=100% / 24h 이내·노쇼=0%),
//   고객 등급(Gold/Platinum) 차등 폐지 — 전 고객 동일. 실 환불 SSOT = api/_refund-policy.js.
//
// ⚠️ 상품별 custom 티어 편집기 제거(2026-07-14 감사): 환불 엔진(_refund-policy.js)과 결제전 고지
//   (/api/refundPolicy)·표시(RefundPolicyModal)·Terms 전부 24h 바이너리를 하드코딩하고 상품
//   cancellation_policy.tiers 를 **읽지 않는다**. 편집기를 남겨두면 운영자가 설정해도 실 환불에
//   반영 안 돼 "표시≠청구" 분쟁 위험(죽은 설정). → 전 상품 공통 정책은 읽기 전용 안내로만 노출하고,
//   상품별로는 '추가 안내(extra_notes)'만 편집 가능하게 정리한다. (custom 쓰는 상품 0개 확인.)
import { Plus, Trash2 } from 'lucide-react';
import type { Tour, CancellationPolicy, I18nString } from '@/data/tours';
import { I18nTextarea } from './I18nField';

interface Props {
  draft: Partial<Tour>;
  onChange: (patch: Partial<Tour>) => void;
}

function emptyI18n(): I18nString {
  return { ko: '', en: '', ja: '', zh: '' };
}

// 전 상품 공통(읽기 전용) — api/_refund-policy.js BASE_TABLE 와 동일. 하드코딩 아님, 안내 미러.
const POLICY_ROWS: { when: string; refund: string; tone: 'good' | 'bad' }[] = [
  { when: '투어 시작 24시간 이상 전 취소', refund: '100% 환불', tone: 'good' },
  { when: '투어 시작 24시간 이내 취소 · 노쇼', refund: '환불 불가', tone: 'bad' },
];

export function CancellationTab({ draft, onChange }: Props) {
  const policy: CancellationPolicy = draft.cancellation_policy ?? { kind: 'inherit_global' };
  const notes = policy.extra_notes ?? [];

  const update = (patch: Partial<CancellationPolicy>) => {
    onChange({ cancellation_policy: { ...policy, ...patch } });
  };
  const updateNote = (i: number, v: I18nString) => {
    update({ extra_notes: notes.map((n, idx) => (idx === i ? v : n)) });
  };
  const addNote = () => update({ extra_notes: [...notes, emptyI18n()] });
  const removeNote = (i: number) => update({ extra_notes: notes.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-5">
      {/* 전 상품 공통 정책 — 읽기 전용 안내 (실 환불 엔진과 동일) */}
      <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
        <h3 className="text-sm font-bold text-gray-800">취소·환불 정책 (전 상품 공통)</h3>
        <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
          운영자 확정 2026-07-14 · 24시간 바이너리 · 고객 등급 차등 없음(전 고객 동일). 실 환불 엔진과 동일.
        </p>
        <table className="w-full text-xs">
          <tbody>
            {POLICY_ROWS.map((r, i) => (
              <tr key={i} className="border-b border-gray-100 last:border-0">
                <td className="py-2 text-gray-700">{r.when}</td>
                <td className={`py-2 text-right font-semibold ${r.tone === 'good' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {r.refund}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-gray-400">
          정책 변경은 SSOT(api/_refund-policy.js) 에서 — 상품별 개별 티어는 환불 엔진이 적용하지 않아 폐지됨.
        </p>
      </section>

      {/* 상품별 추가 안내 (extra_notes) — 실 표시됨. 예: 날씨 사유 100% 환불 */}
      <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-gray-800">추가 안내</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">글로벌 NOTES 위에 노출됨 (예: 날씨 사유 100% 환불)</p>
          </div>
          <button
            type="button"
            onClick={addNote}
            className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-white px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10 border border-gray-200"
          >
            <Plus className="w-3.5 h-3.5" />
            안내 추가
          </button>
        </div>

        {notes.length === 0 && (
          <p className="text-center py-3 text-xs text-gray-400">추가 안내 없음</p>
        )}

        {notes.map((n, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 mb-2">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <I18nTextarea label="안내문" value={n} onChange={(v) => updateNote(i, v)} rows={2} />
              </div>
              <button
                type="button"
                onClick={() => removeNote(i)}
                className="p-1.5 mt-5 rounded hover:bg-red-50"
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
