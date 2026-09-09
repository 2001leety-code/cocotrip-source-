import type { Language } from "@/i18n";

export type CompanyEmailReplyStatus =
  | "draft"
  | "draft_only"
  | "approved"
  | "sending"
  | "provider_accepted"
  | "outcome_unknown"
  | "failed_pre_send"
  | "cancelled";

export interface CompanyEmailReplyRequest {
  messageId: string;
  channel: "email";
  expectedSourceAtMs: number;
  text: string;
  key: string;
}

export interface CompanyEmailReplyWorkflow {
  request: CompanyEmailReplyRequest;
  status: CompanyEmailReplyStatus;
  revision: number;
  draftHash: string;
  approvalExpiresAtMs: number;
  draftExpiresAtMs: number;
  failedAttemptId: string;
  providerAccepted: boolean;
  deliveryVerified: false;
}

export interface CompanyEmailReplyDetail {
  messageId: string;
  sourceAtMs: number;
  recipient: string;
  canCompose: boolean;
  canSend: boolean;
  reason: string | null;
  workflow: CompanyEmailReplyWorkflow | null;
}

export interface CompanyEmailReplyActionInput {
  action: "draft" | "send";
  request: CompanyEmailReplyRequest;
  expectedRevision?: number;
  expectedDraftHash?: string;
  expectedApprovalExpiresAtMs?: number;
  expectedFailedAttemptId?: string;
  confirmed?: true;
}

export interface CompanyEmailReplyActionResult {
  ok: boolean;
  code: string;
}

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TIME = 8_640_000_000_000_000;
const STATUSES: CompanyEmailReplyStatus[] = [
  "draft",
  "draft_only",
  "approved",
  "sending",
  "provider_accepted",
  "outcome_unknown",
  "failed_pre_send",
  "cancelled",
];

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function time(value: unknown, allowZero = false): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= MAX_TIME
  );
}

function text(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= limit &&
    !Array.from(value).some(
      (character) =>
        (character.charCodeAt(0) < 32 &&
          character !== "\n" &&
          character !== "\t") ||
        character.charCodeAt(0) === 127,
    )
  );
}

export function isCompanyEmailReplyRequest(
  value: unknown,
): value is CompanyEmailReplyRequest {
  if (!object(value)) return false;
  return (
    typeof value.messageId === "string" &&
    HASH.test(value.messageId) &&
    value.channel === "email" &&
    time(value.expectedSourceAtMs) &&
    text(value.text, 4000) &&
    value.text.trim().length > 0 &&
    typeof value.key === "string" &&
    UUID.test(value.key)
  );
}

export function isCompanyEmailReplyWorkflow(
  value: unknown,
): value is CompanyEmailReplyWorkflow {
  if (!object(value)) return false;
  return (
    isCompanyEmailReplyRequest(value.request) &&
    typeof value.status === "string" &&
    STATUSES.includes(value.status as CompanyEmailReplyStatus) &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    typeof value.draftHash === "string" &&
    HASH.test(value.draftHash) &&
    time(value.approvalExpiresAtMs, true) &&
    time(value.draftExpiresAtMs) &&
    typeof value.failedAttemptId === "string" &&
    (value.status === "failed_pre_send"
      ? value.failedAttemptId === "" || UUID.test(value.failedAttemptId)
      : value.failedAttemptId === "") &&
    typeof value.providerAccepted === "boolean" &&
    value.deliveryVerified === false
  );
}

