import { Users, Building2, Package, Palette, UtensilsCrossed, ArrowRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import useEmblaCarousel from 'embla-carousel-react';
import { Link } from 'react-router-dom';
import type { Translations } from '@/i18n';
import type { LucideIcon } from 'lucide-react';

interface ServiceDef {
  key: string;
  icon: LucideIcon;
  color: string;
}

interface ServicesProps {
  t: Translations;
}

const services = [
  { key: 'private', icon: Users, color: 'bg-[#0f3460]' },
  { key: 'group', icon: Building2, color: 'bg-[#c0b283]' },
  { key: 'package', icon: Package, color: 'bg-[#0f3460]' },
  { key: 'culture', icon: Palette, color: 'bg-[#c0b283]' },
  { key: 'food', icon: UtensilsCrossed, color: 'bg-[#0f3460]' },
];

export function Services({ t }: ServicesProps) {
  const isMobile = useIsMobile();
  const [emblaRef] = useEmblaCarousel({ 
    align: 'start', 
    containScroll: 'trimSnaps', 
    loop: true,
    active: isMobile // Activate carousel only on mobile
  });

  const ServiceCard = ({ service, isMobileCard = false }: { service: ServiceDef, isMobileCard?: boolean }) => {
    const Icon = service.icon;
    const serviceData = (t.services as unknown as Record<string, { title: string; desc: string }>)[service.key];
    const cardClass = isMobileCard ? 'flex-shrink-0 w-4/5 mr-4' : 'md:col-span-2 lg:col-span-1';

    return (
      <Link to="/tours" className={`group relative bg-white rounded-2xl p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 overflow-hidden ${cardClass}`}>
        {/* Hover Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f3460] to-[#0f3460]/90 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        {/* Content */}
        <div className="relative z-10">
          <div className={`w-14 h-14 ${service.color} rounded-xl flex items-center justify-center mb-6 group-hover:bg-white/20 transition-colors duration-300`}>
            <Icon className="w-7 h-7 text-white" />
          </div>
          <h3 className="text-xl font-bold text-[#1a1a2e] mb-3 group-hover:text-white transition-colors duration-300">
            {serviceData.title}
          </h3>
          <p className="text-gray-600 text-sm leading-relaxed h-20 group-hover:text-white/80 transition-colors duration-300">
            {serviceData.desc}
          </p>
          <div className="mt-6 flex items-center gap-2 text-[#c0b283] group-hover:text-white font-medium text-sm">
            <span>{t.nav.bookNow}</span>
            <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform duration-300" />
          </div>
        </div>
      </Link>
    );
  };

  return (
    <section id="services" className="py-20 lg:py-32 bg-[#faf9f6]">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16 px-4">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1a1a2e] mb-4">
            {t.services.title}
          </h2>
          <div className="w-20 h-1 bg-[#c0b283] mx-auto rounded-full" />
        </div>

        {isMobile ? (
          <div className="overflow-hidden" ref={emblaRef}>
            <div className="flex pl-4"> 
              {services.map((service) => (
                <ServiceCard key={service.key} service={service} isMobileCard />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 px-4 sm:px-6 lg:px-8">
            {services.map((service) => (
               <ServiceCard key={service.key} service={service} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
