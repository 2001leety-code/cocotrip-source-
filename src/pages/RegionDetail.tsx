import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Phone, MessageCircle, Sparkles } from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';

const regionImages: Record<string, string[]> = {
  ganghwa: [
    '/강화도/강화도 (1).jpg', '/강화도/강화도 (1).jpeg', '/강화도/강화도 (2).jpg',
    '/강화도/강화도 (2).jpeg', '/강화도/강화도 (3).jpg', '/강화도/강화도 (3).jpeg',
    '/강화도/강화도 (4).jpg', '/강화도/강화도 (4).jpeg', '/강화도/강화도 (5).jpg',
    '/강화도/강화도 (5).jpeg', '/강화도/강화도 (6).jpg', '/강화도/강화도 (6).jpeg',
    '/강화도/강화도 (7).jpg', '/강화도/강화도 (7).jpeg', '/강화도/강화도 (8).jpg',
    '/강화도/강화도 (9).jpg', '/강화도/강화도 (10).jpg', '/강화도/강화도 (11).jpg',
    '/강화도/강화도 (12).jpg',
  ],
  seoul: [
    '/서울/서울 (1).jpg', '/서울/서울 (2).jpg', '/서울/서울 (3).jpg',
    '/서울/서울 (4).jpg', '/서울/서울 (5).jpg', '/서울/서울 (6).jpg',
    '/서울/서울 (7).jpg', '/서울/서울 (8).jpg', '/서울/서울 (9).jpg',
    '/서울/서울 (10).jpg', '/서울/서울 (11).jpg', '/서울/서울 (12).jpg',
    '/서울/서울 (13).jpg', '/서울/서울 (14).jpg', '/서울/서울 (15).jpg',
    '/서울/서울 (16).jpg', '/서울/서울 (17).jpg', '/서울/해방촌-남산야경.jpg',
    '/서울/서울 (19).jpg', '/서울/서울 (20).jpg', '/서울/서울 (21).jpg',
  ],
  incheon: [
    '/인천/인천 (1).jpg', '/인천/인천 (1).gif', '/인천/인천 (2).jpg',
    '/인천/인천 (3).jpg', '/인천/인천 (4).jpg', '/인천/인천 (5).jpg',
    '/인천/인천 (6).jpg', '/인천/인천 (7).jpg', '/인천/인천 (8).jpg',
  ],
  jeonju: [
    '/전주/전주 (1).jpg', '/전주/전주 (2).jpg', '/전주/전주 (3).jpg',
    '/전주/전주 (4).jpg', '/전주/전주 (5).jpg', '/전주/전주 (6).jpg',
    '/전주/전주 (7).jpg', '/전주/전주 (8).jpg', '/전주/전주 (9).jpg',
    '/전주/전주 (10).jpg', '/전주/전주 (11).jpg', '/전주/전주 (12).jpg',
    '/전주/전주 (13).jpg', '/전주/전주 (14).jpg', '/전주/전주 (15).jpg',
    '/전주/전주 (16).jpg', '/전주/전주 (17).jpg', '/전주/전주 (18).jpg',
    '/전주/전주 (19).jpg', '/전주/전주 (20).jpg', '/전주/전주 (21).jpg',
    '/전주/전주 (22).jpg',
  ],
  paju: [
    '/파주_dmz/파주 (1).jpg', '/파주_dmz/파주 (2).jpg', '/파주_dmz/파주 (3).jpg',
    '/파주_dmz/파주 (4).jpg', '/파주_dmz/파주 (5).jpg', '/파주_dmz/파주 (6).jpg',
    '/파주_dmz/파주 (7).jpg', '/파주_dmz/파주 (8).jpg', '/파주_dmz/파주 (9).jpg',
  ],
  gyeongju: [
    '/경주/경주 (1).jpg', '/경주/경주 (2).jpg', '/경주/경주 (3).jpg',
    '/경주/경주 (4).jpg', '/경주/경주 (5).jpg', '/경주/경주 (6).jpg',
    '/경주/경주 (7).jpg', '/경주/경주 (8).jpg', '/경주/경주 (9).jpg',
    '/경주/경주 (10).jpg', '/경주/경주 (11).jpg', '/경주/경주 (12).jpg',
    '/경주/경주 (13).jpg',
  ],
  danyang: [
    '/단양/단양 (1).jpg', '/단양/단양 (2).jpg', '/단양/단양 (3).jpg',
    '/단양/단양 (4).jpg', '/단양/단양 (5).jpg', '/단양/단양 (6).jpg',
    '/단양/단양 (7).jpg', '/단양/단양 (8).jpg', '/단양/단양 (9).jpg',
    '/단양/단양 (10).jpg', '/단양/단양 (11).jpg',
  ],
  busan: [
    '/부산/부산 (1).jpg', '/부산/부산 (2).jpg', '/부산/부산 (3).jpg',
    '/부산/부산 (4).jpg', '/부산/부산 (5).jpg', '/부산/부산 (6).jpg',
    '/부산/부산 (7).jpg', '/부산/부산 (8).jpg', '/부산/부산 (9).jpg',
  ],
  chuncheon: [
    '/춘천/춘천 (1).jpg', '/춘천/춘천 (1).jpeg', '/춘천/춘천 (2).jpeg',
    '/춘천/춘천 (3).jpeg', '/춘천/춘천 (4).jpeg', '/춘천/춘천 (5).jpeg',
    '/춘천/춘천 (6).jpeg', '/춘천/춘천 (7).jpeg', '/춘천/춘천 (8).jpeg',
  ],
};

