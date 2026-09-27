// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = { name: '[DEFAULT]' };
  const auth = { currentUser: null, signOut: vi.fn() };
  const googleProvider = { setCustomParameters: vi.fn() };
  const appleProvider = { addScope: vi.fn() };
  const lineProvider = { addScope: vi.fn() };
  const db = {};
  const storage = {};
  return {
    app,
    auth,
    googleProvider,
    appleProvider,
    lineProvider,
    db,
    storage,
    popup: vi.fn(),
    redirect: vi.fn(),
    getRedirectResult: vi.fn(),
    phone: vi.fn(),
    saveUser: vi.fn(),
    recaptcha: vi.fn(),
    doc: vi.fn((...parts: unknown[]) => parts),
    setDoc: vi.fn(async (...args: unknown[]) => {
      mocks.eventOrder.push('profile-write');
      return args;
    }),
    getDoc: vi.fn(),
    serverTimestamp: vi.fn(() => 'server-time'),
    fetch: vi.fn(),
    eventOrder: [] as string[],
  };
});

vi.mock('firebase/app', () => ({
  getApps: () => [mocks.app],
  initializeApp: vi.fn(() => mocks.app),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => mocks.auth,
  GoogleAuthProvider: class {
    setCustomParameters(...args: unknown[]) {
      return mocks.googleProvider.setCustomParameters(...args);
    }
  },
  OAuthProvider: class {
    constructor(providerId: string) {
      return providerId === 'apple.com' ? mocks.appleProvider : mocks.lineProvider;
    }
  },
  signInWithPopup: mocks.popup,
  signInWithRedirect: mocks.redirect,
  getRedirectResult: mocks.getRedirectResult,
  signInWithPhoneNumber: mocks.phone,
  signInAnonymously: vi.fn(),
  RecaptchaVerifier: class {
    constructor(...args: unknown[]) {
      mocks.recaptcha(...args);
    }
  },
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: () => mocks.db,
  doc: mocks.doc,
  setDoc: mocks.setDoc,
  serverTimestamp: mocks.serverTimestamp,
  collection: vi.fn((...parts: unknown[]) => parts),
  query: vi.fn((value: unknown) => value),
  where: vi.fn((...parts: unknown[]) => parts),
  getDocs: vi.fn(),
  getDoc: mocks.getDoc,
}));

vi.mock('firebase/storage', () => ({ getStorage: () => mocks.storage }));
vi.mock('../../src/lib/analytics', () => ({
  trackSignUp: vi.fn(),
  getAttributionSnapshot: vi.fn(() => null),
  trackWelcomeCouponIssued: vi.fn(),
}));

