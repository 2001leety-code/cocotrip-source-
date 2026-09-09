import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { Language } from "@/i18n";
import {
  adminExternalInboxCopy,
  isExternalInboxDetail,
  isExternalInboxOverview,
  isExternalInboxRetention,
  type ExternalInboxMessage,
  type ExternalInboxOverview,
  type ExternalInboxRetention,
} from "@/lib/adminExternalInboxCopy";
import { AdminWhatsAppPrivacy } from "@/components/AdminWhatsAppPrivacy";
import {
  AdminCompanyEmailReply,
  type CompanyEmailReplyTransport,
} from "@/components/AdminCompanyEmailReply";
import { selectInboxMessages } from "@/lib/selectInboxMessages";

interface Props {
  language: Language;
  previewMode?: boolean;
  previewData?: ExternalInboxOverview;
  refreshKey?: number | null;
  retentionAction?: (input: {
    messageId: string;
    expectedRevision: number;
    action: "close" | "reopen" | "protect";
    confirmation?: "ordinary_no_evidence";
  }) => Promise<ExternalInboxRetention>;
  companyEmailReplyTransport?: CompanyEmailReplyTransport;
}
type Account = { uid: string; getIdToken: () => Promise<string> } | null;
const buttonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50";
const EMPTY_PREVIEW: ExternalInboxOverview = {
  generatedAtMs: 0,
  channels: [
    {
      channel: "email",
      status: "disabled",
      lastSuccessAtMs: null,
      lastReceivedAtMs: null,
    },
    {
      channel: "whatsapp",
      status: "disabled",
      lastSuccessAtMs: null,
      lastReceivedAtMs: null,
    },
  ],
  messages: [],
  possiblyTruncated: false,
  listStatus: "not_connected",
};

