const BLOG_HOST = 'cocotripkr.blogspot.com';
const BLOG_FEED_URL = `https://${BLOG_HOST}/feeds/posts/default?alt=json&max-results=3&orderby=published`;

const PUBLIC_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
};

function normalizeTitle(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function parseBloggerPosts(payload) {
  const entries = Array.isArray(payload?.feed?.entry) ? payload.feed.entry : [];
  const posts = [];
  const seen = new Set();

  for (const entry of entries) {
    const title = normalizeTitle(entry?.title?.$t);
    const alternate = Array.isArray(entry?.link)
      ? entry.link.find((link) => link?.rel === 'alternate' && typeof link?.href === 'string')
      : null;

    if (!title || !alternate?.href) continue;

    try {
      const url = new URL(alternate.href);
      const isBlogPost = url.protocol === 'https:'
        && url.hostname === BLOG_HOST
        && /^\/\d{4}\/\d{2}\/[^/]+\.html$/.test(url.pathname);

      if (!isBlogPost || seen.has(url.href)) continue;

      seen.add(url.href);
      posts.push({
        title,
        url: url.href,
        published: typeof entry?.published?.$t === 'string' ? entry.published.$t : null,
      });
    } catch {
      // Skip malformed or non-Blogger URLs from the upstream payload.
    }

    if (posts.length === 3) break;
  }

  return posts;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { ...PUBLIC_HEADERS, Allow: 'GET' });
    return res.end(JSON.stringify({ ok: false, error: 'GET only' }));
  }

  try {
    const response = await fetch(BLOG_FEED_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`Blogger feed returned ${response.status}`);

    const posts = parseBloggerPosts(await response.json());
    if (posts.length === 0) throw new Error('Blogger feed did not contain valid posts');

    res.writeHead(200, PUBLIC_HEADERS);
    return res.end(JSON.stringify({ ok: true, posts }));
  } catch {
    res.writeHead(502, {
      ...PUBLIC_HEADERS,
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ ok: false, posts: [], error: 'blog_feed_unavailable' }));
  }
}
