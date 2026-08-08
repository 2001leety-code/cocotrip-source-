// K-pop 콘서트 셔틀 대상 공연 목록.
//
// ⚠️ 데이터 SSOT = `kpopConcerts.json` (이 파일은 타입 + 조회 헬퍼만).
//    JSON 을 별도 파일로 둔 이유: 서버리스 크론(api/_crons/kpop-calendar-check.js)이
//    같은 파일을 fs 로 읽어 "남은 공연 소진" 을 감시한다. .ts 안에 배열을 박으면
//    백엔드가 못 읽어 데이터가 2벌로 갈라진다 (pricing_spec 2벌 전례).
//    → vercel.json 의 cron-runner includeFiles 로 이 JSON 이 함수 번들에 포함된다.
//
// 갱신 방법: kpopConcerts.json 만 고치면 프론트·크론 양쪽에 동시 반영.
//    매월 1일 크론이 잔여 공연 수를 세어 부족하면 운영자 텔레그램으로 알린다.
import rawConcerts from './kpopConcerts.json';

export interface KpopConcert {
  id: string;
  artist: string;
  tourName: string;
  venue: string;
  venueKo: string;
  location: string;
  locationKo: string;
  dates: string[];
  dateDisplay: string;
  dateDisplayKo: string;
  shuttleAvailable: boolean;
  pickupPoints: string[];
  pickupPointsKo: string[];
  oneWayPrice: number;
  roundTripPrice: number;
  note: string;
  noteKo: string;
  naverMapUrl: string;
  highlight: boolean;
  soldOut: boolean;
}

export const KPOP_CONCERTS: KpopConcert[] = rawConcerts as KpopConcert[];

/**
 * Filter out concerts whose last date has passed — **KST 기준** (2026-08-09).
 *
 * ⚠️ 손님 브라우저 시간대로 판정하면 안 된다. 공연은 전부 한국에서 열린다.
 *   예전 구현(`new Date()` + `setHours()`)은 손님 로컬 시간대를 따랐다:
 *   · 뉴욕(UTC-4) — `new Date('2026-08-08')` 이 UTC 자정이라 현지로는 08-07 이 되고
 *     `setHours(23,59,...)` 가 하루 앞에 찍혀, 한국에서 아직 열리는 공연이 하루 일찍 사라졌다.
 *   · UTC/런던 — KST 로는 어제 끝난 공연이 하루 더 남아 보였다.
 *
 * 계산은 감시 크론 `api/_crons/kpop-calendar-check.js` 의 `splitByDate` 와 **같은 식**이다
 * (그쪽은 node:fs 를 물고 있어 프론트 번들로 가져올 수 없다).
 * 두 벌이 갈라지면 `tests/unit/kpop-calendar-watchdog.test.ts` 가 잡는다.
 */
export function getUpcomingConcerts(): KpopConcert[] {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
  return KPOP_CONCERTS.filter(c => {
    const lastMs = Date.parse(`${c.dates[c.dates.length - 1]}T23:59:59+09:00`);
    return Number.isFinite(lastMs) && lastMs >= todayMs;
  });
}
