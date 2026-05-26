/**
 * Inngest dispatch helper — P220 (2026-05-26).
 *
 * handlerCore.js 가 post-Gemini pipeline 을 Inngest worker 로 분기할지 결정.
 *   - INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY 둘 다 설정 → Inngest dispatch
 *   - 누락 → false 반환 → handlerCore 가 기존 inline pipeline 진행 (silent fail 방지)
 *
 * SAFETY-CRITICAL (CLAUDE.md J): 본 모듈은 dietary validation 을 안 한다.
 *   - dispatch 시점 = runGeminiPipeline 이 이미 validateResponse 통과한 후.
 *   - dispatch payload 의 dietary 는 worker 의 persistPlan 의 doc 저장용만.
 *
 * 환각 차단:
 *   - inngest.send() 시그니처 = { name, data } (Inngest SDK 공식 — context7 docs).
 *   - INNGEST_EVENTS.PLAN_AI_COMPLETE = 'plan/ai.complete' (client.js export 상수).
 */
import { inngest, isInngestConfigured, INNGEST_EVENTS } from '../_inngest/client.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

/**
 * Inngest 활성화 여부 + 환경 의도 검사.
 *
 * P220: PLANNER_INNGEST_ENABLED env 토글 (default OFF) — 운영자가 Inngest ENV 만
 *   추가한 후에도 inline pipeline 으로 계속 운영 가능. 점진 ramp 전략:
 *     Phase A: ENV 만 추가 → Inngest dashboard 에 dry-run 도착 검증
 *     Phase B: PLANNER_INNGEST_ENABLED=true → 실제 dispatch 시작
 *
 * @returns {boolean} true = Inngest dispatch 진행, false = inline fallback.
 */
export function shouldDispatchToInngest() {
  if (!isInngestConfigured()) return false;
  // 운영자가 명시적으로 토글한 경우만 true. 기본은 OFF (점진 ramp).
  const enabled = String(process.env.PLANNER_INNGEST_ENABLED || '').toLowerCase();
  return enabled === 'true' || enabled === '1';
}

/**
 * `plan/ai.complete` event 발행.
 *
 * 호출 시점: handlerCore.js 가 Gemini 호출 + validateResponse + dbMatcher 완료 후.
 * 이 시점에 client 에는 streaming planId (P169) 를 이미 전송한 상태 가능. worker
 * 가 그 planId 를 재사용해 set merge 로 enrichment 완성 후 status='ready' 마킹.
 *
 * @param {{ planId?: string, itinerary: object, ctx: object }} payload
 * @returns {Promise<{ ids: string[] }>} Inngest SDK 반환값 (event ID 목록)
 *
 * 실패 처리:
 *   - send() 가 throw 하면 handlerCore 의 catch 블록이 inline fallback 으로 전환.
 *   - alert telegram — 외부 의존성 down 추적.
 */
export async function publishPlanAiComplete(payload) {
  try {
    const result = await inngest.send({
      name: INNGEST_EVENTS.PLAN_AI_COMPLETE,
      data: payload,
    });
    return result;
  } catch (err) {
    // throttledTelegramAlert 5min dedup — Inngest 외부 down 시 storm 방지.
    throttledTelegramAlert({
      key: 'inngest-send-fail',
      channel: 'admin',
      severity: 'high',
      message: `Inngest send() 실패 (P220) — inline fallback 진행. err=${err.message}`,
    }).catch(() => {});
    throw err;
  }
}

/**
 * P220: handlerCore.js 가 dispatch 시 payload 를 한 줄로 호출하도록 빌더 헬퍼.
 *
 * handlerCore 의 inline pipeline 과 동일한 변수 그룹을 받아 inngestDispatch payload
 * 로 정규화. handlerCore.js 의 P129 line cap (500L) 보호 위해 별도 모듈로 추출.
 *
 * @param {object} args  - handlerCore scope 의 변수 집합 (shaped + computed)
 * @returns {{ planId, itinerary, ctx }} publishPlanAiComplete() 입력
 */
export function buildPlanAiCompletePayload(args) {
  const {
    itinerary,
    streamingPlanId,
    apiKey, body,
    routeHotelAddress, hotelAddressFromBody,
    arrival_airport, departure_airport, pax,
    recommendedZone, recommendedZoneAddress,
    hotelByCity,
    area, dietPrefs, regions,
    vehicle, durationDays,
    uid, guestName, styles, duration, startDate, email,
    specialRequest, mobility, language,
    plannerMode, abReason, abBucket, blocksUsed,
    isAdminBypass, identifierForBucketing,
  } = args;

  return {
    planId: streamingPlanId,
    itinerary,
    ctx: {
      apiKey, body,
      hotel_address: routeHotelAddress,
      arrival_airport, departure_airport, pax,
      recommendedZone, recommendedZoneAddress,
      hotelAddressFromBody,
      hotelByCity,
      area, dietPrefs, regions,
      vehicle, durationDays,
      uid, guestName, styles, duration, startDate, email,
      specialRequest, mobility, language,
      plannerMode, abReason, abBucket, blocksUsed,
      streamingPlanId,
      isAdminBypass: !!isAdminBypass,
      identifierForBucketing,
    },
  };
}

