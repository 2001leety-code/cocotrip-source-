// Centralized PayPal credentials + access token fetch.
// Sandbox vs live selected via isSandbox flag (caller decides — usually
// from TEST_ACCOUNTS membership). Throws on missing creds or non-2xx token
// fetch so callers get a consistent error contract.

// P314 (2026-05-30): sandbox e2e 토글 SSOT. 운영자가 한국인이라 한국 PayPal 로
// 자국 기업 결제 불가 + 외국인 테스터 없음 → sandbox 가짜 미국 buyer 로 P311
// 출시 blocker(결제 멱등성) e2e 검증 필요.
//
// 🔒 PROD 안전 이중 가드 (가장 중요 — prod 실 결제가 sandbox 로 새면 "돈 안 받고
//    plan 발급" 사고):
//   1. HARD: VERCEL_ENV !== 'production'  — Vercel 이 런타임 주입. prod 배포는
//      항상 'production' → 운영자가 PAYPAL_ENV 를 어떻게 두든 코드상 무조건 live.
//      (sentry.js 가 이미 VERCEL_ENV 로 환경 구분 = 작동 확인됨.)
//   2. SOFT: PAYPAL_ENV === 'sandbox' — preview 안에서도 명시해야만 sandbox.
//      미설정 preview 는 live 유지.
// → prod 실 결제 흐름에 코드 경로상 0 영향. preview 배포에서만 sandbox 가능.
export function resolveIsSandbox() {
  return process.env.VERCEL_ENV !== 'production'
    && (process.env.PAYPAL_ENV || '').trim().toLowerCase() === 'sandbox';
}

export function getPaypalCredentials(isSandbox) {
  const clientId = (isSandbox
    ? process.env.PAYPAL_SANDBOX_CLIENT_ID
    : process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = (isSandbox
    ? process.env.PAYPAL_SANDBOX_SECRET
    : process.env.PAYPAL_CLIENT_SECRET || '').trim();
  const baseUrl = isSandbox
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
  return { clientId, secret, baseUrl };
}

export async function getPaypalAccessToken(isSandbox) {
  const { clientId, secret, baseUrl } = getPaypalCredentials(isSandbox);
  if (!clientId || !secret) {
    throw new Error('PayPal credentials not configured');
  }
  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PayPal auth ${res.status}${body ? `: ${body}` : ''}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Failed to get PayPal access token');
  }
  return { accessToken: data.access_token, baseUrl };
}
