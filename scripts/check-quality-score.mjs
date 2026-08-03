// CocoTrip 자율 검증 시스템 v1 — L3 일일 Quality Score 모니터링 + Alert
//
// Tier 1-A endpoint (`/api/admin-quality-summary`, PR #225 + PR-D) 를 24h
// 윈도우로 호출해 평균 점수 + sample count 를 7-day 기준선 (또는 hardcoded
// floor) 과 비교, 회귀 감지 시 GitHub Issue + Telegram alert 발송.
//
// 자율 검증 L1/L2 (api-health + daily-health) 와 분리 — L3 는 "오류 없음" 이
// 아니라 "품질 회귀" 를 본다. Gemini 비결정성 + DB 갱신 + 프롬프트 drift 가
// 누적되면 endpoint 응답 자체는 200 OK 라도 평균 점수가 슬슬 내려간다.
//
// === 실행 흐름 ===
//   1) Firebase Auth REST signInWithPassword → idToken (admin 권한)
//   2) 24h 윈도우: GET /api/admin-quality-summary?days=1&limit=200
//   3) 7d 베이스라인: GET /api/admin-quality-summary?days=7&limit=500
//      (인덱스 없는 신규 배포에서도 fallback 동작 — endpoint 자체가 가짐)
//   4) 임계 검사:
//        - 24h scoredCount < MIN_SAMPLES → 트래픽 급감 경고 (degraded=warn)
//        - 24h avgScore < HARD_FLOOR (80) → 즉시 fail (degraded=hard)
//        - 24h avgScore < (7d avgScore - DROP_DELTA) → 회귀 fail (degraded=regression)
//        - 그 외 → OK
//   5) GITHUB_STEP_SUMMARY md table 작성 (CI 친화)
//   6) STATUS_FILE (JSON) 저장 → workflow 가 읽어 issue/telegram payload 생성
//
// === 환경변수 ===
//   FIREBASE_WEB_API_KEY        — Firebase Web API key (VITE_FIREBASE_API_KEY 와 동일)
//   HEALTH_CHECK_EMAIL          — admin 계정 (TEST- prefix 바이패스 권한)
//   HEALTH_CHECK_PASSWORD       — admin 계정 비밀번호
//   BASE_URL  (선택, 기본 https://cocotripkr.com)
//   MIN_SAMPLES  (선택, 기본 5)        — 24h scoredCount 최저 기준
//   HARD_FLOOR_SCORE  (선택, 기본 80)  — 단독 fail 임계 (Phase 3 후 ~90 평균 가정)
//   DROP_DELTA  (선택, 기본 10)        — 7d 평균 대비 10점 (즉 ~10%) 하락 시 fail
//   STATUS_FILE  (선택, 기본 ./quality-alert-status.json)
//
// === Exit code ===
//   0 — OK (또는 베이스라인 부족·endpoint 미배포 등 graceful skip)
//   1 — hard / regression / fetch-fail (workflow 가 issue + telegram alert 발송)
//
// === 운영자 후속 조치 ===
//   - hard floor 미달: validate-planner.cjs 로 회귀 원인 확인, _food_index 보강
//   - regression: 최근 머지 PR diff 검토 (Gemini 프롬프트·DB matcher 변경 의심)
//   - sample 부족: 트래픽 정상 여부 + ai-planner-full silent fail 점검
//
// 한국어 admin 정책 — i18n 키 없음. 모든 로그/메시지 한국어.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        }),
    );
  } catch { return {}; }
}

const envMain  = parseEnv(join(root, '.env'));
const envLocal = parseEnv(join(root, '.env.local'));

const apiKey =
  process.env.FIREBASE_WEB_API_KEY ||
  envMain.VITE_FIREBASE_API_KEY ||
  envLocal.VITE_FIREBASE_API_KEY;