/**
 * P220: handlerCore.js 가 호출하는 dispatch + fallback 통합 헬퍼.
 *
 * shouldDispatchToInngest() 가 false 면 즉시 false 반환 (inline fallback).
 * send() 가 throw 하면 alert 발사 + false 반환 — handlerCore 가 inline fallback 진행.
 *
 * silent fail 차단 규칙 (CLAUDE.md):
 *   - throw 안 함 (handlerCore 의 catch 블록 abort 회피).
 *   - 단순 boolean — handlerCore 가 분기.
 *
 * @param {object} args - buildPlanAiCompletePayload 와 동일 입력
 * @returns {Promise<boolean>} true = Inngest dispatch 성공 (post-response skip), false = inline fallback
 */
export async function tryDispatchOrFallback(args) {
  if (!shouldDispatchToInngest()) return false;
  try {
    const payload = buildPlanAiCompletePayload(args);
    await publishPlanAiComplete(payload);
    console.log('[planner P220] Inngest worker dispatched. Skipping inline post-response pipeline.');
    return true;
  } catch (dispatchErr) {
    console.error('[planner P220] Inngest dispatch failed — falling back to inline pipeline:', dispatchErr.message);
    return false;
  }
}

/**
 * P220: handlerCore.js 의 line cap (P129 500L) 보호 — streaming response 가 이미 전송된
 * 상태인지 + Inngest dispatch 가능 여부를 한 줄에 결정.
 *
 * handlerCore 가 그냥 `if (await maybeDispatchToInngest(args)) return;` 한 줄로 사용.
 *
 * @returns {Promise<boolean>} true = dispatched (handler 즉시 종료), false = inline 계속
 */
export async function maybeDispatchToInngest(args) {
  const { streamingResponseSent } = args;
  if (!streamingResponseSent) return false;
  return tryDispatchOrFallback(args);
}

/**
 * P220: handlerCore.js line cap (500L) 보호 — dispatch + early return 을 한 함수로.
 * handlerCore 의 scope 변수들을 그대로 받아 dispatch 시도 + dispatched 면 console.log 까지.
 *
 * @param {object} scope - handlerCore 의 const/let 변수 묶음
 * @returns {Promise<boolean>} true = handler 즉시 return, false = inline 계속
 */
export async function tryDispatchAndLog(scope, handlerStart) {
  const dispatched = await maybeDispatchToInngest(scope);
  if (dispatched) console.log('[planner] === TOTAL:', Date.now() - handlerStart, 'ms (P220 dispatched) ===');
  return dispatched;
}

/**
 * P220: handlerCore.js line cap 보호 (단일 호출). handlerCore 의 scope 변수들을
 * shorthand 로 받아 plannerMode/abReason/abBucket/blocksUsed 정규화 + dispatch.
 *
 * 운영자 의도: handlerCore 가 한 줄로 dispatch — 추가 줄 압박 없음. P220 cycle 외부에서
 * 들어오는 scope 객체는 호출자 책임 (handlerCore 가 단일 진입점).
 */
export async function dispatchOrInlineForHandlerCore({
  streamingResponseSent, itinerary, streamingPlanId, apiKey, body, routeHotelAddress, hotel_address,
  arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelByCity,
  area, dietPrefs, regions, vehicle, durationDays, uid, guestName, styles, duration, startDate, email,
  specialRequest, mobility, language, PLANNER_MODE, blockModeUsed, blocksUsed,
  abDecision, isAdminBypass, identifierForBucketing, handlerStart,
}) {
  return tryDispatchAndLog({
    streamingResponseSent, itinerary, streamingPlanId, apiKey, body, routeHotelAddress, hotelAddressFromBody: hotel_address,
    arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelByCity,
    area, dietPrefs, regions, vehicle, durationDays, uid, guestName, styles, duration, startDate, email,
    specialRequest, mobility, language,
    plannerMode: blockModeUsed ? 'block_mode' : PLANNER_MODE,
    abReason: abDecision.reason, abBucket: abDecision.bucket,
    blocksUsed: blockModeUsed ? blocksUsed : null,
    isAdminBypass, identifierForBucketing,
  }, handlerStart);
}
