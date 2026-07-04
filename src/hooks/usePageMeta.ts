import { useEffect } from 'react';

interface PageMeta {
  title: string;
  description: string;
  ogImage?: string;
  ogUrl?: string;
}

export function usePageMeta({ title, description, ogImage, ogUrl }: PageMeta) {
  useEffect(() => {
    // Title
    document.title = title ? `${title} | CocoTrip` : 'CocoTrip — Premium Korea Travel';

    // Meta description
    let descMeta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!descMeta) {
      descMeta = document.createElement('meta');
      descMeta.name = 'description';
      document.head.appendChild(descMeta);
    }
    descMeta.content = description;

    // OG title
    let ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
    }
    ogTitle.content = title;

    // OG description
    let ogDesc = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
    if (!ogDesc) {
      ogDesc = document.createElement('meta');
      ogDesc.setAttribute('property', 'og:description');
      document.head.appendChild(ogDesc);
    }
    ogDesc.content = description;

    // OG image
    if (ogImage) {
      let ogImg = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
      if (!ogImg) {
        ogImg = document.createElement('meta');
        ogImg.setAttribute('property', 'og:image');
        document.head.appendChild(ogImg);
      }
      // 소셜 공유(카카오톡·페이스북·트위터) 미리보기는 절대 URL 필요 — 상대경로면
      //   크롤러가 이미지를 못 불러와 빈 썸네일. '/hero.webp' → 'https://cocotripkr.com/hero.webp'.
      ogImg.content = ogImage.startsWith('http')
        ? ogImage
        : `https://cocotripkr.com${ogImage.startsWith('/') ? '' : '/'}${ogImage}`;
    }

    // twitter:image — og:image 와 별도 meta. index.html 정적값(홈 이미지)이 전 라우트에 남아
    //   X(Twitter) 카드가 홈 이미지로 고정되던 것 해소. og:image 와 같은 절대 URL로 동기화.
    if (ogImage) {
      const absImg = ogImage.startsWith('http')
        ? ogImage
        : `https://cocotripkr.com${ogImage.startsWith('/') ? '' : '/'}${ogImage}`;
      let twImg = document.querySelector('meta[name="twitter:image"]') as HTMLMetaElement | null;
      if (!twImg) {
        twImg = document.createElement('meta');
        twImg.setAttribute('name', 'twitter:image');
        document.head.appendChild(twImg);
      }
      twImg.content = absImg;
    }

    // OG URL
    if (ogUrl) {
      let ogUrlMeta = document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null;
      if (!ogUrlMeta) {
        ogUrlMeta = document.createElement('meta');
        ogUrlMeta.setAttribute('property', 'og:url');
        document.head.appendChild(ogUrlMeta);
      }
      ogUrlMeta.content = ogUrl;
    }

    // Canonical (per-route) — index.html 정적 canonical(홈)이 전 라우트에 남아 자기잠식하던 것 해소.
    // 2026-06-09: 클라이언트 세팅이라 JS 렌더 크롤러(Google)용. 무JS 크롤러는 프리렌더 후 반영.
    if (typeof window !== 'undefined') {
      const canonicalHref = ogUrl || `https://cocotripkr.com${window.location.pathname}`;
      let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
      }
      canonical.href = canonicalHref;
    }
  }, [title, description, ogImage, ogUrl]);
}
