/**
 * AI 운영센터용 순수 집계 함수.
 *
 * 원본 컬렉션을 바꾸지 않고 서로 다른 예약/문의 상태를 같은 모양으로 읽기 위한
 * read model 이다. 이름·이메일로 예약을 합치지 않으며, 확정된 pending mirror 는
 * bookingRef/order/capture 계열의 명시적 식별자가 bookings 와 일치할 때만 제거한다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const OPEN_INQUIRY_STATUSES = new Set(['new', 'pending']);
const OPEN_CS_STATUSES = new Set(['open', 'in_progress', 'pending']);
const CLOSED_RESERVATION_STATUSES = new Set([
  'canceled', 'cancelled', 'refunded', 'rejected', 'failed',
]);

const PRIORITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });

export function toMillis(value) {
  if (!value) return 0;
  try {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value._seconds === 'number') return value._seconds * 1000;
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
  } catch {
    return 0;
  }
  return 0;
}

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function dateToMillis(value) {
  const text = clean(value);
  if (!text) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = Date.parse(`${text}T00:00:00+09:00`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return toMillis(text);
}

function sourceDeepLink(sourceSystem) {
  if (sourceSystem === 'pending_bookings') return '/admin/payments';
  if (sourceSystem === 'mood_bookings') return '/admin/all-bookings';
  return '/admin/calendar';
}

function sourceLabel(sourceSystem) {
  if (sourceSystem === 'pending_bookings') return '입금 대기';
  if (sourceSystem === 'mood_bookings') return 'MOOD';
  return '코코트립';
}

function paymentStatus(raw, reservationStatus, sourceSystem) {
  const explicit = clean(raw.paymentStatus);
  if (explicit) return explicit;
  const status = lower(reservationStatus);
  if (status.includes('refund')) return 'refunded';
  if (status.includes('cancel')) return 'canceled';
  if (status === 'awaiting_verification' || status === 'pending') return 'awaiting_verification';
  if (status === 'confirmed' || status === 'completed' || status === 'paid') return 'confirmed';
  if (sourceSystem === 'mood_bookings' && status) return 'mood_ledger';
  return 'unknown';
}

function dispatchStatus(raw, label) {
  const explicit = clean(raw.dispatchStatus);
  if (explicit) return explicit;
  if (raw.driverAssigned === true || clean(raw.driver) || clean(raw.driverName)
    || clean(raw.driverChatId) || raw.acceptedAt) return 'accepted';
  if (lower(label).includes('ai-planner') || lower(label).includes('ai planner')) return 'not_required';
  return 'unknown';
}

function identityTokens(id, raw) {
  const candidates = [
    id,
    raw.bookingRef,
    raw.orderID,
    raw.orderId,
    raw.paypalOrderId,
    raw.paypalOrderID,
    raw.captureID,
    raw.captureId,
    raw.paypalTransactionId,
    raw.transactionId,
    raw.parentOrderID,
  ];
  return [...new Set(candidates.map((value) => clean(value)).filter(Boolean))];
}

function isExplicitlyUnassigned(raw) {
  const accepted = lower(raw.dispatchStatus) === 'accepted';
  const hasDriver = clean(raw.driver) || clean(raw.driverName) || clean(raw.driverChatId) || raw.acceptedAt;
  return !(accepted || hasDriver);
}

function requiresDispatch(raw) {
  const product = lower(raw.productType || raw.product);
  if (product.includes('ai-planner') || product.includes('ai planner')) return false;
  if (clean(raw.pickupLocation) || clean(raw.dropoffLocation) || clean(raw.vehicleType) || raw.airport) return true;
  return product.includes('tour') || product.includes('charter') || product.includes('transfer')
    || product.includes('airport') || product.includes('vehicle');
}

function reservationAction({ sourceSystem, raw, reservationStatus, tripAtMs, nowMs }) {
  const status = lower(reservationStatus);
  const ageMs = Math.max(0, nowMs - toMillis(raw.createdAt));

  if (sourceSystem === 'pending_bookings' && status === 'awaiting_verification') {
    return {
      priority: ageMs >= DAY_MS ? 'P1' : 'P2',
      nextAction: '입금 확인',
      actionRequired: true,
    };
  }
  if (status === 'refund_failed' || status === 'refund_requested' || status === 'cancel_requested') {
    return { priority: 'P0', nextAction: '환불·취소 상태 확인', actionRequired: true };
  }
  if (raw.voucherFailedAt || clean(raw.voucherError)) {
    return { priority: 'P1', nextAction: '예약 후속처리 확인', actionRequired: true };
  }
  if (sourceSystem === 'bookings' && status === 'confirmed' && tripAtMs > 0
    && requiresDispatch(raw) && isExplicitlyUnassigned(raw)) {
    const untilTrip = tripAtMs - nowMs;
    if (untilTrip >= -DAY_MS && untilTrip <= 3 * DAY_MS) {
      return {
        priority: untilTrip <= DAY_MS ? 'P0' : 'P1',
        nextAction: '배차 상태 확인',
        actionRequired: true,
      };
    }
  }
  return { priority: 'P3', nextAction: '상세 보기', actionRequired: false };
}

export function normalizeReservation(sourceSystem, id, raw = {}, nowMs = Date.now()) {
  const sourceRecordId = clean(id);
  const reservationStatus = clean(raw.status) || 'unknown';
  const label = sourceSystem === 'mood_bookings'
    ? clean(raw.serviceType) || 'MOOD 예약'
    : clean(raw.productType || raw.product) || '예약';
  const tripAt = clean(raw.tourDate || raw.dateStart || raw.date || raw.eventDate);
  const tripAtMs = dateToMillis(tripAt);
  const updatedAtMs = toMillis(raw.updatedAt || raw.confirmedAt || raw.createdAt);
  const action = reservationAction({ sourceSystem, raw, reservationStatus, tripAtMs, nowMs });
  const bookingRef = clean(raw.bookingRef) || sourceRecordId;

  return {
    workItemId: `${sourceSystem}:${sourceRecordId}`,
    sourceSystem,
    sourceLabel: sourceLabel(sourceSystem),
    sourceRecordId,
    bookingRef,
    customerIdentityVerified: raw.customerIdentityVerified === true || raw.userEmailVerified === true,
    tripAt,
    tripAtMs,
    reservationStatus,
    paymentStatus: paymentStatus(raw, reservationStatus, sourceSystem),
    dispatchStatus: dispatchStatus(raw, label),
    replyStatus: 'not_applicable',
    priority: action.priority,
    nextAction: action.nextAction,
    actionRequired: action.actionRequired,
    updatedAtMs,
    createdAtMs: toMillis(raw.createdAt),
    deepLink: sourceDeepLink(sourceSystem),
    label,
    isTest: raw.paymentMethod === 'admin-bypass'
      || clean(raw.paypalTransactionId).startsWith('ADMIN-BYPASS-')
      || sourceRecordId.startsWith('ADMIN-BYPASS-'),
    identityTokens: identityTokens(sourceRecordId, raw),
  };
}

/**
 * 확정된 pending 문서가 정식 bookings 문서와 식별자로 연결될 때만 pending 쪽을 숨긴다.
 * 이름·이메일·전화번호·여행일은 중복 판정에 절대 사용하지 않는다.
 */
