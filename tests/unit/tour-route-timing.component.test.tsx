// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/tours-firestore', () => ({ resolvePhotoUrl: (photo: string) => photo }));
import { TourRouteSummary } from '@/components/tours/TourRouteSummary';
import { TourStopList } from '@/components/tours/TourStopList';
import { TOURS, type Tour } from '@/data/tours';

afterEach(cleanup);

function tour(id: string): Tour {
  const found = TOURS.find((item) => item.id === id);
  if (!found) throw new Error(`Missing tour fixture: ${id}`);
  return found;
}

describe('public tour timing', () => {
  it('hides contradictory Seoul clock, stay, and transit values while retaining the 9-hour duration and visit order', () => {
    const seoul = tour('tour-seoul-city');
    render(
      <>
        <TourRouteSummary tour={seoul} language="ko" />
        <TourStopList stops={seoul.stops || []} language="ko" timingIsReliable={false} />
      </>,
    );

    const summary = screen.getByTestId('tour-route-summary');
    expect(within(summary).getByText('9시간')).toBeTruthy();
    expect(within(summary).queryByText('09:30–18:00')).toBeNull();
    expect(within(summary).getByText('픽업·복귀 장소 및 교통 상황에 따라 세부 시간은 예약 전에 확인')).toBeTruthy();
    expect(within(summary).getByText('방문 순서')).toBeTruthy();
    expect(screen.queryByText('09:30')).toBeNull();
    expect(screen.queryByText('18:00')).toBeNull();
    expect(screen.queryByText('도보 12분')).toBeNull();
  });

  it('keeps internally consistent listed arrivals and stay details visible', () => {
    const consistent: Tour = {
      ...tour('tour-seoul-city'),
      stops: (tour('tour-seoul-city').stops || []).slice(0, 2).map((stop, index) => ({
        ...stop,
        time: index === 0 ? '09:00' : '10:42',
        stay_min: index === 0 ? 90 : stop.stay_min,
        transit_from_prev: index === 0 ? undefined : { method: 'car', minutes: 12 },
      })),
    };

    render(
      <>
        <TourRouteSummary tour={consistent} language="en" />
        <TourStopList stops={consistent.stops || []} language="en" timingIsReliable />
      </>,
    );

    expect(screen.getByText('09:00–10:42')).toBeTruthy();
    expect(screen.getByText('90min')).toBeTruthy();
    expect(screen.getByText('Drive 12min')).toBeTruthy();
    expect(screen.queryByText(/confirm detailed times before booking/i)).toBeNull();
  });

  it('hides a schedule whose final stay would exceed the stated service duration', () => {
    const base = tour('tour-seoul-city');
    const longWindow: Tour = {
      ...base,
      durationHours: 9,
      stops: [
        { ...base.stops![0], time: '09:00', stay_min: 60 },
        { ...base.stops![1], time: '17:30', stay_min: 60, transit_from_prev: { method: 'car', minutes: 10 } },
      ],
    };
    render(<TourRouteSummary tour={longWindow} language="en" />);
    expect(screen.queryByText('09:00–17:30')).toBeNull();
    expect(screen.getByText(/confirm detailed times before booking/i)).toBeTruthy();
  });

  it('fails closed for malformed or missing times without displaying a bogus end time', () => {
    const seoul = tour('tour-seoul-city');
    const malformed: Tour = {
      ...seoul,
      stops: (seoul.stops || []).map((stop, index) => ({ ...stop, time: index === 1 ? '25:99' : stop.time })),
    };

    render(<TourRouteSummary tour={malformed} language="en" />);
    expect(screen.queryByText('09:30–18:00')).toBeNull();
    expect(screen.getByText(/confirm detailed times before booking/i)).toBeTruthy();
    cleanup();

    const missing: Tour = { ...seoul, stops: (seoul.stops || []).map((stop, index) => ({ ...stop, time: index === 1 ? '' : stop.time })) };
    render(<TourRouteSummary tour={missing} language="en" />);
    expect(screen.queryByText(/NaN|Invalid Date|00:00/)).toBeNull();
    expect(screen.getByText(/confirm detailed times before booking/i)).toBeTruthy();
  });

  it('fails closed when an editorial tour is changed to a multi-day duration', () => {
    const seoul = tour('tour-seoul-city');
    render(<TourRouteSummary tour={{ ...seoul, durationDays: 2 }} language="en" />);
    expect(screen.queryByText('09:30–18:00')).toBeNull();
    expect(screen.getByText(/confirm detailed times before booking/i)).toBeTruthy();
  });

  it('labels the other editorial tours as first and last listed arrivals, separate from service duration', () => {
    const ganghwa = tour('tour-ganghwa');
    const { unmount } = render(<TourRouteSummary tour={ganghwa} language="en" />);
    expect(screen.getByText('First / last listed arrival')).toBeTruthy();
    expect(screen.getByText(/includes a Seoul–Ganghwa round trip/)).toBeTruthy();
    expect(screen.getByText('10:30–15:30')).toBeTruthy();
    unmount();

    const gyeongju = tour('tour-gyeongju');
    render(<TourRouteSummary tour={gyeongju} language="en" />);
    expect(screen.getByText('First / last listed arrival')).toBeTruthy();
    expect(screen.getByText(/includes a Seoul–Gyeongju round trip/)).toBeTruthy();
    expect(screen.getByText('10:00–17:00')).toBeTruthy();
  });

  it('localizes the timing confirmation in Japanese and Chinese', () => {
    const seoul = tour('tour-seoul-city');
    const { rerender } = render(<TourRouteSummary tour={seoul} language="ja" />);
    expect(screen.getByText('送迎場所や交通状況により、詳細な時間は予約前にご確認ください')).toBeTruthy();
    rerender(<TourRouteSummary tour={seoul} language="zh" />);
    expect(screen.getByText('接送地点和交通状况可能影响具体时间，请在预订前确认')).toBeTruthy();
  });
});
