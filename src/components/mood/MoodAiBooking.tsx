/**
 * MoodAiBooking — MOOD 일정 붙여넣기 → AI 파싱 → 서비스 더블체크 → 예약 (운영자 전용)
 *
 * 운영자/광고사(MOOD)가 카톡 자유 텍스트 일정을 붙여넣으면:
 *   ① POST /api/mood-parse-schedule 로 장소를 순서대로 추출(주소록 매칭·좌표화·서비스 추천).
 *   ② 추출된 stops 를 리스트로 확인 — geocode 실패 stop 은 🔴 경고 + 주소 직접입력(수정 전 예약 차단).
 *   ③ (좌표 있으면) 지도로 동선 시각 확인 — /api/mood-route 로 실제 경로 선.
 *   ④ 서비스 더블체크(핵심): AI 추천(serviceGuess)을 기본 선택으로 차량/매니저/공항 라디오. 운영자 확정.
 *   ⑤ 날짜·시작시각·이용시간(최소 3h) 입력 → 예상 금액 표시(청구는 서버 SSOT).
 *   ⑥ POST /api/mood-book 로 예약. 성공 시 onBooked() 콜백.
 *
 * 🔴 금액은 표시만 프론트, 실제 청구는 항상 백엔드 재계산(P311). 거리요금/톨비는 예약 시 서버가 반영.
 *
 * 다크 톤(#0a0412 / #181b22, 포인트 #EA537E · #7C5CFC). 운영자 전용이라 한국어 단일.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { MoodRouteMap } from '@/components/MoodRouteMap';
import {
  MOOD_RATES,
  MOOD_MIN_DURATION_HOURS,
  MOOD_MAX_DURATION_HOURS,
  MOOD_FIXED_PRICE_KRW,
  computeMoodTotalKRW,
  formatKRW,
  type MoodServiceType,
} from '@/lib/moodPricing';
import { exceedsWaypointCap, shouldSendRoute } from './moodBookingLogic';

// ── 디자인 토큰 (MoodPortal 과 동일 팔레트: dark navy + purple/pink) ──
const C = {
  card: 'rgba(15,18,32,0.92)',
  cardBorder: '1px solid rgba(124,92,252,0.16)',
  accent: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
  accentSolid: '#B668FC',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.55)',
  danger: '#f87171',
  ok: '#6ee7b7',
  inputBg: 'rgba(124,92,252,0.06)',
  inputBorder: '1px solid rgba(124,92,252,0.18)',
};

/** /api/mood-parse-schedule 응답의 stop 1건. */
interface ParsedStop {
  order: number;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  action: 'pickup' | 'dropoff' | 'via' | 'arrive';
  matchedFromPlacebook: boolean;
  geocodeOk: boolean;
  /** 서버 장소검색(POI) 폴백으로 추정된 좌표 — 지점 확인 유도 배지 (2026-07-04). */
  searchGuessed?: boolean;
}

/** /api/mood-parse-schedule 성공 응답. */
interface ParseResult {
  stops: ParsedStop[];
  serviceGuess: MoodServiceType;
  hasDirector: boolean;
  hasAirport: boolean;
  /** AI 응답이 잘려 부분 회수됨 — 뒤쪽 일정 누락 가능(운영자 원문 대조 필수). */
  truncated?: boolean;
}

/** MoodRouteMap 에 넘기는 경로 데이터 (지도 경로 선용). */
interface RouteData {
  km: number;
  durationMin: number;
  path: [number, number][];
  points: Array<{ lat: number; lng: number; role: 'origin' | 'waypoint' | 'destination'; index?: number }>;
}

const SERVICE_LABEL: Record<MoodServiceType, string> = { vehicle: '차량', airport: '공항', manager: '매니저' };
const SERVICE_ICON: Record<MoodServiceType, string> = { vehicle: '🚗', airport: '✈️', manager: '🧑‍💼' };
const SERVICE_ORDER: MoodServiceType[] = ['vehicle', 'manager', 'airport'];

