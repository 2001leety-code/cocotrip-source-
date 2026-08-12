import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type PricingSpec = {
  airport_transfer_prices: Record<string, unknown>;
  daily_tour_prices: Record<string, unknown>;
  distance_matrix: Record<string, { km?: number } | string>;
  kpop_shuttle: { venues: unknown[] };
};

const PRICING_SPEC = JSON.parse(
  readFileSync(join(process.cwd(), 'src/data/pricing_spec.json'), 'utf8'),
) as PricingSpec;
const AIRPORT_DESTINATION_COUNT = Object.keys(PRICING_SPEC.airport_transfer_prices)
  .filter((key) => key !== 'comment').length;
const DAY_TOUR_DESTINATION_COUNT = Object.keys(PRICING_SPEC.daily_tour_prices)
  .filter((key) => key !== 'comment').length;

const LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;
type Language = (typeof LANGUAGES)[number];

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const NEXT: Record<Language, string> = {
  ko: '다음',
  en: 'Next',
  ja: '次へ',
  zh: '下一步',
};

const AIRPORT_EDGE_TITLES: Record<Language, [string, string]> = {
  ko: ['서울 도심 (명동·홍대·종로·용산)', '제주 시내 (CJU 픽업)'],
  en: ['Seoul City Center (Myeongdong, Hongdae, Jongno)', 'Jeju Metro (CJU pickup)'],
  ja: ['ソウル都心（明洞・弘大・鍾路・龍山）', '済州市内（済州空港発）'],
  zh: ['首尔市中心（明洞·弘大·钟路·龙山）', '济州市区（济州机场出发）'],
};

const AIRPORT_ENGLISH_TITLES = [
  'Seoul City Center (Myeongdong, Hongdae, Jongno)',
  'Seoul Gangnam / Jamsil / Songpa',
  'Suwon / Yongin',
  'Gapyeong / Nami Island',
  'Chuncheon',
  'Pyeongchang / Yongpyong / Alpensia',
  'Gangneung / Sokcho',
  'Busan (ICN Direct)',
  'Busan Metro (PUS pickup)',
  'Seoul City Center (GMP pickup)',
  'Seoul Gangnam (GMP pickup)',
  'Jeju Metro (CJU pickup)',
];

