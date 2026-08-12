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
    return [...faqs].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [faqs]);

  if (sorted.length === 0) return null;

  return (
    <section className="tour-detail-section">
      <h2 className="ec-h3 tour-detail-section-heading flex items-center gap-2">
        <HelpCircle className="h-5 w-5 text-ec-brand" />
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
    <div className="tour-detail-faq-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tour-detail-accordion-button"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold leading-snug text-ec-ink">{question}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ec-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-ec-line px-4 pb-4 pt-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ec-ink-2">
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}
