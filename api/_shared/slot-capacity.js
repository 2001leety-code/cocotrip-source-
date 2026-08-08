// ─────────────────────────────────────────────────────────────────────────────
// slot-capacity.js — TourSlot 별 잔여석 잠금 헬퍼 (Phase 2, 2026-05-20)
//
// 정책:
//   1. createPaypalOrder.js 가 acquireSlotLock 으로 pending 카운터 +pax 증가.
//      capacity 초과 시 throw SLOT_FULL → PayPal order 생성 자체 차단.
//   2. capturePaypalOrder.js 가 confirmSlotLock 으로 pending → confirmed 전환.
//      timeout 으로 pending 잃은 경우 (cron sweep 이 이미 reverted) capacity
//      재검증 → 여유 있으면 confirmed 만 +pax.
//   3. _crons/slot-pending-sweep.js 가 10분 이상 묵힌 pending 을 lock 해제.
//      bookings/{id} 가 status='confirmed' 가 아니면 revert.
//
// 데이터 위치: tour_availability/{tourId}/dates/{date}
//   {
//     tourId, date, status,
//     slot_bookings: { [slotId]: confirmedCount },  // optional, P106
//     slot_pending:  { [slotId]: { [orderId]: { count, expiresAt: ISO } } },  // 버그#18 후 orderId 별 엔트리
//   }
//
// 버그 #18 (2026-06-14) 회계 누수 수정:
//   기존 구조 slot_pending[slotId] = { count, expiresAt, orderId } 는 한 슬롯에
//   여러 주문이 들어오면 count 는 누적되지만 orderId 는 마지막 주문만 보존 →
//   먼저 capture 하는 주문의 orderId 가 불일치 → pending 미차감 → pax 영구 잔류
//   → 후속 예약 SLOT_FULL 오차단(매출손실). 해결: orderId 별 엔트리로 구조화
//   (slot_pending[slotId] = { [orderId]: { count, expiresAt } }) → acquire/
//   confirm/sweep/summarize 가 주문별로 정확히 가감. 하위호환: 읽을 때 옛 단일
//   엔트리(count/expiresAt/orderId 보유)도 정규화하여 처리.
//
// SAFETY-CRITICAL:
//   - 모든 read-modify-write 는 runTransaction 안에서 (race condition 차단).
//   - slot.is_active=false 면 pre-lock 자체 거부.
//   - capacity null/undefined 면 tour.maxPax fallback.
//   - 이 헬퍼는 tourSlotId 가 명시된 흐름에만 호출 — AI 플래너/charter 등
//     슬롯 없는 상품은 기존 흐름 그대로 (호출자가 분기 책임).
// ─────────────────────────────────────────────────────────────────────────────

const PENDING_TTL_MS = 10 * 60 * 1000; // 10분 — PayPal capture 평균 + safety margin

// 하위호환: orderId 없는 옛 단일 엔트리를 식별하는 합성 키. acquire 가 새로
// 쓰는 엔트리는 항상 실제(또는 PRELOCK) orderId 키를 사용하므로 충돌 없음.
const LEGACY_ENTRY_KEY = '__legacy__';

/**
 * pending 항목이 expired 인지 확인. expiresAt 미설정/잘못된 값은 expired 로 간주.
 * @param {{ expiresAt?: string, count?: number } | undefined} entry
 * @param {number} now
 * @returns {boolean}
 */
export function isPendingExpired(entry, now = Date.now()) {
  if (!entry) return true;
  const exp = entry.expiresAt ? Date.parse(entry.expiresAt) : NaN;
  if (!Number.isFinite(exp)) return true;
  return exp <= now;
}

