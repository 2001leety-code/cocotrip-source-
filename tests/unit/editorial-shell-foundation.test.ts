/**
 * Korea Editorial Concierge — common shell contract (2026-08-10).
 *
 * Replaces `refined-ui-header.test.ts`, which pinned
 * `.refined header [style*="box-shadow"] { box-shadow: none }`. That rule
 * existed to erase an inline glow the header used to paint on its own logo and
 * BETA badge. The header no longer paints a glow, so there is nothing to erase
 * and the rule is deleted. The invariant worth keeping is the one underneath:
 * **the shell renders one paper surface and needs no corrective cascade.**
 *
 * The second half of this file guards what the reskin was NOT allowed to
 * change — routes, permission conditions and consent logic. A visual PR that
 * silently moves an auth boundary is the failure mode this catches.
 *
 * firebase-free source assertions (Header imports firebase/auth).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Comments in these files deliberately name the classes that were removed
 *  ("do not bring this back"), so a "no longer contains X" assertion has to
 *  look at code only — otherwise the tombstone fails the test it exists for. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HEADER = read('src/sections/Header.tsx');
const HEADER_CODE = stripComments(HEADER);
const FOOTER = read('src/sections/Footer.tsx');
const BOTTOM_NAV = read('src/components/MobileBottomNav.tsx');
const COOKIE = read('src/components/CookieBanner.tsx');
const MAIN = read('src/main.tsx');

describe('공용 셸 — 종이 서피스 1개, 보정 cascade 없음', () => {
  it('헤더가 다크/라이트 포크 클래스를 더 이상 쓰지 않는다', () => {
    for (const legacy of ['mobile-app-light-header', 'mobile-menu-light', 'isMobileAppLight']) {
      expect(HEADER_CODE, `Header still uses ${legacy}`).not.toContain(legacy);
      expect(stripComments(BOTTOM_NAV), `MobileBottomNav still uses ${legacy}`).not.toContain(legacy);
    }
  });

  it('헤더 색은 --ec-shell-* 토큰에서 온다 (하드코딩 hex 아님)', () => {
    expect(HEADER).toMatch(/var\(--ec-shell-bg\)/);
    expect(HEADER).toMatch(/var\(--ec-surface-shell-solid\)/);
    // The old header hard-coded rgba(8,11,20,...) / #15143d and then index.css
    // repainted it. Colour now has exactly one source.
    expect(HEADER).not.toMatch(/#15143d|rgba\(8\s*,\s*11\s*,\s*20/);
  });

  it('로고 워드마크는 잉크 — 그라데이션 글자가 아니다', () => {
    expect(HEADER).not.toMatch(/bg-clip-text/);
    expect(HEADER).toMatch(/text-ec-ink[^-]/);
  });

  it('하단 내비 spacer 높이가 실제 내비 높이(56px)+여유와 맞는다', () => {
    expect(BOTTOM_NAV).toMatch(/h-\[56px\]/);       // nav row
    expect(BOTTOM_NAV).toMatch(/h-\[72px\]/);       // spacer
    expect(BOTTOM_NAV).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it('활성 탭은 알약이 아니라 2px 룰이다', () => {
    expect(BOTTOM_NAV).toMatch(/h-\[2px\] bg-ec-brand/);
    expect(BOTTOM_NAV).not.toMatch(/rounded-full/);
    expect(BOTTOM_NAV).toMatch(/aria-current=\{active \? 'page' : undefined\}/);
  });
});

describe('키보드 접근성', () => {
  it('Esc 로 모바일 메뉴가 닫힌다', () => {
    // A full-screen overlay with no keyboard exit is a trap.
    expect(HEADER).toMatch(/if \(!isMobileMenuOpen\) return;/);
    expect(HEADER).toMatch(/e\.key === 'Escape'/);
    expect(HEADER).toMatch(/setIsMobileMenuOpen\(false\)/);
    expect(HEADER).toMatch(/removeEventListener\('keydown'/);
  });

  it('메뉴 열림 동안 body 스크롤 잠금 + data-menu-open 신호가 유지된다', () => {
    expect(HEADER).toMatch(/document\.documentElement\.dataset\.menuOpen = 'true'/);
    expect(HEADER).toMatch(/document\.body\.style\.overflow = 'hidden'/);
    // cleanup on unmount — otherwise a route change mid-menu leaves the page frozen
    expect(HEADER).toMatch(/return \(\) => \{\s*delete document\.documentElement\.dataset\.menuOpen/);
  });

  it('포커스 링은 :focus-visible 로만 나타난다', () => {
    const css = read('src/styles/editorial.css');
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/box-shadow: var\(--ec-focus-ring\)/);
    // A ring that also fires on mouse click is noise; :focus is banned here.
    expect(css).not.toMatch(/[^-]:focus\s*\{/);
  });

  it('reduced motion 정책이 토큰층에 있다', () => {
    expect(read('src/styles/editorial.css')).toMatch(/prefers-reduced-motion/);
  });
});

describe('시각만 바뀌었다 — 라우트·권한·동의 로직 무변경', () => {
  it('데스크톱 nav 목적지가 그대로다', () => {
    for (const to of ["'/charter'", "'/tours'", "'/planner'", "'/community'", "'/about'"]) {
      expect(HEADER, `nav lost ${to}`).toContain(to);
    }
  });

  it('검색·PWA 버튼 노출 조건이 내부 경로(admin/mood) 한정으로 남아 있다', () => {
    // Previously this rode on `!isMobileAppLight`, which coupled "which colour"
    // to "which controls". Removing the colour fork must not widen the control set.
    expect(HEADER).toMatch(/const isInternalPath = location\.pathname\.startsWith\('\/admin'\) \|\| location\.pathname\.startsWith\('\/mood'\)/);
    expect(HEADER).toMatch(/isMobile && isInternalPath && <PwaInstallButton/);
    expect(HEADER).toMatch(/\(!isMobile \|\| isInternalPath\)/);
  });

  it('admin 진입은 여전히 이메일 일치로만 열린다', () => {
    expect(HEADER).toMatch(/user\.email\.toLowerCase\(\) === ADMIN_EMAIL/);
    expect(HEADER).toMatch(/isAdmin && !isMobile/);
  });

  it('공유 제안서(shared=1)에서 내부 chrome 을 계속 숨긴다', () => {
    expect(HEADER).toMatch(/get\('shared'\) === '1'/);
    expect(HEADER).toMatch(/!isPublicView && <WishlistPanel \/>/);
  });

  it('쿠키 동의 로직(법적 경계)이 스타일 변경에 휩쓸리지 않았다', () => {
    expect(COOKIE).toMatch(/setConsent\('accepted'\)/);
    expect(COOKIE).toMatch(/setConsent\('dismissed'\)/);
    // accept and dismiss must stay two distinct actions — collapsing them would
    // turn "close" into consent.
    expect(COOKIE).toMatch(/onClick=\{accept\}/);
    expect(COOKIE).toMatch(/onClick=\{dismiss\}/);
    expect(COOKIE).toMatch(/aria-label=\{t\.a11y\?\.close \|\| cb\?\.dismiss \|\| 'Close'\}/);
  });

  it('푸터가 등록번호를 계속 노출한다 (신뢰 신호이자 법적 표기)', () => {
    expect(FOOTER).toMatch(/f\.businessNo/);
    expect(FOOTER).toMatch(/f\.tourNo/);
    for (const legal of ["'/terms'", "'/privacy'", "'/travel-terms'"]) {
      expect(FOOTER, `footer lost ${legal}`).toContain(legal);
    }
    expect(FOOTER).toMatch(/CookieSettings/); // 동의 변경 상시 진입점
  });

  it('푸터 링크가 죽은 앵커(#services/#regions)가 아니라 실제 라우트다', () => {
    expect(FOOTER).not.toMatch(/#services|#regions/);
    expect(FOOTER).toMatch(/to="\/planner"/);
    expect(FOOTER).toMatch(/to="\/guide"/);
  });
});

describe('legacy 플래그 — 아직 전환 안 된 페이지용으로만 남는다', () => {
  it('main.tsx 는 REFINED_LEGACY 일 때만 <html>.refined 를 붙인다', () => {
    expect(MAIN).toMatch(/const REFINED_LEGACY = import\.meta\.env\.VITE_FEATURE_REFINED_UI === 'true'/);
    expect(MAIN).toMatch(/if \(REFINED_LEGACY\) \{[\s\S]*classList\.add\('refined'\)/);
  });

  it('App.tsx 홈에서 refined-home 분기와 모바일/데스크톱 포크가 사라졌다', () => {
    const app = stripComments(read('src/App.tsx'));
    expect(app).not.toMatch(/refined-home/);
    expect(app).not.toMatch(/VITE_FEATURE_MOBILE_V2/);
    expect(app).not.toMatch(/<MobileHome\b/);   // \b does not match MobileHomeV2 (DEV preview route)
    expect(app).toMatch(/const HomeEditorial = lazy\(/);
  });
});
