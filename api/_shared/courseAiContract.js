/**
 * courseAiContract.js — /api/course-ai 배치 계약: fixed/window anchor 보존 (2026-08-24).
 *
 * 배경: course-ai 는 사용자가 넣은 장소 순서를 Gemini(또는 최근접 이웃 폴백)로 재배치한다.
 * 그런데 사용자가 특정 장소에 예약 시각(timeConstraint='fixed') 이나 방문 가능 시간대
 * ('window')를 걸어뒀다면, 모델이 "동선상 자연스럽다"는 이유로 그 장소를 다른 시간으로
 * 밀어내면 안 된다 — 예약을 놓치거나 영업 종료 시간대에 도착하게 된다.
 *
 * 그래서 여기서 fixed/window stop 을 "원래 인덱스에 고정된 anchor"로 뽑아내고, 모델/폴백
 * 에는 나머지(free) id 집합만 재배치 대상으로 넘긴다. 결과를 합칠 때는 서버가 anchor 를
 * 원래 인덱스에 결정론적으로 다시 끼워 넣는다 — 모델이 무엇을 반환하든 anchor 위치는
 * 서버가 강제한다. 원본 stop 객체 필드(메타데이터)는 이 모듈이 절대 건드리지 않는다
 * (순서만 계산 — CLAUDE.md 절대금지 stop 필드 스키마 규칙과 무관).
 *
 * ⚠️ api/ ↔ src/ 상호 import 금지 — src/.../courseOps.ts 의 isValidStopConstraints 와
 *   동일 규칙을 여기 독립 구현한다(두 벌 + 각자 테스트 가드).
 */

const MAX_STOPS = 20;

function isValidClock(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function isValidStayMinutes(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440;
}

/** 계약 위반 — 호출부(course-ai.js)는 이 에러를 400 으로 변환한다. */
export class CourseAiContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CourseAiContractError';
    this.code = code;
  }
}

/**
 * 입력 stop 배열을 검증하고 anchor(fixed/window)/free(자유배치) 로 분리한다.
 * 원본 stop 객체는 그대로 보존(index 만 덧붙임) — 필드를 지우거나 바꾸지 않는다.
 *
 * @param {object[]} rawStops - id/title 필수, time/timeConstraint/windowEnd/stayMinutes 선택.
 * @returns {{ stops: object[], anchorIndexes: Set<number>, freeIds: string[] }}
 * @throws {CourseAiContractError} 형식 불량 시 — 호출부는 400.
 */
export function buildCourseAiContract(rawStops) {
  if (!Array.isArray(rawStops) || rawStops.length === 0) {
    throw new CourseAiContractError('EMPTY_STOPS');
  }
  if (rawStops.length > MAX_STOPS) {
    throw new CourseAiContractError('TOO_MANY_STOPS');
  }
  const seenIds = new Set();
  const stops = rawStops.map((s, index) => {
    const id = typeof s?.id === 'string' ? s.id.trim() : '';
    if (!id) throw new CourseAiContractError('BAD_STOP_ID');
    if (seenIds.has(id)) throw new CourseAiContractError('DUPLICATE_STOP_ID');
    seenIds.add(id);
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
    if (!title) throw new CourseAiContractError('BAD_STOP_TITLE');

    const timeConstraint = s?.timeConstraint;
    if (timeConstraint !== undefined) {
      if (timeConstraint !== 'fixed' && timeConstraint !== 'window') {
        throw new CourseAiContractError('BAD_TIME_CONSTRAINT');
      }
      if (!isValidClock(s?.time)) throw new CourseAiContractError('BAD_TIME_CONSTRAINT');
      if (timeConstraint === 'window') {
        if (!isValidClock(s?.windowEnd) || s.windowEnd <= s.time) {
          throw new CourseAiContractError('BAD_WINDOW_END');
        }
      } else if (s?.windowEnd !== undefined) {
        throw new CourseAiContractError('BAD_WINDOW_END');
      }
    } else if (s?.windowEnd !== undefined) {
      throw new CourseAiContractError('BAD_WINDOW_END');
    }

    if (s?.stayMinutes !== undefined && !isValidStayMinutes(s.stayMinutes)) {
      throw new CourseAiContractError('BAD_STAY_MINUTES');
    }

    return { ...s, id, title, index };
  });

  const anchorIndexes = new Set();
  stops.forEach((s, index) => {
    if (s.timeConstraint === 'fixed' || s.timeConstraint === 'window') anchorIndexes.add(index);
  });
  const freeIds = stops.filter((_, index) => !anchorIndexes.has(index)).map((s) => s.id);

  return { stops, anchorIndexes, freeIds };
}

/**
 * free id 재배치 결과(모델 또는 최근접 이웃 폴백)를 원본 anchor 위치에 결정론적으로
 * 다시 끼워 넣는다. candidateFreeOrder 가 freeIds 와 집합이 정확히 같지 않으면(중복/누락/
 * 미지 id) 원본 자유구간 순서(freeIds)로 폴백한다 — anchor 는 항상 원래 인덱스 유지.
 *
 * @param {{stops: object[], anchorIndexes: Set<number>, freeIds: string[]}} contract
 * @param {unknown} candidateFreeOrder - free id 만 담은 배열이어야 함(모델/폴백 산출).
 * @returns {string[]} 최종 id 순서 — 항상 길이 stops.length.
 */
export function mergeAnchoredOrder(contract, candidateFreeOrder) {
  const { stops, anchorIndexes, freeIds } = contract;
  const candidate = Array.isArray(candidateFreeOrder) ? candidateFreeOrder.map(String) : [];
  const candidateSet = new Set(candidate);
  const validCandidate = candidate.length === freeIds.length
    && freeIds.every((id) => candidateSet.has(id))
    && candidateSet.size === freeIds.length;
  const freeOrder = validCandidate ? candidate : freeIds;

  const result = new Array(stops.length);
  let freeCursor = 0;
  for (let i = 0; i < stops.length; i += 1) {
    if (anchorIndexes.has(i)) {
      result[i] = stops[i].id;
    } else {
      result[i] = freeOrder[freeCursor];
      freeCursor += 1;
    }
  }
  return result;
}
