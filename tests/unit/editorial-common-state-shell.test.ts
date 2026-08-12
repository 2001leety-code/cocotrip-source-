/**
 * Common state + global app shell — source contract. Header/App import firebase
 * and react-router, so the cheap guard is the file text. Real geometry is
 * measured in `tests/e2e/common-state-shell.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
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
    expect(APP_CODE).not.toMatch(/PlannerSkeleton|CharterSkeleton|PageSkeleton/);
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
    const nav = HEADER_CODE.slice(HEADER_CODE.indexOf('{navItems.map'));
    expect(nav.slice(0, 900)).toMatch(/min-h-\[44px\]/);
  });

  it('공용 셸의 sm 버튼은 전부 min-h-[44px] 을 함께 단다', () => {
    for (const [name, src] of [
      ['Header', HEADER_CODE], ['CookieBanner', stripComments(COOKIE)], ['Footer', stripComments(FOOTER)],
    ] as const) {
      for (const m of src.matchAll(/className="([^"]*\bec-btn-sm\b[^"]*)"/g)) {
        expect(m[1], `${name}: sm button without a 44px floor`).toMatch(/min-h-\[44px\]/);
      }
    }
  });

  it('로고 링크도 44px 히트 영역을 갖는다', () => {
    const logo = HEADER_CODE.slice(HEADER_CODE.indexOf('aria-label="CocoTrip"') - 400);
    expect(logo.slice(0, 500)).toMatch(/min-h-\[44px\]/);
  });

  it('작은 모바일 헤더는 보조 BETA 배지를 숨겨 조작 버튼이 화면 밖으로 밀리지 않는다', () => {
    const title = HEADER_CODE.indexOf('title="Beta');
    const badge = HEADER_CODE.slice(title - 240, title + 160);
    expect(badge).toMatch(/hidden sm:inline-flex/);
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
      expect(trigger, `${name} trigger still white-on-paper`).not.toMatch(/text-white/);
    }
  });

  it('하단 내비 탭은 56px 행을 유지한다', () => {
    expect(BOTTOM_NAV).toMatch(/h-\[56px\]/);
  });

  it('쿠키 배너 버튼이 실제로 44px 이다 (주석만 44px 이라고 하던 자리)', () => {
    const cookie = stripComments(COOKIE);
    for (const label of ['accept', 'dismiss']) {
      const i = cookie.indexOf(`onClick={${label}} className=`);
      expect(i, `CookieBanner ${label} button not found`).toBeGreaterThan(-1);
      expect(cookie.slice(i, i + 160)).toMatch(/min-h-\[44px\]/);
    }
  });

  it('푸터 전화 링크와 프로모 띠도 44px 이다 (둘 다 통째로 링크)', () => {
    expect(stripComments(FOOTER)).toMatch(/tel:\+821087140611[\s\S]{0,200}min-h-\[44px\]/);
    const promo = stripComments(PROMO);
    const link = promo.slice(promo.indexOf('to={activeCtaHref}'), promo.indexOf('</Link>'));
    expect(link).toMatch(/min-h-\[44px\]/);
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

  it('Tab·Shift+Tab 이 dialog 안에 갇힌다 (실동작은 e2e 가 잰다)', () => {
    expect(HEADER_CODE).toMatch(/e\.key !== 'Tab'/);
    expect(HEADER_CODE).toMatch(/e\.shiftKey/);
    expect(HEADER_CODE).toMatch(/e\.preventDefault\(\)/);
    const keydowns = HEADER_CODE.match(/addEventListener\('keydown'/g) || [];
    expect(keydowns.length, 'Esc·Tab must share one keydown listener').toBe(1);
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
