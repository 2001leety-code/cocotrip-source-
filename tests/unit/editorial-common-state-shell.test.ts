/**
 * Korea Editorial Concierge — common state + global app shell (2026-08-11).
 *
 * One root cause, three symptoms:
 *
 * 1. **Route loading.** `src/components/ui/states.tsx` defines the loading
 *    contract (`role=status` + `aria-busy` + a specific label), but the app
 *    shell never adopted it. Every lazy route fell back to `PlannerSkeleton`
 *    — a dark `#080b14` wizard-shaped panel, announced to nobody, painted on
 *    ~50 routes including `/planner` itself, which is paper since phase 2.
 *    `/guide` had already been special-cased out of it by hand; this makes the
 *    exception the rule.
 * 2. **Global failure.** `ErrorBoundary` is the shell's last surface and it
 *    rendered a dark panel with the logo gradient on its retry button and the
 *    raw `Error.message` shown to travellers in production.
 * 3. **Shell touch targets.** The 44px floor reached the header's own icon
 *    rail but not the Wishlist / Cart triggers (36×36, and drawn in
 *    `text-white/70` on a paper header), the desktop nav links (38.5px) or the
 *    two `ec-btn-sm` CTAs (36px).
 *
 * Source assertions — Header/App import firebase and react-router, so the
 * cheap guard is the file text. Real geometry is measured in
 * `tests/e2e/common-state-shell.spec.ts` against the production bundle.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** Tombstone comments name the classes that were removed, so "no longer
 *  contains X" has to look at code only. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const APP = read('src/App.tsx');
const APP_CODE = stripComments(APP);
const STATES = read('src/components/ui/states.tsx');
const BOUNDARY = read('src/components/ErrorBoundary.tsx');
const BOUNDARY_CODE = stripComments(BOUNDARY);
const HEADER = read('src/sections/Header.tsx');
const HEADER_CODE = stripComments(HEADER);
const WISHLIST = read('src/components/WishlistButton.tsx');
const CART = read('src/components/CartButton.tsx');
const BOTTOM_NAV = read('src/components/MobileBottomNav.tsx');
const COOKIE = read('src/components/CookieBanner.tsx');
const FOOTER = read('src/sections/Footer.tsx');
const PROMO = read('src/components/PromoBanner.tsx');
const CSS = read('src/styles/editorial.css');

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const locale = (l: string) =>
  JSON.parse(read(`src/i18n/locales/${l}.json`)) as Record<string, Record<string, string>>;

/* ── 1. Route loading ───────────────────────────────────────────────────── */

