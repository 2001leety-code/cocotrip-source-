/**
 * Vercel API Route: AI Planner Modify (P128, 2026-05-21)
 * POST /api/ai-planner-modify
 *
 * 사용자가 기존 plan 에 대해 follow-up 수정을 요청할 때 사용. 전체 plan 을 재생성
 * 하지 않고 fine-grained 변경만 수행 (block_swap / stop_swap / stop_add / stop_remove).
 *
 * Flow:
 *   1. Authorization: Bearer <Firebase ID token> 검증
 *   2. body { planId, request_text, day_index? } 파싱
 *   3. plan 소유권 확인 (plan.uid === auth.uid 또는 plan.guestEmail === auth.email)
 *   4. intent classify (rule-based + Gemini 폴백 confidence < 0.5)
 *   5. intent 별 mutator 적용 (block_swap / stop_swap / stop_add / stop_remove)
 *   6. validatePatternStructure 재실행 — 실패 시 mutator 결과 rollback
 *   7. Firestore plan 업데이트 (itinerary 만 교체)
 *
 * SAFETY-CRITICAL (CLAUDE.md J — dietary):
 *   - stop_swap / stop_add 가 dietary 위반 식당으로 교체 시 → reject 422
 *   - block_swap 결과 block 이 dietary_options 호환 X → reject 422
 *
 * NOTE: revision (전체 재생성) 와 다름 — revision 은 별도 결제 + 전체 Gemini 재호출,
 *       modify 는 무료 + 부분 mutation. modifyCount 별도 카운트.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import {
  fetchAvailableBlocks,
  expandBlocksToItinerary,
  matchFoodPlaceholder,
  markReturnToAirport,
} from './_ai_core/blockMode.js';
import { loadFoodIndex } from './_ai_core/geminiPipeline.js';
import { backfillStopEndTimes } from './_ai_core/planPersister.js';
import { validatePatternStructure } from './_ai_core/responseValidator.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const _ok = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR', extra) => ({ ok: false, error: msg, code, ...extra });

const adminDb = initAdminDb('ai-planner-modify');

// ─────────────────────────────────────────────────────────────────────
// Rule-based classifier (server-side mirror of src/ai_planner/intent-classifier.ts).
// 서버에서 직접 호출하기 위한 simplified copy — TypeScript 파일을 server 에서
// 직접 import 못해서 동일 규칙을 JS 로 재구현. 5개 intent + keyword 사전 동일.
// ─────────────────────────────────────────────────────────────────────

const BLOCK_SWAP_KEYWORDS = [
  'DMZ', 'dmz', '비무장지대',
  '트레킹', '트래킹', 'trekking',
  '북한산', '관악산', '도봉산', '청계산',
  '러닝', 'running', '뛰는', '조깅',
  '자전거', 'cycling', '바이크',
  '강남', '명동', '홍대', '이태원', '인사동', '종로',
  '부산', '제주', '경주',
  'mountain', 'hike', 'beach',
];
const STOP_SWAP_TRIGGERS = ['다른', '교체', '바꿔', '바꿀', '변경', 'change', 'swap', 'different', 'replace'];
const STOP_SWAP_CATEGORIES = [
  '식당', '음식점', '맛집', '레스토랑', 'restaurant',
  '카페', 'cafe',
  '쇼핑', 'shopping',
  '명소', 'attraction',
];
const STOP_ADD_TRIGGERS = ['추가', '끼워', '넣어', '포함', '같이', 'add', 'include', 'insert'];
const KNOWN_STOPS = [
  'N서울타워', '남산타워', 'N seoul tower', 'namsan tower',
  '경복궁', '창덕궁', '덕수궁',
  '광장시장', '동대문', '명동성당',
  '한강', '여의도',
  '롯데월드', '에버랜드',
];
const STOP_REMOVE_TRIGGERS = ['빼', '제거', '취소', '삭제', '없애', 'remove', 'cancel', 'delete', 'skip'];

function extractDayIndex(text) {
  const m1 = text.match(/(\d{1,2})\s*일\s*(차|째)/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = text.match(/day\s*(\d{1,2})/i);
  if (m2) return parseInt(m2[1], 10);
  return undefined;
}
function extractStopOrder(text) {
  const m1 = text.match(/(\d{1,2})\s*번\s*째/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = text.match(/stop\s*(\d{1,2})/i);
  if (m2) return parseInt(m2[1], 10);
  return undefined;
}
function firstKeywordMatch(text, keywords) {
  const lower = String(text || '').toLowerCase();
  for (const k of keywords) {
    if (lower.includes(String(k).toLowerCase())) return k;
  }
  return undefined;
}

export function classifyModification(rawText) {
  if (typeof rawText !== 'string') {
    return { intent: 'no_change', raw_text: '', confidence: 0, fallback_reason: 'non-string input' };
  }
  const text = rawText.trim();
  if (text.length === 0) return { intent: 'no_change', raw_text: rawText, confidence: 0, fallback_reason: 'empty input' };
  if (text.length > 1000) return { intent: 'no_change', raw_text: rawText, confidence: 0, fallback_reason: 'input too long' };

  const dayIndex = extractDayIndex(text);
  const stopOrder = extractStopOrder(text);

  const removeTrigger = firstKeywordMatch(text, STOP_REMOVE_TRIGGERS);
  if (removeTrigger) {
    const stopName = firstKeywordMatch(text, KNOWN_STOPS);
    return {
      intent: 'stop_remove',
      target: { day_index: dayIndex, stop_order: stopOrder, stop_name: stopName },
      raw_text: rawText,
      confidence: stopName || stopOrder ? 0.85 : 0.6,
    };
  }
  const addTrigger = firstKeywordMatch(text, STOP_ADD_TRIGGERS);
  const knownStop = firstKeywordMatch(text, KNOWN_STOPS);
  if (addTrigger && knownStop) {
    return {
      intent: 'stop_add',
      target: { day_index: dayIndex, stop_order: stopOrder, stop_name: knownStop },
      raw_text: rawText,
      confidence: 0.85,
    };
  }
  const swapTrigger = firstKeywordMatch(text, STOP_SWAP_TRIGGERS);
  const swapCategory = firstKeywordMatch(text, STOP_SWAP_CATEGORIES);
  if (swapTrigger && swapCategory) {
    return {
      intent: 'stop_swap',
      target: { day_index: dayIndex, stop_order: stopOrder, stop_name: swapCategory },
      raw_text: rawText,
      confidence: 0.75,
    };
  }
  const zoneKeyword = firstKeywordMatch(text, BLOCK_SWAP_KEYWORDS);
  if (zoneKeyword) {
    return {
      intent: 'block_swap',
      target: { day_index: dayIndex, stop_name: zoneKeyword },
      raw_text: rawText,
      confidence: dayIndex ? 0.8 : 0.55,
    };
  }
  if (addTrigger) {
    return {
      intent: 'stop_add',
      target: { day_index: dayIndex, stop_order: stopOrder },
      raw_text: rawText,
      confidence: 0.4,
      fallback_reason: 'add trigger 있지만 known stop 없음',
    };
  }
  if (swapTrigger) {
    return {
      intent: 'stop_swap',
      target: { day_index: dayIndex, stop_order: stopOrder },
      raw_text: rawText,
      confidence: 0.4,
      fallback_reason: 'swap trigger 있지만 category 매칭 안 됨',
    };
  }
  return { intent: 'no_change', raw_text: rawText, confidence: 0, fallback_reason: 'no keyword match' };
}

// ─────────────────────────────────────────────────────────────────────
// Gemini fallback (confidence < 0.5)
// ─────────────────────────────────────────────────────────────────────

async function llmClassify(rawText, apiKey, hintDayIndex) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
    },
  });
  const system = `You are CocoTrip's modification intent classifier. Classify into 5 intents. JSON only.

Schema: { "intent": "block_swap|stop_swap|stop_add|stop_remove|no_change", "target": {"day_index":1,"stop_order":3,"block_id":"...","stop_name":"...","stop_address":"..."}, "confidence": 0.85, "fallback_reason": "..." }

Intents:
- block_swap: replace whole day (DMZ/강남/북한산 zone change)
- stop_swap: change 1 stop with similar category
- stop_add: add new stop
- stop_remove: remove stop
- no_change: ambiguous / off-topic

Confidence 0-1. day_index 1-based. stop_order 1-based.`;
  const user = JSON.stringify({ user_request_text: String(rawText || '').slice(0, 1000), hint_day_index: hintDayIndex });

  const callPromise = model.generateContent({
    contents: [{ role: 'user', parts: [{ text: user }] }],
    systemInstruction: { role: 'system', parts: [{ text: system }] },
  });
  const result = await Promise.race([
    callPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('LLM classify timeout')), 12000)),
  ]);
  // 사용량 실측 기록(비용 가시화 2026-07-09) — fire-and-forget, 실패해도 본 흐름 영향 0.
  import('./_shared/apiUsageRecorder.js').then((m) => m.recordUsageFromResponse('planner-modify', 'gemini-2.5-flash-lite', result?.response)).catch(() => {});
  const raw = result?.response?.text?.()?.trim() || '';
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const ALLOWED = ['block_swap', 'stop_swap', 'stop_add', 'stop_remove', 'no_change'];
  const intent = ALLOWED.includes(parsed?.intent) ? parsed.intent : 'no_change';
  let confidence = Number(parsed?.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));
  const target = {};
  if (parsed?.target && typeof parsed.target === 'object') {
    if (Number.isFinite(parsed.target.day_index)) target.day_index = Math.max(1, Math.min(30, Math.floor(parsed.target.day_index)));
    if (Number.isFinite(parsed.target.stop_order)) target.stop_order = Math.max(1, Math.min(30, Math.floor(parsed.target.stop_order)));
    if (typeof parsed.target.block_id === 'string') target.block_id = parsed.target.block_id.slice(0, 80);
    if (typeof parsed.target.stop_name === 'string') target.stop_name = parsed.target.stop_name.slice(0, 200);
    if (typeof parsed.target.stop_address === 'string') target.stop_address = parsed.target.stop_address.slice(0, 300);
  }
  return {
    intent,
    target: Object.keys(target).length > 0 ? target : undefined,
    raw_text: rawText,
    confidence,
    fallback_reason: typeof parsed?.fallback_reason === 'string' ? String(parsed.fallback_reason).slice(0, 200) : undefined,
    source: 'llm',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Mutators
// ─────────────────────────────────────────────────────────────────────

// 식당/stop 의 dietary 태그 정규화 — blockMode.js 의 dietaryTagsOf 와 동일 규칙.
// 프로덕션 _food_index.json 은 식이태그를 r.tag (단일 문자열, 예 "halal") 에 저장하고
// r.dietary_tags 는 없다 (build-food-index.js). 일부 mock/legacy 데이터·기존 plan stop 은
// dietary_tags(배열) 만 가진다. ⚠️ SAFETY (CLAUDE.md J): 둘 다 읽지 않으면 stop_swap 이
// matchFoodPlaceholder 로 정상 hard-filter 한 halal/vegan 식당을 checkDietary 가 태그 0으로 보고
// false-reject → 식이 손님 수정이 사실상 불가했다. tag(문자열)·dietary_tags(배열) 모두 소문자 배열로.
function dietaryTagsOf(stop) {
  if (!stop || typeof stop !== 'object') return [];
  const out = [];
  const dt = stop.dietary_tags;
  if (Array.isArray(dt)) out.push(...dt);
  else if (dt) out.push(dt);
  const tg = stop.tag;
  if (Array.isArray(tg)) out.push(...tg);
  else if (tg) out.push(tg);
  return out.map((t) => String(t).toLowerCase());
}

export function checkDietary(stop, dietPrefs) {
  const dietCritical = (dietPrefs || []).filter((d) => /halal|vegan|vegetarian/i.test(String(d || '')));
  if (dietCritical.length === 0) return { ok: true };
  const tags = dietaryTagsOf(stop); // r.tag(문자열) + dietary_tags(배열) 둘 다 — SAFETY
  for (const d of dietCritical) {
    if (!tags.includes(String(d).toLowerCase())) {
      return { ok: false, missing: d };
    }
  }
  return { ok: true };
}

/**
 * block_swap — Day 의 모든 stops 를 새 block 의 stops 로 교체.
 */
