// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe,it,expect,vi,beforeEach } from 'vitest';
import { useEditCommand, type EditCtx } from '../../src/pages/PlanDetailPage/hooks/useEditCommand';
const base={uid:'owner',planId:'p',fingerprint:'a'.repeat(64),revision:0};
let scopeId=0;
beforeEach(()=>{base.planId='p'+(++scopeId);});
const op={type:'delete',dayIndex:0,stopIndex:0};
const deferred=()=>{let resolve!:(value:Response)=>void;const promise=new Promise<Response>(r=>{resolve=r;});return{promise,resolve};};
const success=(requestId:string)=>new Response(JSON.stringify({ok:true,requestId,editRevision:1,fingerprint:'b'.repeat(64)}),{status:200});
describe('actual command hook, synthetic transport only',()=>{
 it('keeps ID and entire payload after response loss, blocks different edit and waits for snapshot',async()=>{
  let uid='owner';const calls:unknown[]=[];
  const send=vi.fn(async body=>{calls.push(structuredClone(body));if(calls.length===1)throw Error('lost');return success(body.requestId);});
  const {result,rerender}=renderHook(({ctx}:{ctx:EditCtx})=>useEditCommand(ctx,()=>uid,send),{initialProps:{ctx:base as EditCtx}});
  await act(async()=>{await expect(result.current.execute(op)).rejects.toMatchObject({code:'uncertain'});});
  const updated={...base,fingerprint:'c'.repeat(64),revision:0};rerender({ctx:updated});
  await act(async()=>{await expect(result.current.execute({...op,stopIndex:1})).rejects.toMatchObject({code:'pending'});});
  uid='other';await act(async()=>{await expect(result.current.retry()).rejects.toMatchObject({code:'mismatch'});});expect(send).toHaveBeenCalledTimes(1);
  uid='owner';await act(async()=>{await result.current.retry();});expect(calls[1]).toEqual(calls[0]);
  expect(result.current.state).toBe('awaitingSnapshot');expect(result.current.canEdit).toBe(false);
  rerender({ctx:{...base,revision:1,fingerprint:'b'.repeat(64)}});
  await waitFor(()=>expect(result.current.state).toBe('idle'));
 });
 it('handles snapshot before response, locks same-tick duplicate, snapshots alone never clear uncertainty',async()=>{
  const pending=deferred();const send=vi.fn(()=>pending.promise);
  const {result,rerender}=renderHook(({ctx}:{ctx:EditCtx})=>useEditCommand(ctx,()=> 'owner',send),{initialProps:{ctx:base as EditCtx}});
  let request!:Promise<void>;act(()=>{request=result.current.execute(op);});
  await act(async()=>{await expect(result.current.execute(op)).rejects.toBeDefined();});
  rerender({ctx:{...base,revision:1}});
  expect(result.current.state).toBe('sending');
  await act(async()=>{pending.resolve(success(send.mock.calls[0][0].requestId));await request;});
  expect(result.current.state).toBe('idle');expect(send).toHaveBeenCalledTimes(1);
 });
 it('mutable caller operation cannot alter exact retry body',async()=>{
  const send=vi.fn(async()=>{throw Error('lost');});
  const {result}=renderHook(()=>useEditCommand(base,()=> 'owner',send));const value={...op};
  await act(async()=>{await expect(result.current.execute(value)).rejects.toBeDefined();});
  value.stopIndex=999;
  await act(async()=>{await expect(result.current.retry()).rejects.toBeDefined();});
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
 });
 it('retains command after uncertain then 401, never sends from another account or after unmount',async()=>{
  let uid='owner';const send=vi.fn(async()=>new Response('{}',{status:401}));
  const {result,rerender,unmount}=renderHook(({ctx}:{ctx:EditCtx})=>useEditCommand(ctx,()=>uid,send),{initialProps:{ctx:base as EditCtx}});
  await act(async()=>{await expect(result.current.execute(op)).rejects.toBeDefined();});
  rerender({ctx:{...base,revision:9}});expect(result.current.state).toBe('uncertain');
  uid='other';rerender({ctx:{...base,uid:'other'}});
  await act(async()=>{await expect(result.current.retry()).rejects.toBeDefined();});
  expect(send).toHaveBeenCalledTimes(1);
  const retry=result.current.retry;unmount();uid='owner';await expect(retry()).rejects.toBeDefined();expect(send).toHaveBeenCalledTimes(1);
 });
});

