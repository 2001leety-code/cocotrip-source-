import { useMemo, useRef, useState } from 'react';

import { authFetch } from '@/lib/authFetch';
import { openDaumPostcode } from '@/lib/daumPostcode';
import { formatKRW, MOOD_MAX_DURATION_HOURS, MOOD_MIN_DURATION_HOURS, type MoodServiceType } from '@/lib/moodPricing';
import { appendMoodCoursePercentage, normalizeMoodCoursePercentages } from '@/lib/moodBookingShare';
import { MoodCourseShareEditor } from '@/components/mood/MoodCourseShareEditor';

export type SettlementMode = 'initial' | 'correction';
type DistanceMode = 'manual' | 'route' | 'booked' | 'unchanged';
export type TollMode = 'estimated' | 'none' | 'actual' | 'itemized';

export interface SettlementTollEntry {
  label: string;
  date?: string | null;
  amountKRW: number;
  status: 'pending' | 'confirmed';
  includedInSettlement: boolean;
  evidenceRef?: string | null;
}

export interface SettlementBreakdown {
  baseKRW?: number;
  distanceSurchargeKRW?: number;
  tollKRW?: number;
  estimatedTollKRW?: number;
  km?: number;
  distanceSource?: 'manual' | 'route' | 'booked';
  actualTotalKm?: number;
  excludedKm?: number;
  origin?: string;
  destination?: string;
  waypoints?: string[] | null;
}

export interface SettlementApprovalSummary {
  status: 'awaiting_mood' | 'changes_requested' | 'approved' | 'withdrawn';
  mode: SettlementMode;
  proposalId: string;
  version: number;
  bookedAmountKRW: number;
  previousFinalAmountKRW: number | null;
  finalAmountKRW: number;
  deltaKRW: number;
  actualHours: number;
  finalBreakdown: SettlementBreakdown;
  tollMode: TollMode;
  tollEntries: SettlementTollEntry[] | null;
  settlementReason: string;
  proposedByEmail: string;
  proposedAt: number;
  changeRequestReason: string | null;
  approvedByEmail: string | null;
  approvedAt: number | null;
  proposedBalanceKRW: number;
  proposedResultingBalanceKRW: number;
  pendingIncludedTollCount: number;
}

interface TollEntryDraft {
  key: string;
  label: string;
  date: string;
  amountKRW: string;
  status: 'pending' | 'confirmed';
  includedInSettlement: boolean;
  evidenceRef: string;
}

export interface SettlementBooking {
  id: string;
  date: string;
  startTime: string;
  durationHours: number;
  serviceType: MoodServiceType;
  amountKRW: number;
  status: string;
  revision?: number;
  breakdown?: SettlementBreakdown | null;
  finalBreakdown?: SettlementBreakdown | null;
  actualHours?: number | null;
  finalAmountKRW?: number | null;
  manualAdjustmentKRW?: number | null;
  settlementReason?: string | null;
  tollMode?: TollMode | null;
  tollEntries?: SettlementTollEntry[] | null;
  influencerName?: string | null;
  courseMoodPercentages?: number[] | null;
  coursePayers?: Array<'mood' | 'influencer'> | null;
  settlementApproval?: SettlementApprovalSummary | null;
}

interface PreviewData {
  mode?: SettlementMode;
  bookingId: string;
  revision: number;
  actualHours: number;
  km: number;
  distanceSource: 'manual' | 'route' | 'booked';
  actualTotalKm?: number | null;
  excludedKm?: number | null;
  baseKRW: number;
  distanceSurchargeKRW: number;
  estimatedTollKRW: number;
  tollKRW: number;
  manualAdjustmentKRW: number;
  bookedAmountKRW: number;
  previousFinalAmountKRW?: number;
  finalAmountKRW: number;
  deltaKRW: number;
  currentBalanceKRW: number;
  resultingBalanceKRW: number;
  previewHash: string;
}

interface Props {
  booking: SettlementBooking;
  mode: SettlementMode;
  onClose: () => void;
  onCompleted: (message: string) => void | Promise<void>;
}

const palette = {
  card: 'rgba(15,18,32,0.96)',
  input: 'rgba(124,92,252,0.06)',
  border: '1px solid rgba(124,92,252,0.20)',
  text: '#ffffff',
  dim: 'rgba(255,255,255,0.60)',
  accent: '#B668FC',
  danger: '#f87171',
  ok: '#6ee7b7',
  gradient: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
};

const inputStyle = { background: palette.input, border: palette.border, color: palette.text };
const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
const formControlClass = `min-h-[44px] ${focusClass}`;
const touchButtonClass = `min-h-[44px] ${focusClass}`;

