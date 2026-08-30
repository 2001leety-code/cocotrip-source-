// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — 운영 .mjs 스크립트는 TypeScript 선언 파일이 없다.
import {
  applyFindingDelta,
  classifyRequestForReadonly,
  collectPageMetrics,
  isUnexpectedFinalOrigin,
  parseAuditArgs,
  validateManifest,
  validateOpsSnapshot,
} from '../../scripts/design-ops-audit.mjs';
// @ts-expect-error — 기존 운영 .mjs 스크립트는 TypeScript 선언 파일이 없다.
import {
  assertReadonlyDesignTarget,
  normalizeDesignBaseUrl,
} from '../../scripts/design-audit.mjs';

const ROOT = path.resolve(process.cwd());
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'config', 'design-surfaces.v1.json'), 'utf8'));
const resultSchema = JSON.parse(readFileSync(path.join(ROOT, 'config', 'design-audit-result.schema.json'), 'utf8'));

function finding(key: string, observedAt = 200): Record<string, any> {
  const parts = key.split('.');
  return {
    key,
    dedupe_key: key,
    severity: 'warning',
    status: 'observed',
    fact: '측정된 디자인 문제',
    current: { delta: 'new', surface: parts[2] || 'home', lang: parts[3] || 'ko', viewport: { id: parts[4] || 'mobile-390' } },
    previous: null,
    proposed_action: '운영자 승인 뒤 수정',
    approval_required: true,
    owner: 'design-team',
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    next_check_at: observedAt + 604800,
    estimated_cost_usd: null,
    risk_flags: { privacy: false, payment: false, security: false, external_write: false },
    evidence: [{ kind: 'http', ref: 'https://example.test/', observed_at: observedAt, read_only: true }],
  };
}

function snapshot(findings: Record<string, any>[] = []): Record<string, any> {
  return {
    schema_version: 'ops.v1',
    generated_at: 200,
    project: 'web',
    job: {
      key: 'design.web.weekly-audit',
      title: '웹 주요 화면 주간 디자인 자동감사',
      project: 'web',
      role: 'design.release_verifier',
      owner: 'design-team',
      scheduler_owner: 'github-actions',
      schedule: { kind: 'cron', expression: '0 1 * * 1', timezone: 'Asia/Seoul', interval_seconds: null },
      write_scope: 'read_only',
      approval_required: false,
      stale_after_seconds: 691200,
      cost_ceiling_usd: null,
    },
    run: {
      id: 'design-200-abcd',
      dedupe_key: 'design.web.weekly-audit:1',
      status: 'succeeded',
      terminal: true,
      executor: { kind: 'script', name: 'web.design-ops-audit', version: '1' },
      started_at: 199,
      heartbeat_at: 200,
      finished_at: 200,
      changed: findings.length > 0,
      error: null,
    },
    summary: { status: findings.length ? 'warning' : 'ok', changed: findings.length > 0, source_count: 1, finding_count: findings.length },
    sources: [{
      key: 'web.design.home.ko.mobile-390',
      status: findings.length ? 'warning' : 'ok',
      observed_at: 200,
      last_attempt_at: 200,
      last_success_at: 200,
      freshness: { state: 'fresh', age_seconds: 0, stale_after_seconds: 691200 },
      metrics: { surface: 'home', lang: 'ko', viewport: { id: 'mobile-390', width: 390, height: 844 } },
      evidence: [{ kind: 'http', ref: 'https://example.test/', observed_at: 200, read_only: true }],
    }],
    findings,
  };
}

describe('design surface manifest v1', () => {
  it('locks 4 languages, 390x844 + 1280x800, and active public surfaces', () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.languages).toEqual(['ko', 'en', 'ja', 'zh']);
    expect(manifest.viewports).toEqual([
      { id: 'mobile-390', width: 390, height: 844 },
      { id: 'desktop-1280', width: 1280, height: 800 },
    ]);
    expect(manifest.surfaces.map((surface: any) => surface.id)).toEqual(['home', 'planner', 'tours', 'charter', 'assistant']);
    expect(manifest.surfaces.every((surface: any) => surface.status === 'active' && surface.audience === 'public')).toBe(true);
  });

  it('fails closed when a required locale, viewport, or selector disappears', () => {
    const broken = structuredClone(manifest);
    broken.languages.pop();
    broken.viewports[0].width = 391;
    delete broken.surfaces[0].requirements.primary_action_selector;
    const errors = validateManifest(broken).join('\n');
    expect(errors).toContain('ko/en/ja/zh');
    expect(errors).toContain('mobile-390=390x844');
    expect(errors).toContain('primary_action_selector');
  });
});

