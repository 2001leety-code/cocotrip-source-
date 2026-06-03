/**
 * blockMode.js — zone_courses 기반 block-mode planner pipeline (P128, 2026-05-21).
 *
 * 운영자가 사전 큐레이트한 day-block (zone_courses Firestore 컬렉션) 을 가지고
 * Gemini 가 block ID 만 선택 + 약간의 tweak 만 수행. Gemini 부하 1/10 + 검증된
 * 동선 동시 확보.
 *
 * 진입 조건:
 *   shouldUseBlockMode(city, durationDays, dietPrefs)
 *     - Firestore zone_courses where city == ? AND status == 'published'
 *       (block_type 은 FEATURE_ACTIVITY_BLOCKS 플래그로 in-code 필터: OFF=city_day 만 / ON=+trekking/running_route)
 *     - count >= 3 이면 block-mode 가능. 부족하면 legacy path 로 폴백.
 *     - dietPrefs 가 비어있거나 (none) 또는 block 의 dietary_options 가 매칭 가능한
 *       경우만 (예: vegan plan + vegan block 없음 = block-mode 불가, legacy 폴백).
 *
 * Pipeline:
 *   1. fetchAvailableBlocks(city) — Firestore published blocks (FEATURE_ACTIVITY_BLOCKS OFF=city_day 만 / ON=+활동 블록)
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
import { repairAndParseJSON, normalizeRegionKey } from './responseValidator.js';

/** 기본 ENV mode — 운영자가 PLANNER_BLOCK_MODE 미설정 시 'auto' (자동 폴백). */
export function getBlockModeEnv() {
  const raw = String(process.env.PLANNER_BLOCK_MODE || '').trim().toLowerCase().replace(/[\r\n]/g, '');
  if (raw === 'enabled' || raw === 'disabled') return raw;
  return 'auto';
}

/**
 * PR-E (2026-06-01): 트레킹/러닝 block_type 을 block_mode 에 편입하는 feature flag.
 *
 * 끊긴 고리 #1 — 위저드 칩·4lang·백엔드 헬퍼·zone_courses 블록(trekking 3 + running_route 2)
 * 인프라는 prod 가동 중이나, fetchAvailableBlocks 가 block_type !== 'city_day' 를 명시적 제외
 * → P321 전환된 빠른 block_mode 경로에서 트레킹/러닝 day 선택 불가.
 *
 * OFF (FEATURE_ACTIVITY_BLOCKS 미설정/'false') → 현재처럼 city_day 만 (byte-identical 절대 보장).
 * ON  ('true')                                  → trekking / running_route 블록도 허용.
 *
 * P102 패턴 (CRLF strip + case-insensitive) 동일 적용 — Vercel env 줄바꿈 오염 방지.
 *
 * @returns {boolean}
 */
export function isActivityBlocksEnabled() {
  const raw = String(process.env.FEATURE_ACTIVITY_BLOCKS || '').trim().toLowerCase().replace(/[\r\n]/g, '');
  return raw === 'true';
}

/**
 * (2026-06-03) "선택한 취미 = 전용 day 1개 보장" feature flag.
 * 운영자 신고/실측(plan c7192a27): HangangBike(따릉이) 스타일을 선택해도 plan 에 안 나옴.
 *   따릉이 블록은 block_type='city_day' 라 서울 city_day ~15개와 동등 경쟁 → Gemini 선택기가 탈락시킴
 *   (블록↔스타일 결정론적 매핑 부재, 순수 LLM theme 추론에만 의존).
 * OFF (미설정/'false') → Gemini 선택 그대로 (현행 byte-identical 절대 보장).
 * ON  ('true')        → Gemini 선택 후 day_selections 후처리로 선택 취미 블록을 안전 day 에 강제 pin.
 */
export function isPinnedActivityDayEnabled() {
  const raw = String(process.env.FEATURE_PINNED_ACTIVITY_DAY || '').trim().toLowerCase().replace(/[\r\n]/g, '');
  return raw === 'true';
}

/**
 * 거동 제약(mobility) 여부 — 활동 블록(트레킹/러닝)의 unsuitable_for 안전 필터 게이트.
 *
 * prod 위저드는 mobility='ok' 하드코딩(WizardForm/index.tsx:213, handlers 디폴트도 'ok').
 * 'normal'/'good' 등 benign 값도 정상 거동 → 활동 블록 유지해야 함(과거 화이트리스트가 'ok'/'none'
 *   뿐이라 'normal' 을 limited 오판 → 트레킹/러닝 silent 제외 trap, 2026-06-04 발견).
 * 화이트리스트 밖(wheelchair_user/severe_mobility_limitation 등 실제 제약값)만 limited=true →
 *   보수적 SAFETY 디폴트(미지의 값 = 안전하게 제외) 유지.
 *
 * @param {string} mobility
 * @returns {boolean}
 */
const NON_LIMITED_MOBILITY = new Set(['ok', 'none', 'normal', 'good', 'full', 'fine']);
export function isLimitedMobility(mobility) {
  const m = String(mobility || '').trim().toLowerCase();
  return !!m && !NON_LIMITED_MOBILITY.has(m);
}

