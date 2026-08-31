import { describe, expect, it } from 'vitest';
import {
  dedupeConfirmedPendingMirrors,
  normalizeDecision,
  normalizeReservation,
  publicReservation,
  retryQueueHealth,
  sortWorkItems,
} from '../../api/_shared/adminAiOpsAggregate.js';

const NOW = Date.parse('2026-08-31T12:00:00+09:00');

describe('AI 운영센터 예약 정규화·중복 제거', () => {
  it('bookings와 연결된 확정 pending mirror만 정확한 식별자로 제거한다', () => {
    const booking = normalizeReservation('bookings', 'CAPTURE-1', {
      bookingRef: 'CT-20260831-001',
      captureID: 'CAPTURE-1',
      status: 'CONFIRMED',
      tourDate: '2026-09-02',
    }, NOW);
    const mirror = normalizeReservation('pending_bookings', 'CT-20260831-001', {
      bookingRef: 'CT-20260831-001',
      paypalTransactionId: 'CAPTURE-1',
      status: 'CONFIRMED',
      dateStart: '2026-09-02',
    }, NOW);

    const result = dedupeConfirmedPendingMirrors([booking, mirror]);
    expect(result.items.map((item) => item.workItemId)).toEqual(['bookings:CAPTURE-1']);
    expect(result.removed).toEqual(['pending_bookings:CT-20260831-001']);
  });

  it('이름·이메일·날짜가 같아도 식별자가 다르면 합치지 않는다', () => {
    const booking = normalizeReservation('bookings', 'ORDER-A', {
      bookingRef: 'ORDER-A',
      customerName: '동일 고객',
      userEmail: 'same@example.com',
      status: 'CONFIRMED',
      tourDate: '2026-09-02',
    }, NOW);
    const pending = normalizeReservation('pending_bookings', 'ORDER-B', {
      bookingRef: 'ORDER-B',
      customerName: '동일 고객',
      customerEmail: 'same@example.com',
      status: 'CONFIRMED',
      dateStart: '2026-09-02',
    }, NOW);

    const result = dedupeConfirmedPendingMirrors([booking, pending]);
    expect(result.items).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it('식별자가 같아도 아직 확정되지 않은 pending은 숨기지 않는다', () => {
    const booking = normalizeReservation('bookings', 'ORDER-A', {
      bookingRef: 'ORDER-A', status: 'CONFIRMED',
    }, NOW);
    const awaiting = normalizeReservation('pending_bookings', 'ORDER-A', {
      bookingRef: 'ORDER-A', status: 'AWAITING_VERIFICATION',
    }, NOW);

    expect(dedupeConfirmedPendingMirrors([booking, awaiting]).items).toHaveLength(2);
  });

  it('공개 응답에서 내부 중복 판정 토큰과 고객 PII를 내보내지 않는다', () => {
    const normalized = normalizeReservation('bookings', 'ORDER-A', {
      bookingRef: 'ORDER-A',
      userEmail: 'private@example.com',
      customerName: '비공개',
      captureID: 'CAPTURE-A',
      status: 'CONFIRMED',
    }, NOW);
    const safe = publicReservation(normalized) as Record<string, unknown>;
    const serialized = JSON.stringify(safe);

    expect(safe.identityTokens).toBeUndefined();
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('비공개');
    expect(serialized).not.toContain('CAPTURE-A');
  });

  it('AI 플래너 결제를 차량 예약으로 오인해 배차 긴급업무를 만들지 않는다', () => {
    const planner = normalizeReservation('bookings', 'PLAN-ORDER', {
      bookingRef: 'PLAN-ORDER',
      productType: 'ai-planner-full',
      status: 'CONFIRMED',
      tourDate: '2026-09-01',
    }, NOW);
    expect(planner.actionRequired).toBe(false);
    expect(planner.dispatchStatus).toBe('not_required');
  });
});

describe('AI 운영센터 우선순위 회귀 방지', () => {
  it('P0를 숫자 0 때문에 마지막으로 보내지 않고 가장 먼저 정렬한다', () => {
    const base = {
      type: 'test', sourceSystem: 'test', sourceRecordId: 'x', status: 'open',
      nextAction: '확인', actionRequired: true, ageHours: 0, eventDate: '',
      createdAtMs: NOW, deepLink: '/admin',
    };
    const sorted = sortWorkItems([
      { ...base, workItemId: 'p2', title: 'P2', priority: 'P2' },
      { ...base, workItemId: 'p0', title: 'P0', priority: 'P0' },
      { ...base, workItemId: 'p1', title: 'P1', priority: 'P1' },
    ]);
    expect(sorted.map((item) => item.priority)).toEqual(['P0', 'P1', 'P2']);
  });

  it('재시도 원본 조회 실패를 대기 0건 정상으로 오인하지 않는다', () => {
    const health = retryQueueHealth('email_retry', '고객 이메일', [], false);
    expect(health.status).toBe('unknown');
    expect(health.detail).toBe('상태 확인 실패');
  });

  it('decision_queue status가 누락된 과거 문서는 pending으로 정규화하고 처리 대상으로 둔다', () => {
    const decision = normalizeDecision('DECISION-1', { createdAtMs: NOW }, NOW);
    expect(decision.status).toBe('pending');
    expect(decision.actionRequired).toBe(true);
  });
});
