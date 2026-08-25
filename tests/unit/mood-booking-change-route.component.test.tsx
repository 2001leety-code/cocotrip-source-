// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DragEndLike = {
  active: { id: string };
  over: { id: string } | null;
};

let capturedDragEnd: ((event: DragEndLike) => void) | null = null;
const authFetchMock = vi.fn();
const openDaumPostcodeMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (event: DragEndLike) => void }) => {
    capturedDragEnd = onDragEnd;
    return children;
  },
  KeyboardSensor: class KeyboardSensor {},
  MouseSensor: class MouseSensor {},
  TouchSensor: class TouchSensor {},
  useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
  useSensors: (...sensors: unknown[]) => sensors,
}));

vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: <T,>(items: T[], fromIndex: number, toIndex: number) => {
    const next = items.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  },
  SortableContext: ({ children }: { children: ReactNode }) => children,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: { 'aria-describedby': 'DndDescribedBy-test' },
    listeners: {},
    setActivatorNodeRef: vi.fn(),
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));
vi.mock('@/lib/daumPostcode', () => ({ openDaumPostcode: (...args: unknown[]) => openDaumPostcodeMock(...args) }));
vi.mock('@/components/MoodRouteMap', () => ({
  MoodRouteMap: ({
    origin,
    destination,
    waypoints,
    route,
  }: {
    origin: string;
    destination: string;
    waypoints: string[];
    route: { km: number } | null;
  }) => (
    <div
      data-testid="mood-route-map"
      data-order={[origin, ...waypoints, destination].join(' → ')}
      data-km={route ? String(route.km) : ''}
    />
  ),
}));
vi.mock('@/components/mood/MoodCourseShareEditor', () => ({
  MoodCourseShareEditor: ({
    items,
    percentages,
    onChange,
  }: {
    items: Array<{ address: string; percentageIndex: number }>;
    percentages: number[];
    onChange: (next: number[]) => void;
  }) => (
    <div>
      <output data-testid="course-share-values">
        {JSON.stringify({
          addresses: items.map((item) => item.address),
          percentages: items.map((item) => percentages[item.percentageIndex]),
        })}
      </output>
      <button
        type="button"
        onClick={() => {
          const next = percentages.slice();
          next[1] = 25;
          onChange(next);
        }}
      >
        테스트 부담률 수정
      </button>
    </div>
  ),
}));

import { MoodBookingChangeModal, type ChangeableMoodBooking } from '../../src/components/mood/MoodBookingChangeModal';

function jsonResponse(json: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  };
}

function routeResponse(km: number, tollKRW: number) {
  return jsonResponse({
    ok: true,
    data: { km, tollKRW, durationMin: km + 20, path: [], points: [] },
  });
}

function booking(overrides: Partial<ChangeableMoodBooking> = {}): ChangeableMoodBooking {
  return {
    id: 'booking-route-order',
    date: '2026-10-01',
    startTime: '10:00',
    durationHours: 4,
    serviceType: 'vehicle',
    amountKRW: 120_000,
    revision: 3,
    influencerName: '테스트 인플루언서',
    courseMoodPercentages: [100, 50, 0, 33],
    routeSchedule: [
      { arrivalTime: null, pickupTime: '10:00' },
      { arrivalTime: '10:30', pickupTime: '12:30' },
      { arrivalTime: '13:00', pickupTime: '14:00' },
      { arrivalTime: '14:30', pickupTime: null },
    ],
    breakdown: {
      origin: '서울역',
      waypoints: ['성수동', '잠실'],
      destination: '서울시청',
    },
    ...overrides,
  };
}

function routeRows() {
  return screen.getAllByTestId('mood-route-stop');
}

function rowAddresses() {
  return routeRows().map((row) => (within(row).getByRole('textbox') as HTMLInputElement).value);
}

function rowId(row: HTMLElement) {
  return String(row.getAttribute('data-route-stop-id') || '');
}

