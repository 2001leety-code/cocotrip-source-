// sync-blog-guides 순수 로직 — 테스트 가능하게 분리 (2026-08-01).
// 파일 IO·fetch 는 sync-blog-guides.mjs(실행부)에만 둔다.

import { createHash } from 'node:crypto';

export const GUIDE_IMPORT_SCHEMA_VERSION = 1;
export const GUIDE_CANONICAL_BASE = 'https://cocotripkr.com/guide';
export const BLOGGER_SOURCE_ORIGIN = 'https://cocotripkr.blogspot.com';
export const LEGACY_GUIDE_LEDGER_SCOPE = 'legacy-blogger-migration-only';
export const LEGACY_BLOGGER_CUTOFF_PUBLISHED = '2026-08-22';

function compareText(a, b) {
  const left = String(a);
  const right = String(b);
  const leftFolded = left.toLowerCase();
  const rightFolded = right.toLowerCase();
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export const decodeEntities = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// 자기 도메인 절대링크 → 상대경로. utm_* 만 제거, 기능 쿼리(dietary= 등)는 보존.
// href='...' 작은따옴표 변형도 반드시 처리.
// blogspot 글 링크 → /guide/<slug>, blogspot 홈 → /guide (중복 사이트로 유출 방지).
export function transformHtml(html) {
  return html
    .replace(
      /(href=)(["'])https?:\/\/(?:www\.)?cocotripkr\.com(\/[^"'?#]*)?(?:\?([^"'#]*))?(#[^"']*)?\2/g,
      (_, pre, q, p, query, hash) => {
        const kept = (query || '')
          .split('&')
          .filter((kv) => kv && !/^(amp;)?utm_/.test(kv))
          .join('&');
        return `${pre}${q}${p || '/'}${kept ? `?${kept}` : ''}${hash || ''}${q}`;
      },
    )
    .replace(
      /(href=)(["'])https?:\/\/cocotripkr\.blogspot\.com\/\d{4}\/\d{2}\/([a-z0-9-]+)\.html(?:[?#][^"']*)?\2/g,
      (_, pre, q, slug) => `${pre}${q}/guide/${slug}${q}`,
    )
    .replace(/(href=)(["'])https?:\/\/cocotripkr\.blogspot\.com\/?\2/g, (_, pre, q) => `${pre}${q}/guide${q}`);
}

export function extractDescription(html) {
  const m = html.match(/<p class="post-summary"><em>([\s\S]*?)<\/em>/);
  if (m) return decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim();
  const text = decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text.length > 155 ? `${text.slice(0, 155).trim()}…` : text;
}

export function entryToGuide(e) {
  const alt = (e.link || []).find((l) => l.rel === 'alternate');
  if (!alt) return null;
  const slug = alt.href.split('/').pop().replace(/\.html$/, '');
  const html = transformHtml(e.content.$t);
  return {
    slug,
    title: e.title.$t,
    description: extractDescription(html),
    published: e.published.$t.slice(0, 10),
    updated: e.updated.$t.slice(0, 10),
    labels: (e.category || []).map((c) => c.term).sort(compareText),
    // slug 충돌 판별용 — blogspot slug 는 "그 달 안에서만" 유일하다. 연/월이 다른
    // 동명 slug 가 오면 이 값으로 같은 글인지 다른 글인지 가른다.
    sourceUrl: alt.href,
    html,
  };
}

/** 공개 피드 안의 alternate 링크도 우리 Blogger 원천만 허용한다. */
export function isTrustedBloggerSourceUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return url.origin === BLOGGER_SOURCE_ORIGIN
      && /^\/\d{4}\/\d{2}\/[a-z0-9-]+\.html$/.test(url.pathname)
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

/**
 * 승인 뒤 피드 본문이 바뀌면 같은 승인을 재사용하지 못하게 하는 콘텐츠 지문.
 * 필드 순서를 여기서 고정한다. JSON 객체 전체를 바로 hash 하면 키 순서 변화만으로
 * 승인 기록이 무효가 될 수 있다.
 */
export function guideContentSha256(guide) {
  const canonical = {
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    published: guide.published,
    updated: guide.updated,
    labels: [...guide.labels].sort(compareText),
    sourceUrl: guide.sourceUrl,
    html: guide.html,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function guideHtmlSha256(html) {
  return createHash('sha256').update(String(html || ''), 'utf8').digest('hex');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validReviewedAt(value) {
  return nonEmpty(value)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function exactReviewMatch(review, guide, hash) {
  return review.sourceUrl === guide.sourceUrl
    && review.slug === guide.slug
    && review.title === guide.title
    && review.contentSha256 === hash;
}

/**
 * 새 글 후보를 승인 manifest 와 대조한다.
 *
 * approved: 정확히 같은 본문 + pass + 92점 이상일 때만 쓰기 가능
 * rejected: 검토 완료, 가져오지 않음
 * hold: 현재 가져오지 않되 다음 후보를 막지 않는 격리 상태
 * pending/invalid: 하나라도 있으면 전체 쓰기 금지
 */
export function classifyGuideCandidates(candidates, manifest) {
  const result = {
    approved: [],
    rejected: [],
    held: [],
    pending: [],
    invalid: [],
  };

  if (!manifest || manifest.schemaVersion !== GUIDE_IMPORT_SCHEMA_VERSION) {
    result.invalid.push({ reason: `manifest schemaVersion must be ${GUIDE_IMPORT_SCHEMA_VERSION}` });
    return result;
  }
  if (manifest.canonicalBase !== GUIDE_CANONICAL_BASE) {
    result.invalid.push({ reason: `manifest canonicalBase must be ${GUIDE_CANONICAL_BASE}` });
    return result;
  }
  if (manifest.scope !== LEGACY_GUIDE_LEDGER_SCOPE) {
    result.invalid.push({ reason: `manifest scope must be ${LEGACY_GUIDE_LEDGER_SCOPE}` });
    return result;
  }
  if (manifest.latestSourceDate !== LEGACY_BLOGGER_CUTOFF_PUBLISHED) {
    result.invalid.push({ reason: `manifest latestSourceDate must remain ${LEGACY_BLOGGER_CUTOFF_PUBLISHED}` });
    return result;
  }
  if (!Array.isArray(manifest.reviews)) {
    result.invalid.push({ reason: 'manifest reviews must be an array' });
    return result;
  }

  const bySource = new Map();
  for (const review of manifest.reviews) {
    if (!review || !nonEmpty(review.sourceUrl)) {
      result.invalid.push({ review, reason: 'review sourceUrl is required' });
      continue;
    }
    if (bySource.has(review.sourceUrl)) {
      result.invalid.push({ review, reason: `duplicate review sourceUrl: ${review.sourceUrl}` });
      continue;
    }
    bySource.set(review.sourceUrl, review);
  }

  for (const guide of candidates) {
    const hash = guideContentSha256(guide);
    const review = bySource.get(guide.sourceUrl);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(guide.published)
      || guide.published > LEGACY_BLOGGER_CUTOFF_PUBLISHED) {
      result.invalid.push({
        guide,
        review,
        contentSha256: hash,
        reason: 'outside legacy Blogger cutoff; use the Brain projection contract',
      });
      continue;
    }
    if (!review) {
      result.pending.push({ guide, contentSha256: hash, reason: 'review missing' });
      continue;
    }
    if (!isTrustedBloggerSourceUrl(guide.sourceUrl)) {
      result.invalid.push({ guide, review, contentSha256: hash, reason: 'untrusted sourceUrl' });
      continue;
    }
    if (!nonEmpty(guide.html)) {
      result.invalid.push({ guide, review, contentSha256: hash, reason: 'sanitized HTML is empty' });
      continue;
    }
    if (!exactReviewMatch(review, guide, hash)) {
      result.invalid.push({ guide, review, contentSha256: hash, reason: 'review does not match current content' });
      continue;
    }
    if (review.decision === 'approved') {
      if (!nonEmpty(review.reviewedBy) || !validReviewedAt(review.reviewedAt)) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'approved review requires valid reviewedBy/reviewedAt' });
        continue;
      }
      const score = review.quality && review.quality.score;
      const verdict = review.quality && review.quality.verdict;
      if (verdict !== 'pass' || typeof score !== 'number' || !Number.isFinite(score) || score < 92) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'approved review requires quality pass and score >= 92' });
        continue;
      }
      if (guide.sanitizationChanged && review.sanitizedHtmlAccepted !== true) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'approved sanitized HTML requires sanitizedHtmlAccepted=true' });
        continue;
      }
      result.approved.push({ guide, review, contentSha256: hash });
      continue;
    }

    if (review.decision === 'rejected') {
      if (!nonEmpty(review.reviewedBy) || !validReviewedAt(review.reviewedAt)) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'rejected review requires valid reviewedBy/reviewedAt' });
        continue;
      }
      if (!nonEmpty(review.reason)) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'rejected review requires reason' });
        continue;
      }
      if (review.redirectTo !== undefined
        && (!new RegExp(`^${GUIDE_CANONICAL_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\/[a-z0-9]+(?:-[a-z0-9]+)*$`).test(review.redirectTo)
          || review.redirectTo === `${GUIDE_CANONICAL_BASE}/${guide.slug}`)) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'rejected redirectTo must be a different canonical /guide/<slug> URL' });
        continue;
      }
      result.rejected.push({ guide, review, contentSha256: hash });
      continue;
    }

    if (review.decision === 'hold') {
      if (!nonEmpty(review.recordedBy) || !validReviewedAt(review.recordedAt)) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'hold requires valid recordedBy/recordedAt' });
        continue;
      }
      if (!nonEmpty(review.reason)) {
        result.invalid.push({ guide, review, contentSha256: hash, reason: 'hold requires reason' });
        continue;
      }
      result.held.push({ guide, review, contentSha256: hash });
      continue;
    }

    result.invalid.push({ guide, review, contentSha256: hash, reason: 'decision must be approved, rejected, or hold' });
  }

  return result;
}

