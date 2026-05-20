/**
 * T-money calculation + Firestore plan persistence.
 * Extracted verbatim from api/ai-planner-full.js L1074-1172.
 * Contains ?? at L1123/L1124 (body.adults ?? pax, body.children ?? 0).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { computeQualityScore } from './qualityMetrics.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

/**
 * P112 (2026-05-20): end_time backfill. plan 4792076e dump 결과 29/29 stops 의
 * end_time = undefined. UI 가 "15:45-undefined" 류 표시 위험 + PDF/email/voucher
 * 같은 downstream surface 가 end_time 가정. start_time + stay_min 으로 자동
 * 계산. Gemini/RouteAgent 가 이미 채웠으면 (시간 stitching 결과) override X.
 *
 * stay_min 0 이면 end_time = start_time (transit-only stop). stay_min 음수/
 * NaN 이면 graceful skip (corruption 차단).
 *
 * @param {string} startHHMM  "HH:mm" 형식
 * @param {number} stayMin    체류 분
 * @returns {string|null}     "HH:mm" 또는 input 비정상이면 null
 */
export function computeEndTime(startHHMM, stayMin) {
  if (typeof startHHMM !== 'string' || !/^\d{1,2}:\d{2}$/.test(startHHMM)) return null;
  // 명시적 null/undefined reject — Number(null) === 0 통과 차단.
  if (stayMin === null || stayMin === undefined) return null;
  const stay = Number(stayMin);
  if (!Number.isFinite(stay) || stay < 0) return null;
  const [h, m] = startHHMM.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  const totalMin = h * 60 + m + Math.floor(stay);
  // 24h+ wrap-around (예: Day 5 의 새벽 stop) — modulo 24h.
  const wrapped = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const eh = Math.floor(wrapped / 60);
  const em = wrapped % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

/**
 * P112: 모든 stop 에 end_time 채우기 (없는 경우만). Gemini 또는 RouteAgent 가
 * 이미 채웠으면 override X (timeline stitching 결과 존중).
 */
export function backfillStopEndTimes(itinerary) {
  let filled = 0;
  for (const day of (itinerary?.days || [])) {
    for (const stop of (day?.stops || [])) {
      if (stop.end_time && /^\d{1,2}:\d{2}$/.test(stop.end_time)) continue;
      const computed = computeEndTime(stop.start_time, stop.stay_min);
      if (computed) {
        stop.end_time = computed;
        filled += 1;
      }
    }
  }
  if (filled > 0) console.log(`[planPersister] end_time backfilled: ${filled} stops`);
  return filled;
}

/**
 * P119 (2026-05-20): day.lodging 필드 backfill. plan 4792076e dump 결과 모든
 * day 의 day.lodging = undefined. RouteAgent Phase 2.4 의 prevDayHotelCoord null
 * → KTX intercity bookend 누락 silent fail (P111 alert 대상). buildPrompt 보강
 * (day.lodging 명시 지시) 의 안전망 — Gemini 비결정성으로 day.lodging 누락 시
 * stops[] 의 첫 lodging category stop 으로 자동 채우기.
 *
 * 이미 day.lodging.name 있으면 override X.
 */
export function backfillDayLodging(itinerary) {
  let filled = 0;
  for (const day of (itinerary?.days || [])) {
    if (day?.lodging && (day.lodging.name || day.lodging.address)) continue;
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    const firstLodging = stops.find((s) => s?.category === 'lodging');
    if (firstLodging) {
      day.lodging = {
        name: String(firstLodging.name || firstLodging.display_name || '').trim() || null,
        address: String(firstLodging.address || '').trim() || null,
      };
      if (day.lodging.name || day.lodging.address) {
        filled += 1;
      }
    }
  }
  if (filled > 0) console.log(`[planPersister] day.lodging backfilled: ${filled} days`);
  return filled;
}

/**
 * P120 (2026-05-20): 새벽 시간대 stops detect. plan 4792076e 의 Day3 00:31,
 * Day4 01:24, 03:26 같은 start_time = 사용자 실현 불가능 (새벽 관광 X). 회귀의
 * root cause 는 RouteAgent Phase 2.5/2.6 시간 stitching 의 transit time 누적
 * 검증 부재 — 24h modulo wrap-around 가 새벽 시각 silent 생성.
 *
 * 1차 fix (본 함수): 합리 시간대 [05:00, 23:59] 밖의 stop 발견 시 admin telegram
 * alert (P83 dedup 패턴). plan 저장은 non-blocking (사용자 영향 없음). root cause
 * fix 는 별도 후속 (RouteAgent stitching 검증 강화).
 *
 * @param {object} itinerary
 * @returns {Array<{day:number, stop:string, start_time:string, reason:string}>}
 */
export function detectUnreasonableStopTimes(itinerary) {
  const alerts = [];
  for (const day of (itinerary?.days || [])) {
    const dayNum = day?.day || day?.day_index || 0;
    for (const stop of (day?.stops || [])) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(stop?.start_time || ''));
      if (!m) continue;
      const hour = parseInt(m[1], 10);
      const minute = parseInt(m[2], 10);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
      // 합리 범위: 05:00 ~ 23:59 (24h 자체는 invalid time 이므로 별도 처리 X).
      // 새벽 0~4 시 = pre-dawn (관광/식사 불가).
      if (hour < 5) {
        alerts.push({
          day: dayNum,
          stop: String(stop?.name || stop?.display_name || '').slice(0, 80),
          start_time: stop.start_time,
          reason: 'pre-dawn (< 05:00) — 사용자 실현 불가',
        });
      }
    }
  }
  return alerts;
}

