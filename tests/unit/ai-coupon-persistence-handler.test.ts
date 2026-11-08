import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../../tests/helpers/fake-firestore.js';

const boundary = vi.hoisted(() => ({
  authUid: 'synthetic-planner-user',
  cleanup: vi.fn(),
  db: null as ReturnType<typeof createFakeFirestore> | null,
  generate: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  sheetsAppend: vi.fn(),
  sheets: vi.fn(),
  jwt: vi.fn(),
  sendEvent: vi.fn(),
}));

vi.mock('../../api/_ai_core/planCloseout.js', async importOriginal => { const actual = await importOriginal<typeof import('../../api/_ai_core/planCloseout.js')>(); return {...actual, runHandlerFailureCleanup: async (args:Parameters<typeof actual.runHandlerFailureCleanup>[0]) => {boundary.cleanup(args); return actual.runHandlerFailureCleanup(args);}}; });

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (token:string) => token === 'synthetic-anon-token' ? ({uid:'synthetic-anon-owner',firebase:{sign_in_provider:'anonymous'}}) : ({ uid: boundary.authUid, email: 'planner-test@example.invalid', email_verified: true }) }),
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    increment: (by: number) => ({ __sentinel: 'increment', by }),
    delete: () => ({ __sentinel: 'delete' }),
  },
  getFirestore: () => boundary.db,
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => boundary.db }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: vi.fn(async () => ({ accessToken: 'synthetic-paypal-access-token', baseUrl: 'https://paypal.invalid' })),
  resolveIsSandbox: () => true,
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: boundary.generate,
        generateContentStream: async () => ({
          stream: (async function* () { yield { text: () => '' }; })(),
          response: Promise.resolve({ usageMetadata: {} }),
        }),
      };
    }
  },
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: boundary.createTransport },
}));
vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: class { constructor(...args: unknown[]) { boundary.jwt(...args); } } },
    sheets: boundary.sheets,
  },
}));
vi.mock('inngest', () => ({ Inngest: class {
  send = boundary.sendEvent;
  createFunction(_config: unknown, handler: unknown) { return handler; }
} }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: vi.fn(), recordGeminiUsage: vi.fn() }));

const generated = {
  tour_title: 'Synthetic Busan day',
  regions: ['busan'],
  days: [{
    day: 1, city: 'busan', theme: 'Coast and culture',
    stops: [
      { name: 'Haeundae Beach', display_name: 'Haeundae Beach', category: 'attraction', start_time: '10:00', stay_min: 60, address: 'Busan', tip: 'Enjoy the coast' },
      { name: 'Lunch House', display_name: 'Lunch House', category: 'food', start_time: '12:00', stay_min: 60, address: 'Busan', tip: 'Try a local lunch' },
      { name: 'Busan Museum', display_name: 'Busan Museum', category: 'attraction', start_time: '12:00', stay_min: 60, address: 'Busan', tip: 'Explore local history' },
      { name: 'Beomeosa', display_name: 'Beomeosa', category: 'attraction', start_time: '14:00', stay_min: 60, address: 'Busan', tip: 'Visit the temple' },
      { name: 'Dinner House', display_name: 'Dinner House', category: 'food', start_time: '18:00', stay_min: 60, address: 'Busan', tip: 'Enjoy dinner' },
    ],
  }],
  arrival_guide: { airport: 'PUS', steps: [] },
};

type ApiHandler = (req: Record<string, unknown>, res: {
  statusCode?: number; headersSent?: boolean; payload?: string;
  writeHead: (code: number) => void; end: (payload?: string) => void;
}) => Promise<void>;
let plannerHandler: ApiHandler;
let restoreDbBoundary = () => {};
const PAYPAL_ORDER = '5O190127TN364715T';

beforeAll(async () => {
  boundary.db = createFakeFirestore();
  plannerHandler = (await import('../../api/ai-planner-full.js')).default as ApiHandler;
});

