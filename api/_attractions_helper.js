/**
 * Attractions Context Helper — CocoTrip (P190, 2026-05-25)
 *
 * Loads the pre-built attractions index (_attractions_index.json) and provides
 * verified attraction context to inject into the AI planner prompt.
 * Covers: museums (50) + temples (50) + night_spots (30) = 130 rows.
 *
 * Pattern mirrors api/_food_helper.js (lazy load + city mapping + export).
 *
 * Usage:
 *   import { getAttractionsContext, getMuseumsForFree,
 *            getTemplesForeignerPopular, getNightSpotsSafe }
 *     from '../_attractions_helper.js';
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lazy-load attractions index ─────────────────────────────────────────────
let _attractionsIndex = null;
function getAttractionsIndex() {
  if (!_attractionsIndex) {
    try {
      const raw = readFileSync(join(__dirname, '_attractions_index.json'), 'utf-8');
      _attractionsIndex = JSON.parse(raw);
      console.log(`[attractions-helper] Loaded ${_attractionsIndex.length} attractions from index`);
    } catch (err) {
      console.warn('[attractions-helper] Failed to load _attractions_index.json:', err.message);
      _attractionsIndex = [];
    }
  }
  return _attractionsIndex;
}

// ── City mapping (mirrors _food_helper.js pattern) ──────────────────────────
const CITY_MAP = {
  seoul: 'seoul', seoul_city: 'seoul', '서울': 'seoul',
  busan: 'busan', '부산': 'busan',
  jeju: 'jeju', '제주': 'jeju', 'jeju island': 'jeju',
  gyeongju: 'gyeongju', '경주': 'gyeongju',
  jeonju: 'jeonju', '전주': 'jeonju',
  gangneung: 'gangneung', '강릉': 'gangneung',
  incheon: 'seoul', '인천': 'seoul',  // grouped under seoul
  suwon: 'seoul', '수원': 'seoul',    // grouped under seoul
};

function normCity(dest) {
  if (!dest) return 'seoul';
  const d = dest.toLowerCase().trim();
  return CITY_MAP[d] ||
    (d.includes('seoul') ? 'seoul' :
     d.includes('busan') ? 'busan' :
     d.includes('jeju')  ? 'jeju'  :
     d.includes('gyeongju') ? 'gyeongju' :
     d.includes('jeonju')   ? 'jeonju'   :
     d.includes('gangneung') ? 'gangneung' : 'seoul');
}

// ── Style → _source mapping ──────────────────────────────────────────────────
// WizardForm styles: 'Temple', 'FreeMuseum', 'Night'
const STYLE_TO_SOURCE = {
  Temple:     ['temple'],
  FreeMuseum: ['museum'],
  Night:      ['night_spot'],
};

// ── Filter helpers ──────────────────────────────────────────────────────────

/**
 * Filter attractions by city code, relaxing to all-city if too few results.
 */
function filterByCity(index, cityCode, minItems = 3) {
  const results = index.filter(a => a.city === cityCode);
  if (results.length >= minItems) return results;
  // fallback: return all (city data may be sparse for smaller cities)
  return index;
}

/**
 * Get free museums for a city.
 * entry_fee_krw === 0 only.
 */
export function getMuseumsForFree({ city } = {}) {
  const index = getAttractionsIndex();
  const cityCode = normCity(city);
  const cityFiltered = filterByCity(
    index.filter(a => (a._source === 'museum' || a.theme === 'museum')),
    cityCode,
    2,
  );
  return cityFiltered.filter(a => Number(a.entry_fee_krw) === 0);
}

/**
 * Get temples that are foreigner-popular for a city.
 * tags must include 'foreigner_popular'.
 * Falls back to ALL temples with foreigner_popular if city has none.
 */
export function getTemplesForeignerPopular({ city } = {}) {
  const index = getAttractionsIndex();
  const cityCode = normCity(city);
  const temples = index.filter(a => (a._source === 'temple' || a.theme === 'temple'));
  // Try city-specific foreigner_popular first
  const cityFp = temples
    .filter(a => a.city === cityCode)
    .filter(a => Array.isArray(a.tags) && a.tags.includes('foreigner_popular'));
  if (cityFp.length > 0) return cityFp;
  // Global fallback: all foreigner_popular temples regardless of city
  return temples.filter(a => Array.isArray(a.tags) && a.tags.includes('foreigner_popular'));
}

/**
 * Get safe night spots for a city.
 * Returns all night_spot rows; subway_last field is included in results.
 */