/**
 * slot_pending[slotId] 값을 orderId→{count,expiresAt} 맵으로 정규화.
 *
 * 🔴 옛 구조와 신 구조는 **배타적이지 않다** — 한 맵에 섞인 hybrid 가 정상 상태다.
 *   Firestore set(...,{merge:true}) 는 중첩 맵 키를 지울 수 없어(같은 파일
 *   releaseSlotLock 헤더), 옛 단일 엔트리가 있던 슬롯에 신규 orderId 엔트리를 쓰면
 *   루트 스칼라(count/expiresAt/orderId)와 orderId 키가 공존한다.
 *   어느 한쪽만 읽으면 두 방향으로 다 틀린다:
 *     - 옛 루트만 읽으면 신규 pending 이 안 보여 **과소집계 = 오버부킹**
 *     - 신규만 읽으면 옛 루트가 안 지워져 **오차단(매출손실)**
 *   → 값이 객체인 키는 orderId 엔트리로, 루트 스칼라는 엔트리 하나로 **둘 다** 읽는다.
 *
 * 옛 엔트리 키: 루트 orderId 가 있으면 그 이름, 없으면 LEGACY_ENTRY_KEY.
 * 🔴 **같은 키의 nested 엔트리가 이미 있으면 그쪽이 권위** — 둘은 같은 논리 잠금 하나다.
 *   (구버전 acquire 가 옛 루트를 정규화해 nested 로 다시 쓰면서 merge 가 루트를 남긴 결과.
 *   acquire 재시도로 nested count 가 루트보다 커졌을 수 있어 max/sum 이 아니라 **대체**다.
 *   합산하면 한 주문 좌석을 두 번 세어 정원이 조기 소진된다.)
 *   키가 다르면(= 다른 주문) 둘 다 보존한다.
 * 입력 미존재/형태 불명은 빈 맵.
 *
 * @param {*} slotPendingForSlot   slot_pending[slotId] 원본
 * @returns {Record<string, { count: number, expiresAt?: string }>}
 */
export function normalizeSlotPendingEntry(slotPendingForSlot) {
  if (!slotPendingForSlot || typeof slotPendingForSlot !== 'object') return {};
  const out = {};
  // 신 구조: 값이 객체인 키 = orderId 별 엔트리.
  for (const [k, v] of Object.entries(slotPendingForSlot)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v;
  }
  // 옛 구조: 루트가 count/expiresAt 를 직접 보유(=값이 숫자/문자열).
  if (typeof slotPendingForSlot.count === 'number' || typeof slotPendingForSlot.expiresAt === 'string') {
    const key = typeof slotPendingForSlot.orderId === 'string' && slotPendingForSlot.orderId
      ? slotPendingForSlot.orderId
      : LEGACY_ENTRY_KEY;
    // 같은 키의 nested = 같은 잠금의 최신 사본 → 루트는 버린다(합산 금지).
    if (!out[key]) {
      out[key] = {
        count: Number(slotPendingForSlot.count || 0),
        expiresAt: slotPendingForSlot.expiresAt,
      };
    }
  }
  return out;
}

/**
 * 쓰기 직전 옛 단일 엔트리의 **루트 스칼라(count/expiresAt)를 만료 처리**해 무력화한다.
 *
 * 왜 필요한가 — acquire/confirm/sweep 은 모두 슬롯의 pending 을 orderId 별 엔트리로
 * 다시 써낸다. Firestore merge 는 루트 스칼라를 지울 수 없으므로(releaseSlotLock 헤더)
 * 그대로 두면 **같은 좌석이 루트와 orderId 엔트리 양쪽에서 두 번** 세어진다.
 * 잔여 pending 은 항상 orderId 엔트리 쪽에 실려 나가므로 여기서 잃는 좌석은 없다.
 *
 * 루트가 없던(신 구조) 슬롯은 그대로 둔다 — 불필요한 스칼라를 새로 만들지 않는다.
 *
 * @param {*} rawSlotValue   읽어온 slot_pending[slotId] 원본
 * @param {Record<string, object>} nextEntries  써낼 orderId 엔트리 맵 (제자리 변경)
 * @param {number} nowMs
 * @returns {Record<string, object>} nextEntries
 */