describe('read-only browser boundary', () => {
  it('defaults to local and requires an explicit production read-only flag', () => {
    expect(parseAuditArgs(['--no-screenshots'], {}).baseUrl).toBe('http://127.0.0.1:4173');
    expect(() => assertReadonlyDesignTarget('https://cocotripkr.com')).toThrow(/allow-prod-readonly/);
    expect(assertReadonlyDesignTarget('https://cocotripkr.com/', true)).toBe('https://cocotripkr.com');
  });

  it('rejects non-http URLs and embedded credentials', () => {
    expect(() => normalizeDesignBaseUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => normalizeDesignBaseUrl('https://user:secret@example.test')).toThrow(/비밀번호/);
  });

  it('allows reads and known semantic-read POSTs, while blocking writes and telemetry', () => {
    expect(classifyRequestForReadonly('GET', 'https://cocotripkr.com/tours')).toBe('allow_read');
    expect(classifyRequestForReadonly('POST', 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel')).toBe('allow_read');
    expect(classifyRequestForReadonly('OPTIONS', 'https://cocotripkr.com/api/public-data')).toBe('allow_read');
    expect(classifyRequestForReadonly('POST', 'https://cocotripkr.com/api/reviews', JSON.stringify({ action: 'list' }))).toBe('allow_read');
    expect(classifyRequestForReadonly('POST', 'http://127.0.0.1:4173/api/reviews', { action: 'aggregate' })).toBe('allow_read');
    expect(classifyRequestForReadonly('POST', 'https://cocotripkr.com/api/reviews', JSON.stringify({ action: 'create' }))).toBe('block_non_read');
    expect(classifyRequestForReadonly('POST', 'https://attacker.example/api/reviews', JSON.stringify({ action: 'list' }))).toBe('block_non_read');
    expect(classifyRequestForReadonly('POST', 'https://cocotripkr.com/api/checkout')).toBe('block_non_read');
    expect(classifyRequestForReadonly('POST', 'https://us.posthog.com/e/')).toBe('block_telemetry');
  });

  it('treats a final navigation outside the configured origin as an audit failure condition', () => {
    expect(isUnexpectedFinalOrigin('https://cocotripkr.com', 'https://cocotripkr.com/planner')).toBe(false);
    expect(isUnexpectedFinalOrigin('https://cocotripkr.com', 'https://attacker.example/landing')).toBe(true);
  });

  it('detects missing form labels and button accessible names without flagging named controls', async () => {
    document.body.innerHTML = `
      <h1>Plan Korea</h1>
      <a id="cta" href="/planner">Start planning</a>
      <label for="traveler-name">Traveler name</label>
      <input id="traveler-name">
      <input id="email" aria-label="Email">
      <input id="missing-label" placeholder="Placeholder is not a label">
      <button id="named-button" aria-label="Open menu"></button>
      <button id="missing-button"><svg></svg></button>
    `;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 100, height: 50, top: 0, bottom: 50, left: 0, right: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 });
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: 390 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 844 });
    const page = { evaluate: async (callback: (arg: any) => any, arg: any) => callback(arg) };
    const metrics = await collectPageMetrics(page as any, '#cta', 44, { width: 390, height: 844 });

    expect(metrics.form_control_count).toBe(3);
    expect(metrics.form_control_label_missing).toEqual([{ key: '#missing-label', tag: 'input', placeholder: 'Placeholder is not a label' }]);
    expect(metrics.button_count).toBe(2);
    expect(metrics.button_accessible_name_missing).toEqual([{ key: '#missing-button', tag: 'button' }]);
  });
});

