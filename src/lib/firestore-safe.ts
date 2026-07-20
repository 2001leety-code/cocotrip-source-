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
 * Firestore 저장 전 undefined 필드 재귀 제거 (null 은 보존 — Firestore 허용).
 * 🔴 Firestore setDoc 은 undefined 값을 거부(throw)한다. 폼에서 "값을 비웠다"가
 *    `undefined` 로 표현되는 코드(`value ? Number(value) : undefined`)는 매우 흔하므로,
 *    사용자 입력을 받아 저장하는 모든 경로는 이 함수를 통과해야 한다.
 * ⚠️ serverTimestamp() 등 FieldValue 는 strip 후 호출부에서 별도로 부착할 것
 *    (FieldValue 는 클래스 인스턴스라 여기서 평범한 객체로 분해되면 안 된다).
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
