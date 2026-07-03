/**
 * MoodPortal — MOOD B2B 선불 예약 포털 (숨은 /mood 모듈)
 *
 * 운영자 MOOD brand consulting (매니저업) 이 광고사에 시급 매니저/차량 제공.
 * 광고사가 선불 충전 후 예약마다 잔액 차감. (외상 = 잔액 음수 허용 정책)
 *
 * 🔒 고객 노출 금지: 공개 네비/링크/프리렌더에 절대 추가 안 함. 접근은
 *    로그인 + mood_config/allowlist 게이트로만. 비-allowlist 사용자는 "접근 권한 없음".
 *
 * 모바일 퍼스트 (운영자가 모바일로 더 많이 씀). 한 화면: 잔액 카드 / 예약 폼 /
 * 차감 내역(ledger) / (admin) 충전. 디자인: dark navy + purple/pink gradient.
 *
 * 인증: Firebase auth + ID 토큰을 authFetch 가 Authorization: Bearer 로 첨부.
 *
 * 💰 가격: 출발지/경유지(선택)/도착지 주소 입력 → /api/mood-route 가 네이버
 *    Directions 로 km/톨비 계산 → computeMoodTotalKRW 로 예상 금액 분해 표시
 *    (시급×시간 + 거리추가(50km↑) + 톨비). 🔴 실제 청구는 백엔드 재계산(P311).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';
import { authFetch } from '@/lib/authFetch';
import { openDaumPostcode } from '@/lib/daumPostcode';
import { signalAppReady } from '@/lib/appReady';
import { maxConcurrentCount } from '@/lib/moodOverlap';
import { MoodRouteMap } from '@/components/MoodRouteMap';
import { MoodAiBooking } from '@/components/mood/MoodAiBooking';
import { MoodReceiptModal } from '@/components/mood/MoodReceiptModal';
import {
  MOOD_RATES,
  MOOD_MAX_DURATION_HOURS,
  MOOD_MIN_DURATION_HOURS,
  MOOD_FIXED_PRICE_KRW,
  computeMoodTotalKRW,
  formatKRW,
  type MoodServiceType,
} from '@/lib/moodPricing';

// ── 디자인 토큰 (DESIGN.md: dark navy + purple/pink gradient) ──────────
const C = {
  bgGradient: 'linear-gradient(160deg, #0a0412 0%, #0d0618 55%, #080210 100%)',
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

/** 예약 doc 의 금액 분해 (백엔드 mood-data 가 breakdown 으로 저장/반환). */
interface MoodBreakdown {
  baseKRW?: number;
  distanceSurchargeKRW?: number;
  tollKRW?: number;
  km?: number;
  origin?: string;
  destination?: string;
  waypoints?: string[] | null;
}

interface MoodBooking {
  id: string;
  date: string;
  startTime: string;
  durationHours: number;
  serviceType: MoodServiceType;
  amountKRW: number;
  status: string;
  createdByEmail: string;
  createdAt: number;
  breakdown?: MoodBreakdown;
  /** 운행 종료 정산(status='completed') 시 채워짐. */
  actualHours?: number | null;
  finalAmountKRW?: number | null;
  adjustmentKRW?: number | null;
  /** 이 예약 직후 잔액 (백엔드 mood-data 가 내려줌). 레거시 예약은 null = 화면 미표시. */
  runningBalanceKRW?: number | null;
}

interface MoodData {
  clientId: string;
  client: { name: string; balanceKRW: number };
  bookings: MoodBooking[];
  isAdmin: boolean;
}

type LedgerTab = 'today' | 'upcoming' | 'settle' | 'calendar' | 'all';

/** 상단 3-탭 — 현황 / 수기 예약 / AI 예약. */
type PortalTab = 'status' | 'manual' | 'ai';

/** 경로 마커 좌표 (출발/경유/도착) — 지도 핀용. */
interface MoodRoutePoint {
  lat: number;
  lng: number;
  role: 'origin' | 'waypoint' | 'destination';
  index?: number;
}
/** /api/mood-route 응답 (계약: { ok, data:{ km, tollKRW, durationMin, path, points } } | { ok:false, error }). */
interface MoodRoute {
  km: number;
  tollKRW: number;
  durationMin: number;
  path: [number, number][]; // 경로 선 좌표 [[lng,lat],...] — 지도에 실제 경로 그리기용
  points: MoodRoutePoint[]; // 출발/경유/도착 마커
}

const SERVICE_LABEL: Record<MoodServiceType, string> = {
  vehicle: '차량',
  airport: '공항',
  manager: '매니저',
};

function todayISO(): string {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

function monthKeyFromISO(iso: string): string {
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : todayISO().slice(0, 7);
}

function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonthGrid(monthKey: string): Array<{ iso: string; day: number; inMonth: boolean }> {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { iso, day: d.getDate(), inMonth: d.getMonth() === month - 1 };
  });
}

/** 음수 잔액은 빨강 마이너스로 — "-123,000원". */
function formatBalance(n: number): string {
  const v = Math.round(Number(n) || 0);
  if (v < 0) return `-${Math.abs(v).toLocaleString('ko-KR')}원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

function cleanStops(bd?: MoodBreakdown | null): string[] {
  if (!bd) return [];
  return [
    bd.origin,
    ...(Array.isArray(bd.waypoints) ? bd.waypoints : []),
    bd.destination,
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

function routeTextFromBreakdown(bd?: MoodBreakdown | null): string | null {
  const stops = cleanStops(bd);
  return stops.length >= 2 ? stops.join(' → ') : null;
}

function googleDirectionsUrl(bd?: MoodBreakdown | null): string {
  const stops = cleanStops(bd);
  if (stops.length >= 2) {
    const params = new URLSearchParams({
      api: '1',
      origin: stops[0],
      destination: stops[stops.length - 1],
      travelmode: 'driving',
    });
    if (stops.length > 2) params.set('waypoints', stops.slice(1, -1).join('|'));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }
  const target = stops[0] || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
}

function naverDirectionsUrl(bd?: MoodBreakdown | null): string {
  const target = cleanStops(bd).join(' ') || '';
  return `https://map.naver.com/p/search/${encodeURIComponent(target)}`;
}

