// ─────────────────────────────────────────────────────────────────────────────
// SuitabilityChips — 적합성 칩 (Phase 1, 2026-05-19)
//   휠체어 / 유모차 / 임산부 / 연령 / 체력 등
// ─────────────────────────────────────────────────────────────────────────────
import type { Suitability, I18nString } from '@/data/tours';
import type { Language } from '@/i18n';

function txt(field: I18nString | undefined, lang: Language): string {
  if (!field) return '';
  return field[lang] || field.en || field.ko || '';
}

const FITNESS_LABEL: Record<NonNullable<Suitability['fitness_level']>, Record<Language, string>> = {
  easy: { ko: '쉬움', en: 'Easy', ja: '簡単', zh: '简单' },
  moderate: { ko: '보통', en: 'Moderate', ja: '普通', zh: '中等' },
  challenging: { ko: '도전적', en: 'Challenging', ja: '挑戦的', zh: '挑战' },
};

const WHEELCHAIR: Record<Language, string> = {
  ko: '휠체어 가능', en: 'Wheelchair friendly', ja: '車椅子対応', zh: '可使用轮椅',
};
const STROLLER: Record<Language, string> = {
  ko: '유모차 친화', en: 'Stroller friendly', ja: 'ベビーカー対応', zh: '婴儿车友好',
};
const PREGNANCY: Record<Language, string> = {
  ko: '임산부 가능', en: 'Pregnancy safe', ja: '妊婦OK', zh: '孕妇可参加',
};
const CARSEAT: Record<Language, string> = {
  ko: '카시트 제공', en: 'Car seat available', ja: 'チャイルドシートあり', zh: '提供儿童座椅',
};

function ageLabel(min: number | undefined, max: number | undefined, lang: Language): string | null {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) {
    if (lang === 'ko') return `${min}-${max}세`;
    if (lang === 'ja') return `${min}-${max}歳`;
    if (lang === 'zh') return `${min}-${max}岁`;
    return `Ages ${min}-${max}`;
  }
  if (min !== undefined) {
    if (lang === 'ko') return `만 ${min}세 이상`;
    if (lang === 'ja') return `${min}歳以上`;
    if (lang === 'zh') return `${min}岁以上`;
    return `${min}+`;
  }
  // max only
  if (lang === 'ko') return `만 ${max}세 이하`;
  if (lang === 'ja') return `${max}歳以下`;
  if (lang === 'zh') return `${max}岁以下`;
  return `Up to ${max}`;
}

interface Props {
  suitability: Suitability;
  language: Language;
}

interface Chip {
  icon: string;
  text: string;
}

export function SuitabilityChips({ suitability: s, language }: Props) {
  const chips: Chip[] = [];

  const age = ageLabel(s.min_age, s.max_age, language);
  if (age) {
    chips.push({
      icon: '👶',
      text: age,
    });
  }

  if (s.fitness_level) {
    chips.push({
      icon: '💪',
      text: FITNESS_LABEL[s.fitness_level][language] || FITNESS_LABEL[s.fitness_level].en,
    });
  }

  if (s.wheelchair_accessible) {
    chips.push({
      icon: '♿',
      text: WHEELCHAIR[language] || WHEELCHAIR.en,
    });
  }

  if (s.stroller_friendly) {
    chips.push({
      icon: '🚼',
      text: STROLLER[language] || STROLLER.en,
    });
  }

  if (s.pregnancy_safe) {
    chips.push({
      icon: '🤰',
      text: PREGNANCY[language] || PREGNANCY.en,
    });
  }

  if (s.infant_seat_available) {
    chips.push({
      icon: '🚸',
      text: CARSEAT[language] || CARSEAT.en,
    });
  }

  const notes = txt(s.notes, language);

  if (chips.length === 0 && !notes) return null;

  return (
    <div className="mb-5">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c, i) => (
            <span
              key={i}
              className="ec-chip"
            >
              <span aria-hidden>{c.icon}</span>
              <span>{c.text}</span>
            </span>
          ))}
        </div>
      )}
      {notes && (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ec-ink-2">
          {notes}
        </p>
      )}
    </div>
  );
}
