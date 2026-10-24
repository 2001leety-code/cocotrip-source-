/**
 * revisitPolicy — 검증 식당 재방문 정책 (2026-10-24, 운영자 결정 + Astra 설계 r1~r3).
 *
 * 운영자 결정: 식이 손님의 도시 검증 식당 후보가 바닥나면 같은 검증 식당을 **다른 날** 한 번 더 방문해도 된다
 * (동선상 가장 가까운 곳, 어쩔 수 없는 경우만). 같은 날 두 번·미검증 식당은 여전히 금지.
 *
 * 생산자(블록·교체기·pass2·모델)는 "새 식당 우선, 소진돼도 실패하지 않기"만 하고, 정확성은 이 모듈 한 쌍이 보장한다:
 *   - judgeRepeats    : 최종 일정 판정(종단 중복 게이트·품질 지표·하네스 공용). 허용 재방문만 중복에서 뺀다.
 *   - normalizeRevisits: 같은 걷기로 반복 지점을 고친다(미사용 적격 행으로 교체 → 소진이면 revisit 표시).
 * 둘은 같은 순서·같은 적격 집합·같은 소진 정의를 쓴다 — "유효한 배치가 있으면 judge(normalize(x)) 중복 0".
 *
 * 허용 재방문(judge) = 반복 지점의 stop 이 전부 만족:
 *   revisit === true · category food · verified === true · 시각 유효(HH:MM) · 행 ∈ 적격(그 날 도시·요청 안전 식이 전부)
 *   · 행 ∉ 오늘 방문 · 그 시점 (적격 \ 앞선 방문) = ∅ (소진 증명 — 앞선 stop 은 **최종 일정에 남은** 방문만, 시각 없는 stop 제외).
 * ctx 없음(foodIndex 없음 또는 안전 식이 없음) → 모든 반복 = 중복(현행 이름 기준과 동일).
 *
 * 🔴 식이 신뢰 완화 아님: 적격 = dietaryCoverageGate 와 같은 술어(isRowCityConsistent + 요청 식이 전부 dietaryEvidenceFor),
 *   unverified 행은 dietaryEvidenceFor 가 null 이라 절대 적격이 아니다. 순수 모듈(I/O 없음).
 */
import { findSelectedFoodRow } from '../_shared/food-name-match.js';
import { dietaryEvidenceFor, dietaryTagsOfRow, describeDietaryEvidence } from '../_shared/dietary-trust.js';
import { isRowCityConsistent } from '../_shared/food-row-provenance.js';
import { resolveUiCityKey } from '../_shared/cityResolver.js';
import { avoidKey } from '../_shared/plannerIntentV1.js';
import { revisitNote, stripRevisitNote } from '../../src/lib/revisitNote.js';

const SAFETY_DIETS = ['halal', 'vegan', 'vegetarian'];
const REVISIT_FIELDS = ['revisit', 'revisit_note', '_revisit_note'];

/** 요청 식이 중 안전 식이(소문자·중복 제거) — dietaryCoverageGate.safetyDietsOf 와 같은 규칙. */
export function safetyDiets(dietary) {
  return [...new Set((Array.isArray(dietary) ? dietary : []).map((d) => String(d).toLowerCase()).filter((d) => SAFETY_DIETS.includes(d)))];
}

/** 도시 키 — dietaryCoverageGate.mealCityCode 와 같은 규칙('_' 접미 제거 → UI 도시 SSOT 별칭, 없으면 소문자 원문). */
export function cityKeyOf(value) {
  const t = String(value || '').toLowerCase().trim().split('_')[0].trim();
  return resolveUiCityKey(t) || t;
}