async function applyBlockSwap({ itinerary, classified, dietPrefs, language, city, area, foodIndex }) {
  const dayIndex = classified.target?.day_index;
  if (!dayIndex || dayIndex < 1) {
    return { ok: false, code: 'MISSING_DAY_INDEX', message: 'Specify a day index (e.g. "Day 2") to swap.' };
  }
  if (!Array.isArray(itinerary?.days) || dayIndex > itinerary.days.length) {
    return { ok: false, code: 'INVALID_DAY', message: `Day ${dayIndex} does not exist in plan.` };
  }
  // 후보 blocks 가져오기 (city 의 city_day blocks)
  const blocks = await fetchAvailableBlocks(adminDb, city, { dietaryRequired: dietPrefs });
  if (blocks.length === 0) {
    return { ok: false, code: 'NO_BLOCKS', message: `No alternative blocks available for ${city}.` };
  }
  // keyword 로 block 선택 — stop_name 에 zone keyword 들어있으면 우선 매칭.
  const keyword = String(classified.target?.stop_name || classified.target?.block_id || '').toLowerCase();
  let chosen = null;
  if (keyword) {
    chosen = blocks.find((b) => String(b.zone || '').toLowerCase().includes(keyword)
      || String(b.theme || '').toLowerCase().includes(keyword)
      || String(b.id || '').toLowerCase().includes(keyword));
  }
  if (!chosen) {
    // current day 와 다른 block 우선 (intensity 다양성).
    const currentBlockId = itinerary.days[dayIndex - 1]?.source_block_id;
    const diff = blocks.filter((b) => b.id !== currentBlockId);
    chosen = diff[0] || blocks[0];
  }
  // 단일 day expand
  const selections = { day_selections: [{ day: dayIndex, block_id: chosen.id, tweak_notes: classified.raw_text.slice(0, 200) }] };
  const partial = expandBlocksToItinerary(selections, blocks, { durationDays: 1, dietPrefs, language, area, foodIndex });
  const newDay = partial.days[0];
  if (!newDay) return { ok: false, code: 'EXPAND_FAILED', message: 'Block expansion failed.' };
  // preserve day.date / day.day from original.
  newDay.day = dayIndex;
  newDay.date = itinerary.days[dayIndex - 1].date;
  // food stop 의 dietary 마지막 확인 (defense-in-depth).
  for (const s of (newDay.stops || [])) {
    if (s.category === 'food') {
      const dietCheck = checkDietary(s, dietPrefs);
      if (!dietCheck.ok) {
        return { ok: false, code: 'DIETARY_UNSATISFIED', message: `Dietary preference (${dietCheck.missing}) not met after block swap.` };
      }
    }
  }
  itinerary.days[dayIndex - 1] = newDay;
  return { ok: true, intent: 'block_swap', day: dayIndex, block_id: chosen.id };
}

