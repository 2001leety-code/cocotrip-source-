/**
 * finiteCoord 회귀 가드 (P790, 2026-06-03 자율 사이클).
 *
 * 배경: RouteAgent geocoding 이 `parseFloat(addresses[0].x/y)` 로 좌표 파싱 — 비수치 응답 시 NaN.
 * NaN 은 downstream `== null` / `!= null` 가드를 통과(NaN == null === false)해 haversine 까지 전파
 * → 거리 NaN → 비교 항상 false → P326 cache 지리검증/거리 로직 silent 오작동. fix: 유한수 아니면 null.
 *
 * 가드: 유효 좌표 통과 / 0 보존 / NaN·빈값·비수치 → null (기존 null fallback 체인이 처리).
 */
import { describe, it, expect } from 'vitest';
import { finiteCoord } from '../../api/_ai_core/agents/RouteAgent.js';

describe('finiteCoord — geocoding 좌표 NaN 가드', () => {
  it('유효 좌표 문자열 → number', () => {
    expect(finiteCoord('126.9784')).toBe(126.9784);
    expect(finiteCoord('37.5665')).toBe(37.5665);
    expect(finiteCoord(126.9784)).toBe(126.9784);
  });

  it('0 은 유한수 → 보존 (0,0 차단은 별도 가드 책임)', () => {
    expect(finiteCoord('0')).toBe(0);
    expect(finiteCoord(0)).toBe(0);
  });

  it('🔴 비수치/빈값/null/undefined → null (NaN 전파 차단)', () => {
    expect(finiteCoord('')).toBeNull();
    expect(finiteCoord('abc')).toBeNull();
    expect(finiteCoord(undefined)).toBeNull();
    expect(finiteCoord(null)).toBeNull();
    expect(finiteCoord(NaN)).toBeNull();
    expect(finiteCoord({})).toBeNull();
  });

  it('절대 NaN 을 반환하지 않음 (downstream == null 가드 통과 방지)', () => {
    for (const bad of ['', 'x', undefined, null, NaN, {}, [], 'NaN']) {
      const r = finiteCoord(bad as unknown as string);
      expect(Number.isNaN(r as number)).toBe(false); // null 이지 NaN 아님
    }
  });
});
