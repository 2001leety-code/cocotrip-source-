// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

import { MoodBookingBlockManager } from '../../src/components/mood/MoodBookingBlockManager';
import type { MoodBookingAvailability } from '../../src/lib/moodBookingAvailability';

const availability: MoodBookingAvailability = {
  schemaVersion: 1,
  revision: 7,
  rules: [{
    id: 'legacy-evening-blackout-2026',
    enabled: true,
    startDate: '2026-08-15',
    endDate: '2026-09-15',
    weekdays: [4, 5, 6],
    mode: 'starts_from',
    startTime: '18:00',
    reason: '예약 운영 일정',
  }],
};

function response(json: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

beforeEach(() => {
  authFetchMock.mockReset();
});

describe('MoodBookingBlockManager', () => {
  it('기존 규칙을 보여 주고 revision·requestId를 포함해 사용 상태를 저장한다', async () => {
    const onUpdated = vi.fn();
    authFetchMock.mockResolvedValue(response({
      ok: true,
      data: {
        bookingAvailability: {
          ...availability,
          revision: 8,
          rules: [{ ...availability.rules[0], enabled: false }],
        },
      },
    }));

    render(<MoodBookingBlockManager availability={availability} onUpdated={onUpdated} onReload={() => {}} />);

    expect(screen.getByText(/8월 15일~9월 15일 목·금·토/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /사용 중지/ }));

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    const [, init] = authFetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      action: 'upsert',
      expectedRevision: 7,
      rule: { id: 'legacy-evening-blackout-2026', enabled: false },
    });
    expect(body.requestId).toMatch(/^mood-block-/);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ revision: 8 })));
  });

  it('설정이 없으면 편집 대신 신규 예약 잠금과 다시 불러오기를 제공한다', () => {
    render(<MoodBookingBlockManager availability={null} onUpdated={() => {}} onReload={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('신규 예약은 자동으로 잠겨 있습니다');
    expect(screen.getByRole('button', { name: '설정 다시 불러오기' })).toHaveClass('min-h-11');
  });

  it('신규 규칙 저장 응답이 끊겨도 같은 ruleId와 requestId로 안전하게 재시도한다', async () => {
    let firstBody: Record<string, unknown> | null = null;
    let secondBody: Record<string, unknown> | null = null;
    authFetchMock
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        firstBody = JSON.parse(String(init.body));
        throw new Error('응답 연결 끊김');
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        secondBody = JSON.parse(String(init.body));
        return response({
          ok: true,
          data: {
            bookingAvailability: {
              schemaVersion: 1,
              revision: 8,
              rules: [(secondBody as { rule: unknown }).rule],
            },
          },
        });
      });
    const onUpdated = vi.fn();
    render(<MoodBookingBlockManager availability={availability} onUpdated={onUpdated} onReload={() => {}} />);

    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: '+ 차단 추가' }));
    fireEvent.change(screen.getByLabelText('차단 사유'), { target: { value: '촬영 휴무' } });
    fireEvent.click(screen.getByRole('button', { name: '규칙 저장' }));
    await screen.findByText('응답 연결 끊김');
    fireEvent.click(screen.getByRole('button', { name: '규칙 저장' }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ revision: 8 })));
    expect(secondBody).not.toBeNull();
    expect((secondBody as { requestId: string }).requestId).toBe((firstBody as { requestId: string }).requestId);
    expect((secondBody as { rule: { id: string } }).rule.id).toBe((firstBody as { rule: { id: string } }).rule.id);
  });
});
