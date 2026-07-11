/**
 * 프로모 배너/팝업 설정 — Firestore admin_config/{promo_banner|promo_popup} 읽기/쓰기.
 * 어드민이 배포 없이 배너·팝업 문구·CTA·노출여부를 직접 관리.
 *
 * 안전 설계:
 *   - fail-safe: 읽기 실패/문서 미존재 → DEFAULT 반환 (throw 금지).
 *   - setPromoConfig / setPopupConfig: 화이트리스트 필드만 허용 + 타입 검증. 임의 키 쓰기 금지.
 *   - Firestore rules: admin_config/* client write false (서버 경유만).
 *   - 공개 읽기(promo-config.js) / 어드민 쓰기(admin-promo-config.js) 완전 분리.
 */

const COLLECTION = 'admin_config';
const DOC_ID = 'promo_banner';
const POPUP_DOC_ID = 'promo_popup';
const TTL_MS = 60_000; // 공개 엔드포인트 Cache-Control: max-age=60 와 일치
let _cache = null;
let _cacheAt = 0;
// 팝업 전용 캐시 (배너와 독립)
let _popupCache = null;
let _popupCacheAt = 0;

// 허용 필드 목록 (임의 키 쓰기 방어)
const ALLOWED_FIELDS = ['enabled', 'copy', 'ctaText', 'ctaHref', 'endDate'];
// 팝업 허용 필드 목록
const ALLOWED_POPUP_FIELDS = ['enabled', 'title', 'body', 'imageUrl', 'ctaText', 'ctaHref', 'frequency'];
// frequency 허용값
const ALLOWED_FREQUENCY = ['once', 'daily', 'every_visit'];

// 4언어 키 목록
const LANG_KEYS = ['ko', 'en', 'ja', 'zh'];

/**
 * DEFAULT_PROMO_CONFIG — PromoBanner.tsx 코드 상수와 동일 값 (둘 다 같이 고칠 것).
 * Firestore 문서가 없거나 읽기 실패 시 폴백.
 *
 * 🚨 2026-07-10 P0 프로모션 진실성: 거짓 '50% OFF'·'첫 예약 10%'·지난 '6/28' 제거.
 *    프론트(PromoBanner.tsx)는 7/7에 고쳤으나 이 서버 DEFAULT 가 남아 prod API 가
 *    낡은 문구를 반환하고 있었음. 실발급(onboarding-coupons.js) = AI플랜 무료(1~3일)
 *    + 차터 5% + 투어 5%, 총 할인 상한 10% — 문구는 실발급과 일치해야 한다.
 *    가짜 긴급성·가짜 재고·근거 없는 할인율 금지 (Booking €413M 벌금 사례).
 */
export const DEFAULT_PROMO_CONFIG = {
  enabled: true,
  copy: {
    en: '🎉 Grand Opening — free 1–3 day AI plan + 5% charter and tour coupons when you sign up',
    ko: '🎉 오픈 기념 — 가입하면 1~3일 AI 일정 무료 + 차터·투어 5% 쿠폰',
    ja: '🎉 オープン記念 — 登録で1〜3日AIプラン無料 + チャーター・ツアー5%クーポン',
    zh: '🎉 开业纪念 — 注册即享1–3天AI行程免费 + 包车·行程5%优惠券',
  },
  ctaText: {
    en: 'See deals →',
    ko: '딜 보기 →',
    ja: 'お得を見る →',
    zh: '查看优惠 →',
  },
  ctaHref: '/tours',
  endDate: '', // 지난 6/28 제거 — 빈값이면 프론트가 '선착순'류 표시 (가짜 마감일 금지)
};

/**
 * 프로모 배너 설정 읽기 (60s 캐시, fail-safe).
 * @param {object|null} db - initAdminDb 결과 (null 허용)
 * @returns {Promise<typeof DEFAULT_PROMO_CONFIG>}
 */
export async function getPromoConfig(db) {
  const now = Date.now();
  if (_cache && now - _cacheAt < TTL_MS) return _cache;
  if (!db) return _cache || DEFAULT_PROMO_CONFIG;
  try {
    const snap = await db.collection(COLLECTION).doc(DOC_ID).get();
    const data = (snap && snap.exists) ? (snap.data() || {}) : {};
    // Firestore 값이 있는 필드만 병합 (없으면 DEFAULT 유지)
    const merged = {
      enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_PROMO_CONFIG.enabled,
      copy: _mergeLangMap(data.copy, DEFAULT_PROMO_CONFIG.copy),
      ctaText: _mergeLangMap(data.ctaText, DEFAULT_PROMO_CONFIG.ctaText),
      ctaHref: (typeof data.ctaHref === 'string' && data.ctaHref) ? data.ctaHref : DEFAULT_PROMO_CONFIG.ctaHref,
      endDate: (typeof data.endDate === 'string') ? data.endDate : DEFAULT_PROMO_CONFIG.endDate,
    };
    _cache = merged;
    _cacheAt = now;
    return merged;
  } catch (err) {
    console.warn('[promo-config] read 실패 → 기본값(안전) 사용:', err.message);
    return _cache || DEFAULT_PROMO_CONFIG;
  }
}

