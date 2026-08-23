import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { pickHomeCopy, type HomeLang } from '@/sections/home/homeCopy';
import { pickAboutCopy } from './aboutCopy';

/**
 * /about — 회사 소개 (2026-08-23 전면 교체).
 *
 * 🔴 이전 화면에는 뜻 있는 낱말이 **두 개**("About COCOTRIP") 뿐이었다. 나머지는 브랜드
 *    이미지 4장이고, 모바일·데스크톱이 서로 다른 트리로 갈라져 있었다. 색인 대상 경로인데
 *    크롤러가 읽을 본문이 없었고, "이 회사를 믿어도 되나" 를 확인하려는 사람에게도
 *    아무 말을 하지 않았다.
 *
 * 지금 본문은 **이미 검증된 두 원천만** 잇는다 — 이 파일은 새 사실을 만들지 않는다:
 *   · `sections/home/homeCopy.ts` (서비스 3종 · 데이터 근거 · 안 하는 약속)
 *   · `t.footer.*` (상호·대표·주소·등록번호·연락처 — 이미 전 페이지 하단에 있는 값)
 * 면허번호·보증·응대시간·가격을 새로 적지 않는다. `tests/unit/about-content.component.test.tsx` 가 잠근다.
 *
 * 화면은 한 개의 반응형 트리다(홈·가이드·지역과 같은 Editorial 토큰). 예전의
 * `useIsMobile` 분기는 같은 페이지를 두 벌 유지하게 만들었을 뿐이다.
 */

