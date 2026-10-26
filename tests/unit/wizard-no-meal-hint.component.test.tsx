// @vitest-environment jsdom
//
// 2026-10-26 — WizardStep3Review no-meal hint (rendered component, not only the pure helper).
// Shows only for a 2-day trip (inclusive start..end) arriving >= 18:00 and departing < 11:00.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { WizardStep3Review } from '../../src/components/WizardForm/WizardStep3Review';
import ko from '../../src/i18n/locales/ko.json';

afterEach(cleanup);

const base = {
  p: {}, language: 'en', reservationStatus: 'flight' as const, arrivalTerminal: 'ICN_T1', arrivalTime: '19:00',
  allCities: ['Seoul'], cityKeys: ['seoul'], arrivalCityKey: 'seoul', departureCityKey: 'seoul',
  selectedActivities: [], freeText: '', dietPrefs: [], dietaryRestrictions: ['Halal'], dietaryRestrictionsTouched: true,
  priceRange: '', spiceLevel: '', bucketDishes: [], startDate: '2027-03-10', endDate: '2027-03-11', pax: 2,
  departureTerminal: 'ICN_T1', departureTime: '10:00', hotelAddress: '', mainCityKey: 'seoul', hotelByCity: {},
  recommendedZones: {}, isMultiCity: false, tourPace: 'balanced' as const, tourStartTime: '09:00', tourEndTime: '21:00',
  companions: 'couple' as const, luggageSmall: 0, luggageMedium: 0, luggageLarge: 0, wantAccom: false, accomBudget: '',
  isLoading: false, errorMsg: '', onEditStep: () => {}, onGenerate: () => {},
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const show = (o: Record<string, unknown> = {}) => render(<WizardStep3Review {...(base as any)} {...o} />).queryByTestId('wizard-no-meal-hint');

describe('WizardStep3Review — no-meal hint', () => {
  it('2-day trip, arrival 19:00, departure 10:00 → hint shown (English fallback)', () => {
    const el = show();
    expect(el).not.toBeNull();
    expect(el!.textContent).toMatch(/no meal stops/i);
  });
  it('Korean copy comes from the locale key', () => {
    const planner = (ko as Record<string, Record<string, string>>).planner || {};
    const el = show({ p: planner, language: 'ko' });
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe(planner.wizardNoMealHint);
  });
  it.each([
    ['3-day trip', { endDate: '2027-03-12' }],
    ['1-day trip', { endDate: '2027-03-10' }],
    ['arrival 17:59', { arrivalTime: '17:59' }],
    ['departure 11:00', { departureTime: '11:00' }],
    ['no arrival time', { arrivalTime: '' }],
    ['no departure time', { departureTime: '' }],
  ])('%s → no hint', (_label, o) => {
    expect(show(o)).toBeNull();
  });
});
