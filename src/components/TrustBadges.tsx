// D5: trust signal row — appears between HeroSlider and HeroCards.
// 5 trust badges (외국인 visitor 첫 화면 신뢰 신호 시각화):
//   - 5.0 Google rating (150+ reviews)
//   - 24/7 English support
//   - KTO registered (관광 등록 사업자)
//   - PayPal secure payment
//   - 1,000+ tours completed
// Glass dark + brand accent (D1 톤). Icon: lucide-react (project standard).
import { Star, Globe, ShieldCheck, CreditCard, Award } from 'lucide-react';

interface Badge {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
}

const BADGES: Badge[] = [
  {
    icon: <Star className="w-4 h-4 fill-[#FBBC05] text-[#FBBC05]" />,
    label: '5.0 Google',
    sublabel: '150+ reviews',
  },
  {
    icon: <Globe className="w-4 h-4 text-[#B668FC]" />,
    label: '24/7 English',
    sublabel: 'WhatsApp support',
  },
  {
    icon: <Award className="w-4 h-4 text-[#FF6B9D]" />,
    label: 'KTO Registered',
    sublabel: '관광 등록 사업자',
  },
  {
    icon: <CreditCard className="w-4 h-4 text-[#B668FC]" />,
    label: 'PayPal Secure',
    sublabel: 'No hidden fees',
  },
  {
    icon: <ShieldCheck className="w-4 h-4 text-[#FF6B9D]" />,
    label: '1,000+ Tours',
    sublabel: 'Verified guests',
  },
];

export function TrustBadges() {
  return (
    <section
      className="relative z-10 -mt-8 lg:-mt-12 mb-8 lg:mb-12 px-4"
      aria-label="Trust signals"
    >
      <div className="max-w-6xl mx-auto">
        <ul className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 lg:gap-4 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl py-3 px-4 sm:py-4 sm:px-6">
          {BADGES.map((b, i) => (
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