/**
 * stop_swap — Day 의 특정 stop 1개를 다른 식당/카페로 교체.
 */
export function applyStopSwap({ itinerary, classified, dietPrefs, foodIndex, area }) {
  const dayIndex = classified.target?.day_index;
  const stopOrder = classified.target?.stop_order;
  const categoryHint = String(classified.target?.stop_name || '').toLowerCase(); // e.g. '식당' / 'cafe'
  if (!dayIndex || !Array.isArray(itinerary?.days) || dayIndex > itinerary.days.length) {
    return { ok: false, code: 'INVALID_DAY', message: `Specify a valid day index.` };
  }
  const day = itinerary.days[dayIndex - 1];
  const stops = Array.isArray(day.stops) ? day.stops : [];
  let targetIdx = -1;
  if (stopOrder) {
    targetIdx = stops.findIndex((s) => s.order === stopOrder);
  }
  if (targetIdx === -1 && categoryHint) {
    // category hint 로 첫 matching stop 찾기
    const isCafe = /cafe|카페/i.test(categoryHint);
    const isFood = !isCafe && /식당|음식점|맛집|레스토랑|restaurant|food/i.test(categoryHint);
    if (isCafe || isFood) {
      targetIdx = stops.findIndex((s) => s.category === 'food');
    }
  }
  if (targetIdx === -1) {
    return { ok: false, code: 'STOP_NOT_FOUND', message: `No matching stop found in Day ${dayIndex}.` };
  }
  const oldStop = stops[targetIdx];
  if (oldStop.category !== 'food') {
    return { ok: false, code: 'UNSUPPORTED', message: 'stop_swap currently supports food stops only (P128 v1).' };
  }
  // foodIndex 에서 동일 동선 (city) + dietary 호환 식당 1개 선택. 기존 stop name 제외.
  const placeholderStop = {
    placeholder: 'verified_lunch',
    preferred_dietary: [],
  };
  const matched = matchFoodPlaceholder(placeholderStop, foodIndex, area, dietPrefs);
  if (!matched) {
    return { ok: false, code: 'NO_ALTERNATIVE', message: 'No alternative restaurant found matching your preferences.' };
  }
  if (matched.name === oldStop.name) {
    // 동일 식당 매칭 — index 의 다른 후보 찾기. 간단 retry: filter out then re-pick.
    const filtered = (Array.isArray(foodIndex) ? foodIndex : []).filter((r) => r && r.name !== oldStop.name);
    const matched2 = matchFoodPlaceholder(placeholderStop, filtered, area, dietPrefs);
    if (!matched2) {
      return { ok: false, code: 'NO_ALTERNATIVE', message: 'Only the same restaurant was available.' };
    }
    Object.assign(matched, matched2);
  }
  // mutate stop in place — preserve order/start_time/stay_min.
  // ⚠️ SAFETY (CLAUDE.md J): 프로덕션 _food_index.json 은 식이태그를 matched.tag(단일 문자열) 에
  // 저장하고 matched.dietary_tags 는 없다. dietaryTagsOf 로 tag·dietary_tags 둘 다 정규화해 승격
  // 해야 직후 checkDietary 가 halal/vegan 적합 식당을 인식한다 (이전엔 oldStop.dietary_tags 폴백 →
  // oldStop 에 식이태그 없으면 정상 교체인데 DIETARY_UNSATISFIED false-reject).
  const matchedTags = dietaryTagsOf(matched);
  const swapped = {
    ...oldStop,
    name: matched.name || oldStop.name,
    display_name: matched.display_name || matched.name_en || matched.name,
    address: matched.address || oldStop.address,
    verified: true,
    dietary_tags: matchedTags.length > 0 ? matchedTags : oldStop.dietary_tags,
    tag: matched.tag || oldStop.tag, // 프로덕션 원본 필드 보존 (downstream 일관성)
    tip: matched.tip || oldStop.tip,
    personalization_reasoning: `Swap (user-requested): ${classified.raw_text.slice(0, 60)}`,
  };
  const dietCheck = checkDietary(swapped, dietPrefs);
  if (!dietCheck.ok) {
    return { ok: false, code: 'DIETARY_UNSATISFIED', message: `Dietary preference (${dietCheck.missing}) not met by candidate.` };
  }
  stops[targetIdx] = swapped;
  return { ok: true, intent: 'stop_swap', day: dayIndex, stop_order: swapped.order, name: swapped.name };
}