/** HH:MM(00~23:00~59) 만 유효 — 관대한 파서(qualityMetrics) 재사용 금지(R5). */
export function parseStrictHHMM(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof value === 'string' ? value.trim() : '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * 종단 중복 판정 키 — 숙소·빈 이름은 ''(비교 제외). 이름은 신·구 필드 폴백 → trim → 소문자.
 * 신 스키마(name/display_name)만 본다(CLAUDE.md B-2). 레거시 필드 폴백은 qualityMetrics.stopDuplicateKey 가 갖고,
 * 그 키는 ctx.labelOf 로 주입된다(qualityMetrics → revisitPolicy 단방향 — 순환 import 없음).
 */
export function stopDuplicateKey(stop) {
  if (!stop || stop.category === 'lodging') return '';
  return String(stop.name || stop.display_name || '').trim().toLowerCase();
}

/** ctx.labelOf(키 함수)가 있으면 그것, 없으면 신 스키마 키. 행 식별(findSelectedFoodRow)이 항상 우선. */
const keyFnOf = (ctx) => (ctx && typeof ctx.labelOf === 'function' ? ctx.labelOf : stopDuplicateKey);
const displayLabel = (stop, key) => String(stop.name || stop.display_name || '').trim() || key;

const rowName = (row) => String((row && row.name) || '').split('|')[0].trim();

function validCtx(ctx) {
  const diets = safetyDiets(ctx && ctx.dietary);
  const foodIndex = ctx && Array.isArray(ctx.foodIndex) && ctx.foodIndex.length > 0 ? ctx.foodIndex : null;
  if (!foodIndex || diets.length === 0) return null;
  const avoidKeys = (Array.isArray(ctx.avoidStopNames) ? ctx.avoidStopNames : []).map((n) => avoidKey(n)).filter(Boolean);
  return { foodIndex, diets, avoidKeys };
}

function isAvoidedRow(row, avoidKeys) {
  if (!avoidKeys || avoidKeys.length === 0) return false;
  return [rowName(row), row.nameEn].map((v) => avoidKey(v)).filter(Boolean).some((k) => avoidKeys.includes(k));
}

/** 이름 → 행 (food-name-match 의 식별자 우선 매처). 못 찾으면 null(허용 재방문 불가). */
export function resolveRow(stop, foodIndex, dayCity) {
  return findSelectedFoodRow(stop, foodIndex, { dayCity: dayCity || '', normalizeCity: cityKeyOf });
}

/**
 * 도시 전체(선호·거리로 좁힌 부분집합 아님) 적격 행 — trusted + 요청 안전 식이 **전부** + 주소-도시 정합
 * + 사용자 제외(avoid) 아님 + 저장될 이름으로 다시 찾으면 **그 행이 유일하게** 나오는 행(R4: 이름 충돌 행 제외).
 * @param {object[]} foodIndex
 * @param {string} cityCode — cityKeyOf 결과
 * @param {string[]} diets — 소문자 안전 식이(비면 [])
 * @param {{avoidKeys?: string[]}} [opts]
 */
export function eligibleRows(foodIndex, cityCode, diets, { avoidKeys = [] } = {}) {
  if (!Array.isArray(foodIndex) || !cityCode || !Array.isArray(diets) || diets.length === 0) return [];
  return foodIndex.filter((r) => r && typeof r === 'object'
    && cityKeyOf(r.city) === cityCode
    && isRowCityConsistent(r)
    && diets.every((d) => dietaryEvidenceFor(r, d))
    && !isAvoidedRow(r, avoidKeys)
    && rowName(r) !== ''
    && findSelectedFoodRow({ name: rowName(r) }, foodIndex, { dayCity: cityCode, normalizeCity: cityKeyOf }) === r);
}

/**
 * 판정 순서 — (dayIndex, start_time 분). start_time 없음/형식 오류 stop 은 그 날 맨 뒤(원래 순서 유지), minute=null.
 * @returns {Array<{stop: object, day: object, dayIndex: number, dayCity: string, minute: number|null}>}
 */
export function orderedStops(itinerary) {
  const out = [];
  const days = Array.isArray(itinerary && itinerary.days) ? itinerary.days : [];
  days.forEach((day, dayIndex) => {
    const stops = Array.isArray(day && day.stops) ? day.stops : [];
    const dayCity = cityKeyOf(day && day.city);
    const entries = stops.map((stop, j) => ({ stop, day, dayIndex, dayCity, minute: parseStrictHHMM(stop && stop.start_time), j }))
      .filter((e) => e.stop && typeof e.stop === 'object');
    entries.sort((a, b) => {
      if (a.minute === null && b.minute === null) return a.j - b.j;
      if (a.minute === null) return 1;
      if (b.minute === null) return -1;
      return a.minute - b.minute || a.j - b.j;
    });
    for (const e of entries) out.push({ stop: e.stop, day: e.day, dayIndex: e.dayIndex, dayCity: e.dayCity, minute: e.minute });
  });
  return out;
}

/** 판정 순서의 food stop 만. */
export function orderedFoodStops(itinerary) {
  return orderedStops(itinerary).filter((e) => e.stop.category === 'food');
}

/** 걷기 공용 상태 — judge/normalize 가 같은 정의를 쓰게 한 곳에. */
function makeWalker(c, keyFn = stopDuplicateKey) {
  const eligibleCache = new Map();
  const eligibleFor = (city) => {
    if (!c) return [];
    if (!eligibleCache.has(city)) eligibleCache.set(city, eligibleRows(c.foodIndex, city, c.diets, { avoidKeys: c.avoidKeys }));
    return eligibleCache.get(city);
  };
  const rowIndex = new Map();
  const keyFor = (entry, row) => {
    if (row) {
      if (!rowIndex.has(row)) rowIndex.set(row, rowIndex.size);
      return `row:${rowIndex.get(row)}`;
    }
    return keyFn(entry.stop);
  };
  return { eligibleFor, keyFor };
}

/** 허용 재방문 판정(반복 지점에서) — judge 와 normalize 가 공유. */
function isApprovedRevisit(entry, row, state, eligible) {
  const s = entry.stop;
  return s.revisit === true && s.category === 'food' && s.verified === true && entry.minute !== null
    && !!row && eligible.includes(row) && !state.visitedToday.has(row)
    && eligible.every((r) => state.visitedBefore.has(r));
}

/**
 * 최종 일정 판정.
 * @param {object} itinerary
 * @param {{foodIndex?: object[], dietary?: string[], avoidStopNames?: string[], labelOf?: (stop: object) => string}} [ctx]
 *   labelOf — 행 미식별 stop 의 그룹 키 함수(qualityMetrics 가 레거시 폴백 키를 넘긴다). 없으면 신 스키마 키.
 * @returns {{duplicates: Array<{name: string, count: number}>, revisits: Array<{name: string, day: number}>}}
 */
export function judgeRepeats(itinerary, ctx) {
  const c = validCtx(ctx);
  const keyFn = keyFnOf(ctx);
  const { eligibleFor, keyFor } = makeWalker(c, keyFn);
  const groups = new Map();
  const revisits = [];
  const state = { visitedBefore: new Set(), visitedToday: new Set() };
  let currentDay = -1;
  for (const entry of orderedStops(itinerary)) {
    if (entry.dayIndex !== currentDay) { currentDay = entry.dayIndex; state.visitedToday = new Set(); }
    const nameKey = keyFn(entry.stop);
    if (!nameKey) continue;
    const row = c && entry.stop.category === 'food' ? resolveRow(entry.stop, c.foodIndex, entry.day && entry.day.city) : null;
    const key = keyFor(entry, row);
    const g = groups.get(key) || { label: displayLabel(entry.stop, nameKey), count: 0, approved: 0 };
    g.count += 1;
    if (g.count > 1 && c && row && isApprovedRevisit(entry, row, state, eligibleFor(entry.dayCity))) {
      g.approved += 1;
      revisits.push({ name: g.label, day: Number(entry.day && entry.day.day) || entry.dayIndex + 1 });
    }
    groups.set(key, g);
    if (row) {
      state.visitedToday.add(row);
      if (entry.minute !== null) state.visitedBefore.add(row);
    }
  }
  const duplicates = [];
  for (const g of groups.values()) {
    const n = g.count - g.approved;
    if (n > 1) duplicates.push({ name: g.label, count: n });
  }
  return { duplicates, revisits };
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const hasCoord = (o) => !!o && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng)) && o.lat !== null && o.lng !== null && o.lat !== '' && o.lng !== '';

