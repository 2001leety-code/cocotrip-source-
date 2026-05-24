/**
 * P182 (2026-05-24): telegram alert 자동 fetch — error_log Firestore collection
 * 의 최근 N건 read. backend 의 throttledTelegramAlert 가 매 alert 마다 error_log
 * 에 raw 저장 (line 138-151 telegram-throttle.js) → 우리 측 자율 검증 시스템이
 * 직접 fetch (운영자 텔레그램 복사-붙여넣기 우회).
 *
 * 사용: node scripts/fetch-recent-alerts.cjs [limit] [base-url]
 *   limit: default 20, max 100
 *   base-url: default https://cocotripkr.com (Firestore project 자동 inferred)
 *
 * Firestore rules: error_log read = admin email only (P182 변경 + firebase deploy 필요).
 * 우리는 admin email (HEALTH_CHECK_EMAIL=2001leety@gmail.com) 인증.
 */
const fs = require('fs');
const path = require('path');

const LIMIT = Math.min(100, Math.max(1, Number.parseInt(process.argv[2] || '20', 10)));
const TEST_EMAIL = process.env.HEALTH_CHECK_EMAIL || '2001leety@gmail.com';
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'planning-with-ai-a0801';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getIdToken() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  const password = process.env.HEALTH_CHECK_PASSWORD;
  if (!apiKey || !password) {
    throw new Error('FIREBASE_WEB_API_KEY (또는 VITE_FIREBASE_API_KEY) + HEALTH_CHECK_PASSWORD env 필수');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password, returnSecureToken: true }),
  });
  if (!r.ok) throw new Error(`Firebase Auth ${r.status}: ${(await r.text()).substring(0,200)}`);
  return (await r.json()).idToken;
}

function unwrap(v) {
  if (v == null) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number.parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(unwrap);
  if (v.mapValue !== undefined) {
    const m = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) m[k] = unwrap(vv);
    return m;
  }
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  return v;
}

async function fetchRecentAlerts(idToken) {
  // Firestore REST runQuery (orderBy + limit). REST API path:
  //   POST .../documents:runQuery
  //   body: structuredQuery { from, orderBy, limit }
  const url = `${FIRESTORE_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'error_log' }],
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: LIMIT,
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Firestore runQuery ${r.status}: ${errText.substring(0, 300)}`);
  }
  const docs = await r.json();
  // runQuery 응답: 배열 [{ document: { fields } }, ...]
  const alerts = [];
  for (const d of docs) {
    if (!d.document) continue;
    const fields = d.document.fields || {};
    alerts.push({
      key: unwrap(fields.key),
      channel: unwrap(fields.channel),
      severity: unwrap(fields.severity),
      message: unwrap(fields.message),
      context: unwrap(fields.context),
      createdAt: unwrap(fields.createdAt),
      createdAtISO: unwrap(fields.createdAtISO),
    });
  }
  return alerts;
}

function formatAlert(a, idx) {
  const ts = a.createdAtISO || new Date(a.createdAt || 0).toISOString();
  const sev = (a.severity || 'medium').toUpperCase();
  const sevIcon = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴' }[sev] || '⚪';
  // HTML escape 풀기 (telegram message → terminal 가독성)
  const msgPlain = (a.message || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const msgFirst = msgPlain.split('\n')[0].substring(0, 200);
  return `${String(idx + 1).padStart(2)}. ${sevIcon} [${ts}] ${a.key || '(no-key)'}\n     ${msgFirst}`;
}

async function main() {
  console.log(`\n🔔 Recent telegram alerts (Firestore error_log, last ${LIMIT})`);
  console.log(`   Project: ${PROJECT_ID}`);
  console.log(`   Auth: ${TEST_EMAIL}\n`);

  const idToken = await getIdToken();
  console.log(`🔑 Token len=${idToken.length}\n`);

  const alerts = await fetchRecentAlerts(idToken);
  if (alerts.length === 0) {
    console.log('  (no recent alerts in error_log)\n');
    return;
  }

  console.log(`${'─'.repeat(70)}`);
  for (let i = 0; i < alerts.length; i++) {
    console.log(formatAlert(alerts[i], i));
  }
  console.log(`${'─'.repeat(70)}`);

  // Summary by key
  const byKey = {};
  for (const a of alerts) {
    const k = a.key || '(no-key)';
    byKey[k] = (byKey[k] || 0) + 1;
  }
  const sorted = Object.entries(byKey).sort((a, b) => b[1] - a[1]);
  console.log('\n📊 dedup key 빈도:');
  for (const [k, n] of sorted) {
    console.log(`   ${n}x  ${k}`);
  }
  console.log();

  // Output JSON for tooling
  const outPath = path.join(__dirname, 'recent-alerts.json');
  fs.writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), limit: LIMIT, count: alerts.length, alerts }, null, 2));
  console.log(`💾 ${outPath}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
