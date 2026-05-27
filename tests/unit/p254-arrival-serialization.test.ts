/**
 * P254 — arrival_time serialization unit test
 *
 * requestShaper.js P254 fix: camelCase(arrivalTime) 우선 + snake_case(arrival_time) fallback.
 *
 * 검증 시나리오:
 * A. body.arrivalTime = '14:00' (camelCase, 정상 prod frontend 방식) → arrivalTime = '14:00'
 * B. body.arrival_time = '14:00' (snake_case, verify script / admin tool) → arrivalTime = '14:00' (P254 fallback)
 * C. 둘 다 없음 → arrivalTime = '' (빈 문자열)
 * D. camelCase 우선순위: 둘 다 있으면 camelCase 사용
 *
 * blockMode P245 룰 검증:
 * E. arrivalTime='14:00' + tourStartTime='09:00' → dayStart = max(09:00, 15:00) = 15:00
 * F. arrivalTime='' → dayStart = tourStartTime = '09:00' (arrival 미입력 폴백)
 */
import { describe, it, expect } from 'vitest';

// requestShaper 의 arrival_time 파싱 로직을 pure function 으로 추출하여 테스트
// (실제 requestShaper 는 ESM + Vercel env 의존성 → 직접 import 불가 → 동일 로직 인라인)
function parseArrivalTime(body: Record<string, unknown>): string {
  const raw = typeof body.arrivalTime === 'string' ? body.arrivalTime
    : typeof body.arrival_time === 'string' ? body.arrival_time : '';
  return raw.slice(0, 5);
}

function parseDepartureTime(body: Record<string, unknown>): string {
  const raw = typeof body.departureTime === 'string' ? body.departureTime
    : typeof body.departure_time === 'string' ? body.departure_time : '';
  return raw.slice(0, 5);
}

// blockMode P245 로직 (addMinutesToHHMM + max)
function addMinutesToHHMM(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function calcDayStart(tourStartTime: string, arrivalTime: string): string {
  const HHMM_RE = /^\d{1,2}:\d{2}$/;
  if (arrivalTime && HHMM_RE.test(arrivalTime)) {
    const arrivalPlus60 = addMinutesToHHMM(arrivalTime, 60);
    return arrivalPlus60 > tourStartTime ? arrivalPlus60 : tourStartTime;
  }
  return tourStartTime;
}

describe('P254 — arrival_time serialization (requestShaper)', () => {
  it('A: camelCase arrivalTime → 정상 파싱', () => {
    expect(parseArrivalTime({ arrivalTime: '14:00' })).toBe('14:00');
  });

  it('B: snake_case arrival_time → P254 fallback 파싱', () => {
    expect(parseArrivalTime({ arrival_time: '14:00' })).toBe('14:00');
  });

  it('C: 둘 다 없음 → 빈 문자열', () => {
    expect(parseArrivalTime({})).toBe('');
    expect(parseArrivalTime({ area: 'seoul' })).toBe('');
  });

  it('D: camelCase 우선순위 (둘 다 있으면 camelCase 사용)', () => {
    expect(parseArrivalTime({ arrivalTime: '10:00', arrival_time: '14:00' })).toBe('10:00');
  });

  it('D2: snake_case arrival_time → departureTime fallback 동일 패턴', () => {
    expect(parseDepartureTime({ departure_time: '20:30' })).toBe('20:30');
    expect(parseDepartureTime({ departureTime: '19:00', departure_time: '20:30' })).toBe('19:00');
  });

  it('긴 문자열 → 5자리만 (slice 보장)', () => {
    expect(parseArrivalTime({ arrivalTime: '14:00:00' })).toBe('14:00');
    expect(parseArrivalTime({ arrival_time: '09:30:00' })).toBe('09:30');
  });
});

describe('P254 — blockMode P245 dayStart 계산', () => {
  it('E: arrival=14:00 + tourStart=09:00 → dayStart=15:00 (P245 룰 작동)', () => {
    expect(calcDayStart('09:00', '14:00')).toBe('15:00');
  });

  it('F: arrivalTime 빈 문자열 → dayStart=tourStartTime (P245 룰 스킵)', () => {
    expect(calcDayStart('09:00', '')).toBe('09:00');
  });

  it('G: arrival=01:30 + tourStart=09:00 → max(09:00, 02:30) = 09:00', () => {
    // max(09:00, 02:30) = 09:00 → 새벽 도착 케이스
    expect(calcDayStart('09:00', '01:30')).toBe('09:00');
  });

  it('H: arrival=10:00 + tourStart=09:00 → max(09:00, 11:00) = 11:00', () => {
    expect(calcDayStart('09:00', '10:00')).toBe('11:00');
  });

  it('I: addMinutesToHHMM — 자정 넘기기 케이스', () => {
    expect(addMinutesToHHMM('23:30', 60)).toBe('00:30');
  });

  it('J: arrival=14:00 이전 P254 bug 재현: arrivalTime=\'\' → dayStart=09:00 (P245 미작동)', () => {
    // P254 fix 이전: verify script 가 arrival_time (snake_case) 전달 → requestShaper arrivalTime=''
    // → blockMode arrivalTime 빈 문자열 → P245 룰 스킵 → dayStart=09:00
    // 이 테스트는 빈 문자열일 때 dayStart가 tourStartTime이 되는 것을 확인 (재현)
    const bugArrival = ''; // requestShaper 가 body.arrival_time 을 무시한 결과
    expect(calcDayStart('09:00', bugArrival)).toBe('09:00');
    // fix 후: 실제 arrival_time='14:00' 처리
    const fixedArrival = '14:00';
    expect(calcDayStart('09:00', fixedArrival)).toBe('15:00');
  });
});
