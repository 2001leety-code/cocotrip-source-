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

// ── P189 (2026-05-25): allergen tag constants ────────────────────────────
// WizardForm allergy keys: 'Nuts', 'Shellfish', 'Gluten', 'Dairy'
// allergen: prefix 는 P189 식별용 — 'general' fallback 으로 흡수 금지.
// NOTE: 실제 필터링 효과는 _food_index.json 의 allergens 필드가 true 인 row 가
//       수집된 후 발휘됨. 현재는 모든 row 가 false default → 필터링 무력.
//       allergen 정보 실측 retrofit 은 별도 cycle (DB 수집 담당자 작업).
export const ALLERGEN_TAG_PREFIX = 'allergen:';
export const ALLERGEN_KEYS = ['Nuts', 'Shellfish', 'Gluten', 'Dairy'];

// ── Diet preference → tag mapping ───────────────────────────────────────
// WizardForm FOOD_STYLE_KEYS: 'Vegan', 'Halal', 'Seafood', 'Meat', 'Spicy', 'Street'
// WizardForm ALLERGY_KEYS (P189): 'Nuts', 'Shellfish', 'Gluten', 'Dairy'
export function getTagsForDiet(dietPrefs) {
  if (!dietPrefs || dietPrefs.length === 0) return ['general'];

  const tags = new Set();
  // P189 (2026-05-25): SAFETY-CRITICAL — 알레르기 4종은 'general' 폴백 금지.
  // allergen:<name> 태그로 분리하여 필터링 체인이 구분할 수 있게 함.
  const allergenPrefs = [];
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
      // P189: 알레르기 키 — 'general' 폴백 금지. allergen:<name> 별도 태그.
      case 'Nuts':     allergenPrefs.push('nuts');      tags.add(`${ALLERGEN_TAG_PREFIX}nuts`); break;
      case 'Shellfish': allergenPrefs.push('shellfish'); tags.add(`${ALLERGEN_TAG_PREFIX}shellfish`); break;
      case 'Gluten':   allergenPrefs.push('gluten');    tags.add(`${ALLERGEN_TAG_PREFIX}gluten`); break;
      case 'Dairy':    allergenPrefs.push('dairy');     tags.add(`${ALLERGEN_TAG_PREFIX}dairy`); break;
      case 'Seafood':
      case 'Meat':
      case 'Spicy':
      case 'Street':
      default:
        // B5 (P309): SAFETY tag 존재 시 general 추가 금지 (위 주석 참조).
        if (!hasSafetyTag) tags.add('general');
        break;
    }
  }
  // allergen 만 선택됐고 food style 미선택 → general 도 함께 포함 (식당 추천 가능해야 함)
  // allergen 필터는 식당 제외 용도, general 은 식당 포함 용도 — 구분 명확히.
  if (allergenPrefs.length > 0 && !tags.has('vegan') && !tags.has('halal') && !tags.has('general')) {
    tags.add('general');
  }
  return [...tags];
}

