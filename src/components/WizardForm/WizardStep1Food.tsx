// Step 1: food preferences (style chips, dietary restrictions, spice, bucket list, price).
//
// P10 (2026-04-24):
//   - Halal/Vegan moved into "Dietary Restrictions" group (religious/ethical, not flavor)
//   - Spice tolerance is now a 4-step slider, not a chip
//   - Korean dish "bucket list" multi-select added so the AI knows
//     which iconic dishes the user really wants to try
//
// Branches #16/#17/#18 (2026-05-21):
//   - #16 Halal selected → kbbq/jokbal bucket dishes grayed out (pork-based)
//   - #17 Vegan selected → Seafood/Meat food-style chips + kbbq/samgyetang/jokbal grayed out
//   - #18 No food selection → spice level slider grayed out
import { Check, AlertTriangle as TriangleAlert, Flame } from 'lucide-react';
import { WizardNav } from './WizardNav';
import { FOOD_STYLE_KEYS, FOOD_STYLE_ICONS, ALLERGY_KEYS, PRICE_KEYS, SPICE_LEVEL_KEYS, KOREAN_BUCKET_LIST } from './data';
import type { WizardDict } from './types';

// Bucket dishes incompatible with Halal (pork-based).
// kbbq = Korean BBQ (includes 삼겹살/돼지), jokbal = 족발 (pork trotters).
// Note: samgyetang (chicken) IS halal-compatible, so NOT in this list.
const HALAL_INCOMPATIBLE_BUCKETS = new Set(['kbbq', 'jokbal']);

// Bucket dishes incompatible with Vegan (meat/seafood-based).
const VEGAN_INCOMPATIBLE_BUCKETS = new Set(['kbbq', 'samgyetang', 'jokbal']);

