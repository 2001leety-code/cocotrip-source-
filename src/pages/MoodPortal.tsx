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
import {
  MOOD_RATES,
  MOOD_MAX_DURATION_HOURS,
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
  /** 이 예약 직후 잔액 (백엔드 mood-data 가 최신순으로 running 계산해 내려줌). */
  running?: number;
}

interface MoodData {
  clientId: string;
  client: { name: string; balanceKRW: number };
  bookings: MoodBooking[];
  isAdmin: boolean;
}

/** /api/mood-route 응답 (계약: { ok, km, tollKRW, durationMin } | { ok:false, error }). */
interface MoodRoute {
  km: number;
  tollKRW: number;
  durationMin: number;
}

const SERVICE_LABEL: Record<MoodServiceType, string> = {
  vehicle: '차량',
  manager: '매니저',
};

function todayISO(): string {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

/** 음수 잔액은 빨강 마이너스로 — "-123,000원". */
function formatBalance(n: number): string {
  const v = Math.round(Number(n) || 0);
  if (v < 0) return `-${Math.abs(v).toLocaleString('ko-KR')}원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

export default function MoodPortal() {
  const { user, loading } = useAuth();

  const [data, setData] = useState<MoodData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  // 예약 폼 상태
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('10:00');
  const [durationHours, setDurationHours] = useState(2);
  const [serviceType, setServiceType] = useState<MoodServiceType>('manager');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 경로(주소) 입력 상태
  const [origin, setOrigin] = useState('');
  const [waypoints, setWaypoints] = useState(''); // "A | B" — 선택, | 구분
  const [destination, setDestination] = useState('');
  const [route, setRoute] = useState<MoodRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const routeSeq = useRef(0); // 경합 방지 — 최신 요청만 반영

  // 충전 폼 상태 (admin)
  const [topupClientId, setTopupClientId] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [topupSubmitting, setTopupSubmitting] = useState(false);
  const [topupMsg, setTopupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
      if (json.data?.clientId && !topupClientId) setTopupClientId(json.data.clientId);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setDataLoading(false);
    }
  }, [topupClientId]);

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
      if (!o || !d) {
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
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean)
          .join('|');
        if (wp) params.set('waypoints', wp);
        const res = await authFetch(`/api/mood-route?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (seq !== routeSeq.current) return; // 더 최신 요청이 있으면 폐기
        if (json?.ok) {
          setRoute({
            km: Number(json.km) || 0,
            tollKRW: Number(json.tollKRW) || 0,
            durationMin: Number(json.durationMin) || 0,
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
  }, [origin, waypoints, destination]);

  const handleBook = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setFormMsg(null);
    try {
      const wp = waypoints
        .split('|')
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
  }, [data, date, startTime, durationHours, serviceType, origin, destination, waypoints, loadData]);

  const handleTopup = useCallback(async () => {
    setTopupSubmitting(true);
    setTopupMsg(null);
    try {
      const res = await authFetch('/api/mood-topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: topupClientId.trim(), amountKRW: Number(topupAmount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setTopupMsg({ kind: 'ok', text: `충전 완료 — 잔액 ${formatBalance(json.data.balanceKRW)}` });
        setTopupAmount('');
        await loadData(data?.clientId);
      } else {
        setTopupMsg({ kind: 'err', text: json?.error || `충전 실패 (${res.status})` });
      }
    } catch (e) {
      setTopupMsg({ kind: 'err', text: e instanceof Error ? e.message : '충전 실패' });
    } finally {
      setTopupSubmitting(false);
    }
  }, [topupClientId, topupAmount, data, loadData]);

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

        {/* 예약 폼 */}
        <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: C.card, border: C.cardBorder }}>
          <h2 className="text-sm font-bold" style={{ color: C.text }}>예약하기</h2>

          {/* 서비스 토글 */}
          <div className="grid grid-cols-2 gap-2">
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
                    {formatKRW(MOOD_RATES[st])}/시간
                  </span>
                </button>
              );
            })}
          </div>

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

          {/* 시간 (duration) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: C.textDim }}>이용 시간</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDurationHours((h) => Math.max(1, h - 1))}
                className="w-10 h-10 rounded-xl text-lg font-bold shrink-0"
                style={inputStyle}
                aria-label="시간 감소"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={MOOD_MAX_DURATION_HOURS}
                value={durationHours}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) setDurationHours(Math.min(MOOD_MAX_DURATION_HOURS, Math.max(1, v)));
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

          {/* 경로 (출발 / 경유 / 도착) — 거리/톨비 자동 계산 */}
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-xs" style={{ color: C.textDim }}>경로 <span className="opacity-70">(거리 추가요금·톨비 자동 계산)</span></span>
            <input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="출발지 (예: 강남역)"
              className="rounded-xl px-3 py-2.5 text-sm"
              style={inputStyle}
            />
            <input
              value={waypoints}
              onChange={(e) => setWaypoints(e.target.value)}
              placeholder="경유지 (선택, | 로 구분)"
              className="rounded-xl px-3 py-2.5 text-sm"
              style={inputStyle}
            />
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="도착지 (예: 인천공항)"
              className="rounded-xl px-3 py-2.5 text-sm"
              style={inputStyle}
            />
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
          </div>

          {/* 예상 금액 분해 */}
          <div className="rounded-xl px-3 py-3 flex flex-col gap-1.5" style={{ background: C.inputBg, border: C.inputBorder }}>
            <div className="flex items-center justify-between text-xs" style={{ color: C.textDim }}>
              <span>{SERVICE_LABEL[serviceType]} {durationHours}시간 ({formatKRW(MOOD_RATES[serviceType])}/시간)</span>
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

        {/* 차감 내역 (ledger) — 각 예약 분해 + 차감액 + 잔액(running) */}
        <div className="rounded-2xl p-5" style={{ background: C.card, border: C.cardBorder }}>
          <h2 className="text-sm font-bold mb-3" style={{ color: C.text }}>차감 내역</h2>
          {!data || data.bookings.length === 0 ? (
            <p className="text-xs" style={{ color: C.textDim }}>예약 내역이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.bookings.map((b) => {
                const bd = b.breakdown;
                const routeText = bd?.origin || bd?.destination
                  ? `${bd?.origin || '?'} → ${bd?.destination || '?'}`
                  : null;
                return (
                  <li
                    key={b.id}
                    className="rounded-xl px-3 py-2.5"
                    style={{ background: C.inputBg, border: C.inputBorder }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: C.text }}>
                          {b.date} · {b.startTime}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: C.textDim }}>
                          {SERVICE_LABEL[b.serviceType] || b.serviceType} {b.durationHours}시간 · {b.createdByEmail}
                        </p>
                        {routeText && (
                          <p className="text-[11px] truncate" style={{ color: C.textDim }}>{routeText}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-bold" style={{ color: C.danger }}>
                          −{formatKRW(b.amountKRW)}
                        </span>
                        {typeof b.running === 'number' && (
                          <p className="text-[11px]" style={{ color: b.running < 0 ? C.danger : C.textDim }}>
                            잔액 {formatBalance(b.running)}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* 분해: 시급/거리추가/톨비 (값 있을 때만) */}
                    {bd && (bd.baseKRW != null || bd.distanceSurchargeKRW || bd.tollKRW) && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" style={{ color: C.textDim }}>
                        {bd.baseKRW != null && <span>시급 {formatKRW(bd.baseKRW)}</span>}
                        {!!bd.distanceSurchargeKRW && (
                          <span>거리 +{formatKRW(bd.distanceSurchargeKRW)}{bd.km ? ` (${bd.km}km)` : ''}</span>
                        )}
                        {!!bd.tollKRW && <span>톨비 +{formatKRW(bd.tollKRW)}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 충전 (admin 전용) */}
        {data?.isAdmin && (
          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: C.card, border: '1px solid rgba(234,83,126,0.25)' }}>
            <h2 className="text-sm font-bold" style={{ color: C.text }}>잔액 충전 <span className="text-[11px] font-normal" style={{ color: C.textDim }}>(운영자)</span></h2>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>clientId</span>
              <input
                value={topupClientId}
                onChange={(e) => setTopupClientId(e.target.value)}
                className="rounded-xl px-3 py-2.5 text-sm"
                style={inputStyle}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>충전 금액 (원)</span>
              <input
                type="number"
                min={1}
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="예: 1000000"
                className="rounded-xl px-3 py-2.5 text-sm"
                style={inputStyle}
              />
            </label>
            <button
              onClick={() => { void handleTopup(); }}
              disabled={topupSubmitting || !topupClientId.trim() || !(Number(topupAmount) > 0)}
              className="w-full py-3 rounded-xl font-bold transition-all hover:scale-[1.01] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #EA537E, #7C5CFC)', color: '#fff' }}
            >
              {topupSubmitting ? '충전 중…' : '충전하기'}
            </button>
            {topupMsg && (
              <p className="text-xs text-center" style={{ color: topupMsg.kind === 'ok' ? C.ok : C.danger }}>
                {topupMsg.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