beforeEach(() => {
  boundary.authUid='synthetic-planner-user';
  boundary.cleanup.mockReset();
  boundary.sendEvent.mockReset().mockResolvedValue({ ids: ['synthetic-event'] });
  restoreDbBoundary();
  restoreDbBoundary = () => {};
  for (const path of Object.keys(boundary.db?.__dump() || {})) boundary.db?.__delete(path);
  boundary.db?.__set(`paypal_order_snapshots/${PAYPAL_ORDER}`, {
    productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000,
  });
  boundary.generate.mockReset().mockResolvedValue({ response: { text: () => JSON.stringify(generated), usageMetadata: {} } });
  boundary.sendMail.mockReset().mockRejectedValue(new Error('synthetic blocked mail transport'));
  boundary.createTransport.mockReset().mockReturnValue({ sendMail: boundary.sendMail });
  boundary.sheetsAppend.mockReset().mockRejectedValue(new Error('synthetic blocked Sheets transport'));
  boundary.sheets.mockReset().mockReturnValue({ spreadsheets: { values: { append: boundary.sheetsAppend } } });
  boundary.jwt.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('External fetch forbidden'); }));
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-offline-only-key');
  vi.stubEnv('PLANNER_MODE', 'legacy');
  vi.stubEnv('PLANNER_BLOCK_MODE', 'auto');
  vi.stubEnv('PLANNER_STREAMING_ENABLED', 'false');
  vi.stubEnv('PLANNER_STREAMING_EARLY_RESPONSE', 'false');
  vi.stubEnv('INNGEST_EVENT_KEY', '');
  vi.stubEnv('FEATURE_GUEST_ANON_AUTH', 'false');
  vi.stubEnv('P181_PRO_ESCALATE_ENABLED', 'false');
  vi.stubEnv('P181_MINIMAL_FALLBACK_ENABLED', 'false');
  // Exercise the completion-notification code with synthetic credentials while
  // nodemailer/googleapis are mocked transport boundaries; no real account wins.
  vi.stubEnv('GMAIL_USER', 'planner-test@example.invalid');
  vi.stubEnv('GMAIL_APP_PASSWORD', 'synthetic-blocked-password');
  vi.stubEnv('GOOGLE_CLIENT_EMAIL', 'planner-test@example.invalid');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '');
  vi.stubEnv('GOOGLE_PRIVATE_KEY', 'synthetic-blocked-private-key');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', '');
  vi.stubEnv('GOOGLE_SHEETS_SPREADSHEET_ID', 'synthetic-spreadsheet-id');
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  restoreDbBoundary();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const requestBody = () => ({
  paypalOrderId: PAYPAL_ORDER,
  regions: ['Busan'], durationDays: 1, pax: 2, adults: 2, children: 0,
  startDate: '2099-01-10', language: 'en', styles: ['culture'], categories: ['culture'],
  reservation_status: 'none', vehicle: 'sedan', email: 'spoofed@example.invalid',
});

function response() {
  return {
    statusCode: 0, headersSent: false, payload: '',
    writeHead(this: { statusCode: number; headersSent: boolean }, code: number) { this.statusCode = code; this.headersSent = true; },
    end(this: { payload: string }, payload = '') { this.payload = payload; },
  };
}

async function runPlanner(body: Record<string, unknown>, extraHeaders:Record<string,string>={}) {
  const res = response();
  await plannerHandler({ method: 'POST', headers: { authorization: 'Bearer synthetic-firebase-token',...extraHeaders }, body }, res);
  return { ...res, json: JSON.parse(res.payload) };
}


