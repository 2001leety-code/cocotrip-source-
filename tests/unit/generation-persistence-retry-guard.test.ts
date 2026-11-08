import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
vi.mock('firebase-admin/firestore',()=>({FieldValue:{increment:(by:number)=>({__sentinel:'increment',by})}}));
vi.mock('../../api/_shared/telegram-throttle.js',()=>({throttledTelegramAlert:vi.fn(async()=>{})}));
vi.mock('../../api/_ai_core/qualityMetrics.js',()=>({computeQualityScore:()=>({score:80,metrics:{dietary_violation:{count:0},unverified_restaurant:{count:0},language_mismatch:{count:0},route_failure:{count:0}}}),detectDepartureFlightOverrun:()=>null}));
import { persistPlan, updatePlanProgressive, savePlanSkeleton } from '../../api/_ai_core/planPersister.js';

const ID='guard-plan',UID='guard-owner',ORDER='GUARD_SYNTHETIC_ORDER';
const claim={orderId:ORDER,attemptId:'guard-attempt',planId:ID};
function args(paid=false,uid:string|null=UID){return {
 body:{paypalOrderId:paid?ORDER:'ADMIN-BYPASS-guard',regions:['seoul'],adults:1},
 itinerary:{tour_title:'Generated',days:[{day:1,stops:[{name:'Original',category:'culture',start_time:'09:00',stay_min:60}]}]},
 uid,planIdOverride:ID,vehicle:'sedan',priceKRW:1,priceUSD:1,guestName:'Synthetic',pax:1,styles:[],area:'seoul',duration:1,
 startDate:'2099-01-01',email:null,specialRequest:'',arrival_airport:null,departure_airport:null,hotel_address:null,mobility:null,
 language:'ko',dietary:[],foodIndex:[],...(paid?{issuanceClaim:claim}:{}),
};}
function harness(paid=false){
 const db=createFakeFirestore(paid?{[`plan_issued_orders/${ORDER}`]:{status:'ISSUING',attemptId:claim.attemptId,planId:ID,uid:UID}}:{});
 const faults={mirror:false,finalize:false,ack:false}; const rootPath=`plans/${ID}`,listPath=`users/${UID}/plans/${ID}`;
 const original=db.runTransaction.bind(db);
 db.runTransaction=async fn=>{
  let wroteRoot=false;
  const result=await original(async tx=>fn({...tx,set(ref,data,opts){
   if(ref.path===listPath&&faults.mirror){faults.mirror=false;throw Error('synthetic mirror failure');}
   if(ref.path===rootPath)wroteRoot=true;
   return tx.set(ref,data,opts);
  },update(ref,data){if(data.status==='ISSUED'&&faults.finalize){faults.finalize=false;throw Error('synthetic finalize failure');}return tx.update(ref,data);}}));
  if(wroteRoot&&faults.ack){faults.ack=false;throw Error('synthetic root ACK loss');}return result;
 };
 const edit=()=>{const d=db.__get(rootPath);d.itinerary.tour_title='Owner title';d.itinerary.days[0].stops[0].name='Owner edit';d.edited=true;d.editRevision=1;d.lastEditedAt=42;db.__set(rootPath,d);return d;};
 return {db,faults,edit,rootPath,listPath};
}
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('External IO forbidden');}));for(const k of ['log','warn','error'] as const)vi.spyOn(console,k).mockImplementation(()=>{});});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('actual persistence retry guards with versioned fake DB, not emulator',()=>{
 it('claimless mirror retry preserves edit and projects latest title/date',async()=>{
  const h=harness();h.faults.mirror=true;await expect(persistPlan(h.db,args())).rejects.toThrow('mirror failure');
  const edited=h.edit();h.db.__set(h.listPath,{extra:'keep'});const version=h.db.__version(h.rootPath);
  await persistPlan(h.db,args());expect(h.db.__get(h.rootPath)).toEqual(edited);expect(h.db.__version(h.rootPath)).toBe(version);
  expect(h.db.__get(h.listPath)).toMatchObject({tourTitle:'Owner title',createdAt:edited.createdAt,extra:'keep'});
 });
 it('ISSUED replay repairs list without root, legacy marker or counters replay',async()=>{
  const h=harness(true);h.faults.mirror=true;await expect(persistPlan(h.db,args(true))).rejects.toThrow('mirror failure');
  const edited=h.edit(),beforeClaim=h.db.__get(`plan_issued_orders/${ORDER}`);await persistPlan(h.db,args(true));
  expect(h.db.__get(h.rootPath)).toEqual(edited);expect(h.db.__get(h.listPath).tourTitle).toBe('Owner title');expect(h.db.__get(`plan_issued_orders/${ORDER}`)).toEqual(beforeClaim);
  expect(Object.keys(h.db.__dump()).filter(p=>p.startsWith('api_stats/'))).toEqual([]);
 });
 it('COMMITTING replay reuses ready root and still executes normal finalize',async()=>{
  const h=harness(true);h.faults.finalize=true;await expect(persistPlan(h.db,args(true))).rejects.toThrow('finalize failure');
  expect(h.db.__get(`plan_issued_orders/${ORDER}`).status).toBe('COMMITTING');const edited=h.edit();await persistPlan(h.db,args(true));
  expect(h.db.__get(h.rootPath)).toEqual(edited);expect(h.db.__get(`plan_issued_orders/${ORDER}`).status).toBe('ISSUED');
 });
 it('root committed but ACK lost: replay preserves edit',async()=>{
  const h=harness();h.faults.ack=true;await expect(persistPlan(h.db,args())).rejects.toThrow('Plan save failed');const edited=h.edit();await persistPlan(h.db,args());expect(h.db.__get(h.rootPath)).toEqual(edited);
 });
 it.each(['owner','input','malformed-ready'])('ambiguous ready %s fails without overwrite or false success',async kind=>{
  const h=harness();await persistPlan(h.db,args());const d=h.edit();if(kind==='owner')d.uid='other';if(kind==='input')d.input.area='busan';if(kind==='malformed-ready')d._streaming_in_progress=true;h.db.__set(h.rootPath,d);
  await expect(persistPlan(h.db,args())).rejects.toThrow();expect(h.db.__get(h.rootPath)).toEqual(d);
 });
 it('guest replay preserves canonical token, dates, credits and prices',async()=>{
  const h=harness();const first=await persistPlan(h.db,args(false,null));const d=h.db.__get(h.rootPath);d.revisionCredits=1;h.db.__set(h.rootPath,d);
  const again=await persistPlan(h.db,args(false,null));expect(again).toEqual(first);expect(h.db.__get(h.rootPath)).toEqual(d);
 });
 it('actual caller-shaped late progressive write cannot reactivate ready',async()=>{
  const h=harness();await persistPlan(h.db,args());const d=h.edit();await updatePlanProgressive(h.db,ID,{'itinerary.days':[{day:1,stops:[]}],_streaming_progress:1});expect(h.db.__get(h.rootPath)).toEqual(d);
 });
 it('late skeleton cannot clear ready edited itinerary',async()=>{
  const h=harness();await persistPlan(h.db,args());const d=h.edit();await savePlanSkeleton(h.db,args());expect(h.db.__get(h.rootPath)).toEqual(d);
 });
 it('actual skeleton defaults allow shaped preferences/styles to finalize',async()=>{const h=harness();const a=args();a.body.preferences='food';a.styles=['food'];await savePlanSkeleton(h.db,a);expect(h.db.__get(h.rootPath).input.styles).toEqual([]);await persistPlan(h.db,a);expect(h.db.__get(h.rootPath).input.styles).toEqual(['food']);});
 it('progress cannot create a missing ghost document',async()=>{const h=harness();await updatePlanProgressive(h.db,ID,{'itinerary.days':[]});expect(h.db.__get(h.rootPath)).toBeUndefined();});
 it('nonready edited document cannot be regenerated',async()=>{const h=harness();await persistPlan(h.db,args());const d=h.edit();d.status='error';h.db.__set(h.rootPath,d);await expect(persistPlan(h.db,args())).rejects.toThrow();expect(h.db.__get(h.rootPath)).toEqual(d);});
});
