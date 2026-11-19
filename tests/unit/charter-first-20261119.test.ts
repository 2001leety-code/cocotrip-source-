/**
 * 2026-11-19 (operator): a CocoTrip charter (7–9 seat Staria) over a taxi (4 seats) at dawn and for
 * groups; night legs with no transit point to WhatsApp (no reply in 20 minutes = no car, take a taxi).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isDawnMin, isLateNightLegMin, needsCharterForGroup, COCOTRIP_WHATSAPP_URL, NIGHT_WHATSAPP_REPLY_MIN,
} from '../../src/lib/charterFirst.js';
import {
  pickRecommendedTransport, pickDepartureTransport, nightContact, buildBookendFallbackLeg, airportTransferPriceKRW,
} from '../../api/_ai_core/agents/RouteAgent.js';
import { legLeavingMin } from '../../api/_shared/nightBusLeg.js';

const hm = (h: number, m = 0) => h * 60 + m;
const SPEC = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_pricing_spec.json'), 'utf8'));
const ATP = SPEC.airport_transfer_prices as Record<string, { priceKRW: number }>;

describe('charterFirst windows', () => {
  it('dawn = 23:00–04:59, wraps both ways', () => {
    expect(isDawnMin(hm(22, 59))).toBe(false);
    expect(isDawnMin(hm(23))).toBe(true);
    expect(isDawnMin(hm(4, 59))).toBe(true);
    expect(isDawnMin(hm(5))).toBe(false);
    expect(isDawnMin(-60)).toBe(true); // 23:00 the day before
    expect(isDawnMin(hm(25))).toBe(true); // 01:00 next day
    expect(isDawnMin(NaN)).toBe(false);
    expect(isDawnMin(null as unknown as number)).toBe(false);
  });
  it('late-night leg = 22:00–04:59', () => {
    expect(isLateNightLegMin(hm(21, 59))).toBe(false);
    expect(isLateNightLegMin(hm(22))).toBe(true);
    expect(isLateNightLegMin(hm(4, 59))).toBe(true);
    expect(isLateNightLegMin(hm(5))).toBe(false);
  });
});

describe('needsCharterForGroup', () => {
  it('4+ people or luggage beyond a sedan trunk', () => {
    expect(needsCharterForGroup({ pax: 4 })).toBe(true);
    expect(needsCharterForGroup({ pax: 3, luggage: { large: 1, medium: 1 } })).toBe(false);
    expect(needsCharterForGroup({ pax: 2, luggage: { large: 3 } })).toBe(true);
    expect(needsCharterForGroup({ pax: 3, luggage: { large: 1, medium: 2 } })).toBe(true);
    expect(needsCharterForGroup({ pax: 2, luggage: { small: 8 } })).toBe(true);
    expect(needsCharterForGroup({ pax: 2, luggage: { small: 7 } })).toBe(false);
    expect(needsCharterForGroup({})).toBe(false);
    expect(needsCharterForGroup({ pax: NaN, luggage: null })).toBe(false);
  });
});

describe('pickRecommendedTransport — arrival', () => {
  const prev = process.env.FEATURE_CHARTER_HERO_PRICE;
  beforeEach(() => { delete process.env.FEATURE_CHARTER_HERO_PRICE; });
  afterEach(() => {
    if (prev === undefined) delete process.env.FEATURE_CHARTER_HERO_PRICE;
    else process.env.FEATURE_CHARTER_HERO_PRICE = prev;
  });
  const light = { luggage: { large: 1, small: 1 }, paxCount: 2 };

  it('dawn leave where we run airport transfers → charter (dawn), never the limousine bus', () => {
    const rec = pickRecommendedTransport({ ...light, arrivalTimeHHMM: '23:50', leaveHHMM: '01:20', region: 'seoul' });
    expect(rec.key).toBe('cocotrip_charter');
    expect(rec.dawn).toBe(true);
    expect(rec.reason_ko).toMatch(/7~9인승/);
  });
  it('dawn leave in any region (operator: the van runs anywhere) → charter, price line only where priced', () => {
    for (const region of ['gwangju', 'daegu', null]) {
      const rec = pickRecommendedTransport({ ...light, arrivalTimeHHMM: '23:50', leaveHHMM: '01:20', region, airportKey: 'TAE' });
      expect(rec.key).toBe('cocotrip_charter');
      expect(rec.dawn).toBe(true);
    }
  });
  it('leave time wins over landing time; landing stands in when leave is missing', () => {
    expect(pickRecommendedTransport({ ...light, arrivalTimeHHMM: '21:40', leaveHHMM: '23:10', region: 'busan' }).key).toBe('cocotrip_charter');
    expect(pickRecommendedTransport({ ...light, arrivalTimeHHMM: '21:40', region: 'busan' }).key).toBe('arex_express');
    expect(pickRecommendedTransport({ ...light, arrivalTimeHHMM: '23:30', region: 'busan' }).key).toBe('cocotrip_charter');
  });
  it('day arrival, 2 people → AREX; 4 people → charter (group reason, not dawn)', () => {
    expect(pickRecommendedTransport({ ...light, arrivalTimeHHMM: '14:00', leaveHHMM: '15:30', region: 'seoul' }).key).toBe('arex_express');
    const rec = pickRecommendedTransport({ luggage: { medium: 2, small: 2 }, paxCount: 4, arrivalTimeHHMM: '14:00', leaveHHMM: '15:30', region: 'seoul' });
    expect(rec.key).toBe('cocotrip_charter');
    expect(rec.dawn).toBeUndefined();
    expect(rec.reason_en).toMatch(/seats 4/);
  });
  it('no time at all → AREX (unchanged)', () => {
    expect(pickRecommendedTransport({ ...light, arrivalTimeHHMM: '9:30 ', region: 'seoul' }).key).toBe('arex_express');
  });
});

describe('pickDepartureTransport — hotel → airport', () => {
  it('dawn leave in a charter region → charter (dawn)', () => {
    const rec = pickDepartureTransport({ leaveHHMM: '04:30', paxCount: 2, region: 'busan' });
    expect(rec?.key).toBe('cocotrip_charter');
    expect(rec?.dawn).toBe(true);
  });
  it('group → charter; small daytime party → null (card shows transit as before)', () => {
    expect(pickDepartureTransport({ leaveHHMM: '15:00', paxCount: 4, region: 'seoul' })?.key).toBe('cocotrip_charter');
    expect(pickDepartureTransport({ leaveHHMM: '15:00', paxCount: 2, region: 'seoul' })).toBeNull();
  });
  it('any region, any airport (operator: the van runs anywhere)', () => {
    expect(pickDepartureTransport({ leaveHHMM: '04:30', paxCount: 2, region: 'gwangju' })?.key).toBe('cocotrip_charter');
    expect(pickDepartureTransport({ leaveHHMM: '04:30', paxCount: 2, region: null })?.key).toBe('cocotrip_charter');
    expect(pickDepartureTransport({ leaveHHMM: '15:00', paxCount: 4, region: 'gwangju', airportKey: 'KWJ' })?.key).toBe('cocotrip_charter');
  });
  it('review must-fix: a group leaving at dawn gets dawn: true (airport-bus card hidden)', () => {
    expect(pickDepartureTransport({ leaveHHMM: '01:30', paxCount: 4, region: 'seoul' })?.dawn).toBe(true);
    expect(pickDepartureTransport({ leaveHHMM: '15:00', paxCount: 4, region: 'seoul' })?.dawn).toBeUndefined();
    expect(pickRecommendedTransport({ leaveHHMM: '01:30', paxCount: 4, region: 'gwangju' }).dawn).toBe(true);
  });
});

describe('airportTransferPriceKRW by airport (review: Busan via PUS showed the ICN 660,000 price)', () => {
  it('ICN zones only for ICN; GMP / PUS / CJU have their own; other airports → null', () => {
    expect(airportTransferPriceKRW('busan', 'PUS')).toBe(ATP['busan-metro'].priceKRW);
    expect(airportTransferPriceKRW('busan', 'ICN_T2')).toBe(ATP['busan'].priceKRW);
    expect(airportTransferPriceKRW('seoul_city', 'GMP')).toBe(ATP['gimpo-seoul-central'].priceKRW);
    expect(airportTransferPriceKRW('jeju', 'CJU')).toBe(ATP['jeju-metro'].priceKRW);
    expect(airportTransferPriceKRW('jeju', 'ICN')).toBeNull();
    expect(airportTransferPriceKRW('suwon', 'GMP')).toBeNull();
    expect(airportTransferPriceKRW('seoul', 'TAE')).toBeNull();
    expect(airportTransferPriceKRW('busan')).toBe(ATP['busan'].priceKRW); // no airport → as before
  });
  it('departure pick (flag on) prices the departure airport and sets no prefill origin', () => {
    const prev = process.env.FEATURE_CHARTER_HERO_PRICE;
    process.env.FEATURE_CHARTER_HERO_PRICE = 'true';
    try {
      const rec = pickDepartureTransport({ leaveHHMM: '04:00', paxCount: 2, region: 'busan', airportKey: 'PUS' });
      expect(rec?.est_price_krw).toBe(ATP['busan-metro'].priceKRW);
      expect(rec?.cta_link).not.toContain('origin=');
    } finally {
      if (prev === undefined) delete process.env.FEATURE_CHARTER_HERO_PRICE; else process.env.FEATURE_CHARTER_HERO_PRICE = prev;
    }
  });
});

describe('night WhatsApp contact', () => {
  it('4 languages, 20-minute rule, CocoTrip WhatsApp link; unknown language → English', () => {
    expect(NIGHT_WHATSAPP_REPLY_MIN).toBe(20);
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const c = nightContact(lang);
      expect(c.url).toBe(COCOTRIP_WHATSAPP_URL);
      expect(c.text).toMatch(/20/);
      expect(c.text).not.toMatch(/wa\.me/);
    }
    expect(nightContact('ko').text).toMatch(/왓츠앱/);
    expect(nightContact('fr').text).toBe(nightContact('en').text);
  });
  it('fallback leg: taxi distance at night gets the contact; walk or daytime does not', () => {
    const far = { fromLat: 37.5665, fromLng: 126.978, toLat: 37.5172, toLng: 127.0473, fromLabel: 'Hotel', toLabel: 'Gangnam', language: 'en' };
    expect(buildBookendFallbackLeg({ ...far, night: true })?.night_contact?.url).toBe(COCOTRIP_WHATSAPP_URL);
    expect(buildBookendFallbackLeg({ ...far })?.night_contact).toBeUndefined();
    const near = { ...far, toLat: 37.567, toLng: 126.979 };
    expect(buildBookendFallbackLeg({ ...near, night: true })?.night_contact).toBeUndefined();
  });
  it('leg leaving time: last stop start + stay, or next start − assumed leg', () => {
    expect(legLeavingMin({ start_time: '21:30', stay_min: 60 }, {})).toBe(hm(22, 30));
    expect(isLateNightLegMin(legLeavingMin({ start_time: '21:30', stay_min: 60 }, {}))).toBe(true);
    expect(legLeavingMin({}, { start_time: '09:00' })).toBe(hm(8));
  });
  it('RouteAgent wires the night flag into every fallback leg (hotel legs + station legs)', () => {
    const src = readFileSync(resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'), 'utf8');
    expect(src.match(/night: isLateNightLegMin\(legLeavingMin\(/g)?.length).toBe(4);
  });
});
