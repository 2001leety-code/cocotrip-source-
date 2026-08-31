import AdminAiOpsCenter from '@/pages/AdminAiOpsCenter';
import type { OpsCenterData } from '@/pages/AdminAiOpsCenter';

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-31T21:00:00+09:00');

const previewData: OpsCenterData = {
  generatedAt: new Date(NOW).toISOString(),
  summary: {
    actionRequired: 6,
    urgent: 4,
    todayReservations: 2,
    upcoming7d: 5,
    openInquiries: 2,
    openCs: 1,
    paymentReviews: 1,
    automationAttention: 2,
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
      priority: 'P0', nextAction: '배차 상태 확인', actionRequired: true, ageHours: 8, eventDate: '2026-08-31',
      createdAtMs: NOW - 8 * HOUR_MS, deepLink: '/admin/calendar',
    },
    {
      workItemId: 'charter_inquiries:INQ-OLD', type: 'inquiry', sourceSystem: 'charter_inquiries',
      sourceRecordId: 'INQ-OLD', title: '맞춤 투어 문의 · INQ-OLD', status: 'pending',
      priority: 'P1', nextAction: '최종 답변 검토', actionRequired: true, ageHours: 29, eventDate: '2026-09-04',
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
      sourceRecordId: 'CT-TODAY', bookingRef: 'CT-20260831-001', customerIdentityVerified: true,
      tripAt: '2026-08-31', tripAtMs: Date.parse('2026-08-31T00:00:00+09:00'), reservationStatus: 'CONFIRMED',
      paymentStatus: 'confirmed', dispatchStatus: 'unknown', replyStatus: 'not_applicable', priority: 'P0',
      nextAction: '배차 상태 확인', actionRequired: true, updatedAtMs: NOW - HOUR_MS, createdAtMs: NOW - 8 * HOUR_MS,
      deepLink: '/admin/calendar', label: '서울 프라이빗 투어', isTest: false,
    },
    {
      workItemId: 'pending_bookings:CT-PENDING', sourceSystem: 'pending_bookings', sourceLabel: '입금 대기',
      sourceRecordId: 'CT-PENDING', bookingRef: 'CT-20260831-002', customerIdentityVerified: false,
      tripAt: '2026-09-02', tripAtMs: Date.parse('2026-09-02T00:00:00+09:00'), reservationStatus: 'AWAITING_VERIFICATION',
      paymentStatus: 'awaiting_verification', dispatchStatus: 'unknown', replyStatus: 'not_applicable', priority: 'P2',
      nextAction: '입금 확인', actionRequired: true, updatedAtMs: NOW - 2 * HOUR_MS, createdAtMs: NOW - 2 * HOUR_MS,
      deepLink: '/admin/payments', label: '인천공항 이동', isTest: false,
    },
    {
      workItemId: 'mood_bookings:MOOD-01', sourceSystem: 'mood_bookings', sourceLabel: 'MOOD',
      sourceRecordId: 'MOOD-01', bookingRef: 'MOOD-01', customerIdentityVerified: false,
      tripAt: '2026-09-03', tripAtMs: Date.parse('2026-09-03T00:00:00+09:00'), reservationStatus: 'confirmed',
      paymentStatus: 'confirmed', dispatchStatus: 'unknown', replyStatus: 'not_applicable', priority: 'P3',
      nextAction: '상세 보기', actionRequired: false, updatedAtMs: NOW - 4 * HOUR_MS, createdAtMs: NOW - 4 * HOUR_MS,
      deepLink: '/admin/all-bookings', label: 'vehicle', isTest: false,
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
    { key: 'bookings', label: '온라인·정식 예약', ok: true, count: 28, possiblyTruncated: false },
    { key: 'pending_bookings', label: '입금 대기 예약', ok: true, count: 14, possiblyTruncated: false },
    { key: 'mood_bookings', label: 'MOOD 예약', ok: true, count: 9, possiblyTruncated: false },
    { key: 'charter_inquiries', label: '차터·맞춤 문의', ok: true, count: 6, possiblyTruncated: false },
    { key: 'pending_email_retries', label: '고객 이메일 재시도', ok: false, count: 0, possiblyTruncated: false },
  ],
  partialErrors: ['pending_email_retries'],
  deduplication: { rule: 'confirmed-pending-exact-identifier-only', removedMirrorCount: 3 },
  window: { perSourceLimit: 180, note: '최근 자료 기준' },
};

export default function AdminAiOpsCenterDevHarness() {
  return <AdminAiOpsCenter previewData={previewData} />;
}