/**
 * 위저드 취미 스타일 키 → 후보 블록 매칭 predicate (결정론적 pin 용).
 * zone_courses 블록에 구조화된 style 필드가 없어(best_for 컨벤션 오염) id/block_type/theme 로 매칭.
 * 향후 개선: 블록에 activity_styles:[] 필드 추가 후 그걸로 대체하면 더 견고 (재시드 필요).
 */
const PINNED_ACTIVITY_STYLES = {
  HangangBike: (b) => /hangang.?bike|따릉이|ttareungi/i.test(`${b && b.id || ''} ${b && b.zone || ''} ${b && b.theme || ''}`),
  Trekking:    (b) => (b && b.block_type) === 'trekking',
  Hallasan:    (b) => (b && b.block_type) === 'trekking' && /halla/i.test(`${b && b.id || ''} ${b && b.theme || ''}`),
  HangangRun:  (b) => (b && b.block_type) === 'running_route' || /hangang.?run/i.test(`${b && b.id || ''} ${b && b.theme || ''}`),
  Running:     (b) => (b && b.block_type) === 'running_route',
};

/**
 * "선택한 취미 = 전용 day 1개 보장" — Gemini 블록 선택 후처리. selections.day_selections in-place 보정.
 *
 * flag OFF / 취미 미선택 / day < 3 / hard dietary / 매칭 블록 부재 → no-op (현행 byte-identical).
 * 안전 day(도착=첫날, 출국=마지막날 제외)의 그 도시 후보에서 취미 블록을 찾아 교체 → expand 의 city 정합
 * 가드(cityValidBlockIds)를 자연 통과 (그 도시 후보 풀에서 골랐으므로). 취미 1종당 최대 1 day.
 *
 * @param {object} selections — { day_selections: [{day, block_id, city?, tweak_notes}] } (in-place mutate)
 * @param {(cityKey: string) => Array<object>} getBlocksForCity — 도시별 후보 블록 (단도시는 city 무시 단일 pool)
 * @param {object} userInput — { styles, dietPrefs }
 * @returns {string[]} pin 된 스타일 목록 (로깅/테스트용)
 */
export function pinActivityDays(selections, getBlocksForCity, userInput) {
  const pinnedStyles = [];
  if (!isPinnedActivityDayEnabled()) return pinnedStyles;
  const ds = selections && selections.day_selections;
  if (!Array.isArray(ds) || ds.length < 3) return pinnedStyles; // 도착=출국 사이 중간 day 없으면 skip (cap)
  const styles = Array.isArray(userInput && userInput.styles) ? userInput.styles : [];
  const wanted = styles.filter((s) => typeof PINNED_ACTIVITY_STYLES[s] === 'function');
  if (wanted.length === 0) return pinnedStyles;
  // 식이 가드: 취미/활동 블록은 dietary_options 빈약 → hard dietary(halal/vegan/veg) 면 식당 매칭 throw 위험 → skip.
  const hardDiet = (Array.isArray(userInput && userInput.dietPrefs) ? userInput.dietPrefs : [])
    .some((d) => /halal|vegan|vegetarian/i.test(String(d || '')));
  if (hardDiet) return pinnedStyles;

  const n = ds.length;
  const candsFor = (sel) => getBlocksForCity(String((sel && sel.city) || '').toLowerCase()) || [];
  const blockOf = (sel) => candsFor(sel).find((b) => b && b.id === sel.block_id) || null;
  const pinnedIdx = new Set();

  for (const style of wanted) {
    const match = PINNED_ACTIVITY_STYLES[style];
    // 이미 그 취미 블록이 plan 에 있으면 skip (중복 방지)
    if (ds.some((sel) => { const b = blockOf(sel); return b && match(b); })) continue;
    // 안전 day (첫날·마지막날 제외, 미pin) 중 그 도시 후보에 매칭 블록 있는 첫 day 교체
    for (let i = 1; i < n - 1; i++) {
      if (pinnedIdx.has(i)) continue;
      const hobby = candsFor(ds[i]).find((b) => b && match(b));
      if (hobby) {
        ds[i] = { ...ds[i], block_id: hobby.id, tweak_notes: `취미 전용 day 확정 배정 (${style})` };
        pinnedIdx.add(i);
        pinnedStyles.push(style);
        break;
      }
    }
  }
  return pinnedStyles;
}

/**
 * PR-E: flag ON 시 block_mode 가 허용하는 block_type 집합 (city_day + 활동 블록).
 * flag OFF 시 city_day 단독 (현재 동작 byte-identical).
 *
 * 활동 블록은 stops 가 충분하므로 (trekking/running 모두 3 stops) 기존 stops.length>=3 가드 통과.
 */
const ACTIVITY_BLOCK_TYPES = ['trekking', 'running_route'];
function isAllowedBlockType(blockType, activityEnabled) {
  if (blockType === 'city_day') return true;
  if (activityEnabled && ACTIVITY_BLOCK_TYPES.includes(blockType)) return true;
  return false;
}

