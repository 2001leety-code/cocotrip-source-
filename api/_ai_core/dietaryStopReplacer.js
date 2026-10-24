/**
 * dietaryStopReplacer — 위반 식사 stop 을 "검증된" DB 식당으로 결정론적 교체
 * (2026-07-11 운영자 지시 3단계-C).
 *
 * 배경: 기존엔 dietary_violation 시 전체 일정 재생성(Gemini retry)에만 의존 —
 * 비결정적이고 느리며 재차 위반 가능. 여기서는 위반 stop 만 골라
 * 신뢰 등급(isDietaryTrusted) 통과 후보로 교체한다.
 *
 * 교체 후보 조건 (전부 만족):
 *   - 같은 도시 (resolveCityCode 기준)
 *   - dietary 태그 일치 + isDietaryTrusted (unverified 제외)
 *   - isRowCityConsistent (주소가 city 필드와 모순되는 행 제외)
 *   - 위반 stop 좌표가 있으면 반경 MAX_KM 내 (동선 보존), 없으면 도시 전체에서 최고 평점
 *   - 플랜에 이미 등장한 식당 제외 (중복 방지)
 *   ⚠️ 영업시간: DB 에 영업시간 데이터가 없어 검사 불가 — 정직하게 한계 명시.
 *     (후보의 tip 에 시간 확언을 넣지 않는다)
 *
 * 절대 규칙 (CLAUDE.md J):
 *   - 후보 부족 시 이름 생성·general 완화 금지 → 교체 포기(false 반환), caller 가
 *     기존 retry→throw(DIETARY_VIOLATION) 경로로 진행.
 *   - 검증 완화 아님: 교체 후 validateResponse 를 다시 통과해야 한다 (caller 책임).
 */
import { isDietaryTrusted, dietaryEvidenceFor } from '../_shared/dietary-trust.js';
import { applyFoodRowToStop } from './revisitPolicy.js';
import { resolveCityCode } from '../_food_helper.js';
import { isRowCityConsistent } from '../_shared/food-row-provenance.js';
import { resolveUiCityKey } from '../_shared/cityResolver.js';

const MAX_KM = 8; // 위반 stop 좌표 기준 교체 후보 최대 거리 (동선 보존)

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 명시 식별자 정규화 — 정확 일치만(trim + 소문자). 브랜드 퍼지·접미사 제거 없음 (지점 구분 보존). */
function identityKeys(values) {
  const keys = [];
  for (const v of values) {
    if (!v) continue;
    for (const part of String(v).split('|')) {
      const k = part.trim().toLowerCase();
      if (k) keys.push(k);
    }
  }
  return keys;
}

/** stop 의 명시 식별자 — 현재 필드 + legacy name_ko/name_en, pipe 별칭 전부. */
function stopIdentityKeys(s) {
  return s ? identityKeys([s.name, s.display_name, s.name_ko, s.name_en]) : [];
}

/** DB 행의 명시 식별자 — name 의 pipe 별칭 전부 + nameEn. */
function rowIdentityKeys(r) {
  return r ? identityKeys([r.name, r.nameEn]) : [];
}

function collectPlanNames(itinerary) {
  const names = new Set();
  for (const day of itinerary?.days || []) {
    for (const s of day?.stops || []) {
      for (const k of stopIdentityKeys(s)) names.add(k);
    }
  }
  return names;
}


/**
 * 위반 food stop 들을 교체 시도.
 * @param {object} itinerary - Gemini 응답 (mutate)
 * @param {Array} issues - validateResponse 결과
 * @param {Array} foodIndex - _food_index.json
 * @param {string[]} dietaryArr - 사용자 식이 목록
 * @param {string} area - 요청 도시 (다도시는 stop 좌표 우선)
 * @returns {{replaced: number, failed: number, detail: string[]}}
 */
