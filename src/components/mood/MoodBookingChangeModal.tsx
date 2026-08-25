import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, RotateCcw, Search, X } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { openDaumPostcode } from '@/lib/daumPostcode';
import { computeMoodTotalKRW, formatKRW, type MoodAirportCode, type MoodServiceType } from '@/lib/moodPricing';
import { MoodRouteMap } from '@/components/MoodRouteMap';
import { MoodCourseShareEditor } from '@/components/mood/MoodCourseShareEditor';
import { normalizeMoodCoursePercentages } from '@/lib/moodBookingShare';
import {
  MOOD_EVENING_BLACKOUT_NOTICE,
  isMoodEveningBookingBlocked,
  moodKstDateISO,
  shouldShowMoodEveningBlackoutNotice,
} from '@/lib/moodBookingAvailability';

interface RouteData {
  km: number;
  tollKRW: number;
  durationMin: number;
  path: [number, number][];
  points: Array<{ lat: number; lng: number; role: 'origin' | 'waypoint' | 'destination'; index?: number }>;
}

interface MoodRouteStop {
  id: string;
  address: string;
  moodPercentage: number;
}

interface RemovedMoodRouteStop {
  stop: MoodRouteStop;
  index: number;
}

interface RouteCalculationState {
  signature: string;
  state: 'idle' | 'loading' | 'ready' | 'error';
  route: RouteData | null;
  directRoute: RouteData | null;
  error: string;
}

const MAX_ROUTE_STOPS = 7;
let addedRouteStopSequence = 0;

function routeStopRole(index: number, count: number) {
  if (index === 0) return '출발지';
  if (index === count - 1) return '도착지';
  return `경유지 ${index}`;
}