export function isCompanyEmailReplyDetail(
  value: unknown,
): value is CompanyEmailReplyDetail {
  if (!object(value)) return false;
  const workflow = value.workflow;
  const disabledWithoutSource =
    value.sourceAtMs === 0 &&
    value.recipient === "" &&
    value.canCompose === false &&
    value.canSend === false &&
    workflow === null &&
    [
      "REPLY_DISABLED",
      "INBOX_CONNECTION_REQUIRED",
      "COMPANY_ACCOUNT_REQUIRED",
      "DRAFT_EXPIRED",
    ].includes(value.reason as string);
  const verifiedSource =
    time(value.sourceAtMs) &&
    text(value.recipient, 254) &&
    value.recipient.length > 0;
  return (
    typeof value.messageId === "string" &&
    HASH.test(value.messageId) &&
    (disabledWithoutSource || verifiedSource) &&
    typeof value.canCompose === "boolean" &&
    typeof value.canSend === "boolean" &&
    (value.reason === null || text(value.reason, 128)) &&
    (workflow === null || isCompanyEmailReplyWorkflow(workflow)) &&
    (!workflow ||
      (workflow.request.messageId === value.messageId &&
        workflow.request.expectedSourceAtMs === value.sourceAtMs)) &&
    (!(value.canSend && workflow?.status === "failed_pre_send") ||
      (workflow?.status === "failed_pre_send" &&
        UUID.test(workflow.failedAttemptId)))
  );
}

export function isCompanyEmailReplyActionResult(
  value: unknown,
): value is CompanyEmailReplyActionResult {
  return (
    object(value) &&
    typeof value.ok === "boolean" &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    value.code.length <= 80 &&
    /^[A-Z0-9_]+$/.test(value.code)
  );
}