export default function About() {
  const { language, t, changeLanguage } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as HomeLang;
  const copy = pickAboutCopy(lang);
  const home = pickHomeCopy(lang);
  const footer = t.footer;

  usePageMeta({
    title: t.pageMeta?.about?.title || 'About CocoTrip',
    description: t.pageMeta?.about?.description
      || 'CocoTrip is a premium Korea inbound travel agency offering private tours, charter vehicles, and AI-powered trip planning.',
    ogImage: '/hero-hanok-real.webp',
  });

  const services = [
    { key: 'plan', to: '/planner', module: home.modules.plan },
    { key: 'charter', to: '/charter', module: home.modules.charter },
    { key: 'tours', to: '/tours', module: home.modules.tours },
  ] as const;

  // 등록·연락 정보는 전부 footer i18n 값 그대로다. 없는 값은 줄 자체를 그리지 않는다.
  const companyRows = [
    footer?.company,
    footer?.ceo,
    footer?.address,
    footer?.businessNo,
    footer?.tourNo,
    footer?.email,
    footer?.phone,
    footer?.hours,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const readNext = [
    { to: '/guide', label: copy.readNext.guide },
    { to: '/#regions', label: copy.readNext.regions },
    { to: '/terms', label: copy.readNext.terms },
    { to: '/privacy', label: copy.readNext.privacy },
    { to: '/travel-terms', label: copy.readNext.travelTerms },
  ];

  return (
    <div className="ec-root min-h-screen">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <main className="ec-root">
        {/* ── 이름 · 이 페이지가 담는 것 · 검증 가능한 한 줄 ── */}
        <section className="border-b border-ec-line">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow">{copy.eyebrow}</p>
            <h1 className="ec-h2 mt-4 max-w-[20ch] text-[clamp(26px,3.4vw,40px)]">
              {t.about?.heading || 'About COCOTRIP'}
            </h1>
            <p className="ec-body ec-measure mt-5">{copy.lede}</p>
            <p className="ec-body-sm mt-6 border-l-2 border-ec-brand pl-4 text-ec-ink-2">
              {home.ledger.trustLine}
            </p>
          </div>
        </section>

        {/* ── 우리가 운영하는 것 세 가지. 문구는 홈과 같은 원천이라 두 화면이 어긋날 수 없다. ── */}
        <section className="border-b border-ec-line">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow">{home.modules.eyebrow}</p>
            <h2 className="ec-h2 mt-4 max-w-[22ch]">{home.modules.heading}</h2>
            <ul className="mt-8 grid gap-x-10 md:grid-cols-3">
              {services.map(({ key, to, module }) => (
                <li key={key} className="border-t border-ec-line py-6">
                  <p className="ec-eyebrow text-ec-brand">{module.kicker}</p>
                  <h3 className="ec-h3 mt-3">{module.title}</h3>
                  <p className="ec-body-sm mt-3">{module.body}</p>
                  <Link
                    to={to}
                    className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-semibold text-ec-brand transition-colors duration-ec-base ease-ec-standard hover:text-ec-brand-hover"
                  >
                    {module.cta}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 일정이 무엇을 근거로 나오는가. 수치는 홈 원장과 같은 상수(실제 파일에서 재계산 잠금). ── */}
        <section className="border-b border-ec-line bg-ec-sunken">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow">{home.ledger.eyebrow}</p>
            <h2 className="ec-h2 mt-4 max-w-[24ch]">{home.ledger.heading}</h2>
            <p className="ec-body ec-measure mt-5">{home.ledger.lede}</p>
            <dl className="mt-8 grid gap-x-10 md:grid-cols-3">
              {home.ledger.items.map((item) => (
                <div key={item.label} className="border-t border-ec-line py-6">
                  <dt className="ec-figure text-[22px] text-ec-brand">{item.figure}</dt>
                  <dd className="mt-2">
                    <span className="block text-[15px] font-semibold text-ec-ink">{item.label}</span>
                    <span className="ec-body-sm mt-2 block">{item.note}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── 안 하는 약속. 신뢰는 여기서 갈린다 — 못 하는 것을 먼저 말한다. ── */}
        <section className="border-b border-ec-line">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow">{copy.limitsHeading}</p>
            <h2 className="ec-h2 mt-4 max-w-[24ch]">{home.closing.reviewsHeading}</h2>
            <p className="ec-body ec-measure mt-5">{home.closing.reviewsBody}</p>
            <p className="ec-body-sm ec-measure mt-6 border-l-2 border-ec-notice bg-ec-sunken px-4 py-3 text-ec-ink-2">
              {home.ledger.limits}
            </p>
          </div>
        </section>

        {/* ── 사업자 정보. footer i18n 값 그대로 — 두 번째 원천을 만들지 않는다. ── */}
        <section className="border-b border-ec-line">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow">{copy.companyHeading}</p>
            <ul className="mt-6 max-w-[46rem]">
              {companyRows.map((row) => (
                <li key={row} className="border-t border-ec-line py-3 text-[15px] text-ec-ink-2">
                  {row}
                </li>
              ))}
            </ul>
            <p className="ec-body-sm mt-4 text-ec-ink-3">{copy.companyNote}</p>
          </div>
        </section>

        {/* ── 이어서 볼 곳. 평범한 앵커라 프리렌더 HTML 에 그대로 실린다. ── */}
        <section className="border-b border-ec-line bg-ec-sunken">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow">{copy.readNextHeading}</p>
            <ul className="mt-6 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
              {readNext.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="group flex min-h-[44px] items-center gap-3 border-t border-ec-line py-4 text-[15px] font-semibold text-ec-ink"
                  >
                    <span className="min-w-0 flex-1">{link.label}</span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-ec-ink-3 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 운영자가 만든 브랜드 상세 이미지. 본문이 아니라 마지막 첨부다. ── */}
        <section>
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow">{copy.brandHeading}</p>
            <div className="mt-6 flex flex-col items-center gap-6">
              {[1, 2, 3, 4].map((n) => (
                <img
                  key={n}
                  src={`/브랜드 상세페이지/${n}.jpeg`}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                  className="w-full max-w-3xl rounded-ec-md border border-ec-line object-cover"
                />
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer t={t} />
    </div>
  );
}
