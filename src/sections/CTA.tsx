import { MessageCircle } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Translations } from '@/i18n';

interface CTAProps {
  t: Translations;
}

export function CTA({ t }: CTAProps) {
  const isMobile = useIsMobile();

  return (
    <section id="cta" className="py-20 lg:py-32 bg-[#faf9f6] relative overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#c0b283]/5 rounded-full blur-3xl" />
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e] mb-8 whitespace-pre-line leading-tight">
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
            <div className="bg-white rounded-2xl p-6 shadow-lg">
              <p className="text-sm text-gray-500 mb-4">Scan to chat on WhatsApp</p>
              <img
                src="/whatsapp-qr.jpg"
                alt="WhatsApp QR Code"
                className="w-32 h-32 mx-auto rounded-lg"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