describe('ops.v1 result contract and finding lifecycle', () => {
  it('projects the design result schema onto the Brain ops.v1 SSOT', () => {
    expect(resultSchema.$id).toBe('urn:cocotrip:contracts:design-audit-result:v1');
    expect(resultSchema.allOf[0].$ref).toBe('urn:cocotrip:contracts:ops:v1');
    expect(resultSchema.allOf[1].properties.job.properties.key.const).toBe('design.web.weekly-audit');
    expect(resultSchema.allOf[1].properties.job.properties.write_scope.const).toBe('read_only');
  });

  it('accepts a complete ops.v1 snapshot and rejects a missing risk flag', () => {
    const good = snapshot([finding('web.design.home.ko.mobile-390.primary-action-missing')]);
    expect(good.job.cost_ceiling_usd).toBeNull();
    expect(validateOpsSnapshot(good)).toEqual([]);
    const broken = structuredClone(good);
    delete broken.findings[0].risk_flags.external_write;
    expect(validateOpsSnapshot(broken).join('\n')).toContain('external_write');
  });

  it('marks matching keys unchanged, new keys new, and absent prior keys resolved', () => {
    const priorA = finding('web.design.home.ko.mobile-390.touch', 100);
    const priorResolved = finding('web.design.tours.en.desktop-1280.overflow', 110);
    const previous = snapshot([priorA, priorResolved]);
    const currentA = finding(priorA.key, 300);
    const currentNew = finding('web.design.planner.ja.mobile-390.cta', 300);
    const successfulScopes = new Set(['home|ko|mobile-390', 'tours|en|desktop-1280', 'planner|ja|mobile-390']);
    const result = applyFindingDelta([currentA, currentNew], previous, 300, 'design-300-abcd', successfulScopes);

    expect(result.changed).toBe(true);
    expect(result.findings.find((item: any) => item.key === priorA.key).current.delta).toBe('unchanged');
    expect(result.findings.find((item: any) => item.key === priorA.key).first_seen_at).toBe(100);
    expect(result.findings.find((item: any) => item.key === currentNew.key).current.delta).toBe('new');
    const resolved = result.findings.find((item: any) => item.key === priorResolved.key);
    expect(resolved.current.delta).toBe('resolved');
    expect(resolved.status).toBe('closed');
    expect(resolved.approval_required).toBe(false);
  });

  it('does not falsely close a prior finding when that exact screen audit failed', () => {
    const prior = finding('web.design.tours.en.desktop-1280.overflow', 100);
    const previous = snapshot([prior]);
    const result = applyFindingDelta([], previous, 300, 'design-300-failed', new Set());
    const carried = result.findings.find((item: any) => item.key === prior.key);
    expect(carried.status).toBe('observed');
    expect(carried.current.delta).toBe('unknown');
    expect(carried.current.surface).toBe('tours');
    expect(carried.current.lang).toBe('en');
    expect(carried.current.viewport.id).toBe('desktop-1280');
    expect(carried.fact).toBe(prior.fact);
    expect(result.changed).toBe(false);

    const rechecked = finding(prior.key, 400);
    const afterSuccess = applyFindingDelta(
      [rechecked],
      snapshot([carried]),
      400,
      'design-400-rechecked',
      new Set(['tours|en|desktop-1280']),
    );
    expect(afterSuccess.findings.find((item: any) => item.key === prior.key).current.delta).toBe('unchanged');
  });

  it('marks the same finding key as updated when its measured value changes', () => {
    const prior = finding('web.design.home.ko.mobile-390.touch', 100);
    prior.current.measurement = { violation_count: 5 };
    const current = finding(prior.key, 300);
    current.current.measurement = { violation_count: 20 };
    const result = applyFindingDelta(
      [current],
      snapshot([prior]),
      300,
      'design-300-updated',
      new Set(['home|ko|mobile-390']),
    );
    const updated = result.findings.find((item: any) => item.key === prior.key);
    expect(updated.current.delta).toBe('updated');
    expect(updated.previous.measurement.violation_count).toBe(5);
    expect(result.changed).toBe(true);
  });
});
