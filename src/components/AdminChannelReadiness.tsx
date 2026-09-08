import type { Language } from '@/i18n';

type ChannelKey = 'webform' | 'webchat' | 'email' | 'whatsapp' | 'instagram' | 'tiktok';
interface ReadinessGate { ready: boolean; reason: string; delivery: 'not-verified' }
export interface ChannelResponseReadiness {
  autoAck: ReadinessGate;
  channels: {
    channel: ChannelKey;
    implementation: string;
    supported: boolean;
    intake: { status: 'implemented' | 'configured' | 'not_ready' | 'not_implemented'; detail: string };
    autoAck: ReadinessGate;
    ownerPush: ReadinessGate & { inbox?: ReadinessGate };
  }[];
}

const copy = {
  ko: {
    title: '채널별 응대 상태', expand: '연결·응대 범위 보기',
    note: '설정 준비와 실제 수신·발송 성공은 다릅니다. 이 표는 설정만 확인합니다.',
    unknown: '현재 설정을 확인하지 못했습니다. 자동응대 중으로 판단하지 마세요.',
    names: { webform: '홈페이지 문의폼', webchat: '홈페이지 채팅', email: '회사 메일', whatsapp: 'WhatsApp', instagram: 'Instagram DM', tiktok: 'TikTok 메시지' },
    intake: { implemented: '수신 기능 있음', configured: '수신 설정 준비', not_ready: '수신 설정 필요', not_implemented: '미구현' },
    responses: { webform: '접수확인만 자동 · 최종 답변은 승인 후', webchat: 'AI 답변 · 예외 문의는 담당자 전달', email: '읽기 전용 · 자동답장 없음', whatsapp: '동의한 업무 세션만 수신 · 자동답장 없음', instagram: '게시물 연결과 DM 연결은 별개', tiktok: '게시물 연결과 메시지 연결은 별개' },
    ack: '접수확인', push: '휴대폰 알림', ready: '설정 준비', off: '꺼짐 / 설정 필요', unavailable: '미지원', unverified: '실제 전달 미검증',
  },
  en: {
    title: 'Channel response status', expand: 'View connections and response scope',
    note: 'Configuration readiness does not prove messages were received or delivered. This checks configuration only.',
    unknown: 'Current configuration could not be verified. Do not assume automatic responses are active.',
    names: { webform: 'Website inquiry form', webchat: 'Website chat', email: 'Company email', whatsapp: 'WhatsApp', instagram: 'Instagram DM', tiktok: 'TikTok messages' },
    intake: { implemented: 'Intake implemented', configured: 'Intake configured', not_ready: 'Setup required', not_implemented: 'Not implemented' },
    responses: { webform: 'Automatic acknowledgment only · final reply requires approval', webchat: 'AI replies · exceptions referred to the operator', email: 'Read-only · no automatic replies', whatsapp: 'Consented business sessions only · no automatic replies', instagram: 'Publishing access does not connect DMs', tiktok: 'Publishing access does not connect messages' },
    ack: 'Acknowledgment', push: 'Phone alerts', ready: 'Configured', off: 'Off / setup required', unavailable: 'Not supported', unverified: 'Delivery not verified',
  },
  ja: {
    title: 'チャネル別の応答状況', expand: '接続と対応範囲を見る',
    note: '設定の準備完了は、実際の受信・送信成功を意味しません。ここでは設定のみ確認します。',
    unknown: '現在の設定を確認できません。自動応答中とは判断しないでください。',
    names: { webform: 'サイトのお問い合わせ', webchat: 'サイトのチャット', email: '会社メール', whatsapp: 'WhatsApp', instagram: 'Instagram DM', tiktok: 'TikTokメッセージ' },
    intake: { implemented: '受信機能あり', configured: '受信設定済み', not_ready: '受信設定が必要', not_implemented: '未実装' },
    responses: { webform: '受付確認のみ自動 · 最終回答は承認後', webchat: 'AI回答 · 例外は担当者へ引き継ぎ', email: '閲覧専用 · 自動返信なし', whatsapp: '同意した業務セッションのみ · 自動返信なし', instagram: '投稿連携とDM連携は別です', tiktok: '投稿連携とメッセージ連携は別です' },
    ack: '受付確認', push: 'スマホ通知', ready: '設定済み', off: '停止中 / 設定が必要', unavailable: '未対応', unverified: '実際の送信は未検証',
  },
  zh: {
    title: '各渠道回复状态', expand: '查看连接及回复范围',
    note: '配置就绪不代表已成功接收或发送消息。此处仅检查配置。',
    unknown: '无法确认当前配置，请勿认定自动回复已启用。',
    names: { webform: '网站咨询表单', webchat: '网站聊天', email: '公司邮件', whatsapp: 'WhatsApp', instagram: 'Instagram私信', tiktok: 'TikTok消息' },
    intake: { implemented: '已实现接收功能', configured: '接收配置就绪', not_ready: '需要配置接收', not_implemented: '尚未实现' },
    responses: { webform: '仅自动确认收件 · 最终回复须审批', webchat: 'AI回复 · 特殊问题转交负责人', email: '只读 · 无自动回复', whatsapp: '仅接收已同意的业务会话 · 无自动回复', instagram: '发布连接不等于私信连接', tiktok: '发布连接不等于消息连接' },
    ack: '收件确认', push: '手机通知', ready: '配置就绪', off: '已关闭 / 需要配置', unavailable: '不支持', unverified: '实际送达尚未验证',
  },
} satisfies Record<Language, unknown>;

export function AdminChannelReadiness({ data, language }: { data?: ChannelResponseReadiness | null; language: Language }) {
  const text = copy[language];
  return (
    <details className="rounded-2xl border border-white/10 bg-[#181b22] p-3.5" data-testid="channel-readiness">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg text-sm font-bold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
        <span>{text.title}</span><span className="text-xs font-normal text-violet-200">{text.expand}</span>
      </summary>
      <p className="mt-2 text-xs leading-5 text-amber-100">{data ? text.note : text.unknown}</p>
      {data && <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.channels.map((item) => {
          const pushReady = item.ownerPush.ready && (!item.ownerPush.inbox || item.ownerPush.inbox.ready);
          return (
            <section key={item.channel} aria-label={text.names[item.channel]} className="min-w-0 rounded-xl border border-white/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-100">{text.names[item.channel]}</h3>
                <span className="text-xs text-violet-200">{text.intake[item.intake.status]}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-200">{text.responses[item.channel]}</p>
              <dl className="mt-2 space-y-1 text-xs text-slate-300">
                {item.channel === 'webform' && <div className="flex flex-wrap justify-between gap-2"><dt>{text.ack}</dt><dd>{item.autoAck.ready ? text.ready : text.off}</dd></div>}
                <div className="flex flex-wrap justify-between gap-2"><dt>{text.push}</dt><dd>{!item.supported ? text.unavailable : pushReady ? text.ready : text.off}</dd></div>
              </dl>
            </section>
          );
        })}
      </div>}
      {data && <p className="mt-3 text-xs text-slate-300">{text.unverified}</p>}
    </details>
  );
}
