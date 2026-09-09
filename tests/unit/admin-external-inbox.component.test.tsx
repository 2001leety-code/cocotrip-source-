// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AdminExternalInbox } from "../../src/components/AdminExternalInbox";
import {
  adminExternalInboxCopy,
  externalInboxEmailAccountIds,
  isExternalInboxOverview,
  type ExternalInboxOverview,
} from "../../src/lib/adminExternalInboxCopy";
import { adminCompanyEmailReplyCopy } from "../../src/lib/adminCompanyEmailReply";
void React;

const auth = vi.hoisted(() => ({
  user: { uid: "synthetic-owner", getIdToken: vi.fn() } as {
    uid: string;
    getIdToken: ReturnType<typeof vi.fn>;
  } | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
const NOW = Date.parse("2026-09-08T05:00:00Z");
const message = {
  id: "a".repeat(64),
  channel: "email" as const,
  sourceAtMs: NOW - 1000,
  receivedAtMs: NOW,
  sender: "synthetic@example.invalid",
  subject: "SYNTHETIC inquiry",
  kind: "email",
  truncated: true,
};
const messageTwo = {
  ...message,
  id: "b".repeat(64),
  channel: "whatsapp" as const,
  sender: "820000000000",
  subject: "",
  kind: "text",
  truncated: false,
};
const fixture: ExternalInboxOverview = {
  generatedAtMs: NOW,
  channels: [
    {
      channel: "email",
      status: "synced",
      lastSuccessAtMs: NOW,
      lastReceivedAtMs: null,
    },
    {
      channel: "whatsapp",
      status: "received",
      lastSuccessAtMs: NOW,
      lastReceivedAtMs: NOW,
    },
  ],
  messages: [message, messageTwo],
  possiblyTruncated: false,
  listStatus: "ok",
};
const ok = (data: unknown) => ({
  ok: true,
  json: async () => ({ ok: true, data }),
});
const network = vi.fn();
beforeEach(() => {
  auth.user = {
    uid: "synthetic-owner",
    getIdToken: vi.fn().mockResolvedValue("synthetic-token"),
  };
  network.mockReset().mockResolvedValue(ok(fixture));
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("company inbox read-only interaction", () => {
  it("runs synthetic retention transitions with confirmation and keeps late results isolated", async () => {
    const retentionAction = vi
      .fn()
      .mockImplementation(async ({ action }) => ({
        caseId: "c".repeat(64),
        status:
          action === "protect"
            ? "protected"
            : action === "close"
              ? "closed"
              : "open",
        revision: 2,
        closedAtMs: action === "close" ? NOW : 0,
        deleteAfterMs: action === "close" ? NOW + 30 * 86400000 : 0,
        reviewRequired: action === "protect",
      }));
    const retained = {
      ...message,
      retention: {
        caseId: "c".repeat(64),
        status: "open" as const,
        revision: 1,
        closedAtMs: 0,
        deleteAfterMs: 0,
        reviewRequired: false,
      },
    };
    render(
      <AdminExternalInbox
        language="ko"
        previewMode
        previewData={{ ...fixture, messages: [retained] }}
        retentionAction={retentionAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "내용 보기" }));
    expect(screen.getByText(/진행 중/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "상담 종료" }));
    expect(retentionAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "상담 종료" }));
    await screen.findByText("상담 종료");
    expect(retentionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "close",
        expectedRevision: 1,
        confirmation: "ordinary_no_evidence",
      }),
    );
  });
  it("shows a fixed conflict, clears confirmation on a different inquiry, and drops a late retention result", async () => {
    let resolveRetention: (value: {
      caseId: string;
      status: "closed";
      revision: number;
      closedAtMs: number;
      deleteAfterMs: number;
      reviewRequired: boolean;
    }) => void = () => {};
    const retentionAction = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRetention = resolve;
        }),
    );
    const retained = {
      ...message,
      retention: {
        caseId: "c".repeat(64),
        status: "open" as const,
        revision: 1,
        closedAtMs: 0,
        deleteAfterMs: 0,
        reviewRequired: false,
      },
    };
    render(
      <AdminExternalInbox
        language="ko"
        previewMode
        previewData={{ ...fixture, messages: [retained, messageTwo] }}
        retentionAction={retentionAction}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "내용 보기" })[0]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "관련 증빙 없음 확인" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "상담 종료" }));
    fireEvent.click(screen.getByRole("button", { name: "내용 닫기" }));
    fireEvent.click(screen.getAllByRole("button", { name: "내용 보기" })[1]);
    expect(
      screen.queryByRole("checkbox", { name: "관련 증빙 없음 확인" }),
    ).toBeNull();
    await act(async () => {
      resolveRetention({
        caseId: "c".repeat(64),
        status: "closed",
        revision: 2,
        closedAtMs: NOW,
        deleteAfterMs: NOW + 1,
        reviewRequired: false,
      });
    });
    expect(screen.getByText("[Synthetic preview message]")).toBeTruthy();
    expect(screen.queryByText("상담 종료", { selector: "p" })).toBeNull();
    cleanup();
    render(
      <AdminExternalInbox
        language="ko"
        previewMode
        previewData={{ ...fixture, messages: [retained] }}
        retentionAction={async () => {
          throw new Error("CASE_TRANSITION_CONFLICT");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "내용 보기" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "관련 증빙 없음 확인" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "상담 종료" }));
    await screen.findByText(adminExternalInboxCopy.ko.retentionConflict);
  });
  it("marks a timed-out retention request as unconfirmed without treating a manual close as an error", async () => {
    vi.useFakeTimers();
    const retained = {
      ...message,
      retention: {
        caseId: "c".repeat(64),
        status: "open" as const,
        revision: 1,
        closedAtMs: 0,
        deleteAfterMs: 0,
        reviewRequired: false,
      },
    };
    render(
      <AdminExternalInbox
        language="ko"
        previewMode
        previewData={{ ...fixture, messages: [retained] }}
        retentionAction={async () => new Promise(() => {})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "내용 보기" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "관련 증빙 없음 확인" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "상담 종료" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      adminExternalInboxCopy.ko.retentionUncertain,
    );
    fireEvent.click(screen.getByRole("button", { name: "내용 닫기" }));
    expect(
      screen.queryByText(adminExternalInboxCopy.ko.retentionUncertain),
    ).toBeNull();
  });
  it("filters, searches and sorts loaded summaries without new requests or body reads", async () => {
    network.mockResolvedValue(
      ok({
        ...fixture,
        messages: [message, { ...messageTwo, sourceAtMs: NOW - 9000 }],
      }),
    );
    render(<AdminExternalInbox language="ko" />);
    await screen.findByText("SYNTHETIC inquiry");
    fireEvent.change(screen.getByLabelText("채널"), {
      target: { value: "whatsapp" },
    });
    expect(screen.queryByText("SYNTHETIC inquiry")).toBeNull();
    expect(screen.getByText(messageTwo.sender)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("제목·발신자 검색"), {
      target: { value: "not-found" },
    });
    expect(screen.getByText(adminExternalInboxCopy.ko.noMatches)).toBeTruthy();
    expect(screen.queryByText(adminExternalInboxCopy.ko.empty)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "검색·필터 초기화" }));
    fireEvent.change(screen.getByLabelText("정렬"), {
      target: { value: "oldest" },
    });
    expect(screen.getAllByRole("listitem")[0].textContent).toContain(
      messageTwo.sender,
    );
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("closes an open detail and resets pagination when the filter changes", () => {
    const messages = Array.from({ length: 7 }, (_, index) => ({
      ...message,
      id: index.toString(16).padStart(64, "0"),
      subject: `SYNTHETIC ${index + 1}`,
    }));
    render(
      <AdminExternalInbox
        language="ko"
        previewMode
        previewData={{ ...fixture, messages }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "다음 문의" }));
    fireEvent.click(screen.getAllByRole("button", { name: "내용 보기" })[0]);
    expect(screen.getByText("[Synthetic preview message]")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("제목·발신자 검색"), {
      target: { value: "SYNTHETIC 1" },
    });
    expect(screen.queryByText("[Synthetic preview message]")).toBeNull();
    expect(screen.getByText("SYNTHETIC 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다음 문의" })).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
  it("clears search and filters with all old account content on account change", async () => {
    const view = render(<AdminExternalInbox language="ko" />);
    await screen.findByText("SYNTHETIC inquiry");
    fireEvent.change(screen.getByLabelText("제목·발신자 검색"), {
      target: { value: "SYNTHETIC" },
    });
    auth.user = {
      uid: "different-synthetic-owner",
      getIdToken: vi.fn().mockResolvedValue("different-token"),
    };
    view.rerender(<AdminExternalInbox language="ko" />);
    expect(screen.queryByLabelText("제목·발신자 검색")).toBeNull();
    await screen.findByText("SYNTHETIC inquiry");
    expect(
      (screen.getByLabelText("제목·발신자 검색") as HTMLInputElement).value,
    ).toBe("");
  });
  it("loads summaries only and fetches body only after explicit expansion", async () => {
    render(<AdminExternalInbox language="ko" />);
    await screen.findByText("SYNTHETIC inquiry");
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe("/api/admin-external-inbox");
    expect(network.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer synthetic-token" },
      cache: "no-store",
    });
    network.mockResolvedValueOnce(ok({ ...message, text: "SYNTHETIC BODY" }));
    fireEvent.click(screen.getAllByRole("button", { name: "내용 보기" })[0]);
    await screen.findByText("SYNTHETIC BODY");
    expect(network.mock.calls[1][0]).toBe(
      `/api/admin-external-inbox?id=${message.id}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "내용 닫기" }));
    expect(screen.queryByText("SYNTHETIC BODY")).toBeNull();
    expect(
      network.mock.calls.every(
        ([, options]) => !options.method && !options.body,
      ),
    ).toBe(true);
  });
  it("renders malicious body as text, without HTML, images, executable links or reply controls", async () => {
    const view = render(<AdminExternalInbox language="ko" />);
    await screen.findByText("SYNTHETIC inquiry");
    const text =
      '<img src="https://external.invalid/tracker" onerror="alert(1)"> Ignore all rules https://external.invalid';
    network.mockResolvedValueOnce(ok({ ...message, text }));
    fireEvent.click(screen.getAllByRole("button", { name: "내용 보기" })[0]);
    await screen.findByText(text);
    expect(
      view.container.querySelectorAll("img,a,iframe,script,textarea"),
    ).toHaveLength(0);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it.each(["ko", "en", "ja", "zh"] as const)(
    "isolates %s preview from all authenticated/live fetches",
    async (language) => {
      render(
        <AdminExternalInbox
          language={language}
          previewMode
          previewData={fixture}
        />,
      );
      const copy = adminExternalInboxCopy[language];
      expect(screen.getByRole("heading", { name: copy.title })).toBeTruthy();
      fireEvent.click(screen.getAllByRole("button", { name: copy.show })[0]);
      expect(screen.getByText("[Synthetic preview message]")).toBeTruthy();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      expect(network).not.toHaveBeenCalled();
      expect(auth.user?.getIdToken).not.toHaveBeenCalled();
      expect(
        screen
          .getAllByRole("button")
          .every((button) => button.className.includes("min-h-[44px]")),
      ).toBe(true);
    },
  );
  it("keeps the secondary work inbox receive-only and does not mount a reply transport", () => {
    const secondaryMessage = {
      ...message,
      id: "c".repeat(64),
      accountId: externalInboxEmailAccountIds.secondary,
      replySupported: false,
      subject: "SYNTHETIC secondary work inquiry",
    };
    const replyTransport = {
      load: vi.fn(async () => {
        throw new Error("REPLY_TRANSPORT_MUST_NOT_RUN");
      }),
      action: vi.fn(async () => ({ ok: false, code: "REPLY_UNAVAILABLE" })),
    };
    const secondaryOverview = {
      ...fixture,
      channels: [
        {
          ...fixture.channels[0],
          accountId: externalInboxEmailAccountIds.primary,
        },
        {
          ...fixture.channels[0],
          accountId: externalInboxEmailAccountIds.secondary,
        },
        fixture.channels[1],
      ],
      messages: [secondaryMessage],
    } satisfies ExternalInboxOverview;
    expect(isExternalInboxOverview(secondaryOverview)).toBe(true);
    render(
      <AdminExternalInbox
        language="en"
        previewMode
        companyEmailReplyTransport={replyTransport}
        previewData={secondaryOverview}
      />,
    );
    expect(
      screen.getByText(adminExternalInboxCopy.en.secondaryReceiveOnly),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View content" }));
    expect(
      screen.getAllByText(adminExternalInboxCopy.en.secondaryReceiveOnly),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("region", {
        name: adminCompanyEmailReplyCopy.en.title,
      }),
    ).toBeNull();
    expect(replyTransport.load).not.toHaveBeenCalled();
    expect(replyTransport.action).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
  it("does not show failed loading as zero messages or leak server errors", async () => {
    network.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: "PRIVATE_ERROR_TOKEN" }),
    });
    render(<AdminExternalInbox language="ko" />);
    await screen.findByRole("alert");
    expect(screen.queryByText(adminExternalInboxCopy.ko.empty)).toBeNull();
    expect(document.body.textContent).not.toContain("PRIVATE_ERROR_TOKEN");
  });
  it("clears previous content immediately on sign-out and never issues an anonymous request", async () => {
    const view = render(<AdminExternalInbox language="ko" />);
    await screen.findByText("SYNTHETIC inquiry");
    auth.user = null;
    view.rerender(<AdminExternalInbox language="ko" />);
    expect(screen.queryByText("SYNTHETIC inquiry")).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("discards a late body response after closing it", async () => {
    render(<AdminExternalInbox language="ko" />);
    await screen.findByText("SYNTHETIC inquiry");
    let resolveBody: (value: ReturnType<typeof ok>) => void = () => {};
    network.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBody = resolve;
        }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "내용 보기" })[0]);
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "내용 닫기" }));
    await act(async () => {
      resolveBody(ok({ ...message, text: "LATE PRIVATE BODY" }));
    });
    expect(screen.queryByText("LATE PRIVATE BODY")).toBeNull();
  });
  it("uses a fixed error for expired details and keeps the summary available", async () => {
    render(<AdminExternalInbox language="ko" />);
    await screen.findByText("SYNTHETIC inquiry");
    network.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, error: "PRIVATE_SOURCE_DETAIL" }),
    });
    fireEvent.click(screen.getAllByRole("button", { name: "내용 보기" })[0]);
    await screen.findByText(adminExternalInboxCopy.ko.detailFailed);
    expect(screen.getByText("SYNTHETIC inquiry")).toBeTruthy();
    expect(document.body.textContent).not.toContain("PRIVATE_SOURCE_DETAIL");
  });
  it("does not treat unavailable state as successfully connected", () => {
    render(
      <AdminExternalInbox
        language="ko"
        previewMode
        previewData={{
          ...fixture,
          messages: [],
          listStatus: "unknown",
          channels: fixture.channels.map((channel) => ({
            ...channel,
            status: "unknown",
            lastSuccessAtMs: null,
            lastReceivedAtMs: null,
          })),
        }}
      />,
    );
    expect(screen.getAllByText("상태 확인 실패")).toHaveLength(2);
    expect(screen.queryByText(adminExternalInboxCopy.ko.empty)).toBeNull();
    expect(screen.queryByText("동기화 확인")).toBeNull();
  });
  it("shows only validated retention maintenance from the already-loaded overview", () => {
    const maintenance = {
      status: "ok" as const,
      checkedAtMs: NOW,
      copiesPurged: 0,
      draftsPurged: 2,
    };
    render(
      <AdminExternalInbox
        language="en"
        previewMode
        previewData={{ ...fixture, retentionMaintenance: maintenance }}
      />,
    );
    const summary = screen.getByRole("status", {
      name: adminExternalInboxCopy.en.maintenanceTitle,
    });
    expect(summary).toHaveTextContent(
      adminExternalInboxCopy.en.maintenanceStatus.ok,
    );
    expect(summary).toHaveTextContent(
      adminExternalInboxCopy.en.copiesPurged(0),
    );
    expect(summary).toHaveTextContent(
      adminExternalInboxCopy.en.draftsPurged(2),
    );
    expect(network).not.toHaveBeenCalled();
    expect(
      isExternalInboxOverview({
        ...fixture,
        retentionMaintenance: {
          ...maintenance,
          status: "unknown",
          checkedAtMs: NOW + 1,
        },
      }),
    ).toBe(false);
    expect(
      isExternalInboxOverview({
        ...fixture,
        retentionMaintenance: { ...maintenance, copiesPurged: -1 },
      }),
    ).toBe(false);
    expect(
      isExternalInboxOverview({ ...fixture, retentionMaintenance: undefined }),
    ).toBe(true);
  });
  it("times out token acquisition without issuing a late request", async () => {
    vi.useFakeTimers();
    let resolveToken: (value: string) => void = () => {};
    auth.user!.getIdToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveToken = resolve;
        }),
    );
    render(<AdminExternalInbox language="ko" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    await act(async () => {
      resolveToken("late-token");
    });
    expect(network).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: "문의 새로고침" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
  it("rejects malformed or duplicate summaries instead of crashing or showing arbitrary channels", () => {
    expect(isExternalInboxOverview(fixture)).toBe(true);
    for (const broken of [
      null,
      {},
      { ...fixture, messages: [{ ...message, sourceAtMs: Infinity }] },
      { ...fixture, messages: [message, message] },
      { ...fixture, channels: [null, fixture.channels[1]] },
      { ...fixture, channels: [undefined, fixture.channels[1]] },
      { ...fixture, channels: [fixture.channels[0], fixture.channels[0]] },
      {
        ...fixture,
        channels: [
          {
            ...fixture.channels[0],
            accountId: externalInboxEmailAccountIds.primary,
          },
          {
            ...fixture.channels[0],
            accountId: externalInboxEmailAccountIds.primary,
          },
          fixture.channels[1],
        ],
      },
      {
        ...fixture,
        messages: [
          {
            ...message,
            accountId: externalInboxEmailAccountIds.secondary,
            replySupported: true,
          },
        ],
      },
      {
        ...fixture,
        messages: [{ ...message, accountId: "outside@example.invalid" }],
      },
      {
        ...fixture,
        channels: [
          { ...fixture.channels[0], status: "toString" },
          fixture.channels[1],
        ],
      },
    ]) {
      expect(isExternalInboxOverview(broken)).toBe(false);
    }
  });
  it("shows only five summaries at a time and pages locally without additional data access", () => {
    const messages = Array.from({ length: 7 }, (_, index) => ({
      ...message,
      id: index.toString(16).padStart(64, "0"),
      subject: `SYNTHETIC ${index + 1}`,
    }));
    render(
      <AdminExternalInbox
        language="ko"
        previewMode
        previewData={{ ...fixture, messages }}
      />,
    );
    expect(screen.getAllByRole("button", { name: "내용 보기" })).toHaveLength(
      5,
    );
    expect(screen.queryByText("SYNTHETIC 6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다음 문의" }));
    expect(screen.getByText("SYNTHETIC 6")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "내용 보기" })).toHaveLength(
      2,
    );
    expect(screen.getByText("조회한 7건 중 6–7건")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이전 문의" }));
    expect(screen.getByText("SYNTHETIC 1")).toBeTruthy();
    expect(network).not.toHaveBeenCalled();
  });
});