export function dedupeConfirmedPendingMirrors(reservations) {
  const bookingTokens = new Set();
  for (const item of reservations) {
    if (item.sourceSystem !== 'bookings') continue;
    for (const token of item.identityTokens || []) bookingTokens.add(token);
  }

  const kept = [];
  const removed = [];
  for (const item of reservations) {
    const isConfirmedPending = item.sourceSystem === 'pending_bookings'
      && lower(item.reservationStatus) === 'confirmed';
    const mirrorsBooking = isConfirmedPending
      && (item.identityTokens || []).some((token) => bookingTokens.has(token));
    if (mirrorsBooking) removed.push(item.workItemId);
    else kept.push(item);
  }
  return { items: kept, removed };
}

export function publicReservation(item) {
  const { identityTokens: _identityTokens, ...safe } = item;
  return safe;
}

function ageHours(createdAtMs, nowMs) {
  if (!createdAtMs) return 0;
  return Math.max(0, Math.floor((nowMs - createdAtMs) / (60 * 60 * 1000)));
}

function inquiryKind(sourceSystem, raw) {
  if (sourceSystem === 'pending_free_claims') return '무료 플랜 신청';
  const vehicle = lower(raw.vehicle);
  if (vehicle === 'tour_custom') return '맞춤 투어 문의';
  if (vehicle === 'bus') return '버스 문의';
  return '차터 문의';
}

