export const ACCOUNT_DELETION_COPY = {
  en: {
    eyebrow: 'Privacy control',
    title: 'Request deletion of your CocoTrip account',
    lede: 'This public page lets you start a request to delete your CocoTrip account and the data associated with it.',
    howTitle: 'How to start your request',
    steps: [
      'Use the email address connected to your CocoTrip account.',
      'Email cocotripkr@gmail.com with the subject “[CocoTrip] Account deletion request”.',
      'We will reply with identity verification and the next steps.',
    ],
    cta: 'Email an account deletion request',
    scopeTitle: 'What the request covers',
    scopeBody: 'The request covers your CocoTrip account and data associated with that account. Transaction or dispute records may be kept when applicable law requires it, as explained in our Privacy Policy.',
    safetyTitle: 'Keep your account secure',
    safetyBody: 'Do not send passwords, one-time verification codes, card numbers, or PayPal details. This page starts a request; opening the email link does not immediately delete anything.',
    privacyLink: 'Read the Privacy Policy',
    signInNote: 'If you can sign in, you can also find this path under My Page → My Account → Request account deletion.',
  },
  ko: {
    eyebrow: '개인정보 관리',
    title: '코코트립 계정 삭제 요청',
    lede: '이 공개 화면에서 코코트립 계정과 해당 계정에 연결된 데이터의 삭제 요청을 시작할 수 있습니다.',
    howTitle: '요청하는 방법',
    steps: [
      '코코트립 계정에 연결된 이메일 주소를 사용해 주세요.',
      'cocotripkr@gmail.com으로 보내고 제목에 “[CocoTrip] Account deletion request”를 적어 주세요.',
      '계정 소유 확인과 다음 절차를 이메일로 안내해 드립니다.',
    ],
    cta: '계정 삭제 요청 이메일 보내기',
    scopeTitle: '삭제 요청 범위',
    scopeBody: '코코트립 계정과 해당 계정에 연결된 데이터가 요청 범위에 포함됩니다. 거래 또는 분쟁 기록은 관련 법률상 필요한 경우 개인정보처리방침에 안내된 기간 동안 보관될 수 있습니다.',
    safetyTitle: '계정 정보를 안전하게 보호하세요',
    safetyBody: '비밀번호, 일회용 인증번호, 카드번호, PayPal 정보는 보내지 마세요. 이 화면은 요청을 시작하는 곳이며 이메일 링크를 여는 즉시 자료가 삭제되지는 않습니다.',
    privacyLink: '개인정보처리방침 보기',
    signInNote: '로그인할 수 있다면 마이페이지 → 내 계정 → 계정 삭제 요청에서도 이 화면으로 들어올 수 있습니다.',
  },
  ja: {
    eyebrow: 'プライバシー管理',
    title: 'CocoTripアカウントの削除をリクエスト',
    lede: 'この公開ページから、CocoTripアカウントと関連データの削除リクエストを開始できます。',
    howTitle: 'リクエスト方法',
    steps: [
      'CocoTripアカウントに登録したメールアドレスを使用してください。',
      '件名を「[CocoTrip] Account deletion request」として、cocotripkr@gmail.comへ送信してください。',
      '本人確認と次の手順をメールでご案内します。',
    ],
    cta: 'アカウント削除リクエストをメールで送る',
    scopeTitle: 'リクエストの対象',
    scopeBody: 'CocoTripアカウントと、そのアカウントに関連するデータが対象です。取引または紛争に関する記録は、法令上必要な場合、プライバシーポリシーに記載した期間保持されることがあります。',
    safetyTitle: 'アカウント情報を安全に保護してください',
    safetyBody: 'パスワード、ワンタイム認証コード、カード番号、PayPal情報は送信しないでください。このページはリクエストを開始するためのもので、メールリンクを開いてもデータは直ちに削除されません。',
    privacyLink: 'プライバシーポリシーを確認',
    signInNote: 'ログインできる場合は、マイページ → マイアカウント → アカウント削除リクエストからもこのページを開けます。',
  },
  zh: {
    eyebrow: '隐私管理',
    title: '申请删除CocoTrip账户',
    lede: '您可以通过此公开页面申请删除CocoTrip账户及其关联数据。',
    howTitle: '申请方法',
    steps: [
      '请使用与CocoTrip账户关联的电子邮箱。',
      '请以“[CocoTrip] Account deletion request”为主题发送邮件至cocotripkr@gmail.com。',
      '我们会通过邮件说明身份验证和后续步骤。',
    ],
    cta: '发送账户删除申请邮件',
    scopeTitle: '申请范围',
    scopeBody: '申请范围包括您的CocoTrip账户及其关联数据。如适用法律要求，交易或争议记录可能会按照隐私政策说明的期限保留。',
    safetyTitle: '请保护您的账户信息',
    safetyBody: '请勿发送密码、一次性验证码、银行卡号或PayPal信息。此页面仅用于发起申请；打开邮件链接不会立即删除任何数据。',
    privacyLink: '查看隐私政策',
    signInNote: '如果可以登录，您也可以通过“我的页面 → 我的账户 → 申请删除账户”进入此页面。',
  },
} as const;

export type AccountDeletionLanguage = keyof typeof ACCOUNT_DELETION_COPY;

export function pickAccountDeletionCopy(language: string) {
  return ACCOUNT_DELETION_COPY[language as AccountDeletionLanguage] || ACCOUNT_DELETION_COPY.en;
}
