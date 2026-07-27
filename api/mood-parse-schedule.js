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
 *     serviceGuess, hasDirector, hasAirport, airportCodeGuess, needsConfirm: true }
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
import { naverCoordToWgs84, resolveCredentialCandidates } from './place-search.js';

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
- dateHint: the date string for this stop's day, copied as written (e.g. "7/15", "7월 15일", "07.15"). A date header line (e.g. "7/15 일정") applies to ALL stops below it until the next date header. Empty string if no date anywhere.
- flights: flight numbers mentioned anywhere (e.g. KE765, OZ102, 7C1301) with their time/date if shown. A flight-number line is flight info, NOT a stop by itself — the actual pickup/dropoff line is the stop.
- Do NOT invent coordinates or addresses. Only extract what is written.
- If a line clearly refers to an airport (공항/ICN/GMP/인천공항/김포공항), keep that word in personOrPlace or addressHint.

OUTPUT — STRICT JSON ONLY, no markdown, no explanation:
{
  "stops": [
    { "order": 1, "rawText": "original line/snippet", "personOrPlace": "홍길동 or 강남역", "addressHint": "", "action": "pickup", "timeHint": "09:30", "dateHint": "7/15" }
  ],
  "flights": [
    { "flightNo": "KE765", "timeHint": "15:10", "dateHint": "7/15" }
  ]
}

EXAMPLE INPUT:
"■ 9:30 이사님 픽업 (인천 강화군 불은면)
 ■ 11:00 강남 코엑스 도착
 ■ 오후 3시 인천공항 T2 드랍"

EXAMPLE OUTPUT:
{"stops":[
 {"order":1,"rawText":"9:30 이사님 픽업 (인천 강화군 불은면)","personOrPlace":"이사님","addressHint":"인천 강화군 불은면","action":"pickup","timeHint":"09:30","dateHint":""},
 {"order":2,"rawText":"11:00 강남 코엑스 도착","personOrPlace":"강남 코엑스","addressHint":"","action":"arrive","timeHint":"11:00","dateHint":""},
 {"order":3,"rawText":"오후 3시 인천공항 T2 드랍","personOrPlace":"인천공항 T2","addressHint":"","action":"dropoff","timeHint":"15:00","dateHint":""}
],"flights":[]}

EXAMPLE 2 INPUT (multi-date with flight):
"7/15 일정
KE765 15:10 인천 도착
■ 15:30 인천공항 T2 픽업
■ 17:00 신라호텔 도착
7/18 일정
■ 10:00 신라호텔 픽업"

