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

/** Filter out concerts whose last date has passed */
export function getUpcomingConcerts(): KpopConcert[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return KPOP_CONCERTS.filter(c => {
    const lastDate = new Date(c.dates[c.dates.length - 1]);
    lastDate.setHours(23, 59, 59, 999);
    return lastDate >= today;
  });
}
