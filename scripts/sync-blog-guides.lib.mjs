// sync-blog-guides 순수 로직 — 테스트 가능하게 분리 (2026-08-01).
// 파일 IO·fetch 는 sync-blog-guides.mjs(실행부)에만 둔다.

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
    labels: (e.category || []).map((c) => c.term).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    // slug 충돌 판별용 — blogspot slug 는 "그 달 안에서만" 유일하다. 연/월이 다른
    // 동명 slug 가 오면 이 값으로 같은 글인지 다른 글인지 가른다.
    sourceUrl: alt.href,
    html,
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

/**
 * _index.json 은 **로컬 글 JSON 이 원천**이다 (추가 전용 원칙의 두 번째 절반).
 *   - 피드에서 빠진 로컬 글도 목록·색인에 남는다 (피드 기준 재구성 금지).
 *   - blogspot 원문이 요약 스텁으로 교체돼도 목록 설명은 로컬 전문 기준을 유지한다.
 * 정렬 = published 내림차순(같으면 slug) — 색인·sitemap 파생이 결정론적이어야 한다.
 */
export function buildIndexFromLocalMeta(metas) {
  return [...metas]
    .map(({ html, sourceUrl, ...meta }) => meta)
    .sort((a, b) => (a.published === b.published ? a.slug.localeCompare(b.slug) : b.published.localeCompare(a.published)));
}
