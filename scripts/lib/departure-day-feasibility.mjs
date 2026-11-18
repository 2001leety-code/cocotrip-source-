// 2026-11-18: 출국일(마지막 날)이 손님이 실제로 갈 수 있는 일정인지 — scenario-matrix B-19.
//   seoul-busan-zh-5d 가 9/6 부터 매번 "부산 숙소 02:18 출발 → 인천공항 07:00"(출국 10:00)을 냈는데
//   이걸 보는 검사가 없어 통과로 떴다. validate-prod-regression.mjs 는 출국 10:00 고정이라
//   05:00 전 숙소 출발 = 대중교통·호텔 체크아웃으로 불가능, 출국일 도시 이동 = 첫차 타고 공항까지 무리.
//   마지막 날 도시를 출국 공항이 안 맡으면(부산 + ICN) 숙소 시각이 그럴듯해도 실패 — mock LLM 폴백
//   경로는 숙소를 06:30 에 고정해 시각만으로는 이 모양을 놓친다(review N1). 시나리오 도시(서울·부산·제주)
//   전제 — 공항 없는 도시(경주 등)가 마지막 날인 시나리오를 넣으면 이 줄을 다시 볼 것.
//   시각 선 = 04:30: 플래너 자체 바닥(05:00, planPersister)은 여유 5분 때문에 추정치가 조금만 길어도 1분
//   차이로 안 걸린다(오프라인 명동→인천 차 116분 추정 → 04:59, 운영 실제 버스 70분 → 05:30). 그 흔들림은
//   넘기고 02:18 처럼 첫차 훨씬 전 출발만 잡는다.
import { cityForAirport } from '../../api/_ai_core/airportInference.js';

export const EARLIEST_LODGING_DEPART_MIN = 4 * 60 + 30;

/**
 * @param {Array<{day?: number, city?: string, stops?: Array<{category?: string, start_time?: string}>, intercity_transit?: {mode?: string}}>} days
 * @param {string} [departureAirport] — 'ICN_T1' · 'PUS' · 'CJU' …; 없으면 공항-도시 대조 생략
 * @returns {{pass: boolean, actual: string}}
 */
export function departureDayFeasibility(days, departureAirport = '') {
  const last = Array.isArray(days) && days.length ? days[days.length - 1] : null;
  if (!last) return { pass: false, actual: '마지막 날 없음' };
  const lodging = (Array.isArray(last.stops) ? last.stops : []).find((s) => s && s.category === 'lodging');
  const m = /^(\d{1,2}):(\d{2})/.exec(String((lodging && lodging.start_time) || ''));
  const departMin = m ? Number(m[1]) * 60 + Number(m[2]) : null;
  const cityChange = !!(last.intercity_transit && last.intercity_transit.mode);
  const farFromAirport = !!(departureAirport && last.city && !cityForAirport(departureAirport, [last.city]));
  const lodgingOk = departMin !== null && departMin >= EARLIEST_LODGING_DEPART_MIN;
  return {
    pass: lodgingOk && !cityChange && !farFromAirport,
    actual: `day${last.day || days.length} ${last.city || '?'}: 숙소 출발 ${departMin === null ? '없음' : lodging.start_time}`
      + `${cityChange ? ` · 출국일 도시 이동(${last.intercity_transit.mode})` : ''}`
      + `${farFromAirport ? ` · 출국 공항 ${departureAirport} 이 맡지 않는 도시` : ''}`,
  };
}