function neutralizeLegacyRoot(rawSlotValue, nextEntries, nowMs) {
  if (!rawSlotValue || typeof rawSlotValue !== 'object') return nextEntries;
  if (typeof rawSlotValue.count !== 'number' && typeof rawSlotValue.expiresAt !== 'string') return nextEntries;
  nextEntries.count = 0;
  nextEntries.expiresAt = new Date(nowMs - 1000).toISOString();
  return nextEntries;
}

/**
 * 한 슬롯의 유효(non-expired) pending pax 합산. orderId 별 엔트리 전부 합산하며
 * 옛 단일 엔트리도 normalizeSlotPendingEntry 로 동일 처리.
 * @param {*} slotPendingForSlot   slot_pending[slotId] 원본
 * @param {number} now
 * @returns {number}
 */
function sumActivePending(slotPendingForSlot, now) {
  const entries = normalizeSlotPendingEntry(slotPendingForSlot);
  let total = 0;
  for (const entry of Object.values(entries)) {
    if (isPendingExpired(entry, now)) continue;
    total += Number(entry?.count || 0);
  }
  return total;
}

/**
 * confirmed + 유효(non-expired) pending 합산 — capacity 비교 기준.
 * pending 은 슬롯의 모든 주문별 엔트리 합(버그#18). 옛 단일 엔트리도 동일 처리.
 * @param {object} data       availability doc data
 * @param {string} slotId
 * @param {number} now
 * @returns {{ confirmed: number, pending: number, total: number }}
 */
export function summarizeSlot(data, slotId, now = Date.now()) {
  const confirmed = Number(data?.slot_bookings?.[slotId] || 0);
  const pending = sumActivePending(data?.slot_pending?.[slotId], now);
  return { confirmed, pending, total: confirmed + pending };
}

/**
 * 슬롯 pre-lock — capacity 검증 + slot_pending 증가. Firestore runTransaction
 * 안에서 호출. 실패 시 throw (호출자가 catch → 400).
 *
 * @param {object} args
 * @param {object} args.adminDb     Firestore Admin instance
 * @param {string} args.tourId
 * @param {string} args.date        YYYY-MM-DD
 * @param {string} args.slotId
 * @param {number} args.pax         예약 인원
 * @param {number} args.capacity    슬롯 정원 (tour.slots[].capacity 또는 tour.maxPax)
 * @param {string} args.orderId     PayPal order id (또는 pre-PayPal 식별자)
 * @param {Date}   [args.now]       (테스트용)
 * @returns {Promise<{ ok: true, remaining: number }>}
 * @throws  Error { code: 'SLOT_FULL'|'SLOT_INVALID_PAX' }
 */
export async function acquireSlotLock({ adminDb, tourId, date, slotId, pax, capacity, orderId, now }) {
  if (!Number.isFinite(pax) || pax <= 0) {
    const e = new Error(`Invalid pax: ${pax}`);
    e.code = 'SLOT_INVALID_PAX';
    throw e;
  }
  const nowMs = (now instanceof Date ? now.getTime() : Date.now());
  const ref = adminDb.doc(`tour_availability/${tourId}/dates/${date}`);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : { tourId, date, status: 'available' };

    // status 'fully_booked'/'blackout' 인 일자는 슬롯 무관 차단.
    if (data.status === 'fully_booked' || data.status === 'blackout') {
      const e = new Error(`Date ${date} is ${data.status}`);
      e.code = 'DATE_UNAVAILABLE';
      throw e;
    }

    const summary = summarizeSlot(data, slotId, nowMs);
    if (summary.total + pax > capacity) {
      const e = new Error(
        `Slot full: requested=${pax}, confirmed=${summary.confirmed}, pending=${summary.pending}, capacity=${capacity}`,
      );
      e.code = 'SLOT_FULL';
      throw e;
    }

    const slotPending = { ...(data.slot_pending || {}) };
    // 버그#18: 슬롯의 pending 을 orderId 별 엔트리 맵으로 정규화(옛 단일 엔트리도
    // 처리). 만료된 엔트리는 신규 acquire 기회에 정리(드리프트 방지). 그 후 이
    // 주문의 orderId 키에만 +pax — 다른 주문 pending 을 덮어쓰지 않음.
    const entries = normalizeSlotPendingEntry(slotPending[slotId]);
    const nextEntries = {};
    for (const [eid, entry] of Object.entries(entries)) {
      if (!isPendingExpired(entry, nowMs)) nextEntries[eid] = entry;
    }
    const key = orderId || LEGACY_ENTRY_KEY;
    const baseCount = nextEntries[key] && !isPendingExpired(nextEntries[key], nowMs)
      ? Number(nextEntries[key].count || 0)
      : 0;
    nextEntries[key] = {
      count: baseCount + pax,
      expiresAt: new Date(nowMs + PENDING_TTL_MS).toISOString(),
    };
    slotPending[slotId] = neutralizeLegacyRoot(slotPending[slotId], nextEntries, nowMs);

    tx.set(ref, {
      tourId,
      date,
      status: data.status || 'available',
      slot_pending: slotPending,
      updatedAt: new Date(nowMs).toISOString(),
    }, { merge: true });

    return { ok: true, remaining: capacity - (summary.total + pax) };
  });
}