describe('라우트 로딩 — 공용 상태 계약 1개', () => {
  it('states.tsx 가 라우트 폴백을 제공한다 (화면마다 자작 금지)', () => {
    expect(STATES).toMatch(/export function EcRouteFallback/);
  });

  it('App 의 lazy 라우트 폴백이 전부 공용 폴백을 지난다', () => {
    expect(APP_CODE).toMatch(/EcRouteFallback/);
    // 51 hand-written `fallback={<PlannerSkeleton />}` — one dark wizard panel
    // standing in for tours, community, about, terms, the planner and admin.
    expect(APP_CODE).not.toMatch(/PlannerSkeleton|CharterSkeleton|PageSkeleton/);
    // The inline `<div className="min-h-screen bg-ec-page" aria-hidden />`
    // patches (home, /guide) announced nothing either — they route through the
    // same component now.
    expect(APP_CODE).not.toMatch(/min-h-screen bg-ec-page" aria-hidden/);
    const remaining = APP_CODE.match(/fallback=\{(?!null|ROUTE_FALLBACK|LEGACY_ROUTE_FALLBACK)/g);
    expect(remaining, `App still has bespoke fallbacks: ${remaining}`).toBeNull();
  });

  it('죽은 PageSkeleton 모듈이 남아 있지 않다', () => {
    expect(existsSync(path.join(ROOT, 'src/components/PageSkeleton.tsx'))).toBe(false);
  });

  it('폴백은 announce 한다 — 청크 로딩 중 스크린리더 침묵 금지', () => {
    const block = STATES.slice(STATES.indexOf('export function EcRouteFallback'));
    expect(block).toMatch(/aria-busy/);
    expect(block).toMatch(/role="status"/);
  });

  it('아직 다크인 페이지의 폴백 색은 토큰에서 온다 (컴포넌트 하드코딩 hex 아님)', () => {
    // PageSkeleton inlined #080b14 — a colour no page actually uses; the legacy
    // bodies open on #0a0412. One token, and it dies with the last dark page.
    expect(CSS).toMatch(/--ec-legacy-page-bg:/);
    expect(stripComments(STATES)).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

/* ── 2. Global failure surface ──────────────────────────────────────────── */

describe('전역 오류 셸 — 편집형 종이, 그라디언트 없음', () => {
  it('공용 EcError 를 쓴다 (자체 오류 패널 아님)', () => {
    expect(BOUNDARY).toMatch(/import \{[^}]*EcError[^}]*\} from '@\/components\/ui\/states'/);
    expect(BOUNDARY).toMatch(/<EcError/);
  });

  it('로고 밖 gradient/glow/glass 가 없다', () => {
    expect(BOUNDARY_CODE).not.toMatch(/linear-gradient|radial-gradient|bg-clip-text|backdrop-blur/);
    expect(BOUNDARY_CODE).not.toMatch(/#7C5CFC|#EA537E|#080b14/i);
  });

  it('원문 Error.message 는 개발 환경에서만 노출된다', () => {
    // A traveller reading "TypeError: Cannot read properties of undefined" is
    // not being told what to do — states.tsx: never a stack, never a bare code.
    expect(BOUNDARY_CODE).toMatch(/isDev && this\.state\.error &&/);
    expect(BOUNDARY_CODE).toMatch(/const isDev = import\.meta\.env\.DEV/);
  });

  it('4언어 문구와 WhatsApp 문의 경로가 그대로다', () => {
    expect(BOUNDARY).toMatch(/translations\[lang\]\.errorBoundary/);
    expect(BOUNDARY).toMatch(/wa\.me\/821087140611/);
    for (const l of LANGS) {
      const eb = locale(l).errorBoundary;
      for (const k of ['title', 'description', 'retry', 'contact']) {
        expect(eb?.[k], `${l}.errorBoundary.${k}`).toBeTruthy();
      }
    }
  });
});

/* ── 3. Shell touch targets ─────────────────────────────────────────────── */

describe('공용 셸 조작 target 44×44', () => {
  it('데스크톱 nav 링크가 44px 이상이다', () => {
    // was `px-4 py-2 text-[15px]` = 38.5px tall (docs/DESIGN-EDITORIAL-CONCIERGE.md
    // "Open item — shared header touch targets").
    const nav = HEADER_CODE.slice(HEADER_CODE.indexOf('{navItems.map'));
    expect(nav.slice(0, 900)).toMatch(/min-h-\[44px\]/);
  });

  it('헤더 CTA(로그인·1:1 문의)가 36px sm 버튼이 아니다', () => {
    expect(HEADER_CODE).not.toMatch(/ec-btn-sm/);
  });

  it('로고 링크도 44px 히트 영역을 갖는다', () => {
    const logo = HEADER_CODE.slice(HEADER_CODE.indexOf('aria-label="CocoTrip"') - 400);
    expect(logo.slice(0, 500)).toMatch(/min-h-\[44px\]/);
  });

  it('Wishlist·Cart 헤더 트리거가 44×44 이고 종이 위에서 보이는 잉크다', () => {
    for (const [name, src] of [
      ['WishlistPanel', stripComments(WISHLIST)],
      ['CartPanel', stripComments(CART)],
    ] as const) {
      const panel = src.slice(src.indexOf(`export function ${name}`));
      const trigger = panel.slice(0, panel.indexOf('</button>'));
      expect(trigger, `${name} trigger under 44px`).toMatch(/min-w-\[44px\]/);
      expect(trigger, `${name} trigger under 44px`).toMatch(/min-h-\[44px\]/);
      // White at 70% on #F3F1EC paper is ~1.06:1 — the control was invisible on
      // every route once the shell went paper.
      expect(trigger, `${name} trigger still white-on-paper`).not.toMatch(/text-white/);
    }
  });

  it('하단 내비 탭은 56px 행을 유지한다', () => {
    expect(BOTTOM_NAV).toMatch(/h-\[56px\]/);
  });

  it('전역 chrome(쿠키 배너·푸터)에도 36px sm 버튼이 남아 있지 않다', () => {
    // `--ec-button-height-sm` 은 44px 미만이라 공용 셸에선 쓸 수 없다. 토큰 자체는
    // 그대로 둔다 — 플래너 코스빌더·구매 패널이 쓰고 있고, 그건 이 PR 밖이다.
    for (const [name, src] of [['CookieBanner', COOKIE], ['Footer', FOOTER]] as const) {
      expect(stripComments(src), `${name} still uses ec-btn-sm`).not.toMatch(/ec-btn-sm/);
    }
    // 쿠키 배너는 44px 이라고 주석만 달아 두고 실제로는 56x36 이었다.
    expect(stripComments(COOKIE)).toMatch(/ec-btn ec-btn-primary"/);
  });

  it('푸터 전화 링크와 프로모 띠도 44px 이다 (둘 다 통째로 링크)', () => {
    expect(stripComments(FOOTER)).toMatch(/tel:\+821087140611[\s\S]{0,200}min-h-\[44px\]/);
    const promo = stripComments(PROMO);
    const link = promo.slice(promo.indexOf('to={activeCtaHref}'), promo.indexOf('</Link>'));
    expect(link).toMatch(/min-h-\[44px\]/);
    // 🔴 flex/grid 로 세로 정렬하면 안의 두 span 이 플렉스 아이템이 되어 사이 공백이
    // 죽는다 — "…when you sign upStart free plan →" (2026-08-11 실측). 높이는
    // padding 으로 만들고 인라인 흐름을 유지한다.
    expect(link, 'promo strip must stay in inline flow').not.toMatch(/\b(flex|grid|inline-flex)\b/);
  });
});

/* ── 4. Global modal shell (header mobile menu) ─────────────────────────── */

describe('전역 모달 셸 — 관계·포커스·정리', () => {
  it('모바일 메뉴가 dialog 로 선언되고 이름을 갖는다', () => {
    expect(HEADER).toMatch(/role="dialog"/);
    expect(HEADER).toMatch(/aria-modal="true"/);
    expect(HEADER).toMatch(/aria-label=\{t\.nav\.navigation \|\| 'Navigation'\}/);
  });

  it('열릴 때 포커스가 들어가고 닫힐 때 트리거로 되돌아간다', () => {
    expect(HEADER).toMatch(/menuPanelRef/);
    expect(HEADER).toMatch(/menuTriggerRef/);
    expect(HEADER).toMatch(/\.focus\(\)/);
  });

  it('Esc·body 스크롤 잠금·cleanup 이 그대로다 (회귀 방지)', () => {
    expect(HEADER).toMatch(/e\.key === 'Escape'/);
    expect(HEADER).toMatch(/document\.body\.style\.overflow = 'hidden'/);
    expect(HEADER).toMatch(/return \(\) => \{\s*delete document\.documentElement\.dataset\.menuOpen/);
  });
});

/* ── 5. Copy, parity, and the rules that outlive this PR ────────────────── */

describe('문구·4언어·금지 규칙', () => {
  it('라우트 로딩 문구가 ko/en/ja/zh 전부에 있고 영어 누출이 없다', () => {
    const seen: Record<string, string> = {};
    for (const l of LANGS) {
      const v = locale(l).a11y?.loadingPage;
      expect(v, `${l}.a11y.loadingPage missing`).toBeTruthy();
      seen[l] = v;
    }
    // "Loading" is what states.tsx tells callers never to announce; and ko/ja/zh
    // must not fall back to the English literal.
    expect(seen.en).not.toBe('Loading');
    for (const l of ['ko', 'ja', 'zh']) {
      expect(seen[l], `${l} leaks English`).not.toMatch(/[A-Za-z]/);
      expect(seen[l]).not.toBe(seen.en);
    }
  });

  it('셸 파일에 새 nullish 연산자가 없다 (repo mojibake 가드)', () => {
    for (const [name, src] of [
      ['App.tsx', APP], ['states.tsx', STATES], ['ErrorBoundary.tsx', BOUNDARY],
      ['Header.tsx', HEADER], ['WishlistButton.tsx', WISHLIST], ['CartButton.tsx', CART],
    ] as const) {
      expect(src, `${name} uses the nullish operator`).not.toMatch(/\?\?/);
    }
  });

  it('셸 파일에 gradient/glow/glass 가 없다 (로고 img 제외)', () => {
    for (const [name, src] of [
      ['states.tsx', stripComments(STATES)],
      ['ErrorBoundary.tsx', BOUNDARY_CODE],
      ['MobileBottomNav.tsx', stripComments(BOTTOM_NAV)],
    ] as const) {
      expect(src, `${name} has a gradient`).not.toMatch(/linear-gradient|radial-gradient|bg-clip-text/);
      expect(src, `${name} has a glow`).not.toMatch(/box-shadow:\s*0 0 \d+px/);
      expect(src, `${name} has glass`).not.toMatch(/backdrop-blur|backdropFilter/);
    }
  });
});
