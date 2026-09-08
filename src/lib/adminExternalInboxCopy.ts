import type { Language } from "@/i18n";

export const adminExternalInboxCopy = {
  ko: {
    title: "회사 메일 · WhatsApp",
    subtitle: "받은 문의를 한곳에서 확인합니다. 자동 발송은 꺼져 있습니다.",
    email: "회사 Gmail",
    whatsapp: "WhatsApp",
    refresh: "문의 새로고침",
    loading: "문의 확인 중",
    allChannels: "모든 채널",
    channelLabel: "채널",
    searchLabel: "제목·발신자 검색",
    orderLabel: "정렬",
    newest: "최근 문의부터",
    oldest: "오래된 문의부터",
    clearFilters: "검색·필터 초기화",
    noMatches: "조회한 목록에서 일치하는 문의가 없습니다.",
    filterScope:
      "검색·정렬은 불러온 목록에만 적용됩니다. 본문은 검색하지 않습니다.",
    failed:
      "문의를 확인하지 못했습니다. 연결 상태와 목록을 다시 확인해 주세요.",
    empty: "현재 조회 범위에 수신한 문의가 없습니다.",
    disconnected: "수신 연결이 아직 완료되지 않았습니다.",
    show: "내용 보기",
    close: "내용 닫기",
    noSubject: "제목 없음",
    noSender: "발신자 확인 필요",
    previous: "이전 문의",
    next: "다음 문의",
    range: (start: number, end: number, count: number) =>
      `조회한 ${count}건 중 ${start}–${end}건`,
    detailFailed:
      "내용을 불러오지 못했습니다. 만료되었거나 연결 설정이 바뀌었을 수 있습니다.",
    emptyText:
      "표시할 텍스트가 없습니다. 첨부 내용은 원래 앱에서 확인해 주세요.",
    clipped:
      "일부 텍스트만 보입니다. 전체 내용과 첨부 파일은 원래 앱에서 확인해 주세요.",
    limited:
      "최근 저장 100건 범위입니다. 전체 문의 건수나 미답변 건수가 아닙니다.",
    scope:
      "설정한 수신 시작일 이후의 회사 받은편지함만 표시합니다. 읽음 처리나 답장은 하지 않습니다.",
    retentionTitle: "보관 관리",
    retentionStatus: {
      open: "진행 중",
      closed: "상담 종료",
      protected: "증빙 보호",
    },
    retentionWindow: "상담 종료 후 최대 30일",
    retentionReview: "증빙 검토가 필요해 삭제를 보류합니다.",
    retentionProtected:
      "증빙 보호 중인 상담은 여기서 재개하거나 종료할 수 없습니다.",
    retentionClosedAt: "종료 시각",
    retentionDeleteAfter: "삭제 예정 시각",
    retentionConflict:
      "다른 관리자가 상태를 바꾸었거나 보관 기한이 지났습니다. 내용을 새로 열어 확인하세요.",
    retentionUncertain:
      "요청 결과를 확인하지 못했습니다. 같은 변경을 다시 보내지 말고 내용을 다시 열어 현재 상태를 확인하세요.",
    retentionWarning:
      "예약·계약·결제·불만·분쟁 증빙이 없을 때만 종료하세요. WhatsApp 수신 동의 종료나 예약 완료와는 다릅니다.",
    closeConfirm: "관련 증빙 없음 확인",
    closeCase: "상담 종료",
    protect: "증빙 보호",
    reopen: "진행 중으로 되돌리기",
    maintenanceTitle: "보관 정리 상태",
    maintenanceStatus: {
      not_active: "연결 전 또는 정리 비활성",
      unknown: "확인 안 됨",
      ok: "정상 확인",
      attention: "확인 필요",
      delayed: "확인 지연",
    },
    maintenanceChecked: "마지막 확인",
    copiesPurged: (count: number) => `문의 사본 정리 ${count}건`,
    draftsPurged: (count: number) => `미발송 초안 정리 ${count}건`,
    lastSync: "최근 동기화",
    lastReceived: "최근 수신 확인",
    noTime: "아직 확인 안 됨",
    locale: "ko-KR",
    statuses: {
      disabled: "수신 꺼짐",
      not_configured: "설정 필요",
      awaiting: "실제 수신 확인 대기",
      received: "수신 이력 확인",
      synced: "동기화 확인",
      delayed: "동기화 지연",
      error: "연결 오류",
      resync_required: "재연결 점검 필요",
      unknown: "상태 확인 실패",
    },
  },
  en: {
    title: "Company email · WhatsApp",
    subtitle: "Check incoming inquiries together. Automatic sending is off.",
    email: "Company Gmail",
    whatsapp: "WhatsApp",
    refresh: "Refresh inquiries",
    loading: "Checking inquiries",
    allChannels: "All channels",
    channelLabel: "Channel",
    searchLabel: "Search subject or sender",
    orderLabel: "Sort",
    newest: "Newest first",
    oldest: "Oldest first",
    clearFilters: "Reset search and filters",
    noMatches: "No matching inquiries in the loaded list.",
    filterScope:
      "Search and sorting apply only to the loaded list. Message bodies are not searched.",
    failed:
      "Unable to check inquiries. Please refresh the connection status and list.",
    empty: "No received inquiries in the current view.",
    disconnected: "Incoming connections are not complete yet.",
    show: "View content",
    close: "Close content",
    noSubject: "No subject",
    noSender: "Sender unavailable",
    previous: "Previous inquiries",
    next: "Next inquiries",
    range: (start: number, end: number, count: number) =>
      `${start}–${end} of ${count} loaded`,
    detailFailed:
      "Unable to load content. It may have expired or the connection settings may have changed.",
    emptyText: "No text to display. Check attachments in the original app.",
    clipped:
      "Only part of the text is shown. Open the original app for the full message and attachments.",
    limited:
      "Up to the 100 most recently stored messages. This is not a total or unanswered count.",
    scope:
      "Only the company inbox after the configured start date is shown. Messages are not marked read or replied to.",
    retentionTitle: "Retention",
    retentionStatus: {
      open: "Open",
      closed: "Closed",
      protected: "Protected evidence",
    },
    retentionWindow: "Up to 30 days after closing",
    retentionReview: "Deletion is paused pending evidence review.",
    retentionProtected: "Protected evidence cannot be reopened or closed here.",
    retentionClosedAt: "Closed at",
    retentionDeleteAfter: "Scheduled deletion",
    retentionConflict:
      "Another administrator changed this case, or its retention window ended. Open it again to check the current state.",
    retentionUncertain:
      "The result could not be confirmed. Do not send the same change again; reopen the inquiry to check its current state.",
    retentionWarning:
      "Close only after confirming there is no booking, contract, payment, complaint, or dispute evidence. This is separate from WhatsApp consent STOP or booking completion.",
    closeConfirm: "Confirm no related evidence",
    closeCase: "Close case",
    protect: "Protect evidence",
    reopen: "Reopen",
    maintenanceTitle: "Retention maintenance",
    maintenanceStatus: {
      not_active: "Not connected or maintenance inactive",
      unknown: "Status unavailable",
      ok: "Checked",
      attention: "Needs attention",
      delayed: "Check delayed",
    },
    maintenanceChecked: "Last checked",
    copiesPurged: (count: number) => `${count} inquiry copies cleared`,
    draftsPurged: (count: number) => `${count} unsent drafts cleared`,
    lastSync: "Last sync",
    lastReceived: "Last confirmed receipt",
    noTime: "Not yet confirmed",
    locale: "en-US",
    statuses: {
      disabled: "Receiving off",
      not_configured: "Setup required",
      awaiting: "Awaiting receipt verification",
      received: "Receipt history verified",
      synced: "Sync verified",
      delayed: "Sync delayed",
      error: "Connection error",
      resync_required: "Reconnection check required",
      unknown: "Status unavailable",
    },
  },
  ja: {
    title: "業務メール · WhatsApp",
    subtitle: "受信したお問い合わせをまとめて確認。自動送信は無効です。",
    email: "業務用 Gmail",
    whatsapp: "WhatsApp",
    refresh: "お問い合わせを更新",
    loading: "お問い合わせを確認中",
    allChannels: "すべてのチャネル",
    channelLabel: "チャネル",
    searchLabel: "件名・送信者を検索",
    orderLabel: "並び順",
    newest: "新しい順",
    oldest: "古い順",
    clearFilters: "検索・絞り込みをリセット",
    noMatches: "取得した一覧に一致するお問い合わせはありません。",
    filterScope:
      "検索・並び替えは取得した一覧のみが対象です。本文は検索しません。",
    failed:
      "お問い合わせを確認できませんでした。接続状態と一覧を再度確認してください。",
    empty: "現在の表示範囲に受信したお問い合わせはありません。",
    disconnected: "受信接続はまだ完了していません。",
    show: "内容を見る",
    close: "内容を閉じる",
    noSubject: "件名なし",
    noSender: "送信者の確認が必要",
    previous: "前のお問い合わせ",
    next: "次のお問い合わせ",
    range: (start: number, end: number, count: number) =>
      `取得した${count}件のうち${start}–${end}件`,
    detailFailed:
      "内容を取得できません。保存期限切れ、または接続設定が変更された可能性があります。",
    emptyText:
      "表示できるテキストはありません。添付内容は元のアプリで確認してください。",
    clipped:
      "テキストの一部のみ表示しています。全文と添付は元のアプリで確認してください。",
    limited:
      "直近に保存した最大100件の範囲です。総件数や未返信件数ではありません。",
    scope:
      "設定した受信開始日以降の業務用受信箱のみ表示します。既読操作や返信は行いません。",
    retentionTitle: "保存管理",
    retentionStatus: {
      open: "進行中",
      closed: "相談終了",
      protected: "証拠保護",
    },
    retentionWindow: "相談終了後最大30日",
    retentionReview: "証拠確認のため削除を保留しています。",
    retentionProtected: "証拠保護中の相談は、ここで再開または終了できません。",
    retentionClosedAt: "終了時刻",
    retentionDeleteAfter: "削除予定時刻",
    retentionConflict:
      "別の管理者が状態を変更したか、保存期限が終了しました。もう一度開いて現在の状態を確認してください。",
    retentionUncertain:
      "結果を確認できませんでした。同じ変更を再送せず、問い合わせを開き直して現在の状態を確認してください。",
    retentionWarning:
      "予約・契約・決済・苦情・紛争の証拠がない場合のみ終了してください。WhatsAppのSTOP同意終了や予約完了とは別です。",
    closeConfirm: "関連証拠なしを確認",
    closeCase: "相談を終了",
    protect: "証拠を保護",
    reopen: "進行中に戻す",
    maintenanceTitle: "保存整理の状態",
    maintenanceStatus: {
      not_active: "未接続または整理が無効",
      unknown: "状態を確認できません",
      ok: "確認済み",
      attention: "確認が必要",
      delayed: "確認が遅れています",
    },
    maintenanceChecked: "最終確認",
    copiesPurged: (count: number) => `お問い合わせのコピーを${count}件整理`,
    draftsPurged: (count: number) => `未送信下書きを${count}件整理`,
    lastSync: "最終同期",
    lastReceived: "最終受信確認",
    noTime: "未確認",
    locale: "ja-JP",
    statuses: {
      disabled: "受信オフ",
      not_configured: "設定が必要",
      awaiting: "実際の受信確認待ち",
      received: "受信履歴を確認済み",
      synced: "同期を確認済み",
      delayed: "同期が遅延",
      error: "接続エラー",
      resync_required: "再接続の確認が必要",
      unknown: "状態を確認できません",
    },
  },
  zh: {
    title: "公司邮件 · WhatsApp",
    subtitle: "集中查看收到的咨询。自动发送已关闭。",
    email: "公司 Gmail",
    whatsapp: "WhatsApp",
    refresh: "刷新咨询",
    loading: "正在检查咨询",
    allChannels: "所有渠道",
    channelLabel: "渠道",
    searchLabel: "搜索主题或发件人",
    orderLabel: "排序",
    newest: "最新优先",
    oldest: "最早优先",
    clearFilters: "重置搜索和筛选",
    noMatches: "已加载的列表中没有匹配的咨询。",
    filterScope: "搜索和排序仅适用于已加载的列表，不搜索消息正文。",
    failed: "无法检查咨询，请刷新连接状态和列表。",
    empty: "当前查看范围内没有收到的咨询。",
    disconnected: "接收连接尚未完成。",
    show: "查看内容",
    close: "关闭内容",
    noSubject: "无主题",
    noSender: "需要确认发件人",
    previous: "上一页咨询",
    next: "下一页咨询",
    range: (start: number, end: number, count: number) =>
      `已加载${count}条，显示${start}–${end}条`,
    detailFailed: "无法加载内容，可能已过期或连接设置已更改。",
    emptyText: "没有可显示的文本，请在原应用中查看附件。",
    clipped: "仅显示部分文本，请在原应用中查看完整内容和附件。",
    limited: "最多显示最近保存的100条，不代表咨询总数或未回复数量。",
    scope: "仅显示设定开始日期之后的公司收件箱，不会标记已读或回复。",
    retentionTitle: "保存管理",
    retentionStatus: {
      open: "进行中",
      closed: "已结束",
      protected: "证据保护",
    },
    retentionWindow: "结束后最多30天",
    retentionReview: "等待证据审查，暂缓删除。",
    retentionProtected: "受保护的证据不能在这里恢复或结束。",
    retentionClosedAt: "结束时间",
    retentionDeleteAfter: "计划删除时间",
    retentionConflict:
      "其他管理员已更改此咨询，或保存期限已结束。请重新打开以确认当前状态。",
    retentionUncertain:
      "无法确认请求结果。请勿再次发送相同变更；请重新打开咨询确认当前状态。",
    retentionWarning:
      "仅在确认没有预订、合同、付款、投诉或争议证据后结束。与WhatsApp STOP同意结束或预订完成无关。",
    closeConfirm: "确认没有相关证据",
    closeCase: "结束咨询",
    protect: "保护证据",
    reopen: "恢复进行中",
    maintenanceTitle: "保存清理状态",
    maintenanceStatus: {
      not_active: "未连接或清理未启用",
      unknown: "无法确认状态",
      ok: "已确认",
      attention: "需要确认",
      delayed: "确认延迟",
    },
    maintenanceChecked: "最近确认",
    copiesPurged: (count: number) => `已清理${count}份咨询副本`,
    draftsPurged: (count: number) => `已清理${count}份未发送草稿`,
    lastSync: "最近同步",
    lastReceived: "最近确认接收",
    noTime: "尚未确认",
    locale: "zh-CN",
    statuses: {
      disabled: "接收已关闭",
      not_configured: "需要设置",
      awaiting: "等待实际接收验证",
      received: "已确认接收记录",
      synced: "已确认同步",
      delayed: "同步延迟",
      error: "连接错误",
      resync_required: "需要检查重新连接",
      unknown: "无法确认状态",
    },
  },
} satisfies Record<Language, object>;

