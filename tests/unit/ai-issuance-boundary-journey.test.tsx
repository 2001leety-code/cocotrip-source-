// @vitest-environment jsdom
/** Actual PurchaseSection + PayPal + planner hook with page-equivalent gating, synthetic SDK/auth/network only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ guest: false, user: { uid: 'synthetic-user', email: 'test@example.invalid' }, navigate: vi.fn(), authFetch: vi.fn(), clear: vi.fn(async () => {}), track: vi.fn(), paid: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: mocks.track }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: mocks.paid, trackBeginCheckout: vi.fn(), markPlannerPendingComplete: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }], clear: mocks.clear }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { get currentUser() { return mocks.guest ? null : {...mocks.user,getIdToken:async()=> 'synthetic-token'}; } } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, signInWithGoogle: vi.fn(), getAvailableAiCoupon: async () => null }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/discountFlags', () => ({ discountV2Enabled: () => false }));
vi.mock('@/lib/charterExtras', () => ({ charterOptionsBody: (o: unknown) => o }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/lib/charterUsd', () => ({ charterCheckoutExpectedUsd: () => undefined, charterUsdFromKrw: () => 100 }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('../../src/components/PayPalQrPanel', async () => {
  const R = await import('react');
  return { PayPalQrPanel: () => R.createElement('div', null, 'QR PANEL') };
});
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => mocks.navigate }));
vi.mock('@/lib/guestReader', () => ({ isGuestAnonEnabled: () => false, shouldAttachGuestAnonToken: () => false }));

import { recoveryKey } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
/** Real server statuses: success 200, capture 202 for recovery-pending, 409 for a create block / NOT_CAPTURED / generic errors. */
function json(url: string, body: unknown) {
  const value = (body || {}) as { ok?: boolean; code?: string; bookingStatus?: string };
  const status = value.ok === true ? 200
    : value.code === 'PAYMENT_RECOVERY_PENDING' && url.startsWith('/api/capture') ? 202 : 409;
  return { ok: status < 300, status, json: async () => body };
}
function route(table: Record<string, (body: Record<string, unknown>) => unknown>) {
  mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    const reply = table[url];
    if (!reply) throw new Error(`OFFLINE: unexpected ${url}`);
    return json(url, await reply(body));
  });
}
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100.00', currency: 'USD', payerName: 'Pay Er', payerEmail: 'payer@example.invalid' } });
const createOk = { ok: true, data: { orderID: 'ORD-1', usdAmount: '100.00', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000원', displayUSD: '$100.00 USD' } };
/** Server terminal proof (capturePaypalOrder PROMO path): proven full refund + confirmed booking transition. */

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});

function validTable(): string {
  return (
    '| Time | Spot | Transit | Insider Tip |\n' +
    '|---|---|---|---|\n' +
    '| 10:00 | Gamcheon Culture Village | Start point | Go early for photos |\n' +
    '| 12:30 | Jagalchi Market | Subway Line 1, 10 min | Try the fresh sashimi |\n' +
    '| 15:00 | Haeundae Beach | Bus 100, 15 min | Sunset spot |'
  );
}