/**
 * P120: detectUnreasonableStopTimes + admin telegram alert (P83 dedup) wrapper.
 * ai-planner-full.js 가 1줄 호출만 하도록 (P1 lock — per-file line limit 보호).
 */
export function runUnreasonableStopTimesCheck(itinerary, body) {
  try {
    const stops = detectUnreasonableStopTimes(itinerary);
    if (stops.length === 0) return 0;
    const regionsKey = Array.isArray(body?.regions) && body.regions.length > 0
      ? body.regions.slice(0, 2).join('+')
      : 'unknown';
    const sample = stops.slice(0, 5)
      .map((u) => `Day${u.day} ${u.start_time} "${u.stop}"`).join(' / ');
    throttledTelegramAlert({
      key: `unreasonable-stop-times:${regionsKey}`,
      channel: 'admin',
      severity: 'low',
      message: [
        `⚠️ <b>새벽 시간 stops 감지 — RouteAgent stitching wrap (P120)</b>`,
        ``,
        `<b>건수:</b> ${stops.length}`,
        `<b>샘플:</b> ${sample}`,
        ``,
        `→ root cause 후속: RouteAgent Phase 2.5/2.6 transit time 누적 검증`,
      ].join('\n'),
      context: { count: stops.length, stops: stops.slice(0, 10), regions: body?.regions || null },
    });
    console.log(`[planner] P120 unreasonable stops detected: ${stops.length}`);
    return stops.length;
  } catch (e) {
    console.warn('[planner] P120 check failed:', e?.message);
    return 0;
  }
}

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
  // Phase 4 A/B test (2026-05-13): plannerMode / abReason / abBucket persisted
  // alongside qualityScore so admin can compare legacy vs 3-pass score
  // distribution. Absent on legacy revision paths that don't pass the field
  // (back-compat — silent skip when undefined).
  plannerMode, abReason, abBucket,
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

  // 2026-05-10 (P1): WizardForm 의 추가 필드들도 Firestore input 에 보존.
  // PlanDetailPage 의 region 인식 (PR #323 PreTripSlide regions[0] 우선) +
  // AirportToLodgingGuide luggage 분기 (heavyLoad 자동 추천) + revision prefill
  // (PR #323) 모두 input.* 필드 의존. 누락 시 silent UX 저하 (audit P1).
  const docToSave = {
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
      // 2026-05-10 (P0-1): regions array 보존 — PlanDetailPage 다도시 인식.
      regions: Array.isArray(body.regions) && body.regions.length > 0
        ? body.regions
        : (area ? [area] : []),
      adults: body.adults ?? pax,
      children: body.children ?? 0,
      vehicle, language, specialRequest,
      arrival_airport: arrival_airport || null,
      departure_airport: departure_airport || null,
      hotel_address: hotel_address || null,
      mobility: mobility || null,
      // 2026-05-10 (P1): 도착/출발 시각 — PlanDetailPage 시각 분기 + revision prefill.
      arrival_time: body.arrivalTime || null,
      departure_time: body.departureTime || null,
      // 2026-05-10 (P1): luggage — AirportToLodgingGuide heavyLoad 자동 추천 핵심.
      luggage: (body.luggage && typeof body.luggage === 'object') ? body.luggage : null,
      // 2026-05-10 (P1): 매운맛 / bucket 음식 — 식당 추천 정확도.
      spice_level: body.spiceLevel || null,
      bucket_dishes: Array.isArray(body.bucketDishes) ? body.bucketDishes : null,
      tour_pace: body.tourPace || null,
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
    // Phase 4 A/B test (2026-05-13): per-plan mode trace. Used by admin
    // quality-summary endpoint (Tier 2-D) to bucket scores by pipeline.
    // Absent fields skip safely (legacy plans pre-PR have no plannerMode).
    ...(plannerMode ? { plannerMode } : {}),
    ...(abReason ? { abReason } : {}),
    ...(typeof abBucket === 'number' ? { abBucket } : {}),
  };

  // 2026-05-10 (P0-5 launch blocker): Firestore 1MB doc size 가드.
  // 14+ 일 다도시 plan 시 itinerary 가 1MB 초과 → set() throw → 사용자 결제 후
  // 데이터 loss. pre-check 후 day 마지막부터 truncate (Sentry alert + 운영자 수동
  // 복구 가능). 사용자에게는 plan 일부 손실 — 보수적으로 truncate 표시 stop 추가.
  //
  // PR #460 (Audit X-H1 — 2026-05-16): truncation 이 silent 였음.
  // - console.error 만 → 운영자가 Vercel 로그 보지 않으면 모름
  // - `_truncated_days` 가 itinerary 안에 묻혀있어 UI 가 surface 하기 어려움
  // 변경:
  // 1. root-level `__truncated: true` + `__truncated_days_count` 추가 →
  //    PlanDetailPage 가 즉시 banner 표시 가능 (itinerary 깊이 탐색 불필요)
  // 2. throttledTelegramAlert (admin channel) — region+duration dedup
  //    (한 사용자가 다도시 14일 반복 시도해도 5분당 1회)
  // 3. 기존 `itinerary._truncated_days/_truncation_note` 유지 (legacy 호환)
  const SIZE_LIMIT_BYTES = 900_000; // Firestore 한계 1,048,576 의 안전 margin
  const initialSize = Buffer.byteLength(JSON.stringify(docToSave), 'utf8');
  let docSize = initialSize;
  if (docSize > SIZE_LIMIT_BYTES) {
    console.error(`[planPersister] Document size ${docSize}B exceeds ${SIZE_LIMIT_BYTES}B — truncating days`);
    let truncatedCount = 0;
    const originalDayCount = docToSave.itinerary?.days?.length || 0;
    while (docSize > SIZE_LIMIT_BYTES && docToSave.itinerary?.days?.length > 1) {
      docToSave.itinerary.days.pop();
      truncatedCount += 1;
      docSize = Buffer.byteLength(JSON.stringify(docToSave), 'utf8');
    }
    // Legacy fields (itinerary-deep) — UI 의 기존 탐색 경로 지원.
    docToSave.itinerary._truncated_days = truncatedCount;
    docToSave.itinerary._truncation_note = 'Plan size exceeded Firestore limit — last days removed for safety. Contact support for full plan.';
    // Root-level flags (PR #460) — PlanDetailPage / banner UI 가 즉시 감지.
    docToSave.__truncated = true;
    docToSave.__truncated_days_count = truncatedCount;
    docToSave.__truncated_original_days = originalDayCount;
    docToSave.__truncated_initial_size_bytes = initialSize;
    console.warn(`[planPersister] Truncated ${truncatedCount} days. Final size: ${docSize}B`);

    // PR #460 (X-H1): operator alert — 사용자는 plan 받지만 일부 day 누락.
    // dedup key: region+duration → 같은 다도시 14일 사용자 반복 시도해도 5분 1회.
    // fire-and-forget — Telegram fail 이 plan 저장 latency 영향 X.
    const regionKey = Array.isArray(body?.regions) && body.regions.length > 0
      ? body.regions.slice(0, 3).join('+')
      : (area || 'unknown');
    const durationKey = String(duration ?? originalDayCount ?? 'unknown');
    throttledTelegramAlert({
      key: `plan-persister-truncate:${regionKey}:${durationKey}`,
      channel: 'admin',
      severity: 'high',
      message: [
        `⚠️ <b>Plan truncated — Firestore 1MB 초과로 마지막 ${truncatedCount}일 제거</b>`,
        ``,
        `<b>planId:</b> <code>${planId}</code>`,
        `<b>regions:</b> ${regionKey}`,
        `<b>duration:</b> ${durationKey} days`,
        `<b>원본 days:</b> ${originalDayCount} → <b>저장:</b> ${originalDayCount - truncatedCount}`,
        `<b>초기 크기:</b> ${initialSize.toLocaleString()}B / 한계 ${SIZE_LIMIT_BYTES.toLocaleString()}B`,
        `<b>최종 크기:</b> ${docSize.toLocaleString()}B`,
        ``,
        `→ user 가 plan 받았지만 day ${originalDayCount - truncatedCount + 1}~${originalDayCount} 누락.`,
        `→ uid: <code>${uid || 'guest'}</code> · email: <code>${(email || 'none').slice(0, 80)}</code>`,
      ].join('\n'),
      context: {
        planId,
        region: regionKey,
        durationDays: Number(durationKey) || originalDayCount,
        uid: uid || 'guest',
        email: email || null,
      },
    }).catch(() => {});
  }

  try {
    await adminDb.collection('plans').doc(planId).set(docToSave);
  } catch (saveErr) {
    // Firestore set() 실패 시 마지막 안전망 — 사용자 결제 후 plan loss 회피.
    // throw 시 ai-planner-full handler 가 catch 해서 사용자에게 명확한 에러 + 환불 안내.
    console.error('[planPersister] Firestore set failed:', saveErr.message);
    throw new Error(`Plan save failed (${saveErr.code || saveErr.name}). Contact WhatsApp for refund.`);
  }

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
