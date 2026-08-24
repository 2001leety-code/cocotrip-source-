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
 * 요청 diet 하나를 커버할 수 있는 태그 목록 — vegetarian 은 vegan 식당으로도 안전, 역은 불가.
 * checkDietaryCoverage / dietaryStopReplacer / blockMode 가 같은 규칙을 쓰도록 SSOT 로 올렸다
 * (세 곳에 따로 박혀 있으면 한쪽만 완화돼도 아무도 못 잡는다).
 */
export function acceptTagsForDiet(diet) {
  const d = String(diet || '').toLowerCase();
  if (d === 'vegetarian') return ['vegetarian', 'vegan'];
  return d ? [d] : [];
}

/**
 * 레코드의 dietary 태그 정규화 — 프로덕션 _food_index.json 은 r.tag(단일 문자열),
 * 일부 mock/legacy/기존 plan stop 은 r.dietary_tags(배열). 둘 다 읽어 소문자 배열로.
 * ⚠️ SAFETY: 한쪽만 읽으면 프로덕션에서 halal/vegan 후보가 조용히 0이 된다(2026-06-12 실측).
 */
export function dietaryTagsOfRow(row) {
  if (!row || typeof row !== 'object') return [];
  const out = [];
  const dt = row.dietary_tags;
  if (Array.isArray(dt)) out.push(...dt);
  else if (dt) out.push(dt);
  const tg = row.tag;
  if (Array.isArray(tg)) out.push(...tg);
  else if (tg) out.push(tg);
  return out.map((t) => String(t).toLowerCase());
}

/**
 * 이 레코드가 요청 diet 를 **신뢰 가능한 증거로** 커버하는가.
 *
 * 태그만 맞고 등급이 unverified(naver_local / ai_curated)면 null — 후보 자체에서 탈락시켜
 * 점수 경쟁(평점·근접)에 진입조차 못 하게 한다. "평점 높은 unverified" 가 "평점 낮은 trusted"를
 * 이기는 일이 구조적으로 불가능해야 한다.
 *
 * @param {object} row       foodIndex 레코드
 * @param {string} diet      'halal' | 'vegan' | 'vegetarian'
 * @param {string[]} [rowTags] 이미 계산한 정규화 태그 (없으면 여기서 계산)
 * @returns {{diet: string, tag: string, verification_status: string}|null}
 */
export function dietaryEvidenceFor(row, diet, rowTags) {
  if (!row || typeof row !== 'object') return null;
  const accept = acceptTagsForDiet(diet);
  if (accept.length === 0) return null;
  const tags = Array.isArray(rowTags) ? rowTags : dietaryTagsOfRow(row);
  const matched = accept.find((t) => tags.includes(t));
  if (!matched) return null;
  // 등급은 **매칭된 태그 기준**으로 판정한다. 필드 부재 시 소스 폴백 파생(fail-safe:
  // 격리 소스면 unverified). tag 필드가 없고 dietary_tags 만 있는 레코드도 같은 규칙을 탄다.
  const status = row.verification_status || deriveVerificationStatus({ ...row, tag: matched }) || 'unverified';
  if (!TRUSTED_DIETARY_STATUS.includes(status)) return null;
  return { diet: String(diet || '').toLowerCase(), tag: matched, verification_status: status };
}

/**
 * 등급별 **정직한** 손님 문구 (ko/en/ja/zh).
 *
 * 🔴 muslim_friendly / vegan_options 를 인증(certified)처럼 적으면 안 된다 — 이 둘은
 * Google Places 기반 "친화" 등급이고 인증서 확인이 0이다. 문구가 등급을 감추면
 * 데이터 등급 분리 자체가 무의미해진다.
 */
const DIETARY_EVIDENCE_NOTES = {
  halal_certified: {
    ko: '할랄 인증 근거를 운영자가 직접 확인한 곳입니다. 방문 전 영업시간을 확인하세요.',
    en: 'Halal certification verified by our team. Please confirm opening hours before visiting.',
    ja: 'ハラール認証の根拠を当社が確認済みです。訪問前に営業時間をご確認ください。',
    zh: '清真认证依据已由我们核实。前往前请确认营业时间。',
  },
  muslim_friendly: {
    ko: '무슬림 친화 등록 정보 — 할랄 인증은 확인되지 않았습니다. 방문 전 매장에 할랄 여부와 영업시간을 확인하세요.',
    en: 'Muslim-friendly listing — halal certification NOT verified. Please confirm halal status and opening hours with the restaurant.',
    ja: 'ムスリムフレンドリーの登録情報 — ハラール認証は未確認です。訪問前に店舗へハラール対応と営業時間をご確認ください。',
    zh: '穆斯林友好登记信息 — 清真认证未经核实。前往前请向餐厅确认清真状况与营业时间。',
  },
  vegan_restaurant: {
    ko: '비건 전문점으로 운영자가 직접 확인한 곳입니다. 방문 전 영업시간을 확인하세요.',
    en: 'Verified vegan restaurant, checked by our team. Please confirm opening hours before visiting.',
    ja: '当社が確認したヴィーガン専門店です。訪問前に営業時間をご確認ください。',
    zh: '经我们核实的纯素餐厅。前往前请确认营业时间。',
  },
  vegan_options: {
    ko: '비건 메뉴가 있다고 등록된 곳 — 비건 전문점으로 확인된 것은 아닙니다. 방문 전 매장에 재료와 영업시간을 확인하세요.',
    en: 'Listed as having vegan options — NOT verified as a fully vegan restaurant. Please confirm ingredients and opening hours with the restaurant.',
    ja: 'ヴィーガン対応ありと登録された店 — ヴィーガン専門店として確認されたものではありません。訪問前に材料と営業時間をご確認ください。',
    zh: '登记为提供纯素选项 — 并非已核实的纯素专门餐厅。前往前请向餐厅确认食材与营业时间。',
  },
};

/**
 * @param {string} status verification_status
 * @param {string} [lang] ko|en|ja|zh (기타 값은 en)
 * @returns {string} 등급을 숨기지 않는 문구. 미지의 등급이면 '' (문구를 지어내지 않는다).
 */
export function describeDietaryEvidence(status, lang = 'en') {
  const notes = DIETARY_EVIDENCE_NOTES[String(status || '')];
  if (!notes) return '';
  const l = ['ko', 'en', 'ja', 'zh'].includes(String(lang)) ? String(lang) : 'en';
  return notes[l];
}

/** 운영자 수동 검증 등급인가 (친화 등급과 구분해 표기해야 한다). */
export function isCertifiedDietaryStatus(status) {
  return status === 'halal_certified' || status === 'vegan_restaurant';
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
      // vegetarian 요청은 vegan 식당으로도 커버 가능 (역은 불가) — 규칙 SSOT = acceptTagsForDiet
      const acceptTags = acceptTagsForDiet(diet);
      const has = (foodIndex || []).some((r) =>
        r && r.city === city && acceptTags.includes(String(r.tag || '').toLowerCase()) && isDietaryTrusted(r));
      if (!has) missing.push({ city, diet });
    }
  }
  return { ok: missing.length === 0, missing };
}
