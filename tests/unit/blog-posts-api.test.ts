import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { parseBloggerPosts } from '../../api/blog-posts.js';

function makeResponse() {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(statusCode: number, headers: Record<string, string>) {
      response.statusCode = statusCode;
      response.headers = headers;
      return response;
    },
    end(body = '') {
      response.body = body;
      return response;
    },
  };
  return response;
}

const validFeed = {
  feed: {
    entry: [
      {
        title: { $t: '  Latest   Seoul Guide  ' },
        published: { $t: '2026-07-15T10:00:00+09:00' },
        link: [{ rel: 'alternate', href: 'https://cocotripkr.blogspot.com/2026/07/latest-seoul-guide.html' }],
      },
      {
        title: { $t: 'K-pop Concert Tips' },
        link: [{ rel: 'alternate', href: 'https://cocotripkr.blogspot.com/2026/07/kpop-concert-tips.html' }],
      },
      {
        title: { $t: 'Halal Food Guide' },
        link: [{ rel: 'alternate', href: 'https://cocotripkr.blogspot.com/2026/07/halal-food-guide.html' }],
      },
    ],
  },
};

describe('blog posts API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes valid Blogger entries and rejects unsafe links', () => {
    const posts = parseBloggerPosts({
      feed: {
        entry: [
          ...validFeed.feed.entry,
          {
            title: { $t: 'Unsafe' },
            link: [{ rel: 'alternate', href: 'https://example.com/2026/07/unsafe.html' }],
          },
        ],
      },
    });

    expect(posts).toHaveLength(3);
    expect(posts[0]).toEqual({
      title: 'Latest Seoul Guide',
      url: 'https://cocotripkr.blogspot.com/2026/07/latest-seoul-guide.html',
      published: '2026-07-15T10:00:00+09:00',
    });
    expect(posts.every((post) => post.url.startsWith('https://cocotripkr.blogspot.com/'))).toBe(true);
  });

  it('returns normalized posts with cache headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(validFeed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const response = makeResponse();

    await handler({ method: 'GET' }, response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Cache-Control']).toContain('s-maxage=3600');
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, posts: expect.any(Array) });
  });

  it('fails closed when the upstream feed is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
    const response = makeResponse();

    await handler({ method: 'GET' }, response);

    expect(response.statusCode).toBe(502);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      posts: [],
      error: 'blog_feed_unavailable',
    });
  });

  it('rejects non-GET requests without contacting Blogger', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = makeResponse();

    await handler({ method: 'POST' }, response);

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
