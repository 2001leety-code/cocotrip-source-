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
import { isDietaryTrusted } from './_shared/dietary-trust.js';

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
