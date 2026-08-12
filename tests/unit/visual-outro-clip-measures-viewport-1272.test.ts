/**
 * Plan-detail visual CI must use a deterministic fixture rather than a mutable
 * production plan or stale pixel coordinates.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const specPath = 'tests/visual/plan-detail-mobile.spec.ts';
const source = readFileSync(resolve(process.cwd(), specPath), 'utf8');
const code = source;

describe('plan detail visual smoke uses the current editorial document', () => {
  it('stubs a deterministic plan and never depends on production credentials', () => {
    expect(code).toMatch(/PLAN_FIXTURE/);
    expect(code).toMatch(/page\.route\('\*\*\/api\/get-plan\?\*\*'/);
    expect(code).not.toMatch(/PDF_GOLDEN_PLAN_ID|HEALTH_CHECK_EMAIL|signInWithPassword/);
  });

  it('asserts live geometry plus a focused, stable pixel baseline', () => {
    expect(code).toMatch(/horizontalOverflow/);
    expect(code).toMatch(/height >= 44/);
    expect(code).toMatch(/plan-document-masthead/);
    expect(code).toMatch(/day-route-map/);
    expect(code).toMatch(/toHaveScreenshot/);
    expect(code).toMatch(/section-tabs-scroll-affordance\.png/);
    expect(code).not.toMatch(/header-fold|summary-metrics|outro-fold/);
  });

  it('uploads current screenshots for human review', () => {
    expect(code).toMatch(/testInfo\.attach\('plan-detail-document-top'/);
    expect(code).toMatch(/testInfo\.attach\('plan-detail-day-route'/);
    expect(code).toMatch(/testInfo\.attach\('plan-detail-permission-state'/);
  });

  it('covers a terminal permission state without real operational writes', () => {
    expect(code).toMatch(/installDeterministicRoutes\(page, 403\)/);
    expect(code).toMatch(/plan-detail-permission/);
    expect(code).not.toMatch(/action:\s*['"](?:create|delete|report)['"]/);
  });
});
