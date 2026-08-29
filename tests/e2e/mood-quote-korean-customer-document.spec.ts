import { expect, test } from './fixtures/analytics-guard';
import type { Locator, Page } from '@playwright/test';
import type { VehicleQuotePreviewRequest } from '../../src/lib/vehicleQuote';

const localBaseUrl = process.env.BASE_URL || '';
const runsAgainstLocalDev = /localhost|127\.0\.0\.1/.test(localBaseUrl);

const SUCCESS_SOURCE = [
  'Service date: 2026-09-01',
  'Vehicle time: 08:00-20:00',
  'Departure: 서울특별시 강남구 신사동 643-18',
  '10:00-12:00 KI ONE WHISKY DISTILLERY',
  'Purpose: Whiskey collaboration research meeting',
  'Road address: 경기도 남양주시 화도읍 녹촌로 259-18',
  'Lot address: 경기도 남양주시 화도읍 녹촌리 384-20',
  'Naver Map: https://naver.me/Fx2gIj9B',
  'Return: 서울특별시 강남구 신사동 643-18',
].join('\n');

const FAILED_TRANSLATION_SOURCE = [
  'Service date: 2026-09-01',
  'Vehicle time: 08:00-20:00',
  'Departure: 서울특별시 강남구 신사동 643-18',
  '14:30-16:00 THE ROOF',
  'Purpose: Client meeting',
  'Road address: 서울특별시 용산구 독서당로35길 4, 4층',
  'Lot address: 서울특별시 용산구 한남동 60-24',
  'Naver Map: https://naver.me/5eDY0Qr4',
  'Return: 서울특별시 강남구 신사동 643-18',
].join('\n');

interface ParsedStopFixture {
  order: number;
  arrivalTime: string;
  departureTime: string;
  name: string;
  purpose: string;
  sourceName: string;
  sourcePurpose: string;
  sourceRegion: string;
  roadAddress: string;
  jibunAddress: string;
  naverMapUrl: string;
  optional: boolean;
  includeInRoute: boolean;
  addressVerified: boolean;
  lat: number;
  lng: number;
}

interface ParsedScheduleFixture {
  serviceDate: string;
  startTime: string;
  endTime: string;
  departureAddress: string;
  returnAddress: string;
  needsConfirm: boolean;
  conflicts: unknown[];
  warnings: string[];
  stops: ParsedStopFixture[];
}

interface QuoteScenarioState {
  parseRequests: Array<Record<string, unknown>>;
  previewRequests: VehicleQuotePreviewRequest[];
}

async function prepareOfflineQuoteHarness(page: Page) {
  const leakedApiRequests: string[] = [];
  const blockedExternalRequests: string[] = [];

  await page.addInitScript(() => {
    window.localStorage.setItem('cocotrip_lang', 'ko');
    const testWindow = window as typeof window & { __moodQuoteClipboard?: string };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          testWindow.__moodQuoteClipboard = value;
        },
      },
    });
  });

  await page.route('**/api/**', async (route) => {
    leakedApiRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await page.route('https://www.googleapis.com/identitytoolkit/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizedDomains: ['localhost', '127.0.0.1'] }),
    });
  });
  await page.route(/https:\/\/(securetoken\.googleapis\.com|www\.paypal\.com|www\.paypalobjects\.com)\/.*/, async (route) => {
    blockedExternalRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });

  return { leakedApiRequests, blockedExternalRequests };
}

async function openQuoteHarness(page: Page) {
  const network = await prepareOfflineQuoteHarness(page);
  await page.goto('/mood/dev-ui');
  const builder = page.getByTestId('mood-vehicle-quote-builder');
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel('업체 선택')).toHaveValue('mood-default');
  return { builder, ...network };
}

async function installQuoteScenario(page: Page, parsed: ParsedScheduleFixture) {
  await page.evaluate((fixture) => {
    type BrowserScenarioState = {
      parseRequests: Array<Record<string, unknown>>;
      previewRequests: Array<Record<string, unknown>>;
    };
    type ScenarioWindow = typeof window & {
      __moodKoreanQuoteScenario?: BrowserScenarioState;
    };

    const scenarioWindow = window as ScenarioWindow;
    const harnessFetch = window.fetch.bind(window);
    scenarioWindow.__moodKoreanQuoteScenario = { parseRequests: [], previewRequests: [] };

    window.fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};

      if (url.includes('/api/mood-quote-parse')) {
        scenarioWindow.__moodKoreanQuoteScenario?.parseRequests.push(body);
        return new Response(JSON.stringify({ ok: true, data: fixture }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/mood-quote-preview')) {
        scenarioWindow.__moodKoreanQuoteScenario?.previewRequests.push(body);
      }
      return harnessFetch(input, init);
    };
  }, parsed);
}

async function analyzeSource(builder: Locator, source: string) {
  const sourceTextarea = builder.getByLabel('받은 일정 전체 붙여넣기');
  await sourceTextarea.fill(source);
  await builder.getByRole('button', { name: '일정 분석' }).click();
  await expect(builder.getByRole('article', { name: '장소 1' })).toBeVisible();
  await expect(sourceTextarea).toHaveValue(source);
  return builder.getByRole('article', { name: '장소 1' });
}