/**
 * 프로모 배너 설정 쓰기.
 * 화이트리스트 필드(ALLOWED_FIELDS) + 타입검증. 잘못된 필드/타입 = 거부.
 * @param {object} db
 * @param {object} config - 부분 업데이트 가능 (merge: true)
 * @param {string} [byEmail]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function setPromoConfig(db, config, byEmail) {
  if (!db || !config || typeof config !== 'object') {
    return { ok: false, error: 'db 또는 config 누락' };
  }

  // 화이트리스트 외 필드 거부
  const unknownKeys = Object.keys(config).filter((k) => !ALLOWED_FIELDS.includes(k));
  if (unknownKeys.length > 0) {
    return { ok: false, error: `허용되지 않은 필드: ${unknownKeys.join(', ')}` };
  }

  // enabled: boolean 검증
  if ('enabled' in config && typeof config.enabled !== 'boolean') {
    return { ok: false, error: 'enabled 는 boolean 이어야 합니다' };
  }

  // copy / ctaText: 4언어 string 검증
  for (const mapKey of ['copy', 'ctaText']) {
    if (mapKey in config) {
      const val = config[mapKey];
      if (!val || typeof val !== 'object') {
        return { ok: false, error: `${mapKey} 는 객체(4언어 map) 이어야 합니다` };
      }
      for (const lang of LANG_KEYS) {
        if (lang in val && typeof val[lang] !== 'string') {
          return { ok: false, error: `${mapKey}.${lang} 는 string 이어야 합니다` };
        }
      }
    }
  }

  // ctaHref / endDate: string 검증
  for (const strKey of ['ctaHref', 'endDate']) {
    if (strKey in config && typeof config[strKey] !== 'string') {
      return { ok: false, error: `${strKey} 는 string 이어야 합니다` };
    }
  }

  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection(COLLECTION).doc(DOC_ID).set({
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: byEmail || 'admin',
    }, { merge: true });
    _cache = null; // 즉시 무효화 (다음 read 가 fresh)
    _cacheAt = 0;
    return { ok: true };
  } catch (err) {
    console.error('[promo-config] set 실패:', err.message);
    return { ok: false, error: err.message };
  }
}

/** 테스트용 캐시 리셋 */
export function __resetPromoConfigCache() { _cache = null; _cacheAt = 0; }

// ─── 팝업 설정 ────────────────────────────────────────────────────────────────

/**
 * DEFAULT_POPUP_CONFIG — PromoPopup.tsx 코드 상수와 동일 값.
 * Firestore 문서가 없거나 읽기 실패 시 폴백. enabled:false = 처음엔 팝업 안 뜸.
 */
export const DEFAULT_POPUP_CONFIG = {
  enabled: false,
  title: {
    en: '🎉 Special Offer',
    ko: '🎉 특별 혜택',
    ja: '🎉 スペシャルオファー',
    zh: '🎉 特别优惠',
  },
  body: {
    en: 'Book your Korea adventure today and get an exclusive discount!',
    ko: '지금 한국 여행을 예약하고 특별 할인을 받으세요!',
    ja: '今すぐ韓国旅行を予約して、特別割引をゲット！',
    zh: '立即预订韩国之旅，享受专属折扣！',
  },
  imageUrl: '',
  ctaText: {
    en: 'Book Now →',
    ko: '지금 예약 →',
    ja: '今すぐ予約 →',
    zh: '立即预订 →',
  },
  ctaHref: '/tours',
  frequency: 'once', // 'once' | 'daily' | 'every_visit'
};

/**
 * 프로모 팝업 설정 읽기 (60s 캐시, fail-safe).
 * @param {object|null} db - initAdminDb 결과 (null 허용)
 * @returns {Promise<typeof DEFAULT_POPUP_CONFIG>}
 */
