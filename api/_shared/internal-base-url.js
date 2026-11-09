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

const PREVIEW_ID_MAX_LEN = 64;
const HOST_MAX_LEN = 253;
const LABEL_MAX_LEN = 63;
const ID_BODY_RE = /^[A-Za-z0-9]+$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const VERCEL_APP_SUFFIX = '.vercel.app';

// Visible ASCII only (0x21-0x7E). Rejects whitespace, control chars, DEL, non-ASCII/Unicode.
function isStrictVisibleAscii(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

// Full-match regex test that does not rely on `$` semantics alone.
function fullMatch(re, s) {
  const m = re.exec(s);
  return m !== null && m.index === 0 && m[0].length === s.length;
}

function isValidPrefixedId(v, prefix) {
  if (!isStrictVisibleAscii(v)) return false;
  if (v.length > PREVIEW_ID_MAX_LEN) return false;
  if (v.slice(0, prefix.length) !== prefix) return false;
  const body = v.slice(prefix.length);
  return body.length > 0 && fullMatch(ID_BODY_RE, body);
}

// Strict lowercase ASCII DNS bare hostname: no scheme/credentials/port/path/query/hash,
// no backslash, no trailing dot, finite label/host lengths.
function isStrictBareHost(v) {
  if (!isStrictVisibleAscii(v)) return false;
  if (v.length > HOST_MAX_LEN) return false;
  const labels = v.split('.');
  if (labels.length < 2) return false;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label.length === 0 || label.length > LABEL_MAX_LEN) return false;
    if (!fullMatch(LABEL_RE, label)) return false;
  }
  return true;
}

/**
 * Pure resolver for the preview-internal origin. Returns 'https://<host>' or null.
 * Conditional defense only: assumes Vercel system env vars are trusted/not overridden.
 */
export function resolvePreviewInternalOrigin(env = process.env) {
  if (!env || typeof env !== 'object') return null;
  if (env.VERCEL_ENV !== 'preview') return null;
  if (env.VERCEL !== '1') return null;
  if (env.VERCEL_TARGET_ENV !== 'preview') return null;
  if (!isValidPrefixedId(env.VERCEL_DEPLOYMENT_ID, 'dpl_')) return null;

  const pinnedProject = env.PREVIEW_INTERNAL_PROJECT_ID;
  const runtimeProject = env.VERCEL_PROJECT_ID;
  if (!isValidPrefixedId(pinnedProject, 'prj_')) return null;
  if (!isValidPrefixedId(runtimeProject, 'prj_')) return null;
  if (pinnedProject !== runtimeProject) return null;

  const host = env.VERCEL_URL;
  if (!isStrictBareHost(host)) return null;
  if (host.length <= VERCEL_APP_SUFFIX.length) return null;
  if (host.slice(host.length - VERCEL_APP_SUFFIX.length) !== VERCEL_APP_SUFFIX) return null;
  if (host.split('.').length < 3) return null;

  const prodHost = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!isStrictBareHost(prodHost)) return null;
  if (host === prodHost) return null;
  const prodSuffix = '.' + prodHost;
  if (host.length > prodSuffix.length && host.slice(host.length - prodSuffix.length) === prodSuffix) return null;

  return 'https://' + host;
}

export function internalApiBase() {
  if (process.env.VERCEL_ENV === 'production') return PROD_ORIGIN;
  if (process.env.VERCEL_ENV === 'preview') {
    const origin = resolvePreviewInternalOrigin(process.env);
    if (origin === null) throw new Error('PREVIEW_INTERNAL_ORIGIN_INVALID');
    return origin;
  }
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : PROD_ORIGIN;
}

export function vercelBypassHeaders(targetOrigin) {
  if (process.env.VERCEL_ENV === 'preview') {
    const resolvedOrigin = resolvePreviewInternalOrigin(process.env);
    if (
      typeof resolvedOrigin !== 'string' ||
      resolvedOrigin === '' ||
      typeof targetOrigin !== 'string' ||
      targetOrigin !== resolvedOrigin
    ) {
      throw new Error('PREVIEW_INTERNAL_TARGET_INVALID');
    }
  }
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
  if (process.env.VERCEL_ENV === 'preview') {
    return resolvePreviewInternalOrigin(process.env);
  }
  const url = (process.env.VERCEL_URL || '').trim();
  return url ? `https://${url}` : null;
}

/**
 * 고객에게 보내는 링크의 사이트 주소(2026-10-23, ②a 확인 메일 "예약 관리" 링크).
 * 운영 = 운영 도메인, 프리뷰 = 그 배포 URL(프리뷰 토큰이 운영 페이지로 가지 않게), 그 외 = 운영 도메인.
 */
export function publicSiteOrigin() {
  if (process.env.VERCEL_ENV === 'production') return PROD_ORIGIN;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : PROD_ORIGIN;
}

export default internalApiBase;
