import { expect, test, isAnalyticsUrl } from './fixtures/analytics-guard';
import { adminExternalInboxCopy } from '../../src/lib/adminExternalInboxCopy';
import { adminAiOpsCopy } from '../../src/lib/adminAiOpsCopy';

for (const width of [390, 1280]) for (const language of ['ko', 'en', 'ja', 'zh'] as const) {
  test(`loaded inbox filters ${language} ${width}px`, async ({ page, baseURL }, testInfo) => {
    test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Local synthetic data only');
    const copy = adminExternalInboxCopy[language];
    let apiCalls = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (isAnalyticsUrl(url.href)) return route.fallback();
      if (url.pathname.startsWith('/api/')) { apiCalls++; return route.abort(); }
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    await page.addInitScript(lang => localStorage.setItem('cocotrip_lang', lang), language);
    await page.goto('/admin/preview-ai-center?inbox=synthetic');
    const opsCopy = adminAiOpsCopy[language];
    const notice = page.getByRole('note', { name: opsCopy.queryRangeLabel });
    await expect(notice).toContainText(opsCopy.queryRangeRecent(180));
    if (language === 'ko') await page.screenshot({ path: testInfo.outputPath(`scope-${width}.png`) });
    const panel = page.getByRole('region', { name: copy.title, exact: true });
    await expect(panel).toBeVisible();
    await panel.getByLabel(copy.channelLabel, { exact: true }).selectOption('whatsapp');
    await expect(panel.getByRole('button', { name: copy.show, exact: true })).toHaveCount(3);
    await panel.getByLabel(copy.orderLabel, { exact: true }).selectOption('oldest');
    await expect(panel.locator('li').first()).toContainText('synthetic-6@example.invalid');
    await panel.getByLabel(copy.searchLabel, { exact: true }).fill('NO_MATCH');
    await expect(panel.getByText(copy.noMatches)).toBeVisible();
    await panel.getByRole('button', { name: copy.clearFilters, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: copy.show, exact: true })).toHaveCount(5);
    await panel.getByRole('button', { name: copy.next, exact: true }).click();
    await expect(panel.getByRole('button', { name: copy.show, exact: true })).toHaveCount(2);
    await panel.getByLabel(copy.searchLabel, { exact: true }).fill('INQUIRY 1');
    await expect(panel.getByText('SYNTHETIC inquiry 1')).toBeVisible();
    await expect(panel.getByRole('button', { name: copy.next, exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: copy.show, exact: true }).click();
    await expect(panel.getByText('[Synthetic preview message]')).toBeVisible();
    await panel.getByLabel(copy.searchLabel, { exact: true }).fill('INQUIRY 3');
    await expect(panel.getByText('[Synthetic preview message]')).toHaveCount(0);
    const search = panel.getByLabel(copy.searchLabel, { exact: true });
    await search.focus();
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('button', { name: copy.clearFilters, exact: true })).toBeFocused();
    expect(await panel.evaluate(element => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      smallTargets: [...element.querySelectorAll('button,select,input')].filter(target => target.getBoundingClientRect().height < 44).length,
    }))).toEqual({ overflow: false, smallTargets: 0 });
    if (language === 'ko') {
      await panel.getByRole('button', { name: copy.clearFilters, exact: true }).click();
      await panel.getByLabel(copy.channelLabel, { exact: true }).selectOption('whatsapp');
      await panel.getByLabel(copy.searchLabel, { exact: true }).fill('synthetic-2');
      await panel.screenshot({ path: testInfo.outputPath(`filters-${width}.png`) });
    }
    expect(apiCalls).toBe(0);
    expect(errors).toEqual([]);
    expect(new URL(page.url()).search).toBe('?inbox=synthetic');
    if (language === 'ko') {
      await page.goto('/admin/preview-ai-center?query-range=limited');
      await expect(notice).toContainText(opsCopy.queryRangeLimited(180));
      await page.screenshot({ path: testInfo.outputPath(`scope-limited-${width}.png`) });
      await page.goto('/admin/preview-ai-center?scenario=partial-empty');
      await expect(notice).toContainText(opsCopy.queryRangeUnknown);
      expect(apiCalls).toBe(0);
      expect(errors).toEqual([]);
    }
  });
}
