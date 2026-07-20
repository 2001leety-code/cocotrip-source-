// ─────────────────────────────────────────────────────────────────────────────
// 플래너 스모크 스크립트 공용 헬퍼 (2026-07-20)
//
// 배경: scripts/create-temp-plan.js 와 scripts/test-production-plan.mjs 가 둘 다
//   Authorization 헤더 없이 /api/ai-planner-full 을 호출해 401 로 죽어 있었다.
//   2026-05-04 PR #247 (audit P0-#2) 이후 이 엔드포인트는 verifyUserToken 을 호출하므로
//   Bearer <idToken> 이 필수다. scripts/validate-planner.cjs 는 P174 때 이미 고쳐졌지만
//   이 둘은 남아 있었고, 아무도 안 돌려봐서 몰랐다.
//
// 같은 로직을 세 번째로 복붙하지 않으려고 여기로 뺀다. validate-planner.cjs 는 CJS 라
// 그대로 두었다 — 동작 중인 코드를 모듈 시스템 때문에 건드릴 이유가 없다.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';

/** .env 계열 파일을 읽어 process.env 에 주입 (기존 값은 덮지 않는다). */
export function loadDotEnv(files = ['.env', '.env.admin.local', '.env.test.local']) {
  for (const file of files) {
    try {
      const envText = readFileSync(file, 'utf8');
      const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
      let m;
      while ((m = pattern.exec(envText)) !== null) {
        const key = m[1];
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1).replace(/\\n/g, '\n');
        }
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {}
  }
}

/**
 * Firebase Auth REST API 로 admin 계정 idToken 발급.
 * scripts/validate-planner.cjs::getIdToken 과 동일 방식 (env 이름까지 맞춤).
 *
 * 필수 env:
 *   FIREBASE_WEB_API_KEY   Firebase Console → Project settings → General → Web API Key
 *   HEALTH_CHECK_PASSWORD  admin 계정 비밀번호
 *   (선택) HEALTH_CHECK_EMAIL  기본값 2001leety@gmail.com
 */
export async function getIdToken() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const password = process.env.HEALTH_CHECK_PASSWORD;
  const email = process.env.HEALTH_CHECK_EMAIL || '2001leety@gmail.com';
  if (!apiKey || !password) {
    throw new Error(
      'FIREBASE_WEB_API_KEY + HEALTH_CHECK_PASSWORD env 필수. 로컬 .env 또는 GitHub Actions ' +
      'Secrets 에 등록. docs/AUTOMATION.md 참조.'
    );
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Firebase Auth signInWithPassword failed: HTTP ${r.status} — ${errText.slice(0, 200)}`);
  }
  const j = await r.json();
  if (!j.idToken) throw new Error('Firebase Auth response missing idToken');
  return j.idToken;
}

/**
 * 서버 날짜 검증(PLANNER_DATE_TOO_SOON)을 통과하는 미래 날짜.
 * 하드코딩된 과거 날짜가 전 시나리오를 HTTP 400 으로 죽인 사고가 있었다
 * (validate-planner.cjs 2026-07-03 fix 주석 참조). 고정 날짜를 쓰지 말 것.
 */
export function futureDate(daysAhead = 14) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}

/**
 * admin bypass orderId. 서버(_ai_core/paymentGate.js)가 Firebase ID token 의 email 을
 * ADMIN_BYPASS_EMAILS/ADMIN_EMAIL 과 대조해 최종 판정한다 — 이 문자열 자체는 권한이 아니다.
 * (구 TEST- prefix 경로는 2026-07-20 폐지됐다.)
 */
export function adminBypassOrderId(label) {
  return `ADMIN-BYPASS-${label}-${Date.now()}`;
}

/** /api/ai-planner-full 호출 + Bearer 주입. 실패 시 본문을 그대로 실어 throw. */
export async function postPlanner(baseUrl, body, idToken, { timeoutMs = 240000 } = {}) {
  const res = await fetch(`${baseUrl}/api/ai-planner-full`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(
      `POST /api/ai-planner-full → HTTP ${res.status} ${json?.code || ''} ${json?.error || ''}`.trim()
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}
