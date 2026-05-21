/**
 * intent-classifier.ts — 사용자 freeText / revision request → 수정 유형 분류 (PR-A stub).
 *
 * 2026-05-21 zone_courses 시스템과 연동. 사용자가 plan 수정을 요구할 때, 어떤 유형의
 * 수정인지 미리 분류해서 적절한 ai-planner handler 분기 (PR-B에서 추가 예정).
 *
 * Stub 구현 (PR-A): rule-based 키워드 매칭. Gemini 호출 X.
 * 향후 PR-B 에서 Gemini fallback 추가 예정 — confidence < 0.5 일 때 LLM 분류.
 *
 * 핵심 원칙 (사용자 강조 — "오류 없이 진행할 수 있는 시스템"):
 *   - invalid input 에 throw 금지. 항상 ClassifiedModification 반환.
 *   - 매칭 실패 시 intent='no_change' + confidence=0 + fallback_reason 명시.
 *   - 키워드 사전은 변경 빈도 낮게 (운영자가 후속 PR 에서 추가).
 */

/** 수정 유형 */
export type ModificationIntent =
  | 'block_swap'   // day 전체 block 을 다른 block 으로 교체 (예: 종로 → DMZ)
  | 'stop_swap'    // block 내 stop 1개 교체 (예: 광장시장 식당 → 다른 식당)
  | 'stop_add'     // stop 1개 추가 (예: N서울타워 추가)
  | 'stop_remove'  // stop 1개 제거 (예: 인사동 빼기)
  | 'no_change';   // 매칭 실패 — Gemini 호출 또는 사용자에게 명확화 요청

/** 분류 결과 — invalid input 에도 항상 반환 */
export interface ClassifiedModification {
  intent: ModificationIntent;
  target?: {
    /** 1-based day index (예: Day 2 면 2) */
    day_index?: number;
    /** 1-based stop order */
    stop_order?: number;
    /** block_swap 시 새 block ID (zone_courses.id) */
    block_id?: string;
    /** stop_swap/add/remove 시 한국어 stop 이름 */
    stop_name?: string;
    /** stop_add 시 주소 */
    stop_address?: string;
  };
  raw_text: string;
  /** 0 = 매칭 안 됨, 1 = 강한 확신. 키워드 매칭만 — 후속 PR-B 에서 Gemini 보강 */
  confidence: number;
  /** intent='no_change' 일 때 이유 */
  fallback_reason?: string;
}

// ─────────────────────────────────────────────────────────────────────
// 키워드 사전 — 운영자 후속 PR 에서 확장.
// 한국어 + 영어 (사용자 입력 패턴 다양).
// ─────────────────────────────────────────────────────────────────────

/** block 교체 단서 (zone 또는 활동 유형) */
const BLOCK_SWAP_KEYWORDS = [
  // 한국어 zone keywords
  'DMZ', 'dmz', '비무장지대',
  '트레킹', '트래킹', 'trekking',
  '북한산', '관악산', '도봉산', '청계산',
  '러닝', 'running', '뛰는', '조깅',
  '자전거', 'cycling', '바이크',
  '강남', '명동', '홍대', '이태원', '인사동', '종로',
  '부산', '제주', '경주',
  // 영어
  'mountain', 'hike', 'beach',
];

/** stop 교체 단서 (배경: 다른 / 교체) */
const STOP_SWAP_TRIGGERS = ['다른', '교체', '바꿔', '바꿀', '변경', 'change', 'swap', 'different', 'replace'];
/** stop 교체 카테고리 */
const STOP_SWAP_CATEGORIES = [
  '식당', '음식점', '맛집', '레스토랑', 'restaurant',
  '카페', 'cafe',
  '쇼핑', 'shopping',
  '명소', 'attraction',
];

/** stop 추가 단서 */
const STOP_ADD_TRIGGERS = ['추가', '끼워', '넣어', '포함', '같이', 'add', 'include', 'insert'];
/** 알려진 추가 명소 (운영자 확장) */
const KNOWN_STOPS = [
  'N서울타워', '남산타워', 'N seoul tower', 'namsan tower',
  '경복궁', '창덕궁', '덕수궁',
  '광장시장', '동대문', '명동성당',
  '한강', '여의도',
  '롯데월드', '에버랜드',
];

/** stop 제거 단서 */
const STOP_REMOVE_TRIGGERS = ['빼', '제거', '취소', '삭제', '없애', 'remove', 'cancel', 'delete', 'skip'];

// ─────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────

/** raw_text 에 day index 가 명시되어 있으면 추출 (예: "2일차", "Day 3") */
function extractDayIndex(text: string): number | undefined {
  // "X일차" 또는 "X일째"
  const koMatch = text.match(/(\d{1,2})\s*일\s*(차|째)/);
  if (koMatch) return parseInt(koMatch[1], 10);
  // "Day X"
  const enMatch = text.match(/day\s*(\d{1,2})/i);
  if (enMatch) return parseInt(enMatch[1], 10);
  return undefined;
}

