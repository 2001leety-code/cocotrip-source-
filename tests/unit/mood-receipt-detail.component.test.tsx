// @vitest-environment jsdom
/**
 * MoodReceiptModal 상세표시 회귀 슬롯 (2026-07-04 운영자 요청 fix).
 *
 * 잠금:
 *   1. 톨비 0원도 항상 표시("통행료 없는 경로") — 숨겨서 '톨비가 안 나온다' 오해했던 원인.
 *   2. 요금 산식: 기본요금(단가 × 시간)·거리 추가(km × 660원) 계산 근거 표기.
 *   3. 레거시(상세 미기록) 예약은 "상세 내역 미기록" 안내.
 *   4. 동선 지도: breakdown 주소 있으면 /api/mood-route 재조회(시각화 전용).
 *
 * authFetch·MoodRouteMap 은 mock (지도 SDK/네트워크 무의존).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetchMock(...a) }));
vi.mock('@/components/MoodRouteMap', () => ({
  MoodRouteMap: () => <div data-testid="route-map" />,
}));

import { MoodReceiptModal } from '../../src/components/mood/MoodReceiptModal';

// 실제 7/4 운행 실데이터 형태 (톨비 0 케이스)
const REAL_BOOKING = {
  id: 'rAYZlLg6VcaByp',
  date: '2026-07-04',
  startTime: '09:20',
  durationHours: 9,
  serviceType: 'vehicle',
  amountKRW: 387420,
  ratePerHour: 33000,
  runningBalanceKRW: 662580,
  breakdown: {
    baseKRW: 297000,
    distanceSurchargeKRW: 90420,
    tollKRW: 0,
    km: 137,
    origin: '서울특별시 송파구 잠실동',
    destination: '서울특별시 송파구 잠실동',
    waypoints: ['르픽', '브이스페이스', '김포공항', '유진집'],
  },
};

beforeEach(() => {
  authFetchMock.mockReset();
  authFetchMock.mockResolvedValue({
    json: async () => ({ ok: true, data: { km: 137, durationMin: 180, path: [[127, 37.5]], points: [{ lat: 37.5, lng: 127, role: 'origin' }] } }),
  });
});

describe('MoodReceiptModal — 요금 상세 (2026-07-04)', () => {
  it('톨비 0원도 항상 표시 — "통행료 없는 경로" 명시', () => {
    render(<MoodReceiptModal booking={REAL_BOOKING} onClose={() => {}} />);
    expect(screen.getByText(/톨비/)).toBeTruthy();
    expect(screen.getByText(/통행료 없는 경로/)).toBeTruthy();
  });

  it('기본요금 산식 — 단가 × 시간 표기', () => {
    render(<MoodReceiptModal booking={REAL_BOOKING} onClose={() => {}} />);
    expect(screen.getByText(/33,000원\/시간 × 9시간/)).toBeTruthy();
  });

  it('거리 추가요금 산식 — km × 660원 표기', () => {
    render(<MoodReceiptModal booking={REAL_BOOKING} onClose={() => {}} />);
    expect(screen.getByText(/137km × 660원/)).toBeTruthy();
  });

  it('50km 미만이면 "무료" 근거 표시 + 0원', () => {
    const b = { ...REAL_BOOKING, breakdown: { ...REAL_BOOKING.breakdown, km: 30, distanceSurchargeKRW: 0 } };
    render(<MoodReceiptModal booking={b} onClose={() => {}} />);
    expect(screen.getByText(/30km — 50km 미만 무료/)).toBeTruthy();
  });

  it('레거시(상세 미기록) 예약은 안내 문구 + 톨비 행 없음', () => {
    const legacy = { id: 'x', serviceType: 'vehicle', amountKRW: 99000, breakdown: { origin: 'A', destination: 'B' } };
    render(<MoodReceiptModal booking={legacy} onClose={() => {}} />);
    expect(screen.getByText(/상세 내역 미기록/)).toBeTruthy();
    expect(screen.queryByText(/통행료 없는 경로/)).toBeNull();
  });

  it('동선 지도 — breakdown 주소로 mood-route 재조회 후 렌더', async () => {
    render(<MoodReceiptModal booking={REAL_BOOKING} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('route-map')).toBeTruthy());
    const url = String(authFetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/mood-route?');
    expect(url).toContain('origin=');
    expect(url).toContain('waypoints=');
  });

  it('저장된 도착·재출발 시각과 대기시간을 주소 아래 표시한다', () => {
    const scheduled = {
      ...REAL_BOOKING,
      routeSchedule: [
        { arrivalTime: null, pickupTime: '09:20' },
        { arrivalTime: '10:00', pickupTime: '12:00' },
        { arrivalTime: null, pickupTime: null },
        { arrivalTime: null, pickupTime: null },
        { arrivalTime: null, pickupTime: null },
        { arrivalTime: '18:00', pickupTime: null },
      ],
    };
    render(<MoodReceiptModal booking={scheduled} onClose={() => {}} />);

    expect(screen.getByText('출발 09:20')).toBeTruthy();
    expect(screen.getByText('도착 10:00 · 재출발 12:00 · 대기 2시간')).toBeTruthy();
    expect(screen.getByText('도착 18:00')).toBeTruthy();
  });

  it('경로 조회 실패해도 영수증 텍스트는 그대로 (지도만 생략)', async () => {
    authFetchMock.mockRejectedValueOnce(new Error('network'));
    render(<MoodReceiptModal booking={REAL_BOOKING} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull());
    expect(screen.queryByTestId('route-map')).toBeNull();
    expect(screen.getByText(/요금 내역/)).toBeTruthy();
  });

  it('완료 영수증은 운영자와 MOOD 확인자·제안 버전을 함께 남긴다', () => {
    const approved = {
      ...REAL_BOOKING,
      status: 'completed',
      finalAmountKRW: 551300,
      actualHours: 10,
      finalBreakdown: { ...REAL_BOOKING.breakdown, baseKRW: 300000, distanceSurchargeKRW: 235200, tollKRW: 16100, km: 392 },
      settlementApproval: {
        status: 'approved' as const,
        mode: 'initial' as const,
        proposalId: 'proposal-receipt-001',
        version: 2,
        bookedAmountKRW: REAL_BOOKING.amountKRW,
        previousFinalAmountKRW: null,
        finalAmountKRW: 551300,
        deltaKRW: 163880,
        actualHours: 10,
        finalBreakdown: { baseKRW: 300000, distanceSurchargeKRW: 235200, tollKRW: 16100, km: 392 },
        tollMode: 'actual' as const,
        tollEntries: null,
        settlementReason: '실제 이용 반영',
        proposedByEmail: 'operator@cocotrip.test',
        proposedAt: Date.UTC(2026, 7, 21, 1, 30),
        changeRequestReason: null,
        approvedByEmail: 'mood-approver@example.com',
        approvedAt: Date.UTC(2026, 7, 21, 2, 15),
        proposedBalanceKRW: 1000000,
        proposedResultingBalanceKRW: 836120,
        pendingIncludedTollCount: 0,
      },
    };
    render(<MoodReceiptModal booking={approved} onClose={() => {}} />);

    expect(screen.getByText(/양측 금액 확인 완료 · 제안 버전 2/)).toBeTruthy();
    expect(screen.getByText(/operator@cocotrip.test/)).toBeTruthy();
    expect(screen.getByText(/mood-approver@example.com/)).toBeTruthy();
  });

  it('위·아래 닫기 버튼은 모두 44px 터치 높이를 가진다', () => {
    render(<MoodReceiptModal booking={REAL_BOOKING} onClose={() => {}} />);

    screen.getAllByRole('button', { name: '닫기' }).forEach((button) => {
      expect(button.className).toMatch(/(?:h-11|min-h-11)/);
    });
  });
});
