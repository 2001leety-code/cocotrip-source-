import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
const h=vi.hoisted(()=>{const state={db:null};const db={collection:(...a)=>state.db.collection(...a),runTransaction:(...a)=>state.db.runTransaction(...a)};return{state,db,release:vi.fn(async()=>({released:false})),coupon:vi.fn(async()=>{}),alert:vi.fn(async()=>{})};});
vi.mock('../../api/_inngest/client.js',()=>({inngest:{createFunction:(o,fn)=>({fn,onFailureFn:o.onFailure})}}));
vi.mock('../../api/_ai_core/firestoreAdmin.js',()=>({initAdminDb:()=>h.db}));
vi.mock('../../api/_ai_core/paymentGate.js',()=>({restoreAiPlanCoupon:h.coupon}));
vi.mock('../../api/_ai_core/postResponsePipeline.js',()=>({runRouteEnrichment:vi.fn(),applyBackfillsAndTmoney:vi.fn(),applyRecommendedRestaurants:vi.fn(),computePricing:vi.fn(),savePlan:vi.fn(),arrivalRestDayFromCtx:()=>false}));
vi.mock('../../api/_ai_core/backgroundPipelines.js',()=>({triggerPass3BackgroundIfPending:vi.fn()}));
vi.mock('../../api/_shared/plan-issuance.js',async importOriginal=>({...await importOriginal(),releasePlanIssuance:h.release}));
vi.mock('../../api/_ai_core/emailNotifier.js',()=>({sendNotificationEmail:vi.fn(),recordLeadToSheets:vi.fn()}));
vi.mock('../../api/_shared/telegram-throttle.js',()=>({throttledTelegramAlert:h.alert}));
vi.mock('../../api/_ai_core/qualityMetrics.js',()=>({computeQualityScore:vi.fn(),detectDepartureFlightOverrun:vi.fn()}));
import {processPlanAfterAI} from '../../api/_inngest/functions/processPlanAfterAI.js';
const id='worker-guard',owner='owner';
const fixture=()=>({planId:id,uid:owner,status:'ready',edited:true,editRevision:1,itinerary:{days:[{stops:[{name:'Owner'}]}]}});
const logger={info:()=>{},warn:()=>{},error:()=>{}};
beforeEach(()=>{h.state.db=createFakeFirestore({[`plans/${id}`]:fixture()});vi.clearAllMocks();for(const m of ['log','warn','error'])vi.spyOn(console,m).mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());
describe('actual worker guards, mocked IO and versioned fake DB',()=>{
 it('late worker failure preserves ready while leaving release/coupon call conditions intact',async()=>{
  const before=h.state.db.__get(`plans/${id}`);const claim={orderId:'order',attemptId:'attempt',planId:id};
  await processPlanAfterAI.onFailureFn({event:{data:{event:{data:{planId:id,ctx:{issuanceClaim:claim,consumedCoupon:{uid:owner,code:'synthetic',consumptionId:'consumption'}}}}}},error:Object.assign(new Error('synthetic route failure'),{code:'ROUTE_DAY_INFEASIBLE'})});
  expect(h.state.db.__get(`plans/${id}`)).toEqual(before);expect(h.release).toHaveBeenCalledWith(h.db,claim);expect(h.coupon).toHaveBeenCalledWith(h.db,owner,'synthetic','consumption');
 });
 it('matching streaming failure keeps original error metadata',async()=>{
  h.state.db.__set(`plans/${id}`,{planId:id,uid:owner,status:'streaming',_streaming_in_progress:true});
  await processPlanAfterAI.onFailureFn({event:{data:{event:{data:{planId:id,ctx:{}}}}},error:new Error('synthetic failure')});
  expect(h.state.db.__get(`plans/${id}`)).toMatchObject({status:'error',_streaming_in_progress:false,_streaming_error:'inngest_worker_failure_p307',_streaming_error_message:'synthetic failure'});expect(h.state.db.__get(`plans/${id}`)._failed_at).toEqual(expect.any(String));
 });
 it('worker failure on missing doc does not create ghost',async()=>{
  h.state.db.__delete(`plans/${id}`);await processPlanAfterAI.onFailureFn({event:{data:{event:{data:{planId:id,ctx:{}}}}},error:new Error('failure')});expect(h.state.db.__get(`plans/${id}`)).toBeUndefined();
 });
 it('late worker skeleton cannot erase ready edited days',async()=>{
  const before=h.state.db.__get(`plans/${id}`);const ctx={body:{},streamingPlanId:id,skeletonCtx:{uid:owner,body:{},pax:1,guestName:'Synthetic'}};
  const step={run:async(name,fn)=>{if(name==='skeleton-write')return fn();throw Error('STOP_AFTER_SKELETON');}};
  await expect(processPlanAfterAI.fn({event:{data:{planId:id,itinerary:{days:[]},ctx}},step,logger})).rejects.toThrow('STOP_AFTER_SKELETON');expect(h.state.db.__get(`plans/${id}`)).toEqual(before);
 });
});
