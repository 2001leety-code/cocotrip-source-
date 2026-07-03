/**
 * POST /api/mood-parse-schedule — MOOD 자유 텍스트 일정 → 구조화 장소 리스트 (운영자/광고사 전용)
 *
 * 용도: 운영자가 MOOD 카톡 일정(픽업/드롭/장소/시간/사람 뒤섞인 자유텍스트)을 붙여넣으면
 *   Gemini 가 장소를 순서대로 추출 → 주소록(mood_places) 매칭 → 네이버 좌표화 →
 *   서비스(vehicle/manager/airport) 추천 까지 한 번에 돌려준다.
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - verifyUserToken + emailVerified + isAllowedEmail (allowlist.emails) 게이트.
 *   - 쓰기가 아니라 조회성이지만 MOOD 내부 데이터(주소록/이사님 등)라 allowlist 로 게이트한다.
 *
 * Body: { text: string }  — MOOD 가 준 자유 텍스트 일정.
 *
 * 처리 파이프라인:
 *   ① Gemini(gemini-2.5-flash, JSON 강제) 로 text → stops[] 추출.
 *      각 stop: { order, rawText, personOrPlace, addressHint, action, timeHint }.
 *      □■ 같은 마커·이모지는 무시 (실제 이동 지점만).
 *   ② 각 stop 을 주소록(mood_places: {name, address, lat, lng, isDirector}) 이름 매칭.
 *      personOrPlace 가 주소록 name 과 일치/포함 → 저장된 주소·좌표 재사용(matchedFromPlacebook).
 *      매칭된 place 가 isDirector=true 면 이사님(vehicle 서비스) 신호.
 *   ③ 주소록 미매칭 stop 은 네이버 geocode (addressHint or personOrPlace 로).
 *      실패하면 geocodeOk=false 로 표시 → 프론트가 그 stop 을 수동 확인/차단.
 *   ④ 서비스 추천:
 *      - 주소록에서 isDirector=true 인 항목이 stops 에 포함 → serviceGuess='vehicle'
 *      - 공항 키워드(공항/airport/ICN/GMP 등) 또는 공항 주소 → serviceGuess='airport'
 *      - 둘 다 아니면 → 'manager'
 *      (airport 는 vehicle 보다 우선 — 공항 이동이 명확한 서비스 구분이므로.)
 *
 * 반환:
 *   { ok: true,
 *     stops: [{ order, label, address, lat, lng, action, matchedFromPlacebook, geocodeOk }],
 *     serviceGuess, hasDirector, hasAirport, needsConfirm: true }
 *   - needsConfirm 은 항상 true (프론트가 서비스 추천을 더블체크).
 *   - geocode 실패 stop 이 있어도 ok:true (그 stop 만 geocodeOk:false) → 프론트가 개별 차단.
 *
 * 실패는 fail-soft — 500 이 아니라 구조화된 { ok:false, error, code } 로 반환.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail } from './_shared/mood-allowlist.js';
import { geocode } from './_shared/mood-route.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';
const MAX_TEXT_LEN = 8000; // 붙여넣기 일정 상한 (프롬프트 폭주 방지)
const MAX_STOPS = 40; // Gemini 가 과다 추출해도 상한 (지도/요금 계산 폭주 방지)

// 공항 판정 키워드 (한/영/약어). 소문자 비교.
const AIRPORT_KEYWORDS = ['공항', 'airport', 'icn', 'gmp', '인천공항', '김포공항', '제주공항', 't1', 't2', 'terminal'];

const ALLOWED_ACTIONS = new Set(['pickup', 'dropoff', 'via', 'arrive']);

/**
 * Gemini system prompt — 자유 텍스트 → stops JSON.
 * 마커(□■●▶ 등)·이모지는 무시하고 실제 이동 지점(사람/장소)만 추출.
 */
