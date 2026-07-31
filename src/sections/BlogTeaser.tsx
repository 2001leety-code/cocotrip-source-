import { ArrowUpRight, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Translations } from '@/i18n';

// 2026-08-01: blogspot → 우리 도메인 /guide 이식(유입 확보 묶음 C). 링크 전부 내부 전환 —
// 검색 자산·체류가 우리 도메인에 쌓인다. 에버그린 3개 수동 큐레이션 정책은 유지, 갱신은 이 목록만.
const POSTS = [
  { title: 'Seoul Cafe Guide 2026: Best Neighborhoods & What to Know', to: '/guide/seoul-cafe-guide-2026-best' },
  { title: 'How to Ace Your First K-Pop Concert in Korea', to: '/guide/how-to-ace-your-first-k-pop-concert-in' },
  { title: 'How to Find Halal Food in Seoul', to: '/guide/how-to-find-halal-food-in-seoul-2026' },
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
        <Link
          to="/guide"
          className="hidden sm:inline-flex items-center gap-1 text-sm text-[#B668FC] hover:text-[#FF6B9D] transition-colors shrink-0"
        >
          {t.blogTeaser?.viewAll || 'View all posts'}
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {POSTS.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="group flex items-start justify-between gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 hover:border-[#B668FC]/40 hover:bg-white/[0.05] transition-colors"
          >
            <span className="text-sm text-white/80 group-hover:text-white leading-snug">{p.title}</span>
            <ArrowUpRight className="w-4 h-4 text-white/25 group-hover:text-[#B668FC] shrink-0 mt-0.5" />
          </Link>
        ))}
      </div>
      <Link
        to="/guide"
        className="sm:hidden mt-4 inline-flex items-center gap-1 text-sm text-[#B668FC]"
      >
        {t.blogTeaser?.viewAll || 'View all posts'}
        <ArrowUpRight className="w-4 h-4" />
      </Link>
    </section>
  );
}
