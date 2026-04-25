// Firestore tour_availability/{tourId}/{YYYY-MM-DD} CRUD wrapper.
// 가용성 상태: 'available' (default) | 'fully_booked' | 'blackout'.
// 운영자 admin 페이지에서 set/clear, 클라이언트(UI)는 fetchMonthAvailability 로 한달치 한 번에 조회.
import {
  doc,
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
