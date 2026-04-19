// Plan editor hook — optimistic Firestore updates with rollback.
// Level 1 scope: same-day delete / add / reorder. No transit recalculation.
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface StopData {
  name: string;
  display_name: string;
  address: string;
  start_time: string;
  stay_min: number;
  category: string;
  entry_fee_krw: number;
  tip: string;
  _userAdded: boolean;
}

export function usePlanEditor(
  planId: string,
  plan: any,
  setPlan: (updater: (prev: any) => any) => void,
) {
  // Persist updated days array to Firestore
  async function commitDays(nextDays: any[], snapshot: any) {
    try {
      await updateDoc(doc(db, 'plans', planId), {
        'itinerary.days': nextDays,
        edited: true,
        lastEditedAt: Date.now(),
      });
    } catch (e) {
      console.error('[planEditor] Firestore write failed, rolling back:', e);
      setPlan(() => snapshot);
      throw e;
    }
  }

  // Mark transit as stale for stops adjacent to changes
  function markStale(stops: any[], affectedIdx: number) {
    // The stop AT affectedIdx and the one AFTER it get _stale
    if (stops[affectedIdx] && stops[affectedIdx].transit_from_prev) {
      stops[affectedIdx].transit_from_prev._stale = true;
    }
    if (stops[affectedIdx + 1] && stops[affectedIdx + 1].transit_from_prev) {
      stops[affectedIdx + 1].transit_from_prev._stale = true;
    }
  }

  async function deleteStop(dayIdx: number, stopIdx: number) {
    if (!plan || !plan.itinerary) return;
    const snapshot = structuredClone(plan);
    const nextDays = structuredClone(plan.itinerary.days);
    nextDays[dayIdx].stops.splice(stopIdx, 1);
    // Mark neighbors stale
    if (nextDays[dayIdx].stops[stopIdx]) {
      markStale(nextDays[dayIdx].stops, stopIdx);
    }
    // Re-number orders
    nextDays[dayIdx].stops.forEach((s: any, i: number) => { s.order = i + 1; });

    setPlan((prev: any) => ({
      ...prev,
      itinerary: { ...prev.itinerary, days: nextDays },
      edited: true,
      lastEditedAt: Date.now(),
    }));
    await commitDays(nextDays, snapshot);
  }

  async function addStop(dayIdx: number, stopData: Partial<StopData>) {
    if (!plan || !plan.itinerary) return;
    const snapshot = structuredClone(plan);
    const nextDays = structuredClone(plan.itinerary.days);
    const newStop = {
      name: stopData.name || '',
      display_name: stopData.display_name || stopData.name || '',
      address: stopData.address || '',
      start_time: stopData.start_time || '12:00',
      stay_min: stopData.stay_min || 60,
      category: stopData.category || 'landmark',
      entry_fee_krw: 0,
      tip: '',
      order: nextDays[dayIdx].stops.length + 1,
      _userAdded: true,
    };
    nextDays[dayIdx].stops.push(newStop);

    setPlan((prev: any) => ({
      ...prev,
      itinerary: { ...prev.itinerary, days: nextDays },
      edited: true,
      lastEditedAt: Date.now(),
    }));
    await commitDays(nextDays, snapshot);
  }

  async function reorderStops(dayIdx: number, oldIdx: number, newIdx: number) {
    if (!plan || !plan.itinerary) return;
    if (oldIdx === newIdx) return;
    const snapshot = structuredClone(plan);
    const nextDays = structuredClone(plan.itinerary.days);
    const stops = nextDays[dayIdx].stops;
    const [moved] = stops.splice(oldIdx, 1);
    stops.splice(newIdx, 0, moved);
    // Mark all affected range stale
    const minIdx = Math.min(oldIdx, newIdx);
    const maxIdx = Math.max(oldIdx, newIdx);
    for (let i = minIdx; i <= maxIdx + 1 && i < stops.length; i++) {
      if (stops[i] && stops[i].transit_from_prev) {
        stops[i].transit_from_prev._stale = true;
      }
    }
    // Re-number orders
    stops.forEach((s: any, i: number) => { s.order = i + 1; });

    setPlan((prev: any) => ({
      ...prev,
      itinerary: { ...prev.itinerary, days: nextDays },
      edited: true,
      lastEditedAt: Date.now(),
    }));
    await commitDays(nextDays, snapshot);
  }

  return { deleteStop, addStop, reorderStops };
}
