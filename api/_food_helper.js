/**
 * Food Context Helper — CocoTrip
 * 
 * Loads the pre-built food index (_food_index.json) and provides
 * relevant restaurant context to inject into the AI planner prompt.
 * 
 * Usage:
 *   import { getFoodContext } from './_food_helper.js';
 *   const ctx = getFoodContext('seoul', ['Halal', 'Meat'], 'Budget', 10);
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { isDietaryTrusted, dietaryEvidenceFor, describeDietaryEvidence } from './_shared/dietary-trust.js';
import { displayNamesFor } from './_shared/cityResolver.js';

// ── Row integrity predicate (2026-08-24, planner-trust-course #3) ──────────
// The `city` field on some real _food_index.json rows is simply wrong (e.g.
// "Everhalal - Halal Bulgogi near Everland" is tagged city:"busan" but its
// address is in Yongin, Gyeonggi; "Cheolgil Busan Jip Beomgye" is tagged
// city:"busan" but is actually in Anyang). Trusting `row.city === cityKey`
// alone lets these leak into an exact-city quick-preview context as if they
// were local. This predicate is the strict gate for BOTH the general and the
// trusted-dietary exact-city candidate paths — never relax it per-caller.
const EXCLUDE_BUSINESS_RE = /(마트|슈퍼|수입\s*식품|화장품|성원|모스크|mosque|supermarket|import\s*food|cosmetic)/i;
const KOREA_LAT_RANGE = [32.5, 39.5];
const KOREA_LNG_RANGE = [124, 132];

function hasStableIdentity(row) {
  return !!(row.placeId || row.googleMapsUrl || row.naverLink);
}

function isFiniteKoreaLatLng(row) {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= KOREA_LAT_RANGE[0] && lat <= KOREA_LAT_RANGE[1] && lng >= KOREA_LNG_RANGE[0] && lng <= KOREA_LNG_RANGE[1];
}

function isRealFoodBusiness(row) {
  const hay = `${row.cuisine || ''} ${row.cuisineKo || ''} ${row.name || ''} ${row.nameEn || ''}`;
  return !EXCLUDE_BUSINESS_RE.test(hay);
}

function addressMatchesCity(address, cityKey) {
  const addr = String(address || '').toLowerCase();
  const aliases = displayNamesFor(cityKey);
  return aliases.some((alias) => addr.includes(String(alias).toLowerCase()));
}

/**
 * Strict row-integrity gate for exact-city quick-preview food candidates —
 * nonempty name/address, finite Korea lat/lng, a stable place identity, an
 * address that actually names the requested city (not just a `city` field
 * that may be wrong), and a real restaurant/cafe/food business (excludes
 * supermarkets/marts, import-food retail, cosmetics shops, religious
 * facilities that only carry a "halal" cuisine label for their own kitchen).
 * @param {object} row
 * @param {string} cityKey
 * @returns {boolean}
 */
