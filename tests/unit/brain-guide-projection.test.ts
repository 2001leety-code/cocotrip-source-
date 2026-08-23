import { describe, expect, it } from 'vitest';
// @ts-expect-error — .mjs operational contract module.
import {
  BRAIN_GUIDE_PROJECTION_SCHEMA_VERSION,
  brainGuideHtmlSha256,
  slugifyBrainGuideTitle,
  validateBrainGuideProjection,
} from '../../scripts/brain-guide-projection.lib.mjs';
import { buildArticleJsonLd } from '../../src/lib/jsonLd';

const html = '<p class="post-summary"><em>Rainy-day routes.</em></p><h2>Start indoors</h2><p>Use Line 2.</p>';
const title = 'Seoul Rainy Day Guide 2026';
const slug = 'seoul-rainy-day-guide-2026';
const longTitle = 'A Practical Seoul Neighborhood Guide With Cafes Museums Markets Parks Transit Tips And Rainy Day Options For First Time Visitors 2026';
const longSlug = 'a-practical-seoul-neighborhood-guide-with-cafes-museums-markets-parks-transit-tips-and-rainy-day';

const validManifest = () => ({
  schemaVersion: BRAIN_GUIDE_PROJECTION_SCHEMA_VERSION,
  queueId: 'blog-20260823-seoul-rain',
  slug,
  canonicalUrl: `https://cocotripkr.com/guide/${slug}`,
  contentSha256: brainGuideHtmlSha256(html),
  title,
  description: 'Practical indoor routes for a rainy day in Seoul.',
  published: '2026-08-23',
  labels: ['Indoor Seoul', 'Rainy Day', 'Seoul Travel'],
  html,
  review: { verdict: 'pass', score: 94 },
  approval: { approvedBy: 'discord:12345', approvedAt: '2026-08-23T10:00:00+09:00' },
  qualityRulesVersion: 'brain-content-quality-v1',
});

describe('Brain content_queue → web guide projection contract', () => {
  it('schemaVersion=숫자 1, 결정적 slug, 안전 HTML hash와 승인 provenance가 모두 맞으면 통과', () => {
    expect(slugifyBrainGuideTitle(title)).toBe(slug);
    expect(slugifyBrainGuideTitle(longTitle)).toBe(longSlug);
    expect(longSlug.length).toBe(96);
    const result = validateBrainGuideProjection(validManifest());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('검증된 canonical/hash가 Article JSON-LD @id/identifier와 정확히 이어진다', () => {
    const manifest = validManifest();
    expect(validateBrainGuideProjection(manifest).ok).toBe(true);
    const article = buildArticleJsonLd({
      path: manifest.canonicalUrl,
      title: manifest.title,
      description: manifest.description,
      published: manifest.published,
      contentSha256: manifest.contentSha256,
    });
    expect((article.mainEntityOfPage as Record<string, string>)['@id']).toBe(manifest.canonicalUrl);
    expect(article.identifier).toBe(`urn:sha256:${manifest.contentSha256}`);
  });

  it.each([
    [{ schemaVersion: '1' }, 'schemaVersion'],
    [{ queueId: 'spaces are rejected' }, 'queueId'],
    [{ title: 'Unsafe </script><script>alert(1)</script>' }, 'title'],
    [{ description: 'Unsafe <img src=x onerror=alert(1)>' }, 'description'],
    [{ slug: 'different-slug' }, 'slug'],
    [{ canonicalUrl: 'https://cocotripkr.blogspot.com/x' }, 'canonicalUrl'],
    [{ contentSha256: '0'.repeat(64) }, 'contentSha256'],
    [{ review: { verdict: 'warn', score: 99 } }, 'review'],
    [{ review: { verdict: 'pass', score: 91 } }, 'review'],
    [{ approval: { approvedBy: '', approvedAt: '2026-08-23' } }, 'approval'],
    [{ qualityRulesVersion: '' }, 'qualityRulesVersion'],
    [{ qualityRulesVersion: 'garbage' }, 'qualityRulesVersion'],
  ])('%s 드리프트는 %s 오류로 fail-closed', (override, field) => {
    const result = validateBrainGuideProjection({ ...validManifest(), ...override });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error: { field: string }) => error.field)).toContain(field);
  });

  it('script/handler/data URL이 든 HTML은 hash가 맞아도 거부한다', () => {
    const unsafeHtml = '<p onclick="alert(1)">x</p><script>alert(1)</script><img src="data:text/html,x">';
    const result = validateBrainGuideProjection({
      ...validManifest(),
      html: unsafeHtml,
      contentSha256: brainGuideHtmlSha256(unsafeHtml),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error: { field: string }) => error.field)).toContain('html');
  });

  it('labels는 중복 없이 결정적으로 정렬돼야 한다', () => {
    const result = validateBrainGuideProjection({ ...validManifest(), labels: ['Z', 'A', 'A'] });
    expect(result.ok).toBe(false);
    expect(result.errors.filter((error: { field: string }) => error.field === 'labels').length).toBeGreaterThan(0);
  });

  it('labels의 대소문자 중복·개수·길이 제한을 fail-closed로 막는다', () => {
    const duplicate = validateBrainGuideProjection({ ...validManifest(), labels: ['Seoul', 'seoul'] });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.map((error: { field: string }) => error.field)).toContain('labels');

    const tooMany = validateBrainGuideProjection({
      ...validManifest(),
      labels: Array.from({ length: 11 }, (_, index) => `tag-${String(index).padStart(2, '0')}`),
    });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.errors.map((error: { field: string }) => error.field)).toContain('labels');

    const tooLong = validateBrainGuideProjection({ ...validManifest(), labels: ['A'.repeat(61)] });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors.map((error: { field: string }) => error.field)).toContain('labels');
  });

  it('published는 승인 시각을 서울 시간으로 환산한 날짜와 같아야 한다', () => {
    const result = validateBrainGuideProjection({
      ...validManifest(),
      published: '2026-08-22',
      approval: { approvedBy: 'telegram:12345', approvedAt: '2026-08-23T00:30:00Z' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error: { field: string }) => error.field)).toContain('published');
  });
});
