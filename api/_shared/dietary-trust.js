/**
 * 식단 안전 데이터 신뢰 등급 SSOT (2026-07-11 운영자 지시 3단계-B).
 *
 * 배경 (docs/DIETARY-DATA-AUDIT-2026-07-11.md):
 *   dietary 태그(halal/vegan/vegetarian) 328건 중 218건이 Naver 키워드 검색·AI-curated
 *   산출물 — 인증 근거 0 (생선회집 vegan, 화장품 매장 vegan, 치킨집 halal 실증).
 *   기존 tag 만으로 halal/vegan "인증" 판정하는 것을 금지하고 등급으로 분리한다.
 *
 * 등급 (verification_status):
 *   - halal_certified / vegan_restaurant : 운영자가 source_url 검증 후 수동 부여 (최우선)
 *   - muslim_friendly / vegan_options    : Google Places 기반(실존·평점) dietary 태그 — 자동
 *   - unverified                         : naver_local / ai_curated — 매칭·프롬프트·검증 증거에서 제외
 *
 * ⚠️ SAFETY: 이 모듈은 "증거 강화"용 — 검증 완화 용도로 절대 사용 금지 (CLAUDE.md J).
 */

export const DIETARY_TAGS = ['halal', 'vegan', 'vegetarian'];

// dietary 매칭·증거로 인정되는 등급 (unverified 제외 전부)
export const TRUSTED_DIETARY_STATUS = [
  'halal_certified', 'vegan_restaurant', // 운영자 인증 확인
  'muslim_friendly', 'vegan_options',    // Google Places 기반 (인증 아님 — 친화 등급)
];

// 격리 대상 소스 (운영자 검증 전까지 unverified)
const QUARANTINE_SOURCES = ['naver_local', 'ai_curated_2026_05_21'];

/**
 * 레코드의 verification_status 파생 (인덱스 빌드·마이그레이션 공용).
 * 이미 수동 부여된 halal_certified/vegan_restaurant 는 보존.
 */
export function deriveVerificationStatus(row) {
  const tag = String(row?.tag || '').toLowerCase();
  if (!DIETARY_TAGS.includes(tag)) return null; // dietary 주장 아님 — 등급 불필요
  const existing = row.verification_status;
  if (existing === 'halal_certified' || existing === 'vegan_restaurant') return existing; // 수동 승격 보존
  if (QUARANTINE_SOURCES.includes(row.source)) return 'unverified';
  // Google Places 기반 (placeId + 실측 평점) — 실존 확인, 인증서 검증은 아님
  return tag === 'halal' ? 'muslim_friendly' : 'vegan_options';
}

/**
 * dietary 요청 매칭에 이 레코드를 써도 되는가.
 * - dietary 태그가 아닌 레코드(general 등)는 신뢰 문제 자체가 없음 → true
 * - verification_status 없는 옛 인덱스 레코드는 소스로 폴백 파생 (fail-safe:
 *   격리 소스면 false — 필드 부재가 신뢰 승격이 되면 안 됨)
 */
export function isDietaryTrusted(row) {
  if (!row) return false;
  const tag = String(row.tag || '').toLowerCase();
  if (!DIETARY_TAGS.includes(tag)) return true;
  const vs = row.verification_status || deriveVerificationStatus(row);
  return TRUSTED_DIETARY_STATUS.includes(vs);
}

/**
 * 사전 커버리지 체크 — 요청 도시들×dietary 에 trusted 후보가 있는가.
 * @returns {{ok: boolean, missing: Array<{city: string, diet: string}>}}
 */
export function checkDietaryCoverage(foodIndex, cities, dietaryList) {
  const safety = (dietaryList || []).map((d) => String(d).toLowerCase())
    .filter((d) => ['halal', 'vegan', 'vegetarian'].includes(d));
  if (safety.length === 0) return { ok: true, missing: [] };
  const missing = [];
  for (const cityRaw of (cities || [])) {
    const city = String(cityRaw || '').toLowerCase();
    if (!city) continue;
    for (const diet of safety) {
      // vegetarian 요청은 vegan 식당으로도 커버 가능 (역은 불가)
      const acceptTags = diet === 'vegetarian' ? ['vegetarian', 'vegan'] : [diet];
      const has = (foodIndex || []).some((r) =>
        r && r.city === city && acceptTags.includes(String(r.tag || '').toLowerCase()) && isDietaryTrusted(r));
      if (!has) missing.push({ city, diet });
    }
  }
  return { ok: missing.length === 0, missing };
}
