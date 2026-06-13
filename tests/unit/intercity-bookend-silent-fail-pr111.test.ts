/**
 * P111 (2026-05-20) regression slot — intercity bookend silent fail diagnostics.
 *
 * Source bug (plan 4792076e, 2026-05-20): 서울→부산 KTX 일정 생성됐는데 사용자
 * 화면에 "Day3 첫 stop = Myeongdong Hotel → 갑자기 부산역 식당" 으로 표시.
 * doc 의 day3.intercity_transit 에 mode/from_station/to_station 다 있는데
 * lodging_to_station + station_to_lodging 만 누락 → UI 의 LodgingBookend 카드
 * 미표시.
 *
 * 원인 추적이 RouteAgent.js Phase 2.4 의 4 silent-fail 분기:
 *   1. it.from_station / it.to_station 없음 (Gemini 출력 누락)
 *   2. prevDayHotelCoord.lat/lng 없음 (이전 day hotel 좌표 계산 실패)
 *   3. lookupStationCoord(from_station) null (STATION_COORDS 미등록 역명)
 *   4. ODsay _getTransitData throw (네트워크/quota)
 *
 * 이전엔 console.warn 만 → 운영자가 Vercel logs 폴링 없이 인지 불가.
 * P111: throttledTelegramAlert (key=intercity-bookend-fail:{reason}:{from→to})
 * 발사 + 4 분기별 reason string 명시. P83 routeEnrichment silent catch
 * 패턴 동일 (5분 dedup, P67).
 *
 * Verifies (regression-prevention asserts in source):
 *   1. RouteAgent.js imports throttledTelegramAlert from telegram-throttle.
 *   2. Phase 2.4 의 4 silent-fail 분기 각각 명시 reason push (from_station_missing /
 *      prev_hotel_coord_missing / station_coord_missing / odsay_throw + post: 변형).
 *   3. bookendFailReasons.length > 0 시 throttledTelegramAlert 호출.
 *   4. alert key 가 'intercity-bookend-fail:{reason}:{from→to}' 패턴.
 *   5. severity:'high' + channel:'admin'.
 *   6. context 에 day / fromCity / toCity / reasons 포함.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_AGENT = readFileSync(
  join(__dirname, '../../api/_ai_core/agents/RouteAgent.js'),
  'utf8',
);

describe('RouteAgent — P111 intercity bookend silent-fail telemetry', () => {
  it('imports throttledTelegramAlert from telegram-throttle helper', () => {
    expect(ROUTE_AGENT).toMatch(/from\s*['"]\.\.\/\.\.\/_shared\/telegram-throttle\.js['"]/);
    expect(ROUTE_AGENT).toMatch(/throttledTelegramAlert/);
  });

  it('declares bookendFailReasons accumulator before Phase 2.4 block', () => {
    // Accumulator must exist so all four branches can push their reason.
    expect(ROUTE_AGENT).toMatch(/const\s+bookendFailReasons\s*=\s*\[\]/);
  });

  it('Phase 2.4a: 4 explicit silent-fail reasons covered (pre-leg)', () => {
    // (1) from_station missing
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(['"`]pre:from_station_missing/);
    // (2) prev hotel coord missing
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(['"`]pre:prev_hotel_coord_missing/);
    // (3) station coord missing
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(`pre:station_coord_missing:\$\{it\.from_station\}/);
    // (4) ODsay throw
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(`pre:odsay_throw:/);
  });

  it('Phase 2.4b: 4 explicit silent-fail reasons covered (post-leg)', () => {
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(['"`]post:to_station_missing/);
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(['"`]post:day_hotel_coord_missing/);
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(`post:station_coord_missing:\$\{it\.to_station\}/);
    expect(ROUTE_AGENT).toMatch(/bookendFailReasons\.push\(`post:odsay_throw:/);
  });

  it('throttledTelegramAlert fires only when bookendFailReasons.length > 0', () => {
    // guard pattern: if (bookendFailReasons.length > 0) { throttledTelegramAlert({...}) }
    const guardBlock = ROUTE_AGENT.match(
      /if\s*\(\s*bookendFailReasons\.length\s*>\s*0\s*\)\s*\{[\s\S]{0,2000}?throttledTelegramAlert\s*\(/,
    );
    expect(guardBlock).not.toBeNull();
  });

  it('alert key matches intercity-bookend-fail:{reason}:{from→to} pattern', () => {
    expect(ROUTE_AGENT).toMatch(/key:\s*`intercity-bookend-fail:\$\{firstReason\}:\$\{fromTo\}`/);
  });

  it('alert channel=admin + severity=high (P83 pattern)', () => {
    // Locate the throttledTelegramAlert call block (not the earlier comment ref).
    // bookend alert 를 key 로 특정(다른 throttledTelegramAlert 호출이 앞에 있어도 정확히).
    const keyIdx = ROUTE_AGENT.lastIndexOf('intercity-bookend-fail'); // 주석(L1379) 말고 실제 key
    const callIdx = ROUTE_AGENT.lastIndexOf('throttledTelegramAlert({', keyIdx);
    expect(callIdx).toBeGreaterThan(0);
    const alertBlock = ROUTE_AGENT.slice(callIdx, callIdx + 3000);
    expect(alertBlock).toMatch(/channel:\s*['"]admin['"]/);
    expect(alertBlock).toMatch(/severity:\s*['"]high['"]/);
  });

  it('alert context includes day + fromCity + toCity + reasons array', () => {
    // bookend alert 를 key 로 특정(다른 throttledTelegramAlert 호출이 앞에 있어도 정확히).
    const keyIdx = ROUTE_AGENT.lastIndexOf('intercity-bookend-fail'); // 주석(L1379) 말고 실제 key
    const callIdx = ROUTE_AGENT.lastIndexOf('throttledTelegramAlert({', keyIdx);
    expect(callIdx).toBeGreaterThan(0);
    const alertBlock = ROUTE_AGENT.slice(callIdx, callIdx + 3500);
    expect(alertBlock).toMatch(/context:\s*\{/);
    expect(alertBlock).toMatch(/day:\s*dayPlan\.day/);
    expect(alertBlock).toMatch(/fromCity:\s*it\.from_city/);
    expect(alertBlock).toMatch(/toCity:\s*it\.to_city/);
    expect(alertBlock).toMatch(/reasons:\s*bookendFailReasons/);
  });

  it('non-blocking dispatch via .catch(() => {}) — alert failure never breaks plan', () => {
    expect(ROUTE_AGENT).toMatch(/throttledTelegramAlert\(\{[\s\S]+?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });

  it('per-branch explicit console.warn replaces silent skip', () => {
    // Each branch must console.warn so prod logs are also actionable
    // (Telegram alert is the primary signal, logs are fallback).
    expect(ROUTE_AGENT).toMatch(/intercity bookend pre SKIP — from_station undefined/);
    expect(ROUTE_AGENT).toMatch(/intercity bookend pre SKIP — prevDayHotelCoord/);
    expect(ROUTE_AGENT).toMatch(/intercity bookend pre SKIP — STATION_COORDS/);
    expect(ROUTE_AGENT).toMatch(/intercity bookend post SKIP — to_station undefined/);
    expect(ROUTE_AGENT).toMatch(/intercity bookend post SKIP — dayHotel/);
    expect(ROUTE_AGENT).toMatch(/intercity bookend post SKIP — STATION_COORDS/);
  });
});