/**
 * 슬롯 capture confirm — pending → confirmed 전환. capture endpoint 가 PayPal
 * order capture 성공 후 호출. pending 만료된 경우 (cron sweep 이 reverted) 도
 * capacity 재검증 후 confirmed 만 +pax (lock 없이도 동작; 일관성 우선).
 *
 * @param {object} args  same shape as acquireSlotLock + paxConfirmed
 * @returns {Promise<{ ok: true, confirmed: number }>}
 * @throws  Error { code: 'SLOT_FULL_AT_CAPTURE' } (드물지만 lock 만료 + 다른 confirmed 가 채워졌을 때)
 */
export async function confirmSlotLock({ adminDb, tourId, date, slotId, pax, capacity, orderId, now }) {
  if (!Number.isFinite(pax) || pax <= 0) {
    const e = new Error(`Invalid pax: ${pax}`);
    e.code = 'SLOT_INVALID_PAX';
    throw e;
  }
  const nowMs = (now instanceof Date ? now.getTime() : Date.now());
  const ref = adminDb.doc(`tour_availability/${tourId}/dates/${date}`);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : { tourId, date, status: 'available' };

    const confirmed = Number(data.slot_bookings?.[slotId] || 0);

    // 버그#18: slot_pending 을 orderId 별 엔트리로 정규화(옛 단일 엔트리도 처리).
    const rawSlotPending = data.slot_pending?.[slotId];
    const entries = normalizeSlotPendingEntry(rawSlotPending);
    const myKey = orderId || LEGACY_ENTRY_KEY;
    const myEntry = entries[myKey];
    // 우리 lock = 같은 orderId 키의 유효 pending. 이 경로면 우리 pax 가 이미
    // pending 에 포함돼 있어 capacity check 무조건 통과 — confirmed += pax 하고
    // 우리 엔트리만 -pax(주문별 격리 → 다른 주문 pending 잔류 누수 방지).
    const ourPending = !!myEntry && !isPendingExpired(myEntry, nowMs);

    if (!ourPending) {
      // lock 잃었음(만료/sweep) 또는 orderId 키 불일치(정상 PRELOCK 흐름:
      // acquire 는 PRELOCK-* 키, capture 는 실제 PayPal orderId) — 재검증.
      // 기존 동작 보존: confirmed + pax 만으로 capacity 판정.
      if (confirmed + pax > capacity) {
        const e = new Error(
          `Slot full at capture: confirmed=${confirmed}, pax=${pax}, capacity=${capacity}`,
        );
        e.code = 'SLOT_FULL_AT_CAPTURE';
        throw e;
      }
    }

    const newConfirmed = confirmed + pax;
    const slotBookings = { ...(data.slot_bookings || {}) };
    slotBookings[slotId] = newConfirmed;

    // pending 차감(버그#18 회계 누수 핵심):
    //   - ourPending: 우리 orderId 엔트리에서만 -pax.
    //   - 키 불일치(PRELOCK 정상 흐름 등): 만료 엔트리는 정리하고, 활성 pending
    //     에서 pax 만큼 소비(만료 임박 순) → PRELOCK pending 이 confirmed 로
    //     전환되며 영구 잔류하지 않게 함.
    const nextEntries = {};
    for (const [eid, entry] of Object.entries(entries)) {
      if (!isPendingExpired(entry, nowMs)) nextEntries[eid] = { ...entry };
    }
    if (ourPending) {
      const remaining = Math.max(0, Number(nextEntries[myKey].count || 0) - pax);
      if (remaining > 0) nextEntries[myKey].count = remaining;
      else delete nextEntries[myKey];
    } else {
      // 활성 pending 을 만료 임박 순(가장 오래된 lock 먼저)으로 pax 소비.
      let toConsume = pax;
      const ordered = Object.entries(nextEntries).sort(
        (a, b) => Date.parse(a[1].expiresAt || '') - Date.parse(b[1].expiresAt || ''),
      );
      for (const [eid, entry] of ordered) {
        if (toConsume <= 0) break;
        const take = Math.min(toConsume, Number(entry.count || 0));
        const left = Number(entry.count || 0) - take;
        toConsume -= take;
        if (left > 0) nextEntries[eid].count = left;
        else delete nextEntries[eid];
      }
    }

    // 🔴 소비한 엔트리는 **지우는 게 아니라 만료 표시로 덮어야** 실제로 사라진다.
    //   Firestore `set(..., {merge:true})` 는 중첩 맵을 깊게 병합하므로 JS 객체에서 키를 빼도
    //   문서에서는 그대로 남는다(releaseSlotLock 헤더가 문서화한 같은 성질). 그냥 지우면
    //   confirm 한 pax 가 pending 에 남아 TTL 10분 동안 같은 좌석을 두 번 세고, 남은 정원이
    //   있는데도 다음 손님이 SLOT_FULL 로 오차단된다(버그#18 과 같은 계열의 매출손실).
    //   count 0 + 과거 expiresAt = summarizeSlot 이 즉시 0 으로 센다. 실제 키 제거는 불필요.
    const tombstoneExpiresAt = new Date(nowMs - 1000).toISOString();
    for (const eid of Object.keys(entries)) {
      if (!nextEntries[eid]) nextEntries[eid] = { count: 0, expiresAt: tombstoneExpiresAt };
    }
    // 옛 단일 엔트리는 orderId 키가 아니라 **루트 스칼라**로 앉아 있다 — 위 tombstone 은
    //   중첩 키만 덮으므로 루트는 살아남아 오차단이 계속된다. 루트도 같이 만료 처리.
    const slotPending = { ...(data.slot_pending || {}) };
    slotPending[slotId] = neutralizeLegacyRoot(rawSlotPending, nextEntries, nowMs);

    tx.set(ref, {
      tourId,
      date,
      status: data.status || 'available',
      slot_bookings: slotBookings,
      slot_pending: slotPending,
      updatedAt: new Date(nowMs).toISOString(),
    }, { merge: true });

    return { ok: true, confirmed: newConfirmed };
  });
}

