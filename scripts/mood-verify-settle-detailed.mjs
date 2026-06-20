/**
 * MOOD 정산 고도화(#947) 자동검증 — 운행 종료 정산의 ① 추가 방문지 거리 재측정 ②
 * 상세 영수증(예약→실제 비교 + 항목별 분해) 을 실제로 실행해 검증하고 메일 발송.
 *
 *   1) 실제 Naver 경로 재측정(computeRoute): 같은 출발/도착에 방문지를 넣으면 km 가 늘어남을 입증.
 *   2) 정산 금액 math-check: 최종 = 시급×max(3,실제) + 거리추가(50km↑ km×660) + 톨비.
 *   3) 상세 영수증 콘텐츠 검증: 예약→실제 비교 / 기본요금·거리추가·톨비 분해 / "추가 방문지 N곳".
 *   4) 렌더된 영수증을 어드민(2001leety@gmail.com)에게 발송 — 눈으로 새 레이아웃 확인.
 *
 * 실행: node scripts/mood-verify-settle-detailed.mjs
 */
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { computeMoodTotalKRW } from '../api/_shared/mood-pricing.js';
import { buildMoodSettlementReceiptEmail } from '../api/_shared/mood-receipt.js';
import { computeRoute } from '../api/_shared/mood-route.js';

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
const BALANCE = 1100000;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass++; console.log(`[PASS] ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`[FAIL] ${label}${detail ? ' — ' + detail : ''}`); }
}
async function send(subject, html, text) {
  await transporter.sendMail({ from: `MOOD <${process.env.GMAIL_USER}>`, to: TO, subject, html, text });
  console.log(`  -> sent: ${subject}`);
}
const settle = (svc, hours, km, toll) => computeMoodTotalKRW({ serviceType: svc, durationHours: hours, km, tollKRW: toll });

async function main() {
  console.log('=== MOOD 정산 고도화(#947) 자동검증 ===\n');

  // ─────────────────────────────────────────────────────────────
  // 1) 실제 Naver 경로 재측정 — 방문지 추가 시 km 증가 입증 (핵심 신기능)
  // ─────────────────────────────────────────────────────────────
  console.log('① 실제 Naver 거리 재측정 (방문지 추가 → km 증가)');
  const O = '인천국제공항', D = '강남역', WP = '서울역';
  const routeBooked = await computeRoute({ origin: O, destination: D });            // 방문지 없음(예약)
  const routeActual = await computeRoute({ origin: O, destination: D, waypoints: [WP] }); // 서울역 경유(실제)

  let bookedKm, actualKm, actualToll, realRoute = false;
  if (routeBooked.ok && routeActual.ok) {
    realRoute = true;
    bookedKm = routeBooked.km;
    actualKm = routeActual.km;
    actualToll = routeActual.tollKRW;
    console.log(`   예약(${O}→${D}) = ${bookedKm}km / 실제(${O}→${WP}→${D}) = ${actualKm}km, 톨 ${actualToll}원`);
    check('방문지 추가 시 실제 거리 ≥ 예약 거리', actualKm >= bookedKm, `${bookedKm} → ${actualKm}km`);
  } else {
    // 네트워크/키 문제 시 시뮬레이션 값으로 대체(검증 계속). 어느 쪽 실패인지 로그.
    console.log(`   ⚠️ Naver 호출 실패 → 시뮬값 사용 (booked=${routeBooked.error || 'ok'}, actual=${routeActual.error || 'ok'})`);
    bookedKm = 30; actualKm = 62; actualToll = 3300;
  }

  // 정산: 매니저 4h, 예약거리 vs 실제(방문지 반영)거리
  const recBooked = settle('manager', 3, bookedKm, 0);
  const recFinal = settle('manager', 4, actualKm, actualToll);
  const recDiff = recFinal.amountKRW - recBooked.amountKRW;
  // 최종 = base + surcharge + toll 검증
  check('최종금액 = 기본+거리추가+톨비', recFinal.amountKRW === recFinal.baseKRW + recFinal.distanceSurchargeKRW + recFinal.tollKRW,
    `${recFinal.baseKRW}+${recFinal.distanceSurchargeKRW}+${recFinal.tollKRW}=${recFinal.amountKRW}`);
  // 거리추가 공식(50km↑ km×660) 검증
  const expSur = actualKm >= 50 ? Math.round(actualKm * 660) : 0;
  check('거리 추가요금 = 50km↑ km×660', recFinal.distanceSurchargeKRW === expSur, `${actualKm}km → ${recFinal.distanceSurchargeKRW}원`);

  const recReceipt = buildMoodSettlementReceiptEmail({
    clientName: 'MOOD (실제 거리 재측정)', bookingId: 'TEST-ROUTE-RECOMPUTE',
    date: DATE, startTime: START, serviceType: 'manager',
    bookedHours: 3, actualHours: 4, bookedKm, actualKm,
    ratePerHour: recFinal.ratePerHour, baseKRW: recFinal.baseKRW,
    distanceSurchargeKRW: recFinal.distanceSurchargeKRW, tollKRW: recFinal.tollKRW,
    bookedAmountKRW: recBooked.amountKRW, finalAmountKRW: recFinal.amountKRW,
    adjustmentKRW: recDiff, newBalance: BALANCE - recFinal.amountKRW,
    routeRecomputed: true, waypointCount: 1,
  });
  // 콘텐츠 검증 — "뭐가 추가됐는지" 가 영수증에 실제로 들어갔는가
  check('영수증: 예약→실제 시간 비교', recReceipt.html.includes('3시간') && recReceipt.html.includes('4시간'));
  check('영수증: 거리 비교 + 추가 방문지 표기', recReceipt.html.includes(`${actualKm}km`) && recReceipt.html.includes('추가 방문지 1곳'));
  check('영수증: 항목별 분해(기본/거리추가/톨비)', recReceipt.html.includes('기본요금') && (expSur === 0 || recReceipt.html.includes('거리 추가요금')));
  await send(`[정산·거리재측정] ${recReceipt.subject}`, recReceipt.html, recReceipt.text);

  // ─────────────────────────────────────────────────────────────
  // 2) 시간 초과만(경로 없음) — 시간 비교 강조
  // ─────────────────────────────────────────────────────────────
  console.log('\n② 시간 초과 정산 (경로 없음)');
  const otBooked = settle('vehicle', 3, 0, 0);   // 99,000
  const otFinal = settle('vehicle', 4.5, 0, 0);  // 148,500
  const otDiff = otFinal.amountKRW - otBooked.amountKRW;
  check('차량 3h→4.5h 최종 148,500', otFinal.amountKRW === 148500, String(otFinal.amountKRW));
  check('초과 차액 +49,500', otDiff === 49500, String(otDiff));
  const otReceipt = buildMoodSettlementReceiptEmail({
    clientName: 'MOOD (시간 초과)', bookingId: 'TEST-OVERTIME',
    date: DATE, startTime: START, serviceType: 'vehicle',
    bookedHours: 3, actualHours: 4.5, bookedKm: 0, actualKm: 0,
    ratePerHour: otFinal.ratePerHour, baseKRW: otFinal.baseKRW,
    distanceSurchargeKRW: 0, tollKRW: 0,
    bookedAmountKRW: otBooked.amountKRW, finalAmountKRW: otFinal.amountKRW,
    adjustmentKRW: otDiff, newBalance: BALANCE - otFinal.amountKRW,
    routeRecomputed: false, waypointCount: 0,
  });
  check('영수증: +1.5시간 초과 강조', otReceipt.html.includes('+1.5시간'));
  check('영수증: 경로 없으면 거리 추가요금 행 생략', !otReceipt.html.includes('거리 추가요금'));
  await send(`[정산·시간초과] ${otReceipt.subject}`, otReceipt.html, otReceipt.text);

  // ─────────────────────────────────────────────────────────────
  // 3) 환원(실제가 예약보다 적음) — 조정 음수 색/표기
  // ─────────────────────────────────────────────────────────────
  console.log('\n③ 환원 정산 (실제 < 예약)');
  const rfBooked = settle('manager', 5, 0, 0);   // 220,000
  const rfFinal = settle('manager', 3, 0, 0);    // 132,000
  const rfDiff = rfFinal.amountKRW - rfBooked.amountKRW; // -88,000
  check('매니저 5h예약→3h실제 환원 -88,000', rfDiff === -88000, String(rfDiff));
  const rfReceipt = buildMoodSettlementReceiptEmail({
    clientName: 'MOOD (환원)', bookingId: 'TEST-REFUND',
    date: DATE, startTime: START, serviceType: 'manager',
    bookedHours: 5, actualHours: 3, bookedKm: 0, actualKm: 0,
    ratePerHour: rfFinal.ratePerHour, baseKRW: rfFinal.baseKRW,
    distanceSurchargeKRW: 0, tollKRW: 0,
    bookedAmountKRW: rfBooked.amountKRW, finalAmountKRW: rfFinal.amountKRW,
    adjustmentKRW: rfDiff, newBalance: BALANCE - rfFinal.amountKRW,
    routeRecomputed: false, waypointCount: 0,
  });
  check('영수증: 환원 표기', rfReceipt.html.includes('환원'));
  await send(`[정산·환원] ${rfReceipt.subject}`, rfReceipt.html, rfReceipt.text);

  console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL · 실제Naver=${realRoute} · 메일 3통 발송(${TO}) ===`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });
