import { expect, test } from '@playwright/test';

// Local synthetic preview only: never log in, read customer records, or send messages.
for (const width of [390, 1280]) {
  for (const language of ['ko', 'en', 'ja', 'zh']) {
    test(`channel readiness ${language} ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Local DEV harness only');
      await page.setViewportSize({ width, height: 844 });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) return route.abort();
        return route.continue();
      });
      await page.addInitScript((lang) => localStorage.setItem('cocotrip_lang', lang), language);
      await page.goto('/admin/preview-ai-center');
      const panel = page.getByTestId('channel-readiness');
      const toggle = panel.locator('summary');
      await expect(toggle).toBeVisible();
      await expect(panel).not.toHaveAttribute('open');
      await toggle.click();
      await expect(panel).toHaveAttribute('open', '');
      await expect(panel.locator('section')).toHaveCount(6);
      await expect(panel.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible();
      const layout = await panel.evaluate((element) => {
        const button = element.querySelector('summary')!;
        const width = document.documentElement.clientWidth;
        return { touchHeight: button.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > width,
          clipped: [...element.querySelectorAll('section')].some((item) => item.getBoundingClientRect().right > width) };
      });
      expect(layout.touchHeight).toBeGreaterThanOrEqual(44);
      expect(layout.overflow).toBe(false);
      expect(layout.clipped).toBe(false);
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(toggle).toBeFocused();
      expect(await toggle.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      if (language === 'ko') await panel.screenshot({ path: testInfo.outputPath(`channels-${width}.png`) });
      await page.keyboard.press('Enter');
      await expect(panel).not.toHaveAttribute('open');
    });
  }
}
