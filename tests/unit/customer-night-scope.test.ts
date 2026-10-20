import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCustomerNightPath, isHomeChromePath } from '@/lib/customerNight';

describe('home chrome predicate (Home + exact /planner only)', () => {
  it('matches Home and the exact planner entry', () => {
    expect(isHomeChromePath('/')).toBe(true);
    expect(isHomeChromePath('/planner')).toBe(true);
  });

  it('leaves every other night route on the shared shell', () => {
    for (const p of ['/tours', '/tours/seoul-night', '/planner/share', '/planner/x', '/planner/share/abc', '/planner/','/my-plans/abc', '/charter', '/admin']) {
      expect(isHomeChromePath(p), p).toBe(false);
    }
  });

  it('Header and Footer gate Home chrome on the shared predicate, not a literal path', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');
    const header = read('src/sections/Header.tsx');
    const footer = read('src/sections/Footer.tsx');
    expect(header).toContain('isHomeChromePath(location.pathname)');
    expect(header).not.toMatch(/homeChrome = location\.pathname === '\/'/);
    expect(header).not.toMatch(/compactHeader = isCompactViewport && location\.pathname === '\/'/);
    expect(footer).toContain('isHomeChromePath(useLocation().pathname)');
    // Direct /planner visits need Home's stylesheet without passing through Home.
    expect(read('src/pages/PlannerPage/index.tsx')).toContain("import '@/styles/home-dope.css';");
  });
});

describe('customer night scope predicate', () => {
  it('covers customer routes by exact path or `/` child', () => {
    for (const p of [
      '/', '/tours', '/tours/seoul-night', '/planner', '/charter', '/guide/abc', '/region/busan',
      '/community', '/community/post/1', '/my-plans', '/my-plans/abc', '/s/xyz', '/mypage',
      '/about', '/terms', '/privacy', '/travel-terms', '/account-deletion', '/map', '/assistant',
      '/links', '/whatsapp-support',
    ]) {
      expect(isCustomerNightPath(p), p).toBe(true);
    }
  });

  it('excludes admin, mood, DEV harnesses and charter-legacy', () => {
    for (const p of [
      '/admin', '/admin/plans', '/admin/preview-ai-center', '/mood', '/mood/dev-ui', '/dev/mypage-editorial',
      '/preview/mobile-home', '/charter-legacy', '/charter-new', '/toursx', '/settings',
    ]) {
      expect(isCustomerNightPath(p), p).toBe(false);
    }
  });
});

describe('customer night portal / charter class scope (source contract)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

  it('MobileSelectDrawer only gets `ec-night` from the customer planner callers', () => {
    const drawer = read('src/components/MobileSelectDrawer.tsx');
    expect(drawer).not.toMatch(/className="[^"]*ec-night/);
    expect(drawer).toContain("contentClassName = ''");
    expect(read('src/components/WizardForm/WizardStep2Details.tsx').match(/contentClassName="ec-night"/g)).toHaveLength(2);
    expect(read('src/pages/CharterPage.tsx')).not.toContain('contentClassName');
  });

  it('/charter carries the `.ec-charter` scope; /charter-legacy does not', () => {
    const page = read('src/pages/CharterNewPage.tsx');
    expect(page).toContain('ec-charter');
    expect(page).not.toContain("'m-page cocotrip-mobile-charter'");
    expect(read('src/pages/CharterPage.tsx')).not.toContain('ec-charter');
  });
});
