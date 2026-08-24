// @vitest-environment jsdom
//
// Parity (2026-08-24, planner-trust-course): drives the REAL WizardForm state
// (via its real setters, exposed through thin step stubs) through a fully
// populated trip, mounts the REAL WizardStep3Review at step 4, and checks
// that what Review displays and what handleGenerate actually submits agree —
// both consumers read the same state, so a real divergence bug (Review
// showing X while the request sends Y) would fail this test. Not a source
// grep, not a snapshot of props handed to Review — both sides are read from
// actual rendered/submitted output.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

vi.hoisted(() => {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
});

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { planner: {} }, language: 'en' }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/notify', () => ({ requestNotifyPermission: vi.fn() }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/useWizardPersistence', () => ({
  useWizardPersistence: () => ({ clear: vi.fn() }),
  loadFreshestWizardSnapshot: () => null,
  clearWizardSnapshot: vi.fn(),
  clearPlannerWizardSnapshot: vi.fn(),
  markWizardDirtyExit: vi.fn(),
}));
vi.mock('@/components/ResumeWizardModal', () => ({ ResumeWizardModal: () => null }));
vi.mock('../../src/components/WizardForm/WizardStepHint', () => ({ WizardStepHint: () => null }));

// Steps 0-2 are stubbed with buttons wired directly to WizardForm's REAL
// setters/togglers (the same functions production step components call) —
// only the visual chip/calendar/drawer UI is replaced, not the state logic.
// WizardStep3Review (the thing under test) is the REAL component.
vi.mock('../../src/components/WizardForm/WizardStep0Reservation', () => ({
  WizardStep0Reservation: (props: Record<string, unknown>) => {
    const setStatus = props.setStatus as (v: string) => void;
    const setArrivalAirport = props.setArrivalAirport as (v: string) => void;
    const setArrivalTime = props.setArrivalTime as (v: string) => void;
    const onNext = props.onNext as () => void;
    return (
      <div>
        <button type="button" onClick={() => setStatus('flight')}>set-status</button>
        <button type="button" onClick={() => setArrivalAirport('ICN_T1')}>set-airport</button>
        <button type="button" onClick={() => setArrivalTime('09:15')}>set-time</button>
        <button type="button" onClick={onNext}>next0</button>
      </div>
    );
  },
}));
vi.mock('../../src/components/WizardForm/WizardStep0Destination', () => ({
  WizardStep0Destination: (props: Record<string, unknown>) => {
    const setMainCity = props.setMainCity as (v: string) => void;
    const setMainCityKey = props.setMainCityKey as (v: string) => void;
    const setSelectedActivities = props.setSelectedActivities as (v: string[]) => void;
    const setFreeText = props.setFreeText as (v: string) => void;
    const onNext = props.onNext as () => void;
    return (
      <div>
        <button type="button" onClick={() => { setMainCity('Seoul'); setMainCityKey('seoul'); }}>set-city</button>
        <button type="button" onClick={() => setSelectedActivities(['Kpop', 'Food'])}>set-activities</button>
        <button type="button" onClick={() => setFreeText('Cherry blossoms please')}>set-freetext</button>
        <button type="button" onClick={onNext}>next1</button>
      </div>
    );
  },
}));
vi.mock('../../src/components/WizardForm/WizardStep1Food', () => ({
  WizardStep1Food: (props: Record<string, unknown>) => {
    const toggleDiet = props.toggleDiet as (k: string) => void;
    const toggleDietaryRestriction = props.toggleDietaryRestriction as (k: string) => void;
    const setPriceRange = props.setPriceRange as (v: string) => void;
    const setSpiceLevel = props.setSpiceLevel as (v: string) => void;
    const toggleBucketDish = props.toggleBucketDish as (k: string) => void;
    const onNext = props.onNext as () => void;
    return (
      <div>
        <button type="button" onClick={() => toggleDiet('Seafood')}>set-diet</button>
        <button type="button" onClick={() => toggleDietaryRestriction('Vegan')}>set-restriction</button>
        <button type="button" onClick={() => setPriceRange('Premium')}>set-price</button>
        <button type="button" onClick={() => setSpiceLevel('mild')}>set-spice</button>
        <button type="button" onClick={() => toggleBucketDish('bibimbap')}>set-bucket</button>
        <button type="button" onClick={onNext}>next2</button>
      </div>
    );
  },
}));
vi.mock('../../src/components/WizardForm/WizardStep2Details', () => ({
  WizardStep2Details: (props: Record<string, unknown>) => {
    const setDateRange = props.setDateRange as (r: { from: Date; to: Date }) => void;
    const setPaxInput = props.setPaxInput as (v: string) => void;
    const setArrivalTerminal = props.setArrivalTerminal as (v: string) => void;
    const setDepartureTerminal = props.setDepartureTerminal as (v: string) => void;
    const setHotelAddress = props.setHotelAddress as (v: string) => void;
    const setTourPace = props.setTourPace as (v: string) => void;
    const setCompanions = props.setCompanions as (v: string) => void;
    const setLuggageSmall = props.setLuggageSmall as (v: number) => void;
    const setWantAccom = props.setWantAccom as (v: boolean) => void;
    const setAccomBudget = props.setAccomBudget as (v: string) => void;
    const onNext = props.onNext as () => void;
    return (
      <div>
        <button type="button" onClick={() => setDateRange({ from: new Date(2099, 0, 10), to: new Date(2099, 0, 15) })}>set-dates</button>
        <button type="button" onClick={() => setPaxInput('4')}>set-pax</button>
        <button type="button" onClick={() => setArrivalTerminal('ICN_T1')}>set-arrival-airport</button>
        <button type="button" onClick={() => setDepartureTerminal('GMP')}>set-departure-airport</button>
        <button type="button" onClick={() => setHotelAddress('Lotte Hotel Myeongdong')}>set-hotel</button>
        <button type="button" onClick={() => setTourPace('action')}>set-pace</button>
        <button type="button" onClick={() => setCompanions('family')}>set-companions</button>
        <button type="button" onClick={() => setLuggageSmall(2)}>set-luggage</button>
        <button type="button" onClick={() => { setWantAccom(true); setAccomBudget('luxury'); }}>set-accom</button>
        <button type="button" onClick={onNext}>next3</button>
      </div>
    );
  },
}));

