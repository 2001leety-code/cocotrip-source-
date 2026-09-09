import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Language } from "@/i18n";
import {
  adminCompanyEmailReplyCopy,
  isCompanyEmailReplyActionResult,
  isCompanyEmailReplyDetail,
  type CompanyEmailReplyActionInput,
  type CompanyEmailReplyDetail,
} from "@/lib/adminCompanyEmailReply";

type Account = { getIdToken: () => Promise<string> } | null;

export interface CompanyEmailReplyTransport {
  load: (
    messageId: string,
    signal: AbortSignal,
  ) => Promise<CompanyEmailReplyDetail>;
  action: (
    input: CompanyEmailReplyActionInput,
    signal: AbortSignal,
  ) => Promise<{ ok: boolean; code: string }>;
}

interface Props {
  language: Language;
  messageId: string;
  sourceAtMs: number;
  account: Account;
  transport?: CompanyEmailReplyTransport;
}

const buttonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50";

async function token(account: NonNullable<Account>, signal: AbortSignal) {
  if (signal.aborted) throw new Error("ABORTED");
  let onAbort = () => {};
  try {
    return await Promise.race([
      account.getIdToken(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("ABORTED"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw new Error("ABORTED");
  let onAbort = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("ABORTED"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function uuid() {
  if (
    typeof crypto === "undefined" ||
    typeof crypto.randomUUID !== "function"
  )
    return "";
  return crypto.randomUUID();
}

function time(copy: (typeof adminCompanyEmailReplyCopy)[Language], value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) return copy.noTime;
  return `${new Date(value).toLocaleString(copy.locale, {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} KST`;
}

function conflict(code: string) {
  return [
    "DRAFT_CONFLICT",
    "SOURCE_EXPIRED",
    "DRAFT_EXPIRED",
    "RETENTION_CHANGED",
    "APPROVAL_EXPIRED",
  ].includes(code);
}

function uncertain(code: string) {
  return ["DELIVERY_UNCERTAIN", "REPLY_UNAVAILABLE"].includes(code);
}

export function AdminCompanyEmailReply({
  language,
  messageId,
  sourceAtMs,
  account,
  transport,
}: Props) {
  const copy = adminCompanyEmailReplyCopy[language] || adminCompanyEmailReplyCopy.en;
  const titleId = useId();
  const [data, setData] = useState<CompanyEmailReplyDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [uncertainLock, setUncertainLock] = useState(false);
  const [problem, setProblem] = useState<"failed" | "conflict" | "uncertain" | null>(null);
  const loadRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const keyRef = useRef("");

  const get = useCallback(async () => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoading(true);
    setProblem(null);
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const result = transport
        ? await abortable(transport.load(messageId, controller.signal), controller.signal)
        : await (async () => {
            if (!account) throw new Error("AUTH_REQUIRED");
            const bearer = await token(account, controller.signal);
            const response = await fetch(
              `/api/admin-company-email-reply?id=${encodeURIComponent(messageId)}`,
              {
                headers: { Authorization: `Bearer ${bearer}` },
                signal: controller.signal,
                cache: "no-store",
              },
            );
            const payload = await response.json();
            if (!response.ok || !payload?.ok || !isCompanyEmailReplyDetail(payload.data))
              throw new Error("REPLY_UNAVAILABLE");
            return payload.data;
          })();
      if (
        !isCompanyEmailReplyDetail(result) ||
        result.messageId !== messageId ||
        (result.sourceAtMs !== sourceAtMs && result.sourceAtMs !== 0)
      )
        throw new Error("REPLY_UNAVAILABLE");
      if (mounted.current && loadRequest.current === controller) {
        setData(result);
        setDraft(result.workflow?.request.text || "");
        keyRef.current = result.workflow?.request.key || uuid();
        setConfirmed(false);
        setUncertainLock(false);
      }
    } catch {
      if (mounted.current && loadRequest.current === controller) {
        setData(null);
        setProblem("failed");
      }
    } finally {
      window.clearTimeout(timeout);
      if (loadRequest.current === controller) loadRequest.current = null;
      if (mounted.current) setLoading(false);
    }
  }, [account, messageId, sourceAtMs, transport]);

  useEffect(() => {
    mounted.current = true;
    const start = window.setTimeout(() => {
      void get();
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(start);
      loadRequest.current?.abort();
      actionRequest.current?.abort();
    };
  }, [get]);

  async function submit(action: "draft" | "send") {
    if (!data || busy || !keyRef.current || (action === "send" && uncertainLock)) return;
    if (action === "draft" && (!data.canCompose || !draft.trim() || draft.length > 4000))
      return;
    const workflow = data.workflow;
    if (
      action === "send" &&
      (!data.canSend ||
        !workflow ||
        workflow.providerAccepted ||
        !confirmed ||
        draft !== workflow.request.text)
    )
      return;
    actionRequest.current?.abort();
    const controller = new AbortController();
    actionRequest.current = controller;
    setBusy(true);
    setProblem(null);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    const request = {
      messageId,
      channel: "email" as const,
      expectedSourceAtMs: sourceAtMs,
      text: draft,
      key: keyRef.current || workflow?.request.key || "",
    };
    const input: CompanyEmailReplyActionInput =
      action === "draft"
        ? {
            action,
            request,
            ...(workflow
              ? {
                  expectedRevision: workflow.revision,
                  expectedDraftHash: workflow.draftHash,
                }
              : {}),
          }
        : {
            action,
            request,
            expectedRevision: workflow!.revision,
            expectedDraftHash: workflow!.draftHash,
            expectedApprovalExpiresAtMs: workflow!.approvalExpiresAtMs,
            confirmed: true,
            ...(workflow!.status === "failed_pre_send"
              ? { expectedFailedAttemptId: workflow!.failedAttemptId }
              : {}),
          };
    try {
      const result = transport
        ? await abortable(transport.action(input, controller.signal), controller.signal)
        : await (async () => {
            if (!account) throw new Error("AUTH_REQUIRED");
            const bearer = await token(account, controller.signal);
            const response = await fetch("/api/admin-company-email-reply", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${bearer}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(input),
              signal: controller.signal,
              cache: "no-store",
            });
            const payload = await response.json();
            if (!isCompanyEmailReplyActionResult(payload))
              throw new Error("REPLY_UNAVAILABLE");
            return payload;
          })();
      if (!isCompanyEmailReplyActionResult(result)) throw new Error("REPLY_UNAVAILABLE");
      const nextProblem = result.ok
        ? null
        : conflict(result.code)
          ? "conflict"
          : uncertain(result.code)
            ? "uncertain"
            : "failed";
      if (mounted.current && actionRequest.current === controller) {
        setConfirmed(false);
        await get();
        if (nextProblem && mounted.current && actionRequest.current === controller)
          setProblem(nextProblem);
      }
    } catch {
      if (mounted.current && actionRequest.current === controller) {
        const unknownSend = action === "send";
        setConfirmed(false);
        if (unknownSend) setUncertainLock(true);
        setProblem(timedOut || unknownSend ? "uncertain" : "failed");
      }
    } finally {
      window.clearTimeout(timeout);
      if (actionRequest.current === controller) actionRequest.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  const workflow = data?.workflow || null;
  const editingDiffers = Boolean(workflow && draft !== workflow.request.text);
  const retrying = workflow?.status === "failed_pre_send";
  return (
    <section
      aria-labelledby={titleId}
      className="mt-4 rounded-xl border border-violet-300/20 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          {copy.title}
        </h3>
        <button
          type="button"
          className={buttonClass}
          disabled={loading || busy}
          onClick={() => void get()}
        >
          {copy.refresh}
        </button>
      </div>
      {loading && <p role="status" className="mt-3 text-sm text-slate-300">{copy.loading}</p>}
      {problem && (
        <p role="alert" className="mt-3 text-sm leading-6 text-amber-100">
          {problem === "uncertain"
            ? copy.uncertain
            : problem === "conflict"
              ? copy.conflict
              : copy.failed}
        </p>
      )}
      {!loading && !data && <p className="mt-3 text-sm leading-6 text-amber-100">{copy.unavailable}</p>}
      {data && (
        <>
          <dl className="mt-3 grid gap-1 text-xs leading-5 text-slate-300">
            {data.recipient && (
              <div>
                <dt className="inline font-semibold">{copy.recipient}: </dt>
                <dd className="inline break-all">{data.recipient}</dd>
              </div>
            )}
            {workflow && (
              <>
                <div>
                  <dt className="inline font-semibold">{copy.draftExpires}: </dt>
                  <dd className="inline">{time(copy, workflow.draftExpiresAtMs)}</dd>
                </div>
                {workflow.approvalExpiresAtMs > 0 && (
                  <div>
                    <dt className="inline font-semibold">{copy.approvalExpires}: </dt>
                    <dd className="inline">{time(copy, workflow.approvalExpiresAtMs)}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          {!data.canCompose && !workflow ? (
            <p className="mt-3 text-sm leading-6 text-amber-100">{copy.unavailable}</p>
          ) : workflow?.providerAccepted ? (
            <div className="mt-3 rounded-lg border border-emerald-300/30 p-3 text-sm leading-6 text-slate-100">
              <p className="font-semibold">{copy.gmailAccepted}</p>
              <p className="mt-1 text-slate-300">{copy.gmailAcceptedHint}</p>
            </div>
          ) : (
            <>
              <label className="mt-3 block text-sm font-semibold">
                {copy.draft}
                <textarea
                  className="ph-no-capture mt-1 min-h-32 w-full rounded-xl border border-white/20 bg-bg-card p-3 text-sm font-normal leading-6 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50"
                  value={draft}
                  maxLength={4000}
                  placeholder={copy.placeholder}
                  disabled={busy || !data.canCompose}
                  onChange={(event) => {
                    const nextDraft = event.target.value;
                    if (workflow) {
                      if (nextDraft === workflow.request.text)
                        keyRef.current = workflow.request.key;
                      else if (keyRef.current === workflow.request.key)
                        keyRef.current = uuid();
                    }
                    setDraft(nextDraft);
                    setConfirmed(false);
                  }}
                />
              </label>
              <p className="mt-2 text-xs leading-5 text-slate-300">{copy.draftHint}</p>
              <p className="mt-2 text-xs text-slate-300">
                {workflow ? copy.savedDraft : copy.noDraft}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !data.canCompose || !draft.trim() || draft.length > 4000}
                  onClick={() => void submit("draft")}
                >
                  {copy.saveDraft}
                </button>
              </div>
              {workflow && !editingDiffers && data.canSend && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <label className="flex min-h-[44px] items-center gap-2 text-xs leading-5">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    {retrying ? copy.retryApprove : copy.approve}
                  </label>
                  {retrying && (
                    <p className="mt-2 text-xs leading-5 text-slate-300">
                      {copy.retryHint}
                    </p>
                  )}
                  <button
                    type="button"
                    className={`${buttonClass} mt-2`}
                    disabled={busy || uncertainLock || !confirmed}
                    onClick={() => void submit("send")}
                  >
                    {busy ? copy.sending : retrying ? copy.retrySend : copy.send}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