export function normalizeInquiry(sourceSystem, id, raw = {}, nowMs = Date.now()) {
  const status = lower(raw.status) || 'pending';
  const createdAtMs = toMillis(raw.createdAt);
  const open = OPEN_INQUIRY_STATUSES.has(status);
  const hours = ageHours(createdAtMs, nowMs);
  const eventDate = clean(raw.startDate || raw.eventDate || raw.tripDates);
  const acknowledged = lower(raw.ackWorkflow && raw.ackWorkflow.status) === 'sent'
    || lower(raw.ackWorkflow && raw.ackWorkflow.deliveryStatus) === 'sent';
  return {
    workItemId: `${sourceSystem}:${clean(id)}`,
    type: 'inquiry',
    sourceSystem,
    sourceRecordId: clean(id),
    title: `${inquiryKind(sourceSystem, raw)} · ${shortId(id)}`,
    status,
    priority: open && hours >= 24 ? 'P1' : 'P2',
    nextAction: acknowledged ? '최종 답변 검토' : '문의 확인·답변',
    actionRequired: open,
    ageHours: hours,
    eventDate,
    createdAtMs,
    deepLink: '/admin/claims',
  };
}

export function normalizeCsTicket(id, raw = {}, nowMs = Date.now()) {
  const status = lower(raw.status) || 'open';
  const createdAtMs = toMillis(raw.createdAt);
  const open = OPEN_CS_STATUSES.has(status);
  const hours = ageHours(createdAtMs, nowMs);
  return {
    workItemId: `cs_tickets:${clean(id)}`,
    type: 'cs',
    sourceSystem: 'cs_tickets',
    sourceRecordId: clean(id),
    title: `CS 문의 · ${shortId(id)}`,
    status,
    priority: open && hours >= 24 ? 'P1' : 'P2',
    nextAction: 'CS 답변 확인',
    actionRequired: open,
    ageHours: hours,
    eventDate: '',
    createdAtMs,
    deepLink: '/admin/ops?tab=review',
  };
}

export function normalizePaymentReview(id, raw = {}, nowMs = Date.now()) {
  const createdAtMs = toMillis(raw.createdAt);
  return {
    workItemId: `payment_reviews:${clean(id)}`,
    type: 'payment_review',
    sourceSystem: 'payment_reviews',
    sourceRecordId: clean(id),
    title: `결제 격리 확인 · ${shortId(id)}`,
    status: clean(raw.mismatchCode) || 'unresolved',
    priority: raw.paymentCaptured === true ? 'P0' : 'P1',
    nextAction: '결제 자료 대조',
    actionRequired: true,
    ageHours: ageHours(createdAtMs, nowMs),
    eventDate: '',
    createdAtMs,
    deepLink: '/admin/payment-reviews',
  };
}

export function normalizeDecision(id, raw = {}, nowMs = Date.now()) {
  const createdAtMs = toMillis(raw.createdAtMs || raw.createdAt);
  const status = lower(raw.status) || 'pending';
  return {
    workItemId: `decision_queue:${clean(id)}`,
    type: 'decision',
    sourceSystem: 'decision_queue',
    sourceRecordId: clean(id),
    title: `운영자 결정 · ${shortId(id)}`,
    status,
    priority: 'P1',
    nextAction: '승인·거절 판단',
    actionRequired: status === 'pending',
    ageHours: ageHours(createdAtMs, nowMs),
    eventDate: '',
    createdAtMs,
    deepLink: '/admin/decisions',
  };
}

export function retryQueueHealth(key, label, docs, sourceAvailable = true) {
  if (!sourceAvailable) {
    return {
      key,
      label,
      status: 'unknown',
      pending: 0,
      manual: 0,
      count: 0,
      detail: '상태 확인 실패',
      deepLink: '/admin/reconciliation',
    };
  }
  let pending = 0;
  let manual = 0;
  for (const doc of docs) {
    const status = lower(doc.status);
    if (status === 'pending') pending += 1;
    else if (status === 'manual-intervention' || status === 'permanent-failure') manual += 1;
  }
  return {
    key,
    label,
    status: manual > 0 ? 'attention' : pending > 0 ? 'retrying' : 'ok',
    pending,
    manual,
    count: pending + manual,
    detail: manual > 0
      ? `수동 확인 ${manual}건`
      : pending > 0 ? `자동 재시도 ${pending}건` : '대기 없음',
    deepLink: '/admin/reconciliation',
  };
}

