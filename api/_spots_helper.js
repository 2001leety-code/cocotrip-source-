/**
 * Korea Spots Context Helper
 * Loads pre-generated backfill data and injects relevant place context
 * into AI planner prompts to improve accuracy and reduce hallucination.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { resolveUiCityKey } from './_shared/cityResolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _spots = null;
function getSpots() {
  if (!_spots) {
    try {
      const raw = readFileSync(join(__dirname, '_korea_spots.json'), 'utf-8');
      _spots = JSON.parse(raw);
    } catch {
      _spots = [];
    }
  }
  return _spots;
}

// Map common destination strings to city codes in the JSON
const CITY_MAP = {
  seoul: 'seoul',
  '부산': 'busan', busan: 'busan',
  '제주': 'jeju', jeju: 'jeju', 'jeju island': 'jeju',
  '경주': 'gyeongju', gyeongju: 'gyeongju',
  '전주': 'jeonju', jeonju: 'jeonju',
  '수원': 'gyeonggi', suwon: 'gyeonggi',
  '인천': 'gyeonggi', incheon: 'gyeonggi',
  '남이섬': 'gyeonggi', 'nami island': 'gyeonggi',
  '파주': 'gyeonggi', paju: 'gyeonggi',
  '가평': 'gyeonggi', gapyeong: 'gyeonggi',
  seoul_city: 'seoul',
};

/**
 * Resolves a free-text destination token to a known city code.
 *
 * 2026-08-24 (planner-trust-course): this used to be a fixed `seoul` →
 * `busan` → `jeju` priority chain against the *whole* destination string, so
 * a multi-city request like "Busan, Seoul" always matched `seoul` first
 * regardless of which city the traveller actually put first. Callers that
 * care about order (day-1 spot context is always the *first* requested city)
 * must pass one city token at a time — this only resolves that one token, no
 * cross-city priority left to collapse.
 * @param {string} cityToken - a single city name, e.g. "Busan", "부산".
 * @returns {string|null}
 */
export function resolveCityCode(cityToken) {
  const dest = (cityToken || '').toLowerCase().trim();
  if (!dest) return null;
  if (CITY_MAP[dest]) return CITY_MAP[dest];
  if (dest.includes('seoul')) return 'seoul';
  if (dest.includes('busan')) return 'busan';
  if (dest.includes('jeju')) return 'jeju';
  return null;
}

/**
 * Returns a compact context string of real places for the given destination.
 * @param {string} destination - e.g. "Seoul", "Busan", "Hongdae", "seoul_city".
 *   For a multi-city trip, pass the single city that should anchor the
 *   context (day 1 of a preview is always the first requested city) — this
 *   function does not itself pick a city out of a comma-joined list.
 * @param {number} maxLocations - how many neighborhoods to include (default 3)
 * @returns {string} Context block to inject into prompt
 */
export function getSpotContext(destination, maxLocations = 3) {
  const spots = getSpots();
  if (!spots.length) return '';

  const dest = (destination || '').toLowerCase().trim();

  // 1. Try exact dongEn match first
  const dongMatch = spots.find(
    s => s.dongEn.toLowerCase() === dest || s.dong.toLowerCase() === dest
  );

  // 2. City-level match
  const cityCode = resolveCityCode(dest);

  const cityMatches = cityCode
    ? spots.filter(s => s.city === cityCode)
    : spots.filter(s =>
        s.dongEn.toLowerCase().includes(dest) || dest.includes(s.dongEn.toLowerCase())
      );

  // Build list: exact dong first, then city matches, deduplicated
  const selected = [];
  if (dongMatch) selected.push(dongMatch);
  for (const s of cityMatches) {
    if (selected.length >= maxLocations) break;
    if (!selected.includes(s)) selected.push(s);
  }

  // Fallback: Seoul if nothing matched
  if (!selected.length) {
    const seoulSpots = spots.filter(s => s.city === 'seoul').slice(0, maxLocations);
    selected.push(...seoulSpots);
  }

  if (!selected.length) return '';

  // Format as compact context for the prompt
  const lines = selected.map(s => {
    const places = s.places.slice(0, 5).map(p =>
      `  • ${p.nameEn} [${p.category}] ${p.stayDuration}min — ${p.tip}`
    ).join('\n');
    return `## ${s.dongEn} (${s.district})\nThemes: ${s.themes.join(', ')}\n${places}`;
  });

  return `\n\n--- VERIFIED KOREA SPOTS DATA (use these real places) ---\n${lines.join('\n\n')}\n---`;
}