function requestKey(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sanitizeKeyForId(key: string): string {
  return key.replace(/\s+/g, '');
}

function draftFromEntry(entry: SettlementTollEntry, index: number): TollEntryDraft {
  return {
    key: `${index}-${entry.date || ''}-${entry.label}`,
    label: entry.label,
    date: entry.date || '',
    amountKRW: String(entry.amountKRW),
    status: entry.status,
    includedInSettlement: entry.includedInSettlement,
    evidenceRef: entry.evidenceRef || '',
  };
}

function blankTollEntry(): TollEntryDraft {
  return {
    key: requestKey('toll'),
    label: '',
    date: '',
    amountKRW: '',
    status: 'pending',
    includedInSettlement: true,
    evidenceRef: '',
  };
}

function apiErrorMessage(error: string) {
  const messages: Record<string, string> = {
    EXCLUDED_KM_EXCEEDS_TOTAL: '제외 거리는 전체 주행거리보다 클 수 없습니다.',
    INVALID_ACTUAL_TOTAL_KM: '전체 주행거리를 0~3,000km 범위로 입력해 주세요.',
    INVALID_EXCLUDED_KM: '제외 거리를 0km 이상으로 입력해 주세요.',
    PENDING_TOLL_ACK_REQUIRED: '미확정 톨비를 잠정 반영한다는 확인이 필요합니다.',
    SETTLEMENT_REASON_REQUIRED: '실제값을 바꾼 이유를 입력해 주세요.',
    CORRECTION_REASON_REQUIRED: '정정 이유를 입력해 주세요.',
    CREDIT_LIMIT_EXCEEDED: '정산 뒤 잔액이 허용된 외상 한도를 넘습니다.',
    STALE_REVISION: '다른 운영자가 먼저 수정했습니다. 새로고침 후 다시 확인해 주세요.',
    BOOKING_CHANGED: '미리보기 뒤 예약이 바뀌었습니다. 다시 미리보기해 주세요.',
    PREVIEW_MISMATCH: '입력값이 미리보기와 달라졌습니다. 다시 미리보기해 주세요.',
    ALREADY_SETTLED: '이미 정산된 예약입니다. 정산 정정을 이용해 주세요.',
    IDEMPOTENCY_CONFLICT: '같은 처리 번호에 다른 정정 내용이 들어왔습니다. 화면을 닫고 다시 시도해 주세요.',
    PROPOSAL_ALREADY_PENDING: '이미 MOOD 확인을 기다리는 제안이 있습니다. 먼저 기존 요청을 철회해 주세요.',
    PROPOSAL_CHANGED: '정산 제안이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
    PROPOSAL_NOT_ACTIVE: '이미 처리됐거나 철회된 정산 제안입니다.',
    PROPOSAL_NOT_AWAITING: '이미 처리됐거나 철회된 정산 제안입니다.',
    SETTLEMENT_APPROVAL_MISMATCH: '화면의 제안과 서버 기록이 다릅니다. 새로고침 후 다시 확인해 주세요.',
    NOT_SETTLEMENT_APPROVER: '이 계정에는 정산 금액을 확정할 권한이 없습니다.',
  };
  return messages[error] || error || '처리하지 못했습니다.';
}

export function MoodSettlementEditor({ booking, mode, onClose, onCompleted }: Props) {
  const booked = booking.breakdown || {};
  const current = mode === 'correction' ? (booking.finalBreakdown || booking.breakdown || {}) : booked;
  const proposal = booking.settlementApproval && booking.settlementApproval.mode === mode
    && (booking.settlementApproval.status === 'awaiting_mood' || booking.settlementApproval.status === 'changes_requested')
    ? booking.settlementApproval
    : null;
  const formBreakdown = proposal?.finalBreakdown || current;
  const initialDistanceMode: DistanceMode = proposal
    ? (formBreakdown.distanceSource === 'manual' ? 'manual' : mode === 'correction' ? 'unchanged' : formBreakdown.distanceSource === 'route' ? 'route' : 'booked')
    : mode === 'correction'
      ? (current.distanceSource === 'manual' ? 'manual' : 'unchanged')
      : 'manual';
  const initialTollMode: TollMode = proposal
    ? proposal.tollMode
    : mode === 'correction' && booking.tollMode
      ? booking.tollMode
      : 'estimated';
  const proposalManualAdjustmentKRW = proposal
    ? proposal.finalAmountKRW
      - Number(formBreakdown.baseKRW || 0)
      - Number(formBreakdown.distanceSurchargeKRW || 0)
      - Number(formBreakdown.tollKRW || 0)
    : null;

  const [actualHours, setActualHours] = useState(String(proposal ? proposal.actualHours : mode === 'correction' ? (booking.actualHours || booking.durationHours) : booking.durationHours));
  const [distanceMode, setDistanceMode] = useState<DistanceMode>(initialDistanceMode);
  const [actualTotalKm, setActualTotalKm] = useState(formBreakdown.actualTotalKm === undefined ? '' : String(formBreakdown.actualTotalKm));
  const [excludedKm, setExcludedKm] = useState(formBreakdown.excludedKm === undefined ? '0' : String(formBreakdown.excludedKm));
  const [origin, setOrigin] = useState(formBreakdown.origin || booked.origin || '');
  const [waypoints, setWaypoints] = useState<string[]>(Array.isArray(formBreakdown.waypoints) ? formBreakdown.waypoints.slice() : Array.isArray(booked.waypoints) ? booked.waypoints.slice() : []);
  const [destination, setDestination] = useState(formBreakdown.destination || booked.destination || '');
  const initialStopCount = waypoints.length + 2;
  const [courseMoodPercentages, setCourseMoodPercentages] = useState(normalizeMoodCoursePercentages(
    booking.courseMoodPercentages,
    initialStopCount,
    booking.coursePayers,
    100,
  ));
  const [tollMode, setTollMode] = useState<TollMode>(initialTollMode);
  const [actualTollKRW, setActualTollKRW] = useState(initialTollMode === 'actual' ? String(formBreakdown.tollKRW || 0) : '');
  const [tollEntries, setTollEntries] = useState<TollEntryDraft[]>(
    initialTollMode === 'itemized' && Array.isArray(proposal ? proposal.tollEntries : booking.tollEntries)
      ? (proposal ? proposal.tollEntries || [] : booking.tollEntries || []).map(draftFromEntry)
      : [],
  );
  const [acknowledgePendingTolls, setAcknowledgePendingTolls] = useState(false);
  const [manualAdjustmentKRW, setManualAdjustmentKRW] = useState(String(proposalManualAdjustmentKRW === null ? mode === 'correction' ? (booking.manualAdjustmentKRW || 0) : 0 : proposalManualAdjustmentKRW));
  const [reason, setReason] = useState(proposal?.settlementReason || '');
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ signature: string; data: PreviewData } | null>(null);
  const requestKeyRef = useRef('');

  const billableKm = useMemo(() => {
    const total = Number(actualTotalKm);
    const excluded = Number(excludedKm);
    if (!actualTotalKm.trim() || !excludedKm.trim() || !Number.isFinite(total) || !Number.isFinite(excluded) || total < excluded) return null;
    return Math.round((total - excluded) * 10) / 10;
  }, [actualTotalKm, excludedKm]);
  const includedTollKRW = useMemo(() => tollEntries.reduce((sum, entry) => {
    const amount = Number(entry.amountKRW);
    return entry.includedInSettlement && Number.isSafeInteger(amount) && amount >= 0 ? sum + amount : sum;
  }, 0), [tollEntries]);
  const pendingIncludedCount = useMemo(
    () => tollEntries.filter((entry) => entry.includedInSettlement && entry.status === 'pending').length,
    [tollEntries],
  );
  const draftSignature = useMemo(() => JSON.stringify({
    bookingId: booking.id,
    revision: booking.revision || 0,
    mode,
    actualHours,
    distanceMode,
    actualTotalKm,
    excludedKm,
    origin,
    waypoints,
    destination,
    courseMoodPercentages,
    tollMode,
    actualTollKRW,
    tollEntries,
    acknowledgePendingTolls,
    manualAdjustmentKRW,
    reason,
  }), [booking.id, booking.revision, mode, actualHours, distanceMode, actualTotalKm, excludedKm, origin, waypoints, destination, courseMoodPercentages, tollMode, actualTollKRW, tollEntries, acknowledgePendingTolls, manualAdjustmentKRW, reason]);
  const validPreview = preview && preview.signature === draftSignature ? preview.data : null;

  const courseItems = useMemo(() => [origin, ...waypoints, destination]
    .map((address, percentageIndex) => ({ address: address.trim(), percentageIndex }))
    .filter((item) => Boolean(item.address)), [origin, waypoints, destination]);

  function updateTollEntry(key: string, patch: Partial<TollEntryDraft>) {
    setTollEntries((entries) => entries.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }

  function addWaypoint() {
    if (waypoints.length >= 5) return;
    setWaypoints((items) => [...items, '']);
    setCourseMoodPercentages(appendMoodCoursePercentage);
  }

  function removeWaypoint(index: number) {
    setWaypoints((items) => items.filter((_, itemIndex) => itemIndex !== index));
    setCourseMoodPercentages((items) => items.filter((_, itemIndex) => itemIndex !== index + 1));
  }

  async function searchAddress(apply: (address: string) => void) {
    try {
      const address = await openDaumPostcode();
      if (address) apply(address);
    } catch {
      setMessage({ kind: 'err', text: '주소 검색을 열지 못했습니다. 주소를 직접 입력해 주세요.' });
    }
  }

  function buildPayload() {
    const parsedHours = Number(actualHours);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0 || parsedHours > MOOD_MAX_DURATION_HOURS) {
      return { ok: false as const, error: `실제 시간을 0 초과 ${MOOD_MAX_DURATION_HOURS}시간 이하로 입력해 주세요.` };
    }
    const parsedManualAdjustment = Number(manualAdjustmentKRW || 0);
    if (!Number.isSafeInteger(parsedManualAdjustment) || Math.abs(parsedManualAdjustment) > 10000000) {
      return { ok: false as const, error: '기타 금액 조정은 ±10,000,000원 이내 정수로 입력해 주세요.' };
    }
    const payload: Record<string, unknown> = {
      bookingId: booking.id,
      actualHours: parsedHours,
      manualAdjustmentKRW: parsedManualAdjustment,
    };
    if (mode === 'correction') {
      payload.expectedRevision = booking.revision || 0;
      payload.reason = reason.trim();
      if (!reason.trim()) return { ok: false as const, error: '정정 이유를 입력해 주세요.' };
    } else {
      payload.settlementReason = reason.trim() || undefined;
    }

    if (distanceMode === 'manual') {
      const total = Number(actualTotalKm);
      const excluded = Number(excludedKm);
      if (!actualTotalKm.trim() || !excludedKm.trim() || !Number.isFinite(total) || total < 0 || total > 3000) {
        return { ok: false as const, error: '전체 주행거리를 0~3,000km 범위로 입력해 주세요.' };
      }
      if (!Number.isFinite(excluded) || excluded < 0 || excluded > total) {
        return { ok: false as const, error: '제외 거리는 0km 이상, 전체 주행거리 이하여야 합니다.' };
      }
      payload.actualTotalKm = total;
      payload.excludedKm = excluded;
    } else if (distanceMode === 'route') {
      if (mode === 'correction') return { ok: false as const, error: '정정에서는 주소 재측정을 사용할 수 없습니다.' };
      const cleanOrigin = origin.trim();
      const cleanDestination = destination.trim();
      if (!cleanOrigin || !cleanDestination) return { ok: false as const, error: '실제 경로의 출발지와 도착지를 모두 입력해 주세요.' };
      const cleanWaypoints = waypoints
        .map((address, index) => ({ address: address.trim(), percentage: courseMoodPercentages[index + 1] || 0 }))
        .filter((item) => Boolean(item.address));
      payload.origin = cleanOrigin;
      payload.destination = cleanDestination;
      payload.waypoints = cleanWaypoints.map((item) => item.address);
      payload.courseMoodPercentages = [
        courseMoodPercentages[0] || 0,
        ...cleanWaypoints.map((item) => item.percentage),
        courseMoodPercentages[courseMoodPercentages.length - 1] || 0,
      ];
    }

    payload.tollMode = tollMode;
    if (tollMode === 'actual') {
      const amount = Number(actualTollKRW);
      if (!actualTollKRW.trim() || !Number.isSafeInteger(amount) || amount < 0 || amount > 1000000) {
        return { ok: false as const, error: '실제 톨비를 0~1,000,000원 정수로 입력해 주세요.' };
      }
      payload.actualTollKRW = amount;
    } else if (tollMode === 'itemized') {
      const normalizedEntries: SettlementTollEntry[] = [];
      for (const entry of tollEntries) {
        const amount = Number(entry.amountKRW);
        if (!entry.label.trim() || !entry.amountKRW.trim() || !Number.isSafeInteger(amount) || amount < 0 || amount > 1000000) {
          return { ok: false as const, error: '톨비 각 행의 항목명과 0원 이상 정수 금액을 확인해 주세요.' };
        }
        normalizedEntries.push({
          label: entry.label.trim(),
          date: entry.date.trim() || null,
          amountKRW: amount,
          status: entry.status,
          includedInSettlement: entry.includedInSettlement,
          evidenceRef: entry.evidenceRef.trim() || null,
        });
      }
      if (pendingIncludedCount > 0 && !acknowledgePendingTolls) {
        return { ok: false as const, error: '미확정 톨비를 잠정 반영한다는 확인이 필요합니다.' };
      }
      payload.tollEntries = normalizedEntries;
      payload.acknowledgePendingTolls = acknowledgePendingTolls;
    }
    if (mode === 'initial' && (distanceMode === 'manual' || tollMode !== 'estimated' || parsedManualAdjustment !== 0) && !reason.trim()) {
      return { ok: false as const, error: '예약값과 다르게 정산하는 이유를 입력해 주세요.' };
    }
    return { ok: true as const, payload };
  }

  async function handlePreview() {
    const built = buildPayload();
    if (!built.ok) {
      setMessage({ kind: 'err', text: built.error });
      return;
    }
    setPreviewing(true);
    setMessage(null);
    try {
      const res = await authFetch('/api/mood-settle-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...built.payload, mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setMessage({ kind: 'err', text: apiErrorMessage(json?.error || `미리보기 실패 (${res.status})`) });
        return;
      }
      requestKeyRef.current = requestKey(`mood-settle-${mode}`);
      setPreview({ signature: draftSignature, data: json.data as PreviewData });
      setMessage({ kind: 'ok', text: '서버 계산이 끝났습니다. 아래 금액을 확인해 주세요.' });
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : '미리보기를 불러오지 못했습니다.' });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!validPreview) {
      setMessage({ kind: 'err', text: '현재 입력값으로 다시 미리보기해 주세요.' });
      return;
    }
    const built = buildPayload();
    if (!built.ok) {
      setMessage({ kind: 'err', text: built.error });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const endpoint = mode === 'correction' ? '/api/mood-settle-correct' : '/api/mood-settle';
      const payload = {
        ...built.payload,
        expectedRevision: validPreview.revision,
        idempotencyKey: requestKeyRef.current || requestKey(`mood-settle-${mode}`),
        previewHash: validPreview.previewHash,
      };
      const res = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setMessage({ kind: 'err', text: apiErrorMessage(json?.error || `확정 실패 (${res.status})`) });
        return;
      }
      const delta = typeof json.data.deltaKRW === 'number' ? json.data.deltaKRW : Number(json.data.adjustmentKRW || 0);
      const changeText = delta > 0 ? `추가 ${formatKRW(delta)}` : delta < 0 ? `환원 ${formatKRW(-delta)}` : '차액 없음';
      await onCompleted(`확인 요청 전송 · 최종 ${formatKRW(json.data.finalAmountKRW)} · ${changeText} · 잔액 변경 없음`);
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : '확정하지 못했습니다.' });
    } finally {
      setSubmitting(false);
    }
  }

  const bookedTotal = booking.amountKRW;
  const currentTotal = mode === 'correction' && typeof booking.finalAmountKRW === 'number' ? booking.finalAmountKRW : bookedTotal;

  return (
    <section className="mt-3 rounded-2xl p-3" style={{ background: palette.card, border: palette.border }} aria-label={mode === 'correction' ? '정산 정정' : '실제 이용 정산'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black" style={{ color: palette.text }}>{mode === 'correction' ? '정산 정정' : '실제 이용 입력'}</p>
          <p className="text-[10px] mt-0.5" style={{ color: palette.dim }}>입력 → 서버 미리보기 → 운영자 확인 요청 → MOOD 확인 순서입니다.</p>
        </div>
        <button type="button" onClick={onClose} className={`rounded-lg px-2.5 text-xs ${touchButtonClass}`} style={{ color: palette.dim, border: palette.border }}>닫기</button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl p-2.5" style={{ background: palette.input, border: palette.border }}>
          <p className="font-bold" style={{ color: palette.dim }}>{mode === 'correction' ? '현재 정산' : '예약 원본'}</p>
          <p className="mt-1" style={{ color: palette.text }}>{mode === 'correction' ? (booking.actualHours || booking.durationHours) : booking.durationHours}시간</p>
          <p style={{ color: palette.text }}>{Number(current.km || 0).toLocaleString('ko-KR')}km</p>
          <p style={{ color: palette.text }}>톨비 {formatKRW(Number(current.tollKRW || 0))}</p>
          <p className="font-bold" style={{ color: palette.accent }}>{formatKRW(currentTotal)}</p>
        </div>
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(110,231,183,0.07)', border: '1px solid rgba(110,231,183,0.20)' }}>
          <p className="font-bold" style={{ color: palette.ok }}>입력 중인 실제값</p>
          <p className="mt-1" style={{ color: palette.text }}>{actualHours || '-'}시간</p>
          <p style={{ color: palette.text }}>{distanceMode === 'manual' ? (billableKm === null ? '거리 입력 필요' : `${billableKm.toLocaleString('ko-KR')}km`) : distanceMode === 'route' ? '경로 재측정' : `${Number(current.km || 0).toLocaleString('ko-KR')}km`}</p>
          <p style={{ color: palette.text }}>톨비 {tollMode === 'itemized' ? formatKRW(includedTollKRW) : tollMode === 'actual' ? formatKRW(Number(actualTollKRW || 0)) : tollMode === 'none' ? '0원' : formatKRW(Number(current.tollKRW || 0))}</p>
          <p style={{ color: palette.dim }}>최종 금액은 미리보기에서 계산</p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <label htmlFor="mood-settlement-actual-hours" className="text-[11px] font-semibold" style={{ color: palette.dim }}>실제 이용 시간
          <input id="mood-settlement-actual-hours" name="actualHours" type="number" min={MOOD_MIN_DURATION_HOURS} max={MOOD_MAX_DURATION_HOURS} step="0.5" value={actualHours} onChange={(event) => setActualHours(event.target.value)} className={`mt-1 w-full rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} />
        </label>

        <div className="rounded-xl p-2.5" style={{ background: palette.input, border: palette.border }}>
          <p className="text-[11px] font-bold" style={{ color: palette.dim }}>거리 기준</p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {(mode === 'correction'
              ? [['manual', '실주행 직접 입력'], ['unchanged', '현재 거리 유지']]
              : [['manual', '실주행 직접 입력'], ['route', '주소로 재측정'], ['booked', '예약 거리 유지']]
            ).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setDistanceMode(value as DistanceMode)} className={`rounded-lg px-2 text-[11px] font-semibold ${touchButtonClass}`} style={{ background: distanceMode === value ? palette.gradient : palette.card, border: palette.border, color: palette.text }}>{label}</button>
            ))}
          </div>
          {distanceMode === 'manual' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label htmlFor="mood-settlement-actual-total-km" className="text-[10px]" style={{ color: palette.dim }}>전체 주행거리(km)
                <input id="mood-settlement-actual-total-km" name="actualTotalKm" type="number" min={0} max={3000} step="0.1" value={actualTotalKm} onChange={(event) => setActualTotalKm(event.target.value)} className={`mt-1 w-full rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} placeholder="예: 438" />
              </label>
              <label htmlFor="mood-settlement-excluded-km" className="text-[10px]" style={{ color: palette.dim }}>요금 제외 거리(km)
                <input id="mood-settlement-excluded-km" name="excludedKm" type="number" min={0} max={3000} step="0.1" value={excludedKm} onChange={(event) => setExcludedKm(event.target.value)} className={`mt-1 w-full rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} placeholder="예: 46" />
              </label>
              <div className="col-span-2 rounded-lg px-3 py-2 text-xs font-bold" style={{ color: billableKm === null ? palette.danger : palette.ok, background: palette.card }}>
                정산 거리: {billableKm === null ? '값을 확인해 주세요' : `${actualTotalKm} − ${excludedKm} = ${billableKm.toLocaleString('ko-KR')}km`}
              </div>
            </div>
          )}
          {distanceMode === 'route' && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <input aria-label="실제 출발지" value={origin} onChange={(event) => setOrigin(event.target.value)} className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} placeholder="실제 출발지" />
                <button type="button" aria-label="실제 출발지 주소 검색" onClick={() => { void searchAddress(setOrigin); }} className={`shrink-0 rounded-lg px-2.5 text-[11px] font-semibold ${touchButtonClass}`} style={{ color: palette.accent, border: palette.border }}>주소 검색</button>
              </div>
              {waypoints.map((waypoint, index) => (
                <div key={index} className="flex gap-1.5">
                  <input aria-label={`실제 방문지 ${index + 1}`} value={waypoint} onChange={(event) => setWaypoints((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} placeholder={`실제 방문지 ${index + 1}`} />
                  <button type="button" aria-label={`실제 방문지 ${index + 1} 주소 검색`} onClick={() => { void searchAddress((address) => setWaypoints((items) => items.map((item, itemIndex) => itemIndex === index ? address : item))); }} className={`shrink-0 rounded-lg px-2 text-[11px] font-semibold ${touchButtonClass}`} style={{ color: palette.accent, border: palette.border }}>검색</button>
                  <button type="button" aria-label={`실제 방문지 ${index + 1} 삭제`} onClick={() => removeWaypoint(index)} className={`rounded-lg px-2 text-xs ${touchButtonClass}`} style={{ color: palette.danger, border: palette.border }}>삭제</button>
                </div>
              ))}
              {waypoints.length < 5 && <button type="button" onClick={addWaypoint} className={`self-start rounded-lg px-2.5 text-[11px] underline ${touchButtonClass}`} style={{ color: palette.accent }}>+ 방문지 추가</button>}
              <div className="flex gap-1.5">
                <input aria-label="실제 도착지" value={destination} onChange={(event) => setDestination(event.target.value)} className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} placeholder="실제 도착지" />
                <button type="button" aria-label="실제 도착지 주소 검색" onClick={() => { void searchAddress(setDestination); }} className={`shrink-0 rounded-lg px-2.5 text-[11px] font-semibold ${touchButtonClass}`} style={{ color: palette.accent, border: palette.border }}>주소 검색</button>
              </div>
              {courseItems.length >= 2 && <MoodCourseShareEditor items={courseItems} percentages={courseMoodPercentages} totalKRW={validPreview ? validPreview.finalAmountKRW : booking.amountKRW} influencerName={booking.influencerName} onChange={setCourseMoodPercentages} compact />}
            </div>
          )}
        </div>

        <div className="rounded-xl p-2.5" style={{ background: palette.input, border: palette.border }}>
          <label htmlFor="mood-settlement-toll-mode" className="text-[11px] font-bold" style={{ color: palette.dim }}>톨비 기준
            <select id="mood-settlement-toll-mode" name="tollMode" value={tollMode} onChange={(event) => setTollMode(event.target.value as TollMode)} className={`mt-1 w-full rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle}>
              <option value="estimated">예약 예상 톨비 유지</option>
              <option value="none">톨비 없음 (0원)</option>
              <option value="actual">실제 합계 직접 입력</option>
              <option value="itemized">항목별 입력</option>
            </select>
          </label>
          {tollMode === 'actual' && <input aria-label="실제 톨비 합계(원)" type="number" min={0} max={1000000} value={actualTollKRW} onChange={(event) => setActualTollKRW(event.target.value)} className={`mt-2 w-full rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} placeholder="실제 톨비 합계(원)" />}
          {tollMode === 'itemized' && (
            <div className="mt-2 flex flex-col gap-2">
              {tollEntries.map((entry, index) => (
                <div key={entry.key} className="rounded-xl p-2" style={{ background: palette.card, border: palette.border }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold" style={{ color: palette.dim }}>항목 {index + 1}</span>
                    <button type="button" aria-label={`${index + 1}번 톨비 항목 삭제`} onClick={() => setTollEntries((entries) => entries.filter((item) => item.key !== entry.key))} className={`rounded-lg px-2 text-[10px] ${touchButtonClass}`} style={{ color: palette.danger }}>삭제</button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <input name={`tollEntry-${sanitizeKeyForId(entry.key)}-date`} aria-label={`${index + 1}번 톨비 날짜·시간`} value={entry.date} onChange={(event) => updateTollEntry(entry.key, { date: event.target.value })} className={`rounded-lg px-2 py-1.5 text-[11px] ${formControlClass}`} style={inputStyle} placeholder="날짜·시간" />
                    <input name={`tollEntry-${sanitizeKeyForId(entry.key)}-label`} aria-label={`${index + 1}번 톨비 구간 또는 항목명`} value={entry.label} onChange={(event) => updateTollEntry(entry.key, { label: event.target.value })} className={`rounded-lg px-2 py-1.5 text-[11px] ${formControlClass}`} style={inputStyle} placeholder="구간/항목명" />
                    <input name={`tollEntry-${sanitizeKeyForId(entry.key)}-amount`} aria-label={`${index + 1}번 톨비 금액(원)`} type="number" min={0} max={1000000} value={entry.amountKRW} onChange={(event) => updateTollEntry(entry.key, { amountKRW: event.target.value })} className={`rounded-lg px-2 py-1.5 text-[11px] ${formControlClass}`} style={inputStyle} placeholder="금액(원)" />
                    <select name={`tollEntry-${sanitizeKeyForId(entry.key)}-status`} aria-label={`${index + 1}번 톨비 확정 상태`} value={entry.status} onChange={(event) => updateTollEntry(entry.key, { status: event.target.value as 'pending' | 'confirmed' })} className={`rounded-lg px-2 py-1.5 text-[11px] ${formControlClass}`} style={inputStyle}>
                      <option value="pending">미확정</option>
                      <option value="confirmed">확정</option>
                    </select>
                    <input name={`tollEntry-${sanitizeKeyForId(entry.key)}-evidence`} aria-label={`${index + 1}번 톨비 증빙 메모 또는 링크`} value={entry.evidenceRef} onChange={(event) => updateTollEntry(entry.key, { evidenceRef: event.target.value })} className={`col-span-2 rounded-lg px-2 py-1.5 text-[11px] ${formControlClass}`} style={inputStyle} placeholder="증빙 메모 또는 링크" />
                    <label className={`col-span-2 flex min-h-[44px] items-center gap-2 text-[10px] ${focusClass}`} style={{ color: palette.dim }}>
                      <input type="checkbox" checked={entry.includedInSettlement} onChange={(event) => updateTollEntry(entry.key, { includedInSettlement: event.target.checked })} className={`h-4 w-4 ${focusClass}`} /> 이번 정산에 포함
                    </label>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setTollEntries((entries) => [...entries, blankTollEntry()])} className={`self-start rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${touchButtonClass}`} style={{ color: palette.accent, border: palette.border }}>+ 톨비/제외 항목 추가</button>
              <div className="flex items-center justify-between text-xs" style={{ color: palette.text }}><span>포함 합계</span><b>{formatKRW(includedTollKRW)}</b></div>
              {pendingIncludedCount > 0 && (
                <label className={`flex min-h-[44px] items-start gap-2 rounded-lg p-2 text-[10px] ${focusClass}`} style={{ color: '#fde68a', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <input type="checkbox" checked={acknowledgePendingTolls} onChange={(event) => setAcknowledgePendingTolls(event.target.checked)} className={`mt-0.5 h-4 w-4 ${focusClass}`} />
                  미확정 톨비 {pendingIncludedCount}건을 잠정 금액으로 반영하며, 확정 뒤 달라지면 정산 정정으로 고칩니다.
                </label>
              )}
            </div>
          )}
        </div>

        <label htmlFor="mood-settlement-manual-adjustment" className="text-[11px]" style={{ color: palette.dim }}>기타 금액 조정(원) <span className="opacity-70">· 할인/감액은 음수</span>
          <input id="mood-settlement-manual-adjustment" name="manualAdjustmentKRW" type="number" value={manualAdjustmentKRW} onChange={(event) => setManualAdjustmentKRW(event.target.value)} className={`mt-1 w-full rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} />
        </label>
        <label htmlFor="mood-settlement-reason" className="text-[11px]" style={{ color: palette.dim }}>{mode === 'correction' ? '정정 이유' : '실제값/조정 이유'}
          <textarea id="mood-settlement-reason" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} className={`mt-1 w-full resize-y rounded-lg px-2.5 py-2 text-xs ${formControlClass}`} style={inputStyle} placeholder={mode === 'correction' ? '무엇을 왜 바로잡는지 입력' : '예: 픽업 전 46km 제외, 8월 20일 톨비 캡처 반영'} />
        </label>
      </div>

      <button type="button" onClick={() => { void handlePreview(); }} disabled={previewing || submitting} className={`mt-3 w-full rounded-xl px-3 text-xs font-black disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>{previewing ? '서버 계산 중…' : validPreview ? '금액 다시 미리보기' : '금액 미리보기'}</button>

      {validPreview && (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(110,231,183,0.07)', border: '1px solid rgba(110,231,183,0.22)' }}>
          <div className="flex items-center justify-between"><p className="text-xs font-black" style={{ color: palette.ok }}>서버 정산 미리보기</p><span className="text-[10px]" style={{ color: palette.dim }}>revision {validPreview.revision}</span></div>
          <div className="mt-2 flex flex-col gap-1 text-[11px]" style={{ color: palette.dim }}>
            <div className="flex justify-between"><span>기본요금</span><span style={{ color: palette.text }}>{formatKRW(validPreview.baseKRW)}</span></div>
            <div className="flex justify-between"><span>거리 {validPreview.km.toLocaleString('ko-KR')}km</span><span style={{ color: palette.text }}>+{formatKRW(validPreview.distanceSurchargeKRW)}</span></div>
            <div className="flex justify-between"><span>톨비</span><span style={{ color: palette.text }}>+{formatKRW(validPreview.tollKRW)}</span></div>
            {validPreview.manualAdjustmentKRW !== 0 && <div className="flex justify-between"><span>기타 조정</span><span style={{ color: validPreview.manualAdjustmentKRW > 0 ? palette.danger : palette.ok }}>{validPreview.manualAdjustmentKRW > 0 ? '+' : '−'}{formatKRW(Math.abs(validPreview.manualAdjustmentKRW))}</span></div>}
            <div className="my-1 h-px" style={{ background: 'rgba(255,255,255,0.12)' }} />
            <div className="flex justify-between text-sm font-black"><span style={{ color: palette.text }}>최종 금액</span><span style={{ color: palette.accent }}>{formatKRW(validPreview.finalAmountKRW)}</span></div>
            <div className="flex justify-between"><span>{mode === 'correction' ? '현재 정산 대비' : '예약 대비'}</span><span style={{ color: validPreview.deltaKRW > 0 ? palette.danger : palette.ok }}>{validPreview.deltaKRW > 0 ? '+' : validPreview.deltaKRW < 0 ? '−' : ''}{formatKRW(Math.abs(validPreview.deltaKRW))}</span></div>
            <div className="flex justify-between"><span>MOOD 승인 시 예상 잔액</span><span style={{ color: palette.text }}>{formatKRW(validPreview.currentBalanceKRW)} → {formatKRW(validPreview.resultingBalanceKRW)}</span></div>
          </div>
          <p className="mt-2 text-[10px]" style={{ color: '#fde68a' }}>지금은 잔액이 바뀌지 않습니다. MOOD가 같은 금액을 확인해야 반영됩니다.</p>
          <button type="button" onClick={() => { void handleConfirm(); }} disabled={submitting} className={`mt-3 w-full rounded-xl px-3 text-xs font-black disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>{submitting ? '확인 요청 보내는 중…' : `MOOD에 ${formatKRW(validPreview.finalAmountKRW)} 확인 요청`}</button>
        </div>
      )}

      {preview && !validPreview && <p className="mt-2 rounded-lg px-2.5 py-2 text-[10px]" role="status" aria-live="polite" style={{ color: '#fde68a', background: 'rgba(245,158,11,0.10)' }}>입력값이 바뀌어 이전 미리보기가 무효가 됐습니다. 다시 미리보기해 주세요.</p>}
      {message && <p className="mt-2 text-[11px]" role="status" aria-live="polite" style={{ color: message.kind === 'ok' ? palette.ok : palette.danger }}>{message.text}</p>}
    </section>
  );
}

