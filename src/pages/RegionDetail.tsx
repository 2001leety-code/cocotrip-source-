import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Phone, MessageCircle } from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';

const regionImages: Record<string, string[]> = {
  ganghwa: [
    '/강화도/강화도 (1).jpg',
    '/강화도/강화도 (1).jpeg',
    '/강화도/강화도 (2).jpg',
    '/강화도/강화도 (2).jpeg',
    '/강화도/강화도 (3).jpg',
    '/강화도/강화도 (3).jpeg',
    '/강화도/강화도 (4).jpg',
    '/강화도/강화도 (4).jpeg',
    '/강화도/강화도 (5).jpg',
    '/강화도/강화도 (5).jpeg',
    '/강화도/강화도 (6).jpg',
    '/강화도/강화도 (6).jpeg',
    '/강화도/강화도 (7).jpg',
    '/강화도/강화도 (7).jpeg',
    '/강화도/강화도 (8).jpg',
    '/강화도/강화도 (9).jpg',
    '/강화도/강화도 (10).jpg',
    '/강화도/강화도 (11).jpg',
    '/강화도/강화도 (12).jpg',
  ],
  seoul: ['/region-seoul.jpg','/서울/서울 (1).jpg','/서울/서울 (2).jpg','/서울/서울 (3).jpg','/서울/서울 (4).jpg'],
  incheon: ['/region-incheon.jpg','/인천/인천 (1).jpg','/인천/인천 (2).jpg','/인천/인천 (3).jpg','/인천/인천 (4).jpg'],
  jeonju: ['/region-jeonju.jpg','/전주/전주 (1).jpg','/전주/전주 (2).jpg','/전주/전주 (3).jpg'],
  paju: ['/region-paju.jpg','/파주_dmz/파주 (1).jpg','/파주_dmz/파주 (2).jpg','/파주_dmz/파주 (3).jpg','/파주_dmz/파주 (4).jpg','/파주_dmz/파주 (5).jpg','/파주_dmz/파주 (6).jpg','/파주_dmz/파주 (7).jpg','/파주_dmz/파주 (8).jpg','/파주_dmz/파주 (9).jpg'],
  gyeongju: ['/region-gyeongju.jpg','/경주/경주 (1).jpg','/경주/경주 (2).jpg','/경주/경주 (3).jpg','/경주/경주 (4).jpg','/경주/경주 (5).jpg','/경주/경주 (6).jpg','/경주/경주 (7).jpg','/경주/경주 (8).jpg','/경주/경주 (9).jpg','/경주/경주 (10).jpg','/경주/경주 (11).jpg','/경주/경주 (12).jpg'],
  danyang: ['/region-danyang.jpg','/단양/단양 (1).jpg','/단양/단양 (2).jpg','/단양/단양 (3).jpg','/단양/단양 (4).jpg','/단양/단양 (5).jpg','/단양/단양 (6).jpg','/단양/단양 (7).jpg','/단양/단양 (8).jpg','/단양/단양 (9).jpg','/단양/단양 (10).jpg'],
  busan: ['/region-busan.jpg','/부산/부산 (1).jpg','/부산/부산 (2).jpg','/부산/부산 (3).jpg','/부산/부산 (4).jpg','/부산/부산 (5).jpg','/부산/부산 (6).jpg','/부산/부산 (7).jpg','/부산/부산 (8).jpg'],
  chuncheon: ['/region-chuncheon.jpg','/춘천/춘천 (1).jpg','/춘천/춘천 (1).jpeg','/춘천/춘천 (2).jpeg','/춘천/춘천 (3).jpeg','/춘천/춘천 (4).jpeg','/춘천/춘천 (5).jpeg','/춘천/춘천 (6).jpeg','/춘천/춘천 (7).jpeg','/춘천/춘천 (8).jpeg'],
};

export function RegionDetail() {
  const { regionId } = useParams<{ regionId: string }>();
  const navigate = useNavigate();
  const { language, t, changeLanguage } = useLanguage();

  const regionData = t.regionDetail[regionId as keyof typeof t.regionDetail] as {
    title: string;
    subtitle: string;
    description: string;
    attractions: { name: string; desc: string }[];
  } | undefined;
  const images = regionImages[regionId || ''] || [];

  if (!regionData) {
    return (
      <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#1a1a2e] mb-4">Region not found</h1>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-[#0f3460] text-white rounded-full"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      
      {/* Hero Section */}
      <div className="relative h-[50vh] lg:h-[60vh] overflow-hidden">
        <img
          src={images[0] || '/region-seoul.jpg'}
          alt={regionData.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-12">
          <div className="max-w-7xl mx-auto">
            <button
              onClick={() => navigate('/#regions')}
              className="flex items-center gap-2 text-white/80 hover:text-white mb-4 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              {t.regionDetail.backToRegions}
            </button>
            <h1 className="text-4xl lg:text-6xl font-bold text-white mb-2">
              {regionData.title}
            </h1>
            <p className="text-xl text-white/90">{regionData.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
        {/* Description */}
        <div className="mb-16">
          <h2 className="text-2xl lg:text-3xl font-bold text-[#1a1a2e] mb-6">
            About {regionData.title}
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl">
            {regionData.description}
          </p>
        </div>

        {/* Attractions */}
        <div className="mb-16">
          <h2 className="text-2xl lg:text-3xl font-bold text-[#1a1a2e] mb-8">
            Must-Visit Attractions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regionData.attractions.map((attraction: { name: string; desc: string }, index: number) => (
              <div
                key={index}
                className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-lg transition-shadow"
              >
                <div className="w-12 h-12 bg-[#c0b283]/20 rounded-xl flex items-center justify-center mb-4">
                  <MapPin className="w-6 h-6 text-[#c0b283]" />
                </div>
                <h3 className="text-xl font-bold text-[#1a1a2e] mb-2">
                  {attraction.name}
                </h3>
                <p className="text-gray-600">{attraction.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Photo Gallery */}
        {images.length > 1 && (
          <div className="mb-16">
            <h2 className="text-2xl lg:text-3xl font-bold text-[#1a1a2e] mb-8">
              Photo Gallery
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {images.slice(1).map((image, index) => (
                <div
                  key={index}
                  className="aspect-square rounded-2xl overflow-hidden"
                >
                  <img
                    src={image}
                    alt={`${regionData.title} gallery ${index + 1}`}
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA Section */}
        <div className="bg-[#0f3460] rounded-3xl p-8 lg:p-12 text-center">
          <h2 className="text-2xl lg:text-3xl font-bold text-white mb-4">
            Plan Your Trip to {regionData.title}
          </h2>
          <p className="text-white/80 mb-8 max-w-2xl mx-auto">
            Let COCOTRIP create a personalized tour experience just for you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
               onClick={() => navigate('/booking')}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#25D366] text-white rounded-full font-bold hover:bg-[#128C7E] transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              {t.regionDetail.bookNow}
            </button>
            <a
              href="tel:+821087140611"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 text-white rounded-full font-bold hover:bg-white/20 transition-colors"
            >
              <Phone className="w-5 h-5" />
              +82 10-8714-0611
            </a>
          </div>
        </div>
      </div>

      <Footer t={t} />
    </div>
  );
}
