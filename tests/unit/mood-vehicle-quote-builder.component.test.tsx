// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();

vi.mock('@/lib/authFetch', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'ko' }),
}));

import { MoodQuoteBuilder } from '../../src/components/mood/MoodQuoteBuilder';

const PROFILE = {
  id: 'mood-default',
  version: 1,
  builtIn: true,
  companyName: 'MOOD',
  hourlyRateKRW: 30000,
  minMinutes: 180,
  maxMinutes: 900,
  billingIncrementMinutes: 1,
  distanceThresholdMeters: 50000,
  distanceRateKRWPerKm: 600,
  distanceBillingMode: 'all_distance_when_threshold_reached',
  vatBasisPoints: 1000,
  tollPolicy: 'route_estimate',
  parkingPolicy: 'manual',
  overtimeRateKRW: 33000,
  overtimeIncludesVat: true,
  documentTitle: '전용 차량 일정 및 예상 견적',
  footer: '',
};

const PARSED = {
  serviceDate: '2026-09-01',
  startTime: '08:00',
  endTime: '20:00',
  departureAddress: '서울특별시 강남구 신사동 643-18',
  returnAddress: '서울특별시 강남구 신사동 643-18',
  needsConfirm: true,
  conflicts: [],
  warnings: [],
  stops: [
    {
      order: 1,
      arrivalTime: '10:00',
      departureTime: '12:00',
      name: '기원 위스키 증류소',
      purpose: '협업 조사',
      sourceRegion: '남양주',
      roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
      jibunAddress: '경기도 남양주시 화도읍 녹촌리 384-20',
      naverMapUrl: 'https://naver.me/Fx2gIj9B',
      optional: false,
      includeInRoute: true,
      addressVerified: false,
    },
    {
      order: 2,
      arrivalTime: '17:00',
      departureTime: '19:00',
      name: '고척스카이돔',
      purpose: '야구 경기',
      sourceRegion: '서울',
      roadAddress: '서울특별시 구로구 경인로 430',
      jibunAddress: '서울특별시 구로구 고척동 63-6',
      naverMapUrl: 'https://naver.me/F1a5w2dx',
      optional: false,
      includeInRoute: true,
      addressVerified: false,
    },
  ],
};

