// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminCompanyEmailReply, type CompanyEmailReplyTransport } from "../../src/components/AdminCompanyEmailReply";
import {
  adminCompanyEmailReplyCopy,
  isCompanyEmailReplyDetail,
  type CompanyEmailReplyDetail,
  type CompanyEmailReplyWorkflow,
} from "../../src/lib/adminCompanyEmailReply";

void React;

const NOW = Date.parse("2026-09-09T04:00:00Z");
const messageId = "a".repeat(64);
const requestKey = "11111111-1111-4111-8111-111111111111";

function detail(workflow: CompanyEmailReplyWorkflow | null): CompanyEmailReplyDetail {
  return {
    messageId,
    sourceAtMs: NOW - 1_000,
    recipient: "synthetic-recipient@example.invalid",
    canCompose: !workflow?.providerAccepted,
    canSend: workflow?.status === "draft",
    reason: null,
    workflow,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => requestKey });
});

describe("manual company email reply", () => {
  it("saves a draft before an explicitly confirmed Gmail send and then refetches", async () => {
    let workflow: CompanyEmailReplyWorkflow | null = null;
    const load = vi.fn(async () => detail(workflow));
    const action = vi.fn(async (input) => {
      if (input.action === "draft") {
        workflow = {
          request: input.request,
          status: "draft",
          revision: 1,
          draftHash: "d".repeat(64),
          approvalExpiresAtMs: 0,
          draftExpiresAtMs: NOW + 7 * 86_400_000,
          failedAttemptId: "",
          providerAccepted: false,
          deliveryVerified: false,
        };
        return { ok: true, code: "DRAFT_PREPARED" };
      }
      workflow = {
        ...workflow!,
        status: "provider_accepted",
        revision: 2,
        providerAccepted: true,
      };
      return { ok: true, code: "PROVIDER_ACCEPTED" };
    });
    const transport: CompanyEmailReplyTransport = { load, action };
    render(
      <AdminCompanyEmailReply
        language="en"
        messageId={messageId}
        sourceAtMs={NOW - 1_000}
        account={null}
        transport={transport}
      />,
    );
    const copy = adminCompanyEmailReplyCopy.en;
    await screen.findByLabelText(copy.draft);
    fireEvent.change(screen.getByLabelText(copy.draft), {
      target: { value: "Original verified reply." },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.saveDraft }));
    await screen.findByText(copy.savedDraft);
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "draft",
        request: expect.objectContaining({
          messageId,
          channel: "email",
          text: "Original verified reply.",
        }),
      }),
      expect.any(AbortSignal),
    );
    const send = screen.getByRole("button", { name: copy.send });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: copy.approve }));
    fireEvent.click(send);
    await screen.findByText(copy.gmailAccepted);
    expect(screen.getByText(copy.gmailAcceptedHint)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(3);
    expect(action).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "send",
        confirmed: true,
        expectedRevision: 1,
        expectedDraftHash: "d".repeat(64),
        expectedApprovalExpiresAtMs: 0,
      }),
      expect.any(AbortSignal),
    );
  });

  it("does not show server codes, sends no network request, and treats a timeout as unknown", async () => {
    const transport: CompanyEmailReplyTransport = {
      load: async () => detail(null),
      action: async () => ({ ok: false, code: "DELIVERY_UNCERTAIN" }),
    };
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    render(
      <AdminCompanyEmailReply
        language="ko"
        messageId={messageId}
        sourceAtMs={NOW - 1_000}
        account={null}
        transport={transport}
      />,
    );
    const copy = adminCompanyEmailReplyCopy.ko;
    await screen.findByLabelText(copy.draft);
    fireEvent.change(screen.getByLabelText(copy.draft), {
      target: { value: "확인한 원문입니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.saveDraft }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(copy.uncertain);
    expect(document.body.textContent).not.toContain("PRIVATE_PROVIDER_CODE");
    expect(network).not.toHaveBeenCalled();
  });

  it("permits exactly the server-authorized pre-send retry after a new confirmation", async () => {
    const failedAttemptId = "22222222-2222-4222-8222-222222222222";
    let workflow: CompanyEmailReplyWorkflow | null = {
      request: {
        messageId,
        channel: "email",
        expectedSourceAtMs: NOW - 1_000,
        text: "Original retry text.",
        key: requestKey,
      },
      status: "failed_pre_send",
      revision: 1,
      draftHash: "d".repeat(64),
      approvalExpiresAtMs: 0,
      draftExpiresAtMs: NOW + 7 * 86_400_000,
      failedAttemptId,
      providerAccepted: false,
      deliveryVerified: false,
    };
    const action = vi.fn(async () => {
      workflow = {
        ...workflow!,
        status: "provider_accepted",
        revision: 2,
        failedAttemptId: "",
        providerAccepted: true,
      };
      return { ok: true, code: "PROVIDER_ACCEPTED" };
    });
    render(
      <AdminCompanyEmailReply
        language="en"
        messageId={messageId}
        sourceAtMs={NOW - 1_000}
        account={null}
        transport={{
          load: async () => ({ ...detail(workflow), canCompose: false, canSend: true }),
          action,
        }}
      />,
    );
    const copy = adminCompanyEmailReplyCopy.en;
    await screen.findByRole("checkbox", { name: copy.retryApprove });
    fireEvent.click(screen.getByRole("checkbox", { name: copy.retryApprove }));
    fireEvent.click(screen.getByRole("button", { name: copy.retrySend }));
    await screen.findByText(copy.gmailAccepted);
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ expectedFailedAttemptId: failedAttemptId }),
      expect.any(AbortSignal),
    );
  });

  it("uses a new request key for an edited draft and locks an uncertain send until refresh", async () => {
    const existingKey = "33333333-3333-4333-8333-333333333333";
    const workflow: CompanyEmailReplyWorkflow = {
      request: {
        messageId,
        channel: "email",
        expectedSourceAtMs: NOW - 1_000,
        text: "Original draft.",
        key: existingKey,
      },
      status: "draft",
      revision: 1,
      draftHash: "d".repeat(64),
      approvalExpiresAtMs: 0,
      draftExpiresAtMs: NOW + 7 * 86_400_000,
      failedAttemptId: "",
      providerAccepted: false,
      deliveryVerified: false,
    };
    const draftAction = vi.fn(async () => ({ ok: false, code: "DRAFT_CONFLICT" }));
    const copy = adminCompanyEmailReplyCopy.en;
    const view = render(
      <AdminCompanyEmailReply
        language="en"
        messageId={messageId}
        sourceAtMs={NOW - 1_000}
        account={null}
        transport={{ load: async () => detail(workflow), action: draftAction }}
      />,
    );
    const editor = await screen.findByLabelText(copy.draft);
    fireEvent.change(editor, { target: { value: "Edited draft." } });
    fireEvent.click(screen.getByRole("button", { name: copy.saveDraft }));
    await screen.findByRole("alert");
    expect(draftAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ key: expect.not.stringMatching(existingKey) }),
      }),
      expect.any(AbortSignal),
    );
    view.unmount();

    const sendAction = vi.fn(async () => {
      throw new Error("TRANSPORT_LOST");
    });
    render(
      <AdminCompanyEmailReply
        language="en"
        messageId={messageId}
        sourceAtMs={NOW - 1_000}
        account={null}
        transport={{ load: async () => detail(workflow), action: sendAction }}
      />,
    );
    await screen.findByRole("checkbox", { name: copy.approve });
    fireEvent.click(screen.getByRole("checkbox", { name: copy.approve }));
    const send = screen.getByRole("button", { name: copy.send });
    fireEvent.click(send);
    await screen.findByText(copy.uncertain);
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it.each(["ko", "en", "ja", "zh"] as const)(
    "keeps %s unavailable state distinct from a connected Gmail claim",
    async (language) => {
      const copy = adminCompanyEmailReplyCopy[language];
      render(
        <AdminCompanyEmailReply
          language={language}
          messageId={messageId}
          sourceAtMs={NOW - 1_000}
          account={null}
          transport={{
            load: async () => ({
              messageId,
              sourceAtMs: 0,
              recipient: "",
              canCompose: false,
              canSend: false,
              reason: "REPLY_DISABLED",
              workflow: null,
            }),
            action: async () => ({ ok: false, code: "REPLY_DISABLED" }),
          }}
        />,
      );
      await screen.findByText(copy.unavailable);
      expect(screen.queryByText(copy.gmailAccepted)).toBeNull();
      expect(screen.queryByLabelText(copy.draft)).toBeNull();
      expect(
        screen
          .getByRole("button", { name: copy.refresh })
          .className.includes("min-h-[44px]"),
      ).toBe(true);
    },
  );

  it("rejects malformed reply payloads before showing or posting them", () => {
    expect(isCompanyEmailReplyDetail(detail(null))).toBe(true);
    expect(
      isCompanyEmailReplyDetail({
        ...detail(null),
        recipient: "recipient@example.invalid\u0000",
      }),
    ).toBe(false);
    const failedWorkflow = {
      request: {
        messageId,
        channel: "email",
        expectedSourceAtMs: NOW - 1_000,
        text: "x",
        key: requestKey,
      },
      status: "failed_pre_send",
      revision: 1,
      draftHash: "d".repeat(64),
      approvalExpiresAtMs: 0,
      draftExpiresAtMs: NOW,
      failedAttemptId: "",
      providerAccepted: false,
      deliveryVerified: false,
    } as const;
    expect(
      isCompanyEmailReplyDetail({ ...detail(failedWorkflow), canSend: false }),
    ).toBe(true);
    expect(
      isCompanyEmailReplyDetail({ ...detail(failedWorkflow), canSend: true }),
    ).toBe(false);
    expect(
      isCompanyEmailReplyDetail({
        ...detail(null),
        workflow: {
          request: {
            messageId,
            channel: "email",
            expectedSourceAtMs: NOW - 1_000,
            text: "x",
            key: requestKey,
          },
          status: "arbitrary_status",
          revision: 1,
          draftHash: "d".repeat(64),
          approvalExpiresAtMs: 0,
          draftExpiresAtMs: NOW,
          failedAttemptId: "",
          providerAccepted: false,
          deliveryVerified: false,
        },
      }),
    ).toBe(false);
    expect(
      isCompanyEmailReplyDetail({
        messageId,
        sourceAtMs: 0,
        recipient: "",
        canCompose: false,
        canSend: false,
        reason: "REPLY_DISABLED",
        workflow: null,
      }),
    ).toBe(true);
    expect(
      isCompanyEmailReplyDetail({
        messageId,
        sourceAtMs: 0,
        recipient: "",
        canCompose: false,
        canSend: false,
        reason: "DRAFT_EXPIRED",
        workflow: null,
      }),
    ).toBe(true);
    expect(
      isCompanyEmailReplyDetail({
        messageId,
        sourceAtMs: 0,
        recipient: "should-not-be-present@example.invalid",
        canCompose: false,
        canSend: false,
        reason: "REPLY_DISABLED",
        workflow: null,
      }),
    ).toBe(false);
  });
});