async function generateAcceptancePreview(builder: Locator) {
  await builder.getByRole('button', { name: '시간·장소 확인 완료' }).click();
  const addressChecks = builder.getByLabel('주소 확인 완료');
  for (let index = 0; index < await addressChecks.count(); index += 1) {
    await addressChecks.nth(index).check();
  }
  await builder.getByLabel('거리 직접 입력').check();
  await builder.getByLabel('예상 거리(km)').fill('125');
  await builder.getByLabel('예상 통행료(원)').fill('20000');
  await builder.getByLabel('예상 주차비(원)').fill('10000');
  await builder.getByRole('button', { name: '견적서 미리보기' }).click();

  const preview = builder.getByTestId('mood-vehicle-quote-preview');
  await expect(preview).toBeVisible();
  return preview;
}

async function quoteScenarioState(page: Page): Promise<QuoteScenarioState> {
  return page.evaluate(() => {
    type ScenarioWindow = typeof window & {
      __moodKoreanQuoteScenario?: {
        parseRequests: Array<Record<string, unknown>>;
        previewRequests: VehicleQuotePreviewRequest[];
      };
    };
    const state = (window as ScenarioWindow).__moodKoreanQuoteScenario;
    return {
      parseRequests: state?.parseRequests || [],
      previewRequests: state?.previewRequests || [],
    };
  });
}

async function copiedQuoteText(page: Page, preview: Locator) {
  await preview.getByRole('button', { name: '전체 일정·견적 복사' }).click();
  await expect(preview.getByRole('status')).toHaveText('복사했습니다.');
  return page.evaluate(() => (
    (window as typeof window & { __moodQuoteClipboard?: string }).__moodQuoteClipboard || ''
  ));
}

