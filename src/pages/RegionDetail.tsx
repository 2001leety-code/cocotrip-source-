import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Phone, MessageCircle } from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';

const regionImages: Record<string, string[]> = {
  seoul: [
    '/region-seoul.jpg',
    '/JnR5Ie_경복궁(1).jpg',
    '/n7SQla_창덕궁(1).jpg',
    '/Type1_경복궁 근정전_한국관광공사 김지호_4hPP1a(1).jpg',
    '/Type1_경복궁_IR 스튜디오_Q0FNNa(1).jpg',
    '/Type1_근정전_임귀빈_nfS9ea(1).jpg',
    '/3Xgcka_북촌한옥마을(1).jpg',
    '/dJ6Ara_북촌한옥마을(1).jpg',
    '/Type1_북촌한옥마을_라이브스튜디오_dJ6Ara.jpg',
    '/1uA0qa_반포대교(1).jpg',
    '/Type1_반포대교_한국관광공사 이범수_1uA0qa(1).jpg',
    '/J7FqPa_서울 밤도깨비 야시장(1).jpg',
    '/Type1_서울약령시 (구 경동약령시장)_한국관광공사 브이앤드_a2LDxa.jpg',
    '/Type1_김치 만들기_한국관광공사 김지호_Kg5oKa(1).jpg',
  ],
  busan: [
    '/region-busan.jpg',
    '/Type1_더베이101_한국관광공사 김지호_VZJFRa(2).jpg',
    '/Type1_광안대교, 도시를 품다_최영근_XA2xTa(1).jpg',
    '/Type1_부산 광안대교_한국관광공사 이범수_BTr8Za(1).jpg',
    '/Type1_핵동용궁사_한국관광공사 김지호_Ha9TWa.jpg',
    '/Type1_깡통야시장_한국관광공사 김지호_sS5JIa(1).jpg',
    '/Type1_깡통야시장_한국관광공사 김지호_sS5JDa(1).jpg',
    '/Type1_부산국제시장_한국관광공사 김지호_0c8lca.jpg',
    '/Type1_자갈치시장_IR 스튜디오_LNrJOa.jpg',
    '/Type1_광장시장_한국관광공사 이범수_84cpaa(1).jpg',
  ],
  gyeongju: [
    '/region-gyeongju.jpg',
    '/Type1_불국사_두드림_z0WAPa.jpg',
    '/Type1_대릉원(천마총)_한국관광공사, 엠엠피 김진규_651iea(1).jpg',
    '/Type1_대릉원의 가을_이명진_NoD0fa(1).jpg',
    '/Type1_첨성대_한국관광공사 김지호_r4H57a.jpg',
    '/Type1_첨성대_한국관광공사 이범수_jHzDia.jpg',
    '/Type1_경주 교촌마을_한국관광공사 김지호_McL7ma(1).jpg',
    '/Type1_과거와 현재의 공존_표길영_spB4IZ(1).jpg',
    '/Type1_볼문정_라이브스튜디오_H1byza(1).jpg',
    '/Type1_운곡서원의 가을_노명유_bWtFDp.jpg',
    '/Type1_월정교 반영_황은경_8898ea.jpg',
    '/Type1_유채꽃 축제_Ekaterina Rogozkina_t5Shka.jpg',
    '/Type1_황리단길_한국관광공사 김지호_p6JHdG.jpg',
    '/Type1_경주 중앙시장_한국관광공사 이범수_jHzD4a(1).jpg',
  ],
  danyang: [
    '/region-danyang.jpg',
    '/Type1_도담삼봉_한국관광공사 김지호_m9M3Ka(2).jpg',
    '/Type1_단양강 잔도_한국관광공사 김지호_6yEHMa(1).jpg',
    '/Type1_만천하스카이워크_한국관광공사 김지호_dAeuea(1).jpg',
    '/Type1_구인사 설경_정태섭_buVutY(1).jpg',
    '/Type1_단양 구인사_심현우_I9Wwhg(1).jpg',
    '/Type1_상선암_한국관광공사 김지호_NxiAfa.jpg',
    '/Type1_고수동굴_우창민_fe88vW(1).jpg',
    '/Type1_고수동굴_우창민_OKkx36(1).jpg',
    '/Type1_고수동굴_우창민_VD5JRr(1).jpg',
    '/Type1_고수동굴_우창민_bq6ita(1).jpg',
    '/Type1_단양 구경시장_한국관광공사 김지호_p8BITa(1).jpg',
  ],
  chuncheon: [
    '/region-chuncheon.jpg',
    '/Type1_남이섬_라이브스튜디오 김학리_nAXeHa(2).jpg',
    '/AdobeStock_317669454_Preview.jpeg',
    '/AdobeStock_339397586.jpeg',
    '/AdobeStock_398851394_Preview.jpeg',
    '/AdobeStock_471672383_Preview.jpeg',
    '/AdobeStock_479480288.jpeg',
    '/AdobeStock_496652117.jpeg',
    '/AdobeStock_526120779_Preview.jpeg',
    '/AdobeStock_88280073_Preview.jpeg',
  ],
  incheon: [
    '/region-incheon.jpg',
    '/Type1_인천 차이나타운_한국관광공사 이범수_br0BVa.jpg',
    '/Type1_강화도_천준교_CbVKL2.jpg',
  ],
  paju: [
    '/region-paju.jpg',
    '/Type1_임진각 관광지_한국관광공사 이범수_WX0kEa.jpg',
    '/Type1_도라전망대_한국관광공사 이범수_ruNNUa.jpg',
  ],
  ganghwa: [
    '/region-ganghwa.jpg',
    '/Type1_강화도_천준교_CbVKL2.jpg',
    '/Type1_고성통일전망대_한국관광공사 김지호_DWrc2a.jpg',
  ],
  jeonju: [
    '/region-jeonju.jpg',
    '/3Xgcka_북촌한옥마을.jpg',
    '/dJ6Ara_북촌한옥마을.jpg',
  ],
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
            <a
              href="https://wa.me/821087140611"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#25D366] text-white rounded-full font-bold hover:bg-[#128C7E] transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              {t.regionDetail.bookNow}
            </a>
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
