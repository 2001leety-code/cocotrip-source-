/**
 * 서버 슬롯 정원 재확인 — slotCapacity 클라이언트 신뢰 제거 (2026-08-08).
 *
 * 🔴 고친 문제
 *   - #1255(단건)·#1257(장바구니)가 배선한 슬롯 정원 잠금은 capacity 를 **클라이언트 body**
 *     (`slotCapacity`)에서 받았다 — 두 경로 공통 신뢰모델(당시 주석에 알려진 한계로 명시).
 *     정원을 부풀린 요청(예: capacity=999)은 서버가 못 막았다 = 오버부킹 재개 가능.
 *   - 금액은 무관 — 가격은 전부 서버 SSOT 재계산(P311). 조작 가능한 건 정원 카운터뿐이었다.
 *
 * 수리
 *   - `fetchServerSlotCapacity` 가 상품 원본 `tours/{tourId}` 문서의 `slots[]` 배열에서
 *     정원을 재조회한다(어드민 상품 등록이 쓰는 곳 — 서브컬렉션 저장은 구현된 곳이 없다).
 *   - capacity 미설정 슬롯 = tour.maxPax 폴백 (slot-capacity.js 헤더·validateSlotNumeric 의
 *     기존 문서화 규칙 그대로).
 *   - 결정적 검증 실패(투어/슬롯 없음·꺼짐·정원 미설정) = {ok:false, code} — 호출자는
 *     fail-closed(주문 불성립). Firestore 읽기 장애는 throw 전파 — 호출자가 body 값 후퇴
 *     (오늘까지의 신뢰모델보다 나빠지지 않게)를 결정한다.
 *   - 호출부 = createPaypalOrder.js + createCartOrder.js **동시**(한쪽만 고침 금지 —
 *     이 레포 반복 사고 패턴 7회). 배선 검증은 각 경로의 wiring 테스트 파일에 있다.
 */
import { describe, it, expect } from 'vitest';
import { fetchServerSlotCapacity } from '../../api/_shared/slot-capacity.js';

/** Firestore Admin 대역 — doc(path).get() 만 필요 (트랜잭션 불필요한 읽기 전용 헬퍼). */
function makeTourDb(docs: Record<string, Record<string, unknown> | undefined>) {
  return {
    doc: (path: string) => ({
      get: async () => {
        const cur = docs[path];
        return { exists: cur !== undefined, data: () => structuredClone(cur || {}) };
      },
    }),
  };
}

const TOUR_ID = 'tour-seoul-city';
const PATH = `tours/${TOUR_ID}`;
const baseTour = {
  maxPax: 7,
  slots: [
    { id: 'slot_am', start_time: '09:00', capacity: 8, is_active: true },
    { id: 'slot_pm', start_time: '14:00', is_active: true },
  ],
};

function call(tour: Record<string, unknown> | undefined, slotId: string) {
  return fetchServerSlotCapacity({
    adminDb: makeTourDb({ [PATH]: tour }),
    tourId: TOUR_ID,
    slotId,
  });
}

describe('fetchServerSlotCapacity — 정원 원본 조회', () => {
  it('슬롯에 capacity 가 있으면 그 값 (body 가 뭐라 했든 무관)', async () => {
    await expect(call(baseTour, 'slot_am')).resolves.toEqual({ ok: true, capacity: 8 });
  });

  it('슬롯 capacity 미설정이면 tour.maxPax 폴백 (문서화된 기존 규칙 유지)', async () => {
    await expect(call(baseTour, 'slot_pm')).resolves.toEqual({ ok: true, capacity: 7 });
  });

  it('capacity 0·음수는 값이 아니다 → maxPax 폴백 (0 = 전원 차단 사고 방지)', async () => {
    const tour = { ...baseTour, slots: [{ id: 'slot_am', start_time: '09:00', capacity: 0, is_active: true }] };
    await expect(call(tour, 'slot_am')).resolves.toEqual({ ok: true, capacity: 7 });
    const tour2 = { ...baseTour, slots: [{ id: 'slot_am', start_time: '09:00', capacity: -3, is_active: true }] };
    await expect(call(tour2, 'slot_am')).resolves.toEqual({ ok: true, capacity: 7 });
  });

  it('문자열 숫자도 받는다 (Firestore 왕복 형 변화 방어 — readSlotFields 와 같은 이유)', async () => {
    const tour = { maxPax: '7', slots: [{ id: 'slot_am', start_time: '09:00', capacity: '6', is_active: true }] };
    await expect(call(tour, 'slot_am')).resolves.toEqual({ ok: true, capacity: 6 });
  });
});

describe('fetchServerSlotCapacity — 결정적 검증 실패 = fail-closed 코드', () => {
  it('투어 문서가 없으면 SLOT_TOUR_NOT_FOUND (위조 tourId / 삭제된 투어)', async () => {
    await expect(call(undefined, 'slot_am')).resolves.toEqual({ ok: false, code: 'SLOT_TOUR_NOT_FOUND' });
  });

  it('slots 에 없는 slotId 면 SLOT_NOT_IN_TOUR (위조 슬롯)', async () => {
    await expect(call(baseTour, 'slot_ghost')).resolves.toEqual({ ok: false, code: 'SLOT_NOT_IN_TOUR' });
  });

  it('slots 배열 자체가 없어도 SLOT_NOT_IN_TOUR (슬롯 없는 투어에 슬롯 필드를 위조)', async () => {
    await expect(call({ maxPax: 7 }, 'slot_am')).resolves.toEqual({ ok: false, code: 'SLOT_NOT_IN_TOUR' });
  });

  it('is_active=false 슬롯은 SLOT_INACTIVE (헤더의 "pre-lock 자체 거부" 규칙을 실제로 강제)', async () => {
    const tour = { ...baseTour, slots: [{ id: 'slot_am', start_time: '09:00', capacity: 8, is_active: false }] };
    await expect(call(tour, 'slot_am')).resolves.toEqual({ ok: false, code: 'SLOT_INACTIVE' });
  });

  it('capacity 도 maxPax 도 없으면 SLOT_CAPACITY_UNSET (정직한 클라는 이 상태에서 4필드를 안 보낸다)', async () => {
    const tour = { slots: [{ id: 'slot_am', start_time: '09:00', is_active: true }] };
    await expect(call(tour, 'slot_am')).resolves.toEqual({ ok: false, code: 'SLOT_CAPACITY_UNSET' });
    const tour2 = { maxPax: 0, slots: [{ id: 'slot_am', start_time: '09:00', capacity: 0, is_active: true }] };
    await expect(call(tour2, 'slot_am')).resolves.toEqual({ ok: false, code: 'SLOT_CAPACITY_UNSET' });
  });
});

describe('fetchServerSlotCapacity — Firestore 장애는 전파', () => {
  it('읽기 실패는 그대로 throw — 호출자가 body 값 후퇴 여부를 결정한다', async () => {
    const brokenDb = {
      doc: () => ({
        get: async () => {
          throw new Error('UNAVAILABLE: firestore down');
        },
      }),
    };
    await expect(
      fetchServerSlotCapacity({ adminDb: brokenDb, tourId: TOUR_ID, slotId: 'slot_am' }),
    ).rejects.toThrow('UNAVAILABLE');
  });
});
