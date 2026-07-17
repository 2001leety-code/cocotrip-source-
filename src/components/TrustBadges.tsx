// D5: trust signal row — appears between HeroSlider and HeroCards.
// 5 trust badges (외국인 visitor 첫 화면 신뢰 신호 시각화):
//   - Real Google reviews (links out, no fabricated rating/count)
//   - 24/7 English support
//   - KTO registered (관광 등록 사업자)
//   - PayPal secure payment
//   - Private licensed guide
// Glass dark + brand accent (D1 톤). Icon: lucide-react (project standard).
// 2026-07-17: 영어 하드코딩 → 4언어 (컴포넌트 로컬 사전 — 레포 관례).
import { Star, Globe, ShieldCheck, CreditCard, Award } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface Badge {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
}

const BADGE_STR = {
  en: [
    { label: 'Private Tours', sublabel: 'Your own guide & van' },
    { label: '24/7 English', sublabel: 'WhatsApp support' },
    { label: 'KTO Registered', sublabel: 'Registered tour operator' },
    { label: 'PayPal Secure', sublabel: 'No hidden fees' },
    { label: 'Licensed Guide', sublabel: 'Vetted professionals' },
  ],
  ko: [
    { label: '프라이빗 투어', sublabel: '전용 가이드 & 차량' },
    { label: '24시간 지원', sublabel: 'WhatsApp 상담' },
    { label: 'KTO 등록', sublabel: '관광 등록 사업자' },
    { label: 'PayPal 보안결제', sublabel: '숨은 비용 없음' },
    { label: '자격 가이드', sublabel: '검증된 전문가' },
  ],
  ja: [
    { label: 'プライベートツアー', sublabel: '専用ガイド＆車両' },
    { label: '24時間対応', sublabel: 'WhatsAppサポート' },
    { label: 'KTO登録', sublabel: '観光登録事業者' },
    { label: 'PayPal安全決済', sublabel: '隠れた費用なし' },
    { label: '資格ガイド', sublabel: '審査済みプロ' },
  ],
  zh: [
    { label: '私人定制游', sublabel: '专属导游&车辆' },
    { label: '24小时支持', sublabel: 'WhatsApp客服' },
    { label: 'KTO注册', sublabel: '注册旅游企业' },
    { label: 'PayPal安全支付', sublabel: '无隐藏费用' },
    { label: '持证导游', sublabel: '经审核的专业人员' },
  ],
};

const BADGE_ICONS: React.ReactNode[] = [
  <Star key="star" className="w-4 h-4 fill-[#FBBC05] text-[#FBBC05]" />,
  <Globe key="globe" className="w-4 h-4 text-[#B668FC]" />,
  <Award key="award" className="w-4 h-4 text-[#FF6B9D]" />,
  <CreditCard key="card" className="w-4 h-4 text-[#B668FC]" />,
  <ShieldCheck key="shield" className="w-4 h-4 text-[#FF6B9D]" />,
];

export function TrustBadges({ className }: { className?: string }) {
  const { language } = useLanguage();
  const labels = BADGE_STR[language as keyof typeof BADGE_STR] || BADGE_STR.en;
  const badges: Badge[] = labels.map((b, i) => ({ ...b, icon: BADGE_ICONS[i] }));
  return (
    <section
      className={className || "relative z-10 -mt-8 lg:-mt-12 mb-8 lg:mb-12 px-4"}
      aria-label="Trust signals"
    >
      <div className="max-w-6xl mx-auto">
        <ul className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 lg:gap-4 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl py-3 px-4 sm:py-4 sm:px-6">
          {badges.map((b, i) => (
            <li
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/[0.04] transition-colors"
            >
              <span className="shrink-0">{b.icon}</span>
              <span className="flex flex-col leading-tight">
                <span className="text-xs sm:text-sm font-semibold text-white whitespace-nowrap">
                  {b.label}
                </span>
                {b.sublabel && (
                  <span className="text-[10px] sm:text-[11px] text-white/50 whitespace-nowrap">
                    {b.sublabel}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
