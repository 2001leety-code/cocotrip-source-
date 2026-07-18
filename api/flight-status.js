// 인천공항 항공편 도착 조회 — data.go.kr 인천국제공항공사 공공API (무료).
// 고객이 항공편명(예: KE5760) 입력 → 예정 도착시간·터미널·게이트 자동 표시.
// 키 = process.env.AIRPORT_API_KEY (Vercel env, 하드코딩 금지).
// ⚠️ data.go.kr 는 https 가 Forbidden, http 로 호출해야 정상 (서버사이드라 안전).
//
// 🔧 2026-07-18 검색 미작동 fix (차터 전체점검):
//   1) 편명 정규화 — 공항 데이터 canonical 은 3자리 zero-pad(KE082, LO097)인데 구글/항공권 표기는
//      KE82·KE 82·KE0082 등 제각각 → 완전일치라 영원히 miss (prod 실증 KE82/KE0082/LO97 전부 실패).
//      canonicalFlightId 로 양쪽(입력·응답) 동일 정규화.
//   2) 예약일(date) 전달 — 미래편 API(DSOdp)는 조회일 기준 D+0~D+6 창 한정 + 날짜 파라미터 미지원.
//      창 밖 예약(차터는 통상 1주+ 전)은 조회 자체가 불가능한데 "편명 없음"으로 위장되던 것을
//      reason:'beyond_window' 로 정직하게 구분. 같은 편명이 창 내 여러 날 운항 시 예약일 인스턴스 우선.
//      매일 운항편이 '오늘' 인스턴스(오늘의 지연·게이트)로 미래 예약을 하이재킹하던 문제도 date 로 차단.
//   3) 실패 사유 구분 — not_found / beyond_window / past_date + HTTP 500(키)·502(upstream).
export const config = { maxDuration: 15 };

const BASE = 'http://apis.data.go.kr/B551177';

// 편명 canonical 정규화 — 캐리어코드(2자리, 영숫자 혼용 허용) + 숫자부(선행 0 제거 후 3자리
// zero-pad, 4자리는 그대로) + 선택 접미문자. 비표준 입력은 원문(공백 제거) 유지.
//   KE82 · KE 82 · KE0082 → KE082 / LO97 → LO097 / KE5760 → KE5760 / 7C1403 → 7C1403
export function canonicalFlightId(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '');
  const m = s.match(/^([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])0*([0-9]{1,4})([A-Z]?)$/);
  if (!m) return s;
  const digits = m[2];
  const padded = digits.length >= 4 ? digits : digits.padStart(3, '0');
  return m[1] + padded + m[3];
}

// KST 기준 오늘 (YYYY-MM-DD) — 서버 TZ 무관.
export function kstTodayYmd(nowMs) {
  const ms = typeof nowMs === 'number' ? nowMs : Date.now();
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDaysYmd(ymdStr, n) {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 예약일 vs 조회창(D+0~D+6) 판정 — 'past' | 'beyond' | 'in_window'
export function classifyDate(date, today) {
  if (date < today) return 'past';
  if (date > addDaysYmd(today, 6)) return 'beyond';
  return 'in_window';
}

// "0040" 또는 "202606290040" → "00:40"
function hhmm(s) {
  const t = String(s || '').slice(-4);
  return /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2)}` : '';
}
// "202606290040" → "2026-06-29"
function ymd(s) {
  const t = String(s || '');
  return t.length >= 8 && /^\d{8}/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : '';
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
  const code = j && j.response && j.response.header && j.response.header.resultCode;
  if (code && code !== '00') throw new Error(`api ${code}`);
  let items = j && j.response && j.response.body && j.response.body.items;
  if (items && !Array.isArray(items)) items = items.item ? [].concat(items.item) : [items];
  return Array.isArray(items) ? items : [];
}

export default async function handler(req, res) {
  const key = process.env.AIRPORT_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'AIRPORT_API_KEY 미설정' });

  const flightId = canonicalFlightId(req.query.flightId);
  if (!flightId) return res.status(400).json({ ok: false, error: 'flightId 필요' });
  const lang = String(req.query.lang || 'E').toUpperCase();

  // 예약일 (선택, YYYY-MM-DD) — 프론트 Step5 가 state.startDate 전달. 창 밖이면 API 호출 없이
  // 정직 반환 (무료키 일일쿼터 절약 + "편명 없음" 오답 방지).
  const dateRaw = String(req.query.date || '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  const today = kstTodayYmd();
  if (date) {
    const cls = classifyDate(date, today);
    if (cls === 'past') return res.status(200).json({ ok: true, found: false, flight: null, reason: 'past_date' });
    if (cls === 'beyond') {
      return res.status(200).json({
        ok: true, found: false, flight: null, reason: 'beyond_window',
        availableFrom: addDaysYmd(date, -6), // 이 날짜부터 자동조회 가능
      });
    }
  }

  try {
    // 1) 당일 다국어 API — 편명 직접 필터 (flight_id 지원). 예약일이 오늘이 아니면 건너뜀 —
    //    매일 운항편의 '오늘' 인스턴스(오늘 지연·게이트)가 미래 예약 정보를 하이재킹하는 것 방지.
    if (!date || date === today) {
      const u1 = `${BASE}/StatusOfPassengerFlightsOdp/getPassengerArrivalsOdp`
        + `?serviceKey=${key}&flight_id=${encodeURIComponent(flightId)}`
        + `&type=json&lang=${lang}&numOfRows=10&pageNo=1`;
      const todayRows = await fetchJson(u1);
      if (todayRows.length) {
        return res.status(200).json({ ok: true, found: true, source: 'today', flight: mapFlight(todayRows[0]) });
      }
    }

    // 2) 미래(주간 D+0~D+6) — 편명·날짜 필터 미지원(공식문서 15095074: 요청변수 airport_code/type/
    //    serviceKey 뿐)이라 ICN 전체 받아 서버 필터. 응답 flightId 도 canonical 정규화 후 비교.
    const u2 = `${BASE}/StatusOfPassengerFlightsDSOdp/getPassengerArrivalsDSOdp`
      + `?serviceKey=${key}&airport=ICN&type=json&numOfRows=3000&pageNo=1`;
    const weekly = await fetchJson(u2);
    const matches = weekly.filter((x) => canonicalFlightId(x.flightId) === flightId);
    // 예약일 지정 시 그 날짜 인스턴스 우선 — 같은 편명이 창 내 여러 날 운항하는 케이스(prod 실증
    // LO097: 7/22·23·24)에서 무조건 최초 인스턴스를 주던 오답 방지. 미지정 시 기존처럼 최초.
    const hit = date
      ? (matches.find((x) => ymd(x.scheduleDateTime) === date) || null)
      : (matches[0] || null);
    if (hit) {
      return res.status(200).json({ ok: true, found: true, source: 'weekly', flight: mapFlight(hit) });
    }

    return res.status(200).json({ ok: true, found: false, flight: null, reason: 'not_found' });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 160) });
  }
}
