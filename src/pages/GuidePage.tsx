import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CalendarDays } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useJsonLd } from '@/hooks/useJsonLd';
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from '@/lib/jsonLd';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import type { Language } from '@/i18n';
import guidesIndex from '@/content/guides/_index.json';

/**
 * 여행 가이드 — blogspot 15+편을 우리 도메인으로 이식 (2026-08-01, 유입 확보 묶음 C).
 * 콘텐츠 자산·검색 순위가 Blogger 도메인에 쌓이던 것을 cocotripkr.com/guide/* 로 옮긴다.
 * 원문 = Brain OS 봇이 생성한 우리 글(Blogger API 수집·정제, 이미지도 우리 도메인 호스팅).
 * 본문 JSON 은 글별 청크(import.meta.glob lazy) — eager 번들에 안 들어간다.
 * 글 UI 문구는 4언어 로컬 COPY (본문은 영어 채널이라 영어 고정 — 블로그와 동일 정책).
 */

type GuideMeta = {
  slug: string; title: string; description: string;
  published: string; updated: string; labels: string[];
};
type GuideDoc = GuideMeta & { html: string };

const guideModules = import.meta.glob<{ default: GuideDoc }>('../content/guides/*.json');

const COPY: Record<Language, { title: string; subtitle: string; back: string; read: string; notFound: string; notFoundBody: string }> = {
  en: { title: 'Korea Travel Guides', subtitle: 'Real routes, prices and local picks — written by the CocoTrip team.', back: 'All guides', read: 'Read guide', notFound: 'Guide not found', notFoundBody: 'This guide may have moved. Browse all guides instead.' },
  ko: { title: '한국 여행 가이드', subtitle: '코코트립 팀이 쓰는 실제 동선·가격·현지 추천.', back: '전체 가이드', read: '가이드 읽기', notFound: '가이드를 찾을 수 없어요', notFoundBody: '이동됐을 수 있어요. 전체 가이드에서 찾아보세요.', },
  ja: { title: '韓国旅行ガイド', subtitle: 'CocoTrip チームによる実際のルート・料金・現地のおすすめ。', back: 'ガイド一覧', read: 'ガイドを読む', notFound: 'ガイドが見つかりません', notFoundBody: '移動した可能性があります。ガイド一覧からお探しください。' },
  zh: { title: '韩国旅行指南', subtitle: 'CocoTrip 团队撰写的真实路线、价格与本地推荐。', back: '全部指南', read: '阅读指南', notFound: '未找到该指南', notFoundBody: '内容可能已移动，请浏览全部指南。' },
};

function Shell({ children }: { children: React.ReactNode }) {
  const { language, t, changeLanguage } = useLanguage();
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210]">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      {children}
      <Footer t={t} />
    </div>
  );
}

export default function GuideIndexPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  usePageMeta({ title: copy.title, description: copy.subtitle, ogImage: '/hero-hanok-real.webp' });
  // 빵부스러기 이름은 화면 h1 과 같은 문구(=현재 언어)를 쓴다 — 마크업과 보이는 것이 달라지면 안 된다.
  useJsonLd('guide-breadcrumb', buildBreadcrumbJsonLd([['CocoTrip', '/'], [copy.title, '/guide']]));
  const guides = guidesIndex as GuideMeta[];
  return (
    <Shell>
      <main className="container mx-auto px-4 py-14 max-w-4xl">
        <h1 className="text-4xl font-display text-white mb-2 flex items-center gap-3"><BookOpen className="w-8 h-8 text-[#FF6B9D]" />{copy.title}</h1>
        <p className="text-white/55 mb-10">{copy.subtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {guides.map((g) => (
            <Link key={g.slug} to={`/guide/${g.slug}`} className="group rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 hover:border-[#B668FC]/40 hover:bg-white/[0.05] transition-colors">
              <div className="text-xs text-white/40 mb-2 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" />{g.published}</div>
              <h2 className="text-white/90 group-hover:text-white font-semibold leading-snug mb-2">{g.title}</h2>
              <p className="text-sm text-white/50 leading-relaxed line-clamp-3">{g.description}</p>
              <span className="mt-3 inline-block text-sm text-[#B668FC]">{copy.read} →</span>
            </Link>
          ))}
        </div>
      </main>
    </Shell>
  );
}

export function GuideDetailPage() {
  const { slug } = useParams();
  const { language } = useLanguage();
  const copy = COPY[language];
  // 로드 결과를 slug 와 함께 저장하고 렌더에서 파생 — slug 변경 시 "리셋 setState" 가
  // 필요 없어(react-hooks/set-state-in-effect 회피) 이전 글이 잠깐 보이는 일도 없다.
  const [loaded, setLoaded] = useState<{ slug: string; doc: GuideDoc | null } | null>(null);
  const loader = slug ? guideModules[`../content/guides/${slug}.json`] : undefined;
  const done = loaded !== null && loaded.slug === slug;
  const doc = done ? loaded.doc : null;
  const missing = !loader || (done && loaded.doc === null);

  useEffect(() => {
    if (!slug || !loader) return;
    let cancelled = false;
    loader().then((m) => { if (!cancelled) setLoaded({ slug, doc: m.default }); })
      .catch(() => { if (!cancelled) setLoaded({ slug, doc: null }); });
    return () => { cancelled = true; };
  }, [slug, loader]);

  const firstImg = doc ? /<img[^>]+src="([^"]+)"/.exec(doc.html)?.[1] : undefined;
  usePageMeta({
    title: doc ? doc.title : copy.title,
    description: doc ? doc.description : copy.subtitle,
    ogImage: firstImg || '/hero-hanok-real.webp',
  });
  // 글이 로드된 뒤에만 Article 을 내보낸다 — 로딩 중 껍데기에 스키마를 붙이면
  // 제목·날짜가 빈 Article 이 크롤러에 잡힌다.
  useJsonLd('guide-article', doc && slug
    ? buildArticleJsonLd({
        path: `/guide/${slug}`,
        title: doc.title,
        description: doc.description,
        published: doc.published,
        updated: doc.updated,
        image: firstImg,
      })
    : null);
  useJsonLd('guide-breadcrumb', doc && slug
    ? buildBreadcrumbJsonLd([['CocoTrip', '/'], [copy.title, '/guide'], [doc.title, `/guide/${slug}`]])
    : null);

  return (
    <Shell>
      <main className="container mx-auto px-4 py-14 max-w-3xl">
        <Link to="/guide" className="inline-flex items-center gap-1.5 text-sm text-[#B668FC] hover:text-[#FF6B9D] transition-colors mb-8"><ArrowLeft className="w-4 h-4" />{copy.back}</Link>
        {missing && (
          <div className="text-center py-20">
            <h1 className="text-2xl text-white mb-3">{copy.notFound}</h1>
            <p className="text-white/55 mb-6">{copy.notFoundBody}</p>
            <Link to="/guide" className="text-[#B668FC]">{copy.back} →</Link>
          </div>
        )}
        {doc && (
          <article>
            <h1 className="text-3xl sm:text-4xl font-display text-white leading-tight mb-3">{doc.title}</h1>
            <div className="text-sm text-white/40 mb-8 flex items-center gap-1.5"><CalendarDays className="w-4 h-4" />{doc.published}</div>
            {/* 본문 = 우리 봇이 생성한 자체 콘텐츠(수집 시 script/iframe/핸들러 부재 검증) */}
            <div className="guide-article" dangerouslySetInnerHTML={{ __html: doc.html }} />
          </article>
        )}
      </main>
    </Shell>
  );
}