type SettlementResponseAction = 'approve' | 'request_changes' | 'withdraw';

interface SettlementApprovalPanelProps {
  booking: SettlementBooking;
  isAdmin: boolean;
  canApproveSettlement: boolean;
  onResponded: (message: string) => void | Promise<void>;
  onEdit?: (mode: SettlementMode) => void;
}

function proposalDateTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '시각 기록 없음';
  return new Date(timestamp).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function proposalDeltaText(deltaKRW: number) {
  if (deltaKRW > 0) return `추가 ${formatKRW(deltaKRW)}`;
  if (deltaKRW < 0) return `환원 ${formatKRW(-deltaKRW)}`;
  return '차액 없음';
}

/**
 * 서버가 고정한 정산 제안만 보여주고 응답하는 패널.
 * 표시 금액을 브라우저에서 다시 계산하지 않으며, 승인 시 proposalId만 서버에 보낸다 —
 * version은 클라가 보내지 않고, 서버가 저장된 제안/예약 문서에서 직접 읽어 재검증·바인딩한다.
 */
export function MoodSettlementApprovalPanel({
  booking,
  isAdmin,
  canApproveSettlement,
  onResponded,
  onEdit,
}: SettlementApprovalPanelProps) {
  const approval = booking.settlementApproval;
  const [pendingAction, setPendingAction] = useState<'approve' | 'withdraw' | 'replace' | null>(null);
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [acknowledgePendingTolls, setAcknowledgePendingTolls] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const responseKeyRef = useRef<{ action: SettlementResponseAction; key: string } | null>(null);

  if (!approval || approval.status === 'approved' || approval.status === 'withdrawn') return null;
  const activeApproval: SettlementApprovalSummary = approval;

  const breakdown = approval.finalBreakdown || {};
  const baselineAmountKRW = approval.mode === 'correction' && typeof approval.previousFinalAmountKRW === 'number'
    ? approval.previousFinalAmountKRW
    : approval.bookedAmountKRW;
  const tollEntries = Array.isArray(approval.tollEntries) ? approval.tollEntries : [];
  const pendingIncludedTollCount = Number.isInteger(approval.pendingIncludedTollCount)
    ? approval.pendingIncludedTollCount
    : tollEntries.filter((entry) => entry.includedInSettlement && entry.status === 'pending').length;
  const awaitingMood = approval.status === 'awaiting_mood';
  const changesRequested = approval.status === 'changes_requested';
  const proposedBalanceAvailable = Number.isSafeInteger(approval.proposedBalanceKRW)
    && Number.isSafeInteger(approval.proposedResultingBalanceKRW);

  function responseKey(action: SettlementResponseAction) {
    if (!responseKeyRef.current || responseKeyRef.current.action !== action) {
      responseKeyRef.current = { action, key: requestKey(`mood-settle-${action}`) };
    }
    return responseKeyRef.current.key;
  }

  async function respond(action: SettlementResponseAction, editAfterWithdraw = false) {
    const trimmedReason = changeReason.trim();
    if (action === 'request_changes' && !trimmedReason) {
      setMessage({ kind: 'err', text: '바꿔야 할 내용을 입력해 주세요.' });
      return;
    }
    if (action === 'approve' && pendingIncludedTollCount > 0 && !acknowledgePendingTolls) {
      setMessage({ kind: 'err', text: `미확정 톨비 ${pendingIncludedTollCount}건을 잠정 반영한다는 확인이 필요합니다.` });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        proposalId: activeApproval.proposalId,
        action,
        idempotencyKey: responseKey(action),
      };
      if (action === 'request_changes') payload.reason = trimmedReason;
      if (action === 'approve' && pendingIncludedTollCount > 0) payload.acknowledgePendingTolls = true;
      const res = await authFetch('/api/mood-settle-respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setMessage({ kind: 'err', text: apiErrorMessage(json?.error || `처리 실패 (${res.status})`) });
        return;
      }
      responseKeyRef.current = null;
      const successText = action === 'approve'
        ? `양측 확인 완료 · ${formatKRW(activeApproval.finalAmountKRW)} 확정`
        : action === 'request_changes'
          ? '수정 요청을 운영자에게 전달했습니다.'
          : editAfterWithdraw
            ? '기존 확인 요청을 철회했습니다. 새 제안을 작성해 주세요.'
            : '정산 확인 요청을 철회했습니다.';
      await onResponded(successText);
      if (editAfterWithdraw && onEdit) onEdit(activeApproval.mode);
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : '정산 요청을 처리하지 못했습니다.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-3 rounded-2xl p-3" style={{ background: palette.card, border: palette.border }} aria-label="정산 금액 확인">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black" style={{ color: changesRequested ? palette.danger : palette.text }}>
            {changesRequested ? 'MOOD 수정 요청' : isAdmin ? 'MOOD 확인 대기' : '정산 금액 확인 필요'}
          </p>
          <p className="mt-0.5 text-[10px]" style={{ color: palette.dim }}>
            {approval.mode === 'correction' ? '정산 정정' : '최초 정산'} 제안 · 버전 {approval.version}
          </p>
        </div>
        <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ color: changesRequested ? palette.danger : palette.accent, border: palette.border }}>
          {changesRequested ? '운영자 확인 필요' : isAdmin ? '상대 확인 대기' : '내 확인 필요'}
        </span>
      </div>

      {changesRequested && approval.changeRequestReason && (
        <div className="mt-3 rounded-xl p-3 text-[11px]" style={{ background: palette.input, border: palette.border, color: palette.text }}>
          <p className="font-bold" style={{ color: palette.danger }}>수정 요청 내용</p>
          <p className="mt-1 whitespace-pre-wrap">{approval.changeRequestReason}</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl p-2.5" style={{ background: palette.input, border: palette.border }}>
          <p className="font-bold" style={{ color: palette.dim }}>{approval.mode === 'correction' ? '현재 정산' : '예약 금액'}</p>
          <p className="mt-2 text-sm font-black" style={{ color: palette.text }}>{formatKRW(baselineAmountKRW)}</p>
        </div>
        <div className="rounded-xl p-2.5" style={{ background: palette.input, border: palette.border }}>
          <p className="font-bold" style={{ color: palette.dim }}>제안 금액</p>
          <p className="mt-2 text-sm font-black" style={{ color: palette.accent }}>{formatKRW(approval.finalAmountKRW)}</p>
          <p className="mt-0.5 font-bold" style={{ color: approval.deltaKRW > 0 ? palette.danger : palette.ok }}>{proposalDeltaText(approval.deltaKRW)}</p>
        </div>
      </div>

      <div className="mt-2 rounded-xl p-3 text-[11px]" style={{ background: palette.input, border: palette.border }}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p style={{ color: palette.dim }}>실제 시간</p><p className="mt-1 font-bold" style={{ color: palette.text }}>{approval.actualHours}시간</p></div>
          <div><p style={{ color: palette.dim }}>정산 거리</p><p className="mt-1 font-bold" style={{ color: palette.text }}>{Number(breakdown.km || 0).toLocaleString('ko-KR')}km</p></div>
          <div><p style={{ color: palette.dim }}>톨비</p><p className="mt-1 font-bold" style={{ color: palette.text }}>{formatKRW(Number(breakdown.tollKRW || 0))}</p></div>
        </div>
        {breakdown.distanceSource === 'manual' && typeof breakdown.actualTotalKm === 'number' && typeof breakdown.excludedKm === 'number' && (
          <p className="mt-2 text-center" style={{ color: palette.dim }}>
            전체 {breakdown.actualTotalKm.toLocaleString('ko-KR')}km − 제외 {breakdown.excludedKm.toLocaleString('ko-KR')}km = {Number(breakdown.km || 0).toLocaleString('ko-KR')}km
          </p>
        )}
      </div>

      {tollEntries.length > 0 && (
        <div className="mt-2 rounded-xl p-3" style={{ background: palette.input, border: palette.border }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold" style={{ color: palette.text }}>톨비 근거</p>
            <span className="text-[10px]" style={{ color: pendingIncludedTollCount > 0 ? palette.danger : palette.ok }}>
              {pendingIncludedTollCount > 0 ? `미확정 ${pendingIncludedTollCount}건` : '모두 확정'}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {tollEntries.map((entry, index) => (
              <div key={`${entry.date || ''}-${entry.label}-${index}`} className="text-[11px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold" style={{ color: entry.includedInSettlement ? palette.text : palette.dim }}>{entry.label}</p>
                    <p style={{ color: palette.dim }}>{entry.date || '일시 미기록'} · {entry.status === 'pending' ? '미확정' : '확정'}{entry.includedInSettlement ? '' : ' · 정산 제외'}</p>
                  </div>
                  <span className="shrink-0" style={{ color: entry.includedInSettlement ? palette.text : palette.dim }}>{formatKRW(entry.amountKRW)}</span>
                </div>
                {entry.evidenceRef && <p className="mt-0.5 break-all text-[10px]" style={{ color: palette.dim }}>증빙: {entry.evidenceRef}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {approval.settlementReason && (
        <div className="mt-2 rounded-xl p-3 text-[11px]" style={{ background: palette.input, border: palette.border, color: palette.text }}>
          <p className="font-bold" style={{ color: palette.dim }}>제안 사유</p>
          <p className="mt-1 whitespace-pre-wrap">{approval.settlementReason}</p>
        </div>
      )}

      {proposedBalanceAvailable && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl p-3 text-[11px]" style={{ background: palette.input, border: palette.border }}>
          <span style={{ color: palette.dim }}>제안 시 예상 잔액</span>
          <span className="text-right font-bold" style={{ color: palette.text }}>{formatKRW(approval.proposedBalanceKRW)} → {formatKRW(approval.proposedResultingBalanceKRW)}</span>
        </div>
      )}
      <p className="mt-2 text-[10px]" style={{ color: palette.dim }}>
        제안 {proposalDateTime(approval.proposedAt)} · {approval.proposedByEmail} · MOOD 확인 전까지 잔액 변경 없음
      </p>

      {awaitingMood && !isAdmin && pendingIncludedTollCount > 0 && canApproveSettlement && (
        <label className={`mt-3 flex min-h-[44px] items-start gap-2 rounded-xl p-2.5 text-[11px] ${focusClass}`} style={{ background: palette.input, border: palette.border, color: palette.text }}>
          <input type="checkbox" checked={acknowledgePendingTolls} onChange={(event) => setAcknowledgePendingTolls(event.target.checked)} className={`mt-0.5 h-4 w-4 ${focusClass}`} />
          <span>미확정 톨비 {pendingIncludedTollCount}건을 잠정 금액에 포함하며, 실제 금액이 달라지면 새 정산 정정 확인이 필요함을 확인했습니다.</span>
        </label>
      )}

      {awaitingMood && isAdmin && !pendingAction && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setPendingAction('withdraw')} disabled={submitting} className={`rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.input, border: palette.border, color: palette.dim }}>요청만 철회</button>
          <button type="button" onClick={() => setPendingAction('replace')} disabled={submitting} className={`rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>철회 후 새 제안</button>
        </div>
      )}

      {awaitingMood && isAdmin && pendingAction && pendingAction !== 'approve' && (
        <div className="mt-3 rounded-xl p-3" style={{ background: palette.input, border: palette.border }}>
          <p className="text-[11px]" style={{ color: palette.text }}>
            {pendingAction === 'replace' ? '현재 요청을 철회하고 같은 예약의 새 정산 제안을 작성합니다.' : '현재 정산 확인 요청을 철회합니다. 잔액은 바뀌지 않습니다.'}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { void respond('withdraw', pendingAction === 'replace'); }} disabled={submitting} className={`rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>{submitting ? '처리 중…' : pendingAction === 'replace' ? '철회하고 새로 작성' : '철회 확인'}</button>
            <button type="button" onClick={() => setPendingAction(null)} disabled={submitting} className={`rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.card, border: palette.border, color: palette.dim }}>돌아가기</button>
          </div>
        </div>
      )}

      {changesRequested && isAdmin && (
        <button type="button" onClick={() => onEdit && onEdit(approval.mode)} className={`mt-3 w-full rounded-xl px-3 text-xs font-black ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>요청 내용 반영해 다시 편집</button>
      )}

      {awaitingMood && !isAdmin && canApproveSettlement && !pendingAction && !changeRequestOpen && (
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" onClick={() => setPendingAction('approve')} disabled={submitting || (pendingIncludedTollCount > 0 && !acknowledgePendingTolls)} className={`w-full rounded-xl px-3 text-xs font-black disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>{formatKRW(approval.finalAmountKRW)}으로 확정</button>
          <button type="button" onClick={() => setChangeRequestOpen(true)} disabled={submitting} className={`w-full rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.input, border: palette.border, color: palette.text }}>수정 요청</button>
        </div>
      )}

      {awaitingMood && !isAdmin && canApproveSettlement && pendingAction === 'approve' && (
        <div className="mt-3 rounded-xl p-3" style={{ background: palette.input, border: palette.border }}>
          <p className="text-[11px] font-bold" style={{ color: palette.text }}>{formatKRW(baselineAmountKRW)}에서 {formatKRW(approval.finalAmountKRW)}으로 바뀌며, {proposalDeltaText(approval.deltaKRW)}이 잔액에 반영됩니다.</p>
          <p className="mt-1 text-[10px]" style={{ color: palette.dim }}>확정 뒤 금액을 바꾸려면 양측이 정정 제안을 다시 확인해야 합니다.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { void respond('approve'); }} disabled={submitting} className={`rounded-xl px-3 text-xs font-black disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>{submitting ? '확정 중…' : `${formatKRW(approval.finalAmountKRW)} 최종 확인`}</button>
            <button type="button" onClick={() => setPendingAction(null)} disabled={submitting} className={`rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.card, border: palette.border, color: palette.dim }}>다시 보기</button>
          </div>
        </div>
      )}

      {awaitingMood && !isAdmin && canApproveSettlement && changeRequestOpen && (
        <div className="mt-3 rounded-xl p-3" style={{ background: palette.input, border: palette.border }}>
          <label className="text-[11px] font-bold" style={{ color: palette.text }}>바꿔야 할 내용
            <textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={500} rows={3} className={`mt-2 min-h-[88px] w-full resize-y rounded-xl px-3 py-2 text-xs ${focusClass}`} style={inputStyle} placeholder="예: 픽업 전 제외 거리를 48km로 확인해 주세요." />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { void respond('request_changes'); }} disabled={submitting || !changeReason.trim()} className={`rounded-xl px-3 text-xs font-black disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.gradient, color: '#fff' }}>{submitting ? '전달 중…' : '수정 요청 보내기'}</button>
            <button type="button" onClick={() => { setChangeRequestOpen(false); setChangeReason(''); }} disabled={submitting} className={`rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${touchButtonClass}`} style={{ background: palette.card, border: palette.border, color: palette.dim }}>취소</button>
          </div>
        </div>
      )}

      {awaitingMood && !isAdmin && !canApproveSettlement && (
        <div className="mt-3 rounded-xl p-3 text-[11px]" style={{ background: palette.input, border: palette.border, color: palette.dim }}>
          <b style={{ color: palette.text }}>읽기 전용</b> · 지정된 MOOD 정산 승인자가 확인하면 금액이 확정됩니다.
        </div>
      )}

      {changesRequested && !isAdmin && (
        <p className="mt-3 rounded-xl p-3 text-[11px]" style={{ background: palette.input, border: palette.border, color: palette.dim }}>운영자가 요청 내용을 반영해 새 제안을 보내면 다시 확인할 수 있습니다.</p>
      )}

      {message && <p className="mt-2 text-[11px]" role="status" aria-live="polite" style={{ color: message.kind === 'ok' ? palette.ok : palette.danger }}>{message.text}</p>}
    </section>
  );
}

export default MoodSettlementEditor;
