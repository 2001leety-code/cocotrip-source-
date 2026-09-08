import type { Language } from '@/i18n';

export interface AdminAiOpsCopy {
  locale: string;
  pageTitle: string;
  pageDescription: string;
  title: string;
  subtitle: string;
  adminHome: string;
  refresh: string;
  refreshStatus: string;
  refreshing: string;
  refreshComplete: string;
  refreshPartial: string;
  refreshFailed: string;
  refreshPending: string;
  updatedAt: (time: string) => string;
  previewData: string;
  previewMode: string;
  serverMode: string;
  dateUnknown: string;
  ageWithinHour: string;
  ageHours: (count: number) => string;
  ageDays: (count: number) => string;
  priorityLabels: Record<'P0' | 'P1' | 'P2' | 'P3', string>;
  automationLabels: Record<'ok' | 'attention' | 'retrying' | 'off' | 'unknown' | 'unlinked', string>;
  reservationLabels: Record<'confirmed' | 'completed' | 'awaiting_verification' | 'pending' | 'refunded' | 'canceled' | 'cancelled', string>;
  statusUnknown: string;
  dispatchAccepted: string;
  dispatchNotRequired: string;
  dispatchRejected: string;
  dispatchUnknown: string;
  jumpTitle: string;
  jumpLabel: string;
  summary: string;
  urgentWork: string;
  automation: string;
  reservations: string;
  inquiries: string;
  connections: string;
  settings: string;
  language: string;
  setupTitle: string;
  summaryLabel: string;
  queryRangeLabel: string;
  queryRangeRecent: (limit: number) => string;
  queryRangeLimited: (limit: number | null) => string;
  queryRangeUnknown: string;
  actionRequired: string;
  urgentCount: (count: number) => string;
  todayReservations: string;
  upcomingCount: (count: number) => string;
  unansweredInquiries: string;
  inquiryCounts: (web: number, cs: number) => string;
  automationAttention: string;
  automationAttentionDetail: string;
  count: (count: number) => string;
  countUnit: string;
  workTitle: string;
  workDetail: string;
  workEmpty: string;
  workEmptyDetail: string;
  moreWork: (count: number) => string;
  shown: (visible: number, total: number) => string;
  allShown: string;
  automationTitle: string;
  automationDetail: string;
  outboundEmailRetry: string;
  autoAckLabel: string;
  autoAckReadyDetail: string;
  autoAckNotReadyDetail: string;
  sendingQueueEmpty: string;
  sendingQueueDetail: string;
  partialData: string;
  countUnavailable: string;
  workPartialEmpty: string;
  workPartialEmptyDetail: string;
  reservationsPartialEmpty: string;
  additionalConnectionsTitle: string;
  incomingEmail: string;
  whatsapp: string;
  apiHostingCosts: string;
  notConnected: string;
  reservationsTitle: string;
  reservationsDetail: string;
  reservationFilterLabel: string;
  today: string;
  week: string;
  weekDescription: string;
  allRecent: string;
  reservationsEmpty: string;
  moreReservations: (count: number) => string;
  test: string;
  tripDate: string;
  webInquiries: string;
  csInquiries: string;
  paymentReviews: string;
  inboxLabel: string;
  sourcesTitle: string;
  sourceFailures: (count: number) => string;
  allSourcesResponded: string;
  sourceFailed: string;
  sourceCount: (count: number, truncated: boolean) => string;
  sourceDetail: (limit: number, removed: number) => string;
  loadErrorTitle: string;
  loadError: string;
  retry: string;
  loading: string;
  partialErrorTitle: string;
  partialErrorDetail: string;
  staleTitle: string;
  staleDetail: (time: string) => string;
  readOnly: string;
}

