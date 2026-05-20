// Firestore tour_availability/{tourId}/{YYYY-MM-DD} CRUD wrapper.
// 가용성 상태: 'available' (default) | 'fully_booked' | 'blackout'.
// 운영자 admin 페이지에서 set/clear, 클라이언트(UI)는 fetchMonthAvailability 로 한달치 한 번에 조회.
//
// P108 (2026-05-20): TourSlot 별 잔여석 (slot_bookings / slot_pending) 조회 헬퍼
// 추가. SlotPicker 가 "정원 7 (잔여 3)" UX 표시 + 마감 슬롯 비활성화.
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type AvailabilityStatus = 'available' | 'fully_booked' | 'blackout';

export type AvailabilityEntry = {
  tourId: string;
  date: string;       // YYYY-MM-DD
  status: AvailabilityStatus;
  note?: string;      // admin 메모
  updatedAt?: number; // serverTimestamp on write
  // P108: 슬롯별 카운터 (모두 optional, 슬롯 미사용 투어는 누락).
  slot_bookings?: Record<string, number>;
  slot_pending?: Record<string, { count: number; expiresAt: string; orderId?: string | null }>;
};

/** P108: 슬롯 capacity 정보 — SlotPicker 가 잔여석 표시 + 마감 차단에 사용. */
export type SlotCapacityEntry = {
  /** 결제 확정 인원. */
  booked: number;
  /** 결제 진행 중인 (10분 TTL) 인원. UX 상 "선점 중" 으로 표시 가능. */
  pending: number;
  /** 총 점유 = booked + pending (만료 제외). */
  total: number;
};

function entryDocPath(tourId: string, date: string) {
  return doc(db, 'tour_availability', tourId, 'dates', date);
}

/** 단일 일자 가용성 set (운영자 admin 액션). status='available'은 doc 삭제로 처리. */
export async function setAvailability(tourId: string, date: string, status: AvailabilityStatus, note?: string): Promise<void> {
  if (status === 'available') {
    // default 상태는 doc 삭제로 표현 — 데이터 절약
    await deleteDoc(entryDocPath(tourId, date)).catch(() => undefined);
    return;
  }
  await setDoc(entryDocPath(tourId, date), {
    tourId,
    date,
    status,
    note: note || '',
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** 한 달치 가용성 일괄 조회 (UI 캘린더용). 비어있는 날짜는 default available. */
export async function fetchMonthAvailability(tourId: string, yearMonth: string): Promise<Map<string, AvailabilityEntry>> {
  // yearMonth: 'YYYY-MM'
  const start = `${yearMonth}-01`;
  const end = `${yearMonth}-31`;
  const q = query(
    collection(db, 'tour_availability', tourId, 'dates'),
    where('date', '>=', start),
    where('date', '<=', end),
  );
  const snap = await getDocs(q);
  const map = new Map<string, AvailabilityEntry>();
  snap.forEach(d => {
    const data = d.data() as AvailabilityEntry;
    map.set(data.date, data);
  });
  return map;
}

/**
 * 슬롯별 잔여 capacity 조회 (P108). 반환 맵은 slot id 키. 슬롯별 entry 가 없으면
 * (slot 사용 첫 결제 전) 빈 맵 반환 — caller 는 "0 booked / capacity" 로 처리.
 *
 * 만료된 pending (cron sweep 직전 상태) 은 클라이언트 단에서도 제외하므로 UI
 * 표시가 prematurely "마감" 처리되지 않음.
 */
export async function fetchSlotCapacity(
  tourId: string,
  date: string,
): Promise<Map<string, SlotCapacityEntry>> {
  const result = new Map<string, SlotCapacityEntry>();
  try {
    const snap = await getDoc(doc(db, 'tour_availability', tourId, 'dates', date));
    if (!snap.exists()) return result;
    const data = snap.data() as AvailabilityEntry;
    const now = Date.now();
    const allSlotIds = new Set<string>([
      ...Object.keys(data.slot_bookings ?? {}),
      ...Object.keys(data.slot_pending ?? {}),
    ]);
    for (const slotId of allSlotIds) {
      const booked = Number(data.slot_bookings?.[slotId] ?? 0);
      const rawPending = data.slot_pending?.[slotId];
      const expiresMs = rawPending?.expiresAt ? Date.parse(rawPending.expiresAt) : NaN;
      const activePending = rawPending && Number.isFinite(expiresMs) && expiresMs > now
        ? Number(rawPending.count ?? 0)
        : 0;
      result.set(slotId, { booked, pending: activePending, total: booked + activePending });
    }
  } catch (err) {
    console.warn('[tour-availability-store] fetchSlotCapacity failed:', err);
  }
  return result;
}

/** 단일 일자 비활성 여부 (Firestore + mock fallback). */
export async function isUnavailable(tourId: string, date: string): Promise<{ unavailable: boolean; reason?: AvailabilityStatus }> {
  try {
    const month = date.slice(0, 7);
    const map = await fetchMonthAvailability(tourId, month);
    const entry = map.get(date);
    if (!entry) return { unavailable: false };
    if (entry.status === 'fully_booked' || entry.status === 'blackout') {
      return { unavailable: true, reason: entry.status };
    }
    return { unavailable: false };
  } catch {
    return { unavailable: false };
  }
}
