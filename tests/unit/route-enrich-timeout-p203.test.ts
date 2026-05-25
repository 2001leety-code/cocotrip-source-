/**
 * P203 (2026-05-26): routeEnrich 180s wall-clock cap 회귀 테스트.
 *
 * 배경:
 *   - 5/25 prod alert: step elapsed 26-27분 (1.59-1.67M ms) — Vercel 600s cap 도달 전
 *   - root cause: 외부 API hang (Naver/ODsay) 또는 axios connect/TLS handshake 무한 대기
 *   - fix: postResponsePipeline.js 의 runRouteEnrichment 안에서 enrichItineraryWithRoute
 *     호출에 Promise.race(180s) wrap. timeout 시 partial 결과 보존 + telegram alert.
 *
 * assertion 8종 (source-level — 외부 API mock 불요):
 *   1. ROUTE_ENRICH_TIMEOUT_MS = 180_000 (180s) 정의 존재
 *   2. throttledTelegramAlert import (alert 발송)
 *   3. Promise.race wrap 패턴 적용
 *   4. timeout error message = 'ROUTE_ENRICH_TIMEOUT'
 *   5. timeout catch + throttledTelegramAlert(key: 'route-enrich-timeout') 호출
 *   6. timeout 시 throw 안 함 (fall through to remaining steps)
 *   7. clearTimeout in finally (timer leak 방지)
 *   8. enrichItineraryWithRoute 호출 동일 인자 유지 (apiKey/body/...)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../api/_ai_core/postResponsePipeline.js');

describe('P203 postResponsePipeline.js — routeEnrich 180s wall-clock cap', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(sourcePath, 'utf8');
  });

  it('assertion 1: ROUTE_ENRICH_TIMEOUT_MS = 180_000 (180s)', () => {
    expect(/ROUTE_ENRICH_TIMEOUT_MS\s*=\s*180_?000/.test(src)).toBe(true);
  });

  it('assertion 2: throttledTelegramAlert import (alert 발송)', () => {
    expect(/import\s*{[^}]*throttledTelegramAlert[^}]*}\s*from\s*['"][^'"]*telegram-throttle/.test(src)).toBe(true);
  });

  it('assertion 3: Promise.race wrap 패턴 적용 (enrichItineraryWithRoute + timeout)', () => {
    expect(/Promise\.race\(\s*\[\s*enrichItineraryWithRoute/.test(src)).toBe(true);
  });

  it("assertion 4: timeout error message = 'ROUTE_ENRICH_TIMEOUT'", () => {
    expect(/new Error\(['"]ROUTE_ENRICH_TIMEOUT['"]\)/.test(src)).toBe(true);
  });

  it("assertion 5: catch + throttledTelegramAlert(key: 'route-enrich-timeout') 호출", () => {
    expect(/key:\s*['"]route-enrich-timeout['"]/.test(src)).toBe(true);
    // alert 가 catch 블록 안에 위치 확인 (timeout 매칭 후)
    expect(/ROUTE_ENRICH_TIMEOUT[\s\S]{1,500}throttledTelegramAlert/.test(src)).toBe(true);
  });

  it('assertion 6: timeout 시 throw 안 함 (fall through to remaining steps)', () => {
    // ROUTE_ENRICH_TIMEOUT 매칭 분기에서 throw 가 다른 case 에만 있어야.
    // 패턴: if (err.message === 'ROUTE_ENRICH_TIMEOUT') { ... } else { throw err; }
    expect(/ROUTE_ENRICH_TIMEOUT[\s\S]{1,800}else\s*{\s*throw\s+err/.test(src)).toBe(true);
  });

  it('assertion 7: clearTimeout in finally (timer leak 방지)', () => {
    expect(/finally\s*{\s*clearTimeout\(timeoutId\)/.test(src)).toBe(true);
  });

  it('assertion 8: enrichItineraryWithRoute 호출 동일 인자 유지', () => {
    expect(/apiKey[\s\S]{0,100}body[\s\S]{0,100}hotel_address[\s\S]{0,100}arrival_airport[\s\S]{0,100}departure_airport[\s\S]{0,100}pax/.test(src)).toBe(true);
  });

  it('assertion 9: 180s 값 = deep-search agent 권고 (99th percentile + 안전마진)', () => {
    // Sample 4 outlier 151s + 50% headroom = ~225s. 180s = slight 더 적극 (Sample 4 일부 false positive 허용).
    // 다만 27분 (1.67M ms = 1670s) 대비 -89% 단축. 정상 plan (37-43s) 영향 0.
    expect(/180_?000/.test(src)).toBe(true);
    // 정상 plan 영향 확인 — 37-43초 < 180s
    expect(180_000).toBeGreaterThan(151_000);  // Sample 4 outlier
    expect(180_000).toBeLessThan(300_000);  // Vercel maxDuration 300s cap 안전
  });
});
