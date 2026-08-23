import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useJsonLd } from '@/hooks/useJsonLd';
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from '@/lib/jsonLd';
import { guideCanonicalUrl } from '@/lib/seoRoutes';
import { sanitizeGuideHtml } from '@/lib/sanitizeGuideHtml';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { pickGuideCopy, type GuideDoc, type GuideMeta } from '@/sections/guide/guideCopy';
import { GuideIndexBody } from '@/sections/guide/GuideIndexBody';
import { GuideArticleBody, type GuideArticleStatus } from '@/sections/guide/GuideArticleBody';
import guidesIndex from '@/content/guides/_index.json';
import '@/styles/guide-editorial.css';

/**
 * 여행 가이드 — blogspot 15+편을 우리 도메인으로 이식 (2026-08-01, 유입 확보 묶음 C).
 * 콘텐츠 자산·검색 순위가 Blogger 도메인에 쌓이던 것을 cocotripkr.com/guide/* 로 옮긴다.
 * 원문 = Brain OS 봇이 생성한 우리 글(Blogger API 수집·정제, 이미지도 우리 도메인 호스팅).
 * 본문 JSON 은 글별 청크(import.meta.glob lazy) — eager 번들에 안 들어간다.
 * 글 UI 문구는 4언어 로컬 COPY (본문은 영어 채널이라 영어 고정 — 블로그와 동일 정책).
 *
 * 2026-08-11 Korea Editorial Concierge 전환. 이 파일은 라우팅·메타·로드 상태만 들고,
 * 화면은 src/sections/guide/* 가 그린다(firebase·라우터를 모르는 순수 컴포넌트라 렌더
 * 테스트가 목킹 없이 돈다). 디자인 SSOT: docs/DESIGN-EDITORIAL-CONCIERGE.md
 */

const guideModules = import.meta.glob<{ default: GuideDoc }>('../content/guides/*.json');

const GUIDES = guidesIndex as GuideMeta[];

function Shell({ children }: { children: React.ReactNode }) {
  const { language, t, changeLanguage } = useLanguage();
  return (
    <div className="ec-root min-h-screen">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      {children}
      <Footer t={t} />
    </div>
  );
}

export default function GuideIndexPage() {
  const { language } = useLanguage();
  const copy = pickGuideCopy(language);
  usePageMeta({
    title: copy.index.title,
    description: copy.index.lede,
    ogImage: '/hero-hanok-real.webp',
    ogUrl: guideCanonicalUrl(),
  });
  // 빵부스러기 이름은 화면에 보이는 섹션명(masthead eyebrow)과 같은 문구다 —
  // 마크업과 보이는 것이 달라지면 안 된다.
  useJsonLd('guide-breadcrumb', buildBreadcrumbJsonLd([['CocoTrip', '/'], [copy.index.title, '/guide']]));
  return (
    <Shell>
      <GuideIndexBody copy={copy} guides={GUIDES} />
    </Shell>
  );
}

export function GuideDetailPage() {
  const { slug } = useParams();
  const { language } = useLanguage();
  const copy = pickGuideCopy(language);

  // 로드 결과를 slug 와 함께 저장하고 렌더에서 파생 — slug 변경 시 "리셋 setState" 가
  // 필요 없어(react-hooks/set-state-in-effect 회피) 이전 글이 잠깐 보이는 일도 없다.
  const [loaded, setLoaded] = useState<{ slug: string; doc: GuideDoc | null } | null>(null);
  const loader = slug ? guideModules[`../content/guides/${slug}.json`] : undefined;
  const done = loaded !== null && loaded.slug === slug;
  const doc = done ? loaded.doc : null;

  // 없는 글(loader 자체가 없음)과 못 불러온 글(청크 fetch 실패)은 사용자가 할 수 있는
  // 일이 다르다 — 하나는 목록으로, 하나는 재시도다. 전환 전에는 둘 다 "글 없음"이었다.
  useEffect(() => {
    if (!slug || !loader) return;
    let cancelled = false;
    loader().then((m) => { if (!cancelled) setLoaded({ slug, doc: m.default }); })
      .catch(() => { if (!cancelled) setLoaded({ slug, doc: null }); });
    return () => { cancelled = true; };
  }, [slug, loader]);

  // 재시도 = 전체 새로고침. 2026-08-11 Chromium 실측: 동적 import 가 한 번 거절되면
  // 모듈 맵에 실패가 남아 같은 loader 를 다시 불러도 네트워크를 타지 않고 즉시 거절된다
  // — "다시 시도" 를 소프트 재호출로 만들면 영원히 성공할 수 없는 버튼이 된다.
  // App.tsx 의 lazyRetry 가 같은 이유로 reload 를 쓴다.
  const retry = useCallback(() => window.location.reload(), []);

  // 읽는 시간은 목록이 본문에서 계산해 둔 낱말 수에서만 나온다. 목록에 없는 글이면
  // (직접 URL 로 들어온 신규 파일 등) 그 줄을 아예 그리지 않는다 — 지어내지 않는다.
  const meta = GUIDES.find((g) => g.slug === slug);
  const safeHtml = doc ? sanitizeGuideHtml(doc.html) : '';
  const hasSafeBody = safeHtml.trim().length > 0;
  const status: GuideArticleStatus = !loader
    ? 'missing'
    : !done
      ? 'loading'
      : loaded.doc && hasSafeBody
        ? 'ready'
        : 'error';
  const readyDoc = status === 'ready' ? doc : null;
  const firstImg = safeHtml ? /<img[^>]+src="([^"]+)"/.exec(safeHtml)?.[1] : undefined;
  const ogImage = firstImg || meta?.image || '/hero-hanok-real.webp';
  const canonicalUrl = slug ? guideCanonicalUrl(slug) : guideCanonicalUrl();
  const pageTitle = readyDoc?.title || meta?.title || copy.index.title;
  const pageDescription = readyDoc?.description || meta?.description || copy.index.lede;

  usePageMeta({
    title: pageTitle,
    description: pageDescription,
    ogImage,
    ogUrl: canonicalUrl,
    contentSha256: readyDoc?.contentSha256,
    robots: status === 'ready' ? 'index, follow' : 'noindex, nofollow',
  });
  // 글이 로드된 뒤에만 Article 을 내보낸다 — 로딩 중 껍데기에 스키마를 붙이면
  // 제목·날짜가 빈 Article 이 크롤러에 잡힌다.
  useJsonLd('guide-article', readyDoc && slug
    ? buildArticleJsonLd({
        path: canonicalUrl,
        title: readyDoc.title,
        description: readyDoc.description,
        published: readyDoc.published,
        updated: readyDoc.updated,
        image: firstImg,
        contentSha256: readyDoc.contentSha256,
      })
    : null);
  useJsonLd('guide-breadcrumb', readyDoc && slug
    ? buildBreadcrumbJsonLd([['CocoTrip', '/'], [copy.index.title, '/guide'], [readyDoc.title, `/guide/${slug}`]])
    : null);

  return (
    <Shell>
      <GuideArticleBody copy={copy} status={status} doc={readyDoc} words={meta?.words} onRetry={retry} />
    </Shell>
  );
}
