import { MessageCircle } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Translations } from '@/i18n';
import { MotionSection } from '@/components/MotionSection';

interface CTAProps {
  t: Translations;
}

export function CTA({ t }: CTAProps) {
  const isMobile = useIsMobile();

  return (
    <MotionSection id="cta" className="py-20 lg:py-32 relative overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#B668FC]/10 rounded-full blur-3xl" />
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <h2 className="text-3xl sm:text-4xl font-bold text-white mb-8 whitespace-pre-line leading-tight">
          {t.cta.title}
        </h2>
        
        <a
          href="https://wa.me/821087140611"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 px-8 py-4 sm:px-10 sm:py-5 bg-[#25D366] text-white rounded-full font-bold text-base sm:text-lg hover:bg-[#128C7E] transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
        >
          <MessageCircle className="w-6 h-6" />
          <span>{t.cta.button}</span>
        </a>

        {/* Show QR code only on desktop */}
        {!isMobile && (
          <div className="mt-12 inline-block">
            <div className="bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl p-6 shadow-lg">
              <p className="text-sm text-white/60 mb-4">{t.cta.scanWhatsApp}</p>
              <img
                src="/whatsapp-qr.jpg"
                alt="WhatsApp QR Code"
                className="w-32 h-32 mx-auto rounded-lg"
              />
            </div>
          </div>
        )}
      </div>
    </MotionSection>
  );
}
