// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

import { MoodAccessManager } from '../../src/components/admin/MoodAccessManager';

const PRIMARY_MOOD_ADMIN_EMAIL = '2001leety@gmail.com';

function jsonResponse(value: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  };
}

beforeEach(() => {
  authFetchMock.mockReset();
  authFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return jsonResponse({ ok: true, data: { changed: true } });
    }
    return jsonResponse({
      ok: true,
      data: {
        emails: [PRIMARY_MOOD_ADMIN_EMAIL, 'mood1@x.com', 'mood2@x.com', 'legacy@x.com'],
        admins: [PRIMARY_MOOD_ADMIN_EMAIL, 'legacy@x.com'],
        settlementApproverEmails: ['mood1@x.com', 'mood2@x.com'],
        clientId: 'COMPANY_A',
        primaryAdminEmail: PRIMARY_MOOD_ADMIN_EMAIL,
      },
    });
  });
});

describe('MoodAccessManager 단일 관리자와 직원 권한', () => {
  it('고정 관리자는 읽기 전용이고 과거 비고정 관리자 항목만 정리할 수 있다', async () => {
    render(<MoodAccessManager open onClose={() => undefined} />);

    expect(await screen.findByText('유일한 고정 관리자 (제안·충전)')).toBeInTheDocument();
    expect(screen.getByText('고정 · 변경 불가')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`${PRIMARY_MOOD_ADMIN_EMAIL} 제거`) })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '정리 대상 관리자 항목 legacy@x.com 제거' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /관리자|제안|충전/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '정리 대상 관리자 항목 legacy@x.com 제거' }));
    await waitFor(() => {
      const removeCall = authFetchMock.mock.calls.find((call) => {
        const init = call[1] as RequestInit | undefined;
        return init?.method === 'POST'
          && JSON.parse(String(init.body)).action === 'remove';
      });
      expect(JSON.parse(String((removeCall?.[1] as RequestInit).body))).toEqual({
        action: 'remove',
        list: 'admins',
        email: 'legacy@x.com',
      });
    });
  });

  it('직원 소비자와 금액 확인 전용 권한을 구분하고 확인 목록으로 추가한다', async () => {
    render(<MoodAccessManager open onClose={() => undefined} />);

    expect(await screen.findByRole('heading', { name: '직원 금액 확인 전용' })).toBeInTheDocument();
    expect(screen.getByText('직원 소비자 계정 (조회·예약)')).toBeInTheDocument();
    expect(screen.getAllByText('mood1@x.com').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('mood2@x.com').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/관리자가 제안한 예약 변경·정산 금액을 확인/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '금액 확인 전용 직원 mood1@x.com 제거' }).className).toContain('h-11');

    fireEvent.change(screen.getByLabelText('추가할 MOOD 직원 이메일'), { target: { value: 'mood3@x.com' } });
    fireEvent.change(screen.getByLabelText('추가할 권한 종류'), { target: { value: 'settlementApproverEmails' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));

    await waitFor(() => {
      const postCall = authFetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({
        action: 'add',
        list: 'settlementApproverEmails',
        email: 'mood3@x.com',
      });
    });
  });

  it('서버가 고정 관리자 값을 누락하면 정확한 관리자를 표시하고 모든 편집을 잠근다', async () => {
    authFetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      data: {
        emails: [PRIMARY_MOOD_ADMIN_EMAIL, 'legacy@x.com'],
        admins: [PRIMARY_MOOD_ADMIN_EMAIL, 'legacy@x.com'],
        settlementApproverEmails: [],
        clientId: 'COMPANY_A',
      },
    }));

    render(<MoodAccessManager open onClose={() => undefined} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(PRIMARY_MOOD_ADMIN_EMAIL);
    expect(screen.getByText(PRIMARY_MOOD_ADMIN_EMAIL)).toBeInTheDocument();
    expect(screen.getByLabelText('추가할 MOOD 직원 이메일')).toBeDisabled();
    expect(screen.getByLabelText('추가할 권한 종류')).toBeDisabled();
    expect(screen.getByRole('button', { name: '정리 대상 관리자 항목 legacy@x.com 제거' })).toBeDisabled();
  });
});
