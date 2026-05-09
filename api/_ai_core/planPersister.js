/**
 * T-money calculation + Firestore plan persistence.
 * Extracted verbatim from api/ai-planner-full.js L1074-1172.
 * Contains ?? at L1123/L1124 (body.adults ?? pax, body.children ?? 0).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { computeQualityScore } from './qualityMetrics.js';

/**
 * Calculate T-money recommended load from ODsay fares + arrival/departure costs.
 */
export function calculateTmoney(itinerary) {
  const totalTransitFare = (itinerary.days || [])
    .flatMap(d => d.stops || [])
    .reduce((sum, s) => {
      // ODsay 실제 요금이 있으면 우선 사용
      const odsayFare = s.travelFromPrev?.transitOptions?.publicTransit?.fare;
      const geminiFare = s.transit_from_prev?.est_fare_krw;
      return sum + (odsayFare || geminiFare || 0);
    }, 0);

  const arrivalTransitCost =
    itinerary.arrival_guide?.steps
      ?.find(s => s.transport_to_hotel)
      ?.transport_to_hotel?.arex_all_stop?.price_krw || 0;

  const departureTransitCost =
    itinerary.departure_guide?.to_airport?.cost_krw || 0;

  const rawTotal = totalTransitFare + arrivalTransitCost + departureTransitCost;
  itinerary.t_money_recommended_load = Math.ceil(rawTotal * 1.1 / 5000) * 5000;

  if (itinerary.arrival_guide?.steps) {
    const tmStep = itinerary.arrival_guide.steps.find(s => s.t_money_recommended_load_krw !== undefined);
    if (tmStep) tmStep.t_money_recommended_load_krw = itinerary.t_money_recommended_load;
  }
}

/**
 * Persist plan to Firestore + update user subcollection + API stats + loyalty.
 * Returns { planId, planUrl }.
 */
