/**
 * 2026-08-05: `/mood` 에서 pageview 계측이 통째로 죽어 있었다 — PostHog **와 GA4 양쪽 모두**.
 *
 * 두 변경이 각각은 멀쩡한데 겹쳐서 구멍이 났다:
 *   2026-06-13  `GlobalWidgets` 가 `/mood` 에서 early-return — 마케팅 chrome 숨김 목적.
 *               당시엔 posthog-js 가 pageview 를 자동 수집해서 아무 문제 없었다.
 *   2026-07-31  `capture_pageview: false` (커밋 55d3f94a, 동의 철회 누수 차단) → **수동 전송**.
 *               그 수동 전송기(`PageViewTracker`)가 하필 early-return **뒤**에 있었다.
 *
 * 실측(`$pathname='/mood'`): 7/31 페이지로드 4회 → pageview 4건 / 8/4 로드 6회 → **0건**.
 * `$web_vitals` 는 SDK 내부 자동수집이라 계속 나가서 "vitals 만 남는" 모양이 됐다.
 *
 * ⚠️ 이 테스트는 **소스 배선**을 고정한다. 렌더 테스트로 잡으려면 App 전체(라우터·Suspense·
 *    lazy 40여 개·PostHog init)를 띄워야 해서 배보다 배꼽이 크다. 대신 앵커를 좁게 잡는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const src = readFileSync('src/App.tsx', 'utf8');

/** `function GlobalWidgets()` 본문 범위 — 다음 최상위 `function` 선언 직전까지. */
const gwStart = src.indexOf('function GlobalWidgets()');
const gwEnd = (() => {
  if (gwStart < 0) return -1;
  const rel = src.slice(gwStart + 1).indexOf('\nfunction ');
  return rel < 0 ? src.length : gwStart + 1 + rel;
})();
const globalWidgetsBody = gwStart < 0 ? '' : src.slice(gwStart, gwEnd);

describe('pageview 계측 마운트 지점', () => {
  it('GlobalWidgets 는 여전히 /mood 에서 early-return 한다 (chrome 숨김 의도 유지)', () => {
    // 이게 사라졌다면 무드가 "별도 사이트" 가 아니게 된 것 — 이 테스트의 전제가 바뀐다.
    expect(globalWidgetsBody).toMatch(/pathname\.startsWith\('\/mood'\)\)\s*return null/);
  });

  it('PageViewTracker 가 GlobalWidgets **안에** 있으면 안 된다', () => {
    // early-return 뒤에 있으면 /mood 계측이 통째로 죽는다. 그게 이 버그였다.
    expect(globalWidgetsBody).not.toContain('<PageViewTracker />');
  });

  it('PageViewTracker 마운트가 GlobalWidgets 본문 **밖**에 있다', () => {
    const mountIdx = src.lastIndexOf('<PageViewTracker />');
    expect(mountIdx).toBeGreaterThan(0);
    expect(gwStart).toBeGreaterThan(0);
    // 옛 코드는 이 범위 **안**에 있었고, 그래서 /mood 계측이 죽었다.
    const insideGlobalWidgets = mountIdx > gwStart && mountIdx < gwEnd;
    expect(insideGlobalWidgets).toBe(false);
  });

  it('마운트가 GlobalWidgets 호출보다 앞이라 경로와 무관하게 돈다', () => {
    const mountIdx = src.lastIndexOf('<PageViewTracker />');
    const globalWidgetsMount = src.lastIndexOf('<GlobalWidgets />');
    expect(globalWidgetsMount).toBeGreaterThan(gwEnd); // App 반환부의 호출
    expect(mountIdx).toBeLessThan(globalWidgetsMount);
    expect(mountIdx).toBeGreaterThan(gwEnd);           // 정의부 밖 = App 반환부
  });

  it('PostHog·GA4 pageview 를 같은 곳에서 쏜다 (한쪽만 살아남는 일 방지)', () => {
    // 둘이 갈라지면 이번처럼 "PostHog 만" 혹은 "GA4 만" 죽는 걸 못 알아챈다.
    const trackerBody = src.slice(src.indexOf('function PageViewTracker()'));
    expect(trackerBody).toMatch(/trackPageView\(location\.pathname\)/);
    expect(trackerBody).toMatch(/posthogPageView\(location\.pathname\)/);
  });
});

describe('IndexNow 배선 (Bing·Naver 색인 고지)', () => {
  it('스크립트가 CI 에 연결돼 있다 — 손으로만 돌리면 잊힌다', () => {
    // 2026-08-01 에 만들어졌지만 8/5 까지 어디에도 안 걸려 있었다. 실제로 잊혔다.
    const wf = readFileSync('.github/workflows/indexnow.yml', 'utf8');
    expect(wf).toContain('scripts/submit-indexnow.mjs');
    expect(wf).toContain('deployment_status');
  });

  it('운영 배포에만 반응한다 (프리뷰 배포마다 중복 제출 금지)', () => {
    const wf = readFileSync('.github/workflows/indexnow.yml', 'utf8');
    expect(wf).toMatch(/environment == 'Production'/);
    expect(wf).toMatch(/state == 'success'/);
  });

  it('수동 실행 경로도 있다', () => {
    const wf = readFileSync('.github/workflows/indexnow.yml', 'utf8');
    expect(wf).toContain('workflow_dispatch');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['seo:indexnow']).toBe('node scripts/submit-indexnow.mjs');
  });
});
