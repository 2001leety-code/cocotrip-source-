/**
 * POST /api/course-ai — 코스 빌더 "AI 동선 최적화 + 주변 추천" (2026-07-05)
 *
 * 사용자가 직접 넣은 장소(좌표 포함)를 받아:
 *   ① 방문 순서를 이동 동선이 자연스럽게 재배치 (좌표 근접 + 맥락: 식당은 식사시간대,
 *      숙소는 마지막). ② 근처에 안 넣은 가볼 만한 곳 3~5개 추천(좌표 포함).
 *
 * 인증 없음(플래너 공개 기능) — 대신 입력 상한(장소 20개)과 좌표 유효성으로 남용 방어.
 * Gemini 실패 시 fail-soft: 순서는 최근접 이웃(nearest-neighbor) 순수계산으로 폴백,
 * 추천은 빈 배열. 500 대신 { ok:false, code } 구조화 에러(프론트가 조용히 무시 가능).
 *
 * ⚠️ api/_food_index.json 임포트 금지(CLAUDE.md B-1) — 주변 추천은 Gemini 지식으로만.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// 공개 기능(플래너) — place-search 와 동일한 개방 CORS(인증 없음, 좌표·상한으로 남용 방어).
const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const MAX_STOPS = 20;

const SYSTEM_PROMPT = `You optimize a one-day Korea travel course.
Input: an ordered list of stops the user picked, each with id, name, category (food/sight/show/stay/etc), and lat/lng.

TASKS:
1. Reorder stops into a natural travel route: minimize back-and-forth by geography (lat/lng),
   but respect context — meals(food) around lunch/dinner, a hotel(stay) goes last, a show at its likely time.
2. Suggest 3-5 nearby places the user did NOT include, that fit the area and theme. Real, well-known Korea places only.
   Give approximate lat/lng. Do NOT invent obscure spots.

Return STRICT JSON only, no markdown:
{
  "optimizedOrder": ["<stop id in new order>", ...],   // MUST contain exactly the input ids, no more, no less
  "nearby": [ { "name": "<place name>", "lat": 37.5, "lng": 127.0, "category": "food|sight|show|stay|etc", "reason": "<short why, in the user's language>" } ]
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
    }))
    .filter((s) => s.id && s.title);
  const lang = ['ko', 'en', 'ja', 'zh'].includes(body.lang) ? body.lang : 'en';

  if (stops.length < 2) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '장소가 2곳 이상이어야 합니다', code: 'TOO_FEW_STOPS' }));
  }

  const apiKey = process.env.GEMINI_API_KEY || '';
  const fallbackOrder = nearestNeighborOrder(stops);

  if (!apiKey) {
    // 키 없으면 순수계산 순서만 (추천 없음)
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, optimizedOrder: fallbackOrder, nearby: [], source: 'nn' }));
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const userPayload = {
      language: lang,
      stops: stops.map((s) => ({ id: s.id, name: s.title, category: s.category, lat: s.lat, lng: s.lng })),
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
    const raw = result.response.text() || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    // optimizedOrder 정합성 — 입력 id 집합과 동일해야(손실/추가 방지). 아니면 폴백.
    const inputIds = new Set(stops.map((s) => s.id));
    let order = Array.isArray(parsed?.optimizedOrder) ? parsed.optimizedOrder.map(String) : [];
    const orderSet = new Set(order);
    const valid = order.length === stops.length
      && order.every((id) => inputIds.has(id))
      && orderSet.size === stops.length;
    if (!valid) order = fallbackOrder;

    // nearby 정제 — 좌표 유효 + 한국 범위 + 상한 5.
    const nearby = (Array.isArray(parsed?.nearby) ? parsed.nearby : [])
      .map((n) => ({
        name: String(n?.name || '').slice(0, 80),
        lat: Number(n?.lat),
        lng: Number(n?.lng),
        category: ['food', 'sight', 'show', 'stay', 'etc'].includes(n?.category) ? n.category : 'sight',
        reason: String(n?.reason || '').slice(0, 120),
      }))
      .filter((n) => n.name && Number.isFinite(n.lat) && Number.isFinite(n.lng)
        && n.lat >= 33 && n.lat <= 39 && n.lng >= 124 && n.lng <= 132)
      .slice(0, 5);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, optimizedOrder: order, nearby, source: valid ? 'ai' : 'nn' }));
  } catch (e) {
    console.warn('[course-ai] Gemini 실패 → 폴백:', e.message);
    await captureError(e, { route: '/api/course-ai' });
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, optimizedOrder: fallbackOrder, nearby: [], source: 'nn' }));
  }
}
