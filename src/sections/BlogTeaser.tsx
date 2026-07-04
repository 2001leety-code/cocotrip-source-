import { ArrowUpRight, BookOpen } from 'lucide-react';
import type { Translations } from '@/i18n';

const BLOG_URL = 'https://cocotripkr.blogspot.com';

// 추천 글 하드코딩 — 블로그가 영어 채널이라 제목은 영어 고정.
// 피드 연동은 과설계(외부 요청·CLS 리스크) — 에버그린 3개만 수동 큐레이션, 갱신은 이 목록만.
const POSTS = [
  { title: 'Korea food guide: Must-try dishes beyond KBBQ', url: `${BLOG_URL}/2026/07/korea-food-guide-must-try-dishes-beyond.html` },
  { title: 'Getting around Korea: essential transit tips', url: `${BLOG_URL}/2026/07/korea-transit-tips-getting-around-seoul.html` },
  { title: 'Seoul local spots: Euljiro, Mangwon & Seongsu', url: `${BLOG_URL}/2026/07/seoul-local-spots-neighborhoods.html` },
];

interface BlogTeaserProps {
  t: Translations;
}

export function BlogTeaser({ t }: BlogTeaserProps) {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-[#FF6B9D]" />
            {t.blogTeaser?.title || 'Travel tips from CocoTrip'}
          </h2>
          <p className="text-white/55 text-sm mt-1">{t.blogTeaser?.subtitle || 'Real routes, prices and local picks from our Korea travel blog'}</p>
        </div>
        {/* 외부 블로그 — 권위 전달 목적이라 nofollow 금지 */}
        <a
          href={BLOG_URL}
          target="_blank"
          rel="noopener"
          className="hidden sm:inline-flex items-center gap-1 text-sm text-[#B668FC] hover:text-[#FF6B9D] transition-colors shrink-0"
        >
          {t.blogTeaser?.viewAll || 'View all posts'}
          <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {POSTS.map((p) => (
          <a
            key={p.url}
            href={p.url}
            target="_blank"
            rel="noopener"
            className="group flex items-start justify-between gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 hover:border-[#B668FC]/40 hover:bg-white/[0.05] transition-colors"
          >
            <span className="text-sm text-white/80 group-hover:text-white leading-snug">{p.title}</span>
            <ArrowUpRight className="w-4 h-4 text-white/25 group-hover:text-[#B668FC] shrink-0 mt-0.5" />
          </a>
        ))}
      </div>
      <a
        href={BLOG_URL}
        target="_blank"
        rel="noopener"
        className="sm:hidden mt-4 inline-flex items-center gap-1 text-sm text-[#B668FC]"
      >
        {t.blogTeaser?.viewAll || 'View all posts'}
        <ArrowUpRight className="w-4 h-4" />
      </a>
    </section>
  );
}
