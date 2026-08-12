import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { openDaumPostcode } from '@/lib/daumPostcode';
import { computeMoodTotalKRW, formatKRW, type MoodAirportCode, type MoodServiceType } from '@/lib/moodPricing';
import { MoodRouteMap } from '@/components/MoodRouteMap';

interface RouteData {
  km: number;
  tollKRW: number;
  durationMin: number;
  path: [number, number][];
  points: Array<{ lat: number; lng: number; role: 'origin' | 'waypoint' | 'destination'; index?: number }>;
}

export interface ChangeableMoodBooking {
  id: string;
  date: string;
  startTime: string;
  durationHours: number;
  serviceType: MoodServiceType;
  airportDirection?: 'pickup' | 'sending' | null;
  airportCode?: MoodAirportCode | null;
  amountKRW: number;
  revision?: number;
  influencerName?: string | null;
  coursePayers?: Array<'mood' | 'influencer'> | null;
  note?: string | null;
  breakdown?: {
    origin?: string | null;
    destination?: string | null;
    waypoints?: string[] | null;
  } | null;
}

interface Props {
  booking: ChangeableMoodBooking;
  balanceKRW: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

function makeRequestKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `mood-change-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fetchRoute(origin: string, destination: string, waypoints: string[]) {
  const query = new URLSearchParams({ origin, destination });
  if (waypoints.length) query.set('waypoints', waypoints.join('|'));
  const response = await authFetch(`/api/mood-route?${query.toString()}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) throw new Error(json.error || '경로를 계산하지 못했습니다.');
  return json.data as RouteData;
}