export function replaceViolatingFoodStops(itinerary, issues, foodIndex, dietaryArr, area, language = 'en') {
  const result = { replaced: 0, failed: 0, detail: [] };
  const violations = (issues || []).filter((i) => i.type === 'dietary_violation');
  if (!violations.length || !Array.isArray(foodIndex) || !foodIndex.length) return result;

  const usedNames = collectPlanNames(itinerary);
  const fallbackCity = resolveCityCode(area);
  // 2026-10-24 (재방문 정책 F): stop 별로 **요청 안전 식이 전부**를 한 행이 만족해야 후보(위반 식이 하나만 보던 것 →
  //   Halal+Vegan 손님에게 halal 만 맞는 행으로 바꿔 vegan 위반을 새로 만들던 구멍). 같은 stop 의 위반 여러 건은 한 번만.
  const safety = [...new Set((Array.isArray(dietaryArr) ? dietaryArr : []).map((d) => String(d).toLowerCase())
    .filter((d) => d === 'halal' || d === 'vegan' || d === 'vegetarian'))];
  // 위반 stop 찾기 (label 매칭 — validateResponse 와 동일 라벨 규칙). 2026-10-24: 처리 단위 = **stop 객체** —
  //   같은 이름의 위반 식당이 Day1·Day2 에 둘 다 있으면 둘 다 교체(이름 단위면 두 번째가 남았다), 같은 stop 의
  //   식이별 위반 여러 건은 한 번만. 교체 전에 대상을 다 모은다(교체로 바뀐 이름이 다음 라벨 매칭에 끼지 않게).
  const targets = [];
  const handled = new Set();
  const seenLabels = new Set();
  for (const v of violations) {
    if (seenLabels.has(v.stop)) continue;
    seenLabels.add(v.stop);
    let found = 0;
    for (const day of itinerary?.days || []) {
      for (const s of day?.stops || []) {
        const label = (s?.name || s?.display_name || '').split('|')[0].trim();
        if (!label || label !== v.stop || handled.has(s)) continue;
        handled.add(s);
        found += 1;
        targets.push({ v, target: s, targetDay: day });
      }
    }
    if (found === 0) result.failed++;
  }

  for (const { v, target, targetDay } of targets) {
    // UI city key of the day that owns the stop; null when unknown (no seoul fallback)
    const dayCity = resolveUiCityKey(targetDay?.city) || resolveUiCityKey(area);
    if (target.category !== 'food') { result.failed++; continue; }

    const diets = safety.length > 0 ? safety : [String(v.diet || '').toLowerCase()];
    const hasCoord = Number.isFinite(target.lat) && Number.isFinite(target.lng);
    // 공통 자격: 요청 식이 전부(신뢰 등급 포함 — unverified 절대 금지) + 주소-도시 정합 + 그 날 도시.
    const eligible = foodIndex.filter((r) => {
      if (!r || typeof r !== 'object') return false;
      if (!diets.every((d) => dietaryEvidenceFor(r, d))) return false;
      if (!isDietaryTrusted(r)) return false; // unverified 절대 금지
      if (!isRowCityConsistent(r)) return false; // 주소가 city 필드와 모순 — 좌표/도시 근거 불신
      // 2026-10-10: the 8km radius alone trusted the MODEL's coordinates — a Busan day with Seoul coords pulled
      // Seoul restaurants (final gate then blocked → paid retry). A candidate must belong to the day's city.
      if (dayCity) return String(r.city || '').toLowerCase() === dayCity;
      return r.city === fallbackCity;
    });
    const unused = eligible.filter((r) => !rowIdentityKeys(r).some((k) => usedNames.has(k)));
    const todayNames = new Set((targetDay?.stops || []).filter((s) => s !== target).flatMap((s) => stopIdentityKeys(s)));
    const byRating = (a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0);
    const byNearest = (a, b) => {
      const da = hasCoord && Number.isFinite(a.lat) && Number.isFinite(a.lng) ? distanceKm(target.lat, target.lng, a.lat, a.lng) : Infinity;
      const db = hasCoord && Number.isFinite(b.lat) && Number.isFinite(b.lng) ? distanceKm(target.lat, target.lng, b.lat, b.lng) : Infinity;
      return da - db || byRating(a, b);
    };
    // 단계: 8km 내 미사용 → 도시 전체 미사용 → 오늘 미사용(다른 날 재방문, revisit: true) → 실패.
    const near = hasCoord
      ? unused.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && distanceKm(target.lat, target.lng, r.lat, r.lng) <= MAX_KM).sort(byRating)
      : [];
    let stage = 'near-8km';
    let pick = near[0];
    if (!pick) { stage = 'city-unused'; pick = unused.slice().sort(byNearest)[0]; }
    if (!pick) { stage = 'revisit-other-day'; pick = eligible.filter((r) => !rowIdentityKeys(r).some((k) => todayNames.has(k))).sort(byNearest)[0]; }

    if (!pick) {
      result.failed++;
      result.detail.push(`no-candidate ${diets.join('+')}:${v.stop}`);
      continue; // 이름 생성·완화 금지 — caller 가 retry→throw
    }
    const pickName = String(pick.name || '').split('|')[0].trim();

    // stop 교체 — 검증된 DB 값으로 (스키마: name=한국어, display_name=표시). 2026-10-24: 정규화기와 같은 공용 헬퍼 —
    //   행 값으로 덮고 옛 식당 종속 필드(메뉴·예약·지도 링크 등)는 지운다. 증거 = 요청 식이 전부(행에서만).
    //   tip: 시간·메뉴 확언 없이 **등급을 숨기지 않는** 문구(dietary-trust SSOT — "친화" 를 "인증" 으로 읽히게 하지 않음).
    applyFoodRowToStop(target, pick, { diets, language });
    if (stage === 'revisit-other-day') target.revisit = true; else delete target.revisit;
    target._replaced_for_dietary = v.diet; // 감사 추적

    for (const k of rowIdentityKeys(pick)) usedNames.add(k);
    result.replaced++;
    result.detail.push(`replaced ${v.diet}:${v.stop} -> ${pickName} [${stage}]`);
  }
  return result;
}
