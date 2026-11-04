import { verifyUserToken, resolveGuestAnonOwner } from '../_shared/user-auth.js';
// Reuse the existing guest feature flag and revoked-token checks; no new permissions or auth settings.
export async function verifyMealActor(req) {
  const auth = await verifyUserToken(req);
  if (auth.ok) return auth;
  const guest = await resolveGuestAnonOwner(req, null);
  return guest.forceGuestToken && guest.planOwnerUid ? { ok: true, uid: guest.planOwnerUid, email: null } : auth;
}
