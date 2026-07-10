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

  it("PII 방어: '@' 포함 값 폐기", () => {
    const out = sanitizeAttribution({ last: { utm_source: 'user@example.com', utm_medium: 'cpc' } })!;
    expect(out.last.utm_source).toBeUndefined();
    expect(out.last.utm_medium).toBe('cpc');
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
