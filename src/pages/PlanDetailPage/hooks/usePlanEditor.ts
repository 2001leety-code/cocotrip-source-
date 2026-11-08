// Owner commands never write client/translated days. Canonical owner read updates the view.
import { useState, useCallback, useRef, useEffect } from 'react';
import { auth } from '@/lib/firebase-auth';
import { authFetch } from '@/lib/authFetch';
import type { PlanDocument, PlanStop, SetPlanFn } from '../types';
import { useEditCommand, type EditCtx } from './useEditCommand';
type StopData = {name:string;display_name:string;address:string;start_time:string;stay_min:number;category:string};

export function markStopStale(stops: PlanStop[], i: number, before?: PlanStop[]): void {
  const s = stops[i] as (PlanStop & { _stale_transit?: boolean; same_lodging_as_prev?: boolean }) | undefined;
  if (!s || i === 0) return;
  if (s.same_lodging_as_prev && before) {
    const bi = before.indexOf(s);
    if (bi > 0 && before[bi - 1] === stops[i - 1]) return;
  }
  if (s.transit_from_prev) s.transit_from_prev._stale = true;
  else s._stale_transit = true;
  delete s.same_lodging_as_prev;
}

export function usePlanEditor(planId: string, plan: PlanDocument | null, _setPlan: SetPlanFn, context: EditCtx = null) {
  const [isRecalculating, setIsRecalculating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  const recalcTransit = useCallback(async (dayIndex: number, token: string | null) => {
    if (!planId || !mounted.current) return;
    setIsRecalculating(true);
    try {
      const response = await authFetch('/api/recalc-transit', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({planId,dayIndex,token})});
      if (!response.ok) console.warn('[planEditor] Transit was not refreshed');
    } catch { console.warn('[planEditor] Transit refresh unavailable'); }
    finally { if (mounted.current) setIsRecalculating(false); }
  }, [planId]);
  function schedule(dayIndex: number, token: string | null) {
    if (!mounted.current) return;
    if (timer.current) clearTimeout(timer.current);
    const ownerUid = context?.uid;
    timer.current = setTimeout(() => {
      if (mounted.current && ownerUid && auth.currentUser?.uid === ownerUid) void recalcTransit(dayIndex, token);
    }, 2000);
  }
  const command = useEditCommand(context, () => auth.currentUser?.uid || null, (body, signal) =>
    authFetch('/api/plan-edit', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}), (operation, ownerUid, originalPlanId) => {
      const dayIndex = (operation as {dayIndex?:unknown}).dayIndex;
      if (originalPlanId === planId && auth.currentUser?.uid === ownerUid && typeof dayIndex === 'number') schedule(dayIndex, null);
    });
  async function commit(operation: Record<string, unknown>, _token?: string | null) {
    void _token;
    await command.execute(operation);
    // Accepted callback covers both initial save and same-request retry.
  }
  async function deleteStop(dayIndex:number,stopIndex:number,token?:string|null) {
    await commit({type:'delete',dayIndex,stopIndex},token);
  }
  async function addStop(dayIndex:number,data:Partial<StopData>,token?:string|null) {
    const stop={name:data.name || '',display_name:data.display_name || data.name || '',address:data.address || '',
      start_time:data.start_time || '12:00',stay_min:data.stay_min || 60,category:data.category || 'landmark'};
    await commit({type:'add',dayIndex,stop},token);
  }
  async function reorderStops(dayIndex:number,fromIndex:number,toIndex:number,token?:string|null) {
    if(fromIndex===toIndex)return;
    await commit({type:'reorder',dayIndex,fromIndex,toIndex},token);
  }
  async function applyStopOrder(dayIndex:number,order:number[],token?:string|null) {
    const stops=plan?.itinerary?.days?.[dayIndex]?.stops || [];
    if(order.length!==stops.length || [...order].sort((a,b)=>a-b).some((v,i)=>v!==i))return;
    await commit({type:'applyOrder',dayIndex,order:[...order]},token);
  }
  return {deleteStop,addStop,reorderStops,applyStopOrder,recalcTransit,isRecalculating,
    editState:command.state,canEdit:command.canEdit,retryEdit:command.retry};
}
