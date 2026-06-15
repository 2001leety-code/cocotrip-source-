/**
 * jarvis-lookup.mjs — 디스코드 자비스 "단건 조회" (읽기 전용).
 *
 * 봇이 사장님의 "예약 CT-1234" / "고객 a@b.com" / "플랜 abc123" 같은 명령에 이 스크립트를
 * 고정 type + value 인자로 실행한다. value 는 Firestore .where() 값으로만 쓰여(코드 실행 X)
 * 프롬프트 주입 안전. type 은 봇이 화이트리스트(booking|email|plan)로 매핑해 넘긴다.
 *
 * 사용: node scripts/jarvis-lookup.mjs <booking|email|plan> <value>
 * READ-ONLY: .get() 만.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { toMs } from '../api/_shared/morningBriefingAggregate.js';

for (const file of ['.env', '.env.local', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1]; let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* optional */ }
}

const type = (process.argv[2] || '').toLowerCase();
const value = (process.argv[3] || '').trim();
if (!['booking', 'email', 'plan'].includes(type) || !value) {
  console.log('조회 형식: "예약 <번호>" / "고객 <이메일>" / "플랜 <ID>"');
  process.exit(0);
}

let db;
try {
  const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^﻿/, '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
  const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
  let privateKey = rawKey;
  if (pemMatch) { const c = pemMatch[1].replace(/\s+/g, ''); privateKey = '-----BEGIN PRIVATE KEY-----\n' + (c.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n'; }
  if (!getApps().length) initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey }) });
  db = getFirestore();
} catch (e) {
  console.log(`조회 실패: Firebase 연결 오류 — ${e.message}`);
  process.exit(1);
}

const kstDate = (v) => { const ms = toMs(v); if (ms == null) return '-'; const d = new Date(ms + 9 * 3600 * 1000); const p = (x) => String(x).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const driverState = (b) => (b.driver && String(b.driver).trim()) || b.driverChatId || b.acceptedAt || String(b.dispatchStatus || '') === 'accepted' ? `배정됨${b.driver ? `(${b.driver})` : ''}` : '🔴 미배정';
const bookingLine = (id, b) => `· ${id.slice(0, 10)} | ${b.tourDate || '-'} | ${b.productType || b.product || '-'} | ${b.status || '-'} | $${b.amountUSD || '0'} | ${driverState(b)}${b.status === 'REFUNDED' || b.status === 'PARTIALLY_REFUNDED' ? ` | 환불 ${kstDate(b.refundedAt)}` : ''}`;

async function firstMatch(field, val) {
  try { const s = await db.collection('bookings').where(field, '==', val).limit(5).get(); if (!s.empty) return s.docs; } catch { /* ignore */ }
  return null;
}

const out = [];
if (type === 'booking') {
  let docs = null;
  // doc id 직접 → bookingRef → orderId → paypalOrderId 순서로 시도.
  try { const d = await db.collection('bookings').doc(value).get(); if (d.exists) docs = [d]; } catch { /* ignore */ }
  if (!docs) docs = await firstMatch('bookingRef', value);
  if (!docs) docs = await firstMatch('orderId', value);
  if (!docs) docs = await firstMatch('paypalOrderId', value);
  if (!docs || !docs.length) { out.push(`예약 "${value}" 못 찾음. (번호/주문ID 확인)`); }
  else {
    out.push(`🔎 예약 조회: ${value}`);
    for (const d of docs) {
      const b = d.data();
      out.push('', bookingLine(d.id, b),
        `  고객: ${b.customerName || '-'} · ${b.payerEmail || b.userEmail || '-'}`,
        `  결제: $${b.amountUSD || '0'} (환율 ${b.exchangeRate || '-'}) · 쿠폰 ${b.couponApplied || '없음'} · 생성 ${kstDate(b.createdAt)}`,
        `  경로: ${[b.pickupLocation, b.dropoffLocation].filter(Boolean).join(' → ') || '-'} · 인원 ${b.paxCount || '-'}`);
    }
  }
} else if (type === 'email') {
  let docs = [];
  try { const s = await db.collection('bookings').where('payerEmail', '==', value).limit(20).get(); docs = s.docs; } catch { /* ignore */ }
  if (!docs.length) { try { const s = await db.collection('bookings').where('userEmail', '==', value).limit(20).get(); docs = s.docs; } catch { /* ignore */ } }
  if (!docs.length) { out.push(`고객 "${value}" 예약 없음.`); }
  else {
    let total = 0; for (const d of docs) total += parseFloat(d.data().amountUSD) || 0;
    out.push(`🔎 고객 조회: ${value} — 예약 ${docs.length}건 · 누적 $${total.toFixed(2)}`, '');
    for (const d of docs.slice(0, 12)) out.push(bookingLine(d.id, d.data()));
  }
} else if (type === 'plan') {
  let snap = null;
  try { snap = await db.collection('plans').doc(value).get(); } catch { /* ignore */ }
  if (!snap || !snap.exists) { out.push(`플랜 "${value}" 못 찾음.`); }
  else {
    const p = snap.data();
    out.push(`🔎 플랜 조회: ${value.slice(0, 12)}`, '',
      `· 상태: ${p.status || '-'} · 지역: ${p.input && p.input.area ? p.input.area : (p.area || '-')}`,
      `· 결제: ${p.paymentSource || '-'}${p.isAdminBypass ? ' (admin-bypass)' : ''} · paypalOrderId ${p.paypalOrderId || '-'}`,
      `· 생성: ${kstDate(p.createdAtMs != null ? p.createdAtMs : p.createdAt)} · days ${(p.itinerary && p.itinerary.days && p.itinerary.days.length) || '-'}`);
  }
}
console.log(out.join('\n'));
process.exit(0);
