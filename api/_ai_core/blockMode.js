/**
 * blockMode.js — zone_courses 기반 block-mode planner pipeline (P128, 2026-05-21).
 *
 * 운영자가 사전 큐레이트한 day-block (zone_courses Firestore 컬렉션) 을 가지고
 * Gemini 가 block ID 만 선택 + 약간의 tweak 만 수행. Gemini 부하 1/10 + 검증된
 * 동선 동시 확보.
 *
 * 진입 조건:
 *   shouldUseBlockMode(city, durationDays, dietPrefs)
 *     - Firestore zone_courses where city == ? AND block_type == 'city_day'
 *     - count >= 3 이면 block-mode 가능. 부족하면 legacy path 로 폴백.
 *     - dietPrefs 가 비어있거나 (none) 또는 block 의 dietary_options 가 매칭 가능한
 *       경우만 (예: vegan plan + vegan block 없음 = block-mode 불가, legacy 폴백).
 *
 * Pipeline:
 *   1. fetchAvailableBlocks(city) — Firestore 에서 published city_day blocks 가져오기
 *   2. selectBlocksWithGemini(blocks, userInput, geminiClient) — Gemini 빠른 모델 호출.
 *      block ID 배열 (day 별) + tweak instructions 반환.
 *   3. expandBlocksToItinerary(blockSelections, blocks, userInput) — block stops 를
 *      itinerary.days[].stops[] 로 변환 + start_time 계산 + food placeholder 매칭.
 *
 * SAFETY-CRITICAL (CLAUDE.md J — dietary):
 *   - dietPrefs 가 있고 block dietary_options 가 매칭 안 되면 expand 단에서 throw.
 *   - food placeholder 매칭은 _food_index.json + preferred_dietary 매칭. 다중 후보 중
 *     dietary_tags 가 사용자 dietPrefs 와 일치하는 식당만 선택. 매칭 실패 시 throw.
 *
 * ENV flag PLANNER_BLOCK_MODE:
 *   - 'enabled' : 무조건 block-mode (블록 부족하면 throw)
 *   - 'disabled': 무조건 legacy (block-mode 비활성)
 *   - 'auto'    : shouldUseBlockMode 결과에 따라 결정 (기본값)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { repairAndParseJSON } from './responseValidator.js';

/** 기본 ENV mode — 운영자가 PLANNER_BLOCK_MODE 미설정 시 'auto' (자동 폴백). */
export function getBlockModeEnv() {
  const raw = String(process.env.PLANNER_BLOCK_MODE || '').trim().toLowerCase().replace(/[\r\n]/g, '');
  if (raw === 'enabled' || raw === 'disabled') return raw;
  return 'auto';
}

/**
 * Firestore 의 zone_courses 컬렉션에서 city 의 published city_day blocks 가져오기.
 *
 * @param {object} adminDb — Firebase Admin Firestore instance
 * @param {string} city — 'seoul' / 'busan' / ...
 * @param {object} [opts]
 * @param {string[]} [opts.dietaryRequired] — 사용자 dietPrefs. 매칭되는 block 만 반환.
 * @returns {Promise<Array<object>>}  blocks[] (raw Firestore doc data)
 */
export async function fetchAvailableBlocks(adminDb, city, opts = {}) {
  if (!adminDb || !city) return [];
  const cityLc = String(city).trim().toLowerCase();
  if (!cityLc) return [];

  try {
    const snap = await adminDb
      .collection('zone_courses')
      .where('city', '==', cityLc)
      .where('status', '==', 'published')
      .get();
    if (snap.empty) return [];

    let blocks = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (!data || typeof data !== 'object') return;
      // block_type 누락 시 default 'city_day' (backward compat — PR-A 의 schema 확장 전 block).
      const blockType = data.block_type || 'city_day';
      if (blockType !== 'city_day') return; // trekking / running_route 등은 별도 분기
      if (!Array.isArray(data.stops) || data.stops.length < 3) return; // 너무 적은 stops 는 invalid block
      blocks.push({ ...data, id: doc.id });
    });

    // dietPrefs 필터링 — SAFETY-CRITICAL (CLAUDE.md J).
    // halal / vegan / vegetarian 사용자는 block.dietary_options 에 그 옵션이 포함된 block 만 선택.
    const dietary = Array.isArray(opts.dietaryRequired) ? opts.dietaryRequired : [];
    const critical = dietary.filter((d) => /halal|vegan|vegetarian/i.test(String(d || '')));
    if (critical.length > 0) {
      blocks = blocks.filter((b) => {
        const opts2 = Array.isArray(b.dietary_options) ? b.dietary_options : [];
        return critical.every((d) => opts2.some((o) => String(o).toLowerCase() === String(d).toLowerCase()));
      });
    }

    return blocks;
  } catch (err) {
    // Firestore 인덱스 누락 또는 권한 오류 — graceful fallback (legacy path).
    console.warn('[blockMode] fetchAvailableBlocks failed:', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * block-mode 사용 가능 여부.
 *
 * @param {string} city
 * @param {number} durationDays
 * @param {string[]} dietPrefs
 * @param {Array<object>} availableBlocks — fetchAvailableBlocks 결과 (이미 dietary 필터 적용)
 * @returns {{eligible: boolean, reason: string}}
 */
export function shouldUseBlockMode(city, durationDays, dietPrefs, availableBlocks) {
  const env = getBlockModeEnv();
  if (env === 'disabled') return { eligible: false, reason: 'env_disabled' };

  const cityLc = String(city || '').trim().toLowerCase();
  if (!cityLc) return { eligible: false, reason: 'no_city' };
  const days = Number(durationDays) || 0;
  if (!Number.isFinite(days) || days < 1 || days > 14) {
    return { eligible: false, reason: 'invalid_duration' };
  }

  const blocks = Array.isArray(availableBlocks) ? availableBlocks : [];
  if (blocks.length < 3) {
    return { eligible: false, reason: `insufficient_blocks:${blocks.length}` };
  }

  // env=enabled 일 때는 강제. auto 면 조건 만족 시.
  if (env === 'enabled') return { eligible: true, reason: 'env_enabled' };
  return { eligible: true, reason: 'auto_eligible' };
}

/**
 * Gemini 빠른 모델 (2.5 flash) 로 block ID 선택 + tweak 받기.
 * 일반 legacy / 3-pass 보다 가볍게: block ID 배열 + per-day 변경 사유만 응답하면 OK.
 *
 * @param {Array<object>} blocks — available blocks
 * @param {object} userInput — { durationDays, styles, special_request, dietPrefs, language, ... }
 * @param {object} geminiClient — { apiKey, model? }
 * @returns {Promise<{ day_selections: Array<{day:number, block_id:string, tweak_notes?:string}>, language: string }>}
 */
export async function selectBlocksWithGemini(blocks, userInput, geminiClient) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('selectBlocksWithGemini: no blocks available');
  }
  if (!userInput || typeof userInput !== 'object') {
    throw new Error('selectBlocksWithGemini: userInput required');
  }
  if (!geminiClient || !geminiClient.apiKey) {
    throw new Error('selectBlocksWithGemini: geminiClient.apiKey required');
  }

  const durationDays = Math.max(1, Math.min(14, Number(userInput.durationDays) || 1));
  const styles = Array.isArray(userInput.styles) ? userInput.styles : [];
  const language = String(userInput.language || 'en');
  const specialRequest = String(userInput.special_request || '').slice(0, 800);
  const dietPrefs = Array.isArray(userInput.dietPrefs) ? userInput.dietPrefs : [];
  // P240 SAFETY-CRITICAL: allergies (Peanut/Nuts/Shellfish 등) block 선택 Gemini 에 명시 의무.
  // 알레르기 미입력 사용자 = [] (빈 배열) → prompt 에 field 생략 (정상).
  const allergies = Array.isArray(userInput.allergies) ? userInput.allergies : [];

  // 압축된 block 카드만 prompt 에 넣음 — Gemini 가 ID 만 선택하면 되므로 stops/transit 풀 detail X.
  const blockCards = blocks.map((b) => ({
    id: b.id,
    zone: b.zone,
    theme: b.theme,
    intensity: b.intensity,
    duration_min: b.duration_min,
    best_for: Array.isArray(b.best_for) ? b.best_for.slice(0, 6) : [],
    dietary_options: Array.isArray(b.dietary_options) ? b.dietary_options : [],
    stops_summary: Array.isArray(b.stops)
      ? b.stops.slice(0, 8).map((s) => ({
          order: s.order,
          category: s.category,
          name: s.name || (s.placeholder ? `[placeholder:${s.placeholder}]` : '???'),
        }))
      : [],
  }));

  const systemPrompt = buildBlockSelectionSystemPrompt(language);
  const userMessage = JSON.stringify({
    duration_days: durationDays,
    styles,
    special_request: specialRequest || undefined,
    diet_preferences: dietPrefs.length > 0 ? dietPrefs : undefined,
    // P240 SAFETY: 알레르기 정보 — Gemini 가 해당 식재료 포함 block 제외 의무.
    food_allergies: allergies.length > 0 ? allergies : undefined,
    available_blocks: blockCards,
  });

  // 2026-05-21 P135: 2.5 Flash → resolveGeminiModel('block') default 3.5 Flash.
  // ENV GEMINI_BLOCK_MODEL 또는 GEMINI_MODEL_OVERRIDE 로 override.
  // JSON-only response — block ID 선택만 책임 (Gemini 부하 1/10).
  const { resolveGeminiModel } = await import('./geminiModelResolver.js');
  const genAI = new GoogleGenerativeAI(geminiClient.apiKey);
  const model = genAI.getGenerativeModel({
    model: geminiClient.model || resolveGeminiModel('block'),
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
  });

  const raw = (result && result.response && typeof result.response.text === 'function')
    ? result.response.text().trim()
    : '';
  if (!raw) {
    throw new Error('selectBlocksWithGemini: empty Gemini response');
  }

  let parsed;
  try {
    parsed = repairAndParseJSON(raw);
  } catch (err) {
    throw new Error(`selectBlocksWithGemini: parse failed — ${err && err.message ? err.message : err}`);
  }

  const daySelections = Array.isArray(parsed?.day_selections) ? parsed.day_selections : [];
  if (daySelections.length !== durationDays) {
    // Gemini 가 day 수 무시한 경우 — clamp + 부족 시 첫 block 반복 (fail-safe).
    const safe = [];
    for (let i = 1; i <= durationDays; i++) {
      const existing = daySelections.find((d) => Number(d?.day) === i);
      if (existing && existing.block_id) {
        safe.push({
          day: i,
          block_id: String(existing.block_id),
          tweak_notes: typeof existing.tweak_notes === 'string' ? existing.tweak_notes.slice(0, 400) : '',
        });
      } else {
        // round-robin available blocks (배치 다양성).
        const fallback = blocks[(i - 1) % blocks.length];
        safe.push({ day: i, block_id: fallback.id, tweak_notes: 'auto-fallback (Gemini omitted day)' });
      }
    }
    return { day_selections: safe, language };
  }

  // Validate block IDs.
  const validIds = new Set(blocks.map((b) => b.id));
  const cleaned = daySelections.map((d, idx) => {
    const day = Number(d?.day) || (idx + 1);
    let blockId = String(d?.block_id || '').trim();
    if (!validIds.has(blockId)) {
      blockId = blocks[(idx) % blocks.length].id; // fallback to round-robin
    }
    return {
      day,
      block_id: blockId,
      tweak_notes: typeof d?.tweak_notes === 'string' ? d.tweak_notes.slice(0, 400) : '',
    };
  });
  return { day_selections: cleaned, language };
}

/**
 * block-mode 전용 system prompt — Gemini 가 block ID 선택만 책임짐.
 */
export function buildBlockSelectionSystemPrompt(language = 'en') {
  return `You are CocoTrip's block selector — pick the best pre-curated day-blocks for the user.

## OUTPUT FORMAT — STRICT JSON ONLY
No markdown. No code blocks. No explanation. Pure JSON only.

{
  "day_selections": [
    {
      "day": 1,
      "block_id": "<one of available_blocks[].id>",
      "tweak_notes": "Optional 1-sentence note in ${language} (max 200 chars) about why this block fits the user. Empty if no rationale needed."
    }
  ]
}

## RULES
1. day_selections MUST contain EXACTLY duration_days entries (one per day). day = 1, 2, ..., duration_days.
2. block_id MUST be one of available_blocks[].id (string match). NEVER invent new IDs.
3. Prefer variety — do NOT repeat the same block_id across multiple days unless duration_days exceeds unique blocks count.
4. Match user's styles (e.g. "Food", "Kpop") to block.best_for and block.theme.
5. Honor diet_preferences strictly — every selected block's dietary_options MUST cover all user dietary needs (halal/vegan/vegetarian). The system already filtered the available_blocks to dietary-compatible ones; you only need to focus on preference variety.
6. tweak_notes is optional and short. NEVER use it to invent new stops — actual stop substitutions happen later.
7. Day 1 should be an easy / standard intensity block (arrival fatigue). Day N can be packed if styles indicate. Otherwise alternate intensity.

## OUTPUT LANGUAGE
- tweak_notes text MUST be in language=${language}.
- block_id values are language-neutral identifiers — copy them verbatim.`;
}

// ─────────────────────────────────────────────────────────────────────
// Expand block selections to itinerary.days[].stops[].
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_DAY_START_HHMM = '09:00';

/**
 * "HH:mm" + minutes → "HH:mm" (24h wrap-around).
 */
function addMinutesToHHMM(hhmm, minutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mn) || h < 0 || h > 23 || mn < 0 || mn > 59) return null;
  const minTotal = h * 60 + mn + Math.floor(Number(minutes) || 0);
  const wrapped = ((minTotal % (24 * 60)) + 24 * 60) % (24 * 60);
  const oh = Math.floor(wrapped / 60);
  const om = wrapped % 60;
  return `${String(oh).padStart(2, '0')}:${String(om).padStart(2, '0')}`;
}