/**
 * stop_add — Day 에 새 stop 추가. order 자동 재할당.
 */
function applyStopAdd({ itinerary, classified }) {
  const dayIndex = classified.target?.day_index;
  if (!dayIndex || !Array.isArray(itinerary?.days) || dayIndex > itinerary.days.length) {
    return { ok: false, code: 'INVALID_DAY', message: `Specify a valid day index.` };
  }
  const day = itinerary.days[dayIndex - 1];
  const stops = Array.isArray(day.stops) ? day.stops : [];
  if (stops.length >= 8) {
    return { ok: false, code: 'DAY_FULL', message: `Day ${dayIndex} already has 8 stops (max).` };
  }
  const stopName = String(classified.target?.stop_name || '').trim();
  if (!stopName) {
    return { ok: false, code: 'MISSING_STOP_NAME', message: 'Specify the place name to add.' };
  }
  // Insert before last lodging stop (preserve lodging bookend).
  const lastLodgingIdx = (() => {
    for (let i = stops.length - 1; i >= 0; i--) {
      if (stops[i]?.category === 'lodging') return i;
    }
    return stops.length;
  })();
  const newStop = {
    order: lastLodgingIdx + 1, // will be renumbered
    start_time: stops[lastLodgingIdx - 1]?.start_time
      ? addOneHour(stops[lastLodgingIdx - 1].start_time)
      : '16:00',
    name: stopName,
    display_name: stopName,
    category: 'culture',
    address: String(classified.target?.stop_address || '').slice(0, 300) || '',
    stay_min: 60,
    entry_fee_krw: 0,
    reservation_required: false,
    local_tag: '',
    tip: '',
    personalization_reasoning: `Added (user-requested): ${classified.raw_text.slice(0, 60)}`,
  };
  // insert before last lodging.
  stops.splice(lastLodgingIdx, 0, newStop);
  // renumber order.
  for (let i = 0; i < stops.length; i++) stops[i].order = i + 1;
  return { ok: true, intent: 'stop_add', day: dayIndex, name: stopName };
}