const { WizardForm } = await import('../../src/components/WizardForm');

void React;
afterEach(cleanup);

async function flushLazy() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function click(container: HTMLElement, text: string) {
  const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  fireEvent.click(btn);
}

describe('WizardForm — Review display and onSubmit payload agree (real state, real Review)', () => {
  it('reaches Review with the same values handleGenerate submits', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const { container } = render(<WizardForm onSubmit={onSubmit} isLoading={false} />);
    await flushLazy();

    click(container, 'set-status');
    click(container, 'set-airport');
    click(container, 'set-time');
    click(container, 'next0');
    await flushLazy();

    click(container, 'set-city');
    click(container, 'set-activities');
    click(container, 'set-freetext');
    click(container, 'next1');
    await flushLazy();

    click(container, 'set-diet');
    click(container, 'set-restriction');
    click(container, 'set-price');
    click(container, 'set-spice');
    click(container, 'set-bucket');
    click(container, 'next2');
    await flushLazy();

    click(container, 'set-dates');
    click(container, 'set-pax');
    click(container, 'set-arrival-airport');
    click(container, 'set-departure-airport');
    click(container, 'set-hotel');
    click(container, 'set-pace');
    click(container, 'set-companions');
    click(container, 'set-luggage');
    click(container, 'set-accom');
    click(container, 'next3');
    await waitFor(() => {
      expect(container.textContent || '').toContain('Flight booked');
    });

    // --- Review (real component) shows the same values ---
    const text = container.textContent || '';
    expect(text).toContain('Flight booked');
    expect(text).toContain('ICN T1');
    expect(text).toContain('09:15');
    expect(text).toContain('Seoul');
    expect(text).toContain('Kpop, Food');
    expect(text).toContain('Cherry blossoms please');
    expect(text).toContain('Seafood');
    expect(text).toContain('Vegan');
    expect(text).toContain('Premium');
    expect(text).toContain('mild');
    expect(text).toContain('bibimbap');
    expect(text).toContain('4 pax');
    expect(text).toContain('Gimpo');
    expect(text).toContain('Lotte Hotel Myeongdong');
    expect(text).toContain('action');
    expect(text).toContain('family');
    expect(text).toContain('luxury');

    // --- trigger the real free-preview submit from Review ---
    const generateBtn = container.querySelector('.ec-btn-primary') as HTMLButtonElement;
    expect(generateBtn).toBeTruthy();
    await act(async () => { fireEvent.click(generateBtn); });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;

    // --- the actual submitted payload matches what Review displayed ---
    expect(payload.startDate).toBe('2099-01-10');
    expect(payload.endDate).toBe('2099-01-15');
    expect(payload.regions).toEqual(['Seoul']);
    expect(payload.categories).toEqual(['Kpop', 'Food']);
    expect(payload.pax).toBe(4);
    expect(payload.arrival_airport).toBe('ICN_T1');
    expect(payload.departure_airport).toBe('GMP');
    expect(payload.hotel_address).toBe('Lotte Hotel Myeongdong');
    expect(payload.reservation_status).toBe('flight');
    expect(payload.freeText).toBe('Cherry blossoms please');
    expect(payload.dietPrefs).toEqual(['Seafood']);
    expect(payload.dietaryRestrictions).toEqual(['Vegan']);
    expect(payload.priceRange).toBe('Premium');
    expect(payload.spiceLevel).toBe('mild');
    expect(payload.bucketDishes).toEqual(['bibimbap']);
    expect(payload.tourPace).toBe('action');
    expect(payload.companions).toBe('family');
    expect(payload.accomBudget).toBe('luxury');
    expect(payload.luggage).toEqual({ small: 2, medium: 0, large: 0 });
  });
});