// Food style keys incompatible with Vegan.
const VEGAN_INCOMPATIBLE_FOOD_STYLES = new Set(['Seafood', 'Meat']);

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

  // Branch #16: Halal selected → pork-based buckets disabled.
  const isHalal = allergies.includes('Halal');
  // Branch #17: Vegan selected → meat/seafood food-styles + meat buckets disabled.
  const isVegan = allergies.includes('Vegan');
  // Branch #18: No food preference at all → spice disabled.
  const hasAnyFoodPref = dietPrefs.length > 0 || bucketDishes.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="ec-question mb-1">{p.wizardFoodTitle || 'Tell us your food preferences'}</h2>
        <p className="ec-help">{p.wizardFoodSub || "We'll recommend restaurants just for you"}</p>
      </div>

      {/* 5/7 추가 — 할랄/비건 명시 안내 (사용자 요구사항). 식이제한 사용자가 누락하면
          unverified_restaurant 위험 + 건강 안전 이슈 → 명시적 강조. */}
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-ec-md border border-ec-line bg-ec-sunken">
        <TriangleAlert className="w-4 h-4 text-ec-notice shrink-0 mt-0.5" />
        <div className="text-[12px] text-ec-ink-2 leading-relaxed">
          <p className="font-semibold text-ec-notice mb-0.5">
            {p.wizardFoodDietaryHighlight || '⚠️ Halal / Vegan / Allergies — please select if applicable'}
          </p>
          <p className="text-ec-ink-3">
            {p.wizardFoodDietaryHint || 'Selecting these helps us recommend restaurants matching your dietary needs along your route. Missing this can lead to unverified suggestions.'}
          </p>
        </div>
      </div>

      {/* Diet style chips */}
      <div>
        <p className="text-sm text-ec-ink-3 mb-1 font-medium">{p.wizardFoodStyleLabel || 'Food Preferences'}</p>
        <p className="ec-help mb-3">{p.wizardActivitiesHint || 'Select all that apply'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FOOD_STYLE_KEYS.map((key) => {
            const nameKey = `food${key}` as keyof typeof p;
            const subKey = `food${key}Sub` as keyof typeof p;
            const sel = dietPrefs.includes(key);
            // Branch #17: Vegan → Seafood/Meat chips disabled
            const veganDisabled = isVegan && VEGAN_INCOMPATIBLE_FOOD_STYLES.has(key);
            const disabledTooltip = veganDisabled
              ? (p.wizardBucketDisabledVegan || 'Disabled when Vegan is selected')
              : undefined;
            return (
              <button key={key}
                onClick={() => { if (!veganDisabled) toggleDiet(key); }}
                title={disabledTooltip}
                disabled={veganDisabled}
                aria-pressed={sel}
                className={`ec-option ${sel ? 'is-selected' : ''}`}>
                <span className="flex items-center gap-2">
                  <span className="shrink-0">{FOOD_STYLE_ICONS[key]}</span>
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block text-[13px] font-bold truncate">{p[nameKey] || key}</span>
                    <span className="block text-[10px] text-ec-ink-3 truncate">
                      {veganDisabled ? disabledTooltip : p[subKey]}
                    </span>
                  </span>
                  {(!veganDisabled && sel) && <Check className="w-4 h-4 ml-auto shrink-0 text-ec-brand" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Allergy chips */}
      <div>
        <p className="text-sm text-ec-ink-3 mb-1 font-medium flex items-center gap-1.5">
          <TriangleAlert className="w-3.5 h-3.5 text-ec-notice" />
          {p.wizardFoodAllergyLabel || 'Allergies / Dietary Restrictions'}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {ALLERGY_KEYS.map((key) => {
            const label = p[`allergy${key}`] || key;
            const sel = key === 'None' ? allergies.length === 0 : allergies.includes(key);
            return (
              <button key={key} onClick={() => toggleAllergy(key)}
                aria-pressed={sel}
                className={`ec-option ec-option-sm ${sel ? 'is-selected' : ''}`}>
                {sel && <Check className="w-3 h-3 inline mr-1 text-ec-brand" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Spice slider (P10) — Branch #18: disabled when no food pref selected */}
      <div>
        <p className={`text-sm mb-2.5 font-medium flex items-center gap-1.5 text-ec-ink-3 ${hasAnyFoodPref ? '' : 'opacity-60'}`}>
          <Flame className="w-3.5 h-3.5 text-ec-notice" />
          {p.wizardFoodSpiceLabel || 'Spice tolerance'}
          {!hasAnyFoodPref && (
            <span className="text-[11px] font-normal ml-1">
              — {p.wizardSpiceDisabledNoFood || 'Select a food preference first'}
            </span>
          )}
        </p>
        <div className={`grid grid-cols-4 gap-1.5 ${!hasAnyFoodPref ? 'opacity-40 pointer-events-none' : ''}`}>
          {SPICE_LEVEL_KEYS.map((key) => {
            const fallback = SPICE_LABELS_FALLBACK[key];
            const label = (p[`spice${key.charAt(0).toUpperCase()}${key.slice(1)}`] as string) || fallback.label;
            const sub = (p[`spice${key.charAt(0).toUpperCase()}${key.slice(1)}Sub`] as string) || fallback.sub;
            const sel = spiceLevel === key;
            return (
              <button key={key} type="button"
                onClick={() => { if (hasAnyFoodPref) setSpiceLevel(key); }}
                disabled={!hasAnyFoodPref}
                aria-pressed={sel}
                className={`ec-option ${sel ? 'is-selected' : ''}`}>
                <span className="flex flex-col items-center gap-0.5 text-center">
                  <span className="text-[12px] font-semibold">{label}</span>
                  <span className="text-[9px] text-ec-ink-3 font-normal leading-tight">{sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Korean dish bucket list (P10) — Branch #16/#17: Halal/Vegan incompatible dishes grayed */}
      <div>
        <p className="text-sm text-ec-ink-3 mb-1 font-medium">{p.wizardFoodBucketLabel || 'Korean bucket list'}</p>
        <p className="ec-help mb-3">{p.wizardFoodBucketHint || 'Iconic dishes you must try (we\'ll fit them in)'}</p>
        <div className="flex flex-wrap gap-2">
          {KOREAN_BUCKET_LIST.map((key) => {
            const label = (p[`bucket${key.charAt(0).toUpperCase()}${key.slice(1)}`] as string) || BUCKET_LABELS_FALLBACK[key] || key;
            const sel = bucketDishes.includes(key);
            // Branch #16: Halal → pork-based dishes disabled
            const halalDisabled = isHalal && HALAL_INCOMPATIBLE_BUCKETS.has(key);
            // Branch #17: Vegan → meat/seafood-based dishes disabled
            const veganBucketDisabled = isVegan && VEGAN_INCOMPATIBLE_BUCKETS.has(key);
            const isDisabled = halalDisabled || veganBucketDisabled;
            const disabledTooltip = halalDisabled
              ? (p.wizardBucketDisabledHalal || 'Disabled when Halal is selected')
              : veganBucketDisabled
                ? (p.wizardBucketDisabledVegan || 'Disabled when Vegan is selected')
                : undefined;
            return (
              <button key={key} type="button"
                onClick={() => { if (!isDisabled) toggleBucketDish(key); }}
                title={disabledTooltip}
                disabled={isDisabled}
                aria-pressed={sel}
                className={`ec-option ec-option-sm ${sel ? 'is-selected' : ''} ${isDisabled ? 'line-through' : ''}`}>
                {(!isDisabled && sel) && <Check className="w-3 h-3 inline mr-1 text-ec-brand" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Price range */}
      <div>
        <p className="text-sm text-ec-ink-3 mb-2.5 font-medium">{p.wizardFoodPriceLabel || 'Meal Budget'}</p>
        <div className="grid grid-cols-2 gap-2">
          {PRICE_KEYS.map((key) => {
            const label = p[`price${key}`] || key;
            const range = p[`price${key}Range`] || '';
            const sel = priceRange === key;
            return (
              <button key={key} onClick={() => setPriceRange(key)}
                aria-pressed={sel}
                className={`ec-option ${sel ? 'is-selected' : ''}`}>
                <span className="flex flex-col items-center gap-0.5 text-center">
                  <span className="text-[13px] font-semibold">{label}</span>
                  {range && <span className="text-[10px] text-ec-ink-3 font-normal">{range}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nav */}
      <WizardNav
        onPrev={onPrev}
        onNext={onNext}
        prevLabel={p.planner_prev || 'Back'}
        nextLabel={p.planner_step2_date || 'Next: Details'}
        isMobile={isMobile}
      />
    </div>
  );
}