/** action → 한글 배지 텍스트/색. */
const ACTION_BADGE: Record<ParsedStop['action'], { text: string; bg: string; fg: string }> = {
  pickup: { text: '픽업', bg: 'rgba(34,197,94,0.18)', fg: '#86efac' },
  dropoff: { text: '드롭', bg: 'rgba(239,68,68,0.18)', fg: '#fca5a5' },
  arrive: { text: '도착', bg: 'rgba(124,92,252,0.20)', fg: '#c4b5fd' },
  via: { text: '경유', bg: 'rgba(245,158,11,0.18)', fg: '#fcd34d' },
};

function todayISO(): string {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

interface MoodAiBookingProps {
  clientId: string;
  onBooked: () => void;
}

export function MoodAiBooking({ clientId, onBooked }: MoodAiBookingProps) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  // 파싱된 stops 를 로컬 편집 가능하게 복사 (geocode 실패 주소 직접입력용).
  const [stops, setStops] = useState<ParsedStop[]>([]);
  // 운영자가 직접입력한 주소로 재지오코딩 로딩 상태 (order → boolean).
  const [fixingOrder, setFixingOrder] = useState<number | null>(null);
  // 실패 stop 장소검색(2026-07-04 A-2) — order별 후보 목록
  const [searchHits, setSearchHits] = useState<{ order: number; items: Array<{ name: string; address: string; lat: number; lng: number }> } | null>(null);
  const [searchBusy, setSearchBusy] = useState<number | null>(null);
  // 실도로 경로 조회 결과의 요금 입력값(A-3) — 예상 금액에 거리·톨 반영(청구는 서버 SSOT)
  const [routeKm, setRouteKm] = useState(0);
  const [routeToll, setRouteToll] = useState(0);

  // 서비스 확정 (AI 추천을 기본값으로).
  const [serviceType, setServiceType] = useState<MoodServiceType>('manager');

  // 날짜/시각/시간
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('10:00');
  const [durationHours, setDurationHours] = useState(MOOD_MIN_DURATION_HOURS);

  // 예약 상태
  const [route, setRoute] = useState<RouteData | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookMsg, setBookMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const inputStyle = { background: C.inputBg, border: C.inputBorder, color: C.text } as const;

  const isFixedPrice = serviceType === 'airport';

  // 예상 금액 — 프론트 미러(표시 전용, 청구는 서버 SSOT). 실도로 경로 조회 성공 시 km·톨 반영(A-3).
  const estimate = useMemo(
    () => computeMoodTotalKRW({ serviceType, durationHours, km: routeKm, tollKRW: routeToll }),
    [serviceType, durationHours, routeKm, routeToll],
  );

  // geocode 실패로 예약 차단해야 하는 stop 이 남아 있는지.
  const hasBlockingStop = useMemo(() => stops.some((s) => !s.geocodeOk), [stops]);

  // 파싱 결과가 있고, geocode 성공 stop 이 2개 이상이면 예약 가능(출발·도착 필요).
  const geoStops = useMemo(() => stops.filter((s) => s.geocodeOk && s.lat != null && s.lng != null), [stops]);
  // 경유지(출발·도착 제외 중간 지점)는 네이버 경로 API 최대 5개. 초과 시 거리요금이 조용히
  // 0원(base-only)으로 청구되므로 예약 차단(과소청구 방지). = geoStops 8개 초과.
  const tooManyWaypoints = exceedsWaypointCap(geoStops.length);
  const canBook = result != null && stops.length > 0 && !hasBlockingStop && geoStops.length >= 1 && !tooManyWaypoints;

  // ── 지도용 경로 데이터 구성 (좌표 있는 stops → origin/waypoint/destination) ──
  const buildMapRoute = useCallback((list: ParsedStop[]) => {
    const pts = list.filter((s) => s.geocodeOk && s.lat != null && s.lng != null);
    if (pts.length < 2) return null;
    const points: RouteData['points'] = pts.map((s, i) => ({
      lat: s.lat as number,
      lng: s.lng as number,
      role: i === 0 ? 'origin' : i === pts.length - 1 ? 'destination' : 'waypoint',
      index: i === 0 || i === pts.length - 1 ? undefined : i - 1,
    }));
    return { km: 0, durationMin: 0, path: [] as [number, number][], points };
  }, []);

  // ── 실도로 경로(A-3, 2026-07-04) — 좌표 전부 확보되면 네이버 길찾기(자동차)로
  //    실제 도로 경로선+km·톨 조회. 직선(핀 연결)은 로딩/실패 폴백으로만.
  const routeSeq = useRef(0);
  useEffect(() => {
    const usable = stops.filter((st) => st.geocodeOk && st.lat != null && st.lng != null);
    if (usable.length < 2 || stops.some((st) => !st.geocodeOk)) {
      setRouteKm(0); setRouteToll(0);
      return;
    }
    const seq = ++routeSeq.current;
    const t = window.setTimeout(async () => {
      try {
        const o = (usable[0].address || usable[0].label || '').trim();
        const d = (usable[usable.length - 1].address || usable[usable.length - 1].label || '').trim();
        const wp = usable.slice(1, -1).map((st) => (st.address || st.label || '').trim()).filter(Boolean);
        if (!o || !d) return;
        const params = new URLSearchParams({ origin: o, destination: d });
        if (wp.length) params.set('waypoints', wp.join('|'));
        const res = await authFetch(`/api/mood-route?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (seq !== routeSeq.current) return; // 최신 요청만
        const data = json?.ok ? json.data : null;
        if (data && Array.isArray(data.path) && data.path.length) {
          setRoute({ km: Number(data.km || 0), durationMin: Number(data.durationMin || 0), path: data.path, points: data.points || [] });
          setRouteKm(Number(data.km || 0));
          setRouteToll(Number(data.tollKRW || 0));
        }
      } catch { /* 실패 시 기존 직선 폴백 유지 */ }
    }, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  // ── 장소검색(A-2, 2026-07-04) — 실패 stop 을 수기예약 '🔍 주소'처럼 검색→후보→선택 ──
  const handlePlaceSearch = useCallback(async (order: number, query: string) => {
    const q = query.trim();
    if (q.length < 2) { setBookMsg({ kind: 'err', text: '검색어를 2자 이상 입력하세요.' }); return; }
    setSearchBusy(order);
    setSearchHits(null);
    try {
      const res = await fetch(`/api/place-search?query=${encodeURIComponent(q)}&limit=5&lang=ko`);
      const json = await res.json().catch(() => ({}));
      const items = (Array.isArray(json?.items) ? json.items : [])
        .filter((it: { lat?: number; lng?: number }) => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)))
        .slice(0, 5)
        .map((it: { name?: string; roadAddress?: string; address?: string; lat: number; lng: number }) => ({
          name: String(it.name || ''), address: String(it.roadAddress || it.address || ''), lat: Number(it.lat), lng: Number(it.lng),
        }));
      if (!items.length) { setBookMsg({ kind: 'err', text: '검색 결과가 없습니다 — 다른 이름이나 도로명주소로 시도하세요.' }); return; }
      setSearchHits({ order, items });
    } catch {
      setBookMsg({ kind: 'err', text: '장소 검색 실패 — 잠시 후 다시.' });
    } finally {
      setSearchBusy(null);
    }
  }, []);

  const handlePickPlace = useCallback((order: number, hit: { name: string; address: string; lat: number; lng: number }) => {
    setStops((prev) => prev.map((st) => (st.order === order
      ? { ...st, address: hit.address || hit.name, lat: hit.lat, lng: hit.lng, geocodeOk: true, searchGuessed: false }
      : st)));
    setSearchHits(null);
  }, []);

  // ── ① 일정 분석 ──────────────────────────────────────────
  const handleParse = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      setParseErr('일정 텍스트를 붙여넣어 주세요.');
      return;
    }
    setParsing(true);
    setParseErr(null);
    setBookMsg(null);
    try {
      const res = await authFetch('/api/mood-parse-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setResult(null);
        setStops([]);
        setRoute(null);
        setParseErr(json?.error || `일정 분석 실패 (${res.status})`);
        return;
      }
      const parsedStops: ParsedStop[] = Array.isArray(json.stops) ? json.stops : [];
      const guess: MoodServiceType =
        json.serviceGuess === 'vehicle' || json.serviceGuess === 'airport' ? json.serviceGuess : 'manager';
      setResult({ stops: parsedStops, serviceGuess: guess, hasDirector: !!json.hasDirector, hasAirport: !!json.hasAirport, truncated: !!json.truncated });
      setStops(parsedStops);
      setServiceType(guess); // AI 추천을 기본 선택으로 (운영자가 확정).
      setRoute(buildMapRoute(parsedStops));
      // 첫 stop 시각 힌트로 시작시각 prefill 은 하지 않음(파서는 timeHint 를 stop 응답에 내리지 않음).
    } catch (e) {
      setResult(null);
      setStops([]);
      setRoute(null);
      setParseErr(e instanceof Error ? e.message : '일정 분석 실패');
    } finally {
      setParsing(false);
    }
  }, [text, buildMapRoute]);

  // ── ② geocode 실패 stop 주소 직접입력 반영 ──────────────
  const setStopAddress = useCallback((order: number, address: string) => {
    setStops((prev) => prev.map((s) => (s.order === order ? { ...s, address } : s)));
  }, []);

  // 운영자가 고친 주소를 /api/mood-route 로 지오코딩 검증(출발=도착=같은 주소 트릭)해 좌표 확보.
  const handleFixGeocode = useCallback(
    async (order: number) => {
      const target = stops.find((s) => s.order === order);
      const addr = (target?.address || '').trim();
      if (!addr) {
        setBookMsg({ kind: 'err', text: '주소를 입력한 뒤 확인하세요.' });
        return;
      }
      setFixingOrder(order);
      setBookMsg(null);
      try {
        // mood-route 는 출발·도착이 필요 → 같은 주소를 넣어 좌표(points[0]) 만 회수.
        const params = new URLSearchParams({ origin: addr, destination: addr });
        const res = await authFetch(`/api/mood-route?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        const pt = json?.ok && Array.isArray(json.data?.points) ? json.data.points[0] : null;
        if (pt && Number.isFinite(Number(pt.lat)) && Number.isFinite(Number(pt.lng))) {
          setStops((prev) => {
            const next = prev.map((s) =>
              s.order === order ? { ...s, lat: Number(pt.lat), lng: Number(pt.lng), geocodeOk: true } : s,
            );
            setRoute(buildMapRoute(next));
            return next;
          });
        } else {
          setBookMsg({ kind: 'err', text: '주소를 찾지 못했습니다 — 도로명주소로 다시 입력해 주세요.' });
        }
      } catch (e) {
        setBookMsg({ kind: 'err', text: e instanceof Error ? e.message : '주소 확인 실패' });
      } finally {
        setFixingOrder(null);
      }
    },
    [stops, buildMapRoute],
  );

  // ── ⑥ 예약 ──────────────────────────────────────────────
  const handleBook = useCallback(async () => {
    if (!canBook) return;
    setBooking(true);
    setBookMsg(null);
    try {
      // 좌표 있는 stops = 실제 이동 지점. 첫=출발, 끝=도착, 중간=경유.
      const usable = stops.filter((s) => s.geocodeOk);
      const originStop = usable[0];
      const destStop = usable[usable.length - 1];
      const waypointStops = usable.slice(1, -1);

      const originAddr = (originStop?.address || originStop?.label || '').trim();
      const destAddr = (destStop?.address || destStop?.label || '').trim();
      const waypointAddrs = waypointStops.map((s) => (s.address || s.label || '').trim()).filter(Boolean);

      // 공항(정액)은 거리 계산 없이 정액 청구 → origin/destination 은 참고용으로만 전송.
      const body: Record<string, unknown> = {
        clientId,
        serviceType,
        date,
        startTime,
        durationHours: isFixedPrice ? 0 : durationHours,
      };
      // origin·destination 은 함께 있어야 서버가 거리 재계산 (한쪽만 = 400).
      // ⚠️ 왕복(픽업지=드롭지)이어도 경유지가 있으면 실제 이동거리가 발생하므로 경로를 보낸다.
      //    origin!==dest 조건만 쓰면 '집→관광지→집' 왕복에서 거리요금이 통째로 누락됨(과소청구).
      //    실이동 판정 = 좌표 있는 지점 2곳 이상(usable≥2)이고, (다른 목적지 or 경유지 존재).
      if (shouldSendRoute({ originAddr, destAddr, usableCount: usable.length, waypointCount: waypointAddrs.length })) {
        body.origin = originAddr;
        body.destination = destAddr;
        if (waypointAddrs.length) body.waypoints = waypointAddrs;
      }

      const res = await authFetch('/api/mood-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setBookMsg({
          kind: 'ok',
          text: `예약 완료 — ${formatKRW(json.data.amountKRW)} 차감, 잔액 ${formatKRW(json.data.balanceKRW)}`,
        });
        onBooked();
      } else {
        setBookMsg({ kind: 'err', text: json?.error || `예약 실패 (${res.status})` });
      }
    } catch (e) {
      setBookMsg({ kind: 'err', text: e instanceof Error ? e.message : '예약 실패' });
    } finally {
      setBooking(false);
    }
  }, [canBook, stops, clientId, serviceType, date, startTime, durationHours, isFixedPrice, onBooked]);

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: C.card, border: C.cardBorder }}>
      <div>
        <h2 className="text-sm font-bold" style={{ color: C.text }}>
          AI 일정 예약 <span style={{ color: C.accentSolid }}>✨</span>
        </h2>
        <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
          MOOD 일정을 붙여넣으면 장소·서비스를 자동 인식합니다. 서비스는 예약 전 확정하세요.
        </p>
      </div>

      {/* ① 일정 텍스트 입력 */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'MOOD 일정을 그대로 붙여넣기\n예)\n■ 9:30 이사님 픽업 (인천 강화군 불은면)\n■ 11:00 강남 코엑스 도착\n■ 오후 3시 인천공항 T2 드랍'}
        rows={5}
        className="w-full rounded-xl px-3 py-2.5 text-sm resize-y"
        style={{ ...inputStyle, minHeight: 110 }}
      />
      <button
        type="button"
        onClick={() => { void handleParse(); }}
        disabled={parsing || !text.trim()}
        className="w-full py-3 rounded-xl font-bold transition-all hover:scale-[1.01] disabled:opacity-50"
        style={{ background: C.accent, color: '#fff' }}
      >
        {parsing ? '일정 분석 중…' : '🔍 일정 분석'}
      </button>
      {parseErr && (
        <p className="text-xs" style={{ color: C.danger }}>{parseErr}</p>
      )}

      {/* ② 분석 결과 */}
      {result && (
        <div className="flex flex-col gap-4">
          {/* stops 리스트 */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold" style={{ color: C.textDim }}>
              동선 {stops.length}개 {hasBlockingStop && <span style={{ color: C.danger }}>· 🔴 주소 확인 필요</span>}
              {tooManyWaypoints && <span style={{ color: C.danger }}>· 🔴 경유지 5개 초과 — 일정을 나눠 예약하세요(거리요금 계산 한도)</span>}
            </p>
            {result.truncated && (
              <p className="text-[11px] rounded-lg px-3 py-2" style={{ color: C.danger, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)' }}>
                ⚠️ AI 응답이 잘려 뒤쪽 일정이 빠졌을 수 있습니다 — 원문과 동선 개수를 대조하고, 빠진 곳이 있으면 다시 분석하세요. (누락된 채 예약하면 거리요금이 실제보다 적게 계산됩니다)
              </p>
            )}
            {stops.map((s, i) => {
              const badge = ACTION_BADGE[s.action] || ACTION_BADGE.via;
              return (
                <div
                  key={s.order}
                  className="rounded-xl px-3 py-2.5 flex flex-col gap-1.5"
                  style={{
                    background: C.inputBg,
                    border: s.geocodeOk ? C.inputBorder : '1px solid rgba(248,113,113,0.45)',
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{
                        background: i === 0 ? '#22c55e' : i === stops.length - 1 ? '#ef4444' : C.accentSolid,
                        color: '#fff',
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold truncate" style={{ color: C.text }}>{s.label}</span>
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] font-bold shrink-0"
                          style={{ background: badge.bg, color: badge.fg }}
                        >
                          {badge.text}
                        </span>
                        {s.matchedFromPlacebook && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold shrink-0"
                            style={{ background: 'rgba(124,92,252,0.18)', color: '#c4b5fd' }}
                          >
                            📒 주소록
                          </span>
                        )}
                      </div>
                      {s.address && s.geocodeOk && (
                        <p className="text-[11px] truncate" style={{ color: C.textDim }}>
                          {s.address}
                          {s.searchGuessed && (
                            <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d' }}>
                              🔍 검색추정 — 지점 확인
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* geocode 실패 → 경고 + 주소 직접입력 (수정 전 예약 차단) */}
                  {!s.geocodeOk && (
                    <div className="flex flex-col gap-1.5 pl-7">
                      <p className="text-[11px]" style={{ color: C.danger }}>
                        🔴 주소를 찾지 못했습니다 — 🔍 검색으로 장소를 찾아 선택하세요 (미확인 시 예약 불가).
                      </p>
                      <div className="flex gap-1.5">
                        <input
                          value={s.address}
                          onChange={(e) => setStopAddress(s.order, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handlePlaceSearch(s.order, s.address || s.label); }}
                          placeholder="장소 이름 또는 도로명주소 (예: 트리지움아파트, 테헤란로 …)"
                          className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-xs"
                          style={inputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => { void handlePlaceSearch(s.order, s.address || s.label); }}
                          disabled={searchBusy === s.order}
                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold shrink-0 disabled:opacity-50"
                          style={{ background: C.accent, color: '#fff' }}
                        >
                          {searchBusy === s.order ? '검색 중…' : '🔍 검색'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleFixGeocode(s.order); }}
                          disabled={fixingOrder === s.order || !s.address.trim()}
                          title="입력값이 정확한 도로명주소일 때"
                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold shrink-0 disabled:opacity-50"
                          style={{ background: C.inputBg, border: C.inputBorder, color: C.textDim }}
                        >
                          {fixingOrder === s.order ? '확인 중…' : '주소로 확인'}
                        </button>
                      </div>
                      {searchHits?.order === s.order && (
                        <div className="flex flex-col gap-1 rounded-lg p-1.5" style={{ background: C.inputBg, border: C.inputBorder }}>
                          {searchHits.items.map((hit, hi) => (
                            <button
                              key={hi}
                              type="button"
                              onClick={() => handlePickPlace(s.order, hit)}
                              className="rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-white/[0.06]"
                            >
                              <span className="font-bold" style={{ color: C.text }}>{hit.name}</span>
                              <span className="ml-1.5" style={{ color: C.textDim }}>{hit.address}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ③ 지도 (좌표 성공 stops 로 경로 미니맵 — 키 없으면 링크 폴백) */}
          {geoStops.length >= 2 && (
            <MoodRouteMap
              origin={geoStops[0]?.address || geoStops[0]?.label || ''}
              waypoints={geoStops.slice(1, -1).map((s) => s.address || s.label)}
              destination={geoStops[geoStops.length - 1]?.address || geoStops[geoStops.length - 1]?.label || ''}
              route={route}
              accent={C.accentSolid}
              inputBg={C.inputBg}
              inputBorder={C.inputBorder}
              textDim={C.textDim}
            />
          )}

          {/* ④ 서비스 더블체크 (핵심) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: C.textDim }}>
              서비스 확정 <span className="font-normal">— AI 추천: {SERVICE_LABEL[result.serviceGuess]}</span>
            </span>
            {result.hasAirport && (
              <p className="text-[11px]" style={{ color: '#fcd34d' }}>
                ✈️ 공항 이동이 감지되었습니다 — 공항 서비스가 맞는지 확인하세요.
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {SERVICE_ORDER.map((st) => {
                const active = serviceType === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setServiceType(st)}
                    className="py-3 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: active ? C.accent : C.inputBg,
                      color: active ? '#fff' : C.textDim,
                      border: active ? '1px solid transparent' : C.inputBorder,
                    }}
                  >
                    {SERVICE_ICON[st]} {SERVICE_LABEL[st]}
                    <span className="block text-[10px] font-normal mt-0.5 opacity-80">
                      {st === 'airport'
                        ? `${formatKRW(MOOD_FIXED_PRICE_KRW.airport || 0)} 고정`
                        : `${formatKRW(MOOD_RATES[st])}/시간`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ⑤ 날짜 / 시작시각 / 이용시간 */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>날짜</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-xl px-3 py-2.5 text-sm"
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>시작 시각</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-xl px-3 py-2.5 text-sm"
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </label>
          </div>

          {/* 이용 시간 — 공항은 정액이라 숨김 */}
          {!isFixedPrice && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>
                이용 시간 <span className="opacity-70">· 최소 {MOOD_MIN_DURATION_HOURS}시간</span>
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDurationHours((h) => Math.max(MOOD_MIN_DURATION_HOURS, h - 1))}
                  className="w-10 h-10 rounded-xl text-lg font-bold shrink-0"
                  style={inputStyle}
                  aria-label="시간 감소"
                >
                  −
                </button>
                <input
                  type="number"
                  min={MOOD_MIN_DURATION_HOURS}
                  max={MOOD_MAX_DURATION_HOURS}
                  value={durationHours}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (Number.isFinite(v)) {
                      setDurationHours(Math.min(MOOD_MAX_DURATION_HOURS, Math.max(MOOD_MIN_DURATION_HOURS, v)));
                    }
                  }}
                  className="flex-1 text-center rounded-xl px-3 py-2.5 text-sm"
                  style={inputStyle}
                />
                <span className="text-sm shrink-0" style={{ color: C.textDim }}>시간</span>
                <button
                  type="button"
                  onClick={() => setDurationHours((h) => Math.min(MOOD_MAX_DURATION_HOURS, h + 1))}
                  className="w-10 h-10 rounded-xl text-lg font-bold shrink-0"
                  style={inputStyle}
                  aria-label="시간 증가"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* ⑥ 예상 금액 */}
          <div className="rounded-xl px-3 py-3 flex flex-col gap-1.5" style={{ background: C.inputBg, border: C.inputBorder }}>
            <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
              <span>
                {isFixedPrice
                  ? `${SERVICE_LABEL[serviceType]} (정액)`
                  : `${SERVICE_LABEL[serviceType]} ${durationHours}시간 (${formatKRW(MOOD_RATES[serviceType])}/시간)`}
              </span>
              <span style={{ color: C.text }}>{formatKRW(estimate.baseKRW)}</span>
            </div>
            {estimate.ok && estimate.distanceSurchargeKRW > 0 && (
              <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
                <span>거리 추가요금 ({routeKm.toLocaleString('ko-KR')}km)</span>
                <span style={{ color: C.text }}>+{formatKRW(estimate.distanceSurchargeKRW)}</span>
              </div>
            )}
            {estimate.ok && routeToll > 0 && (
              <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
                <span>톨비(예상)</span>
                <span style={{ color: C.text }}>+{formatKRW(routeToll)}</span>
              </div>
            )}
            <div className="h-px my-0.5" style={{ background: 'rgba(124,92,252,0.18)' }} />
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: C.textDim }}>예상 금액{routeKm > 0 ? ` (${routeKm.toLocaleString('ko-KR')}km 반영)` : ''}</span>
              <span className="text-lg font-bold" style={{ color: C.accentSolid }}>{formatKRW(estimate.amountKRW)}</span>
            </div>
            {!isFixedPrice && (
              <p className="text-[10px]" style={{ color: C.textDim }}>
                * 경로 거리요금·톨비는 예약 시 서버가 자동 반영합니다 (표시는 기본요금 기준).
              </p>
            )}
          </div>

          {/* 예약 버튼 */}
          <button
            type="button"
            onClick={() => { void handleBook(); }}
            disabled={booking || !canBook}
            className="w-full py-3.5 rounded-xl font-bold transition-all hover:scale-[1.01] disabled:opacity-50"
            style={{ background: C.accent, color: '#fff' }}
          >
            {booking ? '예약 중…' : hasBlockingStop ? '🔴 주소 확인 후 예약 가능' : '이대로 예약'}
          </button>
          {bookMsg && (
            <p className="text-xs text-center" style={{ color: bookMsg.kind === 'ok' ? C.ok : C.danger }}>
              {bookMsg.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default MoodAiBooking;
