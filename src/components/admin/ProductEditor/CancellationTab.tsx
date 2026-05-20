// CancellationTab — 탭 ⑦ 취소 정책
import { Plus, Trash2 } from 'lucide-react';
import type { Tour, CancellationPolicy, CancellationTier, I18nString } from '@/data/tours';
import { I18nTextarea } from './I18nField';

interface Props {
  draft: Partial<Tour>;
  onChange: (patch: Partial<Tour>) => void;
}

const DEFAULT_TIERS: CancellationTier[] = [
  { hours_before: 72, refund_percent: { general: 100, gold: 100, platinum: 100 } },
  { hours_before: 48, refund_percent: { general: 80, gold: 100, platinum: 100 } },
  { hours_before: 24, refund_percent: { general: 50, gold: 80, platinum: 100 } },
  { hours_before: 12, refund_percent: { general: 0, gold: 50, platinum: 80 } },
  { hours_before: 0,  refund_percent: { general: 0, gold: 0, platinum: 0 } },
];

function emptyI18n(): I18nString {
  return { ko: '', en: '', ja: '', zh: '' };
}

export function CancellationTab({ draft, onChange }: Props) {
  const policy: CancellationPolicy = draft.cancellation_policy ?? { kind: 'inherit_global' };

  const update = (patch: Partial<CancellationPolicy>) => {
    onChange({ cancellation_policy: { ...policy, ...patch } });
  };

  const tiers = policy.tiers ?? DEFAULT_TIERS;

  const updateTier = (i: number, patch: Partial<CancellationTier>) => {
    update({ tiers: tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  };
  const updateRefund = (i: number, lane: 'general' | 'gold' | 'platinum', pct: number) => {
    const t = tiers[i];
    updateTier(i, { refund_percent: { ...t.refund_percent, [lane]: Math.max(0, Math.min(100, pct)) } });
  };
  const addTier = () => update({ tiers: [...tiers, { hours_before: 0, refund_percent: { general: 0, gold: 0, platinum: 0 } }] });
  const removeTier = (i: number) => update({ tiers: tiers.filter((_, idx) => idx !== i) });

  const notes = policy.extra_notes ?? [];
  const updateNote = (i: number, v: I18nString) => {
    update({ extra_notes: notes.map((n, idx) => (idx === i ? v : n)) });
  };
  const addNote = () => update({ extra_notes: [...notes, emptyI18n()] });
  const removeNote = (i: number) => update({ extra_notes: notes.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-2">정책 유형</label>
        <div className="flex gap-2">
          {([
            { v: 'inherit_global', label: '글로벌 기본 사용' },
            { v: 'custom', label: '이 투어 커스텀' },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => update({ kind: opt.v, tiers: opt.v === 'custom' ? (policy.tiers ?? DEFAULT_TIERS) : undefined })}
              className={`px-4 py-2 rounded-lg text-xs font-semibold ${
                policy.kind === opt.v ? 'bg-[#7C5CFC] text-white' : 'bg-gray-50 text-gray-600 border border-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {policy.kind === 'inherit_global' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-[11px] text-blue-700">
          글로벌 환불 정책 표 (RefundPolicyModal) 가 사용됩니다.
        </div>
      )}

      {policy.kind === 'custom' && (
        <section className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-800">Tier 표</h3>
            <button
              type="button"
              onClick={addTier}
              className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-white px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10 border border-gray-200"
            >
              <Plus className="w-3.5 h-3.5" />
              Tier
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 font-semibold">잔여시간 ↑</th>
                  <th className="text-center py-2 font-semibold">일반 %</th>
                  <th className="text-center py-2 font-semibold">Gold %</th>
                  <th className="text-center py-2 font-semibold">Platinum %</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2">
                      <input
                        type="number"
                        value={t.hours_before}
                        onChange={(e) => updateTier(i, { hours_before: parseInt(e.target.value || '0', 10) })}
                        min={0}
                        className="w-20 px-2 py-1 border border-gray-200 rounded-md"
                      />
                      <span className="ml-1 text-gray-400">시간</span>
                    </td>
                    {(['general', 'gold', 'platinum'] as const).map((lane) => (
                      <td key={lane} className="py-2 text-center">
                        <input
                          type="number"
                          value={t.refund_percent[lane]}
                          onChange={(e) => updateRefund(i, lane, parseInt(e.target.value || '0', 10))}
                          min={0}
                          max={100}
                          className="w-16 px-1 py-1 border border-gray-200 rounded-md text-center tabular-nums"
                        />
                      </td>
                    ))}
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => removeTier(i)}
                        className="p-1 rounded hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
