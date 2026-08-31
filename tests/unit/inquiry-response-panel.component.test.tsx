// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InquiryResponsePanel from '../../src/components/admin/InquiryResponsePanel';

void React;

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const workflow = {
  draftStatus: 'ready',
  draftSubject: 'Your CocoTrip inquiry',
  draftBody: 'A coordinator reviewed your request and will reply with the next steps.',
  draftLanguage: 'en',
  draftSource: 'ai',
  draftRevision: 2,
  deliveryStatus: 'not_sent',
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('InquiryResponsePanel', () => {
  it('운영자가 검토한 저장 초안과 revision만 고객 발송 API로 보낸다', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response(200, { ok: true, code: 'SENT' }));
    const getIdToken = vi.fn(async () => 'admin-token');

    render(
      <InquiryResponsePanel
        inquiryId="inquiry-1"
        email="stored@example.com"
        workflow={workflow}
        getIdToken={getIdToken}
      />,
    );

    fireEvent.change(screen.getByLabelText('고객에게 보낼 내용'), {
      target: { value: 'This is the response reviewed and edited by the operator before sending.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /고객 이메일 발송/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(getIdToken).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin-inquiry-response');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      inquiryId: 'inquiry-1',
      action: 'send',
      expectedDraftRevision: 2,
      subject: 'Your CocoTrip inquiry',
      body: 'This is the response reviewed and edited by the operator before sending.',
    });
    expect(await screen.findByText('고객 이메일 발송이 확인되었습니다.')).toBeInTheDocument();
    expect(screen.getByText('답변 완료')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /고객 이메일 발송/ })).toBeNull();
  });

  it('부모 목록 새로고침 없이도 방금 생성한 첫 초안을 표시하고 발송 가능하게 만든다', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response(200, {
      ok: true,
      code: 'DRAFT_READY',
      workflow: { ...workflow, draftRevision: 1 },
    }));

    render(
      <InquiryResponsePanel
        inquiryId="new-inquiry"
        email="stored@example.com"
        getIdToken={async () => 'admin-token'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '답변 초안 만들기' }));

    expect(await screen.findByDisplayValue('Your CocoTrip inquiry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /고객 이메일 발송/ })).toBeEnabled();
  });

  it('재시도 상태에서는 실제 승인·보관된 본문을 보여주고 새 발송 버튼을 숨긴다', () => {
    render(
      <InquiryResponsePanel
        inquiryId="retryable-1"
        email="stored@example.com"
        workflow={{
          ...workflow,
          reviewStatus: 'approved',
          approvedSubject: 'Operator approved subject',
          approvedBody: 'This exact operator-approved response is the one queued for retry.',
          approvedRevision: 2,
          deliveryStatus: 'retryable',
          nextDeliveryAttemptAtMs: Date.now() + 60_000,
        }}
        getIdToken={async () => 'admin-token'}
      />,
    );

    expect(screen.getByLabelText('이메일 제목')).toHaveValue('Operator approved subject');
    expect(screen.getByLabelText('고객에게 보낼 내용')).toHaveValue(
      'This exact operator-approved response is the one queued for retry.',
    );
    expect(screen.getByLabelText('고객에게 보낼 내용')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /고객 이메일 발송/ })).toBeNull();
    expect(screen.getByRole('button', { name: /안전 재시도/ })).toBeInTheDocument();
  });

  it('202 결과 불명 응답도 즉시 잠그고 보낸편지함 확인 단계로 전환한다', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response(202, { ok: false, code: 'OUTCOME_UNKNOWN' }));

    render(
      <InquiryResponsePanel
        inquiryId="unknown-after-send"
        email="stored@example.com"
        workflow={workflow}
        getIdToken={async () => 'admin-token'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /고객 이메일 발송/ }));

    expect(await screen.findByText(/메일 서버에 넘긴 뒤 결과를 확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/중복 발송을 막기 위해 자동 재시도하지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /고객 이메일 발송/ })).toBeNull();
  });

  it('자동 발송 불가 응답의 workflow도 즉시 반영해 수동 완료 경로로 전환한다', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response(422, {
      ok: false,
      code: 'MANUAL_REQUIRED',
      workflow: { ...workflow, deliveryStatus: 'manual_required' },
    }));

    render(
      <InquiryResponsePanel
        inquiryId="invalid-email"
        email="invalid-email-value"
        workflow={workflow}
        getIdToken={async () => 'admin-token'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /고객 이메일 발송/ }));

    expect(await screen.findByText(/자동 이메일을 사용할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /외부 메일·직접 답변 완료/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /고객 이메일 발송/ })).toBeNull();
  });

  it('이메일 없는 문의는 자동 발송 대신 전화·WhatsApp 완료 확인만 제공한다', () => {
    render(
      <InquiryResponsePanel
        inquiryId="phone-only"
        workflow={{ ...workflow, deliveryStatus: 'manual_required' }}
        getIdToken={async () => 'admin-token'}
      />,
    );

    expect(screen.queryByRole('button', { name: /고객 이메일 발송/ })).toBeNull();
    expect(screen.getByRole('button', { name: /전화·WhatsApp 답변 완료/ })).toBeInTheDocument();
  });

  it('이메일 없는 새 문의도 AI 초안을 만들 수 있다', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response(200, {
      ok: true,
      code: 'DRAFT_READY',
      workflow: {
        ...workflow,
        deliveryStatus: 'manual_required',
      },
    }));

    render(
      <InquiryResponsePanel
        inquiryId="phone-only-new"
        getIdToken={async () => 'admin-token'}
      />,
    );

    const generateButton = screen.getByRole('button', { name: '답변 초안 만들기' });
    expect(generateButton).toBeEnabled();
    fireEvent.click(generateButton);

    expect(await screen.findByDisplayValue('Your CocoTrip inquiry')).toBeEnabled();
    expect(screen.getByRole('button', { name: /전화·WhatsApp 답변 완료/ })).toBeInTheDocument();
  });

  it('SMTP 결과 불명은 자동 재시도 버튼 없이 보낸편지함 확인 선택지를 보여준다', () => {
    render(
      <InquiryResponsePanel
        inquiryId="unknown-1"
        email="stored@example.com"
        workflow={{ ...workflow, deliveryStatus: 'outcome_unknown' }}
        getIdToken={async () => 'admin-token'}
      />,
    );

    expect(screen.getByText(/중복 발송을 막기 위해 자동 재시도하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실제 발송됨' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실제 발송 안 됨' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /안전 재시도/ })).toBeNull();
  });
});
