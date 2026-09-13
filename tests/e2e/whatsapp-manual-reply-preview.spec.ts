import { expect, test, isAnalyticsUrl } from "./fixtures/analytics-guard";
import type { Page } from "@playwright/test";
import { adminWhatsAppReplyCopy } from "../../src/lib/adminCompanyEmailReply";
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
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  return () => apiCalls;
}

for (const language of ["ko", "en", "ja", "zh"] as const)
  for (const width of [390, 1280]) {
    test(`synthetic WhatsApp draft and explicit send ${language} ${width}px`, async ({ page, baseURL }) => {
      test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "Local synthetic data only");
      const copy = adminWhatsAppReplyCopy[language];
      const inboxCopy = adminExternalInboxCopy[language];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const apiCalls = await blockLiveRequests(page);
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((lang) => localStorage.setItem("cocotrip_lang", lang), language);
      await page.goto("/admin/preview-ai-center?inbox=synthetic");
      const inbox = page.getByRole("region", { name: inboxCopy.title, exact: true });
      await inbox.locator("select").first().selectOption("whatsapp");
      await inbox.getByRole("button", { name: inboxCopy.show, exact: true }).first().click();
      const reply = inbox.getByRole("region", { name: copy.title, exact: true });
      await reply.getByLabel(copy.draft, { exact: true }).fill("Synthetic WhatsApp reply. No external sending.");
      await reply.getByRole("button", { name: copy.saveDraft, exact: true }).click();
      await expect(reply.getByText(copy.savedDraft, { exact: true })).toBeVisible();
      await expect(reply.getByText(copy.gmailAccepted, { exact: true })).toHaveCount(0);
      const send = reply.getByRole("button", { name: copy.send, exact: true });
      await expect(send).toBeDisabled();
      const confirmation = reply.getByRole("checkbox", { name: copy.approve, exact: true });
      await confirmation.focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("Tab");
      await expect(send).toBeFocused();
      expect(await reply.evaluate((element) => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        smallControls: [...element.querySelectorAll("button,textarea")].filter((control) => control.getBoundingClientRect().height < 44).length,
      }))).toEqual({ overflow: false, smallControls: 0 });
      await page.keyboard.press("Enter");
      await expect(reply.getByText(copy.gmailAccepted, { exact: true })).toBeVisible();
      await expect(reply.getByText(copy.gmailAcceptedHint, { exact: true })).toBeVisible();
      await expect(reply.getByRole("button", { name: copy.send, exact: true })).toHaveCount(0);
      expect(apiCalls()).toBe(0);
      expect(errors).toEqual([]);
    });
  }

for (const mode of ["dispatch-off", "expired", "stopped"] as const) {
  test(`synthetic WhatsApp ${mode} blocks send with a readable reason`, async ({ page, baseURL }) => {
    test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "Local synthetic data only");
    const copy = adminWhatsAppReplyCopy.ko;
    const inboxCopy = adminExternalInboxCopy.ko;
    const apiCalls = await blockLiveRequests(page);
    await page.addInitScript(() => localStorage.setItem("cocotrip_lang", "ko"));
    await page.goto(`/admin/preview-ai-center?inbox=synthetic&whatsapp-reply=${mode}`);
    const inbox = page.getByRole("region", { name: inboxCopy.title, exact: true });
    await inbox.locator("select").first().selectOption("whatsapp");
    await inbox.getByRole("button", { name: inboxCopy.show, exact: true }).first().click();
    const reply = inbox.getByRole("region", { name: copy.title, exact: true });
    const reason = mode === "dispatch-off" ? copy.dispatchOff : mode === "expired" ? copy.sessionExpired : copy.sessionStopped;
    await expect(reply.getByText(reason, { exact: true })).toBeVisible();
    if (mode === "dispatch-off") {
      await reply.getByLabel(copy.draft, { exact: true }).fill("Synthetic draft only.");
      await reply.getByRole("button", { name: copy.saveDraft, exact: true }).click();
      await expect(reply.getByText(copy.savedDraft, { exact: true })).toBeVisible();
    } else {
      await expect(reply.getByLabel(copy.draft, { exact: true })).toHaveCount(0);
    }
    await expect(reply.getByRole("checkbox")).toHaveCount(0);
    await expect(reply.getByText(copy.gmailAccepted, { exact: true })).toHaveCount(0);
    expect(apiCalls()).toBe(0);
  });
}
