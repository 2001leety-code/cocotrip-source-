/**
 * P183 phase 2 (2026-05-24): Gemini responseSchema — typed validation.
 *
 * 운영자 "회귀법칙도 해놨는데 그래도 못 잡네" 메타 — prompt-only 회귀 차단 한계.
 * Gemini API 의 responseSchema 로 typed JSON validation 강제. INVALID_JSON +
 * wrong-field / missing required 자동 reject (Gemini 측).
 *
 * 회귀 시: schema 빠지면 Gemini 가 lenient 출력 → 회귀 재발.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error JS module
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P183 phase 2 — Gemini responseSchema', () => {
  const geminiPath = resolve(__dirname, '../../api/_ai_core/geminiPipeline.js');
  const src = readFileSync(geminiPath, 'utf8');

  it('PLAN_RESPONSE_SCHEMA top-level OBJECT + days required', () => {
    expect(PLAN_RESPONSE_SCHEMA.type).toBe('OBJECT');
    expect(PLAN_RESPONSE_SCHEMA.required).toContain('days');
    expect(PLAN_RESPONSE_SCHEMA.properties.days.type).toBe('ARRAY');
  });

  it('days[] items = OBJECT with day + stops required', () => {
    const dayItem = PLAN_RESPONSE_SCHEMA.properties.days.items;
    expect(dayItem.type).toBe('OBJECT');
    expect(dayItem.required).toEqual(expect.arrayContaining(['day', 'stops']));
    expect(dayItem.properties.day.type).toBe('INTEGER');
    expect(dayItem.properties.stops.type).toBe('ARRAY');
  });

  it('stops[] items = OBJECT with name + category + start_time required', () => {
    const stopItem = PLAN_RESPONSE_SCHEMA.properties.days.items.properties.stops.items;
    expect(stopItem.type).toBe('OBJECT');
    expect(stopItem.required).toEqual(expect.arrayContaining(['name', 'category', 'start_time']));
  });

  it('stops 내 core typed field (lat/lng/stay_min)', () => {
    const props = PLAN_RESPONSE_SCHEMA.properties.days.items.properties.stops.items.properties;
    expect(props.name.type).toBe('STRING');
    expect(props.category.type).toBe('STRING');
    expect(props.start_time.type).toBe('STRING');
    expect(props.lat.type).toBe('NUMBER');
    expect(props.lng.type).toBe('NUMBER');
    expect(props.stay_min.type).toBe('INTEGER');
    expect(props.verified.type).toBe('BOOLEAN');
  });

  it('buildModel generationConfig 에 responseSchema 포함', () => {
    // source-level check — buildModel 의 generationConfig 안에 responseSchema 명시
    expect(src).toMatch(/responseSchema:\s*PLAN_RESPONSE_SCHEMA/);
    expect(src).toMatch(/P183 phase 2[\s\S]{0,200}typed validation/);
  });

  it('OpenAPI Subset 형식 (대문자 type) — Gemini API 요구', () => {
    // 모든 type 대문자 (OBJECT/ARRAY/STRING/INTEGER/NUMBER/BOOLEAN)
    const VALID_TYPES = new Set(['OBJECT', 'ARRAY', 'STRING', 'INTEGER', 'NUMBER', 'BOOLEAN']);
    function checkTypes(node: any, path = 'root') {
      if (!node || typeof node !== 'object') return;
      if (node.type) {
        expect(VALID_TYPES.has(node.type), `${path}.type = "${node.type}" must be uppercase OpenAPI Subset`).toBe(true);
      }
      if (node.properties) {
        for (const [k, v] of Object.entries(node.properties)) {
          checkTypes(v, `${path}.${k}`);
        }
      }
      if (node.items) checkTypes(node.items, `${path}[]`);
    }
    checkTypes(PLAN_RESPONSE_SCHEMA);
  });

  it('P185 — 모든 ARRAY 노드에 items 필수 (Gemini 3.5 Flash strict schema)', () => {
    // 회귀: daily_budget_summary 가 { type: 'ARRAY' } 단독 → admin-bypass (Flash) 500.
    // Pro (2.5) 는 lenient 통과지만 Flash (3.5) 는 strict reject.
    // GenerateContentRequest.generation_config.response_schema.properties[X].items: missing field
    const violations: string[] = [];
    function walk(node: any, path = 'root') {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ARRAY' && !node.items) {
        violations.push(path);
      }
      if (node.properties) {
        for (const [k, v] of Object.entries(node.properties)) {
          walk(v, `${path}.${k}`);
        }
      }
      if (node.items) walk(node.items, `${path}[]`);
    }
    walk(PLAN_RESPONSE_SCHEMA);
    expect(violations, `ARRAY without items: ${violations.join(', ')}`).toEqual([]);
  });

  it('P185 — daily_budget_summary 가 ARRAY of OBJECT 명시', () => {
    // 사용처 확인: planPersister.js selfHealDailyBudget 가 day.daily_budget_summary 를
    // OBJECT 로 채움 (food/attraction/transport/misc/total). 단, 본 schema 는
    // top-level itinerary.daily_budget_summary = ARRAY (per-day budgets) — prompt
    // buildPrompt.js:338 예시 "daily_budget_summary": [ { day, transport_krw, ... } ].
    const node = PLAN_RESPONSE_SCHEMA.properties.daily_budget_summary;
    expect(node.type).toBe('ARRAY');
    expect(node.items).toBeDefined();
    expect(node.items.type).toBe('OBJECT');
  });
});
