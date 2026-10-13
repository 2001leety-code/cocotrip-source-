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

function foodRows(city, diets) {
  const trusted = diets.length ? getExactCityTrustedDietaryCandidates(city, diets, 12).map((c) => c.row) : [];
  const general = diets.length ? [] : getExactCityGeneralFoodCandidates(city, 12);
  const rows = trusted.length ? trusted : general;
  return rows.length ? rows : [{ name: `${CITY_NAME[city] || city} Local Restaurant`, address: `${CITY_NAME[city] || city}` }];
}

function foodStop(row, time, order) {
  return {
    order, start_time: time, name: row.name, display_name: row.nameEn || row.name, category: 'food',
    address: row.address || '', lat: row.lat, lng: row.lng, stay_min: 60, tip: 'mock',
    ...(row.tag && row.tag !== 'general' ? { dietary_tags: [row.tag] } : {}),
  };
}

/**
 * @param {{userText:string}} p user 메시지(끝에 userInput JSON) → 검증기 통과형 플랜.
 */
export function buildMockPlan({ userText }) {
  const u = lastJsonObject(userText) || {};
  const days = Math.max(1, Math.min(14, Number(u.duration_days) || 1));
  const city = String((Array.isArray(u.regions) && u.regions[0]) || u.area || 'seoul').toLowerCase();
  const cityName = CITY_NAME[city] || city;
  const diets = (Array.isArray(u.diet_preferences) ? u.diet_preferences : []).map((d) => String(d).toLowerCase()).filter((d) => ['halal', 'vegan', 'vegetarian'].includes(d));
  const foods = foodRows(city, diets);
  const spots = getExactCitySpotCandidates(city);
  const arrCode = String(u.arrival_airport || 'ICN').split('_')[0];
  const depCode = String(u.departure_airport || arrCode).split('_')[0];
  const arrName = AIRPORT_NAME[arrCode] || `${arrCode} Airport`;
  const depName = AIRPORT_NAME[depCode] || `${depCode} Airport`;
  const lodging = { name: `${cityName} Mock Hotel`, category: 'lodging', address: `${cityName}`, stay_min: 0 };

  let fi = 0; let si = 0;
  const nextFood = () => foods[fi++ % foods.length];
  const nextSpot = () => {
    const s = spots[si++ % Math.max(1, spots.length)];
    return s ? { name: s.name.en || s.name.ko, display_name: s.name.en || s.name.ko, address: s.address, category: 'culture' }
      : { name: `${cityName} Landmark`, category: 'culture', address: cityName };
  };

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
    const isLast = d === days;
    const stops = [
      { ...lodging, order: 1, start_time: '08:30' },
      { ...nextSpot(), order: 2, start_time: '10:00', stay_min: 90 },
      foodStop(nextFood(), '12:00', 3),
      { ...nextSpot(), order: 4, start_time: '14:30', stay_min: 90 },
      foodStop(nextFood(), '18:00', 5),
      isLast && days > 1
        ? { order: 6, start_time: '20:00', name: depName, category: 'airport', address: depName, stay_min: 0 }
        : { ...lodging, order: 6, start_time: '20:30' },
    ];
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

const ROLE_FIXTURES = {
  quick: () => JSON.stringify({ title: 'Mock quick preview', summary: 'mock', stops: [] }),
  course: () => JSON.stringify({ order: [], suggestions: [] }),
  classifier: () => JSON.stringify({ intent: 'unknown', confidence: 0 }),
  translate: (text) => text,
  chat: () => 'Hello! (mock reply)',
};

function fixtureText(role, request) {
  const userText = typeof request === 'string' ? request : (request?.contents || []).map((c) => (c.parts || []).map((p) => p.text || '').join('')).join('\n');
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

export function createMockModel(config, { role, modelId, onUsage }) {
  const promptOf = (request) => (typeof request === 'string' ? request : JSON.stringify(request || {}));
  async function generateContent(request) {
    const response = toResponse(fixtureText(role, request), promptOf(request));
    onUsage && onUsage(response.usageMetadata, 0);
    return { response };
  }
  async function generateContentStream(request) {
    const response = toResponse(fixtureText(role, request), promptOf(request));
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
