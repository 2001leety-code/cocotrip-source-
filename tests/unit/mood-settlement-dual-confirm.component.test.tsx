// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

import {
  MoodSettlementApprovalPanel,
  MoodSettlementEditor,
  type SettlementApprovalSummary,
  type SettlementBooking,
} from '../../src/components/mood/MoodSettlementEditor';

const approval: SettlementApprovalSummary = {
  status: 'awaiting_mood',
  mode: 'initial',
  proposalId: 'proposal-dual-confirm-001',
  version: 1,
  bookedAmountKRW: 537740,
  previousFinalAmountKRW: null,
  finalAmountKRW: 551300,
  deltaKRW: 13560,
  actualHours: 10,
  finalBreakdown: {
    baseKRW: 300000,
    distanceSurchargeKRW: 235200,
    tollKRW: 16100,
    estimatedTollKRW: 9200,
    km: 392,
    distanceSource: 'manual',
    actualTotalKm: 438,
    excludedKm: 46,
  },
  tollMode: 'itemized',
  tollEntries: [
    { label: '서울 → 평택', date: '2026-08-20 11:23', amountKRW: 5100, status: 'pending', includedInSettlement: true, evidenceRef: '하이패스 캡처' },
    { label: '충전(제외내역)', date: '2026-08-20 15:27', amountKRW: 10000, status: 'confirmed', includedInSettlement: false, evidenceRef: '카드 충전' },
  ],
  settlementReason: '픽업 전 46km 제외, 실제 톨비 반영',
  proposedByEmail: 'operator@cocotrip.test',
  proposedAt: Date.UTC(2026, 7, 21, 1, 30),
  changeRequestReason: null,
  approvedByEmail: null,
  approvedAt: null,
  proposedBalanceKRW: 1000000,
  proposedResultingBalanceKRW: 986440,
  pendingIncludedTollCount: 1,
};

const booking: SettlementBooking = {
  id: 'MOOD-20260820',
  date: '2026-08-20',
  startTime: '09:30',
  durationHours: 10,
  serviceType: 'vehicle',
  amountKRW: 537740,
  status: 'confirmed',
  revision: 2,
  breakdown: { baseKRW: 300000, distanceSurchargeKRW: 228540, tollKRW: 9200, km: 380.9 },
  settlementApproval: approval,
};

function jsonResponse(data: unknown) {
  return { status: 200, json: async () => data };
}

beforeEach(() => {
  authFetchMock.mockReset();
  authFetchMock.mockResolvedValue(jsonResponse({
    ok: true,
    data: { proposalId: approval.proposalId, bookingId: booking.id, status: 'approved', finalAmountKRW: 551300, deltaKRW: 13560, balanceKRW: 986440, revision: 3 },
  }));
});

afterEach(() => cleanup());

describe('MoodSettlementApprovalPanel — 운영자와 MOOD 양측 확인', () => {
  it('운영자 화면은 제안 근거와 잔액 미반영 상태를 보여주고 승인 버튼은 감춘다', () => {
    render(<MoodSettlementApprovalPanel booking={booking} isAdmin canApproveSettlement={false} onResponded={() => {}} />);

    expect(screen.getByText('MOOD 확인 대기')).toBeInTheDocument();
    expect(screen.getByText(/438km − 제외 46km = 392km/)).toBeInTheDocument();
    expect(screen.getByText(/MOOD 확인 전까지 잔액 변경 없음/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '요청만 철회' })).toHaveClass('min-h-[44px]');
    expect(screen.queryByRole('button', { name: '551,300원으로 확정' })).not.toBeInTheDocument();
  });

  it('MOOD 승인자는 미확정 톨 확인과 금액 재확인을 거친 뒤 proposal id만 승인한다', async () => {
    const user = userEvent.setup();
    const onResponded = vi.fn();
    render(<MoodSettlementApprovalPanel booking={booking} isAdmin={false} canApproveSettlement onResponded={onResponded} />);

    const approveButton = screen.getByRole('button', { name: '551,300원으로 확정' });
    expect(approveButton).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(approveButton).toBeEnabled();
    await user.click(approveButton);
    expect(authFetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '551,300원 최종 확인' }));
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = authFetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(url).toBe('/api/mood-settle-respond');
    expect(body).toMatchObject({ proposalId: approval.proposalId, action: 'approve', acknowledgePendingTolls: true });
    expect(body.idempotencyKey).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('finalAmountKRW');
    expect(onResponded).toHaveBeenCalledWith('양측 확인 완료 · 551,300원 확정');
  });

  it('수정 요청은 사유를 입력하고 두 번째 버튼을 눌러야 전송된다', async () => {
    const user = userEvent.setup();
    authFetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { status: 'changes_requested' } }));
    render(<MoodSettlementApprovalPanel booking={booking} isAdmin={false} canApproveSettlement onResponded={() => {}} />);

    await user.click(screen.getByRole('button', { name: '수정 요청' }));
    expect(authFetchMock).not.toHaveBeenCalled();
    const sendButton = screen.getByRole('button', { name: '수정 요청 보내기' });
    expect(sendButton).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: '바꿔야 할 내용' }), '제외 거리를 48km로 확인해 주세요.');
    await user.click(sendButton);

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(authFetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({
      proposalId: approval.proposalId,
      action: 'request_changes',
      reason: '제외 거리를 48km로 확인해 주세요.',
    });
  });

  it('승인 권한이 없는 MOOD 계정은 상세만 읽고 응답할 수 없다', () => {
    render(<MoodSettlementApprovalPanel booking={booking} isAdmin={false} canApproveSettlement={false} onResponded={() => {}} />);

    expect(screen.getByText(/읽기 전용/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /확정/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수정 요청' })).not.toBeInTheDocument();
  });
});

describe('MoodSettlementEditor — 접근 가능한 실제값 입력', () => {
  it('실제 톨비 직접 입력칸에 이름·터치 높이·키보드 포커스 표시가 있다', async () => {
    const user = userEvent.setup();
    render(<MoodSettlementEditor booking={booking} mode="initial" onClose={() => {}} onCompleted={() => {}} />);

    await user.selectOptions(screen.getByRole('combobox', { name: '톨비 기준' }), 'actual');

    const actualTollInput = screen.getByRole('spinbutton', { name: '실제 톨비 합계(원)' });
    expect(actualTollInput).toHaveClass('min-h-[44px]');
    expect(actualTollInput).toHaveClass('focus-visible:ring-2');
  });
});