/** 가장 가까운 행(순수 haversine) — 기준점 없거나 좌표 없는 행은 맨 뒤, 동률은 평점. */
function nearest(rows, anchor) {
  const scored = rows.map((r) => ({ r, d: anchor && hasCoord(r) ? distanceKm(Number(anchor.lat), Number(anchor.lng), Number(r.lat), Number(r.lng)) : Infinity }));
  scored.sort((a, b) => a.d - b.d || (Number(b.r.rating) || 0) - (Number(a.r.rating) || 0));
  return scored.length ? scored[0].r : null;
}

function clearRevisit(stop) {
  let changed = false;
  for (const f of REVISIT_FIELDS) if (f in stop) { delete stop[f]; changed = true; }
  return changed;
}

/** 행 값으로 stop 교체 — dietaryStopReplacer 와 같은 필드 규칙(이름=한국어, display_name=영문, 증거=행). */
// 옛 식당에만 맞는 필드 — 새 행에 같은 값이 없으므로 지운다(화면에 A 의 메뉴·예약 링크가 B 아래 뜨지 않게).
const RESTAURANT_ONLY_FIELDS = [
  'recommended_items', 'reservation_required', 'reservation_note', 'reservation_phone', 'reservation_url',
  'entry_fee_note', 'description', 'local_tag', '_dbMatchedName', '_intentScore', 'naverMapUrl',
];
const REPLACED_REASON = {
  ko: '검증 식당 대안으로 교체했습니다.',
  en: 'Replaced with a verified alternative restaurant.',
  ja: '確認済みの代替レストランに差し替えました。',
  zh: '已替换为经核实的替代餐厅。',
};

