// @vitest-environment jsdom
//
// 어드민 StopsTab 좌표 입력 — 실제 조작 흐름 가드 (2026-07-20).
//
// 유닛 테스트(admin-stop-coords.test.ts)가 "함수가 맞게 계산하는가"를 본다면, 여기서는
// **운영자가 화면에서 하는 일**을 본다: 이름으로 찾기 → 후보 클릭 → 좌표가 채워지고 저장 patch 가
// 나가는가. 자동채움이 조용히 안 먹으면 지도가 계속 비는데, 그건 함수 테스트로는 안 잡힌다.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

void React;

// PhotoUploader 는 Firebase Storage 를, TourStopMap 은 Leaflet 청크를 끌고 온다 — 좌표 입력과
// 무관하고 jsdom 에서 무겁기만 하므로 대체한다(이 테스트의 대상은 좌표 UI).
vi.mock('@/components/admin/PhotoUploader', () => ({
  PhotoUploader: () => <div data-testid="photo-uploader" />,
}));
vi.mock('@/components/tours/TourStopMap', () => ({
  TourStopMap: ({ stops }: { stops: Array<{ lat?: number; lng?: number }> }) => (
    <div data-testid="map-preview">
      pins:{stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).length}
    </div>
  ),
}));

import { StopsTab } from '../../src/components/admin/ProductEditor/StopsTab';
import type { Tour, TourStop } from '../../src/data/tours';

const i18n = (ko: string) => ({ ko, en: '', ja: '', zh: '' });

function stop(over: Partial<TourStop> = {}): TourStop {
  return {
    time: '09:30',
    name: i18n('경복궁'),
    stay_min: 90,
    description: i18n(''),
    ...over,
  };
}

/** place-search 응답 1건. */
const gyeongbok = {
  name: '경복궁', address: '서울 종로구 세종로', roadAddress: '서울 종로구 사직로 161',
  category: '문화,예술>고궁', tel: '', lat: 37.5796, lng: 126.977,
};

/**
 * StopsTab 은 컨트롤드 컴포넌트다 — 부모(AdminProductEditor)가 patch 를 받아 draft 를 갱신해야
 * 입력값이 화면에 남는다. 스파이만 물리면 타이핑이 매 글자 초기화되므로, 실제 부모처럼
 * 상태를 들고 있는 래퍼로 감싼다(= 자동저장 patch 를 그대로 관찰하면서 화면도 정상 동작).
 */
function Harness({ initial, onPatch }: { initial: Partial<Tour>; onPatch: (p: Partial<Tour>) => void }) {
  const [draft, setDraft] = React.useState<Partial<Tour>>(initial);
  return (
    <StopsTab
      draft={draft}
      tourId="t1"
      onChange={(patch) => {
        onPatch(patch);
        setDraft((prev) => ({ ...prev, ...patch }));
      }}
    />
  );
}

function mockFetchOnce(payload: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('StopsTab — 좌표 직접 입력', () => {
  it('위도/경도를 치면 onChange 로 숫자가 나간다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ stops: [stop()] }} onPatch={onChange} />);

    await user.type(screen.getByLabelText('Stop 1 위도'), '37.5');

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as { stops: TourStop[] };
    expect(last.stops[0].lat).toBe(37.5);
  });

  it('칸을 비우면 lat 이 undefined — 0 으로 대체하면 아프리카 앞바다에 핀이 찍힌다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ stops: [stop({ lat: 37.5, lng: 127 })] }} onPatch={onChange} />);

    await user.clear(screen.getByLabelText('Stop 1 위도'));

    const last = onChange.mock.calls.at(-1)![0] as { stops: TourStop[] };
    expect(last.stops[0].lat).toBeUndefined();
  });
});

describe('StopsTab — 이름으로 찾기(자동 채움)', () => {
  it('후보를 고르면 그 좌표가 stop 에 채워진다', async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetchOnce({ items: [gyeongbok] });
    const onChange = vi.fn();
    render(<Harness initial={{ stops: [stop()] }} onPatch={onChange} />);

    await user.click(screen.getByRole('button', { name: /이름으로 찾기/ }));

    // 검색은 stop 이름(한국어)으로 나간다.
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(String(fetchFn.mock.calls[0][0])).toContain('query=%EA%B2%BD%EB%B3%B5%EA%B6%81'); // 경복궁

    const candidate = await screen.findByText('서울 종로구 사직로 161');
    await user.click(candidate);

    const last = onChange.mock.calls.at(-1)![0] as { stops: TourStop[] };
    expect(last.stops[0].lat).toBe(37.5796);
    expect(last.stops[0].lng).toBe(126.977);
  });

  it('이름이 비어 있으면 호출하지 않고 안내한다 (헛돈 낭비 방지)', async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetchOnce({ items: [] });
    render(<StopsTab draft={{ stops: [stop({ name: i18n('') })] }} tourId="t1" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /이름으로 찾기/ }));

    expect(await screen.findByText(/stop 이름\(한국어\)을 먼저 입력/)).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('검색 실패해도 폼이 죽지 않고 직접 입력을 안내한다', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ error: 'UPSTREAM_ERROR' }, false);
    render(<StopsTab draft={{ stops: [stop()] }} tourId="t1" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /이름으로 찾기/ }));

    expect(await screen.findByText(/검색 실패/)).toBeTruthy();
    expect(screen.getByLabelText('Stop 1 위도')).toBeTruthy(); // 입력창 살아있음
  });

  it('결과 0건이면 직접 입력으로 유도한다', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ items: [] });
    render(<StopsTab draft={{ stops: [stop({ name: i18n('없는장소이름') })] }} tourId="t1" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /이름으로 찾기/ }));

    expect(await screen.findByText(/검색 결과가 없습니다/)).toBeTruthy();
  });
});

describe('StopsTab — 진행 표시와 지도 미리보기', () => {
  it('좌표 1곳이면 지도 미리보기가 안 뜨고 안내가 뜬다', () => {
    render(
      <StopsTab
        draft={{ stops: [stop({ lat: 37.5, lng: 127 }), stop()] }}
        tourId="t1"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/2곳 이상이어야/)).toBeTruthy();
    expect(screen.queryByTestId('map-preview')).toBeNull();
  });

  it('좌표 2곳이면 손님 화면과 같은 지도 미리보기가 뜬다', () => {
    render(
      <StopsTab
        draft={{ stops: [stop({ lat: 37.5, lng: 127 }), stop({ lat: 37.6, lng: 127.1 })] }}
        tourId="t1"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('map-preview').textContent).toContain('pins:2');
    expect(screen.queryByText(/2곳 이상이어야/)).toBeNull();
  });

  it('반쪽 좌표(위도만)는 핀으로 세지 않는다', () => {
    render(
      <StopsTab
        draft={{ stops: [stop({ lat: 37.5, lng: 127 }), stop({ lat: 37.6 })] }}
        tourId="t1"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/2곳 이상이어야/)).toBeTruthy();
  });
});
