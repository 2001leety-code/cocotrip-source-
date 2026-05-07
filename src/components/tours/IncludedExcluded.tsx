// IncludedExcluded — 투어 상세 페이지의 포함/불포함 섹션.
// 글로벌 default + 투어별 override 합쳐서 두 컬럼 표시.
//
// PR-L: i18n key 기반 props (`includedExtraKeys`/`excludedExtraKeys`) 추가.
//   - 신규 호출부는 key 배열 권장 — 단일 source (i18n locale JSON) 참조.
//   - 기존 `includedExtra`/`excludedExtra` (I18nString[]) backward-compat 유지.
//   - 두 props 같이 전달 시 key → object 순으로 합쳐 표시.
import { CheckCircle2, XCircle } from 'lucide-react';
import type { TourHighlight, I18nString } from '@/data/tours';
import { GLOBAL_INCLUDED, GLOBAL_EXCLUDED } from '@/data/tours';
import { useLanguage } from '@/hooks/useLanguage';
import type { Language } from '@/i18n';

function txt(field: I18nString, lang: Language): string {
  return field[lang] || field.en || field.ko;
}

/** 점(.) 구분 i18n key 를 locale 객체에서 안전하게 lookup. miss 시 key 그대로 반환. */
function lookupKey(t: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let cur: unknown = t;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === 'string' ? cur : key;
}

interface Props {
  language: Language;
  /** 투어별 추가 포함 (I18nString — backward compat). */
  includedExtra?: TourHighlight[];
  /** 투어별 추가 불포함 (I18nString — backward compat). */
  excludedExtra?: TourHighlight[];
  /** 투어별 추가 포함 — i18n key 배열 (예: 'tourDetail.airportPickup'). PR-L 신규. */
  includedExtraKeys?: string[];
  /** 투어별 추가 불포함 — i18n key 배열. PR-L 신규. */
  excludedExtraKeys?: string[];
}

export function IncludedExcluded({
  language,
  includedExtra = [],
  excludedExtra = [],
  includedExtraKeys = [],
  excludedExtraKeys = [],
}: Props) {
  // useLanguage 의 t 는 현재 언어의 Translations 캐시. props.language 와 다를 수 있으나
  // 헤더 언어 토글이 즉시 t 갱신을 트리거하므로 실제로는 동기화됨. lookup 만 처리.
  const { t } = useLanguage();

  // i18n key → I18nString 변환은 비효율 — 그냥 현재 언어 string 으로 펼침.
  // I18nString 합치기는 기존대로 유지 → 렌더링 시 한 번에 string 화.
  const includedItems: Array<{ kind: 'i18n'; text: string } | { kind: 'object'; text: I18nString }> = [
    ...GLOBAL_INCLUDED.map((h) => ({ kind: 'object' as const, text: h.text })),
    ...includedExtra.map((h) => ({ kind: 'object' as const, text: h.text })),
    ...includedExtraKeys.map((key) => ({
      kind: 'i18n' as const,
      text: lookupKey(t as unknown as Record<string, unknown>, key),
    })),
  ];

  const excludedItems: Array<{ kind: 'i18n'; text: string } | { kind: 'object'; text: I18nString }> = [
    ...GLOBAL_EXCLUDED.map((h) => ({ kind: 'object' as const, text: h.text })),
    ...excludedExtra.map((h) => ({ kind: 'object' as const, text: h.text })),
    ...excludedExtraKeys.map((key) => ({
      kind: 'i18n' as const,
      text: lookupKey(t as unknown as Record<string, unknown>, key),
    })),
  ];

  // 헤더 라벨도 locale JSON 에서 단일 참조 (file-local LABELS 폐기 — PR-L 단일 source).
  const includedTitle = lookupKey(t as unknown as Record<string, unknown>, 'tourDetail.includedTitle');
  const excludedTitle = lookupKey(t as unknown as Record<string, unknown>, 'tourDetail.excludedTitle');

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
            {includedTitle}
          </p>
        </div>
        <ul className="space-y-1.5">
          {includedItems.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-white/65 leading-snug">
              <span className="mt-1 w-1 h-1 rounded-full shrink-0" style={{ background: '#10B981' }} />
              <span>{item.kind === 'i18n' ? item.text : txt(item.text, language)}</span>
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
            {excludedTitle}
          </p>
        </div>
        <ul className="space-y-1.5">
          {excludedItems.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-white/55 leading-snug">
              <span className="mt-1 w-1 h-1 rounded-full shrink-0 bg-white/30" />
              <span>{item.kind === 'i18n' ? item.text : txt(item.text, language)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
