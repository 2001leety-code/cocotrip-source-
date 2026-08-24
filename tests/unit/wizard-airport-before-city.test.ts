/**
 * 2026-08-24 (planner-trust-course): before a city is chosen (Step 0 runs
 * before Step 1/Destination), the arrival-airport dropdown must show a
 * deduplicated GLOBAL list (ICN/PUS/CJU/...) — not silently narrow to
 * Seoul's 3 options via a `mainCityKey || 'seoul'` fallback. And once an
 * airport is picked from that global list, selecting a city afterward must
 * not erase it just because that one city's own shortlist doesn't happen to
 * include it (`AIRPORT_OPTIONS.seoul` never lists PUS, but PUS is still a
 * real, globally valid answer).
 */
import { describe, it, expect } from 'vitest';
import { getAirportOptions, isKnownAirportValue } from '../../src/components/WizardForm/helpers';

describe('getAirportOptions("") — global list before a city is chosen', () => {
  const global = getAirportOptions('');

  it('includes ICN, PUS, and CJU', () => {
    const values = global.map((o) => o.value);
    expect(values).toContain('ICN_T1');
    expect(values).toContain('PUS');
    expect(values).toContain('CJU');
  });

  it('is deduplicated by value', () => {
    const values = global.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('labels ALREADY generically ("Already in Korea"), never Seoul-only', () => {
    const already = global.find((o) => o.value === 'ALREADY');
    expect(already).toBeDefined();
    expect(already!.label).toBe('Already in Korea');
    expect(already!.label).not.toMatch(/Seoul/i);
  });
});

describe('getAirportOptions(cityKey) — a specific city still narrows as before', () => {
  it('Busan lists PUS and ICN', () => {
    const values = getAirportOptions('busan').map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['PUS', 'ICN_T1']));
  });

  it('Jeju lists CJU', () => {
    const values = getAirportOptions('jeju').map((o) => o.value);
    expect(values).toContain('CJU');
  });
});

describe('isKnownAirportValue — the erase-on-city-change boundary', () => {
  it('PUS is globally known even though only Busan/Gyeongju/Daegu list it directly', () => {
    expect(isKnownAirportValue('PUS')).toBe(true);
  });

  it('ICN_T1 is globally known (listed by both Busan and Seoul)', () => {
    expect(isKnownAirportValue('ICN_T1')).toBe(true);
  });

  it('CJU is globally known', () => {
    expect(isKnownAirportValue('CJU')).toBe(true);
  });

  it('rejects a genuinely unknown/garbage code', () => {
    expect(isKnownAirportValue('XXX_NOT_REAL')).toBe(false);
    expect(isKnownAirportValue('')).toBe(false);
  });
});