/**
 * stop 을 식당 DB 행으로 교체(정규화기·dietaryStopReplacer 공용). 행에 있는 값은 행 값으로, 옛 식당 종속 필드는 삭제.
 * 유지: order/start_time/end_time/stay_min/category/이동 구간(구간은 호출부 — clearReplacedLegs 등).
 * 식이 근거는 행에서만(요청 식이 전부의 증거) — 모델·옛 stop 값을 신뢰하지 않는다.
 * @param {object} stop — in place
 * @param {object} row — 적격 판정된 DB 행
 * @param {{diets?: string[], language?: string}} [opts]
 */
export function applyFoodRowToStop(stop, row, { diets = [], language = 'en' } = {}) {
  const name = rowName(row);
  stop.name = name;
  stop.display_name = row.nameEn || name;
  if (row.address) stop.address = row.address; else delete stop.address;
  if (hasCoord(row)) { stop.lat = Number(row.lat); stop.lng = Number(row.lng); } else { delete stop.lat; delete stop.lng; }
  if (row.googleMapsUrl) stop.googleMapsUrl = row.googleMapsUrl; else delete stop.googleMapsUrl;
  for (const f of RESTAURANT_ONLY_FIELDS) delete stop[f];
  stop.verified = true;
  stop.dietary_tags = [...dietaryTagsOfRow(row)];
  const evidence = diets.map((d) => dietaryEvidenceFor(row, d)).filter(Boolean);
  if (evidence.length) stop.dietary_evidence = evidence; else delete stop.dietary_evidence;
  // tip: 옛 식당 설명이 남지 않게 — 등급을 숨기지 않는 정직 문구(영업시간·메뉴 확언 없음).
  stop.tip = evidence[0]
    ? describeDietaryEvidence(evidence[0].verification_status, language)
    : `Listed in our ${String(row.tag || 'restaurant')} database. Please confirm with the restaurant and check opening hours before visiting.`;
  stop.personalization_reasoning = REPLACED_REASON[language] || REPLACED_REASON.en;
}