export type ExternalInboxChannelState =
  keyof typeof adminExternalInboxCopy.ko.statuses;
export interface ExternalInboxMessage {
  id: string;
  channel: "email" | "whatsapp";
  sourceAtMs: number;
  receivedAtMs: number;
  sender: string;
  subject: string;
  kind: string;
  truncated: boolean;
}
export interface ExternalInboxRetention {
  caseId: string;
  status: "open" | "closed" | "protected";
  revision: number;
  closedAtMs: number;
  deleteAfterMs: number;
  reviewRequired: boolean;
}
export interface ExternalInboxRetentionMaintenance {
  status: "not_active" | "unknown" | "ok" | "attention" | "delayed";
  checkedAtMs: number | null;
  copiesPurged: number | null;
  draftsPurged: number | null;
}
export interface ExternalInboxOverview {
  generatedAtMs: number;
  channels: {
    channel: "email" | "whatsapp";
    status: ExternalInboxChannelState;
    lastSuccessAtMs: number | null;
    lastReceivedAtMs: number | null;
  }[];
  messages: ExternalInboxMessage[];
  possiblyTruncated: boolean;
  listStatus: "ok" | "unknown" | "not_connected";
  retentionMaintenance?: ExternalInboxRetentionMaintenance;
}

export function isExternalInboxMessage(
  value: unknown,
): value is ExternalInboxMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as ExternalInboxMessage;
  return (
    typeof item.id === "string" &&
    /^[a-f0-9]{64}$/.test(item.id) &&
    ["email", "whatsapp"].includes(item.channel) &&
    Number.isSafeInteger(item.sourceAtMs) &&
    item.sourceAtMs > 0 &&
    item.sourceAtMs <= 8_640_000_000_000_000 &&
    Number.isSafeInteger(item.receivedAtMs) &&
    item.receivedAtMs > 0 &&
    typeof item.sender === "string" &&
    item.sender.length <= 640 &&
    typeof item.subject === "string" &&
    item.subject.length <= 512 &&
    typeof item.kind === "string" &&
    item.kind.length <= 32 &&
    typeof item.truncated === "boolean"
  );
}

