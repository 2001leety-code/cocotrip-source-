/**
 * api/_shared/attribution.js — 서버측 유입 스냅샷 화이트리스트 (P1 2026-07-11).
 * 불변식: 허용 키만 통과 / PII('@') 차단 / 어떤 입력에도 throw 없음(결제·가입 보호).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeAttribution } from '../../api/_shared/attribution.js';

describe('sanitizeAttribution', () => {
  it('정상 first/last 통과 + ts 보존', () => {
    const out = sanitizeAttribution({
      first: { utm_source: 'google', utm_medium: 'cpc', ts: '2026-07-11T00:00:00.000Z' },
      last: { utm_source: 'meta', utm_campaign: 'retarget' },
    })!;
    expect(out.first.utm_source).toBe('google');
    expect(out.first.ts).toBe('2026-07-11T00:00:00.000Z');
    expect(out.last.utm_campaign).toBe('retarget');
  });

  it('비허용 키(이메일·전화·임의 필드) 전부 폐기', () => {
    const out = sanitizeAttribution({
      first: {
        utm_source: 'google',
        email: 'a@b.c', phone: '01012345678', address: 'Seoul', uid: 'x', __proto__hack: '1',
      },
    })!;
    expect(Object.keys(out.first).sort()).toEqual(['utm_source']);
  });

  it("PII 최소화: '@' 포함 값 폐기", () => {
    const out = sanitizeAttribution({ last: { utm_source: 'user@example.com', utm_medium: 'cpc' } })!;
    expect(out.last.utm_source).toBeUndefined();
    expect(out.last.utm_medium).toBe('cpc');
  });

  it('PII 최소화: 전화형 값 폐기 (클라 isSuspectPiiValue 와 동일 규칙 명세)', () => {
    const out = sanitizeAttribution({
      first: {
        utm_source: '010-1234-5678',      // 구분자 전화 → 폐기
        utm_medium: '+82 10 1234 5678',   // 국제전화 → 폐기
        utm_campaign: '01012345678',      // 0시작 순수숫자(한국 전화) → 폐기
        utm_term: '1234567890123456',     // 0 미시작 순수숫자(광고 ID) → 허용
        utm_content: 'camp-2026-07-11',   // 날짜 포함 캠페인명 → 허용
      },
    })!;
    expect(out.first.utm_source).toBeUndefined();
    expect(out.first.utm_medium).toBeUndefined();
    expect(out.first.utm_campaign).toBeUndefined();
    expect(out.first.utm_term).toBe('1234567890123456');
    expect(out.first.utm_content).toBe('camp-2026-07-11');
  });

  it('PII 최소화: URL 값 폐기 (http/https/:///www.)', () => {
    const out = sanitizeAttribution({
      first: {
        utm_source: 'https://evil.example.com/steal?token=x',
        utm_medium: 'ftp://host/file',
        utm_campaign: 'www.example.com',
        utm_term: 'summer_sale', // 정상 허용
      },
    })!;
    expect(out.first.utm_source).toBeUndefined();
    expect(out.first.utm_medium).toBeUndefined();
    expect(out.first.utm_campaign).toBeUndefined();
    expect(out.first.utm_term).toBe('summer_sale');
  });

  it('개행·제어문자 제거 후 저장 (로그 인젝션·저장 오염 방지)', () => {
    const out = sanitizeAttribution({ first: { utm_source: 'goo\ngle\tads' } })!;
    expect(out.first.utm_source).toBe('googleads');
  });

  it('utm 키 없이 ts 만 있으면 null (의미 없는 저장 방지)', () => {
    expect(sanitizeAttribution({ first: { ts: '2026-07-11T00:00:00Z' } })).toBeNull();
  });

  it('ts 비 ISO 형식은 폐기', () => {
    const out = sanitizeAttribution({ first: { utm_source: 'g', ts: 'DROP TABLE users' } })!;
    expect(out.first.ts).toBeUndefined();
  });

  it('120자 초과 값 컷', () => {
    const out = sanitizeAttribution({ first: { utm_campaign: 'x'.repeat(500) } })!;
    expect(out.first.utm_campaign.length).toBe(120);
  });

  it('쓰레기 입력 전부 throw 없이 null — 결제 흐름 보호', () => {
    for (const bad of [null, undefined, 'str', 42, [], { first: 'str' }, { first: [] }, { first: {} }, { random: {} }]) {
      expect(() => sanitizeAttribution(bad)).not.toThrow();
      expect(sanitizeAttribution(bad)).toBeNull();
    }
  });

  it('숫자/객체 값(비 string)은 폐기', () => {
    const out = sanitizeAttribution({ first: { utm_source: 123, utm_medium: { a: 1 }, utm_campaign: 'ok' } })!;
    expect(Object.keys(out.first)).toEqual(['utm_campaign']);
  });
});
