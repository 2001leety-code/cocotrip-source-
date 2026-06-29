// 인천공항 항공편 도착 조회 — data.go.kr 인천국제공항공사 공공API (무료).
// 고객이 항공편명(예: KE5760) 입력 → 예정 도착시간·터미널·게이트 자동 표시.
// 키 = process.env.AIRPORT_API_KEY (Vercel env, 하드코딩 금지).
// ⚠️ data.go.kr 는 https 가 Forbidden, http 로 호출해야 정상 (서버사이드라 안전).
export const config = { maxDuration: 15 };

const BASE = 'http://apis.data.go.kr/B551177';

// "0040" 또는 "202606290040" → "00:40"
function hhmm(s) {
  const t = String(s || '').slice(-4);
  return /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2)}` : '';
}
// "202606290040" → "2026-06-29"
function ymd(s) {
  const t = String(s || '');
  return t.length >= 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : '';
}
// 인천공항 터미널 코드 → 라벨 (P01=제1터미널, P02/P03=제2/탑승동)
function term(t) {
  const m = { P01: 'T1', P02: 'T2', P03: 'T1-탑승동' };
  return m[String(t || '')] || String(t || '');
}

function mapFlight(x) {
  return {
    flightId: x.flightId || '',
    airline: x.airline || '',
    scheduledTime: hhmm(x.scheduleDateTime),
    estimatedTime: hhmm(x.estimatedDateTime),
    date: ymd(x.scheduleDateTime),
    terminal: term(x.terminalId || x.terminalid),
    gate: x.gatenumber || '',
    carousel: x.carousel || '',
    origin: x.airport || '',
    originCode: x.airportCode || '',
    status: x.remark || '',
  };
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const j = await r.json();
  const code = j?.response?.header?.resultCode;
  if (code && code !== '00') throw new Error(`api ${code}`);
  let items = j?.response?.body?.items;
  if (items && !Array.isArray(items)) items = items.item ? [].concat(items.item) : [items];
  return Array.isArray(items) ? items : [];
}

export default async function handler(req, res) {
  const key = process.env.AIRPORT_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'AIRPORT_API_KEY 미설정' });

  const flightId = String((req.query.flightId || '')).trim().toUpperCase().replace(/\s+/g, '');
  if (!flightId) return res.status(400).json({ ok: false, error: 'flightId 필요' });
  const lang = String(req.query.lang || 'E').toUpperCase();

  try {
    // 1) 당일 다국어 API — 편명 직접 필터 (flight_id 지원)
    const u1 = `${BASE}/StatusOfPassengerFlightsOdp/getPassengerArrivalsOdp`
      + `?serviceKey=${key}&flight_id=${encodeURIComponent(flightId)}`
      + `&type=json&lang=${lang}&numOfRows=10&pageNo=1`;
    const today = await fetchJson(u1);
    if (today.length) {
      return res.status(200).json({ ok: true, found: true, source: 'today', flight: mapFlight(today[0]) });
    }

    // 2) 미래(주간 D+0~D+6) — 편명 필터 미지원이라 ICN 전체 받아 클라이언트 필터
    const u2 = `${BASE}/StatusOfPassengerFlightsDSOdp/getPassengerArrivalsDSOdp`
      + `?serviceKey=${key}&airport=ICN&type=json&numOfRows=3000&pageNo=1`;
    const weekly = await fetchJson(u2);
    const hit = weekly.find((x) => String(x.flightId || '').toUpperCase() === flightId);
    if (hit) {
      return res.status(200).json({ ok: true, found: true, source: 'weekly', flight: mapFlight(hit) });
    }

    return res.status(200).json({ ok: true, found: false, flight: null });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e && e.message || e).slice(0, 160) });
  }
}
