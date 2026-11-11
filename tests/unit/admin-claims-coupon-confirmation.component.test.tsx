// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

void React;

const state = vi.hoisted(() => ({
  language: 'ko' as 'ko' | 'en' | 'ja' | 'zh',
  getIdToken: vi.fn(async () => 'synthetic-admin-token'),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  user: { email: 'admin@test.invalid', getIdToken: state.getIdToken },
}) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: state.language }) }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/components/admin/InquiryResponsePanel', () => ({ default: () => null }));
vi.mock('@/components/admin/RuntimeFlagsPanel', () => ({ RuntimeFlagsPanel: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(), updateDoc: vi.fn(), serverTimestamp: vi.fn(),
}));

import AdminClaims from '../../src/pages/AdminClaims';

const request = vi.fn();
const confirm = vi.fn();

function openPage(input = 'synthetic-user-id') {
  render(<MemoryRouter><AdminClaims /></MemoryRouter>);
  fireEvent.change(screen.getByPlaceholderText('uid 또는 이메일'), { target: { value: input } });
  return screen.getByRole('button', { name: '발급' });
}

beforeEach(() => {
  state.language = 'ko';
  state.getIdToken.mockClear();
  request.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { uid: 'synthetic-user-id', issued: 3 } }) });
  confirm.mockReset().mockReturnValue(true);
  vi.stubGlobal('fetch', request);
  vi.spyOn(window, 'confirm').mockImplementation(confirm);
  vi.stubEnv('VITE_ADMIN_EMAIL', 'admin@test.invalid');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('AdminClaims 가입쿠폰 발급 확인', () => {
  it.each([
    ['ko', '가입 혜택 3장', '365일'],
    ['en', '3 welcome coupons', '365 days'],
    ['ja', '入会特典クーポン3枚', '365日'],
    ['zh', '3张注册优惠券', '365天'],
  ] as const)('%s 안내와 확인에 실제 3종·유효기간을 표시한다', (language, summary, validity) => {
    state.language = language;
    const button = openPage();
    expect(screen.getByText(new RegExp(summary))).toHaveTextContent(validity);
    confirm.mockReturnValue(false);
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(summary));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(validity));
    expect(request).not.toHaveBeenCalled();
  });

  it('입력창 Enter는 토큰 조회나 발급 요청을 실행하지 않는다', () => {
    openPage();
    fireEvent.keyDown(screen.getByPlaceholderText('uid 또는 이메일'), { key: 'Enter', code: 'Enter' });
    expect(confirm).not.toHaveBeenCalled();
    expect(state.getIdToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('취소하면 입력을 유지하고 토큰 조회와 발급을 하지 않는다', () => {
    confirm.mockReturnValue(false);
    fireEvent.click(openPage('  synthetic-user-id  '));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('synthetic-user-id'));
    expect(screen.getByPlaceholderText('uid 또는 이메일')).toHaveValue('  synthetic-user-id  ');
    expect(state.getIdToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('확인된 UID만 기존 API로 한 번 요청한다', async () => {
    fireEvent.click(openPage('  synthetic-user-id  '));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith('/api/admin-coupon-fix', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ uid: 'synthetic-user-id' }),
    }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('이 화면은 이력을 검사하지 않습니다'));
    await waitFor(() => expect(screen.getByText(/3장 발급 완료/)).toBeInTheDocument());
  });

  it('이메일 대상과 기존 요청 계약을 유지한다', async () => {
    fireEvent.click(openPage('person@example.invalid'));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith('/api/admin-coupon-fix', expect.objectContaining({
      body: JSON.stringify({ email: 'person@example.invalid' }),
    }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('person@example.invalid'));
  });

  it('토큰을 기다리는 중 연속 클릭은 요청을 중복하지 않는다', async () => {
    let resolveToken!: (value: string) => void;
    state.getIdToken.mockImplementationOnce(() => new Promise(resolve => { resolveToken = resolve; }));
    const button = openPage();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(state.getIdToken).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    await act(async () => resolveToken('synthetic-admin-token'));
    expect(request).toHaveBeenCalledOnce();
  });

  it('빈 대상은 발급 버튼을 잠근다', () => {
    expect(openPage('   ')).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['ko', '가입 혜택 발급 기간이 종료되어 쿠폰이 발급되지 않았습니다.'],
    ['en', 'The welcome offer has ended. No coupons were issued.'],
    ['ja', '入会特典の発行期間が終了したため、クーポンは発行されませんでした。'],
    ['zh', '注册优惠活动已结束，未发放优惠券。'],
  ] as const)('%s 마감 응답은 완료로 표시하지 않고 입력을 보존한다', async (language, message) => {
    state.language = language;
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, data: {
      uid: 'synthetic-user-id', issued: 0, promoClosed: true,
    } }) });
    const button = openPage('  synthetic-user-id  ');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(new RegExp(message))).toBeInTheDocument());
    expect(screen.queryByText(/발급 완료/)).toBeNull();
    expect(screen.queryByText(/^성공:/)).toBeNull();
    expect(screen.getByPlaceholderText('uid 또는 이메일')).toHaveValue('  synthetic-user-id  ');
    expect(button).toBeEnabled();
    expect(request).toHaveBeenCalledOnce();
  });

  it('마감 안내 후 새로 확인한 요청만 보내며 실제 3장 응답 때 입력을 지운다', async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, data: {
      uid: 'synthetic-user-id', issued: 0, promoClosed: true,
    } }) });
    const button = openPage();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/가입 혜택 발급 기간이 종료/)).toBeInTheDocument());
    expect(confirm).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/3장 발급 완료/)).toBeInTheDocument());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.getByPlaceholderText('uid 또는 이메일')).toHaveValue('');
  });

  it('이미 발급됨 응답은 마감과 구별해 기존 완료 표시를 유지한다', async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, data: {
      uid: 'synthetic-user-id', issued: 0, alreadyIssued: true,
    } }) });
    fireEvent.click(openPage());
    await waitFor(() => expect(screen.getByText(/이미 발급됨/)).toBeInTheDocument());
    expect(screen.queryByText(/0장 발급 완료/)).toBeNull();
    expect(screen.getByPlaceholderText('uid 또는 이메일')).toHaveValue('');
    expect(request).toHaveBeenCalledOnce();
  });
});