export function isValidExactCityFoodRow(row, cityKey) {
  if (!row || typeof row !== 'object') return false;
  if (!String(row.name || '').trim() || !String(row.address || '').trim()) return false;
  if (!isFiniteKoreaLatLng(row)) return false;
  if (!hasStableIdentity(row)) return false;
  if (!isRealFoodBusiness(row)) return false;
  if (!addressMatchesCity(row.address, cityKey)) return false;
  return true;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── P10/P7 (2026-04-24): User pref snippet for Gemini userMessage ──────
// Allowlist-validates spice/bucket/pace keys (prompt-injection guard) and
// returns a spreadable object. Empty fields are omitted so the Gemini
// message only includes keys the user actually set.
const _SPICE_OK = new Set(['none', 'mild', 'medium', 'hot']);
const _BUCKET_OK = new Set(['kbbq', 'kfc', 'tteokbokki', 'bibimbap', 'samgyetang', 'naengmyeon', 'jokbal', 'sundubu']);
const _PACE_OK = new Set(['half', 'short', 'full', 'action']);
const _PACE_HOURS = { half: 4, short: 6, full: 8, action: 10 };
export function buildFoodPrefSnippet(body) {
  const spiceLevel = _SPICE_OK.has(body && body.spiceLevel) ? body.spiceLevel : null;
  const bucket = Array.isArray(body && body.bucketDishes)
    ? body.bucketDishes.filter((k) => _BUCKET_OK.has(k))
    : [];
  const pace = _PACE_OK.has(body && body.tourPace) ? body.tourPace : null;
  const out = {};
  if (spiceLevel) out.spice_tolerance = spiceLevel;
  if (bucket.length > 0) out.bucket_list_dishes = bucket;
  if (pace) { out.tour_pace = pace; out.daily_tour_hours = _PACE_HOURS[pace]; }
  return out;
}

// ── Lazy-load food index ────────────────────────────────────────────────
let _foodIndex = null;
function getFoodIndex() {
  if (!_foodIndex) {
    try {
      const raw = readFileSync(join(__dirname, '_food_index.json'), 'utf-8');
      _foodIndex = JSON.parse(raw);
      console.log(`[food-helper] Loaded ${_foodIndex.length} restaurants from index`);
    } catch (err) {
      console.warn('[food-helper] Failed to load _food_index.json:', err.message);
      _foodIndex = [];
    }
  }
  return _foodIndex;
}

// ── City mapping (same as _spots_helper.js) ─────────────────────────────
const CITY_MAP = {
  seoul: 'seoul', seoul_city: 'seoul',
  busan: 'busan', '부산': 'busan',
  jeju: 'jeju', '제주': 'jeju', 'jeju island': 'jeju',
  gyeongju: 'gyeongju', '경주': 'gyeongju',
  jeonju: 'jeonju', '전주': 'jeonju',
  suwon: 'seoul', '수원': 'seoul',   // Suwon restaurants grouped under seoul
  incheon: 'seoul', '인천': 'seoul', // Incheon restaurants grouped under seoul
  gangneung: 'gangneung', '강릉': 'gangneung', // P188: DB 26 rows — 직접 매핑
  yeosu: 'yeosu', '여수': 'yeosu',             // P188: DB 25 rows — 직접 매핑
  daegu: 'daegu', '대구': 'daegu',             // P188: DB 43 rows — 직접 매핑
};

/**
 * 도시 표시명/키 → _food_index city 코드 (2026-07-11: getFoodContext 내부 로직 추출 —
 * 사전 커버리지 체크(handlerCore)와 동일 규칙 공유. 파생 금지·중복 금지 원칙).
 * ⚠️ 미등재 도시는 seoul 폴백 — 기존 프롬프트 주입과 동일 규칙 (감사 보고서에 잔여 리스크 명시).
 */
export function resolveCityCode(destination) {
  const dest = (destination || '').toLowerCase().trim();
  return CITY_MAP[dest] ||
    (dest.includes('seoul') ? 'seoul' :
     dest.includes('busan') ? 'busan' :
     dest.includes('jeju') ? 'jeju' : 'seoul');
}

// ── Diet preference → tag mapping ───────────────────────────────────────
// WizardForm FOOD_STYLE_KEYS: 'Vegan', 'Halal', 'Seafood', 'Meat', 'Spicy', 'Street'
// 2026-08-24 (planner trust): allergen 4종(Nuts/Shellfish/Gluten/Dairy) 고객 입력 제거.
// _food_index.json 의 allergens 필드가 전부 미수집(false)이라 필터링 효과가 없었고,
// 선택 UI 존재만으로 "알레르기 대응"이라는 오인을 줄 위험이 있었다 — 기존 저장된
// legacy allergies 배열에 이 값들이 남아 있어도 아래 switch 의 default 분기로 안전 무시됨.
export function getTagsForDiet(dietPrefs) {
  if (!dietPrefs || dietPrefs.length === 0) return ['general'];

  const tags = new Set();
  // B5 (P309, 2026-05-30): SAFETY tag (halal/vegan) 존재 여부 선판단.
  // 존재 시 cuisine 선호(Meat/Seafood 등)가 'general' 을 추가하지 못하게 막는다.
  // 이유: Halal+Meat 조합이 ['halal','general'] 이 되면 Step 2 tag filter 에서 일반식당
  // (돼지/소고기집)이 통과 → "Verified Halal" 오표기 (busan '돼지나무사랑걸렸네' 사례).
  // cuisine 선호는 getFoodContext Step 4 cuisine filter 가 halal/vegan 명단 *내부에서* 처리.
  const hasSafetyTag = dietPrefs.includes('Halal') || dietPrefs.includes('Vegan');
  for (const pref of dietPrefs) {
    switch (pref) {
      case 'Vegan':    tags.add('vegan'); break;
      case 'Halal':    tags.add('halal'); break;
      case 'Seafood':
      case 'Meat':
      case 'Spicy':
      case 'Street':
      default:
        // B5 (P309): SAFETY tag 존재 시 general 추가 금지 (위 주석 참조).
        // legacy allergies 값(Nuts/Shellfish/Gluten/Dairy 등)도 여기로 떨어져 무해 처리됨.
        if (!hasSafetyTag) tags.add('general');
        break;
    }
  }
  return [...tags];
}

// ── Price level mapping ─────────────────────────────────────────────────
// WizardForm PRICE_KEYS: 'Budget', 'Moderate', 'Premium', 'Any'
function matchesPriceRange(item, priceRange) {
  if (!priceRange || priceRange === 'Any') return true;
  const level = item.priceLevel;
  if (level == null) return true; // Unknown price → include as fallback
  switch (priceRange) {
    case 'Budget':   return level <= 1;
    case 'Moderate': return level <= 2;
    case 'Premium':  return level >= 3;
    default:         return true;
  }
}

// ── Cuisine keyword matching for Seafood/Meat/Spicy/Street ──────────────
export function matchesCuisinePrefs(item, dietPrefs) {
  if (!dietPrefs || dietPrefs.length === 0) return true;

  // If only Vegan or Halal selected, tag-based filtering handles it
  const cuisinePrefs = dietPrefs.filter(p => !['Vegan', 'Halal'].includes(p));
  if (cuisinePrefs.length === 0) return true;

  const name = (item.name || '').toLowerCase();
  const cuisine = (item.cuisine || '').toLowerCase();
  const cuisineKo = (item.cuisineKo || '').toLowerCase();

  for (const pref of cuisinePrefs) {
    switch (pref) {
      case 'Seafood':
        if (cuisine.includes('seafood') || cuisineKo.includes('해산물') ||
            name.includes('회') || name.includes('생선') || name.includes('seafood') ||
            name.includes('조개') || name.includes('새우') || name.includes('게') ||
            name.includes('fish') || name.includes('sushi') || name.includes('초밥')) {
          return true;
        }
        break;
      case 'Meat':
        // 2026-08-24 (planner-trust-course, hardening #5): a generic
        // `cuisine.includes('korean')` used to match ANY Korean-cuisine row
        // (a coffee shop tagged cuisine:"Korean" would pass) — narrowed to
        // explicit BBQ/meat tokens only (ko + en, beef/pork/chicken).
        if (cuisine.includes('bbq') || cuisine.includes('meat') ||
            name.includes('고기') || name.includes('bbq') || name.includes('삼겹') ||
            name.includes('갈비') || name.includes('beef') || name.includes('pork') ||
            name.includes('chicken') || name.includes('닭') ||
            name.includes('한우') || name.includes('구이') || name.includes('숙성')) {
          return true;
        }
        break;
      case 'Spicy':
        if (name.includes('매운') || name.includes('불닭') || name.includes('떡볶이') ||
            name.includes('닭발') || name.includes('짬뽕') || name.includes('마라') ||
            name.includes('spicy') || name.includes('hot')) {
          return true;
        }
        break;
      case 'Street':
        if (name.includes('시장') || name.includes('market') || name.includes('포장마차') ||
            name.includes('분식') || name.includes('떡볶이') || name.includes('길거리') ||
            name.includes('street')) {
          return true;
        }
        break;
    }
  }

  // 2026-08-24 (planner-trust-course, hardening #5): no generic-Korean
  // fallback — a row must match one of the explicit style keyword checks
  // above (Seafood/Meat/Spicy/Street) or it does not match this style at all.
  return false;
}

/**
 * Get food context string for AI planner prompt injection.
 * 
 * @param {string} destination - City/area key (e.g. 'seoul', 'busan', 'Seoul')
 * @param {string[]} dietPrefs - ['Vegan', 'Halal', 'Meat', etc.]
 * @param {string} priceRange - 'Budget' | 'Moderate' | 'Premium' | 'Any'
 * @param {number} maxItems - Max restaurants to return (default 10)
 * @returns {string} Formatted context string for prompt injection
 */
export function getFoodContext(destination, dietPrefs = [], priceRange = 'Any', maxItems = 10) {
  const index = getFoodIndex();
  if (!index.length) return '';

  const dest = (destination || '').toLowerCase().trim();
  const tags = getTagsForDiet(dietPrefs);

  // ── Step 1: City filtering ────────────────────────────────────────────
  const cityCode = resolveCityCode(dest);

  let candidates = index.filter(r => r.city === cityCode);

  // If too few results, expand to all cities
  if (candidates.length < maxItems * 2) {
    candidates = [...index]; // use all
  }

  // ── Step 2: Tag filtering (vegan/halal/general) ───────────────────────
  // 2026-07-11 SAFETY (3단계-B): dietary 태그는 신뢰 등급 통과분만 —
  // unverified(naver 키워드·AI-curated) 태그를 "Recommended Halal ..." 헤더 아래
  // 주입하면 생선회집 vegan·치킨집 halal 이 인증 도장 달고 프롬프트에 들어간다.
  let tagFiltered = candidates.filter(r => tags.includes(r.tag || 'general') && isDietaryTrusted(r));

  // B5 (P309, 2026-05-30): SAFETY tag (halal/vegan) 존재 여부 — general 폴백 게이트.
  const hasSafetyTag = dietPrefs.includes('Halal') || dietPrefs.includes('Vegan');

  // If Vegan/Halal selected but few results, keep whatever we have
  if (tagFiltered.length < maxItems && tags.length === 1 && tags[0] !== 'general') {
    console.log(`[food-helper] Only ${tagFiltered.length} ${tags[0]} results for ${cityCode}, using all`);
  }

  // If too few, add general as fallback (only when original was specific tag)
  // B5 (P309) SAFETY-CRITICAL: halal/vegan 요청 시 general 폴백 절대 금지.
  // 할랄/비건 부족을 일반식당(돼지/소고기집)으로 채우면 헤더 "Recommended Halal
  // Restaurants" + verified:true 도장이 일반식당에 찍힘 → 무슬림/비건 건강·종교 위험.
  // 차라리 빈 명단 (출력 안 함, Step 끝 `if(!final.length) return ''`) > 위험한 오표기.
  // recommendedRestaurants.js pickBucket 의 "no general fallback inside dietary bucket"
  // SSOT 패턴과 정합 (SAFETY tag 는 절대 섞지 않음).
  if (tagFiltered.length < maxItems && !tags.includes('general') && !hasSafetyTag) {
    const generalFallback = candidates
      .filter(r => (r.tag || 'general') === 'general')
      .slice(0, maxItems);
    tagFiltered = [...tagFiltered, ...generalFallback];
  }

  // ── Step 3: Price filtering ───────────────────────────────────────────
  let priceFiltered = tagFiltered.filter(r => matchesPriceRange(r, priceRange));
  if (priceFiltered.length < maxItems) {
    priceFiltered = tagFiltered; // relax price filter
  }

  // ── Step 4: Cuisine keyword filter (for Seafood/Meat/Spicy/Street) ────
  const hasCuisinePrefs = dietPrefs.some(p => ['Seafood', 'Meat', 'Spicy', 'Street'].includes(p));
  let result = priceFiltered;
  if (hasCuisinePrefs) {
    const cuisineFiltered = priceFiltered.filter(r => matchesCuisinePrefs(r, dietPrefs));
    if (cuisineFiltered.length >= maxItems / 2) {
      result = cuisineFiltered;
    }
    // else: keep priceFiltered (relaxed)
  }

  // ── Step 5: Diversify by dong (neighborhood) — max 3 per dong ─────────
  const dongBuckets = {};
  const diversified = [];
  for (const r of result) {
    const dong = r.dong || r.dongEn || 'unknown';
    dongBuckets[dong] = (dongBuckets[dong] || 0) + 1;
    if (dongBuckets[dong] <= 3) {
      diversified.push(r);
    }
    if (diversified.length >= maxItems * 2) break;
  }

  // ── Step 6: Shuffle partially to add variation ────────────────────────
  // Keep top 5 fixed (best picks), shuffle the rest
  const top = diversified.slice(0, 5);
  const rest = diversified.slice(5);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const final = [...top, ...rest].slice(0, maxItems);

  if (!final.length) return '';

  // ── Format output ─────────────────────────────────────────────────────
  const dietLabel = dietPrefs.length > 0 ? dietPrefs.join(' & ') : 'Korean';
  // Phase 6: Busan DB uses 4.6 threshold; others use 4.5
  const ratingThresholdLabel = cityCode === 'busan' ? '4.6' : '4.5';
  const lines = final.map(r => {
    const priceInfo = r.priceRange ? ` ${r.priceRange}` : '';
    const priceLevel = r.priceLevel != null ? ` 💴${r.priceLevel}` : '';
    const englishMenu = r.hasEnglishMenu === true ? ' 🌐EN' : '';
    const wheelchair = r.wheelchairAccessible === true ? ' ♿' : '';
    // P325: per-line dietary marker — Gemini 가 어느 식당이 halal/vegan 인지 알고
    // stop.dietary_tags 에 박을 수 있게 (DB halal 식당의 ~80%는 이름에 halal 토큰 없음).
    const _t = String(r.tag || '').toLowerCase();
    const dietMarker = _t === 'halal' ? ' [HALAL]' : _t === 'vegan' ? ' [VEGAN]' : _t === 'vegetarian' ? ' [VEGETARIAN]' : '';
    return (
      `  • ${r.name.split('|')[0].trim()} (${r.nameEn || ''})${dietMarker} ` +
      `⭐${r.rating} (${r.reviewCount} reviews)${priceInfo}${priceLevel}${englishMenu}${wheelchair}\n` +
      `    📍 ${r.address}\n` +
      `    🗺️ ${r.googleMapsUrl || ''}`
    );
  });

  const cityLabel = cityCode.charAt(0).toUpperCase() + cityCode.slice(1);
  const header = `## Recommended ${dietLabel} Restaurants in ${cityLabel} (Rating ≥ ${ratingThresholdLabel})`;

  // "verified": true = 식당 실재(DB 등재) 확인일 뿐 dietary 안전 인증이 아니다
  //   (dietary-trust.js SSOT 가 halal/vegan 인증 등급을 별도 관리).
  return `\n\n--- VERIFIED RESTAURANT DATABASE (MUST use restaurants from this list for meals) ---\n${header}\n${lines.join('\n\n')}\n\nIMPORTANT: Use the EXACT name and address from the above list. Set "verified": true on each food stop from this list.\n---`;
}

// ── Strict exact-city trusted dietary candidates (2026-08-24, planner-trust-course) ──
// getFoodContext() above intentionally relaxes city coverage ("too few results ->
// use all cities") and can add a general fallback when a specific tag comes up
// short. For halal/vegan/vegetarian requests specifically it already refuses the
// general fallback (SAFETY, B5/P309) — but it will still relax the *city* filter,
// which means a Gangneung halal request could get Seoul halal restaurants
// presented as if they were local. The free quick preview needs zero relaxation:
// exact city, trusted evidence tier only, or an explicit "unavailable" signal —
// never another city's restaurants standing in.

/**
 * Exact-city, trusted-evidence-only dietary candidates. No city relaxation, no
 * cross-city substitution. `dietaryEvidenceFor` already excludes `unverified`
 * (naver_local/ai_curated) — this only adds the exact-city constraint.
 *
 * Multi-select (e.g. Halal+Vegan) requires EVERY requested diet to be
 * satisfied by the SAME row (AND, not OR) — a halal-only restaurant must
 * never stand in for a Halal+Vegan request just because it matched one of
 * the two. `evidence` carries one entry per requested diet so every tier is
 * shown honestly (a row can be halal_certified for one diet and
 * vegan_options for another — never collapse to a single tier).
 * 2026-08-24 (planner-trust-course, hardening #5): `stylePrefs` (Seafood/
 * Meat/Street) is ANDed onto the SAME row as the dietary evidence — a
 * Halal+Seafood request must never fall back to a halal-only restaurant with
 * no seafood evidence just because it was the top-rated halal row. Empty/
 * omitted `stylePrefs` skips this filter entirely (dietary-only request).
 * @param {string} cityKey UI city key
 * @param {string[]} dietaryList e.g. ['Halal'] | ['Halal', 'Vegan']
 * @param {number} [maxItems]
 * @param {string[]} [stylePrefs] e.g. ['Seafood'] — non-cuisine keys ignored
 * @returns {Array<{row: object, evidence: Array<{diet: string, tag: string, verification_status: string}>}>}
 */
export function getExactCityTrustedDietaryCandidates(cityKey, dietaryList, maxItems = 10, stylePrefs = []) {
  const diets = (dietaryList || []).map((d) => String(d).toLowerCase()).filter((d) => ['halal', 'vegan', 'vegetarian'].includes(d));
  if (!cityKey || diets.length === 0) return [];
  const styles = (stylePrefs || []).filter(isCuisineStyleKey);
  const index = getFoodIndex();
  const rows = index.filter((r) => r.city === cityKey && isValidExactCityFoodRow(r, cityKey));
  const out = [];
  for (const row of rows) {
    if (styles.length > 0 && !matchesCuisinePrefs(row, styles)) continue; // same-row style intersection
    const evidence = [];
    for (const diet of diets) {
      const ev = dietaryEvidenceFor(row, diet);
      if (!ev) break; // AND: any unmatched requested diet disqualifies this row
      evidence.push(ev);
    }
    if (evidence.length === diets.length) out.push({ row, evidence });
    if (out.length >= maxItems) break;
  }
  return out;
}

// ── Strict exact-city GENERAL food candidates (2026-08-24, planner-trust-course A) ──
// getFoodContext() above relaxes city ("too few -> use all cities") and injects
// price/rating/menu-adjacent details. For a non-dietary "Food"/"K-BBQ" interest
// in the free quick preview, the same exact-city-only, no-fabrication rule as
// attractions applies: identity (name+address) only, no price/hours/Michelin/
// menu claims (those change and this endpoint has no freshness guarantee).

// 2026-08-24 (planner-trust-course #4, food-style support): WizardStep1Food's
// non-dietary style keys are Seafood/Meat/Street (Spicy also exists in the
// shared matchesCuisinePrefs matcher above but isn't a wizard-exposed style
// for this endpoint's scope). Halal/Vegan/Vegetarian never reach this
// function — those go through the trusted-dietary path exclusively and are
// filtered out here so a style-only request never re-triggers dietary logic.
const CUISINE_STYLE_KEYS = ['Seafood', 'Meat', 'Street'];
export function isCuisineStyleKey(key) {
  return CUISINE_STYLE_KEYS.includes(String(key || ''));
}

/**
 * Exact-city general food candidates — no dietary filter, no city relaxation.
 * When `stylePrefs` (Seafood/Meat/Street) is non-empty, rows are filtered
 * deterministically by the existing cuisine/name/tag matcher — a style
 * request that has zero matching exact-city rows returns an EMPTY array
 * (never silently falls back to the unfiltered set), so the caller can fail
 * closed with PREFERENCE_DATA_UNAVAILABLE rather than claim the style was
 * reflected when it wasn't.
 * @param {string} cityKey one of api/_shared/cityResolver.js UI_CITY_KEYS
 * @param {number} [maxItems]
 * @param {string[]} [stylePrefs] e.g. ['Seafood'] — non-cuisine keys ignored
 * @returns {Array<object>} raw index rows for that city only (may be empty)
 */
export function getExactCityGeneralFoodCandidates(cityKey, maxItems = 8, stylePrefs = []) {
  if (!cityKey) return [];
  const styles = (stylePrefs || []).filter(isCuisineStyleKey);
  const index = getFoodIndex();
  let rows = index.filter((r) => r.city === cityKey && isValidExactCityFoodRow(r, cityKey));
  if (styles.length > 0) rows = rows.filter((r) => matchesCuisinePrefs(r, styles));
  return rows
    .slice()
    .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || String(a.nameEn || a.name || '').localeCompare(String(b.nameEn || b.name || '')))
    .slice(0, maxItems);
}

