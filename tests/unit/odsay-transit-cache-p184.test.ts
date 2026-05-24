/**
 * P184 (2026-05-24): ODSAY transit_cache (Firestore 1 month TTL + lazy update).
 *
 * 운영자: "오딧세이 80% 썼어 대안방향있어?" + "호출할때마다 학습해서 그경로 숙지
 * 해놓고 필요할때 그것도 갖다 쓰면 되지않아?" → cache key (좌표 4자리) 동일 시
 * Firestore read → ODSAY 호출 0. TTL 30 days + lazy update (만료 시 자동 refresh).
 *
 * 회귀 시: cache layer 빠지면 같은 좌표 pair 반복 호출 = quota 낭비.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P184 ODSAY transit_cache', () => {
  const helperPath = resolve(__dirname, '../../api/_odsay_helper.js');
  const rulesPath = resolve(__dirname, '../../firestore.rules');
  const src = readFileSync(helperPath, 'utf8');
  const rules = readFileSync(rulesPath, 'utf8');

  it('cache key 좌표 4자리 반올림 + Firestore-safe', () => {
    expect(src).toMatch(/function\s+buildTransitCacheKey\s*\(\s*sx\s*,\s*sy\s*,\s*ex\s*,\s*ey/);
    // 좌표 4자리 (≈11m precision) + "_" separator
    expect(src).toMatch(/toFixed\(4\)/);
    expect(src).toMatch(/\$\{f\(sy\)\},\$\{f\(sx\)\}_\$\{f\(ey\)\},\$\{f\(ex\)\}/);
  });

  it('TTL 30 days (1 month)', () => {
    expect(src).toMatch(/TRANSIT_CACHE_TTL_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('searchTransitRoute 가 cache lookup 먼저 (HIT 시 ODSAY 호출 0)', () => {
    // searchTransitRoute 함수 안에 getCachedTransit 호출 + cache hit return 패턴
    expect(src).toMatch(/getCachedTransit\s*\(\s*cacheKey\s*\)/);
    expect(src).toMatch(/cache HIT/i);
  });

  it('ODSAY 성공 시 cache write (fire-and-forget)', () => {
    expect(src).toMatch(/setCachedTransit\s*\(\s*cacheKey\s*,\s*result\s*\)\s*\.catch/);
  });

  it('firestore.rules transit_cache server only', () => {
    expect(rules).toMatch(/match\s+\/transit_cache\/\{cacheKey\}[\s\S]{0,150}allow\s+read\s*,\s*write\s*:\s*if\s+false/);
  });

  it('P184 reference 명시 (메타 lesson 보존)', () => {
    expect(src).toMatch(/P184[\s\S]{0,500}transit_cache/);
  });
});
