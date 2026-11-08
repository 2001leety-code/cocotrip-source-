import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createEditService } from '../../api/_shared/plan-edit-service.js';
import { validateCommand, applyOperation } from '../../api/_shared/plan-edit-operation.js';
import { canonicalJson, canonicalSource } from '../../src/lib/planEditCanonical.js';
import { saveIfUnchanged } from '../../api/_shared/save-if-unchanged.js';

const hash = s => createHash('sha256').update(s).digest('hex');
const fixture = () => ({ uid:'owner', planId:'p', status:'ready', paid:true, input:{dietary:['keep']},
 itinerary:{title:'keep',days:[{day:1,unknown:'keep',stops:[
 {name:'A',order:1,verified:true,unknown:'keep'}, {name:'B',order:2,transit_from_prev:{method:'walk'}}]}]} });
function harness(plan=fixture()) {
 const records = new Map([['plans/p',structuredClone(plan)]]);
 const writes = [];
 const db = {collection:name=>({doc:id=>name+'/'+id}),runTransaction:async run=>{
  const pending=[];
  const tx={
   get:async ref=>({exists:records.has(ref),data:()=>structuredClone(records.get(ref))}),
   update:(ref,patch)=>pending.push(['update',ref,patch]),
   create:(ref,value)=>pending.push(['create',ref,value]),
  };
  const result=await run(tx);
  for(const [kind,ref,value] of pending){
   if(kind==='create') records.set(ref,structuredClone(value));
   else { const doc=records.get(ref); for(const [key,v] of Object.entries(value)){
    if(key==='itinerary.days')doc.itinerary.days=structuredClone(v);else doc[key]=v;
   }}
   writes.push([kind,ref,value]);
  }
  return result;
 }};
 const service=createEditService({db,validateCommand,canonicalJson,canonicalSource,applyOperation,cleanDays:x=>x,now:()=>100});
 const command=(operation={type:'delete',dayIndex:0,stopIndex:0},requestId='r')=>({
  planId:'p',requestId,expectedFingerprint:hash(canonicalSource(records.get('plans/p'))),operation});
 return {records,writes,service,command};
}
describe('owner edit server contract with in-memory atomic adapter (no live DB)',()=>{
 it('writes allowed patch plus receipt and replays exact command only once',async()=>{
  const h=harness(); const c=h.command(); const r=await h.service.execute('owner',c);
  expect(r.editRevision).toBe(1); expect(h.writes).toHaveLength(2);
  expect(await h.service.execute('owner',c)).toEqual(r);expect(h.writes).toHaveLength(2);
  const p=h.records.get('plans/p');expect(p.paid).toBe(true);expect(p.input).toEqual({dietary:['keep']});
  expect(p.itinerary.title).toBe('keep'); expect(p.itinerary.days[0].unknown).toBe('keep');
  expect(Object.keys(h.writes[0][2]).sort()).toEqual(['editRevision','edited','itinerary.days','lastEditedAt']);
 });
 it.each(['other',''])('denies unverified/mismatched UID %s without writes',async uid=>{
  const h=harness();await expect(h.service.execute(uid,h.command())).rejects.toBeDefined();expect(h.writes).toHaveLength(0);
 });
 it('denies changed owner even when receipt exists',async()=>{
  const h=harness(),c=h.command();await h.service.execute('owner',c);
  h.records.get('plans/p').uid='other';
  await expect(h.service.execute('owner',c)).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(h.writes).toHaveLength(2);
 });
 it('same ID changed intent conflicts without new write',async()=>{
  const h=harness(),c=h.command();await h.service.execute('owner',c);
  await expect(h.service.execute('owner',{...c,operation:{type:'delete',dayIndex:0,stopIndex:1}})).rejects.toMatchObject({code:'OP_ID_CONFLICT'});
  expect(h.writes).toHaveLength(2);
 });
 it.each([{status:'streaming'},{_streaming_in_progress:true},{_p231_stub:true},{planId:'different'},{uid:null},{editRevision:-1}])('rejects invalid gate %j',async patch=>{
  const h=harness({...fixture(),...patch});await expect(h.service.execute('owner',h.command())).rejects.toBeDefined();expect(h.writes).toHaveLength(0);
 });
 it('revision detects ABA even if days revert',async()=>{
  const h=harness(),c=h.command();h.records.get('plans/p').editRevision=2;
  await expect(h.service.execute('owner',c)).rejects.toMatchObject({code:'FINGERPRINT_MISMATCH'});expect(h.writes).toHaveLength(0);
 });
 it('manual add preserves trust of existing stop and never grants trust to new one',async()=>{
  const h=harness(), c=h.command({type:'add',dayIndex:0,stop:{name:'C',display_name:'C',address:'',start_time:'12:00',stay_min:30,category:'food'}});
  await h.service.execute('owner',c);const stops=h.records.get('plans/p').itinerary.days[0].stops;
  expect(stops[0].verified).toBe(true);expect(stops[2]._userAdded).toBe(true);expect(stops[2]).not.toHaveProperty('verified');
 });
 it.each([{type:'applyOrder',dayIndex:0,order:[0,0]},{type:'delete',dayIndex:0,stopIndex:99},{type:'delete',dayIndex:0,stopIndex:0,days:[]}])('rejects bad operation %j',async operation=>{
  const h=harness();await expect(h.service.execute('owner',h.command(operation))).rejects.toBeDefined();expect(h.writes).toHaveLength(0);
 });
 it('canonical matches sorted raw JSON and marker changes; unsupported values fail closed',()=>{
  const p=fixture();expect(canonicalJson({b:1,a:2,drop:undefined})).toBe('{"a":2,"b":1}');
  expect(canonicalSource({...p,lastEditedAt:1})).not.toBe(canonicalSource(p));
  expect(()=>canonicalJson({x:NaN})).toThrow();expect(()=>canonicalJson({x:new Date()})).toThrow();
 });
 it('CAS preserves merge semantics and no write on timestamp conflict or missing version',async()=>{
  const writes=[];let value=1;const stamp=n=>({isEqual:other=>other.n===n,n});
  const db={runTransaction:run=>run({get:async()=>({exists:true,updateTime:stamp(value)}),set:(...args)=>writes.push(args)})};
  expect(await saveIfUnchanged(db,'p',stamp(1),{itinerary:{days:[]}})).toEqual({conflict:false});
  expect(writes[0]).toEqual(['p',{itinerary:{days:[]}},{merge:true}]);
  value=2;expect(await saveIfUnchanged(db,'p',stamp(1),{})).toEqual({conflict:true});
  expect(await saveIfUnchanged(db,'p',undefined,{})).toEqual({conflict:true});expect(writes).toHaveLength(1);
 });
});

