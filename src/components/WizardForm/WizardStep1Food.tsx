// Step 1: food preferences (style chips, dietary restrictions, spice, bucket list, price).
//
// P10 (2026-04-24):
//   - Halal/Vegan moved into "Dietary Restrictions" group (religious/ethical, not flavor)
//   - Spice tolerance is now a 4-step slider, not a chip
//   - Korean dish "bucket list" multi-select added so the AI knows
//     which iconic dishes the user really wants to try
import { ChevronLeft, ChevronRight, Check, AlertTriangle as TriangleAlert, Flame } from 'lucide-react';
import { FOOD_STYLE_KEYS, FOOD_STYLE_ICONS, ALLERGY_KEYS, PRICE_KEYS, SPICE_LEVEL_KEYS, KOREAN_BUCKET_LIST } from './data';
import type { WizardDict } from './types';

interface Step1Props {
  p: WizardDict;
  isMobile: boolean;
  dietPrefs: string[];
  allergies: string[];
  priceRange: string;
  spiceLevel: string;
  bucketDishes: string[];
  toggleDiet: (key: string) => void;
  toggleAllergy: (key: string) => void;
  setPriceRange: (key: string) => void;
  setSpiceLevel: (key: string) => void;
  toggleBucketDish: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
}

const SPICE_LABELS_FALLBACK: Record<string, { label: string; sub: string }> = {
  none:   { label: 'No spice',  sub: 'Cannot tolerate spicy' },
  mild:   { label: 'Mild',      sub: 'A gentle kick' },
  medium: { label: 'Medium',    sub: 'Like kimchi' },
  hot:    { label: 'Very spicy', sub: 'Buldak / extreme tteokbokki' },
};

const BUCKET_LABELS_FALLBACK: Record<string, string> = {
  kbbq: 'Korean BBQ', kfc: 'Korean fried chicken', tteokbokki: 'Tteokbokki',
  bibimbap: 'Bibimbap', samgyetang: 'Samgyetang', naengmyeon: 'Naengmyeon',
  jokbal: 'Jokbal/Bossam', sundubu: 'Sundubu jjigae',
};