/**
 * Strict exact-city general food context string for prompt injection —
 * identity/address only, never price/hours/Michelin/menu claims. Each line
 * carries a deterministic style tag (SEAFOOD/MEAT/STREET) when the row
 * matched one of the requested styles, so the model can see which stop
 * satisfies which requested style without guessing.
 * @returns {{ contextString: string, candidates: Array<object> }}
 */
export function getExactCityGeneralFoodContext({ cityKey, maxItems = 8, stylePrefs = [] } = {}) {
  const candidates = getExactCityGeneralFoodCandidates(cityKey, maxItems, stylePrefs);
  if (candidates.length === 0) return { contextString: '', candidates: [] };
  const styles = (stylePrefs || []).filter(isCuisineStyleKey);
  const cityLabel = String(cityKey).charAt(0).toUpperCase() + String(cityKey).slice(1);
  const lines = candidates.map((r) => {
    const matchedStyles = styles.filter((s) => matchesCuisinePrefs(r, [s]));
    const styleTag = matchedStyles.length > 0 ? ` [${matchedStyles.map((s) => s.toUpperCase()).join('/')}]` : '';
    return `  • ${(r.name || '').split('|')[0].trim()} (${r.nameEn || ''})${styleTag}\n    📍 ${r.address}`;
  });
  const contextString = `\n\n--- VERIFIED ${cityLabel.toUpperCase()} RESTAURANTS (exact-city only — identity/address only, no price/hours/menu claims) ---\n` +
    `Use ONLY restaurants from this list for meal stops. Do not invent others, do not claim exact prices, hours, Michelin status, or specific menu items.\n${lines.join('\n')}\n---`;
  return { contextString, candidates };
}

