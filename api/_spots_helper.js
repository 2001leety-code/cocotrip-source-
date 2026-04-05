/**
 * Korea Spots Context Helper
 * Loads pre-generated backfill data and injects relevant place context
 * into AI planner prompts to improve accuracy and reduce hallucination.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
 * Returns a compact context string of real places for the given destination.
 * @param {string} destination - e.g. "Seoul", "Busan", "Hongdae", "seoul_city"
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
  const cityCode = CITY_MAP[dest] ||
    (dest.includes('seoul') ? 'seoul' :
     dest.includes('busan') ? 'busan' :
     dest.includes('jeju') ? 'jeju' : null);

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