export const adminCompanyEmailReplyCopy = {
  ko: {
    title: "회사 메일 수동 답장",
    loading: "답장 상태를 확인 중",
    refresh: "답장 상태 새로고침",
    unavailable: "이 메일은 여기서 답장할 수 없습니다. 수신 연결과 현재 상태를 다시 확인해 주세요.",
    recipient: "받는 사람",
    draft: "답장 초안",
    placeholder: "답장을 입력하세요. 작성한 내용 그대로 발송됩니다.",
    draftHint: "초안 저장은 메일 발송이 아닙니다. 초안은 생성 시각부터 최대 7일 안에만 사용할 수 있습니다.",
    saveDraft: "초안 저장",
    savedDraft: "저장된 초안",
    noDraft: "저장된 초안 없음",
    approve: "이 원문을 회사 Gmail로 발송하는 것을 확인합니다.",
    send: "확인 후 Gmail 발송",
    retryApprove: "Gmail에 전달되지 않은 이 답장을 한 번만 다시 보내겠습니다.",
    retrySend: "확인 후 Gmail 재발송",
    retryHint: "이미 Gmail에 요청을 보냈거나 결과를 모르면 다시 보내지 않습니다.",
    sending: "발송 결과 확인 중",
    gmailAccepted: "Gmail 접수 확인",
    gmailAcceptedHint: "Gmail이 발송 요청을 접수한 상태입니다. 수신자 도착이나 읽음은 확인되지 않았습니다.",
    draftExpires: "초안 사용 기한",
    approvalExpires: "발송 확인 기한",
    uncertain: "요청 결과를 확인하지 못했습니다. 같은 발송을 다시 누르지 말고 답장 상태를 새로고침하세요.",
    conflict: "다른 변경이 있거나 기한이 지났습니다. 답장 상태를 새로고침하세요.",
    failed: "답장 상태를 처리하지 못했습니다. 내용을 다시 확인하세요.",
    noTime: "확인 안 됨",
    locale: "ko-KR",
  },
  en: {
    title: "Manual company email reply",
    loading: "Checking reply status",
    refresh: "Refresh reply status",
    unavailable: "This email cannot be replied to here. Check the incoming connection and current status again.",
    recipient: "Recipient",
    draft: "Reply draft",
    placeholder: "Enter a reply. The text you write is sent unchanged.",
    draftHint: "Saving a draft does not send email. A draft can be used only for up to 7 days from creation.",
    saveDraft: "Save draft",
    savedDraft: "Saved draft",
    noDraft: "No saved draft",
    approve: "I confirm that this original text will be sent through company Gmail.",
    send: "Confirm and send through Gmail",
    retryApprove: "I will resend this reply only once because it was not handed to Gmail.",
    retrySend: "Confirm and resend through Gmail",
    retryHint: "We do not resend after Gmail was asked or when the result is unknown.",
    sending: "Checking send result",
    gmailAccepted: "Gmail accepted",
    gmailAcceptedHint: "Gmail accepted the sending request. Recipient delivery or reading is not verified.",
    draftExpires: "Draft use deadline",
    approvalExpires: "Send confirmation deadline",
    uncertain: "The result could not be confirmed. Do not press send again; refresh the reply status.",
    conflict: "Another change occurred or the deadline passed. Refresh the reply status.",
    failed: "Unable to process the reply status. Check the content again.",
    noTime: "Unavailable",
    locale: "en-US",
  },
  ja: {
    title: "業務メールの手動返信",
    loading: "返信状態を確認中",
    refresh: "返信状態を更新",
    unavailable: "このメールにはここから返信できません。受信接続と現在の状態を再確認してください。",
    recipient: "宛先",
    draft: "返信下書き",
    placeholder: "返信を入力してください。入力した内容のまま送信されます。",
    draftHint: "下書き保存はメール送信ではありません。下書きは作成時刻から最大7日間だけ使用できます。",
    saveDraft: "下書きを保存",
    savedDraft: "保存済み下書き",
    noDraft: "保存済み下書きなし",
    approve: "この原文を業務用 Gmail から送信することを確認します。",
    send: "確認して Gmail から送信",
    retryApprove: "Gmail に渡されなかったこの返信を一度だけ再送します。",
    retrySend: "確認して Gmail から再送",
    retryHint: "すでに Gmail に依頼した場合や結果不明の場合は再送しません。",
    sending: "送信結果を確認中",
    gmailAccepted: "Gmail 受付確認",
    gmailAcceptedHint: "Gmail が送信依頼を受け付けた状態です。相手への到達や開封は確認されていません。",
    draftExpires: "下書きの利用期限",
    approvalExpires: "送信確認の期限",
    uncertain: "結果を確認できませんでした。同じ送信を再度押さず、返信状態を更新してください。",
    conflict: "別の変更があったか、期限が過ぎました。返信状態を更新してください。",
    failed: "返信状態を処理できませんでした。内容を再確認してください。",
    noTime: "確認できません",
    locale: "ja-JP",
  },
  zh: {
    title: "公司邮件手动回复",
    loading: "正在检查回复状态",
    refresh: "刷新回复状态",
    unavailable: "无法在这里回复此邮件，请重新检查接收连接和当前状态。",
    recipient: "收件人",
    draft: "回复草稿",
    placeholder: "请输入回复。将按您输入的内容原样发送。",
    draftHint: "保存草稿不会发送邮件。草稿自创建起最多只能使用7天。",
    saveDraft: "保存草稿",
    savedDraft: "已保存草稿",
    noDraft: "没有已保存草稿",
    approve: "我确认将通过公司 Gmail 发送此原文。",
    send: "确认并通过 Gmail 发送",
    retryApprove: "此回复尚未交给 Gmail，我将仅重新发送一次。",
    retrySend: "确认并通过 Gmail 重新发送",
    retryHint: "已请求 Gmail 或结果未知时，不会重新发送。",
    sending: "正在确认发送结果",
    gmailAccepted: "Gmail 已接收",
    gmailAcceptedHint: "Gmail 已接收发送请求，未验证收件人送达或已读。",
    draftExpires: "草稿使用期限",
    approvalExpires: "发送确认期限",
    uncertain: "无法确认请求结果。请勿再次点击发送；请刷新回复状态。",
    conflict: "发生了其他变更或期限已过。请刷新回复状态。",
    failed: "无法处理回复状态，请重新检查内容。",
    noTime: "无法确认",
    locale: "zh-CN",
  },
} satisfies Record<Language, object>;
