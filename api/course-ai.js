/**
 * POST /api/course-ai — 코스 빌더 "AI 동선 최적화 + 주변 추천" (2026-07-05)
 *
 * 사용자가 직접 넣은 장소(좌표 포함)를 받아:
 *   ① 방문 순서를 이동 동선이 자연스럽게 재배치 (좌표 근접 + 맥락: 식당은 식사시간대,
 *      숙소는 마지막). ② 근처에 안 넣은 가볼 만한 곳 3~5개 추천(좌표 포함).
 *
 * Firebase 토큰의 AI 기능 자격을 확인하고, 입력 상한(장소 20개)과 좌표 유효성으로 남용 방어.
 * Gemini 실패 시 fail-soft: 순서는 최근접 이웃(nearest-neighbor), 추천은 서버 카탈로그의
 * 결정론적 후보로 폴백한다. 입력 오류만 { ok:false, code } 구조화 응답으로 돌려준다.
 *
 * 주변 추천 identity 는 서버 카탈로그가 소유한다. 관광지와 추천 등급 일반 식당 중에서만
 * Gemini 가 candidateId 를 고르며, 모델이 만든 이름·좌표·식이 주장은 응답에 쓰지 않는다.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { captureError } from './_shared/sentry.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUidFromAuthHeader, hasAiFeatureEntitlement } from './_shared/ai-entitlement.js';
import { buildCourseAiContract, CourseAiContractError, mergeAnchoredOrder } from './_shared/courseAiContract.js';
import {
  describeCatalogCandidate,
  getCourseCandidateCatalogStatus,
  getCourseCandidates,
  rehydrateCandidates,
} from './_shared/courseCandidateCatalog.js';
import { resolveGeminiModel } from './_ai_core/geminiModelResolver.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// IP rate-limit — 자격 확인 뒤에도 토큰 탈취·공유에 의한 Gemini 비용 폭주를 막는다.
// fail-OPEN(Firestore 장애 시 실사용자 안 막음). 시간당 40회.
const _rateDb = initAdminDb('course-ai');

// 웹앱의 Firebase Authorization 헤더를 허용하는 JSON CORS.
const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const MAX_STOPS = 20;

const SYSTEM_PROMPT = `You optimize a one-day Korea travel course.
Input: an ordered list of stops the user picked, each with id, name, category (food/sight/show/stay/etc), lat/lng,
and optionally time/timeConstraint('fixed'|'window')/windowEnd/stayMinutes for stops with a reservation or a
visit-time window. Also a CANDIDATES list of nearby real places, each with a candidateId.

TASKS:
1. Reorder stops into a natural travel route: minimize back-and-forth by geography (lat/lng),
   but respect context — meals(food) around lunch/dinner, a hotel(stay) goes last, a show at its likely time.
   Stops with timeConstraint are anchored by the server at their original position regardless of what you
   return here, so you do not need to keep them literally first/last — just produce a sensible full order.
2. From CANDIDATES only, pick 3-5 candidateId values that best fit the route's area and theme. Keep a useful
   mix of food and sights when both categories exist. Do NOT invent places or ids — choose only values that
   appear in CANDIDATES. Food candidates are general local picks only: never claim halal, vegan, allergy
   safety, certification, opening status, or live availability. If CANDIDATES is empty, return an empty array.

Return STRICT JSON only, no markdown:
{
  "optimizedOrder": ["<stop id in new order>", ...],   // MUST contain exactly the input ids, no more, no less
  "nearby": [ { "candidateId": "<id from CANDIDATES>" } ]
}`;

/** 최근접 이웃 순서 폴백 — Gemini 실패 시 좌표만으로 동선 근사. */
function nearestNeighborOrder(stops) {
  const withCoord = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (withCoord.length < 2) return stops.map((s) => s.id);
  const remaining = [...withCoord];
  const out = [remaining.shift()];
  while (remaining.length) {
    const last = out[out.length - 1];
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const dLat = remaining[i].lat - last.lat;
      const dLng = remaining[i].lng - last.lng;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    out.push(remaining.splice(bestIdx, 1)[0]);
  }
  const ordered = out.map((s) => s.id);
  // 좌표 없는 stop 은 원래 순서로 뒤에
  for (const s of stops) if (!ordered.includes(s.id)) ordered.push(s.id);
  return ordered;
}

function withSafeCandidateReason(candidate, lang, selectionSource = 'catalog') {
  return {
    ...candidate,
    reason: describeCatalogCandidate(candidate, lang),
    selectionSource,
  };
}

function fallbackNearby(candidates, lang) {
  return candidates.slice(0, 5).map((candidate) => withSafeCandidateReason(candidate, lang, 'catalog'));
}