function baseData(): Record<string, unknown> {
  return {
    marketingNarrative: 'A great first day exploring Busan with beaches and food.',
    themes: ['Food', 'Coast'],
    day1MarkdownTable: validTable(),
    spotDetails: [
      { spot: 'Gamcheon Culture Village', type: 'attraction', candidateId: 'attr-1', key: 'gamcheon', lat: 35.0975, lng: 129.0107 },
      { spot: 'Jagalchi Market', type: 'food', candidateId: 'food-1', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', address: 'Busan, South Korea' },
      { spot: 'Haeundae Beach', type: 'spot', candidateId: 'spot-1', name: 'Haeundae Beach', address: 'Busan, South Korea' },
    ],
    deferredCategories: ['Kpop'],
    reflectedConditions: ['Your travel dates'],
  };
}


import { MemoryRouter } from 'react-router-dom';
import { PurchaseSection } from '../../src/pages/PlannerPage/components/PurchaseSection';
import { QuickPreviewCard } from '../../src/pages/PlannerPage/components/QuickPreviewCard';
import { usePlannerHandlers } from '../../src/pages/PlannerPage/hooks/usePlannerHandlers';
import en from '../../src/i18n/locales/en.json';
const values = { regions: ['Busan'], cityKeys: ['busan'], durationDays: 3, pax: 2, reservation_status: 'nothing' };
let latest: ReturnType<typeof usePlannerHandlers>;
import { AiPlanIssuanceNoticePanel } from '../../src/components/AiPlanIssuanceNoticePanel';
import { readAiPlanNotices, settleAiPlanNoticesFromOwnerRead, isAiCheckoutHeldInThisTab } from '../../src/lib/aiPlanIssuanceNotice';
function BoundaryJourney() {
  const flow = usePlannerHandlers({ language:'en', userEmail:'test@example.invalid', setUserEmail:()=>{} });
  React.useEffect(() => { latest = flow; });
  return <><AiPlanIssuanceNoticePanel uid={mocks.user.uid} p={en.planner}/><button onClick={()=>flow.handleSubmit(values as never)}>Synthetic reviewed brief</button>
    <output data-testid="state">{flow.status}:{flow.planErrorCode}</output>
    {flow.status === 'quickSuccess' && flow.resultQuick && <>
      <QuickPreviewCard p={en.planner} language="en" resultQuick={flow.resultQuick}/>
      <PurchaseSection p={{...en.planner,paypalBookBtn:'Book now'}} language="en" userEmail="test@example.invalid" setUserEmail={()=>{}}
       isGeneratingPlan={flow.isGeneratingPlan} planError={flow.planError} resultQuick={flow.resultQuick}
       lastValues={flow.lastValues} revisionMode={false} revisionPlanId={null} revisionToken={null}
       onAiCheckoutStarted={flow.handleAiCheckoutStarted} onVerifiedPayPalFinal={flow.handleVerifiedPayPalFinal} onPaymentSuccess={flow.handlePaymentSuccess} onRevisionRegenerate={flow.handleRevisionRegenerate}/>
    </>}</>;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('new cross-component boundary, no real account/order/network',()=>{
  it.each([false,true,'timeout'])('capture final then full success=%s, including remount after failure', async mode=>{
    const success = mode === true;
    mocks.user = {uid:'synthetic-user-'+String(mode),email:'test@example.invalid'};
    createOk.data.orderID='ORDER-'+String(mode);
    sessionStorage.clear();
    Element.prototype.scrollIntoView=vi.fn(); window.scrollTo=vi.fn();
    vi.spyOn(console,'error').mockImplementation(()=>{});
    const requests: {url:string,body:unknown}[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      requests.push({url:String(url),body:JSON.parse(String(init?.body))});
      if(url==='/api/ai-planner-quick') return new Response(JSON.stringify({ok:true,data:baseData()}));
      if(url==='/api/ai-planner-full' && mode==='timeout') throw new DOMException('synthetic timeout','AbortError');
      if(url==='/api/ai-planner-full') return new Response(JSON.stringify(success ? {ok:true,data:{planId:'synthetic-plan',firestoreSaved:true}} : {ok:false,code:'INTERNAL_ERROR',error:'Synthetic generation failed'}),{status:success?200:503});
      throw new Error(`BLOCKED unexpected network ${url}`);
    }));
    route({'/api/createPaypalOrder':()=>createOk,'/api/capturePaypalOrder':()=>final(createOk.data.orderID)});
    let mounted=render(<MemoryRouter><BoundaryJourney/></MemoryRouter>);
    fireEvent.click(screen.getByText('Synthetic reviewed brief'));
    await screen.findByText('Book now');
    fireEvent.click(screen.getByText('Book now'));
    await waitFor(()=>expect(buttons).toHaveLength(1));
    await act(async()=>{await buttons[0].onApprove({orderID:createOk.data.orderID});});
    await waitFor(()=>expect(requests.filter(x=>x.url==='/api/ai-planner-full')).toHaveLength(1));
    expect(localStorage.getItem(recoveryKey('single'))).toBeNull();
    if(success){expect(mocks.navigate).toHaveBeenCalledWith('/my-plans/synthetic-plan');expect(readAiPlanNotices(mocks.user.uid).notices).toHaveLength(1);return;}
    expect(await screen.findByRole('alert')).toHaveTextContent(mode==='timeout'?'synthetic timeout':'Synthetic generation failed');
    expect(latest.planErrorCode).toBe(mode==='timeout'?'ABORT_TIMEOUT':'INTERNAL_ERROR');
    expect(screen.getAllByRole('link',{name:/WhatsApp/i}).length).toBeGreaterThan(0);
    expect(screen.queryByText('Book now')).toBeNull();
    expect(readAiPlanNotices(mocks.user.uid).notices).toHaveLength(1);
    expect(screen.queryByRole('button',{name:/Check this order|Retry.*generation|Retry.*plan/i})).toBeNull();
    expect(latest.lastValues.current).not.toBeNull();
    const buttonsAfterFailure=screen.getAllByRole('button').map(e=>e.textContent);
    console.log('OBSERVED_FAILURE_BUTTONS',JSON.stringify(buttonsAfterFailure));
    mounted.unmount();
    mounted=render(<MemoryRouter><BoundaryJourney/></MemoryRouter>);
    expect(latest.status).toBe('idle');expect(latest.lastValues.current).toBeNull();expect(latest.resultQuick).toBeNull();
    expect(screen.getByText(en.planner.aiIssuanceTitle)).toBeVisible(); expect(screen.queryByText('Book now')).toBeNull();
    fireEvent.click(screen.getByText('Synthetic reviewed brief')); await waitFor(()=>expect(latest.status).toBe('quickSuccess')); expect(screen.queryByText('Book now')).toBeNull();
    expect(requests.filter(x=>x.url==='/api/ai-planner-full')).toHaveLength(1);
    expect(mocks.authFetch.mock.calls.filter(c=>c[0]==='/api/createPaypalOrder')).toHaveLength(1);
    expect(mocks.authFetch.mock.calls.filter(c=>c[0]==='/api/capturePaypalOrder')).toHaveLength(1);
    expect(localStorage.getItem(recoveryKey('single'))).toBeNull();
  });
});


