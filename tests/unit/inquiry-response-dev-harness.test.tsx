// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InquiryResponsePanel, {
  type InquiryResponseDevActionHandler,
  type InquiryResponseWorkflow,
} from '../../src/components/admin/InquiryResponsePanel';

void React;

const draft: InquiryResponseWorkflow = {
  draftStatus: 'ready',
  draftSubject: 'Demo price inquiry',
  draftBody: 'A fake response for the local-only harness.',
  draftLanguage: 'en',
  draftSource: 'ai',
  draftRevision: 1,
  deliveryStatus: 'not_sent',
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('InquiryResponsePanel DEV action injection', () => {
  it('인증·fetch 없이 DRAFT_READY → RETRY_SCHEDULED → OUTCOME_UNKNOWN 상태를 실제 패널 클릭으로 전환한다', async () => {
    const getIdToken = vi.fn(async () => 'must-not-be-used');
    const fetchMock = vi.fn(async () => { throw new Error('network must not be used'); });
    vi.stubGlobal('fetch', fetchMock);

    const actionHandler = vi.fn<InquiryResponseDevActionHandler>(async (request) => {
      if (request.action === 'generate') {
        return { ok: true, code: 'DRAFT_READY', workflow: draft };
      }
      if (request.action === 'send') {
        return {
          ok: false,
          code: 'RETRY_SCHEDULED',
          workflow: {
            ...draft,
            reviewStatus: 'approved',
            approvedSubject: String(request.subject || ''),
            approvedBody: String(request.body || ''),
            approvedRevision: 1,
            deliveryStatus: 'retryable',
          },
        };
      }
      return {
        ok: false,
        code: 'OUTCOME_UNKNOWN',
        workflow: { ...draft, deliveryStatus: 'outcome_unknown' },
      };
    });

    render(
      <InquiryResponsePanel
        inquiryId="fake-inquiry"
        email="demo@example.invalid"
        getIdToken={getIdToken}
        devActionHandler={actionHandler}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '답변 초안 만들기' }));
    expect(await screen.findByText(/답변 초안을 준비했습니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /고객 이메일 발송/ }));
    expect(await screen.findByText('안전 재시도 대기')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /지금 안전 재시도/ }));
    expect(await screen.findByText('실제 발송 여부 확인 필요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실제 발송됨' })).toHaveClass('min-h-[44px]');

    await waitFor(() => expect(actionHandler).toHaveBeenCalledTimes(3));
    expect(actionHandler.mock.calls.map(([request]) => request.action)).toEqual(['generate', 'send', 'retry']);
    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
