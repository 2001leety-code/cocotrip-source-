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
import { MoodGuideModal } from '@/components/mood/MoodGuideModal';
import { AddressAutocomplete, type AddressResult } from '@/components/charter/AddressAutocomplete';
import { PwaInstallButton } from '@/components/PwaInstallButton';
import { getLocaleSync } from '@/i18n';
import {
  MOOD_RATES,
  MOOD_MAX_DURATION_HOURS,
  MOOD_MIN_DURATION_HOURS,
  MOOD_AIRPORT_PRICE_KRW,
  MOOD_AIRPORT_LABEL,
  MOOD_AIRPORT_CODES,
  MOOD_DEFAULT_AIRPORT_CODE,
  MOOD_SURCHARGE_PER_KM,
  normalizeAirportCode,
  computeMoodTotalKRW,
  formatKRW,
  type MoodServiceType,
  type MoodAirportCode,
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
  /** 예약 메모 (AI 예약이 항공편 정보 자동 첨부, 2026-07-05). */
  note?: string | null;
  /** 공항 예약 메타 — 정액 근거(ICN 110,000 / GMP 80,000). 레거시 예약은 null = 인천 취급. */
  airportCode?: MoodAirportCode | null;
  airportDirection?: 'pickup' | 'sending' | null;
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
  // 어느 공항인지 — 정액이 다름(인천 110,000 / 김포 80,000). 백엔드가 이 값으로 재계산.
  const [airportCode, setAirportCode] = useState<MoodAirportCode>(MOOD_DEFAULT_AIRPORT_CODE);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 경로(주소) 입력 상태 — 경유지는 네이버 지도처럼 개별 추가/삭제(최대 5, 백엔드 한도).
  const [origin, setOrigin] = useState('');
  const [waypoints, setWaypoints] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  // AddressAutocomplete(네이버 검색+미니지도 핀) 표시용 병렬 상태. 돈 경로는 위 문자열이 SSOT —
  // 서버가 재지오코딩(P311)하므로 API엔 문자열만 보낸다. AC는 확정 UI·좌표 보너스일 뿐.
  // waypointsAC 는 waypoints 와 인덱스·길이 항상 동기(add/remove/copy 시 함께 갱신).
  const [originAC, setOriginAC] = useState<AddressResult | null>(null);
  const [destinationAC, setDestinationAC] = useState<AddressResult | null>(null);
  const [waypointsAC, setWaypointsAC] = useState<(AddressResult | null)[]>([]);
  const [route, setRoute] = useState<MoodRoute | null>(null);
  // 공항 경유 우회거리(km) — 경유포함 − 직행 (2026-07-05). 예상 금액 detour 요금 표시용.
  const [airportDetourKm, setAirportDetourKm] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const routeSeq = useRef(0); // 경합 방지 — 최신 요청만 반영

  // 운영용 예약 리스트 상태
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>('today');
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(monthKeyFromISO(todayISO()));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(todayISO());

  // 이용 안내 & Q&A 모달 (2026-07-05 — 직원 온보딩용, 헤더 ❓ 버튼)
  const [guideOpen, setGuideOpen] = useState(false);

  // ── 운영자 스케줄 메모 (2026-07-05 · 2026-07-27 무드에게도 공개) ──────
  // 읽기 = 포털 사용자 전원(무드 포함) — "이 날은 예약 잡지 말 것" 을 무드가 봐야 피할 수 있음.
  // 쓰기 = 운영자만 (서버 mood-notes 가 POST 를 admins 로 제한, 프론트는 isAdmin 일 때만 입력칸 렌더).
  const [scheduleNotes, setScheduleNotes] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMsg, setNoteMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // (충전 폼·광고사 만들기 폼은 어드민 전용 → /mood 에서 제거. 어드민 관리자 화면으로 이관.)

  // 예약 취소 (2026-07-05) — 2단계 확인. 돈은 서버(mood-cancel)가 전액 환원(SSOT).
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 운행 종료 정산 상태 (admin) — settleId = 입력칸 열린 예약 id
  const [settleId, setSettleId] = useState<string | null>(null);
  const [settleHours, setSettleHours] = useState('');
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // 정산 시 추가 방문지(실제 경로) — 정확한 거리 재측정용. 예약 경로로 prefill 후 매니저가 수정/추가.
  const [settleOrigin, setSettleOrigin] = useState('');
  const [settleWaypoints, setSettleWaypoints] = useState<string[]>([]);
  const [settleDestination, setSettleDestination] = useState('');

  // 예상 금액 분해 — base + 거리추가 + 톨비. 공항은 정액 + 경유 우회거리 요금.
  const breakdown = useMemo(
    () =>
      computeMoodTotalKRW({
        serviceType,
        durationHours,
        km: route?.km || 0,
        tollKRW: route?.tollKRW || 0,
        airportDetourKm, // 공항 경유 우회거리 (직행이면 0)
        airportCode,     // 인천/김포 정액 구분
      }),
    [serviceType, durationHours, route, airportDetourKm, airportCode],
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

  // 스케줄 메모 로드 — 포털 사용자 전원(무드 포함), 캘린더 달 바뀔 때마다.
  // data 로드 전(=allowlist 통과 확인 전)엔 호출하지 않음.
  const isAdmin = !!data?.isAdmin;
  const canReadNotes = !!data;
  useEffect(() => {
    if (!canReadNotes) return;
    let alive = true;
    (async () => {
      try {
        const res = await authFetch(`/api/mood-notes?month=${encodeURIComponent(calendarMonth)}`);
        const json = await res.json().catch(() => ({}));
        if (!alive || !json?.ok) return;
        setScheduleNotes((prev) => ({ ...prev, ...(json.notes || {}) }));
      } catch { /* 메모는 보조 기능 — 로드 실패해도 포털 동작에 영향 없음 */ }
    })();
    return () => { alive = false; };
  }, [canReadNotes, calendarMonth]);

  // 날짜 선택/메모 로드 시 입력칸 동기화 (저장 직후엔 같은 텍스트라 체감 무변화).
  useEffect(() => {
    setNoteDraft(scheduleNotes[selectedCalendarDate] || '');
    setNoteMsg(null);
  }, [selectedCalendarDate, scheduleNotes]);

  const saveNote = useCallback(async () => {
    setNoteSaving(true);
    setNoteMsg(null);
    try {
      const text = noteDraft.trim();
      const res = await authFetch('/api/mood-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedCalendarDate, text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setNoteMsg({ kind: 'err', text: json?.error || `저장 실패 (${res.status})` });
        return;
      }
      setScheduleNotes((prev) => {
        const next = { ...prev };
        if (text) next[selectedCalendarDate] = text;
        else delete next[selectedCalendarDate];
        return next;
      });
      setNoteMsg({ kind: 'ok', text: text ? '저장했습니다.' : '메모를 지웠습니다.' });
    } catch (e) {
      setNoteMsg({ kind: 'err', text: e instanceof Error ? e.message : '저장 실패' });
    } finally {
      setNoteSaving(false);
    }
  }, [noteDraft, selectedCalendarDate]);

  // ── 경로 조회 (디바운스) — 출발+도착 둘 다 있을 때만 /api/mood-route ──
  // 모든 setState 는 디바운스 timeout 안에서만 호출(이펙트 본문 동기 setState 회피 →
  // cascading render 방지). 입력이 비면 timeout 에서 route 상태를 비운다.
  useEffect(() => {
    const o = origin.trim();
    const d = destination.trim();
    const seq = ++routeSeq.current;
    const isAirport = serviceType === 'airport';
    const wpList = waypoints.map((s) => s.trim()).filter(Boolean);
    const t = setTimeout(async () => {
      if (seq !== routeSeq.current) return;
      // 공항 직행(경유 0)이거나 주소 미완성 → 거리계산 불필요(경로 표시도 숨김).
      if (!o || !d || (isAirport && wpList.length === 0)) {
        setRoute(null);
        setRouteError(null);
        setRouteLoading(false);
        setAirportDetourKm(0);
        return;
      }
      setRouteLoading(true);
      setRouteError(null);
      try {
        const viaParams = new URLSearchParams({ origin: o, destination: d });
        if (wpList.length) viaParams.set('waypoints', wpList.join('|'));
        if (isAirport) {
          // 공항 + 경유 → 경유포함/직행 각각 측정해 우회거리(백엔드 SSOT 와 동일). 지도=경유 경로.
          const [viaRes, directRes] = await Promise.all([
            authFetch(`/api/mood-route?${viaParams.toString()}`),
            authFetch(`/api/mood-route?${new URLSearchParams({ origin: o, destination: d }).toString()}`),
          ]);
          const [vj, dj] = await Promise.all([viaRes.json().catch(() => ({})), directRes.json().catch(() => ({}))]);
          if (seq !== routeSeq.current) return;
          if (vj?.ok && dj?.ok) {
            const via = vj.data || {};
            setRoute({
              km: Number(via.km) || 0,
              tollKRW: Number(via.tollKRW) || 0,
              durationMin: Number(via.durationMin) || 0,
              path: Array.isArray(via.path) ? via.path : [],
              points: Array.isArray(via.points) ? via.points : [],
            });
            setAirportDetourKm(Math.max(0, (Number(via.km) || 0) - (Number(dj.data?.km) || 0)));
            setRouteError(null);
          } else {
            setRoute(null);
            setAirportDetourKm(0);
            setRouteError((vj?.error || dj?.error) || '경로 조회 실패');
          }
        } else {
          const res = await authFetch(`/api/mood-route?${viaParams.toString()}`);
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
        }
      } catch (e) {
        if (seq !== routeSeq.current) return;
        setRoute(null);
        setAirportDetourKm(0);
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
          airportCode: serviceType === 'airport' ? airportCode : undefined,
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
  }, [data, date, startTime, durationHours, serviceType, airportDirection, airportCode, origin, destination, waypoints, loadData]);

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
  // waypoints(문자열=돈 SSOT)와 waypointsAC(표시용)를 항상 함께 갱신 — 인덱스·길이 동기 유지.
  const addWaypoint = useCallback(() => {
    setWaypoints((w) => (w.length >= 5 ? w : [...w, '']));
    setWaypointsAC((w) => (w.length >= 5 ? w : [...w, null]));
  }, []);
  const removeWaypoint = useCallback((i: number) => {
    setWaypoints((w) => w.filter((_, idx) => idx !== i));
    setWaypointsAC((w) => w.filter((_, idx) => idx !== i));
  }, []);
  const setWaypointAt = useCallback((i: number, val: string) => {
    setWaypoints((w) => w.map((x, idx) => (idx === i ? val : x)));
  }, []);
  const setWaypointACAt = useCallback((i: number, val: AddressResult | null) => {
    setWaypointsAC((w) => w.map((x, idx) => (idx === i ? val : x)));
  }, []);

  // 예약 취소 실행 — confirmed 만 서버가 허용(멱등·IDOR 가드는 서버). 성공 시 목록 갱신.
  const handleCancelBooking = useCallback(async (bookingId: string) => {
    setCancelling(true);
    setCancelMsg(null);
    try {
      const res = await authFetch('/api/mood-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setCancelMsg({ kind: 'err', text: json?.error || `취소 실패 (${res.status})` });
        return;
      }
      setCancelMsg({ kind: 'ok', text: `취소 완료 — ${formatKRW(json.refundKRW)} 환불, 잔액 ${formatKRW(json.balanceKRW)}` });
      setCancelConfirmId(null);
      await loadData(data?.clientId);
    } catch (e) {
      setCancelMsg({ kind: 'err', text: e instanceof Error ? e.message : '취소 실패' });
    } finally {
      setCancelling(false);
    }
  }, [data, loadData]);

  const copyBookingToForm = useCallback((b: MoodBooking) => {
    const bd = b.breakdown || {};
    setServiceType(b.serviceType);
    setAirportCode(normalizeAirportCode(b.airportCode)); // 레거시(null) = 인천
    if (b.airportDirection === 'pickup' || b.airportDirection === 'sending') setAirportDirection(b.airportDirection);
    setDate(b.date || todayISO());
    setStartTime(b.startTime || '10:00');
    setDurationHours(Math.max(MOOD_MIN_DURATION_HOURS, Number(b.durationHours) || MOOD_MIN_DURATION_HOURS));
    const wps = Array.isArray(bd.waypoints) ? bd.waypoints.filter(Boolean) : [];
    setOrigin(bd.origin || '');
    setDestination(bd.destination || '');
    setWaypoints(wps);
    // breakdown 엔 좌표 미저장(주소 문자열만) → AC 는 비움. 복사된 주소는 각 칸 밑
    // "현재: {주소}" 힌트로 노출되고, 경로/금액은 문자열 기준으로 그대로 계산된다.
    // 바꾸려면 검색해서 핀 재확정. (배열 길이는 waypoints 와 동기)
    setOriginAC(null);
    setDestinationAC(null);
    setWaypointsAC(wps.map(() => null));
    setFormMsg({ kind: 'ok', text: '예약 폼에 복사했습니다. 날짜·시간을 확인하고, 경로를 바꾸려면 지도에서 다시 검색하세요.' });
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
  const todayBookings = bookings.filter((b) => b.date === today && b.status !== 'completed' && b.status !== 'cancelled');
  const upcomingBookings = bookings.filter((b) => b.date >= today && b.status !== 'completed' && b.status !== 'cancelled');
  const settleBookings = bookings.filter((b) => b.status === 'confirmed' && b.serviceType !== 'airport');
  const completedBookings = bookings.filter((b) => b.status === 'completed');
  const calendarDays = daysInMonthGrid(calendarMonth);
  const bookingsByDate = bookings.reduce<Record<string, MoodBooking[]>>((acc, b) => {
    if (!b.date || b.status === 'cancelled') return acc; // 취소 건은 캘린더에서 제외 (배차 없음)
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
          <div className="flex items-center gap-1">
            {data && <span className="text-xs" style={{ color: C.textDim }}>{data.client.name}</span>}
            {/* 이용 안내 & Q&A (직원 온보딩) */}
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              aria-label="이용 안내"
              title="이용 안내"
              className="h-7 w-7 rounded-lg text-sm font-bold"
              style={{ background: 'rgba(124,92,252,0.10)', border: C.inputBorder, color: C.accentSolid }}
            >
              ?
            </button>
            {/* 홈화면 추가(PWA) — MOOD 전용 앱 설치. MOOD 앱으로 실행 중일 때만 자동 숨김
                (코코트립 앱 안에서 /mood 를 볼 땐 노출 + 브라우저로 열기 안내). */}
            <PwaInstallButton
              t={getLocaleSync('ko')}
              appScope="/mood"
              browserOpenHint="지금은 코코트립 앱 안이에요. MOOD 전용 앱으로 설치하려면 크롬 브라우저에서 cocotripkr.com/mood 를 연 뒤 메뉴(⋮) → '홈 화면에 추가'를 누르세요."
            />
          </div>
        </div>
        <MoodGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

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
                  {!!scheduleNotes[d.iso] && (
                    // 운영자 스케줄 있는 날 — 앰버 점. 무드에게도 보임(2026-07-27) → 이 날은 예약을 피하라는 신호.
                    <span
                      className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
                      style={{ background: '#fbbf24' }}
                      title={`운영자 스케줄: ${scheduleNotes[d.iso]}`}
                      aria-label={`운영자 스케줄 있음: ${scheduleNotes[d.iso]}`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* 운영자 스케줄 — 무드에게도 공개(2026-07-27). 쓰기는 운영자만(서버 mood-notes 가 POST 제한). */}
          {isAdmin ? (
            <div className="mt-3 flex flex-col gap-1.5 rounded-xl p-3" style={{ background: C.inputBg, border: C.inputBorder }}>
              <span className="text-[11px] font-bold" style={{ color: C.accentSolid }}>
                📝 {selectedCalendarDate} 내 스케줄 <span style={{ color: '#fcd34d' }}>(무드에게 그대로 보임 — 개인 일정 상세는 쓰지 마세요)</span>
              </span>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="예: 오후 일정 있음 — 이 날 예약 잡지 말 것"
                rows={2}
                maxLength={2000}
                className="w-full rounded-lg px-2.5 py-2 text-xs resize-y"
                style={{ background: 'rgba(10,4,18,0.6)', border: C.inputBorder, color: C.text }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void saveNote(); }}
                  disabled={noteSaving}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
                  style={{ background: C.accent, color: '#fff' }}
                >
                  {noteSaving ? '저장 중…' : '메모 저장'}
                </button>
                {noteMsg && (
                  <span className="text-[11px]" style={{ color: noteMsg.kind === 'ok' ? C.ok : C.danger }}>{noteMsg.text}</span>
                )}
              </div>
            </div>
          ) : scheduleNotes[selectedCalendarDate] ? (
            // 무드 계정 — 읽기 전용. 메모가 있는 날에만 노출(없는 날 빈 박스는 소음).
            <div className="mt-3 flex flex-col gap-1 rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.30)' }}>
              <span className="text-[11px] font-bold" style={{ color: '#fcd34d' }}>
                📝 {selectedCalendarDate} 운영자 스케줄 — 이 날은 배차가 어려울 수 있어요
              </span>
              <p className="text-xs whitespace-pre-wrap" style={{ color: C.text }}>{scheduleNotes[selectedCalendarDate]}</p>
            </div>
          ) : null}
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
                    {st === 'airport' ? `${formatKRW(MOOD_AIRPORT_PRICE_KRW[airportCode])} 고정` : `${formatKRW(MOOD_RATES[st])}/시간`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 어느 공항 — 정액이 다름(인천 110,000 / 김포 80,000). 공항 선택 시만 표시 */}
          {serviceType === 'airport' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>공항</span>
              <div className="grid grid-cols-2 gap-2">
                {MOOD_AIRPORT_CODES.map((code) => {
                  const active = airportCode === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setAirportCode(code)}
                      className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                      style={{
                        background: active ? C.accent : C.inputBg,
                        color: active ? '#fff' : C.textDim,
                        border: active ? '1px solid transparent' : C.inputBorder,
                      }}
                    >
                      ✈️ {MOOD_AIRPORT_LABEL[code]}
                      <span className="block text-[11px] font-normal mt-0.5 opacity-80">
                        {formatKRW(MOOD_AIRPORT_PRICE_KRW[code])} 정액
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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

          {/* 경로 (출발 / 경유지 N / 도착) — 네이버 지도 검색+미니지도 핀 확정 + 거리/톨비 자동 계산 */}
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-xs" style={{ color: C.textDim }}>경로 <span className="opacity-70">{serviceType === 'airport' ? '(직행 정액 · 경유 시 우회거리 요금)' : '(거리 추가요금·톨비 자동 계산)'}</span></span>

            {/* 출발지 — 네이버 검색 + 미니지도 핀 확정 (AddressAutocomplete). 확정 시 origin 문자열 갱신. */}
            <AddressAutocomplete
              id="mood-origin"
              label="출발지"
              language="ko"
              placeholder="출발지 검색 (예: 강남역, 롯데호텔)"
              value={originAC ?? undefined}
              onChange={(c) => { setOriginAC(c); setOrigin(c?.address ?? ''); }}
            />
            {!originAC && origin.trim() && (
              <p className="text-[11px]" style={{ color: C.textDim }}>
                현재 출발지: {origin} <span className="opacity-70">— 바꾸려면 위에서 검색</span>
              </p>
            )}

            {/* 경유지 — 네이버 검색+핀. 추가/삭제. (waypoints 문자열 = 돈 SSOT, waypointsAC = 표시) */}
            {waypoints.map((wp, i) => (
              <div key={i} className="flex flex-col gap-1">
                <AddressAutocomplete
                  id={`mood-wp-${i}`}
                  label={`경유지 ${i + 1}`}
                  language="ko"
                  placeholder={`경유지 ${i + 1} 검색`}
                  value={waypointsAC[i] ?? undefined}
                  onChange={(c) => { setWaypointACAt(i, c); setWaypointAt(i, c?.address ?? ''); }}
                />
                <div className="flex items-center justify-between gap-2">
                  {!waypointsAC[i] && wp.trim() ? (
                    <p className="text-[11px] min-w-0 truncate" style={{ color: C.textDim }}>현재: {wp}</p>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => removeWaypoint(i)}
                    aria-label={`경유지 ${i + 1} 삭제`}
                    className="rounded-lg px-2.5 py-1 text-xs shrink-0"
                    style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: C.danger }}
                  >
                    ✕ 경유지 삭제
                  </button>
                </div>
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

            {/* 도착지 — 네이버 검색 + 미니지도 핀 확정. 확정 시 destination 문자열 갱신. */}
            <AddressAutocomplete
              id="mood-destination"
              label="도착지"
              language="ko"
              placeholder="도착지 검색 (예: 인천공항, 명동)"
              value={destinationAC ?? undefined}
              onChange={(c) => { setDestinationAC(c); setDestination(c?.address ?? ''); }}
            />
            {!destinationAC && destination.trim() && (
              <p className="text-[11px]" style={{ color: C.textDim }}>
                현재 도착지: {destination} <span className="opacity-70">— 바꾸려면 위에서 검색</span>
              </p>
            )}
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
                ? `${MOOD_AIRPORT_LABEL[airportCode]} ${airportDirection === 'pickup' ? '픽업' : '샌딩'} (정액)`
                : `${SERVICE_LABEL[serviceType]} ${durationHours}시간 (${formatKRW(MOOD_RATES[serviceType])}/시간)`}</span>
              <span style={{ color: C.text }}>{formatKRW(breakdown.baseKRW)}</span>
            </div>
            {breakdown.distanceSurchargeKRW > 0 && (
              <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
                <span>{serviceType === 'airport'
                  ? `경유 우회거리 (${breakdown.km.toLocaleString('ko-KR')}km × ${MOOD_SURCHARGE_PER_KM}원)`
                  : `거리 추가요금 (${breakdown.km.toLocaleString('ko-KR')}km, 50km↑)`}</span>
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
                // 공항은 어느 공항인지가 금액을 결정 → 목록에서 바로 보이게 (레거시 예약=인천).
                const serviceName = b.serviceType === 'airport'
                  ? MOOD_AIRPORT_LABEL[normalizeAirportCode(b.airportCode)]
                  : (SERVICE_LABEL[b.serviceType] || b.serviceType);
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
                        <span className="block text-[11px] truncate" style={{ color: b.status === 'cancelled' ? '#fca5a5' : C.textDim }}>
                          {serviceName} {serviceTime} · {b.status === 'completed' ? '정산 완료' : b.status === 'cancelled' ? '취소됨 (환불)' : '예약 확정'}
                        </span>
                        {routeText && (
                          <span className="block text-[11px] truncate" style={{ color: C.textDim }}>{routeText}</span>
                        )}
                        {b.note && (
                          <span className="block text-[11px] truncate" style={{ color: '#93c5fd' }}>{b.note}</span>
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
                          {b.status === 'confirmed' && (
                            <button
                              type="button"
                              onClick={() => { setCancelConfirmId((id) => (id === b.id ? null : b.id)); setCancelMsg(null); }}
                              className="rounded-xl px-3 py-2 text-[11px] font-semibold"
                              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
                            >
                              예약 취소
                            </button>
                          )}
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

                        {/* 취소 2단계 확인 — 환불액 명시 후 확정 */}
                        {cancelConfirmId === b.id && (
                          <div className="mt-2 rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.30)' }}>
                            <p className="text-[11px]" style={{ color: '#fca5a5' }}>
                              이 예약을 취소하면 <b style={{ color: C.text }}>{formatKRW(b.amountKRW)}</b>이 잔액으로 환불됩니다.
                              배차도 함께 취소돼요. 되돌릴 수 없습니다.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => { void handleCancelBooking(b.id); }}
                                disabled={cancelling}
                                className="rounded-lg px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                                style={{ background: '#ef4444', color: '#fff' }}
                              >
                                {cancelling ? '취소 중…' : '진짜 취소하기'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setCancelConfirmId(null); setCancelMsg(null); }}
                                className="rounded-lg px-3 py-2 text-[11px] font-semibold"
                                style={{ background: C.inputBg, border: C.inputBorder, color: C.textDim }}
                              >
                                닫기
                              </button>
                            </div>
                            {cancelMsg && (
                              <p className="text-[11px]" style={{ color: cancelMsg.kind === 'ok' ? C.ok : C.danger }}>{cancelMsg.text}</p>
                            )}
                          </div>
                        )}
                        {cancelMsg && cancelConfirmId !== b.id && expanded && cancelMsg.kind === 'ok' && (
                          <p className="mt-2 text-[11px]" style={{ color: C.ok }}>{cancelMsg.text}</p>
                        )}
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
