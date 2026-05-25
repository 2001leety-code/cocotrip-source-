/**
 * Food DB matcher — applies verified restaurant data to Gemini output.
 * Extracted verbatim from api/ai-planner-full.js L953-1009.
 *
 * PR #466 (Audit X-H8 — 2026-05-16): city-mismatch guard.
 * Pre-fix: the 1차 (exact) and 2차 (partial) matchers ignored city
 * entirely. Common chain names like "본가", "원조김밥" exist in many
 * cities — a Seoul plan stop named "본가" would silently get the
 * Busan-branch address/coordinates from foodIndex, and the user would
 * travel to the wrong city for that meal. The 3차 chain matcher already
 * required city, but the first two tiers didn't. Now all three tiers
 * prefer same-city matches; if no same-city match exists, an other-city
 * match is allowed but the stop's address is NOT overwritten (preserving
 * Gemini's intent) and the mismatch is flagged. A per-call summary +
 * throttled admin alert fires when mismatch ratio crosses a threshold.
 */
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

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

// PR #466 (X-H8): per-call summary threshold for city-mismatch alert.
// Below 3 food stops we don't alert (1-mismatch dominates ratio in tiny
// plans). Above 3, fire when > 20% of matches landed on a different city.
// P180 (2026-05-24): 30% → 20% — 측정 시 1/3 (33%) alert 발동했지만 일반
// user 1/5 (20%) 도 hallucination 위험 동등. 돈 받는 plan 의 신뢰 손상
// 차단 위해 조기 발견. 5 stop plan 에서 1+ mismatch 시 alert.
const CITY_MISMATCH_RATIO_THRESHOLD = 0.2;
const CITY_MISMATCH_MIN_MATCHES = 3;

/**
 * Try the three-tier match with a city filter applied. Returns the
 * first match or null. Extracted so we can call it twice: once with
 * the requested city (preferred), once without (fallback that we then
 * flag as a city-mismatch).
 */
function findFoodIndexMatch(foodIndex, stopName, stopDisplayName, cityFilter) {
  const cityOk = (r) => !cityFilter || (r.city || '').toLowerCase() === cityFilter;

  // 1차: 정확 매칭 (name 또는 nameEn)
  let match = foodIndex.find(r => {
    const dbName = (r.name || '').split('|')[0].trim();
    const dbNameEn = (r.nameEn || '').toLowerCase();
    return cityOk(r) && (dbName === stopName || (stopDisplayName && dbNameEn === stopDisplayName));
  });

  // 2차: 부분 매칭 (DB 이름이 stop 이름에 포함되거나 그 반대)
  if (!match) {
    match = foodIndex.find(r => {
      if (!cityOk(r)) return false;
      const dbName = (r.name || '').split('|')[0].trim();
      if (!dbName || dbName.length < 2) return false;
      return stopName.includes(dbName) || dbName.includes(stopName);
    });
  }

  // 3차: 체인점 브랜드 매칭 — "BHC 치킨 홍대점" → "BHC" 브랜드로 매칭
  if (!match) {
    const brand = extractBrand(stopName);
    if (brand && brand.length >= 2) {
      match = foodIndex.find(r => {
        if (!cityOk(r)) return false;
        const dbBrand = extractBrand((r.name || '').split('|')[0].trim());
        return dbBrand && brandsMatch(dbBrand, brand);
      });
    }
  }
  return match;
}

// P189 (2026-05-25) SAFETY-CRITICAL: allergen 위반 검사 헬퍼
// match.allergens.xxx === true → 해당 알레르기 손님에게 해당 식당 추천 = 건강 위험.
// 현재 모든 row allergens = false (default) → 위반 0건 (DB retrofit 전 safe).
// 효과 발휘: DB 수집 담당자가 allergen 정보 실측 후 true 값으로 retrofit 완료 후.
function detectAllergenViolation(match, allergyPrefs) {
  if (!allergyPrefs || allergyPrefs.length === 0) return null;
  if (!match || !match.allergens || typeof match.allergens !== 'object') return null;
  const violated = [];
  for (const pref of allergyPrefs) {
    const key = pref.toLowerCase(); // 'Nuts' → 'nuts'
    if (match.allergens[key] === true) {
      violated.push(pref);
    }
  }
  return violated.length > 0 ? violated : null;
}