function resolveModelNearby(parsedNearby, candidates, lang) {
  const offeredIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const selectedCandidateIds = [];
  const seen = new Set();
  for (const item of Array.isArray(parsedNearby) ? parsedNearby : []) {
    const candidateId = typeof item?.candidateId === 'string' ? item.candidateId.trim() : '';
    if (candidateId && offeredIds.has(candidateId) && !seen.has(candidateId)) {
      selectedCandidateIds.push(candidateId);
      seen.add(candidateId);
    }
  }

  const selected = rehydrateCandidates(selectedCandidateIds, lang).slice(0, 5);
  const aiSelectedIds = new Set(selected.map((candidate) => candidate.candidateId));
  const selectedIds = new Set(selected.map((candidate) => candidate.candidateId));
  const minimum = Math.min(3, candidates.length);
  for (const candidate of candidates) {
    if (selected.length >= minimum) break;
    if (selectedIds.has(candidate.candidateId)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.candidateId);
  }
  const source = aiSelectedIds.size === 0
    ? 'catalog'
    : (aiSelectedIds.size === selected.length ? 'ai' : 'mixed');
  return {
    nearby: selected.map((candidate) => withSafeCandidateReason(
      candidate,
      lang,
      aiSelectedIds.has(candidate.candidateId) ? 'ai' : 'catalog',
    )),
    source,
  };
}