function drag(activeId: string, overId: string) {
  if (!capturedDragEnd) throw new Error('DndContext onDragEnd가 연결되지 않았습니다.');
  act(() => capturedDragEnd?.({ active: { id: activeId }, over: { id: overId } }));
}

async function finishRouteDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(550);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function routeCalls() {
  return authFetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/mood-route'));
}

beforeEach(() => {
  vi.useFakeTimers();
  capturedDragEnd = null;
  authFetchMock.mockReset();
  openDaumPostcodeMock.mockReset();
  openDaumPostcodeMock.mockResolvedValue(null);
  clipboardWriteTextMock.mockReset();
  clipboardWriteTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
  authFetchMock.mockImplementation(async (url: string) => {
    const target = String(url);
    if (target.includes('/api/mood-route')) {
      const parsed = new URL(target, 'https://unit.test');
      const reordered = parsed.searchParams.get('waypoints') === '잠실|성수동';
      return reordered ? routeResponse(71, 9_000) : routeResponse(64, 8_000);
    }
    if (target.includes('/api/mood-change')) return jsonResponse({ ok: true, data: { revision: 4 } });
    return jsonResponse({}, 404);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MoodBookingChangeModal 경로 순서 편집', () => {
  it('9시간을 지운 뒤 6시간을 입력하면 16이 아니라 6으로 저장한다', async () => {
    render(
      <MoodBookingChangeModal
        booking={booking({ durationHours: 9, amountKRW: 270_000 })}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    const durationInput = screen.getByLabelText('이용 시간') as HTMLInputElement;
    expect(durationInput.value).toBe('9');

    fireEvent.change(durationInput, { target: { value: '' } });
    expect(durationInput.value).toBe('');

    fireEvent.change(durationInput, { target: { value: '6' } });
    expect(durationInput.value).toBe('6');

    await finishRouteDebounce();
    fireEvent.change(screen.getByLabelText(/변경 이유/), { target: { value: '총 예약시간 변경' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '변경 내용과 차액 확인 후 저장' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const changeCall = authFetchMock.mock.calls.find((call) => String(call[0]).includes('/api/mood-change'));
    expect(changeCall).toBeTruthy();
    const submitted = JSON.parse(String((changeCall?.[1] as RequestInit).body || '{}'));
    expect(submitted.booking.durationHours).toBe(6);
  });

  it('이용 시간을 비운 채 포커스를 옮기면 마지막 안전값을 복원한다', () => {
    render(
      <MoodBookingChangeModal
        booking={booking({ durationHours: 9, amountKRW: 270_000 })}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    const durationInput = screen.getByLabelText('이용 시간') as HTMLInputElement;
    fireEvent.change(durationInput, { target: { value: '' } });
    expect(durationInput.value).toBe('');
    fireEvent.blur(durationInput);
    expect(durationInput.value).toBe('9');
  });

  it('출발→경유→도착으로 표시하고 순서 변경 시 주소·0% 부담률·저장값을 함께 옮긴다', async () => {
    const onClose = vi.fn();
    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={onClose}
        onChanged={() => undefined}
      />,
    );

    expect(rowAddresses()).toEqual(['서울역', '성수동', '잠실', '서울시청']);
    expect(within(routeRows()[0]).getByText('1. 출발지')).toBeInTheDocument();
    expect(within(routeRows()[1]).getByText('2. 경유지 1')).toBeInTheDocument();
    expect(within(routeRows()[3]).getByText('4. 도착지')).toBeInTheDocument();
    const handles = screen.getAllByRole('button', { name: /순서 이동/ });
    expect(handles).toHaveLength(4);
    handles.forEach((handle) => {
      expect(handle.className).toContain('h-11');
      expect(handle.className).toContain('w-11');
      expect(handle).toHaveAttribute('aria-describedby', 'DndDescribedBy-test mood-route-reorder-help');
    });

    await finishRouteDebounce();
    expect(screen.getByText(/동선 64km/)).toBeInTheDocument();
    expect(screen.getByTestId('course-share-values')).toHaveTextContent('"percentages":[100,50,0,33]');

    const beforeMoveRows = routeRows();
    drag(rowId(beforeMoveRows[2]), rowId(beforeMoveRows[1]));

    expect(rowAddresses()).toEqual(['서울역', '잠실', '성수동', '서울시청']);
    expect(within(routeRows()[1]).getByText('2. 경유지 1')).toBeInTheDocument();
    expect(within(routeRows()[2]).getByText('3. 경유지 2')).toBeInTheDocument();
    expect(screen.getByText('계산 중…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '동선 계산을 기다려 주세요' })).toBeDisabled();
    expect(screen.queryByText(/동선 64km/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-share-values')).not.toBeInTheDocument();

    await finishRouteDebounce();
    const latestRouteUrl = String(routeCalls().at(-1)?.[0] || '');
    expect(new URL(latestRouteUrl, 'https://unit.test').searchParams.get('waypoints')).toBe('잠실|성수동');
    expect(screen.getByText(/동선 71km/)).toBeInTheDocument();
    expect(screen.getByTestId('course-share-values')).toHaveTextContent('"addresses":["서울역","잠실","성수동","서울시청"]');
    expect(screen.getByTestId('course-share-values')).toHaveTextContent('"percentages":[100,0,50,33]');
    expect(within(routeRows()[2]).getByText('도착 10:30 · 재출발 12:30 · 대기 2시간')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/변경 이유/), { target: { value: '촬영 순서 변경' } });
    fireEvent.click(screen.getByRole('button', { name: '변경 내용과 차액 확인 후 저장' }));
    expect(screen.getByText('전체 일정은 첫 출발부터 마지막 시각까지 15시간 이내여야 합니다.')).toBeInTheDocument();
    expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-change'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '3번 경유지 2 시간 편집' }));
    fireEvent.change(screen.getByLabelText('도착 시각'), { target: { value: '14:10' } });
    fireEvent.change(screen.getByLabelText('재출발(픽업) 시각'), { target: { value: '14:20' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '변경 내용과 차액 확인 후 저장' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const changeCall = authFetchMock.mock.calls.find((call) => String(call[0]).includes('/api/mood-change'));
    expect(changeCall).toBeTruthy();
    const submitted = JSON.parse(String((changeCall?.[1] as RequestInit).body || '{}'));
    expect(submitted.booking).toMatchObject({
      origin: '서울역',
      waypoints: ['잠실', '성수동'],
      destination: '서울시청',
      courseMoodPercentages: [100, 0, 50, 33],
      routeSchedule: [
        { arrivalTime: null, pickupTime: '10:00' },
        { arrivalTime: '13:00', pickupTime: '14:00' },
        { arrivalTime: '14:10', pickupTime: '14:20' },
        { arrivalTime: '14:30', pickupTime: null },
      ],
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('새 장소는 도착지 앞에 넣고 삭제·되돌리기에서 원래 위치와 0%를 보존하며 2~7곳을 지킨다', async () => {
    render(
      <MoodBookingChangeModal
        booking={booking({
          courseMoodPercentages: [100, 0, 33],
          breakdown: { origin: '서울역', waypoints: ['성수동'], destination: '서울시청' },
        })}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    const deleteButton = screen.getByRole('button', { name: '2번 경유지 1 삭제' });
    deleteButton.focus();
    fireEvent.click(deleteButton);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rowAddresses()).toEqual(['서울역', '서울시청']);
    expect(within(routeRows()[1]).getByRole('button', { name: /순서 이동/ })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /번 .* 삭제/ })).not.toBeInTheDocument();
    expect(screen.getByText('성수동 삭제됨')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(rowAddresses()).toEqual(['서울역', '성수동', '서울시청']);
    await finishRouteDebounce();
    expect(screen.getByTestId('course-share-values')).toHaveTextContent('"percentages":[100,0,33]');

    fireEvent.click(screen.getByRole('button', { name: '2번 경유지 1 다음에 경유지 추가' }));
    expect(rowAddresses()).toEqual(['서울역', '성수동', '', '서울시청']);
    expect(within(routeRows()[2]).getByText('3. 경유지 2')).toBeInTheDocument();
    expect(within(routeRows()[3]).getByText('4. 도착지')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '빈 장소를 확인해 주세요' })).toBeDisabled();

    for (let index = 0; index < 3; index += 1) {
      const addButtons = screen.getAllByRole('button', { name: /다음에 경유지 추가/ });
      fireEvent.click(addButtons[addButtons.length - 1]);
    }
    expect(routeRows()).toHaveLength(7);
    expect(rowAddresses().at(-1)).toBe('서울시청');
    expect(screen.queryByRole('button', { name: /다음에 경유지 추가/ })).not.toBeInTheDocument();
    expect(screen.getByText('장소는 최대 7곳까지 추가할 수 있습니다.')).toBeInTheDocument();
  });

  it('출발지나 도착지를 삭제했다 되돌려도 임시 끝점이 된 장소의 도착·재출발 시각을 완전히 복원한다', async () => {
    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1번 출발지 삭제' }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rowAddresses()).toEqual(['성수동', '잠실', '서울시청']);
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(rowAddresses()).toEqual(['서울역', '성수동', '잠실', '서울시청']);
    expect(screen.getByText('도착 10:30 · 재출발 12:30 · 대기 2시간')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '4번 도착지 삭제' }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rowAddresses()).toEqual(['서울역', '성수동', '잠실']);
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(rowAddresses()).toEqual(['서울역', '성수동', '잠실', '서울시청']);
    expect(screen.getByText('도착 13:00 · 재출발 14:00 · 대기 1시간')).toBeInTheDocument();
  });

  it('부담률만 바꾸면 경로 API를 다시 부르지 않는다', async () => {
    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );
    await finishRouteDebounce();
    expect(routeCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '테스트 부담률 수정' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(routeCalls()).toHaveLength(1);
    expect(screen.getByTestId('course-share-values')).toHaveTextContent('"percentages":[100,25,0,33]');
    expect(screen.getByText(/동선 64km/)).toBeInTheDocument();
  });

  it('시간은 한 카드만 펼쳐 편집하고 대기 빠른 입력·시작 시각 동기·전체 일정 복사를 지원한다', async () => {
    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    expect(screen.queryByLabelText('도착 시각')).not.toBeInTheDocument();
    expect(screen.getByText('도착 10:30 · 재출발 12:30 · 대기 2시간')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2번 경유지 1 시간 편집' }));
    const arrivalInput = screen.getByLabelText('도착 시각') as HTMLInputElement;
    const pickupInput = screen.getByLabelText('재출발(픽업) 시각') as HTMLInputElement;
    expect(arrivalInput.value).toBe('10:30');
    expect(pickupInput.value).toBe('12:30');
    expect(screen.getByText('대기 2시간')).toBeInTheDocument();

    fireEvent.change(arrivalInput, { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('button', { name: '1시간' }));
    expect((screen.getByLabelText('재출발(픽업) 시각') as HTMLInputElement).value).toBe('12:00');
    expect((screen.getByLabelText('이용 시간') as HTMLInputElement).value).toBe('4');

    fireEvent.click(screen.getByRole('button', { name: '1번 출발지 시간 편집' }));
    expect(screen.queryByLabelText('도착 시각')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('출발 시각'), { target: { value: '09:00' } });
    expect((screen.getByLabelText('시작 시각') as HTMLInputElement).value).toBe('09:00');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '전체 일정 복사' }));
      await Promise.resolve();
    });
    expect(clipboardWriteTextMock).toHaveBeenCalledTimes(1);
    const copied = String(clipboardWriteTextMock.mock.calls[0][0]);
    expect(copied).toContain('[2026년 10월 1일 차량 전체 일정]');
    expect(copied).toContain('1. 서울역 → 성수동');
    expect(copied).toContain('출발 09:00 / 도착 11:00');
    expect(copied).toContain('대기 1시간');
    expect(copied).toContain('재출발(픽업) 12:00');
  });

  it('전체 일정 복사 형식은 서버 호출 없이 미리보기 후 화면에만 적용한다', () => {
    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    const pasted = [
      '[2026년 10월 2일 차량 일정]',
      '',
      '1. 서울역 1번 출구 → 서울 종로구 평창길 133',
      '출발 09:00 / 도착 10:00',
      '대기 2시간',
      '재출발(픽업) 12:00',
      '',
      '2. 서울 종로구 평창길 133 → 잠실종합운동장',
      '출발 12:00 / 도착 13:00',
    ].join('\n');

    fireEvent.click(screen.getByRole('button', { name: '전체 일정 붙여넣기' }));
    fireEvent.change(screen.getByLabelText('카카오톡 전체 일정'), { target: { value: pasted } });
    fireEvent.click(screen.getByRole('button', { name: '미리보기 만들기' }));

    expect(screen.getByText('적용 전 미리보기')).toBeInTheDocument();
    expect(screen.getByText('복사 형식')).toBeInTheDocument();
    expect(screen.getAllByText(/서울역 1번 출구 → 서울 종로구 평창길 133/)).toHaveLength(2);
    expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-parse-schedule'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '이 일정 화면에 적용' }));
    expect(rowAddresses()).toEqual(['서울역 1번 출구', '서울 종로구 평창길 133', '잠실종합운동장']);
    expect(screen.getByText('도착 10:00 · 재출발 12:00 · 대기 2시간')).toBeInTheDocument();
    expect((screen.getByLabelText('날짜') as HTMLInputElement).value).toBe('2026-10-02');
    expect((screen.getByLabelText('시작 시각') as HTMLInputElement).value).toBe('09:00');
    expect(authFetchMock.mock.calls.some((call) => String(call[0]).includes('/api/mood-change'))).toBe(false);
    expect(screen.getByText('전체 일정을 화면에 적용했습니다. 아직 저장되지 않았습니다.')).toBeInTheDocument();
  });

  it('시각이 없는 복사 형식은 기존 시작 시각을 첫 출발과 동기화해 그대로 저장한다', async () => {
    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    const pasted = [
      '[차량 전체 일정]',
      '',
      '1. 서울역 → 잠실종합운동장',
      '출발 미입력 / 도착 미입력',
    ].join('\n');
    fireEvent.click(screen.getByRole('button', { name: '전체 일정 붙여넣기' }));
    fireEvent.change(screen.getByLabelText('카카오톡 전체 일정'), { target: { value: pasted } });
    fireEvent.click(screen.getByRole('button', { name: '미리보기 만들기' }));
    fireEvent.click(screen.getByRole('button', { name: '이 일정 화면에 적용' }));

    expect((screen.getByLabelText('시작 시각') as HTMLInputElement).value).toBe('10:00');
    expect(screen.getByText('출발 10:00')).toBeInTheDocument();
    expect((screen.getByLabelText('이용 시간') as HTMLInputElement).value).toBe('4');

    await finishRouteDebounce();
    fireEvent.change(screen.getByLabelText(/변경 이유/), { target: { value: '시간 없는 일정 적용' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '변경 내용과 차액 확인 후 저장' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const changeCall = authFetchMock.mock.calls.find((call) => String(call[0]).includes('/api/mood-change'));
    const submitted = JSON.parse(String((changeCall?.[1] as RequestInit).body || '{}'));
    expect(submitted.booking.startTime).toBe('10:00');
    expect(submitted.booking.durationHours).toBe(4);
    expect(submitted.booking.routeSchedule).toEqual([
      { arrivalTime: null, pickupTime: '10:00' },
      { arrivalTime: null, pickupTime: null },
    ]);
  });

  it('자유문장은 기존 일정 분석 API를 거쳐 미리보기 후 같은 주소의 도착·픽업을 합친다', async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/api/mood-parse-schedule')) {
        return jsonResponse({
          ok: true,
          stops: [
            { address: '서울역', action: 'pickup', timeHint: '09:00', date: '2026-10-03', geocodeOk: true },
            { address: '서울 종로구 평창길 133', action: 'arrive', timeHint: '10:00', date: '2026-10-03', geocodeOk: true },
            { address: '서울 종로구 평창길 133', action: 'pickup', timeHint: '12:00', date: '2026-10-03', geocodeOk: true },
            { address: '잠실종합운동장', action: 'arrive', timeHint: '13:00', date: '2026-10-03', geocodeOk: true },
          ],
        });
      }
      if (target.includes('/api/mood-route')) return routeResponse(64, 8_000);
      return jsonResponse({}, 404);
    });

    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '전체 일정 붙여넣기' }));
    fireEvent.change(screen.getByLabelText('카카오톡 전체 일정'), {
      target: { value: '오전 9시 서울역 출발, 평창길에서 두 시간 대기 후 잠실 도착' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '미리보기 만들기' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('자유문장 분석')).toBeInTheDocument();
    expect(authFetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/mood-parse-schedule'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '이 일정 화면에 적용' }));
    expect(rowAddresses()).toEqual(['서울역', '서울 종로구 평창길 133', '잠실종합운동장']);
    expect(screen.getByText('도착 10:00 · 재출발 12:00 · 대기 2시간')).toBeInTheDocument();
    expect((screen.getByLabelText('시작 시각') as HTMLInputElement).value).toBe('09:00');
  });

  it('시각이 없는 자유문장 분석도 기존 시작 시각을 첫 출발 일정에 유지한다', async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/api/mood-parse-schedule')) {
        return jsonResponse({
          ok: true,
          stops: [
            { address: '서울역', action: 'pickup', timeHint: '', geocodeOk: true },
            { address: '잠실종합운동장', action: 'arrive', timeHint: '', geocodeOk: true },
          ],
        });
      }
      if (target.includes('/api/mood-route')) return routeResponse(64, 8_000);
      return jsonResponse({}, 404);
    });

    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '전체 일정 붙여넣기' }));
    fireEvent.change(screen.getByLabelText('카카오톡 전체 일정'), {
      target: { value: '서울역에서 출발해 잠실종합운동장 도착' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '미리보기 만들기' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: '이 일정 화면에 적용' }));
    expect((screen.getByLabelText('시작 시각') as HTMLInputElement).value).toBe('10:00');
    expect(screen.getByText('출발 10:00')).toBeInTheDocument();
  });

  it('이전 순서의 늦은 응답이 새 순서의 금액과 지도를 덮지 못한다', async () => {
    type Deferred = { resolve: (value: ReturnType<typeof routeResponse>) => void };
    const pending: Deferred[] = [];
    authFetchMock.mockImplementation((url: string) => {
      if (!String(url).includes('/api/mood-route')) return Promise.resolve(jsonResponse({}, 404));
      return new Promise((resolve) => pending.push({ resolve }));
    });

    render(
      <MoodBookingChangeModal
        booking={booking()}
        balanceKRW={500_000}
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );
    await finishRouteDebounce();
    expect(pending).toHaveLength(1);

    const beforeMoveRows = routeRows();
    drag(rowId(beforeMoveRows[2]), rowId(beforeMoveRows[1]));
    await finishRouteDebounce();
    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[1].resolve(routeResponse(71, 9_000));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/동선 71km/)).toBeInTheDocument();
    expect(screen.getByTestId('mood-route-map')).toHaveAttribute('data-km', '71');

    await act(async () => {
      pending[0].resolve(routeResponse(64, 8_000));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/동선 71km/)).toBeInTheDocument();
    expect(screen.queryByText(/동선 64km/)).not.toBeInTheDocument();
    expect(screen.getByTestId('mood-route-map')).toHaveAttribute('data-km', '71');
  });
});
