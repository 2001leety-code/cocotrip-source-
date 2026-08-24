/**
 * P283 (2026-05-29): recommended_zone Day 2+ enforce rule 회귀 차단.
 *
 * Agent 2 deep-search 발견: 4/4 myeongdong plan 모두 50% 미만 매칭 (Day 1 만 명동 OK, Day 2+ 풀림).
 * 운영자 시점 "명동 묵으면서 매일 강남 1시간 이동" = 추천 zone 무력화.
 *
 * Root cause: userMessageBuilder.js 의 [LODGING ZONE PREFERENCE — STRICT] rule 이 Day 1 first /
 *   Day N last 만 강조. Day 2 ~ Day N-1 middle days 의 first/last stop 명시 누락.
 *
 * Fix: rule 강화 — EVERY day 의 stops[0] AND stops[last] within 3km + middle days 명시 + BAD/GOOD 예시.
 *
 * 회귀 시: 사용자 명동 추천 → Day 2+ 강남구 1시간 이동 회귀 → 환불 클레임 위험.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUserMessage } from '../../api/_ai_core/userMessageBuilder.js';

describe('P283 LODGING ZONE PREFERENCE — Day 2+ enforce rule', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/userMessageBuilder.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — P283 강화 reference 명시', () => {
    expect(src).toContain('P283 강화 2026-05-29');
    expect(src).toContain('EVERY day from Day 1 to Day N');
    expect(src).toContain('Day 2 ~ Day N-1 (middle days)');
    expect(src).toContain('HUB-AND-SPOKE pattern');
  });

  it('source — BAD/GOOD 예시 명시 (회귀 차단)', () => {
    expect(src).toContain('P283 BAD 예시');
    expect(src).toContain('P283 GOOD 예시');
    expect(src).toContain('Agent 2 deep-search 4/4 plans 영향');
    // 사용자 신고 핵심 substring
    expect(src).toContain('명동↔강남 1시간 왕복');
    expect(src).toContain('명동에 묵으라고 추천했는데');
  });

  it('source — middle days first AND last stops 명시', () => {
    expect(src).toContain('first AND last stops also within 3km');
    expect(src).toContain('매일 zone 호텔에서 출발하고 복귀');
  });

  // ── runtime — buildUserMessage 호출 시 LODGING ZONE rule 강화 부분 포함 ──────

  function makeShaped(overrides: any = {}) {
    return {
      guestName: 'Sarah',
      pax: 2,
      startDate: '2026-06-15',
      durationDays: 5,
      styles: ['Food'],
      area: 'seoul_city',
      regions: ['서울'],
      duration: '5-day',
      vehicle: 'staria_8',
      arrival_airport: 'ICN_T1',
      departure_airport: 'ICN_T1',
      arrivalAddress: '',
      departureAddress: '',
      arrivalTime: '14:30',
      departureTime: '18:00',
      tourStartTime: '09:00',
      hotel_address: '',  // hotel 없음 — recommended_zone fallback
      hotelByCity: {},
      arrivalCity: '',
      departureCity: '',
      recommendedZone: '명동',
      recommendedZones: { seoul: '명동' },
      mobility: 'walking',
      luggage: 'medium',
      specialRequest: '',
      dietPrefs: [],
      dietaryRestrictions: [],
      spiceLevel: 'medium',
      bucketDishes: [],
      priceRange: 'Any',
      pace: 'standard',
      wantAccom: false,
      accomBudget: '',
      language: 'en',
      ...overrides,
    };
  }

  it('runtime — single zone plan 의 message 에 P283 강화 rule 포함', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ recommendedZones: { seoul: '명동' } }),
      body: {},
      spotContext: '',
      foodContext: '',
      attractionsContext: '',
    });
    // P283 rule 강화 keyword 가 포함
    expect(msg).toContain('LODGING ZONE PREFERENCE');
    expect(msg).toContain('P283');
    expect(msg).toContain('EVERY day');
    expect(msg).toContain('HUB-AND-SPOKE');
  });

  it('runtime — multi-zone plan (regions ≥ 2) 는 single rule 적용 X (MULTI-CITY branch)', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({
        regions: ['서울', '부산'],
        recommendedZones: { seoul: '명동', busan: '해운대' },
      }),
      body: {},
      spotContext: '',
      foodContext: '',
      attractionsContext: '',
    });
    // multi-city branch — MULTI-CITY LODGING ZONE PREFERENCE 표시 (P283 single rule 적용 X)
    expect(msg).toContain('MULTI-CITY LODGING ZONE PREFERENCE');
    // P283 single rule keyword 는 message 에 없어야 함 (single zone branch 만 강화)
    expect(msg).not.toContain('P283 BAD 예시');
  });

  it('runtime — recommended_zone 없음 plan → LODGING ZONE block 자체 emit 안 함', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ recommendedZones: {} }),
      body: {},
      spotContext: '',
      foodContext: '',
      attractionsContext: '',
    });
    expect(msg).not.toContain('LODGING ZONE PREFERENCE');
  });
});