it('completed replay does not regenerate or resurrect pending/hold',async()=>{
 mocks.guest=false;mocks.user={uid:'complete-owner',email:'test@example.invalid'};
 const {result}=renderHook(()=>usePlannerHandlers({language:'en',userEmail:'',setUserEmail:()=>{}}));
 const scope={uid:mocks.user.uid,orderId:'COMPLETE-ORDER',attemptId:'attempt'};
 result.current.lastValues.current=values as never;result.current.handleAiCheckoutStarted(scope.attemptId,scope.uid);
 expect(result.current.handleVerifiedPayPalFinal(scope,scope.orderId)).toBe(true);
 const {linkAiPlanNotice}=await import('../../src/lib/aiPlanIssuanceNotice');linkAiPlanNotice(scope.uid,scope.orderId,scope.attemptId,'complete-plan');
 settleAiPlanNoticesFromOwnerRead({currentUid:scope.uid,viewerUid:scope.uid,planId:'complete-plan',fromCache:false,hasPendingWrites:false,data:{uid:scope.uid,planId:'complete-plan',status:'ready',input:{paypalOrderId:scope.orderId}}});
 expect(result.current.handleVerifiedPayPalFinal(scope,scope.orderId)).toBe('known-complete');
 expect(readAiPlanNotices(scope.uid).notices).toHaveLength(0);expect(isAiCheckoutHeldInThisTab()).toBe(false);
});
it.each([false,true])('changed brief or reload lacks pinned original input; replay=%s never starts full',async reload=>{
 mocks.guest=false;mocks.user={uid:'input-owner-'+String(reload),email:'test@example.invalid'};
 const {result}=renderHook(()=>usePlannerHandlers({language:'en',userEmail:'',setUserEmail:()=>{}}));
 result.current.lastValues.current=values as never;
 const scope={uid:mocks.user.uid,orderId:'INPUT-ORDER-'+String(reload),attemptId:'input-attempt'};
 if(!reload)result.current.handleAiCheckoutStarted(scope.attemptId,scope.uid);
 result.current.lastValues.current={...values,durationDays:7} as never;
 expect(result.current.handleVerifiedPayPalFinal(scope,scope.orderId)).toBe(false);
 expect(readAiPlanNotices(scope.uid).notices).toHaveLength(1);
 expect(mocks.navigate).not.toHaveBeenCalled();
});
it('unmounted flow links late full result but does not navigate',async()=>{
 mocks.guest=false;mocks.user={uid:'unmounted-owner',email:'test@example.invalid'};
 const mounted=renderHook(()=>usePlannerHandlers({language:'en',userEmail:'',setUserEmail:()=>{}}));
 const flow=mounted.result.current,scope={uid:mocks.user.uid,orderId:'UNMOUNTED-ORDER',attemptId:'unmounted-attempt'};
 flow.lastValues.current=values as never;flow.handleAiCheckoutStarted(scope.attemptId,scope.uid);expect(flow.handleVerifiedPayPalFinal(scope,scope.orderId)).toBe(true);
 let resolveResponse:(v:Response)=>void=()=>{};vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{resolveResponse=resolve;})));
 let running:Promise<void>;act(()=>{running=flow.handlePaymentSuccess(scope.orderId);});await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));mounted.unmount();
 await act(async()=>{resolveResponse(new Response(JSON.stringify({ok:true,data:{planId:'late-plan'}})));await running;});
 expect(mocks.navigate).not.toHaveBeenCalled();expect(readAiPlanNotices(scope.uid).notices[0].planId).toBe('late-plan');
});
it('late old-account failure shows only the generic account notice',async()=>{
 mocks.guest=false;mocks.user={uid:'old-account',email:'test@example.invalid'};
 const {result}=renderHook(()=>usePlannerHandlers({language:'en',userEmail:'',setUserEmail:()=>{}}));
 const flow=result.current,scope={uid:mocks.user.uid,orderId:'LATE-ERROR',attemptId:'late-error'};
 flow.lastValues.current=values as never;flow.handleAiCheckoutStarted(scope.attemptId,scope.uid);expect(flow.handleVerifiedPayPalFinal(scope,scope.orderId)).toBe(true);
 vi.stubGlobal('fetch',vi.fn(async()=>{mocks.user={uid:'new-account',email:'new@example.invalid'};return new Response(JSON.stringify({code:'INTERNAL_ERROR',details:'synthetic old-account private detail'}),{status:503});}));
 await act(async()=>{await flow.handlePaymentSuccess(scope.orderId);});
 expect(result.current.planErrorCode).toBe('AI_SCOPE_AUTH_CHANGED');expect(result.current.planError).not.toContain('private detail');expect(mocks.navigate).not.toHaveBeenCalled();
});
it.each([false,true])('explicit guest normal issuance stays supported; account-change=%s blocks late navigation',async changed=>{
 mocks.guest=true;const {result}=renderHook(()=>usePlannerHandlers({language:'en',userEmail:'',setUserEmail:()=>{}}));
 result.current.lastValues.current=values as never;
 const scope={uid:null,orderId:'GUEST-'+String(changed),attemptId:'guest-attempt'};
 result.current.lastValues.current=values as never;result.current.handleAiCheckoutStarted(scope.attemptId,scope.uid);
 expect(result.current.handleVerifiedPayPalFinal(scope,scope.orderId)).toBe(true);
 vi.stubGlobal('fetch',vi.fn(async()=>{if(changed)mocks.guest=false;return new Response(JSON.stringify({ok:true,data:{planId:'guest-plan'}}));}));
 await act(async()=>{await result.current.handlePaymentSuccess(scope.orderId);});
 expect(fetch).toHaveBeenCalledTimes(1);
 if(changed){expect(mocks.navigate).not.toHaveBeenCalled();expect(result.current.planErrorCode).toBe('AI_SCOPE_AUTH_CHANGED');}
 else expect(mocks.navigate).toHaveBeenCalledWith('/my-plans/guest-plan');
 mocks.guest=false;
});
