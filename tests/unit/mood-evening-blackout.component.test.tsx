// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
const portalRole = vi.hoisted(() => ({
  isAdmin: false,
  operatorUser: { email: 'operator@mood.test' },
  staffUser: { email: 'staff@mood.test' },
}));
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: portalRole.isAdmin ? portalRole.operatorUser : portalRole.staffUser, loading: false }),
}));
vi.mock('@/lib/firebase', () => ({ signInWithGoogle: vi.fn() }));
vi.mock('@/lib/appReady', () => ({ signalAppReady: vi.fn() }));
vi.mock('@/components/MoodRouteMap', () => ({ MoodRouteMap: () => <div data-testid="mood-route-map" /> }));
vi.mock('@/components/PwaInstallButton', () => ({ PwaInstallButton: () => null }));
vi.mock('@/components/charter/AddressAutocomplete', () => ({
  AddressAutocomplete: ({ label, onChange }: {
    label: string;
    onChange: (value: { name: string; address: string; lat: number; lng: number; category: string }) => void;
  }) => (
    <button
      type="button"
      aria-label={`${label} 테스트 주소 선택`}
      onClick={() => onChange({
        name: `${label} 테스트 장소`,
        address: `서울 ${label} 테스트 주소`,
        lat: 37.5,
        lng: 127,
        category: '테스트',
      })}
    >
      {label} 테스트 주소 선택
    </button>
  ),
}));
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

