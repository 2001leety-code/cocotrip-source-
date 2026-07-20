// E2E 픽스처 생성 — 실 플랜 1건을 만들고 planId 를 temp_plan_id.txt 에 남긴다.
//
// 2026-07-20 수리. 이 스크립트는 그 전까지 4가지 이유로 동작하지 않았다:
//   1. Authorization 헤더 없음 → PR #247 (audit P0-#2) 이후 401 AUTH_REQUIRED 로 즉사.
//   2. package.json 이 type=module 인데 require('fs') 사용 → ESM 에서 ReferenceError.
//   3. startDate 가 '2026-05-15' 하드코딩 → 서버 날짜검증 PLANNER_DATE_TOO_SOON 으로 400.
//   4. 응답을 data.planId 로 읽음 → 실제 shape 은 { data: { planId } }.
// 아무도 안 돌려봐서 넷 다 방치돼 있었다.
//
// 사용법: 로컬 .env 에 FIREBASE_WEB_API_KEY + HEALTH_CHECK_PASSWORD 필요.
//   node scripts/create-temp-plan.js
import { writeFileSync } from 'fs';
import {
  loadDotEnv,
  getIdToken,
  futureDate,
  adminBypassOrderId,
  postPlanner,
} from './_lib/planner-smoke.mjs';

const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';

loadDotEnv();

const body = {
  email: process.env.HEALTH_CHECK_EMAIL || '2001leety@gmail.com',
  adults: 2,
  arrival_airport: 'ICN_T1',
  departure_airport: 'ICN_T1',
  styles: ['food'],
  allergies: [],
  paypalOrderId: adminBypassOrderId('TEMP'),
  guestName: 'E2E Test',
  pax: 2,
  area: 'Seoul',
  duration: '1day',
  durationDays: 1,
  startDate: futureDate(14),
  language: 'en',
};

console.log(`→ POST ${BASE_URL}/api/ai-planner-full`);
console.log('  orderId:', body.paypalOrderId, '| startDate:', body.startDate);

const idToken = await getIdToken();
const json = await postPlanner(BASE_URL, body, idToken);

const planId = json?.data?.planId;
if (!planId) {
  console.error('❌ 응답에 planId 가 없다:', JSON.stringify(json).slice(0, 400));
  process.exit(1);
}

writeFileSync('temp_plan_id.txt', planId);
console.log('✅ Created planId:', planId, '→ temp_plan_id.txt');