describe('firebase auth stays independent from the Firestore chunk', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.eventOrder.length = 0;
    mocks.setDoc.mockClear();
    mocks.doc.mockClear();
    mocks.getDoc.mockReset();
    mocks.fetch.mockReset();
    vi.doMock('../../src/lib/firebase.js', () => ({
      saveUserToFirestore: mocks.saveUser.mockImplementation(async () => {
        mocks.eventOrder.push('save');
      }),
    }));
    mocks.popup.mockImplementation(async () => {
      mocks.eventOrder.push('popup');
      return { user: { uid: 'auth-user' } };
    });
    mocks.getRedirectResult.mockResolvedValue(null);
    mocks.redirect.mockResolvedValue(undefined);
    mocks.phone.mockResolvedValue({ smsSent: true });
  });

  afterEach(() => {
    vi.doUnmock('../../src/lib/firebase.js');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['signInWithGoogle', 'signInWithApple', 'signInWithLine'] as const)('%s starts popup in the caller gesture and saves only after success', async (provider) => {
    const authModule = await import('../../src/lib/firebase-auth.js');
    const signingIn = authModule[provider]();

    expect(mocks.popup).toHaveBeenCalledOnce();
    expect(mocks.eventOrder).toEqual(['popup']);
    await expect(signingIn).resolves.toEqual({ uid: 'auth-user' });
    expect(mocks.eventOrder).toEqual(['popup', 'save']);
  });

  it('preserves redirect fallback, null redirect result, and popup errors', async () => {
    const { auth, googleProvider, handleRedirectResult, signInWithGoogle } = await import('../../src/lib/firebase-auth.js');
    mocks.popup.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }));
    await expect(signInWithGoogle()).resolves.toBeNull();
    expect(mocks.redirect).toHaveBeenCalledWith(auth, googleProvider);

    await expect(handleRedirectResult()).resolves.toBeNull();
    mocks.popup.mockRejectedValueOnce(new Error('provider failed'));
    await expect(signInWithGoogle()).rejects.toThrow('provider failed');
  });

  it('saves redirect success, contains redirect failure, and preserves sign-out', async () => {
    const { handleRedirectResult, signOutUser } = await import('../../src/lib/firebase-auth.js');
    const user = { uid: 'redirect-user' };
    mocks.getRedirectResult.mockResolvedValueOnce({ user });
    await expect(handleRedirectResult()).resolves.toBe(user);
    expect(mocks.saveUser).toHaveBeenCalledWith(user);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getRedirectResult.mockRejectedValueOnce(new Error('redirect failed'));
    await expect(handleRedirectResult()).resolves.toBeNull();
    expect(error).toHaveBeenCalledOnce();
    await signOutUser();
    expect(mocks.auth.signOut).toHaveBeenCalledOnce();
  });

  it('verifies phone code, then saves the resulting user', async () => {
    const { setUpRecaptchaVerifier, signInWithPhone, verifyPhoneCode } = await import('../../src/lib/firebase-auth.js');
    const confirmation = { confirm: vi.fn(async () => ({ user: { uid: 'phone-user' } })) };
    const verifier = setUpRecaptchaVerifier('phone-recaptcha-container');
    await expect(signInWithPhone('+821012345678', verifier)).resolves.toEqual({ smsSent: true });
    expect(mocks.phone).toHaveBeenCalledWith(mocks.auth, '+821012345678', verifier);

    const result = await verifyPhoneCode(confirmation, '123456');
    expect(confirmation.confirm).toHaveBeenCalledWith('123456');
    expect(result).toEqual({ uid: 'phone-user' });
    expect(mocks.saveUser).toHaveBeenCalledWith(result);
  });

  it('keeps popup login successful when the Firestore chunk cannot load', async () => {
    vi.doMock('../../src/lib/firebase.js', () => {
      throw new Error('Firestore chunk unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { signInWithGoogle } = await import('../../src/lib/firebase-auth.js');

    await expect(signInWithGoogle()).resolves.toEqual({ uid: 'auth-user' });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toBe('[firebase] Firestore save failed:');
  });

  it('keeps the existing-user write and clears guest wishlist only after syncing', async () => {
    vi.doUnmock('../../src/lib/firebase.js');
    vi.resetModules();
    mocks.getDoc.mockResolvedValue({ exists: () => true });
    localStorage.setItem('COCO_WISHLIST', JSON.stringify([{ id: 'saved-tour', title: 'Tour' }]));
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const { saveUserToFirestore } = await import('../../src/lib/firebase.js');

    await saveUserToFirestore({ uid: 'existing-user', email: 'user@example.test' });

    expect(mocks.setDoc).toHaveBeenCalledTimes(2);
    expect(mocks.setDoc.mock.calls[0][1]).toMatchObject({ uid: 'existing-user', lastLoginAt: 'server-time' });
    expect(mocks.setDoc.mock.calls[1][1]).toMatchObject({ id: 'saved-tour', title: 'Tour' });
    expect(removeItem).toHaveBeenCalledWith('COCO_WISHLIST');
    expect(localStorage.getItem('COCO_WISHLIST')).toBeNull();
  });

  it('keeps new-user coupon retry token refresh behavior and finishes profile save', async () => {
    vi.doUnmock('../../src/lib/firebase.js');
    vi.resetModules();
    vi.useFakeTimers();
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    const user = {
      uid: 'new-user',
      providerData: [{ providerId: 'google.com' }],
      getIdToken: vi.fn().mockResolvedValueOnce('first-token').mockResolvedValueOnce('fresh-token'),
    };
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, error: 'temporary failure' }),
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, issued: 0 }),
    });
    const { saveUserToFirestore } = await import('../../src/lib/firebase.js');

    const saving = saveUserToFirestore(user);
    await vi.runAllTimersAsync();
    await saving;

    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    expect(mocks.setDoc.mock.calls[0][1]).toMatchObject({ tier: 'Bronze', tripCoins: 0, totalSpentUSD: 0, bookingCount: 0 });
    expect(user.getIdToken.mock.calls).toEqual([[false], [true]]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.eventOrder[0]).toBe('profile-write');
  });
});
