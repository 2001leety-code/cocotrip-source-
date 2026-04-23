// Step 0: destination cities + activities + free-text hints.
import { Sparkles, ChevronRight, Check } from 'lucide-react';
import { CITY_CHIPS, ACTIVITY_KEYS, ACTIVITY_ICON_MAP } from './data';
import type { WizardDict } from './types';

interface Step0Props {
  p: WizardDict;
  isMobile: boolean;
  mainCity: string;
  mainCityKey: string;
  extraCities: string[];
  selectedActivities: string[];
  freeText: string;
  setMainCity: (v: string) => void;
  setMainCityKey: (v: string) => void;
  setExtraCities: (v: string[] | ((prev: string[]) => string[])) => void;
  setSelectedActivities: (v: string[]) => void;
  setFreeText: (v: string) => void;
  allCities: string[];
  canGoStep1: boolean;
  getCityName: (key: string) => string;
  toggleActivity: (key: string) => void;
  toggleCity: (cityName: string, chipKey?: string) => void;
  isCitySelected: (cityName: string) => boolean;
  onNext: () => void;
}

export function WizardStep0Destination(props: Step0Props) {
  const {
    p, isMobile, mainCity, selectedActivities, freeText,
    setMainCity, setMainCityKey, setExtraCities, setSelectedActivities, setFreeText,
    allCities, canGoStep1, getCityName, toggleActivity, toggleCity, isCitySelected, onNext,
  } = props;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] sm:text-lg font-bold text-white mb-1">{p.wizardTitle || 'Where would you like to visit?'}</h2>
        <p className="text-[13px] sm:text-sm text-white/40">{p.wizardTitleSub || 'Tap cities to add - first selected is your main base'}</p>
      </div>

      {/* Quick Start Presets */}
      {!mainCity && (
        <div>
          <p className="text-sm text-white/50 mb-2 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#7C5CFC]" />
            {p.presetLabel || 'Quick Start'}
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: p.presetFirst || '3 Days Seoul Highlights', city: 'seoul', acts: ['Food', 'Photo', 'Shopping'] },
              { label: p.presetSecond || 'Seoul + Busan 5 Days', city: 'seoul', extra: ['busan'], acts: ['Food', 'Photo', 'Temple'] },
              { label: p.presetThird || 'K-pop Fan Trip', city: 'seoul', acts: ['Kpop', 'Shopping', 'Photo'] },
              { label: p.presetFourth || 'Foodie Tour Seoul', city: 'seoul', acts: ['Food', 'Night', 'Shopping'] },
              { label: p.presetFifth || 'Jeju Nature Healing', city: 'jeju', acts: ['Photo', 'Food', 'Temple'] },
            ].map((preset: { label: string; city: string; extra?: string[]; acts: string[] }) => (
              <button key={preset.label} onClick={() => {
                const cityName = getCityName(preset.city);
                setMainCity(cityName); setMainCityKey(preset.city);
                if (preset.extra) setExtraCities(preset.extra.map((k: string) => getCityName(k)));
                setSelectedActivities(preset.acts);
              }}
                className="px-3 py-1.5 rounded-full text-[12px] font-semibold border border-[#7C5CFC]/25 text-white/60 hover:border-[#7C5CFC]/50 hover:text-white hover:bg-[#7C5CFC]/10 transition-all">
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* City chips with lucide icons */}
      <div>
        <p className="text-sm text-white/50 mb-3 font-medium">
          {p.tripAreaLabel || 'Select Cities'}
          {allCities.length > 0 && (
            <span className="ml-2 text-[#7C5CFC] font-bold">{allCities.length} {p.wizardCitySelected || 'selected'}</span>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {CITY_CHIPS.map(({ key, icon }) => {
            const cityName = getCityName(key);
            const sel = isCitySelected(cityName);
            const isMain = mainCity === cityName;
            return (
              <button key={key} onClick={() => toggleCity(cityName, key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  sel
                    ? 'border-[#7C5CFC]/60 text-white'
                    : 'border-white/[0.08] bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/80'
                }`}
                style={sel ? { background: 'linear-gradient(135deg,rgba(124,92,252,.2),rgba(234,83,126,.12))' } : {}}>
                <span className={sel ? 'text-[#7C5CFC]' : 'text-white/30'}>{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate">{cityName}</p>
                  {isMain && <p className="text-[10px] text-[#7C5CFC]/80 font-medium">{p.wizardMainBase || 'Main base'}</p>}
                </div>
                {sel && <Check className="w-4 h-4 text-[#7C5CFC] shrink-0" />}
              </button>
            );
          })}
        </div>
        {allCities.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="text-xs text-white/30">{p.wizardRoute || 'Route'}:</span>
            {allCities.map((c, i) => (
              <span key={c} className="text-xs text-white/50">
                {i > 0 && <span className="text-white/20 mx-1">-&gt;</span>}{c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Activities */}
      <div>
        <p className="text-sm text-white/50 mb-1 font-medium">{p.wizardActivities || 'What interests you?'}</p>
        <p className="text-xs text-white/25 mb-3">{p.wizardActivitiesHint || 'Select all that apply'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ACTIVITY_KEYS.map((key) => {
            const nameKey = `act${key}` as keyof typeof p;
            const subKey = `act${key}Sub` as keyof typeof p;
            const sel = selectedActivities.includes(key);
            return (
              <button key={key} onClick={() => toggleActivity(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  sel
                    ? 'border-transparent text-white shadow-lg'
                    : 'border-white/[0.1] bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white'
                }`}
                style={sel ? { background: 'linear-gradient(135deg,rgba(124,92,252,.35),rgba(234,83,126,.35))', borderColor: 'rgba(124,92,252,.5)' } : {}}>
                <span className="shrink-0">{ACTIVITY_ICON_MAP[key]}</span>
                <div className="overflow-hidden flex-1 min-w-0">
                  {/* Allow 2-line wrap so longer translated labels (e.g. EN "Hanbok Experience" / "K-Drama Locations", JA "ショッピングツアー") aren't cut off mid-word. */}
                  <p className="text-[13px] font-bold leading-tight line-clamp-2">{p[nameKey]}</p>
                  {/* Sub also wraps to 2 lines — fixes "Myeongdong · Dongdaemun" being chopped on iphone-se. */}
                  <p className="text-[10px] text-white/40 leading-tight line-clamp-2 mt-0.5">{p[subKey]}</p>
                </div>
                {sel && <Check className="w-4 h-4 ml-auto text-[#7C5CFC] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Free text */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardFreeInput || 'Specific places?'} <span className="text-white/25">({p.wizardOptional || 'optional'})</span></p>
        <textarea value={freeText} onChange={e => setFreeText(e.target.value)}
          placeholder={p.wizardFreeInputPh || 'e.g. Gyeongbokgung Palace, Myeongdong...'}
          rows={2}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 resize-none transition-colors" />
      </div>

      {/* Next */}
      <button onClick={onNext} disabled={!canGoStep1}
        className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] transition-all"
        style={{ background: canGoStep1 ? (isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)') : 'rgba(255,255,255,.1)' }}>
        {p.wizardFoodTitle || 'Next: Food Preferences'} <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