export function MoodBookingChangeModal({ booking, balanceKRW, onClose, onChanged }: Props) {
  const initialWaypoints = Array.isArray(booking.breakdown?.waypoints) ? booking.breakdown.waypoints.slice(0, 5) : [];
  const initialPayerCount = initialWaypoints.length + 2;
  const [date, setDate] = useState(booking.date || '');
  const [startTime, setStartTime] = useState(booking.startTime || '');
  const [durationHours, setDurationHours] = useState(Number(booking.durationHours) || 3);
  const [serviceType, setServiceType] = useState<MoodServiceType>(booking.serviceType || 'vehicle');
  const [airportDirection, setAirportDirection] = useState<'pickup' | 'sending'>(booking.airportDirection === 'sending' ? 'sending' : 'pickup');
  const [airportCode, setAirportCode] = useState<MoodAirportCode>(booking.airportCode === 'GMP' ? 'GMP' : 'ICN');
  const [origin, setOrigin] = useState(String(booking.breakdown?.origin || ''));
  const [destination, setDestination] = useState(String(booking.breakdown?.destination || ''));
  const [waypoints, setWaypoints] = useState<string[]>(initialWaypoints);
  const [influencerName, setInfluencerName] = useState(booking.influencerName || '');
  const [note, setNote] = useState(booking.note || '');
  const [reason, setReason] = useState('');
  const [coursePayers, setCoursePayers] = useState<Array<'mood' | 'influencer'>>(
    Array.isArray(booking.coursePayers) && booking.coursePayers.length === initialPayerCount
      ? booking.coursePayers.slice()
      : Array.from({ length: initialPayerCount }, (_, index) => index === 0 ? 'mood' : 'influencer'),
  );
  const [route, setRoute] = useState<RouteData | null>(null);
  const [directRoute, setDirectRoute] = useState<RouteData | null>(null);
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [routeError, setRouteError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const requestRef = useRef({ signature: '', key: '' });

  useEffect(() => {
    if (!origin.trim() || !destination.trim()) {
      const resetTimer = window.setTimeout(() => {
        setRoute(null);
        setDirectRoute(null);
        setRouteState('idle');
        setRouteError('');
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRouteState('loading');
      setRouteError('');
      try {
        const cleaned = waypoints.map((waypoint) => waypoint.trim()).filter(Boolean);
        const requests: Promise<RouteData>[] = [fetchRoute(origin.trim(), destination.trim(), cleaned)];
        if (serviceType === 'airport' && cleaned.length) requests.push(fetchRoute(origin.trim(), destination.trim(), []));
        const result = await Promise.all(requests);
        if (cancelled) return;
        setRoute(result[0]);
        setDirectRoute(result[1] || result[0]);
        setRouteState('ready');
      } catch (error) {
        if (cancelled) return;
        setRoute(null);
        setDirectRoute(null);
        setRouteState('error');
        setRouteError(error instanceof Error ? error.message : '경로를 계산하지 못했습니다.');
      }
    }, 550);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [origin, destination, waypoints, serviceType]);

  const estimate = useMemo(() => {
    const detourKm = serviceType === 'airport' && route && directRoute ? Math.max(0, route.km - directRoute.km) : 0;
    return computeMoodTotalKRW({
      serviceType,
      durationHours: serviceType === 'airport' ? 0 : durationHours,
      km: route?.km || 0,
      tollKRW: route?.tollKRW || 0,
      airportDetourKm: detourKm,
      airportCode,
    });
  }, [serviceType, durationHours, route, directRoute, airportCode]);

  const adjustment = estimate.amountKRW - booking.amountKRW;
  const nextBalance = balanceKRW - adjustment;
  const routeBlocked = !!(origin.trim() || destination.trim()) && routeState !== 'ready';
  const courseItems = [
    { address: origin.trim(), payerIndex: 0 },
    ...waypoints.map((waypoint, index) => ({ address: waypoint.trim(), payerIndex: index + 1 })),
    { address: destination.trim(), payerIndex: coursePayers.length - 1 },
  ].filter((item) => item.address);
  const coursePayerValues = courseItems.map((item, index) => coursePayers[item.payerIndex] || (index === 0 ? 'mood' : 'influencer'));
  const perCourseKRW = coursePayerValues.length ? Math.floor(estimate.amountKRW / coursePayerValues.length) : 0;
  const payerSplit = coursePayerValues.reduce((result, payer, index) => {
    const remainder = index === coursePayerValues.length - 1 ? estimate.amountKRW - perCourseKRW * coursePayerValues.length : 0;
    const amount = perCourseKRW + remainder;
    if (payer === 'mood') result.moodKRW += amount;
    else result.influencerKRW += amount;
    return result;
  }, { moodKRW: 0, influencerKRW: 0 });

  const selectAddress = async (setter: (value: string) => void) => {
    try {
      const selected = await openDaumPostcode();
      if (selected) setter(selected);
    } catch {
      setMessage('주소 검색창을 열지 못했습니다. 주소를 직접 입력해 주세요.');
    }
  };

  const submit = async () => {
    setMessage('');
    if (!date || !startTime) return setMessage('날짜와 시작 시각을 확인해 주세요.');
    if (!reason.trim()) return setMessage('변경 이유를 입력해 주세요.');
    if (!!origin.trim() !== !!destination.trim()) return setMessage('출발지와 도착지를 함께 입력해 주세요.');
    if (routeBlocked) return setMessage('동선 계산이 끝난 뒤 저장할 수 있습니다.');

    const payload = {
      bookingId: booking.id,
      expectedRevision: Number.isInteger(booking.revision) ? booking.revision : 0,
      reason: reason.trim(),
      booking: {
        date,
        startTime,
        durationHours: serviceType === 'airport' ? 0 : durationHours,
        serviceType,
        airportDirection: serviceType === 'airport' ? airportDirection : null,
        airportCode: serviceType === 'airport' ? airportCode : null,
        origin: origin.trim(),
        destination: destination.trim(),
        waypoints: waypoints.map((waypoint) => waypoint.trim()).filter(Boolean),
        influencerName: influencerName.trim(),
        note: note.trim(),
        coursePayers: coursePayerValues,
      },
    };
    const signature = JSON.stringify(payload);
    if (requestRef.current.signature !== signature) requestRef.current = { signature, key: makeRequestKey() };

    setSubmitting(true);
    try {
      const response = await authFetch('/api/mood-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: requestRef.current.key }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || '예약을 변경하지 못했습니다.');
      requestRef.current = { signature: '', key: '' };
      await onChanged();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '예약을 변경하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="예약 변경">
      <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-[#11131a] p-5 text-white shadow-2xl sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-violet-300">RESERVATION CHANGE</p>
            <h2 className="mt-1 text-2xl font-black">예약 내용 변경</h2>
            <p className="mt-1 text-sm text-slate-400">저장할 때 서버가 동선과 금액을 다시 계산하고 차액만 잔액에 반영합니다.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">닫기</button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          <label className="text-sm font-bold">시작 시각<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          <label className="text-sm font-bold">서비스
            <select value={serviceType} onChange={(event) => setServiceType(event.target.value as MoodServiceType)} className="mt-1 w-full rounded-xl border border-white/15 bg-[#181b25] px-3 py-3">
              <option value="vehicle">차량</option><option value="manager">매니저</option><option value="airport">공항</option>
            </select>
          </label>
          {serviceType === 'airport' ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm font-bold">공항<select value={airportCode} onChange={(event) => setAirportCode(event.target.value as MoodAirportCode)} className="mt-1 w-full rounded-xl border border-white/15 bg-[#181b25] px-3 py-3"><option value="ICN">인천공항</option><option value="GMP">김포공항</option></select></label>
              <label className="text-sm font-bold">방향<select value={airportDirection} onChange={(event) => setAirportDirection(event.target.value as 'pickup' | 'sending')} className="mt-1 w-full rounded-xl border border-white/15 bg-[#181b25] px-3 py-3"><option value="pickup">픽업</option><option value="sending">샌딩</option></select></label>
            </div>
          ) : (
            <label className="text-sm font-bold">이용 시간<input type="number" min={1} max={15} step={0.5} value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value) || 1)} className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          )}
          <label className="text-sm font-bold sm:col-span-2">탑승 인플루언서<input value={influencerName} maxLength={100} onChange={(event) => setInfluencerName(event.target.value)} placeholder="공유 화면에 표시할 이름" className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
        </div>

        <div className="mt-5 space-y-3 rounded-2xl bg-white/[0.04] p-4">
          {([['출발지', origin, setOrigin], ['도착지', destination, setDestination]] as const).map(([label, value, setter]) => (
            <label key={label} className="block text-sm font-bold">{label}
              <div className="mt-1 flex gap-2"><input value={value} maxLength={300} onChange={(event) => setter(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-3" /><button type="button" onClick={() => selectAddress(setter)} className="rounded-xl bg-white/10 px-4 text-sm font-bold">주소 검색</button></div>
            </label>
          ))}
          {waypoints.map((waypoint, index) => (
            <label key={`waypoint-${index}`} className="block text-sm font-bold">경유지 {index + 1}
              <div className="mt-1 flex gap-2"><input value={waypoint} maxLength={300} onChange={(event) => setWaypoints((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-3" /><button type="button" onClick={() => { setWaypoints((items) => items.filter((_, itemIndex) => itemIndex !== index)); setCoursePayers((items) => items.filter((_, itemIndex) => itemIndex !== index + 1)); }} className="rounded-xl bg-rose-500/15 px-3 text-rose-200">삭제</button></div>
            </label>
          ))}
          {waypoints.length < 5 && <button type="button" onClick={() => { setWaypoints((items) => [...items, '']); setCoursePayers((items) => [...items.slice(0, -1), 'influencer', items[items.length - 1] || 'influencer']); }} className="text-sm font-bold text-violet-300">+ 경유지 추가</button>}
          {routeState === 'loading' && <p className="text-xs text-slate-400">동선을 다시 계산하는 중…</p>}
          {routeState === 'error' && <p className="text-xs font-bold text-rose-300">{routeError}</p>}
          <MoodRouteMap origin={origin} destination={destination} waypoints={waypoints.map((waypoint) => waypoint.trim()).filter(Boolean)} route={route} accent="#a78bfa" inputBg="#171923" inputBorder="1px solid rgba(255,255,255,.12)" textDim="#94a3b8" />
          {courseItems.length >= 2 && (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-black">코스별 비용 부담자</p>
              <p className="mb-2 text-[10px] text-slate-400">총액을 {courseItems.length}개 번호 코스로 똑같이 나눕니다.</p>
              <div className="space-y-1.5">
                {courseItems.map((item, index) => {
                  const payer = coursePayers[item.payerIndex] || (index === 0 ? 'mood' : 'influencer');
                  return <div key={`${item.payerIndex}-${item.address}`} className="flex items-center gap-2 rounded-lg bg-white/5 p-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-[10px] font-black">{index + 1}</span><span className="min-w-0 flex-1 truncate text-[11px]">{item.address}</span><button type="button" onClick={() => setCoursePayers((items) => items.map((value, payerIndex) => payerIndex === item.payerIndex ? (payer === 'mood' ? 'influencer' : 'mood') : value))} className={`rounded-full px-2 py-1 text-[10px] font-black ${payer === 'mood' ? 'bg-violet-400/20 text-violet-200' : 'bg-pink-400/20 text-pink-200'}`}>{payer === 'mood' ? 'MOOD 직원' : '인플루언서'}</button></div>;
                })}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs"><div className="rounded-lg bg-violet-400/10 p-2"><p className="text-[9px] text-slate-400">MOOD 직원</p><p className="font-black text-violet-200">{formatKRW(payerSplit.moodKRW)}</p></div><div className="rounded-lg bg-pink-400/10 p-2"><p className="text-[9px] text-slate-400">인플루언서</p><p className="font-black text-pink-200">{formatKRW(payerSplit.influencerKRW)}</p></div></div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4 text-center">
          <div><p className="text-xs text-slate-400">변경 전</p><p className="mt-1 font-black">{formatKRW(booking.amountKRW)}</p></div>
          <div><p className="text-xs text-slate-400">변경 후 예상</p><p className="mt-1 font-black text-violet-200">{formatKRW(estimate.amountKRW)}</p></div>
          <div><p className="text-xs text-slate-400">잔액 변화</p><p className={`mt-1 font-black ${adjustment > 0 ? 'text-rose-300' : adjustment < 0 ? 'text-emerald-300' : ''}`}>{adjustment === 0 ? '변동 없음' : `${adjustment > 0 ? '-' : '+'}${formatKRW(Math.abs(adjustment))}`}</p></div>
          <p className="col-span-3 mt-2 border-t border-white/10 pt-2 text-xs text-slate-300">변경 뒤 예상 잔액 {formatKRW(nextBalance)} · 최종 금액은 서버 계산값으로 확정</p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">예약 메모<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          <label className="text-sm font-bold">변경 이유 <span className="text-rose-300">필수</span><textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="예: 촬영지 변경으로 도착지 수정" className="mt-1 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
        </div>
        {message && <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200">{message}</p>}
        <button type="button" onClick={submit} disabled={submitting || routeBlocked} className="mt-5 w-full rounded-2xl bg-violet-500 py-4 text-base font-black text-white disabled:cursor-not-allowed disabled:opacity-45">{submitting ? '변경 저장 중…' : '변경 내용과 차액 확인 후 저장'}</button>
      </div>
    </div>
  );
}