let parsePayload = parseResponse;
let routeShouldFail = false;
const bookingAvailability = {
  schemaVersion: 1,
  revision: 3,
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
  portalRole.isAdmin = false;
  parsePayload = parseResponse;
  routeShouldFail = false;
  authFetchMock.mockReset();
  authFetchMock.mockImplementation(async (url: string) => {
    const target = String(url);
    if (target.includes('/api/mood-data')) {
      return response({
        ok: true,
        data: { clientId: 'mood', client: { name: 'MOOD', balanceKRW: 1_000_000 }, bookings: [], isAdmin: portalRole.isAdmin, bookingAvailability },
      });
    }
    if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
    if (target.includes('/api/mood-parse-schedule')) return response(parsePayload);
    if (target.includes('/api/mood-route')) {
      if (routeShouldFail) return response({ ok: false, error: '주소를 찾을 수 없음' }, 422);
      return response({ ok: true, data: { km: 10, tollKRW: 0, durationMin: 30, path: [], points: [] } });
    }
    if (target.includes('/api/mood-book')) {
      return response({ ok: true, data: { amountKRW: 120_000, balanceKRW: 880_000 } });
    }
    if (target.includes('/api/mood-change')) return response({ ok: true });
    return response({}, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MoodPortal 임시 저녁 제한 UI', () => {
  beforeEach(() => {
    // 임시 운영 정책을 검증하는 테스트이므로 실제 실행 날짜가 바뀌어도
    // 달력의 기본 선택일과 기대 결과가 흔들리지 않게 Date만 고정한다.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-29T09:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('포커스 재조회에서 설정 누락 오류를 받으면 이전 정상 상태를 버리고 즉시 예약을 잠근다', async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/api/mood-data')) {
        return response({
          ok: true,
          data: { clientId: 'mood', client: { name: 'MOOD', balanceKRW: 1_000_000 }, bookings: [], isAdmin: false, bookingAvailability },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
      if (target.includes('/api/mood-booking-blocks')) {
        return response({ ok: false, error: 'INVALID_BOOKING_AVAILABILITY_CONFIG', detail: 'MISSING_BOOKING_AVAILABILITY_CONFIG' }, 409);
      }
      return response({}, 404);
    });

    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    window.dispatchEvent(new Event('focus'));

    expect(await screen.findByRole('alert', { name: '예약 차단 설정 오류' })).toHaveTextContent('예약 접수 일시 잠금');
    expect(screen.queryByRole('note', { name: '예약 제한 안내' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '선택 날짜 예약 상태' })).toHaveTextContent('예약 차단 설정 확인 필요');
    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));
    expect(screen.getByRole('button', { name: '예약 차단 설정 확인 필요' })).toBeDisabled();
  });

  it('운영 메모를 예약 차단과 구분하고 메모만 있는 날짜는 예약 가능으로 표시한다', async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/api/mood-data')) {
        return response({
          ok: true,
          data: {
            clientId: 'mood',
            client: { name: 'MOOD', balanceKRW: 1_000_000 },
            bookings: [],
            isAdmin: false,
            bookingAvailability: { schemaVersion: 1, revision: 4, rules: [], exceptions: [] },
          },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: { '2026-08-29': '차량 점검 예정' } });
      return response({}, 404);
    });

    render(<MoodPortal />);
    expect(await screen.findByLabelText('운영 메모 있음, 예약 차단 아님: 차량 점검 예정')).toBeInTheDocument();
    expect(screen.getByText('📝 2026-08-29 운영 메모 · 예약 차단 아님')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '선택 날짜 예약 상태' })).toHaveTextContent('예약 가능');
  });

  it('같은 날짜에 운영 메모와 실제 차단이 함께 있어도 차단 배지와 예약 불가 상태를 유지한다', async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/api/mood-data')) {
        return response({
          ok: true,
          data: { clientId: 'mood', client: { name: 'MOOD', balanceKRW: 1_000_000 }, bookings: [], isAdmin: false, bookingAvailability },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: { '2026-08-29': '차량 점검 예정' } });
      return response({}, 404);
    });

    render(<MoodPortal />);
    expect(await screen.findByLabelText('운영 메모 있음, 예약 차단 아님: 차량 점검 예정')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026-08-29 · 오후 6시 이후 시작 예약 불가' })).toHaveTextContent('18시+');
    expect(screen.getByRole('status', { name: '선택 날짜 예약 상태' })).toHaveTextContent('오후 6시 이후 시작 예약 불가');
  });

  it('고정 공지, 캘린더 표시·선택 설명, 수기 예약 즉시 차단을 함께 보여 준다', async () => {
    render(<MoodPortal />);

    const notice = await screen.findByRole('note', { name: '예약 제한 안내' });
    expect(notice).toHaveTextContent('8월 15일~9월 15일 목·금·토 · 오후 6시 이후 시작 예약 불가');
    expect(notice).toHaveTextContent('이미 확정된 예약은 그대로 유효합니다');
    expect(notice).toHaveTextContent('관리자가 따로 연 날짜는 캘린더의 예약 가능 표시가 우선합니다');

    const limitedDay = screen.getByRole('button', { name: '2026-08-15 · 오후 6시 이후 시작 예약 불가' });
    expect(limitedDay).toHaveTextContent('18시+');
    fireEvent.click(limitedDay);
    expect(screen.getByRole('status')).toHaveTextContent('2026-08-15 · 오후 6시 이후 시작 예약 불가');

    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));
    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-08-15' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '18:00' } });

    expect(screen.getByRole('alert')).toHaveTextContent('예약 운영 일정 때문에 2026-08-15 18:00 시작 예약을 할 수 없습니다');
    expect(screen.getByRole('button', { name: '선택 시각 예약 불가' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '17:59' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '예약하기' })).toBeEnabled();
  });

  it('사진 속 9월 2일·5일 시작 시각은 예약 가능하고 5일의 종료 시각 기준 오해를 풀어 준다', async () => {
    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));

    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-09-02' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '14:00' } });
    expect(screen.getByRole('button', { name: '예약하기' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '14:20' } });
    expect(screen.getByRole('button', { name: '예약하기' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('시간 제한 통과');
    expect(screen.getByRole('status')).toHaveTextContent('주소·동선 확인 후 예약해 주세요');
  });

  it('수기 예약이 주소 때문에 막히면 날짜 대신 정확한 해결 방법을 버튼에 표시한다', async () => {
    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));

    fireEvent.click(screen.getByRole('button', { name: '출발지 테스트 주소 선택' }));
    expect(screen.getByRole('button', { name: '출발지·도착지를 모두 입력해 주세요' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '도착지 테스트 주소 선택' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '예약하기' })).toBeEnabled());
  });

  it('주소 경로를 계산하지 못하면 해결 문구를 표시하고 예약 요청을 보내지 않는다', async () => {
    routeShouldFail = true;
    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));

    fireEvent.click(screen.getByRole('button', { name: '출발지 테스트 주소 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '도착지 테스트 주소 선택' }));

    const blockedButton = await screen.findByRole('button', { name: '주소 확인 후 예약 가능' });
    expect(blockedButton).toBeDisabled();
    expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-book'))).toBe(false);
  });

  it('전체 차단 해제 성공 응답을 즉시 반영하고 서버 정본을 다시 확인한다', async () => {
    portalRole.isAdmin = true;
    let moodDataCalls = 0;
    let availabilityGetCalls = 0;
    authFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/api/mood-data')) {
        moodDataCalls += 1;
        return response({
          ok: true,
          data: { clientId: 'mood', client: { name: 'MOOD', balanceKRW: 1_000_000 }, bookings: [], isAdmin: true, canApproveSettlement: false, bookingAvailability },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
      if (target.includes('/api/mood-booking-blocks')) {
        if (!init?.method || init.method === 'GET') {
          availabilityGetCalls += 1;
          return response({
            ok: true,
            data: {
              bookingAvailability: {
                ...bookingAvailability,
                revision: 4,
                rules: bookingAvailability.rules.map((rule) => ({ ...rule, enabled: false })),
                exceptions: [],
              },
            },
          });
        }
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body).toMatchObject({ action: 'set_all_enabled', enabled: false, expectedRevision: 3 });
        return response({
          ok: true,
          data: {
            bookingAvailability: {
              ...bookingAvailability,
              revision: 4,
              rules: bookingAvailability.rules.map((rule) => ({ ...rule, enabled: false })),
              exceptions: [],
            },
          },
        });
      }
      return response({}, 404);
    });

    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: '모든 차단 해제' }));
    fireEvent.click(screen.getByRole('button', { name: '모든 차단 해제 확인' }));

    expect(await screen.findByText('캘린더 반영 완료')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('note', { name: '예약 제한 안내' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '2026-08-28' })).not.toHaveTextContent('18시+');
    expect(screen.getByRole('status', { name: '선택 날짜 예약 상태' })).toHaveTextContent('예약 가능');
    expect(moodDataCalls).toBe(1);
    expect(availabilityGetCalls).toBe(1);
  });

  it('기간 열기 성공 직후 차단 배지와 예약 버튼을 열고 서버 정본까지 다시 확인한다', async () => {
    portalRole.isAdmin = true;
    let availabilityGetCalls = 0;
    const openedAvailability = {
      ...bookingAvailability,
      revision: 4,
      exceptions: [{
        id: 'open-september-range',
        enabled: true,
        startDate: '2026-09-03',
        endDate: '2026-09-05',
        ruleIds: [bookingAvailability.rules[0].id],
        reason: '촬영 예약 운영',
      }],
    };
    authFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/api/mood-data')) {
        return response({
          ok: true,
          data: { clientId: 'mood', client: { name: 'MOOD', balanceKRW: 1_000_000 }, bookings: [], isAdmin: true, bookingAvailability },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
      if (target.includes('/api/mood-booking-blocks')) {
        if (!init?.method || init.method === 'GET') {
          availabilityGetCalls += 1;
          return response({ ok: true, data: { bookingAvailability: openedAvailability } });
        }
        const body = JSON.parse(String(init.body || '{}'));
        expect(body).toMatchObject({
          action: 'upsert_exception',
          expectedRevision: 3,
          exception: { startDate: '2026-09-03', endDate: '2026-09-05' },
        });
        return response({ ok: true, data: { bookingAvailability: openedAvailability } });
      }
      return response({}, 404);
    });

    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.getByRole('button', { name: '2026-09-04 · 오후 6시 이후 시작 예약 불가' })).toHaveTextContent('18시+');
    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: '+ 날짜 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '기간' }));
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-09-03' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('여는 사유'), { target: { value: '촬영 예약 운영' } });
    fireEvent.click(screen.getByRole('button', { name: '이 날짜 열기' }));

    expect(await screen.findByText('캘린더 반영 완료')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026-09-04' })).not.toHaveTextContent('18시+');
    fireEvent.click(screen.getByRole('button', { name: '2026-09-04' }));
    expect(screen.getByRole('status', { name: '선택 날짜 예약 상태' })).toHaveTextContent('예약 가능');
    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));
    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-09-04' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '18:00' } });
    expect(screen.getByRole('button', { name: '예약하기' })).toBeEnabled();
    expect(availabilityGetCalls).toBe(1);
  });

  it('성공 개정보다 늦은 조회 응답은 덮어쓰지 않고 다른 탭 알림·포커스 조회를 중복 없이 처리한다', async () => {
    portalRole.isAdmin = true;
    const channels: Array<{ onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
    class MockBroadcastChannel {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      postMessage = vi.fn();
      close = vi.fn();
      constructor(name: string) { void name; channels.push(this); }
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    let moodDataCalls = 0;
    let availabilityGetCalls = 0;
    authFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/api/mood-data')) {
        moodDataCalls += 1;
        const revision = moodDataCalls === 1 ? 3 : 4;
        return response({
          ok: true,
          data: {
            clientId: 'mood',
            client: { name: 'MOOD', balanceKRW: 1_000_000 },
            bookings: [],
            isAdmin: true,
            canApproveSettlement: false,
            bookingAvailability: { ...bookingAvailability, revision, exceptions: [] },
          },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
      if (target.includes('/api/mood-booking-blocks')) {
        if (!init?.method || init.method === 'GET') {
          availabilityGetCalls += 1;
          return response({ ok: true, data: { bookingAvailability: { ...bookingAvailability, revision: 4, exceptions: [] } } });
        }
        JSON.parse(String(init?.body || '{}'));
        return response({
          ok: true,
          data: {
            bookingAvailability: {
              ...bookingAvailability,
              revision: 5,
              rules: bookingAvailability.rules.map((rule) => ({ ...rule, enabled: false })),
              exceptions: [],
            },
          },
        });
      }
      return response({}, 404);
    });

    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    fireEvent.click(screen.getByText('예약 차단 관리'));
    fireEvent.click(screen.getByRole('button', { name: '모든 차단 해제' }));
    fireEvent.click(screen.getByRole('button', { name: '모든 차단 해제 확인' }));
    await screen.findByText('캘린더 반영 완료');
    expect(channels).toHaveLength(1);
    expect(channels[0].postMessage).toHaveBeenCalledWith({ type: 'booking-availability-updated', revision: 5 });

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(availabilityGetCalls).toBe(2));
    expect(moodDataCalls).toBe(1);
    expect(screen.queryByRole('note', { name: '예약 제한 안내' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '선택 날짜 예약 상태' })).toHaveTextContent('예약 가능');
  });

  it('포커스 차단설정 조회 중에도 예약 완료 뒤 목록·잔액 mood-data 조회를 삼키지 않는다', async () => {
    let moodDataCalls = 0;
    let resolveAvailabilityGet: ((value: ReturnType<typeof response>) => void) | null = null;
    const availabilityGet = new Promise<ReturnType<typeof response>>((resolve) => { resolveAvailabilityGet = resolve; });
    authFetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/api/mood-booking-blocks')) return availabilityGet;
      if (target.includes('/api/mood-data')) {
        moodDataCalls += 1;
        return response({
          ok: true,
          data: {
            clientId: 'mood',
            client: { name: 'MOOD', balanceKRW: moodDataCalls === 1 ? 1_000_000 : 880_000 },
            bookings: [],
            isAdmin: false,
            canApproveSettlement: false,
            bookingAvailability,
          },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
      if (target.includes('/api/mood-book')) return response({ ok: true, data: { amountKRW: 120_000, balanceKRW: 880_000 } });
      return response({}, 404);
    });

    render(<MoodPortal />);
    await screen.findByRole('note', { name: '예약 제한 안내' });
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-booking-blocks'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: '수기 예약' }));
    fireEvent.click(screen.getByRole('button', { name: '예약하기' }));
    await waitFor(() => expect(moodDataCalls).toBe(2));
    expect(await screen.findByText('예약 완료 — 120,000원 차감, 잔액 880,000원')).toBeInTheDocument();

    resolveAvailabilityGet?.(response({ ok: true, data: { bookingAvailability } }));
  });

  it('초기 mood-data가 늦어도 먼저 받은 더 높은 차단설정 개정을 보존한다', async () => {
    let resolveMoodData: ((value: ReturnType<typeof response>) => void) | null = null;
    const moodDataResponse = new Promise<ReturnType<typeof response>>((resolve) => { resolveMoodData = resolve; });
    let availabilityGetCalls = 0;
    authFetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/api/mood-data')) return moodDataResponse;
      if (target.includes('/api/mood-booking-blocks')) {
        availabilityGetCalls += 1;
        return response({
          ok: true,
          data: {
            bookingAvailability: {
              ...bookingAvailability,
              revision: 5,
              rules: bookingAvailability.rules.map((rule) => ({ ...rule, enabled: false })),
              exceptions: [],
            },
          },
        });
      }
      if (target.includes('/api/mood-notes')) return response({ ok: true, notes: {} });
      return response({}, 404);
    });

    render(<MoodPortal />);
    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-data'))).toBe(true));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(availabilityGetCalls).toBe(1));

    resolveMoodData?.(response({
      ok: true,
      data: {
        clientId: 'mood',
        client: { name: 'MOOD', balanceKRW: 1_000_000 },
        bookings: [],
        isAdmin: false,
        canApproveSettlement: false,
        bookingAvailability: { ...bookingAvailability, revision: 4, exceptions: [] },
      },
    }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: '선택 날짜 예약 상태' })).toHaveTextContent('예약 가능');
    });
    expect(screen.queryByRole('note', { name: '예약 제한 안내' })).not.toBeInTheDocument();
  });
});

