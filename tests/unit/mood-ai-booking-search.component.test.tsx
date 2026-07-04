// @vitest-environment jsdom
/**
 * MoodAiBooking 주소 인식 개선 실렌더 잠금 (2026-07-04 PR1).
 *
 * MOOD 포털은 구글로그인+allowlist 게이트라 preview 실물검증 불가 → JSDOM 실렌더로 대체.
 *
 * 잠금:
 *   1. 실패 stop = 🔍 검색(주) + 주소로 확인(보조) 두 버튼 — '그냥 확인'만 있던 UX 회귀 방지.
 *   2. 🔍 검색 → /api/place-search 후보 리스트 → 선택 시 stop 해소(실패 UI 제거).
 *   3. searchGuessed stop 주소줄에 '검색추정' 배지.
 *   4. 전 stop 좌표 확보 시 /api/mood-route 실도로 경로 조회(500ms 디바운스) →
 *      예상 금액에 거리 추가요금(km) 행 반영.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetchMock(...a) }));
vi.mock('@/components/MoodRouteMap', () => ({
  MoodRouteMap: () => <div data-testid="route-map" />,
}));

import { MoodAiBooking } from '../../src/components/mood/MoodAiBooking';

const PARSE_RESPONSE = {
  ok: true,
  serviceGuess: 'vehicle',
  hasDirector: true,
  hasAirport: true,
  truncated: false,
  stops: [
    { order: 1, label: '이사님 픽업', address: '서울 송파구 잠실로 62', lat: 37.5099, lng: 127.0872, action: 'pickup', matchedFromPlacebook: true, geocodeOk: true },
    { order: 2, label: '알촌 을지로점', address: '서울 중구 을지로 12', lat: 37.566, lng: 126.982, action: 'via', matchedFromPlacebook: false, geocodeOk: true, searchGuessed: true },
    { order: 3, label: '인천공항 터미널2', address: '', lat: null, lng: null, action: 'dropoff', matchedFromPlacebook: false, geocodeOk: false },
  ],
};

const ROUTE_RESPONSE = {
  ok: true,
  data: { km: 137, durationMin: 180, tollKRW: 6600, path: [[127, 37.5], [126.43, 37.46]], points: [] },
};

const PLACE_SEARCH_RESPONSE = {
  items: [
    { name: '인천국제공항 제2여객터미널', roadAddress: '인천 중구 제2터미널대로 446', address: '', lat: 37.4689, lng: 126.4333 },
    { name: '인천공항 T2 장기주차장', roadAddress: '인천 중구 공항로 12', address: '', lat: 37.47, lng: 126.44 },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authFetchMock.mockReset();
  authFetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('mood-parse-schedule')) return { status: 200, json: async () => PARSE_RESPONSE };
    if (String(url).includes('mood-route')) return { status: 200, json: async () => ROUTE_RESPONSE };
    return { status: 404, json: async () => ({}) };
  });
  fetchMock = vi.fn(async () => ({ json: async () => PLACE_SEARCH_RESPONSE }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderAndParse() {
  render(<MoodAiBooking clientId="mood" />);
  fireEvent.change(screen.getByPlaceholderText(/MOOD 일정/), {
    target: { value: '■ 9:30 이사님 픽업\n■ 오후 3시 인천공항 터미널2 드랍' },
  });
  fireEvent.click(screen.getByRole('button', { name: /일정 분석/ }));
  await waitFor(() => expect(screen.getByText('이사님 픽업')).toBeTruthy());
}

describe('MoodAiBooking 주소 검색 UI (PR1 실렌더 잠금)', () => {
  it('실패 stop = 🔍 검색(주) + 주소로 확인(보조), searchGuessed 배지 표시', async () => {
    await renderAndParse();

    // 1) 실패 stop 두 버튼 다 렌더
    expect(screen.getByRole('button', { name: /🔍 검색/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /주소로 확인/ })).toBeTruthy();
    // 안내문이 '검색으로 장소를 찾아 선택' 톤 (그냥 '확인' UX 회귀 방지)
    expect(screen.getByText(/검색으로 장소를 찾아 선택/)).toBeTruthy();

    // 3) searchGuessed 배지
    expect(screen.getByText(/검색추정/)).toBeTruthy();
  });

  it('🔍 검색 → 후보 리스트 → 선택 시 stop 해소 → 실도로 경로 km가 예상 금액에 반영', async () => {
    await renderAndParse();

    // 검색 실행 — 실패 stop 라벨('인천공항 터미널2')로 place-search 호출
    fireEvent.click(screen.getByRole('button', { name: /🔍 검색/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/place-search');
    expect(calledUrl).toContain(encodeURIComponent('인천공항 터미널2'));

    // 후보 2건 렌더 → 첫 번째 선택
    const candidate = await screen.findByText('인천국제공항 제2여객터미널');
    fireEvent.click(candidate.closest('button')!);

    // 실패 UI 사라짐 + 선택 주소 반영
    await waitFor(() => {
      expect(screen.queryByText(/주소를 찾지 못했습니다/)).toBeNull();
      expect(screen.getByText(/제2터미널대로 446/)).toBeTruthy();
    });

    // 4) 전 stop 좌표 확보 → 500ms 디바운스 후 mood-route 호출 → km·톨 반영
    await waitFor(
      () => {
        const routeCall = authFetchMock.mock.calls.find((c) => String(c[0]).includes('mood-route'));
        expect(routeCall).toBeTruthy();
      },
      { timeout: 3000 },
    );
    await waitFor(
      () => {
        expect(screen.getByText(/거리 추가요금 \(137km\)/)).toBeTruthy();
        expect(screen.getByText(/톨비\(예상\)/)).toBeTruthy();
        expect(screen.getByText(/137km 반영/)).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
