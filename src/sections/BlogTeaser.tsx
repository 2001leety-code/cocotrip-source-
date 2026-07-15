import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import type { Translations } from '@/i18n';

const BLOG_URL = 'https://cocotripkr.blogspot.com';

interface BlogPost {
  title: string;
  url: string;
}

// Keep a complete fallback so the section is useful even if Blogger is slow or unavailable.
const FALLBACK_POSTS: BlogPost[] = [
  { title: 'Seoul Cafe Guide 2026: Best Neighborhoods & What to Know', url: `${BLOG_URL}/2026/07/seoul-cafe-guide-2026-best.html` },
  { title: '4 Seoul Cafe Neighborhoods Worth Your Time in 2026', url: `${BLOG_URL}/2026/07/4-seoul-cafe-neighborhoods-worth-your.html` },
  { title: 'How to Ace Your First K-Pop Concert in Korea (2026 Guide)', url: `${BLOG_URL}/2026/07/how-to-ace-your-first-k-pop-concert-in.html` },
];

function isBlogPost(value: unknown): value is BlogPost {
  if (!value || typeof value !== 'object') return false;
  const post = value as Partial<BlogPost>;
  return typeof post.title === 'string'
    && post.title.trim().length > 0
    && typeof post.url === 'string'
    && post.url.startsWith(`${BLOG_URL}/`);
}

interface BlogTeaserProps {
  t: Translations;
}

export function BlogTeaser({ t }: BlogTeaserProps) {
  const [posts, setPosts] = useState<BlogPost[]>(FALLBACK_POSTS);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/blog-posts', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Blog feed unavailable');
        return response.json();
      })
      .then((payload: unknown) => {
        const candidates = (payload as { posts?: unknown })?.posts;
        if (!Array.isArray(candidates)) return;

        const latestPosts = candidates.filter(isBlogPost).slice(0, 3);
        // Preserve all three fallback cards if the upstream response is incomplete.
        if (latestPosts.length === 3) setPosts(latestPosts);
      })
      .catch(() => {
        // The static fallback is intentionally silent and always remains clickable.
      });

    return () => controller.abort();
  }, []);

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
        {posts.map((post) => (
          <a
            key={post.url}
            href={post.url}
            target="_blank"
            rel="noopener"
            className="group flex items-start justify-between gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 hover:border-[#B668FC]/40 hover:bg-white/[0.05] transition-colors"
          >
            <span className="text-sm text-white/80 group-hover:text-white leading-snug">{post.title}</span>
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
