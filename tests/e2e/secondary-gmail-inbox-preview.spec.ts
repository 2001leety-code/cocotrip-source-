import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, isAnalyticsUrl, test } from "./fixtures/analytics-guard";
import type { Page } from "@playwright/test";
import { adminCompanyEmailReplyCopy } from "../../src/lib/adminCompanyEmailReply";
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
    test(`synthetic secondary work inbox is receive-only ${language} ${width}px`, async ({
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
      const inbox = page.getByRole("region", { name: copy.title, exact: true });
      await expect(inbox).toBeVisible();
      await expect(
        inbox.getByText(copy.secondaryReceiveOnly, { exact: true }).first(),
      ).toBeVisible();
      const secondary = inbox
        .getByRole("listitem")
        .filter({ hasText: "SYNTHETIC secondary work inquiry" });
      await secondary
        .getByRole("button", { name: copy.show, exact: true })
        .click();
      await expect(
        inbox.getByText(copy.secondaryReceiveOnly, { exact: true }),
      ).toHaveCount(2);
      await expect(
        inbox.getByRole("region", {
          name: adminCompanyEmailReplyCopy[language].title,
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        await inbox.evaluate((element) => ({
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          smallTargets: [
            ...element.querySelectorAll("button,select,input"),
          ].filter((target) => target.getBoundingClientRect().height < 44)
            .length,
        })),
      ).toEqual({ overflow: false, smallTargets: 0 });
      if (language === "ko" && testInfo.project.name === "Desktop Chrome") {
        const directory = resolve(
          process.cwd(),
          "tests",
          "artifacts",
          "secondary-gmail-inbox-20260909",
        );
        await mkdir(directory, { recursive: true });
        await inbox.screenshot({
          path: resolve(directory, `ko-${width}-receive-only.png`),
        });
        if (width === 390)
          await page.screenshot({
            path: resolve(directory, "ko-390-viewport-receive-only.png"),
          });
      }
      expect(apiCalls()).toBe(0);
      expect(errors).toEqual([]);
    });
  }