function applyRow(stop, row, diets, language) {
  applyFoodRowToStop(stop, row, { diets, language });
}

/**
 * 반복 지점 정규화 — judge 와 같은 걷기.
 *   (a) 그 도시 적격 행 중 앞서 방문 안 한 행(오늘 포함)이 있으면 → 가장 가까운 행으로 교체(revisit 필드 제거)
 *       [mode 'markOnly' 면 교체 안 함 — 동선 계산 뒤(R2)]
 *   (b) 없으면: 현재 행이 적격이고 오늘 미방문이면 revisit: true 표시, 아니면 오늘 미방문 적격 행 중 가장 가까운 행으로 교체 + 표시
 *   (c) 그것도 없으면 그대로(게이트가 거부).
 * 첫 방문 stop 에 남은 revisit/revisit_note/_revisit_note 는 제거한다.
 * @param {object} itinerary — in place
 * @param {{foodIndex?: object[], dietary?: string[], avoidStopNames?: string[], language?: string}} [ctx]
 * @param {{mode?: 'replace'|'markOnly'}} [opts]
 * @returns {{changes: Array<{day: number, action: 'replace'|'mark'|'unmark', from: string, to: string, stop?: object}>}}
 *   replace 항목은 교체된 stop 참조를 함께 준다 — 동선 계산 뒤 호출부가 그 stop 의 이동 구간을 비우는 데 쓴다.
 */
export function normalizeRevisits(itinerary, ctx, { mode = 'replace' } = {}) {
  const changes = [];
  const c = validCtx(ctx);
  const language = (ctx && ctx.language) || 'en';
  const { eligibleFor } = makeWalker(c);
  const seenRows = new Set();
  const seenNames = new Set();
  const state = { visitedBefore: new Set(), visitedToday: new Set() };
  let currentDay = -1;
  let prevWithCoord = null;
  let dayAnchor = null;
  for (const entry of orderedStops(itinerary)) {
    const stop = entry.stop;
    const dayNo = Number(entry.day && entry.day.day) || entry.dayIndex + 1;
    if (entry.dayIndex !== currentDay) {
      currentDay = entry.dayIndex;
      state.visitedToday = new Set();
      prevWithCoord = null;
      dayAnchor = (entry.day.stops || []).find((s) => hasCoord(s)) || (hasCoord(entry.day.lodging) ? entry.day.lodging : null);
    }
    const isFood = stop.category === 'food';
    const row = c && isFood ? resolveRow(stop, c.foodIndex, entry.day.city) : null;
    const nameKey = keyFnOf(ctx)(stop);
    const repeat = row ? seenRows.has(row) : (nameKey && seenNames.has(nameKey));
    let finalRow = row;
    if (isFood && !repeat) {
      if (clearRevisit(stop)) changes.push({ day: dayNo, action: 'unmark', from: rowName(row) || nameKey, to: rowName(row) || nameKey });
    } else if (isFood && repeat && c && row) {
      const eligible = eligibleFor(entry.dayCity);
      const anchor = prevWithCoord || dayAnchor;
      const unused = eligible.filter((r) => !state.visitedBefore.has(r) && !state.visitedToday.has(r) && !seenRows.has(r));
      if (unused.length > 0 && mode === 'replace') {
        const pick = nearest(unused, anchor);
        const from = rowName(row);
        applyRow(stop, pick, c.diets, language);
        clearRevisit(stop);
        stop._replaced_for_revisit = from;
        finalRow = pick;
        changes.push({ day: dayNo, action: 'replace', from, to: rowName(pick), stop });
      } else if (unused.length === 0 && entry.minute !== null) {
        const todayFree = eligible.filter((r) => !state.visitedToday.has(r));
        const exhausted = eligible.every((r) => state.visitedBefore.has(r));
        if (exhausted && eligible.includes(row) && !state.visitedToday.has(row)) {
          if (stop.revisit !== true || stop.verified !== true) {
            stop.revisit = true;
            stop.verified = true;
            changes.push({ day: dayNo, action: 'mark', from: rowName(row), to: rowName(row) });
          }
        } else if (exhausted && todayFree.length > 0 && mode === 'replace') {
          const pick = nearest(todayFree, anchor);
          const from = rowName(row);
          applyRow(stop, pick, c.diets, language);
          stop.revisit = true;
          stop._replaced_for_revisit = from;
          finalRow = pick;
          changes.push({ day: dayNo, action: 'replace', from, to: rowName(pick), stop });
          changes.push({ day: dayNo, action: 'mark', from: rowName(pick), to: rowName(pick) });
        }
      }
    }
    if (finalRow) {
      seenRows.add(finalRow);
      state.visitedToday.add(finalRow);
      if (entry.minute !== null) state.visitedBefore.add(finalRow);
    } else if (nameKey) {
      seenNames.add(nameKey);
    }
    if (hasCoord(stop)) prevWithCoord = stop;
  }
  return { changes };
}

