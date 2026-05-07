/**
 * Layer 2 — Firestore-backed cache for place-name translations.
 *
 * 컬렉션: `place_translations`
 *   docId: `${lang}__${originalText}` (URL-unsafe chars 인코딩)
 *   필드: { lang, originalText, translatedText, source, geminiVersion, updatedAt, updatedBy }
 *
 * source:
 *   - 'mapping': Layer 3 chain mapping table 매칭 결과
 *   - 'gemini':  Layer 1 Gemini API 호출 결과
 *   - 'manual':  Layer 4 운영자 어드민에서 수동 수정
 *
 * 운영자가 'manual' 로 마킹한 항목은 Gemini 재번역 안 됨 (translator.js 가 source 체크).
 *
 * Firestore 미연결 시(env 키 누락) 모든 op 가 silent no-op 반환 — caller 는 항상
 * 메모리 LRU 만으로 동작 가능. 신규 도입 비용 0 보장.
 */
import { initAdminDb } from './firebase-admin.js';

const COLLECTION = 'place_translations';

// docId 안전 인코딩 — Firestore 는 / 등 일부 문자 거부.
// `${lang}__${originalText}` 형태 + 위험 문자 base64-url 변형.
function makeDocId(lang, originalText) {
  // base64url 인코딩 (Node Buffer) → docId 충돌 방지
  const safe = Buffer.from(String(originalText), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${lang}__${safe}`;
}

/**
 * Firestore 캐시에서 번역 조회.
 * @returns {Promise<{translatedText: string, source: string, updatedAt?: any}|null>}
 */
export async function getCachedTranslation(originalText, lang) {
  const db = initAdminDb('place-translation-cache');
  if (!db) return null;
  if (!originalText || !lang) return null;

  try {
    const docId = makeDocId(lang, originalText);
    const snap = await db.collection(COLLECTION).doc(docId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data?.translatedText) return null;
    return {
      translatedText: data.translatedText,
      source: data.source || 'gemini',
      updatedAt: data.updatedAt || null,
    };
  } catch (err) {
    console.warn('[place-translation-cache.get] failed:', err.message);
    return null;
  }
}

/**
 * Firestore 캐시에 번역 저장.
 * source='manual' 인 기존 항목은 절대 덮어쓰지 않음 (운영자 보정 우선).
 *
 * @param {string} originalText
 * @param {'en'|'ja'|'zh'} lang
 * @param {string} translatedText
 * @param {'mapping'|'gemini'|'manual'} source
 * @param {{geminiVersion?: string, updatedBy?: string}} [meta]
 */
export async function setCachedTranslation(originalText, lang, translatedText, source, meta = {}) {
  const db = initAdminDb('place-translation-cache');
  if (!db) return false;
  if (!originalText || !lang || !translatedText) return false;
  if (!['mapping', 'gemini', 'manual'].includes(source)) return false;

  try {
    const docId = makeDocId(lang, originalText);
    const ref = db.collection(COLLECTION).doc(docId);

    // manual 보호: 기존 항목이 manual 이면 gemini/mapping 는 덮어쓰지 않음.
    if (source !== 'manual') {
      const existing = await ref.get();
      if (existing.exists && existing.data()?.source === 'manual') {
        return false;
      }
    }

    const { FieldValue } = await import('firebase-admin/firestore');
    await ref.set(
      {
        lang,
        originalText,
        translatedText,
        source,
        geminiVersion: meta.geminiVersion || null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: meta.updatedBy || 'system',
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn('[place-translation-cache.set] failed:', err.message);
    return false;
  }
}

/**
 * 운영자 어드민용 — 페이지네이션으로 캐시 항목 list.
 * @param {{lang?: string, source?: string, search?: string, limit?: number, offset?: number}} opts
 */
export async function listCachedTranslations(opts = {}) {
  const db = initAdminDb('place-translation-cache');
  if (!db) return { items: [], total: 0 };

  const { lang, source, search, limit = 50, offset = 0 } = opts;

  try {
    let q = db.collection(COLLECTION);
    if (lang && ['en', 'ja', 'zh'].includes(lang)) {
      q = q.where('lang', '==', lang);
    }
    if (source && ['mapping', 'gemini', 'manual'].includes(source)) {
      q = q.where('source', '==', source);
    }
    // Firestore 는 substring 검색 미지원 — search 는 클라이언트 필터.
    // 인덱스 비용 최소화 — limit*3 fetch 후 search 적용.
    const fetchLimit = search ? Math.min((limit + offset) * 3, 500) : limit + offset;
    const snap = await q.orderBy('updatedAt', 'desc').limit(fetchLimit).get();
    const all = [];
    snap.forEach((doc) => {
      const d = doc.data();
      all.push({
        id: doc.id,
        lang: d.lang,
        originalText: d.originalText,
        translatedText: d.translatedText,
        source: d.source,
        updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() || null,
        updatedBy: d.updatedBy || null,
      });
    });
    let filtered = all;
    if (search) {
      const s = search.toLowerCase();
      filtered = all.filter(
        (it) =>
          it.originalText.toLowerCase().includes(s) ||
          it.translatedText.toLowerCase().includes(s)
      );
    }
    const items = filtered.slice(offset, offset + limit);
    return { items, total: filtered.length };
  } catch (err) {
    console.warn('[place-translation-cache.list] failed:', err.message);
    return { items: [], total: 0, error: err.message };
  }
}

/**
 * 운영자 수동 수정 — source='manual' 마킹.
 */
export async function updateManualTranslation(originalText, lang, translatedText, updatedBy) {
  return setCachedTranslation(originalText, lang, translatedText, 'manual', {
    updatedBy: updatedBy || 'admin',
  });
}

/**
 * 항목 삭제 — Gemini 재번역 트리거 (다음 호출 시 다시 호출됨).
 */
export async function deleteCachedTranslation(docId) {
  const db = initAdminDb('place-translation-cache');
  if (!db) return false;
  try {
    await db.collection(COLLECTION).doc(docId).delete();
    return true;
  } catch (err) {
    console.warn('[place-translation-cache.delete] failed:', err.message);
    return false;
  }
}

export const _internal = { makeDocId, COLLECTION };
