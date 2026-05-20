// FaqTab — 탭 ⑧ FAQ (Q&A array, max 20)
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { Tour, FAQ } from '@/data/tours';
import { I18nField, I18nTextarea } from './I18nField';

interface Props {
  draft: Partial<Tour>;
  onChange: (patch: Partial<Tour>) => void;
}

const MAX_FAQS = 20;

function genFaqId(): string {
  return `faq_${Math.random().toString(36).slice(2, 8)}`;
}

export function FaqTab({ draft, onChange }: Props) {
  const faqs = draft.faqs ?? [];
  const setFaqs = (next: FAQ[]) => onChange({ faqs: next });

  const sorted = [...faqs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const add = () => {
    if (faqs.length >= MAX_FAQS) return;
    const nextOrder = faqs.length > 0 ? Math.max(...faqs.map((f) => f.order ?? 0)) + 1 : 0;
    setFaqs([...faqs, {
      id: genFaqId(),
      question: { ko: '', en: '', ja: '', zh: '' },
      answer: { ko: '', en: '', ja: '', zh: '' },
      order: nextOrder,
    }]);
  };

  const remove = (id: string) => {
    if (!window.confirm('이 FAQ 를 삭제할까요?')) return;
    setFaqs(faqs.filter((f) => f.id !== id));
  };

  const update = (id: string, patch: Partial<FAQ>) => {
    setFaqs(faqs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = sorted.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= sorted.length) return;
    // swap order values
    const a = sorted[idx];
    const b = sorted[j];
    const aOrder = a.order ?? idx;
    const bOrder = b.order ?? j;
    setFaqs(faqs.map((f) => {
      if (f.id === a.id) return { ...f, order: bOrder };
      if (f.id === b.id) return { ...f, order: aOrder };
      return f;
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">자주 묻는 질문. 최대 {MAX_FAQS}개.</p>
          <p className="text-[10px] text-gray-400">현재 {faqs.length}/{MAX_FAQS}개</p>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={faqs.length >= MAX_FAQS}
          className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          Q&A 추가
        </button>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
          등록된 FAQ 없음
        </div>
      )}

      {sorted.map((faq, idx) => (
        <div key={faq.id} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-gray-700">Q&A {idx + 1}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => move(faq.id, -1)} disabled={idx === 0}
                className="p-1 rounded hover:bg-white disabled:opacity-30">
                <ChevronUp className="w-3.5 h-3.5 text-gray-600" />
              </button>
              <button type="button" onClick={() => move(faq.id, 1)} disabled={idx === sorted.length - 1}
                className="p-1 rounded hover:bg-white disabled:opacity-30">
                <ChevronDown className="w-3.5 h-3.5 text-gray-600" />
              </button>
              <button type="button" onClick={() => remove(faq.id)} className="p-1 rounded hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <I18nField label="질문" value={faq.question} onChange={(v) => update(faq.id, { question: v })} required />
            <I18nTextarea label="답변" value={faq.answer} onChange={(v) => update(faq.id, { answer: v })} rows={3} required />
          </div>
        </div>
      ))}
    </div>
  );
}