export function WizardStep1Food(props: Step1Props) {
  const { p, isMobile, dietPrefs, allergies, priceRange, spiceLevel, bucketDishes,
          toggleDiet, toggleAllergy, setPriceRange, setSpiceLevel, toggleBucketDish,
          onPrev, onNext } = props;

  return (
    <div className="space-y-5">
      <div>
        <h2 className={`text-[17px] sm:text-lg font-bold mb-1 ${isMobile ? 'm-shimmer-text' : 'text-white'}`}>{p.wizardFoodTitle || 'Tell us your food preferences'}</h2>
        <p className="text-[13px] sm:text-sm text-white/40">{p.wizardFoodSub || "We'll recommend restaurants just for you"}</p>
      </div>

      {/* Diet style chips */}
      <div>
        <p className="text-sm text-white/50 mb-1 font-medium">{p.wizardFoodStyleLabel || 'Food Preferences'}</p>
        <p className="text-xs text-white/25 mb-3">{p.wizardActivitiesHint || 'Select all that apply'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FOOD_STYLE_KEYS.map((key) => {
            const nameKey = `food${key}` as keyof typeof p;
            const subKey = `food${key}Sub` as keyof typeof p;
            const sel = dietPrefs.includes(key);
            const accentColor = isMobile ? '#B668FC' : '#7C5CFC';
            return (
              <button key={key} onClick={() => toggleDiet(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  sel
                    ? 'border-transparent text-white shadow-lg'
                    : 'border-white/[0.1] bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white'
                }`}
                style={sel ? {
                  background: isMobile
                    ? 'linear-gradient(135deg,rgba(182,104,252,.35),rgba(255,107,157,.35))'
                    : 'linear-gradient(135deg,rgba(124,92,252,.35),rgba(234,83,126,.35))',
                  borderColor: `${accentColor}80`,
                } : {}}>
                <span className="shrink-0">{FOOD_STYLE_ICONS[key]}</span>
                <div className="overflow-hidden">
                  <p className="text-[13px] font-bold truncate">{p[nameKey] || key}</p>
                  <p className="text-[10px] text-white/40 truncate">{p[subKey]}</p>
                </div>
                {sel && <Check className={`w-4 h-4 ml-auto shrink-0 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Allergy chips */}
      <div>
        <p className="text-sm text-white/50 mb-1 font-medium flex items-center gap-1.5">
          <TriangleAlert className="w-3.5 h-3.5 text-amber-400/70" />
          {p.wizardFoodAllergyLabel || 'Allergies / Dietary Restrictions'}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {ALLERGY_KEYS.map((key) => {
            const label = p[`allergy${key}`] || key;
            const sel = key === 'None' ? allergies.length === 0 : allergies.includes(key);
            return (
              <button key={key} onClick={() => toggleAllergy(key)}
                className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-all ${
                  sel
                    ? (isMobile
                        ? 'bg-[#B668FC]/20 border-[#B668FC]/50 text-white shadow-[0_0_8px_rgba(182,104,252,0.15)]'
                        : 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white shadow-[0_0_8px_rgba(124,92,252,0.15)]')
                    : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'
                }`}>
                {sel && <Check className="w-3 h-3 inline mr-1" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Spice slider (P10) */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-rose-400/70" />
          {p.wizardFoodSpiceLabel || 'Spice tolerance'}
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {SPICE_LEVEL_KEYS.map((key) => {
            const fallback = SPICE_LABELS_FALLBACK[key];
            const label = (p[`spice${key.charAt(0).toUpperCase()}${key.slice(1)}`] as string) || fallback.label;
            const sub = (p[`spice${key.charAt(0).toUpperCase()}${key.slice(1)}Sub`] as string) || fallback.sub;
            const sel = spiceLevel === key;
            return (
              <button key={key} type="button" onClick={() => setSpiceLevel(key)}
                className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl text-[12px] font-semibold border transition-all ${
                  sel
                    ? (isMobile
                        ? 'bg-rose-500/15 border-rose-400/50 text-white shadow-[0_0_8px_rgba(244,63,94,0.15)]'
                        : 'bg-rose-500/15 border-rose-400/50 text-white shadow-[0_0_8px_rgba(244,63,94,0.15)]')
                    : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'
                }`}>
                <span>{label}</span>
                <span className="text-[9px] text-white/30 font-normal text-center leading-tight">{sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Korean dish bucket list (P10) */}
      <div>
        <p className="text-sm text-white/50 mb-1 font-medium">{p.wizardFoodBucketLabel || 'Korean bucket list'}</p>
        <p className="text-xs text-white/25 mb-3">{p.wizardFoodBucketHint || 'Iconic dishes you must try (we’ll fit them in)'}</p>
        <div className="flex flex-wrap gap-2">
          {KOREAN_BUCKET_LIST.map((key) => {
            const label = (p[`bucket${key.charAt(0).toUpperCase()}${key.slice(1)}`] as string) || BUCKET_LABELS_FALLBACK[key] || key;
            const sel = bucketDishes.includes(key);
            return (
              <button key={key} type="button" onClick={() => toggleBucketDish(key)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-all ${
                  sel
                    ? (isMobile
                        ? 'bg-[#B668FC]/20 border-[#B668FC]/50 text-white'
                        : 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white')
                    : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'
                }`}>
                {sel && <Check className="w-3 h-3 inline mr-1" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Price range */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardFoodPriceLabel || 'Meal Budget'}</p>
        <div className="grid grid-cols-2 gap-2">
          {PRICE_KEYS.map((key) => {
            const label = p[`price${key}`] || key;
            const range = p[`price${key}Range`] || '';
            const sel = priceRange === key;
            return (
              <button key={key} onClick={() => setPriceRange(key)}
                className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl text-[13px] font-semibold border transition-all ${
                  sel
                    ? (isMobile
                        ? 'bg-[#B668FC]/20 border-[#B668FC]/50 text-white shadow-[0_0_8px_rgba(182,104,252,0.15)]'
                        : 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white shadow-[0_0_8px_rgba(124,92,252,0.15)]')
                    : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'
                }`}>
                <span>{label}</span>
                {range && <span className="text-[10px] text-white/30 font-normal">{range}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Nav */}
      <div className="flex gap-3 pt-2">
        <button onClick={onPrev}
          className="px-4 py-3 rounded-xl border border-white/[0.12] text-white/50 hover:text-white text-sm font-semibold flex items-center gap-1 transition-all">
          <ChevronLeft className="w-4 h-4" /> {p.wizardTitle || 'Back'}
        </button>
        <button onClick={onNext}
          className="flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 hover:scale-[1.01] transition-all"
          style={{ background: isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
          {p.planner_step2_date || 'Next: Details'} <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