/** 검토자가 그대로 복사해 판단을 채울 수 있는 pending 초안. 자동 승인 값은 넣지 않는다. */
export function buildPendingReview(guide) {
  return {
    sourceUrl: guide.sourceUrl,
    slug: guide.slug,
    title: guide.title,
    contentSha256: guideContentSha256(guide),
    decision: 'pending',
    reviewedBy: '',
    reviewedAt: '',
    quality: { verdict: '', score: 0 },
    reason: '',
  };
}

/**
 * slug 충돌 판정. 로컬에 같은 slug 가 있을 때:
 *   - sourceUrl 이 같으면 → 같은 글(이미 동기화됨) = 정상 스킵
 *   - sourceUrl 이 다르면 → **다른 글이 같은 slug** = 조용히 스킵하면 새 글이 증발하므로 에러
 *   - 로컬에 sourceUrl 기록이 없으면(구버전 파일) 판별 불가 → 에러(수동 확인 요구)
 */
export function classifyExisting(storedSourceUrl, feedSourceUrl) {
  if (!storedSourceUrl) return 'unknown';
  return storedSourceUrl === feedSourceUrl ? 'same' : 'collision';
}

/** Blogger URL slug는 긴 제목에서 자체 절단되므로 teaser의 단일 canonical 링크만 정본 식별자로 쓴다. */
export function extractCanonicalGuideSlugFromTeaser(html) {
  const hrefs = [...String(html || '').matchAll(/\bhref=(['"])(.*?)\1/gi)].map((match) => match[2]);
  if (hrefs.length !== 1) {
    return { ok: false, slug: '', reason: 'teaser must contain exactly one canonical guide link' };
  }
  const match = /^(?:https:\/\/cocotripkr\.com)?\/guide\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(hrefs[0]);
  if (!match) {
    return { ok: false, slug: '', reason: 'teaser link must be an exact cocotripkr.com /guide/<slug> canonical URL' };
  }
  return { ok: true, slug: match[1], reason: '' };
}

/** Web-first Blogger 글은 전문 원천이 아니라 검증된 local Brain guide의 짧은 안내문이어야 한다. */
export function classifyPostCutoffBloggerTeaser(guide, localDoc) {
  const fail = (reason) => ({ ok: false, reason });
  if (!guide) return fail('teaser entry is missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(guide.published || ''))
    || guide.published <= LEGACY_BLOGGER_CUTOFF_PUBLISHED) {
    return fail('entry is not after the legacy cutoff');
  }
  if (!isTrustedBloggerSourceUrl(guide.sourceUrl)) return fail('untrusted Blogger sourceUrl');
  const canonical = extractCanonicalGuideSlugFromTeaser(guide.html);
  if (!canonical.ok) return fail(canonical.reason);
  if (!localDoc || canonical.slug !== localDoc.slug) {
    return fail(`canonical guide ${canonical.slug} has no matching local Brain projection`);
  }
  if (guide.title !== localDoc.title) return fail('teaser title differs from canonical guide');
  if (!localDoc.projection
    || !/^[a-f0-9]{64}$/.test(String(localDoc.projection.queueIdSha256 || ''))
    || !/^[a-f0-9]{64}$/.test(String(localDoc.contentSha256 || ''))
    || localDoc.contentSha256 !== guideHtmlSha256(localDoc.html)) {
    return fail('local guide is not a verified Brain projection');
  }
  if (guide.sanitizationChanged) return fail('teaser contained markup rejected by the shared sanitizer');

  const words = countWords(guide.html);
  if (words < 10 || words > 120) return fail('teaser must be 10-120 words');
  if (/<(?:h[2-4]|ul|ol|table|blockquote|pre)\b/i.test(guide.html)) {
    return fail('teaser contains long-form article structure');
  }

  return { ok: true, reason: '' };
}

/** 대표 사진 = 본문의 첫 <img src>. 없으면 undefined — 빈 문자열도 대체 이미지도 만들지 않는다. */
export function extractLeadImage(html) {
  return /<img[^>]+src="([^"]+)"/.exec(html)?.[1];
}

/** 낱말 수(본문은 영어 채널). 태그·엔티티를 걷어낸 뒤 공백으로 자른다. */
export function countWords(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * _index.json 은 **로컬 글 JSON 이 원천**이다 (추가 전용 원칙의 두 번째 절반).
 *   - 피드에서 빠진 로컬 글도 목록·색인에 남는다 (피드 기준 재구성 금지).
 *   - blogspot 원문이 요약 스텁으로 교체돼도 목록 설명은 로컬 전문 기준을 유지한다.
 * 정렬 = published 내림차순(같으면 slug) — 색인·sitemap 파생이 결정론적이어야 한다.
 *
 * image·words 는 여기서 **본문에서 계산해** 굳힌다 (2026-08-11). 목록 화면이 대표 사진과
 * 읽는 시간을 보이려면 그 두 값이 목록에 있어야 하는데, 글 본문 JSON 은 글별 lazy 청크라
 * 목록에서 전체 글을 다 여는 것은 청크 분리를 무의미하게 만든다. 사람이 적는 값이 아니다 —
 * 동기화 때마다 다시 계산되고, tests/unit/editorial-guide-content.test.ts 가 실제 본문과 대조한다.
 */
export function buildIndexFromLocalMeta(metas) {
  return [...metas]
    .map((doc) => {
      const {
        slug, title, description, published, updated, labels, html,
      } = doc;
      const image = extractLeadImage(html);
      const words = countWords(html);
      // 목록 JSON은 공개 화면용 필드만 허용한다. Brain queueId·검토·승인 provenance와
      // legacy sourceUrl은 상세 문서/감사 원천에 남기고 목록 번들로 퍼뜨리지 않는다.
      const meta = { slug, title, description, published, updated, labels };
      // 사진이 없으면 키 자체를 만들지 않는다 — JSON 에 null 이 새면 화면이
      // "사진이 있다"고 믿고 빈 프레임을 그린다.
      return image ? { ...meta, image, words } : { ...meta, words };
    })
    .sort((a, b) => (a.published === b.published ? a.slug.localeCompare(b.slug) : b.published.localeCompare(a.published)));
}
