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
  render(<MoodAiBooking clientId="mood" onBooked={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/MOOD 일정/), {
    target: { value: '■ 9:30 이사님 픽업\n■ 오후 3시 인천공항 터미널2 드랍' },
  });
  fireEvent.click(screen.getByRole('button', { name: /일정 분석/ }));
  await waitFor(() => expect(screen.getByText(/동선 \d+개/)).toBeTruthy());
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

// ── 날짜별 예약 분리 + 항공편 메모 (2026-07-05 PR3) ──────────────────────
const MULTI_DATE_RESPONSE = {
  ok: true,
  serviceGuess: 'airport',
  hasDirector: false,
  hasAirport: true,
  truncated: false,
  dates: ['2026-07-15', '2026-07-18'],
  flights: [
    { flightNo: 'KE765', timeHint: '15:10', date: '2026-07-15' },
    { flightNo: 'KE764', timeHint: '11:00', date: '2026-07-18' },
  ],
  stops: [
    { order: 1, label: '인천공항 T2', address: 'T2주소', lat: 37.46, lng: 126.43, action: 'pickup', matchedFromPlacebook: true, geocodeOk: true, date: '2026-07-15' },
    { order: 2, label: '신라호텔', address: '서울 중구 동호로 249', lat: 37.556, lng: 127.005, action: 'arrive', matchedFromPlacebook: false, geocodeOk: true, date: '2026-07-15' },
    { order: 3, label: '신라호텔', address: '서울 중구 동호로 249', lat: 37.556, lng: 127.005, action: 'pickup', matchedFromPlacebook: false, geocodeOk: true, date: '2026-07-18' },
    { order: 4, label: '인천공항 T2', address: 'T2주소', lat: 37.46, lng: 126.43, action: 'dropoff', matchedFromPlacebook: true, geocodeOk: true, date: '2026-07-18' },
  ],
};

describe('MoodAiBooking 날짜별 예약 분리 (PR3 실렌더 잠금)', () => {
  beforeEach(() => {
    authFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('mood-parse-schedule')) return { status: 200, json: async () => MULTI_DATE_RESPONSE };
      if (String(url).includes('mood-route')) return { status: 200, json: async () => ROUTE_RESPONSE };
      if (String(url).includes('mood-book')) return { status: 200, json: async () => ({ ok: true, data: { amountKRW: 110000, balanceKRW: 500000 } }) };
      return { status: 404, json: async () => ({}) };
    });
  });

  it('날짜 2개 → 분리 배너+칩, 첫 그룹만 표시, 칩 전환 시 그룹·항공편 전환', async () => {
    await renderAndParse();

    // 배너 + 날짜 칩 2개
    expect(screen.getByText(/날짜가 2개인 일정/)).toBeTruthy();
    const chip15 = screen.getByRole('button', { name: /07\/15 \(2곳\)/ });
    const chip18 = screen.getByRole('button', { name: /07\/18 \(2곳\)/ });
    expect(chip15).toBeTruthy();

    // 첫 그룹(7/15) 활성 — 동선 2개 + 해당 날짜 항공편만
    expect(screen.getByText(/동선 2개 \(07\/15\)/)).toBeTruthy();
    expect(screen.getByText(/✈️ KE765 15:10/)).toBeTruthy();
    expect(screen.queryByText(/KE764/)).toBeNull();

    // 칩 전환 → 7/18 그룹 + 항공편 교체
    fireEvent.click(chip18);
    await waitFor(() => {
      expect(screen.getByText(/동선 2개 \(07\/18\)/)).toBeTruthy();
      expect(screen.getByText(/✈️ KE764 11:00/)).toBeTruthy();
      expect(screen.queryByText(/KE765/)).toBeNull();
    });
  });

  it('예약 요청에 활성 그룹 날짜 + 항공편 메모(note) 자동 첨부', async () => {
    await renderAndParse();

    fireEvent.click(screen.getByRole('button', { name: /이대로 예약/ }));
    await waitFor(() => {
      const bookCall = authFetchMock.mock.calls.find((c) => String(c[0]).includes('mood-book'));
      expect(bookCall).toBeTruthy();
      const body = JSON.parse((bookCall![1] as { body: string }).body);
      expect(body.date).toBe('2026-07-15'); // 첫 그룹 날짜 prefill
      expect(body.note).toBe('✈️ KE765 15:10'); // 그룹 항공편만 첨부
    });
  });
});

