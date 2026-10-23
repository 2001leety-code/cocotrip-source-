// LLM 공급자 전환 (2026-10-13): mock 공급자 — 유료 API 0회. 자동 실행(CI·cron·테스트)용.
// main 역할은 실제 검증기(B-10/B-12/B-15/B-DC·식이 critical)를 통과하는 플랜을 만든다:
//   숙소 bookend · 하루 ≥4 stop · 식사 2회(검증 DB 행, 식이 요청 시 trusted 후보) · 출국일 공항 stop.
// block 역할은 available_blocks 에서 날짜별 1개를 순환 선택한다. 그 외 역할은 역할별 고정 JSON/텍스트.
import { getExactCityTrustedDietaryCandidates, getExactCityGeneralFoodCandidates } from '../../_food_helper.js';
import { getExactCitySpotCandidates } from '../../_spots_helper.js';

function lastJsonObject(text) {
  // userMessageBuilder: staticPrefix + middle + JSON.stringify(userInput) + tail — 마지막 {...} 블록이 userInput.
  const s = String(text || '');
  let end = s.lastIndexOf('}');
  while (end !== -1) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (s[i] === '}') depth++;
      else if (s[i] === '{') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(i, end + 1)); } catch { break; } } }
    }
    end = s.lastIndexOf('}', end - 1);
  }
  return null;
}

function firstJsonObject(text) {
  try { return JSON.parse(String(text || '')); } catch { return lastJsonObject(text); }
}

// day N 날짜 = startDate + (N-1). startDate inclusive (day 1 = 출발일 당일), end = startDate + days - 1 inclusive.
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const CITY_NAME = { seoul: 'Seoul', busan: 'Busan', jeju: 'Jeju', incheon: 'Incheon', gyeongju: 'Gyeongju', daegu: 'Daegu', gangneung: 'Gangneung', suwon: 'Suwon' };
const AIRPORT_NAME = { ICN: 'Incheon International Airport', GMP: 'Gimpo International Airport', PUS: 'Gimhae International Airport', CJU: 'Jeju International Airport' };

// 2026-10-23: 플랜 전체에서 lodging 외 stop 이름은 **유일**해야 한다(종단 중복 게이트
//   finalItineraryGate.runDuplicateStopGate — 키 = name 소문자 trim). 예전엔 풀을 순환해 같은 이름이
//   반복됐다(부산 스팟 풀 0 → "Busan Landmark"×4, 부산 할랄 trusted 3 → 6끼 중 반복) → daily-health 의
//   validate 실행이 매일 422 + plan 'streaming' 고착 + sweep 알림.
//   식당 규칙: 식이(halal/vegan/vegetarian) 손님은 trusted DB 행만 쓴다 — 풀이 바닥나면 **지어내지도
//   반복하지도 않고 그 끼니를 뺀다**(dietary-safety.md "완화 금지"; 빠진 필수 끼니는 B-MEAL 경고로 남는다).
//   식이 요구가 없으면 general 풀 → 유일 합성 이름(unverified, 비-critical) 순.
const SAFETY_DIETS = ['halal', 'vegan', 'vegetarian'];

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
}

function minToHhmm(min) {
  const v = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

const nameKey = (s) => String(s || '').trim().toLowerCase();

/** 식당 후보 — 식이 손님은 trusted 행만(이름 중복 제거), 아니면 general 행. */
function foodRows(city, diets) {
  const rows = diets.length
    ? getExactCityTrustedDietaryCandidates(city, diets, 40).map((c) => c.row)
    : getExactCityGeneralFoodCandidates(city, 40);
  const seen = new Set();
  return rows.filter((r) => {
    const k = nameKey(r && r.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function foodStop(row, time, order) {
  return {
    order, start_time: time, name: row.name, display_name: row.nameEn || row.name, category: 'food',
    address: row.address || '', lat: row.lat, lng: row.lng, stay_min: 60, tip: 'mock',
    ...(row.tag && row.tag !== 'general' ? { dietary_tags: [row.tag] } : {}),
  };
}

/**
 * 하루 뼈대 — 실제 검증기의 시각 규칙을 따른다(B-MEAL / B-LATE-ARRIVAL / B-EARLY-DEPARTURE / B-10 / B-12).
 *   meal.required = 그 날 B-MEAL 이 요구하는 끼니. 선택 끼니는 풀이 남을 때만 채운다.
 * @returns {Array<{kind:'lodging'|'spot'|'meal'|'airport', min:number, stay?:number, required?:boolean}>}
 */
function daySkeleton({ isSingle, isFirst, isLast, startMin, depMin }) {
  const full = (lunchRequired, dinnerRequired, endKind) => [
    { kind: 'lodging', min: 8 * 60 + 30 },
    { kind: 'spot', min: 10 * 60, stay: 90 },
    { kind: 'meal', min: 12 * 60, required: lunchRequired },
    { kind: 'spot', min: 14 * 60 + 30, stay: 90 },
    { kind: 'meal', min: 18 * 60, required: dinnerRequired },
    endKind === 'airport' ? { kind: 'airport', min: 20 * 60 } : { kind: 'lodging', min: 20 * 60 + 30 },
  ];
  if (isSingle) return full(true, true, 'lodging');
  if (isFirst) {
    // 도착일 — 활동은 max(tour_start_time, arrival_ready_time) 이후, 끼니 1회 필수(B-MEAL 도착일).
    if (startMin <= 10 * 60) return full(false, true, 'lodging');
    const t = Math.ceil(startMin / 30) * 30;
    if (t > 21 * 60) return [{ kind: 'lodging', min: Math.min(t, 23 * 60) }, { kind: 'lodging', min: Math.min(t + 30, 23 * 60 + 30) }];
    const out = [{ kind: 'lodging', min: t }];
    let cursor = t;
    if (t <= 16 * 60) { out.push({ kind: 'spot', min: t + 30, stay: 60 }); cursor = t + 30 + 90; }
    const dinner = Math.max(18 * 60, cursor);
    out.push({ kind: 'meal', min: dinner, required: true });
    out.push({ kind: 'lodging', min: dinner + 75 });
    return out;
  }
  if (!isLast) return full(true, true, 'lodging');
  // 출국일
  if (depMin === null) return full(false, false, 'airport'); // 공항 stop 이 있으면 끼니 면제
  const maxAct = depMin - 180; // 출국 3시간 전 이후 활동 금지
  if (depMin < 9 * 60) {
    // red-eye — 체크아웃 + 공항 2 stop 만, 조식 면제
    return [{ kind: 'lodging', min: Math.max(0, depMin - 210) }, { kind: 'airport', min: Math.max(0, maxAct) }];
  }
  if (depMin < 11 * 60) {
    const breakfast = Math.max(6 * 60, maxAct - 30);
    return [
      { kind: 'lodging', min: breakfast - 30 },
      { kind: 'meal', min: breakfast, required: true },
      { kind: 'airport', min: maxAct },
    ];
  }
  if (depMin < 17 * 60) {
    const meal = maxAct - 30;
    const out = [{ kind: 'lodging', min: Math.min(7 * 60, meal - 30) }];
    if (meal - 120 >= 9 * 60) out.push({ kind: 'spot', min: meal - 120, stay: 90 });
    out.push({ kind: 'meal', min: meal, required: true });
    out.push({ kind: 'airport', min: maxAct });
    return out;
  }
  const out = [
    { kind: 'lodging', min: 7 * 60 },
    { kind: 'meal', min: 8 * 60, required: true },
    { kind: 'spot', min: 10 * 60, stay: 90 },
    { kind: 'meal', min: 12 * 60, required: true },
  ];
  if (14 * 60 + 30 <= maxAct) out.push({ kind: 'spot', min: 14 * 60 + 30, stay: 90 });
  out.push({ kind: 'airport', min: maxAct });
  return out;
}

/**
 * @param {{userText:string}} p user 메시지(끝에 userInput JSON) → 검증기 통과형 플랜.
 */
export function buildMockPlan({ userText }) {
  const u = lastJsonObject(userText) || {};
  const days = Math.max(1, Math.min(14, Number(u.duration_days) || 1));
  const city = String((Array.isArray(u.regions) && u.regions[0]) || u.area || 'seoul').toLowerCase();
  const cityName = CITY_NAME[city] || city;
  const diets = (Array.isArray(u.diet_preferences) ? u.diet_preferences : []).map((d) => String(d).toLowerCase()).filter((d) => SAFETY_DIETS.includes(d));
  const foods = foodRows(city, diets);
  const spots = getExactCitySpotCandidates(city);
  const arrCode = String(u.arrival_airport || 'ICN').split('_')[0];
  const depCode = String(u.departure_airport || arrCode).split('_')[0];
  const arrName = AIRPORT_NAME[arrCode] || `${arrCode} Airport`;
  const depName = AIRPORT_NAME[depCode] || `${depCode} Airport`;
  const lodging = { name: `${cityName} Mock Hotel`, category: 'lodging', address: `${cityName}`, stay_min: 0 };

  // 활동 시작 = max(tour_start_time, arrival_ready_time) — userMessageBuilder 가 넘긴 값(검증기와 같은 기준).
  const tourStartMin = hhmmToMin(u.tour_start_time) === null ? 9 * 60 : hhmmToMin(u.tour_start_time);
  const arrMin = hhmmToMin(u.arrival_time);
  let readyMin = hhmmToMin(u.arrival_ready_time);
  if (readyMin !== null && arrMin !== null && readyMin < arrMin) readyMin += 24 * 60; // 자정 넘김(wrap) = 사실상 휴식일
  const startMin = Math.max(tourStartMin, readyMin === null ? 0 : readyMin);
  const depMin = hhmmToMin(u.departure_time);

  // 이름 유일성 — 스팟·식당·공항 공통(lodging 제외). 게이트와 같은 키(소문자 trim).
  const used = new Set();
  const claim = (name) => { used.add(nameKey(name)); return name; };
  let si = 0; let landmarkN = 0;
  const nextSpot = () => {
    while (si < spots.length) {
      const s = spots[si++];
      const n = s.name.en || s.name.ko;
      if (n && !used.has(nameKey(n))) return { name: claim(n), display_name: n, address: s.address, category: 'culture' };
    }
    let n;
    do { landmarkN += 1; n = `${cityName} Landmark ${landmarkN}`; } while (used.has(nameKey(n)));
    return { name: claim(n), display_name: n, category: 'culture', address: cityName };
  };
  let fi = 0; let restaurantN = 0;
  const nextFoodRow = () => {
    while (fi < foods.length) {
      const r = foods[fi++];
      if (!used.has(nameKey(r.name))) { claim(r.name); return r; }
    }
    if (diets.length) return null; // 식이 손님 — trusted 소진 시 지어내지 않는다(빈 끼니).
    let n;
    do { restaurantN += 1; n = `${cityName} Local Restaurant ${restaurantN}`; } while (used.has(nameKey(n)));
    return { name: claim(n), address: cityName };
  };

  // 끼니 배정: 필수 끼니 먼저(전 일정), 남으면 선택 끼니. 못 채운 끼니는 뺀다.
  const skeletons = [];
  for (let d = 1; d <= days; d++) {
    skeletons.push(daySkeleton({ isSingle: days === 1, isFirst: d === 1 && days > 1, isLast: d === days && days > 1, startMin, depMin }));
  }
  if (days > 1) claim(depName); // 공항 stop 은 출국일 1회 — 유일성 집합에 먼저 올린다.
  const mealRows = new Map();
  for (const wantRequired of [true, false]) {
    skeletons.forEach((sk, di) => sk.forEach((slot, si2) => {
      if (slot.kind !== 'meal' || Boolean(slot.required) !== wantRequired) return;
      const row = nextFoodRow();
      if (row) mealRows.set(`${di}:${si2}`, row);
    }));
  }

  const out = {
    tour_title: `${cityName} ${days}-Day Mock Plan`,
    vehicle: 'walking+transit',
    base_price_krw: 0,
    arrival_guide: { airport: arrName, steps: [{ step: 1, title: 'Arrival', detail: `Arrive at ${arrName} (mock).` }] },
    days: [],
    departure_guide: { airport: depName, steps: [{ step: 1, title: 'Departure', detail: `Head to ${depName} (mock).` }] },
    daily_budget_summary: [],
    t_money_recommended_load: 20000,
  };
  for (let d = 1; d <= days; d++) {
    const stops = [];
    skeletons[d - 1].forEach((slot, si2) => {
      const time = minToHhmm(slot.min);
      if (slot.kind === 'lodging') stops.push({ ...lodging, start_time: time });
      else if (slot.kind === 'airport') stops.push({ start_time: time, name: depName, category: 'airport', address: depName, stay_min: 0 });
      else if (slot.kind === 'spot') stops.push({ ...nextSpot(), start_time: time, stay_min: slot.stay || 90 });
      else {
        const row = mealRows.get(`${d - 1}:${si2}`);
        if (row) stops.push(foodStop(row, time));
      }
    });
    stops.forEach((s, i) => { s.order = i + 1; });
    out.days.push({ day: d, date: addDays(u.date, d - 1), city: cityName, theme: `Mock day ${d}`, stops });
    out.daily_budget_summary.push({ day: d, food_krw: 40000, transport_krw: 10000, admission_krw: 10000, total_krw: 60000 });
  }
  if (days === 1) out.days[0].return_to_airport = { airport: depName, mode: 'transit' };
  return out;
}

/** block 역할: { day_selections: [{day, city, block_id, tweak_notes}] } — available_blocks 순환. */
export function buildMockBlockSelection({ userText }) {
  const u = firstJsonObject(userText) || {};
  const days = Math.max(1, Math.min(14, Number(u.duration_days) || 1));
  const idOf = (b) => String(b?.id || b?.block_id || '').trim();
  const day_selections = [];
  if (Array.isArray(u.day_schedule) && u.day_schedule.length) {
    for (const ds of u.day_schedule) {
      const blocks = Array.isArray(ds.available_blocks) ? ds.available_blocks : [];
      const pick = blocks[(Number(ds.day) - 1) % Math.max(1, blocks.length)];
      day_selections.push({ day: Number(ds.day), city: ds.city, block_id: pick ? idOf(pick) : '' });
    }
    return { day_selections };
  }
  const blocks = Array.isArray(u.available_blocks) ? u.available_blocks : [];
  for (let d = 1; d <= days; d++) {
    const pick = blocks[(d - 1) % Math.max(1, blocks.length)];
    day_selections.push({ day: d, city: pick?.city, block_id: pick ? idOf(pick) : '', tweak_notes: '' });
  }
  return { day_selections };
}

const LANG_MARK = { Japanese: 'テスト訳', Chinese: '测试译', Korean: '테스트 번역', English: 'test translation' };

/** translate-plan 프롬프트: "Translate the input into <Lang>." + "Input:\n{descriptive:[],transit:[]}" → 같은 길이 배열 echo. */
function mockTranslatePlan(prompt) {
  const lang = (String(prompt).match(/into ([A-Za-z]+)/) || [])[1] || 'English';
  const mark = LANG_MARK[lang] || LANG_MARK.English;
  const idx = String(prompt).lastIndexOf('Input:');
  let input = { descriptive: [], transit: [] };
  try { input = JSON.parse(String(prompt).slice(idx + 'Input:'.length).trim()); } catch { /* keep empty */ }
  const tag = (t) => `${t} (${mark})`;
  return JSON.stringify({
    descriptive: (input.descriptive || []).map(tag),
    transit: (input.transit || []).map(tag),
  });
}

/**
 * mood-parse-schedule 프롬프트 출력 스키마 고정 응답 — { stops:[{order,rawText,personOrPlace,addressHint,action,timeHint,dateHint}], flights:[] }.
 * action 은 핸들러 ALLOWED_ACTIONS 안의 값만, 마지막 stop 은 공항(mood-smoke 기대 serviceGuess=airport).
 * 좌표·주소는 지어내지 않는다 — 핸들러가 주소록/지오코딩으로 채운다. needsConfirm 은 핸들러가 설정.
 */
export const MOOD_PARSE_FIXTURE = Object.freeze({
  stops: [
    { order: 1, rawText: '09:30 신라호텔 픽업', personOrPlace: '신라호텔', addressHint: '서울 중구 동호로 249', action: 'pickup', timeHint: '09:30', dateHint: '' },
    { order: 2, rawText: '11:00 강남 코엑스 도착', personOrPlace: '강남 코엑스', addressHint: '서울 강남구 영동대로 513', action: 'arrive', timeHint: '11:00', dateHint: '' },
    { order: 3, rawText: '오후 3시 인천공항 T2 드랍', personOrPlace: '인천공항 T2', addressHint: '', action: 'dropoff', timeHint: '15:00', dateHint: '' },
  ],
  flights: [],
});

const STAGE_FIXTURES = {
  'translate-plan': mockTranslatePlan,
  'mood-parse': () => JSON.stringify(MOOD_PARSE_FIXTURE),
};

const ROLE_FIXTURES = {
  mood: () => JSON.stringify(MOOD_PARSE_FIXTURE),
  quick: () => JSON.stringify({ title: 'Mock quick preview', summary: 'mock', stops: [] }),
  course: () => JSON.stringify({ order: [], suggestions: [] }),
  classifier: () => JSON.stringify({ intent: 'unknown', confidence: 0 }),
  translate: (text) => text,
  chat: () => 'Hello! (mock reply)',
};

function fixtureText(role, stage, request) {
  const userText = typeof request === 'string' ? request : (request?.contents || []).map((c) => (c.parts || []).map((p) => p.text || '').join('')).join('\n');
  if (STAGE_FIXTURES[stage]) return STAGE_FIXTURES[stage](userText);
  if (role === 'main') return JSON.stringify(buildMockPlan({ userText }));
  if (role === 'block') return JSON.stringify(buildMockBlockSelection({ userText }));
  const f = ROLE_FIXTURES[role];
  return f ? f(userText) : '{}';
}

function toResponse(text, promptText) {
  const prompt = Math.max(1, Math.ceil(String(promptText || '').length / 4));
  const output = Math.max(1, Math.ceil(text.length / 4));
  return {
    text: () => text,
    candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: output, cachedContentTokenCount: 0, totalTokenCount: prompt + output },
  };
}

export function createMockModel(config, { role, stage, modelId, onUsage }) {
  const promptOf = (request) => (typeof request === 'string' ? request : JSON.stringify(request || {}));
  async function generateContent(request) {
    const response = toResponse(fixtureText(role, stage, request), promptOf(request));
    onUsage && onUsage(response.usageMetadata, 0);
    return { response };
  }
  async function generateContentStream(request) {
    const response = toResponse(fixtureText(role, stage, request), promptOf(request));
    const text = response.text();
    async function* iterate() {
      for (let i = 0; i < text.length; i += 200) {
        const piece = text.slice(i, i + 200);
        yield { text: () => piece, candidates: [{ content: { role: 'model', parts: [{ text: piece }] } }] };
      }
    }
    onUsage && onUsage(response.usageMetadata, 0);
    return { stream: iterate(), response: Promise.resolve(response) };
  }
  function startChat({ history = [] } = {}) {
    const hist = [...history];
    return {
      async sendMessage(message) {
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        const out = await generateContent({ contents: [...hist, { role: 'user', parts: [{ text }] }] });
        hist.push({ role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: out.response.text() }] });
        return out;
      },
    };
  }
  return { provider: 'mock', modelId, generateContent, generateContentStream, startChat };
}