/**
 * Strict exact-city trusted dietary context for prompt injection. Every line
 * carries its honest evidence tier (certified vs. friendly-not-certified) —
 * never relabeled as one thing when it's the other (CLAUDE.md dietary-safety).
 * @returns {{ contextString: string, candidates: ReturnType<typeof getExactCityTrustedDietaryCandidates> }}
 */
export function getExactCityTrustedFoodContext({ cityKey, dietaryList, language = 'en', maxItems = 10, stylePrefs = [] } = {}) {
  const candidates = getExactCityTrustedDietaryCandidates(cityKey, dietaryList, maxItems, stylePrefs);
  if (candidates.length === 0) return { contextString: '', candidates: [] };

  const cityLabel = String(cityKey).charAt(0).toUpperCase() + String(cityKey).slice(1);
  const lines = candidates.map(({ row: r, evidence }) => {
    // evidence = one entry per requested diet on this row — show every tier
    // honestly instead of collapsing to one (a row can be certified for one
    // diet and friendly-only for another).
    const tierLines = evidence.map((ev) => {
      const note = describeDietaryEvidence(ev.verification_status, language);
      const tierLabel = ev.verification_status === 'halal_certified' || ev.verification_status === 'vegan_restaurant'
        ? 'CERTIFIED' : 'FRIENDLY (not certified)';
      return `[${ev.diet.toUpperCase()} — ${tierLabel}] ⚠️ ${note}`;
    });
    return (
      `  • ${(r.name || '').split('|')[0].trim()} (${r.nameEn || ''})\n` +
      `    📍 ${r.address}\n` +
      tierLines.map((l) => `    ${l}`).join('\n')
    );
  });
  const contextString = `\n\n--- VERIFIED ${cityLabel.toUpperCase()} DIETARY-SAFE RESTAURANTS (exact-city, trusted evidence only) ---\n` +
    `Use ONLY restaurants from this list for meal recommendations. Do not invent others.\n` +
    `Each entry's tier is honest: CERTIFIED = manually verified; FRIENDLY = listed as offering ` +
    `this diet but certification is NOT confirmed — say so, do not call it "certified".\n` +
    `${lines.join('\n\n')}\n---`;
  return { contextString, candidates };
}