// ── 💰 김포/인천 공항 정액 분리 (2026-07-27) ────────────────────────────
// 공항마다 정액이 다름(ICN 110,000 / GMP 80,000) → 오선택/미전달 = 3만원 오차.
function airportParseResponse(airportCodeGuess: string | null) {
  return {
    ok: true,
    serviceGuess: 'airport',
    hasDirector: false,
    hasAirport: true,
    airportCodeGuess,
    truncated: false,
    stops: [
      { order: 1, label: '김포공항 국제선', address: '서울 강서구 하늘길 112', lat: 37.558, lng: 126.79, action: 'pickup', matchedFromPlacebook: true, geocodeOk: true },
      { order: 2, label: '신라호텔', address: '서울 중구 동호로 249', lat: 37.556, lng: 127.005, action: 'arrive', matchedFromPlacebook: false, geocodeOk: true },
    ],
  };
}

describe('MoodAiBooking 공항 정액 분리 (김포 80,000 / 인천 110,000)', () => {
  function mockParse(airportCodeGuess: string | null) {
    authFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('mood-parse-schedule')) return { status: 200, json: async () => airportParseResponse(airportCodeGuess) };
      if (String(url).includes('mood-route')) return { status: 200, json: async () => ROUTE_RESPONSE };
      if (String(url).includes('mood-book')) return { status: 200, json: async () => ({ ok: true, data: { amountKRW: 80000, balanceKRW: 500000 } }) };
      return { status: 404, json: async () => ({}) };
    });
  }

  it('AI 가 김포 감지 → 김포 기본 선택 + 예상 금액 80,000원', async () => {
    mockParse('GMP');
    await renderAndParse();

    expect(screen.getByText(/공항 이동이 감지되었습니다 \(김포공항\)/)).toBeTruthy();
    expect(screen.getByText(/김포공항 \(정액\)/)).toBeTruthy();
    // 서비스 버튼 요약가·예상 금액 모두 8만
    expect(screen.getAllByText('80,000원').length).toBeGreaterThan(0);
  });

  it('예약 요청 body 에 airportCode 전달 — 서버가 이 값으로 재계산', async () => {
    mockParse('GMP');
    await renderAndParse();

    fireEvent.click(screen.getByRole('button', { name: /이대로 예약/ }));
    await waitFor(() => {
      const bookCall = authFetchMock.mock.calls.find((c) => String(c[0]).includes('mood-book'));
      expect(bookCall).toBeTruthy();
      const body = JSON.parse((bookCall![1] as { body: string }).body);
      expect(body.serviceType).toBe('airport');
      expect(body.airportCode).toBe('GMP');
    });
  });

  it('운영자가 인천으로 바꾸면 110,000원 — 최종 확정은 사람 (AI 추천은 기본값일 뿐)', async () => {
    mockParse('GMP');
    await renderAndParse();

    fireEvent.click(screen.getByRole('button', { name: /인천공항/ }));
    await waitFor(() => expect(screen.getByText(/인천공항 \(정액\)/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /이대로 예약/ }));
    await waitFor(() => {
      const bookCall = authFetchMock.mock.calls.find((c) => String(c[0]).includes('mood-book'));
      const body = JSON.parse((bookCall![1] as { body: string }).body);
      expect(body.airportCode).toBe('ICN');
    });
  });

  it('🔴 서버가 airportCodeGuess 를 안 주면(구버전 API) 인천 기본 = 비싼 쪽 폴백', async () => {
    mockParse(null);
    await renderAndParse();

    expect(screen.getByText(/인천공항 \(정액\)/)).toBeTruthy();
    expect(screen.queryByText(/김포공항 \(정액\)/)).toBeNull();
  });
});
