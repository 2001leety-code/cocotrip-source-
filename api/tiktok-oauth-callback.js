import { handleSocialOAuthCallback } from './_shared/social-oauth-callback.js';

export default function handler(req, res) {
  return handleSocialOAuthCallback('tiktok', req, res);
}
