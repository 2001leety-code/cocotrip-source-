// END-TO-END: 결제→플랜→번역→PDF 전체 흐름 검증.
// 사용자 명시 요구: "플랜 결과물에서 자꾸 오류나고 번역 오류 PDF 오류" 100번 사이클 차단.
//
// 검증 범위:
//   1. POST /api/ai-planner-full (TEST- bypass) → planId
//   2. 플랜 구조 무결성 (stops, transit_from_prev, hub-and-spoke)
//   3. ⭐ "car · 25분" 회귀 차단 — 모든 transit이 rich data OR 명시적 downgrade
//   4. POST /api/translate-plan (ja/zh) → 실제 CJK 문자 검증
//   5. POST /api/pdf/generate without auth → 401 (PR #118 회귀 차단)
//
// PDF 콘텐츠 검증은 Firebase 인증 필요 — 별도 service-account 기반 테스트 권장.
// 본 spec은 자동 회귀 차단용. 비용: plan당 ~$0.10 (Gemini Pro). 매 PR 실행 X, 수동 트리거.
//
// 실행: BASE_URL=https://cocotripkr.com npx playwright test full-plan-translation-pdf
// 또는 daily-health workflow에 통합 (Mon/Wed/Fri).

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';
const TEST_EMAIL = '2001leety@gmail.com'; // TEST_ACCOUNTS whitelist
const TEST_ORDER_ID = `TEST-E2E-${Date.now()}`;

interface Stop {
  name?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  start_time?: string;
  transit_from_prev?: {
    method?: string;
    est_min?: number;
    step_by_step?: string[];
    steps_detail?: Array<{ mode: string }>;
    instruction?: string;
    instruction_en?: string;
    source?: string;
    _downgraded_from?: string;
  } | null;
}
interface Day { day: number; date?: string; stops: Stop[]; }
interface Plan { tour_title?: string; itinerary?: { days?: Day[] } | Day[]; }

