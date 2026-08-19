/**
 * AI 챗 SYSTEM_PROMPT ↔ 코드 SSOT 팩트체크 잠금 (2026-08-19).
 *
 * 배경: 팩트체크에서 SYSTEM_PROMPT 의 13개 항목이 실제 코드(가격/차량/정책)와
 * 어긋나 있었다 (예: 존재한 적 없는 "Carnival/Mini Bus" 차량, 옛 K-pop 셔틀가
 * ₩26,000/₩52,000, "24시간 마감" 등). 본 테스트는 ①옛 오답 문구가 다시 섞여
 * 들어오지 않는지 ②프롬프트의 숫자가 pricing_spec.json 같은 SSOT 파일과
 * 항상 일치하는지 잠근다 — SSOT 값이 바뀌면 이 테스트부터 빨강이 되어
 * 프롬프트를 따라 고치게 강제한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pricingSpec from '../../src/data/pricing_spec.json';

const chatSrc = readFileSync(join(process.cwd(), 'api', 'chat.js'), 'utf8');

function krw(n: number): string {
  return `₩${n.toLocaleString('en-US')}`;
}

describe('chat SYSTEM_PROMPT — 실존한 적 없는 옛 오답 문구 부재', () => {
  const bannedStrings = [
    'Carnival',
    'Mini Bus',
    '26,000',
    '52,000',
    'Refund within 24h',
    '24/7 service',
    'KT 30-day',
    'up to 8 pax',
    'Minimum 24 hours advance',
    'Child seats free',
    '00:00-06:00',
  ];

  for (const banned of bannedStrings) {
    it(`"${banned}" 가 프롬프트에 없다`, () => {
      expect(chatSrc).not.toContain(banned);
    });
  }
});

describe('chat SYSTEM_PROMPT — 가격은 pricing_spec.json SSOT 와 항상 일치', () => {
  it('K-pop 셔틀 편도가가 SSOT price_one_way 와 일치', () => {
    const oneWay = krw(pricingSpec.kpop_shuttle.price_one_way);
    expect(chatSrc).toContain(oneWay);
  });

  it('K-pop 셔틀 왕복가가 SSOT price_round_trip 와 일치', () => {
    const roundTrip = krw(pricingSpec.kpop_shuttle.price_round_trip);
    expect(chatSrc).toContain(roundTrip);
  });

  it('카시트 추가요금이 SSOT extra_charges.child_seat_per_trip 와 일치', () => {
    const childSeat = krw(pricingSpec.extra_charges.child_seat_per_trip);
    expect(chatSrc).toContain(childSeat);
  });

  it('스타리아 캡틴시트 프리미엄이 SSOT vehicles.staria.captain_premium_krw 와 일치', () => {
    const premium = krw(pricingSpec.vehicles.staria.captain_premium_krw);
    expect(chatSrc).toContain(premium);
  });
});

describe('chat SYSTEM_PROMPT — 정정된 정책/차량 문구 존재', () => {
  it('AI 플래너 환불불가 고지가 있다', () => {
    expect(chatSrc).toMatch(/non-refundable/);
  });

  it('변경 마감 12시간 문구가 있다 (SSOT api/_refund-policy.js canModify)', () => {
    expect(chatSrc).toContain('12 hours');
  });

  it('상담 운영시간(평일)이 안내된다', () => {
    expect(chatSrc).toMatch(/weekdays.*10:00.*18:00/i);
  });

  it('Sprinter 차량이 안내된다', () => {
    expect(chatSrc).toContain('Sprinter');
  });

  it('Staria 9 (9인승)이 안내된다', () => {
    expect(chatSrc).toContain('Staria 9');
  });
});
