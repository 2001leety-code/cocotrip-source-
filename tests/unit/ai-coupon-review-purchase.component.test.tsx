// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestedAiCouponResult } from '../../src/lib/aiCouponPresentation';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

type PaymentProps = { canStartAiCheckout: () => boolean; onPaymentSuccess: (order: string) => void; onVerifiedPayPalFinal: (scope: null, order: string) => boolean; [key: string]: unknown };
const fake = vi.hoisted(() => ({
  user: { uid: 'owner-a' } as { uid: string } | null, currentUid: 'owner-a' as string | null,
  loading: false, pending: false, lookup: vi.fn(), paymentProps: [] as PaymentProps[], mounts: 0,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user, loading: fake.loading }) }));
vi.mock('@/lib/firebase-auth', () => ({ auth: { get currentUser() { return fake.currentUid ? { uid: fake.currentUid } : null; } } }));
vi.mock('@/lib/firebase', () => ({ getRequestedAiCoupon: fake.lookup, signInWithGoogle: vi.fn() }));
vi.mock('@/hooks/useAiPlanNotices', () => ({ useAiPlanNotices: () => ({ notices: fake.pending ? [{}] : [], tabHold: false }) }));
vi.mock('@/lib/aiPlanIssuanceNotice', () => ({ isAiCheckoutHeldInThisTab: () => false, readAiPlanNotices: () => ({ notices: fake.pending ? [{}] : [] }) }));
vi.mock('@/lib/guestReader', () => ({ isGuestAnonEnabled: () => false }));
vi.mock('@/components/PayPalBookingButton', () => ({ PayPalBookingButton: (props: PaymentProps) => {
  fake.paymentProps.push(props);
  React.useEffect(() => { fake.mounts += 1; }, []);
  return <div data-testid="paypal-provider">PayPal and QR stub</div>;
} }));
import { PurchaseSection } from '../../src/pages/PlannerPage/components/PurchaseSection';
import { translations } from '../../src/i18n';