export function isExternalInboxRetention(
  value: unknown,
): value is ExternalInboxRetention {
  if (!value || typeof value !== "object") return false;
  const item = value as ExternalInboxRetention;
  return (
    typeof item.caseId === "string" &&
    /^[a-f0-9]{64}$/.test(item.caseId) &&
    ["open", "closed", "protected"].includes(item.status) &&
    Number.isInteger(item.revision) &&
    item.revision >= 1 &&
    [item.closedAtMs, item.deleteAfterMs].every(
      (ms) => Number.isSafeInteger(ms) && ms >= 0,
    ) &&
    typeof item.reviewRequired === "boolean"
  );
}

export function isExternalInboxDetail(
  value: unknown,
): value is ExternalInboxMessage & {
  text: string;
  retention?: ExternalInboxRetention;
} {
  if (!isExternalInboxMessage(value)) return false;
  const text = (value as ExternalInboxMessage & { text?: unknown }).text;
  const retention = (value as { retention?: unknown }).retention;
  if (retention !== undefined && !isExternalInboxRetention(retention))
    return false;
  return typeof text === "string" && text.length <= 8000;
}

export function isExternalInboxRetentionMaintenance(
  value: unknown,
  generatedAtMs: number,
): value is ExternalInboxRetentionMaintenance {
  if (!value || typeof value !== "object") return false;
  const item = value as ExternalInboxRetentionMaintenance;
  const safeCount = (count: unknown) =>
    count === null ||
    (typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 0 &&
      count <= 1_000_000);
  return (
    ["not_active", "unknown", "ok", "attention", "delayed"].includes(
      item.status,
    ) &&
    (item.checkedAtMs === null ||
      (Number.isSafeInteger(item.checkedAtMs) &&
        item.checkedAtMs > 0 &&
        item.checkedAtMs <= generatedAtMs)) &&
    safeCount(item.copiesPurged) &&
    safeCount(item.draftsPurged)
  );
}