/**
 * 교체된 stop 의 이동 구간(그 stop 으로 오는 구간 + 다음 stop 으로 가는 구간)을 비운다 — 옛 식당 기준 이동·시간·교통비가
 * 남지 않게(R2). 재계산 함수가 없는 경로(수정 API)용; 비워진 구간은 화면에서 이동 정보 없음으로 보인다.
 * @returns {number} 비운 구간 수
 */
export function clearReplacedLegs(itinerary, changes) {
  let n = 0;
  const replaced = new Set((changes || []).filter((c) => c && c.action === 'replace' && c.stop).map((c) => c.stop));
  for (const day of Array.isArray(itinerary && itinerary.days) ? itinerary.days : []) {
    const stops = Array.isArray(day && day.stops) ? day.stops : [];
    stops.forEach((s, i) => {
      if (!replaced.has(s)) return;
      for (const t of [s, stops[i + 1]]) {
        if (!t) continue;
        for (const f of ['travelFromPrev', 'transit_from_prev']) if (f in t) { delete t[f]; n += 1; }
      }
    });
  }
  return n;
}

/**
 * 재방문(revisit: true) food stop tip 끝에 안내 1문장(R6) — planPersister.applyRevisitNotes 로도 내보낸다.
 * 먼저 모든 stop 의 tip 에서 기존 안내(4개 언어 + 저장된 revisit_note)를 떼고, 정규화 결과 revisit===true 인
 * food stop 에만 다시 붙인다 → 언어 바뀜·표시 해제·pass3 tip 덮어쓰기 뒤에도 문장 1회·정확한 언어. revisit_note 에 저장.
 * @returns {number} 안내가 붙은 stop 수
 */
export function applyRevisitNotes(itinerary, { language } = {}) {
  let n = 0;
  const note = revisitNote(language);
  for (const day of Array.isArray(itinerary && itinerary.days) ? itinerary.days : []) {
    for (const stop of Array.isArray(day && day.stops) ? day.stops : []) {
      if (!stop || typeof stop !== 'object') continue;
      const prior = stop.revisit_note;
      // 안내는 tip 에만 저장. 본문은 화면과 같은 폴백(tip 우선) — tip 이 비고 옛 필드에만 설명이 있던 stop 도 설명이 남게.
      if (typeof stop.tip === 'string') stop.tip = stripRevisitNote(stop.tip, prior);
      if (stop.category === 'food' && stop.revisit === true) {
        const tip = String(stripRevisitNote(stop.tip || stop.tip_en || '', prior) || '').trim();
        stop.tip = tip ? `${tip} ${note}` : note;
        stop.revisit_note = note;
        stop._revisit_note = true;
        n += 1;
      } else {
        delete stop.revisit_note;
        delete stop._revisit_note;
      }
    }
  }
  return n;
}