/** raw_text 에 stop order 가 명시되어 있으면 추출 (예: "3번째", "stop 4") */
function extractStopOrder(text: string): number | undefined {
  const koMatch = text.match(/(\d{1,2})\s*번\s*째/);
  if (koMatch) return parseInt(koMatch[1], 10);
  const enMatch = text.match(/stop\s*(\d{1,2})/i);
  if (enMatch) return parseInt(enMatch[1], 10);
  return undefined;
}

/** 키워드 중 첫 매칭 반환 */
function firstKeywordMatch(text: string, keywords: readonly string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const k of keywords) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  return undefined;
}

/** safe — 빈 입력 / null / undefined / 비-string 전부 'no_change' 반환 */
function emptyResult(rawText: string, reason: string): ClassifiedModification {
  return {
    intent: 'no_change',
    raw_text: rawText ?? '',
    confidence: 0,
    fallback_reason: reason,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 메인 분류 함수
// ─────────────────────────────────────────────────────────────────────

/**
 * 사용자의 수정 요청 텍스트를 분류한다.
 *
 * @param rawText 사용자 freeText / revision 입력
 * @param _currentItinerary 현재 plan itinerary (향후 context-aware 분류용). 미사용.
 * @returns ClassifiedModification — invalid input 에도 throw 금지, no_change 반환.
 */
export function classifyModification(
  rawText: string | null | undefined,
  _currentItinerary?: unknown,
): ClassifiedModification {
  // Safe guard — invalid input
  if (typeof rawText !== 'string') {
    return emptyResult('', 'non-string input');
  }
  const text = rawText.trim();
  if (text.length === 0) {
    return emptyResult(rawText, 'empty input');
  }
  if (text.length > 1000) {
    return emptyResult(rawText, 'input too long (>1000 chars)');
  }

  const dayIndex = extractDayIndex(text);
  const stopOrder = extractStopOrder(text);

  // 1. stop_remove — 명확한 제거 의도 우선 처리 (다른 trigger 와 겹쳐도 remove 가 우선)
  const removeTrigger = firstKeywordMatch(text, STOP_REMOVE_TRIGGERS);
  if (removeTrigger) {
    const stopName = firstKeywordMatch(text, KNOWN_STOPS);
    return {
      intent: 'stop_remove',
      target: {
        day_index: dayIndex,
        stop_order: stopOrder,
        stop_name: stopName,
      },
      raw_text: rawText,
      confidence: stopName || stopOrder ? 0.85 : 0.6,
    };
  }

  // 2. stop_add — 추가 + 알려진 stop 매칭
  const addTrigger = firstKeywordMatch(text, STOP_ADD_TRIGGERS);
  const knownStop = firstKeywordMatch(text, KNOWN_STOPS);
  if (addTrigger && knownStop) {
    return {
      intent: 'stop_add',
      target: {
        day_index: dayIndex,
        stop_order: stopOrder,
        stop_name: knownStop,
      },
      raw_text: rawText,
      confidence: 0.85,
    };
  }

  // 3. stop_swap — '다른/교체' + category (식당/카페/...)
  const swapTrigger = firstKeywordMatch(text, STOP_SWAP_TRIGGERS);
  const swapCategory = firstKeywordMatch(text, STOP_SWAP_CATEGORIES);
  if (swapTrigger && swapCategory) {
    return {
      intent: 'stop_swap',
      target: {
        day_index: dayIndex,
        stop_order: stopOrder,
        stop_name: swapCategory, // 카테고리 정보 — block-decompose 가 매칭
      },
      raw_text: rawText,
      confidence: 0.75,
    };
  }

  // 4. block_swap — zone / 활동 keyword 매칭 (day 명시 여부 무관)
  const zoneKeyword = firstKeywordMatch(text, BLOCK_SWAP_KEYWORDS);
  if (zoneKeyword) {
    return {
      intent: 'block_swap',
      target: {
        day_index: dayIndex,
        // block_id 는 ai-planner 가 zone keyword 로 lookup (PR-B)
      },
      raw_text: rawText,
      confidence: dayIndex ? 0.8 : 0.55,
    };
  }

  // 5. add 만 있고 known stop 없음 → 약한 신호로 stop_add 처리 (LLM fallback 후보)
  if (addTrigger) {
    return {
      intent: 'stop_add',
      target: { day_index: dayIndex, stop_order: stopOrder },
      raw_text: rawText,
      confidence: 0.4,
      fallback_reason: 'add trigger 있지만 known stop 매칭 안 됨 — LLM fallback 권장',
    };
  }

  // 6. swap 만 있고 category 없음 → 약한 신호로 stop_swap
  if (swapTrigger) {
    return {
      intent: 'stop_swap',
      target: { day_index: dayIndex, stop_order: stopOrder },
      raw_text: rawText,
      confidence: 0.4,
      fallback_reason: 'swap trigger 있지만 category 매칭 안 됨 — LLM fallback 권장',
    };
  }

  // 매칭 안 됨
  return emptyResult(rawText, 'no keyword match');
}
