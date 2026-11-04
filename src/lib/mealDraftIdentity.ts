import { isGuestAnonEnabled } from './guestReader';
/** Same secondary anonymous identity and feature flag as the existing paid planner flow. */
export async function mealDraftGuestHeaders(): Promise<Record<string, string>> {
  if (!isGuestAnonEnabled()) return {};
  const { auth } = await import('./firebase-auth');
  if (auth.currentUser) return {};
  const { ensureGuestAnon } = await import('./firebase');
  const user = await ensureGuestAnon();
  return user ? { 'x-guest-anon-token': await user.getIdToken() } : {};
}