function addOneHour(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '16:00';
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const total = (h * 60 + min + 60) % (24 * 60);
  const oh = Math.floor(total / 60);
  const om = total % 60;
  return `${String(oh).padStart(2, '0')}:${String(om).padStart(2, '0')}`;
}

/**
 * stop_remove — Day 의 stop 1개 제거. order 재할당.
 */
function applyStopRemove({ itinerary, classified }) {
  const dayIndex = classified.target?.day_index;
  if (!dayIndex || !Array.isArray(itinerary?.days) || dayIndex > itinerary.days.length) {
    return { ok: false, code: 'INVALID_DAY', message: `Specify a valid day index.` };
  }
  const day = itinerary.days[dayIndex - 1];
  const stops = Array.isArray(day.stops) ? day.stops : [];
  const stopOrder = classified.target?.stop_order;
  const stopName = classified.target?.stop_name;
  let targetIdx = -1;
  if (stopOrder) targetIdx = stops.findIndex((s) => s.order === stopOrder);
  if (targetIdx === -1 && stopName) {
    targetIdx = stops.findIndex((s) => (s.name || '').includes(stopName) || (s.display_name || '').toLowerCase().includes(String(stopName).toLowerCase()));
  }
  if (targetIdx === -1) {
    return { ok: false, code: 'STOP_NOT_FOUND', message: `Cannot find stop matching "${stopName || `order ${stopOrder}`}".` };
  }
  // protect lodging bookend — block removing first/last lodging stop.
  const stop = stops[targetIdx];
  if (stop.category === 'lodging' && (targetIdx === 0 || targetIdx === stops.length - 1)) {
    return { ok: false, code: 'PROTECTED', message: 'Cannot remove first/last lodging stop (bookend protection).' };
  }
  // require min 4 stops post-removal (CLAUDE.md MIN STOPS rule).
  if (stops.length <= 4) {
    return { ok: false, code: 'TOO_FEW_STOPS', message: `Day ${dayIndex} would have fewer than 4 stops after removal.` };
  }
  stops.splice(targetIdx, 1);
  for (let i = 0; i < stops.length; i++) stops[i].order = i + 1;
  return { ok: true, intent: 'stop_remove', day: dayIndex, removed: stop.name };
}

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────

