import { useEffect, useRef, useState } from 'react';
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
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ClipboardPaste,
  GripVertical,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { openDaumPostcode } from '@/lib/daumPostcode';
import { formatKRW, type MoodAirportCode, type MoodServiceType } from '@/lib/moodPricing';
import { MoodRouteMap } from '@/components/MoodRouteMap';
import { MoodCourseShareEditor } from '@/components/mood/MoodCourseShareEditor';
import { normalizeMoodCoursePercentages } from '@/lib/moodBookingShare';
import {
  createMoodRouteSchedule,
  formatMoodRouteScheduleStopSummary,
  formatMoodRouteScheduleText,
  formatMoodRouteWait,
  getMoodRouteWaitMinutes,
  normalizeMoodRouteSchedule,
  parseMoodRouteScheduleText,
  setMoodRouteStopWaitMinutes,
  validateMoodRouteSchedule,
  type MoodRouteScheduleStop,
} from '@/lib/moodRouteSchedule';
import {
  MOOD_BOOKING_AVAILABILITY_UNAVAILABLE_MESSAGE,
  formatMoodBookingRuleSummary,
  getMoodBookingBlockStatus,
  getMoodBookingNoticeRules,
  isMoodBookingChangeBlocked,
  moodKstDateISO,
  type MoodBookingAvailability,
} from '@/lib/moodBookingAvailability';

interface RouteData {
  km: number;
  tollKRW: number;
  durationMin: number;
  path: [number, number][];
  points: Array<{ lat: number; lng: number; role: 'origin' | 'waypoint' | 'destination'; index?: number }>;
}

interface MoodRouteStop extends MoodRouteScheduleStop {
  id: string;
  address: string;
  moodPercentage: number;
}

interface MoodSchedulePreview {
  source: 'text' | 'ai';
  date: string | null;
  startTime: string | null;
  addresses: string[];
  routeSchedule: MoodRouteScheduleStop[];
  warnings: string[];
}

interface MoodParsedScheduleStop {
  address?: string;
  label?: string;
  action?: 'pickup' | 'dropoff' | 'via' | 'arrive';
  timeHint?: string;
  date?: string | null;
  geocodeOk?: boolean;
}

interface RemovedMoodRouteStop {
  stop: MoodRouteStop;
  index: number;
  scheduleById: Record<string, MoodRouteScheduleStop>;
}

interface MoodChangeQuote {
  quoteId: string;
  expectedRevision: number;
  expiresAt: number;
  oldAmountKRW: number;
  amountKRW: number;
  adjustmentKRW: number;
  balanceKRW: number;
  breakdown: Record<string, unknown>;
  routeSnapshot: RouteData | null;
  changedFields: string[];
  requestSignature: string;
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
  canInsertAfter: boolean;
  isExpanded: boolean;
  isRecentlyMoved: boolean;
  onAddressChange: (id: string, address: string) => void;
  onSelectAddress: (id: string) => void;
  onRemove: (id: string) => void;
  onInsertAfter: (index: number) => void;
  onToggleSchedule: (id: string) => void;
  onTimeChange: (id: string, field: 'arrivalTime' | 'pickupTime', value: string) => void;
  onSetWait: (id: string, minutes: number) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}