const SYSTEM_PROMPT = `You extract an ordered list of travel stops from a messy Korean chauffeur/manager schedule.
The text is pasted from KakaoTalk and mixes pickup/dropoff, place names, person names, times, and decorative markers.

RULES:
- Read top to bottom = chronological order. First mentioned = order 1.
- IGNORE decorative markers/emojis (□ ■ ● ○ ▶ ▷ ★ ☆ - • etc.) — they are NOT places.
- A "stop" is a physical point the vehicle/manager goes to: a place (장소) OR a person to pick up/drop off.
- personOrPlace: the person name OR place name at this stop. Keep it as written (Korean if Korean).
- addressHint: a fuller address if present in the text (e.g. "인천 강화군 ...", "서울 강남구 테헤란로 ..."). Empty string if none.
- action: one of "pickup" (손님/사람 태움), "dropoff" (내려줌), "arrive" (목적지 도착), "via" (경유/들름). If unclear, use "via".
- timeHint: the time string if present (e.g. "09:30", "오전 10시", "14:00"). Empty string if none.
- Do NOT invent coordinates or addresses. Only extract what is written.
- If a line clearly refers to an airport (공항/ICN/GMP/인천공항/김포공항), keep that word in personOrPlace or addressHint.

OUTPUT — STRICT JSON ONLY, no markdown, no explanation:
{
  "stops": [
    { "order": 1, "rawText": "original line/snippet", "personOrPlace": "홍길동 or 강남역", "addressHint": "", "action": "pickup", "timeHint": "09:30" }
  ]
}

EXAMPLE INPUT:
"■ 9:30 이사님 픽업 (인천 강화군 불은면)
 ■ 11:00 강남 코엑스 도착
 ■ 오후 3시 인천공항 T2 드랍"

EXAMPLE OUTPUT:
{"stops":[
 {"order":1,"rawText":"9:30 이사님 픽업 (인천 강화군 불은면)","personOrPlace":"이사님","addressHint":"인천 강화군 불은면","action":"pickup","timeHint":"09:30"},
 {"order":2,"rawText":"11:00 강남 코엑스 도착","personOrPlace":"강남 코엑스","addressHint":"","action":"arrive","timeHint":"11:00"},
 {"order":3,"rawText":"오후 3시 인천공항 T2 드랍","personOrPlace":"인천공항 T2","addressHint":"","action":"dropoff","timeHint":"15:00"}
]}`;

/** 문자열 소문자 trim 정규화. */
function norm(s) {
  return String(s || '').toLowerCase().trim();
}

/** action 정규화 — 허용 목록 밖이면 'via'. */
function normAction(a) {
  const v = norm(a);
  return ALLOWED_ACTIONS.has(v) ? v : 'via';
}

/** 텍스트에 공항 키워드가 있는지. */
function looksLikeAirport(...parts) {
  const hay = norm(parts.filter(Boolean).join(' '));
  if (!hay) return false;
  return AIRPORT_KEYWORDS.some((kw) => hay.includes(kw));
}

/**
 * Gemini 로 자유 텍스트 → stops[] 추출. 실패 시 throw (상위에서 구조화 에러로 변환).
 */
async function extractStops(text, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text }] }],
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.2, // 추출 태스크 — 낮은 온도로 안정화
      maxOutputTokens: 2000,
      responseMimeType: 'application/json',
    },
  });

  const raw = result.response.text() || '';

  // JSON 강제했지만 방어적으로 코드블록/바깥 { } 도 처리 (ai-planner-quick 패턴).
  let jsonStr = raw;
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (block) jsonStr = block[1];
  if (!jsonStr.trim().startsWith('{')) {
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last > first) jsonStr = jsonStr.slice(first, last + 1);
  }

  const parsed = JSON.parse(jsonStr);
  const stops = Array.isArray(parsed?.stops) ? parsed.stops : [];
  return stops;
}

/**
 * 주소록(mood_places) 전체를 읽어 매칭용 인덱스로 반환.
 * 각 항목: { name, nameNorm, address, lat, lng, isDirector }.
 * lat/lng 는 숫자일 때만 유효 (문자열/누락은 null).
 */