const email    = process.env.HEALTH_CHECK_EMAIL    || envLocal.HEALTH_CHECK_EMAIL;
const password = process.env.HEALTH_CHECK_PASSWORD || envLocal.HEALTH_CHECK_PASSWORD;
const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';

const MIN_SAMPLES     = parseInt(process.env.MIN_SAMPLES     || '5',  10);
const HARD_FLOOR      = parseInt(process.env.HARD_FLOOR_SCORE || '80', 10);
const DROP_DELTA      = parseInt(process.env.DROP_DELTA       || '10', 10);
const STATUS_FILE     = process.env.STATUS_FILE || join(root, 'quality-alert-status.json');

function writeStatus(payload) {
  try {
    writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.warn(`[quality-alert] status file write failed: ${e.message}`);
  }
}

async function appendStepSummary(md) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const { appendFileSync } = await import('fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

function bail(reason, payload = {}) {
  // graceful exit 0 — workflow continue (alert 안 함). 미배포·credential 미설정 등.
  console.warn(`[quality-alert] graceful skip: ${reason}`);
  writeStatus({
    status: 'skipped',
    reason,
    generatedAt: new Date().toISOString(),
    ...payload,
  });
  process.exit(0);
}

function fail(payload) {
  writeStatus({ status: 'fail', generatedAt: new Date().toISOString(), ...payload });
  process.exit(1);
}

function ok(payload) {
  writeStatus({ status: 'ok', generatedAt: new Date().toISOString(), ...payload });
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔍 CocoTrip 자율 검증 L3 — Quality Score 모니터링');
console.log(`   Target: ${BASE_URL}`);
console.log(`   임계: hard=${HARD_FLOOR}, drop=${DROP_DELTA}점, min_samples=${MIN_SAMPLES}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!apiKey || !email || !password) {
  // CI 가 secret 등록 전 첫 manual trigger 일 수 있으므로 fail 대신 graceful skip.
  bail('credentials_missing', {
    note: 'FIREBASE_WEB_API_KEY / HEALTH_CHECK_EMAIL / HEALTH_CHECK_PASSWORD 미설정',
  });
}

// ── Step 1: Firebase Auth ────────────────────────────────────────────
console.log('[1/3] Firebase Auth signInWithPassword...');
let idToken;
try {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const j = await r.json();
  if (!j.idToken) {
    bail('auth_failed', { httpStatus: r.status, errorBody: JSON.stringify(j).slice(0, 300) });
  }
  idToken = j.idToken;
  console.log(`✅ idToken 발급 (uid=${j.localId})\n`);
} catch (e) {
  bail('auth_throw', { error: e.message });
}

// ── Step 2: Tier 1-A endpoint 호출 (24h + 7d) ────────────────────────
async function fetchSummary(days, limit) {
  const url = `${BASE_URL}/api/admin-quality-summary?days=${days}&limit=${limit}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* leave null */ }
  return { httpStatus: r.status, body, raw: text };
}

console.log('[2/3] GET /api/admin-quality-summary (days=1 + days=7)...');
let last24h, last7d;
try {
  [last24h, last7d] = await Promise.all([
    fetchSummary(1, 200),
    fetchSummary(7, 500),
  ]);
} catch (e) {
  fail({
    reason: 'fetch_throw',
    severity: 'hard',
    error: e.message,
    summary: '엔드포인트 호출 자체가 실패. 네트워크 / Vercel 다운 의심.',
  });
}

if (last24h.httpStatus === 404) {
  // endpoint 미배포 — PR 머지 전 trigger 일 수 있으므로 graceful skip
  bail('endpoint_404', {
    httpStatus: 404,
    note: '/api/admin-quality-summary 미배포. PR #225 머지 확인 필요.',
  });
}

if (last24h.httpStatus !== 200 || !last24h.body) {
  fail({
    reason: 'fetch_non_200',
    severity: 'hard',
    httpStatus: last24h.httpStatus,
    rawSnippet: (last24h.raw || '').slice(0, 300),
    summary: `Tier 1-A endpoint 가 ${last24h.httpStatus} 반환. response shape 변경 의심.`,
  });
}

// 7d 베이스라인은 graceful — 실패해도 hard floor 만으로 판정.
const baselineOk = last7d.httpStatus === 200 && last7d.body && last7d.body.overall;

// ── Step 3: 임계 검사 ───────────────────────────────────────────────
const window24h = last24h.body.window || {};
const overall24h = last24h.body.overall || {};
const overall7d  = baselineOk ? last7d.body.overall : null;

const sampleCount = window24h.scoredCount ?? 0;
const avgScore24  = overall24h.avgScore;   // number | null
const avgScore7d  = overall7d?.avgScore;   // number | null (or undefined)

const collectionMissing = Array.isArray(last24h.body._collectionMissing)
  ? last24h.body._collectionMissing
  : [];

// 🔴 2026-08-03: endpoint 가 운영자·CI 테스트 플랜을 집계에서 뺀다. 몇 건을 뺐는지
//   같이 봐야 "표본 0" 이 품질 문제인지 손님 트래픽 문제인지 구분된다.
const excludedTestPlans = Number(window24h.excludedTestPlans) || 0;

console.log(`   24h: scoredCount=${sampleCount}, avgScore=${avgScore24}, 테스트플랜 제외=${excludedTestPlans}`);
console.log(`   7d:  scoredCount=${last7d.body?.window?.scoredCount ?? '?'}, avgScore=${avgScore7d ?? '?'}`);
console.log(`   _collectionMissing: ${collectionMissing.length ? collectionMissing.join(',') : '없음'}`);

// 표시용 라벨. nullish 연산자는 pre-commit MOJIBAKE 검사 시그니처라 쓰지 않는다.
const avg24Label = typeof avgScore24 === 'number' ? String(avgScore24) : 'null';

console.log('\n[3/3] 임계 검사...');

const issues = [];
let severity = 'ok';

// (a) Sample 부족 — 트래픽 급감 또는 ai-planner-full silent fail 의심
if (sampleCount < MIN_SAMPLES) {
  issues.push({
    id: 'sample_count',
    severity: 'warn',
    actual: sampleCount,
    threshold: MIN_SAMPLES,
    excludedTestPlans,
    detail: excludedTestPlans > 0
      ? `24h 동안 손님 plan ${sampleCount}건 (< ${MIN_SAMPLES}). 같은 창에서 운영자·CI 테스트 plan ${excludedTestPlans}건을 집계에서 제외했다 — 품질 회귀가 아니라 손님 트래픽 문제로 먼저 본다.`
      : `24h 동안 qualityScore 보유 plan ${sampleCount}건 (< ${MIN_SAMPLES}). 트래픽 정상 여부 + ai-planner-full silent fail 점검 권장.`,
  });
  severity = severity === 'ok' ? 'warn' : severity;
}

// avgScore 가 null (24h scored=0) 이면 별도 분기. scoredCount<MIN_SAMPLES 와 묶인다.
const hasScore = typeof avgScore24 === 'number';

// (b) Hard floor — 단독 fail (베이스라인 없어도 동작)
if (hasScore && avgScore24 < HARD_FLOOR) {
  issues.push({
    id: 'hard_floor',
    severity: 'hard',
    actual: avgScore24,
    threshold: HARD_FLOOR,
    detail: `24h 평균 ${avgScore24} < hard floor ${HARD_FLOOR}. 즉시 회귀 검사 필요 (Gemini 프롬프트·DB matcher·_food_index 변경 이력 확인).`,
  });
  severity = 'hard';
}

// (c) Regression — 7d 베이스라인 대비 DROP_DELTA 점 하락
if (hasScore && baselineOk && typeof avgScore7d === 'number') {
  const drop = avgScore7d - avgScore24;
  if (drop >= DROP_DELTA) {
    issues.push({
      id: 'regression',
      severity: 'regression',
      actual: avgScore24,
      baseline: avgScore7d,
      drop,
      threshold: DROP_DELTA,
      detail: `24h 평균 ${avgScore24} vs 7d 평균 ${avgScore7d} (−${drop}점). 직전 머지 PR diff 확인 권장.`,
    });
    if (severity !== 'hard') severity = 'regression';
  }
}

// (d) 컬렉션 미존재 — silent fail 노출 (검증 시스템 자체의 운영 신뢰도)
if (collectionMissing.length > 0) {
  issues.push({
    id: 'collection_missing',
    severity: 'warn',
    detail: `Firestore 미존재 컬렉션: ${collectionMissing.join(', ')}. _shared/quality-summary-helper.js 가 silent fail 노출.`,
  });
  if (severity === 'ok') severity = 'warn';
}

// ── 결과 출력 + STATUS_FILE 작성 ─────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 결과: ${severity.toUpperCase()} (issues=${issues.length})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const i of issues) {
  console.log(`  [${i.severity}] ${i.id}: ${i.detail}`);
}

