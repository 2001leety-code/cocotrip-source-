// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

void React;

const getIdToken = vi.fn(async () => 'admin-token');
const mockUser = { getIdToken };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RuntimeFlagsPanel } from '../../src/components/admin/RuntimeFlagsPanel';

function apiResponse(body: unknown) {
  return { json: async () => body } as Response;
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  getIdToken.mockClear();
});

describe('RuntimeFlagsPanel external-send confirmation', () => {
  it('문의 자동 접수를 켤 때만 실제 발송 확인을 요구하고 취소하면 POST하지 않는다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse({
        ok: true,
        flags: { inquiry_auto_ack_enabled: false },
        schema: {
          inquiry_auto_ack_enabled: {
            label: '문의 자동 접수확인',
            desc: '새 문의 접수 확인',
            default: false,
          },
        },
      }))
      .mockResolvedValue(apiResponse({
        ok: true,
        flags: { inquiry_auto_ack_enabled: true },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<RuntimeFlagsPanel />);
    const toggle = await screen.findByRole('button', { name: '꺼짐' });
    fireEvent.click(toggle);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('자동 접수 확인 메일을 실제 발송'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      key: 'inquiry_auto_ack_enabled',
      value: true,
    });
  });

  it('문의 화면은 자동 접수 토글만 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse({
      ok: true,
      flags: {
        inquiry_auto_ack_enabled: false,
        margin_guard_enabled: true,
      },
      schema: {
        inquiry_auto_ack_enabled: {
          label: '문의 자동 접수확인',
          desc: '새 문의 접수 확인',
          default: false,
        },
        margin_guard_enabled: {
          label: '마진 가드',
          desc: '결제 안전 설정',
          default: true,
        },
      },
    })));

    render(<RuntimeFlagsPanel onlyKeys={['inquiry_auto_ack_enabled']} />);

    expect(await screen.findByText('문의 자동 접수확인')).toBeInTheDocument();
    expect(screen.queryByText('마진 가드')).toBeNull();
  });
});
