// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminCompanyEmailReply } from "../../src/components/AdminCompanyEmailReply";
import {
  adminCompanyEmailReplyCopy,
  adminWhatsAppReplyCopy,
  isCompanyEmailReplyDetail,
  isCompanyEmailReplyRequest,
  type CompanyEmailReplyDetail,
  type CompanyEmailReplyWorkflow,
} from "../../src/lib/adminCompanyEmailReply";
import { createWhatsAppReplyPreview } from "../../src/lib/adminWhatsAppReplyPreview";

void React;
const NOW = Date.parse("2026-09-14T04:00:00Z");
const messageId = "4".padStart(64, "0");
const sourceAtMs = NOW - 4 * 60_000;
const key = "11111111-1111-4111-8111-111111111111";
const request = { messageId, channel: "whatsapp" as const, expectedSourceAtMs: sourceAtMs, text: "Synthetic original reply.", key };
const workflow: CompanyEmailReplyWorkflow<"whatsapp"> = {
  request, status: "draft", revision: 1, draftHash: "d".repeat(64),
  approvalExpiresAtMs: 0, draftExpiresAtMs: NOW + 86_400_000,
  failedAttemptId: "", providerAccepted: false, deliveryVerified: false,
};
const detail: CompanyEmailReplyDetail<"whatsapp"> = {
  messageId, sourceAtMs, recipient: "+1••••••0104 (synthetic)",
  canCompose: true, canSend: true, reason: null, workflow,
};

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => key });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("manual WhatsApp reply", () => {
  it.each(["ko", "en", "ja", "zh"] as const)("requires an explicit %s confirmation after saving and reports only provider acceptance", async (language) => {
    const copy = adminWhatsAppReplyCopy[language];
    const transport = createWhatsAppReplyPreview(NOW, null);
    const action = vi.fn(transport.action);
    render(<AdminCompanyEmailReply channel="whatsapp" language={language} messageId={messageId} sourceAtMs={sourceAtMs} account={null} transport={{ ...transport, action }} />);
    const editor = await screen.findByLabelText(copy.draft);
    fireEvent.change(editor, { target: { value: request.text } });
    fireEvent.click(screen.getByRole("button", { name: copy.saveDraft }));
    await screen.findByText(copy.savedDraft);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0][0]).toEqual({ action: "draft", request });
    const send = screen.getByRole("button", { name: copy.send });
    expect(send).toBeDisabled();
    expect(screen.queryByText(copy.gmailAccepted)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: copy.approve }));
    fireEvent.click(send);
    await screen.findByText(copy.gmailAccepted);
    expect(screen.getByText(copy.gmailAcceptedHint)).toBeTruthy();
    expect(screen.queryByText(adminCompanyEmailReplyCopy[language].gmailAccepted)).toBeNull();
    expect(action.mock.calls[1][0]).toEqual({ action: "send", request, expectedRevision: 1, expectedDraftHash: "d".repeat(64), expectedApprovalExpiresAtMs: 0, confirmed: true });
    expect(screen.queryByRole("button", { name: copy.send })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["disabled", "expired", "stopped"])("explains %s without presenting a connected or sendable state", async (mode) => {
    const copy = adminWhatsAppReplyCopy.ko;
    const transport = createWhatsAppReplyPreview(NOW, mode);
    render(<AdminCompanyEmailReply channel="whatsapp" language="ko" messageId={messageId} sourceAtMs={sourceAtMs} account={null} transport={transport} />);
    const expected = mode === "disabled" ? copy.dispatchOff : mode === "expired" ? copy.sessionExpired : copy.sessionStopped;
    await screen.findByText(expected);
    expect(screen.queryByLabelText(copy.draft)).toBeNull();
    expect(screen.queryByText(copy.gmailAccepted)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a draft while dispatch is off but never exposes send confirmation", async () => {
    const copy = adminWhatsAppReplyCopy.ko;
    render(<AdminCompanyEmailReply channel="whatsapp" language="ko" messageId={messageId} sourceAtMs={sourceAtMs} account={null} transport={createWhatsAppReplyPreview(NOW, "dispatch-off")} />);
    fireEvent.change(await screen.findByLabelText(copy.draft), { target: { value: request.text } });
    fireEvent.click(screen.getByRole("button", { name: copy.saveDraft }));
    await screen.findByText(copy.savedDraft);
    expect(screen.getByText(copy.dispatchOff)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.send })).toBeNull();
  });

  it.each(["transport", "provider"])("locks a %s uncertain send, even when the last known detail was sendable", async (failure) => {
    const copy = adminWhatsAppReplyCopy.ko;
    const action = vi.fn(async () => {
      if (failure === "transport") throw new Error("LOST");
      return { ok: false, code: "DELIVERY_UNCERTAIN" };
    });
    render(<AdminCompanyEmailReply channel="whatsapp" language="ko" messageId={messageId} sourceAtMs={sourceAtMs} account={null} transport={{ load: async () => detail, action }} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: copy.approve }));
    fireEvent.click(screen.getByRole("button", { name: copy.send }));
    await screen.findByText(copy.uncertain);
    fireEvent.click(screen.getByRole("checkbox", { name: copy.approve }));
    const send = screen.getByRole("button", { name: copy.send });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("uses the WhatsApp endpoint and authenticated source-only body without recipient overrides", async () => {
    const copy = adminWhatsAppReplyCopy.ko;
    const network = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: detail }) }));
    vi.stubGlobal("fetch", network);
    render(<AdminCompanyEmailReply channel="whatsapp" language="ko" messageId={messageId} sourceAtMs={sourceAtMs} account={{ getIdToken: async () => "synthetic-token" }} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: copy.approve }));
    network.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false, code: "DISPATCH_DISABLED" }) } as never);
    fireEvent.click(screen.getByRole("button", { name: copy.send }));
    await screen.findByRole("alert");
    expect(network.mock.calls[0]).toEqual([`/api/admin-whatsapp-reply?id=${messageId}`, expect.objectContaining({ headers: { Authorization: "Bearer synthetic-token" } })]);
    const posted = (network.mock.calls as unknown as [string, RequestInit][]).find(([, options]) => options.method === "POST");
    expect(posted?.[0]).toBe("/api/admin-whatsapp-reply");
    const input = JSON.parse(String(posted?.[1].body));
    expect(input.request).toEqual(request);
    expect(input.confirmed).toBe(true);
  });

  it("rejects email workflows in WhatsApp mode and preserves email-only validation by default", () => {
    expect(isCompanyEmailReplyDetail(detail, "whatsapp")).toBe(true);
    expect(isCompanyEmailReplyDetail(detail)).toBe(false);
    expect(isCompanyEmailReplyRequest(request)).toBe(false);
    expect(isCompanyEmailReplyDetail({ ...detail, workflow: { ...workflow, request: { ...request, channel: "email" } } }, "whatsapp")).toBe(false);
    expect(isCompanyEmailReplyDetail({ ...detail, workflow: { ...workflow, deliveryVerified: true } }, "whatsapp")).toBe(false);
    expect(isCompanyEmailReplyDetail({ ...detail, sourceAtMs: 0, canCompose: false, canSend: false, workflow: null, reason: "REPLY_DISABLED" }, "whatsapp")).toBe(false);
  });
});
