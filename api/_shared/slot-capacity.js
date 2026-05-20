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
//     slot_pending:  { [slotId]: { count, expiresAt: ISO, orderId } },
//   }
//
// SAFETY-CRITICAL:
//   - 모든 read-modify-write 는 runTransaction 안에서 (race condition 차단).
//   - slot.is_active=false 면 pre-lock 자체 거부.
//   - capacity null/undefined 면 tour.maxPax fallback.
//   - 이 헬퍼는 tourSlotId 가 명시된 흐름에만 호출 — AI 플래너/charter 등
//     슬롯 없는 상품은 기존 흐름 그대로 (호출자가 분기 책임).
// ─────────────────────────────────────────────────────────────────────────────

const PENDING_TTL_MS = 10 * 60 * 1000; // 10분 — PayPal capture 평균 + safety margin

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
 * confirmed + 유효(non-expired) pending 합산 — capacity 비교 기준.
 * @param {object} data       availability doc data
 * @param {string} slotId
 * @param {number} now
 * @returns {{ confirmed: number, pending: number, total: number }}
 */
export function summarizeSlot(data, slotId, now = Date.now()) {
  const confirmed = Number(data?.slot_bookings?.[slotId] ?? 0);
  const rawPending = data?.slot_pending?.[slotId];
  if (!rawPending || isPendingExpired(rawPending, now)) {
    return { confirmed, pending: 0, total: confirmed };
  }
  const pending = Number(rawPending.count ?? 0);
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
 * @param {number} args.capacity    슬롯 정원 (tour.slots[].capacity ?? tour.maxPax)
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
    const existingPending = slotPending[slotId];
    // pending 합산: 만료된 기존 lock 은 무시 (덮어쓰기), 유효하면 누적.
    const baseCount = existingPending && !isPendingExpired(existingPending, nowMs)
      ? Number(existingPending.count ?? 0)
      : 0;
    slotPending[slotId] = {
      count: baseCount + pax,
      expiresAt: new Date(nowMs + PENDING_TTL_MS).toISOString(),
      orderId: orderId || existingPending?.orderId || null,
    };

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

    const confirmed = Number(data.slot_bookings?.[slotId] ?? 0);

    // 만료된 pending 또는 다른 orderId pending 이라면 capacity 재검증.
    // 같은 orderId pending (정상 흐름) 이면 lock 안의 pax 가 우리 것이라
    // capacity check 무조건 통과 — confirmed += pax + pending -= pax.
    const rawPending = data.slot_pending?.[slotId];
    const ourPending = rawPending
      && rawPending.orderId === orderId
      && !isPendingExpired(rawPending, nowMs);

    if (!ourPending) {
      // lock 잃었음 — 재검증.
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

    const slotPending = { ...(data.slot_pending || {}) };
    if (ourPending) {
      const remaining = Math.max(0, Number(rawPending.count ?? pax) - pax);
      if (remaining > 0) {
        slotPending[slotId] = { ...rawPending, count: remaining };
      } else {
        delete slotPending[slotId];
      }
    }

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
    let swept = 0;
    const next = {};
    for (const [slotId, entry] of Object.entries(rawPending)) {
      if (isPendingExpired(entry, nowMs)) {
        swept += 1;
        continue;
      }
      next[slotId] = entry;
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
