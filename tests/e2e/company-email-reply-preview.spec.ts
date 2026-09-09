import { expect, test, isAnalyticsUrl } from "./fixtures/analytics-guard";
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
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
    test(`synthetic company email reply ${language} ${width}px`, async ({
      page,
      baseURL,
    }, testInfo) => {
      test.skip(
        !baseURL ||
          !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname),
        "Local synthetic data only",
      );
      const inboxCopy = adminExternalInboxCopy[language];
      const copy = adminCompanyEmailReplyCopy[language];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      const apiCalls = await blockLiveRequests(page);
      await page.addInitScript(
        (lang) => localStorage.setItem("cocotrip_lang", lang),
        language,
      );
      await page.goto("/admin/preview-ai-center?inbox=synthetic");
      const inbox = page.getByRole("region", {
        name: inboxCopy.title,
        exact: true,
      });
      await expect(inbox).toBeVisible();
      await inbox
        .getByRole("button", { name: inboxCopy.show, exact: true })
        .first()
        .click();
      const reply = inbox.getByRole("region", { name: copy.title, exact: true });
      await expect(reply).toBeVisible();
      const editor = reply.getByLabel(copy.draft, { exact: true });
      await editor.fill("Synthetic original reply. No translation.");
      await reply
        .getByRole("button", { name: copy.saveDraft, exact: true })
        .click();
      await expect(reply.getByText(copy.savedDraft, { exact: true })).toBeVisible();
      const confirmation = reply.getByRole("checkbox", {
        name: copy.approve,
        exact: true,
      });
      await confirmation.focus();
      await page.keyboard.press("Space");
      await expect(confirmation).toBeChecked();
      const send = reply.getByRole("button", { name: copy.send, exact: true });
      await page.keyboard.press("Tab");
      await expect(send).toBeFocused();
      expect(
        await reply.evaluate((element) => ({
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          smallButtonsOrEditor: [
            ...element.querySelectorAll("button,textarea"),
          ].filter((target) => target.getBoundingClientRect().height < 44)
            .length,
          checkboxLabelHeight:
            element.querySelector('input[type="checkbox"]')?.closest("label")?.getBoundingClientRect()
              .height || 0,
        })),
      ).toEqual({
        overflow: false,
        smallButtonsOrEditor: 0,
        checkboxLabelHeight: expect.any(Number),
      });
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
          "company-email-reply-20260909",
        );
        await mkdir(directory, { recursive: true });
        await reply.screenshot({
          path: resolve(directory, `ko-${width}-compose.png`),
        });
      }
      await page.keyboard.press("Enter");
      await expect(reply.getByText(copy.gmailAccepted, { exact: true })).toBeVisible();
      await expect(reply.getByText(copy.gmailAcceptedHint, { exact: true })).toBeVisible();
      await expect(reply.getByText(copy.send, { exact: true })).toHaveCount(0);
      if (language === "ko" && testInfo.project.name === "Desktop Chrome") {
        const directory = resolve(
          process.cwd(),
          "tests",
          "artifacts",
          "company-email-reply-20260909",
        );
        await mkdir(directory, { recursive: true });
        await reply.screenshot({
          path: resolve(directory, `ko-${width}-gmail-accepted.png`),
        });
      }
      expect(
        await reply.evaluate((element) => ({
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          smallButtons: [...element.querySelectorAll("button")].filter(
            (target) => target.getBoundingClientRect().height < 44,
          ).length,
        })),
      ).toEqual({ overflow: false, smallButtons: 0 });
      expect(apiCalls()).toBe(0);
      expect(errors).toEqual([]);
    });
  }

test("synthetic disabled email reply is not presented as a Gmail connection", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname),
    "Local synthetic data only",
  );
  const language = "en";
  const inboxCopy = adminExternalInboxCopy[language];
  const copy = adminCompanyEmailReplyCopy[language];
  const apiCalls = await blockLiveRequests(page);
  await page.addInitScript(() => localStorage.setItem("cocotrip_lang", language));
  await page.goto("/admin/preview-ai-center?inbox=synthetic&email-reply=disabled");
  const inbox = page.getByRole("region", { name: inboxCopy.title, exact: true });
  await inbox.getByRole("button", { name: inboxCopy.show, exact: true }).first().click();
  const reply = inbox.getByRole("region", { name: copy.title, exact: true });
  await expect(reply.getByText(copy.unavailable, { exact: true })).toBeVisible();
  await expect(reply.getByText(copy.gmailAccepted, { exact: true })).toHaveCount(0);
  await expect(reply.getByLabel(copy.draft, { exact: true })).toHaveCount(0);
  expect(apiCalls()).toBe(0);
});

test("synthetic pre-send retry needs a fresh confirmation and carries no delivery claim", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname),
    "Local synthetic data only",
  );
  const language = "en";
  const inboxCopy = adminExternalInboxCopy[language];
  const copy = adminCompanyEmailReplyCopy[language];
  const apiCalls = await blockLiveRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("cocotrip_lang", language));
  await page.goto("/admin/preview-ai-center?inbox=synthetic&email-reply=retry");
  const inbox = page.getByRole("region", { name: inboxCopy.title, exact: true });
  await inbox.getByRole("button", { name: inboxCopy.show, exact: true }).first().click();
  const reply = inbox.getByRole("region", { name: copy.title, exact: true });
  const confirmation = reply.getByRole("checkbox", {
    name: copy.retryApprove,
    exact: true,
  });
  await expect(confirmation).not.toBeChecked();
  await expect(reply.getByRole("button", { name: copy.retrySend, exact: true })).toBeDisabled();
  await confirmation.check();
  await reply.getByRole("button", { name: copy.retrySend, exact: true }).click();
  await expect(reply.getByText(copy.gmailAcceptedHint, { exact: true })).toBeVisible();
  expect(apiCalls()).toBe(0);
});
