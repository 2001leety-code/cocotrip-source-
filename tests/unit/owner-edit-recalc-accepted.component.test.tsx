// @vitest-environment jsdom
import { renderHook, act, cleanup } from '@testing-library/react';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { usePlanEditor } from '../../src/pages/PlanDetailPage/hooks/usePlanEditor';
const fx=vi.hoisted(()=>({send:vi.fn(),auth:{currentUser:{uid:'owner'}}}));
vi.mock('@/lib/authFetch',()=>({authFetch:fx.send}));
vi.mock('@/lib/firebase-auth',()=>({auth:fx.auth}));
let seq=0;
beforeEach(()=>{vi.useFakeTimers();fx.send.mockReset();seq++;});
afterEach(()=>{cleanup();vi.useRealTimers();});
it.each(['initial','retry'])('real hook %s acceptance schedules recalc once and never writes local days',async mode=>{
 const planId='hook-'+seq,ctx={uid:'owner',planId,fingerprint:'a'.repeat(64),revision:0},setPlan=vi.fn();
 let calls=0;
 fx.send.mockImplementation(async(url,options)=>{
  if(url==='/api/recalc-transit')return new Response('{}',{status:409});
  const body=JSON.parse(options.body);
  if(mode==='retry' && ++calls===1)throw Error('response lost');
  return new Response(JSON.stringify({ok:true,requestId:body.requestId,editRevision:1,fingerprint:'b'.repeat(64)}));
 });
 const h=renderHook(()=>usePlanEditor(planId,{planId,itinerary:{days:[]}},setPlan,ctx));
 if(mode==='retry'){
  await act(async()=>{await expect(h.result.current.deleteStop(0,0)).rejects.toBeDefined();});
  await act(async()=>{await h.result.current.retryEdit();});
 }else await act(async()=>{await h.result.current.deleteStop(0,0);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(fx.send.mock.calls.filter(([url])=>url==='/api/recalc-transit')).toHaveLength(1);
 expect(setPlan).not.toHaveBeenCalled();expect(h.result.current.editState).toBe('awaitingSnapshot');
});