function reorderMoodRouteStops<T extends { id: string }>(items: T[], activeId: string, overId: string) {
  const fromIndex = items.findIndex((item) => item.id === activeId);
  const toIndex = items.findIndex((item) => item.id === overId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
  return arrayMove(items, fromIndex, toIndex);
}

interface SortableRouteStopProps {
  stop: MoodRouteStop;
  index: number;
  count: number;
  canRemove: boolean;
  onAddressChange: (id: string, address: string) => void;
  onSelectAddress: (id: string) => void;
  onRemove: (id: string) => void;
}

function SortableRouteStop({
  stop,
  index,
  count,
  canRemove,
  onAddressChange,
  onSelectAddress,
  onRemove,
}: SortableRouteStopProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.id });
  const label = routeStopRole(index, count);
  const inputId = `${stop.id}-address`;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.62 : 1,
    zIndex: isDragging ? 30 : 0,
  };
  const markerClass = index === 0
    ? 'bg-emerald-400'
    : index === count - 1
      ? 'bg-rose-400'
      : 'bg-amber-400';
  const describedBy = [attributes['aria-describedby'], 'mood-route-reorder-help'].filter(Boolean).join(' ');

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="mood-route-stop"
      data-route-stop-id={stop.id}
      className={`relative bg-white/[0.025] p-2.5 ${isDragging ? 'z-30 rounded-2xl ring-2 ring-violet-300 shadow-xl shadow-violet-950/40' : ''}`}
    >
      <div className="flex items-center gap-2">
        <button
          id={`${stop.id}-reorder`}
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`${index + 1}번 ${label} 순서 이동`}
          aria-describedby={describedBy}
          title="끌어서 순서 변경"
          className="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 outline-none transition active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="mb-1 flex items-center gap-1.5 text-xs font-black text-white">
            <span className={`h-2 w-2 rounded-full ${markerClass}`} aria-hidden="true" />
            <span>{index + 1}. {label}</span>
          </label>
          <div className="relative">
            <input
              id={inputId}
              value={stop.address}
              maxLength={300}
              onChange={(event) => onAddressChange(stop.id, event.target.value)}
              placeholder={`${label}를 입력하세요`}
              className="min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-black/20 py-2 pl-3 pr-12 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-300 focus:ring-1 focus:ring-violet-300"
            />
            <button
              type="button"
              onClick={() => onSelectAddress(stop.id)}
              aria-label={`${index + 1}번 ${label} 주소 검색`}
              title="주소 검색"
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-slate-200 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(stop.id)}
            aria-label={`${index + 1}번 ${label} 삭제`}
            title="장소 삭제"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-200 outline-none transition hover:bg-rose-500/25 focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
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
  courseMoodPercentages?: number[] | null;
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
  const showEveningBlackoutNotice = shouldShowMoodEveningBlackoutNotice(moodKstDateISO());
  const initialWaypoints = Array.isArray(booking.breakdown?.waypoints) ? booking.breakdown.waypoints.slice(0, 5) : [];
  const initialPayerCount = initialWaypoints.length + 2;
  const initialCourseMoodPercentages = normalizeMoodCoursePercentages(
    booking.courseMoodPercentages,
    initialPayerCount,
    booking.coursePayers,
    booking.serviceType === 'airport' ? 50 : 100,
  );
  const initialRouteAddresses = [
    String(booking.breakdown?.origin || ''),
    ...initialWaypoints,
    String(booking.breakdown?.destination || ''),
  ];
  const safeBookingId = String(booking.id || 'booking').replace(/[^a-zA-Z0-9_-]/g, '-');
  const [date, setDate] = useState(booking.date || '');
  const [startTime, setStartTime] = useState(booking.startTime || '');
  const [durationHours, setDurationHours] = useState(Number(booking.durationHours) || 3);
  const [serviceType, setServiceType] = useState<MoodServiceType>(booking.serviceType || 'vehicle');
  const [airportDirection, setAirportDirection] = useState<'pickup' | 'sending'>(booking.airportDirection === 'sending' ? 'sending' : 'pickup');
  const [airportCode, setAirportCode] = useState<MoodAirportCode>(booking.airportCode === 'GMP' ? 'GMP' : 'ICN');
  const [routeStops, setRouteStops] = useState<MoodRouteStop[]>(() => initialRouteAddresses.map((address, index) => ({
    id: `mood-route-stop-${safeBookingId}-${index}`,
    address,
    moodPercentage: initialCourseMoodPercentages[index],
  })));
  const [removedRouteStop, setRemovedRouteStop] = useState<RemovedMoodRouteStop | null>(null);
  const [routeAnnouncement, setRouteAnnouncement] = useState('');
  const [influencerName, setInfluencerName] = useState(booking.influencerName || '');
  const [note, setNote] = useState(booking.note || '');
  const [reason, setReason] = useState('');
  const [routeCalculation, setRouteCalculation] = useState<RouteCalculationState>({
    signature: '',
    state: 'idle',
    route: null,
    directRoute: null,
    error: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const requestRef = useRef({ signature: '', key: '' });
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const routeAddresses = routeStops.map((stop) => stop.address.trim());
  const origin = routeAddresses[0] || '';
  const destination = routeAddresses[routeAddresses.length - 1] || '';
  const waypoints = routeAddresses.slice(1, -1);
  const routeStarted = routeAddresses.some(Boolean);
  const routeComplete = routeStarted && routeAddresses.every(Boolean);
  const routeSignature = JSON.stringify({ serviceType, addresses: routeAddresses });

  useEffect(() => {
    const parsed = JSON.parse(routeSignature) as { serviceType: MoodServiceType; addresses: string[] };
    const requestedAddresses = parsed.addresses;
    const requestedOrigin = requestedAddresses[0] || '';
    const requestedDestination = requestedAddresses[requestedAddresses.length - 1] || '';
    const requestedWaypoints = requestedAddresses.slice(1, -1);
    const requestedRouteStarted = requestedAddresses.some(Boolean);
    const requestedRouteComplete = requestedRouteStarted && requestedAddresses.every(Boolean);

    if (!requestedRouteComplete) {
      const resetTimer = window.setTimeout(() => {
        setRouteCalculation({
          signature: routeSignature,
          state: 'idle',
          route: null,
          directRoute: null,
          error: '',
        });
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRouteCalculation({
        signature: routeSignature,
        state: 'loading',
        route: null,
        directRoute: null,
        error: '',
      });
      try {
        const requests: Promise<RouteData>[] = [fetchRoute(requestedOrigin, requestedDestination, requestedWaypoints)];
        if (parsed.serviceType === 'airport' && requestedWaypoints.length) {
          requests.push(fetchRoute(requestedOrigin, requestedDestination, []));
        }
        const result = await Promise.all(requests);
        if (cancelled) return;
        setRouteCalculation({
          signature: routeSignature,
          state: 'ready',
          route: result[0],
          directRoute: result[1] || result[0],
          error: '',
        });
      } catch (error) {
        if (cancelled) return;
        setRouteCalculation({
          signature: routeSignature,
          state: 'error',
          route: null,
          directRoute: null,
          error: error instanceof Error ? error.message : '경로를 계산하지 못했습니다.',
        });
      }
    }, 550);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [routeSignature]);

  const hasFreshRoute = routeComplete
    && routeCalculation.signature === routeSignature
    && routeCalculation.state === 'ready'
    && !!routeCalculation.route;
  const currentRouteState = !routeComplete
    ? 'idle'
    : routeCalculation.signature === routeSignature
      ? routeCalculation.state
      : 'loading';
  const route = hasFreshRoute ? routeCalculation.route : null;
  const directRoute = hasFreshRoute ? routeCalculation.directRoute : null;
  const routeError = routeCalculation.signature === routeSignature ? routeCalculation.error : '';
  const estimateReady = !routeStarted || hasFreshRoute;

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
  const routeBlocked = routeStarted && !hasFreshRoute;
  const originalTimeIsGrandfathered = isMoodEveningBookingBlocked(booking.date, booking.startTime);
  const keepsGrandfatheredTime = originalTimeIsGrandfathered
    && date === booking.date
    && startTime === booking.startTime;
  const eveningBookingBlocked = isMoodEveningBookingBlocked(date, startTime) && !keepsGrandfatheredTime;
  const courseMoodPercentages = routeStops.map((stop) => stop.moodPercentage);
  const courseItems = routeStops
    .map((stop, index) => ({ address: stop.address.trim(), percentageIndex: index }))
    .filter((item) => item.address);
  const activeRouteStops = routeStarted
    ? [routeStops[0], ...routeStops.slice(1, -1).filter((stop) => stop.address.trim()), routeStops[routeStops.length - 1]]
    : [];
  const courseMoodPercentageValues = activeRouteStops.map((stop) => stop.moodPercentage);

  const updateRouteStopAddress = (id: string, address: string) => {
    setRouteStops((items) => items.map((item) => item.id === id ? { ...item, address } : item));
  };

  const selectAddress = async (id: string) => {
    try {
      const selected = await openDaumPostcode();
      if (selected) updateRouteStopAddress(id, selected);
    } catch {
      setMessage('주소 검색창을 열지 못했습니다. 주소를 직접 입력해 주세요.');
    }
  };

  const updateCourseMoodPercentages = (next: number[]) => {
    const percentageById = new Map(routeStops.map((stop, index) => [stop.id, next[index]]));
    setRouteStops((items) => items.map((item) => {
      const percentage = percentageById.get(item.id);
      return typeof percentage === 'number' ? { ...item, moodPercentage: percentage } : item;
    }));
  };

  const addRouteStop = () => {
    if (routeStops.length >= MAX_ROUTE_STOPS) return;
    const destinationStop = routeStops[routeStops.length - 1];
    const inheritedPercentage = destinationStop && typeof destinationStop.moodPercentage === 'number'
      ? destinationStop.moodPercentage
      : 100;
    addedRouteStopSequence += 1;
    const newStop: MoodRouteStop = {
      id: `mood-route-stop-added-${addedRouteStopSequence}`,
      address: '',
      moodPercentage: inheritedPercentage,
    };
    setRouteStops((items) => [...items.slice(0, -1), newStop, items[items.length - 1]]);
    setRemovedRouteStop(null);
    setRouteAnnouncement('새 경유지를 도착지 앞에 추가했습니다.');
    window.setTimeout(() => document.getElementById(`${newStop.id}-address`)?.focus(), 0);
  };

  const removeRouteStop = (id: string) => {
    if (routeStops.length <= 2) return;
    const index = routeStops.findIndex((stop) => stop.id === id);
    if (index < 0) return;
    const stop = routeStops[index];
    const nextFocusStop = routeStops[index + 1] || routeStops[index - 1];
    setRouteStops((items) => items.filter((item) => item.id !== id));
    setRemovedRouteStop({ stop, index });
    setRouteAnnouncement(`${stop.address.trim() || '빈 장소'}를 삭제했습니다. 되돌릴 수 있습니다.`);
    window.setTimeout(() => document.getElementById(`${nextFocusStop.id}-reorder`)?.focus(), 0);
  };

  const undoRemoveRouteStop = () => {
    if (!removedRouteStop || routeStops.length >= MAX_ROUTE_STOPS) return;
    const insertAt = Math.min(removedRouteStop.index, routeStops.length);
    const restoredStop = removedRouteStop.stop;
    setRouteStops((items) => [
      ...items.slice(0, insertAt),
      restoredStop,
      ...items.slice(insertAt),
    ]);
    setRemovedRouteStop(null);
    setRouteAnnouncement(`${restoredStop.address.trim() || '빈 장소'}를 다시 넣었습니다.`);
    window.setTimeout(() => document.getElementById(`${restoredStop.id}-address`)?.focus(), 0);
  };

  const describeRouteStop = (id: string) => {
    const index = routeStops.findIndex((stop) => stop.id === id);
    if (index < 0) return '장소';
    const stop = routeStops[index];
    return `${index + 1}번 ${routeStopRole(index, routeStops.length)} ${stop.address.trim() || '빈 장소'}`;
  };
  const routeAnnouncements: Announcements = {
    onDragStart: ({ active }) => `${describeRouteStop(String(active.id))} 순서 이동을 시작했습니다.`,
    onDragOver: ({ active, over }) => over
      ? `${describeRouteStop(String(active.id))}을 ${describeRouteStop(String(over.id))} 위치로 이동합니다.`
      : `${describeRouteStop(String(active.id))}이 이동 가능한 위치에서 벗어났습니다.`,
    onDragEnd: ({ active, over }) => over
      ? `${describeRouteStop(String(active.id))}을 ${describeRouteStop(String(over.id))} 위치에 놓았습니다.`
      : `${describeRouteStop(String(active.id))} 순서 이동을 끝냈습니다.`,
    onDragCancel: ({ active }) => `${describeRouteStop(String(active.id))} 순서 이동을 취소했습니다.`,
  };

  const handleRouteDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    setRouteStops((items) => reorderMoodRouteStops(items, activeId, overId));
    setRemovedRouteStop(null);
  };

  const submit = async () => {
    setMessage('');
    if (!date || !startTime) return setMessage('날짜와 시작 시각을 확인해 주세요.');
    if (eveningBookingBlocked) return setMessage('선택한 날짜에는 오후 6시 이후 시작 예약으로 변경할 수 없습니다. 시작 시각을 오후 6시 전으로 바꿔 주세요.');
    if (!reason.trim()) return setMessage('변경 이유를 입력해 주세요.');
    if (routeStarted && !routeComplete) return setMessage('경로의 빈 장소를 모두 입력하거나 삭제해 주세요.');
    if (routeBlocked) return setMessage('동선 계산이 끝난 뒤 저장할 수 있습니다.');

    const payloadOrigin = activeRouteStops[0]?.address.trim() || '';
    const payloadDestination = activeRouteStops[activeRouteStops.length - 1]?.address.trim() || '';
    const payloadWaypoints = activeRouteStops.slice(1, -1).map((stop) => stop.address.trim()).filter(Boolean);

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
        origin: payloadOrigin,
        destination: payloadDestination,
        waypoints: payloadWaypoints,
        influencerName: influencerName.trim(),
        note: note.trim(),
        courseMoodPercentages: courseMoodPercentageValues,
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
          <button type="button" onClick={onClose} className="min-h-11 shrink-0 whitespace-nowrap rounded-full bg-white/10 px-4 text-sm outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-violet-300">닫기</button>
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

        {showEveningBlackoutNotice && <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3" role="note">
          <p className="text-xs font-bold text-amber-200">📌 {MOOD_EVENING_BLACKOUT_NOTICE}</p>
          <p className="mt-1 text-[11px] text-slate-300">오후 6시 전 시작은 가능하며, 이미 확정된 예약은 그대로 유효합니다.</p>
        </div>}

        {eveningBookingBlocked && (
          <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200" role="alert">
            선택한 날짜에는 오후 6시 이후 시작 예약으로 변경할 수 없습니다. 시작 시각을 오후 6시 전으로 바꿔 주세요.
          </p>
        )}
        {keepsGrandfatheredTime && (
          <p className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-xs font-bold text-emerald-200" role="status">
            기존 확정 예약의 날짜·시각을 유지해 주소·메모 등 다른 내용은 변경할 수 있습니다. 날짜나 시각을 바꾸면 새 제한 규칙이 적용됩니다.
          </p>
        )}

        <section className="mt-5 rounded-2xl bg-white/[0.04] p-3 sm:p-4" aria-labelledby="mood-route-title">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 id="mood-route-title" className="text-sm font-black text-white">이동 경로</h3>
              <p id="mood-route-reorder-help" className="mt-1 text-[11px] leading-relaxed text-slate-400">
                손잡이를 끌어 순서를 바꾸세요. 맨 앞은 출발지, 맨 뒤는 도착지가 됩니다.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-black text-slate-300">{routeStops.length}/7</span>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleRouteDragEnd}
            accessibility={{
              screenReaderInstructions: {
                draggable: '순서를 바꾸려면 스페이스를 누르고 방향키로 이동한 뒤 다시 스페이스를 누르세요.',
              },
              announcements: routeAnnouncements,
            }}
          >
            <SortableContext items={routeStops.map((stop) => stop.id)} strategy={verticalListSortingStrategy}>
              <ol className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10" aria-label="예약 이동 경로">
                {routeStops.map((stop, index) => (
                  <SortableRouteStop
                    key={stop.id}
                    stop={stop}
                    index={index}
                    count={routeStops.length}
                    canRemove={routeStops.length > 2}
                    onAddressChange={updateRouteStopAddress}
                    onSelectAddress={selectAddress}
                    onRemove={removeRouteStop}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>

          {routeStops.length < MAX_ROUTE_STOPS ? (
            <button
              type="button"
              onClick={addRouteStop}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-violet-300/35 bg-violet-400/10 px-4 text-sm font-black text-violet-200 outline-none hover:bg-violet-400/15 focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> 장소 추가
            </button>
          ) : (
            <p className="mt-3 text-center text-xs font-bold text-slate-400" role="status">장소는 최대 7곳까지 추가할 수 있습니다.</p>
          )}

          {removedRouteStop && (
            <div className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3" role="status">
              <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-200">
                {removedRouteStop.stop.address.trim() || '빈 장소'} 삭제됨
              </p>
              <button
                type="button"
                onClick={undoRemoveRouteStop}
                className="flex min-h-11 shrink-0 items-center gap-1 px-2 text-xs font-black text-violet-200 outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> 되돌리기
              </button>
            </div>
          )}
          <p className="sr-only" aria-live="polite">{routeAnnouncement}</p>

          {routeStarted && !routeComplete && (
            <p className="mt-3 text-xs font-bold text-amber-200" role="status">빈 장소를 입력하거나 삭제하면 동선을 계산합니다.</p>
          )}
          {currentRouteState === 'loading' && <p className="mt-3 text-xs text-slate-400" role="status">새 순서로 동선을 다시 계산하는 중…</p>}
          {currentRouteState === 'error' && <p className="mt-3 text-xs font-bold text-rose-300" role="alert">{routeError}</p>}
          {hasFreshRoute && route && (
            <p className="mt-3 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-200" role="status">
              동선 {route.km}km · 약 {route.durationMin}분 · 예상 통행료 {formatKRW(route.tollKRW)}
            </p>
          )}
          <div className="mt-3">
            <MoodRouteMap origin={origin} destination={destination} waypoints={waypoints.filter(Boolean)} route={route} accent="#a78bfa" inputBg="#171923" inputBorder="1px solid rgba(255,255,255,.12)" textDim="#94a3b8" />
          </div>
          {courseItems.length >= 2 && estimateReady && (
            <div className="mt-3">
              <MoodCourseShareEditor
                items={courseItems}
                percentages={courseMoodPercentages}
                totalKRW={estimate.amountKRW}
                influencerName={influencerName}
                onChange={updateCourseMoodPercentages}
              />
            </div>
          )}
          {courseItems.length >= 2 && !estimateReady && (
            <p className="mt-3 text-xs text-slate-400">비용 분담 금액도 새 동선 계산 후 함께 갱신됩니다.</p>
          )}
        </section>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4 text-center">
          <div><p className="text-xs text-slate-400">변경 전</p><p className="mt-1 font-black">{formatKRW(booking.amountKRW)}</p></div>
          <div><p className="text-xs text-slate-400">변경 후 예상</p><p className="mt-1 font-black text-violet-200">{estimateReady ? formatKRW(estimate.amountKRW) : '계산 중…'}</p></div>
          <div><p className="text-xs text-slate-400">잔액 변화</p><p className={`mt-1 font-black ${!estimateReady ? 'text-slate-400' : adjustment > 0 ? 'text-rose-300' : adjustment < 0 ? 'text-emerald-300' : ''}`}>{!estimateReady ? '계산 대기' : adjustment === 0 ? '변동 없음' : `${adjustment > 0 ? '-' : '+'}${formatKRW(Math.abs(adjustment))}`}</p></div>
          <p className="col-span-3 mt-2 border-t border-white/10 pt-2 text-xs text-slate-300">
            {estimateReady ? `변경 뒤 예상 잔액 ${formatKRW(nextBalance)} · 최종 금액은 서버 계산값으로 확정` : '새 동선 계산이 끝나면 예상 잔액을 표시합니다.'}
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">예약 메모<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          <label className="text-sm font-bold">변경 이유 <span className="text-rose-300">필수</span><textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="예: 촬영지 변경으로 도착지 수정" className="mt-1 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
        </div>
        {message && <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200">{message}</p>}
        <button type="button" onClick={submit} disabled={submitting || routeBlocked || eveningBookingBlocked} className="mt-5 min-h-14 w-full rounded-2xl bg-violet-500 px-4 text-base font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-45">{submitting ? '변경 저장 중…' : eveningBookingBlocked ? '오후 6시 이후 변경 불가' : routeStarted && !routeComplete ? '빈 장소를 확인해 주세요' : routeBlocked ? '동선 계산을 기다려 주세요' : '변경 내용과 차액 확인 후 저장'}</button>
      </div>
    </div>
  );
}