/**
 * PR-E: Gemini block 선택용 압축 카드 1개 생성.
 *
 * flag OFF → 기존 카드 shape byte-identical (block_type / activity 키 없음).
 * flag ON  → block_type + (활동 블록이면) activity 요약(difficulty/distance/unsuitable_for) 추가
 *            → Gemini 가 트레킹/러닝 day 를 적절히 배치 (full-day / 도착·출국일 회피).
 *
 * @param {object} b — raw block
 * @param {boolean} activityEnabled
 * @returns {object} block card
 */
function toBlockCard(b, activityEnabled) {
  const card = {
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
  };
  if (activityEnabled) {
    const blockType = b.block_type || 'city_day';
    card.block_type = blockType;
    const am = buildActivityMeta(b);
    if (am) {
      // 활동 블록은 full-day 성격 — Gemini 배치 판단용 핵심 요약만 (난이도/거리/부적합 대상).
      card.activity = {
        type: am.activity_type,
        difficulty: am.difficulty,
        distance_km: am.distance_km,
        elevation_gain_m: am.elevation_gain_m,
        unsuitable_for: am.unsuitable_for,
        requires_advance_booking: am.requires_advance_booking,
      };
    }
  }
  return card;
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

    // PR-E (2026-06-01): 활동 블록(trekking/running_route) flag — OFF 시 city_day 단독 (byte-identical).
    const activityEnabled = isActivityBlocksEnabled();

    let blocks = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (!data || typeof data !== 'object') return;
      // block_type 누락 시 default 'city_day' (backward compat — PR-A 의 schema 확장 전 block).
      const blockType = data.block_type || 'city_day';
      // PR-E: flag OFF → city_day 만 (현재 동작). flag ON → trekking / running_route 추가 허용.
      if (!isAllowedBlockType(blockType, activityEnabled)) return;
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

    // PR-E SAFETY (2026-06-01): 거동 제약(mobility) 손님은 활동 블록의 unsuitable_for 매칭 시 제외.
    //   trekking_meta 난이도/체력은 보존 의무지만, 휠체어/중증 거동제약 손님에게 트레킹 day 자체를
    //   배정하면 외국인 사고 risk → 사전 제외. pax 는 단순 count(연령/거동 breakdown 없음)라
    //   structured signal 부재 → 유일하게 확보 가능한 mobility 신호로 보수적 가드.
    //   flag OFF 시 활동 블록 자체가 없으므로 이 분기 무효과 (byte-identical 유지).
    if (activityEnabled) {
      const limited = isLimitedMobility(opts.mobility);
      if (limited) {
        const UNSAFE_FOR_LIMITED = new Set(['wheelchair_user', 'severe_mobility_limitation']);
        blocks = blocks.filter((b) => {
          const bt = b.block_type || 'city_day';
          if (bt === 'city_day') return true; // 시티 블록은 mobility 필터 비대상 (현재 동작 유지)
          const unsuit = Array.isArray(b.unsuitable_for) ? b.unsuitable_for.map((x) => String(x).toLowerCase()) : [];
          return !unsuit.some((x) => UNSAFE_FOR_LIMITED.has(x));
        });
      }
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
  // PR-E: flag OFF → 카드 shape byte-identical. flag ON → block_type + activity 요약 추가.
  const activityEnabled = isActivityBlocksEnabled();
  const blockCards = blocks.map((b) => toBlockCard(b, activityEnabled));

  const systemPrompt = buildBlockSelectionSystemPrompt(language, { activityEnabled });
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

  // P278 (2026-05-29): cache instrumentation (P266 chain 의 block_mode 측정 누락 fix).
  // Gemini usageMetadata 추출 — implicit cache hit 측정. legacy 만 측정되던 sleeper bug 해소.
  // 측정 100 plan 중 block_mode 46건 _cache_metadata 0% = handlerCore:400 의 itinerary._cache_metadata
  // 가 null (block_mode 가 attach 안 함) → P266 chain layer 2-5 silent skip.
  const cacheMetadata = (() => {
    const um = result?.response?.usageMetadata;
    if (!um) return { cached: 0, total: 0, output: 0 };
    return {
      cached: Number(um.cachedContentTokenCount) || 0,
      total: Number(um.promptTokenCount) || 0,
      output: Number(um.candidatesTokenCount) || 0,
    };
  })();

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
    return { day_selections: safe, language, cacheMetadata };
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
  return { day_selections: cleaned, language, cacheMetadata };
}

/**
 * block-mode 전용 system prompt — Gemini 가 block ID 선택만 책임짐.
 *
 * PR-E: opts.activityEnabled=true (FEATURE_ACTIVITY_BLOCKS ON) 시 트레킹/러닝 day 배치 규칙 추가.
 *   flag OFF (default) → 반환 문자열 byte-identical (회귀 0). ON 시에만 ## ACTIVITY BLOCKS 섹션 append.
 */
export function buildBlockSelectionSystemPrompt(language = 'en', opts = {}) {
  const activityEnabled = !!opts.activityEnabled;
  const activityRules = activityEnabled
    ? `

## ACTIVITY BLOCKS (trekking / running_route)
Some available_blocks carry block_type "trekking" or "running_route" with an "activity" summary (difficulty, distance_km, elevation_gain_m, unsuitable_for). Treat these as physically demanding FULL-DAY blocks:
- A trekking block occupies the ENTIRE day — do NOT combine it with a city_day block on the same day. Pick at most ONE activity block per day.
- NEVER place a trekking block on the arrival day (day 1 if the user just landed) or the departure day (last day) — fatigue + flight risk. Prefer a middle day.
- Only select an activity block when the user's styles indicate it (e.g. "Trekking", "Hallasan", "Running", "HangangRun") or special_request asks for it. Otherwise prefer city_day blocks.
- The block's difficulty / elevation / hazards / unsuitable_for are preserved downstream and shown to the user — do NOT hide or downplay them in tweak_notes.`
    : '';
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
7. Day 1 should be an easy / standard intensity block (arrival fatigue). Day N can be packed if styles indicate. Otherwise alternate intensity.${activityRules}

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
/** 두 좌표 간 거리(km) — food 근접 가중용 haversine. 호출 측에서 좌표 유효성 가드. */
function foodDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function matchFoodPlaceholder(placeholderStop, foodIndex, city, userDietPrefs = [], excludeNames = null) {
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
    // food_index.json 은 cuisine 필드 사용 (type/category 없음) — verified_cafe 매칭 누락 fix
    // (2026-06-02, plan 279c7ce0: 서울 cafe/dessert 356개 있는데 r.type 부재로 전부 탈락했음).
    const rType = String(r.type || r.category || r.cuisine || '').toLowerCase();
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

  // 근접 가중 정렬 (2026-06-02, plan b720d6db/9c0c2eaa 운영자 "동선 이상" + PR #760 후속 "③거리필터").
  //   기존: rating × log(reviews) 만 → 도시(seoul/jeju) 전체 1등 → 종로 코스에 강남 식당 박힘 = 동선 zigzag.
  //   (게다가 food_index 필드는 reviewCount 라 r.reviews 는 undefined → 기존 가중치가 죽어 사실상 배열순 선택.)
  //   개선: placeholder 앵커 좌표(빌드 시 geocoding)에서 가까울수록 가산. score = base / (1 + dist_km/DECAY).
  //   앵커 좌표 0/누락(mock seed·비-block 호출) 또는 후보 좌표 누락 시 base 만 = 현행 폴백(회귀 0).
  const DECAY_KM = 4.5; // 이 거리에서 가중치 ~절반 — 서울 구·제주 클러스터 모두 합리적(원거리만 강하게 배제).
  const aLat = Number(placeholderStop.lat);
  const aLng = Number(placeholderStop.lng);
  const hasAnchor = Number.isFinite(aLat) && Number.isFinite(aLng) && (aLat !== 0 || aLng !== 0);
  const scoreOf = (r) => {
    const base = (Number(r.rating) || 0) * Math.log10(Number(r.reviewCount || r.reviews) || 1);
    if (!hasAnchor) return base;
    const rLat = Number(r.lat);
    const rLng = Number(r.lng);
    const hasRC = Number.isFinite(rLat) && Number.isFinite(rLng) && (rLat !== 0 || rLng !== 0);
    const dist = hasRC ? foodDistanceKm(aLat, aLng, rLat, rLng) : 50; // 좌표 없는 후보 = 멀리 취급(배제 아님, sparse graceful)
    return base / (1 + dist / DECAY_KM);
  };
  candidates.sort((a, b) => scoreOf(b) - scoreOf(a));

  // 중복 방지 (2026-06-02, plan 4d214e83 신고 "같은 식당 6번 반복"): 이미 배정한 식당 제외하고
  // 차순위 선택. 전부 소진(작은 도시 식당 부족) 시에만 1순위 재사용 허용 (graceful).
  if (excludeNames instanceof Set && excludeNames.size > 0) {
    const fresh = candidates.find((c) => {
      const nm = String((c && (c.name || c.name_ko || c.display_name)) || '').trim();
      return nm && !excludeNames.has(nm);
    });
    if (fresh) return fresh;
  }
  return candidates[0];
}

/**
 * PR-E SAFETY (2026-06-01): 활동 블록(trekking/running_route) 의 안전 메타데이터를 day 에 보존.
 *
 * 트레킹/러닝 day 는 난이도·체력·고도·hazards·부적합 대상이 plan 에 반드시 표기되어야 함
 * (외국인 사고 예방 — 표기 누락 금지). zone_courses 의 trekking_meta / running_meta /
 * unsuitable_for / requires_advance_booking 을 day.activity_meta 로 정규화.
 *
 * city_day 블록 또는 메타 부재 시 null 반환 → 호출자가 day 에 attach 안 함 (현재 동작 유지).
 *
 * @param {object} block — fetchAvailableBlocks 의 raw block (block_type / *_meta 포함)
 * @returns {object|null} activity_meta 또는 null
 */
export function buildActivityMeta(block) {
  if (!block || typeof block !== 'object') return null;
  const blockType = block.block_type || 'city_day';
  if (blockType !== 'trekking' && blockType !== 'running_route') return null;

  const meta = blockType === 'trekking'
    ? (block.trekking_meta && typeof block.trekking_meta === 'object' ? block.trekking_meta : null)
    : (block.running_meta && typeof block.running_meta === 'object' ? block.running_meta : null);

  const unsuitableFor = Array.isArray(block.unsuitable_for)
    ? block.unsuitable_for.map((x) => String(x)).filter(Boolean)
    : [];

  // 난이도/체력/고도/hazards — 두 meta 타입 공통/개별 필드를 보존 (값 없으면 생략).
  const out = {
    activity_type: blockType,
    // SAFETY 핵심 — 난이도/체력/고도 (표기 누락 금지).
    difficulty: meta && meta.difficulty != null ? String(meta.difficulty) : undefined,
    elevation_gain_m: meta && Number.isFinite(Number(meta.elevation_gain_m)) ? Number(meta.elevation_gain_m) : undefined,
    distance_km: meta && Number.isFinite(Number(meta.total_distance_km || meta.total_km))
      ? Number(meta.total_distance_km || meta.total_km)
      : undefined,
    estimated_duration_min: meta && Number.isFinite(Number(meta.estimated_duration_min))
      ? Number(meta.estimated_duration_min)
      : undefined,
    hazards: meta && Array.isArray(meta.hazards) && meta.hazards.length > 0 ? meta.hazards.slice() : undefined,
    recommended_gear: meta && Array.isArray(meta.recommended_gear) && meta.recommended_gear.length > 0
      ? meta.recommended_gear.slice()
      : undefined,
    // 부적합 대상 — 휠체어/노약자/유아/고산 민감 (SAFETY 노출 의무).
    unsuitable_for: unsuitableFor.length > 0 ? unsuitableFor : undefined,
    requires_advance_booking: !!block.requires_advance_booking,
  };
  return out;
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

  // P281 (2026-05-29): placeholder fallback 카운터 — itinerary.quality_warnings 박제용.
  // Agent 2 deep-search 결과 68% (15/22 post-P245) block_mode plan 영향. 운영자 admin panel
  // (P121) 즉시 발견 → seed block 정정 trigger.
  let placeholderSynthesizedCount = 0;
  // 중복 식당 방지 (2026-06-02 plan 4d214e83): plan 전체에서 이미 배정한 식당명 추적.
  const usedFoodNames = new Set();
  // PR-E: 활동 블록(트레킹/러닝) day 수집 — SAFETY quality_warning 박제용 (난이도/체력 표기 의무).
  const activityDays = [];

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
        const matched = matchFoodPlaceholder(bs, foodIndex, area, dietPrefs, usedFoodNames);
        if (matched) {
          resolvedName = matched.name || matched.name_ko || matched.display_name || '';
          resolvedDisplay = matched.display_name || matched.name_en || resolvedName;
          resolvedAddress = matched.address || resolvedAddress;
          verified = true;
          if (resolvedName) usedFoodNames.add(String(resolvedName).trim());
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
          // P281 (2026-05-29): placeholder 매칭 실패 + dietary 강제 X → 명시적 placeholder text.
          // 이전: `resolvedName = bs.address || 'Local restaurant'` → 행정 주소 (예: "서울특별시
          //   종로구 가회동") 가 stop.name 으로 직접 노출 → 운영자 시점 "이름이 빠진 가게" sleeper bug.
          //   prod 측정 68% (15/22 post-P245 plan) block_mode 영향 (Agent 2 deep-search).
          // 현재: `[추천 venue - <지역명>]` 명시적 placeholder text + quality_warnings 박제.
          //   사용자 혼란 차단 + 운영자 admin panel (P121) 즉시 발견 → seed block 정정 trigger.
          const placeholderType = bs.placeholder || 'venue';
          const addrShort = String(bs.address || area || '').split(' ').slice(0, 2).join(' ') || area;
          resolvedName = `[추천 ${placeholderType} - ${addrShort}]`;
          resolvedDisplay = resolvedName;
          placeholderSynthesizedCount++;
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

    // Day 1 (arrival day) late-arrival cutoff (2026-06-02, plan 4d214e83 운영자 신고):
    //   밤 늦은 도착(dayStart 늦음)인데 block 전체 배치 → 새벽 관광 cascade. 마지막 날 departure
    //   cap 과 대칭으로 도착 당일도 22:00 이후 관광 stop trim. 정상 09:00 plan 무영향, lodging/
    //   airport/travel 보존. 다도시 expandBlocksToItineraryMultiCity 와 동일 룰.
    if (isFirstDay) {
      const toMin = (hhmm) => { const mm = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return mm ? (+mm[1]) * 60 + (+mm[2]) : -1; };
      const capMin = toMin('22:00');
      const dayStartMin = toMin(dayStart);
      while (stops.length > 1) {
        const last = stops[stops.length - 1];
        if (last.category === 'lodging' || last.category === 'airport' || last.category === 'travel') break;
        const lastMin = toMin(last.start_time);
        if (lastMin < 0) break;
        // 자정 넘어간 새벽 stop(lastMin < dayStartMin = 다음날) 또는 당일 22:00 이후 → trim.
        const pastMidnight = dayStartMin >= 0 && lastMin < dayStartMin;
        if (pastMidnight || lastMin > capMin) stops.pop();
        else break;
      }
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

    // PR-E SAFETY: 트레킹/러닝 블록이면 난이도/체력/hazards/부적합 대상을 day 에 보존 (표기 누락 금지).
    //   buildActivityMeta 는 city_day / 메타 부재 시 null → city_day plan 은 day shape 불변 (byte-identical).
    const dayActivityMeta = buildActivityMeta(block);
    if (dayActivityMeta) activityDays.push({ day: dayNum, activity_type: dayActivityMeta.activity_type, difficulty: dayActivityMeta.difficulty });

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
      // PR-E SAFETY: 활동 블록 day 에만 존재 (city_day day 는 undefined → JSON 직렬화 시 생략).
      ...(dayActivityMeta ? { activity_meta: dayActivityMeta } : {}),
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
  // P281 (2026-05-29): placeholder 매칭 실패 박제 — quality_warnings 에 운영자 admin panel 노출.
  if (placeholderSynthesizedCount > 0) {
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    itinerary.quality_warnings.push({
      kind: 'block_mode_placeholder_synthesized',
      type: 'block_mode_placeholder_synthesized',
      severity: 'medium',
      count: placeholderSynthesizedCount,
      message: `P281: block_mode seed block 의 placeholder ${placeholderSynthesizedCount}개 매칭 실패 → '[추천 venue - ...]' 명시. seed block 정정 권고 (Agent 2 deep-search 68% plan 영향).`,
    });
  }
  // PR-E SAFETY: 활동 블록(트레킹/러닝) day 포함 시 박제 — 난이도/체력 표기 의무 + 운영자 admin panel 노출.
  if (activityDays.length > 0) {
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    itinerary.quality_warnings.push({
      kind: 'block_mode_activity_day',
      type: 'block_mode_activity_day',
      severity: 'info',
      count: activityDays.length,
      days: activityDays,
      message: `PR-E: 활동 블록(트레킹/러닝) ${activityDays.length}개 day 편입. 난이도·체력·hazards·부적합 대상은 day.activity_meta 에 보존 (SAFETY 표기 의무).`,
    });
  }

  // daily_budget_summary: per-day skeleton (selfHealDailyBudget 가 정확값 계산 — 본 default 는 array shape 만).
  // P300/B2 (2026-05-29): 필드명 BudgetTable.tsx:9-15 일치 (food_krw→meals_krw, activity_krw→entry_fees_krw).
  //   기존 food_krw/activity_krw 는 frontend 가 안 읽어 예산표 0원. selfHealDailyBudget 가 rootValid=false 판정 시 덮어씀.
  itinerary.daily_budget_summary = days.map((d) => ({
    day: d.day,
    transport_krw: 0,
    entry_fees_krw: 0,
    meals_krw: 0,
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
  // PR-E: mobility 전달 — 활동 블록 SAFETY 거동 제약 필터 (flag ON 시에만 효과).
  const blocks = await fetchAvailableBlocks(adminDb, city, { dietaryRequired: dietPrefs, mobility: userInput.mobility });
  const elig = shouldUseBlockMode(city, userInput.durationDays, dietPrefs, blocks);
  if (!elig.eligible) {
    const err = new Error(`block-mode ineligible: ${elig.reason}`);
    err.code = 'BLOCK_MODE_INELIGIBLE';
    err.reason = elig.reason;
    throw err;
  }

  const selections = await selectBlocksWithGemini(blocks, userInput, geminiClient);
  // (2026-06-03) 선택한 취미 = 전용 day 보장 (flag OFF 기본 = no-op). 단도시는 city 무시 단일 pool.
  pinActivityDays(selections, () => blocks, userInput);
  const itinerary = expandBlocksToItinerary(selections, blocks, userInput);
  // P278 (2026-05-29): block_mode 의 _cache_metadata 측정 (P266 chain layer 1 호환).
  // handlerCore:400 가 itinerary?._cache_metadata 를 explicit pass-through → P266 chain layer 2-5
  // (savePlan / Inngest dispatch / worker / planPersister _debug.cacheMetrics) 자동 작동.
  // 이전: block_mode 46/100 plan _cache_metadata 0% (legacy 만 측정) sleeper bug.
  if (selections.cacheMetadata) {
    itinerary._cache_metadata = selections.cacheMetadata;
  }
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
export async function fetchAvailableBlocksMultiCity(adminDb, cities, dietPrefs = [], opts = {}) {
  const results = await Promise.all(
    cities.map(async (city) => {
      try {
        // PR-E: mobility 전달 — 활동 블록 SAFETY 거동 제약 필터 (flag ON 시에만 효과).
        const blocks = await fetchAvailableBlocks(adminDb, city, { dietaryRequired: dietPrefs, mobility: opts.mobility });
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
export function buildCityPerDay(cities, durationDays, perDayCity = null) {
  if (perDayCity && typeof perDayCity === 'object') {
    const result = [];
    for (let d = 1; d <= durationDays; d++) {
      // P321 standing obligation: city 키 흐르는 모든 경로 normalizeRegionKey 필수.
      // perDayCity 값도 한/영/일/중 → 영문 cityKey 로 정규화 (기존 .toLowerCase() 만으론
      // 한글 '서울' 이 Firestore/cityBlocksList 영문 키 'seoul' 과 mismatch → daySchedule
      // available_blocks 빈 배열 + day_selections.city 한글 → 취미 pin 실패).
      // 현재 perDayCity 는 미wiring(dead input)=fallback 만 사용 → byte-identical.
      // 향후 per-day 도시 위저드 wiring 시 P321 재발 예방용 선제 하드닝. split('_')[0] = L1567 패턴 동일.
      const explicit = normalizeRegionKey(String(perDayCity[d] || perDayCity[String(d)] || '').split('_')[0]);
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
  // PR-E: flag OFF → 카드 shape byte-identical. flag ON → block_type + activity 요약 추가.
  const activityEnabled = isActivityBlocksEnabled();
  const cityBlockCards = {};
  const allValidIds = new Set();
  for (const { city, blocks } of cityBlocksList) {
    cityBlockCards[city] = blocks.map((b) => toBlockCard(b, activityEnabled));
    blocks.forEach((b) => allValidIds.add(b.id));
  }

  // day-schedule: day 번호 → 도시 + 해당 도시 available blocks
  const daySchedule = cityPerDay.map((city, idx) => ({
    day: idx + 1,
    city,
    available_blocks: cityBlockCards[city] || [],
  }));

  const systemPrompt = buildBlockSelectionMultiCitySystemPrompt(language, { activityEnabled });
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

  // P278 (2026-05-29): cache instrumentation — multi-city block selection.
  // selectBlocksWithGemini 와 동일 패턴 (block_mode sleeper bug fix).
  const cacheMetadata = (() => {
    const um = result?.response?.usageMetadata;
    if (!um) return { cached: 0, total: 0, output: 0 };
    return {
      cached: Number(um.cachedContentTokenCount) || 0,
      total: Number(um.promptTokenCount) || 0,
      output: Number(um.candidatesTokenCount) || 0,
    };
  })();

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

  return { day_selections: safe, language, cacheMetadata };
}

/**
 * 다도시 block-mode 전용 system prompt.
 *
 * PR-E: opts.activityEnabled=true 시 트레킹/러닝 day 배치 규칙 추가. OFF (default) → byte-identical.
 */
export function buildBlockSelectionMultiCitySystemPrompt(language = 'en', opts = {}) {
  const activityEnabled = !!opts.activityEnabled;
  const activityRules = activityEnabled
    ? `

## ACTIVITY BLOCKS (trekking / running_route)
Some available_blocks carry block_type "trekking" or "running_route" with an "activity" summary (difficulty, distance_km, elevation_gain_m, unsuitable_for). Treat these as physically demanding FULL-DAY blocks:
- A trekking block occupies the ENTIRE day — pick at most ONE activity block per day, never alongside a city_day block.
- NEVER place a trekking block on the arrival day (day 1) or the departure day (last day). Prefer a middle day in the relevant city.
- Only select an activity block when the user's styles (e.g. "Trekking", "Hallasan", "Running", "HangangRun") or special_request indicate it.
- difficulty / elevation / hazards / unsuitable_for are preserved downstream and shown to the user — do NOT hide them.`
    : '';
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
7. Day 1 should be standard intensity. Last day can be lighter for departure prep.${activityRules}

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
  // PR-E: 활동 블록(트레킹/러닝) day 수집 — SAFETY quality_warning 박제용 (단도시 expand 와 동일).
  const activityDays = [];
  // 중복 식당 방지 (2026-06-02 plan 4d214e83): plan 전체 배정 식당명 추적 (단도시 expand 와 동일).
  const usedFoodNames = new Set();

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
        const matched = matchFoodPlaceholder(bs, foodIndex, dayCityKey, dietPrefs, usedFoodNames);
        if (matched) {
          resolvedName = matched.name || matched.name_ko || matched.display_name || '';
          resolvedDisplay = matched.display_name || matched.name_en || resolvedName;
          resolvedAddress = matched.address || resolvedAddress;
          verified = true;
          if (resolvedName) usedFoodNames.add(String(resolvedName).trim());
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
          // P281 (2026-05-29) 다도시 적용 (2026-06-02 plan 4d214e83): 단도시 expandBlocksToItinerary
          //   와 동일 — 행정 주소("서울특별시 종로구 가회동")를 stop.name 으로 직접 노출 금지.
          //   "[추천 venue - <지역명>]" 명시 placeholder text 로 사용자 혼란 차단.
          const placeholderType = bs.placeholder || 'venue';
          const addrShort = String(bs.address || dayCityKey || '').split(' ').slice(0, 2).join(' ') || dayCityKey;
          resolvedName = `[추천 ${placeholderType} - ${addrShort}]`;
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

    // Day 1 (arrival day) late-arrival cutoff (2026-06-02, plan 4d214e83 운영자 신고):
    //   밤 늦은 도착(dayStart = max(tour_start, arrival+60) 가 늦음)인데 block 전체를 그 시각부터
    //   배치 → 새벽 관광 cascade (20:29 도착 → 02:16 북촌 / 05:39 홍대). 마지막 날 departure cap 과
    //   대칭으로 도착 당일도 ARRIVAL_DAY_CAP 이후 관광 stop trim (체크인 + 가벼운 일정만). 정상
    //   09:00 시작 plan 은 stops 가 22:00 이전이라 무영향. lodging/airport/travel 은 보존.
    if (isFirstDay) {
      const toMin = (hhmm) => { const mm = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return mm ? (+mm[1]) * 60 + (+mm[2]) : -1; };
      const capMin = toMin('22:00');
      const dayStartMin = toMin(dayStart);
      while (stops.length > 1) {
        const last = stops[stops.length - 1];
        if (last.category === 'lodging' || last.category === 'airport' || last.category === 'travel') break;
        const lastMin = toMin(last.start_time);
        if (lastMin < 0) break;
        // 자정 넘어간 새벽 stop(lastMin < dayStartMin = 다음날) 또는 당일 22:00 이후 → trim.
        const pastMidnight = dayStartMin >= 0 && lastMin < dayStartMin;
        if (pastMidnight || lastMin > capMin) stops.pop();
        else break;
      }
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

    // PR-E SAFETY: 트레킹/러닝 블록이면 난이도/체력/hazards/부적합 대상 보존 (단도시 expand 와 동일).
    const dayActivityMeta = buildActivityMeta(block);
    if (dayActivityMeta) activityDays.push({ day: dayNum, activity_type: dayActivityMeta.activity_type, difficulty: dayActivityMeta.difficulty });

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
      // PR-E SAFETY: 활동 블록 day 에만 존재 (city_day day 는 생략 → byte-identical).
      ...(dayActivityMeta ? { activity_meta: dayActivityMeta } : {}),
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
  // PR-E SAFETY: 활동 블록(트레킹/러닝) day 포함 시 박제 — 난이도/체력 표기 의무 (단도시 expand 와 동일).
  if (activityDays.length > 0) {
    mcItinerary.quality_warnings = mcItinerary.quality_warnings || [];
    mcItinerary.quality_warnings.push({
      kind: 'block_mode_activity_day',
      type: 'block_mode_activity_day',
      severity: 'info',
      count: activityDays.length,
      days: activityDays,
      message: `PR-E: 활동 블록(트레킹/러닝) ${activityDays.length}개 day 편입. 난이도·체력·hazards·부적합 대상은 day.activity_meta 에 보존 (SAFETY 표기 의무).`,
    });
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
  // PR-E: mobility 전달 — 활동 블록 SAFETY 거동 제약 필터 (flag ON 시에만 효과).
  const cityBlocksList = await fetchAvailableBlocksMultiCity(adminDb, cities, dietPrefs, { mobility: userInput.mobility });
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
  // (2026-06-03) 선택한 취미 = 전용 day 보장 (flag OFF 기본 = no-op). 도시별 후보에서 매칭 → city 정합 가드 통과.
  pinActivityDays(selections, (cityKey) => (cityBlocksList.find((c) => String(c.city).toLowerCase() === cityKey)?.blocks || []), userInput);
  const itinerary = expandBlocksToItineraryMultiCity(selections, cityBlocksList, userInput);
  // P278 (2026-05-29): multi-city block_mode cache_metadata attach (P266 chain layer 1 호환).
  if (selections.cacheMetadata) {
    itinerary._cache_metadata = selections.cacheMetadata;
  }

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

  // P167+P321: regions 정규화 — 도시 key 추출 (예: 'seoul_city' → 'seoul', '서울' → 'seoul').
  // P321 (2026-05-31): normalizeRegionKey 로 한/영/일/중 → 영문 cityKey. 기존 .toLowerCase() 만으론
  // 한국어 regions(['서울','부산'])가 Firestore zone_courses 영문 키('seoul')와 mismatch → 블록 0건
  // → block_mode silent legacy 폴백 (ko/ja/zh 다도시 사용자 100% 영향 = 5일+ 느림 직접 원인).
  // 영문/unmapped 는 그대로 반환 → en 사용자 동작 불변(회귀 0). split('_')[0] 로 area-key 선처리.
  const cities = Array.isArray(regions) && regions.length > 0
    ? regions.map((r) => normalizeRegionKey(String(r || '').split('_')[0])).filter(Boolean)
    : [normalizeRegionKey(String(area || '').split('_')[0])].filter(Boolean);

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
