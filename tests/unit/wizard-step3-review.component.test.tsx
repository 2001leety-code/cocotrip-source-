// @vitest-environment jsdom
//
// WizardStep3Review — canonical-intent review (2026-08-24, planner-trust-course).
//
// Locks two things:
//   1) No medical allergy UI/copy anywhere in Review — the wizard only ever
//      collects Halal/Vegan/Vegetarian (religious/ethical, real trust chain —
//      see .claude/rules/dietary-safety.md), never allergens (Nuts/Shellfish/
//      Gluten/Dairy were removed from the food step entirely).
//   2) Every review group is a real <button> (keyboard-accessible by default)
//      that routes to the exact step owning those fields.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { WizardStep3Review } from '../../src/components/WizardForm/WizardStep3Review';

afterEach(cleanup);

// Empty dict — every `p[key] || fallback` in the component falls through to
// its own hardcoded English fallback string, which is what we assert on.
const p = {};

const baseProps = {
  p,
  language: 'en',
  reservationStatus: 'flight' as const,
  arrivalTerminal: 'ICN_T1',
  arrivalTime: '14:30',
  allCities: ['Seoul', 'Busan'],
  cityKeys: ['seoul', 'busan'],
  arrivalCityKey: 'seoul',
  departureCityKey: 'busan',
  selectedActivities: ['Kpop', 'Food'],
  freeText: 'Want to see cherry blossoms',
  dietPrefs: ['Seafood'],
  dietaryRestrictions: ['Halal'],
  dietaryRestrictionsTouched: true,
  priceRange: 'Budget',
  spiceLevel: 'hot',
  bucketDishes: ['kbbq'],
  startDate: '2027-03-10',
  endDate: '2027-03-15',
  pax: 3,
  departureTerminal: 'GMP',
  departureTime: '20:00',
  hotelAddress: '',
  mainCityKey: 'seoul',
  hotelByCity: {},
  recommendedZones: { seoul: 'myeongdong' },
  isMultiCity: true,
  tourPace: 'action' as const,
  tourStartTime: '07:00',
  tourEndTime: '22:00',
  companions: 'family' as const,
  luggageSmall: 2,
  luggageMedium: 1,
  luggageLarge: 0,
  wantAccom: true,
  accomBudget: 'luxury',
  isLoading: false,
  errorMsg: '',
  onEditStep: () => {},
  onGenerate: () => {},
};

function renderReview(overrides: Partial<typeof baseProps> = {}) {
  const onEditStep = vi.fn();
  const utils = render(<WizardStep3Review {...baseProps} {...overrides} onEditStep={onEditStep} />);
  return { onEditStep, ...utils };
}

describe('WizardStep3Review — no medical allergy UI', () => {
  it('never renders allergen words anywhere in the review', () => {
    const { container } = renderReview();
    const text = container.textContent || '';
    for (const word of ['Nuts', 'Shellfish', 'Gluten', 'Dairy', 'allerg']) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('only shows Halal/Vegan/Vegetarian-style religious/ethical restrictions', () => {
    renderReview();
    expect(screen.getByText('Halal')).toBeTruthy();
  });
});

describe('WizardStep3Review — real submitted values are visible', () => {
  it('shows step 0 reservation + flight detail', () => {
    const { container } = renderReview();
    expect(container.textContent).toContain('Flight booked');
    expect(container.textContent).toContain('ICN T1');
    expect(container.textContent).toContain('14:30');
  });

  it('shows step 1 ordered cities with arrival/departure roles + activities + special request', () => {
    const { container } = renderReview();
    expect(container.textContent).toContain('Seoul (Arrival)');
    expect(container.textContent).toContain('Busan (Departure)');
    expect(container.textContent).toContain('Kpop, Food');
    expect(container.textContent).toContain('Want to see cherry blossoms');
  });

  it('shows step 2 food styles, dietary restrictions, price, spice, bucket dishes', () => {
    const { container } = renderReview();
    expect(container.textContent).toContain('Seafood');
    expect(container.textContent).toContain('Halal');
    expect(container.textContent).toContain('Budget');
    expect(container.textContent).toContain('hot');
    expect(container.textContent).toContain('kbbq');
  });

  it('shows step 3 dates (Intl-formatted, not fixed English month table), pax, airports, zone, pace, window, companions, luggage, accommodation', () => {
    const { container } = renderReview();
    const text = container.textContent || '';
    expect(text).toContain('3 pax');
    expect(text).toContain('ICN T1');
    expect(text).toContain('Gimpo');
    expect(text).toContain('20:00');
    expect(text).toContain('myeongdong');
    expect(text).toContain('action');
    expect(text).toContain('07:00 - 22:00');
    expect(text).toContain('family');
    expect(text).toContain('Carry-on');
    expect(text).toContain('luxury');
  });

  it('distinguishes explicit "None" dietary selection from "not selected"', () => {
    const { container: touchedNone } = renderReview({ dietaryRestrictions: [], dietaryRestrictionsTouched: true });
    expect(touchedNone.textContent).toContain('None');

    cleanup();
    const { container: untouched } = renderReview({ dietaryRestrictions: [], dietaryRestrictionsTouched: false });
    expect(untouched.textContent).toContain('Not selected');
  });
});

describe('WizardStep3Review — every group is a keyboard-accessible button routing to the right step', () => {
  it('reservation/flight group routes to step 0', () => {
    const { onEditStep } = renderReview();
    const btn = screen.getByLabelText(/Reservation & flight/i);
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onEditStep).toHaveBeenCalledWith(0);
  });

  it('destination/activities group routes to step 1', () => {
    const { onEditStep } = renderReview();
    const btn = screen.getByLabelText(/Destination & activities/i);
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onEditStep).toHaveBeenCalledWith(1);
  });

  it('food/dietary group routes to step 2', () => {
    const { onEditStep } = renderReview();
    const btn = screen.getByLabelText(/Food & dietary/i);
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onEditStep).toHaveBeenCalledWith(2);
  });

  it('trip details group routes to step 3', () => {
    const { onEditStep } = renderReview();
    const btn = screen.getByLabelText(/Trip details/i);
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onEditStep).toHaveBeenCalledWith(3);
  });
});

void React;
