// KrPresenceGate — 결제 직전 사용자 자기-식별 게이트.
//
// 배경 (2026-05-06): 한국 체류 외국인 사용자가 PayPal/Braintree 결제 시도 시
// 한국 네트워크/방화벽이 결제 게이트웨이 차단하는 사례 빈발 → 결제 실패.
// 운영자 결정: 사용자가 직접 "한국 체류 여부" 선택 → 한국 = 무통장 입금/QR,
// 해외 = 기존 Braintree. IP geolocation 보다 정확 (VPN 우회 무관) + 사용자
// 동의 명확.
//
// 사용 패턴:
//   const [route, setRoute] = useState<'foreign' | 'kr-bank' | null>(null);
//   {route === null && <KrPresenceGate onChoose={setRoute} />}
//   {route === 'foreign' && <BraintreePaymentButton ... />}
//   {route === 'kr-bank' && <KrBankTransferPanel ... />}
import { Globe, MapPin, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

export type PaymentRoute = 'foreign' | 'kr-bank';

interface Props {
  onChoose: (route: PaymentRoute) => void;
  /** 옵션: 결제 금액 (원). 표시용. */
  priceKRW?: number;
}

const LABELS: Record<string, {
  question: string;
  hint: string;
  abroad: string;
  abroadSub: string;
  inKorea: string;
  inKoreaSub: string;
  notice: string;
}> = {
  ko: {
    question: '결제 전 확인',
    hint: '현재 한국에 계신가요? 결제 방식이 달라집니다.',
    abroad: '해외에 있어요',
    abroadSub: 'PayPal · 신용카드로 결제',
    inKorea: '한국에 있어요',
    inKoreaSub: '계좌이체 · QR로 결제',
    notice: '한국 네트워크는 해외 결제(PayPal) 차단이 잦아 거주지 기준으로 안내드립니다.',
  },
  en: {
    question: 'Before payment',
    hint: 'Are you currently in Korea? Payment method differs.',
    abroad: "I'm abroad",
    abroadSub: 'Pay with PayPal / credit card',
    inKorea: "I'm in Korea",
    inKoreaSub: 'Bank transfer / QR payment',
    notice: 'Korean networks often block overseas gateways like PayPal. We route based on your location.',
  },
  ja: {
    question: 'お支払い前の確認',
    hint: '現在韓国にいらっしゃいますか?お支払い方法が変わります。',
    abroad: '海外にいます',
    abroadSub: 'PayPal・クレジットカードで決済',
    inKorea: '韓国にいます',
    inKoreaSub: '銀行振込・QRで決済',
    notice: '韓国のネットワークは海外決済(PayPal)をブロックすることが多いため、所在地でご案内します。',
  },
  zh: {
    question: '支付前确认',
    hint: '您当前在韩国吗?支付方式会不同。',
    abroad: '我在海外',
    abroadSub: '使用 PayPal / 信用卡支付',
    inKorea: '我在韩国',
    inKoreaSub: '银行转账 / QR码支付',
    notice: '韩国网络经常屏蔽 PayPal 等海外支付,因此根据所在地引导支付。',
  },
};

export function KrPresenceGate({ onChoose, priceKRW }: Props) {
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const L = LABELS[lang];

  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="text-[15px] font-bold text-white">{L.question}</p>
        <p className="text-[12px] text-white/55 mt-1">{L.hint}</p>
        {typeof priceKRW === 'number' && priceKRW > 0 && (
          <p className="text-[11px] text-white/45 mt-1">
            ₩{priceKRW.toLocaleString('ko-KR')}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onChoose('foreign')}
        className="w-full flex items-center justify-between rounded-xl px-4 py-4 transition-all hover:scale-[1.01]"
        style={{
          background: 'linear-gradient(135deg, rgba(124,92,252,0.15), rgba(234,83,126,0.10))',
          border: '1px solid rgba(124,92,252,0.30)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#7C5CFC]/20 border border-[#7C5CFC]/40 flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-[#B9A4FF]" />
          </div>
          <div className="text-left min-w-0">
            <p className="text-sm font-bold text-white">{L.abroad}</p>
            <p className="text-[11px] text-white/55 mt-0.5">{L.abroadSub}</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/55 shrink-0" />
      </button>

      <button
        type="button"
        onClick={() => onChoose('kr-bank')}
        className="w-full flex items-center justify-between rounded-xl px-4 py-4 transition-all hover:scale-[1.01]"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(34,197,94,0.06))',
          border: '1px solid rgba(16,185,129,0.30)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="text-left min-w-0">
            <p className="text-sm font-bold text-white">{L.inKorea}</p>
            <p className="text-[11px] text-white/55 mt-0.5">{L.inKoreaSub}</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/55 shrink-0" />
      </button>

      <p className="text-[10px] text-white/40 text-center leading-relaxed">
        {L.notice}
      </p>
    </div>
  );
}
