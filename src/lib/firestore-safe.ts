// ─────────────────────────────────────────────────────────────────────────────
// firestore-safe.ts — Firestore 쓰기 직전에 데이터를 안전하게 만드는 공용 헬퍼.
//
// Firestore 는 "저장할 수 없는 값"을 조용히 무시하지 않고 **쓰기 자체를 거부(throw)** 한다.
// 그래서 화면·유닛테스트·로컬 하네스가 전부 통과해도 실제 저장만 터지는 사고가 반복됐다.
//   - 2026-06-11 장바구니: undefined 필드가 섞여 담기 전체가 실패
//   - 2026-07-19 플랜 저장: 중첩 배열(path)로 신규 플랜 생성 전량 500 (PR#1149)
//
// 저장 스키마를 바꿀 때는 이 모듈을 통과시키고, **실제 Firestore 쓰기로** 확인할 것.
// (로컬 JSON 하네스는 이 제약을 재현하지 못한다.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 평범한 객체(`{}` 리터럴)인지 — 클래스 인스턴스와 구분한다.
 *
 * 🔴 이 구분이 없으면 Firestore 특수 타입이 조용히 망가진다. `Timestamp`·`GeoPoint`·
 *    `DocumentReference`·`FieldValue`·`Date` 는 전부 클래스 인스턴스라, 무심코
 *    `Object.entries` 로 분해하면 `{seconds, nanoseconds}` 같은 **평범한 맵**이 되어 저장된다.
 *    에러도 안 나고, 나중에 읽을 때가 되어서야 "날짜 자리에 객체가 들어있다"로 드러난다.
 *    Firestore 에서 읽은 문서를 다시 쓰는 경로(draft → publish)에서 실제로 위험하다.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Firestore 저장 전 undefined 필드 재귀 제거 (null 은 보존 — Firestore 허용).
 * 🔴 Firestore setDoc 은 undefined 값을 거부(throw)한다. 폼에서 "값을 비웠다"가
 *    `undefined` 로 표현되는 코드(`value ? Number(value) : undefined`)는 매우 흔하므로,
 *    사용자 입력을 받아 저장하는 모든 경로는 이 함수를 통과해야 한다.
 *
 * 평범한 객체와 배열만 파고든다 — Timestamp·FieldValue 등 특수 타입은 그대로 통과시킨다.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
