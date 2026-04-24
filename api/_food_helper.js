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

// ── P10 (2026-04-24): User food-pref snippet for Gemini userMessage ────
// Allowlist-validates spice/bucket keys (prompt-injection guard) and returns
// a spreadable object. Empty fields are omitted so the Gemini message only
// includes keys the user actually set.
const _SPICE_OK = new Set(['none', 'mild', 'medium', 'hot']);
const _BUCKET_OK = new Set(['kbbq', 'kfc', 'tteokbokki', 'bibimbap', 'samgyetang', 'naengmyeon', 'jokbal', 'sundubu']);
export function buildFoodPrefSnippet(body) {
  const spiceLevel = _SPICE_OK.has(body && body.spiceLevel) ? body.spiceLevel : null;
  const bucket = Array.isArray(body && body.bucketDishes)
    ? body.bucketDishes.filter((k) => _BUCKET_OK.has(k))
    : [];
  const out = {};
  if (spiceLevel) out.spice_tolerance = spiceLevel;
  if (bucket.length > 0) out.bucket_list_dishes = bucket;
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
  gangneung: 'seoul', '강릉': 'seoul',
  yeosu: 'busan', '여수': 'busan',
  daegu: 'busan', '대구': 'busan',
};

// ── Diet preference → tag mapping ───────────────────────────────────────
// WizardForm FOOD_STYLE_KEYS: 'Vegan', 'Halal', 'Seafood', 'Meat', 'Spicy', 'Street'
function getTagsForDiet(dietPrefs) {
  if (!dietPrefs || dietPrefs.length === 0) return ['general'];

  const tags = new Set();
  for (const pref of dietPrefs) {
    switch (pref) {
      case 'Vegan':   tags.add('vegan'); break;
      case 'Halal':   tags.add('halal'); break;
      case 'Seafood':
      case 'Meat':
      case 'Spicy':
      case 'Street':
      default:        tags.add('general'); break;
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

  // If Vegan/Halal selected but few results, keep whatever we have
  if (tagFiltered.length < maxItems && tags.length === 1 && tags[0] !== 'general') {
    console.log(`[food-helper] Only ${tagFiltered.length} ${tags[0]} results for ${cityCode}, using all`);
  }

  // If too few, add general as fallback (only when original was specific tag)
  if (tagFiltered.length < maxItems && !tags.includes('general')) {
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
  const lines = final.map(r => {
    const priceInfo = r.priceRange ? ` ${r.priceRange}` : '';
    return `  • ${r.name.split('|')[0].trim()} (${r.nameEn}) ⭐${r.rating} (${r.reviewCount} reviews)${priceInfo}\n    📍 ${r.address}\n    🗺️ ${r.googleMapsUrl}`;
  });

  const header = `## Recommended ${dietLabel} Restaurants in ${cityCode.charAt(0).toUpperCase() + cityCode.slice(1)} (Rating ≥ 4.5)`;

  return `\n\n--- VERIFIED RESTAURANT DATABASE (MUST use restaurants from this list for meals) ---\n${header}\n${lines.join('\n\n')}\n\nIMPORTANT: Use the EXACT name and address from the above list. Set "verified": true on each food stop from this list.\n---`;
}