EXAMPLE 2 OUTPUT:
{"stops":[
 {"order":1,"rawText":"15:30 인천공항 T2 픽업","personOrPlace":"인천공항 T2","addressHint":"","action":"pickup","timeHint":"15:30","dateHint":"7/15"},
 {"order":2,"rawText":"17:00 신라호텔 도착","personOrPlace":"신라호텔","addressHint":"","action":"arrive","timeHint":"17:00","dateHint":"7/15"},
 {"order":3,"rawText":"10:00 신라호텔 픽업","personOrPlace":"신라호텔","addressHint":"","action":"pickup","timeHint":"10:00","dateHint":"7/18"}
],"flights":[
 {"flightNo":"KE765","timeHint":"15:10","dateHint":"7/15"}
]}`;

/** 문자열 소문자 trim 정규화. */
export function norm(s) {
  return String(s || '').toLowerCase().trim();
}

/** action 정규화 — 허용 목록 밖이면 'via'. */
function normAction(a) {
  const v = norm(a);
  return ALLOWED_ACTIONS.has(v) ? v : 'via';
}

/**
 * 날짜 힌트("7/15"·"7월 15일"·"07.15"·"2026-07-15") → ISO(YYYY-MM-DD) (2026-07-05 PR3).
 *
 * 연도 없는 표기(카톡 일정 대부분)는 오늘 기준 연도로 해석하되, 그러면 90일 넘게
 * 과거가 되는 날짜는 내년으로 넘긴다(일정은 미래 지향 — 12월에 "1/5" 받으면 내년 1월).
 * 해석 불가/무효 날짜(2/30 등)는 null — 프론트는 날짜 없음으로 취급(기존 흐름 유지).
 *
 * @param {string} hint - Gemini 가 원문 그대로 복사한 날짜 문자열.
 * @param {string} todayIso - 기준 오늘(KST) YYYY-MM-DD.
 * @returns {string|null}
 */
export function resolveDateHint(hint, todayIso) {
  const s = String(hint || '').trim();
  if (!s) return null;
  let year = null;
  let mo;
  let day;
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/);
  if (m) {
    year = Number(m[1]);
    mo = Number(m[2]);
    day = Number(m[3]);
  } else {
    // "7/15" "7.15" "07-15" "7월 15일" "7월15일"
    m = s.match(/^(\d{1,2})\s*[/.월-]\s*(\d{1,2})\s*일?\.?$/);
    if (!m) return null;
    mo = Number(m[1]);
    day = Number(m[2]);
  }
  if (!(mo >= 1 && mo <= 12 && day >= 1 && day <= 31)) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const build = (y) => {
    const d = new Date(Date.UTC(y, mo - 1, day));
    // 2/30 → 3/2 처럼 넘어가면 무효 (월/일이 안 맞음)
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) return null;
    return `${y}-${pad(mo)}-${pad(day)}`;
  };
  if (year != null) return build(year);
  const ty = Number(String(todayIso).slice(0, 4));
  if (!Number.isFinite(ty)) return null;
  const cand = build(ty);
  if (!cand) return null;
  // 단일 날짜 변환(구간 아님) — 며칠 전인지(daysAgo)만 보고 연도 추론. 90일 초과 과거 = 내년.
  const daysAgo = (Date.parse(todayIso) - Date.parse(cand)) / 86400000;
  return daysAgo > 90 ? build(ty + 1) : cand;
}

/**
 * Gemini flights 응답 정제 (2026-07-05 PR3) — 편명 형식 검증 + 상한.
 * 편명: 항공사 코드(영숫자 2~3, 숫자 시작 가능 — 7C 등) + 편수 1~4자리.
 * @returns {Array<{flightNo:string, timeHint:string, dateHint:string}>}
 */
export function sanitizeFlights(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const f of raw.slice(0, 8)) {
    const no = String(f && f.flightNo ? f.flightNo : '').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(no) || !/\d/.test(no) || /^\d+$/.test(no)) continue;
    if (seen.has(no)) continue;
    seen.add(no);
    out.push({
      flightNo: no,
      timeHint: String(f && f.timeHint ? f.timeHint : '').slice(0, 20).trim(),
      dateHint: String(f && f.dateHint ? f.dateHint : '').slice(0, 20).trim(),
    });
  }
  return out;
}

/** 텍스트에 공항 키워드가 있는지. */
export function looksLikeAirport(...parts) {
  const hay = norm(parts.filter(Boolean).join(' '));
  if (!hay) return false;
  return AIRPORT_KEYWORDS.some((kw) => hay.includes(kw));
}

/**
 * 어느 공항인지 판정 (정액이 공항마다 달라 금액에 영향 — ICN 110,000 / GMP 80,000).
 * 김포 신호가 있을 때만 'GMP', 그 외 공항은 전부 기본 'ICN'.
 * 🔴 애매하면 비싼 쪽(ICN) — 운영자가 화면에서 김포로 바꾸는 건 쉽지만,
 *    싸게 잡힌 걸 못 보고 지나가면 과소청구가 된다.
 * @returns {'ICN'|'GMP'|null} 공항 신호가 아예 없으면 null.
 */
export function guessAirportCode(...parts) {
  const hay = norm(parts.filter(Boolean).join(' '));
  if (!hay) return null;
  if (hay.includes('김포') || hay.includes('gmp')) return 'GMP';
  return AIRPORT_KEYWORDS.some((kw) => hay.includes(kw)) ? 'ICN' : null;
}

/**
 * 잘린 JSON 응답에서 완성된 stop 객체만 회수 (최후 방어).
 *
 * maxOutputTokens 초과 등으로 응답이 중간에서 끊기면 JSON.parse 가 통째로 실패해
 * 멀쩡히 완성된 앞쪽 stop 들까지 다 버려졌다. "stops" 배열 안에서 중괄호 균형이
 * 맞는(문자열/이스케이프 인지) 최상위 객체들만 스캔해 개별 파싱으로 회수한다.
 * 뒤쪽 미완성 stop 은 버려지므로 호출측은 truncated 플래그로 운영자에게 경고할 것.
 *
 * @param {string} jsonStr - 잘렸을 수 있는 JSON 문자열.
 * @returns {object[]} 회수된 stop 객체 배열 (없으면 []).
 */
export function salvageStopsFromTruncatedJson(jsonStr) {
  const s = String(jsonStr || '');
  const arrKey = s.indexOf('"stops"');
  if (arrKey === -1) return [];
  const arrStart = s.indexOf('[', arrKey);
  if (arrStart === -1) return [];

  const out = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let escaped = false;
  for (let i = arrStart + 1; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          out.push(JSON.parse(s.slice(objStart, i + 1)));
        } catch { /* 개별 객체 불량 — skip */ }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break; // 배열 정상 종료
    }
  }
  return out;
}

/**
 * Gemini 로 자유 텍스트 → stops[] 추출. 실패 시 throw (상위에서 구조화 에러로 변환).
 * @returns {{ stops: object[], truncated: boolean }} truncated=true 면 잘린 응답에서
 *   부분 회수한 것 — 프론트가 운영자에게 "뒤쪽 일정 누락 가능" 경고를 띄워야 한다.
 */
async function extractStops(text, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text }] }],
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.2, // 추출 태스크 — 낮은 온도로 안정화
      // 🔴 2026-07-03 prod 버그 fix: gemini-2.5-flash 는 thinking 토큰이 maxOutputTokens
      //   안에서 차감됨(geminiPipeline.js 문서화). thinkingConfig 없이 2000 이면 thinking 이
      //   예산을 먹어 JSON 이 문자열 중간에서 잘림 → "Unterminated string in JSON at
      //   position 156"(Sentry) → AI_PARSE_FAILED("일정 해석 실패"). 추출 태스크라 thinking
      //   불필요 → 0 (chat.js·telegram-webhook-admin·BaseAgent 동일 규약).
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 5000, // 40 stops 상한 여유 (dateHint·flights 필드 추가로 4000→5000, ~2K 실사용)
      responseMimeType: 'application/json',
    },
  });
  // 사용량 실측 기록(비용 가시화 2026-07-09) — fire-and-forget, 실패해도 본 흐름 영향 0.
  import('./_shared/apiUsageRecorder.js').then((m) => m.recordUsageFromResponse('mood-parse', 'gemini-2.5-flash', result.response)).catch(() => {});

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

  let parsed;
  let truncated = false;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // 최후 방어: 응답이 그래도 잘렸으면 완성된 stop 객체만 회수(뒤쪽 미완성 stop 은 버림).
    // ⚠️ 부분 회수 = 뒤 stop 누락 가능 → truncated 플래그를 반환에 실어 프론트가
    //   운영자에게 경고(누락 확인) — 조용히 짧은 경로로 예약되는 과소청구 방지.
    //   flights 는 부분 회수 미지원(빈 배열) — 항공편 메모는 보조 정보라 fail-soft.
    const salvaged = salvageStopsFromTruncatedJson(jsonStr);
    if (!salvaged.length) throw new Error('AI 응답 JSON 파싱 실패 (수리 불가)');
    parsed = { stops: salvaged };
    truncated = true;
  }
  const stops = Array.isArray(parsed?.stops) ? parsed.stops : [];
  const flights = sanitizeFlights(parsed?.flights);
  return { stops, flights, truncated };
}

/**
 * 주소록(mood_places) 전체를 읽어 매칭용 인덱스로 반환.
 * 각 항목: { name, nameNorm, address, lat, lng, isDirector }.
 * lat/lng 는 숫자일 때만 유효 (문자열/누락은 null).
 */
/**
 * 주소록 문서의 좌표 정규화 — 손상/누락 좌표를 null 로 (2026-07-03 돈버그 fix).
 *
 * 🔴 기존 `Number(d.lat)` 는 lat 이 null/undefined 일 때 0 을 반환하고 `Number.isFinite(0)=true`
 * 라 (0,0) = null island(아프리카 앞바다)를 "유효 좌표"로 오인 → handler 가 geocode 를
 * 건너뛰고 (0,0) 재사용 → 거리요금이 지구 반바퀴로 폭발(과다청구). admin SDK 로 좌표 없이
 * 저장된 항목(예: 지오코딩 실패한 '유진집')에서 실제 발생.
 *
 * 규칙: 실제 number 이고 유한하며 한국 범위(lat 33~39, lng 124~132) 안일 때만 좌표 유효.
 * 무효면 {null,null} → handler 가 geocode 경로로 보냄(정상 처리 or 🔴 차단).
 *
 * @param {object} d - Firestore mood_places 문서 데이터.
 * @returns {{lat:number|null, lng:number|null}}
 */
export function coordFromPlaceDoc(d) {
  const lat = typeof d?.lat === 'number' && Number.isFinite(d.lat) ? d.lat : null;
  const lng = typeof d?.lng === 'number' && Number.isFinite(d.lng) ? d.lng : null;
  if (lat === null || lng === null) return { lat: null, lng: null };
  const inKorea = lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
  return inKorea ? { lat, lng } : { lat: null, lng: null };
}

/**
 * 주소록 문서 1개 → 매칭 엔트리 배열 (2026-07-04 별칭 지원).
 *
 * aliases[] 로 표기 변형("인천공항 터미널2"↔"인천공항 T2", "트리지움아파트 311동"↔최수현)
 * 을 같은 장소로 매칭. 각 엔트리는 key(문서 id)를 가짐 — matchPlacebook 의 모호성 판정이
 * "서로 다른 장소 2곳"일 때만 포기하도록(같은 장소의 별칭 여러 개는 모호 아님).
 */
export function expandPlaceEntries(docId, d) {
  const name = typeof d?.name === 'string' ? d.name.trim() : '';
  if (!name) return [];
  const { lat, lng } = coordFromPlaceDoc(d);
  const base = {
    key: docId,
    name, // 표시는 항상 대표명
    address: typeof d.address === 'string' ? d.address.trim() : '',
    lat,
    lng,
    isDirector: d.isDirector === true,
  };
  const aliasList = Array.isArray(d.aliases) ? d.aliases : [];
  const seen = new Set();
  const out = [];
  for (const raw of [name, ...aliasList]) {
    const nm = norm(raw);
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    out.push({ ...base, nameNorm: nm });
  }
  return out;
}

async function loadPlacebook(db) {
  const snap = await db.collection('mood_places').get();
  const places = [];
  snap.forEach((doc) => {
    places.push(...expandPlaceEntries(doc.id, doc.data() || {}));
  });
  return places;
}

/**
 * stop 의 personOrPlace 를 주소록과 매칭.
 * - 정확 일치(정규화) 우선, 없으면 포함 관계(양방향) 매칭.
 * - 짧은 이름(1글자)은 오매칭 위험이 커 포함 매칭에서 제외.
 * @returns {object|null} 매칭된 place 또는 null.
 */
export function matchPlacebook(personOrPlace, places) {
  const q = norm(personOrPlace);
  if (!q) return null;

  // 1) 정확 일치
  const exact = places.find((p) => p.nameNorm === q);
  if (exact) return exact;

  // 2) 포함 관계 — 오매칭 방지 규칙:
  //    - 방향은 "주소록명이 파싱명을 포함"(p⊇q)만 허용. 반대(q⊇p)는 짧은 주소록명이
  //      긴 이름에 잘못 걸림('유진'이 '정유진'에 매칭)이라 제거.
  //    - 서로 다른 장소 2곳 이상이면 모호 → 매칭 포기(null) → 운영자 확인 강제.
  //      (2026-07-04: 같은 장소의 별칭 여러 개가 걸린 건 모호 아님 — key 로 판정)
  if (q.length >= 2) {
    const contains = places.filter((p) => p.nameNorm.length >= 2 && p.nameNorm.includes(q));
    if (contains.length) {
      const uniquePlaces = new Set(contains.map((p) => p.key || p.nameNorm));
      if (uniquePlaces.size === 1) return contains[0];
    }
  }
  return null;
}

/**
 * 네이버 장소검색 폴백 (2026-07-04) — 주소록 미스 + 주소 지오코딩 실패 시 3차 시도.
 *
 * 지오코더는 도로명주소 전용이라 "트리지움아파트 311동"·"인천공항 터미널2" 같은
 * 건물/시설명을 못 받음 → 장소검색(POI)으로 도로명주소+좌표를 얻는다.
 * place-search.js(#1059)의 키 폴백 체인·좌표 포맷 자동감지를 재사용.
 * 성공 stop 은 searchGuessed=true — 프론트가 "검색추정, 지점 확인" 표시(오지점=요금 오차 방지).
 */
async function searchPlaceFallback(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return null;
  for (const { id, secret } of resolveCredentialCandidates()) {
    try {
      const r = await fetch(
        `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=1`,
        { headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret } },
      );
      if (r.status === 401 || r.status === 403) continue; // 죽은 키 → 다음 키쌍
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      const it = j?.items?.[0];
      if (!it) return null;
      const coord = naverCoordToWgs84(it.mapx, it.mapy);
      const address = String(it.roadAddress || it.address || '').trim();
      if (!coord || !address) return null;
      return { address, lat: coord.lat, lng: coord.lng };
    } catch {
      return null; // 네트워크 오류 — 폴백 실패로 처리(운영자 검색 UI 경로)
    }
  }
  return null;
}

/**
 * stop 1건의 주소록 매칭 — 명시 장소(addressHint)가 사람 이름보다 우선 (2026-07-03).
 *
 * 왜: "르픽(정유진 픽업)" 은 정유진을 '르픽에서' 태우는 것. personOrPlace(정유진)만
 * 매칭하면 주소록의 정유진 집 주소가 이겨서 픽업 위치가 집으로 잡힘 → 동선·km·요금
 * 전부 오계산(돈 버그). 명시된 위치(addressHint)가 주소록에 있으면 그게 이긴다.
 *
 * 이사님(vehicle 판별) 신호는 위치 승자와 무관 — 어느 쪽이든 isDirector 면 켠다
 * ("르픽(이사님 픽업)" 도 차량 서비스 신호 유지).
 *
 * @returns {{ matched: object|null, directorSignal: boolean }}
 */
export function matchStopPlaces(personOrPlace, addressHint, places) {
  const byHint = matchPlacebook(addressHint, places);
  const byPerson = matchPlacebook(personOrPlace, places);
  return {
    matched: byHint || byPerson,
    directorSignal: !!(byHint?.isDirector || byPerson?.isDirector),
  };
}

/**
 * 서비스 추천 (더블체크 대상 — 항상 needsConfirm=true 로 프론트가 재확인).
 * 우선순위: airport(공항 이동=명확한 구분) > vehicle(이사님 동승) > manager(그 외).
 * @param {boolean} hasAirport - stops 에 공항 지점 포함 여부.
 * @param {boolean} hasDirector - stops 에 이사님(isDirector) 포함 여부.
 * @returns {'airport'|'vehicle'|'manager'}
 */
export function guessService(hasAirport, hasDirector) {
  if (hasAirport) return 'airport';
  if (hasDirector) return 'vehicle';
  return 'manager';
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
    let rawFlights = [];
    let truncated = false;
    try {
      const extracted = await extractStops(rawText, apiKey);
      rawStops = extracted.stops;
      rawFlights = extracted.flights;
      truncated = extracted.truncated;
      if (truncated) {
        console.warn('[mood-parse-schedule] 응답 잘림 — 부분 회수', rawStops.length, 'stops');
      }
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
    // 어느 공항인지 (금액 영향 — GMP 8만 / ICN 11만). 김포 신호가 하나라도 있으면 GMP.
    let airportCodeGuess = null;

    // 날짜 해석 기준 = 오늘(KST). 서버는 UTC 라 +9h 보정 (연도 추론용).
    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    const stops = await Promise.all(
      trimmedStops.map(async (s, idx) => {
        const order = Number.isInteger(s?.order) ? s.order : idx + 1;
        const personOrPlace = typeof s?.personOrPlace === 'string' ? s.personOrPlace.trim() : '';
        const addressHint = typeof s?.addressHint === 'string' ? s.addressHint.trim() : '';
        const action = normAction(s?.action);
        const rawStopText = typeof s?.rawText === 'string' ? s.rawText.trim() : '';
        // 날짜(2026-07-05 PR3) — "7/15 일정 + 7/18 일정" 이 한 예약으로 뭉치는 문제 해결용.
        // 해석 실패 = null (날짜 없음과 동일 취급 — 기존 단일날짜 흐름 그대로).
        const stopDate = resolveDateHint(s?.dateHint, todayKst);

        // ② 주소록 매칭 — 명시 장소(addressHint) 우선, 이사님 신호는 양쪽 다 (matchStopPlaces).
        const { matched, directorSignal } = matchStopPlaces(personOrPlace, addressHint, placebook);
        if (directorSignal) hasDirector = true;

        // 공항 판정 (이름/주소힌트/rawText/매칭주소 전부 검사)
        if (looksLikeAirport(personOrPlace, addressHint, rawStopText, matched?.address)) {
          hasAirport = true;
          const code = guessAirportCode(personOrPlace, addressHint, rawStopText, matched?.address);
          // 김포가 한 번이라도 잡히면 GMP 유지 (ICN 이 덮어쓰지 않게).
          if (code === 'GMP' || !airportCodeGuess) airportCodeGuess = code;
        }

        // 라벨: 매칭된 주소록 이름 우선, 없으면 추출된 이름.
        const label = matched?.name || personOrPlace || addressHint || rawStopText || `장소 ${order}`;

        // ③ 좌표 결정
        let lat = null;
        let lng = null;
        let matchedFromPlacebook = false;
        let geocodeOk = false;
        let searchGuessed = false;
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
          // 3차 폴백(2026-07-04): 지오코더는 주소 전용이라 "트리지움아파트 311동"·
          // "인천공항 터미널2" 같은 건물/시설명 실패 → 네이버 장소검색(POI)으로 재시도.
          // 성공 시 도로명주소를 채워(예약 시 서버 재지오코딩과 일관) searchGuessed 표시 —
          // 프론트가 "검색추정, 지점 확인" 배지로 운영자 확인 유도(오지점=요금 오차 방지).
          if (!geocodeOk) {
            const found = await searchPlaceFallback(geoQuery || personOrPlace);
            if (found) {
              address = found.address;
              lat = found.lat;
              lng = found.lng;
              geocodeOk = true;
              searchGuessed = true;
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
          searchGuessed,
          date: stopDate, // YYYY-MM-DD | null — 프론트 날짜별 예약 분리용
        };
      })
    );

    // order 순 정렬 (Gemini 순서 신뢰하되 방어적 정렬).
    stops.sort((a, b) => a.order - b.order);

    // 항공편(2026-07-05 PR3) — 편명·시각·날짜(ISO 해석). 예약 메모 자동 첨부용 보조 정보.
    const flights = rawFlights.map((f) => ({
      flightNo: f.flightNo,
      timeHint: f.timeHint,
      date: resolveDateHint(f.dateHint, todayKst),
    }));

    // 서로 다른 날짜 목록 (정렬) — 2개 이상이면 프론트가 날짜별 예약 분리 UI 를 띄운다.
    const dates = [...new Set(stops.map((s) => s.date).filter(Boolean))].sort();

    // ── ④ 서비스 추천 (guessService 파생 — 테스트와 로직 공유) ──
    const serviceGuess = guessService(hasAirport, hasDirector);

    console.log(
      `[mood-parse-schedule] ${email} → stops=${stops.length} service=${serviceGuess} director=${hasDirector} airport=${hasAirport}${airportCodeGuess ? `(${airportCodeGuess})` : ''}`
    );

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      stops,
      serviceGuess,
      hasDirector,
      hasAirport,
      airportCodeGuess, // 'ICN' | 'GMP' | null — 공항 정액이 달라 프론트가 기본 선택으로 사용(운영자 확정)
      needsConfirm: true, // 항상 true — 프론트가 서비스 추천 더블체크
      truncated, // true 면 응답 잘림→부분 회수 — 프론트가 "뒤쪽 일정 누락 가능" 경고
      flights, // [{flightNo, timeHint, date}] — 예약 메모 자동 첨부용 (없으면 [])
      dates, // 서로 다른 stop 날짜 (ISO, 정렬) — 2개 이상이면 날짜별 예약 분리
    }));
  } catch (err) {
    console.error('[mood-parse-schedule] failed:', err.message);
    await captureError(err, { route: '/api/mood-parse-schedule', email });
    // fail-soft: 예기치 못한 오류도 구조화된 에러로.
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류 — 다시 시도하세요', code: 'INTERNAL_ERROR' }));
  }
}
