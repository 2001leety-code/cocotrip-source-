// IncludedExcluded — 투어 상세 페이지의 포함/불포함 섹션.
// 글로벌 default + 투어별 override 합쳐서 두 컬럼 표시.
import { CheckCircle2, XCircle } from 'lucide-react';
import type { TourHighlight, I18nString } from '@/data/tours';
import { GLOBAL_INCLUDED, GLOBAL_EXCLUDED } from '@/data/tours';
import type { Language } from '@/i18n';

function txt(field: I18nString, lang: Language): string {
  return field[lang] || field.en || field.ko;
}

const LABELS: Record<Language, { included: string; excluded: string }> = {
  ko: { included: '포함', excluded: '별도 (현장 결제)' },
  en: { included: 'Included', excluded: 'Not included' },
  ja: { included: '含まれる', excluded: '別途（現地支払）' },
  zh: { included: '包含', excluded: '不包含（现场支付）' },
};

interface Props {
  language: Language;
  /** 투어별 추가 포함. */
  includedExtra?: TourHighlight[];
  /** 투어별 추가 불포함. */
  excludedExtra?: TourHighlight[];
}

export function IncludedExcluded({ language, includedExtra = [], excludedExtra = [] }: Props) {
  const labels = LABELS[language] || LABELS.en;
  const included = [...GLOBAL_INCLUDED, ...includedExtra];
  const excluded = [...GLOBAL_EXCLUDED, ...excludedExtra];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Included */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.18)' }}
      >
        <div className="flex items-center gap-1.5 mb-2.5">
          <CheckCircle2 className="w-4 h-4" style={{ color: '#10B981' }} />
          <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#6EE7B7' }}>
            {labels.included}
          </p>
        </div>
        <ul className="space-y-1.5">
          {included.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-white/65 leading-snug">
              <span className="mt-1 w-1 h-1 rounded-full shrink-0" style={{ background: '#10B981' }} />
              <span>{txt(h.text, language)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Excluded */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-1.5 mb-2.5">
          <XCircle className="w-4 h-4 text-white/55" />
          <p className="text-[11px] font-black uppercase tracking-wider text-white/55">
            {labels.excluded}
          </p>
        </div>
        <ul className="space-y-1.5">
          {excluded.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-white/55 leading-snug">
              <span className="mt-1 w-1 h-1 rounded-full shrink-0 bg-white/30" />
              <span>{txt(h.text, language)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
