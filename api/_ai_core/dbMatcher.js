/**
 * Food DB matcher — applies verified restaurant data to Gemini output.
 * Extracted verbatim from api/ai-planner-full.js L953-1009.
 */

// ── 체인점 브랜드 추출 ──────────────────────────────────────────────────────
// "BHC 치킨 홍대점" → "BHC", "교촌치킨 강남점" → "교촌"
// 지점명(~점/~지점/~본점/~매장) 제거 + 위치/카테고리 키워드 제거
const BRANCH_SUFFIX = /\s*([\w가-힣]+[점관]|본점|지점|매장|직영점|가맹점)$/;
const LOCATION_WORDS = /\s+(홍대|강남|명동|이태원|신촌|건대|혜화|종로|을지로|서울|부산|제주|대구|인천|광주|대전|해운대|남포|서면|광안리|역삼|삼성|잠실|마포|용산|성수|합정|연남|망원|신림|노량진|여의도|동대문|서대문|영등포|관악|송파|중구|강서|양천|도봉|노원|강북|강동|광진|구로|금천|동작|서초)\s*$/;
const CATEGORY_WORDS = /\s*(치킨|피자|카페|커피|베이커리|빵집|버거|분식)\s*/g;

function extractBrand(name) {
  if (!name || name.length < 2) return null;
  let brand = name.trim();
  // 지점 접미사 제거 (반복 적용)
  for (let i = 0; i < 3; i++) {
    const prev = brand;
    brand = brand.replace(BRANCH_SUFFIX, '').trim();
    brand = brand.replace(LOCATION_WORDS, '').trim();
    if (brand === prev) break;
  }
  // 카테고리 단어 제거 (e.g., "BHC 치킨" → "BHC")
  brand = brand.replace(CATEGORY_WORDS, ' ').trim();
  return brand.length >= 2 ? brand : null;
}

// 두 브랜드가 동일한지 비교 (정확 매치 또는 한쪽이 다른 쪽을 포함)
function brandsMatch(a, b) {
  if (!a || !b) return false;
  const al = a.toLowerCase(), bl = b.toLowerCase();
  return al === bl || al.startsWith(bl) || bl.startsWith(al);
}

// Sanitize SEO 키워드 합친 name "한국어 | English | 中文 | 日本語" → 사용자 언어 토큰만.
// food_index의 raw name 또는 Gemini hallucination이 여러 언어 합친 string을 반환할 때 정리.
function pickLangToken(name, lang = 'ko') {
  if (!name || typeof name !== 'string') return name;
  const trimmed = name.trim();
  if (!trimmed.includes('|')) return trimmed;
  const tokens = trimmed.split('|').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return trimmed;

  const HANGUL = /[가-힣]/;
  const HIRAKATA = /[぀-ヿ]/;
  const HANZI = /[一-鿿]/;  // CJK unified — note: 한자 vs 중국어 구분 어려움
  const ASCII = /^[A-Za-z0-9\s.,'\-:&()/]+$/;

  // 사용자 언어에 맞는 첫 토큰 선택
  const pickers = {
    ko: (t) => HANGUL.test(t),
    en: (t) => ASCII.test(t),
    ja: (t) => HIRAKATA.test(t),
    zh: (t) => HANZI.test(t) && !HIRAKATA.test(t) && !HANGUL.test(t),
  };
  const picker = pickers[lang] || pickers.ko;
  const matched = tokens.find(picker);
  if (matched) return matched;

  // fallback: 첫 토큰
  return tokens[0];
}

// 다국어 split 패턴 정리 — name + display_name + tip + reason 모두 적용 가능
export function sanitizeStopNames(stop, lang = 'ko') {
  if (!stop || typeof stop !== 'object') return;
  const fields = ['name', 'display_name', 'name_ko', 'name_en', 'tip', 'tip_en', 'reason'];
  for (const f of fields) {
    if (typeof stop[f] === 'string' && stop[f].includes('|')) {
      const fixed = pickLangToken(stop[f], f === 'name' || f === 'name_ko' ? 'ko' : (f === 'name_en' || f === 'tip_en' ? 'en' : lang));
      if (fixed && fixed !== stop[f]) {
        stop[f] = fixed;
      }
    }
  }
}

export function applyDBMatcher(itinerary, foodIndex, city, lang = 'ko') {
  if (!foodIndex || foodIndex.length === 0) {
    // foodIndex 없어도 다국어 sanitize는 수행
    const allStops = (itinerary.days || []).flatMap(d => d.stops || []);
    for (const stop of allStops) sanitizeStopNames(stop, lang);
    return;
  }

  // Normalize city name for matching (e.g., "seoul_city" → "seoul")
  const matchCity = (city || '').replace(/_.*$/, '').toLowerCase();

  let dbMatched = 0, dbUnmatched = 0;
  const allStops = (itinerary.days || []).flatMap(d => d.stops || []);
  for (const stop of allStops) {
    // 모든 stop에 sanitize 적용 (food 카테고리 외에도 hallucination 가능)
    sanitizeStopNames(stop, lang);

    if (stop.category !== 'food') continue;

    const stopName = (stop.name || stop.name_ko || '').trim();
    if (!stopName) { dbUnmatched++; continue; }

    const stopDisplayName = (stop.display_name || stop.name_en || '').toLowerCase();

    // 1차: 정확 매칭 (name 또는 nameEn)
    let match = foodIndex.find(r => {
      const dbName = (r.name || '').split('|')[0].trim();
      const dbNameEn = (r.nameEn || '').toLowerCase();
      return dbName === stopName || (stopDisplayName && dbNameEn === stopDisplayName);
    });

    // 2차: 부분 매칭 (DB 이름이 stop 이름에 포함되거나 그 반대)
    if (!match) {
      match = foodIndex.find(r => {
        const dbName = (r.name || '').split('|')[0].trim();
        if (!dbName || dbName.length < 2) return false;
        return stopName.includes(dbName) || dbName.includes(stopName);
      });
    }

    // 3차: 체인점 브랜드 매칭 — "BHC 치킨 홍대점" → "BHC" 브랜드로 동일 도시 매칭
    if (!match) {
      const brand = extractBrand(stopName);
      if (brand && brand.length >= 2) {
        match = foodIndex.find(r => {
          const dbBrand = extractBrand((r.name || '').split('|')[0].trim());
          if (!dbBrand) return false;
          // 브랜드 매치 + 동일 도시 (과잉 매칭 방지)
          return brandsMatch(dbBrand, brand) && r.city === matchCity;
        });
        // 도시 정보 없을 때 브랜드만으로 매칭 (fallback)
        if (!match && !matchCity) {
          match = foodIndex.find(r => {
            const dbBrand = extractBrand((r.name || '').split('|')[0].trim());
            return dbBrand && brandsMatch(dbBrand, brand);
          });
        }
        if (match) {
          console.log(`[planner] Chain match: "${stopName}" → "${(match.name || '').split('|')[0]}" (brand: ${brand})`);
        }
      }
    }

    if (match) {
      // DB 데이터로 교정 — 주소/좌표/URL을 실제 검증된 데이터로 덮어씌움
      const dbName = (match.name || '').split('|')[0].trim();
      if (match.address) {
        // _food_index 주소 정리: "대한민국 " 접두사, "KR " 제거, 역순 주소 무시
        let cleanAddr = match.address
          .replace(/^대한민국\s+/, '')
          .replace(/\bKR\s+/g, '');
        // DB 주소가 한국 도시로 시작하면 덮어쓰기, 아니면 Gemini 주소 유지
        if (/^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/.test(cleanAddr)) {
          stop.address = cleanAddr;
        }
        // else: keep Gemini's address (usually cleaner)
      }
      if (match.lat) { stop.lat = match.lat; stop._dbLat = match.lat; }
      if (match.lng) { stop.lng = match.lng; stop._dbLng = match.lng; }
      if (match.googleMapsUrl) stop.googleMapsUrl = match.googleMapsUrl;
      stop.verified = true;
      stop._dbMatchedName = dbName;
      dbMatched++;
    } else {
      stop.verified = false;
      dbUnmatched++;
    }
  }
  console.log(`[planner] DB Match: ${dbMatched} matched, ${dbUnmatched} unmatched out of ${dbMatched + dbUnmatched} food stops`);
}
