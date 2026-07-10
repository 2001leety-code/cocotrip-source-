/**
 * 유입(UTM) 스냅샷 서버측 검증 — P1 장기 귀속 (2026-07-11 마케팅 지시서).
 *
 * 클라이언트(analytics.ts getAttributionSnapshot)가 보낸 { first?, last? } 를
 * 화이트리스트로만 통과시켜 가입(users)·예약(bookings) 문서에 저장한다.
 *
 * 안전 설계:
 *   - 허용 키만: utm_source/medium/campaign/term/content + ts. 그 외 전부 폐기.
 *   - 값은 string 만, 120자 컷, '@' 포함 값 폐기(이메일 등 PII 유입 차단).
 *   - 어떤 입력에도 throw 하지 않는다 — 유입 추적이 로그인·예약·결제를 막으면 안 됨.
 *   - 유효 데이터 없으면 null 반환 → 호출부가 필드 자체를 생략.
 */

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const VALUE_MAX = 120;

function sanitizeTouch(touch) {
  if (!touch || typeof touch !== 'object' || Array.isArray(touch)) return null;
  const out = {};
  for (const k of UTM_KEYS) {
    const v = touch[k];
    if (typeof v !== 'string') continue;
    const t = v.trim().slice(0, VALUE_MAX);
    if (!t || t.includes('@')) continue; // PII(이메일류) 값 차단
    out[k] = t;
  }
  // ts 는 ISO 형식만 (임의 문자열 저장 방지)
  if (typeof touch.ts === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(touch.ts.slice(0, 30))) {
    out.ts = touch.ts.slice(0, 30);
  }
  // utm 키가 하나도 없으면 (ts 만 있으면) 의미 없음 → 폐기
  return UTM_KEYS.some((k) => k in out) ? out : null;
}

/**
 * @param {unknown} raw - 클라이언트 body.attribution
 * @returns {{first?: object, last?: object} | null}
 */
export function sanitizeAttribution(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const first = sanitizeTouch(raw.first);
    const last = sanitizeTouch(raw.last);
    if (!first && !last) return null;
    return { ...(first ? { first } : {}), ...(last ? { last } : {}) };
  } catch {
    return null; // 방어: 절대 throw 금지
  }
}