export default async function handler(req, res) {
  
  if (req.method === 'OPTIONS') { res.writeHead(200, JSON_HEADERS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const rawStops = Array.isArray(body.stops) ? body.stops.slice(0, MAX_STOPS) : [];
  const stops = rawStops
    .map((s) => ({
      id: String(s?.id || '').slice(0, 40),
      title: String(s?.title || '').slice(0, 120),
      category: String(s?.category || 'etc').slice(0, 20),
      lat: Number(s?.lat),
      lng: Number(s?.lng),
      // planner-trust-course v1 확장 — 형식 검증은 buildCourseAiContract 가 fail-closed 로 처리.
      ...(typeof s?.time === 'string' ? { time: s.time } : {}),
      ...(s?.timeConstraint !== undefined ? { timeConstraint: s.timeConstraint } : {}),
      ...(typeof s?.windowEnd === 'string' ? { windowEnd: s.windowEnd } : {}),
      ...(s?.stayMinutes !== undefined ? { stayMinutes: s.stayMinutes } : {}),
      ...(typeof s?.placeKey === 'string' ? { placeKey: s.placeKey } : {}),
      ...(s?.placeSource !== undefined ? { placeSource: s.placeSource } : {}),
    }))
    .filter((s) => s.id && s.title);
  const lang = ['ko', 'en', 'ja', 'zh'].includes(body.lang) ? body.lang : 'en';

  if (stops.length < 2) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '장소가 2곳 이상이어야 합니다', code: 'TOO_FEW_STOPS' }));
  }

  // 🔒 fixed/window anchor 계약 — 형식 불량은 Gemini 호출/과금 전에 400 (fail-closed).
  let contract;
  try {
    contract = buildCourseAiContract(stops);
  } catch (err) {
    if (err instanceof CourseAiContractError) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '장소 시간/체류시간 형식이 잘못됨', code: err.code }));
    }
    throw err;
  }

  // 🔒 유료 AI 기능 게이트 (운영자 2026-07-07 요금제): AI 동선최적화+주변추천 = $9.90 구매자 전용.
  // 무료 쿠폰/비로그인은 잠김 → 프론트가 업셀 표시. Gemini(유료) 호출 전에 차단. 자격 없으면 403.
  const _uid = await verifyUidFromAuthHeader(req.headers?.authorization);
  const _entitled = await hasAiFeatureEntitlement(_rateDb, _uid);
  if (!_entitled) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, code: 'AI_FEATURE_LOCKED', error: 'AI optimize & nearby picks are unlocked with the $9.90 planner.' }));
  }

  const apiKey = process.env.GEMINI_API_KEY || '';

  // free(비anchor) id 만 최근접 이웃으로 재배치하고, anchor 는 원래 인덱스로 되돌린다 —
  // 폴백 경로도 예약/방문시간대 stop 을 절대 밀어내지 않는다.
  const freeStopsList = contract.stops.filter((s) => !contract.anchorIndexes.has(s.index));
  const fallbackFreeOrder = nearestNeighborOrder(freeStopsList);
  const fallbackOrder = mergeAnchoredOrder(contract, fallbackFreeOrder);

  // 주변 추천 후보 — 선택된 stop 들의 중심 좌표 근방, 서버 카탈로그(api/_attractions_index.json)
  // 에서만 뽑는다. 좌표 있는 stop 이 하나도 없으면 후보 없음(추천 스킵, 위치 추측 금지).
  const coordStops = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const catalogStatus = getCourseCandidateCatalogStatus();
  const candidates = coordStops.length && catalogStatus.healthy
    ? getCourseCandidates({
      origins: coordStops.map((s) => ({ lat: s.lat, lng: s.lng })),
      excludeStops: stops,
      lang,
      limit: 12,
    })
    : [];
  const deterministicNearby = fallbackNearby(candidates, lang);

  if (!apiKey) {
    // 키가 없어도 서버 카탈로그 추천은 결정론적으로 제공한다(외부 호출·비용 없음).
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      optimizedOrder: fallbackOrder,
      nearby: deterministicNearby,
      source: 'nn',
      nearbySelectionSource: 'catalog',
      nearbySource: catalogStatus.healthy ? 'cocotrip_catalog' : 'unavailable',
      catalogAvailable: catalogStatus.healthy,
    }));
  }

  // 유료 Gemini 호출 직전 IP rate-limit. 한도 초과 시 500/429 대신 nn 폴백으로 degrade —
  // 사용자는 무료 순서라도 받고(추천만 없음), 비용 소진만 차단. fail-OPEN(장애 시 통과).
  const _rate = await checkIpRateLimit({
    db: _rateDb,
    ip: getClientIp(req),
    collection: 'course_ai_rate_limits',
    maxRequests: 40,
    errorLabel: 'course AI requests',
  });
  if (!_rate.ok) {
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      optimizedOrder: fallbackOrder,
      nearby: deterministicNearby,
      source: 'nn',
      nearbySelectionSource: 'catalog',
      nearbySource: catalogStatus.healthy ? 'cocotrip_catalog' : 'unavailable',
      catalogAvailable: catalogStatus.healthy,
      rateLimited: true,
    }));
  }

  const resolvedModel = resolveGeminiModel('course');
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: resolvedModel });
    const userPayload = {
      language: lang,
      stops: stops.map((s) => ({
        id: s.id, name: s.title, category: s.category, lat: s.lat, lng: s.lng,
        ...(s.time ? { time: s.time } : {}),
        ...(s.timeConstraint ? { timeConstraint: s.timeConstraint } : {}),
        ...(s.windowEnd ? { windowEnd: s.windowEnd } : {}),
        ...(s.stayMinutes !== undefined ? { stayMinutes: s.stayMinutes } : {}),
      })),
      candidates: candidates.map((c) => ({
        candidateId: c.candidateId,
        name: c.name,
        theme: c.theme,
        category: c.category,
        ...(c.rating ? { rating: c.rating, reviewCount: c.reviewCount } : {}),
      })),
    };
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(userPayload) }] }],
      systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });
    // 사용량 실측 기록(비용 가시화 2026-07-09) — fire-and-forget, 실패해도 본 흐름 영향 0.
    import('./_shared/apiUsageRecorder.js').then((m) => m.recordUsageFromResponse('course-ai', resolvedModel, result.response)).catch(() => {});
    const raw = result.response.text() || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    // optimizedOrder 정합성 — 입력 id 집합과 동일해야(손실/추가 방지). 아니면 폴백.
    const inputIds = new Set(stops.map((s) => s.id));
    const order = Array.isArray(parsed?.optimizedOrder) ? parsed.optimizedOrder.map(String) : [];
    const orderSet = new Set(order);
    const valid = order.length === stops.length
      && order.every((id) => inputIds.has(id))
      && orderSet.size === stops.length;
    // 모델이 뭘 반환하든 anchor(fixed/window) 는 서버가 원래 인덱스로 강제한다 —
    // 모델 출력에서 free id 순서 신호만 뽑아 재삽입(mergeAnchoredOrder 가 집합 불일치 시 자체 폴백).
    const freeIdSet = new Set(contract.freeIds);
    const finalOrder = valid
      ? mergeAnchoredOrder(contract, order.filter((id) => freeIdSet.has(id)))
      : fallbackOrder;

    // nearby — 모델은 이번 요청에서 실제 제시한 candidateId 만 고를 수 있다. 이름·좌표·평점은
    // 서버 카탈로그로 복원하며, 모델 선택이 부족하면 결정론적 후보로 최소 3개까지 채운다.
    const nearbyResult = resolveModelNearby(parsed?.nearby, candidates, lang);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      optimizedOrder: finalOrder,
      nearby: nearbyResult.nearby,
      source: valid ? 'ai' : 'nn',
      nearbySelectionSource: nearbyResult.source,
      nearbySource: catalogStatus.healthy ? 'cocotrip_catalog' : 'unavailable',
      catalogAvailable: catalogStatus.healthy,
    }));
  } catch (e) {
    console.warn('[course-ai] Gemini 실패 → 폴백:', e.message);
    await captureError(e, { route: '/api/course-ai' });
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      optimizedOrder: fallbackOrder,
      nearby: deterministicNearby,
      source: 'nn',
      nearbySelectionSource: 'catalog',
      nearbySource: catalogStatus.healthy ? 'cocotrip_catalog' : 'unavailable',
      catalogAvailable: catalogStatus.healthy,
    }));
  }
}