export function RegionDetail() {
  const { regionId } = useParams<{ regionId: string }>();
  const navigate = useNavigate();
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();

  const regionData = t.regionDetail[regionId as keyof typeof t.regionDetail] as {
    title: string;
    subtitle: string;
    description: string;
    attractions: { name: string; desc: string }[];
  } | undefined;
  const images = regionImages[regionId || ''] || [];

  usePageMeta({
    title: regionData?.title ? `${regionData.title} Tour` : 'Region Detail',
    description: regionData?.description || 'Explore Korea with CocoTrip premium tours',
    ogImage: images[0] || '/hero-seoul.webp',
  });

  if (!regionData) {
    return (
      <div className={isMobile ? 'm-page flex items-center justify-center' : 'min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210] flex items-center justify-center'}>
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-white">{t.regionDetail?.notFound || 'Region not found'}</h1>
          <button
            onClick={() => navigate('/')}
            className={isMobile ? 'm-cta px-6 py-3' : 'px-6 py-3 bg-[#B668FC] bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] text-white rounded-full'}
          >
            {t.regionDetail?.goHome || 'Go Home'}
          </button>
        </div>
      </div>
    );
  }

  /* ═══ MOBILE ═══ */
  if (isMobile) {
    return (
      <div className="m-page">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />

        {/* Hero */}
        <div className="relative h-[45vh] overflow-hidden">
          <img
            src={images[0] || '/region-seoul.jpg'}
            alt={regionData.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,4,18,0.2) 0%, rgba(10,4,18,0.85) 80%, #0a0412 100%)' }} />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <button
              onClick={() => navigate('/#regions')}
              className="flex items-center gap-1.5 text-white/50 text-xs mb-3 hover:text-white/80 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t.regionDetail.backToRegions}
            </button>
            <h1 className="text-3xl font-black m-shimmer-text leading-tight">
              {regionData.title}
            </h1>
            <p className="text-white/60 text-sm mt-1">{regionData.subtitle}</p>
          </div>
        </div>

        <div className="px-4 pt-5 pb-4 space-y-5">
          {/* Description */}
          <div className="m-card m-appear p-4">
            <p className="text-[13px] text-white/50 leading-relaxed">{regionData.description}</p>
          </div>

          {/* Attractions */}
          <div className="m-appear" style={{ animationDelay: '0.1s' }}>
            <p className="m-label">{t.regionDetail?.mustVisit || 'Must-Visit'}</p>
            <div className="space-y-2.5">
              {regionData.attractions.map((attraction: { name: string; desc: string }, index: number) => (
                <div key={index} className="m-card m-btn p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl m-icon m-float shrink-0" style={{ animationDelay: `${index * 0.3}s` }}>
                    <MapPin className="w-4 h-4 text-[#B668FC]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[14px] font-bold text-white">{attraction.name}</h3>
                    <p className="text-[12px] text-white/55 mt-0.5 leading-relaxed">{attraction.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Photo Gallery */}
          {images.length > 1 && (
            <div className="m-appear" style={{ animationDelay: '0.2s' }}>
              <p className="m-label">{t.regionDetail?.gallery || 'Gallery'}</p>
              <div className="grid grid-cols-2 gap-2">
                {images.slice(1, 9).map((image, index) => (
                  <div key={index} className="aspect-square rounded-xl overflow-hidden m-card-glow" style={{ animationDelay: `${index * 0.5}s` }}>
                    <img
                      src={image}
                      alt={`${regionData.title} ${index + 1}`}
                      loading="lazy"
                      className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="m-card m-appear p-5 text-center" style={{ animationDelay: '0.3s', background: 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.04))' }}>
            <h2 className="text-lg font-bold text-white mb-2">
              {t.regionDetail?.planTrip || 'Plan Your Trip to'} {regionData.title}
            </h2>
            <p className="text-white/55 text-xs mb-4">
              {t.regionDetail?.planTripDesc || 'Let COCOTRIP create a personalized tour experience just for you.'}
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => navigate('/planner')}
                className="m-cta m-btn w-full py-3.5 text-[14px] flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {t.regionDetail?.aiPlannerCta || 'AI Planner'}
              </button>
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="m-btn flex items-center justify-center gap-2 w-full py-3 rounded-xl text-[13px] font-semibold text-white"
                style={{ background: '#25D366' }}
              >
                <MessageCircle className="w-4 h-4" />
                {t.regionDetail?.whatsappCta || 'WhatsApp'}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══ DESKTOP (unchanged) ═══ */
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210]">
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
            <h1 className="text-4xl lg:text-7xl font-display font-normal text-white mb-2 tracking-tight">
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
          <h2 className="text-2xl lg:text-3xl font-bold text-white mb-6">
            {t.regionDetail?.aboutHeading || 'About'} {regionData.title}
          </h2>
          <p className="text-lg text-white/60 leading-relaxed max-w-3xl">
            {regionData.description}
          </p>
        </div>

        {/* Attractions */}
        <div className="mb-16">
          <h2 className="text-2xl lg:text-3xl font-bold text-white mb-8">
            {t.regionDetail?.mustVisitAttractions || 'Must-Visit Attractions'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regionData.attractions.map((attraction: { name: string; desc: string }, index: number) => (
              <div
                key={index}
                className="bg-white/[0.04] backdrop-blur-md border border-white/[0.08] hover:border-[#B668FC]/30 rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 bg-[#B668FC]/20 border border-[#B668FC]/30 rounded-xl flex items-center justify-center mb-4">
                  <MapPin className="w-6 h-6 text-[#FF6B9D]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {attraction.name}
                </h3>
                <p className="text-white/60">{attraction.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Photo Gallery */}
        {images.length > 1 && (
          <div className="mb-16">
            <h2 className="text-2xl lg:text-3xl font-bold text-white mb-8">
              {t.regionDetail?.photoGallery || 'Photo Gallery'}
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
                    loading="lazy"
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA Section */}
        <div className="bg-gradient-to-br from-[#B668FC]/20 to-[#FF6B9D]/20 border border-[#B668FC]/30 backdrop-blur-md rounded-3xl p-8 lg:p-12 text-center">
          <h2 className="text-2xl lg:text-3xl font-bold text-white mb-4">
            {t.regionDetail?.planTrip || 'Plan Your Trip to'} {regionData.title}
          </h2>
          <p className="text-white/80 mb-8 max-w-2xl mx-auto">
            {t.regionDetail?.planTripDesc || 'Let COCOTRIP create a personalized tour experience just for you.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
               onClick={() => navigate('/tours')}
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