export async function getPopupConfig(db) {
  const now = Date.now();
  if (_popupCache && now - _popupCacheAt < TTL_MS) return _popupCache;
  if (!db) return _popupCache || DEFAULT_POPUP_CONFIG;
  try {
    const snap = await db.collection(COLLECTION).doc(POPUP_DOC_ID).get();
    const data = (snap && snap.exists) ? (snap.data() || {}) : {};
    const merged = {
      enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_POPUP_CONFIG.enabled,
      title: _mergeLangMap(data.title, DEFAULT_POPUP_CONFIG.title),
      body: _mergeLangMap(data.body, DEFAULT_POPUP_CONFIG.body),
      imageUrl: (typeof data.imageUrl === 'string') ? data.imageUrl : DEFAULT_POPUP_CONFIG.imageUrl,
      ctaText: _mergeLangMap(data.ctaText, DEFAULT_POPUP_CONFIG.ctaText),
      ctaHref: (typeof data.ctaHref === 'string' && data.ctaHref) ? data.ctaHref : DEFAULT_POPUP_CONFIG.ctaHref,
      frequency: (typeof data.frequency === 'string' && ALLOWED_FREQUENCY.includes(data.frequency))
        ? data.frequency
        : DEFAULT_POPUP_CONFIG.frequency,
    };
    _popupCache = merged;
    _popupCacheAt = now;
    return merged;
  } catch (err) {
    console.warn('[promo-config] popup read 실패 → 기본값(안전) 사용:', err.message);
    return _popupCache || DEFAULT_POPUP_CONFIG;
  }
}

/**
 * 프로모 팝업 설정 쓰기.
 * 화이트리스트 필드(ALLOWED_POPUP_FIELDS) + 타입검증. 잘못된 필드/타입 = 거부.
 * @param {object} db
 * @param {object} config - 부분 업데이트 가능 (merge: true)
 * @param {string} [byEmail]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function setPopupConfig(db, config, byEmail) {
  if (!db || !config || typeof config !== 'object') {
    return { ok: false, error: 'db 또는 config 누락' };
  }

  // 화이트리스트 외 필드 거부
  const unknownKeys = Object.keys(config).filter((k) => !ALLOWED_POPUP_FIELDS.includes(k));
  if (unknownKeys.length > 0) {
    return { ok: false, error: `허용되지 않은 필드: ${unknownKeys.join(', ')}` };
  }

  // enabled: boolean 검증
  if ('enabled' in config && typeof config.enabled !== 'boolean') {
    return { ok: false, error: 'enabled 는 boolean 이어야 합니다' };
  }

  // title / body / ctaText: 4언어 string 검증
  for (const mapKey of ['title', 'body', 'ctaText']) {
    if (mapKey in config) {
      const val = config[mapKey];
      if (!val || typeof val !== 'object') {
        return { ok: false, error: `${mapKey} 는 객체(4언어 map) 이어야 합니다` };
      }
      for (const lang of LANG_KEYS) {
        if (lang in val && typeof val[lang] !== 'string') {
          return { ok: false, error: `${mapKey}.${lang} 는 string 이어야 합니다` };
        }
      }
    }
  }

  // imageUrl / ctaHref: string 검증
  for (const strKey of ['imageUrl', 'ctaHref']) {
    if (strKey in config && typeof config[strKey] !== 'string') {
      return { ok: false, error: `${strKey} 는 string 이어야 합니다` };
    }
  }

  // frequency: 허용값 검증
  if ('frequency' in config) {
    if (typeof config.frequency !== 'string' || !ALLOWED_FREQUENCY.includes(config.frequency)) {
      return { ok: false, error: `frequency 는 'once'|'daily'|'every_visit' 이어야 합니다` };
    }
  }

  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection(COLLECTION).doc(POPUP_DOC_ID).set({
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: byEmail || 'admin',
    }, { merge: true });
    _popupCache = null; // 즉시 무효화
    _popupCacheAt = 0;
    return { ok: true };
  } catch (err) {
    console.error('[promo-config] popup set 실패:', err.message);
    return { ok: false, error: err.message };
  }
}

/** 테스트용 팝업 캐시 리셋 */
export function __resetPopupConfigCache() { _popupCache = null; _popupCacheAt = 0; }

// 내부: 4언어 map 병합 (Firestore 값 우선, 없으면 DEFAULT)
function _mergeLangMap(firestoreMap, defaultMap) {
  const result = {};
  for (const lang of LANG_KEYS) {
    const fsVal = firestoreMap && typeof firestoreMap[lang] === 'string' ? firestoreMap[lang] : null;
    result[lang] = fsVal !== null ? fsVal : defaultMap[lang];
  }
  return result;
}
