/**
 * 프리렌더 준비 판정 — 시계가 아니라 **화면 내용**으로 (2026-08-23).
 *
 * 🔴 이전에는 `src/main.tsx` 가 `setTimeout(signal, 2500)` 하나로 캡처 시점을 정했다.
 *    2.5초는 "다 됐다" 의 증거가 아니라 짐작이다. 청크가 늦거나 실패하면 프리렌더러는
 *    **빈 껍데기를 정적 HTML 로 구워 배포**한다 — 그리고 그건 조용하다. 색인이 안 되는
 *    것보다 나쁘다: 크롤러가 와서 얇은 페이지를 보고 갔다는 기록만 남는다.
 *
 * 그래서 판정을 내용으로 바꾼다. 이 모듈은 살아 있는 `document` 든 JSDOM 이 만든
 * `document` 든 똑같이 받는다 — 브라우저(캡처 신호), Node(빌드 후 산출물 감사),
 * 테스트가 **같은 규칙 한 벌**을 쓴다. `guideHtmlPolicy.mjs` 가 쓰는 그 방식이다.
 *
 * `.mjs` 인 이유: `scripts/audit-prerender-artifacts.mjs` 가 TS 를 못 읽는다.
 * `tsconfig.app.json` 의 `allowJs: true` 로 TS 쪽에서도 그대로 import 된다.
 */

/** `src/lib/seoRoutes.ts` 의 SITE_ORIGIN 과 같은 값. 어긋나면 잠금 테스트가 잡는다. */
export const SITE_ORIGIN = 'https://cocotripkr.com';

/**
 * 본문이 "있다" 고 부를 최소 길이(공백 정규화 후 글자 수).
 *
 * 근거: 색인 거부되던 `/planner` 가 크롤러 기준 939자, 색인된 `/charter` 가 4,980자였다
 * (RegionSeoInfo.tsx 의 실측 주석). 여기서 막으려는 것은 "얇다" 가 아니라 **비었다** 이므로
 * 문턱은 낮게 잡는다 — 로딩 스켈레톤·404 화면은 이 아래로 떨어진다.
 */
export const MIN_MAIN_TEXT_CHARS = 400;

/** 끝 슬래시·쿼리·해시 차이로 판정이 갈리지 않게. 빈 값은 '/'. */
export function normalizePath(pathname) {
  const raw = String(pathname || '/');
  const clean = raw.split('?')[0].split('#')[0];
  if (!clean) return '/';
  if (clean.length > 1 && clean.endsWith('/')) return clean.replace(/\/+$/, '') || '/';
  return clean;
}

