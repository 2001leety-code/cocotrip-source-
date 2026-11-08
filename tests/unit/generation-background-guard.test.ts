import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
vi.mock('../../api/_ai_core/threePassPipeline.js',()=>({pass3Enrich:vi.fn()}));
vi.mock('../../api/_ai_core/geminiPipeline.js',()=>({isPass3BackgroundEnabled:()=>false,isStreamingEnabled:()=>true,buildModel:vi.fn(),loadFoodIndex:vi.fn()}));
vi.mock('../../api/_shared/telegram-throttle.js',()=>({throttledTelegramAlert:vi.fn(async()=>{})}));
vi.mock('../../api/_ai_core/emailNotifier.js',()=>({sendNotificationEmail:vi.fn(),recordLeadToSheets:vi.fn()}));
vi.mock('../../api/_ai_core/qualityMetrics.js',()=>({computeQualityScore:vi.fn(),detectDepartureFlightOverrun:vi.fn()}));
import { tryInitStreamingSkeleton, tryInitBlockModeForInngest } from '../../api/_ai_core/backgroundPipelines.js';
const id='background-guard';
const ready=()=>({planId:id,uid:'owner',status:'ready',edited:true,editRevision:1,itinerary:{days:[{stops:[{name:'Owner edit'}]}]}});
const args=db=>({adminDb:db,uid:'owner',email:null,area:'seoul',startDate:'2099-01-01',guestName:'Guest',pax:1,language:'en',vehicle:'sedan',durationDays:1,body:{},reservedPlanId:id,itinerary:{days:[{stops:[]}]}});
beforeEach(()=>{for(const m of ['log','warn','error'])vi.spyOn(console,m).mockImplementation(()=>{});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('actual background stub and block writers',()=>{
 it.each(['streaming-stub','block-stub','block-skeleton'])('%s preserves completed owner edit',async kind=>{
  vi.stubEnv('PLANNER_SKELETON_IN_WORKER',kind==='block-skeleton'?'false':'true');const root=ready();const db=createFakeFirestore({[`plans/${id}`]:root});
  const result=await (kind==='streaming-stub'?tryInitStreamingSkeleton(args(db)):tryInitBlockModeForInngest(args(db)));
  expect(result.planId).toBe(id);expect(db.__get(`plans/${id}`)).toEqual(root);expect(db.__version(`plans/${id}`)).toBe(1);
 });
 it('new legitimate worker stub still writes same expected shape',async()=>{vi.stubEnv('PLANNER_SKELETON_IN_WORKER','true');const db=createFakeFirestore();await tryInitStreamingSkeleton(args(db));expect(db.__get(`plans/${id}`)).toMatchObject({planId:id,uid:'owner',status:'streaming',_streaming_in_progress:true,_p231_stub:true});});
});
