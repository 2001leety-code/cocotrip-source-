/**
 * 런타임 어드민 토글 (어드민 조종석, 2026-06-06) — Firestore admin_config/runtime_flags 읽기/쓰기.
 * 어드민이 Claude/재배포 없이 백엔드 플래그 on/off. 표준 런타임 플래그 패턴 (config doc + 캐시 + fail-safe).
 *
 * 안전 설계:
 *   - fail-safe: 읽기 실패/문서 미존재 → 화이트리스트 default (spec/env 기본값 유지). 장애 시 기존 동작.
 *   - ⚠️ RUNTIME_FLAG_KEYS 화이트리스트만 토글 가능 — 임의 키 쓰기 금지 (원격 제어 surface 보안).
 *   - 백엔드 read 플래그만 (프론트 VITE_ 빌드고정 플래그는 런타임 토글 불가 — 별도 정책).
 */

// 런타임 토글 가능한 백엔드 플래그 (label/desc/default). 신규 플래그는 여기 등록 + 백엔드 read 연결.
export const RUNTIME_FLAG_KEYS = {
  inquiry_auto_ack_enabled: {
    label: '문의 자동 접수확인',
    desc: '켜면 로그인에서 이메일 소유가 확인되고 서버 검증·시간창·일일상한을 모두 통과한 새 문의에만 접수 확인 메일을 보냅니다. 최종 견적 답변은 계속 사람 승인입니다.',
    default: false,
  },
  transfer_margin_guard_enabled: {
    label: 'transfer 최소마진 가드',
    desc: '켜면 transfer 결제가 추정원가×배수 미달 시 차단(협의). ⚠️ 원가모델=추정치 — 실 기사일당/연료 교체 후 권장.',
    default: false,
  },
};

const COLLECTION = 'admin_config';
const DOC_ID = 'runtime_flags';
const TTL_MS = 30_000;
let _cache = null;
let _cacheAt = 0;

function defaultsObject() {
  const d = {};
  for (const [k, v] of Object.entries(RUNTIME_FLAG_KEYS)) d[k] = v.default;
  return d;
}

/**
 * 런타임 플래그 읽기 (30s 캐시, fail-safe). 화이트리스트 키만, boolean 만 신뢰.
 * @param {object} adminDb - initAdminDb 결과
 * @returns {Promise<object>} { [flagKey]: boolean }
 */
export async function getRuntimeFlags(adminDb) {
  const now = Date.now();
  if (_cache && now - _cacheAt < TTL_MS) return _cache;
  const defaults = defaultsObject();
  if (!adminDb) return _cache || defaults;
  try {
    const snap = await adminDb.collection(COLLECTION).doc(DOC_ID).get();
    const data = (snap && snap.exists) ? (snap.data() || {}) : {};
    const merged = { ...defaults };
    for (const k of Object.keys(RUNTIME_FLAG_KEYS)) {
      if (typeof data[k] === 'boolean') merged[k] = data[k];
    }
    _cache = merged;
    _cacheAt = now;
    return merged;
  } catch (err) {
    console.warn('[runtime-flags] read 실패 → 기본값(안전) 사용:', err.message);
    return _cache || defaults;
  }
}

/**
 * 외부 자동발송용 무캐시·fail-closed 읽기.
 * 문서 없음, 비 boolean, Firestore 오류는 모두 false이며 과거 캐시를 재사용하지 않는다.
 */
export async function getFailClosedRuntimeFlag(adminDb, key) {
  if (!adminDb || !RUNTIME_FLAG_KEYS[key] || RUNTIME_FLAG_KEYS[key].default !== false) return false;
  try {
    const snap = await adminDb.collection(COLLECTION).doc(DOC_ID).get();
    if (!snap || !snap.exists) return false;
    const data = snap.data() || {};
    return data[key] === true;
  } catch (err) {
    console.warn('[runtime-flags] 외부 자동화 플래그 read 실패 → OFF:', err.message);
    return false;
  }
}

/**
 * 런타임 플래그 쓰기 (화이트리스트 + boolean 검증). 캐시 즉시 무효화.
 * @returns {Promise<boolean>} 성공 여부
 */
export async function setRuntimeFlag(adminDb, key, value, byEmail) {
  if (!adminDb || !RUNTIME_FLAG_KEYS[key] || typeof value !== 'boolean') return false;
  const { FieldValue } = await import('firebase-admin/firestore');
  await adminDb.collection(COLLECTION).doc(DOC_ID).set({
    [key]: value,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: byEmail || 'admin',
  }, { merge: true });
  _cache = null; // 즉시 반영 (다음 read 가 fresh)
  _cacheAt = 0;
  return true;
}

/** 테스트용 캐시 리셋 */
export function __resetRuntimeFlagsCache() { _cache = null; _cacheAt = 0; }