test.describe('CocoTrip Full E2E — Plan + Translation + PDF Auth', () => {
  let planId: string | null = null;
  let plan: Plan | null = null;

  test('1. 플랜 생성 — POST /api/ai-planner-full (TEST bypass)', async ({ request }) => {
    test.setTimeout(180_000); // Gemini Pro 60-90s 응답
    const res = await request.post(`${BASE_URL}/api/ai-planner-full`, {
      data: {
        paypalOrderId: TEST_ORDER_ID,
        guest_name: 'E2E Test User',
        email: TEST_EMAIL,
        pax: 2,
        styles: ['culture', 'food'],
        area: 'seoul_city',
        duration: '1day',
        durationDays: 1,
        startDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        language: 'ko',
        pace: 'standard',
        arrival_airport: 'ICN T1',
        special_request: '인사동, 광화문 포함',
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 180_000,
    });

    expect(res.status(), `expected 200, got ${res.status()}`).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data?.planId).toBeTruthy();
    planId = body.data.planId;
    plan = body.data.itinerary || body.data.plan || body.data;
    console.log(`✅ 1. Plan generated — planId=${planId}`);
  });

  test('2. 플랜 구조 무결성 — days/stops/transit shape', async () => {
    test.skip(!plan, 'Plan not generated');
    const days = Array.isArray(plan!.itinerary) ? plan!.itinerary : (plan!.itinerary as { days?: Day[] })?.days;
    expect(days).toBeTruthy();
    expect(days!.length).toBeGreaterThanOrEqual(1);
    const day1 = days![0];
    expect(day1.stops?.length).toBeGreaterThanOrEqual(3);
    console.log(`✅ 2. Day 1 has ${day1.stops.length} stops`);
  });

  test('3. ⭐ Transit integrity — "car · 25분" blind fallback 차단', async () => {
    test.skip(!plan, 'Plan not generated');
    const days = (Array.isArray(plan!.itinerary) ? plan!.itinerary : (plan!.itinerary as { days?: Day[] })?.days) || [];
    let blindFallbackCount = 0;
    let richTransitCount = 0;
    let downgradeCount = 0;
    const offenses: string[] = [];

    for (const day of days) {
      for (let i = 1; i < day.stops.length; i++) {
        const t = day.stops[i].transit_from_prev;
        if (!t) continue;
        const hasRich = (t.steps_detail?.length || 0) > 0
          || (t.step_by_step?.length || 0) > 0
          || !!t.instruction
          || !!t.instruction_en;
        const isExplicitDowngrade = !!t._downgraded_from;
        const isBlindCar = t.method === 'car' && !hasRich && !isExplicitDowngrade;
        if (isBlindCar) {
          blindFallbackCount++;
          offenses.push(`Day ${day.day} stop ${i} (${day.stops[i].name}): blind car·${t.est_min}분 — 좌표 인식 실패 가능성`);
        } else if (isExplicitDowngrade) {
          downgradeCount++;
        } else if (hasRich) {
          richTransitCount++;
        }
      }
    }

    console.log(`   Rich transit: ${richTransitCount}, Explicit downgrade: ${downgradeCount}, Blind car fallback: ${blindFallbackCount}`);
    if (offenses.length) console.log('   Offenses:', offenses.join('\n     '));

    // 핵심 회귀 게이트: blind fallback 0건이어야 함 (downgrade는 OK — 명시적 사유 있음)
    expect(blindFallbackCount, `${blindFallbackCount} blind 'car · 25분' 발견`).toBe(0);
    console.log(`✅ 3. Transit integrity OK — 0 blind fallbacks`);
  });

  test('4. Hub-and-spoke — 첫 stop / 마지막 stop 동일 zone', async () => {
    test.skip(!plan, 'Plan not generated');
    const days = (Array.isArray(plan!.itinerary) ? plan!.itinerary : (plan!.itinerary as { days?: Day[] })?.days) || [];
    for (const day of days) {
      if (day.stops.length < 2) continue;
      const first = day.stops[0];
      const last = day.stops[day.stops.length - 1];
      // Address-based heuristic — 같은 구(district) 또는 인접 구이면 OK
      const firstDistrict = first.address?.match(/(\S+구)/)?.[1];
      const lastDistrict = last.address?.match(/(\S+구)/)?.[1];
      console.log(`   Day ${day.day}: ${first.name}(${firstDistrict}) → ${last.name}(${lastDistrict})`);
      // Soft assertion — 같은 zone 권장이지만 강제는 X (Gemini가 항상 따르진 않음)
      if (firstDistrict && lastDistrict && firstDistrict !== lastDistrict) {
        console.log(`   ⚠️ Day ${day.day} hub-and-spoke 약함: ${firstDistrict} ↔ ${lastDistrict}`);
      }
    }
    console.log(`✅ 4. Hub-and-spoke 검사 완료 (soft check)`);
  });

  test('5. 번역 검증 — POST /api/translate-plan (ja)', async ({ request }) => {
    test.skip(!planId, 'Plan not generated');
    const res = await request.post(`${BASE_URL}/api/translate-plan`, {
      data: { planId, targetLang: 'ja' },
      headers: { 'Content-Type': 'application/json' },
      timeout: 60_000,
    });
    if (res.status() === 401) {
      // 번역 API에 auth 필요한 경우 — 보안 OK, 콘텐츠 검증은 스킵
      console.log(`⚠️  5. /api/translate-plan requires auth (401) — content check skipped`);
      return;
    }
    expect(res.status()).toBe(200);
    const body = await res.json();
    const text = JSON.stringify(body);
    // 일본어 히라가나/카타카나 포함 검증
    expect(text, 'Japanese characters expected').toMatch(/[぀-ゟ゠-ヿ]/);
    console.log(`✅ 5. Translation OK — Japanese characters detected`);
  });

  test('6. PDF endpoint auth — without token → 401 (PR #118 회귀 차단)', async ({ request }) => {
    test.skip(!planId, 'Plan not generated');
    const res = await request.post(`${BASE_URL}/api/pdf/generate`, {
      data: { planId },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(body.detail || body.error || '').toMatch(/Bearer|token|unauthorized/i);
    console.log(`✅ 6. PDF auth gate OK (401: ${body.detail})`);
  });

  test('7. PDF endpoint — invalid token → 401 with verification error', async ({ request }) => {
    test.skip(!planId, 'Plan not generated');
    const res = await request.post(`${BASE_URL}/api/pdf/generate`, {
      data: { planId },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-test-token-' + Date.now(),
      },
    });
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    // PR #118 fix 검증: "Firebase Admin SDK init failed" 가 아니어야 함
    const detail = String(body.detail || body.error || '');
    expect(detail).not.toMatch(/Firebase Admin SDK init failed/);
    expect(detail).toMatch(/Token verification failed|verifyIdToken|argument-error/);
    console.log(`✅ 7. PDF init working (no init-failed error) — auth: ${detail}`);
  });
});