export function applyDBMatcher(itinerary, foodIndex, city, lang = 'ko', allergyPrefs = []) {
  if (!foodIndex || foodIndex.length === 0) {
    // foodIndex 없어도 다국어 sanitize는 수행
    const allStops = (itinerary.days || []).flatMap(d => d.stops || []);
    for (const stop of allStops) sanitizeStopNames(stop, lang);
    return;
  }

  // Normalize city name for matching (e.g., "seoul_city" → "seoul")
  const tripMatchCity = (city || '').replace(/_.*$/, '').toLowerCase();

  // P114 (2026-05-20): per-day matchCity — multi-city plan 의 Busan day 식당이
  // Seoul foodIndex 와 매칭되던 회귀 차단 (plan 4792076e: Jagalchi/Isaac Toast
  // 부산 식당이 Seoul 주소로 override 됨).
  //
  // day.city 가 있으면 그걸 사용 (정규화 후), 없으면 trip-level area 폴백.
  // single-city plan 은 day.city 가 trip area 와 같거나 undefined → 동일 동작.
  function dayMatchCity(day) {
    const dayCity = (day?.city || '').replace(/_.*$/, '').toLowerCase().trim();
    return dayCity || tripMatchCity;
  }

  let dbMatched = 0, dbUnmatched = 0;
  // PR #466 (X-H8): track city-mismatch occurrences across this call.
  let cityMismatchCount = 0;
  const cityMismatchSamples = [];
  // P114: 평탄화 대신 day 단위 iterate — 각 stop 에 정확한 day.city 적용.
  for (const day of (itinerary.days || [])) {
    const matchCity = dayMatchCity(day);
    for (const stop of (day.stops || [])) {
    // 모든 stop에 sanitize 적용 (food 카테고리 외에도 hallucination 가능)
    sanitizeStopNames(stop, lang);

    if (stop.category !== 'food') continue;

    const stopName = (stop.name || stop.name_ko || '').trim();
    if (!stopName) { dbUnmatched++; continue; }

    const stopDisplayName = (stop.display_name || stop.name_en || '').toLowerCase();

    // PR #466 (X-H8): prefer same-city match first. Only fall back to
    // other-city when no same-city match exists, and flag the result.
    // P114: matchCity 가 trip-level 이 아닌 day-level — Busan day 식당이
    // Seoul foodIndex 와 silent override 되던 회귀 차단.
    let match = findFoodIndexMatch(foodIndex, stopName, stopDisplayName, matchCity);
    let isCityMismatch = false;

    if (!match) {
      const fallback = findFoodIndexMatch(foodIndex, stopName, stopDisplayName, null);
      if (fallback && matchCity && (fallback.city || '').toLowerCase() !== matchCity) {
        // P114 후속 (2026-05-22): landmark/market name 인 경우 cross-city fallback
        // SKIP. plan 9845a69e Day 4 "자갈치" (Busan landmark) 가 Seoul 종로 "자갈치"
        // 식당과 매칭되던 33% city-mismatch noise. Landmark = 시장 / 거리 / 광장 /
        // 역 suffix 또는 정확히 시장/거리 단어. dbMatcher 의도 (food category 매칭)
        // 와 무관 — 그냥 unmatched 처리 + verified=false.
        const LANDMARK_SUFFIXES = /(시장|거리|광장|역|타운|마을|로|공항|터미널|광장시장|남대문|동대문|광장)$/;
        const LANDMARK_WORDS = /^(자갈치|광장시장|남대문시장|동대문시장|남포동|해운대|광안리|gwangjang|namdaemun|dongdaemun|jagalchi|nampo|haeundae|gwangalli)$/i;
        const isLandmark = LANDMARK_SUFFIXES.test(stopName) || LANDMARK_WORDS.test(stopName);
        if (isLandmark) {
          console.warn(
            `[planner] DB city-mismatch SKIP (P114 후속): "${stopName}" landmark name — cross-city fallback 사용 X (verified=false)`
          );
          // match 미설정 → 아래 else 분기로 가서 verified=false + dbUnmatched++
        } else {
          // P183 phase 1 (2026-05-24): cross-city fallback HARD REJECT (P180 후속 강화).
          // 이전: match=fallback + verified=false (P466 X-H8) + Gemini address 유지.
          // 그러나 _dbMatchedName 메타 + isCityMismatch flag = 사용자 UI 가 "DB matched"
          // 흔적 노출 가능. 운영자 "오류 좀 잡자 회귀법칙도 해놨는데" 강조 — prompt-only
          // 회귀 차단 한계 인정 후 runtime hard reject. 변경: match=null + count++ +
          // alert. unmatched 처리 → 명확한 verified=false (DB 메타 0).
          cityMismatchCount++;
          if (cityMismatchSamples.length < 5) {
            cityMismatchSamples.push(`${stopName} (plan=${matchCity}, fallbackCity=${(fallback.city || '?').toLowerCase()}, REJECTED)`);
          }
          console.warn(
            `[planner P183 phase 1] DB cross-city HARD REJECT: "${stopName}" plan=${matchCity} fallback=${(fallback.city || '?').toLowerCase()} — match=null + verified=false (hallucination 차단)`
          );
          // match 미설정 → 아래 else 분기 → verified=false + dbUnmatched++
        }
      } else if (fallback) {
        // No requested city, or fallback happened to be in the right city anyway.
        match = fallback;
      }
    }

    if (match) {
      const dbName = (match.name || '').split('|')[0].trim();
      if (match.address && !isCityMismatch) {
        // _food_index 주소 정리: "대한민국 " 접두사, "KR " 제거, 역순 주소 무시
        let cleanAddr = match.address
          .replace(/^대한민국\s+/, '')
          .replace(/\bKR\s+/g, '');
        if (/^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/.test(cleanAddr)) {
          stop.address = cleanAddr;
        }
      }
      // PR #466 (X-H8): coord override SKIPPED on city-mismatch — user must
      // not be led to a different city via the map link.
      if (!isCityMismatch) {
        if (match.lat) { stop.lat = match.lat; stop._dbLat = match.lat; }
        if (match.lng) { stop.lng = match.lng; stop._dbLng = match.lng; }
        if (match.googleMapsUrl) stop.googleMapsUrl = match.googleMapsUrl;
      }
      stop.verified = !isCityMismatch; // city-mismatch is NOT fully verified for the requested city
      stop._dbMatchedName = dbName;
      if (isCityMismatch) {
        stop._db_city_mismatch = {
          dbCity: (match.city || '').toLowerCase(),
          requestedCity: matchCity,
        };
      }

      // P189 (2026-05-25) SAFETY-CRITICAL: allergen 위반 검사
      // match 의 allergens.xxx === true + 사용자 해당 알레르기 선택 → 위반
      // 현재: 모든 row allergens = false (default) → 위반 0 (DB retrofit 전 safe).
      // 위반 발생 시: verified=false + _allergen_violation 마킹 + 경고 로그.
      if (allergyPrefs.length > 0) {
        const violated = detectAllergenViolation(match, allergyPrefs);
        if (violated) {
          stop.verified = false;
          stop._allergen_violation = violated;
          console.warn(
            `[planner P189 SAFETY] allergen violation: "${dbName}" allergens.${violated.join('+')}=true — user allergy: ${violated.join(', ')} — verified=false`
          );
          throttledTelegramAlert({
            key: `p189-allergen-violation:${dbName}`,
            channel: 'admin',
            severity: 'critical',
            message: [
              `🚨 <b>P189 SAFETY-CRITICAL — allergen violation in DB match</b>`,
              ``,
              `<b>식당:</b> ${dbName.replace(/[<>&]/g, '_')}`,
              `<b>위반 알레르기:</b> ${violated.join(', ')}`,
              `<b>도시:</b> ${matchCity || '(unknown)'}`,
              `<b>조치:</b> stop.verified=false 처리`,
              ``,
              `→ _food_index.json 의 해당 식당 allergens 값 확인 후 DB 수정 또는 Gemini prompt 수정 필요.`,
            ].join('\n'),
            context: {
              errorCode: 'p189_allergen_violation',
              restaurant: dbName,
              allergens: violated,
              step: 'applyDBMatcher',
            },
          });
        }
      }

      dbMatched++;
    } else {
      stop.verified = false;
      dbUnmatched++;
    }
    } // end per-stop (P114)
  } // end per-day (P114)
  console.log(`[planner] DB Match: ${dbMatched} matched (${cityMismatchCount} city-mismatch), ${dbUnmatched} unmatched out of ${dbMatched + dbUnmatched} food stops`);

  // PR #466 (X-H8): admin alert when city-mismatch ratio is suspiciously high.
  // Indicates either a regional outage in foodIndex (city field missing for
  // a region's restaurants), a Gemini regression (outputting wrong-city
  // restaurant names), or a wizard mis-routing plans to the wrong region.
  // P183 phase 1 (2026-05-24): 분모 = same-city match + cross-city reject (cityMismatch)
  // = "city-checked food stops". 이전 dbMatched 분모는 P183 cross-city reject 후
  // dbMatched 에 cross-city 빠짐 → MIN_MATCHES 미달 + ratio 왜곡. totalFoodWithCity
  // 가 직관적 의미 (5-stop plan 의 2 mismatch = 40%).
  const totalFoodWithCityCheck = dbMatched + cityMismatchCount;
  if (totalFoodWithCityCheck >= CITY_MISMATCH_MIN_MATCHES) {
    const ratio = cityMismatchCount / totalFoodWithCityCheck;
    // P180 (2026-05-24): > 에서 >= 로 변경 — 정확히 20% (1/5 mismatch) 도 alert.
    // 이전 `>` 는 1/5 = 0.2 = 0.2 false → silent. 1+ mismatch in 5-stop plan
    // 시 alert 보장.
    if (ratio >= CITY_MISMATCH_RATIO_THRESHOLD) {
      const ratioPct = Math.round(ratio * 100);
      throttledTelegramAlert({
        key: `dbmatcher-city-mismatch:${tripMatchCity || 'unknown'}`,
        channel: 'admin',
        severity: 'high',
        message: [
          `⚠️ <b>DB matcher city-mismatch — ${ratioPct}% of food matches landed in wrong city</b>`,
          ``,
          `<b>requested city (trip):</b> ${tripMatchCity || '(none)'} <i>(P114: per-day matchCity 적용; samples 에 day별 city 포함)</i>`,
          `<b>mismatched:</b> ${cityMismatchCount} / ${totalFoodWithCityCheck} city-checked food stops (${ratioPct}%)`,
          `<b>samples:</b>`,
          ...cityMismatchSamples.slice(0, 5).map((s) => `  • ${s.replace(/[<>&]/g, '_')}`),
          ``,
          `→ 회귀 원인 가능성:`,
          `• foodIndex.json 의 특정 region 데이터가 city 필드 누락`,
          `• Gemini prompt 가 region 명시 못 따라가 wrong-city 식당 출력 (P85 retry storm 동반 가능)`,
          `• wizard 가 plan 을 잘못된 region 으로 routing (P54 foodIndex cache 회귀 검토)`,
          ``,
          `<i>city-mismatch stop 의 address/lat/lng 는 Gemini 원본 보존 (사용자 잘못된 도시 안 감).</i>`,
        ].join('\n'),
        context: {
          errorCode: 'dbmatcher_city_mismatch_high',
          reason: tripMatchCity || 'unknown',
          step: 'applyDBMatcher',
        },
      }).catch(() => {});
    }
  }
}