describe('pure operation raw immutability and existing stale parity',()=>{
 const freeze=value=>{if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
 it('applies to deeply frozen server data, preserves unknown fields and all original bytes',()=>{
  const original=freeze(fixture()),before=JSON.stringify(original);
  const c=validateCommand({planId:'p',requestId:'r',expectedFingerprint:'a'.repeat(64),operation:{type:'delete',dayIndex:0,stopIndex:1}});
  const days=applyOperation(original,c);
  expect(JSON.stringify(original)).toBe(before);
  expect(days[0].stops[0]).toEqual(original.itinerary.days[0].stops[0]);
  expect(days[0].unknown).toBe('keep');
 });
 it('applyOrder preserves unchanged merged pair but marks other nonfirst stops like prior helper',()=>{
  const raw=fixture();raw.itinerary.days[0].stops=[
   {name:'A',order:1,transit_from_prev:null},
   {name:'B',order:2,same_lodging_as_prev:true,transit_from_prev:null},
   {name:'C',order:3,transit_from_prev:null,unknown:42}
  ];
  const cmd=validateCommand({planId:'p',requestId:'r',expectedFingerprint:'a'.repeat(64),operation:{type:'applyOrder',dayIndex:0,order:[0,1,2]}});
  const stops=applyOperation(freeze(raw),cmd)[0].stops;
  expect(stops[0]).not.toHaveProperty('_stale_transit');
  expect(stops[1].same_lodging_as_prev).toBe(true);expect(stops[1]).not.toHaveProperty('_stale_transit');
  expect(stops[2]._stale_transit).toBe(true);expect(stops[2].unknown).toBe(42);
 });
});