// ── Strict exact-city candidates (2026-08-24, planner-trust-course #8) ────
// getSpotContext() above relaxes to a Seoul fallback when nothing matched —
// unusable for the quick preview's zero-cross-city-substitution rule. This
// reader is the opposite: NO relaxation, and never matches on the bare
// `city` field — _korea_spots.json tags Suwon-Hwaseong, Incheon Songdo, Nami
// Island, DMZ/Paju, and Gapyeong all under city:"gyeonggi", so matching that
// field alone would blur five unrelated places together. Each group's
// `district` text (e.g. "Suwon-si", "Incheon") is the real signal, resolved
// through the SAME cityResolver SSOT every other exact-city path uses — so
// "gyeonggi" itself (not a UI city) and non-UI districts (Chuncheon-si/
// Paju-si/Gapyeong-gun/Daejeon) never resolve to anything.
function districtToUiCityKey(district) {
  const cleaned = String(district || '').trim().replace(/-(si|gun|gu)$/i, '');
  return resolveUiCityKey(cleaned);
}

/**
 * Exact-city Korea-spots place candidates — for thin cities where the
 * attraction/food indexes have too few rows (e.g. Suwon: 1 attraction row, 0
 * food rows). Normalized to a minimal, stable shape: only name/nameEn/
 * address/category and a deterministic server-owned key — the source JSON
 * also carries price/hours/tip fields, which are NOT surfaced here (not
 * refreshed for this free preview surface, same rule as attractions/food).
 * @param {string} cityKey one of api/_shared/cityResolver.js UI_CITY_KEYS
 * @returns {Array<{key:string, name:{ko:string,en:string}, address:string, category:string}>}
 */
export function getExactCitySpotCandidates(cityKey) {
  if (!cityKey) return [];
  const spots = getSpots();
  const out = [];
  for (const group of spots) {
    if (districtToUiCityKey(group.district) !== cityKey) continue;
    for (const p of group.places || []) {
      if (!p.nameEn && !p.name) continue;
      const slug = String(p.nameEn || p.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
      out.push({
        key: `spot_${cityKey}_${slug}`,
        name: { ko: p.name || '', en: p.nameEn || p.name || '' },
        address: p.address || '',
        category: p.category || '',
      });
    }
  }
  return out;
}

/**
 * Strict exact-city Korea-spots context string for prompt injection — same
 * "identity only, no price/hours/menu claims" rule as attractions/food.
 * @returns {{ contextString: string, candidates: ReturnType<typeof getExactCitySpotCandidates> }}
 */
export function getExactCitySpotsContext({ cityKey, maxItems = 6 } = {}) {
  const candidates = getExactCitySpotCandidates(cityKey).slice(0, maxItems);
  if (candidates.length === 0) return { contextString: '', candidates: [] };
  const cityLabel = String(cityKey).charAt(0).toUpperCase() + String(cityKey).slice(1);
  const lines = candidates.map((c) => `  • ${c.name.en}${c.name.ko && c.name.ko !== c.name.en ? ` (${c.name.ko})` : ''}`);
  const contextString = `\n\n--- VERIFIED ${cityLabel.toUpperCase()} PLACES (exact-city only — do not use for another city) ---\n` +
    `Use EXACT names from this list for named attractions/landmarks:\n${lines.join('\n')}\n---`;
  return { contextString, candidates };
}