export function isExternalInboxOverview(
  value: unknown,
): value is ExternalInboxOverview {
  if (!value || typeof value !== "object") return false;
  const item = value as ExternalInboxOverview;
  return (
    Number.isSafeInteger(item.generatedAtMs) &&
    item.generatedAtMs > 0 &&
    Array.isArray(item.messages) &&
    item.messages.length <= 100 &&
    item.messages.every(isExternalInboxMessage) &&
    new Set(item.messages.map((message) => message.id)).size ===
      item.messages.length &&
    ["ok", "unknown", "not_connected"].includes(item.listStatus) &&
    typeof item.possiblyTruncated === "boolean" &&
    Array.isArray(item.channels) &&
    item.channels.length === 2 &&
    new Set(item.channels.map((channel) => channel?.channel)).size === 2 &&
    (item.retentionMaintenance === undefined ||
      isExternalInboxRetentionMaintenance(
        item.retentionMaintenance,
        item.generatedAtMs,
      )) &&
    item.channels.every(
      (channel) =>
        channel &&
        ["email", "whatsapp"].includes(channel.channel) &&
        Object.hasOwn(adminExternalInboxCopy.en.statuses, channel.status) &&
        [channel.lastSuccessAtMs, channel.lastReceivedAtMs].every(
          (ms) =>
            ms === null ||
            (Number.isSafeInteger(ms) && ms > 0 && ms <= item.generatedAtMs),
        ),
    )
  );
}
