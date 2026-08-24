// Pure helpers shared across wizard steps.
//
// 🔴 여기에 컴포넌트를 export 하지 말 것 (2026-08-04). 한 모듈이 컴포넌트와 일반 함수를
//   같이 export 하면 Vite fast-refresh 가 이 파일을 갱신할 때 위저드를 통째로 리마운트한다
//   — 입력 중이던 값이 날아간다. react-refresh/only-export-components 가 이걸 잡는다.
//   유일한 컴포넌트였던 SummaryCard 는 소비처가 WizardStep3Review 하나뿐이라 그리로 옮겼다.
import { AIRPORT_OPTIONS, type AirportOption } from './data';

export function getAirportOptions(chipKey: string): AirportOption[] {
  if (chipKey) return AIRPORT_OPTIONS[chipKey] || AIRPORT_OPTIONS.seoul;
  // No city selected: return all globally supported airports (deduplicated).
  // 2026-08-24 (planner-trust-course): every city's list carries its own
  // 'ALREADY' entry with a city-specific label ("Already in Seoul", "Already
  // in Busan", ...) — before dedup this Set kept whichever one it saw FIRST,
  // which was always Seoul's (first key in AIRPORT_OPTIONS), so a traveler
  // who hadn't picked a city yet saw "Already in Seoul" no matter what.
  // Force one neutral label for the global (no-city-yet) case instead.
  const seen = new Set<string>();
  const all: AirportOption[] = [];
  for (const cityOpts of Object.values(AIRPORT_OPTIONS)) {
    for (const opt of cityOpts) {
      if (seen.has(opt.value)) continue;
      seen.add(opt.value);
      all.push(opt.value === 'ALREADY' ? { value: 'ALREADY', label: 'Already in Korea' } : opt);
    }
  }
  return all;
}

/**
 * 2026-08-24 (planner-trust-course): whether a code is a real, globally known
 * airport value (any city's AIRPORT_OPTIONS, including 'ALREADY') — the
 * boundary a previously-picked airport is checked against when the traveler's
 * selected city changes, so that e.g. PUS picked before any city was chosen
 * survives a later "Busan" or "Seoul" city pick (both list ICN; only Busan
 * lists PUS, but PUS is still a real, globally valid answer). Only a value
 * that ISN'T any known airport at all (garbage/corrupted state) is unknown.
 */
export function isKnownAirportValue(value: string): boolean {
  if (!value) return false;
  return getAirportOptions('').some((o) => o.value === value);
}

/** P142 (2026-05-22): 출국 공항 옵션 빌더. 다도시 plan 에서 출국지가 입국지와
 *  다를 수 있어 (서울 → 부산 → 김해 출국) 모든 city 의 공항을 union + dedup.
 *  단도시는 그 city 의 공항만. ALREADY 옵션은 제거 (출국 = 한국 떠남). */
export function getDepartureAirportOptions(cityKeys: string[]): AirportOption[] {
  const keys = (cityKeys && cityKeys.length > 0) ? cityKeys : ['seoul'];
  const seen = new Set<string>();
  const merged: AirportOption[] = [];
  for (const ck of keys) {
    const opts = AIRPORT_OPTIONS[ck] || [];
    for (const opt of opts) {
      if (opt.value === 'ALREADY') continue;
      if (seen.has(opt.value)) continue;
      seen.add(opt.value);
      merged.push(opt);
    }
  }
  return merged;
}

export function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
