// Step (destinations): cities + DYNAMIC activities (P9) + free-text hints.
//
// P9 (2026-04-24): Activity chips are now keyed off selected cities. Universal
// chips (Food/Photo/Shopping/Night) always render; city-specific chips
// (Jagalchi for 부산, OlleTrail for 제주, DMZ only for 서울, etc.) append.
// Falls back to legacy ACTIVITY_KEYS when no city is selected yet so the
// "before you pick a city" view isn't empty.
//
// P161 (2026-05-23): 운영자 신고 — 입국/출국 마킹 UI 가 2페이지 (Destinations) +
// 4페이지 (Details) 양쪽에 있어 사용자가 헷갈림. cycle 로직 + arrival/departure
// 배지 + route 표시 모두 4페이지 (WizardStep2Details) 로 이전. 본 페이지는
// 도시 chips 만 단순 토글 (선택/해제). 입국/출국 의도는 4페이지의 명시적
// chips 에서만 설정.
import { useMemo, useState } from 'react';
import { Sparkles, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { WizardNav } from './WizardNav';
import {
  CITY_CHIPS, CITY_PHOTO, ACTIVITY_KEYS, ACTIVITY_ICON_MAP, CITY_ACTIVITY_ICONS,
  getActivitiesForCities, ACTIVITY_CHIPS_EXPANDED, EXPANDED_ACTIVITY_ICONS,
} from './data';
import type { WizardDict } from './types';

interface Step0Props {
  p: WizardDict;
  isMobile: boolean;
  mainCity: string;
  mainCityKey: string;
  extraCities: string[];
  selectedCityKeys: string[];        // P9: chip keys (e.g. ['seoul','busan'])
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
  onPrev?: () => void;               // P6: Step 0 reservation now precedes this step
  onNext: () => void;
  // 2026-05-11 (B-1 fix): Quick Start preset 라벨에 "3 Days"/"5 Days" 명시인데
  // 클릭 시 일수 set 안 됐던 회귀. preset 클릭 시 setDateRange 호출로 캘린더 sync.
  // 기존 startDate 가 있으면 그 시점 보존, 없으면 default 한 달 후.
  dateRange?: DateRange;
  setDateRange: (range: DateRange | undefined) => void;
  // P161 (2026-05-23): 입국/출국 마킹 props 제거 (arrivalCityKey / departureCityKey /
  // setArrivalCityKey / setDepartureCityKey). 4페이지 (WizardStep2Details) 에서 처리.
}

export function WizardStep0Destination(props: Step0Props) {
  const {
    p, isMobile, mainCity, selectedCityKeys, selectedActivities, freeText,
    setMainCity, setMainCityKey, setExtraCities, setSelectedActivities, setFreeText,
    allCities, canGoStep1, getCityName, toggleActivity, toggleCity, isCitySelected, onPrev, onNext,
    dateRange, setDateRange,
  } = props;

  // P161 (2026-05-23): 도시 chip 클릭 = 단순 토글 (선택 / 해제). 입국/출국 cycle 은
  // 4페이지 (WizardStep2Details) 로 이전됨. 본 페이지는 도시 선택만 담당.
  function handleCityClick(cityName: string, key: string) {
    toggleCity(cityName, key);
  }

  // 입력 가드: 사용자가 Next를 한 번 눌러야 오류 표시 (첫 진입 시 빨간 테두리 없음)
  const [showErrors, setShowErrors] = useState(false);
  // 2026-05-09 (UI variety): 메인 chips는 항상 노출, sub chips (트레킹/한강 따릉이/
  // 무료 활동 등) 는 expand 버튼 클릭 시에만 노출. 기본 false 로 선택지 폭증 회피.
  const [showMoreActivities, setShowMoreActivities] = useState(false);

  function handleNext() {
    if (!canGoStep1) {
      setShowErrors(true);
      return;
    }
    onNext();
  }

  // P9: derived activity keys — falls back to legacy full list when no city
  // chosen so first-time visitors still see something to click.
  const activityKeys = useMemo(
    () => (selectedCityKeys.length > 0 ? getActivitiesForCities(selectedCityKeys) : Array.from(ACTIVITY_KEYS)),
    [selectedCityKeys]
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] sm:text-lg font-bold text-white mb-1">{p.wizardTitle || 'Where would you like to visit?'}</h2>
        <p className="text-[13px] sm:text-sm text-white/55">{p.wizardTitleSub || 'Tap cities to add - first selected is your main base'}</p>
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
              { label: p.presetFirst || '3 Days Seoul Highlights', city: 'seoul', acts: ['Food', 'Photo', 'Shopping'], days: 3 },
              { label: p.presetSecond || 'Seoul + Busan 5 Days', city: 'seoul', extra: ['busan'], acts: ['Food', 'Photo', 'Temple'], days: 5 },
              { label: p.presetThird || 'K-pop Fan Trip', city: 'seoul', acts: ['Kpop', 'Shopping', 'Photo'] },
              { label: p.presetFourth || 'Foodie Tour Seoul', city: 'seoul', acts: ['Food', 'Night', 'Shopping'] },
              { label: p.presetFifth || 'Jeju Nature Healing', city: 'jeju', acts: ['Photo', 'Food', 'Temple'] },
            ].map((preset: { label: string; city: string; extra?: string[]; acts: string[]; days?: number }) => (
              <button key={preset.label} onClick={() => {
                const cityName = getCityName(preset.city);
                setMainCity(cityName); setMainCityKey(preset.city);
                if (preset.extra) setExtraCities(preset.extra.map((k: string) => getCityName(k)));
                setSelectedActivities(preset.acts);
                // B-1 (2026-05-11): preset 에 days 명시 (3 Days / 5 Days) 시 캘린더 sync.
                // 기존 출발일 보존, 없으면 한 달 후 default. 사용자가 캘린더에서 자유롭게 변경 가능.
                if (preset.days) {
                  const start = dateRange?.from ?? new Date(Date.now() + 30 * 86400000);
                  const end = new Date(start.getTime() + (preset.days - 1) * 86400000);
                  setDateRange({ from: start, to: end });
                }
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
        {showErrors && !mainCity && (
          <p className="text-[11px] text-red-400 mb-2">{(p as Record<string, string>).wizardFillRequired || 'Please select a city'}</p>
        )}
        {/* P161 (2026-05-23): 다도시 plan 시 입국/출국 cycle 안내 + arrival/departure 배지 +
            route 표시 모두 4페이지 (WizardStep2Details) 로 이전. 본 페이지는 도시 선택만. */}
        <div className="grid grid-cols-2 gap-2">
          {CITY_CHIPS.map(({ key, icon }) => {
            const cityName = getCityName(key);
            const sel = isCitySelected(cityName);
            const isMain = mainCity === cityName;
            const photo = CITY_PHOTO[key];
            return (
              <button key={key} onClick={() => handleCityClick(cityName, key)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-left transition-all ${
                  sel
                    ? 'border-[#7C5CFC]/60 text-white'
                    : 'border-white/[0.08] bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/80'
                }`}
                style={sel ? { background: 'linear-gradient(135deg,rgba(124,92,252,.2),rgba(234,83,126,.12))' } : {}}>
                {/* UIUX P3: 도시 실사진 썸네일 (KTO 검증). 매핑 없는 도시(yeosu)=아이콘 폴백. */}
                {photo ? (
                  <img src={photo} alt="" loading="lazy" width={44} height={44}
                    className={`w-11 h-11 rounded-lg object-cover shrink-0 ${sel ? '' : 'opacity-90'}`} />
                ) : (
                  <span className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 bg-white/[0.05] ${sel ? 'text-[#7C5CFC]' : 'text-white/55'}`}>{icon}</span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate">{cityName}</p>
                  {isMain && <p className="text-[10px] text-[#7C5CFC]/80 font-medium">{p.wizardMainBase || 'Main base'}</p>}
                </div>
                {sel && <Check className="w-4 h-4 text-[#7C5CFC] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Activities — P9: city-aware, universal chips first then city-specific */}
      <div>
        <p className="text-sm text-white/50 mb-1 font-medium">{p.wizardActivities || 'What interests you?'}</p>
        {showErrors && selectedActivities.length === 0 && (
          <p className="text-[11px] text-red-400 mb-1">{(p as Record<string, string>).wizardCheckRequired || 'Please select at least one activity'}</p>
        )}
        <p className="text-xs text-white/55 mb-3">
          {selectedCityKeys.length > 0
            ? (p.wizardActivitiesHintCity || `Tailored for ${allCities.join(', ')}`)
            : (p.wizardActivitiesHint || 'Select all that apply')}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {activityKeys.map((key) => {
            const nameKey = `act${key}` as keyof typeof p;
            const subKey = `act${key}Sub` as keyof typeof p;
            const sel = selectedActivities.includes(key);
            const icon = ACTIVITY_ICON_MAP[key] || CITY_ACTIVITY_ICONS[key] || <Sparkles className="w-5 h-5" />;
            // Fallback label if i18n key not yet added (lets new chips ship before
            // full translation pass completes — readable English derived from key).
            const labelFallback = key.replace(/([a-z])([A-Z])/g, '$1 $2');
            return (
              <button key={key} onClick={() => toggleActivity(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  sel
                    ? 'border-transparent text-white shadow-lg'
                    : 'border-white/[0.1] bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white'
                }`}
                style={sel ? { background: 'linear-gradient(135deg,rgba(124,92,252,.35),rgba(234,83,126,.35))', borderColor: 'rgba(124,92,252,.5)' } : {}}>
                <span className="shrink-0">{icon}</span>
                <div className="overflow-hidden flex-1 min-w-0">
                  <p className="text-[13px] font-bold leading-tight line-clamp-2">{p[nameKey] || labelFallback}</p>
                  <p className="text-[10px] text-white/55 leading-tight line-clamp-2 mt-0.5">{p[subKey] || ''}</p>
                </div>
                {sel && <Check className="w-4 h-4 ml-auto text-[#7C5CFC] shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* 2026-05-09 (UI variety): "+ Show more activities" — 무료/액티브 활동
            확장. 메인 chips는 위에 그대로 두고 클릭 시에만 sub-chips 노출.
            돈 안 들이고 할 수 있는 활동 (트레킹·한강 따릉이·러닝 등) 강조. */}
        <button
          type="button"
          onClick={() => setShowMoreActivities(v => !v)}
          className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#7C5CFC] hover:text-[#9b80ff] transition-colors"
          aria-expanded={showMoreActivities}
        >
          {showMoreActivities ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showMoreActivities
            ? (p.showLessActivities || 'Show fewer activities')
            : (p.showMoreActivities || '+ Show more activities (free options!)')}
        </button>
        {showMoreActivities && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-white/45 leading-relaxed">
              {p.moreActivitiesHint || 'Active outdoor + free local culture. Most cost ₩0.'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ACTIVITY_CHIPS_EXPANDED.map(({ key, free }) => {
                const nameKey = `act${key}` as keyof typeof p;
                const sel = selectedActivities.includes(key);
                const icon = EXPANDED_ACTIVITY_ICONS[key] || <Sparkles className="w-5 h-5" />;
                const labelFallback = key.replace(/([a-z])([A-Z])/g, '$1 $2');
                return (
                  <button key={key} onClick={() => toggleActivity(key)}
                    className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                      sel
                        ? 'border-transparent text-white shadow-lg'
                        : 'border-white/[0.1] bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white'
                    }`}
                    style={sel ? { background: 'linear-gradient(135deg,rgba(124,92,252,.35),rgba(234,83,126,.35))', borderColor: 'rgba(124,92,252,.5)' } : {}}>
                    <span className="shrink-0">{icon}</span>
                    <div className="overflow-hidden flex-1 min-w-0">
                      <p className="text-[13px] font-bold leading-tight line-clamp-2">{p[nameKey] || labelFallback}</p>
                      {free && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {p.activityFreeBadge || 'FREE ₩0'}
                        </span>
                      )}
                    </div>
                    {sel && <Check className="w-4 h-4 ml-auto text-[#7C5CFC] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Free text */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardFreeInput || 'Specific places?'} <span className="text-white/55">({p.wizardOptional || 'optional'})</span></p>
        <textarea value={freeText} onChange={e => setFreeText(e.target.value)}
          placeholder={p.wizardFreeInputPh || 'e.g. Gyeongbokgung Palace, Myeongdong...'}
          rows={2}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-xl px-3.5 py-2.5 sm:rounded-2xl sm:px-5 sm:py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 resize-none transition-colors" />
      </div>

      {/* Nav — back to reservation status if available */}
      <WizardNav
        onPrev={onPrev}
        onNext={handleNext}
        prevLabel={p.planner_prev || 'Back'}
        nextLabel={p.wizardFoodTitle || 'Next: Food Preferences'}
        isMobile={isMobile}
      />
    </div>
  );
}
