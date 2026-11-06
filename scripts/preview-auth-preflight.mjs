import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const ORIGIN = 'https://cocotrip-planner-qa-20261105-2001leety.vercel.app';
const PROJECT = 'cocotrip-preview-2026';
const COURSE = 'TEST_CLAUDE_20261105_JONGNO_01';

// Normal existing-account Firebase password login, as in planner-smoke.mjs.
// No model, meal, payment, data-write or new credential operations occur here.
export async function preflight(env, fetcher = fetch, now = Date.now) {
  const result = { qaOrigin: ORIGIN, expectedProject: PROJECT, stage: 'configuration',
    ok: false, modelCalls: 0, dataWrites: 0, generationPermission: 'not_checked' };
  const stop = (code) => ({ ...result, code });
  if (env.BASE_URL !== ORIGIN) return stop('EXACT_QA_ORIGIN_REQUIRED');
  if (!['FIREBASE_WEB_API_KEY', 'HEALTH_CHECK_EMAIL', 'HEALTH_CHECK_PASSWORD']
    .every((key) => typeof env[key] === 'string' && env[key].length > 0)) {
    return stop('EXISTING_PREVIEW_LOGIN_CONFIGURATION_MISSING');
  }
  const request = (url, options) => fetcher(url, { ...options,
    redirect: 'error', signal: AbortSignal.timeout(20000) });
  try {
    result.stage = 'normal_firebase_login';
    const login = await request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='
      + encodeURIComponent(env.FIREBASE_WEB_API_KEY), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.HEALTH_CHECK_EMAIL,
        password: env.HEALTH_CHECK_PASSWORD, returnSecureToken: true }),
    });
    result.loginHttp = login.status;
    if (!login.ok) return stop('PREVIEW_LOGIN_REJECTED');
    const auth = await login.json();
    if (typeof auth.idToken !== 'string') return stop('LOGIN_TOKEN_MISSING');
    result.stage = 'preview_project_check';
    // These local checks restrict destinations. The app verifies the token's
    // signature, revocation and actual account permission on the next request.
    const claims = JSON.parse(Buffer.from(auth.idToken.split('.')[1], 'base64url').toString('utf8'));
    if (claims.aud !== PROJECT || claims.iss !== 'https://securetoken.google.com/' + PROJECT) {
      return stop('PREVIEW_TOKEN_PROJECT_MISMATCH');
    }
    if (claims.email_verified !== true || typeof claims.exp !== 'number'
      || claims.exp * 1000 <= now() || !claims.email
      || claims.email.toLowerCase() !== env.HEALTH_CHECK_EMAIL.toLowerCase()) {
      return stop('VERIFIED_EXISTING_ACCOUNT_REQUIRED');
    }
    result.previewProjectMatches = true;
    const headers = { Authorization: 'Bearer ' + auth.idToken };
    result.stage = 'server_verified_admin_read';
    const admin = await request(ORIGIN + '/api/admin-operational-checks', { method: 'GET', headers });
    result.adminReadHttp = admin.status;
    if (admin.status !== 200) return stop('AUTHENTICATED_ADMIN_READ_NOT_CONFIRMED');
    const adminBody = await admin.json();
    if (adminBody.ok !== true || !adminBody.data || typeof adminBody.data !== 'object') {
      return stop('ADMIN_READ_RESPONSE_NOT_CONFIRMED');
    }
    result.serverAdminReadAllowed = true;
    result.stage = 'test_course_read';
    const course = await request('https://firestore.googleapis.com/v1/projects/' + PROJECT
      + '/databases/(default)/documents/zone_courses/' + COURSE, { method: 'GET', headers });
    result.testCourseReadHttp = course.status;
    if (course.status !== 200 && course.status !== 404) return stop('TEST_COURSE_READ_NOT_CONFIRMED');
    if (course.status === 200) {
      const courseBody = await course.json();
      if (courseBody.name !== 'projects/' + PROJECT + '/databases/(default)/documents/zone_courses/' + COURSE) {
        return stop('TEST_COURSE_RESPONSE_NOT_CONFIRMED');
      }
    }
    result.testCourse1Exists = course.status === 200;
    result.stage = 'complete';
    return { ...result, ok: true, code: 'NORMAL_PREVIEW_AUTH_AND_READ_CHECKED' };
  } catch {
    // Never print provider bodies, exception messages, secrets or token claims.
    return stop('REQUEST_OR_RESPONSE_ERROR');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await preflight(process.env);
  writeFileSync('preview-auth-result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
