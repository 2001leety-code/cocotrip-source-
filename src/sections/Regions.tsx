import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, ArrowRight } from 'lucide-react';
import type { Translations } from '@/i18n';
import { MotionSection } from '@/components/MotionSection';

interface RegionsProps {
  t: Translations;
}

const regions = [
  // 첫 번째 줄
  { id: 'seoul', image: '/region-seoul.jpg' },
  { id: 'chuncheon', image: '/region-chuncheon.webp' },
  { id: 'paju', image: '/region-paju.jpg' },
  { id: 'ganghwa', image: '/region-ganghwa.webp' },
  { id: 'busan', image: '/region-busan.webp' },
  { id: 'danyang', image: '/region-danyang.webp' },
  // 두 번째 줄
  { id: 'incheon', image: '/region-incheon.jpg' },
  { id: 'gyeongju', image: '/region-gyeongju.jpg' },
  { id: 'jeonju', image: '/region-jeonju.jpg' },
];

export function Regions({ t }: RegionsProps) {
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleRegionClick = (regionId: string) => {
    navigate(`/region/${regionId}`);
  };

  return (
    <MotionSection id="regions" className="py-20 lg:py-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            {t.regions.title}
          </h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">
            {t.regions.subtitle}
          </p>
          <div className="w-20 h-1 bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] mx-auto rounded-full mt-6" />
        </div>

        {/* Regions Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
          {regions.map((region, index) => {
            const isLarge = index === 0 || index === 4;
            const isActive = activeRegion === region.id;
            
            return (
              <div
                key={region.id}
                className={`group relative overflow-hidden rounded-2xl cursor-pointer ${
                  isLarge ? 'col-span-2 row-span-2' : 'aspect-square'
                }`}
                onMouseEnter={() => setActiveRegion(region.id)}
                onMouseLeave={() => setActiveRegion(null)}
                onClick={() => handleRegionClick(region.id)}
              >
                {/* Image */}
                <div className="absolute inset-0">
                  <img
                    src={region.image}
                    alt={(t.regions as Record<string, string>)[region.id]}
                    className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700"
                  />
                </div>

                {/* Overlay */}
                <div className={`absolute inset-0 bg-gradient-to-t from-[#0a0412] via-[#B668FC]/40 to-transparent transition-opacity duration-300 ${
                  isActive ? 'opacity-90' : 'opacity-60'
                }`} />

                {/* Content */}
                <div className="absolute inset-0 flex flex-col justify-end p-4 lg:p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="w-4 h-4 text-[#FF6B9D]" />
                    <span className="text-white/80 text-xs uppercase tracking-wider">
                      Korea
                    </span>
                  </div>
                  <h3 className="text-white font-bold text-lg lg:text-2xl mb-2">
                    {(t.regions as Record<string, string>)[region.id]}
                  </h3>
                  
                  {/* Hover Content — CTA personalized with region name so 9 cards aren't all "View Tours" */}
                  <div className={`overflow-hidden transition-all duration-300 ${
                    isActive ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'
                  }`}>
                    <button className="flex items-center gap-2 text-[#FF6B9D] text-sm font-medium mt-2">
                      <span>{(t.regions as Record<string, string>)[region.id]} {t.regions.viewTours}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Corner Decoration */}
                <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-white/30 rounded-tr-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
            );
          })}
        </div>

        {/* View All Button */}
        <div className="text-center mt-12">
          <button className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] text-white rounded-full font-medium hover:from-[#FF6B9D] hover:to-[#B668FC] transition-colors duration-300">
            <span>{t.regions.viewAll}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </MotionSection>
  );
}