describe('MoodAiBooking 임시 저녁 제한 UI', () => {
  it('사진 속 9월 5일 14시 20분 일정은 AI 분석 뒤 예약 버튼까지 활성화한다', async () => {
    parsePayload = {
      ...parseResponse,
      dates: ['2026-09-05'],
      stops: [
        { order: 1, label: '촬영지', address: '서울 촬영지', lat: 37.51, lng: 127.02, action: 'pickup', matchedFromPlacebook: true, geocodeOk: true, date: '2026-09-05', timeHint: '14:20' },
        { order: 2, label: '행사장', address: '서울 행사장', lat: 37.52, lng: 127.03, action: 'arrive', matchedFromPlacebook: true, geocodeOk: true, date: '2026-09-05', timeHint: '15:00' },
        { order: 3, label: '종료지', address: '서울 종료지', lat: 37.53, lng: 127.04, action: 'dropoff', matchedFromPlacebook: true, geocodeOk: true, date: '2026-09-05', timeHint: '20:30' },
      ],
    };

    render(<MoodAiBooking clientId="mood" bookingAvailability={bookingAvailability} onBooked={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/MOOD 일정/), { target: { value: '9월 5일 14시 20분 출발, 20시 30분 종료' } });
    fireEvent.click(screen.getByRole('button', { name: /일정 분석/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('시간 제한 통과');
    expect(screen.getByRole('button', { name: '이대로 예약' })).toBeEnabled();
    expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-book'))).toBe(false);
  });

  it('AI가 제한 시각을 채우면 즉시 경고하고, 17:59로 고치기 전에는 요청하지 않는다', async () => {
    render(<MoodAiBooking clientId="mood" bookingAvailability={bookingAvailability} onBooked={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/MOOD 일정/), { target: { value: '9월 10일 18시 서울역 출발, 성수동 도착' } });
    fireEvent.click(screen.getByRole('button', { name: /일정 분석/ }));

    const blockedButton = await screen.findByRole('button', { name: '선택 시각 예약 불가' });
    expect(blockedButton).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('예약 운영 일정 때문에 2026-09-10 18:00 시작 예약을 할 수 없습니다');
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
      const view = render(<MoodBookingChangeModal booking={booking({ date: '2026-09-16', startTime: '10:00' })} balanceKRW={1_000_000} isAdmin bookingAvailability={bookingAvailability} onClose={() => {}} onChanged={() => {}} />);
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('기존 제한 슬롯을 그대로 두면 주소·메모 변경을 허용하고 시각을 더 늦추면 차단한다', () => {
    render(<MoodBookingChangeModal booking={booking()} balanceKRW={1_000_000} isAdmin bookingAvailability={bookingAvailability} onClose={() => {}} onChanged={() => {}} />);

    expect(screen.getByText(/기존 확정 예약의 날짜·시각을 유지해/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('1. 출발지'), { target: { value: '서울역' } });
    fireEvent.change(screen.getByLabelText('2. 도착지'), { target: { value: '서울시청' } });
    fireEvent.change(screen.getByLabelText('예약 메모'), { target: { value: '기존 시간 유지' } });
    fireEvent.change(screen.getByLabelText(/변경 이유/), { target: { value: '촬영 동선 변경' } });
    expect(screen.getByRole('button', { name: '변경 내용과 금액 미리보기' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '18:01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('예약 운영 일정 때문에 2026-09-10 18:01 시작으로 변경할 수 없습니다');
    expect(screen.getByRole('button', { name: '선택 시각으로 변경 불가' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '17:59' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경 내용과 금액 미리보기' })).toBeEnabled();
  });

  it('기존 일반 예약을 다른 제한 슬롯으로 옮기면 저장을 차단한다', () => {
    render(<MoodBookingChangeModal booking={booking({ date: '2026-09-09', startTime: '10:00' })} balanceKRW={1_000_000} isAdmin bookingAvailability={bookingAvailability} onClose={() => {}} onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '18:00' } });

    expect(screen.getByRole('button', { name: '선택 시각으로 변경 불가' })).toBeDisabled();
  });
});
