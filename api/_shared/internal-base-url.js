/**
 * Internal self-call base URL + Vercel Deployment Protection bypass.
 *
 * 2026-07-26 root cause: server-to-server self-calls (booking-processor,
 * ai-planner-full, …) used `https://${process.env.VERCEL_URL}`. VERCEL_URL is
 * the deployment-generated URL (`<project>-<hash>-<team>.vercel.app`), which
 * sits behind Vercel Deployment Protection (SSO) — POSTs get 401, GETs 302 to
 * vercel.com/sso-api. Every doc ever written to `pending_processor_retries`
 * failed with `http-401` because of this (retry sweep hit the same wall, so
 * nothing could ever reach status='done').
 *
 * Only production custom domains are public, so production self-calls must go
 * through cocotripkr.com. Previews keep the deployment URL and pass the wall
 * with the `x-vercel-protection-bypass` header once the operator creates a
 * "Protection Bypass for Automation" secret in Vercel (auto-injected as
 * VERCEL_AUTOMATION_BYPASS_SECRET). Without the secret, preview self-calls
 * stay as broken as before — no regression, production is what matters.
 */

const PROD_ORIGIN = 'https://cocotripkr.com';

export function internalApiBase() {
  if (process.env.VERCEL_ENV === 'production') return PROD_ORIGIN;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : PROD_ORIGIN;
}

export function vercelBypassHeaders() {
  const secret = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

export default internalApiBase;
