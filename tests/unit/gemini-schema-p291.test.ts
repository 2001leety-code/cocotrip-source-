/**
 * P291 (2026-05-29): PLAN_RESPONSE_SCHEMA properties hint 확장 회귀 차단.
 *
 * 박제 의무:
 *   - required 추가 X (P196 회귀 root cause = Flash "satisfy required, then stop")
 *   - propertyOrdering 명시 (Google docs schema/prompt mismatch 경고 회피)
 *   - buildPrompt.js JSON example 와 nested level 정확 일치
 *   - cache miss risk 0 (schema 는 generationConfig.responseSchema, prompt body 별개)
 *
 * 회귀 시: arrival_guide.steps / daily_budget_summary 통째 누락 → self_heal 의존 →
 *   사용자 personalize 0 (P276/P277 의도 손상).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';

describe('P291 PLAN_RESPONSE_SCHEMA properties hint 확장 (cache miss 0 대안)', () => {
  // ── top-level (P200 유지) ────────────────────────────────────────────────

  it('top-level required = days + arrival_guide + departure_guide (P200 유지)', () => {
    expect(PLAN_RESPONSE_SCHEMA.required).toEqual(['days', 'arrival_guide', 'departure_guide']);
  });

  it('top-level propertyOrdering 8 keys (buildPrompt 일치)', () => {
    expect(PLAN_RESPONSE_SCHEMA.propertyOrdering).toEqual([
      'tour_title', 'vehicle', 'base_price_krw',
      'arrival_guide', 'days', 'departure_guide',
      'daily_budget_summary', 't_money_recommended_load',
    ]);
  });

  // ── R1: arrival_guide.steps array hint ───────────────────────────────────

  it('R1 — arrival_guide.properties.steps array hint 존재', () => {
    const ag = PLAN_RESPONSE_SCHEMA.properties.arrival_guide;
    expect(ag.propertyOrdering).toEqual(['airport', 'steps']);
    expect(ag.properties.steps).toBeDefined();
    expect(ag.properties.steps.type).toBe('ARRAY');
    expect(ag.properties.steps.items.type).toBe('OBJECT');
  });

  it('R1 — arrival_guide.steps.items propertyOrdering 7 fields', () => {
    const stepsItems = PLAN_RESPONSE_SCHEMA.properties.arrival_guide.properties.steps.items;
    expect(stepsItems.propertyOrdering).toEqual([
      'step', 'title', 'description', 'est_min',
      't_money_card_cost_krw', 't_money_recommended_load_krw', 'recommended_cash_krw',
    ]);
    expect(stepsItems.properties.step.type).toBe('INTEGER');
    expect(stepsItems.properties.title.type).toBe('STRING');
    expect(stepsItems.properties.description.type).toBe('STRING');
    expect(stepsItems.properties.est_min.type).toBe('INTEGER');
  });

  it('R1 — arrival_guide / steps 의 required 추가 X (P196 회귀 root cause 회피)', () => {
    const ag = PLAN_RESPONSE_SCHEMA.properties.arrival_guide;
    expect(ag.required).toBeUndefined();
    expect(ag.properties.steps.items.required).toBeUndefined();
  });

  // ── R2: departure_guide 확장 ─────────────────────────────────────────────

  it('R2 — departure_guide.propertyOrdering 7 fields', () => {
    const dg = PLAN_RESPONSE_SCHEMA.properties.departure_guide;
    expect(dg.propertyOrdering).toEqual([
      'airport', 'recommended_departure_time', 'latest_leave_hotel',
      'luggage_storage', 'to_airport', 'tax_refund', 'last_minute_shopping',
    ]);
  });

  it('R2 — departure_guide.properties 3 nested OBJECT (luggage_storage / to_airport / tax_refund)', () => {
    const dg = PLAN_RESPONSE_SCHEMA.properties.departure_guide;
    expect(dg.properties.luggage_storage.type).toBe('OBJECT');
    expect(dg.properties.luggage_storage.propertyOrdering).toEqual(['available', 'location', 'price_krw']);
    expect(dg.properties.to_airport.type).toBe('OBJECT');
    expect(dg.properties.to_airport.propertyOrdering).toEqual(['method', 'instruction', 'cost_krw', 'duration_min']);
    expect(dg.properties.tax_refund.type).toBe('OBJECT');
    expect(dg.properties.tax_refund.propertyOrdering).toEqual(['threshold_krw', 'note']);
  });

  it('R2 — departure_guide / nested OBJECT 의 required 추가 X', () => {
    const dg = PLAN_RESPONSE_SCHEMA.properties.departure_guide;
    expect(dg.required).toBeUndefined();
    expect(dg.properties.luggage_storage.required).toBeUndefined();
    expect(dg.properties.to_airport.required).toBeUndefined();
    expect(dg.properties.tax_refund.required).toBeUndefined();
  });

  // ── R3: daily_budget_summary.items 확장 ──────────────────────────────────

  it('R3 — daily_budget_summary.items 6 NUMBER fields + day INTEGER', () => {
    const db = PLAN_RESPONSE_SCHEMA.properties.daily_budget_summary;
    expect(db.type).toBe('ARRAY');
    expect(db.items.type).toBe('OBJECT');
    expect(db.items.propertyOrdering).toEqual([
      'day', 'transport_krw', 'entry_fees_krw', 'meals_krw',
      'activities_krw', 'shopping_estimate_krw', 'total_krw',
    ]);
    expect(db.items.properties.day.type).toBe('INTEGER');
    expect(db.items.properties.transport_krw.type).toBe('NUMBER');
    expect(db.items.properties.entry_fees_krw.type).toBe('NUMBER');
    expect(db.items.properties.meals_krw.type).toBe('NUMBER');
    expect(db.items.properties.activities_krw.type).toBe('NUMBER');
    expect(db.items.properties.shopping_estimate_krw.type).toBe('NUMBER');
    expect(db.items.properties.total_krw.type).toBe('NUMBER');
  });

  it('R3 — daily_budget_summary.items required 추가 X', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.daily_budget_summary.items.required).toBeUndefined();
  });

  // ── R4: days.items 확장 ──────────────────────────────────────────────────

  it('R4 — days.items.propertyOrdering 7 keys (P200 required:[day,stops] 유지)', () => {
    const daysItems = PLAN_RESPONSE_SCHEMA.properties.days.items;
    expect(daysItems.propertyOrdering).toEqual([
      'day', 'date', 'city', 'theme', 'lodging', 'intercity_transit', 'stops',
    ]);
    expect(daysItems.required).toEqual(['day', 'stops']);
    expect(daysItems.properties.date.type).toBe('STRING');
  });

  it('R4 — days.items.lodging 4 fields + intercity_transit 5 fields nested 확장', () => {
    const daysItems = PLAN_RESPONSE_SCHEMA.properties.days.items;
    expect(daysItems.properties.lodging.propertyOrdering).toEqual(['name', 'address', 'check_in', 'check_out']);
    expect(daysItems.properties.lodging.properties.name.type).toBe('STRING');
    // B7 (P308): intercity_transit 필드명을 frontend/buildPrompt/RouteAgent 와 통일.
    // 이전 method/duration_min/cost_krw (P291 오명명) → mode/est_min/est_fare_krw.
    expect(daysItems.properties.intercity_transit.propertyOrdering).toEqual([
      'from_city', 'to_city', 'mode', 'est_min', 'est_fare_krw',
    ]);
    expect(daysItems.properties.intercity_transit.properties.est_min.type).toBe('INTEGER');
    expect(daysItems.properties.intercity_transit.properties.est_fare_krw.type).toBe('NUMBER');
    expect(daysItems.properties.intercity_transit.properties.mode.type).toBe('STRING');
  });

  it('R4 — lodging / intercity_transit 의 required 추가 X', () => {
    const daysItems = PLAN_RESPONSE_SCHEMA.properties.days.items;
    expect(daysItems.properties.lodging.required).toBeUndefined();
    expect(daysItems.properties.intercity_transit.required).toBeUndefined();
  });

  // ── R5: stops.items propertyOrdering ─────────────────────────────────────

  it('R5 — stops.items propertyOrdering 13 fields (P200 required:[name,category,start_time] 유지)', () => {
    // 2026-07-03 B-18 fix: local_tag 추가(12→13). responseSchema 에 없는 필드는 구조화출력이
    // 물리적으로 못 내서 프롬프트 LOCAL TAG MANDATORY 가 무력화됐었다 (5/24 이후 전 plan 0%).
    const stopsItems = PLAN_RESPONSE_SCHEMA.properties.days.items.properties.stops.items;
    expect(stopsItems.propertyOrdering).toEqual([
      'order', 'start_time', 'name', 'display_name', 'category',
      'stay_min', 'address', 'tip', 'local_tag', 'lat', 'lng', 'entry_fee_krw', 'verified',
    ]);
    expect(stopsItems.required).toEqual(['name', 'category', 'start_time']);
  });

  // ── 박제 의무 ────────────────────────────────────────────────────────────

  it('박제: P196 회귀 root cause 회피 — nested level required 확장 0', () => {
    // top-level 외 모든 nested 의 required 확장 X (P196 회귀 패턴 회피).
    // P200 의 days.items.required (day,stops) + stops.items.required (name,category,start_time) 만 유지.
    const ag = PLAN_RESPONSE_SCHEMA.properties.arrival_guide;
    const dg = PLAN_RESPONSE_SCHEMA.properties.departure_guide;
    const db = PLAN_RESPONSE_SCHEMA.properties.daily_budget_summary;
    expect(ag.required).toBeUndefined();
    expect(ag.properties.steps.items.required).toBeUndefined();
    expect(dg.required).toBeUndefined();
    expect(db.items.required).toBeUndefined();
    // P291 새로 추가된 nested 모두 required 확장 X
    expect(dg.properties.luggage_storage.required).toBeUndefined();
    expect(dg.properties.to_airport.required).toBeUndefined();
    expect(dg.properties.tax_refund.required).toBeUndefined();
    expect(PLAN_RESPONSE_SCHEMA.properties.days.items.properties.lodging.required).toBeUndefined();
    expect(PLAN_RESPONSE_SCHEMA.properties.days.items.properties.intercity_transit.required).toBeUndefined();
  });

  it('박제: cache miss risk 0 — schema 는 generationConfig.responseSchema (prompt body 별개)', () => {
    // schema 확장 = Gemini API generationConfig.responseSchema 변경.
    // prompt body (system + user message) 변경 0 → implicit cache prefix 변경 0 → P273 90% 할인 보존.
    // 본 test = schema 확장 후에도 schema 의 typeof 가 object (export 정상) 검증.
    expect(typeof PLAN_RESPONSE_SCHEMA).toBe('object');
    expect(PLAN_RESPONSE_SCHEMA.type).toBe('OBJECT');
  });
});