describe('registry and bounded request boundaries',()=>{
 it.each([400,409,422])('first explicit not-applied %s releases, unlike a prior ambiguous response',async status=>{
  const send=vi.fn(async body=>new Response(JSON.stringify({ok:false,outcome:'not_applied',requestId:body.requestId}),{status}));
  const {result,unmount}=renderHook(()=>useEditCommand(base,()=> 'owner',send));
  await act(async()=>{await expect(result.current.execute(op)).rejects.toMatchObject({code:'not_applied'});});
  expect(result.current.state).toBe('idle');unmount();
  base.planId+='-ambiguous';let n=0;
  const later=vi.fn(async body=>{if(++n===1)throw Error('lost');return new Response(JSON.stringify({ok:false,outcome:'not_applied',requestId:body.requestId}),{status});});
  const h=renderHook(()=>useEditCommand(base,()=> 'owner',later));
  await act(async()=>{await expect(h.result.current.execute(op)).rejects.toBeDefined();});
  await act(async()=>{await expect(h.result.current.retry()).rejects.toMatchObject({code:'uncertain'});});
  expect(h.result.current.state).toBe('uncertain');
 });
 it('remount retains exact request; different document sees no old pending and late result stays scoped',async()=>{
  const d=deferred(), send=vi.fn(()=>d.promise);
  const first=renderHook(()=>useEditCommand(base,()=> 'owner',send));
  let task!:Promise<void>;act(()=>{task=first.result.current.execute(op);});
  const original=send.mock.calls[0][0];first.unmount();
  const other=renderHook(()=>useEditCommand({...base,planId:'other-'+base.planId},()=> 'owner',send));
  expect(other.result.current.state).toBe('idle');
  await act(async()=>{d.resolve(success(original.requestId));await task;});
  expect(other.result.current.state).toBe('idle');
  const accepted=vi.fn();const sendAgain=vi.fn(async body=>success(body.requestId));
  const next=renderHook(({ctx}:{ctx:EditCtx})=>useEditCommand(ctx,()=> 'owner',sendAgain,accepted),{initialProps:{ctx:base as EditCtx}});
  await waitFor(()=>expect(next.result.current.state).toBe('awaitingSnapshot'));
  await waitFor(()=>expect(accepted).toHaveBeenCalledTimes(1));
  await act(async()=>{await next.result.current.retry();});expect(sendAgain.mock.calls[0][0]).toEqual(original);
  expect(accepted).toHaveBeenCalledTimes(1);
  next.rerender({ctx:{...base,revision:1}});await waitFor(()=>expect(next.result.current.canEdit).toBe(true));
 });
 it.each(['headers','body'])('45s %s timeout is uncertain; late first response cannot clear same-ID retry',async phase=>{
  vi.useFakeTimers();
  try{
   const d=deferred();let finishBody!:(value:unknown)=>void;
   const stalledBody=new Promise(r=>{finishBody=r;});
   const send=vi.fn((body,signal)=>{ void signal;
    if(send.mock.calls.length===1)return phase==='headers'?d.promise:Promise.resolve({ok:true,json:()=>stalledBody} as Response);
    return Promise.resolve(success(body.requestId));
   });
   const h=renderHook(()=>useEditCommand(base,()=> 'owner',send));let task!:Promise<void>;
   act(()=>{task=h.result.current.execute(op);});const rejection=expect(task).rejects.toMatchObject({code:'uncertain'});
   await act(async()=>{await vi.advanceTimersByTimeAsync(45000);await rejection;});
   expect(h.result.current.state).toBe('uncertain');expect(send.mock.calls[0][1].aborted).toBe(true);
   await act(async()=>{await h.result.current.retry();});
   const body=send.mock.calls[0][0];expect(send.mock.calls[1][0]).toEqual(body);
   await act(async()=>{d.resolve(success(body.requestId));finishBody({ok:false});await Promise.resolve();});
   expect(h.result.current.state).toBe('awaitingSnapshot');
  }finally{vi.useRealTimers();}
 });
});
