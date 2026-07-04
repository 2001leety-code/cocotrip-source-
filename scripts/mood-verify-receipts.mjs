/**
 * MOOD 영수증 자동검증 — 각 서비스(차량/매니저/공항) 예약 + 오버타임 정산 금액 계산을
 * 검증하고, 렌더된 영수증을 어드민 메일로 실제 발송한다(눈으로 확인용).
 *
 * 실행: node scripts/mood-verify-receipts.mjs   (로컬 .env 의 GMAIL_USER/APP_PASSWORD 사용)
 * 발송 대상: 2001leety@gmail.com (어드민 본인). 운영자 요청 검증용.
 *
 * sendEmail() 의 Firestore 쿼터체크 의존을 피하려 nodemailer 직접 사용.
 */
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { computeMoodTotalKRW } from '../api/_shared/mood-pricing.js';
import { buildMoodReceiptEmail, buildMoodSettlementReceiptEmail } from '../api/_shared/mood-receipt.js';

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* ignore */ }
}
loadEnv('.env.local');
loadEnv('.env');

const TO = '2001leety@gmail.com';
const DATE = '2026-06-20';
const START = '10:00';
const BALANCE = 1100000; // 가정 잔액(110만)

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

const results = [];
function check(label, got, expected) {
  const pass = got === expected;
  results.push({ label, got, expected, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}: got=${got} expected=${expected}`);
  return pass;
}

async function send(subject, html, text) {
  await transporter.sendMail({ from: `MOOD <${process.env.GMAIL_USER}>`, to: TO, subject, html, text });
  console.log(`  -> sent: ${subject}`);
}

async function main() {
  console.log('=== MOOD receipt auto-verify ===');

  // ── 예약 영수증 3종 ──
  const bookings = [
    { svc: 'vehicle', hours: 3, km: 0, toll: 0, expect: 99000, clientName: 'MOOD (vehicle test)' },
    { svc: 'manager', hours: 3, km: 0, toll: 0, expect: 132000, clientName: 'MOOD (manager test)' },
    { svc: 'airport', hours: 0, km: 0, toll: 0, expect: 110000, clientName: 'MOOD (airport test)' },
  ];
  for (const b of bookings) {
    const priced = computeMoodTotalKRW({ serviceType: b.svc, durationHours: b.hours, km: b.km, tollKRW: b.toll });
    check(`booking ${b.svc}`, priced.amountKRW, b.expect);
    const r = buildMoodReceiptEmail({
      bookingId: `TEST-${b.svc.toUpperCase()}`,
      clientName: b.clientName,
      date: DATE, startTime: START,
      durationHours: b.hours,
      serviceType: b.svc,
      ratePerHour: priced.ratePerHour,
      amountKRW: priced.amountKRW,
      newBalance: BALANCE - priced.amountKRW,
    });
    await send(`[예약] ${r.subject}`, r.html, r.text);
  }

  // ── 오버타임 정산 영수증 2종 ──
  const settles = [
    { svc: 'vehicle', booked: 3, actual: 4.5, km: 0, toll: 0, expectFinal: 148500, expectDiff: 49500, clientName: 'MOOD (vehicle OT)' },
    { svc: 'manager', booked: 3, actual: 5, km: 60, toll: 5000, expectFinal: 264600, expectDiff: 88000, clientName: 'MOOD (manager OT+route)' },
  ];
  for (const s of settles) {
    const booked = computeMoodTotalKRW({ serviceType: s.svc, durationHours: s.booked, km: s.km, tollKRW: s.toll });
    const final = computeMoodTotalKRW({ serviceType: s.svc, durationHours: s.actual, km: s.km, tollKRW: s.toll });
    const diff = final.amountKRW - booked.amountKRW;
    check(`settle ${s.svc} final`, final.amountKRW, s.expectFinal);
    check(`settle ${s.svc} diff(overtime)`, diff, s.expectDiff);
    const r = buildMoodSettlementReceiptEmail({
      clientName: s.clientName,
      bookingId: `TEST-${s.svc.toUpperCase()}-SETTLE`,
      date: DATE, startTime: START,
      serviceType: s.svc,
      actualHours: s.actual,
      finalAmountKRW: final.amountKRW,
      adjustmentKRW: diff,
      newBalance: BALANCE - final.amountKRW,
    });
    await send(`[정산] ${r.subject}`, r.html, r.text);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks PASS, ${failed.length} FAIL ===`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });
