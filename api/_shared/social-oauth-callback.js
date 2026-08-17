const CALLBACK_PROVIDERS = Object.freeze({
  meta: Object.freeze({
    errorField: 'error',
    forbiddenFields: Object.freeze(['auth_code']),
    localCallbackUrl: 'http://127.0.0.1:8765/oauth/meta/callback',
    successFields: Object.freeze(['code']),
  }),
  // TikTok의 계정 소유자 인증(www.tiktok.com/v2/auth/authorize)은 실제로
  // `auth_code`가 아니라 `code`로 돌려준다(2026-08-17 실측). 두 이름을 모두
  // 받아 그대로 전달하고, 어느 쪽을 쓸지는 로컬 수신부가 판단한다.
  tiktok: Object.freeze({
    forbiddenFields: Object.freeze(['error']),
    localCallbackUrl: 'http://127.0.0.1:8765/oauth/tiktok/callback',
    successFields: Object.freeze(['auth_code', 'code']),
  }),
});

const CALLBACK_FIELD_LIMITS = Object.freeze({
  auth_code: 4096,
  code: 4096,
  error: 256,
  state: 1024,
});

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
});

function isSafeQueryValue(value, maxLength) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && /^[\x21-\x7E]+$/.test(value)
  );
}

/**
 * Parse the provider callback without reflecting arbitrary query parameters.
 * Unknown fields are intentionally discarded because providers may append
 * informational values such as `scopes`, but they must never influence the
 * loopback destination.
 */
export function validateOAuthCallbackQuery(provider, query = {}) {
  const providerConfig = CALLBACK_PROVIDERS[provider];
  if (!providerConfig) return { kind: 'invalid' };
  if (providerConfig.forbiddenFields.some((field) => query[field] !== undefined)) {
    return { kind: 'invalid' };
  }

  const forwarded = new URLSearchParams();
  const allowedFields = [...providerConfig.successFields, 'state', providerConfig.errorField]
    .filter(Boolean);

  for (const field of allowedFields) {
    const maxLength = CALLBACK_FIELD_LIMITS[field];
    const value = query[field];
    if (value === undefined) continue;
    if (!isSafeQueryValue(value, maxLength)) return { kind: 'invalid' };
    forwarded.set(field, value);
  }

  const presentSuccessFields = providerConfig.successFields
    .filter((field) => forwarded.has(field));
  const hasSuccess = presentSuccessFields.length > 0;
  const hasError = providerConfig.errorField
    ? forwarded.has(providerConfig.errorField)
    : false;

  if (!hasSuccess && !hasError) {
    return Object.keys(query).length === 0 ? { kind: 'ready' } : { kind: 'invalid' };
  }

  // 성공 코드가 두 이름으로 동시에 오면 어느 쪽이 진짜인지 알 수 없다.
  if (presentSuccessFields.length > 1) return { kind: 'invalid' };
  if (hasSuccess && hasError) return { kind: 'invalid' };
  if (!forwarded.has('state')) return { kind: 'invalid' };

  const destination = new URL(providerConfig.localCallbackUrl);
  destination.search = forwarded.toString();
  return { kind: 'redirect', location: destination.toString() };
}

function setSecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
}

function endText(res, statusCode, body) {
  res.statusCode = statusCode;
  return res.end(body);
}

/**
 * Public OAuth bridge for the desktop listener. The redirect host and port are
 * compile-time constants; request-controlled `next`, `host`, `port`, or
 * `redirect_uri` values are never used or forwarded.
 */
export function handleSocialOAuthCallback(provider, req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return endText(res, 405, 'Method not allowed.');
  }

  const parsed = validateOAuthCallbackQuery(provider, req.query || {});

  if (parsed.kind === 'ready') {
    return endText(res, 200, 'OAuth callback is ready.');
  }

  if (parsed.kind === 'invalid') {
    return endText(res, 400, 'Invalid OAuth callback.');
  }

  res.statusCode = 302;
  res.setHeader('Location', parsed.location);
  return res.end();
}

export const SOCIAL_OAUTH_LOCAL_CALLBACKS = Object.freeze({
  meta: CALLBACK_PROVIDERS.meta.localCallbackUrl,
  tiktok: CALLBACK_PROVIDERS.tiktok.localCallbackUrl,
});
