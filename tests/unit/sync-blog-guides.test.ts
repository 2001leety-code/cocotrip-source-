import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs 스크립트 lib (스크립트 전용, 타입 선언 없음)
import {
  transformHtml, entryToGuide, classifyExisting, buildIndexFromLocalMeta,
  extractLeadImage, countWords, guideContentSha256, classifyGuideCandidates,
  buildPendingReview, isTrustedBloggerSourceUrl,
  classifyPostCutoffBloggerTeaser, extractCanonicalGuideSlugFromTeaser, guideHtmlSha256,
  GUIDE_CANONICAL_BASE as SCRIPT_GUIDE_CANONICAL_BASE,
  LEGACY_GUIDE_LEDGER_SCOPE,
  LEGACY_BLOGGER_CUTOFF_PUBLISHED,
} from '../../scripts/sync-blog-guides.lib.mjs';
import {
  GUIDE_CANONICAL_BASE as WEB_GUIDE_CANONICAL_BASE,
  guideCanonicalUrl,
} from '../../src/lib/seoRoutes';

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

describe('가이드 수입 승인 게이트 — 공개 피드만으로 쓰지 않는다', () => {
  const guide = {
    slug: 'new-guide',
    title: 'A reviewed Korea guide for 2026',
    description: 'Useful details.',
    published: '2026-08-22',
    updated: '2026-08-22',
    labels: ['Korea', 'Travel'],
    sourceUrl: 'https://cocotripkr.blogspot.com/2026/08/new-guide.html',
    html: '<h2>Plan</h2><p>Useful details for a real trip.</p>',
  };
  const hash = guideContentSha256(guide);
  const baseReview = {
    sourceUrl: guide.sourceUrl,
    slug: guide.slug,
    title: guide.title,
    contentSha256: hash,
    decision: 'approved',
    reviewedBy: 'operator',
    reviewedAt: '2026-08-23T10:00:00+09:00',
    quality: { verdict: 'pass', score: 92 },
    reason: '',
  };
  const manifest = (reviews: unknown[]) => ({
    schemaVersion: 1,
    scope: LEGACY_GUIDE_LEDGER_SCOPE,
    latestSourceDate: LEGACY_BLOGGER_CUTOFF_PUBLISHED,
    canonicalBase: SCRIPT_GUIDE_CANONICAL_BASE,
    reviews,
  });

  it('승인 기록이 없으면 pending — 피드 공개 여부는 승인 근거가 아니다', () => {
    const state = classifyGuideCandidates([guide], manifest([]));
    expect(state.pending).toHaveLength(1);
    expect(state.approved).toHaveLength(0);
  });

  it('정확한 본문 지문 + pass + 92점부터 approved', () => {
    const state = classifyGuideCandidates([guide], manifest([baseReview]));
    expect(state.approved).toHaveLength(1);
    expect(state.invalid).toHaveLength(0);
  });

  it('import sanitizer가 원문을 바꿨으면 approved도 명시 수락 전에는 막힌다', () => {
    const sanitizedGuide = { ...guide };
    Object.defineProperty(sanitizedGuide, 'sanitizationChanged', { value: true, enumerable: false });
    const blocked = classifyGuideCandidates([sanitizedGuide], manifest([baseReview]));
    expect(blocked.approved).toHaveLength(0);
    expect(blocked.invalid[0].reason).toMatch(/sanitizedHtmlAccepted/);

    const accepted = classifyGuideCandidates(
      [sanitizedGuide],
      manifest([{ ...baseReview, sanitizedHtmlAccepted: true }]),
    );
    expect(accepted.approved).toHaveLength(1);
  });

  it.each([
    [{ verdict: 'warn', score: 99 }, 'warn verdict'],
    [{ verdict: 'pass', score: 91 }, 'score below 92'],
    [{ verdict: 'pass', score: '95' }, 'non-numeric score'],
  ])('approved 라도 %s 이면 invalid 로 닫힌다 (%s)', (quality) => {
    const state = classifyGuideCandidates([guide], manifest([{ ...baseReview, quality }]));
    expect(state.approved).toHaveLength(0);
    expect(state.invalid).toHaveLength(1);
  });

  it('승인 뒤 본문이 바뀌면 지문 불일치로 재검토가 필요하다', () => {
    const changed = { ...guide, html: `${guide.html}<p>changed</p>` };
    const state = classifyGuideCandidates([changed], manifest([baseReview]));
    expect(state.approved).toHaveLength(0);
    expect(state.invalid[0].reason).toMatch(/does not match current content/);
  });

  it('승인 검토 시각은 시간대가 포함된 ISO 8601이어야 한다', () => {
    const state = classifyGuideCandidates([guide], manifest([{ ...baseReview, reviewedAt: '2026-08-23' }]));
    expect(state.approved).toHaveLength(0);
    expect(state.invalid[0].reason).toMatch(/approved review requires valid reviewedBy\/reviewedAt/);
  });

  it('자동 hold는 검토자로 위장하지 않고 기록 주체·시각을 쓴다', () => {
    const hold = {
      ...baseReview,
      decision: 'hold',
      reviewedBy: undefined,
      reviewedAt: undefined,
      recordedBy: 'migration-safety-audit',
      recordedAt: '2026-08-23T10:00:00+09:00',
      reason: 'legacy backlog needs a new review',
    };
    expect(classifyGuideCandidates([guide], manifest([hold])).held).toHaveLength(1);
    expect(classifyGuideCandidates([guide], manifest([{ ...hold, recordedAt: '2026-08-23' }])).invalid)
      .toHaveLength(1);
  });

  it('사람이 확정하는 rejected는 이유와 실제 검토자 기록이 있어야 한다', () => {
    const rejected = { ...baseReview, decision: 'rejected', reason: 'duplicate topic' };
    expect(classifyGuideCandidates([guide], manifest([rejected])).rejected).toHaveLength(1);
  });

  it('중복 URL의 exact rejected+redirect ledger는 다음 audit에서 재수입하지 않는다', () => {
    const redirected = {
      ...baseReview,
      decision: 'rejected',
      redirectTo: `${SCRIPT_GUIDE_CANONICAL_BASE}/surviving-guide`,
      reason: 'duplicate intent consolidated by permanent redirect',
    };
    const state = classifyGuideCandidates([guide], manifest([redirected]));
    expect(state.rejected).toHaveLength(1);
    expect(state.approved).toHaveLength(0);
    expect(state.pending).toHaveLength(0);
    expect(classifyGuideCandidates(
      [guide],
      manifest([{ ...redirected, redirectTo: `${SCRIPT_GUIDE_CANONICAL_BASE}/${guide.slug}` }]),
    ).invalid[0].reason).toMatch(/different canonical/);
  });

  it('다른 출처·중복 sourceUrl·틀린 canonical 정책은 invalid', () => {
    expect(isTrustedBloggerSourceUrl(guide.sourceUrl)).toBe(true);
    expect(isTrustedBloggerSourceUrl('https://example.com/2026/08/new-guide.html')).toBe(false);
    expect(classifyGuideCandidates([guide], manifest([baseReview, baseReview])).invalid.length).toBeGreaterThan(0);
    expect(classifyGuideCandidates([guide], { ...manifest([baseReview]), canonicalBase: 'https://example.com/guide' }).invalid)
      .toHaveLength(1);
  });

  it('Blogger 장부는 2026-08-22 이관분에만 쓰고 이후 글은 Brain projection으로 보낸다', () => {
    const future = { ...guide, published: '2026-08-23' };
    const futureReview = {
      ...baseReview,
      contentSha256: guideContentSha256(future),
    };
    const state = classifyGuideCandidates([future], manifest([futureReview]));
    expect(state.approved).toHaveLength(0);
    expect(state.invalid[0].reason).toMatch(/Brain projection/);
  });

  it('pending 초안은 자동 승인 값을 만들지 않고 현재 지문만 채운다', () => {
    const pending = buildPendingReview(guide);
    expect(pending.contentSha256).toBe(hash);
    expect(pending.decision).toBe('pending');
    expect(pending.reviewedBy).toBe('');
    expect(pending.quality).toEqual({ verdict: '', score: 0 });
  });

  it('웹·동기화 스크립트의 대표 원문 주소가 같고 slug 로만 확장된다', () => {
    expect(SCRIPT_GUIDE_CANONICAL_BASE).toBe(WEB_GUIDE_CANONICAL_BASE);
    expect(guideCanonicalUrl()).toBe('https://cocotripkr.com/guide');
    expect(guideCanonicalUrl('new-guide')).toBe('https://cocotripkr.com/guide/new-guide');
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

describe('cutoff 이후 Blogger는 web-first guide의 짧은 teaser만 허용', () => {
  const slug = 'seoul-rainy-day-guide-2026-indoor-plans-that-dont-feel-like-backups';
  const bloggerSlug = 'seoul-rainy-day-guide-2026-indoor-plans';
  const localHtml = '<p class="post-summary"><em>Canonical body.</em></p><h2>Plan</h2><p>Full guide.</p>';
  const local = {
    slug,
    title: "Seoul Rainy Day Guide 2026: Indoor Plans That Don't Feel Like Backups",
    html: localHtml,
    contentSha256: guideHtmlSha256(localHtml),
    projection: { queueIdSha256: 'a'.repeat(64) },
  };
  const teaser = {
    slug: bloggerSlug,
    title: local.title,
    published: '2026-08-24',
    sourceUrl: `https://cocotripkr.blogspot.com/2026/08/${bloggerSlug}.html`,
    html: `<p class="post-summary"><em>Rain in Seoul can still make a strong travel day. See the indoor route, transit order, neighborhood timing, and practical backup choices.</em></p><p><a href="https://cocotripkr.com/guide/${slug}">Read the full guide on CocoTrip</a>.</p>`,
  };

  it('Blogger 자체 절단 slug가 달라도 canonical href로 local Brain guide를 찾아 정상 처리한다', () => {
    expect(extractCanonicalGuideSlugFromTeaser(teaser.html)).toEqual({ ok: true, slug, reason: '' });
    expect(classifyPostCutoffBloggerTeaser(teaser, local)).toEqual({ ok: true, reason: '' });
  });

  it.each([
    [{ ...teaser, html: `<p>This is a full post with enough words to reach the structure gate safely.</p><h2>Full section</h2><p>More body words here now.</p><p><a href="/guide/${slug}">Read</a></p>` }, /long-form/],
    [{ ...teaser, html: '<p>This teaser has enough useful words but sends travelers to a different destination instead of the canonical full guide page.</p><p><a href="/planner">Continue here</a></p>' }, /canonical|exact/],
    [{ ...teaser, title: 'Different Blogger-first title' }, /title differs/],
  ])('전문 구조·다른 링크·제목 드리프트는 실패', (candidate, reason) => {
    expect(classifyPostCutoffBloggerTeaser(candidate, local)).toEqual({
      ok: false,
      reason: expect.stringMatching(reason),
    });
  });

  it('정제 변경이나 local content hash 드리프트가 있으면 실패', () => {
    const sanitized = { ...teaser };
    Object.defineProperty(sanitized, 'sanitizationChanged', { value: true });
    expect(classifyPostCutoffBloggerTeaser(sanitized, local).ok).toBe(false);
    expect(classifyPostCutoffBloggerTeaser(teaser, { ...local, contentSha256: 'b'.repeat(64) }).ok).toBe(false);
  });

  it('canonical 링크가 없거나 복수·다른 local 대상이면 fail-closed', () => {
    expect(classifyPostCutoffBloggerTeaser({ ...teaser, html: '<p>There is no canonical guide link in this teaser even though it has enough words to look valid.</p>' }, local).ok)
      .toBe(false);
    expect(classifyPostCutoffBloggerTeaser({ ...teaser, html: `${teaser.html}<a href="/guide/other-guide">Other</a>` }, local).ok)
      .toBe(false);
    expect(classifyPostCutoffBloggerTeaser(teaser, { ...local, slug: 'other-guide' }).ok)
      .toBe(false);
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

  it('Brain 내부 provenance도 공개 목록 JSON으로 새지 않는다', () => {
    const idx = buildIndexFromLocalMeta([{
      ...metas[0],
      queueId: 'queue-private-link',
      review: { verdict: 'pass', score: 99 },
      approval: { approvedBy: 'operator', approvedAt: '2026-08-23T10:00:00+09:00' },
      qualityRulesVersion: 'v2',
      contentSha256: 'a'.repeat(64),
    }]);
    expect(idx[0]).not.toHaveProperty('queueId');
    expect(idx[0]).not.toHaveProperty('review');
    expect(idx[0]).not.toHaveProperty('approval');
    expect(idx[0]).not.toHaveProperty('qualityRulesVersion');
    expect(idx[0]).not.toHaveProperty('contentSha256');
  });
});

/**
 * 목록 화면(/guide)이 대표 사진과 읽는 시간을 보여주려면 그 두 값이 목록에 있어야 한다.
 * 글 본문 JSON 은 글별 lazy 청크라 목록에서 전체를 다 열 수 없다 — 열면 청크 분리가 무의미해진다.
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
