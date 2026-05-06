// PaymentGuidanceModal — 결제 전 한국 거주 외국인 사용자용 사전 안내.
//
// 배경 (2026-05-06): 한국 ISP 의 SNI 필터링 → paypalobjects.com 일부 차단 가능.
// PayPal Risk Engine 이 외국 계정 + 한국 IP 조합을 fraud score 상승으로 분류 가능.
// 사용자에게 결제 시 권장 네트워크 (본국 로밍 / 호텔 wifi) + VPN OFF + 막힐 시
// fallback (paypal.me QR) 진입 경로를 사전 안내.
//
// 사용 패턴:
//   const [showGuide, setShowGuide] = useState(false);
//   <button onClick={() => setShowGuide(true)}>결제 전 안내 보기</button>
//   {showGuide && (
//     <PaymentGuidanceModal
//       onClose={() => setShowGuide(false)}
//       onUseFallback={() => { setShowGuide(false); setShowFallback(true); }}
//     />
//   )}
import { X, Wifi, Globe2, ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  onClose: () => void;
  /** 레거시 — 5/6 변경: paypal.me QR 이 메인 흐름이라 별도 fallback 진입점 불필요. 호출
   *  처가 미설정 시 onClose alias 처럼 동작. */
  onUseFallback?: () => void;
}

interface ModalLabels {
  title: string;
  intro: string;
  networkTitle: string;
  networkRecommend: string;
  networkAvoid: string;
  vpnTitle: string;
  vpnNote: string;
  authTitle: string;
  authNote: string;
  failTitle: string;
  failNote: string;
  proceed: string;
  fallbackCta: string;
}

const LABELS: Record<string, ModalLabels> = {
  ko: {
    title: '결제 전 꼭 읽어주세요',
    intro: '한국 체류 중이시거나 한국 네트워크에서 결제하시는 경우, 다음 안내를 참고하시면 결제 성공률이 올라갑니다.',
    networkTitle: '권장 네트워크',
    networkRecommend: '✅ 본국 로밍 데이터, 호텔 wifi (안정적)',
    networkAvoid: '⚠️ 공항·카페 공공 wifi 비추 (결제 차단 빈도 높음)',
    vpnTitle: 'VPN 끄기',
    vpnNote: 'PayPal 이 VPN/프록시 감지 시 결제 즉시 거절됩니다. 결제 시 반드시 OFF.',
    authTitle: '본인 인증 안내',
    authNote: '갑작스러운 위치 변경 시 PayPal 이 SMS / 앱 본인 인증을 요구할 수 있습니다. 안내에 따라 인증해 주세요.',
    failTitle: '결제 안 될 때',
    failNote: '"결제 버튼이 안 보임" 또는 "결제 거절됨" 상황이면 아래 대체 결제 (PayPal QR) 사용하세요. 페이팔 메인 도메인을 직접 사용해 차단 회피 가능.',
    proceed: '확인했습니다, 결제 진행',
    fallbackCta: '결제 안 됨 → 대체 결제 (QR)',
  },
  en: {
    title: 'Read before payment',
    intro: "If you're in Korea or paying from a Korean network, the following tips improve success rate.",
    networkTitle: 'Recommended network',
    networkRecommend: '✅ Home-country roaming data, hotel wifi (stable)',
    networkAvoid: '⚠️ Avoid airport/cafe public wifi (higher block rate)',
    vpnTitle: 'Turn OFF VPN',
    vpnNote: 'PayPal blocks instantly when VPN/proxy is detected. Disable VPN before paying.',
    authTitle: 'Identity verification',
    authNote: 'PayPal may request SMS / app verification when location changes suddenly. Please complete it as prompted.',
    failTitle: 'If payment fails',
    failNote: 'If the payment button is missing or rejected, use the alternative QR payment below. It uses PayPal\'s main domain and bypasses common network blocks.',
    proceed: 'Got it, proceed to payment',
    fallbackCta: 'Payment not working → use QR',
  },
  ja: {
    title: 'お支払い前にご確認ください',
    intro: '韓国に滞在中、または韓国のネットワークから決済される場合、以下のご案内で成功率が上がります。',
    networkTitle: '推奨ネットワーク',
    networkRecommend: '✅ 本国のローミングデータ、ホテルWi-Fi(安定)',
    networkAvoid: '⚠️ 空港・カフェ公衆Wi-Fiは非推奨(ブロック率高)',
    vpnTitle: 'VPNをオフに',
    vpnNote: 'PayPalはVPN/プロキシを検知すると即座に決済を拒否します。決済時は必ずOFFにしてください。',
    authTitle: '本人認証のご案内',
    authNote: '位置の急変時にPayPalがSMS・アプリ認証を要求する場合があります。案内に従ってご認証ください。',
    failTitle: '決済できない場合',
    failNote: '「決済ボタンが表示されない」「決済拒否」の場合、下記の代替決済(QR)をご利用ください。PayPalのメインドメインを使用し、ネットワーク制限を回避できます。',
    proceed: '確認しました、決済へ',
    fallbackCta: '決済できない → QR決済へ',
  },
  zh: {
    title: '支付前请阅读',
    intro: '如您在韩国停留或从韩国网络支付,以下提示可提高支付成功率。',
    networkTitle: '推荐网络',
    networkRecommend: '✅ 母国漫游数据、酒店Wi-Fi(稳定)',
    networkAvoid: '⚠️ 不推荐机场/咖啡馆公共Wi-Fi(屏蔽率高)',
    vpnTitle: '关闭VPN',
    vpnNote: 'PayPal检测到VPN/代理时会立即拒绝支付。支付前请务必关闭。',
    authTitle: '身份验证提示',
    authNote: '位置突变时PayPal可能要求SMS/应用验证。请按提示完成验证。',
    failTitle: '支付失败时',
    failNote: '若"支付按钮不显示"或"支付被拒",请使用下方备用支付(QR)。其使用PayPal主域名,可绕过网络限制。',
    proceed: '已了解,前往支付',
    fallbackCta: '支付失败 → 使用QR',
  },
};

