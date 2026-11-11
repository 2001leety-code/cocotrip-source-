// @vitest-environment jsdom
// Onboarding r1 E1 —linkGoogleAccount keeps the uid (linkWithPopup) and maps Firebase errors to
// stable codes; the raw Firebase message never reaches the caller. Offline (firebase/auth mocked).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  link: vi.fn(),
  save: vi.fn(async () => undefined),
  clearMark: vi.fn(),
}));

vi.mock('firebase/app', () => ({ getApps: () => [{ name: '[DEFAULT]' }], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: () => h.auth,
  GoogleAuthProvider: class { setCustomParameters() {} },
  OAuthProvider: class { addScope() {} },
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), getRedirectResult: vi.fn(),
  signInWithPhoneNumber: vi.fn(), RecaptchaVerifier: class {},
  linkWithPopup: h.link,
}));
vi.mock('../../src/lib/firebase.js', () => ({ saveUserToFirestore: h.save, clearOnboardingRetryMark: h.clearMark }));

const { linkGoogleAccount, googleProvider } = await import('../../src/lib/firebase-auth.js');
const { AUTH_PROFILE_EVENT } = await import('../../src/lib/connectEmail');
const profileEvents = vi.fn();
window.addEventListener(AUTH_PROFILE_EVENT, profileEvents);

const linkedUser = (email: string | null) => ({
  uid: 'phone-uid', email, reload: vi.fn(async () => undefined), getIdToken: vi.fn(async () => 'fresh'),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.currentUser = { uid: 'phone-uid', isAnonymous: false, email: null };
});

describe('linkGoogleAccount', () => {
  it('links Google to the same account, reloads, refreshes the token, saves the profile → ok + email', async () => {
    const user = linkedUser('person@example.invalid');
    h.link.mockResolvedValueOnce({ user });
    await expect(linkGoogleAccount()).resolves.toEqual({ ok: true, email: 'person@example.invalid' });
    expect(h.link).toHaveBeenCalledExactlyOnceWith(h.auth.currentUser, googleProvider);
    expect(user.reload).toHaveBeenCalledOnce();
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(h.save).toHaveBeenCalledExactlyOnceWith(user);
    expect(user.reload.mock.invocationCallOrder[0]).toBeLessThan(h.save.mock.invocationCallOrder[0]);
  });

  it('r2: success clears the onboarding retry mark before saving and announces the profile update (no reload)', async () => {
    const user = linkedUser('person@example.invalid');
    h.link.mockResolvedValueOnce({ user });
    await linkGoogleAccount();
    expect(h.clearMark).toHaveBeenCalledExactlyOnceWith('phone-uid');
    expect(h.clearMark.mock.invocationCallOrder[0]).toBeLessThan(h.save.mock.invocationCallOrder[0]);
    expect(profileEvents).toHaveBeenCalledOnce();
  });

  it('linked but still no email → no-email, no profile event', async () => {
    h.link.mockResolvedValueOnce({ user: linkedUser('  ') });
    await expect(linkGoogleAccount()).resolves.toEqual({ ok: false, code: 'no-email' });
    expect(profileEvents).not.toHaveBeenCalled();
  });

  it.each([
    ['auth/credential-already-in-use', 'already-in-use'],
    ['auth/email-already-in-use', 'already-in-use'],
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/popup-blocked', 'popup-blocked'],
    ['auth/provider-already-linked', 'failed'],
    ['auth/network-request-failed', 'failed'],
    [undefined, 'failed'],
  ])('Firebase %s → %s without exposing the SDK message', async (fbCode, code) => {
    h.link.mockRejectedValueOnce(Object.assign(new Error('Firebase: raw english detail (auth/x).'), { code: fbCode }));
    const result = await linkGoogleAccount();
    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain('raw english');
    expect(h.save).not.toHaveBeenCalled();
    expect(profileEvents).not.toHaveBeenCalled();
  });

  it.each([['signed out', null], ['anonymous', { uid: 'anon', isAnonymous: true }]])('%s → failed without opening a popup', async (_n, current) => {
    h.auth.currentUser = current;
    await expect(linkGoogleAccount()).resolves.toEqual({ ok: false, code: 'failed' });
    expect(h.link).not.toHaveBeenCalled();
  });
});
