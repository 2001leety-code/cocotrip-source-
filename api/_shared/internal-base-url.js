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

/**
 * 🔴 2026-07-29 — **돈·예약·적립 API 자기호출 전용**.
 *
 * internalApiBase() 는 VERCEL_URL 이 없으면 운영 도메인으로 폴백한다. 링크 생성처럼
 * "주소가 하나라도 나와야 하는" 용도에는 맞지만, **돈이 움직이는 호출에는 재앙**이다:
 *   프리뷰/로컬에서 돈 API 를 부르면 운영 API + 운영 Firestore 로 향한다.
 *   실제로 booking-processor 가 적립을 `https://cocotripkr.com/api/loyalty` 로
 *   하드코딩해 부르고 있었다 → 샌드박스 결제 적립이 운영 원장에 꽂혔다.
 *
 * 그래서 이 함수는 **운영이 아니면 운영 도메인을 절대 돌려주지 않는다.**
 * 주소를 특정할 수 없으면 null 을 준다. 호출부는 그 단계를 건너뛰고 재시도 상태로 남겨야 한다
 * (환경을 잘못 넘나드는 것보다 적립이 늦는 게 낫다).
 *
 * @returns {string|null}
 */
export function internalMoneyApiBase() {
  if (process.env.VERCEL_ENV === 'production') return PROD_ORIGIN;
  const url = (process.env.VERCEL_URL || '').trim();
  return url ? `https://${url}` : null;
}

export default internalApiBase;
