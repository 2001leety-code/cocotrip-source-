// ─────────────────────────────────────────────────────────────────────────────
// SlotPicker — TourBookingDialog 시간 슬롯 선택 (Phase 1, 2026-05-19)
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useEffect } from 'react';
import { Clock, Users, Check } from 'lucide-react';
import type { TourSlot, I18nString } from '@/data/tours';
import type { Language } from '@/i18n';

function txt(field: I18nString | undefined, lang: Language): string {
  if (!field) return '';
  return field[lang] || field.en || field.ko || '';
}

const HEADING: Record<Language, string> = {
  ko: '시간 선택',
  en: 'Choose time',
  ja: '時刻選択',
  zh: '选择时间',
};

const CAPACITY_LABEL: Record<Language, string> = {
  ko: '정원',
  en: 'Capacity',
  ja: '定員',
  zh: '名额',
};

const BASE_PRICE: Record<Language, string> = {
  ko: '기본가',
  en: 'Base price',
  ja: '基本料金',
  zh: '基本价',
};

function formatModifier(krw: number, lang: Language): string {
  if (krw === 0) return BASE_PRICE[lang] || BASE_PRICE.en;
  const sign = krw > 0 ? '+' : '-';
  return `${sign}₩${Math.abs(krw).toLocaleString()}`;
}

function formatCapacity(cap: number | undefined, lang: Language): string {
  if (cap === undefined) return '';
  if (lang === 'ko') return `${cap}명`;
  if (lang === 'ja') return `${cap}名`;
  if (lang === 'zh') return `${cap}人`;
  return `${cap} pax`;
}

interface Props {
  slots: TourSlot[];
  selectedSlotId: string | null;
  onChange: (slotId: string | null) => void;
  language: Language;
}

export function SlotPicker({ slots, selectedSlotId, onChange, language }: Props) {
  const activeSlots = useMemo(
    () => slots.filter((s) => s.is_active !== false).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [slots],
  );

  // 활성 슬롯 1개면 자동 선택
  useEffect(() => {
    if (activeSlots.length === 1 && selectedSlotId !== activeSlots[0].id) {
      onChange(activeSlots[0].id);
    } else if (activeSlots.length === 0 && selectedSlotId !== null) {
      onChange(null);
    }
  }, [activeSlots, selectedSlotId, onChange]);

  if (activeSlots.length === 0) return null;

  // 단일 슬롯: 정보 카드만 표시
  if (activeSlots.length === 1) {
    const slot = activeSlots[0];
    return (
      <div>
        <label className="flex items-center gap-1.5 text-[11px] text-white/55 uppercase tracking-wider mb-1.5">
          <Clock className="w-3 h-3" />
          {HEADING[language] || HEADING.en}
        </label>
        <div
          className="px-3 py-2 rounded-xl flex items-center gap-2 text-[13px] text-white/85"
          style={{
            background: 'rgba(182,104,252,0.08)',
            border: '1px solid rgba(182,104,252,0.20)',
          }}
        >
          <Clock className="w-3.5 h-3.5 text-[#B668FC]" />
          <span className="font-bold">{slot.start_time}</span>
          {slot.label && <span className="text-white/65">— {txt(slot.label, language)}</span>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] text-white/55 uppercase tracking-wider mb-1.5">
        <Clock className="w-3 h-3" />
        {HEADING[language] || HEADING.en}
      </label>
      <div className="space-y-1.5">
        {activeSlots.map((slot) => (
          <SlotOption
            key={slot.id}
            slot={slot}
            selected={selectedSlotId === slot.id}
            onSelect={() => onChange(slot.id)}
            language={language}
          />
        ))}
      </div>
    </div>
  );
}

function SlotOption({
  slot, selected, onSelect, language,
}: {
  slot: TourSlot;
  selected: boolean;
  onSelect: () => void;
  language: Language;
}) {
  const labelText = txt(slot.label, language);
  const modifier = slot.price_modifier_krw ?? 0;
  const modText = formatModifier(modifier, language);
  const capText = formatCapacity(slot.capacity, language);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
      style={{
        background: selected ? 'rgba(182,104,252,0.10)' : 'rgba(255,255,255,0.025)',
        border: selected ? '1px solid rgba(182,104,252,0.40)' : '1px solid rgba(255,255,255,0.07)',
      }}
      aria-pressed={selected}
    >
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: selected ? '#B668FC' : 'transparent',
          border: selected ? 'none' : '1.5px solid rgba(255,255,255,0.20)',
        }}
      >
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>

      <div className="flex-1 flex items-center gap-2">
        <span className="text-[14px] font-black text-white tabular-nums">{slot.start_time}</span>
        {labelText && <span className="text-[12px] text-white/65">— {labelText}</span>}
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        {capText && (
          <span className="flex items-center gap-0.5 text-white/55">
            <Users className="w-3 h-3" />
            {capText}
          </span>
        )}
        <span
          className="font-bold tabular-nums"
          style={{ color: modifier === 0 ? 'rgba(255,255,255,0.55)' : modifier > 0 ? '#FFD250' : '#7EE29C' }}
        >
          {modText}
        </span>
      </div>
    </button>
  );
}