/** Static screen copy only. Source records and their operational labels remain unchanged. */
export const adminAiOpsCopy: Record<Language, AdminAiOpsCopy> = {
  ko: {
    locale: 'ko-KR',
    pageTitle: 'AI 운영센터 (관리자)',
    pageDescription: 'CocoTrip 예약과 운영을 한눈에 확인하는 관리자 화면입니다.',
    title: 'AI 운영센터',
    subtitle: '예약 · 문의 · 자동화 한눈에 보기',
    adminHome: '관리자 홈으로',
    refresh: '새로고침',
    refreshStatus: '자료 갱신 상태',
    refreshing: '갱신 중',
    refreshComplete: '갱신 완료',
    refreshPartial: '일부 자료 갱신',
    refreshFailed: '갱신 실패',
    refreshPending: '갱신 대기 중',
    updatedAt: (time) => `마지막 화면 조회 ${time}`,
    previewData: '미리보기 데이터',
    previewMode: '미리보기 모드',
    serverMode: '운영 연동 모드',
    dateUnknown: '날짜 미정',
    ageWithinHour: '1시간 이내',
    ageHours: (count) => `${count}시간 대기`,
    ageDays: (count) => `${count}일 대기`,
    priorityLabels: { P0: '즉시', P1: '우선', P2: '확인', P3: '일반' },
    automationLabels: { ok: '정상', attention: '수동 확인', retrying: '재시도 중', off: '꺼짐', unknown: '확인 실패', unlinked: '미연동' },
    reservationLabels: { confirmed: '확정', completed: '완료', awaiting_verification: '입금 대기', pending: '대기', refunded: '환불 완료', canceled: '취소', cancelled: '취소' },
    statusUnknown: '상태 미확인',
    dispatchAccepted: '배차 완료',
    dispatchNotRequired: '배차 불필요',
    dispatchRejected: '재배차 필요',
    dispatchUnknown: '배차 미확인',
    jumpTitle: '한눈에 이동',
    jumpLabel: '운영 센터 섹션 바로가기',
    summary: '요약',
    urgentWork: '긴급업무',
    automation: '자동화',
    reservations: '예약',
    inquiries: '문의',
    connections: '연결상태',
    settings: '설정',
    language: '화면 언어',
    setupTitle: '앱 설치 및 설정',
    summaryLabel: '운영 핵심 요약',
    queryRangeLabel: '화면 조회 범위',
    queryRangeRecent: (limit) => `출처별 최대 ${limit}건을 조회한 결과입니다. 전체 기간 합계가 아닙니다.`,
    queryRangeLimited: (limit) => `${limit === null ? '일부 출처가 조회 한도' : `일부 출처가 ${limit}건 조회 한도`}에 도달했습니다. 추가 대기 건이 있을 수 있습니다.`,
    queryRangeUnknown: '조회 범위를 확인하지 못했습니다. 보이는 건수를 전체 대기 건수로 보지 마세요.',
    actionRequired: '처리할 일',
    urgentCount: (count) => `즉시·우선 ${count}건`,
    todayReservations: '오늘 예약',
    upcomingCount: (count) => `오늘 + 7일 ${count}건`,
    unansweredInquiries: '미답변 문의',
    inquiryCounts: (web, cs) => `웹 ${web} · CS ${cs}`,
    automationAttention: '자동화 주의',
    automationAttentionDetail: '재시도·자료 연결 포함',
    count: (count) => `${count}건`,
    countUnit: '건',
    workTitle: '지금 해야 할 일',
    workDetail: '긴급도와 대기시간 순서',
    workEmpty: '지금 급한 업무가 없습니다',
    workEmptyDetail: '각 원본의 조회 성공 여부는 아래 자료 상태에서 확인할 수 있습니다.',
    moreWork: (count) => `${count}건 더 보기`,
    shown: (visible, total) => `전체 ${total}건 중 ${visible}건 표시`,
    allShown: '전체 표시 중',
    automationTitle: '자동화 상태',
    automationDetail: '실행 결과가 없는 항목은 미연동으로 표시',
    outboundEmailRetry: '고객 메일 발신 재시도',
    autoAckLabel: '문의 자동 접수확인',
    autoAckReadyDetail: '서버 설정 준비 · 실제 발송 미검증 · 최종 답변은 승인 후',
    autoAckNotReadyDetail: '꺼짐 또는 서버 설정 미완료 · 실제 발송 미검증',
    sendingQueueEmpty: '대기 없음',
    sendingQueueDetail: '발신 재시도 대기 상태이며, 실행 성공이나 메일 수신 완료를 뜻하지 않습니다.',
    partialData: '일부 자료 기준',
    countUnavailable: '확인 불가',
    workPartialEmpty: '자료 확인이 필요합니다',
    workPartialEmptyDetail: '일부 원본을 읽지 못해 남은 업무를 확인할 수 없습니다.',
    reservationsPartialEmpty: '일부 예약 자료를 확인하지 못했습니다.',
    additionalConnectionsTitle: '아직 이 화면에 연결되지 않음',
    incomingEmail: '수신 메일',
    whatsapp: 'WhatsApp',
    apiHostingCosts: 'API·호스팅 비용',
    notConnected: '화면 미연동',
    reservationsTitle: '통합 예약 흐름',
    reservationsDetail: '온라인·입금 대기·MOOD를 원본 식별자로 정리',
    reservationFilterLabel: '예약 기간 필터',
    today: '오늘',
    week: '오늘 + 7일',
    weekDescription: '오늘과 이후 7일을 포함합니다.',
    allRecent: '최근 전체',
    reservationsEmpty: '선택한 기간에 표시할 예약이 없습니다.',
    moreReservations: (count) => `예약 ${count}건 더 보기`,
    test: '테스트',
    tripDate: '여행일',
    webInquiries: '웹 문의',
    csInquiries: 'CS 문의',
    paymentReviews: '결제 격리',
    inboxLabel: '문의와 검토 바로가기',
    sourcesTitle: '자료 연결 상태',
    sourceFailures: (count) => `${count}곳 확인 실패`,
    allSourcesResponded: '예약·문의·자동화 조회 정상',
    sourceFailed: '실패',
    sourceCount: (count, truncated) => `${count}${truncated ? '+' : ''}건`,
    sourceDetail: (limit, removed) => `출처별 최대 ${limit}건 조회 기준 · 확정된 입금 대기 중복 ${removed}건을 명시적 예약 식별자로만 정리했습니다.`,
    loadErrorTitle: '운영 자료를 불러오지 못했습니다',
    loadError: '운영 자료를 불러오지 못했습니다.',
    retry: '다시 불러오기',
    loading: '원본 자료를 안전하게 모으는 중…',
    partialErrorTitle: '일부 자료를 확인하지 못했습니다.',
    partialErrorDetail: '확인된 자료만 표시합니다. 실패한 원본의 건수·업무는 확정할 수 없습니다.',
    staleTitle: '갱신 실패 — 이전 자료를 표시합니다',
    staleDetail: (time) => `마지막 성공 ${time} · 최신 상태가 아닐 수 있습니다. 다시 불러오세요.`,
    readOnly: '읽기 전용 화면 · 원본 예약·문의·결제 상태를 변경하지 않습니다.',
  },
  en: {
    locale: 'en-US',
    pageTitle: 'AI Operations Center (Admin)',
    pageDescription: 'View CocoTrip reservations and operations in one place.',
    title: 'AI Operations Center',
    subtitle: 'Reservations, inquiries and automation at a glance',
    adminHome: 'Back to admin home',
    refresh: 'Refresh',
    refreshStatus: 'Data refresh status',
    refreshing: 'Refreshing',
    refreshComplete: 'Refresh complete',
    refreshPartial: 'Partially refreshed',
    refreshFailed: 'Refresh failed',
    refreshPending: 'Waiting to refresh',
    updatedAt: (time) => `Last screen data request: ${time}`,
    previewData: 'Preview data',
    previewMode: 'Preview mode',
    serverMode: 'Connected mode',
    dateUnknown: 'Date not set',
    ageWithinHour: 'Under 1 hour',
    ageHours: (count) => `Waiting ${count} ${count === 1 ? 'hour' : 'hours'}`,
    ageDays: (count) => `Waiting ${count} ${count === 1 ? 'day' : 'days'}`,
    priorityLabels: { P0: 'Immediate', P1: 'Priority', P2: 'Review', P3: 'Normal' },
    automationLabels: { ok: 'Normal', attention: 'Manual review', retrying: 'Retrying', off: 'Off', unknown: 'Check failed', unlinked: 'Not connected' },
    reservationLabels: { confirmed: 'Confirmed', completed: 'Completed', awaiting_verification: 'Awaiting deposit', pending: 'Pending', refunded: 'Refunded', canceled: 'Canceled', cancelled: 'Canceled' },
    statusUnknown: 'Status not verified',
    dispatchAccepted: 'Vehicle assigned',
    dispatchNotRequired: 'No vehicle assignment needed',
    dispatchRejected: 'Reassignment needed',
    dispatchUnknown: 'Assignment not verified',
    jumpTitle: 'Quick navigation',
    jumpLabel: 'Operations center section shortcuts',
    summary: 'Summary',
    urgentWork: 'Urgent tasks',
    automation: 'Automation',
    reservations: 'Reservations',
    inquiries: 'Inquiries',
    connections: 'Connections',
    settings: 'Settings',
    language: 'Screen language',
    setupTitle: 'App installation and settings',
    summaryLabel: 'Key operations summary',
    queryRangeLabel: 'Screen query scope',
    queryRangeRecent: (limit) => `Based on up to ${limit} queried records per source, not an all-time total.`,
    queryRangeLimited: (limit) => `${limit === null ? 'Some sources reached their query limit' : `Some sources reached the ${limit}-record query limit`}. Additional pending items may remain outside this view.`,
    queryRangeUnknown: 'The query scope could not be confirmed. Shown counts are not a complete pending total.',
    actionRequired: 'Action required',
    urgentCount: (count) => `${count} immediate or priority`,
    todayReservations: 'Today’s reservations',
    upcomingCount: (count) => `Today + 7 days: ${count}`,
    unansweredInquiries: 'Unanswered inquiries',
    inquiryCounts: (web, cs) => `Web ${web} · Support ${cs}`,
    automationAttention: 'Automation alerts',
    automationAttentionDetail: 'Includes retries and data connections',
    count: (count) => `${count} ${count === 1 ? 'item' : 'items'}`,
    countUnit: '',
    workTitle: 'Tasks to handle now',
    workDetail: 'Ordered by urgency and waiting time',
    workEmpty: 'No urgent tasks right now',
    workEmptyDetail: 'Check the data connection status below to see whether each source was loaded successfully.',
    moreWork: (count) => `Show ${count} more ${count === 1 ? 'task' : 'tasks'}`,
    shown: (visible, total) => `Showing ${visible} of ${total}`,
    allShown: 'Showing all',
    automationTitle: 'Automation status',
    automationDetail: 'Items without execution results are shown as not connected',
    outboundEmailRetry: 'Customer email sending retries',
    autoAckLabel: 'Automatic inquiry acknowledgment',
    autoAckReadyDetail: 'Server configured · delivery unverified · final reply requires approval',
    autoAckNotReadyDetail: 'Off or server setup incomplete · delivery unverified',
    sendingQueueEmpty: 'Nothing queued',
    sendingQueueDetail: 'This is the sending retry queue, not proof of successful execution or received mail.',
    partialData: 'Partial data only',
    countUnavailable: 'Not verified',
    workPartialEmpty: 'Source data needs checking',
    workPartialEmptyDetail: 'Some sources could not be read, so remaining tasks cannot be confirmed.',
    reservationsPartialEmpty: 'Some reservation data could not be checked.',
    additionalConnectionsTitle: 'Not connected to this screen yet',
    incomingEmail: 'Incoming email',
    whatsapp: 'WhatsApp',
    apiHostingCosts: 'API and hosting costs',
    notConnected: 'Not connected here',
    reservationsTitle: 'Unified reservations',
    reservationsDetail: 'Online, pending deposits and MOOD matched by source identifiers',
    reservationFilterLabel: 'Reservation date filter',
    today: 'Today',
    week: 'Today + 7 days',
    weekDescription: 'Includes today and the following 7 days.',
    allRecent: 'All recent',
    reservationsEmpty: 'No reservations to display for this period.',
    moreReservations: (count) => `Show ${count} more ${count === 1 ? 'reservation' : 'reservations'}`,
    test: 'Test',
    tripDate: 'Trip date',
    webInquiries: 'Web inquiries',
    csInquiries: 'Support inquiries',
    paymentReviews: 'Quarantined payments',
    inboxLabel: 'Inquiry and review shortcuts',
    sourcesTitle: 'Data connection status',
    sourceFailures: (count) => `${count} ${count === 1 ? 'source' : 'sources'} failed`,
    allSourcesResponded: 'Reservation, inquiry and automation queries succeeded',
    sourceFailed: 'Failed',
    sourceCount: (count, truncated) => `${count}${truncated ? '+' : ''} ${count === 1 && !truncated ? 'item' : 'items'}`,
    sourceDetail: (limit, removed) => `Based on up to ${limit} queried records per source. Removed ${removed} confirmed pending-deposit duplicates using explicit reservation identifiers only.`,
    loadErrorTitle: 'Could not load operations data',
    loadError: 'Could not load operations data.',
    retry: 'Try loading again',
    loading: 'Safely gathering source data…',
    partialErrorTitle: 'Some data could not be checked.',
    partialErrorDetail: 'Only retrieved data is shown. Counts and tasks from failed sources cannot be confirmed.',
    staleTitle: 'Refresh failed — showing previous data',
    staleDetail: (time) => `Last successful refresh: ${time}. This may not be current. Try loading again.`,
    readOnly: 'Read-only view · Does not change source reservation, inquiry or payment statuses.',
  },
  ja: {
    locale: 'ja-JP',
    pageTitle: 'AI運営センター（管理者）',
    pageDescription: 'CocoTripの予約と運営状況をまとめて確認する管理画面です。',
    title: 'AI運営センター',
    subtitle: '予約・お問い合わせ・自動化をまとめて確認',
    adminHome: '管理者ホームへ',
    refresh: '再読み込み',
    refreshStatus: 'データの更新状況',
    refreshing: '更新中',
    refreshComplete: '更新完了',
    refreshPartial: '一部のデータを更新',
    refreshFailed: '更新失敗',
    refreshPending: '更新待ち',
    updatedAt: (time) => `画面データの最終取得 ${time}`,
    previewData: 'プレビューデータ',
    previewMode: 'プレビューモード',
    serverMode: '運用連携モード',
    dateUnknown: '日付未定',
    ageWithinHour: '1時間以内',
    ageHours: (count) => `${count}時間待機`,
    ageDays: (count) => `${count}日待機`,
    priorityLabels: { P0: '即時', P1: '優先', P2: '確認', P3: '通常' },
    automationLabels: { ok: '正常', attention: '手動確認', retrying: '再試行中', off: 'オフ', unknown: '確認失敗', unlinked: '未連携' },
    reservationLabels: { confirmed: '確定', completed: '完了', awaiting_verification: '入金待ち', pending: '保留', refunded: '返金済み', canceled: 'キャンセル', cancelled: 'キャンセル' },
    statusUnknown: '状態未確認',
    dispatchAccepted: '配車完了',
    dispatchNotRequired: '配車不要',
    dispatchRejected: '再配車が必要',
    dispatchUnknown: '配車未確認',
    jumpTitle: 'すばやく移動',
    jumpLabel: '運営センターのセクションへ移動',
    summary: '概要',
    urgentWork: '緊急業務',
    automation: '自動化',
    reservations: '予約',
    inquiries: 'お問い合わせ',
    connections: '接続状態',
    settings: '設定',
    language: '表示言語',
    setupTitle: 'アプリのインストールと設定',
    summaryLabel: '運営の主要概要',
    queryRangeLabel: '画面の取得範囲',
    queryRangeRecent: (limit) => `各取得元から最大${limit}件を取得した結果です。全期間の合計ではありません。`,
    queryRangeLimited: (limit) => `${limit === null ? '一部の取得元で取得上限' : `一部の取得元で${limit}件の取得上限`}に達しました。未表示の未対応項目がほかにもある可能性があります。`,
    queryRangeUnknown: '取得範囲を確認できませんでした。表示件数を未対応項目の全件数として扱わないでください。',
    actionRequired: '対応が必要',
    urgentCount: (count) => `即時・優先 ${count}件`,
    todayReservations: '本日の予約',
    upcomingCount: (count) => `今日＋7日 ${count}件`,
    unansweredInquiries: '未回答のお問い合わせ',
    inquiryCounts: (web, cs) => `ウェブ ${web} · サポート ${cs}`,
    automationAttention: '自動化の要確認',
    automationAttentionDetail: '再試行・データ接続を含む',
    count: (count) => `${count}件`,
    countUnit: '件',
    workTitle: '今すぐ対応する業務',
    workDetail: '緊急度と待機時間の順',
    workEmpty: '現在、急ぎの業務はありません',
    workEmptyDetail: '各データ元の取得に成功したかどうかは、下のデータ接続状態で確認できます。',
    moreWork: (count) => `さらに${count}件を表示`,
    shown: (visible, total) => `全${total}件中${visible}件を表示`,
    allShown: 'すべて表示中',
    automationTitle: '自動化の状態',
    automationDetail: '実行結果がない項目は未連携と表示',
    outboundEmailRetry: '顧客メール送信の再試行',
    autoAckLabel: 'お問い合わせの自動受付確認',
    autoAckReadyDetail: 'サーバー設定済み · 実際の送信は未検証 · 最終回答は承認後',
    autoAckNotReadyDetail: '停止中または設定未完了 · 実際の送信は未検証',
    sendingQueueEmpty: '待機なし',
    sendingQueueDetail: '送信の再試行待ち状態です。実行成功やメール受信完了を示すものではありません。',
    partialData: '一部のデータのみ',
    countUnavailable: '確認できません',
    workPartialEmpty: 'データの確認が必要です',
    workPartialEmptyDetail: '一部の取得元を読み込めず、残りの業務を確認できません。',
    reservationsPartialEmpty: '一部の予約データを確認できませんでした。',
    additionalConnectionsTitle: 'この画面にはまだ未接続',
    incomingEmail: '受信メール',
    whatsapp: 'WhatsApp',
    apiHostingCosts: 'API・ホスティング費用',
    notConnected: '画面に未連携',
    reservationsTitle: '予約の一元管理',
    reservationsDetail: 'オンライン・入金待ち・MOODを元の識別子で整理',
    reservationFilterLabel: '予約期間フィルター',
    today: '今日',
    week: '今日＋7日',
    weekDescription: '今日と、その後の7日間を含みます。',
    allRecent: '最近のすべて',
    reservationsEmpty: '選択した期間に表示する予約はありません。',
    moreReservations: (count) => `予約をさらに${count}件表示`,
    test: 'テスト',
    tripDate: '旅行日',
    webInquiries: 'ウェブのお問い合わせ',
    csInquiries: 'サポートのお問い合わせ',
    paymentReviews: '決済の隔離',
    inboxLabel: 'お問い合わせと確認へのショートカット',
    sourcesTitle: 'データ接続状態',
    sourceFailures: (count) => `${count}か所で確認失敗`,
    allSourcesResponded: '予約・問い合わせ・自動処理の取得は正常',
    sourceFailed: '失敗',
    sourceCount: (count, truncated) => `${count}${truncated ? '+' : ''}件`,
    sourceDetail: (limit, removed) => `各データ元から最大${limit}件を取得した結果です。確定済みの入金待ちの重複${removed}件を、明示的な予約識別子だけで整理しました。`,
    loadErrorTitle: '運営データを読み込めませんでした',
    loadError: '運営データを読み込めませんでした。',
    retry: 'もう一度読み込む',
    loading: '元のデータを安全に収集中…',
    partialErrorTitle: '一部のデータを確認できませんでした。',
    partialErrorDetail: '取得できたデータのみ表示します。失敗した取得元の件数・業務は確定できません。',
    staleTitle: '更新失敗 — 前回のデータを表示しています',
    staleDetail: (time) => `最後に成功した更新：${time}。最新の状態ではない可能性があります。もう一度読み込んでください。`,
    readOnly: '閲覧専用画面 · 元の予約・お問い合わせ・決済の状態は変更しません。',
  },
  zh: {
    locale: 'zh-CN',
    pageTitle: 'AI运营中心（管理员）',
    pageDescription: '集中查看CocoTrip预约和运营情况的管理页面。',
    title: 'AI运营中心',
    subtitle: '预约、咨询与自动化一目了然',
    adminHome: '返回管理员首页',
    refresh: '刷新',
    refreshStatus: '数据刷新状态',
    refreshing: '正在更新',
    refreshComplete: '更新完成',
    refreshPartial: '部分数据已更新',
    refreshFailed: '更新失败',
    refreshPending: '等待更新',
    updatedAt: (time) => `页面数据最后查询 ${time}`,
    previewData: '预览数据',
    previewMode: '预览模式',
    serverMode: '运营连接模式',
    dateUnknown: '日期待定',
    ageWithinHour: '1小时以内',
    ageHours: (count) => `已等待${count}小时`,
    ageDays: (count) => `已等待${count}天`,
    priorityLabels: { P0: '立即', P1: '优先', P2: '确认', P3: '普通' },
    automationLabels: { ok: '正常', attention: '人工确认', retrying: '重试中', off: '已关闭', unknown: '检查失败', unlinked: '未连接' },
    reservationLabels: { confirmed: '已确认', completed: '已完成', awaiting_verification: '等待汇款', pending: '待处理', refunded: '已退款', canceled: '已取消', cancelled: '已取消' },
    statusUnknown: '状态未确认',
    dispatchAccepted: '已派车',
    dispatchNotRequired: '无需派车',
    dispatchRejected: '需要重新派车',
    dispatchUnknown: '派车状态未确认',
    jumpTitle: '快速跳转',
    jumpLabel: '运营中心分区快捷导航',
    summary: '概览',
    urgentWork: '紧急任务',
    automation: '自动化',
    reservations: '预约',
    inquiries: '咨询',
    connections: '连接状态',
    settings: '设置',
    language: '界面语言',
    setupTitle: '应用安装与设置',
    summaryLabel: '运营重点概览',
    queryRangeLabel: '页面查询范围',
    queryRangeRecent: (limit) => `以各来源最多${limit}条查询记录为准，并非全部历史总数。`,
    queryRangeLimited: (limit) => `${limit === null ? '部分来源达到查询上限' : `部分来源达到${limit}条的查询上限`}。可能还有其他未显示的待办事项。`,
    queryRangeUnknown: '无法确认查询范围。请勿将显示数量视为全部待办总数。',
    actionRequired: '待处理事项',
    urgentCount: (count) => `立即与优先 ${count}项`,
    todayReservations: '今日预约',
    upcomingCount: (count) => `今天＋7天 ${count}项`,
    unansweredInquiries: '未回复咨询',
    inquiryCounts: (web, cs) => `网页 ${web} · 客服 ${cs}`,
    automationAttention: '自动化提醒',
    automationAttentionDetail: '包括重试与数据连接',
    count: (count) => `${count}项`,
    countUnit: '项',
    workTitle: '现在需要处理的事项',
    workDetail: '按紧急程度和等待时间排序',
    workEmpty: '目前没有紧急任务',
    workEmptyDetail: '请在下方的数据连接状态中确认各数据源是否读取成功。',
    moreWork: (count) => `再显示${count}项`,
    shown: (visible, total) => `共${total}项，已显示${visible}项`,
    allShown: '已显示全部',
    automationTitle: '自动化状态',
    automationDetail: '没有执行结果的项目显示为未连接',
    outboundEmailRetry: '客户邮件发送重试',
    autoAckLabel: '咨询自动收件确认',
    autoAckReadyDetail: '服务器配置就绪 · 实际发送未验证 · 最终回复须审批',
    autoAckNotReadyDetail: '已关闭或配置未完成 · 实际发送未验证',
    sendingQueueEmpty: '无待重试项',
    sendingQueueDetail: '此处显示发送重试队列，不代表执行成功或邮件已接收。',
    partialData: '仅含部分数据',
    countUnavailable: '无法确认',
    workPartialEmpty: '需要检查数据来源',
    workPartialEmptyDetail: '部分来源读取失败，无法确认剩余任务。',
    reservationsPartialEmpty: '部分预约数据无法确认。',
    additionalConnectionsTitle: '尚未连接到此页面',
    incomingEmail: '收件邮件',
    whatsapp: 'WhatsApp',
    apiHostingCosts: 'API及托管费用',
    notConnected: '页面未连接',
    reservationsTitle: '统一预约管理',
    reservationsDetail: '按原始标识整理在线预约、待汇款预约和MOOD',
    reservationFilterLabel: '预约日期筛选',
    today: '今天',
    week: '今天＋7天',
    weekDescription: '包含今天及之后的7天。',
    allRecent: '最近全部',
    reservationsEmpty: '所选期间没有可显示的预约。',
    moreReservations: (count) => `再显示${count}项预约`,
    test: '测试',
    tripDate: '旅行日期',
    webInquiries: '网页咨询',
    csInquiries: '客服咨询',
    paymentReviews: '隔离支付',
    inboxLabel: '咨询与审核快捷入口',
    sourcesTitle: '数据连接状态',
    sourceFailures: (count) => `${count}个来源检查失败`,
    allSourcesResponded: '预订、咨询及自动化查询正常',
    sourceFailed: '失败',
    sourceCount: (count, truncated) => `${count}${truncated ? '+' : ''}项`,
    sourceDetail: (limit, removed) => `以各数据源最多${limit}条查询记录为准。仅根据明确的预约标识整理了${removed}条已确认的待汇款重复记录。`,
    loadErrorTitle: '无法加载运营数据',
    loadError: '无法加载运营数据。',
    retry: '重新加载',
    loading: '正在安全地汇集原始数据…',
    partialErrorTitle: '部分数据无法确认。',
    partialErrorDetail: '仅显示已获取的数据。失败来源的数量与任务无法确认。',
    staleTitle: '更新失败 — 正在显示之前的数据',
    staleDetail: (time) => `最后成功更新：${time}。数据可能不是最新状态，请重新加载。`,
    readOnly: '只读页面 · 不会更改原始预约、咨询或支付状态。',
  },
};
