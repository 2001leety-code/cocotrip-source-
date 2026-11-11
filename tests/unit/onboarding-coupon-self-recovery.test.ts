// @vitest-environment jsdom
// Onboarding r1 D — 가입 쿠폰 미발급 회원 자가 복구 (saveUserToFirestore + ensureOnboardingCoupons).
// 완전 오프라인: firebase SDK·fetch·analytics 전부 mock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(async () => undefined),
  fetch: vi.fn(),
  trackSignUp: vi.fn(),
  trackWelcomeCouponIssued: vi.fn(),
  getAttributionSnapshot: vi.fn(() => ({ first: { source: 'synthetic' } })),
}));

vi.mock('firebase/app', () => ({ getApps: () => [{ name: '[DEFAULT]' }], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
  GoogleAuthProvider: class { setCustomParameters() {} },
  OAuthProvider: class { addScope() {} },
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), getRedirectResult: vi.fn(),
  signInWithPhoneNumber: vi.fn(), signInAnonymously: vi.fn(), RecaptchaVerifier: class {},
  linkWithPopup: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), doc: vi.fn((...p: unknown[]) => p), setDoc: m.setDoc, getDoc: m.getDoc,
  serverTimestamp: () => 'server-time', collection: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}) }));
vi.mock('../../src/lib/analytics', () => ({
  trackSignUp: m.trackSignUp,
  trackWelcomeCouponIssued: m.trackWelcomeCouponIssued,
  getAttributionSnapshot: m.getAttributionSnapshot,
}));

const ok = (body: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => body });
const fail = () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'temporary' }) });
const member = (uid = 'member-uid', extra: Record<string, unknown> = {}) => ({
  uid, isAnonymous: false, providerData: [{ providerId: 'phone' }], getIdToken: vi.fn(async () => 'token'), ...extra,
});
const load = async () => import('../../src/lib/firebase.js');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal('fetch', m.fetch);
  ['log', 'warn', 'error'].forEach(k => vi.spyOn(console, k as 'log').mockImplementation(() => {}));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('saveUserToFirestore coupon trigger', () => {
  it('new user: unchanged — GA sign_up once, 2 attempts with refreshed token, attribution sent, awaited', async () => {
    vi.useFakeTimers();
    m.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    m.fetch.mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok({ ok: true, issued: 3 }));
    const user = member('new-uid');
    const { saveUserToFirestore } = await load();
    const saving = saveUserToFirestore(user);
    await vi.runAllTimersAsync();
    await saving;
    expect(m.trackSignUp).toHaveBeenCalledExactlyOnceWith('phone');
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(user.getIdToken.mock.calls).toEqual([[false], [true]]);
    expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({ attribution: { first: { source: 'synthetic' } } });
    expect(sessionStorage.getItem('COCO_ONBOARDING_COUPONS_JUST_ISSUED')).toBe('3');
    expect(m.trackWelcomeCouponIssued).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('existing member already issued: 0 coupon calls', async () => {
    m.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ onboardingCouponsIssued: true }) });
    const { saveUserToFirestore } = await load();
    await saveUserToFirestore(member());
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ onboardingCouponsIssued: false }]])('existing member not issued (%j): exactly 1 call, no retry, no GA sign_up, failure does not throw', async (data) => {
    vi.useFakeTimers();
    m.getDoc.mockResolvedValue({ exists: () => true, data: () => data });
    m.fetch.mockResolvedValue(fail());
    const { saveUserToFirestore } = await load();
    const saving = saveUserToFirestore(member());
    await vi.runAllTimersAsync();
    await expect(saving).resolves.toBeUndefined();
    expect(m.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({}); // 지금 세션 유입을 가입 유입으로 남기지 않음
    expect(m.trackSignUp).not.toHaveBeenCalled();
  });

  it('existing member not issued: the sign-in flow does not wait for the coupon request', async () => {
    m.getDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });
    m.fetch.mockReturnValue(new Promise(() => {}));
    const { saveUserToFirestore } = await load();
    await expect(saveUserToFirestore(member())).resolves.toBeUndefined();
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('ensureOnboardingCoupons', () => {
  it('existing member: once per session per uid (sessionStorage survives a module reload)', async () => {
    m.fetch.mockResolvedValue(ok({ ok: true, issued: 0, promoClosed: true }));
    let mod = await load();
    await mod.ensureOnboardingCoupons(member());
    await mod.ensureOnboardingCoupons(member());
    vi.resetModules();
    mod = await load();
    await mod.ensureOnboardingCoupons(member());
    expect(m.fetch).toHaveBeenCalledTimes(1);
    await mod.ensureOnboardingCoupons(member('other-uid'));
    expect(m.fetch).toHaveBeenCalledTimes(2);
  });

  it('once per tab even when sessionStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    m.fetch.mockResolvedValue(ok({ ok: true, issued: 0 }));
    const mod = await load();
    await mod.ensureOnboardingCoupons(member());
    await mod.ensureOnboardingCoupons(member());
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });

  it('a successful recovery sets the welcome modal flag; GA sign_up stays silent', async () => {
    m.fetch.mockResolvedValue(ok({ ok: true, issued: 3 }));
    const mod = await load();
    await mod.ensureOnboardingCoupons(member());
    expect(sessionStorage.getItem('COCO_ONBOARDING_COUPONS_JUST_ISSUED')).toBe('3');
    expect(m.trackWelcomeCouponIssued).toHaveBeenCalledExactlyOnceWith(3);
    expect(m.trackSignUp).not.toHaveBeenCalled();
  });

  it.each([
    ['anonymous', member('anon', { isAnonymous: true })],
    ['no uid', { uid: '', getIdToken: vi.fn() }],
    ['null', null],
  ])('%s user → 0 calls', async (_n, user) => {
    const mod = await load();
    await mod.ensureOnboardingCoupons(user);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('r2: after a Google link clears the mark, the same session retries once more (403 before linking)', async () => {
    m.fetch
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ ok: false, error: 'EMAIL_REQUIRED' }) })
      .mockResolvedValueOnce(ok({ ok: true, issued: 3 }));
    const mod = await load();
    await mod.ensureOnboardingCoupons(member());
    await mod.ensureOnboardingCoupons(member());
    expect(m.fetch).toHaveBeenCalledTimes(1);
    mod.clearOnboardingRetryMark('member-uid');
    await mod.ensureOnboardingCoupons(member());
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('COCO_ONBOARDING_COUPONS_JUST_ISSUED')).toBe('3');
  });

  it('a new-user run marks the session so the later doc-subscription retry does not call again', async () => {
    m.fetch.mockResolvedValue(ok({ ok: true, issued: 3 }));
    const mod = await load();
    await mod.ensureOnboardingCoupons(member('new-uid'), { isNewUser: true });
    await mod.ensureOnboardingCoupons(member('new-uid'));
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
});
