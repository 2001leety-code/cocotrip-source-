import { expect, test, isAnalyticsUrl } from "./fixtures/analytics-guard";
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { adminExternalInboxCopy } from "../../src/lib/adminExternalInboxCopy";

async function blockLiveRequests(page: Page) {
  let apiCalls = 0;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (isAnalyticsUrl(url.href)) return route.fallback();
    if (url.pathname.startsWith("/api/")) {
      apiCalls += 1;
      return route.abort();
    }
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return route.abort();
    return route.continue();
  });
  return () => apiCalls;
}

for (const width of [390, 1280])
  for (const language of ["ko", "en", "ja", "zh"] as const) {
    test(`synthetic retention workflow ${language} ${width}px`, async ({
      page,
      baseURL,
    }, testInfo) => {
      test.skip(
        !baseURL ||
          !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname),
        "Local synthetic data only",
      );
      const copy = adminExternalInboxCopy[language];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      const apiCalls = await blockLiveRequests(page);
      await page.addInitScript(
        (lang) => localStorage.setItem("cocotrip_lang", lang),
        language,
      );
      await page.goto("/admin/preview-ai-center?inbox=synthetic");
      const panel = page.getByRole("region", { name: copy.title, exact: true });
      await expect(panel).toBeVisible();
      await panel
        .getByRole("button", { name: copy.show, exact: true })
        .first()
        .click();
      await expect(
        panel.getByText(copy.retentionTitle, { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByText(copy.retentionStatus.open, { exact: true }),
      ).toBeVisible();
      const confirmation = panel.getByRole("checkbox", {
        name: copy.closeConfirm,
        exact: true,
      });
      await expect(confirmation).not.toBeChecked();
      expect(
        await confirmation.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
      expect(
        await confirmation.evaluate(
          (element) =>
            element.closest("label")?.getBoundingClientRect().height || 0,
        ),
      ).toBeGreaterThanOrEqual(44);
      if (language === "ko" && testInfo.project.name === "Desktop Chrome") {
        const directory = resolve(
          process.cwd(),
          "tests",
          "artifacts",
          "retention-20260909",
        );
        await mkdir(directory, { recursive: true });
        await panel.screenshot({
          path: resolve(directory, `ko-${width}-open.png`),
        });
      }
      await confirmation.check();
      await panel
        .getByRole("button", { name: copy.closeCase, exact: true })
        .click();
      await expect(
        panel.getByText(copy.retentionStatus.closed, { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByText(copy.retentionClosedAt, { exact: false }),
      ).toBeVisible();
      await expect(
        panel.getByText(copy.retentionDeleteAfter, { exact: false }),
      ).toBeVisible();
      if (language === "ko" && testInfo.project.name === "Desktop Chrome") {
        await panel.screenshot({
          path: resolve(
            process.cwd(),
            "tests",
            "artifacts",
            "retention-20260909",
            `ko-${width}-closed.png`,
          ),
        });
      }
      await panel
        .getByRole("button", { name: copy.reopen, exact: true })
        .click();
      await expect(
        panel.getByText(copy.retentionStatus.open, { exact: true }),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: copy.protect, exact: true })
        .click();
      await expect(
        panel.getByText(copy.retentionStatus.protected, { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByText(copy.retentionProtected, { exact: true }),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: copy.close, exact: true })
        .click();
      await panel
        .getByRole("button", { name: copy.show, exact: true })
        .nth(1)
        .click();
      await expect(
        panel.getByText("[Synthetic preview message]", { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByText(copy.retentionTitle, { exact: true }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("checkbox", { name: copy.closeConfirm, exact: true }),
      ).toHaveCount(0);
      expect(
        await panel.evaluate((element) => ({
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          smallTargets: [
            ...element.querySelectorAll("button,select,input"),
          ].filter((target) => target.getBoundingClientRect().height < 44)
            .length,
        })),
      ).toEqual({ overflow: false, smallTargets: 0 });
      expect(apiCalls()).toBe(0);
      expect(errors).toEqual([]);
    });
  }

test("synthetic retention reports a conflict and discards a late result after another inquiry opens", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname),
    "Local synthetic data only",
  );
  const copy = adminExternalInboxCopy.en;
  const apiCalls = await blockLiveRequests(page);
  await page.addInitScript(() => localStorage.setItem("cocotrip_lang", "en"));
  await page.goto(
    "/admin/preview-ai-center?inbox=synthetic&retention-conflict=1",
  );
  const panel = page.getByRole("region", { name: copy.title, exact: true });
  await panel
    .getByRole("button", { name: copy.show, exact: true })
    .first()
    .click();
  await panel
    .getByRole("checkbox", { name: copy.closeConfirm, exact: true })
    .check();
  await panel
    .getByRole("button", { name: copy.closeCase, exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(copy.retentionConflict);
  await page.goto("/admin/preview-ai-center?inbox=synthetic&retention-late=1");
  await panel
    .getByRole("button", { name: copy.show, exact: true })
    .first()
    .click();
  await panel
    .getByRole("checkbox", { name: copy.closeConfirm, exact: true })
    .check();
  await panel
    .getByRole("button", { name: copy.closeCase, exact: true })
    .click();
  await panel.getByRole("button", { name: copy.close, exact: true }).click();
  await panel
    .getByRole("button", { name: copy.show, exact: true })
    .nth(1)
    .click();
  await page.waitForTimeout(120);
  await expect(
    panel.getByText("[Synthetic preview message]", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(copy.retentionTitle, { exact: true }),
  ).toHaveCount(0);
  expect(apiCalls()).toBe(0);
});