/**
 * 잠금 인자 추출 — 라인/주문 booking 객체에서 tourId·tourSlotId·bookingDate·slotCapacity·
 * passengers 를 **전부 갖췄을 때만** 돌려준다. 하나라도 없으면 null = 잠금 스킵
 * (슬롯 없는 상품 = AI 플래너·차터 보호. 위 SAFETY-CRITICAL "호출자가 분기 책임" 규칙).
 *
 * 반쪽 잠금을 만들지 않는 이유는 프론트 `src/lib/tourSlotBooking.ts` 헤더와 같다 —
 * 정원 강제가 안 걸린 상태를 만들면서 아무 신호도 안 남긴다.
 *
 * Firestore 스냅샷을 왕복한 값이 문자열로 돌아올 수 있어 Number() 로 받되,
 * 0·음수·NaN 은 값이 아니다(capacity 0 = 전원 차단, pax 0 = 잠금 무의미).
 *
 * @param {object|null|undefined} booking
 * @returns {{tourId:string, date:string, slotId:string, capacity:number, pax:number}|null}
 */
export function readSlotFields(booking) {
  if (!booking || typeof booking !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const pos = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const tourId = str(booking.tourId);
  const slotId = str(booking.tourSlotId);
  const date = str(booking.bookingDate);
  const capacity = pos(booking.slotCapacity);
  const pax = pos(booking.passengers);
  if (!tourId || !slotId || !date || !capacity || !pax) return null;
  return { tourId, date, slotId, capacity, pax };
}

/**
 * 서버 슬롯 정원 재확인 (2026-08-08) — body/카트 스냅샷의 `slotCapacity` 는 클라이언트
 * 출처라 신뢰하지 않는다(부풀린 정원 = SLOT_FULL 무력화 = 오버부킹). 원본 =
 * `tours/{tourId}` 문서의 `slots[]` 배열(어드민 상품 등록이 쓰는 곳 — tours.ts 의
 * "서브컬렉션 저장 가능" 주석은 구현된 곳이 없다). capacity 미설정/0/음수 슬롯은
 * tour.maxPax 폴백 — 이 파일 헤더와 validateSlotNumeric 이 문서화한 기존 규칙 그대로.
 *
 * 반환 계약:
 *   - { ok:true, capacity }  — 검증된 정원. 호출자는 이 값으로만 잠근다.
 *   - { ok:false, code }     — 결정적 검증 실패(위조 tourId/slotId·꺼진 슬롯·정원 미설정).
 *     정직한 클라이언트는 같은 tours 문서에서 4필드를 만들었으므로 이 상태를 만들지
 *     않는다 → 호출자는 fail-closed(주문 불성립).
 *   - throw                  — Firestore 읽기 장애. 후퇴(기존 body 신뢰모델) 여부는
 *     호출자가 결정한다 — 여기서 삼키면 장애가 전량 거부로 둔갑한다.
 *
 * 문자열 숫자 허용은 readSlotFields 와 같은 이유(Firestore 왕복 형 변화).
 *
 * @param {{ adminDb: object, tourId: string, slotId: string }} args
 * @returns {Promise<{ok:true, capacity:number}|{ok:false, code:string}>}
 */
export async function fetchServerSlotCapacity({ adminDb, tourId, slotId }) {
  const snap = await adminDb.doc(`tours/${tourId}`).get();
  if (!snap.exists) return { ok: false, code: 'SLOT_TOUR_NOT_FOUND' };
  const tour = snap.data() || {};
  const slots = Array.isArray(tour.slots) ? tour.slots : [];
  const slot = slots.find((s) => s && typeof s === 'object' && s.id === slotId);
  if (!slot) return { ok: false, code: 'SLOT_NOT_IN_TOUR' };
  if (slot.is_active === false) return { ok: false, code: 'SLOT_INACTIVE' };
  const pos = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const capacity = pos(slot.capacity) || pos(tour.maxPax);
  if (!capacity) return { ok: false, code: 'SLOT_CAPACITY_UNSET' };
  return { ok: true, capacity };
}

/**
 * 잠금 해제 — 아직 결제로 이어지지 않는 게 확정된 pre-lock 을 되돌린다.
 * 장바구니처럼 **여러 라인을 순차로 잡는 흐름**에서 뒷 라인이 SLOT_FULL 이면 앞 라인의
 * pending 이 남아 다른 손님을 10분간 오차단한다(버그#18 과 같은 계열의 매출손실).
 *
 * 구현 메모 — 엔트리를 지우는 대신 **만료 처리(count 0 + 과거 expiresAt)** 한다.
 *   Firestore `set(..., {merge:true})` 는 중첩 맵을 깊게 병합하므로 JS 객체에서 키를
 *   빼도 문서에서는 안 지워진다. 반면 만료 표시는 병합으로 확실히 덮이고,
 *   summarizeSlot 이 곧바로 0 으로 세며, 실제 삭제는 sweepExpiredPending(cron)이 맡는다.
 *   읽기가 필요 없는 상수 쓰기라 트랜잭션도 필요 없다(다른 주문 엔트리는 건드리지 않음).
 * 🔴 slot_bookings(확정석)은 절대 만지지 않는다 — 해제는 pending 전용.
 *
 * @param {object} args {adminDb, tourId, date, slotId, orderId, now?}
 * @returns {Promise<{ok:true}>}
 */
export async function releaseSlotLock({ adminDb, tourId, date, slotId, orderId, now }) {
  const nowMs = (now instanceof Date ? now.getTime() : Date.now());
  const key = orderId || LEGACY_ENTRY_KEY;
  await adminDb.doc(`tour_availability/${tourId}/dates/${date}`).set({
    slot_pending: {
      [slotId]: {
        [key]: { count: 0, expiresAt: new Date(nowMs - 1000).toISOString() },
      },
    },
    updatedAt: new Date(nowMs).toISOString(),
  }, { merge: true });
  return { ok: true };
}

/**
 * 만료된 pending 정리 (cron 호출). 한 doc 의 모든 slot_pending 을 검사,
 * expiresAt 지난 항목 제거. confirmed 는 영향 X.
 *
 * @param {object} args
 * @param {object} args.adminDb
 * @param {string} args.tourId
 * @param {string} args.date
 * @param {Date}   [args.now]
 * @returns {Promise<{ ok: true, swept: number }>}  swept = 제거된 slot 수
 */
export async function sweepExpiredPending({ adminDb, tourId, date, now }) {
  const nowMs = (now instanceof Date ? now.getTime() : Date.now());
  const ref = adminDb.doc(`tour_availability/${tourId}/dates/${date}`);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: true, swept: 0 };
    const data = snap.data();
    const rawPending = data.slot_pending || {};
    // 버그#18: slot_pending[slotId] 가 orderId 별 엔트리 맵이 됐으므로 슬롯
    // 단위가 아니라 orderId 엔트리 단위로 만료 검사. 옛 단일 엔트리도
    // normalizeSlotPendingEntry 로 동일 처리. swept = 만료된 엔트리(주문) 수.
    let swept = 0;
    const next = {};
    for (const [slotId, slotVal] of Object.entries(rawPending)) {
      const entries = normalizeSlotPendingEntry(slotVal);
      const kept = {};
      for (const [eid, entry] of Object.entries(entries)) {
        // count 0 = 이미 무력화된 만료 표시(confirm/release 가 남긴 것). 회수할 좌석이
        // 없으므로 swept 로 세지 않는다 — 세면 cron 이 매 tick 같은 doc 을 영구 재기록한다.
        if (!(Number(entry?.count || 0) > 0)) continue;
        if (isPendingExpired(entry, nowMs)) {
          swept += 1;
          continue;
        }
        kept[eid] = entry;
      }
      if (Object.keys(kept).length > 0) {
        // sweep 도 활성 엔트리를 orderId 키로 재방출한다 — 옛 루트를 남겨두면 같은
        // 좌석이 두 번 세어진다(confirm/acquire 와 같은 규칙).
        next[slotId] = neutralizeLegacyRoot(slotVal, kept, nowMs);
      }
    }
    if (swept === 0) return { ok: true, swept: 0 };

    tx.set(ref, {
      slot_pending: next,
      updatedAt: new Date(nowMs).toISOString(),
    }, { merge: true });
    return { ok: true, swept };
  });
}

export const SLOT_CAPACITY_INTERNAL = { PENDING_TTL_MS };