/**
 * P130 (2026-05-21) — intent classifier 로그 저장. fire-and-forget.
 * Firestore `intent_classifier_logs/{logId}` 컬렉션. Admin only read (rules).
 *
 * 호출 응답 차단 X — 실패해도 사용자 modify 흐름 영향 없음.
 *
 * schema:
 *   ts, uid, email, plan_id, raw_text, language,
 *   rule_intent, rule_confidence, used_llm_fallback,
 *   llm_intent, llm_confidence, final_intent, final_confidence,
 *   classifier_source ('rule'|'llm'), mutator_success, mutator_error,
 *   mutator_code, elapsed_ms
 */
function logIntentClassifierAsync(payload) {
  if (!adminDb) return;
  try {
    const doc = {
      ts: new Date().toISOString(),
      uid: payload.uid || null,
      email: payload.email || null,
      plan_id: payload.plan_id || null,
      raw_text: String(payload.raw_text || '').slice(0, 1000),
      language: payload.language || null,
      rule_intent: payload.rule_intent || 'no_change',
      rule_confidence: typeof payload.rule_confidence === 'number'
        ? Math.max(0, Math.min(1, payload.rule_confidence))
        : 0,
      used_llm_fallback: !!payload.used_llm_fallback,
      llm_intent: payload.llm_intent || null,
      llm_confidence: typeof payload.llm_confidence === 'number'
        ? Math.max(0, Math.min(1, payload.llm_confidence))
        : null,
      final_intent: payload.final_intent || 'no_change',
      final_confidence: typeof payload.final_confidence === 'number'
        ? Math.max(0, Math.min(1, payload.final_confidence))
        : null,
      classifier_source: payload.classifier_source === 'llm' ? 'llm' : 'rule',
      mutator_success: !!payload.mutator_success,
      mutator_error: payload.mutator_error
        ? String(payload.mutator_error).slice(0, 300)
        : null,
      mutator_code: payload.mutator_code || null,
      elapsed_ms: typeof payload.elapsed_ms === 'number'
        ? Math.max(0, Math.floor(payload.elapsed_ms))
        : null,
    };
    // fire-and-forget — never block caller. swallow all errors (no telegram —
    // log write 실패가 prod alert flood 가 되면 곤란하다).
    adminDb.collection('intent_classifier_logs').add(doc).catch((err) => {
      console.warn('[ai-planner-modify] log write failed:', err?.message || err);
    });
  } catch (err) {
    console.warn('[ai-planner-modify] log preparation failed:', err?.message || err);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method Not Allowed', 'METHOD_NOT_ALLOWED')));
  }

  // P130: track timing for monitoring. captured even on early-return paths.
  const _startedAt = Date.now();

  try {
    if (!adminDb) {
      res.writeHead(500, JSON_CORS);
      return res.end(JSON.stringify(_err('Firestore not configured', 'CONFIG_ERROR')));
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const auth = await verifyUserToken(req);
    if (!auth.ok) {
      res.writeHead(auth.status, JSON_CORS);
      return res.end(JSON.stringify(_err(auth.error, 'AUTH_REQUIRED')));
    }

    const planId = String(body.planId || '').trim();
    const requestText = String(body.request_text || body.requestText || '').slice(0, 1000);
    const hintDayIndex = Number.isFinite(body.day_index) ? Math.floor(body.day_index) : undefined;
    if (!planId || !requestText) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('planId + request_text required', 'MISSING_FIELDS')));
    }

    const docRef = adminDb.collection('plans').doc(planId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      res.writeHead(404, JSON_CORS);
      return res.end(JSON.stringify(_err('Plan not found', 'NOT_FOUND')));
    }
    const planData = docSnap.data() || {};
    // ownership check
    const ownerUid = planData.uid || null;
    const ownerEmail = String(planData.guestEmail || '').toLowerCase();
    const isOwner = (ownerUid && ownerUid === auth.uid) || (ownerEmail && ownerEmail === auth.email);
    if (!isOwner) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err('You do not own this plan', 'FORBIDDEN')));
    }

    const itinerary = planData.itinerary;
    if (!itinerary || !Array.isArray(itinerary.days)) {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Plan has no itinerary', 'INVALID_PLAN')));
    }

    // ── classify intent (P130 — track rule + LLM split for monitoring)
    const ruleClassified = classifyModification(requestText);
    if (typeof hintDayIndex === 'number' && !ruleClassified.target?.day_index) {
      ruleClassified.target = { ...(ruleClassified.target || {}), day_index: hintDayIndex };
    }
    let classified = ruleClassified;
    let llmRes = null;
    if (ruleClassified.confidence < 0.5) {
      try {
        const apiKey = (process.env.GEMINI_API_KEY || '').trim();
        if (apiKey) {
          llmRes = await llmClassify(requestText, apiKey, hintDayIndex);
          if (llmRes && llmRes.confidence > ruleClassified.confidence) {
            classified = llmRes;
          }
        }
      } catch (llmErr) {
        // graceful — rule-based 결과 그대로 진행
        console.warn('[ai-planner-modify] LLM classify failed:', llmErr?.message || llmErr);
      }
    }
    const usedLlmFallback = ruleClassified.confidence < 0.5;
    // P130 — language used for both logging + downstream block-mode call.
    const language = planData.input?.language || 'en';

    if (classified.intent === 'no_change' || classified.confidence < 0.3) {
      // P130 — log intent_unclear case too (rule classifier 정확도 감지).
      logIntentClassifierAsync({
        uid: auth.uid,
        email: auth.email,
        plan_id: planId,
        raw_text: requestText,
        language,
        rule_intent: ruleClassified.intent,
        rule_confidence: ruleClassified.confidence,
        used_llm_fallback: usedLlmFallback,
        llm_intent: llmRes ? llmRes.intent : null,
        llm_confidence: llmRes ? llmRes.confidence : null,
        final_intent: classified.intent,
        final_confidence: classified.confidence,
        classifier_source: classified.source || 'rule',
        mutator_success: false,
        mutator_error: 'INTENT_UNCLEAR',
        mutator_code: 'INTENT_UNCLEAR',
        elapsed_ms: Date.now() - _startedAt,
      });
      res.writeHead(422, JSON_CORS);
      return res.end(JSON.stringify(_err(
        'Could not understand modification — please be more specific (e.g. "Day 2 add N서울타워", "remove 인사동").',
        'INTENT_UNCLEAR',
        { intent: classified.intent, confidence: classified.confidence, fallback_reason: classified.fallback_reason },
      )));
    }

    // ── snapshot for rollback
    const originalDaysJson = JSON.stringify(itinerary.days);
    const dietPrefs = Array.isArray(planData.input?.dietary)
      ? planData.input.dietary
      : (Array.isArray(planData.input?.dietPrefs) ? planData.input.dietPrefs : []);
    // language already declared above for P130 logging — reuse.
    const area = String(planData.input?.area || '').trim() || (Array.isArray(planData.input?.regions) ? planData.input.regions[0] : '') || '';
    const city = String(area).split('_')[0].toLowerCase();
    let foodIndex = [];
    try { foodIndex = await loadFoodIndex(); } catch {}

    // ── apply mutator
    let mutResult;
    if (classified.intent === 'block_swap') {
      mutResult = await applyBlockSwap({ itinerary, classified, dietPrefs, language, city, area, foodIndex });
    } else if (classified.intent === 'stop_swap') {
      mutResult = applyStopSwap({ itinerary, classified, dietPrefs, foodIndex, area: city });
    } else if (classified.intent === 'stop_add') {
      mutResult = applyStopAdd({ itinerary, classified });
    } else if (classified.intent === 'stop_remove') {
      mutResult = applyStopRemove({ itinerary, classified });
    } else {
      res.writeHead(422, JSON_CORS);
      return res.end(JSON.stringify(_err('Unsupported intent', 'UNSUPPORTED_INTENT')));
    }

    if (!mutResult || !mutResult.ok) {
      // rollback (should be safe since we only mutated days)
      try { itinerary.days = JSON.parse(originalDaysJson); } catch {}
      // P130 — log mutator failure for monitoring.
      logIntentClassifierAsync({
        uid: auth.uid,
        email: auth.email,
        plan_id: planId,
        raw_text: requestText,
        language,
        rule_intent: ruleClassified.intent,
        rule_confidence: ruleClassified.confidence,
        used_llm_fallback: usedLlmFallback,
        llm_intent: llmRes ? llmRes.intent : null,
        llm_confidence: llmRes ? llmRes.confidence : null,
        final_intent: classified.intent,
        final_confidence: classified.confidence,
        classifier_source: classified.source || 'rule',
        mutator_success: false,
        mutator_error: mutResult?.message || 'Mutation failed',
        mutator_code: mutResult?.code || 'MUTATION_FAILED',
        elapsed_ms: Date.now() - _startedAt,
      });
      res.writeHead(422, JSON_CORS);
      return res.end(JSON.stringify(_err(
        mutResult?.message || 'Mutation failed',
        mutResult?.code || 'MUTATION_FAILED',
      )));
    }

    // ── post-mutation validation. backfill end_time first.
    backfillStopEndTimes(itinerary);
    // 2026-07-03 B-15 backfill: 기존 저장된 block_mode plan 은 출국일 공항 stop/메타가
    // 구조적으로 없어(생성 당시 Gemini 파이프라인 스킵) 어떤 수정 요청이든 아래
    // validatePatternStructure 의 B-15 에 걸려 422 PATTERN_VIOLATION — 유료 고객 수정
    // 기능이 전면 고장이었다. 검증 전 메타를 backfill(검증 완화 아님 — 신규 생성분은
    // blockMode.js 가 동일 메타를 주입).
    if (itinerary.planner_pipeline === 'block_mode') {
      markReturnToAirport(itinerary, planData.input || {});
    }
    const patternErrors = validatePatternStructure(itinerary, {
      regions: Array.isArray(planData.input?.regions) ? planData.input.regions : [city],
      arrival_airport: planData.input?.arrival_airport || '',
      departure_airport: planData.input?.departure_airport || '',
      durationDays: itinerary.days.length,
    });
    if (patternErrors.length > 0) {
      // rollback
      try { itinerary.days = JSON.parse(originalDaysJson); } catch {}
      // P130 — log validation failure for monitoring (mutator 자체는 ok 였으나
      // validator 가 거부했음).
      logIntentClassifierAsync({
        uid: auth.uid,
        email: auth.email,
        plan_id: planId,
        raw_text: requestText,
        language,
        rule_intent: ruleClassified.intent,
        rule_confidence: ruleClassified.confidence,
        used_llm_fallback: usedLlmFallback,
        llm_intent: llmRes ? llmRes.intent : null,
        llm_confidence: llmRes ? llmRes.confidence : null,
        final_intent: classified.intent,
        final_confidence: classified.confidence,
        classifier_source: classified.source || 'rule',
        mutator_success: false,
        mutator_error: 'pattern_violation: ' + (patternErrors[0]?.code || patternErrors[0] || ''),
        mutator_code: 'PATTERN_VIOLATION',
        elapsed_ms: Date.now() - _startedAt,
      });
      res.writeHead(422, JSON_CORS);
      return res.end(JSON.stringify(_err(
        'Modification would break plan structure — request rejected.',
        'PATTERN_VIOLATION',
        { violations: patternErrors.slice(0, 5) },
      )));
    }

    // ── persist
    await docRef.set({
      itinerary,
      modifyCount: (planData.modifyCount || 0) + 1,
      lastModifiedAt: new Date().toISOString(),
      lastModifyIntent: classified.intent,
    }, { merge: true });

    // P130 — log successful mutation for monitoring.
    logIntentClassifierAsync({
      uid: auth.uid,
      email: auth.email,
      plan_id: planId,
      raw_text: requestText,
      language,
      rule_intent: ruleClassified.intent,
      rule_confidence: ruleClassified.confidence,
      used_llm_fallback: usedLlmFallback,
      llm_intent: llmRes ? llmRes.intent : null,
      llm_confidence: llmRes ? llmRes.confidence : null,
      final_intent: classified.intent,
      final_confidence: classified.confidence,
      classifier_source: classified.source || 'rule',
      mutator_success: true,
      mutator_error: null,
      mutator_code: null,
      elapsed_ms: Date.now() - _startedAt,
    });

    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({
      planId,
      intent: classified.intent,
      confidence: classified.confidence,
      classifierSource: classified.source || 'rule',
      result: mutResult,
    })));
  } catch (err) {
    console.error('[ai-planner-modify] UNHANDLED:', err?.message, err?.stack);
    if (!res.headersSent) {
      res.writeHead(err?.statusCode || 500, JSON_CORS);
      res.end(JSON.stringify(_err('Modification failed', err?.code || 'INTERNAL_ERROR', {
        details: err?.message || 'Unknown error',
      })));
    }
    captureError(err, { route: '/api/ai-planner-modify' }).catch(() => {});
    throttledTelegramAlert({
      key: 'ai-planner-modify-error',
      channel: 'error',
      severity: 'high',
      message: `🔴 <b>AI Planner Modify 실패</b>\n\n${err?.message || 'unknown'}`,
      context: { error: String(err?.message || '').slice(0, 200) },
    }).catch(() => {});
  }
}
