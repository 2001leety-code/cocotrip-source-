import type { CompanyEmailReplyTransport } from "@/components/AdminCompanyEmailReply";
import type {
  CompanyEmailReplyDetail,
  CompanyEmailReplyWorkflow,
} from "@/lib/adminCompanyEmailReply";

// Imported only by the dev harness. All state is synthetic and stays in memory.
export function createWhatsAppReplyPreview(now: number, mode: string | null): CompanyEmailReplyTransport<"whatsapp"> {
  const workflows = new Map<string, CompanyEmailReplyWorkflow<"whatsapp">>();
  const sources = new Map([4, 6].map((index) => [
    index.toString(16).padStart(64, "0"),
    now - index * 60_000,
  ]));
  const reason = mode === "disabled" ? "REPLY_DISABLED"
    : mode === "dispatch-off" ? "DISPATCH_DISABLED"
      : mode === "expired" ? "WHATSAPP_WINDOW_EXPIRED"
        : mode === "stopped" ? "WHATSAPP_CONSENT_REQUIRED" : null;
  const blocked = Boolean(reason && reason !== "DISPATCH_DISABLED");
  return {
    load: async (messageId) => {
      const sourceAtMs = sources.get(messageId);
      if (!sourceAtMs) throw new Error("REPLY_UNAVAILABLE");
      const workflow = workflows.get(messageId) || null;
      return {
        messageId,
        sourceAtMs: blocked ? 0 : sourceAtMs,
        recipient: blocked ? "" : "+1••••••0104 (synthetic)",
        canCompose: !blocked && !workflow?.providerAccepted,
        canSend: !reason && workflow?.status === "draft",
        reason,
        workflow: blocked ? null : workflow,
      } satisfies CompanyEmailReplyDetail<"whatsapp">;
    },
    action: async (input) => {
      const current = workflows.get(input.request.messageId);
      if (
        blocked ||
        input.request.channel !== "whatsapp" ||
        sources.get(input.request.messageId) !== input.request.expectedSourceAtMs
      ) return { ok: false, code: reason || "SOURCE_CONTEXT_INVALID" };
      if (current && (
        current.providerAccepted ||
        input.expectedRevision !== current.revision ||
        input.expectedDraftHash !== current.draftHash
      )) return { ok: false, code: "DRAFT_CONFLICT" };
      if (input.action === "draft") {
        workflows.set(input.request.messageId, {
          request: input.request,
          status: "draft",
          revision: (current?.revision || 0) + 1,
          draftHash: "d".repeat(64),
          approvalExpiresAtMs: 0,
          draftExpiresAtMs: now + 7 * 86_400_000,
          failedAttemptId: "",
          providerAccepted: false,
          deliveryVerified: false,
        });
        return { ok: true, code: "DRAFT_PREPARED" };
      }
      if (reason) return { ok: false, code: reason };
      if (
        !current ||
        input.confirmed !== true ||
        input.request.key !== current.request.key ||
        input.request.text !== current.request.text ||
        input.expectedApprovalExpiresAtMs !== current.approvalExpiresAtMs
      ) return { ok: false, code: "APPROVAL_REQUIRED" };
      workflows.set(input.request.messageId, {
        ...current,
        status: "provider_accepted",
        revision: current.revision + 1,
        providerAccepted: true,
      });
      return { ok: true, code: "PROVIDER_ACCEPTED" };
    },
  };
}