test.describe('MOOD 고객 견적서 한글 표시 경계', () => {
  test.skip(!runsAgainstLocalDev, '개발 전용 /mood/dev-ui 하네스에서만 실행합니다.');

  test('영문 원문은 감사 입력에 남기고 한글 장소명·내용만 고객 문서로 보낸다', async ({ page }) => {
    const { builder, leakedApiRequests, blockedExternalRequests } = await openQuoteHarness(page);
    const parsed: ParsedScheduleFixture = {
      serviceDate: '2026-09-01',
      startTime: '08:00',
      endTime: '20:00',
      departureAddress: '서울특별시 강남구 신사동 643-18',
      returnAddress: '서울특별시 강남구 신사동 643-18',
      needsConfirm: true,
      conflicts: [],
      warnings: ['한글 장소명·일정 내용, 주소와 시간을 직접 확인해 주세요.'],
      stops: [{
        order: 1,
        arrivalTime: '10:00',
        departureTime: '12:00',
        name: '기원 위스키 증류소',
        purpose: '위스키 협업 조사 및 미팅',
        sourceName: 'KI ONE WHISKY DISTILLERY',
        sourcePurpose: 'Whiskey collaboration research meeting',
        sourceRegion: 'Namyangju',
        roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
        jibunAddress: '경기도 남양주시 화도읍 녹촌리 384-20',
        naverMapUrl: 'https://naver.me/Fx2gIj9B',
        optional: false,
        includeInRoute: true,
        addressVerified: false,
        lat: 37.661,
        lng: 127.352,
      }],
    };
    await installQuoteScenario(page, parsed);

    const stop = await analyzeSource(builder, SUCCESS_SOURCE);
    await expect(stop.getByLabel('장소명')).toHaveValue('기원 위스키 증류소');
    await expect(stop.getByLabel('일정 내용')).toHaveValue('위스키 협업 조사 및 미팅');
    await expect(stop.getByLabel('도로명 주소')).toHaveValue('경기도 남양주시 화도읍 녹촌로 259-18');
    await expect(stop.getByLabel('지번 주소')).toHaveValue('경기도 남양주시 화도읍 녹촌리 384-20');
    await expect(stop.getByLabel('네이버 지도 링크')).toHaveValue('https://naver.me/Fx2gIj9B');

    const preview = await generateAcceptancePreview(builder);
    const documentText = await preview.locator('[data-mood-quote-print-document]').textContent() || '';
    expect(documentText).toContain('기원 위스키 증류소');
    expect(documentText).toContain('위스키 협업 조사 및 미팅');
    expect(documentText).toContain('경기도 남양주시 화도읍 녹촌로 259-18');
    expect(documentText).toContain('경기도 남양주시 화도읍 녹촌리 384-20');
    expect(documentText).toContain('https://naver.me/Fx2gIj9B');
    expect(documentText).not.toContain('KI ONE WHISKY DISTILLERY');
    expect(documentText).not.toContain('Whiskey collaboration research meeting');

    const copiedText = await copiedQuoteText(page, preview);
    expect(copiedText).toBe(documentText);
    expect(copiedText).not.toContain('KI ONE WHISKY DISTILLERY');
    expect(copiedText).not.toContain('Whiskey collaboration research meeting');

    const state = await quoteScenarioState(page);
    expect(state.parseRequests).toEqual([{ text: SUCCESS_SOURCE }]);
    expect(state.previewRequests).toHaveLength(1);
    const previewStop = state.previewRequests[0].stops[0];
    expect(previewStop).toMatchObject({
      name: '기원 위스키 증류소',
      purpose: '위스키 협업 조사 및 미팅',
      roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
      jibunAddress: '경기도 남양주시 화도읍 녹촌리 384-20',
      naverMapUrl: 'https://naver.me/Fx2gIj9B',
    });
    expect(previewStop).not.toHaveProperty('sourceName');
    expect(previewStop).not.toHaveProperty('sourcePurpose');
    expect(JSON.stringify(state.previewRequests[0])).not.toContain('KI ONE WHISKY DISTILLERY');
    expect(JSON.stringify(state.previewRequests[0])).not.toContain('Whiskey collaboration research meeting');
    expect(leakedApiRequests).toEqual([]);
    expect(blockedExternalRequests).toEqual([]);
  });

  test('한글 변환 실패 시 영문 원문 대신 빈 관리값과 확인 필요 문구로 막는다', async ({ page }) => {
    const { builder, leakedApiRequests, blockedExternalRequests } = await openQuoteHarness(page);
    const parsed: ParsedScheduleFixture = {
      serviceDate: '2026-09-01',
      startTime: '08:00',
      endTime: '20:00',
      departureAddress: '서울특별시 강남구 신사동 643-18',
      returnAddress: '서울특별시 강남구 신사동 643-18',
      needsConfirm: true,
      conflicts: [],
      warnings: [
        '1번 장소명을 한글로 변환하지 못했습니다. 원문을 보고 한글 장소명을 직접 확인해 주세요.',
        '1번 일정 내용을 한글로 변환하지 못했습니다. 원문을 보고 한글 내용을 직접 확인해 주세요.',
      ],
      stops: [{
        order: 1,
        arrivalTime: '14:30',
        departureTime: '16:00',
        name: '',
        purpose: '',
        sourceName: 'THE ROOF',
        sourcePurpose: 'Client meeting',
        sourceRegion: 'Seoul',
        roadAddress: '서울특별시 용산구 독서당로35길 4, 4층',
        jibunAddress: '서울특별시 용산구 한남동 60-24',
        naverMapUrl: 'https://naver.me/5eDY0Qr4',
        optional: false,
        includeInRoute: true,
        addressVerified: false,
        lat: 37.535,
        lng: 127.01,
      }],
    };
    await installQuoteScenario(page, parsed);

    const stop = await analyzeSource(builder, FAILED_TRANSLATION_SOURCE);
    await expect(stop.getByLabel('장소명')).toHaveValue('');
    await expect(stop.getByLabel('일정 내용')).toHaveValue('');
    await expect(stop.getByLabel('도로명 주소')).toHaveValue('서울특별시 용산구 독서당로35길 4, 4층');
    await expect(stop.getByLabel('지번 주소')).toHaveValue('서울특별시 용산구 한남동 60-24');
    await expect(stop.getByLabel('네이버 지도 링크')).toHaveValue('https://naver.me/5eDY0Qr4');
    await expect(builder).toContainText('1번 장소명을 한글로 변환하지 못했습니다.');
    await expect(builder).toContainText('1번 일정 내용을 한글로 변환하지 못했습니다.');

    const preview = await generateAcceptancePreview(builder);
    const documentText = await preview.locator('[data-mood-quote-print-document]').textContent() || '';
    expect(documentText).toContain('확인 필요');
    expect(documentText).toContain('서울특별시 용산구 독서당로35길 4, 4층');
    expect(documentText).toContain('서울특별시 용산구 한남동 60-24');
    expect(documentText).toContain('https://naver.me/5eDY0Qr4');
    expect(documentText).not.toContain('THE ROOF');
    expect(documentText).not.toContain('Client meeting');

    const copiedText = await copiedQuoteText(page, preview);
    expect(copiedText).toBe(documentText);
    expect(copiedText).not.toContain('THE ROOF');
    expect(copiedText).not.toContain('Client meeting');

    const state = await quoteScenarioState(page);
    expect(state.parseRequests).toEqual([{ text: FAILED_TRANSLATION_SOURCE }]);
    expect(state.previewRequests).toHaveLength(1);
    const previewStop = state.previewRequests[0].stops[0];
    expect(previewStop).toMatchObject({
      name: '',
      purpose: '',
      roadAddress: '서울특별시 용산구 독서당로35길 4, 4층',
      jibunAddress: '서울특별시 용산구 한남동 60-24',
      naverMapUrl: 'https://naver.me/5eDY0Qr4',
    });
    expect(previewStop).not.toHaveProperty('sourceName');
    expect(previewStop).not.toHaveProperty('sourcePurpose');
    expect(JSON.stringify(state.previewRequests[0])).not.toContain('THE ROOF');
    expect(JSON.stringify(state.previewRequests[0])).not.toContain('Client meeting');
    expect(leakedApiRequests).toEqual([]);
    expect(blockedExternalRequests).toEqual([]);
  });
});