const available = (code = 'NORMAL'): RequestedAiCouponResult => ({ state: 'available', coupon: { code, maxDays: 3, expiresAt: Date.UTC(2099, 0, 1) } });
let go: ReturnType<typeof useNavigate>;
function Navigation() { const navigate = useNavigate(); React.useLayoutEffect(() => { go = navigate; }, [navigate]); return null; }
function setup(path = '/planner?coupon=NORMAL', language: keyof typeof translations = 'en') {
  const props = {
    p: translations[language].planner, language, userEmail: 'test@example.invalid', setUserEmail: vi.fn(),
    isGeneratingPlan: false, planError: null, resultQuick: {},
    lastValues: { current: { durationDays: 3, regions: ['Seoul'] } as unknown as PlannerFormValues },
    revisionMode: false, revisionPlanId: null as string | null, revisionToken: null,
    onPaymentSuccess: vi.fn(), onVerifiedPayPalFinal: vi.fn(() => true), onRevisionRegenerate: vi.fn(),
  };
  const view = render(<MemoryRouter initialEntries={[path]}><Navigation /><PurchaseSection {...props} /></MemoryRouter>);
  const rerender = () => view.rerender(<MemoryRouter initialEntries={[path]}><Navigation /><PurchaseSection {...props} /></MemoryRouter>);
  return { ...view, props, rerender };
}
function expectBlocked() {
  expect(screen.queryByTestId('paypal-provider')).toBeNull();
  for (const language of ['en', 'ko', 'ja', 'zh'] as const) {
    expect(screen.queryByText(translations[language].planner.aiCouponApplied)).toBeNull();
    expect(screen.queryByRole('button', { name: translations[language].planner.aiCouponProceed })).toBeNull();
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.user = { uid: 'owner-a' }; fake.currentUid = 'owner-a'; fake.loading = false; fake.pending = false;
  fake.paymentProps = []; fake.mounts = 0;
  fake.lookup.mockReset(); fake.lookup.mockResolvedValue(available());
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('No network allowed'))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('explicit requested-coupon UI boundary', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as const)('renders review/support/recheck in %s without any checkout provider', async language => {
    fake.lookup.mockResolvedValue({ state: 'review' });
    const { props } = setup('/planner?coupon=LEGACY', language);
    expectBlocked();
    const p = translations[language].planner;
    expect(await screen.findByText(p.aiCouponReviewBody)).toBeVisible();
    expect(screen.getByRole('link', { name: p.aiCouponSupport })).toHaveAttribute('href', 'https://wa.me/821087140611');
    const retry = screen.getByRole('button', { name: p.aiCouponRecheck });
    expect(retry.className).toContain('min-h-[44px]');
    expect(retry.className).toContain('focus-visible');
    fireEvent.click(retry);
    await waitFor(() => expect(fake.lookup).toHaveBeenCalledTimes(2));
    expectBlocked(); expect(fake.mounts).toBe(0); expect(props.onPaymentSuccess).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'error'] as const)('withholds free and paid starts for %s, including retry', async state => {
    fake.lookup.mockResolvedValue({ state });
    const { props } = setup();
    await screen.findByText(state === 'error' ? translations.en.planner.aiCouponLookupError : translations.en.planner.aiCouponUnavailable);
    expectBlocked();
    fireEvent.click(screen.getByRole('button', { name: translations.en.planner.aiCouponRecheck }));
    await waitFor(() => expect(fake.lookup).toHaveBeenCalledTimes(2));
    expect(fake.mounts).toBe(0); expect(props.onPaymentSuccess).not.toHaveBeenCalled();
  });
  it.each(['', '%20'])('does not treat explicit empty/blank coupon %s as no parameter', async code => {
    fake.lookup.mockResolvedValue({ state: 'unavailable' });
    setup('/planner?coupon=' + code);
    await screen.findByText(translations.en.planner.aiCouponUnavailable);
    expectBlocked(); expect(fake.mounts).toBe(0);
  });
  it('holds loading and rejected requests without mounting PayPal/QR or free callbacks', async () => {
    let reject!: (reason: Error) => void;
    fake.lookup.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { props } = setup();
    expect(screen.getByText(translations.en.planner.aiCouponChecking)).toBeVisible(); expectBlocked();
    await act(async () => { reject(new Error('offline')); });
    expect(screen.getByRole('alert')).toHaveTextContent(translations.en.planner.aiCouponLookupError);
    expectBlocked(); expect(fake.mounts).toBe(0); expect(props.onPaymentSuccess).not.toHaveBeenCalled();
  });
  it.each([null, {}, { state: 'available' }, { state: 'available', coupon: { code: 'OTHER', maxDays: 3, expiresAt: null } }])('rejects malformed/mismatched adapter result %j', async result => {
    fake.lookup.mockResolvedValue(result); setup();
    await screen.findByText(translations.en.planner.aiCouponUnavailable); expectBlocked();
  });
  it('keeps normal free-coupon callback and double-click guard', async () => {
    const { props } = setup();
    const button = await screen.findByRole('button', { name: translations.en.planner.aiCouponProceed });
    fireEvent.click(button); fireEvent.click(button);
    expect(props.onPaymentSuccess).toHaveBeenCalledExactlyOnceWith('', 'NORMAL'); expect(fake.mounts).toBe(0);
  });
  it('preserves normal no-coupon pricing/payload and existing pending-issuance hold', () => {
    const view = setup('/planner');
    expect(fake.mounts).toBe(1); expect(fake.lookup).not.toHaveBeenCalled();
    const payment = fake.paymentProps.at(-1)!;
    expect(payment).toMatchObject({ productType: 'ai-planner-full', passengers: 1, dateStart: '', dateEnd: '', priceKRW: 13365, expectedUSD: 9.9 });
    expect(payment.onPaymentSuccess).toBe(view.props.onPaymentSuccess);
    expect(payment.onVerifiedPayPalFinal).toBe(view.props.onVerifiedPayPalFinal);
    expect(payment.canStartAiCheckout()).toBe(true);
    fake.pending = true; view.rerender();
    expect(screen.queryByTestId('paypal-provider')).toBeNull(); expect(payment.canStartAiCheckout()).toBe(false);
  });
  it('invalidates loaded A data before B lookup, rejects A late results, logout and auth restoration', async () => {
    const resolves: ((value: RequestedAiCouponResult) => void)[] = [];
    fake.lookup.mockImplementation(() => new Promise(resolve => { resolves.push(resolve); }));
    const view = setup();
    fake.user = { uid: 'owner-b' }; fake.currentUid = 'owner-b'; view.rerender(); expectBlocked();
    await act(async () => { resolves[1](available()); });
    expect(screen.getByText(translations.en.planner.aiCouponApplied)).toBeVisible();
    await act(async () => { resolves[0]({ state: 'review' }); });
    expect(screen.getByText(translations.en.planner.aiCouponApplied)).toBeVisible();
    fake.user = null; fake.currentUid = null; view.rerender(); expectBlocked();
    fake.loading = true; view.rerender(); expectBlocked();
    fake.user = { uid: 'owner-b' }; fake.currentUid = 'owner-b'; fake.loading = false; view.rerender();
    // A restored auth session must be freshly checked, not reuse B's pre-logout lookup.
    expectBlocked();
  });
  it('rejects code, days, preview and submitted-context changes including a ref-only mutation at click time', async () => {
    const view = setup();
    let button = await screen.findByRole('button', { name: translations.en.planner.aiCouponProceed });
    view.props.lastValues.current = { ...view.props.lastValues.current, regions: ['Busan'] };
    fireEvent.click(button); expect(view.props.onPaymentSuccess).not.toHaveBeenCalled();
    fake.lookup.mockImplementation(() => new Promise(() => {}));
    view.rerender(); expectBlocked();
    view.props.lastValues.current = { ...view.props.lastValues.current, durationDays: 4 };
    view.rerender(); expectBlocked(); expect(fake.lookup).toHaveBeenLastCalledWith('owner-a', 'NORMAL', 4);
    view.props.lastValues.current = { ...view.props.lastValues.current, durationDays: 3 };
    fake.lookup.mockResolvedValue(available()); view.rerender();
    button = await screen.findByRole('button', { name: translations.en.planner.aiCouponProceed });
    expect(button).toBeVisible();
    fake.lookup.mockImplementation(() => new Promise(() => {}));
    view.props.resultQuick = {}; view.rerender(); expectBlocked();
    await act(async () => { go('/planner?coupon=LEGACY'); }); expectBlocked();
    expect(fake.lookup).toHaveBeenLastCalledWith('owner-a', 'LEGACY', 3);
  });
  it('blocks old SDK NEW starts on a coupon transition but preserves verified payment completion', async () => {
    const view = setup('/planner');
    const payment = fake.paymentProps.at(-1)!;
    expect(payment.canStartAiCheckout()).toBe(true);
    fake.lookup.mockResolvedValue({ state: 'review' });
    await act(async () => { go('/planner?coupon=LEGACY'); });
    expectBlocked(); expect(payment.canStartAiCheckout()).toBe(false);
    expect(payment.onVerifiedPayPalFinal(null, 'VERIFIED-OLD')).toBe(true);
    payment.onPaymentSuccess('VERIFIED-OLD');
    expect(view.props.onPaymentSuccess).toHaveBeenCalledWith('VERIFIED-OLD');
    expect(view.props.onVerifiedPayPalFinal).toHaveBeenCalledWith(null, 'VERIFIED-OLD');
    view.unmount(); expect(payment.canStartAiCheckout()).toBe(false);
  });
  it('keeps fresh remount/refresh pending until its own coupon read finishes', async () => {
    const view = setup(); await screen.findByText(translations.en.planner.aiCouponApplied); view.unmount();
    fake.lookup.mockImplementation(() => new Promise(() => {})); setup(); expectBlocked(); expect(fake.mounts).toBe(0);
  });
  it.each(['query', 'account'] as const)('never revives a departed SDK start after an ABA %s transition', async kind => {
    const view = setup('/planner');
    const oldPayment = fake.paymentProps.at(-1)!;
    expect(oldPayment.canStartAiCheckout()).toBe(true);
    if (kind === 'query') {
      fake.lookup.mockResolvedValue({ state: 'review' });
      await act(async () => { go('/planner?coupon=LEGACY'); });
      expect(oldPayment.canStartAiCheckout()).toBe(false);
      await act(async () => { go('/planner'); });
    } else {
      fake.user = { uid: 'owner-b' }; fake.currentUid = 'owner-b'; view.rerender();
      expect(oldPayment.canStartAiCheckout()).toBe(false);
      fake.user = { uid: 'owner-a' }; fake.currentUid = 'owner-a'; view.rerender();
    }
    expect(oldPayment.canStartAiCheckout()).toBe(false);
    expect(fake.paymentProps.at(-1)!.canStartAiCheckout()).toBe(true);
    expect(oldPayment.onVerifiedPayPalFinal(null, 'VERIFIED-ABA')).toBe(true);
    oldPayment.onPaymentSuccess('VERIFIED-ABA');
    expect(view.props.onPaymentSuccess).toHaveBeenCalledWith('VERIFIED-ABA');
  });
  it('ignores a late old-code response after the new requested code has finished', async () => {
    const resolves: ((value: RequestedAiCouponResult) => void)[] = [];
    fake.lookup.mockImplementation(() => new Promise(resolve => { resolves.push(resolve); }));
    const view = setup();
    await act(async () => { go('/planner?coupon=LEGACY'); }); expectBlocked();
    await act(async () => { resolves[1]({ state: 'review' }); });
    await act(async () => { resolves[0](available()); });
    expect(screen.getByText(translations.en.planner.aiCouponReviewBody)).toBeVisible();
    expectBlocked(); expect(fake.mounts).toBe(0); expect(view.props.onPaymentSuccess).not.toHaveBeenCalled();
  });
  it('blocks an old SDK start when submitted inputs change without a render and after changing back', () => {
    const view = setup('/planner');
    const oldPayment = fake.paymentProps.at(-1)!;
    const original = view.props.lastValues.current;
    view.props.lastValues.current = { ...original, regions: ['Busan'] };
    expect(oldPayment.canStartAiCheckout()).toBe(false);
    view.rerender();
    expect(fake.paymentProps.at(-1)!.canStartAiCheckout()).toBe(true);
    view.props.lastValues.current = original; view.rerender();
    expect(oldPayment.canStartAiCheckout()).toBe(false);
    expect(fake.paymentProps.at(-1)!.canStartAiCheckout()).toBe(true);
  });
  it('rechecks a review coupon after returning from revision mode instead of remaining loading', async () => {
    fake.lookup.mockResolvedValue({ state: 'review' });
    const view = setup('/planner?coupon=LEGACY');
    await screen.findByText(translations.en.planner.aiCouponReviewBody);
    view.props.revisionMode = true; view.props.revisionPlanId = 'existing-plan';
    await act(async () => { view.rerender(); });
    expect(screen.getByRole('button', { name: /Free Regeneration.*Create New Plan/ })).toBeVisible();
    view.props.revisionMode = false; view.props.revisionPlanId = null;
    await act(async () => { view.rerender(); });
    expect(await screen.findByText(translations.en.planner.aiCouponReviewBody)).toBeVisible();
    expect(screen.queryByText(translations.en.planner.aiCouponChecking)).toBeNull();
    expect(fake.lookup).toHaveBeenCalledTimes(3);
    expectBlocked(); expect(fake.mounts).toBe(0);
    expect(view.props.onPaymentSuccess).not.toHaveBeenCalled();
    expect(view.props.onRevisionRegenerate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores pending coupon reads from both departed revision scopes', async () => {
    const resolves: ((value: RequestedAiCouponResult) => void)[] = [];
    fake.lookup.mockImplementation(() => new Promise(resolve => { resolves.push(resolve); }));
    const view = setup();
    view.props.revisionMode = true; view.props.revisionPlanId = 'existing-plan'; view.rerender();
    view.props.revisionMode = false; view.props.revisionPlanId = null; view.rerender();
    expect(fake.lookup).toHaveBeenCalledTimes(3);
    await act(async () => { resolves[0](available()); resolves[1](available()); });
    expect(screen.getByText(translations.en.planner.aiCouponChecking)).toBeVisible(); expectBlocked();
    await act(async () => { resolves[2]({ state: 'review' }); });
    expect(screen.getByText(translations.en.planner.aiCouponReviewBody)).toBeVisible();
    expectBlocked(); expect(fake.mounts).toBe(0);
    expect(view.props.onPaymentSuccess).not.toHaveBeenCalled();
    expect(view.props.onRevisionRegenerate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a departed revision response delivered between layout commit and effect cleanup', () => {
    let accept!: (result: RequestedAiCouponResult) => void;
    // A controllable thenable lets the old read callback run exactly in the cleanup gap.
    fake.lookup.mockImplementation(() => ({ then: (onResult: typeof accept) => { accept = onResult; } }));
    function CommitReply({ revisionMode }: { revisionMode: boolean }) {
      React.useLayoutEffect(() => { if (!revisionMode) accept(available()); }, [revisionMode]);
      return null;
    }
    const props = {
      p: translations.en.planner, language: 'en', userEmail: 'test@example.invalid', setUserEmail: vi.fn(),
      isGeneratingPlan: false, planError: null, resultQuick: {},
      lastValues: { current: { durationDays: 3 } as unknown as PlannerFormValues },
      revisionMode: true, revisionPlanId: 'existing-plan' as string | null, revisionToken: null,
      onPaymentSuccess: vi.fn(), onRevisionRegenerate: vi.fn(),
    };
    const tree = () => <MemoryRouter initialEntries={['/planner?coupon=NORMAL']}>
      <PurchaseSection {...props} /><CommitReply revisionMode={props.revisionMode} />
    </MemoryRouter>;
    const view = render(tree());
    props.revisionMode = false; props.revisionPlanId = null;
    view.rerender(tree());
    expect(screen.getByText(translations.en.planner.aiCouponChecking)).toBeVisible();
    expectBlocked(); expect(fake.mounts).toBe(0);
    expect(props.onPaymentSuccess).not.toHaveBeenCalled();
  });
});