/** 그 경로의 유일하게 옳은 canonical. */
export function expectedCanonical(pathname) {
  const p = normalizePath(pathname);
  return p === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${p}`;
}

/** 가이드 **상세**인가. 목록(`/guide`)은 본문·Article 스키마를 갖지 않는다. */
export function isGuideDetailPath(pathname) {
  const p = normalizePath(pathname);
  return p.startsWith('/guide/') && p.length > '/guide/'.length;
}

/** canonical 은 끝 슬래시만 다른 것도 같은 주소로 본다. */
function sameUrl(a, b) {
  const strip = (v) => String(v || '').trim().replace(/\/+$/, '');
  return strip(a) === strip(b);
}

function collapse(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** `<script type="application/ld+json">` 를 전부 파싱해 배열로. 깨진 것은 버린다. */
export function readJsonLd(doc) {
  const nodes = doc.querySelectorAll('script[type="application/ld+json"]');
  const out = [];
  for (const node of Array.from(nodes)) {
    try {
      const parsed = JSON.parse(node.textContent || '');
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch {
      out.push({ __invalid: true });
    }
  }
  return out;
}

/**
 * 이 문서가 색인 대상으로 내보내도 되는 상태인가.
 *
 * 실패는 배열로 모아서 돌려준다 — 첫 번째에서 멈추면 감사 로그가 한 번에 하나씩만
 * 보여줘 고치는 데 여러 번 빌드해야 한다.
 *
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function checkPrerenderReady(doc, pathname) {
  const reasons = [];
  if (!doc || typeof doc.querySelector !== 'function') {
    return { ok: false, reasons: ['no document'] };
  }

  // 1) 본문이 실제로 있다.
  const main = doc.querySelector('main');
  if (!main) {
    reasons.push('no <main> element');
  } else {
    const text = collapse(main.textContent);
    if (text.length < MIN_MAIN_TEXT_CHARS) {
      reasons.push(`main text too short (${text.length} < ${MIN_MAIN_TEXT_CHARS})`);
    }
  }

  // 2) canonical 이 정확히 하나이고, 자기 자신을 가리킨다.
  const canonicals = Array.from(doc.querySelectorAll('link[rel="canonical"]'));
  if (canonicals.length !== 1) {
    reasons.push(`expected exactly 1 canonical, found ${canonicals.length}`);
  } else {
    const href = canonicals[0].getAttribute('href');
    const want = expectedCanonical(pathname);
    if (!sameUrl(href, want)) reasons.push(`canonical ${href || '(empty)'} != ${want}`);
  }

  // 3) robots 가 index/follow 다. noindex 를 구워 배포하는 것이 가장 조용한 사고다.
  const robots = doc.querySelector('meta[name="robots"]');
  const robotsContent = collapse(robots?.getAttribute('content')).toLowerCase();
  if (!robots) reasons.push('no robots meta');
  else if (/noindex|nofollow|none/.test(robotsContent)) reasons.push(`robots is "${robotsContent}"`);
  else if (!/\bindex\b/.test(robotsContent) || !/\bfollow\b/.test(robotsContent)) {
    reasons.push(`robots is "${robotsContent}" (expected index, follow)`);
  }

  // 4) 가이드 상세는 본문이 도착했다는 구조 신호 + 유효한 Article 스키마까지 있어야 한다.
  if (isGuideDetailPath(pathname)) {
    if (!doc.querySelector('[data-testid="guide-article"]')) {
      reasons.push('guide article body not rendered');
    }
    const blocks = readJsonLd(doc);
    if (blocks.some((b) => b && b.__invalid)) reasons.push('invalid JSON-LD block');
    const article = blocks.find((b) => b && b['@type'] === 'Article');
    if (!article) {
      reasons.push('no Article JSON-LD');
    } else {
      if (!collapse(article.headline)) reasons.push('Article JSON-LD has no headline');
      if (!collapse(article.datePublished)) reasons.push('Article JSON-LD has no datePublished');
      const id = article.mainEntityOfPage && article.mainEntityOfPage['@id'];
      if (!sameUrl(id, expectedCanonical(pathname))) {
        reasons.push(`Article mainEntityOfPage ${id || '(empty)'} != ${expectedCanonical(pathname)}`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** 캡처 신호가 끝내 못 나갔을 때 문서에 남기는 표시. 감사가 이걸 보고 실패시킨다. */
export const INCOMPLETE_ATTR = 'data-prerender-incomplete';

/**
 * 내용이 준비되면 `prerender-ready` 를 쏜다. 준비되지 않은 채 `timeoutMs` 를 넘기면
 * **표시를 남기고** 쏜다 — 프리렌더러를 60초 타임아웃으로 굶기는 대신, 산출물 감사가
 * 정확한 이유와 함께 빌드를 세우게 한다(실패는 조용하지 않아야 한다).
 *
 * @returns {() => void} 중단 함수 (테스트·언마운트용)
 */
export function startPrerenderReadySignal(doc, options = {}) {
  const intervalMs = options.intervalMs || 100;
  const timeoutMs = options.timeoutMs || 25000;
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer || ((id) => clearTimeout(id));
  const started = now();
  let timer = null;
  let done = false;

  const fire = () => {
    done = true;
    doc.dispatchEvent(new (doc.defaultView || globalThis).Event('prerender-ready'));
  };

  const tick = () => {
    if (done) return;
    const path = options.pathname || (doc.defaultView || globalThis).location.pathname;
    const { ok, reasons } = checkPrerenderReady(doc, path);
    if (ok) {
      fire();
      return;
    }
    if (now() - started >= timeoutMs) {
      doc.documentElement.setAttribute(INCOMPLETE_ATTR, reasons.join(' | '));
      fire();
      return;
    }
    timer = setTimer(tick, intervalMs);
  };

  tick();
  return () => {
    done = true;
    if (timer !== null) clearTimer(timer);
  };
}
