import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AdminAiOpsCenter from '@/pages/AdminAiOpsCenter';
import type { OpsCenterData } from '@/pages/AdminAiOpsCenter';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function createPreviewData(now: number, search: string): OpsCenterData {
  const params = new URLSearchParams(search);
  const shifted = new Date(now + 9 * HOUR_MS);
  const dayStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 9 * HOUR_MS;
  const dateAt = (offset: number) => new Date(dayStart + offset * DAY_MS + 9 * HOUR_MS).toISOString().slice(0, 10);
  const NOW = now;

  const previewData: OpsCenterData = {
    generatedAt: new Date(NOW).toISOString(),
    summary: {
      actionRequired: 0,
      urgent: 0,
      todayReservations: 0,
      upcoming7d: 0,
      openInquiries: 0,
      openCs: 0,
      paymentReviews: 0,
      automationAttention: 0,
    },
    workItems: [
      {
        workItemId: 'payment_reviews:ORDER-REVIEW', type: 'payment_review', sourceSystem: 'payment_reviews',
        sourceRecordId: 'ORDER-REVIEW', title: '결제 격리 확인 · ORDER-REVIEW', status: 'AMOUNT_MISMATCH',
        priority: 'P0', nextAction: '결제 자료 대조', actionRequired: true, ageHours: 3, eventDate: '',
        createdAtMs: NOW - 3 * HOUR_MS, deepLink: '/admin/payment-reviews',
      },
      {
        workItemId: 'bookings:CT-TODAY', type: 'reservation', sourceSystem: 'bookings',
        sourceRecordId: 'CT-TODAY', title: '배차 상태 확인 · CT-TODAY', status: 'CONFIRMED',
        priority: 'P0', nextAction: '배차 상태 확인', actionRequired: true, ageHours: 8, eventDate: dateAt(0),
        createdAtMs: NOW - 8 * HOUR_MS, deepLink: '/admin/calendar',
      },
      {
        workItemId: 'charter_inquiries:INQ-OLD', type: 'inquiry', sourceSystem: 'charter_inquiries',
        sourceRecordId: 'INQ-OLD', title: '맞춤 투어 문의 · INQ-OLD', status: 'pending',
        priority: 'P1', nextAction: '최종 답변 검토', actionRequired: true, ageHours: 29, eventDate: dateAt(4),
        createdAtMs: NOW - 29 * HOUR_MS, deepLink: '/admin/claims',
      },
      {
        workItemId: 'automation:email_retry', type: 'automation', sourceSystem: 'email_retry',
        sourceRecordId: 'email_retry', title: '고객 이메일 · 2건', status: 'attention',
        priority: 'P1', nextAction: '수동 처리 필요', actionRequired: true, ageHours: 0, eventDate: '',
        createdAtMs: 0, deepLink: '/admin/reconciliation',
      },
    ],
    reservations: [
      {
        workItemId: 'bookings:CT-TODAY', sourceSystem: 'bookings', sourceLabel: '코코트립',
        sourceRecordId: 'CT-TODAY', bookingRef: 'PREVIEW-CT-TODAY', customerIdentityVerified: true,
        tripAt: dateAt(0), tripAtMs: dayStart, reservationStatus: 'CONFIRMED',
        paymentStatus: 'confirmed', dispatchStatus: 'unknown', replyStatus: 'not_applicable', priority: 'P0',
        nextAction: '배차 상태 확인', actionRequired: true, updatedAtMs: NOW - HOUR_MS, createdAtMs: NOW - 8 * HOUR_MS,
        deepLink: '/admin/calendar', label: '서울 프라이빗 투어', isTest: true,
      },
      {
        workItemId: 'pending_bookings:CT-PENDING', sourceSystem: 'pending_bookings', sourceLabel: '입금 대기',
        sourceRecordId: 'CT-PENDING', bookingRef: 'PREVIEW-CT-PENDING', customerIdentityVerified: false,
        tripAt: dateAt(2), tripAtMs: dayStart + 2 * DAY_MS, reservationStatus: 'AWAITING_VERIFICATION',
        paymentStatus: 'awaiting_verification', dispatchStatus: 'unknown', replyStatus: 'not_applicable', priority: 'P2',
        nextAction: '입금 확인', actionRequired: true, updatedAtMs: NOW - 2 * HOUR_MS, createdAtMs: NOW - 2 * HOUR_MS,
        deepLink: '/admin/payments', label: '인천공항 이동', isTest: true,
      },
      {
        workItemId: 'mood_bookings:MOOD-01', sourceSystem: 'mood_bookings', sourceLabel: 'MOOD',
        sourceRecordId: 'MOOD-01', bookingRef: 'MOOD-01', customerIdentityVerified: false,
        tripAt: dateAt(3), tripAtMs: dayStart + 3 * DAY_MS, reservationStatus: 'confirmed',
        paymentStatus: 'confirmed', dispatchStatus: 'unknown', replyStatus: 'not_applicable', priority: 'P3',
        nextAction: '상세 보기', actionRequired: false, updatedAtMs: NOW - 4 * HOUR_MS, createdAtMs: NOW - 4 * HOUR_MS,
        deepLink: '/admin/all-bookings', label: 'vehicle', isTest: true,
      },
    ],
    inboxItems: [],
    automation: [
      { key: 'inquiry_auto_ack', label: '문의 자동 접수확인', status: 'ok', pending: 0, manual: 0, count: 0, detail: '켜짐 · 최종 답변은 사람 승인', deepLink: '/admin/claims' },
      { key: 'processor_retry', label: '예약 후속처리', status: 'ok', pending: 0, manual: 0, count: 0, detail: '대기 없음', deepLink: '/admin/reconciliation' },
      { key: 'email_retry', label: '고객 이메일', status: 'attention', pending: 1, manual: 1, count: 2, detail: '수동 확인 1건', deepLink: '/admin/reconciliation' },
      { key: 'planner_retry', label: 'AI 플래너 생성', status: 'retrying', pending: 1, manual: 0, count: 1, detail: '자동 재시도 1건', deepLink: '/admin/reconciliation' },
      { key: 'github_checks', label: 'GitHub 정기검사', status: 'unlinked', pending: 0, manual: 0, count: 0, detail: '실행 이력 미연동 · GitHub에서 확인', deepLink: 'https://github.com/2001leety-code/cocotrip-source-/actions' },
    ],
    sources: [
      { key: 'bookings', label: '온라인·정식 예약', ok: true, count: 1, possiblyTruncated: false },
      { key: 'pending_bookings', label: '입금 대기 예약', ok: true, count: 1, possiblyTruncated: false },
      { key: 'mood_bookings', label: 'MOOD 예약', ok: true, count: 1, possiblyTruncated: false },
      { key: 'charter_inquiries', label: '차터·맞춤 문의', ok: true, count: 1, possiblyTruncated: false },
      { key: 'pending_email_retries', label: '고객 이메일 재시도', ok: true, count: 2, possiblyTruncated: false },
    ],
    partialErrors: [],
    deduplication: { rule: 'confirmed-pending-exact-identifier-only', removedMirrorCount: 0 },
    window: { perSourceLimit: 180, note: '최근 자료 기준' },
  };

  const pending = previewData.reservations[1];
  previewData.workItems.push({
    workItemId: pending.workItemId, type: 'reservation', sourceSystem: pending.sourceSystem,
    sourceRecordId: pending.sourceRecordId, title: `${pending.nextAction} · ${pending.bookingRef}`,
    status: pending.reservationStatus, priority: pending.priority, nextAction: pending.nextAction,
    actionRequired: true, ageHours: 2, eventDate: pending.tripAt, createdAtMs: pending.createdAtMs,
    deepLink: pending.deepLink,
  }, {
    workItemId: 'automation:planner_retry', type: 'automation', sourceSystem: 'planner_retry',
    sourceRecordId: 'planner_retry', title: 'AI 플래너 생성 · 1건', status: 'retrying',
    priority: 'P2', nextAction: '자동 재시도 확인', actionRequired: true, ageHours: 0,
    eventDate: '', createdAtMs: 0, deepLink: '/admin/reconciliation',
  });
  previewData.inboxItems = previewData.workItems.filter((item) => item.type === 'inquiry');

  if (params.get('work-list') === 'long') {
    for (let index = previewData.workItems.length; index < 23; index += 1) {
      previewData.workItems.push({
        workItemId: `decision_queue:PREVIEW-${index + 1}`, type: 'decision', sourceSystem: 'decision_queue',
        sourceRecordId: `PREVIEW-${index + 1}`, title: `미리보기 확인 업무 ${index + 1}`,
        status: 'pending', priority: 'P2', nextAction: '내용 확인', actionRequired: true,
        ageHours: 0, eventDate: '', createdAtMs: NOW, deepLink: '/admin/decisions',
      });
    }
  }

  if (params.get('reservations') === 'long') {
    const template = previewData.reservations[2];
    for (let index = previewData.reservations.length; index < 65; index += 1) {
      const offset = index % 8;
      previewData.reservations.push({
        ...template, workItemId: `mood_bookings:PREVIEW-${index + 1}`,
        sourceRecordId: `PREVIEW-${index + 1}`, bookingRef: `PREVIEW-${index + 1}`,
        label: `미리보기 예약 ${index + 1}`, tripAt: dateAt(offset), tripAtMs: dayStart + offset * DAY_MS,
      });
    }
  }

  if (params.get('email-state') === 'empty') {
    previewData.workItems = previewData.workItems.filter((item) => item.sourceSystem !== 'email_retry');
    previewData.automation = previewData.automation.map((item) => item.key === 'email_retry'
      ? { ...item, status: 'ok', pending: 0, manual: 0, count: 0, detail: '대기 없음' }
      : item);
  }

  if (params.get('source-state') === 'partial') {
    previewData.partialErrors = ['pending_email_retries'];
    previewData.workItems = previewData.workItems.filter((item) => item.sourceSystem !== 'email_retry');
    previewData.automation = previewData.automation.map((item) => item.key === 'email_retry'
      ? { ...item, status: 'unknown', pending: 0, manual: 0, count: 0, detail: '원본 조회 실패' }
      : item);
  }

  if (params.get('scenario') === 'empty' || params.get('scenario') === 'partial-empty') {
    previewData.workItems = [];
    previewData.reservations = [];
    previewData.inboxItems = [];
    previewData.automation = [];
    previewData.partialErrors = params.get('scenario') === 'partial-empty' ? ['bookings', 'charter_inquiries', 'cs_tickets'] : [];
  }

  previewData.sources = previewData.sources.map((source) => {
    const count = source.key === 'charter_inquiries'
      ? previewData.inboxItems.length
      : source.key === 'pending_email_retries'
        ? (previewData.automation.find((item) => item.key === 'email_retry')?.count || 0)
        : previewData.reservations.filter((item) => item.sourceSystem === source.key).length;
    return { ...source, ok: !previewData.partialErrors.includes(source.key), count };
  });
  // Deliberately omit partialErrors here to exercise the independent source flag.
  if (params.get('source-state') === 'flag-only') {
    previewData.partialErrors = [];
    previewData.sources = previewData.sources.map((source) => source.key === 'pending_email_retries' ? { ...source, ok: false } : source);
  }
  previewData.summary = {
    actionRequired: previewData.workItems.filter((item) => item.actionRequired).length,
    urgent: previewData.workItems.filter((item) => item.priority === 'P0' || item.priority === 'P1').length,
    todayReservations: previewData.reservations.filter((item) => item.tripAtMs >= dayStart && item.tripAtMs < dayStart + DAY_MS).length,
    upcoming7d: previewData.reservations.filter((item) => item.tripAtMs >= dayStart && item.tripAtMs < dayStart + 8 * DAY_MS).length,
    openInquiries: previewData.inboxItems.filter((item) => item.type === 'inquiry' && item.actionRequired).length,
    openCs: previewData.inboxItems.filter((item) => item.type === 'cs' && item.actionRequired).length,
    paymentReviews: previewData.workItems.filter((item) => item.type === 'payment_review').length,
    automationAttention: previewData.automation.filter((item) => item.status === 'attention' || item.status === 'retrying').length + previewData.partialErrors.length,
  };
  return previewData;
}

export default function AdminAiOpsCenterDevHarness() {
  const [now] = useState(() => Date.now());
  const { search } = useLocation();
  const previewData = useMemo(() => createPreviewData(now, search), [now, search]);
  // Static presentation scenario only; this does not simulate or send a network request.
  const previewFailure = new URLSearchParams(search).get('scenario') === 'refresh-failed' ? '가상 갱신 실패' : undefined;
  return <AdminAiOpsCenter previewData={previewData} previewFailure={previewFailure} />;
}