export function PaymentGuidanceModal({ onClose }: Props) {
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const L = LABELS[lang];

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-guide-title"
    >
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10"
        style={{
          background: 'linear-gradient(135deg, rgba(15,17,26,0.98), rgba(26,15,24,0.98))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4 text-white/70" />
        </button>

        <div className="p-5 sm:p-6">
          {/* Title */}
          <div className="mb-4 pr-8">
            <h2 id="payment-guide-title" className="text-lg sm:text-xl font-bold text-white mb-1.5">
              {L.title}
            </h2>
            <p className="text-[12.5px] text-white/65 leading-relaxed">{L.intro}</p>
          </div>

          {/* Sections */}
          <div className="space-y-3.5">
            <Section icon={<Wifi className="w-4 h-4 text-emerald-300" />} title={L.networkTitle} accent="emerald">
              <p className="text-[12px] text-white/75 leading-relaxed">{L.networkRecommend}</p>
              <p className="text-[12px] text-amber-300/80 mt-1 leading-relaxed">{L.networkAvoid}</p>
            </Section>

            <Section icon={<Globe2 className="w-4 h-4 text-rose-300" />} title={L.vpnTitle} accent="rose">
              <p className="text-[12px] text-white/75 leading-relaxed">{L.vpnNote}</p>
            </Section>

            <Section icon={<ShieldCheck className="w-4 h-4 text-violet-300" />} title={L.authTitle} accent="violet">
              <p className="text-[12px] text-white/75 leading-relaxed">{L.authNote}</p>
            </Section>

            <Section icon={<AlertTriangle className="w-4 h-4 text-amber-300" />} title={L.failTitle} accent="amber">
              <p className="text-[12px] text-white/75 leading-relaxed">{L.failNote}</p>
            </Section>
          </div>

          {/* CTA — 단일 버튼. 5/6 변경: paypal.me QR 이 메인 흐름 (PayPalBookingButton
              wrapper) 이라 별도 fallback CTA 불필요. */}
          <div className="mt-5">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #7C5CFC, #B668FC)',
                boxShadow: '0 4px 20px rgba(124,92,252,0.3)',
              }}
            >
              {L.proceed}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  accent: 'emerald' | 'rose' | 'violet' | 'amber';
  children: React.ReactNode;
}

const ACCENT_BG: Record<SectionProps['accent'], string> = {
  emerald: 'rgba(16,185,129,0.06)',
  rose: 'rgba(244,63,94,0.06)',
  violet: 'rgba(124,92,252,0.06)',
  amber: 'rgba(245,158,11,0.06)',
};
const ACCENT_BORDER: Record<SectionProps['accent'], string> = {
  emerald: 'rgba(16,185,129,0.20)',
  rose: 'rgba(244,63,94,0.20)',
  violet: 'rgba(124,92,252,0.20)',
  amber: 'rgba(245,158,11,0.20)',
};
const ACCENT_ICON_BG: Record<SectionProps['accent'], string> = {
  emerald: 'bg-emerald-500/15 border-emerald-500/30',
  rose: 'bg-rose-500/15 border-rose-500/30',
  violet: 'bg-[#7C5CFC]/15 border-[#7C5CFC]/30',
  amber: 'bg-amber-500/15 border-amber-500/30',
};

function Section({ icon, title, accent, children }: SectionProps) {
  return (
    <div
      className="rounded-xl p-3.5 border"
      style={{ background: ACCENT_BG[accent], borderColor: ACCENT_BORDER[accent] }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-7 h-7 rounded-lg ${ACCENT_ICON_BG[accent]} border flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <p className="text-sm font-bold text-white">{title}</p>
      </div>
      <div className="pl-9">{children}</div>
    </div>
  );
}
