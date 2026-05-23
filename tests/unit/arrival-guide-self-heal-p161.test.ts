/**
 * P161 (2026-05-23): arrival_guide self-heal.
 *
 * 사용자 신고 (plan 8e767d9c, 2026-05-23): Intro 다음 빈 영역 → arrival_guide 통째 누락.
 * 본 fix: arrival_airport 가 있고 ALREADY 아닌데 itinerary.arrival_guide 가 falsy 면
 * 기본 5-step (Immigration / SIM / T-money / Currency / Get-to-Hotel) skeleton 합성.
 *
 * postResponsePipeline.runRouteEnrichment 진입 직후 호출 — RouteAgent 가 step 5
 * transport_to_hotel 을 실제 ODsay 데이터로 덮어씀.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { selfHealArrivalGuide } from '../../api/_ai_core/planPersister.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

describe('P161 selfHealArrivalGuide', () => {
  it('arrival_guide 누락 + arrival_airport=ICN T1 → 5-step skeleton 합성', () => {
    const itinerary: Loose = { days: [] };
    const healed = selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(healed).toBe(true);
    expect(itinerary.arrival_guide).toBeDefined();
    expect(itinerary.arrival_guide.airport).toBe('ICN T1');
    expect(itinerary.arrival_guide.steps).toHaveLength(5);
    expect(itinerary.arrival_guide.steps[0].title).toMatch(/Immigration/i);
    expect(itinerary.arrival_guide.steps[1].title).toMatch(/SIM|Wi-?Fi|Connect/i);
    expect(itinerary.arrival_guide.steps[2].title).toMatch(/T-?money/i);
    expect(itinerary.arrival_guide.steps[3].title).toMatch(/Currency|Payment/i);
    expect(itinerary.arrival_guide.steps[4].title).toMatch(/Hotel|Transport/i);
    expect(itinerary.arrival_guide._self_healed).toBe(true);
  });

  it('5-step skeleton 의 SIM 옵션 3개 (Physical / Pocket Wi-Fi / eSIM)', () => {
    const itinerary: Loose = {};
    selfHealArrivalGuide(itinerary, 'ICN T2');
    const sim = itinerary.arrival_guide.steps[1];
    expect(sim.options).toHaveLength(3);
    const names = sim.options.map((o: { name: string }) => o.name).join(' ');
    expect(names).toMatch(/SIM/i);
    expect(names).toMatch(/Wi-?Fi/i);
    expect(names).toMatch(/eSIM/i);
  });

  it('T-money step 의 card_cost_krw = 4000', () => {
    const itinerary: Loose = {};
    selfHealArrivalGuide(itinerary, 'PUS');
    const tmoney = itinerary.arrival_guide.steps[2];
    expect(tmoney.t_money_card_cost_krw).toBe(4000);
    expect(tmoney.t_money_recommended_load_krw).toBe(0); // server fills
  });

  it('Currency step 의 recommended_cash_krw = 50000', () => {
    const itinerary: Loose = {};
    selfHealArrivalGuide(itinerary, 'GMP');
    const currency = itinerary.arrival_guide.steps[3];
    expect(currency.recommended_cash_krw).toBe(50000);
  });

  it('Get-to-Hotel step 의 transport_to_hotel 4 옵션 (AREX express/all_stop, 리무진, 택시)', () => {
    const itinerary: Loose = {};
    selfHealArrivalGuide(itinerary, 'ICN T1');
    const last = itinerary.arrival_guide.steps[4];
    expect(last.transport_to_hotel).toBeDefined();
    expect(last.transport_to_hotel.arex_express).toBeDefined();
    expect(last.transport_to_hotel.arex_all_stop).toBeDefined();
    expect(last.transport_to_hotel.limousine_bus).toBeDefined();
    expect(last.transport_to_hotel.taxi).toBeDefined();
  });

  it('arrival_airport = "ALREADY" → no-op (이미 한국 체류)', () => {
    const itinerary: Loose = {};
    const healed = selfHealArrivalGuide(itinerary, 'ALREADY');
    expect(healed).toBe(false);
    expect(itinerary.arrival_guide).toBeUndefined();
  });

  it('arrival_airport = "already_in_korea" → no-op', () => {
    const itinerary: Loose = {};
    const healed = selfHealArrivalGuide(itinerary, 'already_in_korea');
    expect(healed).toBe(false);
    expect(itinerary.arrival_guide).toBeUndefined();
  });

  it('arrival_airport 빈 값 → no-op', () => {
    const itinerary: Loose = {};
    expect(selfHealArrivalGuide(itinerary, '')).toBe(false);
    expect(selfHealArrivalGuide(itinerary, null)).toBe(false);
    expect(selfHealArrivalGuide(itinerary, undefined)).toBe(false);
    expect(itinerary.arrival_guide).toBeUndefined();
  });

  it('arrival_guide 이미 있고 steps 1+ 면 no-op (Gemini 정상 응답)', () => {
    const itinerary: Loose = {
      arrival_guide: {
        airport: 'ICN T1',
        steps: [{ step: 1, title: '실제 Gemini 응답', est_min: 35 }],
      },
    };
    const healed = selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(healed).toBe(false);
    expect(itinerary.arrival_guide.steps).toHaveLength(1);
    expect(itinerary.arrival_guide.steps[0].title).toBe('실제 Gemini 응답');
  });

  it('arrival_guide 빈 객체 (steps 미정) → self-heal 발동', () => {
    const itinerary: Loose = { arrival_guide: { airport: 'ICN T1' } };
    const healed = selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(healed).toBe(true);
    expect(itinerary.arrival_guide.steps).toHaveLength(5);
  });

  it('arrival_guide.steps = [] (빈 배열) → self-heal 발동', () => {
    const itinerary: Loose = { arrival_guide: { airport: 'ICN T1', steps: [] } };
    const healed = selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(healed).toBe(true);
    expect(itinerary.arrival_guide.steps).toHaveLength(5);
  });

  it('quality_warnings 박제 — kind/type/message 모두 채워짐 (P161 undefined 회귀 차단)', () => {
    const itinerary: Loose = {};
    selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(itinerary.quality_warnings).toHaveLength(1);
    const w = itinerary.quality_warnings[0];
    expect(w.kind).toBe('arrival_guide_self_healed');
    expect(w.type).toBe('arrival_guide_self_healed');
    expect(w.severity).toBe('medium');
    expect(w.airport).toBe('ICN T1');
    expect(typeof w.message).toBe('string');
    expect(w.message.length).toBeGreaterThan(0);
    expect(w.message).toContain('ICN T1');
  });

  it('기존 quality_warnings 보존', () => {
    const itinerary: Loose = {
      quality_warnings: [{ kind: 'existing', message: '기존 warning' }],
    };
    selfHealArrivalGuide(itinerary, 'GMP');
    expect(itinerary.quality_warnings).toHaveLength(2);
    expect(itinerary.quality_warnings[0].kind).toBe('existing');
    expect(itinerary.quality_warnings[1].kind).toBe('arrival_guide_self_healed');
  });

  it('itinerary null/undefined → false (graceful)', () => {
    expect(selfHealArrivalGuide(null, 'ICN T1')).toBe(false);
    expect(selfHealArrivalGuide(undefined, 'ICN T1')).toBe(false);
  });
});