const UID='synthetic-planner-user', CODE='SYNTHETIC-COUPON', COUPON=`users/${UID}/coupons/synthetic`;
function setupCoupon(){boundary.db!.__set(COUPON,{code:CODE,productScope:'ai-plan',type:'free',isUsed:false,maxDays:3});}
function couponBody(){const body:Record<string,unknown>=requestBody();delete body.paypalOrderId;body.aiCouponCode=CODE;body.uid=UID;return body;}
function roots(){return Object.entries(boundary.db!.__dump()).filter(([path])=>/^plans\/[^/]+$/.test(path));}
function injectFailure(kind:'root'|'list'){
 const db=boundary.db!,original=db.runTransaction.bind(db);
 db.runTransaction=fn=>original(async tx=>{let hit=false;const value=await fn({...tx,set(ref,data,options){if(kind==='root'?ref.path.startsWith('plans/'):new RegExp(`^users/${UID}/plans/`).test(ref.path))hit=true;tx.set(ref,data,options);}});if(hit)throw Error(`synthetic ${kind} commit rejected`);return value;});
 restoreDbBoundary=()=>{db.runTransaction=original;};
}
async function restored(){await vi.waitFor(()=>expect(boundary.db!.__get(COUPON)).toMatchObject({isUsed:false,consumptionId:null}));}
it('control: actual coupon consumption + handler/savePlan completes, coupon stays used',async()=>{
 setupCoupon();const res=await runPlanner(couponBody());expect(res.statusCode).toBe(200);expect(boundary.cleanup).not.toHaveBeenCalled();expect(roots()).toHaveLength(1);expect(roots()[0][1]).toMatchObject({status:'ready',isFreeCoupon:true,uid:UID});expect(boundary.db!.__get(COUPON).isUsed).toBe(true);expect(boundary.db!.__get(COUPON).consumptionId).toEqual(expect.any(String));
});
it('control: root transaction abort leaves no plan and actual cleanup restores consumed coupon',async()=>{
 setupCoupon();injectFailure('root');const res=await runPlanner(couponBody());expect(res.statusCode).toBe(500);expect(roots()).toHaveLength(0);expect(boundary.cleanup).toHaveBeenCalledTimes(1);expect(boundary.cleanup.mock.calls[0][0]).toMatchObject({planPersisted:false});await restored();
});
it('does not restore a consumed coupon after root commits but listing fails',async()=>{
 setupCoupon();injectFailure('list');const res=await runPlanner(couponBody());expect(res.statusCode).toBe(500);
 expect(roots()).toHaveLength(1);const [path,root]=roots()[0];expect(root).toMatchObject({status:'ready',isFreeCoupon:true,uid:UID});
 expect(boundary.db!.__get(`users/${UID}/plans/${root.planId}`)).toBeUndefined();
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(boundary.db!.__get(COUPON)).toMatchObject({isUsed:true,consumptionId:expect.any(String)});
 expect(boundary.db!.__get(path)).toEqual(root);
});
it('retries a completed coupon using the same canonical plan and repairs its list without generation',async()=>{
 setupCoupon();injectFailure('list');const first=await runPlanner(couponBody());expect(first.statusCode).toBe(500);
 const [oldPath,oldRoot]=roots()[0];restoreDbBoundary();const modelCalls=boundary.generate.mock.calls.length;
 const second=await runPlanner(couponBody());expect(second.statusCode).toBe(200);expect(roots()).toHaveLength(1);
 expect(boundary.db!.__get(oldPath)).toEqual(oldRoot);expect(second.json.data.planId).toBe(oldRoot.planId);
 expect(boundary.db!.__get(`users/${UID}/plans/${oldRoot.planId}`)).toMatchObject({planId:oldRoot.planId,status:'ready'});
 expect(boundary.db!.__get(COUPON).isUsed).toBe(true);expect(boundary.generate).toHaveBeenCalledTimes(modelCalls);
 expect(Object.keys(boundary.db!.__dump()).filter(x=>x.startsWith('plan_issued_orders/'))).toHaveLength(0);
});
it('does not regenerate a completed coupon for changed travel inputs',async()=>{
 setupCoupon();injectFailure('list');await runPlanner(couponBody());restoreDbBoundary();const before=roots(), modelCalls=boundary.generate.mock.calls.length;
 const changed=await runPlanner({...couponBody(),startDate:'2099-02-11'});
 expect([403,409]).toContain(changed.statusCode);expect(roots()).toEqual(before);expect(boundary.generate).toHaveBeenCalledTimes(modelCalls);
 expect(boundary.db!.__get(COUPON).consumptionId).toEqual(expect.any(String));
});
it('does not trust an external isUsed=false reset over a completed consumption binding',async()=>{
 setupCoupon();const first=await runPlanner(couponBody());expect(first.statusCode).toBe(200);const before=roots(), modelCalls=boundary.generate.mock.calls.length;
 boundary.db!.__set(COUPON,{...boundary.db!.__get(COUPON),isUsed:false,usedAt:null,usedOrderID:null,pendingCapture:false});
 const retry=await runPlanner(couponBody());expect(retry.statusCode).toBe(200);expect(retry.json.data.planId).toBe(first.json.data.planId);
 expect(roots()).toEqual(before);expect(boundary.generate).toHaveBeenCalledTimes(modelCalls);
});
it('preserves committed coupon root after root acknowledgement loss',async()=>{
 setupCoupon();const db=boundary.db!,original=db.runTransaction.bind(db);let loseAck=true;
 db.runTransaction=async fn=>{let rootWrite=false;const value=await original(async tx=>fn({...tx,set(ref,data,options){if(ref.path.startsWith('plans/')&&data.status==='ready')rootWrite=true;tx.set(ref,data,options);}}));if(rootWrite&&loseAck){loseAck=false;throw Error('synthetic committed root ACK lost');}return value;};
 restoreDbBoundary=()=>{db.runTransaction=original;};
 const first=await runPlanner(couponBody());expect([200,500]).toContain(first.statusCode);expect(roots()).toHaveLength(1);
 await new Promise(resolve=>setTimeout(resolve,0));expect(boundary.db!.__get(COUPON).isUsed).toBe(true);
 const [path,root]=roots()[0];restoreDbBoundary();const modelCalls=boundary.generate.mock.calls.length;
 const retry=await runPlanner(couponBody());expect(retry.statusCode).toBe(200);expect(retry.json.data.planId).toBe(root.planId);
 expect(roots()).toHaveLength(1);expect(boundary.db!.__get(path)).toEqual(root);expect(boundary.generate).toHaveBeenCalledTimes(modelCalls);
});