// metric frequency Top 3 (참고용)
const metricFreq = last24h.body.metricFrequency || {};
const topMetrics = Object.entries(metricFreq)
  .map(([metric, cell]) => ({ metric, ...cell }))
  .filter((m) => m.violations > 0)
  .sort((a, b) => b.avgRate - a.avgRate)
  .slice(0, 3);

// GITHUB_STEP_SUMMARY (md table)
const md = [
  '# L3 — Quality Score 일일 모니터링',
  '',
  `**Target:** ${BASE_URL}  `,
  `**Status:** ${severity.toUpperCase()}  `,
  `**24h:** avg \`${avg24Label}\`, 손님 plan \`${sampleCount}\` (테스트 plan \`${excludedTestPlans}\`건 제외)  `,
  `**7d 베이스라인:** avg \`${avgScore7d ?? 'n/a'}\`  `,
  '',
  '## 임계',
  '',
  `- Hard floor: \`${HARD_FLOOR}\` (단독 fail)`,
  `- Drop delta: 7d − 24h ≥ \`${DROP_DELTA}\` 점 (regression fail)`,
  `- Min samples: \`${MIN_SAMPLES}\` (warn)`,
  '',
  '## 감지된 이슈',
  '',
  issues.length === 0
    ? '없음.'
    : issues.map((i) => `- **[${i.severity}] ${i.id}** — ${i.detail}`).join('\n'),
  '',
  '## Top 3 violation rate (24h)',
  '',
  topMetrics.length === 0
    ? '없음.'
    : '| metric | violations | stops | avgRate |\n| --- | ---: | ---: | ---: |\n' +
      topMetrics.map((m) => `| ${m.metric} | ${m.violations} | ${m.stops} | ${m.avgRate} |`).join('\n'),
  '',
].join('\n');

await appendStepSummary(md);

const payload = {
  status: severity === 'ok' ? 'ok' : severity === 'warn' ? 'warn' : 'fail',
  severity,
  baseUrl: BASE_URL,
  window24h: {
    avgScore: avgScore24,
    sampleCount,
    excludedTestPlans,
    minScore: overall24h.minScore,
    maxScore: overall24h.maxScore,
  },
  baseline7d: baselineOk
    ? { avgScore: avgScore7d, sampleCount: last7d.body.window?.scoredCount ?? 0 }
    : null,
  thresholds: { hardFloor: HARD_FLOOR, dropDelta: DROP_DELTA, minSamples: MIN_SAMPLES },
  issues,
  topMetrics,
  collectionMissing,
  generatedAt: new Date().toISOString(),
};

// hard / regression 만 workflow 실패. warn 은 issue 안 만들고 STEP_SUMMARY 만.
if (severity === 'hard' || severity === 'regression') {
  fail(payload);
} else {
  ok(payload);
}