async function loadPlacebook(db) {
  const snap = await db.collection('mood_places').get();
  const places = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const name = typeof d.name === 'string' ? d.name.trim() : '';
    if (!name) return;
    const lat = Number(d.lat);
    const lng = Number(d.lng);
    places.push({
      name,
      nameNorm: norm(name),
      address: typeof d.address === 'string' ? d.address.trim() : '',
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      isDirector: d.isDirector === true,
    });
  });
  return places;
}

/**
 * stop 의 personOrPlace 를 주소록과 매칭.
 * - 정확 일치(정규화) 우선, 없으면 포함 관계(양방향) 매칭.
 * - 짧은 이름(1글자)은 오매칭 위험이 커 포함 매칭에서 제외.
 * @returns {object|null} 매칭된 place 또는 null.
 */
function matchPlacebook(personOrPlace, places) {
  const q = norm(personOrPlace);
  if (!q) return null;

  // 1) 정확 일치
  const exact = places.find((p) => p.nameNorm === q);
  if (exact) return exact;

  // 2) 포함 관계 — 오매칭 방지 규칙:
  //    - 방향은 "주소록명이 파싱명을 포함"(p⊇q)만 허용. 반대(q⊇p)는 짧은 주소록명이
  //      긴 이름에 잘못 걸림('유진'이 '정유진'에 매칭)이라 제거.
  //    - 후보가 2개 이상이면 모호 → 매칭 포기(null) → geocode 경로로 보내 운영자 확인 강제.
  if (q.length >= 2) {
    const contains = places.filter((p) => p.nameNorm.length >= 2 && p.nameNorm.includes(q));
    if (contains.length === 1) return contains[0];
  }
  return null;
}

