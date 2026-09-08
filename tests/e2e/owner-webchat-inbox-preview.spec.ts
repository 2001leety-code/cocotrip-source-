import { expect, test, isAnalyticsUrl } from './fixtures/analytics-guard';
import { adminWebchatInboxCopy } from '../../src/lib/adminWebchatInboxCopy';
import { adminOperationalChecksCopy } from '../../src/lib/adminOperationalChecks';

for (const width of [390, 1280]) for (const language of ['ko', 'en', 'ja', 'zh'] as const) {
  test(`owner webchat preview ${language} ${width}px`, async ({ page, baseURL }, testInfo) => {
    test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Local synthetic data only');
    const copy = adminWebchatInboxCopy[language];
    let apiCalls = 0;
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (isAnalyticsUrl(url.href)) return route.fallback();
      if (url.pathname.startsWith('/api/')) { apiCalls++; return route.abort(); }
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    await page.addInitScript(lang => localStorage.setItem('cocotrip_lang', lang), language);
    await page.goto('/admin/preview-ai-center');
    const panel = page.getByRole('region', { name: copy.title, exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(copy.readOnlyPreview)).toBeVisible();
    await panel.getByRole('button', { name: copy.show, exact: true }).first().click();
    await expect(panel.getByText('Can I ask a question about my travel plan? (Synthetic test)')).toBeVisible();
    const draft = panel.getByLabel(copy.replyLabel, { exact: true });
    await draft.fill('SYNTHETIC OWNER DRAFT — 실제 고객에게 보내지 않는 시험');
    await panel.getByRole('button', { name: copy.review, exact: true }).click();
    const confirm = panel.getByRole('button', { name: copy.confirmSend, exact: true });
    await expect(confirm).toBeDisabled();
    await expect(panel.getByText(copy.confirmHint)).toBeVisible();
    const metrics = await panel.evaluate(element => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      smallTargets: [...element.querySelectorAll('button')].filter(button => button.getBoundingClientRect().height < 44).length,
    }));
    expect(metrics).toEqual({ overflow: false, smallTargets: 0 });
    await panel.getByRole('button', { name: copy.cancel, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    if (language === 'ko') await panel.screenshot({ path: testInfo.outputPath(`webchat-${width}.png`) });
    const checksCopy = adminOperationalChecksCopy[language];
    const checks = page.getByRole('region', { name: checksCopy.title, exact: true });
    await expect(checks.getByRole('button', { name: new RegExp(checksCopy.expand) })).toHaveAttribute('aria-expanded', 'false');
    await checks.getByRole('button', { name: new RegExp(checksCopy.expand) }).click();
    await expect(checks.getByText(checksCopy.stale)).toBeVisible();
    await expect(checks.getByRole('link', { name: checksCopy.openRun })).toHaveCount(6);
    expect(await checks.evaluate(element => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      smallTargets: [...element.querySelectorAll('button, a, summary')].filter(target => target.getBoundingClientRect().height < 44).length,
    }))).toEqual({ overflow: false, smallTargets: 0 });
    if (language === 'ko') await checks.screenshot({ path: testInfo.outputPath(`checks-${width}.png`) });
    expect(apiCalls).toBe(0);
  });
}
