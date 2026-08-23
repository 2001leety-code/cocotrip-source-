import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Phone, MessageCircle, Sparkles } from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { RegionSeoInfo } from '@/components/region/RegionSeoInfo';
import { CITY_CHIPS } from '@/components/WizardForm/data';
import { REGION_IDS, regionPath } from '@/data/regions';
import '@/styles/editorial-region.css';

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
    // 2026-08-22 후속 감사 제거: '/서울/해방촌-남산야경.jpg' 는 좌하단에
    // "AI로 생성한 콘텐츠" 워터마크가 박힌 AI 생성 이미지 → 지역 실사진 갤러리에서 제외(21→20장).
    '/서울/서울 (16).jpg', '/서울/서울 (17).jpg',
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

type RegionLanguage = 'ko' | 'en' | 'ja' | 'zh';

type RegionData = {
  title: string;
  subtitle: string;
  description: string;
  attractions: { name: string; desc: string }[];
};

const SHELL_COPY: Record<RegionLanguage, {
  eyebrow: string;
  notFoundBody: string;
  nextStep: string;
  ctaTitle: (region: string) => string;
  plannerBody: string;
  contactBody: string;
  browseTours: string;
  phone: string;
  facts: (places: number, photos: number) => string;
  otherRegions: string;
}> = {
  ko: {
    eyebrow: '한국 지역 안내',
    notFoundBody: '주소를 다시 확인하거나 다른 지역 안내를 살펴보세요.',
    nextStep: '다음 단계',
    ctaTitle: (region) => `${region} 방문을 준비하세요`,
    plannerBody: '지역 정보를 확인한 뒤, 여행 날짜와 조건에 맞는 일정을 플래너에서 구성할 수 있어요.',
    contactBody: '지역 정보를 확인한 뒤, 투어 목록을 살펴보거나 이동 방법을 문의하세요.',
    browseTours: '투어 둘러보기',
    phone: '전화 문의',
    facts: (places, photos) => `명소 ${places}곳 · 사진 ${photos}장`,
    otherRegions: '다른 지역',
  },
  en: {
    eyebrow: 'Korea region guide',
    notFoundBody: 'Check the address or choose another Korea region guide.',
    nextStep: 'Next step',
    ctaTitle: (region) => `Prepare your visit to ${region}`,
    plannerBody: 'Review the region first, then arrange it around your dates and trip conditions in the planner.',
    contactBody: 'Review the region information, then browse the tour list or ask CocoTrip about travel options.',
    browseTours: 'Browse tours',
    phone: 'Call CocoTrip',
    facts: (places, photos) => `${places} places · ${photos} photos`,
    otherRegions: 'Other regions',
  },
  ja: {
    eyebrow: '韓国地域ガイド',
    notFoundBody: 'URLを確認するか、別の地域ガイドをご覧ください。',
    nextStep: '次のステップ',
    ctaTitle: (region) => `${region}への旅を準備する`,
    plannerBody: '地域情報を確認してから、旅行日程と条件に合わせてプランナーで旅程を組み立てられます。',
    contactBody: '地域情報を確認してから、ツアー一覧を見るか、移動方法についてお問い合わせください。',
    browseTours: 'ツアーを見る',
    phone: '電話で問い合わせ',
    facts: (places, photos) => `スポット${places}か所 · 写真${photos}枚`,
    otherRegions: 'ほかの地域',
  },
  zh: {
    eyebrow: '韩国地区指南',
    notFoundBody: '请检查网址，或浏览其他韩国地区指南。',
    nextStep: '下一步',
    ctaTitle: (region) => `准备前往${region}`,
    plannerBody: '先查看地区信息，再在规划工具中根据日期和出行条件安排行程。',
    contactBody: '查看地区信息后，可浏览旅游产品列表或咨询前往方式。',
    browseTours: '浏览旅游产品',
    phone: '电话咨询',
    facts: (places, photos) => `${places}个景点 · ${photos}张照片`,
    otherRegions: '其他地区',
  },
};

