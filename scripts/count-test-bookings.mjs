/**
 * Pre-flight for P0-#2 (TEST_ACCOUNTS bypass fix).
 *
 * 목적: prod Firestore에 TEST- prefix order ID로 생성된 booking + plan 카운트.
 * 결과 = "현재 prod에 어떤 영향이 있는지" 가시화. 0건이면 안전하게 reject 정책 적용 가능.
 *
 * 검사 대상:
 *   - bookings.captureID (Braintree transaction ID, TEST- 접두 검사)
 *   - bookings.paypalOrderId (구 PayPal direct, 일부 docs 만)
 *   - used_paypal_orders.<docId> (paymentGate.js가 set 한 sentinel — TEST-로 시작하는 docId)
 *   - plans.paypalOrderId (AI 플래너 결제 token, used_paypal_orders와 cross-check 가능)
 *
 * 실행:
 *   node scripts/count-test-bookings.mjs
 *
 * 요구:
 *   .env.admin.local 에 FIREBASE_* 키 (다른 admin script 와 동일 패턴)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.admin.local');

let env = {};
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^(\w+)=(.+)$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      env[m[1]] = val;
    }
  }
} catch (e) {
  console.error('[pre-flight] .env.admin.local 읽기 실패:', e.message);
  console.error('[pre-flight] 다른 admin script 와 동일 자격 증명 필요.');
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID || 'planning-with-ai-a0801',
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  }),
});

const db = getFirestore();

async function countTestPrefix(collection, field, prefix = 'TEST-') {
  // Firestore range query trick: prefix == [prefix, prefix + '￿']
  const snap = await db.collection(collection)
    .where(field, '>=', prefix)
    .where(field, '<', prefix + '￿')
    .get();
  return snap;
}

async function countTestDocIds(collection, prefix = 'TEST-') {
  // Firestore __name__ range query needs DocumentReference, not string path.
  // 안전한 방식: 컬렉션 전체 스캔 후 in-memory 필터.
  // used_paypal_orders 는 일반적으로 100s 수준이라 부담 없음.
  const snap = await db.collection(collection).get();
  const matched = snap.docs.filter(d => d.id.startsWith(prefix));
  return { size: matched.length, docs: matched, total: snap.size };
}

(async () => {
  console.log('[pre-flight] TEST- prefix booking + plan 카운트 시작...\n');

  const results = {};

  // 1. bookings.captureID 시작 TEST- (Braintree)
  try {
    const snap = await countTestPrefix('bookings', 'captureID');
    results.bookings_captureID = {
      count: snap.size,
      samples: snap.docs.slice(0, 5).map(d => ({
        id: d.id,
        captureID: d.data().captureID,
        userEmail: d.data().userEmail,
        productType: d.data().productType,
        amountKRW: d.data().amountKRW,
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
      })),
      dateRange: snap.size > 0 ? {
        oldest: snap.docs.map(d => d.data().createdAt?.toDate?.()).filter(Boolean).sort()[0]?.toISOString(),
        newest: snap.docs.map(d => d.data().createdAt?.toDate?.()).filter(Boolean).sort().slice(-1)[0]?.toISOString(),
      } : null,
    };
  } catch (e) {
    results.bookings_captureID = { error: e.message };
  }

  // 2. bookings.paypalOrderId (legacy)
  try {
    const snap = await countTestPrefix('bookings', 'paypalOrderId');
    results.bookings_paypalOrderId = { count: snap.size };
  } catch (e) {
    results.bookings_paypalOrderId = { error: e.message };
  }

  // 3. used_paypal_orders sentinel (paymentGate.js) — TEST- doc ID 검색
  try {
    const snap = await countTestDocIds('used_paypal_orders');
    results.used_paypal_orders = {
      count: snap.size,
      total_in_collection: snap.total,
      samples: snap.docs.slice(0, 5).map(d => ({
        orderId: d.id,
        usedAt: d.data().usedAt,
        provider: d.data().provider,
      })),
      dateRange: snap.size > 0 ? {
        oldest: snap.docs.map(d => d.data().usedAt).filter(Boolean).sort()[0],
        newest: snap.docs.map(d => d.data().usedAt).filter(Boolean).sort().slice(-1)[0],
      } : null,
    };
  } catch (e) {
    results.used_paypal_orders = { error: e.message };
  }

  // 4. plans.paypalOrderId
  try {
    const snap = await countTestPrefix('plans', 'paypalOrderId');
    results.plans_paypalOrderId = {
      count: snap.size,
      samples: snap.docs.slice(0, 5).map(d => ({
        id: d.id,
        userEmail: d.data().userEmail,
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
      })),
    };
  } catch (e) {
    results.plans_paypalOrderId = { error: e.message };
  }

  console.log(JSON.stringify(results, null, 2));

  // Summary
  const total = (results.bookings_captureID?.count || 0)
    + (results.bookings_paypalOrderId?.count || 0)
    + (results.used_paypal_orders?.count || 0)
    + (results.plans_paypalOrderId?.count || 0);

  console.log(`\n[pre-flight] 총 TEST- prefix records: ${total}`);
  if (total === 0) {
    console.log('[pre-flight] ✅ 0건 — P0-#2 fix safe to deploy without legacy compatibility concerns.');
  } else {
    console.log('[pre-flight] ⚠️ legacy TEST- records exist. Operator decision needed:');
    console.log('  (a) 그대로 두고 신규만 reject — Firestore 데이터 손실 0');
    console.log('  (b) legacy 도 admin /admin/reconciliation 에서 검토 후 정리');
  }

  process.exit(0);
})();
