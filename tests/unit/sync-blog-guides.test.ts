import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs 스크립트 lib (스크립트 전용, 타입 선언 없음)
import {
  transformHtml, entryToGuide, classifyExisting, buildIndexFromLocalMeta,
  extractLeadImage, countWords,
} from '../../scripts/sync-blog-guides.lib.mjs';

/**
 * sync-blog-guides 결함 3종 회귀 잠금 (2026-08-01 감사).
 *   ① _index 가 피드 기준 재구성이라 피드 탈락 글이 색인에서 증발
 *   ② slug 충돌(연/월 다른 동명) 신규 글이 "이미 있음"으로 조용히 스킵
 *   ③ 링크 변환: utm 만 제거·기능 쿼리 보존·작은따옴표 href (기존 함정 재확인)
 */

describe('transformHtml', () => {
  it('자기 도메인 절대링크 → 상대 + utm_* 만 제거, 기능 쿼리 보존', () => {
    const html = '<a href="https://cocotripkr.com/planner?utm_source=blogger&dietary=halal&city=seoul">go</a>';
    expect(transformHtml(html)).toBe('<a href="/planner?dietary=halal&city=seoul">go</a>');
  });

  it("작은따옴표 href 변형도 처리한다", () => {
    expect(transformHtml("<a href='https://cocotripkr.com/planner'>x</a>")).toBe("<a href='/planner'>x</a>");
  });

  it('blogspot 글 링크 → /guide/<slug>, blogspot 홈 → /guide', () => {
    const html =
      '<a href="https://cocotripkr.blogspot.com/2026/07/some-post.html">p</a><a href="https://cocotripkr.blogspot.com/">h</a>';
    expect(transformHtml(html)).toBe('<a href="/guide/some-post">p</a><a href="/guide">h</a>');
  });
});

describe('entryToGuide', () => {
  const entry = {
    title: { $t: 'T' },
    published: { $t: '2026-08-01T00:00:00+09:00' },
    updated: { $t: '2026-08-02T00:00:00+09:00' },
    category: [{ term: 'b' }, { term: 'A' }],
    content: { $t: '<p class="post-summary"><em>Sum</em></p><p>body</p>' },
    link: [{ rel: 'alternate', href: 'https://cocotripkr.blogspot.com/2026/08/my-post.html' }],
  };

  it('slug·sourceUrl 을 함께 기록한다 (충돌 판별의 근거)', () => {
    const g = entryToGuide(entry);
    expect(g.slug).toBe('my-post');
    expect(g.sourceUrl).toBe('https://cocotripkr.blogspot.com/2026/08/my-post.html');
    expect(g.published).toBe('2026-08-01');
    expect(g.labels).toEqual(['A', 'b']);
  });
});

describe('classifyExisting — slug 충돌 판정', () => {
  const feedUrl = 'https://cocotripkr.blogspot.com/2027/03/seoul-cafe.html';
  it('sourceUrl 동일 = 같은 글(정상 스킵)', () => {
    expect(classifyExisting(feedUrl, feedUrl)).toBe('same');
  });
  it('sourceUrl 다름 = 다른 글이 같은 slug — 조용한 스킵 금지 대상', () => {
    expect(classifyExisting('https://cocotripkr.blogspot.com/2026/07/seoul-cafe.html', feedUrl)).toBe('collision');
  });
  it('로컬에 sourceUrl 없음 = 판별 불가', () => {
    expect(classifyExisting(undefined, feedUrl)).toBe('unknown');
  });
});

describe('buildIndexFromLocalMeta — 로컬이 원천', () => {
  const metas = [
    { slug: 'old-local-only', title: 'L', description: 'd', published: '2026-06-01', updated: '2026-06-01', labels: [], sourceUrl: 'u1', html: '<p>x</p>' },
    { slug: 'newer', title: 'N', description: 'd', published: '2026-08-01', updated: '2026-08-01', labels: [], sourceUrl: 'u2', html: '<p>y</p>' },
  ];

  it('피드에 없는 로컬 글도 목록에 남는다 (증발 금지)', () => {
    const idx = buildIndexFromLocalMeta(metas);
    expect(idx.map((m: { slug: string }) => m.slug)).toContain('old-local-only');
  });

  it('html·sourceUrl 은 목록에서 제거, published 내림차순 정렬', () => {
    const idx = buildIndexFromLocalMeta(metas);
    expect(idx[0].slug).toBe('newer');
    expect(idx[0]).not.toHaveProperty('html');
    expect(idx[0]).not.toHaveProperty('sourceUrl');
  });
});

/**
 * 목록 화면(/guide)이 대표 사진과 읽는 시간을 보여주려면 그 두 값이 목록에 있어야 한다.
 * 글 본문 JSON 은 글별 lazy 청크라 목록에서 21개를 다 열 수 없다 — 열면 청크 분리가 무의미해진다.
 * 그래서 **본문에서 계산해** _index.json 에 굳힌다. 사람이 적는 값이 아니다:
 * 다음 동기화 때도 같은 계산이 다시 돌고, editorial-guide-content.test.ts 가 실제 본문과 대조한다.
 */
describe('_index 파생 필드 — 본문에서만 나온다', () => {
  it('extractLeadImage: 첫 <img src> 를 그대로', () => {
    expect(extractLeadImage('<p>a</p><img src="https://x/1.webp" alt="a"><img src="/2.webp">'))
      .toBe('https://x/1.webp');
  });

  it('이미지가 없으면 undefined — 빈 문자열도 플레이스홀더도 아니다', () => {
    expect(extractLeadImage('<p>no pictures here</p>')).toBeUndefined();
  });

  it('countWords: 태그와 엔티티를 걷어낸 낱말 수', () => {
    expect(countWords('<p>one two three</p>')).toBe(3);
    expect(countWords('<h2>a&nbsp;b</h2><p>c   d</p>')).toBe(4);
    expect(countWords('   ')).toBe(0);
  });

  it('buildIndexFromLocalMeta 가 image·words 를 본문에서 파생해 붙인다', () => {
    const idx = buildIndexFromLocalMeta([
      { slug: 's', title: 'T', description: 'd', published: '2026-08-01', updated: '2026-08-02', labels: [], sourceUrl: 'u', html: '<img src="/lead.webp"><p>one two three four</p>' },
    ]);
    expect(idx[0].image).toBe('/lead.webp');
    expect(idx[0].words).toBe(4);
  });

  it('이미지 없는 글에는 image 키를 만들지 않는다 (JSON 에 null 이 새지 않게)', () => {
    const idx = buildIndexFromLocalMeta([
      { slug: 's', title: 'T', description: 'd', published: '2026-08-01', updated: '2026-08-02', labels: [], sourceUrl: 'u', html: '<p>text only</p>' },
    ]);
    expect(Object.prototype.hasOwnProperty.call(idx[0], 'image')).toBe(false);
    expect(JSON.stringify(idx[0])).not.toContain('null');
  });
});
