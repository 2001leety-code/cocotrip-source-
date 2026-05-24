import { Percent, Car, Hotel, Gift, ArrowRight } from 'lucide-react';
import type { Translations } from '@/i18n';
import { MotionSection } from '@/components/MotionSection';

interface MembershipBenefit {
  icon: string;
  title: string;
  desc: string;
}

interface MembershipProps {
  t: Translations;
}

const iconMap: Record<string, React.ElementType> = {
  percent: Percent,
  car: Car,
  hotel: Hotel,
  gift: Gift,
};

export function Membership({ t }: MembershipProps) {
  return (
    <MotionSection className="py-20 lg:py-32 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-96 h-96 bg-[#B668FC] rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#FF6B9D] rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left Content */}
          <div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 whitespace-pre-line leading-tight">
              {t.membership.title}
            </h2>
            <p className="text-white/70 text-lg mb-8">
              {t.membership.subtitle}
            </p>
            {/* 멤버십 가입 흐름 미구축 — 우선 차터 페이지로 안내 (CTA 데드링크 방지) */}
            <a
              href="/charter"
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] text-white rounded-full font-bold hover:from-[#FF6B9D] hover:to-[#B668FC] transition-colors duration-300"
            >
              <span>{t.membership.cta}</span>
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>

          {/* Right Content - Benefits Grid */}
          <div className="grid grid-cols-2 gap-4">
            {t.membership.benefits.map((benefit: MembershipBenefit, index: number) => {
              const Icon = iconMap[benefit.icon];
              
              return (
                <div
                  key={index}
                  className="group bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:bg-white/20 transition-all duration-300"
                >
                  <div className="w-12 h-12 bg-[#B668FC]/20 border border-[#B668FC]/30 rounded-xl flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-[#B668FC]" />
                  </div>
                  <h3 className="text-white font-bold text-lg mb-1">
                    {benefit.title}
                  </h3>
                  <p className="text-white/60 text-sm">
                    {benefit.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
