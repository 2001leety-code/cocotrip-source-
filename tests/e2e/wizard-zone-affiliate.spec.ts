/**
 * E2E: WizardForm ZoneRecommender + Trip.com sponsored CTA.
 *
 * Covers PRs #152 (CTA), #153 (zones for 7 more cities), and the
 * keyword-fallback URL builder for cities outside CITY_IDS.
 *
 * Drives the wizard via UI in EN (matches the prod default locale for
 * non-Korean visitors). Cookie banner is dismissed up front. We stop at
 * Step 3 (details) — no Gemini, no PayPal, no plan generation.
 */
import { test, expect, type Page } from '@playwright/test';

async function dismissCookieBanner(page: Page) {
  const accept = page.getByRole('button', { name: /^(Accept|Dismiss)$/ }).first();
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click();
    await page.waitForTimeout(300);
  }
}

/**
 * Walk the wizard from Step 0 → Step 3 (details), where ZoneRecommender
 * lives. Picks "Nothing booked yet" so wantAccom doesn't override.
 */
async function navigateToStep3(page: Page, mainCityEn: string, activityRegex: RegExp) {
  await page.goto('/planner', { waitUntil: 'load' });
  await dismissCookieBanner(page);

  // Step 0: pick Nothing-booked → Continue
  await page.getByRole('button', { name: /Nothing booked yet/i }).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await page.waitForTimeout(800);

  // Step 1: city + activity. The next-step button is labeled with the
  // step-2 heading, so click whatever leads to "food" by exact role match.
  await page.getByRole('button', { name: new RegExp(`^${mainCityEn}`, 'i') }).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: activityRegex }).first().click();
  await page.waitForTimeout(200);
  // Use exact match — the step indicator button shares the text but is
  // prefixed with the step number ("3 Tell us…"), so exact disambiguates.
  await page.getByRole('button', { name: 'Tell us your food preferences', exact: true }).click();
  await page.waitForTimeout(800);

  // Step 2 (food): the next button is labeled with the next step's heading:
  // "Travel Dates". Same disambiguation as above.
  await page.getByRole('button', { name: 'Travel Dates', exact: true }).click();
  await page.waitForTimeout(800);
}

test.describe('ZoneRecommender + Trip.com CTA', () => {
  test('Seoul → Myeongdong shows Trip.com CTA with city=274', async ({ page }) => {
    await navigateToStep3(page, 'Seoul', /Food Tour/i);

    // Zone cards render
    await expect(page.getByText('Myeongdong', { exact: false }).first()).toBeVisible({ timeout: 5000 });

    // Click Myeongdong card
    await page.locator('button', { hasText: 'Myeongdong' }).first().click();
    await page.waitForTimeout(300);

    // CTA appears with Trip.com URL containing Seoul city ID + 명동 keyword
    const cta = page.locator('a[href*="trip.com/hotels"]').first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).toContain('city=274');
    expect(href).toContain('keyword=%EB%AA%85%EB%8F%99'); // 명동 url-encoded
    expect(href).toContain('Allianceid=4831212');
    expect(await cta.getAttribute('rel')).toContain('sponsored');
  });

  test('Jeonju (no Trip.com city ID) → keyword fallback URL', async ({ page }) => {
    await navigateToStep3(page, 'Jeonju', /Food Tour/i);

    // PR #153 zones render (en: "Hanok Village", "Gaengnidan-gil")
    await expect(page.getByText('Hanok Village', { exact: false }).first()).toBeVisible({ timeout: 5000 });

    // Click Hanok Village card
    await page.locator('button', { hasText: 'Hanok Village' }).first().click();
    await page.waitForTimeout(300);

    // URL falls back to keyword-only (no city= param) prefixed with city name
    const cta = page.locator('a[href*="trip.com/hotels"]').first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).not.toContain('city=');  // no numeric city ID for Jeonju
    expect(href).toContain('keyword=');
    expect(href).toContain('%EC%A0%84%EC%A3%BC');  // 전주 prefix
    expect(href).toContain('%ED%95%9C%EC%98%A5%EB%A7%88%EC%9D%84');  // 한옥마을
  });

  test('Gangneung zones render (PR #153 coverage check)', async ({ page }) => {
    await navigateToStep3(page, 'Gangneung', /Food Tour/i);

    await expect(page.getByText(/Gyeongpo|Anmok/i).first()).toBeVisible({ timeout: 5000 });
    // KTX Gangneung Station zone
    await expect(page.getByText(/KTX|Gangneung Station/i).first()).toBeVisible();
  });
});
