import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type Language = 'ko' | 'en' | 'ja' | 'zh';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const REGION_IDS = ['ganghwa', 'seoul', 'incheon', 'jeonju', 'paju', 'gyeongju', 'danyang', 'busan', 'chuncheon'] as const;
const GALLERY_COUNTS: Record<(typeof REGION_IDS)[number], number> = {
  ganghwa: 18,
  seoul: 20,
  incheon: 8,
  jeonju: 21,
  paju: 8,
  gyeongju: 12,
  danyang: 10,
  busan: 8,
  chuncheon: 8,
};
const PLANNER_REGIONS = new Set(['seoul', 'incheon', 'jeonju', 'gyeongju', 'busan']);

const COPY = {
  ko: { title: '서울', notFound: '지역을 찾을 수 없습니다' },
  en: { title: 'Seoul', notFound: 'Region not found' },
  ja: { title: 'ソウル', notFound: '地域が見つかりません' },
  zh: { title: '首尔', notFound: '未找到地区' },
} as const;

async function installLanguage(page: Page, language: Language) {
  await page.addInitScript((value) => {
    const applyRefinedTheme = () => document.documentElement.classList.add('refined');
    if (document.documentElement) applyRefinedTheme();
    else document.addEventListener('DOMContentLoaded', applyRefinedTheme, { once: true });
    window.localStorage.setItem('cocotrip_lang', value);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  }, language);
}

async function isolateExternalAssets(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: '',
  }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
}

async function assertGeometry(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const controls = page.locator('.region-editorial-main button:visible, .region-editorial-main a:visible, .region-editorial-main input:visible, .region-editorial-main textarea:visible, .region-editorial-main select:visible');
  const sizes = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      tag: element.tagName,
      description: `${element.tagName}.${element.className} ${element.textContent || ''}`.trim(),
      width: rect.width,
      height: rect.height,
      fontSize: Number(style.fontSize.replace('px', '')),
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter,
    };
  }));
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
  expect(sizes.filter(({ tag }) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)).every(({ fontSize }) => fontSize >= 16)).toBe(true);
  expect(sizes.every(({ backgroundImage }) => !backgroundImage.includes('gradient'))).toBe(true);
  expect(sizes.every(({ backdropFilter }) => backdropFilter === 'none')).toBe(true);
}

async function assertVisibleFocus(page: Page) {
  const controls = page.locator('.region-editorial-main a:visible, .region-editorial-main button:visible');
  const target = controls.first();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  let reachedTarget = false;
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press('Tab');
    reachedTarget = await target.evaluate((element) => document.activeElement === element);
    if (reachedTarget) break;
  }
  expect(reachedTarget).toBe(true);
  await expect.poll(() => target.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle === 'solid'
      && Number.parseFloat(style.outlineWidth) >= 2
      && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);

  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    await control.focus();
    await expect.poll(() => control.evaluate((element) => {
      const style = getComputedStyle(element);
      const outlined = style.outlineStyle === 'solid'
        && Number.parseFloat(style.outlineWidth) >= 2
        && style.outlineColor !== 'rgba(0, 0, 0, 0)';
      return outlined || (style.boxShadow !== 'none' && style.boxShadow !== '');
    })).toBe(true);
  }
}

async function assertCtaEyebrowContrast(page: Page) {
  const ratio = await page.locator('.region-editorial-cta .ec-eyebrow').evaluate((element) => {
    const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
    const luminance = (rgb: number[]) => {
      const channels = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const foreground = luminance(parse(getComputedStyle(element).color));
    const background = luminance(parse(getComputedStyle(element.closest('.region-editorial-cta') as Element).backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} region detail and missing state`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
      await isolateExternalAssets(page);
      let writes = 0;
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const ownDomainErrors: string[] = [];

      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes += 1;
      });
      page.on('response', (response) => {
        const responseUrl = new URL(response.url());
        const appOrigin = new URL(process.env.BASE_URL || 'https://cocotripkr.com').origin;
        if (responseUrl.origin === appOrigin && response.status() >= 400) {
          ownDomainErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto('/region/seoul', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('region-detail-ready')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: COPY[language].title, exact: true })).toBeVisible();
      await expect(page).toHaveTitle(`${COPY[language].title} | CocoTrip`);
      await expect(page.locator('.region-editorial-gallery img')).toHaveCount(GALLERY_COUNTS.seoul);
      await expect(page.locator('.region-editorial-cta a[href="/planner"]')).toHaveCount(1);
      await assertGeometry(page);
      await assertVisibleFocus(page);
      await assertCtaEyebrowContrast(page);

      await page.goto('/region/not-a-region', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('region-detail-not-found')).toContainText(COPY[language].notFound);
      await assertGeometry(page);
      await assertVisibleFocus(page);

      await page.goto('/region/notFound', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('region-detail-not-found')).toContainText(COPY[language].notFound);

      await page.goto('/region/constructor', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('region-detail-not-found')).toContainText(COPY[language].notFound);
      await expect(page).toHaveTitle(`${COPY[language].notFound} | CocoTrip`);

      expect(writes).toBe(0);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(ownDomainErrors).toEqual([]);
    });
  }
}

test('all indexed region ids render route-owned content', async ({ page }) => {
  await installLanguage(page, 'en');
  await isolateExternalAssets(page);
  let writes = 0;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ownDomainErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes += 1;
  });
  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    const appOrigin = new URL(process.env.BASE_URL || 'https://cocotripkr.com').origin;
    if (responseUrl.origin === appOrigin && response.status() >= 400) {
      ownDomainErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  for (const regionId of REGION_IDS) {
    await page.goto(`/region/${regionId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('region-detail-ready')).toHaveAttribute('data-region-id', regionId);
    await expect(page.locator('.region-editorial-attraction')).toHaveCount(5);
    await expect(page.locator('.region-editorial-gallery img')).toHaveCount(GALLERY_COUNTS[regionId]);
    await expect(page.locator('.region-editorial-facts')).toContainText(`${GALLERY_COUNTS[regionId] + 1} photos`);
    await expect(page.locator('.region-editorial-cta a[href="/planner"]')).toHaveCount(PLANNER_REGIONS.has(regionId) ? 1 : 0);
    await page.locator('.region-editorial-gallery img').last().scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator('.region-editorial-gallery img').evaluateAll((images) => (
      images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)
    ))).toBe(true);
  }

  expect(writes).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(ownDomainErrors).toEqual([]);
});
