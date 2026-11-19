// @vitest-environment jsdom
//
// 2026-11-19: what the traveller sees for the charter-first rule — arrival / departure charter card,
// the airport → lodging guide at dawn, and the always-visible WhatsApp night line.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ArrivalGuide } from '../../src/pages/PlanDetailPage/components/ArrivalGuide';
import { DepartureGuide } from '../../src/pages/PlanDetailPage/components/DepartureGuide';
import { AirportToLodgingGuide } from '../../src/pages/PlanDetailPage/components/AirportToLodgingGuide';
import { TransitArrow } from '../../src/pages/PlanDetailPage/components/TransitArrow';

void React;

let lang = 'en';
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: lang, t: { planDetail: { ui: {}, transit: {} } }, changeLanguage: () => {} }),
}));
vi.mock('@/lib/analytics', () => ({ trackAdClick: () => {} }));

const charter = { key: 'cocotrip_charter', reason_en: 'Late-night arrival — book a charter', dawn: true, cta_link: '/charter' };
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('charter card on failed routes', () => {
  it('arrival: a charter pick on a failed route still shows the charter card', () => {
    wrap(<ArrivalGuide guide={{ airport: 'ICN', route_to_hotel: { _failed: true, method: 'unknown', recommended_option: charter } as never }} />);
    expect(screen.getByText('CocoTrip Private Charter')).toBeTruthy();
    expect(screen.getByText(/Late-night arrival — book a charter/)).toBeTruthy();
  });
  it('arrival: a non-charter pick on a failed route stays hidden (no "undefined min")', () => {
    wrap(<ArrivalGuide guide={{ airport: 'ICN', route_to_hotel: { _failed: true, method: 'unknown', recommended_option: { key: 'taxi' } } as never }} />);
    expect(screen.queryByText('CocoTrip Private Charter')).toBeNull();
  });
  it('arrival: dawn taxi pick on a transit route → no transit steps under "Taxi"', () => {
    const route = { method: 'subway', est_min: 77, est_fare_krw: 3000, step_by_step: ['Line 9 to Express Bus Terminal'], recommended_option: { key: 'taxi', reason_en: 'Take a taxi' } };
    wrap(<ArrivalGuide guide={{ airport: 'TAE', route_to_hotel: route as never }} />);
    expect(screen.getByText('Taxi')).toBeTruthy();
    expect(screen.queryByText(/Line 9 to Express Bus Terminal/)).toBeNull();
  });
  it('departure: dawn charter pick → charter card, airport bus card hidden', () => {
    const plan = { input: { hotel_address: '명동 호텔' } } as never;
    wrap(<DepartureGuide guide={{ airport: 'ICN', route_to_airport: { _failed: true, recommended_option: charter } } as never} plan={plan} />);
    expect(screen.getByText('CocoTrip Private Charter')).toBeTruthy();
    expect(screen.queryByText(/Airport Bus \(Direct\)/)).toBeNull();
  });
  it('departure: no charter pick → bus card as before', () => {
    const plan = { input: { hotel_address: '명동 호텔' } } as never;
    wrap(<DepartureGuide guide={{ airport: 'ICN', route_to_airport: { _failed: true } } as never} plan={plan} />);
    expect(screen.queryByText('CocoTrip Private Charter')).toBeNull();
    expect(screen.getByText(/Airport Bus \(Direct\)/)).toBeTruthy();
  });
});

describe('airport → lodging guide', () => {
  const base = { arrival_airport: 'ICN', hotel_address: 'Myeongdong', pax: 2, luggage: { large: 1, small: 1 } };
  it('23:50 landing → dawn banner, trains/buses marked not running', () => {
    lang = 'en';
    wrap(<AirportToLodgingGuide plan={{ input: { ...base, arrival_time: '23:50' } } as never} />);
    expect(screen.getByText(/Late-night arrival/)).toBeTruthy();
    expect(screen.getAllByText('Not running by the time you clear immigration.')).toHaveLength(2);
  });
  it('14:00 landing, 2 people → no dawn banner, AREX note as before', () => {
    lang = 'en';
    wrap(<AirportToLodgingGuide plan={{ input: { ...base, arrival_time: '14:00' } } as never} />);
    expect(screen.queryByText(/Late-night arrival/)).toBeNull();
    expect(screen.getByText(/Best value for light luggage/)).toBeTruthy();
  });
  it('4 people by day → heavy banner (taxi seats 4)', () => {
    lang = 'en';
    wrap(<AirportToLodgingGuide plan={{ input: { ...base, pax: 4, arrival_time: '14:00' } } as never} />);
    expect(screen.getByText(/Korean taxis seat 4/)).toBeTruthy();
    expect(screen.getByText(/1 vehicle recommended/)).toBeTruthy();
  });
  it('dawn at an airport with no CocoTrip pickup → taxi banner, no charter pick', () => {
    lang = 'en';
    wrap(<AirportToLodgingGuide plan={{ input: { ...base, arrival_airport: 'TAE', arrival_time: '23:50' } } as never} />);
    expect(screen.getByText(/Take a taxi\./)).toBeTruthy();
    expect(screen.queryByText(/waits for you/)).toBeNull();
  });
  it('Korean at dawn → dawn line', () => {
    lang = 'ko';
    wrap(<AirportToLodgingGuide plan={{ input: { ...base, arrival_time: '23:50' } } as never} />);
    expect(screen.getByText(/7~9인승 코코트립 차량/)).toBeTruthy();
    lang = 'en';
  });
});

describe('WhatsApp night line', () => {
  it('TransitArrow shows night_contact as a visible link', () => {
    render(<TransitArrow transit={{ method: 'taxi', est_min: 20, night_contact: { text: 'Message CocoTrip on WhatsApp', url: 'https://wa.me/821087140611' } } as never} />);
    const a = screen.getByText('Message CocoTrip on WhatsApp').closest('a');
    expect(a?.getAttribute('href')).toBe('https://wa.me/821087140611');
  });
});
