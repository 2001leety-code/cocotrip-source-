// Step 1: 출발지 선택 — 주요 4개 + 펼치기 9개 + 기타
import { useState } from 'react';
import { Plane, Hotel, Car, ChevronDown, MapPin } from 'lucide-react';
import type { WizardState, OriginCode } from './types';
import { AIRPORTS_CATALOG, CITIES_CATALOG } from '@/data/charterPricing';
import { getWizardI18n } from './wizard-i18n';

const PRIMARY: OriginCode[] = ['ICN', 'GMP', 'SEL_METRO', 'BUS_METRO'];
const SECONDARY: OriginCode[] = ['PUS', 'CJU', 'TAE', 'CJJ', 'MWX', 'KWJ', 'RSU', 'USN'];

function labelFor(code: OriginCode, lang: 'ko' | 'en'): { title: string; sub: string; Icon: typeof Plane } {
  const airports = AIRPORTS_CATALOG as Record<string, { name_ko: string; name_en: string }>;
  const cities = CITIES_CATALOG as Record<string, { name_ko: string; name_en: string }>;
  if (code in airports) {
    const a = airports[code];
    return { title: lang === 'ko' ? a.name_ko : a.name_en, sub: `(${code})`, Icon: Plane };
  }
  if (code in cities) {
    const c = cities[code];
    const Icon = code === 'SEL_METRO' ? Hotel : Car;
    return { title: lang === 'ko' ? c.name_ko : c.name_en, sub: lang === 'ko' ? '호텔·숙소' : 'Hotels', Icon };
  }
  return { title: code, sub: '', Icon: MapPin };
}

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

export function Step1Origin({ state, patch, language = 'en' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const lang = language === 'ko' ? 'ko' : 'en';
  const i18n = getWizardI18n(language);
  const customHintPlaceholder = language === 'ko' ? '예: 서울 강남구 테헤란로 123'
    : language === 'ja' ? '例: ソウル江南区テヘラン路123'
    : language === 'zh' ? '例: 首尔江南区德黑兰路123' : 'e.g. Lotte Hotel Seoul';

  const card = (code: OriginCode) => {
    const { title, sub, Icon } = labelFor(code, lang);
    const selected = state.origin === code;
    return (
      <button
        key={code}
        type="button"
        onClick={() => patch({ origin: code, originCustom: undefined })}
        className={`flex flex-col items-center justify-center py-4 px-3 rounded-xl border text-center transition-all ${
          selected
            ? 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/15 to-[#FF6B9D]/10 text-white'
            : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-[#B668FC]/40 hover:text-white/90'
        }`}
      >
        <Icon className="w-5 h-5 mb-1.5" />
        <p className="text-xs font-semibold leading-tight">{title}</p>
        <p className="text-[10px] opacity-55 mt-0.5">{sub}</p>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {PRIMARY.map(card)}
      </div>

      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.02] text-white/50 text-xs hover:bg-white/[0.05] transition-colors"
      >
        {i18n.otherOrigins} ({SECONDARY.length + 1})
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {SECONDARY.map(card)}
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-2">
              {i18n.customAddress}
            </label>
            <input
              type="text"
              value={state.originCustom ?? ''}
              onChange={e => patch({ origin: 'CUSTOM', originCustom: e.target.value })}
              placeholder={customHintPlaceholder}
              className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/80 text-sm placeholder:text-white/55 outline-none focus:border-[#B668FC]/40"
            />
          </div>
        </>
      )}
    </div>
  );
}