const SERVICE_EXPECTATIONS = {
  day_tour: {
    count: 7,
    ja: ['ソウル市内ツアー', '釜山日帰りツアー'],
    zh: ['首尔市区一日游', '釜山一日游'],
  },
  multi_day: {
    count: 10,
    ja: ['江陵', '大邱'],
    zh: ['江陵', '大邱'],
  },
  kpop_shuttle: {
    count: 5,
    ja: ['インスパイア・アリーナ', '水原ワールドカップ競技場'],
    zh: ['INSPIRE综艺馆', '水原世界杯体育场'],
  },
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function installLanguage(page: Page, language: Language) {
  await page.addInitScript((nextLanguage) => {
    window.localStorage.clear();
    window.localStorage.setItem('cocotrip_lang', nextLanguage);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    window.localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, language);
}

async function clickNext(page: Page, language: Language) {
  const button = page
    .locator('button:visible')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(NEXT[language])}\\s*$`) })
    .first();
  await expect(button).toBeEnabled();
  await button.click();
}

async function openStep3(
  page: Page,
  language: Language,
  origin: 'ICN' | 'SEL_METRO',
  service: 'airport_transfer' | 'day_tour' | 'multi_day' | 'kpop_shuttle',
) {
  await page.goto('/charter', { waitUntil: 'domcontentloaded' });
  await page.locator(`button[data-origin-code="${origin}"]`).click();
  await clickNext(page, language);
  await page.locator(`button[data-service="${service}"]`).click();
  await clickNext(page, language);
  await expect(page.getByTestId('charter-destination-grid')).toBeVisible();
}

async function destinationTitles(page: Page): Promise<string[]> {
  return page.getByTestId('charter-destination-card').evaluateAll((cards) =>
    cards.map((card) => card.querySelector('p')?.textContent?.trim() || ''),
  );
}

async function expectSafeGeometry(page: Page, context: string) {
  const cards = page.getByTestId('charter-destination-card');
  const metrics = await cards.evaluateAll((elements) => elements.map((element) => {
    const cardRect = element.getBoundingClientRect();
    const title = element.querySelector('p');
    const titleStyle = title ? getComputedStyle(title) : null;
    return {
      width: cardRect.width,
      height: cardRect.height,
      titleClientHeight: title?.clientHeight || 0,
      titleScrollHeight: title?.scrollHeight || 0,
      titleLineHeight: titleStyle ? parseFloat(titleStyle.lineHeight) : 0,
      lineClamp: titleStyle?.webkitLineClamp || '',
    };
  }));

  expect(metrics.length, `${context}: 목적지 카드 없음`).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.width, `${context}: 카드 너비 44px 미만`).toBeGreaterThanOrEqual(44);
    expect(metric.height, `${context}: 카드 높이 44px 미만`).toBeGreaterThanOrEqual(44);
    expect(metric.lineClamp, `${context}: 제목 두 줄 계약`).toBe('2');
    expect(metric.titleClientHeight, `${context}: 제목 높이가 두 줄보다 작음`).toBeGreaterThanOrEqual(metric.titleLineHeight * 2 - 1);
    expect(metric.titleScrollHeight, `${context}: 제목 잘림`).toBeLessThanOrEqual(metric.titleClientHeight + 1);
  }

  const pageMetrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    inputFonts: Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => parseFloat(getComputedStyle(element).fontSize)),
  }));
  expect(pageMetrics.scrollWidth, `${context}: 가로 넘침`).toBeLessThanOrEqual(pageMetrics.innerWidth + 1);
  expect(pageMetrics.inputFonts.length, `${context}: 표시 중인 입력 없음`).toBeGreaterThan(0);
  expect(Math.min(...pageMetrics.inputFonts), `${context}: 입력 글자 16px 미만`).toBeGreaterThanOrEqual(16);
}

test.describe('/charter Step3 표시 언어와 반응형 계약', () => {
  for (const viewport of VIEWPORTS) {
    for (const language of LANGUAGES) {
      test(`${viewport.width}px · ${language} · 공항 목적지 12개`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'Desktop Chrome', '뷰포트를 직접 지정하는 단일 프로젝트 검사');
        await page.setViewportSize(viewport);
        await installLanguage(page, language);

        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        const ownDomainErrors: string[] = [];
        const writes: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(String(error)));
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('response', (response) => {
          const requestUrl = new URL(response.url());
          const pageUrl = page.url() === 'about:blank' ? null : new URL(page.url());
          if (pageUrl && requestUrl.origin === pageUrl.origin && response.status() >= 400) {
            ownDomainErrors.push(`${response.status()} ${requestUrl.pathname}`);
          }
        });
        page.on('request', (request) => {
          const method = request.method();
          if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
          const requestUrl = new URL(request.url());
          const pageUrl = page.url() === 'about:blank' ? null : new URL(page.url());
          if (pageUrl && requestUrl.origin === pageUrl.origin) writes.push(`${method} ${requestUrl.pathname}`);
        });

        await openStep3(page, language, 'ICN', 'airport_transfer');
        const cards = page.getByTestId('charter-destination-card');
        await expect(cards).toHaveCount(AIRPORT_DESTINATION_COUNT);
        const titles = await destinationTitles(page);
        expect(titles[0]).toBe(AIRPORT_EDGE_TITLES[language][0]);
        expect(titles.at(-1)).toBe(AIRPORT_EDGE_TITLES[language][1]);
        if (language === 'ja' || language === 'zh') {
          for (const englishTitle of AIRPORT_ENGLISH_TITLES) expect(titles).not.toContain(englishTitle);
        }

        await expectSafeGeometry(page, `${viewport.width}/${language}`);
        await cards.first().click();
        await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
        expect(pageErrors, `${viewport.width}/${language}: pageerror`).toEqual([]);
        expect(consoleErrors, `${viewport.width}/${language}: console error`).toEqual([]);
        expect(ownDomainErrors, `${viewport.width}/${language}: 자체 도메인 4xx/5xx`).toEqual([]);
        expect(writes, `${viewport.width}/${language}: 운영 쓰기`).toEqual([]);

        if (viewport.width === 390 && language === 'ja') {
          await page.screenshot({ path: testInfo.outputPath('charter-step3-ja-390.png'), fullPage: true });
        }
      });
    }
  }

  for (const language of ['ja', 'zh'] as const) {
    test(`390px · ${language} · 당일/장거리/K-pop 표시 언어`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Desktop Chrome', '뷰포트를 직접 지정하는 단일 프로젝트 검사');
      await page.setViewportSize({ width: 390, height: 844 });
      await installLanguage(page, language);

      for (const service of ['day_tour', 'multi_day', 'kpop_shuttle'] as const) {
        await openStep3(page, language, 'SEL_METRO', service);
        const expectation = SERVICE_EXPECTATIONS[service];
        const expectedCount = service === 'day_tour'
          ? DAY_TOUR_DESTINATION_COUNT
          : service === 'kpop_shuttle'
          ? PRICING_SPEC.kpop_shuttle.venues.length
          : Object.entries(PRICING_SPEC.distance_matrix).filter(([key, value]) =>
              key.startsWith('SEL_METRO→') && typeof value !== 'string' && (value.km || 0) >= 100,
            ).length;
        const cards = page.getByTestId('charter-destination-card');
        expect(expectation.count).toBe(expectedCount);
        await expect(cards).toHaveCount(expectedCount);
        const titles = await destinationTitles(page);
        expect(titles[0]).toBe(expectation[language][0]);
        expect(titles.at(-1)).toBe(expectation[language][1]);
        expect(titles.some((title) => /^[A-Z_]+$/.test(title)), `${language}/${service}: 원시 코드 노출`).toBe(false);
        await expectSafeGeometry(page, `390/${language}/${service}`);
      }
    });
  }
});
