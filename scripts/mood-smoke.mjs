#!/usr/bin/env node
/**
 * CocoTrip — MOOD 로그인-뒤(인증) 스모크 (Brain OS 검증 시스템 편입, 2026-07-03)
 *
 * 왜: MOOD 포털·AI 예약은 로그인(allowlist) 게이트 뒤라 daily-health 의 공개 ping /
 *   validate-planner(플래너 전용)로는 검증되지 않았다. #1046 이 "검증 없이 머지"된
 *   근본 원인 = 로그인-뒤 흐름을 시스템이 안 돌렸음. 이 스크립트가 그 갭을 닫는다:
 *   기존 Firebase Auth REST idToken 패턴(validate-planner.cjs 와 동일)으로 실제
 *   Bearer 토큰을 발급 → 실 MOOD 엔드포인트를 인증 상태로 호출·검증.
 *
 * 검증 대상(전부 읽기전용/파싱 — 돈 차감 없음. mood-book 은 잔액을 깎으므로 제외):
 *   1. GET  /api/mood-data?clientId=mood   → { client:{balanceKRW}, bookings, isAdmin }
 *   2. GET  /api/mood-places               → { ok, places:[] }  (주소록)
 *   3. POST /api/mood-parse-schedule {text} → { ok, stops[], serviceGuess, needsConfirm:true }
 *
 * 필요 env (CI 시크릿 — validate-planner 와 공유):
 *   - FIREBASE_WEB_API_KEY, HEALTH_CHECK_PASSWORD
 *   - (선택) HEALTH_CHECK_EMAIL(기본 2001leety@gmail.com), MOOD_CLIENT_ID(기본 mood)
 *   시크릿 없으면 SKIP(exit 0) — 로컬에서 안전, CI 에서만 실동작(validate-planner 와 동일 정책).
 *
 * Usage: node scripts/mood-smoke.mjs [base-url]   (기본 https://cocotripkr.com)
 * Exit: 0 = pass/skip, 1 = 인증-뒤 MOOD 흐름 회귀.
 */

const BASE = process.argv[2] || process.env.BASE_URL || 'https://cocotripkr.com';
const TEST_EMAIL = process.env.HEALTH_CHECK_EMAIL || '2001leety@gmail.com';
const CLIENT_ID = process.env.MOOD_CLIENT_ID || 'mood';

// MOOD 가 준 자유 텍스트(파싱 정확도 확인용 — 이사님/일반/공항 3종 포함).
const SAMPLE_SCHEDULE = [
  '9:30 이사님 픽업 (인천 강화군 불은면)',
  '11:00 강남 코엑스 도착',
  '오후 3시 인천공항 T2 드랍',
].join('\n');

async function getIdToken() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const password = process.env.HEALTH_CHECK_PASSWORD;
  if (!apiKey || !password) return null; // SKIP 신호
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password, returnSecureToken: true }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`signInWithPassword failed: HTTP ${r.status} — ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  if (!j.idToken) throw new Error('Firebase Auth response missing idToken');
  return j.idToken;
}

async function jsonFetch(path, idToken, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 200) }; }
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`\n🔐 MOOD 인증 스모크 (로그인-뒤 검증)`);
  console.log(`   Base: ${BASE} · client: ${CLIENT_ID} · account: ${TEST_EMAIL}\n`);

  let idToken;
  try {
    idToken = await getIdToken();
  } catch (err) {
    console.error(`❌ idToken 발급 실패: ${err.message}`);
    process.exit(1);
  }
  if (!idToken) {
    console.log('⏭️  SKIP — FIREBASE_WEB_API_KEY / HEALTH_CHECK_PASSWORD 미설정 (로컬). CI 에서 실동작.');
    process.exit(0);
  }

  // 1) mood-data — 잔액/원장 조회 (로그인-뒤 조회 게이트)
  try {
    const { status, body } = await jsonFetch(`/api/mood-data?clientId=${encodeURIComponent(CLIENT_ID)}`, idToken);
    const ok = status === 200 && body?.client && typeof body.client.balanceKRW === 'number' && Array.isArray(body.bookings);
    record('mood-data 잔액/원장 조회', ok, ok ? `balance=${body.client.balanceKRW} bookings=${body.bookings.length} isAdmin=${body.isAdmin}` : `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  } catch (err) {
    record('mood-data 잔액/원장 조회', false, err.message);
  }

  // 2) mood-places — 주소록 조회 (AI 매칭 소스)
  try {
    const { status, body } = await jsonFetch('/api/mood-places', idToken);
    const ok = status === 200 && body?.ok === true && Array.isArray(body.places);
    record('mood-places 주소록 조회', ok, ok ? `places=${body.places.length}` : `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  } catch (err) {
    record('mood-places 주소록 조회', false, err.message);
  }

  // 3) mood-parse-schedule — AI 받아적기 파싱 (핵심 신규 흐름)
  try {
    const { status, body } = await jsonFetch('/api/mood-parse-schedule', idToken, {
      method: 'POST',
      body: JSON.stringify({ text: SAMPLE_SCHEDULE }),
    });
    // 계약: ok=true, stops 배열(≥1), serviceGuess ∈ {airport,vehicle,manager},
    //   needsConfirm 항상 true(더블체크). 샘플에 공항 있으니 serviceGuess=airport 기대.
    const svcOk = ['airport', 'vehicle', 'manager'].includes(body?.serviceGuess);
    const ok = status === 200 && body?.ok === true && Array.isArray(body.stops) && body.stops.length >= 1 && svcOk && body.needsConfirm === true;
    const detail = ok
      ? `stops=${body.stops.length} service=${body.serviceGuess} needsConfirm=${body.needsConfirm} (기대 airport=${body.serviceGuess === 'airport'})`
      : `HTTP ${status} ${JSON.stringify(body).slice(0, 200)}`;
    record('mood-parse-schedule AI 파싱', ok, detail);
    // 서비스 추천 오분류 경고(비차단 — Gemini 비결정성). 공항 샘플인데 airport 아니면 눈에 띄게.
    if (ok && body.serviceGuess !== 'airport') {
      console.log('  ⚠️  공항 포함 샘플인데 serviceGuess≠airport — 파싱/판별 확인 권장(비차단).');
    }
  } catch (err) {
    record('mood-parse-schedule AI 파싱', false, err.message);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔐 MOOD 스모크: ${checks.length - failed.length}/${checks.length} PASS — ${failed.length ? '🔴 DEGRADED' : '🟢 HEALTHY'}`);
  console.log(`${'═'.repeat(50)}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
