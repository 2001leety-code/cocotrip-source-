// prod uptime smoke — 가벼운 health (홈·핵심 API 200·응답시간). Gemini/결제 호출 없음(공짜).
// daily-health.yml(주3회 깊은 Playwright E2E)의 상시(매시간) 보완 — prod 다운을 빨리 감지.
// 실패 시 workflow 가 Telegram 1곳에 긴급 알림 + GitHub Issue 지속 기록. exit 1 = 하나라도 실패.
const BASE = process.env.BASE_URL || 'https://cocotripkr.com';
const TIMEOUT_MS = 15000;
const SLOW_MS = 8000; // 응답 8초 초과 = 느림 경고(실패는 아님)

const checks = [
  { name: '홈 /', path: '/', ok: (r) => r.status === 200 },
  { name: '플래너 /planner', path: '/planner', ok: (r) => r.status === 200 },
  // 4xx = 서버 살아있음(OK), 5xx = 백엔드 장애(fail). planId 더미라 정상 404 기대.
  // 주의: Firestore 는 `__x__` 패턴을 예약어로 거부(500) → 일반 문자열 사용.
  { name: 'API plan-status', path: '/api/plan-status?planId=uptime-smoke-probe', ok: (r) => r.status < 500 },
];

async function probe(c) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + c.path, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    const ms = Date.now() - t0;
    return { name: c.name, status: r.status, ms, pass: c.ok(r), slow: ms > SLOW_MS };
  } catch (e) {
    return { name: c.name, status: 0, ms: Date.now() - t0, pass: false, slow: false, err: e.message };
  }
}

const results = await Promise.all(checks.map(probe));
let failed = 0;
let slow = 0;
for (const r of results) {
  const tag = r.slow ? ' (느림)' : '';
  const err = r.err ? ' ' + r.err : '';
  console.log(`${r.pass ? 'OK ' : 'FAIL'} ${r.name} — HTTP ${r.status} (${r.ms}ms)${tag}${err}`);
  if (!r.pass) failed++;
  if (r.slow) slow++;
}
console.log(`\n결과: ${results.length - failed}/${results.length} 통과${slow ? `, 느림 ${slow}` : ''}`);
if (failed > 0) {
  console.error(`SMOKE_FAIL: ${failed}개 실패`);
  process.exit(1);
}
