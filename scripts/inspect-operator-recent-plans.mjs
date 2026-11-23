/**
 * 운영자 본인 uid 의 최근 plan 5개 조회 — 5/27 plan-not-found 진단.
 */
import { readFileSync } from 'fs';

function parseEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g, '')]; })
    );
  } catch { return {}; }
}
const env = { ...parseEnvFile('.env'), ...parseEnvFile('.env.local') };
const apiKey = env.VITE_FIREBASE_API_KEY;
const projectId = env.VITE_FIREBASE_PROJECT_ID || 'planning-with-ai-a0801';
const email = env.HEALTH_CHECK_EMAIL || '';
if (!email) { console.error("HEALTH_CHECK_EMAIL 이 없음 — 운영자 계정 기본값은 뺐다(2026-11-22, 관리자 비밀번호 로그인 해제). 테스트 계정 이메일·비밀번호를 env 로 넣을 것. 자동 검사 역할 계정은 ADMIN-BYPASS-VALIDATE-/E2E-/REGRESSION- 주문만 무료 통과한다."); process.exit(1); }
const password = env.HEALTH_CHECK_PASSWORD;

const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }) }
);
const auth = await authRes.json();
if (!auth.idToken) { console.error('Auth fail'); process.exit(1); }
const uid = auth.localId;
console.log(`Auth OK (uid=${uid})\n`);

// Firestore REST: structured query for plans where uid == operator uid, order by createdAtMs desc, limit 10
const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
const queryBody = {
  structuredQuery: {
    from: [{ collectionId: 'plans' }],
    where: {
      fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } }
    },
    limit: 20
  }
};

const queryRes = await fetch(queryUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}` },
  body: JSON.stringify(queryBody)
});
const results = await queryRes.json();

function valOf(f) {
  if (!f) return null;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.timestampValue !== undefined) return f.timestampValue;
  if (f.arrayValue) return (f.arrayValue.values || []).map(v => valOf(v));
  if (f.mapValue) {
    const out = {};
    for (const [k, v] of Object.entries(f.mapValue.fields || {})) out[k] = valOf(v);
    return out;
  }
  return f;
}

console.log('=== 운영자 본인 최근 plan 10개 ===\n');
console.log('| planId | createdAt (KST) | status | _p231_stub | _inngest_status | tour_title | days | minimal_fb |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of (results || [])) {
  if (!r.document) continue;
  const f = r.document.fields || {};
  const planId = valOf(f.planId) || r.document.name.split('/').pop();
  const createdAtMs = valOf(f.createdAtMs);
  const kst = createdAtMs ? new Date(createdAtMs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '?';
  const status = valOf(f.status);
  const stub = valOf(f._p231_stub);
  const inngest = valOf(f._inngest_status);
  const tour = valOf(f.tour_title);
  const itin = valOf(f.itinerary);
  const days = Array.isArray(itin) ? itin.length : 0;
  const minimal = valOf(f.__repair_minimal_fallback);
  console.log(`| ${planId.slice(0,8)} | ${kst} | ${status || '-'} | ${stub || '-'} | ${inngest || '-'} | ${tour?.slice(0,30) || '-'} | ${days} | ${minimal || '-'} |`);
}
