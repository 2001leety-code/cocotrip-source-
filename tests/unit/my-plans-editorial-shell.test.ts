import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('/my-plans editorial library source contract', () => {
  const page = read('src/pages/MyPlansPage.tsx');
  const app = read('src/App.tsx');

  it('uses the shared loading, empty, and error states', () => {
    expect(page).toMatch(/import \{[^}]*EcLoading[^}]*EcEmpty[^}]*EcError[^}]*\} from '@\/components\/ui\/states'/s);
    expect(page).toContain('data-testid="my-plans-list-loading"');
    expect(page).toContain('data-testid="my-plans-list-empty"');
    expect(page).toContain('data-testid="my-plans-list-error"');
    expect(page).toContain('data-testid="my-plans-list-partial"');
  });

  it('does not collapse listener or next-page failures into empty data', () => {
    expect(page).toContain('setListError(true)');
    expect(page).toContain('setLoadMoreError(true)');
    expect(page).not.toContain('}, () => setLoading(false))');
    expect(page).not.toMatch(/catch\s*\{\s*setHasMore\(false\)/);
  });

  it('has a dev-only, read-only visual harness outside AuthRequired', () => {
    const start = app.indexOf('{import.meta.env.DEV && (', app.indexOf('path="/mypage"'));
    const end = app.indexOf('path="/my-plans"', start);
    const route = app.slice(start, end);
    expect(route).toContain('<MyPlansPage />');
    expect(route).not.toContain('<AuthRequired>');
    expect(page).toContain("pathname !== '/dev/my-plans-editorial'");
  });

  it('removes page gradients and adopts a route-local editorial stylesheet', () => {
    expect(page).toContain("import '@/styles/editorial-my-plans.css'");
    expect(page).not.toMatch(/linear-gradient|radial-gradient|backdropFilter|backdrop-filter/);
    expect(page).not.toContain('my-plans-bookings-boundary cocotrip-mobile-plans');
  });

  it('keeps the tabs named, keyboard-operable, and connected to their panels', () => {
    expect(page).toContain('handleTabKeyDown');
    expect(page).toContain('tabIndex={tab === id ? 0 : -1}');
    expect(page).toContain('aria-labelledby="my-plans-plans-tab"');
    expect(page).toContain('aria-labelledby="my-plans-bookings-tab"');
  });

  it('keeps pagination reachable when a local search misses the loaded page', () => {
    expect(page).toContain('!fixtureState && hasMore && !loadMoreError');
    expect(page).not.toContain('hasMore && visiblePlans.length > 0');
  });
});

describe('/my-plans editorial CSS floor', () => {
  const css = read('src/styles/editorial-my-plans.css');

  it('keeps controls touch-safe and search inputs zoom-safe', () => {
    expect(css).toMatch(/\.my-plans-editorial-tab[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/\.my-plans-editorial-search[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/\.my-plans-editorial-search[\s\S]*font-size:\s*16px/);
  });

  it('keeps focus visible without gradients, glow, or glass', () => {
    expect(css).toMatch(/\.my-plans-editorial-main[\s\S]*:focus-visible[\s\S]*outline:\s*3px solid var\(--ec-brand\)/);
    expect(css).toMatch(/\.my-plans-bookings-boundary[\s\S]*:focus-visible[\s\S]*outline-color:\s*var\(--ec-text-on-inverse\)/);
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
    expect(css).not.toMatch(/box-shadow:\s*0\s+0/);
  });
});
