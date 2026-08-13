import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type FeedState = 'normal' | 'empty' | 'error' | 'loading';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const STATES: FeedState[] = ['normal', 'empty', 'error', 'loading'];

const COPY = {
  ko: { title: '서울에서 조용히 걷기 좋은 곳', body: '아침 산책에 좋은 장소를 공유해요.', empty: '첫 글의 주인공이 되어보세요', error: '커뮤니티 피드를 불러오지 못했어요.', loading: '커뮤니티 글을 불러오는 중', retry: '다시 시도' },
  en: { title: 'A quiet walk in Seoul', body: 'A calm place for an early walk.', empty: 'Be the first to post', error: 'Could not load the community feed.', loading: 'Loading community posts', retry: 'Try again' },
  ja: { title: 'ソウルで静かに歩ける場所', body: '朝の散歩に向く場所を共有します。', empty: '最初の投稿者になりましょう', error: 'フィードを読み込めませんでした。', loading: 'コミュニティの投稿を読み込んでいます', retry: '再試行' },
  zh: { title: '首尔适合安静散步的地方', body: '分享一个适合清晨散步的地点。', empty: '来发布第一条帖子吧', error: '无法加载社区动态。', loading: '正在加载社区帖子', retry: '重试' },
} as const;

function postFixture(language: Language) {
  return {
    id: `fixture-${language}`,
    title: COPY[language].title,
    body: COPY[language].body,
    lang: language,
    type: 'tip',
    category: 'seoul',
    authorName: 'Coco traveler',
    isOwn: false,
    likeCount: 2,
    replyCount: 1,
    createdAt: 1786464000000,
    translations: {},
    images: [],
  };
}

async function installLanguage(page: Page, language: Language) {
  await page.addInitScript((value) => {
    const applyRefinedTheme = () => document.documentElement.classList.add('refined');
    if (document.documentElement) applyRefinedTheme();
    else document.addEventListener('DOMContentLoaded', applyRefinedTheme, { once: true });
    window.localStorage.setItem('cocotrip_lang', value);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  }, language);
}

async function isolateExternalFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: '',
  }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
}

async function fulfillFeed(route: Route, state: FeedState, language: Language) {
  if (state === 'loading') return new Promise<void>(() => {});
  if (state === 'error') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'fixture-error' }) });
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { posts: state === 'empty' ? [] : [postFixture(language)] } }),
  });
}

async function assertGeometry(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const controls = page.locator('.community-app button:visible, .community-app a:visible, .community-app input:visible, .community-app textarea:visible, .community-app select:visible');
  const sizes = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      tag: element.tagName,
      width: rect.width,
      height: rect.height,
      fontSize: Number(style.fontSize.replace('px', '')),
      backgroundImage: style.backgroundImage,
    };
  }));
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  expect(sizes.filter(({ tag }) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)).every(({ fontSize }) => fontSize >= 16)).toBe(true);
  expect(sizes.every(({ backgroundImage }) => !backgroundImage.includes('gradient'))).toBe(true);
}

async function assertVisibleFocus(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.focus();
  await expect.poll(() => target.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none'
      && Number.parseFloat(style.outlineWidth) > 0
      && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);
}

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} community feed and signed-out compose`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
      await isolateExternalFonts(page);
      let activeState: FeedState = 'normal';
      let writes = 0;
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];

      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const location = message.location();
        consoleErrors.push(location.url ? `${message.text()} @ ${location.url}` : message.text());
      });
      page.on('request', (request) => {
        if (request.method() !== 'GET' && request.method() !== 'HEAD' && request.method() !== 'OPTIONS') writes += 1;
      });
      await page.route('**/api/community-posts?**', (route) => fulfillFeed(route, activeState, language));

      for (const state of STATES) {
        activeState = state;
        await page.goto('/community', { waitUntil: 'domcontentloaded' });
        if (state === 'normal') await expect(page.getByRole('heading', { name: COPY[language].title })).toBeVisible();
        if (state === 'empty') {
          const empty = page.getByTestId('community-feed-empty');
          await expect(empty).toContainText(COPY[language].empty);
          await assertVisibleFocus(page, '[data-testid="community-feed-empty"] .community-primary-button');
        }
        if (state === 'error') {
          const error = page.getByTestId('community-feed-error');
          await expect(error).toContainText(COPY[language].error);
          activeState = 'empty';
          await error.getByRole('button', { name: COPY[language].retry }).click();
          await expect(page.getByTestId('community-feed-empty')).toContainText(COPY[language].empty);
        }
        if (state === 'loading') await expect(page.getByTestId('community-feed-loading')).toContainText(COPY[language].loading);
        await assertGeometry(page);
      }

      const languageButton = page.locator('.community-language-button');
      const visibleLanguage = (await languageButton.innerText()).trim();
      await expect(languageButton).toHaveAttribute('aria-label', new RegExp(visibleLanguage));
      expect(await languageButton.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

      await page.goto('/community/new', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('community-compose-signed-out')).toBeVisible();
      await assertGeometry(page);

      expect(writes).toBe(0);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }
}

test('dev-only compose harness renders the real form without network writes', async ({ page }) => {
  test.skip(process.env.COMMUNITY_DEV_HARNESS !== '1', 'run against the local Vite dev server with COMMUNITY_DEV_HARNESS=1');
  await page.setViewportSize({ width: 390, height: 844 });
  await installLanguage(page, 'en');
  await isolateExternalFonts(page);
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD' && request.method() !== 'OPTIONS') writes += 1;
  });

  await page.goto('/community/new?__fixture=compose', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Title')).toBeVisible();
  await expect(page.getByLabel('Details')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await assertVisibleFocus(page, '.community-segmented-control [role="radio"][aria-checked="true"]');
  await assertGeometry(page);
  expect(writes).toBe(0);
});
