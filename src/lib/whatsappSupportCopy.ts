import type { Language } from '@/i18n';

export const WHATSAPP_SUPPORT_START = 'COCOTRIP SUPPORT START';
export const WHATSAPP_SUPPORT_STOP = 'COCOTRIP SUPPORT STOP';
export const WHATSAPP_SUPPORT_URL = 'https://wa.me/821087140611?text=COCOTRIP%20SUPPORT%20START';

export const whatsappSupportCopy = {
  ko: {
    title: 'WhatsApp 여행 상담', description: '상담 기록 범위를 확인한 뒤 WhatsApp으로 이동하세요.',
    back: '코코트립으로', language: '화면 언어', duration: '새 메시지 · 최대 2시간',
    scope: '동의하는 상담 기록 범위는 시작 문구가 접수된 뒤 최대 2시간 동안의 새 메시지입니다. 답변 준비에 AI 보조를 사용할 수 있습니다.',
    history: '과거 대화는 가져오지 않습니다. 개인적인 내용은 보내지 마세요.',
    privacyBoundary: '개인 대화와 완전히 분리되는 기능은 아닙니다.', more: '기록 처리 방식 자세히',
    transport: 'WhatsApp 알림 원문은 서버에 먼저 도착할 수 있습니다. 상담 여부에 따라 저장을 제한하는 방식이며, 개인 대화가 완전히 분리된다는 뜻은 아닙니다.',
    stopTitle: '상담 기록 처리를 끝내려면', stop: '아래 문구를 보내세요. 시작 후 2시간이 지나도 상담 범위가 끝납니다.',
    instruction: 'WhatsApp이 열리면 준비된 시작 문구만 먼저 보내고, 1초 이상 지난 뒤 새 메시지로 질문해 주세요. 문구를 바꾸거나 질문을 덧붙이면 동의로 인식되지 않습니다.',
    consent: '위 상담 기록 범위와 AI 보조 가능성을 이해했으며, 이 범위로 상담을 시작하는 데 동의합니다.',
    open: '동의하고 WhatsApp 열기', unchecked: '동의 항목을 선택하면 WhatsApp을 열 수 있습니다.',
    manual: '일반 WhatsApp 직접 문의는 계속 사람이 수동으로 처리합니다. 현재 자동 답장은 꺼져 있습니다.',
    linksTitle: 'WhatsApp 상담', linksSubtitle: '상담 기록 범위를 먼저 확인하고 문의하세요.',
    admin: {
      title: 'WhatsApp 개인 연락처 보호', intro: '상담 상태를 확인하고 개인 연락처를 수집 대상에서 제외합니다.',
      refresh: '보호 설정 새로고침', loading: '보호 설정 확인 중', changing: '변경 확인 중',
      signedOut: '관리자 로그인 후 보호 설정을 확인할 수 있습니다.', preview: '미리보기입니다. 실제 조회나 설정 변경은 전송하지 않습니다.',
      receivingOn: '수신 켜짐', receivingOff: '수신 꺼짐', ready: '개인정보 설정 가능', notReady: '개인정보 설정 준비 필요',
      offHelp: '수신이 꺼져 있어도 준비된 번호의 개인 연락처 제외는 미리 설정할 수 있습니다.',
      failed: '보호 설정을 확인하지 못했습니다. 현재 상태를 확인하기 전에는 변경할 수 없습니다.',
      unconfirmed: '변경 결과를 확인하지 못했습니다. 상담 종료나 제외·해제가 적용됐다고 간주하지 말고 새로고침해 확인하세요.',
      saved: '서버에서 변경된 상태를 다시 확인했습니다.', empty: '현재 조회 범위에 표시할 상담이나 제외 연락처가 없습니다.',
      sender: '제외할 WhatsApp 번호', senderHelp: '국가번호를 포함한 숫자만 입력하세요. + 기호나 공백은 넣지 않습니다.',
      invalidSender: '0이 아닌 국가번호로 시작하는 숫자 1~20자리인지 확인해 주세요.', block: '개인 연락처 제외', unblock: '제외 해제', close: '상담 종료',
      active: '상담 중', closed: '상담 종료됨', blocked: '개인 연락처 제외됨', expires: '상담 기한', noTime: '기록 없음',
      scope: '설정은 이후 수집 여부를 제어합니다. 원문이 서버에 도착하는 것까지 막지는 않으며, 이미 저장된 자료나 개인 WhatsApp 앱 대화를 삭제하지 않습니다. 제외 해제만으로 상담이 다시 시작되지는 않습니다. 자동 답장은 꺼져 있습니다.',
      limited: '제한된 조회 범위이며 전체 연락처 목록이 아닙니다.', previous: '이전 연락처', next: '다음 연락처', locale: 'ko-KR',
      range: (start: number, end: number, count: number) => `조회한 ${count}건 중 ${start}–${end}건`,
    },
  },
  en: {
    title: 'WhatsApp travel support', description: 'Review the consultation scope before opening WhatsApp.',
    back: 'Back to CocoTrip', language: 'Display language', duration: 'New messages · up to 2 hours',
    scope: 'The consultation-record scope you agree to covers new messages for up to two hours after the start phrase is received. AI assistance may be used to prepare replies.',
    history: 'Past conversations are not imported. Please do not send personal content.',
    privacyBoundary: 'This does not completely separate personal chats.', more: 'How records are processed',
    transport: 'Original WhatsApp notifications may reach the server first. Storage is limited according to consultation status; this does not mean personal chats are completely separated.',
    stopTitle: 'To end consultation recording', stop: 'Send the phrase below. The consultation scope also ends two hours after it starts.',
    instruction: 'When WhatsApp opens, send only the prepared start phrase first. Wait at least one second, then send your question in a new message. Changing the phrase or adding a question will not be recognized as consent.',
    consent: 'I understand this consultation-record scope and possible AI assistance, and agree to start a consultation within this scope.',
    open: 'Agree and open WhatsApp', unchecked: 'Select the agreement to enable the WhatsApp link.',
    manual: 'Regular direct WhatsApp inquiries are still handled manually by a person. Automatic replies are currently off.',
    linksTitle: 'WhatsApp support', linksSubtitle: 'Review the consultation-record scope before contacting us.',
    admin: {
      title: 'WhatsApp personal-contact protection', intro: 'Review consultation status and exclude personal contacts from collection.',
      refresh: 'Refresh protection settings', loading: 'Checking protection settings', changing: 'Confirming change',
      signedOut: 'Sign in as an administrator to view protection settings.', preview: 'Preview only. No live reads or setting changes are sent.',
      receivingOn: 'Receiving on', receivingOff: 'Receiving off', ready: 'Privacy settings available', notReady: 'Privacy setup required',
      offHelp: 'When the company number is configured, you can exclude personal contacts before receiving is enabled.',
      failed: 'Unable to check protection settings. Changes are unavailable until the current state is confirmed.',
      unconfirmed: 'The change could not be confirmed. Do not assume the consultation ended or the exclusion changed; refresh to check.',
      saved: 'The changed state was confirmed again on the server.', empty: 'No consultations or excluded contacts in the current view.',
      sender: 'WhatsApp number to exclude', senderHelp: 'Use digits including the country code, without a plus sign or spaces.',
      invalidSender: 'Use 1–20 digits starting with a non-zero country code.', block: 'Exclude personal contact', unblock: 'Remove exclusion', close: 'End consultation',
      active: 'Consultation active', closed: 'Consultation closed', blocked: 'Personal contact excluded', expires: 'Consultation expires', noTime: 'No record',
      scope: 'These settings control future collection. They do not prevent original notifications from reaching the server or delete stored records or chats in your personal WhatsApp app. Removing an exclusion does not restart a consultation. Automatic replies are off.',
      limited: 'A limited view, not a complete contact list.', previous: 'Previous contacts', next: 'Next contacts', locale: 'en-US',
      range: (start: number, end: number, count: number) => `${start}–${end} of ${count} loaded`,
    },
  },
  ja: {
    title: 'WhatsApp旅行相談', description: '相談記録の範囲を確認してからWhatsAppを開いてください。',
    back: 'CocoTripへ', language: '表示言語', duration: '新しいメッセージ · 最大2時間',
    scope: '同意する相談記録の範囲は、開始文の受信後、最大2時間の新しいメッセージです。回答の準備にAI支援を利用する場合があります。',
    history: '過去の会話は取り込みません。私的な内容は送らないでください。',
    privacyBoundary: '私的な会話を完全に分離する機能ではありません。', more: '記録処理の詳細',
    transport: 'WhatsApp通知の原文が先にサーバーへ届く場合があります。相談状態に応じて保存を制限する仕組みで、私的な会話が完全に分離されるという意味ではありません。',
    stopTitle: '相談記録の処理を終了するには', stop: '下の文を送信してください。開始から2時間が過ぎても相談範囲は終了します。',
    instruction: 'WhatsAppが開いたら、用意された開始文だけを先に送信し、1秒以上待ってから新しいメッセージで質問してください。文を変更したり質問を付け足すと、同意として認識されません。',
    consent: '相談記録の範囲とAI支援の可能性を理解し、この範囲で相談を開始することに同意します。',
    open: '同意してWhatsAppを開く', unchecked: '同意欄を選択するとWhatsAppを開けます。',
    manual: '通常のWhatsAppへの直接のお問い合わせは、引き続き人が手動で対応します。現在、自動返信は無効です。',
    linksTitle: 'WhatsApp相談', linksSubtitle: '相談記録の範囲を確認してからお問い合わせください。',
    admin: {
      title: 'WhatsAppの個人連絡先保護', intro: '相談状態を確認し、個人の連絡先を収集対象から除外します。',
      refresh: '保護設定を更新', loading: '保護設定を確認中', changing: '変更を確認中',
      signedOut: '管理者としてログインすると保護設定を確認できます。', preview: 'プレビューです。実際の照会や設定変更は送信しません。',
      receivingOn: '受信オン', receivingOff: '受信オフ', ready: 'プライバシー設定が可能', notReady: 'プライバシー設定の準備が必要',
      offHelp: '業務用番号の設定ができていれば、受信オフでも個人連絡先を事前に除外できます。',
      failed: '保護設定を確認できませんでした。現在の状態を確認するまで変更できません。',
      unconfirmed: '変更結果を確認できません。相談終了や除外・解除が適用されたと判断せず、更新して確認してください。',
      saved: 'サーバーで変更後の状態を再確認しました。', empty: '現在の表示範囲に相談や除外した連絡先はありません。',
      sender: '除外するWhatsApp番号', senderHelp: '国番号を含む数字のみを入力してください。+記号や空白は不要です。',
      invalidSender: '0以外の国番号で始まる1〜20桁の数字を入力してください。', block: '個人連絡先を除外', unblock: '除外を解除', close: '相談を終了',
      active: '相談中', closed: '相談終了', blocked: '個人連絡先を除外済み', expires: '相談期限', noTime: '記録なし',
      scope: '設定は今後の収集を制御します。原文がサーバーへ届くことを防ぐものではなく、保存済み記録や個人のWhatsAppアプリ内の会話も削除しません。除外解除だけでは相談は再開されません。自動返信は無効です。',
      limited: '限られた表示範囲で、全連絡先の一覧ではありません。', previous: '前の連絡先', next: '次の連絡先', locale: 'ja-JP',
      range: (start: number, end: number, count: number) => `取得した${count}件のうち${start}–${end}件`,
    },
  },
  zh: {
    title: 'WhatsApp旅行咨询', description: '打开WhatsApp前，请先了解咨询记录范围。',
    back: '返回CocoTrip', language: '显示语言', duration: '新消息 · 最多2小时',
    scope: '您同意的咨询记录范围为收到开始短语后最多2小时内的新消息。准备回复时可能使用AI辅助。',
    history: '不会导入过去的对话。请勿发送私人内容。',
    privacyBoundary: '此功能并不能完全隔离私人对话。', more: '记录处理详情',
    transport: 'WhatsApp通知原文可能先到达服务器。系统根据咨询状态限制保存，并不代表私人对话被完全隔离。',
    stopTitle: '结束咨询记录处理', stop: '请发送以下短语。开始2小时后，咨询范围也会结束。',
    instruction: 'WhatsApp打开后，请先单独发送准备好的开始短语，等待至少1秒后，再用新消息提问。修改短语或附加问题，将无法识别为同意。',
    consent: '我理解上述咨询记录范围及可能使用AI辅助，并同意在此范围内开始咨询。',
    open: '同意并打开WhatsApp', unchecked: '勾选同意后即可打开WhatsApp。',
    manual: '普通WhatsApp直接咨询仍由人工手动处理。目前自动回复已关闭。',
    linksTitle: 'WhatsApp咨询', linksSubtitle: '联系前请先了解咨询记录范围。',
    admin: {
      title: 'WhatsApp私人联系人保护', intro: '查看咨询状态，并将私人联系人排除在收集范围之外。',
      refresh: '刷新保护设置', loading: '正在检查保护设置', changing: '正在确认更改',
      signedOut: '管理员登录后可查看保护设置。', preview: '仅供预览，不会发送实际查询或设置更改。',
      receivingOn: '接收已开启', receivingOff: '接收已关闭', ready: '可设置隐私保护', notReady: '需要准备隐私设置',
      offHelp: '公司号码准备就绪后，即使接收关闭，也可提前排除私人联系人。',
      failed: '无法确认保护设置，确认当前状态前不能更改。',
      unconfirmed: '无法确认更改结果，请勿认定咨询已结束或排除设置已更改，请刷新确认。',
      saved: '已在服务器上再次确认更改后的状态。', empty: '当前查看范围内没有咨询或已排除的联系人。',
      sender: '要排除的WhatsApp号码', senderHelp: '请输入含国家代码的数字，不要输入加号或空格。',
      invalidSender: '请输入以非零国家代码开头的1至20位数字。', block: '排除私人联系人', unblock: '取消排除', close: '结束咨询',
      active: '咨询中', closed: '咨询已结束', blocked: '私人联系人已排除', expires: '咨询期限', noTime: '无记录',
      scope: '设置控制今后的收集，不会阻止原文到达服务器，也不会删除已保存记录或个人WhatsApp应用中的对话。取消排除不会自动重新开始咨询。自动回复已关闭。',
      limited: '仅限当前查询范围，并非完整联系人列表。', previous: '上一页联系人', next: '下一页联系人', locale: 'zh-CN',
      range: (start: number, end: number, count: number) => `已加载${count}条，显示${start}–${end}条`,
    },
  },
} satisfies Record<Language, object>;

