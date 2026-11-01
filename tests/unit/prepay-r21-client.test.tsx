// @vitest-environment jsdom
/**
 * 2026-11-01 B6-1 r21 — 결과 보관 불변식(B-I1~B-I5)과 적대적 r20 재현. 실제 React(CartPanel/CartCheckout/PayPalBookingButton) +
 *   실제 paymentRecovery, authFetch·PayPal SDK 모의(로그인 장바구니 = 공유 목록 모의). 실 PayPal·네트워크 0.
 *
 * B-I1 기록: 최종 적용 결과(final·review·not_captured)는 경로(새 capture·일반 오류 뒤 자동 증거·수동 확인)와 무관하게 공통 적용
 *      지점에서, 그 결과를 적용한 화면이 언마운트돼 있으면 모듈에 남는다. 첫 분류(일반 오류)는 남지 않는다.
 * B-I2 소멸: 보관 결과는 결과 화면을 닫을 때·화면이 다른 미해결 주문을 고를 때·화면이 자기 결과/새 결제로 넘어갈 때·
 *      장바구니 패널 닫기·Edit cart 에서 사라지고, 사라진 결과는 다시 나타나지 않는다.
 * B-I3 범위: 보관 결과는 flow·상품 종류·상품 식별값(투어·구간·날짜)이 같은 화면에서만, 다른 미해결 주문이 선택돼 있지 않을 때만 보인다.
 * B-I4 문구: 보관 미결제 결과는 기록 때의 맥락(QR 흐름 = 재결제 금지, 플래너 사전 거부 = 사유 + QR 대체 숨김)을 그대로 보인다.
 * B-I5 재결제 금지: 확정·검토 결과가 보이는 동안 그 화면에 'Book now'·'Confirm & pay' 가 없다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), items: [] as unknown[], listeners: new Set<() => void>(), createIds: [] as string[] }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null, trackPlannerOutcomeFromStatus: () => {}, markPlannerPendingComplete: () => {} }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1', email: 'u@example.invalid' } }) }));
vi.mock('@/hooks/useCart', async () => {
  const R = await import('react');
  const emit = () => { for (const f of [...mocks.listeners]) f(); };
  return {
    useCart: () => {
      const items = R.useSyncExternalStore((fn: () => void) => { mocks.listeners.add(fn); return () => { mocks.listeners.delete(fn); }; }, () => mocks.items);
      return { items, loading: false, clear: async () => { mocks.items = []; emit(); }, remove: vi.fn(), add: vi.fn(), isInCart: () => false };
    },
  };
});
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { currentUser: null } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/discountFlags', () => ({ discountV2Enabled: () => false }));
vi.mock('@/lib/charterExtras', () => ({ charterOptionsBody: (o: unknown) => o }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/lib/aiPlannerPrice', () => ({ fillPrice: (s: string) => s }));
vi.mock('@/lib/charterUsd', () => ({ charterCheckoutExpectedUsd: () => undefined, charterUsdFromKrw: () => 100 }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('@/lib/cart-types', async (orig) => ({ ...(await orig() as object), isCartEnabled: () => true }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children), useNavigate: () => vi.fn() };
});

import * as PR from '@/lib/paymentRecovery';
import { CartPanel } from '@/components/CartButton';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';

type BC = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: BC[] = [];
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const FINAL = (id: string) => ({ ok: true, finalized: true, data: { orderID: id, amount: '100.00', currency: 'USD' } });
const REVIEW = (id: string) => ({ ok: true, bookingStatus: 'PAYMENT_REVIEW', paymentCaptured: true, captureID: 'CAP-1', data: { orderID: id } });
const VOIDED = (id: string, flow = 'single', extra: Record<string, unknown> = {}) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: id, flow, paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: false, evidence: 'order_voided', error: 'Payment was not completed. You can start a new payment.', ...extra });
const GENERIC = { ok: false, code: 'INTERNAL_ERROR', error: 'Internal error' };
type Call = { url: string; resolve: (v: unknown) => void };
const q: Call[] = [];
const settle = async (ms = 15) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const answer = async (i: number, status: number, body: unknown) => { await act(async () => { q[i].resolve(reply(status, body)); }); await settle(); };
const has = (t: string | RegExp) => screen.queryAllByText(t).length > 0;
const btn = (t: string) => screen.queryAllByText(t)[0] as HTMLButtonElement | undefined;
const PAY_AGAIN = /You can start a new payment|You can pay again/;
const DATE = '2099-12-05';
const ITEM = { id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, addedAt: 1, booking: { productType: 'airport_pickup', dateStart: '2026-12-01', passengers: 2 } };
const P_PROPS = { paypalBookBtn: 'Book now', paypalRetry: 'Retry', errors: { DIETARY_COVERAGE_UNAVAILABLE: 'Some meals cannot be matched to your diet' } };
const openCart = async () => { await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); }); await settle(); };
const closeX = async () => { const x = document.querySelector('.customer-cart-header button:last-child') as HTMLButtonElement; await act(async () => { fireEvent.click(x); }); await settle(); };
const singlePanel = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const otherTab = async (ops: Array<[string, string | null]>) => {
  await act(async () => {
    for (const [k, v] of ops) {
      const old = localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      window.dispatchEvent(new StorageEvent('storage', { key: k, oldValue: old, newValue: v }));
    }
  });
  await settle();
};
const otherTabFinishes = (id: string) => otherTab([[PR.doneRecoveryKey(id), String(Date.now())], [PR.orderRecoveryKey(id), null]]);
const otherTabPending = (id: string, flow: 'single' | 'cart' = 'single', productType = 'charter_dmz') =>
  otherTab([[PR.orderRecoveryKey(id), JSON.stringify({ orderID: id, flow, paymentStatus: 'CAPTURE_UNKNOWN', review: false, ...(flow === 'single' ? { productType } : {}), updatedAt: Date.now(), createdAt: Date.now(), v: 2 })]]);
const charter = (productType = 'charter_dmz', dateStart = DATE) => <PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" dateStart={dateStart} p={P_PROPS} />;
const planner = () => <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" dateStart={DATE} keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={P_PROPS} />;

async function singleCaptureThenUnmount(orderID: string, productType = 'charter_dmz', dateStart = DATE) {
  mocks.createIds.push(orderID);
  const view = render(charter(productType, dateStart));
  fireEvent.click(await screen.findByText('Book now'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  act(() => { void buttons[buttons.length - 1].onApprove({ orderID }); });
  await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
  await settle();
  view.unmount();
  await settle();
}
async function cartCaptureThenClose(orderID: string) {
  mocks.items = [ITEM]; mocks.createIds.push(orderID);
  render(<CartPanel />);
  await openCart();
  fireEvent.click(screen.getByText('Proceed to checkout'));
  fireEvent.click(await screen.findByText('Confirm & pay'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  act(() => { void buttons[buttons.length - 1].onApprove({ orderID }); });
  await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
  await settle();
  await closeX();
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0; q.length = 0; mocks.createIds = [];
  PR.resetPaymentRecoveryMemory(); localStorage.clear(); mocks.items = [];
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network blocked'); }));
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client'); vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: BC) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
  mocks.authFetch.mockImplementation((url: string) => new Promise((resolve) => {
    if (url === '/api/createCartOrder') { resolve(reply(200, { ok: true, data: { orderID: mocks.createIds.shift() || 'CART-F', usdAmount: '100.00', totalKRW: 135000 } })); return; }
    if (url === '/api/createPaypalOrder') { resolve(reply(200, { ok: true, data: { orderID: mocks.createIds.shift() || 'ORD-F', usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } })); return; }
    q.push({ url, resolve });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('B-I2 repros — a stored "not paid" result never outlives another order\'s confirmation (N1)', () => {
  it('N1a: A voided while unmounted → remount (notice) → another tab adds B → check B → final → Done → no "pay again", no stale notice', async () => {
    await singleCaptureThenUnmount('ORD-A');
    await answer(0, 409, VOIDED('ORD-A'));
    render(charter()); await settle();
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    await otherTabPending('ORD-B');
    expect(singlePanel()).toBe('ORD-B');
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(q.length - 1, 200, FINAL('ORD-B'));
    expect(has('Booking Confirmed!')).toBe(true);
    fireEvent.click(screen.getByText('Done')); await settle();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('N1b: A voided (stored) → the server later shows A CAPTURED (webhook conflict) → panel "Payment received" → final → Done → no "not completed"', async () => {
    await singleCaptureThenUnmount('ORD-A');
    await answer(0, 409, VOIDED('ORD-A'));
    render(charter()); await settle();
    await act(async () => { PR.placeForeignPending({ orderID: 'ORD-A', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'charter_dmz' }); });
    await settle();
    expect(has('Payment received; your booking is being recorded')).toBe(true);
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(q.length - 1, 200, FINAL('ORD-A'));
    expect(has('Booking Confirmed!')).toBe(true);
    fireEvent.click(screen.getByText('Done')); await settle();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('N1c: A voided (stored) → B pending → B finished in another tab → no "pay again"', async () => {
    await singleCaptureThenUnmount('ORD-A');
    await answer(0, 409, VOIDED('ORD-A'));
    render(charter()); await settle();
    await otherTabPending('ORD-B');
    await otherTabFinishes('ORD-B');
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('N1d: stored review A → Done → panel (review pointer) → check → final → Done → review screen not shown again', async () => {
    await singleCaptureThenUnmount('ORD-A');
    await answer(0, 200, REVIEW('ORD-A'));
    render(charter()); await settle();
    expect(has('Payment received')).toBe(true);
    fireEvent.click(screen.getByText('Done')); await settle();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(q.length - 1, 200, FINAL('ORD-A'));
    expect(has('Booking Confirmed!')).toBe(true);
    fireEvent.click(screen.getByText('Done')); await settle();
    expect(has('Payment received')).toBe(false);
  });
});

describe('B-I1 repros — the FINAL applied result is kept, whatever the path (N2·N2b·N3)', () => {
  it('N2 single: unmount → capture 500 → evidence final → remount → confirmation, no Book now', async () => {
    await singleCaptureThenUnmount('ORD-E');
    await answer(0, 500, GENERIC);
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(2));
    await answer(1, 200, FINAL('ORD-E'));
    render(charter()); await settle();
    expect(PR.isRecoveryDone('ORD-E')).toBe(true);
    expect(has('Booking Confirmed!')).toBe(true);
    expect(btn('Book now')).toBeUndefined();
  });
  it('N2b single: remount BEFORE the evidence → evidence final → the remounted screen shows the confirmation', async () => {
    await singleCaptureThenUnmount('ORD-E');
    render(charter()); await settle();
    await answer(0, 500, GENERIC);
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(2));
    await answer(1, 200, FINAL('ORD-E'));
    expect(has('Booking Confirmed!')).toBe(true);
    expect(btn('Book now')).toBeUndefined();
  });
  it('N3 cart: X → capture 500 → evidence final → reopen → confirmation', async () => {
    await cartCaptureThenClose('CART-E');
    await answer(0, 500, GENERIC);
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(2));
    await answer(1, 200, FINAL('CART-E'));
    await openCart();
    expect(PR.isRecoveryDone('CART-E')).toBe(true);
    expect(has('Booking confirmed!')).toBe(true);
  });
  it('a manual "Check this order" whose screen unmounts before the answer keeps the result too', async () => {
    PR.saveRecoveryOrder({ orderID: 'ORD-M', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    const view = render(charter()); await settle();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    view.unmount();
    await answer(0, 200, FINAL('ORD-M'));
    render(charter()); await settle();
    expect(has('Booking Confirmed!')).toBe(true);
  });
});

describe('B-I3 / B-I4 / cart Edit cart (N4·N5·notice context)', () => {
  it('N4: a confirmation for the 12-05 Danyang order never shows on the 12-20 screen of the same productType', async () => {
    await singleCaptureThenUnmount('ORD-DY', 'charter_seoul_suburb', '2099-12-05');
    await answer(0, 200, FINAL('ORD-DY'));
    render(charter('charter_seoul_suburb', '2099-12-20')); await settle();
    expect(has('Booking Confirmed!')).toBe(false);
    cleanup();
    render(charter('charter_seoul_suburb', '2099-12-05')); await settle();
    expect(has('Booking Confirmed!')).toBe(true);
    expect(has('ORD-DY')).toBe(true);
  });
  it('N5: stored cart "not paid" screen → ← Edit cart → back on the cart list (Proceed to checkout)', async () => {
    await cartCaptureThenClose('CART-V');
    await answer(0, 409, VOIDED('CART-V', 'cart'));
    await openCart();
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    fireEvent.click(screen.getByText('← Edit cart')); await settle();
    expect(btn('Proceed to checkout')).toBeDefined();
  });
  it('a stored planner pre-capture refusal shows its reason and hides the QR fallback (same rule as the mounted screen)', async () => {
    await singleCaptureThenUnmount('ORD-P');
    await answer(0, 422, VOIDED('ORD-P', 'single', { preCaptureCode: 'DIETARY_COVERAGE_UNAVAILABLE' }));
    render(charter()); await settle();
    expect(has('Some meals cannot be matched to your diet')).toBe(true);
    expect(has(/Pay via QR/)).toBe(false);
  });
  it('a stored QR-flow "not paid" result says "do not pay again", never "you can pay again"', async () => {
    PR.recordCaptureResult({ orderID: 'ORD-Q', flow: 'single', productType: 'charter_dmz', key: PR.resultKeyOf('charter_dmz', undefined, undefined, undefined, DATE), notice: { kind: 'warn' }, outcome: { kind: 'not_captured', message: 'x' } });
    render(charter()); await settle();
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.warn)).toBe(true);
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('a plain stored "not paid" result keeps the QR fallback and the 4-language text', async () => {
    PR.recordCaptureResult({ orderID: 'ORD-N', flow: 'single', productType: 'charter_dmz', key: PR.resultKeyOf('charter_dmz', undefined, undefined, undefined, DATE), notice: { kind: 'plain' }, outcome: { kind: 'not_captured', message: 'x' } });
    render(charter()); await settle();
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    expect(has(/Pay via QR/)).toBe(true);
  });
});

// ── B invariant combination matrix ───────────────────────────────────────────────────────────────────────
type Flow = 'single' | 'cart' | 'planner';
type Kind = 'final' | 'review' | 'not_captured';
const outcomeOf = (kind: Kind, id: string): PR.CaptureOutcome => (kind === 'final' ? { kind: 'final', data: { orderID: id, amount: '100.00' } }
  : kind === 'review' ? { kind: 'review', captured: true, captureID: 'CAP-1' } : { kind: 'not_captured', message: 'x' });
const productOf = (flow: Flow) => (flow === 'planner' ? 'ai-planner-full' : flow === 'single' ? 'charter_dmz' : undefined);
function recordX(flow: Flow, kind: Kind, relation: 'same' | 'otherProduct') {
  const key = flow === 'cart' ? undefined : PR.resultKeyOf(productOf(flow), undefined, undefined, undefined, relation === 'same' ? DATE : '2099-12-31');
  PR.recordCaptureResult({ orderID: 'X-1', flow: flow === 'cart' ? 'cart' : 'single', ...(flow === 'cart' ? {} : { productType: flow === 'planner' ? 'ai_planner_full' : 'charter_dmz' }), ...(key ? { key } : {}), notice: { kind: 'plain' }, outcome: outcomeOf(kind, 'X-1') });
}
async function mountScreen(flow: Flow) {
  if (flow === 'cart') { mocks.items = [ITEM]; render(<CartPanel />); await openCart(); return; }
  render(flow === 'planner' ? planner() : charter()); await settle();
}
const visibleText = (flow: Flow, kind: Kind) => (kind === 'final' ? (flow === 'cart' ? 'Booking confirmed!' : 'Booking Confirmed!') : kind === 'review' ? 'Payment received' : PR.PAYMENT_RECOVERY_COPY.en.notCaptured);
const shown = (flow: Flow, kind: Kind) => has(visibleText(flow, kind));
async function closeResult(flow: Flow, kind: Kind) {
  if (kind === 'not_captured') {
    if (flow === 'cart') fireEvent.click(screen.getByText('← Edit cart'));
    else fireEvent.click(screen.getByText('Retry'));
  } else {
    fireEvent.click(screen.getByText('Done'));
  }
  await settle();
}
async function selectOtherOrder(flow: Flow) {
  await otherTabPending('Y-1', flow === 'cart' ? 'cart' : 'single', flow === 'planner' ? 'ai_planner_full' : 'charter_dmz');
}
const FLOWS: Flow[] = ['single', 'cart', 'planner'];
const KINDS: Kind[] = ['final', 'review', 'not_captured'];
const MOUNTS = ['remount', 'kept'] as const;
const expectVisible = (flow: Flow, kind: Kind) => !(flow === 'planner' && kind === 'final'); // the planner's CAPTURED pointer owns issuance

const visibleCases = FLOWS.flatMap((flow) => KINDS.filter((kind) => expectVisible(flow, kind)).flatMap((kind) => MOUNTS.flatMap((mount) => (['close', 'otherOrderSelected', 'otherTabDone'] as const).map((end) => [flow, kind, mount, end] as const))));
describe('B invariant matrix — same order: visible, no pay button, and the end actions', () => {
  it.each(visibleCases)('%s × %s × %s × %s', async (flow, kind, mount, end) => {
    if (mount === 'remount') { recordX(flow, kind, 'same'); await mountScreen(flow); } else { await mountScreen(flow); await act(async () => { recordX(flow, kind, 'same'); }); await settle(); }
    expect(shown(flow, kind)).toBe(true);
    if (kind !== 'not_captured') { expect(btn('Book now')).toBeUndefined(); expect(btn('Confirm & pay')).toBeUndefined(); } // B-I5
    if (end === 'close') {
      await closeResult(flow, kind);
      expect(shown(flow, kind)).toBe(false);
      cleanup(); await mountScreen(flow);
      expect(shown(flow, kind)).toBe(false);
    } else if (end === 'otherOrderSelected') {
      await selectOtherOrder(flow);
      expect(shown(flow, kind)).toBe(false);
      await otherTabFinishes('Y-1');
      expect(shown(flow, kind)).toBe(false);
    } else {
      await otherTabFinishes('X-1');
      expect(shown(flow, kind)).toBe(true);
    }
  });
});

const hiddenCases = FLOWS.flatMap((flow) => KINDS.flatMap((kind) => MOUNTS.flatMap((mount) => {
  const rows: Array<readonly [Flow, Kind, 'remount' | 'kept', 'otherOrder' | 'otherProduct' | 'plannerFinal']> = [];
  rows.push([flow, kind, mount, 'otherOrder'] as const);
  if (flow !== 'cart') rows.push([flow, kind, mount, 'otherProduct'] as const);
  if (!expectVisible(flow, kind)) rows.push([flow, kind, mount, 'plannerFinal'] as const);
  return rows;
})));
describe('B invariant matrix — other order selected / same productType other product / planner final: never visible', () => {
  it.each(hiddenCases)('%s × %s × %s × %s', async (flow, kind, mount, relation) => {
    const doRecord = () => recordX(flow, kind, relation === 'otherProduct' ? 'otherProduct' : 'same');
    if (relation === 'otherOrder') PR.saveRecoveryOrder({ orderID: 'Y-1', flow: flow === 'cart' ? 'cart' : 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, ...(flow === 'cart' ? {} : { productType: flow === 'planner' ? 'ai_planner_full' : 'charter_dmz' }) });
    if (mount === 'remount') { doRecord(); await mountScreen(flow); } else { await mountScreen(flow); await act(async () => { doRecord(); }); await settle(); }
    expect(shown(flow, kind)).toBe(false);
    if (relation === 'otherOrder') { // dismissed for good: finishing Y never revives X's result
      await otherTabFinishes('Y-1');
      expect(shown(flow, kind)).toBe(false);
    }
  });
});
