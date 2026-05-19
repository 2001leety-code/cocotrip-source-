// ─────────────────────────────────────────────────────────────────────────────
// TourFAQ — TourDetailPage FAQ accordion (Phase 1, 2026-05-19)
// shadcn Accordion 미설치 환경 — useState 기반 단순 collapse.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { HelpCircle, ChevronDown } from 'lucide-react';
import type { FAQ, I18nString } from '@/data/tours';
import type { Language } from '@/i18n';

function txt(field: I18nString | undefined, lang: Language): string {
  if (!field) return '';
  return field[lang] || field.en || field.ko || '';
}

const HEADING: Record<Language, string> = {
  ko: '자주 묻는 질문',
  en: 'Frequently Asked Questions',
  ja: 'よくある質問',
  zh: '常见问题',
};

interface Props {
  faqs: FAQ[];
  language: Language;
}

export function TourFAQ({ faqs, language }: Props) {
  const sorted = useMemo(() => {
    return [...faqs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [faqs]);

  if (sorted.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-[13px] font-black uppercase tracking-[0.08em] text-white/55 mb-3 flex items-center gap-2">
        <HelpCircle className="w-3.5 h-3.5" />
        {HEADING[language] || HEADING.en}
      </h2>

      <div className="space-y-2">
        {sorted.map((faq) => (
          <FaqItem key={faq.id} faq={faq} language={language} />
        ))}
      </div>
    </section>
  );
}

function FaqItem({ faq, language }: { faq: FAQ; language: Language }) {
  const [open, setOpen] = useState(false);
  const question = txt(faq.question, language);
  const answer = txt(faq.answer, language);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold text-white/85 leading-snug">{question}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-white/55 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-3.5 pt-1 border-t border-white/[0.04]">
          <p className="text-[12px] text-white/65 leading-relaxed whitespace-pre-line">
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}
