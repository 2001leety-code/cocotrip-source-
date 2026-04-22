import { Phone, Mail, MapPin, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Translations } from '@/i18n';

interface FooterProps {
  t: Translations;
}

export function Footer({ t }: FooterProps) {
  const isMobile = useIsMobile();

  /* ═══ MOBILE FOOTER ═══ */
  if (isMobile) {
    return (
      <footer
        className="pb-20"
        style={{
          background: 'linear-gradient(180deg, #080210 0%, #0a0412 100%)',
          borderTop: '1px solid rgba(182,104,252,0.1)',
        }}
      >
        <div className="px-5 pt-6 pb-4">
          {/* Brand */}
          <div className="text-center mb-5">
            <p className="text-base font-bold text-white">코코트립</p>
            <p className="text-[11px] text-white/25 mt-0.5">프리미엄 한국 여행 — cocotripkr.com</p>
          </div>

          {/* Links */}
          <div className="flex justify-center gap-4 mb-5 text-[11px]">
            <Link to="/about" className="text-white/35 hover:text-[#B668FC] transition-colors">{t.footer.about}</Link>
            <span className="text-white/15">·</span>
            <Link to="/terms" className="text-white/35 hover:text-[#B668FC] transition-colors">{t.footer.terms}</Link>
            <span className="text-white/15">·</span>
            <Link to="/privacy" className="text-white/35 hover:text-[#B668FC] transition-colors">{t.footer.privacy}</Link>
          </div>

          {/* Info - compact */}
          <div className="m-card p-4 mb-4 space-y-2 text-[11px] text-white/30">
            <p>{t.footer.ceo}</p>
            <p className="flex items-start gap-1.5">
              <MapPin className="w-3 h-3 shrink-0 mt-0.5" />{t.footer.address}
            </p>
            <p className="flex items-center gap-1.5">
              <Mail className="w-3 h-3 shrink-0" />{t.footer.email}
            </p>
            <p>{t.footer.businessNo}</p>
            <p>{t.footer.tourNo}</p>
          </div>

          {/* Trust badges */}
          <div className="flex justify-center gap-4 mb-4">
            <div className="flex items-center gap-1.5 text-[10px] text-white/25">
              <CreditCard className="w-3 h-3" /> {t.footer.payment}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-white/25">
              <Phone className="w-3 h-3" /> 24h
            </div>
          </div>

          {/* Copyright */}
          <p className="text-center text-[10px] text-white/15">{t.footer.copyright}</p>
        </div>
      </footer>
    );
  }

  /* ═══ DESKTOP FOOTER (unchanged) ═══ */
  return (
    <footer className="bg-[#1a1a2e] text-white pb-16 md:pb-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        
        {/* Top Link Bar */}
        <div className="border-b border-white/10 pb-6 mb-8">
          <div className="flex flex-wrap justify-center md:justify-start items-center gap-x-6 gap-y-2">
            <Link to="/about" className="text-white/60 hover:text-white text-sm transition-colors">{t.footer.about}</Link>
            <span className="text-white/30">|</span>
            <Link to="/terms" className="text-white/60 hover:text-white text-sm transition-colors">{t.footer.terms}</Link>
            <span className="text-white/30">|</span>
            <Link to="/privacy" className="text-white/60 hover:text-white text-sm transition-colors">{t.footer.privacy}</Link>
            <span className="text-white/30">|</span>
            <Link to="/travel-terms" className="text-white/60 hover:text-white text-sm transition-colors">{t.footer.travelTerms}</Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          
          {/* Company Info */}
          <div className="md:col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-full bg-[#c0b283] flex items-center justify-center">
                <span className="text-[#0f3460] font-bold text-sm">COCO</span>
              </div>
              <div>
                <span className="font-bold text-lg">COCOTRIP</span>
                <span className="text-[#c0b283] text-xs block">{t.footer.tagline}</span>
              </div>
            </div>
            
            <div className="space-y-3 text-gray-400 text-sm">
              <p>{t.footer.ceo}</p>
              <p className="flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {t.footer.address}
              </p>
              <p className="flex items-center gap-2">
                <Mail className="w-4 h-4 flex-shrink-0" />
                {t.footer.email}
              </p>
              <p>{t.footer.businessNo}</p>
              <p>{t.footer.tourNo}</p>
            </div>
          </div>

          {/* Customer Service */}
          <div className="border-t border-white/10 pt-8 md:pt-0 md:border-t-0">
            <h3 className="text-lg font-bold mb-6 text-[#c0b283]">{t.footer.cs}</h3>
            <div className="space-y-4">
              <a
                href="tel:+821087140611"
                className="flex items-center gap-3 text-2xl font-bold text-white hover:text-[#c0b283] transition-colors"
              >
                <Phone className="w-6 h-6" />
                {t.footer.phone}
              </a>
              <p className="text-gray-400 text-sm">{t.footer.hours}</p>
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <CreditCard className="w-4 h-4" />
                <span>{t.footer.payment}</span>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="border-t border-white/10 pt-8 md:pt-0 md:border-t-0">
            <h3 className="text-lg font-bold mb-6 text-[#c0b283]">{t.footer.quickLinks}</h3>
            <nav className="space-y-3">
              <a href="#services" className="block text-gray-400 hover:text-white transition-colors">{t.nav.privateTour}</a>
              <a href="#services" className="block text-gray-400 hover:text-white transition-colors">{t.nav.groupTour}</a>
              <a href="#regions" className="block text-gray-400 hover:text-white transition-colors">{t.nav.packages}</a>
            </nav>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col-reverse sm:flex-row items-center justify-between gap-6 sm:gap-4">
          <p className="text-gray-500 text-center sm:text-left text-sm">{t.footer.copyright}</p>
          <div className="flex items-center gap-4">
            <a
              href="https://wa.me/821087140611"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 bg-[#25D366] rounded-full flex items-center justify-center hover:bg-[#128C7E] transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