export interface WhatsAppPrivacySession {
  id: string; sender: string; status: 'active' | 'closed' | 'blocked';
  startedAtMs: number | null; expiresAtMs: number | null; updatedAtMs: number;
}
export interface WhatsAppPrivacyOverview {
  generatedAtMs: number; enabled: boolean; ready: boolean;
  sessions: WhatsAppPrivacySession[]; possiblyTruncated: boolean;
}
export type WhatsAppPrivacyAction = 'close' | 'block' | 'unblock';

export function isWhatsAppPrivacyOverview(value: unknown): value is WhatsAppPrivacyOverview {
  if (!value || typeof value !== 'object') return false;
  const data = value as WhatsAppPrivacyOverview;
  const time = (ms: unknown): ms is number => typeof ms === 'number' && Number.isSafeInteger(ms) && ms > 0 && ms <= 8_640_000_000_000_000;
  return time(data.generatedAtMs) && typeof data.enabled === 'boolean' && typeof data.ready === 'boolean'
    && typeof data.possiblyTruncated === 'boolean' && Array.isArray(data.sessions) && data.sessions.length <= 100
    && data.sessions.every(session => session && typeof session === 'object'
      && typeof session.id === 'string' && /^[a-f0-9]{64}$/.test(session.id)
      && typeof session.sender === 'string' && /^[1-9]\d{0,19}$/.test(session.sender)
      && ['active', 'closed', 'blocked'].includes(session.status)
      && (session.startedAtMs === null || (time(session.startedAtMs) && session.startedAtMs <= data.generatedAtMs))
      && (session.expiresAtMs === null || time(session.expiresAtMs))
      && time(session.updatedAtMs) && session.updatedAtMs <= data.generatedAtMs)
    && new Set(data.sessions.map(session => session.id)).size === data.sessions.length
    && new Set(data.sessions.map(session => session.sender)).size === data.sessions.length
    && (data.ready || data.sessions.length === 0);
}