// ── P189: allergen filter — allergens 필드 활용 식당 제외 ─────────────────
// 사용자가 알레르기 키 선택 시 해당 allergen.xxx === true 인 식당 제외.
// 경고: allergens 필드가 모두 false (default) 인 현재 상태에서는 필터링 무력.
//       allergen 정보 실측 retrofit 완료 후 효과 발휘됨.
// backward-compat: allergens 필드 없는 legacy row → 포함 (안전 default = 모름 = 포함).
function filterByAllergens(candidates, dietPrefs) {
  if (!dietPrefs || dietPrefs.length === 0) return candidates;

  // P189: 선택된 알레르기 키 추출 (소문자)
  const allergenKeys = dietPrefs
    .filter(p => ALLERGEN_KEYS.includes(p))
    .map(p => p.toLowerCase()); // 'Nuts' → 'nuts'

  if (allergenKeys.length === 0) return candidates;

  return candidates.filter(r => {
    const allergens = r.allergens;
    // allergens 필드 없는 legacy row → 포함 (backward-compat)
    // NOTE: allergens 모두 false default 상태에서는 포함됨 — retrofit 후 효과 발휘.
    if (!allergens || typeof allergens !== 'object') return true;
    // allergens.nuts === true → 견과 메뉴 있음 → 견과 알레르기 손님 제외
    for (const key of allergenKeys) {
      if (allergens[key] === true) return false;
    }
    return true;
  });
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
function matchesCuisinePrefs(item, dietPrefs) {
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
        if (cuisine.includes('korean') || cuisine.includes('bbq') ||
            name.includes('고기') || name.includes('bbq') || name.includes('삼겹') ||
            name.includes('갈비') || name.includes('beef') || name.includes('pork') ||
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

  // If no specific cuisine match, still include general Korean food
  return cuisinePrefs.includes('Meat') && cuisine.includes('korean');
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
  const cityCode = CITY_MAP[dest] ||
    (dest.includes('seoul') ? 'seoul' :
     dest.includes('busan') ? 'busan' :
     dest.includes('jeju') ? 'jeju' : 'seoul'); // default to seoul

  let candidates = index.filter(r => r.city === cityCode);

  // If too few results, expand to all cities
  if (candidates.length < maxItems * 2) {
    candidates = [...index]; // use all
  }

  // ── Step 2: Tag filtering (vegan/halal/general) ───────────────────────
  let tagFiltered = candidates.filter(r => tags.includes(r.tag || 'general'));

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

  // ── Step 4b (P189 SAFETY-CRITICAL): allergen filter ──────────────────
  // allergens.xxx === true 인 식당 제외. allergens 필드 없는 legacy row 는 포함.
  // 현재 상태: 모든 row allergens = false (default) → 필터 무력이나 코드 준비됨.
  // 효과 발휘 시점: DB 수집 担당자가 각 식당 allergen 정보 실측 후 retrofit 완료 후.
  const hasAllergenPrefs = dietPrefs.some(p => ALLERGEN_KEYS.includes(p));
  if (hasAllergenPrefs) {
    const allergenFiltered = filterByAllergens(result, dietPrefs);
    // 필터 후 결과가 절반 이상이면 적용, 아니면 유지 (DB retrofit 전 과도한 제외 방지)
    if (allergenFiltered.length >= result.length / 2) {
      result = allergenFiltered;
    } else {
      console.warn(`[food-helper P189] allergen filter relaxed: only ${allergenFiltered.length}/${result.length} results after filter — using unfiltered (allergens DB retrofit 필요)`);
    }
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
  // P189 SAFETY: 알레르겐 키(Nuts/Shellfish/Gluten/Dairy)는 DB allergen 데이터가 미수집
  //   (전부 false=미확인)이라 filterByAllergens 가 무력하다. 헤더 라벨에 넣으면
  //   "Recommended Nuts Restaurants … VERIFIED" = 알레르겐 검증 추천으로 오표기되므로 제외.
  const allergenSelected = dietPrefs.filter(p => ALLERGEN_KEYS.includes(p));
  const labelPrefs = dietPrefs.filter(p => !ALLERGEN_KEYS.includes(p));
  const dietLabel = labelPrefs.length > 0 ? labelPrefs.join(' & ') : 'Korean';
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

  // P189 SAFETY-CRITICAL: "verified": true = 식당 실재(DB 등재) 확인일 뿐, 알레르겐 안전
  //   검증이 아니다. allergen DB 미수집(0% 실측) 상태라 이 명단은 알레르겐 스크리닝 안 됨.
  //   알레르겐 선택 시 "검증된 추천"으로 오인되지 않게 명시 면책 + 매 stop 현장확인 지시.
  const allergenNotice = allergenSelected.length > 0
    ? `\n\nALLERGEN SAFETY (${allergenSelected.join(', ')}): "verified": true confirms the restaurant EXISTS in our database — it does NOT confirm the restaurant is safe for these allergies. This list is NOT allergen-screened. NEVER state or imply any stop is allergy-safe; for EVERY food stop add a per-stop caution telling the guest to confirm ${allergenSelected.join('/')} ingredients with the restaurant before eating.`
    : '';

  return `\n\n--- VERIFIED RESTAURANT DATABASE (MUST use restaurants from this list for meals) ---\n${header}\n${lines.join('\n\n')}\n\nIMPORTANT: Use the EXACT name and address from the above list. Set "verified": true on each food stop from this list.${allergenNotice}\n---`;
}
