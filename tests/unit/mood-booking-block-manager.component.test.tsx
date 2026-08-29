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
  exceptions: [],
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
    expect(await screen.findByText('캘린더 반영 완료')).toBeInTheDocument();
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

  it('하루만 열기는 ruleIds 없이 예외 초안만 보내고 열린 날짜를 즉시 반영한다', async () => {
    const onUpdated = vi.fn();
    authFetchMock.mockResolvedValue(response({
      ok: true,
      data: {
        bookingAvailability: {
          ...availability,
          revision: 8,
          exceptions: [{
            id: 'open-one-day',
            enabled: true,
            startDate: '2026-09-04',
            endDate: '2026-09-04',
            ruleIds: ['legacy-evening-blackout-2026'],
            reason: '촬영 예약 가능',
          }],
        },
      },
    }));

    render(<MoodBookingBlockManager availability={availability} onUpdated={onUpdated} onReload={() => {}} />);
    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: '+ 날짜 열기' }));
    fireEvent.change(screen.getByLabelText('열 날짜'), { target: { value: '2026-09-04' } });
    fireEvent.change(screen.getByLabelText('여는 사유'), { target: { value: '촬영 예약 가능' } });
    fireEvent.click(screen.getByRole('button', { name: '이 날짜 열기' }));

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((authFetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({
      action: 'upsert_exception',
      expectedRevision: 7,
      exception: {
        enabled: true,
        startDate: '2026-09-04',
        endDate: '2026-09-04',
        reason: '촬영 예약 가능',
      },
    });
    expect(body.exception.id).toMatch(/^mood-open-date-/);
    expect(body.exception).not.toHaveProperty('ruleIds');
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ revision: 8 })));
    expect(screen.getByText('캘린더 반영 완료')).toBeInTheDocument();
  });

  it('기간 열기는 시작일과 종료일을 양끝 포함 payload로 보낸다', async () => {
    authFetchMock.mockResolvedValue(response({
      ok: true,
      data: {
        bookingAvailability: {
          ...availability,
          revision: 8,
          exceptions: [{ id: 'open-range', enabled: true, startDate: '2026-09-03', endDate: '2026-09-05', ruleIds: ['legacy-evening-blackout-2026'], reason: '3일 운영' }],
        },
      },
    }));

    render(<MoodBookingBlockManager availability={availability} onUpdated={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: '+ 날짜 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '기간' }));
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-09-03' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('여는 사유'), { target: { value: '3일 운영' } });
    fireEvent.click(screen.getByRole('button', { name: '이 날짜 열기' }));

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((authFetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.exception).toMatchObject({ startDate: '2026-09-03', endDate: '2026-09-05', reason: '3일 운영' });
  });

  it('열린 날짜의 다시 차단은 exceptionId로 삭제 요청한다', async () => {
    const withException: MoodBookingAvailability = {
      ...availability,
      exceptions: [{ id: 'open-range', enabled: true, startDate: '2026-09-03', endDate: '2026-09-05', ruleIds: ['legacy-evening-blackout-2026'], reason: '3일 운영' }],
    };
    authFetchMock.mockResolvedValue(response({ ok: true, data: { bookingAvailability: { ...availability, revision: 8, exceptions: [] } } }));

    render(<MoodBookingBlockManager availability={withException} onUpdated={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByText('예약 차단 관리'));
    expect(screen.getByText('영향 규칙 1개 · 3일 운영')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 차단' }));

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((authFetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      action: 'delete_exception',
      exceptionId: 'open-range',
      expectedRevision: 7,
    });
  });

  it('모든 차단 해제는 두 번 확인한 뒤 하나의 원자 요청만 보낸다', async () => {
    authFetchMock.mockResolvedValue(response({
      ok: true,
      data: { bookingAvailability: { ...availability, revision: 8, rules: availability.rules.map((rule) => ({ ...rule, enabled: false })) } },
    }));
    render(<MoodBookingBlockManager availability={availability} onUpdated={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByText('예약 차단 관리'));

    fireEvent.click(screen.getByRole('button', { name: '모든 차단 해제' }));
    expect(authFetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '모든 차단 해제 확인' }));

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((authFetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      action: 'set_all_enabled',
      enabled: false,
      expectedRevision: 7,
    });
  });

  it('409 응답에 최신 설정이 있으면 먼저 반영하고 재시도 안내를 보여 준다', async () => {
    const onUpdated = vi.fn();
    const latest = { ...availability, revision: 9, rules: availability.rules.map((rule) => ({ ...rule, enabled: false })) };
    authFetchMock.mockResolvedValue(response({ ok: false, error: 'REVISION_CONFLICT', data: { bookingAvailability: latest } }, 409));
    render(<MoodBookingBlockManager availability={availability} onUpdated={onUpdated} onReload={() => {}} />);
    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: /사용 중지/ }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ revision: 9 })));
    expect(screen.getByRole('alert')).toHaveTextContent('최신 변경을 캘린더에 반영했습니다');
  });

  it('서버 error 필드의 날짜 불일치 코드를 조작 가능한 안내로 바꾼다', async () => {
    authFetchMock.mockResolvedValue(response({ ok: false, error: 'BOOKING_BLOCK_EXCEPTION_NO_MATCH' }, 409));
    render(<MoodBookingBlockManager availability={availability} onUpdated={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: '+ 날짜 열기' }));
    fireEvent.change(screen.getByLabelText('열 날짜'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('여는 사유'), { target: { value: '특별 운영' } });
    fireEvent.click(screen.getByRole('button', { name: '이 날짜 열기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('적용되는 차단 규칙이 없습니다');
    expect(screen.getByRole('alert')).not.toHaveTextContent('최신 변경');
  });

  it.each([
    ['BOOKING_BLOCK_RULE_LIMIT', '예약 차단 규칙은 최대 50개'],
    ['BOOKING_BLOCK_EXCEPTION_LIMIT', '열린 날짜는 최대 100개'],
    ['IDEMPOTENCY_CONFLICT', '같은 요청 번호에 다른 변경 내용'],
    ['IDEMPOTENCY_RESPONSE_MISSING', '이전 변경 결과를 확인할 수 없습니다'],
    ['INVALID_BOOKING_AVAILABILITY_CONFIG', '저장된 예약 차단 설정에 문제가 있어 변경할 수 없습니다'],
  ])('409 %s를 관리자 충돌이 아닌 정확한 안내로 보여 준다', async (error, expectedMessage) => {
    authFetchMock.mockResolvedValue(response({ ok: false, error }, 409));
    render(<MoodBookingBlockManager availability={availability} onUpdated={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /사용 중지/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(expectedMessage);
    expect(alert).not.toHaveTextContent('다른 관리자의 최신 변경');
  });
});