it('keeps authenticated coupon consumption separate from a null plan owner',async()=>{
 setupCoupon();const body=couponBody();delete body.uid;const first=await runPlanner(body);expect(first.statusCode).toBe(200);
 const root=roots()[0][1];expect(root.uid).toBeNull();expect(root.verifiedHistoryUid).toBe(UID);expect(root.accessToken).toEqual(expect.any(String));
 expect(Object.keys(boundary.db!.__dump()).filter(x=>/^users\/[^/]+\/plans\//.test(x))).toHaveLength(0);
});
it('retains distinct anonymous plan owner and existing guest token policy',async()=>{
 setupCoupon();vi.stubEnv('FEATURE_GUEST_ANON_AUTH','true');const body=couponBody();delete body.uid;
 const first=await runPlanner(body,{'x-guest-anon-token':'synthetic-anon-token'});expect(first.statusCode).toBe(200);
 const root=roots()[0][1];expect(root.uid).toBe('synthetic-anon-owner');expect(root.verifiedHistoryUid).toBe(UID);expect(root.accessToken).toEqual(expect.any(String));
 expect(boundary.db!.__get(`users/${UID}/plans/${root.planId}`)).toBeUndefined();
 expect(boundary.db!.__get(`users/synthetic-anon-owner/plans/${root.planId}`)).toMatchObject({planId:root.planId});
});
it('cannot recover another account coupon or reveal the completed plan after account switch',async()=>{
 setupCoupon();const first=await runPlanner(couponBody());expect(first.statusCode).toBe(200);const before=roots(), calls=boundary.generate.mock.calls.length;
 boundary.authUid='synthetic-other-user';const retry=await runPlanner(couponBody());expect([403,404,409]).toContain(retry.statusCode);
 expect(JSON.stringify(retry.json)).not.toContain(first.json.data.planId);expect(roots()).toEqual(before);expect(boundary.generate).toHaveBeenCalledTimes(calls);
});
it('does not leave a consumed coupon behind on the early start-date rejection',async()=>{
 setupCoupon();const res=await runPlanner({...couponBody(),startDate:'2000-01-01'});expect(res.statusCode).toBe(400);
 expect(roots()).toHaveLength(0);expect(boundary.generate).not.toHaveBeenCalled();
 expect(boundary.db!.__get(COUPON).isUsed).toBe(false);
});

it.each([{pendingCapture:true},{usedOrderID:'SYNTHETIC-FOREIGN-ORDER'}])('does not consume a coupon with an unrelated capture lock %j',async lock=>{
 setupCoupon();boundary.db!.__set(COUPON,{...boundary.db!.__get(COUPON),...lock});const before=boundary.db!.__get(COUPON);
 const res=await runPlanner(couponBody());expect([403,409]).toContain(res.statusCode);expect(roots()).toHaveLength(0);
 expect(boundary.generate).not.toHaveBeenCalled();expect(boundary.db!.__get(COUPON)).toEqual(before);
});
it('does not restart active generation after an external boolean-only reset',async()=>{
 setupCoupon();let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
 boundary.generate.mockImplementationOnce(async()=>{await hold;return {response:{text:()=>JSON.stringify(generated),usageMetadata:{}}};});
 const first=runPlanner(couponBody());
 try {
  await vi.waitFor(()=>expect(boundary.generate).toHaveBeenCalledTimes(1));const consumed=boundary.db!.__get(COUPON);
  boundary.db!.__set(COUPON,{...consumed,isUsed:false,usedAt:null,usedOrderID:null,pendingCapture:false});
  const second=await runPlanner(couponBody());expect([403,409]).toContain(second.statusCode);
  expect(boundary.generate).toHaveBeenCalledTimes(1);expect(boundary.db!.__get(COUPON).consumptionId).toBe(consumed.consumptionId);
 } finally {release();await first;}
});

it('does not disclose a null-owner bearer token on coupon recovery',async()=>{
 setupCoupon();const body=couponBody();delete body.uid;const first=await runPlanner({...body});expect(first.statusCode).toBe(200);
 const before=roots(), root=before[0][1], calls=boundary.generate.mock.calls.length;const retry=await runPlanner({...body});
 expect(retry.statusCode).toBe(409);expect(JSON.stringify(retry.json)).not.toContain(root.accessToken);
 expect(roots()).toEqual(before);expect(boundary.generate).toHaveBeenCalledTimes(calls);expect(boundary.db!.__get(COUPON).isUsed).toBe(true);
});
it('recovers a distinct anonymous owner only with that current verified anonymous identity',async()=>{
 setupCoupon();vi.stubEnv('FEATURE_GUEST_ANON_AUTH','true');const body=couponBody();delete body.uid;
 const first=await runPlanner({...body},{'x-guest-anon-token':'synthetic-anon-token'});expect(first.statusCode).toBe(200);const before=roots(), calls=boundary.generate.mock.calls.length;
 const absentProof=await runPlanner({...body});expect(absentProof.statusCode).toBe(409);expect(JSON.stringify(absentProof.json)).not.toContain(before[0][1].accessToken);
 const retry=await runPlanner({...body},{'x-guest-anon-token':'synthetic-anon-token'});expect(retry.statusCode).toBe(200);
 expect(retry.json.data.planUrl).toBe(first.json.data.planUrl);expect(roots()).toEqual(before);expect(boundary.generate).toHaveBeenCalledTimes(calls);
});
it.each([['ko','쿠폰'],['en','coupon'],['ja','クーポン'],['zh','优惠券']])('returns usable %s coupon guidance without implying a paid transaction',async(language,word)=>{
 setupCoupon();const body={...couponBody(),language};const first=await runPlanner(body);expect(first.statusCode).toBe(200);
 const retry=await runPlanner({...body,startDate:'2099-02-22'});expect(retry.statusCode).toBe(409);expect(retry.json.details).toContain(word);
 expect(retry.json.code).toBe('AI_COUPON_CONFLICT');expect(retry.json.details).not.toContain('this payment');expect(retry.json.details).not.toContain('이 결제로');
});
it('keeps a completed root and consumed coupon when list recovery repeatedly fails',async()=>{
 setupCoupon();injectFailure('list');const first=await runPlanner(couponBody());expect(first.statusCode).toBe(500);const before=roots(), calls=boundary.generate.mock.calls.length;
 const retry=await runPlanner(couponBody());expect(retry.statusCode).toBe(500);expect(roots()).toEqual(before);expect(boundary.generate).toHaveBeenCalledTimes(calls);
 expect(boundary.db!.__get(COUPON).isUsed).toBe(true);
});

it('preserves a verified revision that also carries a coupon code without consuming that coupon',async()=>{
 setupCoupon();const couponBefore=boundary.db!.__get(COUPON);
 boundary.db!.__set('plans/synthetic-original-revision',{planId:'synthetic-original-revision',uid:UID,status:'ready',revisionCredits:2,revisionCount:0,itinerary:generated,input:{}});
 const res=await runPlanner({...couponBody(),revisionOf:'synthetic-original-revision'});expect(res.statusCode).toBe(200);
 expect(boundary.db!.__get(COUPON)).toEqual(couponBefore);expect(boundary.db!.__get('plans/synthetic-original-revision')).toMatchObject({revisionCredits:1,revisionCount:1});
 const created=boundary.db!.__get(`plans/${res.json.data.planId}`);expect(created).toMatchObject({uid:UID,isFreeCoupon:true,paymentSource:'ai-coupon'}); // Existing display provenance, not a new coupon consumption.
 expect(created.aiCouponBinding).toBeUndefined();expect(roots()).toHaveLength(2);
});
it('does not let an unverified revision claim bypass the coupon binding requirement',async()=>{
 setupCoupon();const couponBefore=boundary.db!.__get(COUPON);
 boundary.db!.__set('plans/synthetic-other-revision',{planId:'synthetic-other-revision',uid:'other-user',status:'ready',revisionCredits:2,itinerary:generated,input:{}});
 const res=await runPlanner({...couponBody(),revisionOf:'synthetic-other-revision'});expect(res.statusCode).toBe(403);expect(boundary.generate).not.toHaveBeenCalled();
 expect(boundary.db!.__get(COUPON)).toEqual(couponBefore);expect(roots()).toHaveLength(1);
});