function SortableRouteStop({
  stop,
  index,
  count,
  canRemove,
  canInsertAfter,
  isExpanded,
  isRecentlyMoved,
  onAddressChange,
  onSelectAddress,
  onRemove,
  onInsertAfter,
  onToggleSchedule,
  onTimeChange,
  onSetWait,
  onMove,
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
  const scheduleSummary = formatMoodRouteScheduleStopSummary(stop, index, count);
  const waitMinutes = getMoodRouteWaitMinutes(stop);
  const isOrigin = index === 0;
  const isDestination = index === count - 1;
  const isWaypoint = !isOrigin && !isDestination;

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="mood-route-stop"
      data-route-stop-id={stop.id}
      className={`relative ${isDragging ? 'z-30 rounded-2xl ring-2 ring-violet-300 shadow-xl shadow-violet-950/40' : ''}`}
    >
      <div className={`rounded-2xl border bg-white/[0.025] p-2.5 ${isRecentlyMoved ? 'mood-route-drop-highlight border-violet-300/70' : 'border-white/10'}`}>
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

        <button
          type="button"
          onClick={() => onToggleSchedule(stop.id)}
          aria-expanded={isExpanded}
          aria-controls={`${stop.id}-schedule-panel`}
          aria-label={`${index + 1}번 ${label} 시간 ${isExpanded ? '접기' : '편집'}`}
          className="mt-2 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-violet-300/20 bg-violet-400/[0.08] px-3 text-left text-xs font-bold text-slate-200 outline-none transition hover:bg-violet-400/[0.14] focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          <span className="min-w-0 flex-1 leading-relaxed">{scheduleSummary}</span>
          {isExpanded
            ? <ChevronUp className="h-4 w-4 shrink-0 text-violet-200" aria-hidden="true" />
            : <ChevronDown className="h-4 w-4 shrink-0 text-violet-200" aria-hidden="true" />}
        </button>

        {isExpanded && (
          <div id={`${stop.id}-schedule-panel`} className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className={`grid gap-2 ${isWaypoint ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {!isOrigin && (
                <label className="text-xs font-bold text-slate-200">
                  도착 시각
                  <input
                    type="time"
                    value={stop.arrivalTime || ''}
                    onChange={(event) => onTimeChange(stop.id, 'arrivalTime', event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-[#181b25] px-3 text-sm text-white outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-300"
                  />
                </label>
              )}
              {!isDestination && (
                <label className="text-xs font-bold text-slate-200">
                  {isOrigin ? '출발 시각' : '재출발(픽업) 시각'}
                  <input
                    type="time"
                    value={stop.pickupTime || ''}
                    onChange={(event) => onTimeChange(stop.id, 'pickupTime', event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-[#181b25] px-3 text-sm text-white outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-300"
                  />
                </label>
              )}
            </div>

            {isWaypoint && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-white">대기시간 빠른 입력</p>
                  <p className="text-xs font-bold text-violet-200" aria-live="polite">
                    {waitMinutes === null ? '도착 시각을 먼저 입력하세요' : `대기 ${formatMoodRouteWait(waitMinutes)}`}
                  </p>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[30, 60, 120].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => onSetWait(stop.id, minutes)}
                      disabled={!stop.arrivalTime}
                      className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-2 text-xs font-black text-slate-200 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {minutes === 30 ? '30분' : `${minutes / 60}시간`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onMove(stop.id, -1)}
                disabled={index === 0}
                className="min-h-11 rounded-xl border border-white/10 bg-white/5 text-xs font-black text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-35"
              >
                위로 이동
              </button>
              <button
                type="button"
                onClick={() => onMove(stop.id, 1)}
                disabled={index === count - 1}
                className="min-h-11 rounded-xl border border-white/10 bg-white/5 text-xs font-black text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-35"
              >
                아래로 이동
              </button>
            </div>
          </div>
        )}
      </div>

      {canInsertAfter && (
        <div className="flex justify-center py-1">
          <button
            type="button"
            onClick={() => onInsertAfter(index)}
            aria-label={`${index + 1}번 ${label} 다음에 경유지 추가`}
            className="flex min-h-11 items-center gap-1 rounded-full border border-dashed border-violet-300/35 bg-[#11131a] px-4 text-[11px] font-black text-violet-200 outline-none transition hover:bg-violet-400/10 focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> 이 사이에 경유지 추가
          </button>
        </div>
      )}
    </li>
  );
}

export interface BookingChangeApprovalSummary {
  status: 'awaiting_mood' | 'approved' | 'withdrawn';
  quoteId: string;
  proposalRevision: number;
  proposedByEmail: string;
  proposedAt: number;
  reason: string;
  currency: 'KRW';
  oldAmountKRW: number;
  amountKRW: number;
  adjustmentKRW: number;
  balanceBeforeKRW: number;
  balanceAfterKRW: number;
  changedFields: string[];
  proposedBooking: {
    date: string;
    startTime: string;
    durationHours: number;
    serviceType: MoodServiceType;
    origin: string;
    destination: string;
    waypoints: string[];
    note?: string | null;
    airportDirection?: 'pickup' | 'sending' | null;
    airportCode?: MoodAirportCode | null;
    influencerName?: string | null;
    courseMoodPercentages?: number[] | null;
    routeSchedule?: MoodRouteScheduleStop[] | null;
  };
  breakdown: Record<string, unknown>;
  routeSnapshot: RouteData | null;
  approvedByEmail?: string | null;
  approvedAt?: number | null;
  withdrawnByEmail?: string | null;
  withdrawnAt?: number | null;
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
  routeSchedule?: MoodRouteScheduleStop[] | null;
  routeSnapshot?: {
    km?: number;
    tollKRW?: number;
    durationMin?: number;
    path?: [number, number][];
    points?: RouteData['points'];
  } | null;
  breakdown?: {
    baseKRW?: number | null;
    distanceSurchargeKRW?: number | null;
    tollKRW?: number | null;
    estimatedTollKRW?: number | null;
    otherAdjustmentKRW?: number | null;
    km?: number | null;
    origin?: string | null;
    destination?: string | null;
    waypoints?: string[] | null;
  } | null;
  bookingChangeApproval?: BookingChangeApprovalSummary | null;
}

interface Props {
  booking: ChangeableMoodBooking;
  balanceKRW: number;
  isAdmin?: boolean;
  canApprove?: boolean;
  bookingAvailability?: MoodBookingAvailability | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

function makeRequestKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `mood-change-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function changeErrorMessage(code: string) {
  const messages: Record<string, string> = {
    NO_CHANGES: '변경된 내용이 없습니다.',
    CHANGE_QUOTE_REQUIRED: '금액 미리보기를 다시 확인해 주세요.',
    CHANGE_QUOTE_EXPIRED: '금액 미리보기 유효시간이 지났습니다. 다시 확인해 주세요.',
    CHANGE_QUOTE_MISMATCH: '미리보기 뒤 입력값이 달라졌습니다. 금액을 다시 확인해 주세요.',
    CHANGE_QUOTE_INTEGRITY_FAILED: '금액 미리보기 검증에 실패했습니다. 다시 확인해 주세요.',
    CHANGE_QUOTE_ALREADY_USED: '이미 처리된 변경입니다. 예약 현황을 새로 확인해 주세요.',
    CHANGE_QUOTE_BALANCE_STALE: '잔액이 달라져 금액을 다시 확인해야 합니다.',
    CHANGE_PROPOSAL_MISMATCH: '확인 대기 중인 변경 내용이 달라졌습니다. 운영자에게 다시 요청해 주세요.',
    CHANGE_PROPOSAL_NOT_PENDING: '이미 처리됐거나 철회된 변경입니다.',
    CHANGE_APPROVER_REQUIRED: '지정된 MOOD 확인 담당자만 금액을 확정할 수 있습니다.',
    BOOKING_CHANGE_APPROVAL_PENDING: '이미 MOOD 확인을 기다리는 변경이 있습니다.',
    ADMIN_REQUIRED: '금액에 영향을 주는 변경은 운영자만 요청할 수 있습니다.',
    REVISION_CONFLICT: '다른 변경이 먼저 반영됐습니다. 예약 현황을 새로고침해 주세요.',
    CREDIT_LIMIT_EXCEEDED: '변경 뒤 잔액이 허용 한도를 넘습니다.',
    ROUTE_CALCULATION_FAILED: '새 동선을 계산하지 못했습니다. 주소를 확인해 주세요.',
  };
  return messages[code] || code || '예약을 변경하지 못했습니다.';
}

function pendingDeltaText(value: number) {
  if (value > 0) return `추가 차감 ${formatKRW(value)}`;
  if (value < 0) return `잔액 환원 ${formatKRW(-value)}`;
  return '금액 변동 없음';
}

function approvalServiceLabel(value: MoodServiceType) {
  if (value === 'airport') return '공항 이동';
  if (value === 'manager') return '매니저';
  return '차량';
}

function approvalRouteText(origin: string, waypoints: string[], destination: string) {
  return [origin, ...waypoints, destination].map((value) => String(value || '').trim()).filter(Boolean).join(' → ') || '없음';
}

function approvalCourseShareText(addresses: string[], percentages: number[] | null | undefined, totalKRW: number) {
  if (!Array.isArray(percentages) || !percentages.length) return '없음';
  const courseBaseKRW = Math.floor(totalKRW / percentages.length);
  return percentages.map((percentage, index) => {
    const courseKRW = courseBaseKRW + (index === percentages.length - 1 ? totalKRW - courseBaseKRW * percentages.length : 0);
    const moodKRW = Math.round(courseKRW * percentage / 100);
    return `${index + 1}. ${addresses[index] || '장소 미입력'} · MOOD ${percentage}% (${formatKRW(moodKRW)})`;
  }).join('\n');
}

function BookingChangeApprovalModal({
  booking,
  isAdmin = false,
  canApprove = false,
  onClose,
  onChanged,
}: Props) {
  const approval = booking.bookingChangeApproval as BookingChangeApprovalSummary;
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState<'approve' | 'withdraw' | null>(null);
  const [message, setMessage] = useState('');
  const inFlightRef = useRef(false);
  const requestKeyRef = useRef<Record<'approve' | 'withdraw', string>>({ approve: '', withdraw: '' });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const finalApproveButtonRef = useRef<HTMLButtonElement | null>(null);
  const proposed = approval.proposedBooking;
  const addresses = [proposed.origin, ...(Array.isArray(proposed.waypoints) ? proposed.waypoints : []), proposed.destination]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const schedule = normalizeMoodRouteSchedule(proposed.routeSchedule, addresses.length, proposed.startTime);
  const originalAddresses = [
    String(booking.breakdown?.origin || ''),
    ...(Array.isArray(booking.breakdown?.waypoints) ? booking.breakdown.waypoints : []),
    String(booking.breakdown?.destination || ''),
  ].map((value) => value.trim()).filter(Boolean);
  const originalSchedule = normalizeMoodRouteSchedule(booking.routeSchedule, originalAddresses.length, booking.startTime);
  const fieldKeys = Array.from(new Set(approval.changedFields.map((field) => (
    ['origin', 'destination', 'waypoints'].includes(field) ? 'route' : field
  ))));
  const fieldLabels: Record<string, string> = {
    date: '날짜',
    startTime: '시작 시각',
    durationHours: '이용 시간',
    serviceType: '서비스',
    route: '이동 경로·순서',
    airportDirection: '공항 방향',
    airportCode: '공항',
    courseMoodPercentages: '비용 분담',
    note: '예약 메모',
    influencerName: '탑승 인플루언서',
    routeSchedule: '도착·대기 시간',
  };
  const fieldValue = (field: string, next: boolean) => {
    if (field === 'date') return next ? proposed.date : booking.date;
    if (field === 'startTime') return next ? proposed.startTime : booking.startTime;
    if (field === 'durationHours') return `${next ? proposed.durationHours : booking.durationHours}시간`;
    if (field === 'serviceType') return approvalServiceLabel(next ? proposed.serviceType : booking.serviceType);
    if (field === 'route') {
      return next
        ? approvalRouteText(proposed.origin, proposed.waypoints, proposed.destination)
        : approvalRouteText(String(booking.breakdown?.origin || ''), booking.breakdown?.waypoints || [], String(booking.breakdown?.destination || ''));
    }
    if (field === 'airportDirection') {
      const value = next ? proposed.airportDirection : booking.airportDirection;
      return value === 'sending' ? '샌딩' : value === 'pickup' ? '픽업' : '없음';
    }
    if (field === 'airportCode') return String((next ? proposed.airportCode : booking.airportCode) || '없음');
    if (field === 'courseMoodPercentages') {
      return approvalCourseShareText(
        next ? addresses : originalAddresses,
        next ? proposed.courseMoodPercentages : booking.courseMoodPercentages,
        next ? approval.amountKRW : approval.oldAmountKRW,
      );
    }
    if (field === 'note') return String((next ? proposed.note : booking.note) || '없음');
    if (field === 'influencerName') return String((next ? proposed.influencerName : booking.influencerName) || '없음');
    if (field === 'routeSchedule') {
      return formatMoodRouteScheduleText({
        date: next ? proposed.date : booking.date,
        addresses: next ? addresses : originalAddresses,
        routeSchedule: next ? schedule : originalSchedule,
        startTime: next ? proposed.startTime : booking.startTime,
      }) || '없음';
    }
    return '변경';
  };
  const oldBreakdown = booking.breakdown || {};
  const proposedBreakdown = approval.breakdown || {};
  const breakdownValue = (source: Record<string, unknown>, key: string) => {
    const raw = key === 'tollKRW' && !Number.isSafeInteger(source.tollKRW) ? source.estimatedTollKRW : source[key];
    return Number.isSafeInteger(raw) ? Number(raw) : null;
  };
  const breakdownRows = [
    ['baseKRW', '기본 이용료'],
    ['distanceSurchargeKRW', '거리 추가요금'],
    ['tollKRW', '톨비'],
    ['otherAdjustmentKRW', '기타 조정'],
  ].map(([key, label]) => ({
    key,
    label,
    before: breakdownValue(oldBreakdown as Record<string, unknown>, key),
    after: breakdownValue(proposedBreakdown, key),
  })).filter((row) => row.before !== null || row.after !== null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!inFlightRef.current) onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href]',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (confirming) finalApproveButtonRef.current?.focus();
  }, [confirming]);

  const respond = async (action: 'approve' | 'withdraw') => {
    if (inFlightRef.current) return;
    if (action === 'withdraw' && !window.confirm('이 변경 제안을 철회할까요? 예약 금액과 잔액은 바뀌지 않습니다.')) return;
    if (!requestKeyRef.current[action]) requestKeyRef.current[action] = makeRequestKey();
    inFlightRef.current = true;
    setSubmitting(action);
    setMessage('');
    try {
      const response = await authFetch('/api/mood-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          bookingId: booking.id,
          quoteId: approval.quoteId,
          idempotencyKey: requestKeyRef.current[action],
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(changeErrorMessage(String(json.error || '')));
      await onChanged();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '변경 확인을 처리하지 못했습니다.');
    } finally {
      inFlightRef.current = false;
      setSubmitting(null);
    }
  };

  return (
    <div
      className="mood-surface fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-2 sm:p-3"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !inFlightRef.current) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mood-change-approval-title"
        aria-busy={Boolean(submitting)}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/10 bg-[#11131a] p-3 text-white shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black text-violet-300">운영자 제안 · MOOD 확인 대기</p>
            <h2 id="mood-change-approval-title" className="mt-1 text-xl font-black">예약 변경 금액 확인</h2>
            <p className="mt-1 text-xs text-slate-300">확인 전에는 예약 내용·금액·잔액이 바뀌지 않습니다.</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} disabled={Boolean(submitting)} aria-label="예약 변경 금액 확인 닫기" className="mood-icon-button rounded-full bg-white/5 text-slate-200 disabled:opacity-40"><X className="mx-auto h-5 w-5" /></button>
        </div>

        <section aria-labelledby="mood-change-price-title" className="mt-5 rounded-2xl border border-violet-300/20 bg-violet-400/10 p-4">
          <h3 id="mood-change-price-title" className="text-sm font-black">금액 영향</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div><dt className="text-slate-400">기존 금액</dt><dd className="mt-1 text-sm font-black">{formatKRW(approval.oldAmountKRW)}</dd></div>
            <div><dt className="text-slate-400">제안 금액</dt><dd className="mt-1 text-base font-black text-violet-200">{formatKRW(approval.amountKRW)}</dd></div>
            <div><dt className="text-slate-400">차액</dt><dd className="mt-1 font-black">{pendingDeltaText(approval.adjustmentKRW)}</dd></div>
            <div><dt className="text-slate-400">확정 뒤 잔액</dt><dd className="mt-1 font-black">{formatKRW(approval.balanceAfterKRW)}</dd></div>
          </dl>
          {breakdownRows.length > 0 && (
            <div className="mt-4 border-t border-violet-200/15 pt-3">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 text-xs">
                <span className="font-black text-slate-300">요금 산식</span><span className="text-right text-slate-400">기존</span><span className="text-right text-violet-200">제안</span>
                {breakdownRows.map((row) => (
                  <div key={row.key} className="contents">
                    <span className="text-slate-300">{row.label}</span>
                    <span className="text-right font-bold">{row.before === null ? '—' : formatKRW(row.before)}</span>
                    <span className="text-right font-black text-violet-100">{row.after === null ? '—' : formatKRW(row.after)}</span>
                  </div>
                ))}
              </div>
              {(breakdownValue(oldBreakdown as Record<string, unknown>, 'km') !== null || breakdownValue(proposedBreakdown, 'km') !== null) && (
                <p className="mt-3 text-xs text-slate-300">계산 거리 · {breakdownValue(oldBreakdown as Record<string, unknown>, 'km') === null ? '—' : `${breakdownValue(oldBreakdown as Record<string, unknown>, 'km')}km`} → {breakdownValue(proposedBreakdown, 'km') === null ? '—' : `${breakdownValue(proposedBreakdown, 'km')}km`}</p>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="mood-change-fields-title" className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <h3 id="mood-change-fields-title" className="text-sm font-black">바뀌는 항목 {fieldKeys.length}개</h3>
          <div className="mt-3 space-y-3">
            {fieldKeys.map((field) => (
              <div key={field} className="rounded-xl bg-black/20 p-3">
                <p className="text-xs font-black text-violet-200">{fieldLabels[field] || field}</p>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div><p className="text-slate-500">기존</p><p className="mt-1 whitespace-pre-wrap break-words font-semibold text-slate-300">{fieldValue(field, false)}</p></div>
                  <div><p className="text-violet-300">제안</p><p className="mt-1 whitespace-pre-wrap break-words font-bold text-white">{fieldValue(field, true)}</p></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="mood-change-route-title" className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <h3 id="mood-change-route-title" className="text-sm font-black">변경될 일정</h3>
          <p className="mt-2 text-sm font-bold">{proposed.date} · {proposed.startTime} · {proposed.serviceType === 'airport' ? '공항 이동' : `${proposed.durationHours}시간 차량 이용`}</p>
          {addresses.length >= 2 && (
            <ol className="mt-3 space-y-2">
              {addresses.map((address, index) => {
                const stop = schedule[index];
                const waitMinutes = stop ? getMoodRouteWaitMinutes(stop) : null;
                const timing = index === 0
                  ? `출발 ${stop?.pickupTime || proposed.startTime}`
                  : index === addresses.length - 1
                    ? stop?.arrivalTime ? `도착 ${stop.arrivalTime}` : '도착 시각 미정'
                    : [
                      stop?.arrivalTime ? `도착 ${stop.arrivalTime}` : '도착 시각 미정',
                      waitMinutes === null ? null : `대기 ${formatMoodRouteWait(waitMinutes)}`,
                      stop?.pickupTime ? `재출발 ${stop.pickupTime}` : null,
                    ].filter(Boolean).join(' · ');
                return (
                  <li key={`${address}-${index}`} className="rounded-xl bg-black/20 px-3 py-2.5">
                    <p className="text-xs font-black text-violet-200">{index === 0 ? '출발지' : index === addresses.length - 1 ? '도착지' : `경유지 ${index}`}</p>
                    <p className="mt-1 break-words text-sm font-bold">{address}</p>
                    <p className="mt-1 text-xs text-slate-300">{timing}</p>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 rounded-xl bg-black/20 px-3 py-2.5 text-xs text-slate-300">변경 이유 · {approval.reason}</p>
          <p className="mt-2 text-xs text-slate-400">제안 {new Date(approval.proposedAt).toLocaleString('ko-KR')} · {approval.proposedByEmail}</p>
        </section>

        {message && <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200" role="alert">{message}</p>}

        <div className="mt-5" aria-live="polite">
          {isAdmin ? (
            <div className="space-y-2">
              <p className="rounded-xl bg-amber-400/10 px-3 py-2.5 text-xs font-bold text-amber-100">MOOD 지정 담당자의 확인을 기다리고 있습니다.</p>
              <button type="button" onClick={() => { void respond('withdraw'); }} disabled={Boolean(submitting)} className="min-h-12 w-full rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-black disabled:opacity-40">{submitting === 'withdraw' ? '철회 중…' : '제안 철회 후 다시 수정'}</button>
            </div>
          ) : canApprove ? (
            confirming ? (
              <div className="rounded-2xl border border-violet-300/25 bg-violet-400/10 p-4">
                <p id="mood-change-final-impact" className="text-sm font-bold">{formatKRW(approval.oldAmountKRW)}에서 {formatKRW(approval.amountKRW)}으로 바뀌며, {pendingDeltaText(approval.adjustmentKRW)}이 잔액에 반영됩니다.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button ref={finalApproveButtonRef} type="button" onClick={() => { void respond('approve'); }} disabled={Boolean(submitting)} aria-describedby="mood-change-final-impact" className="mood-primary-action min-h-12 rounded-2xl bg-violet-500 px-3 text-sm font-black disabled:opacity-40">{submitting === 'approve' ? '확정 중…' : `${formatKRW(approval.amountKRW)} 최종 확인`}</button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={Boolean(submitting)} className="min-h-12 rounded-2xl border border-white/15 bg-white/5 px-3 text-sm font-bold disabled:opacity-40">다시 보기</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="mood-primary-action min-h-14 w-full rounded-2xl bg-violet-500 px-4 text-base font-black">{formatKRW(approval.amountKRW)} 변경 내용 확인</button>
            )
          ) : (
            <p className="rounded-xl bg-white/5 px-3 py-3 text-xs font-bold text-slate-300">읽기 전용 · 지정된 MOOD 담당자의 확인을 기다리고 있습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function MoodBookingChangeModal(props: Props) {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  if (props.booking.bookingChangeApproval?.status === 'awaiting_mood') {
    return <BookingChangeApprovalModal {...props} />;
  }
  return <MoodBookingChangeEditor {...props} />;
}

function MoodBookingChangeEditor({ booking, balanceKRW, isAdmin = false, bookingAvailability, onClose, onChanged }: Props) {
  const bookingNoticeRules = getMoodBookingNoticeRules(moodKstDateISO(), bookingAvailability);
  const initialWaypoints = Array.isArray(booking.breakdown?.waypoints) ? booking.breakdown.waypoints.slice(0, 5) : [];
  const initialPayerCount = initialWaypoints.length + 2;
  const hasStoredCourseShare = Array.isArray(booking.courseMoodPercentages) || Array.isArray(booking.coursePayers);
  const initialCourseMoodPercentages = hasStoredCourseShare
    ? normalizeMoodCoursePercentages(
        booking.courseMoodPercentages,
        initialPayerCount,
        booking.coursePayers,
        booking.serviceType === 'airport' ? 50 : 100,
      )
    : Array.from({ length: initialPayerCount }, (_, index) => index === 0 ? 100 : 0);
  const initialRouteAddresses = [
    String(booking.breakdown?.origin || ''),
    ...initialWaypoints,
    String(booking.breakdown?.destination || ''),
  ];
  const initialRouteSchedule = normalizeMoodRouteSchedule(
    booking.routeSchedule,
    initialRouteAddresses.length,
    booking.startTime,
  );
  const safeBookingId = String(booking.id || 'booking').replace(/[^a-zA-Z0-9_-]/g, '-');
  const [date, setDate] = useState(booking.date || '');
  const [startTime, setStartTime] = useState(booking.startTime || '');
  const initialDurationHours = Number(booking.durationHours) || 3;
  const [durationHoursInput, setDurationHoursInput] = useState(String(initialDurationHours));
  const [lastValidDurationHours, setLastValidDurationHours] = useState(initialDurationHours);
  const durationHours = durationHoursInput.trim() === ''
    ? lastValidDurationHours
    : Number(durationHoursInput);
  const [serviceType, setServiceType] = useState<MoodServiceType>(booking.serviceType || 'vehicle');
  const [airportDirection, setAirportDirection] = useState<'pickup' | 'sending'>(booking.airportDirection === 'sending' ? 'sending' : 'pickup');
  const [airportCode, setAirportCode] = useState<MoodAirportCode>(booking.airportCode === 'GMP' ? 'GMP' : 'ICN');
  const [routeStops, setRouteStops] = useState<MoodRouteStop[]>(() => initialRouteAddresses.map((address, index) => ({
    id: `mood-route-stop-${safeBookingId}-${index}`,
    address,
    moodPercentage: initialCourseMoodPercentages[index],
    ...initialRouteSchedule[index],
  })));
  const [removedRouteStop, setRemovedRouteStop] = useState<RemovedMoodRouteStop | null>(null);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [routeAnnouncement, setRouteAnnouncement] = useState('');
  const [showSchedulePaste, setShowSchedulePaste] = useState(false);
  const [schedulePasteText, setSchedulePasteText] = useState('');
  const [schedulePreview, setSchedulePreview] = useState<MoodSchedulePreview | null>(null);
  const [scheduleParsing, setScheduleParsing] = useState(false);
  const [scheduleTransferMessage, setScheduleTransferMessage] = useState('');
  const [influencerName, setInfluencerName] = useState(booking.influencerName || '');
  const [note, setNote] = useState(booking.note || '');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<MoodChangeQuote | null>(null);
  const [submittingAction, setSubmittingAction] = useState<'preview' | 'propose' | 'confirm' | null>(null);
  const [message, setMessage] = useState('');
  const [recentlyMovedStopId, setRecentlyMovedStopId] = useState<string | null>(null);
  const previewRequestRef = useRef({ signature: '', key: '' });
  const confirmRequestRef = useRef({ signature: '', key: '' });
  const submitInFlightRef = useRef(false);
  const movedHighlightTimerRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
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
  const originalBlockStatus = getMoodBookingBlockStatus(booking.date, booking.startTime, bookingAvailability);
  const exactOriginalTime = date === booking.date && startTime === booking.startTime;
  const keepsGrandfatheredTime = exactOriginalTime && (originalBlockStatus.blocked || !originalBlockStatus.availabilityReady);
  const nextBlockStatus = getMoodBookingBlockStatus(date, startTime, bookingAvailability);
  const bookingChangeBlocked = isMoodBookingChangeBlocked(
    booking.date,
    booking.startTime,
    date,
    startTime,
    bookingAvailability,
  );
  const courseMoodPercentages = routeStops.map((stop) => stop.moodPercentage);
  const courseItems = routeStops
    .map((stop, index) => ({ address: stop.address.trim(), percentageIndex: index }))
    .filter((item) => item.address);
  const activeRouteStops = routeStarted
    ? [routeStops[0], ...routeStops.slice(1, -1).filter((stop) => stop.address.trim()), routeStops[routeStops.length - 1]]
    : [];
  const courseMoodPercentageValues = activeRouteStops.map((stop) => stop.moodPercentage);
  const routeSchedule = routeStops.map(({ arrivalTime, pickupTime }) => ({ arrivalTime, pickupTime }));
  const payloadOrigin = activeRouteStops[0]?.address.trim() || '';
  const payloadDestination = activeRouteStops[activeRouteStops.length - 1]?.address.trim() || '';
  const payloadWaypoints = activeRouteStops.slice(1, -1).map((stop) => stop.address.trim()).filter(Boolean);
  const payloadRouteSchedule = activeRouteStops.map(({ arrivalTime, pickupTime }) => ({ arrivalTime, pickupTime }));
  const normalizedDurationHours = serviceType === 'airport' ? 0 : durationHours;
  const initialActiveAddresses = initialRouteAddresses.some((address) => address.trim())
    ? initialRouteAddresses.map((address) => address.trim())
    : [];
  const currentActiveAddresses = activeRouteStops.map((stop) => stop.address.trim());
  const initialActiveSchedule = initialActiveAddresses.length ? initialRouteSchedule : [];
  const initialActivePercentages = initialActiveAddresses.length ? initialCourseMoodPercentages : [];

  const changedFieldKeys: string[] = [];
  const noteChanged = note.trim() !== String(booking.note || '').trim();
  const influencerChanged = influencerName.trim() !== String(booking.influencerName || '').trim();
  const scheduleChanged = JSON.stringify(payloadRouteSchedule) !== JSON.stringify(initialActiveSchedule);
  const courseShareChanged = JSON.stringify(courseMoodPercentageValues) !== JSON.stringify(initialActivePercentages);
  if (date !== booking.date) changedFieldKeys.push('date');
  if (startTime !== booking.startTime) changedFieldKeys.push('startTime');
  if (normalizedDurationHours !== (booking.serviceType === 'airport' ? 0 : Number(booking.durationHours))) changedFieldKeys.push('durationHours');
  if (serviceType !== booking.serviceType) changedFieldKeys.push('serviceType');
  if (JSON.stringify(currentActiveAddresses) !== JSON.stringify(initialActiveAddresses)) changedFieldKeys.push('route');
  if (serviceType === 'airport' && airportDirection !== (booking.airportDirection === 'sending' ? 'sending' : 'pickup')) changedFieldKeys.push('airportDirection');
  if (serviceType === 'airport' && airportCode !== (booking.airportCode === 'GMP' ? 'GMP' : 'ICN')) changedFieldKeys.push('airportCode');
  if (courseShareChanged) changedFieldKeys.push('courseMoodPercentages');
  if (noteChanged) changedFieldKeys.push('note');
  if (influencerChanged) changedFieldKeys.push('influencerName');
  if (scheduleChanged) changedFieldKeys.push('routeSchedule');

  const changedFieldLabels: Record<string, string> = {
    date: '날짜',
    startTime: '시작 시각',
    durationHours: '이용 시간',
    serviceType: '서비스',
    route: '이동 경로·순서',
    airportDirection: '공항 방향',
    airportCode: '공항',
    courseMoodPercentages: '비용 분담',
    note: '예약 메모',
    influencerName: '탑승 인플루언서',
    routeSchedule: '장소별 도착·대기 시각',
  };
  const hasChanges = changedFieldKeys.length > 0;
  const quoteRequired = changedFieldKeys.some((key) => ![
    'date',
    'startTime',
    'airportDirection',
    'note',
    'influencerName',
    'routeSchedule',
  ].includes(key));
  const requestPayload = {
    bookingId: booking.id,
    expectedRevision: Number.isInteger(booking.revision) ? booking.revision : 0,
    reason: reason.trim(),
    booking: {
      date,
      startTime,
      durationHours: normalizedDurationHours,
      serviceType,
      airportDirection: serviceType === 'airport' ? airportDirection : null,
      airportCode: serviceType === 'airport' ? airportCode : null,
      origin: payloadOrigin,
      destination: payloadDestination,
      waypoints: payloadWaypoints,
      influencerName: influencerName.trim(),
      note: note.trim(),
      courseMoodPercentages: courseMoodPercentageValues,
      routeSchedule: payloadRouteSchedule,
    },
  };
  const requestSignature = JSON.stringify(requestPayload);
  const activeQuote = quote && quote.requestSignature === requestSignature
    ? quote
    : null;
  const estimateReady = !quoteRequired || !!activeQuote;
  const estimatedAmountKRW = typeof activeQuote?.amountKRW === 'number' ? activeQuote.amountKRW : booking.amountKRW;
  const adjustment = typeof activeQuote?.adjustmentKRW === 'number' ? activeQuote.adjustmentKRW : 0;
  const nextBalance = typeof activeQuote?.balanceKRW === 'number' ? activeQuote.balanceKRW : balanceKRW;
  const routeIdentityChanged = JSON.stringify(currentActiveAddresses) !== JSON.stringify(initialActiveAddresses)
    || serviceType !== booking.serviceType;
  const storedRoute = booking.routeSnapshot && typeof booking.routeSnapshot.km === 'number'
    ? {
        km: booking.routeSnapshot.km,
        tollKRW: typeof booking.routeSnapshot.tollKRW === 'number' ? booking.routeSnapshot.tollKRW : 0,
        durationMin: typeof booking.routeSnapshot.durationMin === 'number' ? booking.routeSnapshot.durationMin : 0,
        path: Array.isArray(booking.routeSnapshot.path) ? booking.routeSnapshot.path : [],
        points: Array.isArray(booking.routeSnapshot.points) ? booking.routeSnapshot.points : [],
      }
    : null;
  const route = activeQuote?.routeSnapshot || (!routeIdentityChanged ? storedRoute : null);
  const routeBlocked = routeStarted && !routeComplete;
  const hasInvalidatedQuote = !!quote && !activeQuote;
  const hasUnappliedScheduleDraft = schedulePasteText.trim().length > 0 || schedulePreview !== null;
  const hasUnsavedChanges = hasChanges || hasUnappliedScheduleDraft;
  const dirtyRef = useRef(hasUnsavedChanges);
  const closeHandlerRef = useRef(onClose);

  useEffect(() => {
    dirtyRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    closeHandlerRef.current = onClose;
  }, [onClose]);

  const attemptClose = () => {
    if (submitInFlightRef.current || submittingAction) return;
    if (dirtyRef.current && !window.confirm('저장하지 않은 변경 내용이 있습니다. 닫을까요?')) return;
    closeHandlerRef.current();
  };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (submitInFlightRef.current) return;
        if (!dirtyRef.current || window.confirm('저장하지 않은 변경 내용이 있습니다. 닫을까요?')) {
          closeHandlerRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
      if (movedHighlightTimerRef.current !== null) window.clearTimeout(movedHighlightTimerRef.current);
    };
  }, []);

  const handleStartTimeChange = (value: string) => {
    setStartTime(value);
    setRouteStops((items) => items.map((item, index) => (
      index === 0 ? { ...item, pickupTime: value || null } : item
    )));
  };

  const updateRouteStopTime = (
    id: string,
    field: 'arrivalTime' | 'pickupTime',
    value: string,
  ) => {
    const normalizedValue = value || null;
    const index = routeStops.findIndex((stop) => stop.id === id);
    if (index === 0 && field === 'pickupTime') setStartTime(value);
    setRouteStops((items) => items.map((item) => (
      item.id === id ? { ...item, [field]: normalizedValue } : item
    )));
    setScheduleTransferMessage('일정 시각을 수정했습니다. 청구 이용시간은 자동으로 바뀌지 않습니다.');
  };

  const setRouteStopWait = (id: string, minutes: number) => {
    setRouteStops((items) => items.map((item) => (
      item.id === id ? { ...item, ...setMoodRouteStopWaitMinutes(item, minutes) } : item
    )));
    setScheduleTransferMessage(`대기 ${formatMoodRouteWait(minutes)}을 적용했습니다.`);
  };

  const commitRouteStopOrder = (nextItems: MoodRouteStop[], announcement: string, movedId?: string) => {
    if (nextItems.length < 2) return;
    const next = nextItems.map((item) => ({ ...item }));
    const firstTime = next[0].pickupTime || next[0].arrivalTime || startTime || null;
    next[0].arrivalTime = null;
    next[0].pickupTime = firstTime;
    const lastIndex = next.length - 1;
    next[lastIndex].arrivalTime = next[lastIndex].arrivalTime || next[lastIndex].pickupTime || null;
    next[lastIndex].pickupTime = null;
    setRouteStops(next);
    setStartTime(firstTime || '');
    setRemovedRouteStop(null);
    setRouteAnnouncement(announcement);
    if (movedId) {
      setRecentlyMovedStopId(movedId);
      if (movedHighlightTimerRef.current !== null) window.clearTimeout(movedHighlightTimerRef.current);
      movedHighlightTimerRef.current = window.setTimeout(() => setRecentlyMovedStopId(null), 600);
    }
  };

  const moveRouteStop = (id: string, delta: -1 | 1) => {
    const fromIndex = routeStops.findIndex((stop) => stop.id === id);
    const toIndex = fromIndex + delta;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= routeStops.length) return;
    const next = arrayMove(routeStops, fromIndex, toIndex);
    commitRouteStopOrder(next, `${routeStops[fromIndex].address.trim() || '빈 장소'}를 ${delta < 0 ? '위로' : '아래로'} 이동했습니다.`, id);
    window.setTimeout(() => document.getElementById(`${id}-reorder`)?.focus(), 0);
  };

  const copyScheduleText = async () => {
    const text = formatMoodRouteScheduleText({ date, addresses: routeAddresses, routeSchedule, startTime });
    if (!text) {
      setScheduleTransferMessage('전체 일정을 복사하려면 빈 주소를 먼저 확인해 주세요.');
      return;
    }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const copyTarget = document.createElement('textarea');
        copyTarget.value = text;
        copyTarget.setAttribute('readonly', '');
        copyTarget.style.position = 'fixed';
        copyTarget.style.opacity = '0';
        document.body.appendChild(copyTarget);
        copyTarget.select();
        const copied = document.execCommand('copy');
        copyTarget.remove();
        if (!copied) throw new Error('copy failed');
      }
      setScheduleTransferMessage('전체 일정을 복사했습니다. 카카오톡에 그대로 붙여넣을 수 있습니다.');
    } catch {
      setSchedulePasteText(text);
      setShowSchedulePaste(true);
      setScheduleTransferMessage('자동 복사가 막혀 전체 일정을 입력칸에 열었습니다. 길게 눌러 복사해 주세요.');
    }
  };

  const buildAiSchedulePreview = (json: Record<string, unknown>): MoodSchedulePreview | null => {
    const parsedStops = Array.isArray(json.stops) ? json.stops as MoodParsedScheduleStop[] : [];
    const datedStops = parsedStops.filter((stop) => stop.date);
    const dates = [...new Set(datedStops.map((stop) => String(stop.date)))].sort();
    const selectedDate = dates.includes(date) ? date : dates[0] || null;
    const visibleStops = selectedDate
      ? parsedStops.filter((stop) => !stop.date || stop.date === selectedDate)
      : parsedStops;
    const merged: Array<{ address: string; arrivalTime: string | null; pickupTime: string | null }> = [];

    visibleStops.forEach((stop) => {
      const address = String(stop.address || stop.label || '').trim();
      if (!address) return;
      const time = String(stop.timeHint || '').trim() || null;
      const previous = merged[merged.length - 1];
      const row = previous && previous.address.replace(/\s+/g, '') === address.replace(/\s+/g, '')
        ? previous
        : { address, arrivalTime: null, pickupTime: null };
      if (row !== previous) merged.push(row);
      if (stop.action === 'pickup') row.pickupTime = time;
      else if (stop.action === 'dropoff' || stop.action === 'arrive') row.arrivalTime = time;
      else if (!row.arrivalTime) row.arrivalTime = time;
      else row.pickupTime = time;
    });

    if (merged.length < 2 || merged.length > MAX_ROUTE_STOPS) return null;
    const addresses = merged.map((stop) => stop.address);
    const parsedStartTime = merged[0].pickupTime || merged[0].arrivalTime || startTime || null;
    const parsedSchedule = normalizeMoodRouteSchedule(merged, merged.length, parsedStartTime);
    const warnings: string[] = [];
    if (dates.length > 1 && selectedDate) warnings.push(`여러 날짜 중 ${selectedDate} 일정만 가져왔습니다.`);
    if (visibleStops.some((stop) => stop.geocodeOk === false)) warnings.push('주소를 찾지 못한 장소가 있어 적용 후 주소를 확인해야 합니다.');
    if (json.truncated) warnings.push('AI 결과 뒤쪽이 잘렸을 수 있으니 원문과 장소 개수를 대조해 주세요.');
    return {
      source: 'ai',
      date: selectedDate,
      startTime: parsedStartTime,
      addresses,
      routeSchedule: parsedSchedule,
      warnings,
    };
  };

  const analyzeSchedulePaste = async () => {
    const text = schedulePasteText.trim();
    setScheduleTransferMessage('');
    setSchedulePreview(null);
    if (!text) {
      setScheduleTransferMessage('붙여넣은 전체 일정을 입력해 주세요.');
      return;
    }

    const parsed = parseMoodRouteScheduleText(text);
    if (parsed.ok) {
      if (parsed.addresses.length > MAX_ROUTE_STOPS) {
        setScheduleTransferMessage(`장소는 최대 ${MAX_ROUTE_STOPS}곳까지 적용할 수 있습니다.`);
        return;
      }
      setSchedulePreview({
        source: 'text',
        date: parsed.date,
        startTime: parsed.startTime,
        addresses: parsed.addresses,
        routeSchedule: parsed.routeSchedule,
        warnings: [],
      });
      setScheduleTransferMessage('복사 형식으로 읽었습니다. 아래 미리보기를 확인한 뒤 적용해 주세요.');
      return;
    }

    if (parsed.addresses.length) {
      setScheduleTransferMessage(parsed.errors.join(' ') || '전체 일정 형식을 확인해 주세요.');
      return;
    }

    setScheduleParsing(true);
    try {
      const response = await authFetch('/api/mood-parse-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || '일정을 분석하지 못했습니다.');
      const preview = buildAiSchedulePreview(json as Record<string, unknown>);
      if (!preview) throw new Error(`일정은 주소가 확인된 2~${MAX_ROUTE_STOPS}곳이어야 합니다.`);
      setSchedulePreview(preview);
      setScheduleTransferMessage('자유문장을 분석했습니다. 아래 미리보기를 확인한 뒤 적용해 주세요.');
    } catch (error) {
      setScheduleTransferMessage(error instanceof Error ? error.message : '일정을 분석하지 못했습니다.');
    } finally {
      setScheduleParsing(false);
    }
  };

  const applySchedulePreview = () => {
    if (!schedulePreview) return;
    const effectiveStartTime = schedulePreview.startTime || startTime || null;
    const effectiveRouteSchedule = normalizeMoodRouteSchedule(
      schedulePreview.routeSchedule,
      schedulePreview.addresses.length,
      effectiveStartTime,
    );
    const scheduleValidation = validateMoodRouteSchedule(
      effectiveRouteSchedule,
      schedulePreview.addresses.length,
      effectiveStartTime,
    );
    if (!scheduleValidation.valid) {
      setScheduleTransferMessage(scheduleValidation.issues[0]?.message || '일정 시각을 확인해 주세요.');
      return;
    }

    const percentagePools = new Map<string, number[]>();
    routeStops.forEach((stop) => {
      const key = stop.address.trim().replace(/\s+/g, '');
      const values = percentagePools.get(key) || [];
      values.push(stop.moodPercentage);
      percentagePools.set(key, values);
    });
    const defaultPercentage = serviceType === 'airport' ? 50 : 100;
    const nextStops = schedulePreview.addresses.map((address, index) => {
      addedRouteStopSequence += 1;
      const key = address.trim().replace(/\s+/g, '');
      const percentages = percentagePools.get(key) || [];
      const moodPercentage = percentages.length ? Number(percentages.shift()) : defaultPercentage;
      return {
        id: `mood-route-stop-pasted-${addedRouteStopSequence}`,
        address,
        moodPercentage,
        ...effectiveRouteSchedule[index],
      };
    });
    setRouteStops(nextStops);
    if (schedulePreview.date) setDate(schedulePreview.date);
    setStartTime(effectiveStartTime || '');
    setExpandedStopId(null);
    setRemovedRouteStop(null);
    setSchedulePreview(null);
    setShowSchedulePaste(false);
    setRouteAnnouncement(`전체 일정 ${nextStops.length}곳을 적용했습니다. 저장 전 주소와 시간을 확인해 주세요.`);
    setScheduleTransferMessage('전체 일정을 화면에 적용했습니다. 아직 저장되지 않았습니다.');
  };

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

  const addRouteStopAfter = (index: number) => {
    if (routeStops.length >= MAX_ROUTE_STOPS) return;
    const nextStop = routeStops[index + 1];
    const inheritedPercentage = nextStop && typeof nextStop.moodPercentage === 'number'
      ? nextStop.moodPercentage
      : 100;
    addedRouteStopSequence += 1;
    const emptySchedule = createMoodRouteSchedule(1)[0];
    const newStop: MoodRouteStop = {
      id: `mood-route-stop-added-${addedRouteStopSequence}`,
      address: '',
      moodPercentage: inheritedPercentage,
      ...emptySchedule,
    };
    setRouteStops((items) => [...items.slice(0, index + 1), newStop, ...items.slice(index + 1)]);
    setExpandedStopId(newStop.id);
    setRemovedRouteStop(null);
    setRouteAnnouncement(`${index + 1}번 장소 다음에 새 경유지를 추가했습니다.`);
    window.setTimeout(() => document.getElementById(`${newStop.id}-address`)?.focus(), 0);
  };

  const removeRouteStop = (id: string) => {
    if (routeStops.length <= 2) return;
    const index = routeStops.findIndex((stop) => stop.id === id);
    if (index < 0) return;
    const stop = routeStops[index];
    const nextFocusStop = routeStops[index + 1] || routeStops[index - 1];
    const scheduleById = Object.fromEntries(routeStops.map((item) => [item.id, {
      arrivalTime: item.arrivalTime,
      pickupTime: item.pickupTime,
    }]));
    const nextItems = routeStops.filter((item) => item.id !== id);
    commitRouteStopOrder(nextItems, `${stop.address.trim() || '빈 장소'}를 삭제했습니다. 되돌릴 수 있습니다.`);
    if (expandedStopId === id) setExpandedStopId(null);
    setRemovedRouteStop({ stop, index, scheduleById });
    window.setTimeout(() => document.getElementById(`${nextFocusStop.id}-reorder`)?.focus(), 0);
  };

  const undoRemoveRouteStop = () => {
    if (!removedRouteStop || routeStops.length >= MAX_ROUTE_STOPS) return;
    const insertAt = Math.min(removedRouteStop.index, routeStops.length);
    const restoredStop = removedRouteStop.stop;
    const nextItems = [
      ...routeStops.slice(0, insertAt),
      restoredStop,
      ...routeStops.slice(insertAt),
    ].map((item) => {
      const originalSchedule = removedRouteStop.scheduleById[item.id];
      return originalSchedule ? { ...item, ...originalSchedule } : item;
    });
    commitRouteStopOrder(nextItems, `${restoredStop.address.trim() || '빈 장소'}를 다시 넣었습니다.`);
    setRemovedRouteStop(null);
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
    const next = reorderMoodRouteStops(routeStops, activeId, overId);
    const moved = routeStops.find((stop) => stop.id === activeId);
    commitRouteStopOrder(next, `${moved?.address.trim() || '빈 장소'}의 순서를 변경했습니다.`, activeId);
  };

  const submit = async () => {
    if (submitInFlightRef.current) return;
    setMessage('');
    if (!date || !startTime) return setMessage('날짜와 시작 시각을 확인해 주세요.');
    if (serviceType !== 'airport' && !durationHoursInput.trim()) return setMessage('이용 시간을 입력해 주세요.');
    if (serviceType !== 'airport' && (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 15)) {
      return setMessage('이용 시간은 1시간 이상 15시간 이하로 입력해 주세요.');
    }
    if (bookingChangeBlocked) {
      return setMessage(nextBlockStatus.availabilityReady
        ? `${nextBlockStatus.rule?.reason} 때문에 선택한 날짜·시각으로 변경할 수 없습니다.`
        : MOOD_BOOKING_AVAILABILITY_UNAVAILABLE_MESSAGE);
    }
    if (!hasChanges) return setMessage('변경된 내용이 없습니다.');
    if (!reason.trim()) return setMessage('변경 이유를 입력해 주세요.');
    if (quoteRequired && !isAdmin) return setMessage('금액에 영향을 주는 변경은 운영자만 요청할 수 있습니다.');
    if (routeStarted && !routeComplete) return setMessage('경로의 빈 장소를 모두 입력하거나 삭제해 주세요.');
    const scheduleValidation = validateMoodRouteSchedule(payloadRouteSchedule, activeRouteStops.length, startTime);
    if (!scheduleValidation.valid) {
      return setMessage(scheduleValidation.issues[0]?.message || '경유지별 일정 시각을 확인해 주세요.');
    }

    const needsPreview = quoteRequired && !activeQuote;
    const requestRef = needsPreview ? previewRequestRef : confirmRequestRef;
    if (requestRef.current.signature !== requestSignature) {
      requestRef.current = { signature: requestSignature, key: makeRequestKey() };
    }
    submitInFlightRef.current = true;
    const submitAction = needsPreview ? 'preview' : quoteRequired ? 'propose' : 'confirm';
    setSubmittingAction(submitAction);
    try {
      const response = await authFetch('/api/mood-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestPayload,
          action: submitAction,
          idempotencyKey: requestRef.current.key,
          ...(!needsPreview && activeQuote ? { quoteId: activeQuote.quoteId } : {}),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        const errorCode = String(json.error || '');
        if ([
          'CHANGE_QUOTE_REQUIRED',
          'CHANGE_QUOTE_EXPIRED',
          'CHANGE_QUOTE_MISMATCH',
          'CHANGE_QUOTE_INTEGRITY_FAILED',
          'CHANGE_QUOTE_ALREADY_USED',
          'CHANGE_QUOTE_BALANCE_STALE',
          'CHANGE_QUOTE_NOT_FOUND',
          'REVISION_CONFLICT',
          'BOOKING_NOT_CHANGEABLE',
          'SETTLEMENT_APPROVAL_PENDING',
        ].includes(errorCode)) {
          setQuote(null);
          previewRequestRef.current = { signature: '', key: '' };
          confirmRequestRef.current = { signature: '', key: '' };
        }
        throw new Error(changeErrorMessage(errorCode));
      }
      if (needsPreview) {
        const preview = json.data || {};
        const quoteId = String(preview.quoteId || '');
        const previewRevision = Number(preview.expectedRevision);
        const expiresAt = Number(preview.expiresAt);
        const oldAmountKRW = Number(preview.oldAmountKRW);
        const amountKRW = Number(preview.amountKRW);
        const adjustmentKRW = Number(preview.adjustmentKRW);
        const nextBalanceKRW = Number(preview.balanceKRW);
        const breakdown = preview.breakdown;
        if (
          !/^[a-f0-9]{64}$/.test(quoteId)
          || preview.currency !== 'KRW'
          || previewRevision !== Number(booking.revision || 0)
          || !Number.isSafeInteger(expiresAt)
          || expiresAt <= Date.now()
          || !Number.isSafeInteger(oldAmountKRW)
          || oldAmountKRW !== booking.amountKRW
          || !Number.isSafeInteger(amountKRW)
          || amountKRW < 0
          || !Number.isSafeInteger(adjustmentKRW)
          || adjustmentKRW !== amountKRW - oldAmountKRW
          || !Number.isSafeInteger(nextBalanceKRW)
          || nextBalanceKRW !== balanceKRW - adjustmentKRW
          || !breakdown
          || typeof breakdown !== 'object'
          || Array.isArray(breakdown)
        ) {
          throw new Error('서버 금액 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
        }
        setQuote({
          quoteId,
          expectedRevision: previewRevision,
          expiresAt,
          oldAmountKRW,
          amountKRW,
          adjustmentKRW,
          balanceKRW: nextBalanceKRW,
          breakdown,
          routeSnapshot: preview.routeSnapshot || null,
          changedFields: Array.isArray(preview.changedFields) ? preview.changedFields : [],
          requestSignature,
        });
        confirmRequestRef.current = { signature: '', key: '' };
        setMessage('');
        return;
      }
      confirmRequestRef.current = { signature: requestSignature, key: requestRef.current.key };
      await onChanged();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '예약을 변경하지 못했습니다.');
    } finally {
      submitInFlightRef.current = false;
      setSubmittingAction(null);
    }
  };

  return (
    <div
      className="mood-surface fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-2 sm:p-3"
      onMouseDown={(event) => { if (event.target === event.currentTarget) attemptClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mood-change-title"
        aria-describedby="mood-change-description"
        className="max-h-[94vh] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-3xl border border-white/10 bg-[#11131a] p-3 text-white shadow-2xl sm:p-7"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-violet-300">RESERVATION CHANGE</p>
            <h2 id="mood-change-title" className="mt-1 text-2xl font-black">예약 내용 변경</h2>
            <p id="mood-change-description" className="mt-1 text-sm leading-relaxed text-slate-300">
              금액에 영향이 있는 변경은 운영자가 서버 계산 금액을 제안하고, MOOD 담당자가 확인해야 반영됩니다.
            </p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={attemptClose} className="mood-icon-button min-h-11 shrink-0 whitespace-nowrap rounded-full bg-white/10 px-4 text-sm outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-violet-300">닫기</button>
        </div>

        <details open className="group rounded-2xl border border-white/10 bg-white/[0.035]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-sm font-black outline-none focus-visible:ring-2 focus-visible:ring-violet-300 sm:px-4">
            <span>1. 기본 정보</span>
            <ChevronDown className="h-4 w-4 text-violet-200 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="grid gap-4 border-t border-white/10 p-3 sm:grid-cols-2 sm:p-4">
          <label className="text-sm font-bold">날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          <label className="text-sm font-bold">시작 시각<input type="time" value={startTime} onChange={(event) => handleStartTimeChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3 outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-300" /></label>
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
            <label className="text-sm font-bold">이용 시간<input type="number" min={1} max={15} step={0.5} value={durationHoursInput} onChange={(event) => {
              const nextValue = event.target.value;
              setDurationHoursInput(nextValue);
              const parsed = Number(nextValue);
              if (nextValue.trim() && Number.isFinite(parsed) && parsed >= 1 && parsed <= 15) {
                setLastValidDurationHours(parsed);
              }
            }} onBlur={() => {
              if (!durationHoursInput.trim()) setDurationHoursInput(String(lastValidDurationHours));
            }} className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          )}
          <label className="text-sm font-bold sm:col-span-2">탑승 인플루언서<input value={influencerName} maxLength={100} onChange={(event) => setInfluencerName(event.target.value)} placeholder="공유 화면에 표시할 이름" className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          </div>

        {bookingNoticeRules.length > 0 && <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3" role="note" aria-label="예약 제한 안내">
          <p className="text-xs font-bold text-amber-200">예약 제한 안내</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-200">
            {bookingNoticeRules.map((rule) => (
              <li key={rule.id}>{formatMoodBookingRuleSummary(rule)} · {rule.reason}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-300">시각 제한은 시작 시각에만 적용됩니다. 이미 확정된 날짜·시각은 그대로 유지할 수 있습니다.</p>
        </div>}

        {bookingChangeBlocked && (
          <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200" role="alert">
            {nextBlockStatus.availabilityReady
              ? `${nextBlockStatus.rule?.reason} 때문에 ${date} ${startTime} 시작으로 변경할 수 없습니다.`
              : MOOD_BOOKING_AVAILABILITY_UNAVAILABLE_MESSAGE}
          </p>
        )}
        {keepsGrandfatheredTime && (
          <p className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-xs font-bold text-emerald-200" role="status">
            기존 확정 예약의 날짜·시각을 유지해 주소·메모 등 다른 내용은 변경할 수 있습니다. 날짜나 시각을 바꾸면 새 제한 규칙이 적용됩니다.
          </p>
        )}
        </details>

        <details open className="group mt-4 rounded-2xl border border-white/10 bg-white/[0.035]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-sm font-black outline-none focus-visible:ring-2 focus-visible:ring-violet-300 sm:px-4">
            <span>2. 동선·일정</span>
            <ChevronDown className="h-4 w-4 text-violet-200 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
        <section className="border-t border-white/10 px-2 pb-3 pt-3 sm:p-4" aria-labelledby="mood-route-title">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 id="mood-route-title" className="text-sm font-black text-white">이동 경로</h3>
              <p id="mood-route-reorder-help" className="mt-1 text-xs leading-relaxed text-slate-400">
                손잡이를 끌어 순서를 바꾸세요. 맨 앞은 출발지, 맨 뒤는 도착지가 됩니다.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-black text-slate-300">{routeStops.length}/7</span>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setShowSchedulePaste((visible) => !visible);
                setSchedulePreview(null);
                setScheduleTransferMessage('');
              }}
              aria-expanded={showSchedulePaste}
              aria-controls="mood-schedule-paste-panel"
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-violet-300/25 bg-violet-400/10 px-2 text-xs font-black text-violet-100 outline-none transition hover:bg-violet-400/15 focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <ClipboardPaste className="h-4 w-4" aria-hidden="true" /> 전체 일정 붙여넣기
            </button>
            <button
              type="button"
              onClick={copyScheduleText}
              disabled={!routeComplete}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 text-xs font-black text-slate-100 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Clipboard className="h-4 w-4" aria-hidden="true" /> 전체 일정 복사
            </button>
          </div>

          {showSchedulePaste && (
            <div id="mood-schedule-paste-panel" className="mb-3 rounded-2xl border border-violet-300/20 bg-black/20 p-3">
              <label htmlFor="mood-schedule-paste-text" className="text-xs font-black text-white">
                카카오톡 전체 일정
              </label>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                복사한 일정이나 자유문장을 붙여넣으세요. 분석 결과는 바로 저장되지 않고 먼저 미리보기로 보여드립니다.
              </p>
              <textarea
                id="mood-schedule-paste-text"
                value={schedulePasteText}
                onChange={(event) => {
                  setSchedulePasteText(event.target.value);
                  setSchedulePreview(null);
                }}
                rows={7}
                maxLength={8000}
                placeholder={'[차량 전체 일정]\n\n1. 출발 주소 → 도착 주소\n출발 09:00 / 도착 10:00'}
                className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-[#181b25] px-3 py-3 text-sm leading-relaxed text-white outline-none placeholder:text-slate-500 focus:border-violet-300 focus:ring-1 focus:ring-violet-300"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={analyzeSchedulePaste}
                  disabled={scheduleParsing || !schedulePasteText.trim()}
                  className="min-h-11 rounded-xl bg-violet-500 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                >
                  {scheduleParsing ? '일정 읽는 중…' : '미리보기 만들기'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSchedulePaste(false);
                    setSchedulePreview(null);
                  }}
                  className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-black text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  닫기
                </button>
              </div>

              {schedulePreview && (
                <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black text-emerald-100">적용 전 미리보기</p>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-bold text-slate-200">
                      {schedulePreview.source === 'text' ? '복사 형식' : '자유문장 분석'}
                    </span>
                  </div>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/25 p-3 font-sans text-xs leading-6 text-slate-100">
                    {formatMoodRouteScheduleText({
                      date: schedulePreview.date || date,
                      addresses: schedulePreview.addresses,
                      routeSchedule: schedulePreview.routeSchedule,
                      startTime: schedulePreview.startTime,
                    })}
                  </pre>
                  {schedulePreview.warnings.map((warning) => (
                    <p key={warning} className="mt-2 text-xs font-bold leading-relaxed text-amber-200">⚠️ {warning}</p>
                  ))}
                  <button
                    type="button"
                    onClick={applySchedulePreview}
                    className="mt-3 min-h-11 w-full rounded-xl bg-emerald-500 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    이 일정 화면에 적용
                  </button>
                </div>
              )}
            </div>
          )}

          {scheduleTransferMessage && (
            <p className="mb-3 rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-bold leading-relaxed text-slate-200" role="status" aria-live="polite">
              {scheduleTransferMessage}
            </p>
          )}

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
              <ol className="space-y-1" aria-label="예약 이동 경로">
                {routeStops.map((stop, index) => (
                  <SortableRouteStop
                    key={stop.id}
                    stop={stop}
                    index={index}
                    count={routeStops.length}
                    canRemove={routeStops.length > 2}
                    canInsertAfter={routeStops.length < MAX_ROUTE_STOPS && index < routeStops.length - 1}
                    isExpanded={expandedStopId === stop.id}
                    isRecentlyMoved={recentlyMovedStopId === stop.id}
                    onAddressChange={updateRouteStopAddress}
                    onSelectAddress={selectAddress}
                    onRemove={removeRouteStop}
                    onInsertAfter={addRouteStopAfter}
                    onToggleSchedule={(id) => setExpandedStopId((current) => current === id ? null : id)}
                    onTimeChange={updateRouteStopTime}
                    onSetWait={setRouteStopWait}
                    onMove={moveRouteStop}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>

          {routeStops.length >= MAX_ROUTE_STOPS && (
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
            <p className="mt-3 text-xs font-bold text-amber-200" role="status">빈 장소를 입력하거나 삭제해 주세요.</p>
          )}
          {submittingAction === 'preview' && <p className="mt-3 text-xs text-slate-300" role="status">서버에서 새 동선과 금액을 계산하는 중…</p>}
          {quoteRequired && !activeQuote && !routeBlocked && submittingAction !== 'preview' && (
            <p className="mt-3 rounded-xl bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-100" role="status">
              입력을 마치고 금액 미리보기를 누르면 새 동선을 한 번 계산합니다.
            </p>
          )}
          {route && (
            <p className="mt-3 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-200" role="status">
              동선 {route.km}km · 약 {route.durationMin}분 · 예상 통행료 {formatKRW(route.tollKRW)}
            </p>
          )}
          <div className="mood-route-map-touch mt-3">
            <MoodRouteMap origin={origin} destination={destination} waypoints={waypoints.filter(Boolean)} route={route} accent="#a78bfa" inputBg="#171923" inputBorder="1px solid rgba(255,255,255,.12)" textDim="#94a3b8" />
          </div>
          {courseItems.length >= 2 && (
            <div className="-mx-2 mt-3 sm:mx-0">
              <MoodCourseShareEditor
                items={courseItems}
                percentages={courseMoodPercentages}
                totalKRW={estimatedAmountKRW}
                influencerName={influencerName}
                onChange={updateCourseMoodPercentages}
              />
            </div>
          )}
          {courseItems.length >= 2 && !estimateReady && (
            <p className="mt-3 text-xs text-slate-300">현재는 기존 총액 기준입니다. 서버 미리보기 뒤 새 금액으로 갱신됩니다.</p>
          )}
        </section>
        </details>

        <details open className="group mt-4 rounded-2xl border border-white/10 bg-white/[0.035]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-sm font-black outline-none focus-visible:ring-2 focus-visible:ring-violet-300 sm:px-4">
            <span>3. 금액 확인</span>
            <ChevronDown className="h-4 w-4 text-violet-200 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
        <div className="grid grid-cols-3 gap-2 border-t border-violet-400/20 bg-violet-400/10 p-3 text-center sm:p-4">
          <div><p className="text-xs text-slate-400">변경 전</p><p className="mt-1 font-black">{formatKRW(booking.amountKRW)}</p></div>
          <div><p className="text-xs text-slate-400">변경 후</p><p className="mt-1 font-black text-violet-200" translate="no">{estimateReady ? formatKRW(estimatedAmountKRW) : '미리보기 필요'}</p></div>
          <div><p className="text-xs text-slate-400">잔액 변화</p><p className={`mt-1 font-black ${!estimateReady ? 'text-slate-300' : adjustment > 0 ? 'text-rose-300' : adjustment < 0 ? 'text-emerald-300' : ''}`}>{!estimateReady ? '확인 전' : adjustment === 0 ? '변동 없음' : `${adjustment > 0 ? '-' : '+'}${formatKRW(Math.abs(adjustment))}`}</p></div>
          <p className="col-span-3 mt-2 border-t border-white/10 pt-2 text-xs text-slate-300">
            {estimateReady ? `변경 뒤 잔액 ${formatKRW(nextBalance)}` : '서버 미리보기와 같은 견적으로만 최종 확정됩니다.'}
          </p>
        </div>

        <div className="p-3 sm:p-4">
          <p className="text-xs font-black text-white">바뀐 항목</p>
          {hasChanges ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
              {changedFieldKeys.map((key) => (
                <span key={key} className="rounded-full border border-violet-300/25 bg-violet-400/10 px-2.5 py-1 text-xs font-bold text-violet-100">
                  {changedFieldLabels[key] || key}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-bold text-slate-300" role="status">변경된 내용이 없습니다.</p>
          )}

          {activeQuote && (
            <div className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-black text-emerald-100">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> 서버 금액 확인 완료
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-200">이 입력값과 예약 개정 번호에 묶인 견적입니다. 입력을 바꾸면 다시 확인해야 합니다.</p>
            </div>
          )}
          {hasInvalidatedQuote && (
            <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100" role="status">
              미리보기 뒤 입력이 바뀌었습니다. 금액을 다시 확인해 주세요.
            </p>
          )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">예약 메모<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
          <label className="text-sm font-bold">변경 이유 <span className="text-rose-300">필수</span><textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="예: 촬영지 변경으로 도착지 수정" className="mt-1 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-3" /></label>
        </div>
        {message && <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200" role="alert">{message}</p>}
        </div>
        </details>

        <div className="sticky -bottom-3 z-20 -mx-3 mt-4 border-t border-white/10 bg-[#11131a]/95 px-3 pb-3 pt-3 shadow-[0_-14px_30px_rgba(0,0,0,0.35)] backdrop-blur sm:-bottom-7 sm:-mx-7 sm:px-7 sm:pb-7">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-bold text-slate-300">{hasChanges ? `${changedFieldKeys.length}개 항목 변경` : '변경 없음'}</span>
            <span className="font-black text-violet-100" translate="no">{estimateReady ? formatKRW(estimatedAmountKRW) : '금액 확인 전'}</span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!!submittingAction || routeBlocked || bookingChangeBlocked || !hasChanges || !reason.trim() || (quoteRequired && !isAdmin)}
            className="mood-primary-action min-h-14 w-full rounded-2xl bg-violet-500 px-4 text-base font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submittingAction === 'preview'
              ? '서버 금액 확인 중…'
              : submittingAction === 'confirm'
                ? '변경 확정 중…'
                : submittingAction === 'propose'
                  ? 'MOOD 확인 요청 중…'
                : bookingChangeBlocked
                  ? !nextBlockStatus.availabilityReady
                    ? '예약 차단 설정 확인 필요'
                    : nextBlockStatus.rule?.mode === 'full_day'
                      ? '해당 날짜로 변경 불가'
                      : '선택 시각으로 변경 불가'
                  : routeBlocked
                    ? '빈 장소를 확인해 주세요'
                    : !hasChanges
                      ? '변경된 내용이 없습니다'
                      : !reason.trim()
                        ? '변경 이유를 입력해 주세요'
                        : quoteRequired && !isAdmin
                          ? '금액 변경은 운영자만 요청할 수 있습니다'
                        : quoteRequired && !activeQuote
                          ? '변경 내용과 금액 미리보기'
                          : quoteRequired
                            ? `${formatKRW(activeQuote?.amountKRW || estimatedAmountKRW)} · MOOD 확인 요청`
                            : '금액 변동 없이 변경 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