export default function MoodPortal() {
  const { user, loading } = useAuth();

  const [data, setData] = useState<MoodData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  // 상단 3-탭 (현황 / 수기 예약 / AI 예약)
  const [portalTab, setPortalTab] = useState<PortalTab>('status');
  // 예약 항목 클릭 시 영수증 모달 대상 (완료/일반 공용)
  const [selectedBooking, setSelectedBooking] = useState<MoodBooking | null>(null);

  // 예약 폼 상태
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('10:00');
  const [durationHours, setDurationHours] = useState(3); // 차량/매니저 최소 3시간
  const [serviceType, setServiceType] = useState<MoodServiceType>('manager');
  const [airportDirection, setAirportDirection] = useState<'pickup' | 'sending'>('pickup');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 경로(주소) 입력 상태 — 경유지는 네이버 지도처럼 개별 추가/삭제(최대 5, 백엔드 한도).
  const [origin, setOrigin] = useState('');
  const [waypoints, setWaypoints] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  const [route, setRoute] = useState<MoodRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const routeSeq = useRef(0); // 경합 방지 — 최신 요청만 반영

  // 운영용 예약 리스트 상태
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>('today');
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(monthKeyFromISO(todayISO()));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(todayISO());

  // (충전 폼·광고사 만들기 폼은 어드민 전용 → /mood 에서 제거. 어드민 관리자 화면으로 이관.)

  // 운행 종료 정산 상태 (admin) — settleId = 입력칸 열린 예약 id
  const [settleId, setSettleId] = useState<string | null>(null);
  const [settleHours, setSettleHours] = useState('');
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // 정산 시 추가 방문지(실제 경로) — 정확한 거리 재측정용. 예약 경로로 prefill 후 매니저가 수정/추가.
  const [settleOrigin, setSettleOrigin] = useState('');
  const [settleWaypoints, setSettleWaypoints] = useState<string[]>([]);
  const [settleDestination, setSettleDestination] = useState('');

  // 예상 금액 분해 — base + 거리추가 + 톨비. 경로 없으면 거리/톨비 0 (base 만).
  const breakdown = useMemo(
    () =>
      computeMoodTotalKRW({
        serviceType,
        durationHours,
        km: route?.km || 0,
        tollKRW: route?.tollKRW || 0,
      }),
    [serviceType, durationHours, route],
  );
  const estimate = breakdown.amountKRW;

  const loadData = useCallback(async (clientId?: string) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await authFetch(`/api/mood-data${qs}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setForbidden(true);
        setData(null);
        return;
      }
      if (!json?.ok) {
        setDataError(json?.error || `조회 실패 (${res.status})`);
        return;
      }
      setForbidden(false);
      setData(json.data as MoodData);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    // 로그인 시 1회 데이터 로드 — loadData 내부 setState 는 의도된 fetch-on-mount 패턴.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) loadData();
  }, [user, loadData]);

  // ── 경로 조회 (디바운스) — 출발+도착 둘 다 있을 때만 /api/mood-route ──
  // 모든 setState 는 디바운스 timeout 안에서만 호출(이펙트 본문 동기 setState 회피 →
  // cascading render 방지). 입력이 비면 timeout 에서 route 상태를 비운다.
  useEffect(() => {
    const o = origin.trim();
    const d = destination.trim();
    const seq = ++routeSeq.current;
    const t = setTimeout(async () => {
      if (seq !== routeSeq.current) return;
      // 공항=정액이라 거리계산 불필요 → 스킵(경로 표시도 숨김).
      if (!o || !d || serviceType === 'airport') {
        setRoute(null);
        setRouteError(null);
        setRouteLoading(false);
        return;
      }
      setRouteLoading(true);
      setRouteError(null);
      try {
        const params = new URLSearchParams({ origin: o, destination: d });
        const wp = waypoints
          .map((s) => s.trim())
          .filter(Boolean)
          .join('|');
        if (wp) params.set('waypoints', wp);
        const res = await authFetch(`/api/mood-route?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (seq !== routeSeq.current) return; // 더 최신 요청이 있으면 폐기
        if (json?.ok) {
          // 백엔드 응답은 { ok, data:{ km, tollKRW, durationMin } } 중첩 — data 에서 읽는다.
          const dd = json.data || {};
          setRoute({
            km: Number(dd.km) || 0,
            tollKRW: Number(dd.tollKRW) || 0,
            durationMin: Number(dd.durationMin) || 0,
            path: Array.isArray(dd.path) ? dd.path : [],
            points: Array.isArray(dd.points) ? dd.points : [],
          });
          setRouteError(null);
        } else {
          setRoute(null);
          setRouteError(json?.error || `경로 조회 실패 (${res.status})`);
        }
      } catch (e) {
        if (seq !== routeSeq.current) return;
        setRoute(null);
        setRouteError(e instanceof Error ? e.message : '경로 조회 실패');
      } finally {
        if (seq === routeSeq.current) setRouteLoading(false);
      }
    }, o && d ? 600 : 0);
    return () => clearTimeout(t);
  }, [origin, waypoints, destination, serviceType]);

  const handleBook = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setFormMsg(null);
    try {
      const wp = waypoints
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await authFetch('/api/mood-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: data.clientId,
          date,
          startTime,
          durationHours,
          serviceType,
          // 주소 — 백엔드가 km/톨비 재계산해 잔액 차감 (클라 금액 무시, P311).
          origin: origin.trim() || undefined,
          destination: destination.trim() || undefined,
          waypoints: wp.length ? wp : undefined,
          airportDirection: serviceType === 'airport' ? airportDirection : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setFormMsg({
          kind: 'ok',
          text: `예약 완료 — ${formatKRW(json.data.amountKRW)} 차감, 잔액 ${formatBalance(json.data.balanceKRW)}`,
        });
        await loadData(data.clientId);
      } else {
        setFormMsg({ kind: 'err', text: json?.error || `예약 실패 (${res.status})` });
      }
    } catch (e) {
      setFormMsg({ kind: 'err', text: e instanceof Error ? e.message : '예약 실패' });
    } finally {
      setSubmitting(false);
    }
  }, [data, date, startTime, durationHours, serviceType, airportDirection, origin, destination, waypoints, loadData]);

  // (충전/광고사 생성 핸들러는 어드민 전용 → /mood 에서 제거. 어드민 관리자 화면으로 이관.)

  // 운행 종료 정산 — 실제 시간 + (추가 방문지로) 실제 거리 재측정 → 최종 금액·잔액 조정 + 영수증.
  const handleSettle = useCallback(async (bookingId: string) => {
    const hours = Number(settleHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setSettleMsg({ kind: 'err', text: '실제 시간을 입력하세요' });
      return;
    }
    // 실제 경로 — 출발·도착이 둘 다 있을 때만 백엔드가 Naver 로 거리 재측정. 경유지는 빈 칸 제외.
    const o = settleOrigin.trim();
    const d = settleDestination.trim();
    const wp = settleWaypoints.map((s) => s.trim()).filter(Boolean);
    const routePayload = o && d ? { origin: o, destination: d, waypoints: wp } : {};
    setSettling(true);
    setSettleMsg(null);
    try {
      const res = await authFetch('/api/mood-settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, actualHours: hours, ...routePayload }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        const adj = json.data.adjustmentKRW;
        const adjTxt = adj > 0 ? `추가 ${formatKRW(adj)}` : adj < 0 ? `환원 ${formatKRW(-adj)}` : '조정 없음';
        const kmTxt = json.data.routeRecomputed ? ` · 거리 ${json.data.km}km 재측정` : '';
        setSettleMsg({ kind: 'ok', text: `정산 완료 — 최종 ${formatKRW(json.data.finalAmountKRW)} (${adjTxt})${kmTxt}` });
        setSettleId(null);
        setSettleHours('');
        setSettleOrigin('');
        setSettleDestination('');
        setSettleWaypoints([]);
        await loadData(data?.clientId);
      } else {
        setSettleMsg({ kind: 'err', text: json?.error || `정산 실패 (${res.status})` });
      }
    } catch (e) {
      setSettleMsg({ kind: 'err', text: e instanceof Error ? e.message : '정산 실패' });
    } finally {
      setSettling(false);
    }
  }, [settleHours, settleOrigin, settleDestination, settleWaypoints, data, loadData]);

  // ── 정산 경유지 배열 조작 (예약 폼과 동일 규칙, 최대 5 = 백엔드 한도) ──
  const addSettleWaypoint = useCallback(() => {
    setSettleWaypoints((w) => (w.length >= 5 ? w : [...w, '']));
  }, []);
  const removeSettleWaypoint = useCallback((i: number) => {
    setSettleWaypoints((w) => w.filter((_, idx) => idx !== i));
  }, []);
  const setSettleWaypointAt = useCallback((i: number, val: string) => {
    setSettleWaypoints((w) => w.map((x, idx) => (idx === i ? val : x)));
  }, []);

  // ── 경유지 배열 조작 (네이버 지도식 추가/삭제, 최대 5 = 백엔드 한도) ──
  // ⚠️ 훅은 반드시 아래 early-return 게이트보다 위에서 호출 (rules-of-hooks:
  //    게이트 아래 두면 loading/미로그인 렌더 땐 안 불려 "더 많은 훅" 크래시).
  const addWaypoint = useCallback(() => {
    setWaypoints((w) => (w.length >= 5 ? w : [...w, '']));
  }, []);
  const removeWaypoint = useCallback((i: number) => {
    setWaypoints((w) => w.filter((_, idx) => idx !== i));
  }, []);
  const setWaypointAt = useCallback((i: number, val: string) => {
    setWaypoints((w) => w.map((x, idx) => (idx === i ? val : x)));
  }, []);

  const copyBookingToForm = useCallback((b: MoodBooking) => {
    const bd = b.breakdown || {};
    setServiceType(b.serviceType);
    setDate(b.date || todayISO());
    setStartTime(b.startTime || '10:00');
    setDurationHours(Math.max(MOOD_MIN_DURATION_HOURS, Number(b.durationHours) || MOOD_MIN_DURATION_HOURS));
    setOrigin(bd.origin || '');
    setDestination(bd.destination || '');
    setWaypoints(Array.isArray(bd.waypoints) ? bd.waypoints.filter(Boolean) : []);
    setFormMsg({ kind: 'ok', text: '예약 폼에 복사했습니다. 날짜와 시간을 확인하세요.' });
    setPortalTab('manual'); // 예약 폼이 수기 예약 탭으로 이동 — 복사 시 해당 탭으로 전환
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 다음 우편번호 팝업 → 선택 주소를 콜백으로 적용. 로드 실패/취소는 무시(수동 입력 가능).
  const searchAddress = useCallback(async (apply: (addr: string) => void) => {
    try {
      const addr = await openDaumPostcode();
      if (addr) apply(addr);
    } catch {
      // 스크립트 로드 실패 — 수동 입력으로 진행
    }
  }, []);

  // PWA 실행 스플래시 페이드아웃 — 인증 끝나 포털/로그인 화면이 그려질 때 신호(무드 standalone 진입점).
  // (인증 대기 중엔 스플래시가 유지되어 "검정 갭" 을 가린다. 훅은 게이트보다 위 = rules-of-hooks.)
  // 더블 rAF: effect 시점엔 아직 페인트 전일 수 있음 — 다음 프레임이 실제로 그려진 뒤 신호해야
  // 스플래시가 걷힐 때 밑에 로딩 스피너/빈 화면이 안 보임 (2026-07-03 smoothness handoff).
  useEffect(() => {
    if (loading) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => signalAppReady());
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [loading]);

  // ── 로딩 / 미로그인 / 권한없음 게이트 ─────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bgGradient }}>
        <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: C.accentSolid, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: C.bgGradient }}>
        <div className="w-full max-w-sm rounded-2xl p-8 text-center" style={{ background: C.card, border: C.cardBorder }}>
          <h1 className="text-xl font-bold mb-2" style={{ color: C.text }}>MOOD 포털</h1>
          <p className="text-sm mb-6" style={{ color: C.textDim }}>로그인이 필요합니다.</p>
          <button
            onClick={() => { void signInWithGoogle(); }}
            className="w-full py-3.5 rounded-xl font-bold transition-all hover:scale-[1.02]"
            style={{ background: '#fff', color: '#1a1a2e' }}
          >
            구글로 로그인
          </button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: C.bgGradient }}>
        <div className="w-full max-w-sm rounded-2xl p-8 text-center" style={{ background: C.card, border: C.cardBorder }}>
          <h1 className="text-xl font-bold mb-2" style={{ color: C.text }}>접근 권한 없음</h1>
          <p className="text-sm" style={{ color: C.textDim }}>
            이 포털은 승인된 사용자만 이용할 수 있습니다.<br />
            ({user.email})
          </p>
        </div>
      </div>
    );
  }

  const balance = data?.client.balanceKRW || 0;
  const balanceNegative = balance < 0;
  const bookings = data?.bookings || [];
  const today = todayISO();
  const todayBookings = bookings.filter((b) => b.date === today && b.status !== 'completed');
  const upcomingBookings = bookings.filter((b) => b.date >= today && b.status !== 'completed');
  const settleBookings = bookings.filter((b) => b.status === 'confirmed' && b.serviceType !== 'airport');
  const completedBookings = bookings.filter((b) => b.status === 'completed');
  const calendarDays = daysInMonthGrid(calendarMonth);
  const bookingsByDate = bookings.reduce<Record<string, MoodBooking[]>>((acc, b) => {
    if (!b.date) return acc;
    acc[b.date] = [...(acc[b.date] || []), b];
    return acc;
  }, {});
  // 동일 시간대 겹침(중립 표시) — 날짜별 최대 동시 건수(startTime+durationHours 비교, 2건 이상만 기록).
  // ⚠️ 충돌 "경고" 아님: 스키마에 managerId/vehicleId 가 없어 충돌 정의 불가(운영자 결정 2026-07-02,
  //    docs/MOOD-CONFLICT-DETECTION-TODO.md). 빨간색/경고 아이콘 금지 — 회색/보라 중립 톤만.
  const overlapByDate = Object.entries(bookingsByDate).reduce<Record<string, number>>((acc, [iso, list]) => {
    const n = maxConcurrentCount(list);
    if (n >= 2) acc[iso] = n;
    return acc;
  }, {});
  const selectedDateBookings = bookingsByDate[selectedCalendarDate] || [];
  const selectedOverlapCount = overlapByDate[selectedCalendarDate];
  const visibleBookings = ledgerTab === 'today'
    ? todayBookings
    : ledgerTab === 'upcoming'
      ? upcomingBookings
      : ledgerTab === 'settle'
        ? settleBookings
        : ledgerTab === 'calendar'
          ? selectedDateBookings
          : bookings;
  // 외상 정책: 잔액 부족해도 예약 허용. 음수 잔액/예상초과는 "안내"만(차단 아님).
  const willGoNegative = balance - estimate < 0;

  const inputStyle = { background: C.inputBg, border: C.inputBorder, color: C.text } as const;

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: C.bgGradient }}>
      <div className="mx-auto w-full max-w-md flex flex-col gap-5">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold" style={{ color: C.text }}>
            MOOD <span style={{ color: C.accentSolid }}>예약 포털</span>
          </h1>
          {data && <span className="text-xs" style={{ color: C.textDim }}>{data.client.name}</span>}
        </div>

        {/* 상단 3-탭 (현황 / 수기 예약 / AI 예약) — 다크 pill */}
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl" style={{ background: 'rgba(10,4,18,0.6)', border: C.cardBorder }}>
          {([
            ['status', '현황'],
            ['manual', '수기 예약'],
            ['ai', 'AI 예약'],
          ] as const).map(([tab, label]) => {
            const active = portalTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setPortalTab(tab)}
                className="py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: active ? C.accent : 'transparent',
                  color: active ? '#fff' : C.textDim,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ═══ 현황 탭 ═══ 잔액 · KPI · 공유 캘린더 · 예약 운영 보드 */}
        {portalTab === 'status' && (
        <>
        {/* 잔액 카드 (음수 = 빨강 마이너스, 외상 표시) */}
        <div className="rounded-2xl p-6" style={{ background: C.card, border: C.cardBorder }}>
          <p className="text-xs mb-1.5" style={{ color: C.textDim }}>선불 잔액</p>
          <p
            className="text-3xl font-extrabold tracking-tight"
            style={{ color: balanceNegative ? C.danger : C.text }}
          >
            {dataLoading && !data ? '…' : formatBalance(balance)}
          </p>
          {balanceNegative && (
            <p className="text-[11px] mt-1.5" style={{ color: C.danger }}>외상 (마이너스 잔액) — 충전 필요</p>
          )}
          {dataError && <p className="text-xs mt-2" style={{ color: C.danger }}>{dataError}</p>}
        </div>

        {/* 운영 요약 — 무드 직원이 오늘/예정/정산 상태를 바로 보는 영역 */}
        <div className="grid grid-cols-3 gap-2">
          {[
            ['오늘', todayBookings.length, '오늘 운행'],
            ['예정', upcomingBookings.length, '대기 중'],
            ['정산', settleBookings.length, '확인 필요'],
          ].map(([label, count, caption]) => (
            <button
              key={String(label)}
              type="button"
              onClick={() => setLedgerTab(label === '오늘' ? 'today' : label === '예정' ? 'upcoming' : 'settle')}
              className="rounded-2xl px-3 py-3 text-left transition-all hover:scale-[1.01]"
              style={{ background: C.card, border: C.cardBorder }}
            >
              <span className="block text-[11px]" style={{ color: C.textDim }}>{caption}</span>
              <span className="mt-1 block text-xl font-extrabold" style={{ color: label === '정산' && Number(count) > 0 ? C.danger : C.text }}>
                {count}
              </span>
              <span className="block text-[11px] font-semibold" style={{ color: C.accentSolid }}>{label}</span>
            </button>
          ))}
        </div>

        {/* 공유 캘린더 — 무드와 운영자가 날짜별 예약을 같이 확인 */}
        <div className="rounded-2xl p-5" style={{ background: C.card, border: C.cardBorder }}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-bold" style={{ color: C.text }}>공유 캘린더</h2>
              <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
                {selectedCalendarDate} · {selectedDateBookings.length}건
                {selectedOverlapCount !== undefined && (
                  // 중립 정보 표시(회색/보라) — 충돌 경고 아님(스키마상 정의 불가, 2026-07-02 운영자 결정)
                  <span style={{ color: C.accentSolid }}> · 동시간대 {selectedOverlapCount}건</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCalendarMonth((m) => addMonths(m, -1))}
                className="h-8 w-8 rounded-xl text-sm font-bold"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.textDim }}
                aria-label="이전 달"
              >
                ‹
              </button>
              <span className="min-w-[74px] text-center text-xs font-bold" style={{ color: C.text }}>{calendarMonth}</span>
              <button
                type="button"
                onClick={() => setCalendarMonth((m) => addMonths(m, 1))}
                className="h-8 w-8 rounded-xl text-sm font-bold"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.textDim }}
                aria-label="다음 달"
              >
                ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold mb-1.5" style={{ color: C.textDim }}>
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((d) => {
              const dayBookings = bookingsByDate[d.iso] || [];
              const hasSettle = dayBookings.some((b) => b.status === 'confirmed' && b.serviceType !== 'airport');
              const selected = selectedCalendarDate === d.iso;
              const isToday = d.iso === today;
              return (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => {
                    setSelectedCalendarDate(d.iso);
                    setCalendarMonth(monthKeyFromISO(d.iso));
                    setLedgerTab('calendar');
                  }}
                  className="relative min-h-[46px] rounded-xl px-1 py-1 text-left transition-all"
                  style={{
                    background: selected ? C.accent : isToday ? 'rgba(124,92,252,0.14)' : C.inputBg,
                    border: selected ? '1px solid transparent' : C.inputBorder,
                    color: d.inMonth ? C.text : 'rgba(255,255,255,0.28)',
                  }}
                >
                  <span className="block text-[11px] font-bold">{d.day}</span>
                  {dayBookings.length > 0 && (
                    <span
                      className="absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                      style={{ background: hasSettle ? 'rgba(248,113,113,0.26)' : 'rgba(110,231,183,0.20)', color: hasSettle ? '#fecaca' : C.ok }}
                    >
                      {dayBookings.length}
                    </span>
                  )}
                  {overlapByDate[d.iso] !== undefined && (
                    // 동시간대 겹침 힌트 — 중립 보라 점(경고 아님). 상세 수치는 위 "동시간대 N건" 문구로.
                    <span
                      className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full"
                      style={{ background: selected ? 'rgba(255,255,255,0.8)' : 'rgba(182,104,252,0.6)' }}
                      title={`동시간대 ${overlapByDate[d.iso]}건`}
                      aria-label={`동시간대 ${overlapByDate[d.iso]}건`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        {/* 예약 운영 보드는 아래 별도 status 블록으로 이동 — 수기 예약 폼을 탭으로 분리하기 위함 */}
        </>
        )}

        {/* ═══ 수기 예약 탭 ═══ 기존 예약하기 폼 */}
        {portalTab === 'manual' && (
        <>
        {/* 예약 폼 */}
        <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: C.card, border: C.cardBorder }}>
          <h2 className="text-sm font-bold" style={{ color: C.text }}>예약하기</h2>

          {/* 서비스 토글 */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(MOOD_RATES) as MoodServiceType[]).map((st) => {
              const active = serviceType === st;
              return (
                <button
                  key={st}
                  onClick={() => setServiceType(st)}
                  className="py-3 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: active ? C.accent : C.inputBg,
                    color: active ? '#fff' : C.textDim,
                    border: active ? '1px solid transparent' : C.inputBorder,
                  }}
                >
                  {SERVICE_LABEL[st]}
                  <span className="block text-[11px] font-normal mt-0.5 opacity-80">
                    {st === 'airport' ? `${formatKRW(MOOD_FIXED_PRICE_KRW.airport || 0)} 고정` : `${formatKRW(MOOD_RATES[st])}/시간`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 공항 픽업/샌딩 방향 — 공항 선택 시만 표시 */}
          {serviceType === 'airport' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>공항 방향</span>
              <div className="grid grid-cols-2 gap-2">
                {([['pickup', '픽업 (공항 → 목적지)'], ['sending', '샌딩 (출발지 → 공항)']] as const).map(([dir, label]) => {
                  const active = airportDirection === dir;
                  return (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setAirportDirection(dir)}
                      className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                      style={{
                        background: active ? C.accent : C.inputBg,
                        color: active ? '#fff' : C.textDim,
                        border: active ? '1px solid transparent' : C.inputBorder,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 날짜 */}
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

          {/* 시작 시각 */}
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

          {/* 시간 (duration) — 공항은 정액이라 시간 개념 없음 → 숨김 */}
          {serviceType !== 'airport' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: C.textDim }}>이용 시간 <span className="opacity-70">· 최소 3시간</span></span>
            <div className="flex items-center gap-3">
              <button
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
                  if (Number.isFinite(v)) setDurationHours(Math.min(MOOD_MAX_DURATION_HOURS, Math.max(MOOD_MIN_DURATION_HOURS, v)));
                }}
                className="flex-1 text-center rounded-xl px-3 py-2.5 text-sm"
                style={inputStyle}
              />
              <span className="text-sm shrink-0" style={{ color: C.textDim }}>시간</span>
              <button
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

          {/* 경로 (출발 / 경유지 N / 도착) — 다음 우편번호 주소검색 + 거리/톨비 자동 계산 */}
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-xs" style={{ color: C.textDim }}>경로 <span className="opacity-70">{serviceType === 'airport' ? '(픽업·샌딩 위치)' : '(거리 추가요금·톨비 자동 계산)'}</span></span>

            {/* 출발지 */}
            <div className="flex gap-2">
              <input
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="출발지 (예: 강남역, 도로명주소)"
                className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm"
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => searchAddress(setOrigin)}
                className="rounded-xl px-3 py-2.5 text-xs whitespace-nowrap shrink-0"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.accentSolid }}
              >
                🔍 주소
              </button>
            </div>

            {/* 경유지 — 네이버 지도처럼 추가/삭제 */}
            {waypoints.map((wp, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={wp}
                  onChange={(e) => setWaypointAt(i, e.target.value)}
                  placeholder={`경유지 ${i + 1}`}
                  className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => searchAddress((v) => setWaypointAt(i, v))}
                  aria-label={`경유지 ${i + 1} 주소 검색`}
                  className="rounded-xl px-3 py-2.5 text-xs whitespace-nowrap shrink-0"
                  style={{ background: C.inputBg, border: C.inputBorder, color: C.accentSolid }}
                >
                  🔍
                </button>
                <button
                  type="button"
                  onClick={() => removeWaypoint(i)}
                  aria-label={`경유지 ${i + 1} 삭제`}
                  className="rounded-xl px-3 py-2.5 text-xs shrink-0"
                  style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: C.danger }}
                >
                  ✕
                </button>
              </div>
            ))}

            {waypoints.length < 5 && (
              <button
                type="button"
                onClick={addWaypoint}
                className="rounded-xl px-3 py-2 text-xs self-start"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.textDim }}
              >
                + 경유지 추가
              </button>
            )}

            {/* 도착지 */}
            <div className="flex gap-2">
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="도착지 (예: 인천공항)"
                className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm"
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => searchAddress(setDestination)}
                className="rounded-xl px-3 py-2.5 text-xs whitespace-nowrap shrink-0"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.accentSolid }}
              >
                🔍 주소
              </button>
            </div>
            {routeLoading && (
              <p className="text-[11px]" style={{ color: C.textDim }}>경로 계산 중…</p>
            )}
            {routeError && (
              <p className="text-[11px]" style={{ color: C.danger }}>경로 계산 실패 — {routeError} (거리 추가요금 제외하고 예약 가능)</p>
            )}
            {route && !routeLoading && (
              <p className="text-[11px]" style={{ color: C.textDim }}>
                약 {route.km.toLocaleString('ko-KR')}km · 톨비 {formatKRW(route.tollKRW)}
                {route.durationMin > 0 ? ` · ${route.durationMin}분` : ''}
              </p>
            )}

            {/* 경로 미니맵 — 주소 맞는지 시각 확인 (키 없으면 지도 링크 폴백) */}
            <MoodRouteMap
              origin={origin}
              waypoints={waypoints}
              destination={destination}
              route={route}
              accent={C.accentSolid}
              inputBg={C.inputBg}
              inputBorder={C.inputBorder}
              textDim={C.textDim}
            />
          </div>

          {/* 예상 금액 분해 */}
          <div className="rounded-xl px-3 py-3 flex flex-col gap-1.5" style={{ background: C.inputBg, border: C.inputBorder }}>
            <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
              <span>{serviceType === 'airport'
                ? `${SERVICE_LABEL[serviceType]} ${airportDirection === 'pickup' ? '픽업' : '샌딩'} (정액)`
                : `${SERVICE_LABEL[serviceType]} ${durationHours}시간 (${formatKRW(MOOD_RATES[serviceType])}/시간)`}</span>
              <span style={{ color: C.text }}>{formatKRW(breakdown.baseKRW)}</span>
            </div>
            {breakdown.distanceSurchargeKRW > 0 && (
              <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
                <span>거리 추가요금 ({breakdown.km.toLocaleString('ko-KR')}km, 50km↑)</span>
                <span style={{ color: C.text }}>+{formatKRW(breakdown.distanceSurchargeKRW)}</span>
              </div>
            )}
            {breakdown.tollKRW > 0 && (
              <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
                <span>톨비</span>
                <span style={{ color: C.text }}>+{formatKRW(breakdown.tollKRW)}</span>
              </div>
            )}
            <div className="h-px my-0.5" style={{ background: 'rgba(124,92,252,0.18)' }} />
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: C.textDim }}>예상 금액</span>
              <span className="text-lg font-bold" style={{ color: C.accentSolid }}>{formatKRW(estimate)}</span>
            </div>
            {willGoNegative && (
              <p className="text-[11px]" style={{ color: C.danger }}>
                예약 시 잔액이 마이너스가 됩니다 (외상 허용) — 잔액 {formatBalance(balance - estimate)}
              </p>
            )}
          </div>

          <button
            onClick={() => { void handleBook(); }}
            disabled={submitting || !data || routeLoading}
            className="w-full py-3.5 rounded-xl font-bold transition-all hover:scale-[1.01] disabled:opacity-50"
            style={{ background: C.accent, color: '#fff' }}
          >
            {submitting ? '예약 중…' : '예약하기'}
          </button>

          {formMsg && (
            <p className="text-xs text-center" style={{ color: formMsg.kind === 'ok' ? C.ok : C.danger }}>
              {formMsg.text}
            </p>
          )}
        </div>
        </>
        )}

        {/* ═══ AI 예약 탭 ═══ 자연어로 예약(파트2 컴포넌트, 자체 완결) */}
        {portalTab === 'ai' && (
          <MoodAiBooking clientId={data?.clientId || ''} onBooked={() => { void loadData(data?.clientId); }} />
        )}

        {/* ═══ 현황 탭 (이어서) ═══ 예약 운영 보드 */}
        {portalTab === 'status' && (
        <>
        {/* 예약 운영 보드 — 오늘/예정/정산/전체를 나눠 보는 영역 */}
        <div className="rounded-2xl p-5" style={{ background: C.card, border: C.cardBorder }}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-bold" style={{ color: C.text }}>예약 운영</h2>
              <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
                완료 {completedBookings.length}건 · 총 {bookings.length}건
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void loadData(data?.clientId); }}
              className="rounded-xl px-3 py-2 text-[11px] font-semibold"
              style={{ background: C.inputBg, border: C.inputBorder, color: C.accentSolid }}
            >
              새로고침
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5 mb-3">
            {([
              ['today', '오늘', todayBookings.length],
              ['upcoming', '예정', upcomingBookings.length],
              ['settle', '정산', settleBookings.length],
              ['calendar', '날짜', selectedDateBookings.length],
              ['all', '전체', bookings.length],
            ] as const).map(([tab, label, count]) => {
              const active = ledgerTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setLedgerTab(tab)}
                  className="rounded-xl px-2 py-2 text-[11px] font-bold transition-all"
                  style={{
                    background: active ? C.accent : C.inputBg,
                    border: active ? '1px solid transparent' : C.inputBorder,
                    color: active ? '#fff' : C.textDim,
                  }}
                >
                  {label}
                  <span className="ml-1 opacity-80">{count}</span>
                </button>
              );
            })}
          </div>

          {!data || visibleBookings.length === 0 ? (
            <p className="text-xs" style={{ color: C.textDim }}>
              {bookings.length === 0 ? '예약 내역이 없습니다.' : '이 탭에 표시할 예약이 없습니다.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleBookings.map((b) => {
                const bd = b.breakdown;
                const routeText = routeTextFromBreakdown(bd);
                const stops = cleanStops(bd);
                const expanded = expandedBookingId === b.id;
                const canSettle = data?.isAdmin && b.status === 'confirmed' && b.serviceType !== 'airport';
                const serviceTime = b.serviceType === 'airport' ? '정액' : `${b.durationHours}시간`;
                return (
                  <li
                    key={b.id}
                    className="rounded-xl px-3 py-2.5"
                    style={{ background: C.inputBg, border: C.inputBorder }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedBookingId((id) => (id === b.id ? null : b.id))}
                        className="min-w-0 text-left flex-1"
                      >
                        <span className="block text-sm font-semibold" style={{ color: C.text }}>
                          {b.date} · {b.startTime}
                        </span>
                        <span className="block text-[11px] truncate" style={{ color: C.textDim }}>
                          {SERVICE_LABEL[b.serviceType] || b.serviceType} {serviceTime} · {b.status === 'completed' ? '정산 완료' : '예약 확정'}
                        </span>
                        {routeText && (
                          <span className="block text-[11px] truncate" style={{ color: C.textDim }}>{routeText}</span>
                        )}
                      </button>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-bold" style={{ color: b.status === 'completed' ? C.ok : C.danger }}>
                          −{formatKRW(b.finalAmountKRW || b.amountKRW)}
                        </span>
                        {typeof b.runningBalanceKRW === 'number' && (
                          <p className="text-[11px]" style={{ color: b.runningBalanceKRW < 0 ? C.danger : C.textDim }}>
                            잔액 {formatBalance(b.runningBalanceKRW)}
                          </p>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-3 flex flex-col gap-2">
                        {stops.length > 0 && (
                          <div className="rounded-xl p-3" style={{ background: 'rgba(2,6,23,0.32)', border: '1px solid rgba(124,92,252,0.14)' }}>
                            <p className="text-[11px] font-bold mb-2" style={{ color: C.text }}>동선</p>
                            <div className="flex flex-col gap-1.5">
                              {stops.map((stop, i) => (
                                <div key={`${stop}-${i}`} className="flex gap-2">
                                  <span
                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                                    style={{ background: i === 0 ? '#22c55e' : i === stops.length - 1 ? '#ef4444' : C.accentSolid, color: '#fff' }}
                                  >
                                    {i + 1}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold truncate" style={{ color: C.text }}>{stop}</p>
                                    {i < stops.length - 1 && (
                                      <p className="text-[10px]" style={{ color: C.textDim }}>차량 이동</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedBooking(b)}
                            className="col-span-2 rounded-xl px-3 py-2 text-[11px] font-semibold"
                            style={{ background: C.accent, color: '#fff' }}
                          >
                            영수증 보기
                          </button>
                          <a
                            href={naverDirectionsUrl(bd)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-xl px-3 py-2 text-center text-[11px] font-semibold"
                            style={{ background: C.inputBg, border: C.inputBorder, color: C.accentSolid }}
                          >
                            네이버 지도
                          </a>
                          <a
                            href={googleDirectionsUrl(bd)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-xl px-3 py-2 text-center text-[11px] font-semibold"
                            style={{ background: C.inputBg, border: C.inputBorder, color: C.accentSolid }}
                          >
                            구글 지도
                          </a>
                          <button
                            type="button"
                            onClick={() => copyBookingToForm(b)}
                            className="rounded-xl px-3 py-2 text-[11px] font-semibold"
                            style={{ background: C.inputBg, border: C.inputBorder, color: C.textDim }}
                          >
                            이 예약 복사
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSettleId(b.id);
                              setSettleHours(String(b.durationHours || MOOD_MIN_DURATION_HOURS));
                              setSettleOrigin(b.breakdown?.origin || '');
                              setSettleDestination(b.breakdown?.destination || '');
                              setSettleWaypoints(Array.isArray(b.breakdown?.waypoints) ? b.breakdown.waypoints.slice() : []);
                              setSettleMsg(null);
                            }}
                            disabled={!canSettle}
                            className="rounded-xl px-3 py-2 text-[11px] font-semibold disabled:opacity-40"
                            style={{ background: canSettle ? C.accent : C.inputBg, border: canSettle ? '1px solid transparent' : C.inputBorder, color: canSettle ? '#fff' : C.textDim }}
                          >
                            운행 종료 정산
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 분해: 시급/거리추가/톨비 (값 있을 때만) */}
                    {bd && (bd.baseKRW != null || bd.distanceSurchargeKRW || bd.tollKRW) && (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" style={{ color: C.textDim }}>
                        {bd.baseKRW != null && <span>기본 {formatKRW(bd.baseKRW)}</span>}
                        {!!bd.distanceSurchargeKRW && (
                          <span>거리 +{formatKRW(bd.distanceSurchargeKRW)}{bd.km ? ` (${bd.km}km)` : ''}</span>
                        )}
                        {!!bd.tollKRW && <span>톨비 +{formatKRW(bd.tollKRW)}</span>}
                      </div>
                    )}

                    {/* 운행 종료 정산 (admin · 시간제 · 미정산) */}
                    {data?.isAdmin && b.status === 'confirmed' && b.serviceType !== 'airport' && settleId === b.id && (
                      <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(124,92,252,0.12)' }}>
                          <div className="flex flex-col gap-2">
                            {/* 실제 시간 */}
                            <label className="flex items-center gap-2">
                              <span className="text-[11px] shrink-0" style={{ color: C.textDim }}>실제 시간</span>
                              <input
                                type="number"
                                min={MOOD_MIN_DURATION_HOURS}
                                max={MOOD_MAX_DURATION_HOURS}
                                value={settleHours}
                                onChange={(e) => setSettleHours(e.target.value)}
                                placeholder="실제 시간"
                                className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-xs"
                                style={inputStyle}
                              />
                            </label>

                            {/* 실제 방문 경로 — 추가 방문지 넣으면 정확한 거리 재측정 (Naver) */}
                            <div className="rounded-lg p-2.5 flex flex-col gap-1.5" style={{ background: C.inputBg, border: C.inputBorder }}>
                              <p className="text-[11px] font-semibold" style={{ color: C.textDim }}>
                                실제 방문 경로 <span className="font-normal">— 추가 방문지 넣으면 정확한 거리로 재측정</span>
                              </p>
                              {/* 출발 */}
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={settleOrigin}
                                  onChange={(e) => setSettleOrigin(e.target.value)}
                                  placeholder="출발지"
                                  className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-xs"
                                  style={inputStyle}
                                />
                                <button type="button" onClick={() => { void searchAddress(setSettleOrigin); }} className="rounded-lg px-2 py-1.5 text-[11px] shrink-0" style={{ background: C.card, border: C.inputBorder, color: C.accentSolid }} aria-label="출발지 주소 검색">검색</button>
                              </div>
                              {/* 경유(방문)지 */}
                              {settleWaypoints.map((wp, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                  <input
                                    value={wp}
                                    onChange={(e) => setSettleWaypointAt(i, e.target.value)}
                                    placeholder={`방문지 ${i + 1}`}
                                    className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-xs"
                                    style={inputStyle}
                                  />
                                  <button type="button" onClick={() => { void searchAddress((v) => setSettleWaypointAt(i, v)); }} className="rounded-lg px-2 py-1.5 text-[11px] shrink-0" style={{ background: C.card, border: C.inputBorder, color: C.accentSolid }} aria-label={`방문지 ${i + 1} 주소 검색`}>검색</button>
                                  <button type="button" onClick={() => removeSettleWaypoint(i)} className="rounded-lg px-2 py-1.5 text-[11px] shrink-0" style={{ background: C.card, border: C.inputBorder, color: C.danger }} aria-label={`방문지 ${i + 1} 삭제`}>✕</button>
                                </div>
                              ))}
                              {settleWaypoints.length < 5 && (
                                <button type="button" onClick={addSettleWaypoint} className="self-start text-[11px] underline" style={{ color: C.accentSolid }}>
                                  + 방문지 추가
                                </button>
                              )}
                              {/* 도착 */}
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={settleDestination}
                                  onChange={(e) => setSettleDestination(e.target.value)}
                                  placeholder="도착지"
                                  className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-xs"
                                  style={inputStyle}
                                />
                                <button type="button" onClick={() => { void searchAddress(setSettleDestination); }} className="rounded-lg px-2 py-1.5 text-[11px] shrink-0" style={{ background: C.card, border: C.inputBorder, color: C.accentSolid }} aria-label="도착지 주소 검색">검색</button>
                              </div>
                              <p className="text-[10px]" style={{ color: C.textDim }}>* 비워두면 예약 시 측정한 거리로 정산됩니다.</p>
                            </div>

                            {/* 확정 / 취소 */}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { void handleSettle(b.id); }}
                                disabled={settling}
                                className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                                style={{ background: C.accent, color: '#fff' }}
                              >
                                {settling ? '정산 중…' : '정산 확정'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setSettleId(null); setSettleMsg(null); }}
                                className="rounded-lg px-2.5 py-1.5 text-xs"
                                style={{ background: C.inputBg, border: C.inputBorder, color: C.textDim }}
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        {settleId === b.id && settleMsg && (
                          <p className="text-[11px] mt-1" style={{ color: settleMsg.kind === 'ok' ? C.ok : C.danger }}>{settleMsg.text}</p>
                        )}
                      </div>
                    )}

                    {/* 정산 완료 배지 */}
                    {b.status === 'completed' && (
                      <div className="mt-2 pt-2 text-[11px]" style={{ borderTop: '1px solid rgba(110,231,183,0.15)', color: C.ok }}>
                        ✓ 정산 완료 · 실제 {b.actualHours || '?'}시간 · 최종 {formatKRW(b.finalAmountKRW || b.amountKRW)}
                        {typeof b.adjustmentKRW === 'number' && b.adjustmentKRW !== 0 && (
                          <span style={{ color: C.textDim }}> ({b.adjustmentKRW > 0 ? '+' : ''}{formatKRW(b.adjustmentKRW)})</span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </>
        )}

        {/* 예약 항목 클릭 시 영수증 모달 (완료/일반 공용) — 파트2 컴포넌트 */}
        <MoodReceiptModal booking={selectedBooking} onClose={() => setSelectedBooking(null)} />
      </div>
    </div>
  );
}
