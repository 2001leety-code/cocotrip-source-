/**
 * P288 (2026-05-29): selfHealArrivalGuide personalize 회귀 차단.
 *
 * P276+P277 (PR #695 → revert #696) lesson: buildPrompt 변경 = Gemini cache miss + 504 timeout risk.
 *
 * P288 대안: Gemini prompt 변경 0 (cache miss risk 0). backend self_heal 시 user input 으로
 *   step 5 description personalize (hotel/zone 명 + late-night arrival hint).
 *
 * 회귀 시: self_heal 시 generic 'your hotel' default → 사용자 personalize 없음.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selfHealArrivalGuide } from '../../api/_ai_core/planPersister.js';

describe('P288 selfHealArrivalGuide personalize (Gemini prompt 변경 X)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/planPersister.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — P288 ctx 인자 추가 (hotel_address / recommendedZone / arrival_time)', () => {
    expect(src).toMatch(/selfHealArrivalGuide\(itinerary,\s*arrival_airport,\s*ctx\s*=\s*\{\}\)/);
    expect(src).toContain('P288');
    expect(src).toContain('hotelLabel');
    expect(src).toContain('lateNightHint');
  });

  it('source — postResponsePipeline 가 ctx 전달', () => {
    const postSrcPath = resolve(__dirname, '../../api/_ai_core/postResponsePipeline.js');
    const postSrc = readFileSync(postSrcPath, 'utf8');
    expect(postSrc).toMatch(/selfHealArrivalGuide\(itinerary,\s*arrival_airport,\s*\{/);
    expect(postSrc).toContain('P288');
  });

  // ── runtime ────────────────────────────────────────────────────────────────

  it('runtime — hotel_address 전달 시 step 5 description 에 hotel 명 포함', () => {
    const itinerary = {};
    selfHealArrivalGuide(itinerary, 'ICN T1', {
      hotel_address: '명동 롯데호텔',
      recommendedZone: null,
      arrival_time: '14:30',
    });
    const step5 = itinerary.arrival_guide.steps.find((s) => s.step === 5);
    expect(step5.description).toContain('명동 롯데호텔');
    expect(step5.description).toContain('ICN T1');
  });

  it('runtime — recommendedZone fallback (hotel_address 없음)', () => {
    const itinerary = {};
    selfHealArrivalGuide(itinerary, 'GMP', {
      hotel_address: '',
      recommendedZone: 'myeongdong',
      arrival_time: '10:00',
    });
    const step5 = itinerary.arrival_guide.steps.find((s) => s.step === 5);
    expect(step5.description).toContain('myeongdong');
    expect(step5.description).toContain('GMP');
  });

  it('runtime — 둘 다 없으면 "your hotel" default (회귀 차단)', () => {
    const itinerary = {};
    selfHealArrivalGuide(itinerary, 'ICN T2', {});
    const step5 = itinerary.arrival_guide.steps.find((s) => s.step === 5);
    expect(step5.description).toContain('your hotel');
    expect(step5.description).toContain('ICN T2');
  });

  it('runtime — late-night arrival (23:00+) hint 추가', () => {
    const itinerary = {};
    selfHealArrivalGuide(itinerary, 'ICN T1', {
      hotel_address: '명동 롯데호텔',
      arrival_time: '23:15',
    });
    const step5 = itinerary.arrival_guide.steps.find((s) => s.step === 5);
    expect(step5.description).toContain('Late-night arrival');
    expect(step5.description).toContain('taxi');
  });

  it('runtime — early-morning arrival (00:00-04:59) hint 추가', () => {
    const itinerary = {};
    selfHealArrivalGuide(itinerary, 'ICN T1', {
      hotel_address: '명동 롯데호텔',
      arrival_time: '02:30',
    });
    const step5 = itinerary.arrival_guide.steps.find((s) => s.step === 5);
    expect(step5.description).toContain('Late-night arrival');
  });

  it('runtime — 낮 도착 (09:00-22:59) hint 없음', () => {
    const itinerary = {};
    selfHealArrivalGuide(itinerary, 'ICN T1', {
      hotel_address: '명동 롯데호텔',
      arrival_time: '14:30',
    });
    const step5 = itinerary.arrival_guide.steps.find((s) => s.step === 5);
    expect(step5.description).not.toContain('Late-night');
  });

  it('runtime — ctx 없음 (backward compat) → graceful default', () => {
    const itinerary = {};
    selfHealArrivalGuide(itinerary, 'ICN T1');  // ctx 안 전달
    const step5 = itinerary.arrival_guide.steps.find((s) => s.step === 5);
    expect(step5.description).toContain('your hotel');
    expect(step5.description).toContain('ICN T1');
  });

  it('runtime — arrival_guide 이미 있으면 no-op (회귀 차단)', () => {
    const itinerary = {
      arrival_guide: {
        airport: 'ICN T1',
        steps: [{ step: 1, title: 'Custom Gemini step' }],
      },
    };
    const result = selfHealArrivalGuide(itinerary, 'ICN T1', { hotel_address: '명동' });
    expect(result).toBe(false);  // no-op
    expect(itinerary.arrival_guide.steps[0].title).toBe('Custom Gemini step');  // 보존
  });
});
