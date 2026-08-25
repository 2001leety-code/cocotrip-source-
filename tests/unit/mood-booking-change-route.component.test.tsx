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

    fireEvent.change(screen.getByLabelText(/변경 이유/), { target: { value: '촬영 순서 변경' } });
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

    fireEvent.click(screen.getByRole('button', { name: '장소 추가' }));
    expect(rowAddresses()).toEqual(['서울역', '성수동', '', '서울시청']);
    expect(within(routeRows()[2]).getByText('3. 경유지 2')).toBeInTheDocument();
    expect(within(routeRows()[3]).getByText('4. 도착지')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '빈 장소를 확인해 주세요' })).toBeDisabled();

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: '장소 추가' }));
    }
    expect(routeRows()).toHaveLength(7);
    expect(rowAddresses().at(-1)).toBe('서울시청');
    expect(screen.queryByRole('button', { name: '장소 추가' })).not.toBeInTheDocument();
    expect(screen.getByText('장소는 최대 7곳까지 추가할 수 있습니다.')).toBeInTheDocument();
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
