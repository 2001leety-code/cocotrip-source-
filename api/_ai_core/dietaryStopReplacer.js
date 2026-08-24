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
import { isDietaryTrusted, acceptTagsForDiet, dietaryEvidenceFor, describeDietaryEvidence } from '../_shared/dietary-trust.js';
import { resolveCityCode } from '../_food_helper.js';

const MAX_KM = 8; // 위반 stop 좌표 기준 교체 후보 최대 거리 (동선 보존)

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function collectPlanNames(itinerary) {
  const names = new Set();
  for (const day of itinerary?.days || []) {
    for (const s of day?.stops || []) {
      if (s?.name) names.add(String(s.name).split('|')[0].trim());
      if (s?.display_name) names.add(String(s.display_name).trim());
    }
  }
  return names;
}

/** 위반 diet 하나를 커버하는 태그 목록 — 규칙 SSOT = dietary-trust.acceptTagsForDiet. */
const acceptTagsFor = acceptTagsForDiet;

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

  for (const v of violations) {
    // 위반 stop 찾기 (label 매칭 — validateResponse 와 동일 라벨 규칙)
    let target = null;
    for (const day of itinerary?.days || []) {
      for (const s of day?.stops || []) {
        const label = (s?.name || s?.display_name || '').split('|')[0].trim();
        if (label && label === v.stop) { target = s; break; }
      }
      if (target) break;
    }
    if (!target || target.category !== 'food') { result.failed++; continue; }

    const accept = acceptTagsFor(v.diet);
    const hasCoord = Number.isFinite(target.lat) && Number.isFinite(target.lng);
    const candidates = foodIndex.filter((r) => {
      if (!accept.includes(String(r.tag || '').toLowerCase())) return false;
      if (!isDietaryTrusted(r)) return false; // unverified 절대 금지
      const nm = String(r.name || '').split('|')[0].trim();
      if (usedNames.has(nm) || (r.nameEn && usedNames.has(r.nameEn))) return false;
      if (hasCoord && Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
        return distanceKm(target.lat, target.lng, r.lat, r.lng) <= MAX_KM;
      }
      // 좌표 비교 불가 시 도시 일치 요구
      return r.city === fallbackCity;
    });

    if (!candidates.length) {
      result.failed++;
      result.detail.push(`no-candidate ${v.diet}:${v.stop}`);
      continue; // 이름 생성·완화 금지 — caller 가 retry→throw
    }

    candidates.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0));
    const pick = candidates[0];
    const pickName = String(pick.name || '').split('|')[0].trim();

    // stop 교체 — 검증된 DB 값으로 (스키마: name=한국어, display_name=표시)
    target.name = pickName;
    target.display_name = pick.nameEn || pickName;
    target.address = pick.address || target.address;
    if (Number.isFinite(pick.lat)) target.lat = pick.lat;
    if (Number.isFinite(pick.lng)) target.lng = pick.lng;
    if (pick.googleMapsUrl) target.googleMapsUrl = pick.googleMapsUrl;
    target.verified = true;
    const tagSet = new Set((Array.isArray(target.dietary_tags) ? target.dietary_tags : []).map((t) => String(t).toLowerCase()));
    tagSet.add(String(pick.tag).toLowerCase());
    target.dietary_tags = [...tagSet];
    // 등급 증거를 stop 에 전파 — verified(=DB 실재) 와 별개 필드. (2026-08-24)
    const evidence = dietaryEvidenceFor(pick, v.diet);
    if (evidence) target.dietary_evidence = [evidence];
    // tip: 시간·메뉴 확언 없이 **등급을 숨기지 않는** 문구로 대체 (영업시간 데이터 없음 — 확언 금지).
    //   🔴 이전 문구 "Verified <tag> listing" 은 muslim_friendly(친화, 인증 아님)까지 "검증된 할랄"
    //   로 읽혔다 — 등급 분리의 의미를 문구가 무효화. 등급별 문구는 dietary-trust SSOT.
    target.tip = evidence
      ? describeDietaryEvidence(evidence.verification_status, language)
      : `Listed in our ${String(pick.tag)} database. Please confirm with the restaurant and check opening hours before visiting.`;
    target._replaced_for_dietary = v.diet; // 감사 추적

    usedNames.add(pickName);
    if (pick.nameEn) usedNames.add(pick.nameEn);
    result.replaced++;
    result.detail.push(`replaced ${v.diet}:${v.stop} -> ${pickName}`);
  }
  return result;
}