export function getNightSpotsSafe({ city } = {}) {
  const index = getAttractionsIndex();
  const cityCode = normCity(city);
  const nightSpots = index.filter(a => (a._source === 'night_spot' || a.theme === 'nightlife' || a.theme === 'night_view' || a.theme === 'night_market' || a.theme === 'food_street'));
  const cityFiltered = filterByCity(nightSpots, cityCode, 2);
  // safety preference: 'high' first
  return cityFiltered.sort((a, b) => {
    if (a.safety === 'high' && b.safety !== 'high') return -1;
    if (b.safety === 'high' && a.safety !== 'high') return 1;
    return 0;
  });
}

/**
 * Get attractions context string for AI planner prompt injection.
 *
 * @param {object} opts
 * @param {string}   opts.city         - City/area key (e.g. 'seoul', 'busan')
 * @param {string[]} opts.styles       - Wizard styles (e.g. ['Temple', 'FreeMuseum', 'Night'])
 * @param {string}   opts.language     - 'ko' | 'en' | 'ja' | 'zh'
 * @param {number}   opts.maxLocations - Max items per style type (default 6)
 * @returns {string} Formatted context string for prompt injection, or '' if no match
 */
export function getAttractionsContext({ city, styles = [], language = 'en', maxLocations = 6 } = {}) {
  const index = getAttractionsIndex();
  if (!index.length) return '';

  const cityCode = normCity(city);
  const activeStyles = styles.filter(s => STYLE_TO_SOURCE[s]);
  if (activeStyles.length === 0) return '';

  const sections = [];

  for (const style of activeStyles) {
    const sources = STYLE_TO_SOURCE[style];

    let candidates;
    if (style === 'Temple') {
      candidates = getTemplesForeignerPopular({ city: cityCode });
      if (candidates.length === 0) {
        // No foreigner_popular temples in this city → fall back to all temples by city
        const allTemples = index.filter(a => (a._source === 'temple' || a.theme === 'temple'));
        const byCity = allTemples.filter(a => a.city === cityCode);
        candidates = byCity.length >= 2 ? byCity : allTemples.slice(0, maxLocations);
      }
    } else if (style === 'FreeMuseum') {
      candidates = getMuseumsForFree({ city: cityCode });
      if (candidates.length === 0) {
        // No free museums in this city → use any museum
        const allMuseums = index.filter(a => (a._source === 'museum' || a.theme === 'museum'));
        const byCity = allMuseums.filter(a => a.city === cityCode);
        candidates = byCity.length >= 2 ? byCity : allMuseums.slice(0, maxLocations);
      }
    } else if (style === 'Night') {
      candidates = getNightSpotsSafe({ city: cityCode });
    } else {
      const pool = index.filter(a => sources.includes(a._source || a.theme));
      candidates = filterByCity(pool, cityCode, 2);
    }

    const topItems = candidates.slice(0, maxLocations);
    if (topItems.length === 0) continue;

    const langKey = ['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en';
    const lines = topItems.map(a => {
      const displayName = (a.name && (a.name[langKey] || a.name.en || a.name.ko)) || a.key || '';
      const koName = (a.name && a.name.ko) || '';
      const hrs = a.hours ? ` | 운영: ${a.hours}` : '';
      const fee = a.entry_fee_krw != null ? ` | 입장료: ${a.entry_fee_krw === 0 ? '무료' : `₩${a.entry_fee_krw.toLocaleString()}`}` : '';
      const rating = a.rating ? ` | ⭐${a.rating}` : '';
      const tags = Array.isArray(a.tags) && a.tags.length > 0 ? ` | tags: ${a.tags.slice(0, 4).join(', ')}` : '';
      const subway = a.subway_last ? ` | 막차: ${a.subway_last}` : '';
      const safety = a.safety ? ` | safety: ${a.safety}` : '';
      return `  • ${displayName}${koName && koName !== displayName ? ` (${koName})` : ''}${hrs}${fee}${rating}${tags}${subway}${safety}`;
    });

    const styleLabel = style === 'Temple' ? 'Verified Temples (foreigner-popular)'
      : style === 'FreeMuseum' ? 'Verified Free Museums'
      : 'Verified Night Spots (safe)';

    const cityLabel = cityCode.charAt(0).toUpperCase() + cityCode.slice(1);
    sections.push(
      `## ${styleLabel} in ${cityLabel}\n${lines.join('\n')}`
    );
  }

  if (sections.length === 0) return '';

  return `\n\n--- VERIFIED ATTRACTIONS DATABASE (P190 — hallucination 차단) ---\n` +
    `Use EXACT names from the lists below. Set "verified": true on each matching stop.\n` +
    sections.join('\n\n') +
    `\n---`;
}