export async function persistPlan(adminDb, {
  body, itinerary, uid, vehicle, priceKRW, priceUSD,
  guestName, pax, styles, area, duration, startDate, email,
  specialRequest, arrival_airport, departure_airport,
  hotel_address, mobility, language,
  dietary, foodIndex,
}) {
  if (!adminDb) {
    throw new Error('Firebase not configured — cannot save plan');
  }

  const planId = randomUUID();
  const accessToken = uid ? null : randomUUID();

  // ── Tier 2-D: 9-metric quality score (admin-only, not user-visible) ────
  // P0-3 (2026-05-10, CLAUDE.md J): 빈 배열 fallback 제거.
  // 이전: `dietary || body?.dietPrefs || body?.dietary || []` — 누락 시 silent default
  //       → 사용자 식이제한이 잘못 전달돼도 plan 그대로 저장됐음 (J 룰 위반).
  // 변경: 명시적 array check + 누락이면 null 로 전달 (computeQualityScore 가
  //       buildDietaryChecker 에서 빈 배열로 graceful 처리).
  // Note: 식이제한 차단은 이미 geminiPipeline 단계에서 throw 처리 — 여기까지 도달했다는 건
  //       (a) 사용자 식이제한 없거나 (b) violation 통과한 plan. qualityScore 는
  //       admin 모니터링용이므로 dietary null 도 안전.
  const dietaryRaw = dietary ?? body?.dietPrefs;
  if (dietaryRaw !== undefined && dietaryRaw !== null && !Array.isArray(dietaryRaw)) {
    // 명시적 throw 대신 logging — qualityScore 는 non-blocking 이므로 plan 저장은 진행.
    // Telemetry only — 호출 체인 어딘가에서 잘못된 type 이 넘어왔다는 신호.
    console.error('[planPersister] dietary must be array, got:', typeof dietaryRaw, dietaryRaw);
  }
  const dietaryForScore = Array.isArray(dietaryRaw) ? dietaryRaw : null;

  let qualityScore = null;
  try {
    qualityScore = computeQualityScore(
      itinerary,
      dietaryForScore,
      area,
      foodIndex || [],
      { lang: language || 'ko' },
    );
    console.log(
      `[planner] qualityScore: ${qualityScore.score}/100 ` +
      `(diet=${qualityScore.metrics.dietary_violation.count}, ` +
      `unv=${qualityScore.metrics.unverified_restaurant.count}, ` +
      `lang=${qualityScore.metrics.language_mismatch.count}, ` +
      `route=${qualityScore.metrics.route_failure.count})`,
    );
  } catch (e) {
    // Non-blocking — never fail plan persist on metric computation error.
    console.warn('[planner] qualityScore compute failed:', e.message);
  }

  await adminDb.collection('plans').doc(planId).set({
    planId,
    status: 'ready',
    isPublic: false,
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    uid: uid || null,
    accessToken,
    guestEmail: email || null,
    input: {
      guestName, pax, styles, area, duration, startDate,
      adults: body.adults ?? pax,
      children: body.children ?? 0,
      vehicle, language, specialRequest,
      arrival_airport: arrival_airport || null,
      departure_airport: departure_airport || null,
      hotel_address: hotel_address || null,
      mobility: mobility || null,
      // 2026-05-08: zone-only 사용자도 PlanDetailPage 가 라벨링할 수 있도록 보존.
      // hotel_address 가 null/빈 값인데 zone 만 골랐을 때, LodgingBookend 가
      // "Stay" 가 아니라 zone 명("명동" 등) 을 보여주려면 이 필드가 필수.
      recommended_zone: body.recommended_zone || null,
      recommended_zone_address: body.recommended_zone_address || null,
    },
    itinerary,
    pricing: { vehicle, priceKRW, priceUSD },
    revisionCredits: 2,  // 무료 재생성 2회 (결제 시 포함)
    revisionCount: 0,    // 현재까지 재생성 횟수
    ...(qualityScore ? { qualityScore } : {}),
  });

  if (uid) {
    await adminDb
      .collection('users').doc(uid)
      .collection('plans').doc(planId)
      .set({
        planId,
        createdAt: new Date().toISOString(),
        status: 'ready',
        tourTitle: itinerary.tour_title || `${guestName}'s Korea Itinerary`,
        startDate,
        area,
        pax,
      });
  }

  console.log('[ai-planner-full] Firestore saved:', planId);

  // ── API 사용량 카운터 (non-blocking) ────────────────────────────────
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthKey = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}`;
  const dayKey = `${monthKey}-${String(kst.getDate()).padStart(2, '0')}`;
  const inc = FieldValue.increment(1);
  const incRevenue = FieldValue.increment(priceUSD);
  // 월별
  adminDb.collection('api_stats').doc(monthKey).set(
    { fullCount: inc, fullRevenue: incRevenue, lastUpdated: new Date().toISOString() },
    { merge: true }
  ).catch(e => console.warn('[full] counter error:', e.message));
  // 일별
  adminDb.collection('api_stats').doc(monthKey)
    .collection('daily').doc(dayKey).set(
      { fullCount: inc, fullRevenue: incRevenue, lastUpdated: new Date().toISOString() },
      { merge: true }
    ).catch(e => console.warn('[full] daily counter error:', e.message));

  // ── Loyalty 포인트 적립 (non-blocking — uid가 있는 로그인 사용자만) ────
  if (uid) {
    (async () => {
      try {
        const userRef = adminDb.collection('users').doc(uid);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const userData = userSnap.data() || {};
          const currentCoins = userData.tripCoins || 0;
          const newSpent = (userData.totalSpentUSD || 0) + priceUSD;
          const newCount = (userData.bookingCount || 0) + 1;

          // 등급 + 적립률 계산
          let earnRate = 0.01, tierName = 'Bronze';
          if (newSpent >= 1000 || newCount >= 15) { earnRate = 0.03; tierName = 'Platinum'; }
          else if (newSpent >= 500 || newCount >= 7) { earnRate = 0.02; tierName = 'Gold'; }
          else if (newSpent >= 200 || newCount >= 3) { earnRate = 0.015; tierName = 'Silver'; }

          const earnedCoins = Math.round(priceUSD * 100 * earnRate);
          const newBalance = currentCoins + earnedCoins;

          await userRef.update({
            tripCoins: newBalance,
            totalSpentUSD: newSpent,
            bookingCount: newCount,
            tier: tierName,
            tierUpdatedAt: new Date().toISOString(),
          });

          // 포인트 이력 기록
          await adminDb.collection('users').doc(uid).collection('pointHistory').doc().set({
            type: 'earn',
            amount: earnedCoins,
            balance: newBalance,
            description: `AI Plan: ${itinerary.tour_title || 'Korea Itinerary'} ($${priceUSD})`,
            bookingRef: planId,
            createdAt: Date.now(),
          });

          console.log(`[planner] Loyalty: +${earnedCoins} coins (${tierName} ${(earnRate * 100).toFixed(1)}%) → total ${newBalance}`);
        }
      } catch (e) { console.warn('[planner] Loyalty earn error:', e.message); }
    })();
  }

  const planUrl = accessToken
    ? `/my-plans/${planId}?token=${accessToken}`
    : `/my-plans/${planId}`;

  return { planId, planUrl, accessToken };
}