/**
 * food placeholder 매칭 — dbMatcher 패턴과 유사.
 * preferred_dietary 가 있으면 매칭 식당의 dietary_tags 와 교집합 검사.
 *
 * @param {object} placeholderStop — { placeholder, preferred_dietary, ... }
 * @param {Array<object>} foodIndex — _food_index.json 항목
 * @param {string} city
 * @param {string[]} userDietPrefs
 * @returns {object|null} foodIndex entry 또는 null (매칭 실패)
 */
export function matchFoodPlaceholder(placeholderStop, foodIndex, city, userDietPrefs = []) {
  if (!placeholderStop || !placeholderStop.placeholder) return null;
  if (!Array.isArray(foodIndex) || foodIndex.length === 0) return null;
  const cityLc = String(city || '').trim().toLowerCase();
  const placeholder = String(placeholderStop.placeholder || '').toLowerCase();

  // placeholder 타입별 카테고리 매핑.
  // verified_lunch / verified_dinner / verified_breakfast / verified_cafe
  const cafeTypes = ['cafe', 'dessert', 'bakery'];
  const isCafe = placeholder.includes('cafe');

  // Diet filtering — SAFETY-CRITICAL (CLAUDE.md J).
  const dietary = Array.isArray(userDietPrefs)
    ? userDietPrefs.map((d) => String(d).toLowerCase())
    : [];
  const dietRequired = dietary.filter((d) => /halal|vegan|vegetarian/i.test(d));

  // preferred_dietary 가 명시되면 (block stop 운영자 의도) 추가 필터.
  const preferred = Array.isArray(placeholderStop.preferred_dietary)
    ? placeholderStop.preferred_dietary.map((d) => String(d).toLowerCase())
    : [];

  const candidates = foodIndex.filter((r) => {
    if (!r || typeof r !== 'object') return false;
    const rCity = String(r.city || '').toLowerCase();
    if (cityLc && rCity && !rCity.includes(cityLc) && !cityLc.includes(rCity)) return false;
    const rType = String(r.type || r.category || '').toLowerCase();
    if (isCafe) {
      if (!cafeTypes.some((t) => rType.includes(t))) return false;
    }
    // dietary tags 필터.
    const tags = Array.isArray(r.dietary_tags) ? r.dietary_tags.map((t) => String(t).toLowerCase()) : [];
    for (const d of dietRequired) {
      if (!tags.includes(d)) return false;
    }
    for (const d of preferred) {
      if (!tags.includes(d)) return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    if (dietRequired.length > 0) {
      // SAFETY-CRITICAL — caller (expandBlocksToItinerary) 가 throw 해야 함.
      return null;
    }
    return null;
  }

  // rating × log(reviews) 정렬 — pickRecommendedRestaurants 와 동일 가중치.
  candidates.sort((a, b) => {
    const ra = Number(a.rating) || 0;
    const rb = Number(b.rating) || 0;
    const va = Number(a.reviews) || 1;
    const vb = Number(b.reviews) || 1;
    return rb * Math.log10(vb) - ra * Math.log10(va);
  });

  return candidates[0];
}

/**
 * block-mode 의 핵심: blockSelections 를 받아 itinerary.days[] 형식으로 변환.
 *
 * @param {{day_selections: Array}} blockSelections
 * @param {Array<object>} blocks — fetchAvailableBlocks 결과
 * @param {object} userInput — { durationDays, dietPrefs, language, startDate, arrival_time, departure_time, foodIndex, area }
 * @returns {object} itinerary (legacy 와 호환되는 days[] 포함)
 */
export function expandBlocksToItinerary(blockSelections, blocks, userInput) {
  if (!blockSelections || !Array.isArray(blockSelections.day_selections)) {
    throw new Error('expandBlocksToItinerary: invalid blockSelections');
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('expandBlocksToItinerary: no blocks');
  }
  const blockMap = new Map(blocks.map((b) => [b.id, b]));

  const language = String(userInput?.language || 'en');
  const dietPrefs = Array.isArray(userInput?.dietPrefs) ? userInput.dietPrefs : [];
  const dietCritical = dietPrefs.filter((d) => /halal|vegan|vegetarian/i.test(String(d || '')));
  const foodIndex = Array.isArray(userInput?.foodIndex) ? userInput.foodIndex : [];
  const area = String(userInput?.area || '').toLowerCase();
  const startDate = userInput?.startDate || null;
  const arrivalTime = String(userInput?.arrival_time || userInput?.arrivalTime || '');
  const departureTime = String(userInput?.departure_time || userInput?.departureTime || '');
  // P245 (2026-05-27): tour_start_time architectural — block_mode 가 P239 tour_start_time 무시했던
  // sleeper bug 진짜 fix. arrival=14:00 + 9h = 23:00 → Day1 stops cascade 00:45/02:23/04:10 (P159 alert).
  // 운영자 의도 (P239): arrival_time 무관하게 Day1 stops 시작 시각을 고정 (default '09:00').
  // 본 fix = buildPrompt + RouteAgent 와 동일 룰을 block_mode 에도 적용 (sleeper bug 해소).
  const tourStartTimeRaw = String(userInput?.tour_start_time || userInput?.tourStartTime || '09:00');
  const tourStartTime = /^\d{1,2}:\d{2}$/.test(tourStartTimeRaw) ? tourStartTimeRaw : DEFAULT_DAY_START_HHMM;

  const days = [];
  for (const sel of blockSelections.day_selections) {
    const dayNum = Number(sel.day) || (days.length + 1);
    const block = blockMap.get(sel.block_id);
    if (!block) {
      throw new Error(`expandBlocksToItinerary: block_id not found: ${sel.block_id}`);
    }

    // start_time 결정 — Day 1 이면 P239/P245 룰 적용:
    //   - dayStart = max(tour_start_time, arrival_time + 60min)
    //   - 옛 룰 (arrival + 9h) 폐기 — 14:00 + 9h = 23:00 wrap 으로 P159 새벽 stops cascade 유발했음.
    // Day N (마지막) 이면 departure_time 으로 cap.
    let dayStart = tourStartTime;  // P245: default = tour_start_time (옛 '09:00' literal 대체)
    const isFirstDay = dayNum === 1;
    const isLastDay = dayNum === blockSelections.day_selections.length;
    if (isFirstDay && arrivalTime && /^\d{1,2}:\d{2}$/.test(arrivalTime)) {
      // P245 (2026-05-27): max(tour_start_time, arrival_time + 60min) — P239 architectural fix.
      // arrival=14:00 케이스: max(09:00, 15:00) = 15:00 → 23:00 cascade 차단.
      // arrival=01:30 케이스: max(09:00, 02:30) = 09:00 → 새벽 stops 차단 (호텔만 + 09:00 부터).
      // arrival=06:00 케이스: max(09:00, 07:00) = 09:00 → 너무 늦은 stops 방지.
      const arrivalPlus60 = addMinutesToHHMM(arrivalTime, 60);
      // HH:MM 문자열 비교 = 시간 비교 (lexical = numeric for zero-padded).
      if (arrivalPlus60 && arrivalPlus60 > tourStartTime) {
        dayStart = arrivalPlus60;
      } else {
        dayStart = tourStartTime;
      }
    }

    // stops expand
    const stops = [];
    const blockStops = Array.isArray(block.stops) ? block.stops : [];
    for (const bs of blockStops) {
      const offsetMin = Number(bs.start_time_offset_min) || 0;
      const startTime = addMinutesToHHMM(dayStart, offsetMin) || dayStart;

      // food placeholder 매칭
      let resolvedName = bs.name || '';
      let resolvedDisplay = (bs.name_i18n && bs.name_i18n[language]) || resolvedName;
      let resolvedAddress = bs.address || '';
      let verified = false;
      let dietaryTags = Array.isArray(bs.preferred_dietary) ? bs.preferred_dietary.slice() : [];
      if (bs.placeholder && !resolvedName) {
        const matched = matchFoodPlaceholder(bs, foodIndex, area, dietPrefs);
        if (matched) {
          resolvedName = matched.name || matched.name_ko || matched.display_name || '';
          resolvedDisplay = matched.display_name || matched.name_en || resolvedName;
          resolvedAddress = matched.address || resolvedAddress;
          verified = true;
          if (Array.isArray(matched.dietary_tags)) {
            dietaryTags = matched.dietary_tags.slice();
          }
        } else if (dietCritical.length > 0) {
          // SAFETY-CRITICAL: dietary 사용자에게 매칭 안 됨 = throw (block-mode 폐기 + legacy fallback).
          const err = new Error(
            `Block-mode unable to satisfy dietary preference (${dietCritical.join(', ')}) for placeholder "${bs.placeholder}" in ${area}. ` +
            `Falling back to legacy planner is recommended.`
          );
          err.code = 'BLOCK_MODE_DIETARY_UNSATISFIED';
          err.statusCode = 422;
          throw err;
        } else {
          // placeholder 매칭 실패 + dietary 강제 X → graceful: 표시명 비워두고 진행.
          resolvedName = bs.address || 'Local restaurant';
          resolvedDisplay = resolvedName;
        }
      }

      stops.push({
        order: bs.order,
        start_time: startTime,
        name: resolvedName || '',
        display_name: resolvedDisplay || resolvedName || '',
        category: bs.category || 'culture',
        address: resolvedAddress || '',
        stay_min: Number(bs.stay_min) || 0,
        entry_fee_krw: Number(bs.entry_fee_krw) || 0,
        entry_fee_note: bs.entry_fee_note || undefined,
        reservation_required: !!bs.reservation_required,
        local_tag: bs.local_tag || '',
        tip: (bs.tips_i18n && bs.tips_i18n[language]) || bs.tip || '',
        verified,
        dietary_tags: dietaryTags.length > 0 ? dietaryTags : undefined,
        personalization_reasoning: sel.tweak_notes
          ? sel.tweak_notes
          : `Pre-curated ${block.zone} block — ${block.theme}`,
        // block source 추적 — admin dashboard 에서 plan 진단용
        source_block_id: block.id,
        // P112: end_time backfill 은 planPersister 가 처리 — 여기서는 skip.
      });
    }

    // Day N (departure day) 의 마지막 활동 stop start_time > departure_time - 180min 이면 trim.
    // departure_time 강제는 buildPrompt 기존 로직과 일관성 유지 — block 시간이 너무 늦으면
    // tail stops 제거. SAFETY-CRITICAL 아니므로 graceful (사용자 미입력 시 skip).
    if (isLastDay && departureTime && /^\d{1,2}:\d{2}$/.test(departureTime)) {
      const cap = addMinutesToHHMM(departureTime, -180);
      if (cap && /^\d{1,2}:\d{2}$/.test(cap)) {
        while (
          stops.length > 2 &&
          stops[stops.length - 1].start_time > cap &&
          stops[stops.length - 1].category !== 'lodging' &&
          stops[stops.length - 1].category !== 'airport' &&
          stops[stops.length - 1].category !== 'travel'
        ) {
          stops.pop();
        }
      }
    }

    days.push({
      day: dayNum,
      date: startDate ? offsetDate(startDate, dayNum - 1) : undefined,
      theme: (block.theme_i18n && block.theme_i18n[language]) || block.theme || `Day ${dayNum}`,
      city: block.city || area,
      lodging: undefined, // planPersister.backfillDayLodging 가 stops[] 의 lodging 으로 채움
      stops,
      // block-mode trace — admin dashboard 분석용
      source_block_id: block.id,
      source_block_zone: block.zone,
      source_block_intensity: block.intensity,
      tweak_notes: sel.tweak_notes || '',
    });
  }

  // P271 (2026-05-28): arrival_guide / departure_guide / daily_budget_summary minimal default.
  // 이전: 3 field 누락 → backend self_heal (postResponsePipeline.selfHealArrivalGuide /
  // selfHealDailyBudget) 가 generic 5-step placeholder 합성 (5/28 P266 5/5 plan _self_healed 발동).
  // 본 fix = expand 가 user input 받은 airport/regions/durationDays 로 user-aware minimal default 채움
  // → self_heal 가 already-filled 인식 + step 5 transport_to_hotel/route_to_hotel 만 enrich.
  const arrivalAirport = String(userInput?.arrival_airport || '').trim();
  const departureAirport = String(userInput?.departure_airport || arrivalAirport).trim();
  const itinerary = {
    tour_title: `Pre-curated ${area || 'Korea'} ${days.length}-day plan`,
    days,
    planner_pipeline: 'block_mode',
  };
  if (arrivalAirport && arrivalAirport.toLowerCase() !== 'already_in_korea') {
    itinerary.arrival_guide = { airport: arrivalAirport };
  }
  if (departureAirport && departureAirport.toLowerCase() !== 'already_in_korea') {
    itinerary.departure_guide = { airport: departureAirport };
  }
  // daily_budget_summary: per-day skeleton (selfHealDailyBudget 가 정확값 계산 — 본 default 는 array shape 만).
  itinerary.daily_budget_summary = days.map((d) => ({
    day: d.day,
    transport_krw: 0,
    food_krw: 0,
    activity_krw: 0,
    total_krw: 0,
  }));
  return itinerary;
}

// P10 inclusive/exclusive 컨벤션 (P1 lint rule 요구):
// - yyyymmdd: ISO 'YYYY-MM-DD' 형식의 시작일 (inclusive)
// - offsetDays: 시작일 기준 N 일 뒤. 0 이면 startDate 자체.
// - 반환: startDate + N 일의 ISO date string
// - 예: offsetDate('2026-06-01', 0) = '2026-06-01' (Day 1, inclusive)
//       offsetDate('2026-06-01', 4) = '2026-06-05' (Day 5, 5박6일 trip 의 마지막 day inclusive)
// - durationDays = 5 → days[].date 가 [Day0, Day1, ..., Day4] = startDate + [0..4] = startDate + 4 inclusive
function offsetDate(yyyymmdd, offsetDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(yyyymmdd))) return undefined;
  try {
    const d = new Date(yyyymmdd + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return undefined;
    d.setUTCDate(d.getUTCDate() + Math.floor(Number(offsetDays) || 0));
    return d.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

/**
 * 전체 block-mode pipeline 의 컨비니언스 wrapper.
 * shouldUseBlockMode 통과 후 호출자 (ai-planner-full.js) 가 1줄로 호출 가능.
 *
 * 에러 시 BLOCK_MODE_* 코드 throw — 호출자가 catch 해서 legacy fallback 결정.
 *
 * @param {object} args
 * @param {object} args.adminDb
 * @param {string} args.city
 * @param {object} args.userInput — { durationDays, dietPrefs, styles, special_request, language, startDate, arrival_time, departure_time, area, foodIndex }
 * @param {object} args.geminiClient — { apiKey, model? }
 * @returns {Promise<{itinerary: object, eligible: true, blocks_used: string[]}>}
 */
export async function runBlockModePipeline({ adminDb, city, userInput, geminiClient }) {
  if (!adminDb) throw new Error('runBlockModePipeline: adminDb required');
  if (!city) throw new Error('runBlockModePipeline: city required');
  if (!userInput) throw new Error('runBlockModePipeline: userInput required');

  const dietPrefs = Array.isArray(userInput.dietPrefs) ? userInput.dietPrefs : [];
  const blocks = await fetchAvailableBlocks(adminDb, city, { dietaryRequired: dietPrefs });
  const elig = shouldUseBlockMode(city, userInput.durationDays, dietPrefs, blocks);
  if (!elig.eligible) {
    const err = new Error(`block-mode ineligible: ${elig.reason}`);
    err.code = 'BLOCK_MODE_INELIGIBLE';
    err.reason = elig.reason;
    throw err;
  }

  const selections = await selectBlocksWithGemini(blocks, userInput, geminiClient);
  const itinerary = expandBlocksToItinerary(selections, blocks, userInput);
  return {
    itinerary,
    eligible: true,
    blocks_used: selections.day_selections.map((d) => d.block_id),
  };
}

// ─────────────────────────────────────────────────────────────────────
// P167 (2026-05-23): 다도시 block-mode 지원
// 운영자 PR #514 (서울 4) + PR #518 (부산 5 + 제주 4 + 한라산/설악산/올레 = 18+)
// zone block 이 다도시 plan 에서도 활용되도록. 기존: regions.length >= 2 이면
// multi_city_not_supported → legacy 3-pass 폴백 4분 30초. 수정: 도시별
// fetchAvailableBlocks 병렬 + city-per-day 매핑으로 1-2분 추정.
// ─────────────────────────────────────────────────────────────────────

/**
 * 다도시 plan 에서 도시별 blocks 병렬 fetch.
 *
 * @param {object} adminDb
 * @param {string[]} cities — 정규화된 city key 목록 (예: ['seoul', 'busan'])
 * @param {string[]} dietPrefs — 사용자 dietary preferences
 * @returns {Promise<Array<{city: string, blocks: Array<object>, ok: boolean, error?: Error}>>}
 */
export async function fetchAvailableBlocksMultiCity(adminDb, cities, dietPrefs = []) {
  const results = await Promise.all(
    cities.map(async (city) => {
      try {
        const blocks = await fetchAvailableBlocks(adminDb, city, { dietaryRequired: dietPrefs });
        return { city, blocks, ok: true };
      } catch (err) {
        console.warn(`[blockMode] fetchAvailableBlocksMultiCity failed for ${city}:`, err && err.message ? err.message : err);
        return { city, blocks: [], ok: false, error: err };
      }
    }),
  );
  return results;
}

/**
 * 다도시 block-mode 사용 가능 여부 판단.
 * 각 도시 최소 3 blocks + dietary 매칭 가능 검증.
 *
 * @param {Array<{city: string, blocks: Array<object>, ok: boolean}>} cityBlocksList
 * @param {string[]} dietPrefs
 * @returns {{eligible: boolean, reason: string}}
 */
export function shouldUseBlockModeMultiCity(cityBlocksList, dietPrefs = []) {
  const env = getBlockModeEnv();
  if (env === 'disabled') return { eligible: false, reason: 'env_disabled' };

  const dietCritical = dietPrefs.filter((d) => /halal|vegan|vegetarian/i.test(String(d || '')));

  for (const { city, blocks, ok } of cityBlocksList) {
    if (!ok || !Array.isArray(blocks) || blocks.length < 3) {
      return { eligible: false, reason: `insufficient_blocks_for_${city}:${ok ? blocks.length : 'fetch_failed'}` };
    }
    // dietary 사용자 시 도시별 매칭 block 최소 1개 검증 (SAFETY-CRITICAL CLAUDE.md J).
    if (dietCritical.length > 0) {
      const hasDietary = blocks.some((b) => {
        const opts = Array.isArray(b.dietary_options) ? b.dietary_options : [];
        return dietCritical.every((d) =>
          opts.some((o) => String(o).toLowerCase() === String(d).toLowerCase()),
        );
      });
      if (!hasDietary) {
        return { eligible: false, reason: `no_dietary_block_for_${city}` };
      }
    }
  }

  if (env === 'enabled') return { eligible: true, reason: 'env_enabled' };
  return { eligible: true, reason: 'auto_eligible' };
}

/**
 * 다도시 plan 의 city-per-day 매핑 계산.
 * userInput.perDayCity 가 있으면 우선 사용, 없으면 균등 분배 fallback.
 *
 * @param {string[]} cities — 순서 있는 도시 목록
 * @param {number} durationDays
 * @param {object|null} perDayCity — { 1: 'seoul', 2: 'seoul', 3: 'busan', ... } 명시 매핑
 * @returns {string[]} 길이 = durationDays, 각 day 의 city (1-indexed array[day-1])
 */
function buildCityPerDay(cities, durationDays, perDayCity = null) {
  if (perDayCity && typeof perDayCity === 'object') {
    const result = [];
    for (let d = 1; d <= durationDays; d++) {
      const explicit = String(perDayCity[d] || perDayCity[String(d)] || '').toLowerCase();
      result.push(explicit || cities[0]);
    }
    return result;
  }
  // fallback: 균등 분배 (cities[0] = 전반, cities[1] = 후반, ...).
  // 예: 5-day [seoul, busan] → [seoul, seoul, busan, busan, busan]
  const result = [];
  const cityCount = cities.length;
  for (let d = 1; d <= durationDays; d++) {
    // (d-1) / durationDays 비율로 도시 인덱스 결정
    const idx = Math.min(Math.floor(((d - 1) / durationDays) * cityCount), cityCount - 1);
    result.push(cities[idx]);
  }
  return result;
}

/**
 * 다도시 Gemini block 선택 — 도시별 available blocks + city-per-day 매핑 전달.
 *
 * @param {Array<{city: string, blocks: Array<object>}>} cityBlocksList
 * @param {object} userInput — { durationDays, styles, special_request, dietPrefs, language, perDayCity? }
 * @param {object} geminiClient — { apiKey, model? }
 * @param {string[]} cityPerDay — buildCityPerDay 결과
 * @returns {Promise<{ day_selections: Array<{day:number, city:string, block_id:string, tweak_notes?:string}>, language: string }>}
 */
export async function selectBlocksMultiCity(cityBlocksList, userInput, geminiClient, cityPerDay) {
  if (!Array.isArray(cityBlocksList) || cityBlocksList.length === 0) {
    throw new Error('selectBlocksMultiCity: no cityBlocksList');
  }
  if (!geminiClient || !geminiClient.apiKey) {
    throw new Error('selectBlocksMultiCity: geminiClient.apiKey required');
  }

  const durationDays = Math.max(1, Math.min(14, Number(userInput.durationDays) || 1));
  const styles = Array.isArray(userInput.styles) ? userInput.styles : [];
  const language = String(userInput.language || 'en');
  const specialRequest = String(userInput.special_request || '').slice(0, 800);
  const dietPrefs = Array.isArray(userInput.dietPrefs) ? userInput.dietPrefs : [];
  // P240 SAFETY-CRITICAL: allergies (Peanut/Nuts/Shellfish 등) 다도시 block 선택 Gemini 에 명시 의무.
  const allergies = Array.isArray(userInput.allergies) ? userInput.allergies : [];

  // 도시별 block 카드 + city-per-day 일정 조합
  const cityBlockCards = {};
  const allValidIds = new Set();
  for (const { city, blocks } of cityBlocksList) {
    cityBlockCards[city] = blocks.map((b) => ({
      id: b.id,
      zone: b.zone,
      theme: b.theme,
      intensity: b.intensity,
      duration_min: b.duration_min,
      best_for: Array.isArray(b.best_for) ? b.best_for.slice(0, 6) : [],
      dietary_options: Array.isArray(b.dietary_options) ? b.dietary_options : [],
      stops_summary: Array.isArray(b.stops)
        ? b.stops.slice(0, 8).map((s) => ({
            order: s.order,
            category: s.category,
            name: s.name || (s.placeholder ? `[placeholder:${s.placeholder}]` : '???'),
          }))
        : [],
    }));
    blocks.forEach((b) => allValidIds.add(b.id));
  }

  // day-schedule: day 번호 → 도시 + 해당 도시 available blocks
  const daySchedule = cityPerDay.map((city, idx) => ({
    day: idx + 1,
    city,
    available_blocks: cityBlockCards[city] || [],
  }));

  const systemPrompt = buildBlockSelectionMultiCitySystemPrompt(language);
  const userMessage = JSON.stringify({
    duration_days: durationDays,
    styles,
    special_request: specialRequest || undefined,
    diet_preferences: dietPrefs.length > 0 ? dietPrefs : undefined,
    // P240 SAFETY: 알레르기 정보 — 다도시 block 선택 시 해당 식재료 포함 block 제외 의무.
    food_allergies: allergies.length > 0 ? allergies : undefined,
    day_schedule: daySchedule,
  });

  const { resolveGeminiModel } = await import('./geminiModelResolver.js');
  const genAI = new GoogleGenerativeAI(geminiClient.apiKey);
  const model = genAI.getGenerativeModel({
    model: geminiClient.model || resolveGeminiModel('block'),
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
  });

  const raw = (result && result.response && typeof result.response.text === 'function')
    ? result.response.text().trim()
    : '';
  if (!raw) throw new Error('selectBlocksMultiCity: empty Gemini response');

  let parsed;
  try {
    parsed = repairAndParseJSON(raw);
  } catch (err) {
    throw new Error(`selectBlocksMultiCity: parse failed — ${err && err.message ? err.message : err}`);
  }

  const daySelections = Array.isArray(parsed?.day_selections) ? parsed.day_selections : [];

  // city-per-day 정합성 validator — 서울 day 에 부산 block 거부 (P167 city mismatch 가드).
  const blockCityMap = new Map();
  for (const { city, blocks } of cityBlocksList) {
    for (const b of blocks) blockCityMap.set(b.id, city);
  }

  const safe = [];
  for (let i = 1; i <= durationDays; i++) {
    const expectedCity = cityPerDay[i - 1];
    const existing = daySelections.find((d) => Number(d?.day) === i);
    let blockId = existing && existing.block_id ? String(existing.block_id) : '';

    // block ID 유효성 + city 정합성 검증
    const blockCity = blockCityMap.get(blockId);
    if (!blockId || !allValidIds.has(blockId) || (blockCity && blockCity !== expectedCity)) {
      // fallback: 해당 도시의 round-robin block
      const cityBlocks = cityBlocksList.find((c) => c.city === expectedCity)?.blocks || [];
      const fallback = cityBlocks[(i - 1) % Math.max(1, cityBlocks.length)];
      blockId = fallback ? fallback.id : (cityBlocksList[0]?.blocks[0]?.id || '');
    }

    safe.push({
      day: i,
      city: expectedCity,
      block_id: blockId,
      tweak_notes: typeof existing?.tweak_notes === 'string' ? existing.tweak_notes.slice(0, 400) : '',
    });
  }

  return { day_selections: safe, language };
}

/**
 * 다도시 block-mode 전용 system prompt.
 */
export function buildBlockSelectionMultiCitySystemPrompt(language = 'en') {
  return `You are CocoTrip's multi-city block selector — pick the best pre-curated day-blocks for each city in a multi-city trip.

## OUTPUT FORMAT — STRICT JSON ONLY
No markdown. No code blocks. No explanation. Pure JSON only.

{
  "day_selections": [
    {
      "day": 1,
      "city": "<must match the city given in day_schedule[day-1].city>",
      "block_id": "<one of day_schedule[day-1].available_blocks[].id>",
      "tweak_notes": "Optional 1-sentence note in ${language} (max 200 chars). Empty if not needed."
    }
  ]
}

## RULES
1. day_selections MUST contain EXACTLY duration_days entries. day = 1, 2, ..., duration_days.
2. city MUST exactly match day_schedule[day-1].city — do NOT swap cities between days.
3. block_id MUST be one of day_schedule[day-1].available_blocks[].id (city-specific list). NEVER use a block from a different city.
4. Prefer variety within each city — do NOT repeat the same block_id for the same city unless blocks run out.
5. Match user styles to block.best_for and block.theme.
6. Honor diet_preferences strictly — every selected block's dietary_options MUST cover all user dietary needs.
7. Day 1 should be standard intensity. Last day can be lighter for departure prep.

## OUTPUT LANGUAGE
- tweak_notes text MUST be in language=${language}.
- city and block_id values are identifiers — copy them verbatim from day_schedule.`;
}

/**
 * 다도시 block 선택 결과를 itinerary.days[] 형식으로 변환.
 * 기존 expandBlocksToItinerary 의 다도시 변종.
 *
 * @param {{ day_selections: Array<{day,city,block_id,tweak_notes}> }} blockSelections
 * @param {Array<{city: string, blocks: Array<object>}>} cityBlocksList
 * @param {object} userInput
 * @returns {object} itinerary
 */
export function expandBlocksToItineraryMultiCity(blockSelections, cityBlocksList, userInput) {
  if (!blockSelections || !Array.isArray(blockSelections.day_selections)) {
    throw new Error('expandBlocksToItineraryMultiCity: invalid blockSelections');
  }

  // 전체 blockMap: id → block (도시 무관 조회용)
  const blockMap = new Map();
  for (const { blocks } of cityBlocksList) {
    for (const b of blocks) blockMap.set(b.id, b);
  }

  // P167 city mismatch 가드: 각 도시의 valid block IDs set
  const cityValidBlockIds = new Map();
  for (const { city, blocks } of cityBlocksList) {
    cityValidBlockIds.set(city, new Set(blocks.map((b) => b.id)));
  }

  const language = String(userInput?.language || 'en');
  const dietPrefs = Array.isArray(userInput?.dietPrefs) ? userInput.dietPrefs : [];
  const dietCritical = dietPrefs.filter((d) => /halal|vegan|vegetarian/i.test(String(d || '')));
  const foodIndex = Array.isArray(userInput?.foodIndex) ? userInput.foodIndex : [];
  const startDate = userInput?.startDate || null;
  const arrivalTime = String(userInput?.arrival_time || userInput?.arrivalTime || '');
  const departureTime = String(userInput?.departure_time || userInput?.departureTime || '');
  // P245 (2026-05-27): tour_start_time — multi-city block_mode 도 동일 룰 적용
  // (단도시 expandBlocksToItinerary 와 일관). default '09:00' (P239 architectural).
  const tourStartTimeRaw = String(userInput?.tour_start_time || userInput?.tourStartTime || '09:00');
  const tourStartTime = /^\d{1,2}:\d{2}$/.test(tourStartTimeRaw) ? tourStartTimeRaw : DEFAULT_DAY_START_HHMM;
  // P123 학습: hotelByCity Record 로 도시별 lodging 정합성 보장.
  const hotelByCity = (userInput?.hotelByCity && typeof userInput.hotelByCity === 'object' && !Array.isArray(userInput.hotelByCity))
    ? userInput.hotelByCity
    : {};

  const days = [];
  for (const sel of blockSelections.day_selections) {
    const dayNum = Number(sel.day) || (days.length + 1);
    const dayCityKey = String(sel.city || '').toLowerCase();
    const block = blockMap.get(sel.block_id);

    if (!block) {
      throw new Error(`expandBlocksToItineraryMultiCity: block_id not found: ${sel.block_id}`);
    }

    // P167 city mismatch 가드: 선택된 block 이 해당 day 의 도시와 일치하는지 재확인.
    // (selectBlocksMultiCity 에서 이미 검증했지만 이중 안전망).
    const validIds = cityValidBlockIds.get(dayCityKey);
    if (validIds && !validIds.has(sel.block_id)) {
      // wrong city block 박힘 → runtime error + fallback 대신 명시적 throw (운영자 alert 용).
      throw new Error(
        `expandBlocksToItineraryMultiCity: city mismatch — block "${sel.block_id}" ` +
        `does not belong to city "${dayCityKey}" (day ${dayNum})`,
      );
    }

    // start_time 결정 — P245 (2026-05-27): tour_start_time architectural fix.
    // 옛 룰 (arrival + 9h) 폐기 — 14:00 + 9h = 23:00 wrap → P159 새벽 stops cascade.
    // 신 룰: dayStart = max(tour_start_time, arrival_time + 60min) — buildPrompt/RouteAgent 와 일치.
    let dayStart = tourStartTime;
    const isFirstDay = dayNum === 1;
    const isLastDay = dayNum === blockSelections.day_selections.length;
    if (isFirstDay && arrivalTime && /^\d{1,2}:\d{2}$/.test(arrivalTime)) {
      const arrivalPlus60 = addMinutesToHHMM(arrivalTime, 60);
      if (arrivalPlus60 && arrivalPlus60 > tourStartTime) {
        dayStart = arrivalPlus60;
      } else {
        dayStart = tourStartTime;
      }
    }

    // stops expand (단도시 expandBlocksToItinerary 와 동일 로직)
    const stops = [];
    const blockStops = Array.isArray(block.stops) ? block.stops : [];
    for (const bs of blockStops) {
      const offsetMin = Number(bs.start_time_offset_min) || 0;
      const startTime = addMinutesToHHMM(dayStart, offsetMin) || dayStart;

      let resolvedName = bs.name || '';
      let resolvedDisplay = (bs.name_i18n && bs.name_i18n[language]) || resolvedName;
      let resolvedAddress = bs.address || '';
      let verified = false;
      let dietaryTags = Array.isArray(bs.preferred_dietary) ? bs.preferred_dietary.slice() : [];

      if (bs.placeholder && !resolvedName) {
        const matched = matchFoodPlaceholder(bs, foodIndex, dayCityKey, dietPrefs);
        if (matched) {
          resolvedName = matched.name || matched.name_ko || matched.display_name || '';
          resolvedDisplay = matched.display_name || matched.name_en || resolvedName;
          resolvedAddress = matched.address || resolvedAddress;
          verified = true;
          if (Array.isArray(matched.dietary_tags)) dietaryTags = matched.dietary_tags.slice();
        } else if (dietCritical.length > 0) {
          const err = new Error(
            `Block-mode multi-city unable to satisfy dietary (${dietCritical.join(', ')}) ` +
            `for placeholder "${bs.placeholder}" in city "${dayCityKey}" day ${dayNum}. Legacy fallback.`,
          );
          err.code = 'BLOCK_MODE_DIETARY_UNSATISFIED';
          err.statusCode = 422;
          throw err;
        } else {
          resolvedName = bs.address || 'Local restaurant';
          resolvedDisplay = resolvedName;
        }
      }

      stops.push({
        order: bs.order,
        start_time: startTime,
        name: resolvedName || '',
        display_name: resolvedDisplay || resolvedName || '',
        category: bs.category || 'culture',
        address: resolvedAddress || '',
        stay_min: Number(bs.stay_min) || 0,
        entry_fee_krw: Number(bs.entry_fee_krw) || 0,
        entry_fee_note: bs.entry_fee_note || undefined,
        reservation_required: !!bs.reservation_required,
        local_tag: bs.local_tag || '',
        tip: (bs.tips_i18n && bs.tips_i18n[language]) || bs.tip || '',
        verified,
        dietary_tags: dietaryTags.length > 0 ? dietaryTags : undefined,
        personalization_reasoning: sel.tweak_notes
          ? sel.tweak_notes
          : `Pre-curated ${block.zone} block — ${block.theme}`,
        source_block_id: block.id,
      });
    }

    // departure day tail trim
    if (isLastDay && departureTime && /^\d{1,2}:\d{2}$/.test(departureTime)) {
      const cap = addMinutesToHHMM(departureTime, -180);
      if (cap && /^\d{1,2}:\d{2}$/.test(cap)) {
        while (
          stops.length > 2 &&
          stops[stops.length - 1].start_time > cap &&
          stops[stops.length - 1].category !== 'lodging' &&
          stops[stops.length - 1].category !== 'airport' &&
          stops[stops.length - 1].category !== 'travel'
        ) {
          stops.pop();
        }
      }
    }

    // P123 학습: hotelByCity[dayCityKey] 우선 사용 → day.lodging 정합성.
    // planPersister.backfillDayLodging 가 stops[] 의 lodging 으로 채우나,
    // hotelByCity 가 있으면 해당 도시 호텔을 hint 로 남겨둠.
    const lodgingHint = hotelByCity[dayCityKey] || hotelByCity[block.city] || undefined;

    days.push({
      day: dayNum,
      date: startDate ? offsetDate(startDate, dayNum - 1) : undefined,
      theme: (block.theme_i18n && block.theme_i18n[language]) || block.theme || `Day ${dayNum}`,
      city: dayCityKey || block.city,
      lodging: lodgingHint ? { name: lodgingHint } : undefined,
      stops,
      source_block_id: block.id,
      source_block_zone: block.zone,
      source_block_intensity: block.intensity,
      tweak_notes: sel.tweak_notes || '',
    });
  }

  const cityList = [...new Set(blockSelections.day_selections.map((s) => s.city))].join('/');
  // P271 (2026-05-28): 다도시 expand 도 arrival_guide / departure_guide / daily_budget_summary minimal default.
  const mcArrivalAirport = String(userInput?.arrival_airport || '').trim();
  const mcDepartureAirport = String(userInput?.departure_airport || mcArrivalAirport).trim();
  const mcItinerary = {
    tour_title: `Pre-curated ${cityList} ${days.length}-day plan`,
    days,
    planner_pipeline: 'block_mode',
  };
  if (mcArrivalAirport && mcArrivalAirport.toLowerCase() !== 'already_in_korea') {
    mcItinerary.arrival_guide = { airport: mcArrivalAirport };
  }
  if (mcDepartureAirport && mcDepartureAirport.toLowerCase() !== 'already_in_korea') {
    mcItinerary.departure_guide = { airport: mcDepartureAirport };
  }
  mcItinerary.daily_budget_summary = days.map((d) => ({
    day: d.day,
    transport_krw: 0,
    food_krw: 0,
    activity_krw: 0,
    total_krw: 0,
  }));
  return mcItinerary;
}

/**
 * 다도시 block-mode pipeline 전체 (runBlockModePipeline 의 다도시 변종).
 *
 * @param {object} args
 * @param {object} args.adminDb
 * @param {string[]} args.cities — 정규화된 city key 목록
 * @param {object} args.userInput
 * @param {object} args.geminiClient
 * @returns {Promise<{itinerary: object, eligible: true, blocks_used: string[]}>}
 */
export async function runBlockModeMultiCity({ adminDb, cities, userInput, geminiClient }) {
  if (!adminDb) throw new Error('runBlockModeMultiCity: adminDb required');
  if (!Array.isArray(cities) || cities.length < 2) {
    throw new Error('runBlockModeMultiCity: cities must have >= 2 items');
  }

  const dietPrefs = Array.isArray(userInput.dietPrefs) ? userInput.dietPrefs : [];
  const cityBlocksList = await fetchAvailableBlocksMultiCity(adminDb, cities, dietPrefs);
  const elig = shouldUseBlockModeMultiCity(cityBlocksList, dietPrefs);
  if (!elig.eligible) {
    const err = new Error(`block-mode multi-city ineligible: ${elig.reason}`);
    err.code = 'BLOCK_MODE_INELIGIBLE';
    err.reason = elig.reason;
    throw err;
  }

  const durationDays = Math.max(1, Math.min(14, Number(userInput.durationDays) || 1));
  const cityPerDay = buildCityPerDay(cities, durationDays, userInput.perDayCity || null);

  const selections = await selectBlocksMultiCity(cityBlocksList, userInput, geminiClient, cityPerDay);
  const itinerary = expandBlocksToItineraryMultiCity(selections, cityBlocksList, userInput);

  return {
    itinerary,
    eligible: true,
    blocks_used: selections.day_selections.map((d) => d.block_id),
  };
}

/**
 * Branch helper — ai-planner-full.js 의 길이 lock (800 lines) 보호용 컨비니언스 wrapper.
 *
 * shouldUseBlockMode 사전 check 없이 직접 호출 — runBlockModePipeline 내부 elig 체크에 위임.
 * env='disabled' 이면 result.skipped=true 반환 (legacy path 사용 안내).
 * env='enabled' + 실패 시 throw — 운영자가 명시적으로 강제했으므로 fail-fast.
 * env='auto' + 실패 시 result.skipped=true + result.error 반환 (legacy path 폴백).
 *
 * P167 (2026-05-23): 다도시 regions.length >= 2 지원 추가.
 * 기존 `multi_city_not_supported` 분기 제거 — 운영자 PR #514/#518 의 zone block 18+
 * 이 다도시 plan 에서도 활용됨. 단도시 흐름 backward-compat 100% 보장.
 *
 * @param {object} args
 * @param {object} args.adminDb
 * @param {string[]} args.regions — body.regions (다도시 지원)
 * @param {string} args.area — 단도시 fallback
 * @param {object} args.userInput — runBlockModePipeline 동일 spec + foodIndex
 * @param {string} args.apiKey
 * @returns {Promise<{skipped: true, reason: string} | {skipped: false, itinerary: object, blocks_used: string[]}>}
 */
export async function tryRunBlockMode({ adminDb, regions, area, userInput, apiKey, foodIndex }) {
  const env = getBlockModeEnv();
  if (env === 'disabled') return { skipped: true, reason: 'env_disabled' };

  // P167: regions 정규화 — 도시 key 추출 (예: 'seoul_city' → 'seoul').
  const cities = Array.isArray(regions) && regions.length > 0
    ? regions.map((r) => String(r || '').split('_')[0].toLowerCase()).filter(Boolean)
    : [String(area || '').split('_')[0].toLowerCase()].filter(Boolean);

  if (cities.length === 0) return { skipped: true, reason: 'no_city' };

  // ── 단도시: 기존 runBlockModePipeline (backward-compat 100%) ─────────────
  if (cities.length === 1) {
    const city = cities[0];
    try {
      const blockOut = await runBlockModePipeline({
        adminDb,
        city,
        userInput: { ...userInput, foodIndex, area: city },
        geminiClient: { apiKey },
      });
      return {
        skipped: false,
        itinerary: blockOut.itinerary,
        blocks_used: blockOut.blocks_used,
      };
    } catch (err) {
      const code = err && err.code ? err.code : 'BLOCK_MODE_UNKNOWN';
      if (env === 'enabled') throw err;
      return { skipped: true, reason: code, error: err };
    }
  }

  // ── 다도시: P167 신규 분기 ────────────────────────────────────────────────
  try {
    const blockOut = await runBlockModeMultiCity({
      adminDb,
      cities,
      userInput: { ...userInput, foodIndex },
      geminiClient: { apiKey },
    });
    return {
      skipped: false,
      itinerary: blockOut.itinerary,
      blocks_used: blockOut.blocks_used,
    };
  } catch (err) {
    const code = err && err.code ? err.code : 'BLOCK_MODE_UNKNOWN';
    console.warn(`[blockMode] multi-city block-mode failed (${code}) — falling back to legacy:`, err && err.message ? err.message : err);
    if (env === 'enabled') throw err;
    return { skipped: true, reason: code, error: err };
  }
}