const PREVIEW = {
  profile: PROFILE,
  route: { source: 'route', distanceMeters: 125000, distanceKm: 125, durationMinutes: 210, tollKRW: 20000 },
  breakdown: {
    currency: 'KRW',
    timeMinutes: 720,
    billableMinutes: 720,
    timeFeeKRW: 360000,
    distanceFeeKRW: 75000,
    taxableSupplyKRW: 435000,
    vatKRW: 43500,
    tollKRW: 20000,
    parkingKRW: 10000,
    incidentalsKRW: 30000,
    totalKRW: 508500,
    overtimeRateKRW: 33000,
  },
  documentText: '[전용 차량 일정 및 예상 견적]\n최종 예상 금액: 508,500원',
  warnings: [],
  quoteSnapshot: { snapshotHash: 'abc' },
};

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function deferredResponse() {
  let resolvePromise: (value: ReturnType<typeof jsonResponse>) => void = () => undefined;
  const promise = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

let activeProfile = { ...PROFILE };
let activeParsed = { ...PARSED, stops: [...PARSED.stops] };

beforeEach(() => {
  activeProfile = { ...PROFILE };
  activeParsed = { ...PARSED, stops: [...PARSED.stops] };
  authFetchMock.mockReset();
  authFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
    if (url === '/api/mood-quote-profiles') {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body || '{}'));
        activeProfile = { ...activeProfile, ...body.profile, version: activeProfile.version + 1 };
        return jsonResponse({ ok: true, data: { profile: activeProfile } });
      }
      return jsonResponse({ ok: true, data: { profiles: [activeProfile], builtInProfileId: activeProfile.id } });
    }
    if (url === '/api/mood-quote-parse') return jsonResponse({ ok: true, data: activeParsed });
    if (url === '/api/mood-quote-preview') {
      return jsonResponse({ ok: true, data: { ...PREVIEW, profile: activeProfile } });
    }
    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  });
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })));
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  Object.defineProperty(window, 'print', { configurable: true, value: vi.fn() });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => { callback(0); return 1; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderAndAnalyze(confirmParsedSchedule = true) {
  render(<MoodQuoteBuilder />);
  await screen.findByRole('option', { name: /MOOD/ });
  fireEvent.change(screen.getByLabelText('받은 일정 전체 붙여넣기'), { target: { value: '9월 1일 차량 일정' } });
  fireEvent.click(screen.getByRole('button', { name: '일정 분석' }));
  await screen.findByDisplayValue('기원 위스키 증류소');
  if (confirmParsedSchedule) {
    fireEvent.click(screen.getByRole('button', { name: '시간·장소 확인 완료' }));
  }
}

describe('mood vehicle quote builder', () => {
  it('blocks an AI-parsed quote until the admin confirms the times and places', async () => {
    activeParsed = {
      ...activeParsed,
      warnings: ['1번 장소의 지역 설명과 주소가 다릅니다.', '2번 장소의 주소 확인이 필요합니다.'],
    };
    await renderAndAnalyze(false);
    screen.getAllByRole('checkbox', { name: '주소 확인 완료' })
      .forEach((checkbox) => fireEvent.click(checkbox));

    const previewButton = screen.getByRole('button', { name: '견적서 미리보기' });
    expect(previewButton).toBeDisabled();
    expect(screen.getByText('분석 결과입니다. 주소와 시간을 직접 확인해 주세요.')).toBeTruthy();
    expect(screen.getByText('• 1번 장소의 지역 설명과 주소가 다릅니다.')).toBeTruthy();
    expect(screen.getByText('• 2번 장소의 주소 확인이 필요합니다.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '시간·장소 확인 완료' }));
    expect(previewButton).toBeEnabled();
  });

  it('keeps manual schedule entry usable without an AI confirmation gate', async () => {
    render(<MoodQuoteBuilder />);
    await screen.findByRole('option', { name: /MOOD/ });
    fireEvent.change(screen.getByLabelText('이용일'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('총 이용시간(시간)'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('시작 시각'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('종료 시각'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('차량 출발 주소'), { target: { value: '서울 출발지' } });
    fireEvent.change(screen.getByLabelText('최종 복귀 주소'), { target: { value: '서울 복귀지' } });

    expect(screen.queryByRole('button', { name: '시간·장소 확인 완료' })).toBeNull();
    expect(screen.getByRole('button', { name: '견적서 미리보기' })).toBeEnabled();
  });

  it('accepts origin, one included stop, and return as a complete automatic route', async () => {
    activeParsed = { ...activeParsed, stops: [activeParsed.stops[0]] };
    await renderAndAnalyze();

    expect(within(screen.getByRole('article', { name: '장소 1' })).getByText('경유지')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '주소 확인 완료' }));
    const previewButton = screen.getByRole('button', { name: '견적서 미리보기' });
    expect(previewButton).toBeEnabled();
    fireEvent.click(previewButton);

    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => call[0] === '/api/mood-quote-preview')).toBe(true));
    const previewCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    const request = JSON.parse(previewCall[1].body);
    expect(request.stops).toHaveLength(1);
    expect(request.departureAddress).toBe(PARSED.departureAddress);
    expect(request.returnAddress).toBe(PARSED.returnAddress);
  });

  it('keeps sourceRegion attached to its stop after reordering and an address edit', async () => {
    await renderAndAnalyze();
    screen.getAllByRole('checkbox', { name: '주소 확인 완료' })
      .forEach((checkbox) => fireEvent.click(checkbox));

    fireEvent.click(screen.getByRole('button', { name: '기원 위스키 증류소 아래로' }));
    const movedStop = screen.getByRole('article', { name: '장소 2' });
    fireEvent.change(within(movedStop).getByLabelText('도로명 주소'), {
      target: { value: '부산광역시 중구 중앙대로 1' },
    });
    fireEvent.click(within(movedStop).getByRole('checkbox', { name: '주소 확인 완료' }));

    fireEvent.click(screen.getByRole('button', { name: '견적서 미리보기' }));
    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => call[0] === '/api/mood-quote-preview')).toBe(true));
    const previewCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    const request = JSON.parse(previewCall[1].body);
    expect(request.stops).toEqual([
      expect.objectContaining({ name: '고척스카이돔', sourceRegion: '서울' }),
      expect.objectContaining({
        name: '기원 위스키 증류소',
        sourceRegion: '남양주',
        roadAddress: '부산광역시 중구 중앙대로 1',
      }),
    ]);
    expect(request).not.toHaveProperty('conflicts');
  });

  it('allows manual distance without address verification', async () => {
    activeParsed = { ...activeParsed, stops: [activeParsed.stops[0]] };
    await renderAndAnalyze();

    fireEvent.click(screen.getByRole('radio', { name: '거리 직접 입력' }));
    expect(screen.getByRole('button', { name: '견적서 미리보기' })).toBeDisabled();
    expect(screen.getByText(/예상 거리를 0~3,000km 사이의 숫자로 입력해 주세요/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('예상 거리(km)'), { target: { value: '1e2' } });
    expect(screen.getByRole('button', { name: '견적서 미리보기' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('예상 거리(km)'), { target: { value: '125.5' } });
    const previewButton = screen.getByRole('button', { name: '견적서 미리보기' });
    expect(previewButton).toBeEnabled();
    fireEvent.click(previewButton);

    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => call[0] === '/api/mood-quote-preview')).toBe(true));
    const previewCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    const request = JSON.parse(previewCall[1].body);
    expect(request.routeMode).toBe('manual');
    expect(request.manualDistanceKm).toBe(125.5);
    expect(request.stops[0].addressVerified).toBe(false);
  });

  it('limits automatic routing to 13 addresses but keeps a long schedule usable with manual distance', async () => {
    activeParsed = {
      ...activeParsed,
      stops: Array.from({ length: 12 }, (_, index) => ({
        ...PARSED.stops[0],
        order: index + 1,
        name: index === 0 ? PARSED.stops[0].name : `장소 ${index + 1}`,
        roadAddress: `서울특별시 경로로 ${index + 1}`,
      })),
    };
    await renderAndAnalyze();
    const addressChecks = screen.getAllByRole('checkbox', { name: '주소 확인 완료' });
    expect(addressChecks).toHaveLength(12);
    addressChecks.forEach((checkbox) => fireEvent.click(checkbox));
    addressChecks.forEach((checkbox) => expect(checkbox).toBeChecked());

    const previewButton = screen.getByRole('button', { name: '견적서 미리보기' });
    expect(previewButton).toBeDisabled();
    expect(screen.getByText(/자동 계산은 최대 13개 주소/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '거리 직접 입력' }));
    fireEvent.change(screen.getByLabelText('예상 거리(km)'), { target: { value: '125' } });
    expect(previewButton).toBeEnabled();
  });

  it('offers a route estimate for tolls but not for parking', async () => {
    render(<MoodQuoteBuilder />);
    await screen.findByRole('option', { name: /MOOD/ });
    fireEvent.click(screen.getByRole('button', { name: '요금표 편집' }));

    const tollPolicy = screen.getByLabelText('통행료');
    const parkingPolicy = screen.getByLabelText('주차비');
    expect(within(tollPolicy).getByRole('option', { name: '경로 예상액' })).toBeTruthy();
    expect(within(parkingPolicy).queryByRole('option', { name: '경로 예상액' })).toBeNull();
    expect(within(parkingPolicy).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
      'manual',
      'included',
    ]);
  });

  it('shows and sends a manual toll for an automatic route when the profile requires it', async () => {
    activeProfile = { ...activeProfile, tollPolicy: 'manual' };
    await renderAndAnalyze();
    screen.getAllByRole('checkbox', { name: '주소 확인 완료' })
      .forEach((checkbox) => fireEvent.click(checkbox));

    const manualToll = screen.getByLabelText('예상 통행료(원)');
    fireEvent.change(manualToll, { target: { value: '23456' } });
    fireEvent.click(screen.getByRole('button', { name: '견적서 미리보기' }));

    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => call[0] === '/api/mood-quote-preview')).toBe(true));
    const previewCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    const request = JSON.parse(previewCall[1].body);
    expect(request.routeMode).toBe('route');
    expect(request.manualTollKRW).toBe(23456);
  });

  it('blocks blank or fractional visible KRW expenses instead of coercing them to zero', async () => {
    activeProfile = { ...activeProfile, tollPolicy: 'manual' };
    await renderAndAnalyze();
    screen.getAllByRole('checkbox', { name: '주소 확인 완료' })
      .forEach((checkbox) => fireEvent.click(checkbox));

    const previewButton = screen.getByRole('button', { name: '견적서 미리보기' });
    const manualToll = screen.getByLabelText('예상 통행료(원)');
    expect(previewButton).toBeEnabled();

    fireEvent.change(manualToll, { target: { value: '' } });
    expect(previewButton).toBeDisabled();
    expect(screen.getByText('통행료와 주차비는 0~10,000,000 사이의 원 단위 정수로 입력해 주세요.')).toBeTruthy();

    fireEvent.change(manualToll, { target: { value: '12.5' } });
    expect(previewButton).toBeDisabled();
    expect(authFetchMock.mock.calls.some((call) => call[0] === '/api/mood-quote-preview')).toBe(false);

    fireEvent.change(manualToll, { target: { value: '12' } });
    expect(previewButton).toBeEnabled();
  });

  it('hides and omits toll and parking inputs when the profile includes those costs', async () => {
    activeProfile = { ...activeProfile, tollPolicy: 'included', parkingPolicy: 'included' };
    await renderAndAnalyze();
    screen.getAllByRole('checkbox', { name: '주소 확인 완료' })
      .forEach((checkbox) => fireEvent.click(checkbox));

    expect(screen.queryByLabelText('예상 통행료(원)')).toBeNull();
    expect(screen.queryByLabelText('예상 주차비(원)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '견적서 미리보기' }));

    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => call[0] === '/api/mood-quote-preview')).toBe(true));
    const previewCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    const request = JSON.parse(previewCall[1].body);
    expect(request).not.toHaveProperty('manualTollKRW');
    expect(request).not.toHaveProperty('parkingKRW');

    const preview = await screen.findByTestId('mood-vehicle-quote-preview');
    expect(within(preview).getAllByText('요금에 포함')).toHaveLength(2);
  });

  it('blocks a profile save when a required numeric field is blank', async () => {
    render(<MoodQuoteBuilder />);
    await screen.findByRole('option', { name: /MOOD/ });
    fireEvent.click(screen.getByRole('button', { name: '요금표 편집' }));
    fireEvent.change(screen.getByLabelText('시간당 요금(원)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '업체 저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('필수 요금 숫자와 범위를 확인해 주세요.');
    expect(authFetchMock.mock.calls.some((call) => (
      call[0] === '/api/mood-quote-profiles' && call[1]?.method === 'POST'
    ))).toBe(false);
  });

  it('displays human units and saves exact server units plus overtime settings', async () => {
    render(<MoodQuoteBuilder />);
    await screen.findByRole('option', { name: /MOOD/ });
    fireEvent.click(screen.getByRole('button', { name: '요금표 편집' }));

    expect(screen.getByLabelText('최소 이용(시간)')).toHaveValue(3);
    expect(screen.getByLabelText('최대 이용(시간)')).toHaveValue(15);
    expect(screen.getByLabelText('거리요금 시작(km)')).toHaveValue(50);
    expect(screen.getByLabelText('부가세(%)')).toHaveValue(10);

    fireEvent.change(screen.getByLabelText('최소 이용(시간)'), { target: { value: '3.5' } });
    fireEvent.change(screen.getByLabelText('최대 이용(시간)'), { target: { value: '15.5' } });
    fireEvent.change(screen.getByLabelText('거리요금 시작(km)'), { target: { value: '50.25' } });
    fireEvent.change(screen.getByLabelText('부가세(%)'), { target: { value: '10.25' } });
    fireEvent.change(screen.getByLabelText('시간요금 올림 단위'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '초과요금에 부가세 포함' }));
    fireEvent.click(screen.getByRole('button', { name: '업체 저장' }));

    await waitFor(() => expect(authFetchMock.mock.calls.some((call) => (
      call[0] === '/api/mood-quote-profiles' && call[1]?.method === 'POST'
    ))).toBe(true));
    const saveCall = authFetchMock.mock.calls.find((call) => (
      call[0] === '/api/mood-quote-profiles' && call[1]?.method === 'POST'
    ));
    const request = JSON.parse(saveCall[1].body);
    expect(request.profile).toMatchObject({
      minMinutes: 210,
      maxMinutes: 930,
      billingIncrementMinutes: 30,
      distanceThresholdMeters: 50250,
      vatBasisPoints: 1025,
      overtimeIncludesVat: false,
    });
  });

  it('keeps a cleared duration empty and previews six hours instead of turning it into sixteen', async () => {
    await renderAndAnalyze();

    const duration = screen.getByLabelText('총 이용시간(시간)') as HTMLInputElement;
    expect(duration.value).toBe('12');
    fireEvent.change(duration, { target: { value: '' } });
    expect(duration.value).toBe('');
    fireEvent.change(duration, { target: { value: '6' } });
    expect(duration.value).toBe('6');

    const verifyBoxes = screen.getAllByRole('checkbox', { name: '주소 확인 완료' });
    verifyBoxes.forEach((checkbox) => fireEvent.click(checkbox));
    const previewButton = screen.getByRole('button', { name: '견적서 미리보기' });
    expect(previewButton).toBeEnabled();
    fireEvent.click(previewButton);

    expect((await screen.findAllByText('508,500원')).length).toBeGreaterThan(0);
    const previewCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    expect(previewCall).toBeTruthy();
    const request = JSON.parse(previewCall[1].body);
    expect(request.totalMinutes).toBe(360);
    expect(request.departureAddress).toBe(PARSED.departureAddress);
    expect(request.stops).toHaveLength(2);
    expect(request.stops[0]).not.toHaveProperty('clientId');
  });

  it('copies the exact server document and invalidates it after an itinerary edit', async () => {
    await renderAndAnalyze();
    const verifyBoxes = screen.getAllByRole('checkbox', { name: '주소 확인 완료' });
    verifyBoxes.forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole('button', { name: '견적서 미리보기' }));
    expect((await screen.findAllByText('508,500원')).length).toBeGreaterThan(0);

    const previewCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    const request = JSON.parse(previewCall[1].body);
    expect(request).not.toHaveProperty('conflicts');
    expect(request).not.toHaveProperty('warnings');

    fireEvent.click(screen.getByRole('button', { name: '전체 일정·견적 복사' }));
    await waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(PREVIEW.documentText));

    fireEvent.change(screen.getAllByLabelText('일정 내용')[0], { target: { value: '수정된 일정' } });
    expect(screen.queryByTestId('mood-vehicle-quote-preview')).toBeNull();
    expect(screen.getByText('내용이 바뀌었습니다. 견적서를 다시 계산해 주세요.')).toBeTruthy();
  });

  it('prints only the exact server customer document, without controls or admin inputs', async () => {
    await renderAndAnalyze();
    screen.getAllByRole('checkbox', { name: '주소 확인 완료' })
      .forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole('button', { name: '견적서 미리보기' }));

    const preview = await screen.findByTestId('mood-vehicle-quote-preview');
    const printable = preview.querySelector('[data-mood-quote-print-document]');
    expect(printable).not.toBeNull();
    expect(printable?.textContent?.trim()).toBe(PREVIEW.documentText);
    expect(printable?.querySelector('button, input, textarea, select')).toBeNull();
    expect(printable).not.toHaveTextContent('받은 일정 전체 붙여넣기');

    fireEvent.click(within(preview).getByRole('button', { name: '인쇄' }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('aborts stale parsing, clears the old result on source edits, and applies only the latest text', async () => {
    render(<MoodQuoteBuilder />);
    await screen.findByRole('option', { name: /MOOD/ });
    const firstResponse = deferredResponse();
    const secondResponse = deferredResponse();
    let parseRequestCount = 0;
    authFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/mood-quote-profiles') {
        return jsonResponse({ ok: true, data: { profiles: [activeProfile], builtInProfileId: activeProfile.id } });
      }
      if (url !== '/api/mood-quote-parse') return jsonResponse({ ok: false });
      parseRequestCount += 1;
      return parseRequestCount === 1 ? firstResponse.promise : secondResponse.promise;
    });

    const source = screen.getByLabelText('받은 일정 전체 붙여넣기');
    fireEvent.change(source, { target: { value: '첫 번째 일정' } });
    fireEvent.click(screen.getByRole('button', { name: '일정 분석' }));
    await waitFor(() => expect(parseRequestCount).toBe(1));
    const firstParseCall = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-parse');
    const firstSignal = firstParseCall?.[1]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    fireEvent.change(source, { target: { value: '두 번째 일정' } });
    expect(firstSignal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: '시간·장소 확인 완료' })).toBeNull();
    expect(screen.queryByDisplayValue('기원 위스키 증류소')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '일정 분석' }));
    await waitFor(() => expect(parseRequestCount).toBe(2));

    const latestParsed = {
      ...PARSED,
      stops: [{ ...PARSED.stops[0], name: '최신 일정 장소' }],
    };
    await act(async () => {
      secondResponse.resolve(jsonResponse({ ok: true, data: latestParsed }));
      await secondResponse.promise;
    });
    expect(await screen.findByDisplayValue('최신 일정 장소')).toBeTruthy();

    const olderParsed = {
      ...PARSED,
      stops: [{ ...PARSED.stops[0], name: '오래된 일정 장소' }],
    };
    await act(async () => {
      firstResponse.resolve(jsonResponse({ ok: true, data: olderParsed }));
      await firstResponse.promise;
    });
    expect(screen.queryByDisplayValue('오래된 일정 장소')).toBeNull();
    expect(screen.getByDisplayValue('최신 일정 장소')).toBeTruthy();
  });

  it('ignores an older delayed preview after inputs change and only copies the latest response', async () => {
    await renderAndAnalyze();
    screen.getAllByRole('checkbox', { name: '주소 확인 완료' })
      .forEach((checkbox) => fireEvent.click(checkbox));

    const firstResponse = deferredResponse();
    const secondResponse = deferredResponse();
    let previewRequestCount = 0;
    authFetchMock.mockImplementation(async (url: string) => {
      if (url !== '/api/mood-quote-preview') return jsonResponse({ ok: false });
      previewRequestCount += 1;
      return previewRequestCount === 1 ? firstResponse.promise : secondResponse.promise;
    });

    fireEvent.click(screen.getByRole('button', { name: '견적서 미리보기' }));
    await waitFor(() => expect(previewRequestCount).toBe(1));
    const firstRequest = authFetchMock.mock.calls.find((call) => call[0] === '/api/mood-quote-preview');
    const firstSignal = firstRequest?.[1]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    fireEvent.change(screen.getByLabelText('총 이용시간(시간)'), { target: { value: '6' } });
    expect(firstSignal.aborted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '견적서 미리보기' }));
    await waitFor(() => expect(previewRequestCount).toBe(2));

    const latestPreview = { ...PREVIEW, documentText: '최신 견적 문서' };
    await act(async () => {
      secondResponse.resolve(jsonResponse({ ok: true, data: latestPreview }));
      await secondResponse.promise;
    });
    expect(await screen.findByText('최신 견적 문서')).toBeTruthy();

    const olderPreview = { ...PREVIEW, documentText: '오래된 견적 문서' };
    await act(async () => {
      firstResponse.resolve(jsonResponse({ ok: true, data: olderPreview }));
      await firstResponse.promise;
    });
    expect(screen.queryByText('오래된 견적 문서')).toBeNull();
    expect(screen.getByText('최신 견적 문서')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '전체 일정·견적 복사' }));
    await waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('최신 견적 문서'));
    expect(window.navigator.clipboard.writeText).not.toHaveBeenCalledWith('오래된 견적 문서');
  });

  it('keeps both road and jibun addresses when a Naver place candidate is selected', async () => {
    const placeFetch = vi.fn(async () => jsonResponse({
      items: [{
        name: '더 루프',
        roadAddress: '서울특별시 용산구 독서당로35길 4',
        address: '서울특별시 용산구 한남동 60-24',
        lat: 37.53,
        lng: 127.01,
      }],
    }));
    vi.stubGlobal('fetch', placeFetch);
    await renderAndAnalyze();

    fireEvent.click(screen.getAllByRole('button', { name: '⌕ 장소 검색' })[0]);
    const query = screen.getByPlaceholderText('장소명 또는 주소');
    fireEvent.change(query, { target: { value: '더 루프' } });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    const candidate = await screen.findByRole('button', { name: '더 루프 이 장소 사용' });
    fireEvent.click(candidate);

    expect(screen.getByDisplayValue('서울특별시 용산구 독서당로35길 4')).toBeTruthy();
    expect(screen.getByDisplayValue('서울특별시 용산구 한남동 60-24')).toBeTruthy();
  });
});
