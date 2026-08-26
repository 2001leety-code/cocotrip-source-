// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

import { MoodAccessManager } from '../../src/components/admin/MoodAccessManager';

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
        emails: ['operator@x.com', 'mood1@x.com', 'mood2@x.com'],
        admins: ['operator@x.com'],
        settlementApproverEmails: ['mood1@x.com', 'mood2@x.com'],
        clientId: 'COMPANY_A',
      },
    });
  });
});

describe('MoodAccessManager MOOD 금액 확인 담당자', () => {
  it('두 MOOD 계정을 별도 확인 목록으로 보여주고 정확한 서버 목록 이름으로 추가한다', async () => {
    render(<MoodAccessManager open onClose={() => undefined} />);

    expect(await screen.findByText('MOOD 금액 확인 담당자')).toBeInTheDocument();
    expect(screen.getAllByText('mood1@x.com').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('mood2@x.com').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'MOOD 금액 확인 담당자 mood1@x.com 제거' }).className).toContain('h-11');

    fireEvent.change(screen.getByPlaceholderText('예: staff@example.com'), { target: { value: 'mood3@x.com' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'settlementApproverEmails' } });
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
});
