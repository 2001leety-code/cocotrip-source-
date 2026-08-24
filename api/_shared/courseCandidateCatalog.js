/**
 * courseCandidateCatalog.js — course-ai "주변 추천"의 서버 소유 후보 카탈로그 (2026-08-24).
 *
 * 배경: 이전 course-ai 는 Gemini 가 지어낸 name/lat/lng 를 그대로 응답에 실었다 — 모델이
 * 존재하지 않는 장소나 틀린 좌표를 만들어내도(hallucination) 걸러낼 방법이 없었다.
 *
 * 그래서 "추천 후보"의 identity(위치·이름·좌표)는 전부 이 서버 카탈로그(api/_attractions_index.json,
 * 실존 130곳)가 SSOT 다. Gemini 에게는 candidateId 만 보여주고 그 중에서 고르게 한다 —
 * 이름·좌표를 다시 만들어내지 못하게. 모델이 목록에 없는 id 를 반환하거나 응답을 조작해도
 * rehydrateCandidates 가 카탈로그에 없는 id 는 전부 버린다(0건이면 빈 배열, 대체 추측 금지).
 *
 * ⚠️ api/ ↔ src/ 상호 import 금지 — 프론트 courseOps 의 CourseStop 타입과는 독립.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _catalog = null;

/** api/_attractions_index.json 캐시 로드 — 실패해도 빈 배열(추천 0건, 500 금지). */
function loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const raw = readFileSync(join(__dirname, '..', '_attractions_index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    _catalog = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[courseCandidateCatalog] _attractions_index.json 로드 실패:', err.message);
    _catalog = [];
  }
  return _catalog;
}

const CANDIDATE_LANGS = ['ko', 'en', 'ja', 'zh'];

function localizedName(row, lang) {
  const names = row?.name || {};
  return names[lang] || names.en || names.ko || '';
}

/** 언어 무관 대소문자·공백 제거 비교용 정규화. */
function normalizeForDedupe(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

/** 위경도 절대차가 이 이하면 "같은 장소" 로 본다(대략 100m 이내). */
const NEAR_IDENTICAL_DEG = 0.001;

function isNearIdenticalCoord(aLat, aLng, bLat, bLng) {
  return Math.abs(aLat - bLat) <= NEAR_IDENTICAL_DEG && Math.abs(aLng - bLng) <= NEAR_IDENTICAL_DEG;
}

/** 카탈로그 row → 클라이언트/모델에 노출할 candidate shape (identity 는 전부 서버 값). */
function toCandidateShape(row, lang) {
  return {
    candidateId: row.key,
    placeKey: row.key,
    placeSource: 'cocotrip-attractions',
    name: localizedName(row, lang),
    lat: row.lat,
    lng: row.lng,
    theme: row.theme || 'sight',
  };
}

/**
 * 이미 선택된 stop 들과 겹치는 카탈로그 row 를 제외 대상으로 표시하기 위한 signature 집합.
 * @param {Array<{title?: string, lat?: number, lng?: number, placeKey?: string, placeSource?: string}>} selectedStops
 */
function buildExclusionIndex(selectedStops) {
  const excludedKeys = new Set();
  const excludedNames = new Set();
  const excludedCoords = [];
  for (const s of selectedStops || []) {
    if (s?.placeSource === 'cocotrip-attractions' && typeof s.placeKey === 'string' && s.placeKey) {
      excludedKeys.add(s.placeKey);
    }
    if (typeof s?.title === 'string' && s.title) excludedNames.add(normalizeForDedupe(s.title));
    if (Number.isFinite(s?.lat) && Number.isFinite(s?.lng)) excludedCoords.push([s.lat, s.lng]);
  }
  return { excludedKeys, excludedNames, excludedCoords };
}

function isExcluded(row, index) {
  if (index.excludedKeys.has(row.key)) return true;
  for (const lang of CANDIDATE_LANGS) {
    if (index.excludedNames.has(normalizeForDedupe(row.name?.[lang]))) return true;
  }
  for (const [lat, lng] of index.excludedCoords) {
    if (isNearIdenticalCoord(row.lat, row.lng, lat, lng)) return true;
  }
  return false;
}

/**
 * 선택된 장소들 근처의 후보를 서버 카탈로그에서 뽑는다 — Gemini 는 이 목록의 candidateId
 * 만 선택할 수 있다(이름/좌표를 지어낼 수 없음).
 *
 * @param {object} opts
 * @param {number} [opts.lat] - 기준 좌표(보통 선택된 stop 들의 중심). 없으면 거리순 미정렬(카탈로그 순서).
 * @param {number} [opts.lng]
 * @param {Array} [opts.excludeStops] - 이미 코스에 있는 stop 들(제외 대상).
 * @param {string} [opts.lang] - 응답 name 언어. 기본 'en'.
 * @param {number} [opts.limit] - 최대 후보 개수. 기본 12.
 * @returns {object[]} candidate shape 배열(거리순, 없으면 카탈로그 원순서).
 */
export function getCourseCandidates(opts = {}) {
  const catalog = loadCatalog();
  if (!catalog.length) return [];
  const lang = CANDIDATE_LANGS.includes(opts.lang) ? opts.lang : 'en';
  const exclusion = buildExclusionIndex(opts.excludeStops);
  const hasOrigin = Number.isFinite(opts.lat) && Number.isFinite(opts.lng);

  let rows = catalog.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng) && !isExcluded(row, exclusion));
  if (hasOrigin) {
    rows = rows
      .map((row) => ({ row, d2: (row.lat - opts.lat) ** 2 + (row.lng - opts.lng) ** 2 }))
      .sort((a, b) => a.d2 - b.d2)
      .map((entry) => entry.row);
  }
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 12;
  return rows.slice(0, limit).map((row) => toCandidateShape(row, lang));
}

/**
 * 모델(또는 다른 신뢬 불가 출처)이 고른 candidateId 목록을 서버 카탈로그로만 복원한다.
 * 카탈로그에 없는/변조된 id 는 조용히 버린다(포함하지 않음) — 이름·좌표는 절대 모델 값을
 * 쓰지 않고 카탈로그 row 에서만 가져온다. 유효한 id 가 하나도 없으면 빈 배열.
 *
 * @param {unknown} candidateIds - 모델이 반환한 id 배열(신뢰 불가).
 * @param {string} [lang] - 응답 name 언어. 기본 'en'.
 * @returns {object[]} candidate shape 배열(중복 제거, 카탈로그 순서 유지).
 */
export function rehydrateCandidates(candidateIds, lang = 'en') {
  const catalog = loadCatalog();
  if (!catalog.length || !Array.isArray(candidateIds)) return [];
  const wantedLang = CANDIDATE_LANGS.includes(lang) ? lang : 'en';
  const byKey = new Map(catalog.map((row) => [row.key, row]));
  const seen = new Set();
  const out = [];
  for (const rawId of candidateIds) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    const row = byKey.get(id);
    if (!row) continue; // 카탈로그에 없는 id — 모델 hallucination/변조, 조용히 버림
    seen.add(id);
    out.push(toCandidateShape(row, wantedLang));
  }
  return out;
}
