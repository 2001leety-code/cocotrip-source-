// Plan editor hook -- optimistic Firestore updates with rollback.
// Level 2: delete / add / reorder + automatic transit recalculation.
// After any edit, stale transits are sent to /api/recalc-transit for
// server-side ODsay + Naver refresh. The plan auto-updates via the
// existing Firestore onSnapshot listener in index.tsx.
import { useState, useCallback, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import type { PlanDocument, PlanDay, PlanStop, SetPlanFn } from '../types';

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
  plan: PlanDocument | null,
  setPlan: SetPlanFn,
) {
  const { user } = useAuth();
  const [isRecalculating, setIsRecalculating] = useState(false);
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist updated days array to Firestore
  async function commitDays(nextDays: PlanDay[], snapshot: PlanDocument) {
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
  function markStale(stops: PlanStop[], affectedIdx: number) {
    // The stop AT affectedIdx and the one AFTER it get _stale
    if (stops[affectedIdx] && stops[affectedIdx].transit_from_prev) {
      stops[affectedIdx].transit_from_prev!._stale = true;
    }
    if (stops[affectedIdx + 1] && stops[affectedIdx + 1].transit_from_prev) {
      stops[affectedIdx + 1].transit_from_prev!._stale = true;
    }
  }

  // Schedule transit recalculation (debounced 2s after last edit)
  const scheduleRecalc = useCallback((dayIdx: number, token: string | null) => {
    if (recalcTimerRef.current) {
      clearTimeout(recalcTimerRef.current);
    }
    recalcTimerRef.current = setTimeout(() => {
      recalcTransit(dayIdx, token);
    }, 2000);
  }, [planId, user]);

  // Call /api/recalc-transit to refresh stale segments
  const recalcTransit = useCallback(async (dayIdx: number, token: string | null) => {
    if (!planId) return;
    setIsRecalculating(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (user && user.uid) {
        headers['Authorization'] = `Bearer ${user.uid}`;
      }
      const res = await fetch('/api/recalc-transit', {
        method: 'POST',
        headers,
        body: JSON.stringify({ planId, dayIndex: dayIdx, token }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('[planEditor] recalc-transit failed:', data.error);
      } else {
        console.log(`[planEditor] Transit recalculated: ${data.recalculated} segment(s)`);
        // Firestore onSnapshot will auto-update the local plan state
      }
    } catch (e) {
      console.error('[planEditor] recalc-transit request failed:', e);
    } finally {
      setIsRecalculating(false);
    }
  }, [planId, user]);

  async function deleteStop(dayIdx: number, stopIdx: number, token?: string | null) {
    if (!plan || !plan.itinerary) return;
    const snapshot = structuredClone(plan) as PlanDocument;
    const nextDays = structuredClone(plan.itinerary.days || []) as PlanDay[];
    const stops = (nextDays[dayIdx]?.stops || []) as PlanStop[];
    stops.splice(stopIdx, 1);
    // Mark neighbors stale
    if (stops[stopIdx]) {
      markStale(stops, stopIdx);
    }
    // Re-number orders
    stops.forEach((s, i) => { s.order = i + 1; });
    nextDays[dayIdx].stops = stops;

    setPlan((prev) => prev ? ({
      ...prev,
      itinerary: { ...prev.itinerary, days: nextDays },
      edited: true,
      lastEditedAt: Date.now(),
    }) : prev);
    await commitDays(nextDays, snapshot);
    scheduleRecalc(dayIdx, token || null);
  }

  async function addStop(dayIdx: number, stopData: Partial<StopData>, token?: string | null) {
    if (!plan || !plan.itinerary) return;
    const snapshot = structuredClone(plan) as PlanDocument;
    const nextDays = structuredClone(plan.itinerary.days || []) as PlanDay[];
    const stops = (nextDays[dayIdx]?.stops || []) as PlanStop[];
    const newStop: PlanStop = {
      name: stopData.name || '',
      display_name: stopData.display_name || stopData.name || '',
      address: stopData.address || '',
      start_time: stopData.start_time || '12:00',
      stay_min: stopData.stay_min || 60,
      category: stopData.category || 'landmark',
      entry_fee_krw: 0,
      tip: '',
      order: stops.length + 1,
      _userAdded: true,
      transit_from_prev: {
        method: 'walk',
        est_min: 10,
        est_fare_krw: 0,
        _stale: true,
        source: 'placeholder',
      },
    };
    stops.push(newStop);
    nextDays[dayIdx].stops = stops;

    setPlan((prev) => prev ? ({
      ...prev,
      itinerary: { ...prev.itinerary, days: nextDays },
      edited: true,
      lastEditedAt: Date.now(),
    }) : prev);
    await commitDays(nextDays, snapshot);
    scheduleRecalc(dayIdx, token || null);
  }

  async function reorderStops(dayIdx: number, oldIdx: number, newIdx: number, token?: string | null) {
    if (!plan || !plan.itinerary) return;
    if (oldIdx === newIdx) return;
    const snapshot = structuredClone(plan) as PlanDocument;
    const nextDays = structuredClone(plan.itinerary.days || []) as PlanDay[];
    const stops = (nextDays[dayIdx]?.stops || []) as PlanStop[];
    const [moved] = stops.splice(oldIdx, 1);
    stops.splice(newIdx, 0, moved);
    // Mark all affected range stale
    const minIdx = Math.min(oldIdx, newIdx);
    const maxIdx = Math.max(oldIdx, newIdx);
    for (let i = minIdx; i <= maxIdx + 1 && i < stops.length; i++) {
      if (stops[i] && stops[i].transit_from_prev) {
        stops[i].transit_from_prev!._stale = true;
      }
    }
    // Re-number orders
    stops.forEach((s, i) => { s.order = i + 1; });
    nextDays[dayIdx].stops = stops;

    setPlan((prev) => prev ? ({
      ...prev,
      itinerary: { ...prev.itinerary, days: nextDays },
      edited: true,
      lastEditedAt: Date.now(),
    }) : prev);
    await commitDays(nextDays, snapshot);
    scheduleRecalc(dayIdx, token || null);
  }

  return { deleteStop, addStop, reorderStops, recalcTransit, isRecalculating };
}