export function automationWorkItems(automation) {
  return automation
    .filter((item) => item.count > 0)
    .map((item) => ({
      workItemId: `automation:${item.key}`,
      type: 'automation',
      sourceSystem: item.key,
      sourceRecordId: item.key,
      title: `${item.label} · ${item.count}건`,
      status: item.status,
      priority: item.manual > 0 ? 'P0' : 'P1',
      nextAction: item.manual > 0 ? '수동 처리 필요' : '자동 재시도 확인',
      actionRequired: true,
      ageHours: 0,
      eventDate: '',
      createdAtMs: 0,
      deepLink: item.deepLink,
    }));
}

export function sortWorkItems(items) {
  return [...items].sort((a, b) => {
    const aRank = Object.prototype.hasOwnProperty.call(PRIORITY_RANK, a.priority)
      ? PRIORITY_RANK[a.priority]
      : 9;
    const bRank = Object.prototype.hasOwnProperty.call(PRIORITY_RANK, b.priority)
      ? PRIORITY_RANK[b.priority]
      : 9;
    const priorityDiff = aRank - bRank;
    if (priorityDiff !== 0) return priorityDiff;
    if (b.ageHours !== a.ageHours) return b.ageHours - a.ageHours;
    return b.createdAtMs - a.createdAtMs;
  });
}

export function kstDayStartMs(nowMs) {
  const shifted = new Date(nowMs + 9 * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 9 * 60 * 60 * 1000;
}

export function summarizeOps({ reservations, inboxItems, paymentReviews, decisions, automation, sourceFailures }, nowMs = Date.now()) {
  const dayStart = kstDayStartMs(nowMs);
  const dayEnd = dayStart + DAY_MS;
  const weekEnd = dayStart + 8 * DAY_MS;
  const activeReservations = reservations.filter((item) => !CLOSED_RESERVATION_STATUSES.has(lower(item.reservationStatus)));
  const todayReservations = activeReservations.filter((item) => item.tripAtMs >= dayStart && item.tripAtMs < dayEnd).length;
  const upcoming7d = activeReservations.filter((item) => item.tripAtMs >= dayStart && item.tripAtMs < weekEnd).length;
  const openInquiries = inboxItems.filter((item) => item.type === 'inquiry' && item.actionRequired).length;
  const openCs = inboxItems.filter((item) => item.type === 'cs' && item.actionRequired).length;
  const reservationWork = reservations
    .filter((item) => item.actionRequired)
    .map((item) => ({
      workItemId: item.workItemId,
      type: 'reservation',
      sourceSystem: item.sourceSystem,
      sourceRecordId: item.sourceRecordId,
      title: `${item.nextAction} · ${shortId(item.bookingRef)}`,
      status: item.reservationStatus,
      priority: item.priority,
      nextAction: item.nextAction,
      actionRequired: true,
      ageHours: ageHours(item.createdAtMs, nowMs),
      eventDate: item.tripAt,
      createdAtMs: item.createdAtMs,
      deepLink: item.deepLink,
    }));
  const workItems = sortWorkItems([
    ...reservationWork,
    ...inboxItems.filter((item) => item.actionRequired),
    ...paymentReviews,
    ...decisions.filter((item) => item.actionRequired),
    ...automationWorkItems(automation),
  ]);

  return {
    summary: {
      actionRequired: workItems.length,
      urgent: workItems.filter((item) => item.priority === 'P0' || item.priority === 'P1').length,
      todayReservations,
      upcoming7d,
      openInquiries,
      openCs,
      paymentReviews: paymentReviews.length,
      automationAttention: automation.filter((item) => item.status === 'attention' || item.status === 'retrying').length
        + sourceFailures.length,
    },
    workItems,
  };
}

export function shortId(value) {
  const text = clean(value);
  if (text.length <= 16) return text || '-';
  return `${text.slice(0, 8)}…${text.slice(-5)}`;
}