export default async function handler(req, res) {
  const JSON_HEADERS = {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }),
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only', code: 'METHOD_NOT_ALLOWED' }));
  }

  // ── 인증: Firebase ID 토큰 + 이메일 검증 ──
  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error, code: 'AUTH_REQUIRED' }));
  }
  const email = auth.email;
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증', code: 'EMAIL_UNVERIFIED' }));
  }

  // ── Body 파싱 ──
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  if (!rawText) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'text 필수', code: 'MISSING_TEXT' }));
  }
  if (rawText.length > MAX_TEXT_LEN) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: `text 는 ${MAX_TEXT_LEN}자 이하`, code: 'TEXT_TOO_LONG' }));
  }

  try {
    const db = initAdminDb('mood-parse-schedule');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable', code: 'DB_UNAVAILABLE' }));
    }

    // ── allowlist 게이트 (조회성이지만 MOOD 내부 데이터라 게이트) ──
    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '접근 권한 없음 (MOOD 허용 목록 전용)', code: 'NOT_ALLOWED' }));
    }

    // ── ① Gemini 로 stops 추출 ──
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'AI 설정 누락 (GEMINI_API_KEY)', code: 'AI_NOT_CONFIGURED' }));
    }

    let rawStops;
    try {
      rawStops = await extractStops(rawText, apiKey);
    } catch (aiErr) {
      console.warn('[mood-parse-schedule] Gemini 추출 실패:', aiErr.message);
      await captureError(aiErr, { route: '/api/mood-parse-schedule', email, phase: 'gemini' });
      // fail-soft: 500 아닌 구조화 에러
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '일정 해석 실패 — 다시 시도하거나 수동 입력하세요', code: 'AI_PARSE_FAILED' }));
    }

    if (!Array.isArray(rawStops) || rawStops.length === 0) {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '일정에서 장소를 찾지 못했습니다', code: 'NO_STOPS_FOUND' }));
    }

    // 상한 컷 (과다 추출 방어).
    const trimmedStops = rawStops.slice(0, MAX_STOPS);

    // ── 주소록 로드 (매칭·좌표 재사용용) ──
    let placebook = [];
    try {
      placebook = await loadPlacebook(db);
    } catch (pbErr) {
      // 주소록 못 읽어도 geocode 로 진행 (fail-soft) — 매칭만 스킵.
      console.warn('[mood-parse-schedule] 주소록 로드 실패 (geocode 로 진행):', pbErr.message);
    }

    // NCP/NAVER 키 (mood-route.computeRoute 와 동일 폴백 — 어느 이름으로 등록돼도 동작).
    const ncpId = (process.env.NCP_CLIENT_ID || process.env.NAVER_CLIENT_ID || '').trim();
    const ncpSecret = (process.env.NCP_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET || '').trim();
    const geocodeConfigured = !!(ncpId && ncpSecret);

    // ── ②③ 각 stop: 주소록 매칭 → 좌표(재사용 or geocode) ──
    let hasDirector = false;
    let hasAirport = false;

    const stops = await Promise.all(
      trimmedStops.map(async (s, idx) => {
        const order = Number.isInteger(s?.order) ? s.order : idx + 1;
        const personOrPlace = typeof s?.personOrPlace === 'string' ? s.personOrPlace.trim() : '';
        const addressHint = typeof s?.addressHint === 'string' ? s.addressHint.trim() : '';
        const action = normAction(s?.action);
        const rawStopText = typeof s?.rawText === 'string' ? s.rawText.trim() : '';

        // ② 주소록 매칭
        const matched = matchPlacebook(personOrPlace, placebook);
        if (matched?.isDirector) hasDirector = true;

        // 공항 판정 (이름/주소힌트/rawText/매칭주소 전부 검사)
        if (looksLikeAirport(personOrPlace, addressHint, rawStopText, matched?.address)) {
          hasAirport = true;
        }

        // 라벨: 매칭된 주소록 이름 우선, 없으면 추출된 이름.
        const label = matched?.name || personOrPlace || addressHint || rawStopText || `장소 ${order}`;

        // ③ 좌표 결정
        let lat = null;
        let lng = null;
        let matchedFromPlacebook = false;
        let geocodeOk = false;
        let address = '';

        if (matched && matched.lat !== null && matched.lng !== null) {
          // 주소록에 저장된 좌표 재사용
          lat = matched.lat;
          lng = matched.lng;
          address = matched.address || addressHint || '';
          matchedFromPlacebook = true;
          geocodeOk = true;
        } else {
          // geocode 대상: 매칭 주소 > addressHint > personOrPlace
          const geoQuery = (matched?.address || addressHint || personOrPlace || '').trim();
          address = geoQuery;
          if (geoQuery && geocodeConfigured) {
            try {
              const coord = await geocode(geoQuery, ncpId, ncpSecret);
              if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng)) {
                lat = coord.lat;
                lng = coord.lng;
                geocodeOk = true;
              }
            } catch (geoErr) {
              // fail-soft: 이 stop 만 geocodeOk=false (전체는 계속).
              console.warn(`[mood-parse-schedule] geocode 실패 (stop ${order}):`, geoErr.message);
            }
          }
        }

        return {
          order,
          label,
          address,
          lat,
          lng,
          action,
          matchedFromPlacebook,
          geocodeOk,
        };
      })
    );

    // order 순 정렬 (Gemini 순서 신뢰하되 방어적 정렬).
    stops.sort((a, b) => a.order - b.order);

    // ── ④ 서비스 추천 ──
    // airport 우선 (공항 이동은 명확한 서비스 구분) → 이사님(vehicle) → 그 외 manager.
    let serviceGuess;
    if (hasAirport) {
      serviceGuess = 'airport';
    } else if (hasDirector) {
      serviceGuess = 'vehicle';
    } else {
      serviceGuess = 'manager';
    }

    console.log(
      `[mood-parse-schedule] ${email} → stops=${stops.length} service=${serviceGuess} director=${hasDirector} airport=${hasAirport}`
    );

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      stops,
      serviceGuess,
      hasDirector,
      hasAirport,
      needsConfirm: true, // 항상 true — 프론트가 서비스 추천 더블체크
    }));
  } catch (err) {
    console.error('[mood-parse-schedule] failed:', err.message);
    await captureError(err, { route: '/api/mood-parse-schedule', email });
    // fail-soft: 예기치 못한 오류도 구조화된 에러로.
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류 — 다시 시도하세요', code: 'INTERNAL_ERROR' }));
  }
}