function toLanguage(value: string): RegionLanguage {
  return value === 'ko' || value === 'ja' || value === 'zh' ? value : 'en';
}

function isRegionData(value: unknown): value is RegionData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RegionData;
  return typeof candidate.title === 'string'
    && typeof candidate.subtitle === 'string'
    && typeof candidate.description === 'string'
    && Array.isArray(candidate.attractions)
    && candidate.attractions.every((attraction) => (
      typeof attraction?.name === 'string' && typeof attraction?.desc === 'string'
    ));
}

export function RegionDetail() {
  const { regionId } = useParams<{ regionId: string }>();
  const { language, t, changeLanguage } = useLanguage();
  const lang = toLanguage(language);
  const copy = SHELL_COPY[lang];
  const isKnownRegionId = Boolean(
    regionId && Object.prototype.hasOwnProperty.call(regionImages, regionId),
  );
  const regionValue = isKnownRegionId
    ? t.regionDetail[regionId as keyof typeof t.regionDetail]
    : undefined;
  const regionData = isRegionData(regionValue) ? regionValue : undefined;
  const images = isKnownRegionId && regionId ? regionImages[regionId] : [];
  const galleryImages = images.slice(1);
  const plannerCovered = Boolean(regionId && CITY_CHIPS.some((chip) => chip.key === regionId));
  // 지역끼리 잇는 앵커. 이 페이지들은 홈에서만 들어올 수 있었고 서로는 이어져 있지
  // 않았다 — 이름·한 줄 설명은 각 지역의 i18n 에서 그대로 가져오므로 여기서 새 사실을
  // 만들지 않는다. 번역이 비면 그 지역은 목록에서 빠진다.
  const otherRegions = REGION_IDS.flatMap((id) => {
    if (id === regionId) return [];
    const entry = t.regionDetail?.[id as keyof typeof t.regionDetail] as
      { title?: unknown; subtitle?: unknown } | undefined;
    const title = typeof entry?.title === 'string' ? entry.title : '';
    const subtitle = typeof entry?.subtitle === 'string' ? entry.subtitle : '';
    return title ? [{ id, title, subtitle }] : [];
  });

  usePageMeta({
    title: regionData?.title || t.regionDetail?.notFound || 'Region not found',
    description: regionData?.description || copy.notFoundBody,
    ogImage: images[0] || '/hero-seoul.webp',
  });

  return (
    <div className="region-editorial ec-root">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="region-editorial-main">
        {!regionData ? (
          <section data-testid="region-detail-not-found" className="region-editorial-not-found ec-container">
            <p className="ec-eyebrow">{copy.eyebrow}</p>
            <h1 className="ec-h2">{t.regionDetail?.notFound || 'Region not found'}</h1>
            <p className="ec-body">{copy.notFoundBody}</p>
            <div className="region-editorial-not-found-actions">
              <Link to="/" className="ec-btn ec-btn-primary">{t.regionDetail?.goHome || 'Go Home'}</Link>
              <Link to="/#regions" className="ec-btn ec-btn-secondary">{t.regionDetail?.backToRegions || 'Back to Regions'}</Link>
            </div>
          </section>
        ) : (
          <article data-testid="region-detail-ready" data-region-id={regionId || ''}>
            <section className="region-editorial-hero ec-container-wide" aria-labelledby="region-title">
              <Link to="/#regions" className="region-editorial-back ec-btn ec-btn-quiet">
                <ArrowLeft aria-hidden />
                {t.regionDetail.backToRegions}
              </Link>
              <div className="region-editorial-hero-grid">
                <div className="region-editorial-hero-copy">
                  <p className="ec-eyebrow">{copy.eyebrow}</p>
                  <h1 id="region-title" className="ec-display">{regionData.title}</h1>
                  <p className="region-editorial-deck">{regionData.subtitle}</p>
                  <p className="ec-body">{regionData.description}</p>
                  <p className="region-editorial-facts ec-figure">
                    {copy.facts(regionData.attractions.length, images.length)}
                  </p>
                </div>
                <figure className="region-editorial-hero-media">
                  <img src={images[0] || '/region-seoul.jpg'} alt={regionData.title} />
                </figure>
              </div>
            </section>

            <section className="region-editorial-attractions">
              <div className="ec-container">
                <header className="region-editorial-section-heading">
                  <p className="ec-eyebrow">{t.regionDetail?.mustVisit || 'Must-Visit'}</p>
                  <h2 className="ec-h2">{t.regionDetail?.mustVisitAttractions || 'Must-Visit Attractions'}</h2>
                </header>
                <ol className="region-editorial-attraction-list" role="list">
                  {regionData.attractions.map((attraction: { name: string; desc: string }, index: number) => (
                    <li key={attraction.name} className="region-editorial-attraction">
                      <span className="region-editorial-attraction-number ec-figure">{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <h3 className="ec-h3">{attraction.name}</h3>
                        <p className="ec-body-sm">{attraction.desc}</p>
                      </div>
                      <MapPin aria-hidden />
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            {galleryImages.length > 0 && (
              <section className="region-editorial-gallery-section ec-container-wide">
                <header className="region-editorial-section-heading">
                  <p className="ec-eyebrow">{t.regionDetail?.gallery || 'Gallery'}</p>
                  <h2 className="ec-h2">{t.regionDetail?.photoGallery || 'Photo Gallery'}</h2>
                </header>
                <div className="region-editorial-gallery">
                  {galleryImages.map((image, index) => (
                    <figure key={image}>
                      <img src={image} alt={`${regionData.title} ${t.regionDetail?.gallery || 'gallery'} ${index + 1}`} loading="lazy" />
                    </figure>
                  ))}
                </div>
              </section>
            )}

            <section className="region-editorial-evidence ec-container">
              <RegionSeoInfo regionId={regionId || ''} regionTitle={regionData.title} language={language} t={t} />
            </section>

            {otherRegions.length > 0 && (
              <section className="region-editorial-other ec-container" aria-labelledby="region-other">
                <header className="region-editorial-section-heading">
                  <p className="ec-eyebrow">{copy.eyebrow}</p>
                  <h2 id="region-other" className="ec-h2">{copy.otherRegions}</h2>
                </header>
                <ul className="region-editorial-other-list" role="list">
                  {otherRegions.map((region) => (
                    <li key={region.id}>
                      <Link to={regionPath(region.id)} className="region-editorial-other-link">
                        <span className="ec-h3">{region.title}</span>
                        {region.subtitle && <span className="ec-body-sm">{region.subtitle}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="region-editorial-cta">
              <div className="ec-container">
                <p className="ec-eyebrow">{copy.nextStep}</p>
                <h2 className="ec-h2">{copy.ctaTitle(regionData.title)}</h2>
                <p className="ec-body">{plannerCovered ? copy.plannerBody : copy.contactBody}</p>
                <div className="region-editorial-cta-actions">
                  {plannerCovered && (
                    <Link to="/planner" className="ec-btn ec-btn-primary">
                      <Sparkles aria-hidden />
                      {t.regionDetail?.aiPlannerCta || 'Trip Planner'}
                    </Link>
                  )}
                  <Link to="/tours" className={`ec-btn ${plannerCovered ? 'ec-btn-secondary' : 'ec-btn-primary'}`}>
                    {copy.browseTours}
                  </Link>
                  <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-secondary">
                    <MessageCircle aria-hidden />
                    {t.regionDetail?.whatsappCta || 'WhatsApp'}
                  </a>
                  <a href="tel:+821087140611" className="region-editorial-phone ec-btn ec-btn-quiet">
                    <Phone aria-hidden />
                    {copy.phone}
                  </a>
                </div>
              </div>
            </section>
          </article>
        )}
      </main>
      <Footer t={t} />
    </div>
  );
}
