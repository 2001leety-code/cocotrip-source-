// I18nField / I18nTextarea — 4-lang 어드민 입력 위젯 (Phase 2-5, 2026-05-19~20)
// 기본 ko 만 표시 + "다른 언어" 토글로 en/ja/zh 확장. 세로 공간 절약.
// Phase 4 (2026-05-19): 🤖 AI 번역 버튼 — ko → en/ja/zh 자동 채움 (비어있는 곳만).
// Phase 5 (2026-05-20): 각 lang 옆 ✨ 작은 버튼 — 그 lang 을 source 로 → 나머지
//   3 lang 자동 채움 (역방향 / cross-lang). GYG/Klook 영문 import + 외주 일본인/
//   중국인 운영자 시나리오. Phase 4 의 header AI 번역 버튼은 그대로 (ko→others).
import { useState } from 'react';
import { ChevronDown, ChevronUp, Languages, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { I18nString } from '@/data/tours';
import { useAuth } from '@/hooks/useAuth';
import { translateFromSource, translateKoreanToOthers } from '@/lib/admin-translate';

const LANG_LABELS: Record<keyof I18nString, string> = {
  ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
};

const PLACEHOLDER_HINT: Record<keyof I18nString, string> = {
  ko: 'KR', en: 'EN', ja: 'JP', zh: 'ZH',
};

interface BaseProps {
  label: string;
  value: I18nString | undefined;
  onChange: (next: I18nString) => void;
  required?: boolean;
  hint?: string;
  /** ko 만 입력하고 나머지 비워둘 수 있게 허용 (false=다국어 강제) */
  optional?: boolean;
  /** 우측 헤더 슬롯 (예: 자동번역 버튼) */
  rightSlot?: React.ReactNode;
  /** AI 번역 context 힌트 (예: "투어 제목", "FAQ 답변"). 미설정 시 label 사용. */
  translateContext?: string;
  /** AI 번역 버튼 비활성 (label 만 — 짧은 ID, slug 등). 기본 false. */
  noTranslate?: boolean;
}

const EMPTY: I18nString = { ko: '', en: '', ja: '', zh: '' };

function ensure(v: I18nString | undefined): I18nString {
  return { ...EMPTY, ...(v ?? {}) };
}

const LANG_NAMES: Record<keyof I18nString, string> = {
  ko: '한국어', en: '영어', ja: '일본어', zh: '중국어',
};

/**
 * AI 번역 hook. 두 메서드 노출:
 *   - run()                — Phase 4: ko → en/ja/zh 자동 채움 (header 버튼).
 *   - runFromSource(lang)  — Phase 5: lang → 나머지 3 lang 자동 채움 (각 lang
 *                            옆 ✨ 작은 버튼). 비어있는 lang 만 채움; 모두 채워져
 *                            있으면 confirm 후 덮어씀.
 * 기존 값은 기본 보존 (덮어쓰기 X). translating 상태는 두 메서드 공통 (동시에
 * 한 번에 한 호출만).
 */
function useAiTranslate(
  value: I18nString,
  onChange: (next: I18nString) => void,
  context: string,
) {
  const { user } = useAuth();
  const [translating, setTranslating] = useState(false);

  const run = async () => {
    if (!user) {
      toast.error('로그인이 필요합니다.');
      return;
    }
    if (!value.ko?.trim()) {
      toast.error('먼저 한국어를 입력해주세요.');
      return;
    }
    const empties = (['en', 'ja', 'zh'] as const).filter((l) => !value[l]?.trim());
    if (empties.length === 0) {
      if (!window.confirm('en/ja/zh 모두 채워져 있습니다. AI 번역으로 덮어쓸까요?')) return;
    }
    const targets = empties.length > 0 ? empties : (['en', 'ja', 'zh'] as const);

    setTranslating(true);
    try {
      const result = await translateKoreanToOthers(user, value.ko, {
        context,
        targets: [...targets],
      });
      const next = { ...value };
      let filled = 0;
      for (const lang of targets) {
        if (typeof result[lang] === 'string') {
          next[lang] = result[lang]!;
          filled += 1;
        }
      }
      onChange(next);
      toast.success(`AI 번역 완료 (${filled}/${targets.length} 언어)`);
    } catch (err) {
      toast.error(`번역 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setTranslating(false);
    }
  };

  const runFromSource = async (sourceLang: keyof I18nString) => {
    if (!user) {
      toast.error('로그인이 필요합니다.');
      return;
    }
    const sourceText = value[sourceLang];
    if (!sourceText?.trim()) {
      toast.error(`먼저 ${LANG_NAMES[sourceLang]}를 입력해주세요.`);
      return;
    }
    const otherLangs = (['ko', 'en', 'ja', 'zh'] as const).filter((l) => l !== sourceLang);
    const empties = otherLangs.filter((l) => !value[l]?.trim());
    if (empties.length === 0) {
      if (!window.confirm(
        `${LANG_NAMES[sourceLang]} 외 3 언어 모두 채워져 있습니다. AI 번역으로 덮어쓸까요?`,
      )) return;
    }
    const targets = empties.length > 0 ? empties : otherLangs;

    setTranslating(true);
    try {
      const result = await translateFromSource(
        user,
        { lang: sourceLang, text: sourceText },
        { context, targets: [...targets] },
      );
      const next = { ...value };
      let filled = 0;
      for (const lang of targets) {
        if (typeof result[lang] === 'string') {
          next[lang] = result[lang]!;
          filled += 1;
        }
      }
      onChange(next);
      toast.success(`AI 번역 완료 (${LANG_NAMES[sourceLang]} → ${filled}/${targets.length})`);
    } catch (err) {
      toast.error(`번역 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setTranslating(false);
    }
  };

  return { translating, run, runFromSource };
}

function AiTranslateButton({
  translating, onClick,
}: {
  translating: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={translating}
      className="text-[10px] font-bold text-[#7C5CFC] hover:text-[#6b4ce0] flex items-center gap-0.5 disabled:opacity-50"
      title="ko → en/ja/zh 자동 번역 (Gemini)"
    >
      {translating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      {translating ? '번역 중' : 'AI 번역'}
    </button>
  );
}

/** Phase 5: 각 lang 옆 작은 ✨ 버튼 — 그 lang 을 source 로 나머지 3 lang 채움. */
function LangSparkleButton({
  lang, translating, hasText, onClick,
}: {
  lang: keyof I18nString;
  translating: boolean;
  hasText: boolean;
  onClick: () => void;
}) {
  const disabled = translating || !hasText;
  const title = hasText
    ? `${LANG_NAMES[lang]} → 나머지 3 언어 자동 (Gemini)`
    : `${LANG_NAMES[lang]} 텍스트 입력 후 사용 가능`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 p-1 rounded text-[#7C5CFC] hover:bg-[#7C5CFC]/10 disabled:opacity-30 disabled:hover:bg-transparent"
      title={title}
      aria-label={title}
    >
      {translating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
    </button>
  );
}

/** 단일 줄 4-lang input */
export function I18nField({
  label, value, onChange, required, hint, rightSlot, placeholder,
  translateContext, noTranslate,
}: BaseProps & { placeholder?: string }) {
  const [expanded, setExpanded] = useState(false);
  const v = ensure(value);
  const { translating, run, runFromSource } = useAiTranslate(v, onChange, translateContext ?? label);

  const set = (lang: keyof I18nString, str: string) => onChange({ ...v, [lang]: str });

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <div className="flex items-center gap-2">
          {rightSlot}
          {!noTranslate && <AiTranslateButton translating={translating} onClick={run} />}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[10px] text-gray-500 hover:text-[#7C5CFC] flex items-center gap-0.5"
          >
            <Languages className="w-3 h-3" />
            {expanded ? '접기' : '4언어'}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      <input
        type="text"
        value={v.ko}
        onChange={(e) => set('ko', e.target.value)}
        placeholder={placeholder ? `${placeholder} (한국어)` : `한국어`}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
      />

      {expanded && (
        <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-[#7C5CFC]/15">
          {(['en', 'ja', 'zh'] as const).map((lang) => (
            <div key={lang} className="flex items-center gap-2">
              <span className="w-12 text-[10px] font-bold text-gray-400 uppercase">{PLACEHOLDER_HINT[lang]}</span>
              <input
                type="text"
                value={v[lang]}
                onChange={(e) => set(lang, e.target.value)}
                placeholder={LANG_LABELS[lang]}
                className="flex-1 px-2.5 py-1.5 border border-gray-100 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
              {!noTranslate && (
                <LangSparkleButton
                  lang={lang}
                  translating={translating}
                  hasText={!!v[lang]?.trim()}
                  onClick={() => runFromSource(lang)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {hint && <p className="mt-1 text-[10px] text-gray-400">{hint}</p>}
    </div>
  );
}

/** 4-lang textarea (multiline) */
export function I18nTextarea({
  label, value, onChange, required, hint, rightSlot, rows = 3, placeholder,
  translateContext, noTranslate,
}: BaseProps & { rows?: number; placeholder?: string }) {
  const [expanded, setExpanded] = useState(false);
  const v = ensure(value);
  const { translating, run, runFromSource } = useAiTranslate(v, onChange, translateContext ?? label);

  const set = (lang: keyof I18nString, str: string) => onChange({ ...v, [lang]: str });

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <div className="flex items-center gap-2">
          {rightSlot}
          {!noTranslate && <AiTranslateButton translating={translating} onClick={run} />}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[10px] text-gray-500 hover:text-[#7C5CFC] flex items-center gap-0.5"
          >
            <Languages className="w-3 h-3" />
            {expanded ? '접기' : '4언어'}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      <textarea
        value={v.ko}
        onChange={(e) => set('ko', e.target.value)}
        rows={rows}
        placeholder={placeholder ? `${placeholder} (한국어)` : `한국어`}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
      />

      {expanded && (
        <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-[#7C5CFC]/15">
          {(['en', 'ja', 'zh'] as const).map((lang) => (
            <div key={lang}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-400 uppercase">{LANG_LABELS[lang]}</span>
                {!noTranslate && (
                  <LangSparkleButton
                    lang={lang}
                    translating={translating}
                    hasText={!!v[lang]?.trim()}
                    onClick={() => runFromSource(lang)}
                  />
                )}
              </div>
              <textarea
                value={v[lang]}
                onChange={(e) => set(lang, e.target.value)}
                rows={rows}
                placeholder={LANG_LABELS[lang]}
                className="mt-0.5 w-full px-2.5 py-1.5 border border-gray-100 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
          ))}
        </div>
      )}

      {hint && <p className="mt-1 text-[10px] text-gray-400">{hint}</p>}
    </div>
  );
}
