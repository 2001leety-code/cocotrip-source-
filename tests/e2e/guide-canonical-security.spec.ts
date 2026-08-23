// ⚠️ analytics guard fixture prevents local verification traffic from polluting GA4/PostHog.
import { test, expect } from './fixtures/analytics-guard';

const SLUG = 'best-seoul-street-food-markets-2026';
const CANONICAL = `https://cocotripkr.com/guide/${SLUG}`;
const TITLE = 'Seoul Night Markets & Street Food 2026: Gwangjang, Myeongdong, Mangwon';
const DESCRIPTION = 'Compare must-try food, opening hours, typical prices, cash/card and ordering tips for Gwangjang, Myeongdong and Mangwon markets in Seoul in 2026.';

test.describe('guide canonical + safe renderer', () => {
  test('상세 메타·JSON-LD·본문 안전·모바일 폭이 같은 정본을 가리킨다', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`/guide/${SLUG}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('guide-article')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
    await expect(page.getByText('Updated 2026-08-23', { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', DESCRIPTION);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', CANONICAL);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', CANONICAL);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');

    const articleJson = JSON.parse(await page.locator('script#guide-article').textContent() || '{}');
    expect(articleJson.mainEntityOfPage['@id']).toBe(CANONICAL);
    expect(articleJson.headline).toBe(TITLE);
    expect(articleJson.dateModified).toBe('2026-08-23');

    const prose = page.locator('.ec-prose');
    await expect(prose).toBeVisible();
    await expect(prose.locator('script, style, iframe, form, input, svg, template')).toHaveCount(0);
    await expect(prose.locator('[onclick], [onerror], [style], [srcset]')).toHaveCount(0);
    expect(await prose.locator('a, img').evaluateAll((nodes) => nodes.every((node) => {
      const value = node.getAttribute(node.tagName === 'A' ? 'href' : 'src') || '';
      return !/^\s*(?:javascript|data):/i.test(value);
    }))).toBe(true);

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.documentElement.clientWidth,
      article: Math.ceil(document.querySelector('[data-testid="guide-article"]')?.getBoundingClientRect().right || 0)
        - document.documentElement.clientWidth,
    }));
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.article).toBeLessThanOrEqual(1);
    await expect(page.locator('meta[name="cocotrip:content-sha256"]')).toHaveCount(0);

    // SPA 전환에서도 이전 Brain hash가 legacy/index 페이지에 남지 않아야 한다.
    await page.evaluate(() => {
      const stale = document.createElement('meta');
      stale.name = 'cocotrip:content-sha256';
      stale.content = 'a'.repeat(64);
      document.head.appendChild(stale);
    });
    await page.locator('a[href="/guide"]').first().click();
    await expect(page).toHaveURL(/\/guide$/);
    await expect(page.locator('meta[name="cocotrip:content-sha256"]')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('a[href="/guide/4-seoul-cafe-neighborhoods-worth-your"]')).toHaveCount(0);
    await expect(page.locator('a[href="/guide/seoul-cafe-guide-2026-best"]')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
  });
});
