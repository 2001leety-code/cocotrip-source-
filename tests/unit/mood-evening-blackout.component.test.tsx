// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'staff@mood.test' }, loading: false }),
}));
vi.mock('@/lib/firebase', () => ({ signInWithGoogle: vi.fn() }));
vi.mock('@/lib/appReady', () => ({ signalAppReady: vi.fn() }));
vi.mock('@/components/MoodRouteMap', () => ({ MoodRouteMap: () => <div data-testid="mood-route-map" /> }));
vi.mock('@/components/PwaInstallButton', () => ({ PwaInstallButton: () => null }));
vi.mock('@/components/charter/AddressAutocomplete', () => ({ AddressAutocomplete: () => null }));
vi.mock('@/components/mood/MoodCourseShareEditor', () => ({ MoodCourseShareEditor: () => null }));
vi.mock('@/components/mood/MoodGuideModal', () => ({ MoodGuideModal: () => null }));
vi.mock('@/components/mood/MoodReceiptModal', () => ({ MoodReceiptModal: () => null }));
vi.mock('@/components/mood/MoodBookingShareCard', () => ({
  MoodBookingShareCard: () => null,
  MoodBookingCopyButton: () => null,
}));

import MoodPortal from '../../src/pages/MoodPortal';
import { MoodAiBooking } from '../../src/components/mood/MoodAiBooking';
import { MoodBookingChangeModal, type ChangeableMoodBooking } from '../../src/components/mood/MoodBookingChangeModal';

const parseResponse = {
  ok: true,
  serviceGuess: 'vehicle',
  hasDirector: false,
  hasAirport: false,
  truncated: false,
  dates: ['2026-09-10'],
  flights: [],
  stops: [
    { order: 1, label: '서울역', address: '서울역', lat: 37.55, lng: 126.97, action: 'pickup', matchedFromPlacebook: true, geocodeOk: true, date: '2026-09-10', timeHint: '18:00' },
    { order: 2, label: '성수동', address: '성수동', lat: 37.54, lng: 127.05, action: 'arrive', matchedFromPlacebook: true, geocodeOk: true, date: '2026-09-10', timeHint: '21:00' },
  ],
};

function response(json: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

beforeEach(() => {
  authFetchMock.mockReset();
  authFetchMock.mockImplementation(async (url: string) => {
    const target = String(url);
    if (target.includes('/api/mood-data')) {
      return response({
        ok: true,
        data: { clientId: 'mood', client: { name: 'MOOD', balanceKRW: 1_000_000 }, bookings: [], isAdmin: false },
      });
    }
    if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
    if (target.includes('/api/mood-parse-schedule')) return response(parseResponse);
    if (target.includes('/api/mood-route')) {
      return response({ ok: true, data: { km: 10, tollKRW: 0, durationMin: 30, path: [], points: [] } });
    }
    if (target.includes('/api/mood-book')) {
      return response({ ok: true, data: { amountKRW: 120_000, balanceKRW: 880_000 } });
    }
    if (target.includes('/api/mood-change')) return response({ ok: true });
    return response({}, 404);
  });
});

describe('MoodPortal 임시 저녁 제한 UI', () => {
  it('고정 공지, 캘린더 표시·선택 설명, 수기 예약 즉시 차단을 함께 보여 준다', async () => {
    render(<MoodPortal />);

    const notice = await screen.findByRole('note', { name: '임시 예약 제한 안내' });
    expect(notice).toHaveTextContent('8월 15일~9월 15일 목·금·토는 오후 6시 이후 시작 예약 불가');
    expect(notice).toHaveTextContent('이미 확정된 예약은 그대로 유효합니다');

    const limitedDay = screen.getByRole('button', { name: '2026-08-15 · 오후 6시 이후 시작 예약 불가' });
    expect(limitedDay).toHaveTextContent('18시+');
    fireEvent.click(limitedDay);
    expect(screen.getByRole('status')).toHaveTextContent('2026-08-15는 오후 6시 이후 시작 예약 제한일입니다');

    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));
    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-08-15' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '18:00' } });

    expect(screen.getByRole('alert')).toHaveTextContent('오후 6시 이후 시작 예약을 할 수 없습니다');
    expect(screen.getByRole('button', { name: '오후 6시 이후 예약 불가' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '17:59' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '예약하기' })).toBeEnabled();
  });
});

describe('MoodAiBooking 임시 저녁 제한 UI', () => {
  it('AI가 제한 시각을 채우면 즉시 경고하고, 17:59로 고치기 전에는 요청하지 않는다', async () => {
    render(<MoodAiBooking clientId="mood" onBooked={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/MOOD 일정/), { target: { value: '9월 10일 18시 서울역 출발, 성수동 도착' } });
    fireEvent.click(screen.getByRole('button', { name: /일정 분석/ }));

    const blockedButton = await screen.findByRole('button', { name: '오후 6시 이후 예약 불가' });
    expect(blockedButton).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('오후 6시 이후 시작 예약을 할 수 없습니다');
    expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-book'))).toBe(false);

    fireEvent.change(screen.getByLabelText(/시작 시각/), { target: { value: '17:59' } });
    const enabledButton = screen.getByRole('button', { name: '이대로 예약' });
    expect(enabledButton).toBeEnabled();
    fireEvent.click(enabledButton);
    await waitFor(() => {
      expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-book'))).toBe(true);
    });
  });
});

function booking(overrides: Partial<ChangeableMoodBooking> = {}): ChangeableMoodBooking {
  return {
    id: 'booking-1',
    date: '2026-09-10',
    startTime: '18:00',
    durationHours: 3,
    serviceType: 'vehicle',
    amountKRW: 120_000,
    revision: 0,
    breakdown: null,
    ...overrides,
  };
}

describe('MoodBookingChangeModal 기존 확정 예약 예외', () => {
  it('정책 종료 다음 날부터 고정 공지를 자동으로 숨긴다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T09:00:00+09:00'));
    try {
      const view = render(<MoodBookingChangeModal booking={booking({ date: '2026-09-16', startTime: '10:00' })} balanceKRW={1_000_000} onClose={() => {}} onChanged={() => {}} />);
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('기존 제한 슬롯을 그대로 두면 주소·메모 변경을 허용하고 시각을 더 늦추면 차단한다', () => {
    render(<MoodBookingChangeModal booking={booking()} balanceKRW={1_000_000} onClose={() => {}} onChanged={() => {}} />);

    expect(screen.getByText(/기존 확정 예약의 날짜·시각을 유지해/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경 내용과 차액 확인 후 저장' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '18:01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('오후 6시 이후 시작 예약으로 변경할 수 없습니다');
    expect(screen.getByRole('button', { name: '오후 6시 이후 변경 불가' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '17:59' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경 내용과 차액 확인 후 저장' })).toBeEnabled();
  });

  it('기존 일반 예약을 다른 제한 슬롯으로 옮기면 저장을 차단한다', () => {
    render(<MoodBookingChangeModal booking={booking({ date: '2026-09-09', startTime: '10:00' })} balanceKRW={1_000_000} onClose={() => {}} onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '18:00' } });

    expect(screen.getByRole('button', { name: '오후 6시 이후 변경 불가' })).toBeDisabled();
  });
});