async function accountToken(
  account: NonNullable<Account>,
  signal: AbortSignal,
) {
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

function InboxContent({
  language,
  previewMode = false,
  previewData,
  refreshKey,
  retentionAction,
  companyEmailReplyTransport,
  account,
}: Props & { account: Account }) {
  const copy = adminExternalInboxCopy[language] || adminExternalInboxCopy.en;
  const titleId = useId();
  const [loaded, setLoaded] = useState<ExternalInboxOverview | null>(null);
  const data = previewMode ? previewData || EMPTY_PREVIEW : loaded;
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<
    | (ExternalInboxMessage & {
        text: string;
        retention?: ExternalInboxRetention;
      })
    | null
  >(null);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [retentionConfirm, setRetentionConfirm] = useState(false);
  const [retentionConflict, setRetentionConflict] = useState(false);
  const [retentionUncertain, setRetentionUncertain] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [channelFilter, setChannelFilter] = useState<
    "all" | "email" | "whatsapp"
  >("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const filteredMessages = selectInboxMessages(data?.messages || [], {
    channel: channelFilter,
    query,
    order,
  });
  const visiblePage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredMessages.length / 5) - 1),
  );
  const visibleMessages = filteredMessages.slice(
    visiblePage * 5,
    visiblePage * 5 + 5,
  );
  const overviewRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const retentionRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const selectedRef = useRef<string | null>(null);
  const lastStart = useRef(0);

  const load = useCallback(async () => {
    if (previewMode || !account || overviewRequest.current) return;
    const controller = new AbortController();
    overviewRequest.current = controller;
    lastStart.current = Date.now();
    setLoading(true);
    setFailed(false);
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const token = await accountToken(account, controller.signal);
      if (controller.signal.aborted) throw new Error("ABORTED");
      const response = await fetch("/api/admin-external-inbox", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !isExternalInboxOverview(payload.data))
        throw new Error("INBOX_UNAVAILABLE");
      if (mounted.current && !controller.signal.aborted)
        setLoaded(payload.data);
    } catch {
      if (mounted.current) {
        setFailed(true);
        setLoaded(null);
        setSelected(null);
        setDetail(null);
        detailRequest.current?.abort();
      }
    } finally {
      window.clearTimeout(timeout);
      if (overviewRequest.current === controller)
        overviewRequest.current = null;
      if (mounted.current) setLoading(false);
    }
  }, [account, previewMode]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const foreground = () => {
      if (!document.hidden && Date.now() - lastStart.current >= 1000)
        void load();
    };
    const interval = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
      overviewRequest.current?.abort();
      detailRequest.current?.abort();
      retentionRequest.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (Date.now() - lastStart.current >= 1000) void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  async function show(message: ExternalInboxMessage) {
    detailRequest.current?.abort();
    retentionRequest.current?.abort();
    selectedRef.current = message.id;
    setSelected(message.id);
    setDetail(null);
    setDetailFailed(false);
    setDetailLoading(true);
    setRetentionBusy(false);
    setRetentionConfirm(false);
    setRetentionConflict(false);
    setRetentionUncertain(false);
    if (previewMode) {
      setDetail({
        ...message,
        text: "[Synthetic preview message]",
        retention: (
          message as ExternalInboxMessage & {
            retention?: ExternalInboxRetention;
          }
        ).retention,
      });
      setDetailLoading(false);
      return;
    }
    if (!account) {
      setDetailLoading(false);
      setDetailFailed(true);
      return;
    }
    const controller = new AbortController();
    detailRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const token = await accountToken(account, controller.signal);
      if (controller.signal.aborted) throw new Error("ABORTED");
      const response = await fetch(
        `/api/admin-external-inbox?id=${encodeURIComponent(message.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: "no-store",
        },
      );
      const payload = await response.json();
      if (
        !response.ok ||
        !payload.ok ||
        !isExternalInboxDetail(payload.data) ||
        payload.data.id !== message.id
      )
        throw new Error("MESSAGE_NOT_AVAILABLE");
      if (
        mounted.current &&
        !controller.signal.aborted &&
        detailRequest.current === controller
      )
        setDetail(payload.data);
    } catch {
      if (mounted.current && detailRequest.current === controller)
        setDetailFailed(true);
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && detailRequest.current === controller)
        setDetailLoading(false);
    }
  }

  function close() {
    detailRequest.current?.abort();
    detailRequest.current = null;
    retentionRequest.current?.abort();
    retentionRequest.current = null;
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
    setDetailFailed(false);
    setDetailLoading(false);
    setRetentionBusy(false);
    setRetentionConfirm(false);
    setRetentionConflict(false);
    setRetentionUncertain(false);
  }
  async function changeRetention(action: "close" | "reopen" | "protect") {
    if (!detail?.retention || retentionBusy) return;
    if (action === "close" && !retentionConfirm) return;
    const input = {
      messageId: detail.id,
      expectedRevision: detail.retention.revision,
      action,
      ...(action === "close"
        ? { confirmation: "ordinary_no_evidence" as const }
        : {}),
    };
    const expectedCaseId = detail.retention.caseId;
    retentionRequest.current?.abort();
    const controller = new AbortController();
    retentionRequest.current = controller;
    setRetentionBusy(true);
    setRetentionConflict(false);
    setRetentionUncertain(false);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    try {
      const next = retentionAction
        ? await abortable(retentionAction(input), controller.signal)
        : await (async () => {
            const token = await accountToken(account!, controller.signal);
            if (controller.signal.aborted) throw new Error("RETENTION_FAILED");
            const response = await fetch(
              "/api/admin-external-inbox-retention",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(input),
                signal: controller.signal,
                cache: "no-store",
              },
            );
            const payload = await response.json();
            if (
              !response.ok ||
              !payload.ok ||
              !isExternalInboxRetention(payload.data)
            )
              throw new Error(
                payload?.error === "CASE_TRANSITION_CONFLICT"
                  ? "RETENTION_CONFLICT"
                  : "RETENTION_FAILED",
              );
            return payload.data;
          })();
      if (
        mounted.current &&
        !controller.signal.aborted &&
        retentionRequest.current === controller &&
        selectedRef.current === input.messageId &&
        next.caseId === expectedCaseId
      ) {
        setDetail((current) =>
          current &&
          current.id === input.messageId &&
          current.retention?.caseId === expectedCaseId
            ? { ...current, retention: next }
            : current,
        );
        setRetentionConfirm(false);
      }
    } catch (error) {
      if (
        mounted.current &&
        retentionRequest.current === controller &&
        (!controller.signal.aborted || timedOut)
      ) {
        if (timedOut) setRetentionUncertain(true);
        else if (
          error instanceof Error &&
          ["RETENTION_CONFLICT", "CASE_TRANSITION_CONFLICT"].includes(
            error.message,
          )
        )
          setRetentionConflict(true);
        else setDetailFailed(true);
      }
    } finally {
      window.clearTimeout(timeout);
      if (retentionRequest.current === controller)
        retentionRequest.current = null;
      if (mounted.current && selectedRef.current === input.messageId)
        setRetentionBusy(false);
    }
  }
  function time(ms: number | null) {
    return ms && Number.isFinite(ms)
      ? new Date(ms).toLocaleString(copy.locale, {
          timeZone: "Asia/Seoul",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }) + " KST"
      : copy.noTime;
  }

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 rounded-2xl border border-white/10 bg-bg-card p-4 text-slate-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold">
            {copy.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {copy.subtitle}
          </p>
        </div>
        <button
          type="button"
          className={buttonClass}
          disabled={loading || previewMode || !account}
          onClick={() => {
            void load();
          }}
        >
          {copy.refresh}
        </button>
      </div>
      {loading && (
        <p role="status" className="mt-3 text-sm text-slate-300">
          {copy.loading}
        </p>
      )}
      {(failed || data?.listStatus === "unknown") && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-amber-300/30 p-3 text-sm leading-6 text-amber-100"
        >
          {copy.failed}
        </p>
      )}
      {data && (
        <>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {data.channels.map((channel) => (
              <div
                key={channel.channel}
                className="min-w-0 rounded-xl border border-white/10 p-3"
              >
                <dt className="text-sm font-bold">{copy[channel.channel]}</dt>
                <dd className="mt-1 text-sm text-violet-200">
                  {copy.statuses[channel.status] || copy.statuses.unknown}
                </dd>
                <dd className="mt-2 text-xs leading-5 text-slate-300">
                  {channel.channel === "email"
                    ? copy.lastSync
                    : copy.lastReceived}
                  :{" "}
                  {time(
                    channel.channel === "email"
                      ? channel.lastSuccessAtMs
                      : channel.lastReceivedAtMs,
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {data.retentionMaintenance && (
            <div
              className="mt-3 rounded-xl border border-white/10 p-3"
              role="status"
              aria-label={copy.maintenanceTitle}
            >
              <p className="text-xs font-semibold text-slate-200">
                {copy.maintenanceTitle}
              </p>
              <p
                className={`mt-1 text-sm ${data.retentionMaintenance.status === "ok" ? "text-emerald-200" : data.retentionMaintenance.status === "not_active" ? "text-slate-300" : "text-amber-100"}`}
              >
                {copy.maintenanceStatus[data.retentionMaintenance.status]}
              </p>
              {(data.retentionMaintenance.checkedAtMs ||
                data.retentionMaintenance.copiesPurged !== null ||
                data.retentionMaintenance.draftsPurged !== null) && (
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  {data.retentionMaintenance.checkedAtMs
                    ? `${copy.maintenanceChecked}: ${time(data.retentionMaintenance.checkedAtMs)}`
                    : ""}
                  {data.retentionMaintenance.copiesPurged !== null
                    ? `${data.retentionMaintenance.checkedAtMs ? " · " : ""}${copy.copiesPurged(data.retentionMaintenance.copiesPurged)}`
                    : ""}
                  {data.retentionMaintenance.draftsPurged !== null
                    ? `${data.retentionMaintenance.checkedAtMs || data.retentionMaintenance.copiesPurged !== null ? " · " : ""}${copy.draftsPurged(data.retentionMaintenance.draftsPurged)}`
                    : ""}
                </p>
              )}
            </div>
          )}
          {data.listStatus !== "unknown" && data.messages.length === 0 && (
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {data.listStatus === "not_connected"
                ? copy.disconnected
                : copy.empty}
            </p>
          )}
          {data.messages.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-xs text-slate-300">
                  {copy.channelLabel}
                  <select
                    aria-label={copy.channelLabel}
                    className={`${buttonClass} mt-1 w-full bg-bg-card`}
                    value={channelFilter}
                    onChange={(event) => {
                      close();
                      setPage(0);
                      setChannelFilter(
                        event.target.value as typeof channelFilter,
                      );
                    }}
                  >
                    <option value="all">{copy.allChannels}</option>
                    <option value="email">{copy.email}</option>
                    <option value="whatsapp">{copy.whatsapp}</option>
                  </select>
                </label>
                <label className="min-w-0 text-xs text-slate-300">
                  {copy.orderLabel}
                  <select
                    aria-label={copy.orderLabel}
                    className={`${buttonClass} mt-1 w-full bg-bg-card`}
                    value={order}
                    onChange={(event) => {
                      close();
                      setPage(0);
                      setOrder(event.target.value as typeof order);
                    }}
                  >
                    <option value="newest">{copy.newest}</option>
                    <option value="oldest">{copy.oldest}</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs text-slate-300">
                {copy.searchLabel}
                <input
                  type="search"
                  autoComplete="off"
                  maxLength={160}
                  className={`${buttonClass} ph-no-capture mt-1 w-full bg-bg-card font-normal`}
                  value={query}
                  onChange={(event) => {
                    close();
                    setPage(0);
                    setQuery(event.target.value);
                  }}
                />
              </label>
              <p className="text-xs leading-5 text-slate-300">
                {copy.filterScope}
              </p>
              {(query || channelFilter !== "all" || order !== "newest") && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    close();
                    setPage(0);
                    setQuery("");
                    setChannelFilter("all");
                    setOrder("newest");
                  }}
                >
                  {copy.clearFilters}
                </button>
              )}
              {filteredMessages.length === 0 && (
                <p role="status" className="text-sm leading-6 text-slate-300">
                  {copy.noMatches}
                </p>
              )}
            </div>
          )}
          {filteredMessages.length > 0 && (
            <ul className="mt-4 space-y-3">
              {visibleMessages.map((message) => (
                <li
                  key={message.id}
                  className="min-w-0 rounded-xl border border-white/10 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                    <span>{copy[message.channel]}</span>
                    <time dateTime={new Date(message.sourceAtMs).toISOString()}>
                      {time(message.sourceAtMs)}
                    </time>
                  </div>
                  <p className="mt-2 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                    {message.channel === "email"
                      ? message.subject || copy.noSubject
                      : message.sender || copy.noSender}
                  </p>
                  {message.channel === "email" && (
                    <p className="mt-1 break-words text-xs leading-5 text-slate-300 [overflow-wrap:anywhere]">
                      {message.sender || copy.noSender}
                    </p>
                  )}
                  <button
                    type="button"
                    className={`${buttonClass} mt-3`}
                    aria-expanded={selected === message.id}
                    aria-controls={`${titleId}-${message.id}`}
                    onClick={() => {
                      if (selected === message.id) close();
                      else void show(message);
                    }}
                  >
                    {selected === message.id ? copy.close : copy.show}
                  </button>
                  {selected === message.id && (
                    <div
                      id={`${titleId}-${message.id}`}
                      className="mt-3 border-t border-white/10 pt-3"
                    >
                      {detailLoading && (
                        <p role="status" className="text-sm text-slate-300">
                          {copy.loading}
                        </p>
                      )}
                      {detailFailed && (
                        <p
                          role="alert"
                          className="text-sm leading-6 text-amber-100"
                        >
                          {copy.detailFailed}
                        </p>
                      )}
                      {detail && (
                        <>
                          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-100 [overflow-wrap:anywhere]">
                            {detail.text || copy.emptyText}
                          </p>
                          {(detail.truncated || detail.channel === "email") && (
                            <p className="mt-3 text-xs leading-5 text-slate-300">
                              {copy.clipped}
                            </p>
                          )}
                          {detail.channel === "email" &&
                            (!previewMode || companyEmailReplyTransport) && (
                            <AdminCompanyEmailReply
                              key={`${detail.id}:${detail.sourceAtMs}`}
                              language={language}
                              messageId={detail.id}
                              sourceAtMs={detail.sourceAtMs}
                              account={account}
                              transport={companyEmailReplyTransport}
                            />
                          )}
                          {detail.retention && (
                            <div className="mt-4 rounded-xl border border-violet-300/20 p-3 text-sm">
                              <p className="font-semibold">
                                {copy.retentionTitle}
                              </p>
                              <p className="mt-1 text-slate-300">
                                <span>
                                  {
                                    copy.retentionStatus[
                                      detail.retention.status
                                    ]
                                  }
                                </span>
                                <span aria-hidden="true"> · </span>
                                {copy.retentionWindow}
                              </p>
                              {detail.retention.status === "closed" && (
                                <dl className="mt-2 grid gap-1 text-xs leading-5 text-slate-300">
                                  <div>
                                    <dt className="inline font-semibold">
                                      {copy.retentionClosedAt}:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {time(detail.retention.closedAtMs)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-semibold">
                                      {copy.retentionDeleteAfter}:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {time(detail.retention.deleteAfterMs)}
                                    </dd>
                                  </div>
                                </dl>
                              )}
                              {detail.retention.status === "protected" && (
                                <p className="mt-2 text-amber-100">
                                  {copy.retentionProtected}
                                </p>
                              )}
                              {detail.retention.reviewRequired && (
                                <p className="mt-1 text-amber-100">
                                  {copy.retentionReview}
                                </p>
                              )}
                              {retentionConflict && (
                                <p role="alert" className="mt-2 text-amber-100">
                                  {copy.retentionConflict}
                                </p>
                              )}
                              {retentionUncertain && (
                                <p role="alert" className="mt-2 text-amber-100">
                                  {copy.retentionUncertain}
                                </p>
                              )}
                              <p className="mt-2 text-xs leading-5 text-slate-300">
                                {copy.retentionWarning}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {detail.retention.status === "open" && (
                                  <>
                                    <button
                                      type="button"
                                      className={buttonClass}
                                      disabled={
                                        retentionBusy ||
                                        (!retentionAction && !account)
                                      }
                                      onClick={() =>
                                        void changeRetention("protect")
                                      }
                                    >
                                      {copy.protect}
                                    </button>
                                    <label className="flex min-h-[44px] items-center gap-2 text-xs">
                                      <input
                                        type="checkbox"
                                        checked={retentionConfirm}
                                        onChange={(event) =>
                                          setRetentionConfirm(
                                            event.target.checked,
                                          )
                                        }
                                        disabled={
                                          retentionBusy ||
                                          (!retentionAction && !account)
                                        }
                                      />
                                      {copy.closeConfirm}
                                    </label>
                                    <button
                                      type="button"
                                      className={buttonClass}
                                      disabled={
                                        retentionBusy ||
                                        (!retentionAction && !account) ||
                                        !retentionConfirm
                                      }
                                      onClick={() =>
                                        void changeRetention("close")
                                      }
                                    >
                                      {copy.closeCase}
                                    </button>
                                  </>
                                )}
                                {detail.retention.status === "closed" && (
                                  <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={
                                      retentionBusy ||
                                      (!retentionAction && !account)
                                    }
                                    onClick={() =>
                                      void changeRetention("reopen")
                                    }
                                  >
                                    {copy.reopen}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {filteredMessages.length > 5 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-300" role="status">
                {copy.range(
                  visiblePage * 5 + 1,
                  Math.min(visiblePage * 5 + 5, filteredMessages.length),
                  filteredMessages.length,
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={visiblePage === 0}
                  onClick={() => {
                    close();
                    setPage(visiblePage - 1);
                  }}
                >
                  {copy.previous}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={(visiblePage + 1) * 5 >= filteredMessages.length}
                  onClick={() => {
                    close();
                    setPage(visiblePage + 1);
                  }}
                >
                  {copy.next}
                </button>
              </div>
            </div>
          )}
          <p className="mt-4 text-xs leading-5 text-slate-300">
            {copy.limited}
          </p>
        </>
      )}
      <p className="mt-3 text-xs leading-5 text-slate-300">{copy.scope}</p>
      <AdminWhatsAppPrivacy language={language} previewMode={previewMode} />
    </section>
  );
}

/** Account changes remount the entire state so prior-company content cannot flash after sign-out. */
export function AdminExternalInbox(props: Props) {
  const { user } = useAuth();
  return (
    <InboxContent
      key={props.previewMode ? "preview" : user?.uid || "signed-out"}
      {...props}
      account={user || null}
    />
  );
}
