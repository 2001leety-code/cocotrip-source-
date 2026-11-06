import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const ORIGIN = 'https://cocotrip-planner-qa-20261105-2001leety.vercel.app';
const PROJECT = 'cocotrip-preview-2026';
const COURSE = 'TEST_CLAUDE_20261105_JONGNO_01';

// Normal existing-account Firebase password login, as in planner-smoke.mjs.
// Default auth/identity checks are read-only. Explicit --meal-only may update
// Preview rate counters and save an unpaid meal draft. No full-planner,
// payment or new credential operations occur in this script. Explicit quick-series
// mode makes bounded paid Day-1 preview requests, separate from full generation.
export async function preflight(env, fetcher = fetch, now = Date.now, { identityOnly = false, mealOnly = false, quickSeries = false, onProgress = () => {} } = {}) {
  const result = { qaOrigin: ORIGIN, expectedProject: PROJECT, stage: 'configuration',
    ok: false, modelCalls: 0, dataWrites: 0, generationPermission: 'not_checked' };
  const stop = (code) => ({ ...result, code });
  if (env.BASE_URL !== ORIGIN) return stop('EXACT_QA_ORIGIN_REQUIRED');
  if (!['FIREBASE_WEB_API_KEY', 'HEALTH_CHECK_EMAIL', 'HEALTH_CHECK_PASSWORD']
    .every((key) => typeof env[key] === 'string' && env[key].length > 0)) {
    return stop('EXISTING_PREVIEW_LOGIN_CONFIGURATION_MISSING');
  }
  const deploymentCredential = env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
  if (typeof deploymentCredential !== 'string' || /[\r\n]/.test(deploymentCredential)) {
    return stop('INVALID_EXISTING_DEPLOYMENT_CREDENTIAL');
  }
  const request = (url, options, timeoutMs = 20000) => fetcher(url, { ...options,
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
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
    // The existing deployment credential is sent only to the exact QA host.
    // Firebase Auth and Firestore continue to receive no Vercel credential.
    const qaHeaders = { ...headers, ...(deploymentCredential
      ? { 'x-vercel-protection-bypass': deploymentCredential } : {}) };
    if (quickSeries) {
      result.stage = 'day1_preview_series';
      result.adminRequestSkipped = true;
      result.modelCalls = 'requires_server_usage_evidence';
      result.dataWrites = 'preview_rate_and_usage_counters';
      result.planWrites = 0;
      result.fullGeneration = 'not_requested';
      result.previewIsOnlyDay1 = true;
      result.maximumClientRequests = 9;
      result.cases = [];
      for (let days = 7; days <= 15; days++) {
        const endDate = new Date(Date.UTC(2026, 10, 19 + days - 1)).toISOString().slice(0, 10);
        const entry = { days, startDate: '2026-11-19', endDate,
          testId: 'R90-Q' + String(days).padStart(2, '0') + '-20261106',
          status: 'requested_outcome_unconfirmed', startedAtUtc: new Date(now()).toISOString() };
        result.cases.push(entry);
        onProgress(JSON.parse(JSON.stringify(result)));
        const input = {
          area: 'seoul', regions: ['Seoul'], durationDays: days, pax: 2,
          startDate: '2026-11-19', endDate, language: 'en', reservation_status: 'nothing',
          styles: ['Food Tour', 'Photo Spots', 'Palace'], priceRange: 'Moderate',
          arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1',
          recommendedZone: 'myeongdong', tourStartTime: '09:00', tourEndTime: '21:00',
          tourPace: 'full', dietaryRestrictions: [], suggestHotels: false,
          special_request: 'TEST ONLY / ' + entry.testId + '. Diagnostic Preview test. No booking or notifications.',
        };
        const started = now();
        const response = await request(ORIGIN + '/api/ai-planner-quick', {
          method: 'POST', headers: { ...qaHeaders, 'Content-Type': 'application/json', Origin: ORIGIN },
          body: JSON.stringify(input),
        }, 70000);
        entry.httpStatus = response.status;
        entry.responseMs = now() - started;
        entry.finishedAtUtc = new Date(now()).toISOString();
        const trace = response.headers?.get?.('x-vercel-id');
        if (typeof trace === 'string' && /^[a-zA-Z0-9:._-]{1,200}$/.test(trace)) entry.vercelTrace = trace;
        if (response.status !== 200) {
          entry.status = 'http_rejected_no_retry';
          onProgress(JSON.parse(JSON.stringify(result)));
          return stop('QUICK_SERIES_STOPPED_ON_HTTP_REJECTION');
        }
        const body = await response.json();
        const data = body.data;
        if (body.ok !== true || !data || typeof data.day1MarkdownTable !== 'string'
          || typeof data.marketingNarrative !== 'string') {
          entry.status = 'response_contract_not_confirmed';
          onProgress(JSON.parse(JSON.stringify(result)));
          return stop('QUICK_SERIES_STOPPED_ON_RESPONSE_CONTRACT');
        }
        entry.status = 'preview_success';
        entry.previewDaysGenerated = 1;
        entry.tableDataRows = Math.max(0, data.day1MarkdownTable.split('\n').filter((line) => line.trim().startsWith('|')).length - 2);
        entry.narrativeCharacters = data.marketingNarrative.length;
        entry.themeCount = Array.isArray(data.themes) ? data.themes.length : 0;
        entry.spotDetailCount = Array.isArray(data.spotDetails) ? data.spotDetails.length : 0;
        onProgress(JSON.parse(JSON.stringify(result)));
      }
      result.stage = 'complete';
      return { ...result, ok: true, code: 'NINE_DAY1_PREVIEWS_COMPLETED_FULL_GENERATION_UNRUN' };
    }
    if (mealOnly) {
      // A normal authenticated customer may request an unpaid meal precheck.
      // Do not request the denied admin endpoint or the paid/full generator.
      result.stage = 'seven_day_meal_precheck';
      result.adminRequestSkipped = true;
      result.days = 7;
      result.dataWrites = 'preview_rate_counters_and_optional_meal_draft';
      result.planWrites = 0;
      const input = {
        area: 'seoul', regions: ['Seoul'], durationDays: 7, pax: 2,
        startDate: '2026-11-19', endDate: '2026-11-25', language: 'en',
        styles: ['Food Tour', 'Photo Spots', 'Palace'], priceRange: 'Moderate',
        arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1',
        recommendedZone: 'myeongdong', tourStartTime: '09:00', tourEndTime: '21:00',
        tourPace: 'full', dietaryRestrictions: [], suggestHotels: false,
        special_request: 'TEST ONLY / R90-D07-MEAL. Diagnostic Preview meal precheck. No booking or notifications.',
      };
      const started = now();
      const meal = await request(ORIGIN + '/api/meal-plan-draft', {
        method: 'POST', headers: { ...qaHeaders, 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ input, language: 'en' }),
      }, 190000);
      result.mealHttp = meal.status;
      result.mealResponseMs = now() - started;
      const requestId = meal.headers?.get?.('x-meal-draft-request-id');
      if (typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) result.mealRequestId = requestId;
      if (meal.status !== 200) return stop('MEAL_HTTP_NOT_ACCEPTED');
      const body = await meal.json();
      const code = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : 'unavailable';
      result.mealStatus = code(body.status);
      if (body.reason) result.mealReason = code(body.reason);
      result.referenceMealCount = Array.isArray(body.referenceMeals) ? body.referenceMeals.length : 0;
      result.mealDraftSaved = typeof body.draftId === 'string' && body.draftId.length > 0;
      result.mealAccepted = body.ok === true && ['verified', 'opening_unconfirmed'].includes(body.status);
      result.stage = 'complete';
      return { ...result, ok: result.mealAccepted,
        code: result.mealAccepted ? 'MEAL_PRECHECK_ACCEPTED' : 'MEAL_PRECHECK_REJECTED' };
    }
    if (identityOnly) {
      // The previous admin request was forbidden. Do not retry that resource.
      result.stage = 'allowed_identity_diagnostic';
      result.adminRequestSkipped = true;
      result.tokenAdminClaim = claims.admin === true;
      result.matchesKnownOperatorEmail = claims.email.toLowerCase() === '2001leety@gmail.com';
      const rootHeaders = deploymentCredential ? { 'x-vercel-protection-bypass': deploymentCredential } : {};
      const root = await request(ORIGIN + '/', { method: 'GET', headers: rootHeaders });
      result.qaRootHttp = root.status;
      if (root.status !== 200) return stop('QA_ROOT_ACCESS_NOT_CONFIRMED');
    } else {
      result.stage = 'server_verified_admin_read';
      const admin = await request(ORIGIN + '/api/admin-operational-checks', { method: 'GET', headers: qaHeaders });
      result.adminReadHttp = admin.status;
      if (admin.status !== 200) return stop('AUTHENTICATED_ADMIN_READ_NOT_CONFIRMED');
      const adminBody = await admin.json();
      if (adminBody.ok !== true || !adminBody.data || typeof adminBody.data !== 'object') {
        return stop('ADMIN_READ_RESPONSE_NOT_CONFIRMED');
      }
      result.serverAdminReadAllowed = true;
    }
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
    return { ...result, ok: true, code: identityOnly
      ? 'NORMAL_PREVIEW_IDENTITY_AND_ALLOWED_READS_CHECKED' : 'NORMAL_PREVIEW_AUTH_AND_READ_CHECKED' };
  } catch {
    // Never print provider bodies, exception messages, secrets or token claims.
    return stop('REQUEST_OR_RESPONSE_ERROR');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const persistProgress = (value) => {
    writeFileSync('preview-auth-result.json', JSON.stringify(value, null, 2) + '\n');
    console.log(JSON.stringify(value));
  };
  const result = await preflight(process.env, fetch, Date.now, {
    identityOnly: process.argv.includes('--identity-only'), mealOnly: process.argv.includes('--meal-only'),
    quickSeries: process.argv.includes('--quick-series'), onProgress: persistProgress,
  });
  writeFileSync('preview-auth-result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
