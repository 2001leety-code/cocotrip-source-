/**
 * 변경 가능 시점 24h 통일 (2026-10-23, 후속 ②b) — _refund-policy.js canModify.
 * 잠그는 것: 24h 경계(23.9h 거부 / 24h 허용) · KST 기준 · tourTime 유무(undefined 만 기본 00:00) ·
 *   무료 취소 기한과 같은 선.
 */
import { describe, it, expect } from 'vitest';
import { evaluateRefundPolicy } from '../../api/_refund-policy.js';

const HOUR = 3_600_000;
// 2026-12-10 10:00 KST = 2026-12-10 01:00 UTC
const TOUR_TS = Date.UTC(2026, 11, 10, 1, 0, 0);

describe('canModify — 24h boundary (KST)', () => {
  it('exactly 24h before → allowed; 23.9h before → refused', () => {
    expect(evaluateRefundPolicy({ tourDate: '2026-12-10', tourTime: '10:00', now: new Date(TOUR_TS - 24 * HOUR) }).canModify).toBe(true);
    expect(evaluateRefundPolicy({ tourDate: '2026-12-10', tourTime: '10:00', now: new Date(TOUR_TS - 23.9 * HOUR) }).canModify).toBe(false);
  });

  it('12–24h before (the old 12h window) is now refused', () => {
    expect(evaluateRefundPolicy({ tourDate: '2026-12-10', tourTime: '10:00', now: new Date(TOUR_TS - 13 * HOUR) }).canModify).toBe(false);
  });

  it('same line as the free-cancel window', () => {
    for (const h of [23.9, 24, 30]) {
      const p = evaluateRefundPolicy({ tourDate: '2026-12-10', tourTime: '10:00', now: new Date(TOUR_TS - h * HOUR) });
      expect(p.canModify).toBe(p.canRefund);
    }
  });

  it('tourTime missing → 00:00 KST anchor; empty string handled by callers as `|| undefined`', () => {
    const midnight = Date.UTC(2026, 11, 9, 15, 0, 0); // 2026-12-10 00:00 KST
    expect(evaluateRefundPolicy({ tourDate: '2026-12-10', tourTime: undefined, now: new Date(midnight - 24 * HOUR) }).canModify).toBe(true);
    expect(evaluateRefundPolicy({ tourDate: '2026-12-10', tourTime: undefined, now: new Date(midnight - 23 * HOUR) }).canModify).toBe(false);
    // 저장 형태 tourTime: '' → 호출자는 '' || undefined 로 넘긴다(그대로 넘기면 Invalid Date).
    const stored = '';
    expect(evaluateRefundPolicy({ tourDate: '2026-12-10', tourTime: stored || undefined, now: new Date(midnight - 25 * HOUR) }).canModify).toBe(true);
  });

  it('missing tourDate → never modifiable', () => {
    expect(evaluateRefundPolicy({ tourDate: '', now: new Date(0) }).canModify).toBe(false);
  });
});
