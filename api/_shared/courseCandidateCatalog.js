/**
 * courseCandidateCatalog.js — course-ai "주변 추천"의 서버 소유 후보 카탈로그.
 *
 * 장소 identity(이름·좌표)는 전부 서버 자료가 SSOT 다. Gemini 는 candidateId 만 고르고,
 * rehydrateCandidates 가 서버 값으로 다시 복원한다. 관광지는 _attractions_index.json,
 * 식당은 _food_index.json 중 Google placeId + 평점/리뷰 하한을 통과한 general 행만 쓴다.
 * 식이 태그 행은 이 일반 주변추천에서 제외해 할랄·비건·알레르기 주장을 만들지 않는다.
 *
 * api/ ↔ src/ 상호 import 금지 — 프론트 courseOps 타입과는 독립이다.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _attractionCatalog = null;
let _foodCatalog = null;
const _catalogErrors = new Set();
const _candidateCache = new Map();
const _candidateMapCache = new Map();

const CANDIDATE_LANGS = ['ko', 'en', 'ja', 'zh'];
const ATTRACTION_SOURCE = 'cocotrip-attractions';
const FOOD_SOURCE = 'cocotrip-food';
const FOOD_MIN_RATING = 4.5;
const FOOD_MIN_REVIEWS = 20;
const FOOD_MAX_DISTANCE_KM = 5;
const ATTRACTION_MAX_DISTANCE_KM = 20;
const EARTH_RADIUS_KM = 6371;
const DIETARY_CLAIM_RE = /\b(?:halal|muslim|islamic|kosher|vegan|vegetarian|pescatarian|jain|keto)\b|\bplant[\s-]*based\b|\b(?:gluten|allerg(?:y|en)|dairy|lactose|nut|peanut|pork|shellfish|egg|sugar)[\s-]*(?:free|friendly)\b|\bdiet(?:ary)?\b|비건|채식|할랄|무슬림|이슬람|코셔|글루텐|알레르기|저탄고지|페스코|락토|유당|돼지고기|갑각류|조개류|견과|素食|清真|无麸质|犹太洁食|ハラール|ムスリム|イスラム|ヴィーガン|ベジタリアン|グルテンフリー/iu;

function loadJsonArray(filename, label) {
  try {
    const parsed = JSON.parse(readFileSync(join(__dirname, '..', filename), 'utf-8'));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('비어 있거나 배열이 아님');
    _catalogErrors.delete(label);
    return parsed;
  } catch (err) {
    _catalogErrors.add(label);
    console.warn(`[courseCandidateCatalog] ${label} 로드 실패:`, err.message);
    return [];
  }
}

function loadAttractionCatalog() {
  if (_attractionCatalog) return _attractionCatalog;
  _attractionCatalog = loadJsonArray('_attractions_index.json', '_attractions_index.json');
  return _attractionCatalog;
}

function hasDietaryClaim(row) {
  const explicitClaim = [row?.dietary_claim, row?.certification_type]
    .some((value) => String(value || '').trim() && !/^(none|unknown|n\/a)$/iu.test(String(value).trim()));
  if (explicitClaim) return true;
  return [row?.name, row?.nameEn, row?.cuisine, row?.cuisineKo, row?.description, row?.notes]
    .some((value) => DIETARY_CLAIM_RE.test(String(value || '')));
}

export function isRecommendationGradeFood(row) {
  return row?.tag === 'general'
    && typeof row.placeId === 'string'
    && !!row.placeId.trim()
    && typeof row.name === 'string'
    && !!row.name.trim()
    && Number.isFinite(row.lat)
    && Number.isFinite(row.lng)
    && Number(row.rating) >= FOOD_MIN_RATING
    && Number(row.reviewCount) >= FOOD_MIN_REVIEWS
    && !hasDietaryClaim(row);
}

function loadFoodCatalog() {
  if (_foodCatalog) return _foodCatalog;
  _foodCatalog = loadJsonArray('_food_index.json', '_food_index.json')
    .filter(isRecommendationGradeFood);
  return _foodCatalog;
}

function attractionName(row, lang) {
  const names = row?.name || {};
  return names[lang] || names.en || names.ko || '';
}

function foodName(row, lang) {
  if (lang === 'ko') return row.name || row.nameEn || '';
  return row.nameEn || row.name || '';
}

function toAttractionCandidate(row, lang) {
  return {
    candidateId: row.key,
    placeKey: row.key,
    placeSource: ATTRACTION_SOURCE,
    name: attractionName(row, lang),
    lat: row.lat,
    lng: row.lng,
    theme: row.theme || 'sight',
    category: 'sight',
  };
}

function toFoodCandidate(row, lang) {
  const candidateId = `food:${row.placeId.trim()}`;
  return {
    candidateId,
    placeKey: candidateId,
    placeSource: FOOD_SOURCE,
    name: foodName(row, lang),
    lat: row.lat,
    lng: row.lng,
    theme: row.cuisine || 'restaurant',
    category: 'food',
    address: row.address || '',
    rating: Number(row.rating),
    reviewCount: Number(row.reviewCount),
  };
}

function allCandidates(lang) {
  if (_candidateCache.has(lang)) return _candidateCache.get(lang);
  const candidates = [
    ...loadAttractionCatalog().map((row) => toAttractionCandidate(row, lang)),
    ...loadFoodCatalog().map((row) => toFoodCandidate(row, lang)),
  ];
  _candidateCache.set(lang, candidates);
  return candidates;
}

export function getCourseCandidateCatalogStatus() {
  const attractions = loadAttractionCatalog().length;
  const food = loadFoodCatalog().length;
  return {
    healthy: _catalogErrors.size === 0 && attractions > 0 && food > 0,
    attractions,
    food,
    unavailable: [..._catalogErrors],
  };
}

/** 언어 무관 대소문자·공백 제거 비교용 정규화. */
function normalizeForDedupe(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

/** 위경도 절대차가 이 이하면 같은 장소로 본다(대략 100m 이내). */
const NEAR_IDENTICAL_DEG = 0.001;

function isNearIdenticalCoord(aLat, aLng, bLat, bLng) {
  return Math.abs(aLat - bLat) <= NEAR_IDENTICAL_DEG && Math.abs(aLng - bLng) <= NEAR_IDENTICAL_DEG;
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function buildExclusionIndex(selectedStops) {
  const excludedKeys = new Set();
  const excludedNames = new Set();
  const excludedCoords = [];
  for (const stop of selectedStops || []) {
    if (typeof stop?.placeKey === 'string' && stop.placeKey) {
      excludedKeys.add(`${String(stop.placeSource || '')}:${stop.placeKey}`);
      excludedKeys.add(`:${stop.placeKey}`);
    }
    if (typeof stop?.title === 'string' && stop.title) {
      excludedNames.add(normalizeForDedupe(stop.title));
    }
    if (Number.isFinite(stop?.lat) && Number.isFinite(stop?.lng)) {
      excludedCoords.push([stop.lat, stop.lng]);
    }
  }
  return { excludedKeys, excludedNames, excludedCoords };
}

function isExcluded(candidate, index) {
  if (index.excludedKeys.has(`${candidate.placeSource}:${candidate.placeKey}`)
    || index.excludedKeys.has(`:${candidate.placeKey}`)) return true;
  if (index.excludedNames.has(normalizeForDedupe(candidate.name))) return true;
  for (const [lat, lng] of index.excludedCoords) {
    if (isNearIdenticalCoord(candidate.lat, candidate.lng, lat, lng)) return true;
  }
  return false;
}

function rankCandidates(candidates, origins, maxDistanceKm) {
  return candidates
    .map((candidate) => ({
      candidate,
      distance: Math.min(...origins.map((origin) => (
        distanceKm(origin.lat, origin.lng, candidate.lat, candidate.lng)
      ))),
    }))
    .filter((entry) => entry.distance <= maxDistanceKm)
    .sort((a, b) => a.distance - b.distance);
}

function interleaveCandidates(foodEntries, attractionEntries, limit) {
  const out = [];
  const maxLength = Math.max(foodEntries.length, attractionEntries.length);
  for (let index = 0; index < maxLength && out.length < limit; index += 1) {
    if (foodEntries[index] && out.length < limit) out.push(foodEntries[index].candidate);
    if (attractionEntries[index] && out.length < limit) out.push(attractionEntries[index].candidate);
  }
  return out;
}

/**
 * 선택한 장소 중심에서 가까운 서버 후보를 뽑는다. 식당은 5km·관광지는 20km 안에서만
 * 고르고 두 종류를 번갈아 배치해 한쪽이 후보 목록을 독점하지 않게 한다.
 */
export function getCourseCandidates(opts = {}) {
  const lang = CANDIDATE_LANGS.includes(opts.lang) ? opts.lang : 'en';
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 12;
  const origins = (Array.isArray(opts.origins) ? opts.origins : [{ lat: opts.lat, lng: opts.lng }])
    .filter((origin) => Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng));
  if (origins.length === 0) return [];
  const exclusion = buildExclusionIndex(opts.excludeStops);
  const candidates = allCandidates(lang)
    .filter((candidate) => Number.isFinite(candidate.lat)
      && Number.isFinite(candidate.lng)
      && !!candidate.name
      && !isExcluded(candidate, exclusion));

  const food = rankCandidates(
    candidates.filter((candidate) => candidate.category === 'food'),
    origins,
    FOOD_MAX_DISTANCE_KM,
  );
  const attractions = rankCandidates(
    candidates.filter((candidate) => candidate.category === 'sight'),
    origins,
    ATTRACTION_MAX_DISTANCE_KM,
  );
  return interleaveCandidates(food, attractions, limit);
}

/**
 * 신뢰할 수 없는 candidateId 목록을 서버 카탈로그 값으로만 복원한다.
 * 미지 id·중복은 버리고, 이름·좌표·평점은 모델 값이 아니라 로컬 JSON 값만 쓴다.
 */
export function rehydrateCandidates(candidateIds, lang = 'en') {
  if (!Array.isArray(candidateIds)) return [];
  const wantedLang = CANDIDATE_LANGS.includes(lang) ? lang : 'en';
  if (!_candidateMapCache.has(wantedLang)) {
    _candidateMapCache.set(
      wantedLang,
      new Map(allCandidates(wantedLang).map((candidate) => [candidate.candidateId, candidate])),
    );
  }
  const byId = _candidateMapCache.get(wantedLang);
  const seen = new Set();
  const out = [];
  for (const rawId of candidateIds) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    const candidate = byId.get(id);
    if (!candidate) continue;
    seen.add(id);
    out.push(candidate);
  }
  return out;
}

/** 모델 생성 문구를 쓰지 않고 서버가 확인 가능한 카탈로그 사실만 설명한다. */
export function describeCatalogCandidate(candidate, lang = 'en') {
  const wantedLang = CANDIDATE_LANGS.includes(lang) ? lang : 'en';
  if (candidate?.category !== 'food') {
    const placeCopy = {
      ko: '코코트립 장소 자료에 등록된 곳',
      en: 'Listed in CocoTrip local place data',
      ja: 'CocoTripのローカル場所データに登録',
      zh: '已收录于CocoTrip本地地点数据',
    };
    return placeCopy[wantedLang];
  }
  const rating = Number(candidate.rating).toFixed(1);
  const reviews = Number(candidate.reviewCount).toLocaleString('en-US');
  const copy = {
    ko: `수집 시점 평점 ${rating} · 리뷰 ${reviews}개`,
    en: `At collection: ${rating} rating · ${reviews} reviews`,
    ja: `収集時点：評価 ${rating}・レビュー ${reviews}件`,
    zh: `采集时：评分 ${rating} · ${reviews}条评价`,
  };
  return copy[wantedLang];
}
