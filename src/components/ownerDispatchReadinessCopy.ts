import type { Language } from '@/i18n';

const ko = {
  title: '예약·문의 자동 알림',
  checking: '서버 설정 확인 중',
  labels: { off: '꺼짐', configuration_required: '설정 필요', configured: '서버 설정됨', unknown: '확인 불가' },
  descriptions: {
    off: '자동 발송이 꺼져 있습니다. 이 기기 등록과는 별개입니다.',
    configuration_required: '운영 환경 또는 필수 설정이 맞지 않아 자동 발송을 시작할 수 없습니다.',
    configured: '서버 설정 검사만 통과했습니다. 계정·기기 유효성이나 발송 성공을 뜻하지 않습니다.',
    unknown: '서버 설정 상태를 확인하지 못했습니다. 화면을 새로 조회해 주세요.',
  },
  delivery: '실제 휴대폰 수신: 미확인',
  unavailable: '수신 메일·WhatsApp·API/호스팅 비용 알림: 미연결',
  details: '설정 범위와 다음 단계',
  setup: '예약·문의 발송 코드는 준비되어 있습니다. 켜려면 운영자가 Vercel의 운영 환경에서 수신 기기·언어·보관 기간 등 필수 설정과 활성화를 완료해야 합니다. 이 화면은 설정을 변경하거나 알림을 보내지 않습니다.',
};

type Copy = typeof ko;
export const ownerDispatchReadinessCopy: Record<Language, Copy> = {
  ko,
  en: {
    title: 'Booking and inquiry alerts', checking: 'Checking server configuration',
    labels: { off: 'Off', configuration_required: 'Configuration needed', configured: 'Server configured', unknown: 'Unknown' },
    descriptions: {
      off: 'Automatic delivery is off. Registering this device is a separate step.',
      configuration_required: 'The environment or required settings are not valid for automatic delivery.',
      configured: 'Only the server configuration check passed. This does not verify the account, device or delivery.',
      unknown: 'The server configuration could not be checked. Refresh the dashboard to try again.',
    },
    delivery: 'Actual phone receipt: unverified',
    unavailable: 'Incoming email, WhatsApp and API/hosting cost alerts: not connected',
    details: 'Configuration scope and next steps',
    setup: 'Booking and inquiry delivery code is implemented. To enable it, the owner must complete the target device, language, retention and other required settings and activation in Vercel production. This screen does not change settings or send alerts.',
  },
  ja: {
    title: '予約・問い合わせの自動通知', checking: 'サーバー設定を確認中',
    labels: { off: 'オフ', configuration_required: '設定が必要', configured: 'サーバー設定済み', unknown: '確認できません' },
    descriptions: {
      off: '自動送信はオフです。この端末の登録とは別の設定です。',
      configuration_required: '運用環境または必須設定が適切でないため、自動送信を開始できません。',
      configured: 'サーバー設定の検査のみ通過しました。アカウント・端末の有効性や送信成功を示すものではありません。',
      unknown: 'サーバー設定を確認できませんでした。画面の情報を再取得してください。',
    },
    delivery: '実際のスマートフォン受信：未確認',
    unavailable: '受信メール・WhatsApp・API/ホスティング費用の通知：未接続',
    details: '設定範囲と次の手順',
    setup: '予約・問い合わせの送信コードは実装済みです。有効にするには、運営者が Vercel の本番環境で対象端末・言語・保存期間などの必須設定と有効化を完了する必要があります。この画面は設定変更や通知送信を行いません。',
  },
  zh: {
    title: '预约与咨询自动通知', checking: '正在检查服务器配置',
    labels: { off: '已关闭', configuration_required: '需要配置', configured: '服务器已配置', unknown: '无法确认' },
    descriptions: {
      off: '自动发送已关闭，与登记此设备是不同的步骤。',
      configuration_required: '运行环境或必需配置不符合要求，暂时无法开始自动发送。',
      configured: '仅通过服务器配置检查，不代表账号、设备有效或发送成功。',
      unknown: '无法检查服务器配置，请刷新控制台重试。',
    },
    delivery: '手机实际接收：尚未验证',
    unavailable: '收件邮件、WhatsApp、API/托管费用通知：尚未连接',
    details: '配置范围与后续步骤',
    setup: '预约与咨询发送代码已实现。启用前，运营者须在 Vercel 的生产环境中完成接收设备、语言、保留天数等必需配置并启用。此页面不会更改设置或发送通知。',
  },
};
