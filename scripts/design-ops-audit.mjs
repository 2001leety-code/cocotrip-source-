#!/usr/bin/env node
/**
 * CocoTrip 주요 손님 화면 디자인 자동감사.
 *
 * 기본 대상은 로컬 서버다. 운영 사이트는 --allow-prod-readonly 를 함께 써야 한다.
 * 페이지를 열고 읽기만 하며 클릭, 폼 제출, 로그인, 결제, 외부 쓰기를 하지 않는다.
 * 브라우저가 자동으로 보내려는 비읽기 요청도 가로막아 보고서에 개수만 남긴다.
 */
import { chromium } from 'playwright';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_DESIGN_BASE_URL,
  assertReadonlyDesignTarget,
} from './design-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'config', 'design-surfaces.v1.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'reports', 'design-ops', 'latest.json');
const DEFAULT_MARKDOWN = path.join(ROOT, 'reports', 'design-ops', 'latest.md');
const DEFAULT_SCREENSHOTS = path.join(ROOT, 'reports', 'design-ops', 'screenshots');
const OPS_SCHEMA_VERSION = 'ops.v1';
const REQUIRED_LANGUAGES = ['ko', 'en', 'ja', 'zh'];
const EXPECTED_VIEWPORTS = new Map([
  ['mobile-390', { width: 390, height: 844 }],
  ['desktop-1280', { width: 1280, height: 800 }],
]);
const TELEMETRY_HOST_PARTS = [
  'posthog.com',
  'google-analytics.com',
  'googletagmanager.com',
  'sentry.io',
  'clarity.ms',
];
const ACTIVE_RUN_STATUSES = new Set(['queued', 'claimed', 'running', 'validating', 'awaiting_approval', 'stale']);
const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'partial', 'blocked', 'failed', 'skipped']);
const FINDING_STATUSES = new Set(['observed', 'proposed', 'approved', 'implementing', 'verified', 'released', 'measured', 'closed']);
const FINDING_SEVERITIES = new Set(['info', 'warning', 'critical']);

function valueAfter(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} 뒤에 값이 필요합니다.`);
  return value;
}

export function parseAuditArgs(argv = [], env = process.env) {
  const options = {
    baseUrl: env.DESIGN_AUDIT_BASE_URL || DEFAULT_DESIGN_BASE_URL,
    manifestPath: DEFAULT_MANIFEST,
    outputPath: DEFAULT_OUTPUT,
    markdownPath: DEFAULT_MARKDOWN,
    screenshotsPath: DEFAULT_SCREENSHOTS,
    previousPath: null,
    runId: env.DESIGN_AUDIT_RUN_ID || null,
    strict: false,
    allowProdReadonly: false,
    screenshots: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--allow-prod-readonly') options.allowProdReadonly = true;
    else if (arg === '--no-screenshots') options.screenshots = false;
    else if (arg === '--base-url') options.baseUrl = valueAfter(argv, index++, arg);
    else if (arg === '--manifest') options.manifestPath = valueAfter(argv, index++, arg);
    else if (arg === '--output') options.outputPath = valueAfter(argv, index++, arg);
    else if (arg === '--markdown') options.markdownPath = valueAfter(argv, index++, arg);
    else if (arg === '--screenshots-dir') options.screenshotsPath = valueAfter(argv, index++, arg);
    else if (arg === '--previous') options.previousPath = valueAfter(argv, index++, arg);
    else if (arg === '--run-id') options.runId = valueAfter(argv, index++, arg);
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }

  options.baseUrl = assertReadonlyDesignTarget(options.baseUrl, options.allowProdReadonly);
  options.manifestPath = path.resolve(ROOT, options.manifestPath);
  options.outputPath = path.resolve(ROOT, options.outputPath);
  options.markdownPath = path.resolve(ROOT, options.markdownPath);
  options.screenshotsPath = path.resolve(ROOT, options.screenshotsPath);
  options.previousPath = path.resolve(ROOT, options.previousPath || options.outputPath);
  return options;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredKeys(value, keys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label}: 객체가 아닙니다.`);
    return;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${label}.${key}: 필수값이 없습니다.`);
  }
}

export function validateManifest(manifest) {
  const errors = [];
  requiredKeys(manifest, ['schema_version', 'status', 'project', 'language_storage_key', 'languages', 'viewports', 'policy', 'surfaces'], 'manifest', errors);
  if (errors.length) return errors;
  if (manifest.schema_version !== 'cocotrip.design-surfaces.v1') errors.push('manifest.schema_version: 지원하지 않는 버전입니다.');
  if (manifest.status !== 'active') errors.push('manifest.status: active 여야 합니다.');
  if (manifest.project !== 'web') errors.push('manifest.project: web 이어야 합니다.');

  const languages = Array.isArray(manifest.languages) ? manifest.languages : [];
  if (languages.length !== REQUIRED_LANGUAGES.length || REQUIRED_LANGUAGES.some((lang) => !languages.includes(lang))) {
    errors.push('manifest.languages: ko/en/ja/zh 네 언어가 정확히 있어야 합니다.');
  }

  const viewports = Array.isArray(manifest.viewports) ? manifest.viewports : [];
  for (const [id, expected] of EXPECTED_VIEWPORTS) {
    const actual = viewports.find((viewport) => viewport && viewport.id === id);
    if (!actual || actual.width !== expected.width || actual.height !== expected.height) {
      errors.push(`manifest.viewports: ${id}=${expected.width}x${expected.height} 정본이 필요합니다.`);
    }
  }
  if (viewports.length !== EXPECTED_VIEWPORTS.size) errors.push('manifest.viewports: 정본 두 개만 허용합니다.');

  requiredKeys(manifest.policy, ['minimum_major_touch_px', 'navigation_timeout_ms', 'settle_timeout_ms', 'block_non_read_methods'], 'manifest.policy', errors);
  if (manifest.policy && manifest.policy.minimum_major_touch_px !== 44) errors.push('manifest.policy.minimum_major_touch_px: 44 여야 합니다.');
  if (manifest.policy && manifest.policy.block_non_read_methods !== true) errors.push('manifest.policy.block_non_read_methods: true 여야 합니다.');

  const surfaces = Array.isArray(manifest.surfaces) ? manifest.surfaces : [];
  if (!surfaces.length) errors.push('manifest.surfaces: 화면이 한 개 이상 필요합니다.');
  const ids = new Set();
  for (const [index, surface] of surfaces.entries()) {
    const label = `manifest.surfaces[${index}]`;
    requiredKeys(surface, ['id', 'path', 'status', 'audience', 'requirements'], label, errors);
    if (!surface || !isPlainObject(surface)) continue;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(surface.id || '')) errors.push(`${label}.id: 안정적인 소문자 키여야 합니다.`);
    if (ids.has(surface.id)) errors.push(`${label}.id: 중복 화면 키입니다.`);
    ids.add(surface.id);
    if (typeof surface.path !== 'string' || !surface.path.startsWith('/')) errors.push(`${label}.path: / 로 시작해야 합니다.`);
    if (surface.status !== 'active') errors.push(`${label}.status: 자동감사 대상은 active 여야 합니다.`);
    if (surface.audience !== 'public') errors.push(`${label}.audience: 실제 계정 없는 public 화면만 허용합니다.`);
    requiredKeys(surface.requirements, ['visible_h1', 'primary_action_selector'], `${label}.requirements`, errors);
    if (surface.requirements && surface.requirements.visible_h1 !== true) errors.push(`${label}.requirements.visible_h1: true 여야 합니다.`);
    if (surface.requirements && typeof surface.requirements.primary_action_selector !== 'string') errors.push(`${label}.requirements.primary_action_selector: CSS 선택자가 필요합니다.`);
  }
  return errors;
}

export function validateOpsSnapshot(snapshot) {
  const errors = [];
  const topKeys = ['schema_version', 'generated_at', 'project', 'job', 'run', 'summary', 'sources', 'findings'];
  requiredKeys(snapshot, topKeys, 'snapshot', errors);
  if (errors.length) return errors;
  const extras = Object.keys(snapshot).filter((key) => !topKeys.includes(key));
  if (extras.length) errors.push(`snapshot: 허용하지 않는 필드 ${extras.join(', ')}`);
  if (snapshot.schema_version !== OPS_SCHEMA_VERSION) errors.push('snapshot.schema_version: ops.v1 이어야 합니다.');
  if (!Number.isInteger(snapshot.generated_at) || snapshot.generated_at < 0) errors.push('snapshot.generated_at: UTC Unix 초여야 합니다.');
  if (snapshot.project !== 'web') errors.push('snapshot.project: web 이어야 합니다.');

  requiredKeys(snapshot.job, ['key', 'title', 'project', 'role', 'owner', 'scheduler_owner', 'schedule', 'write_scope', 'approval_required', 'stale_after_seconds', 'cost_ceiling_usd'], 'snapshot.job', errors);
  if (snapshot.job && snapshot.job.write_scope !== 'read_only') errors.push('snapshot.job.write_scope: read_only 여야 합니다.');
  requiredKeys(snapshot.run, ['id', 'dedupe_key', 'status', 'terminal', 'executor', 'started_at', 'heartbeat_at', 'finished_at', 'changed', 'error'], 'snapshot.run', errors);
  if (snapshot.run && TERMINAL_RUN_STATUSES.has(snapshot.run.status) && snapshot.run.terminal !== true) errors.push('snapshot.run.terminal: 종료 상태는 true 여야 합니다.');
  if (snapshot.run && ACTIVE_RUN_STATUSES.has(snapshot.run.status) && snapshot.run.terminal !== false) errors.push('snapshot.run.terminal: 진행 상태는 false 여야 합니다.');
  requiredKeys(snapshot.summary, ['status', 'changed', 'source_count', 'finding_count'], 'snapshot.summary', errors);

  if (!Array.isArray(snapshot.sources)) errors.push('snapshot.sources: 배열이어야 합니다.');
  else {
    for (const [index, source] of snapshot.sources.entries()) {
      requiredKeys(source, ['key', 'status', 'observed_at', 'last_attempt_at', 'last_success_at', 'freshness', 'metrics', 'evidence'], `snapshot.sources[${index}]`, errors);
      if (!Array.isArray(source && source.evidence) || !source.evidence.length) errors.push(`snapshot.sources[${index}].evidence: 한 개 이상 필요합니다.`);
    }
  }

  if (!Array.isArray(snapshot.findings)) errors.push('snapshot.findings: 배열이어야 합니다.');
  else {
    for (const [index, finding] of snapshot.findings.entries()) {
      requiredKeys(finding, ['key', 'dedupe_key', 'severity', 'status', 'fact', 'current', 'previous', 'proposed_action', 'approval_required', 'owner', 'first_seen_at', 'last_seen_at', 'next_check_at', 'estimated_cost_usd', 'risk_flags', 'evidence'], `snapshot.findings[${index}]`, errors);
      if (finding && !FINDING_SEVERITIES.has(finding.severity)) errors.push(`snapshot.findings[${index}].severity: enum 위반입니다.`);
      if (finding && !FINDING_STATUSES.has(finding.status)) errors.push(`snapshot.findings[${index}].status: enum 위반입니다.`);
      requiredKeys(finding && finding.risk_flags, ['privacy', 'payment', 'security', 'external_write'], `snapshot.findings[${index}].risk_flags`, errors);
      if (!Array.isArray(finding && finding.evidence) || !finding.evidence.length) errors.push(`snapshot.findings[${index}].evidence: 한 개 이상 필요합니다.`);
    }
  }

  if (snapshot.summary && Array.isArray(snapshot.sources) && snapshot.summary.source_count !== snapshot.sources.length) errors.push('snapshot.summary.source_count: sources 길이와 다릅니다.');
  if (snapshot.summary && Array.isArray(snapshot.findings) && snapshot.summary.finding_count !== snapshot.findings.length) errors.push('snapshot.summary.finding_count: findings 길이와 다릅니다.');
  return errors;
}

function stableHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function safeRunId(value, now) {
  const candidate = String(value || '').toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  if (candidate && /^[a-z0-9]/.test(candidate)) return candidate.slice(0, 160);
  return `design-${now}-${randomBytes(4).toString('hex')}`;
}

function sourceKey(surface, lang, viewport) {
  return `web.design.${surface}.${lang}.${viewport}`;
}

function findingKey(surface, lang, viewport, rule) {
  return `web.design.${surface}.${lang}.${viewport}.${rule}`;
}

function httpEvidence(url, observedAt, lang, viewport) {
  return {
    kind: 'http',
    ref: `${url} [lang=${lang},viewport=${viewport}]`.slice(0, 500),
    observed_at: observedAt,
    read_only: true,
  };
}

function fileEvidence(ref, observedAt) {
  return {
    kind: 'file',
    ref: ref.slice(0, 500),
    observed_at: observedAt,
    read_only: true,
  };
}

function createFinding(context, rule, severity, fact, proposedAction, measurement, approvalRequired = true) {
  const key = findingKey(context.surface.id, context.lang, context.viewport.id, rule);
  return {
    key,
    dedupe_key: key,
    severity,
    status: 'observed',
    fact,
    current: {
      delta: 'new',
      run_id: context.runId,
      source: 'playwright-readonly',
      base_url: context.baseUrl,
      surface: context.surface.id,
      route: context.surface.path,
      lang: context.lang,
      viewport: {
        id: context.viewport.id,
        width: context.viewport.width,
        height: context.viewport.height,
      },
      rule,
      finding_key: key,
      measurement,
    },
    previous: null,
    proposed_action: proposedAction,
    approval_required: approvalRequired,
    owner: 'design-team',
    first_seen_at: context.observedAt,
    last_seen_at: context.observedAt,
    next_check_at: context.observedAt + 604800,
    estimated_cost_usd: null,
    risk_flags: {
      privacy: false,
      payment: false,
      security: false,
      external_write: false,
    },
    evidence: [...context.evidence],
  };
}

function parsePostBody(postData) {
  if (postData && typeof postData === 'object') return postData;
  if (typeof postData !== 'string' || !postData.trim()) return null;
  try {
    const parsed = JSON.parse(postData);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isKnownReadOnlyPost(urlString, postData) {
  try {
    const url = new URL(urlString);
    const firestoreRead = url.hostname.endsWith('googleapis.com')
      && (url.pathname.includes('/google.firestore.v1.Firestore/Listen/channel')
        || url.pathname.includes(':runQuery')
        || url.pathname.includes(':batchGet'));
    if (firestoreRead) return true;

    const cocotripHost = url.hostname === 'cocotripkr.com'
      || url.hostname === 'www.cocotripkr.com'
      || url.hostname === '127.0.0.1'
      || url.hostname === 'localhost';
    const body = parsePostBody(postData);
    return cocotripHost
      && url.pathname === '/api/reviews'
      && (body?.action === 'list' || body?.action === 'aggregate');
  } catch {
    return false;
  }
}

function isTelemetryUrl(urlString) {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase();
    return TELEMETRY_HOST_PARTS.some((part) => hostname === part || hostname.endsWith(`.${part}`));
  } catch {
    return false;
  }
}

export function classifyRequestForReadonly(method, url, postData = null) {
  const normalizedMethod = String(method || '').toUpperCase();
  if (isTelemetryUrl(url)) return 'block_telemetry';
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') return 'allow_read';
  if (normalizedMethod === 'POST' && isKnownReadOnlyPost(url, postData)) return 'allow_read';
  return 'block_non_read';
}

export function isUnexpectedFinalOrigin(baseUrl, finalUrl) {
  try {
    return new URL(finalUrl).origin !== new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export async function collectPageMetrics(page, primarySelector, minimumTouchPx, viewport) {
  return page.evaluate(({ selector, minTouch, viewportSize }) => {
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        top: Math.round(rect.top * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        in_first_viewport: rect.top < viewportSize.height && rect.bottom > 0,
      };
    };
    const domKey = (element) => {
      const testId = element.getAttribute('data-testid');
      if (testId) return `[data-testid=${testId}]`;
      if (element.id) return `#${element.id}`;
      const originCode = element.getAttribute('data-origin-code');
      if (originCode) return `[data-origin-code=${originCode}]`;
      const name = element.getAttribute('name');
      if (name) return `${element.tagName.toLowerCase()}[name=${name}]`;
      const parts = [];
      let current = element;
      for (let depth = 0; depth < 5 && current && current instanceof HTMLElement; depth += 1) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join('>');
    };
    const label = (element) => {
      const text = element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.getAttribute('placeholder')
        || element.textContent
        || '';
      return text.trim().replace(/\s+/g, ' ').slice(0, 120);
    };
    const referencedLabel = (element) => {
      const ids = (element.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
      return ids.map((id) => {
        const target = document.getElementById(id);
        return target ? (target.textContent || '').trim() : '';
      }).filter(Boolean).join(' ');
    };
    const formControlName = (element) => {
      const labels = 'labels' in element && element.labels ? Array.from(element.labels) : [];
      const imageAlt = element.querySelector('img[alt]');
      return (element.getAttribute('aria-label') || '').trim()
        || referencedLabel(element)
        || labels.map((item) => (item.textContent || '').trim()).filter(Boolean).join(' ')
        || (imageAlt ? (imageAlt.getAttribute('alt') || '').trim() : '');
    };
    const buttonName = (element) => {
      const imageAlt = element.querySelector('img[alt]');
      return (element.getAttribute('aria-label') || '').trim()
        || referencedLabel(element)
        || (element.getAttribute('title') || '').trim()
        || (element.textContent || '').trim()
        || (imageAlt ? (imageAlt.getAttribute('alt') || '').trim() : '')
        || (element instanceof HTMLInputElement ? element.value.trim() : '');
    };

    let primaryElements = [];
    let selectorError = null;
    try {
      primaryElements = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    } catch (error) {
      selectorError = error instanceof Error ? error.message : String(error);
    }

    const h1Elements = Array.from(document.querySelectorAll('h1')).filter(isVisible);
    const candidateSelector = [
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="checkbox"]',
    ].join(',');
    const candidates = new Set(Array.from(document.querySelectorAll(candidateSelector)).filter(isVisible));
    for (const element of primaryElements) candidates.add(element);
    const touchViolations = [];
    for (const element of candidates) {
      const geometry = box(element);
      if (geometry.width < minTouch || geometry.height < minTouch) {
        touchViolations.push({
          key: domKey(element),
          tag: element.tagName.toLowerCase(),
          label: label(element),
          width: geometry.width,
          height: geometry.height,
          is_primary: primaryElements.includes(element),
        });
      }
    }
    touchViolations.sort((left, right) => `${left.key}|${left.label}`.localeCompare(`${right.key}|${right.label}`));

    const formControls = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea')).filter(isVisible);
    const formControlLabelMissing = formControls
      .filter((element) => !formControlName(element))
      .map((element) => ({ key: domKey(element), tag: element.tagName.toLowerCase(), placeholder: element.getAttribute('placeholder') || '' }));
    const namedButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isVisible);
    const buttonNameMissing = namedButtons
      .filter((element) => !buttonName(element))
      .map((element) => ({ key: domKey(element), tag: element.tagName.toLowerCase() }));

    const documentElement = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(documentElement.scrollWidth, body ? body.scrollWidth : 0);
    const clientWidth = documentElement.clientWidth;
    const documentHeight = Math.max(documentElement.scrollHeight, body ? body.scrollHeight : 0);
    return {
      selector_error: selectorError,
      html_lang: documentElement.lang || '',
      visible_h1_count: h1Elements.length,
      h1: h1Elements.length ? { text: label(h1Elements[0]), ...box(h1Elements[0]) } : null,
      primary_action_selector: selector,
      visible_primary_action_count: primaryElements.length,
      primary_action: primaryElements.length ? { text: label(primaryElements[0]), ...box(primaryElements[0]) } : null,
      major_touch_target_count: candidates.size,
      touch_violation_count: touchViolations.length,
      touch_violations: touchViolations.slice(0, 25),
      touch_violations_truncated: touchViolations.length > 25,
      form_control_count: formControls.length,
      form_control_label_missing_count: formControlLabelMissing.length,
      form_control_label_missing: formControlLabelMissing.slice(0, 25),
      button_count: namedButtons.length,
      button_accessible_name_missing_count: buttonNameMissing.length,
      button_accessible_name_missing: buttonNameMissing.slice(0, 25),
      horizontal_overflow_px: Math.max(0, scrollWidth - clientWidth),
      document_width: scrollWidth,
      viewport_width: clientWidth,
      document_height: documentHeight,
    };
  }, { selector: primarySelector, minTouch: minimumTouchPx, viewportSize: viewport });
}

function findingsForMetrics(context, metrics, runtime) {
  const findings = [];
  if (runtime.navigationError) {
    findings.push(createFinding(
      context,
      'navigation_failed',
      'critical',
      `${context.surface.id} ${context.lang} ${context.viewport.id} 화면 탐색에 실패했습니다.`,
      '감사 대상 주소와 운영 상태를 확인한 뒤 다시 실행합니다.',
      { error: runtime.navigationError },
    ));
    return findings;
  }
  if (runtime.httpStatus < 200 || runtime.httpStatus >= 400) {
    findings.push(createFinding(
      context,
      'unexpected_http_status',
      'critical',
      `${context.surface.id} 화면이 HTTP ${runtime.httpStatus}를 반환했습니다.`,
      '해당 공개 경로의 응답 상태와 배포를 확인합니다.',
      { http_status: runtime.httpStatus, final_url: runtime.finalUrl },
    ));
  }
  if (runtime.originMismatch) {
    findings.push(createFinding(
      context,
      'unexpected_origin_redirect',
      'critical',
      `${context.surface.id} 화면이 감사 기준 주소와 다른 출처로 이동했습니다.`,
      '리디렉션 설정과 감사 대상 주소를 확인한 뒤 다시 실행합니다.',
      { expected_origin: runtime.expectedOrigin, final_origin: runtime.finalOrigin, final_url: runtime.finalUrl },
    ));
  }
  if (metrics.selector_error) {
    findings.push(createFinding(
      context,
      'manifest_selector_invalid',
      'critical',
      `${context.surface.id}의 주 행동 선택자를 해석하지 못했습니다.`,
      '화면 정본의 primary_action_selector를 실제 DOM에 맞게 고칩니다.',
      { selector: metrics.primary_action_selector, error: metrics.selector_error },
    ));
  }
  if (metrics.visible_h1_count === 0) {
    findings.push(createFinding(
      context,
      'visible_h1_missing',
      'warning',
      `${context.surface.id} ${context.lang} 화면에서 보이는 H1을 찾지 못했습니다.`,
      '페이지 핵심 목적을 설명하는 H1을 한 개 제공하고 네 언어에서 확인합니다.',
      { visible_h1_count: 0 },
    ));
  }
  if (metrics.visible_primary_action_count === 0) {
    findings.push(createFinding(
      context,
      'primary_action_missing',
      'warning',
      `${context.surface.id} ${context.lang} 화면에서 정본 주 행동을 찾지 못했습니다.`,
      '정본 선택자와 실제 주 버튼을 맞추고 첫 고객 행동이 분명한지 확인합니다.',
      { selector: metrics.primary_action_selector, visible_count: 0 },
    ));
  } else if (metrics.primary_action && !metrics.primary_action.in_first_viewport) {
    findings.push(createFinding(
      context,
      'primary_action_below_fold',
      'warning',
      `${context.surface.id} ${context.lang}의 주 행동이 첫 화면 아래에 있습니다.`,
      '핵심 버튼이나 상품 진입점을 첫 화면 안으로 올릴지 전환 자료와 함께 검토합니다.',
      metrics.primary_action,
    ));
  }
  if (metrics.html_lang !== context.lang) {
    findings.push(createFinding(
      context,
      'document_language_mismatch',
      'warning',
      `${context.surface.id} 화면의 문서 언어(${metrics.html_lang || '없음'})가 요청 언어(${context.lang})와 다릅니다.`,
      '문서 html lang 속성을 실제 표시 언어와 동기화합니다.',
      { expected: context.lang, actual: metrics.html_lang || null },
    ));
  }
  if (metrics.touch_violation_count > 0) {
    findings.push(createFinding(
      context,
      'major_touch_target_under_44',
      'warning',
      `${context.surface.id} ${context.lang}에서 44px 미만 주요 조작부 ${metrics.touch_violation_count}개를 확인했습니다.`,
      '버튼·입력·탭의 실제 누를 수 있는 영역을 최소 44px로 넓힙니다.',
      {
        minimum_px: 44,
        violation_count: metrics.touch_violation_count,
        sample: metrics.touch_violations,
        truncated: metrics.touch_violations_truncated,
      },
    ));
  }
  if (metrics.form_control_label_missing_count > 0) {
    findings.push(createFinding(
      context,
      'form_control_label_missing',
      'warning',
      `${context.surface.id} ${context.lang}에서 연결된 이름표가 없는 입력 요소 ${metrics.form_control_label_missing_count}개를 확인했습니다.`,
      '각 입력에 label, aria-label 또는 aria-labelledby를 연결하고 placeholder만 이름표로 쓰지 않습니다.',
      { count: metrics.form_control_label_missing_count, sample: metrics.form_control_label_missing },
    ));
  }
  if (metrics.button_accessible_name_missing_count > 0) {
    findings.push(createFinding(
      context,
      'button_accessible_name_missing',
      'warning',
      `${context.surface.id} ${context.lang}에서 접근 가능한 이름이 없는 버튼 ${metrics.button_accessible_name_missing_count}개를 확인했습니다.`,
      '아이콘 버튼을 포함한 모든 버튼에 화면 낭독기가 읽을 수 있는 이름을 제공합니다.',
      { count: metrics.button_accessible_name_missing_count, sample: metrics.button_accessible_name_missing },
    ));
  }
  if (metrics.horizontal_overflow_px > 1) {
    findings.push(createFinding(
      context,
      'document_horizontal_overflow',
      'warning',
      `${context.surface.id} ${context.lang} 문서가 뷰포트보다 ${metrics.horizontal_overflow_px}px 넓습니다.`,
      '의도하지 않은 전체 페이지 가로 넘침 요소를 찾아 반응형 폭을 고칩니다.',
      { overflow_px: metrics.horizontal_overflow_px, document_width: metrics.document_width, viewport_width: metrics.viewport_width },
    ));
  }
  if (runtime.consoleErrors.length) {
    findings.push(createFinding(
      context,
      'console_error',
      'critical',
      `${context.surface.id} ${context.lang} 화면에서 console.error ${runtime.consoleErrors.length}건이 발생했습니다.`,
      '오류 로그의 원인을 고치고 같은 읽기 전용 감사에서 0건인지 확인합니다.',
      { count: runtime.consoleErrors.length, sample: runtime.consoleErrors.slice(0, 10) },
    ));
  }
  if (runtime.pageErrors.length) {
    findings.push(createFinding(
      context,
      'page_javascript_error',
      'critical',
      `${context.surface.id} ${context.lang} 화면에서 처리되지 않은 자바스크립트 오류 ${runtime.pageErrors.length}건이 발생했습니다.`,
      '페이지 오류 원인을 고치고 같은 읽기 전용 감사에서 0건인지 확인합니다.',
      { count: runtime.pageErrors.length, sample: runtime.pageErrors.slice(0, 10) },
    ));
  }
  return findings;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadPrevious(filePath) {
  if (!(await exists(filePath))) return null;
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  if (!parsed || parsed.schema_version !== OPS_SCHEMA_VERSION || !Array.isArray(parsed.findings)) return null;
  return parsed;
}

function findingScope(finding) {
  const current = finding && isPlainObject(finding.current) ? finding.current : {};
  const viewport = current && isPlainObject(current.viewport) ? current.viewport.id : null;
  if (!current.surface || !current.lang || !viewport) return null;
  return `${current.surface}|${current.lang}|${viewport}`;
}

function stableComparable(value) {
  if (Array.isArray(value)) return value.map(stableComparable);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['delta', 'run_id', 'reason'].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableComparable(item)]),
  );
}

function sameMaterialCurrent(left, right) {
  return JSON.stringify(stableComparable(left)) === JSON.stringify(stableComparable(right));
}

export function applyFindingDelta(currentFindings, previousSnapshot, observedAt, runId, successfulScopes = new Set()) {
  const previousFindings = previousSnapshot && Array.isArray(previousSnapshot.findings)
    ? previousSnapshot.findings
    : [];
  const previousOpen = new Map(previousFindings.filter((finding) => finding && finding.status !== 'closed').map((finding) => [finding.dedupe_key, finding]));
  const currentKeys = new Set();
  let changed = false;

  for (const finding of currentFindings) {
    currentKeys.add(finding.dedupe_key);
    const previous = previousOpen.get(finding.dedupe_key);
    if (previous) {
      const unchanged = sameMaterialCurrent(finding.current, previous.current);
      finding.current.delta = unchanged ? 'unchanged' : 'updated';
      finding.previous = previous.current;
      finding.first_seen_at = previous.first_seen_at || finding.first_seen_at;
      finding.status = FINDING_STATUSES.has(previous.status) ? previous.status : 'observed';
      if (!unchanged) changed = true;
    } else {
      finding.current.delta = 'new';
      changed = true;
    }
  }

  const resolved = [];
  for (const previous of previousOpen.values()) {
    if (currentKeys.has(previous.dedupe_key)) continue;
    const scope = findingScope(previous);
    if (!scope || !successfulScopes.has(scope)) {
      resolved.push({
        ...previous,
        current: {
          ...previous.current,
          delta: 'unknown',
          run_id: runId,
          reason: '해당 화면 조합의 재검사가 성공하지 않아 해결 여부를 판정하지 않음',
        },
        previous: previous.current,
        next_check_at: observedAt + 604800,
        evidence: [{
          kind: 'test',
          ref: `design audit ${runId}: scope not successfully rechecked`,
          observed_at: observedAt,
          read_only: true,
        }],
      });
      continue;
    }
    changed = true;
    resolved.push({
      ...previous,
      severity: 'info',
      status: 'closed',
      fact: `이전 디자인 감사 항목이 이번 실행에서 다시 발견되지 않았습니다: ${previous.fact}`.slice(0, 2000),
      current: {
        delta: 'resolved',
        source: 'playwright-readonly',
        run_id: runId,
      },
      previous: previous.current,
      proposed_action: '같은 자동감사를 유지해 회귀를 확인합니다.',
      approval_required: false,
      last_seen_at: observedAt,
      next_check_at: observedAt + 604800,
      evidence: [{
        kind: 'test',
        ref: `design audit ${runId}: matching dedupe_key absent`,
        observed_at: observedAt,
        read_only: true,
      }],
    });
  }
  return { findings: [...currentFindings, ...resolved], changed };
}

function sourceStatus(findings, auditFailed) {
  if (auditFailed) return 'error';
  return findings.length ? 'warning' : 'ok';
}

function summaryStatus(findings, auditFailed) {
  if (auditFailed || findings.some((finding) => finding.severity === 'critical' && finding.status !== 'closed')) return 'critical';
  if (findings.some((finding) => finding.status !== 'closed')) return 'warning';
  return 'ok';
}

function reportJob() {
  return {
    key: 'design.web.weekly-audit',
    title: '웹 주요 화면 주간 디자인 자동감사',
    project: 'web',
    role: 'design.release_verifier',
    owner: 'design-team',
    scheduler_owner: 'github-actions',
    schedule: {
      kind: 'cron',
      expression: '0 1 * * 1',
      timezone: 'Asia/Seoul',
      interval_seconds: null,
    },
    write_scope: 'read_only',
    approval_required: false,
    stale_after_seconds: 691200,
    cost_ceiling_usd: null,
  };
}

async function auditOne(browser, options, manifest, surface, lang, viewport, runId, observedAt) {
  const localeMap = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: localeMap[lang] || 'en-US',
    serviceWorkers: 'block',
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { DNT: '1' },
  });
  await context.addInitScript(({ language, storageKey }) => {
    try {
      localStorage.setItem(storageKey, language);
      localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    } catch {
      // 브라우저 저장소가 막혀도 감사 자체는 계속한다.
    }
  }, { language: lang, storageKey: manifest.language_storage_key });

  const page = await context.newPage();
  const blockedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const decision = classifyRequestForReadonly(request.method(), request.url(), request.postData());
    if (decision === 'allow_read') {
      await route.continue();
      return;
    }
    blockedRequests.push({ method: request.method(), url: request.url().slice(0, 300), reason: decision });
    if (decision === 'block_telemetry') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.abort('blockedbyclient');
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500));
  });
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));

  const requestedUrl = new URL(surface.path, `${options.baseUrl}/`).href;
  const evidence = [httpEvidence(requestedUrl, observedAt, lang, viewport.id)];
  const auditContext = { baseUrl: options.baseUrl, surface, lang, viewport, observedAt, runId, evidence };
  let response = null;
  let navigationError = null;
  let metrics = {
    selector_error: null,
    html_lang: '',
    visible_h1_count: 0,
    h1: null,
    primary_action_selector: surface.requirements.primary_action_selector,
    visible_primary_action_count: 0,
    primary_action: null,
    major_touch_target_count: 0,
    touch_violation_count: 0,
    touch_violations: [],
    touch_violations_truncated: false,
    form_control_count: 0,
    form_control_label_missing_count: 0,
    form_control_label_missing: [],
    button_count: 0,
    button_accessible_name_missing_count: 0,
    button_accessible_name_missing: [],
    horizontal_overflow_px: 0,
    document_width: 0,
    viewport_width: viewport.width,
    document_height: 0,
  };
  let screenshotRef = null;

  try {
    response = await page.goto(requestedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: manifest.policy.navigation_timeout_ms,
    });
    await page.waitForFunction(() => !!document.body && document.body.innerText.trim().length > 0, null, {
      timeout: manifest.policy.settle_timeout_ms,
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(300);
    metrics = await collectPageMetrics(page, surface.requirements.primary_action_selector, manifest.policy.minimum_major_touch_px, viewport);

    if (options.screenshots) {
      const runDir = path.join(options.screenshotsPath, runId);
      await mkdir(runDir, { recursive: true });
      const screenshotPath = path.join(runDir, `${surface.id}-${lang}-${viewport.id}.jpg`);
      await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 65, fullPage: false });
      screenshotRef = path.relative(ROOT, screenshotPath).replace(/\\/g, '/');
      evidence.push(fileEvidence(screenshotRef, observedAt));
    }
  } catch (error) {
    navigationError = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  }

  const runtime = {
    navigationError,
    httpStatus: response ? response.status() : 0,
    finalUrl: page.url(),
    expectedOrigin: new URL(options.baseUrl).origin,
    finalOrigin: (() => {
      try { return new URL(page.url()).origin; } catch { return ''; }
    })(),
    consoleErrors,
    pageErrors,
  };
  runtime.originMismatch = !!runtime.finalOrigin && isUnexpectedFinalOrigin(options.baseUrl, runtime.finalUrl);
  const findings = findingsForMetrics(auditContext, metrics, runtime);
  const auditFailed = !!navigationError
    || runtime.httpStatus < 200
    || runtime.httpStatus >= 400
    || runtime.originMismatch
    || !!metrics.selector_error
    || consoleErrors.length > 0
    || pageErrors.length > 0;
  const source = {
    key: sourceKey(surface.id, lang, viewport.id),
    status: sourceStatus(findings, auditFailed),
    observed_at: observedAt,
    last_attempt_at: observedAt,
    last_success_at: auditFailed ? null : observedAt,
    freshness: {
      state: auditFailed ? 'unknown' : 'fresh',
      age_seconds: auditFailed ? null : 0,
      stale_after_seconds: 691200,
    },
    metrics: {
      source: 'playwright-readonly',
      base_url: options.baseUrl,
      surface: surface.id,
      route: surface.path,
      surface_status: surface.status,
      lang,
      viewport: { id: viewport.id, width: viewport.width, height: viewport.height },
      requested_url: requestedUrl,
      final_url: runtime.finalUrl,
      http_status: runtime.httpStatus,
      screenshot: screenshotRef,
      blocked_external_write_count: blockedRequests.length,
      blocked_requests: blockedRequests.slice(0, 20),
      console_errors: consoleErrors,
      page_errors: pageErrors,
      contrast_audit: {
        status: 'not_checked',
        reason: 'gradient/backdrop 픽셀 측정의 오탐 위험이 있어 이번 자동감사에서는 판정하지 않음',
      },
      ...metrics,
    },
    evidence,
  };
  await context.close();
  return { source, findings, auditFailed };
}

export async function runDesignAudit(options, manifest, previousSnapshot = null) {
  const startedAt = Math.floor(Date.now() / 1000);
  const runId = safeRunId(options.runId, startedAt);
  const sources = [];
  const currentFindings = [];
  const successfulScopes = new Set();
  let auditFailed = false;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of manifest.viewports) {
      for (const lang of manifest.languages) {
        for (const surface of manifest.surfaces.filter((item) => item.status === 'active')) {
          const result = await auditOne(browser, options, manifest, surface, lang, viewport, runId, startedAt);
          sources.push(result.source);
          currentFindings.push(...result.findings);
          auditFailed = auditFailed || result.auditFailed;
          if (!result.auditFailed) successfulScopes.add(`${surface.id}|${lang}|${viewport.id}`);
          const label = `${surface.id}/${lang}/${viewport.id}`;
          process.stdout.write(`${result.auditFailed ? 'FAIL' : 'OK'} ${label} findings=${result.findings.length}\n`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const finishedAt = Math.floor(Date.now() / 1000);
  const delta = applyFindingDelta(currentFindings, previousSnapshot, finishedAt, runId, successfulScopes);
  const runStatus = auditFailed ? 'failed' : 'succeeded';
  const report = {
    schema_version: OPS_SCHEMA_VERSION,
    generated_at: finishedAt,
    project: 'web',
    job: reportJob(),
    run: {
      id: runId,
      dedupe_key: `design.web.weekly-audit:${Math.floor(startedAt / 604800)}`,
      status: runStatus,
      terminal: true,
      executor: {
        kind: 'script',
        name: 'web.design-ops-audit',
        version: '1',
      },
      started_at: startedAt,
      heartbeat_at: finishedAt,
      finished_at: finishedAt,
      changed: delta.changed,
      error: auditFailed ? {
        code: 'design.audit-failure',
        message: '한 개 이상의 화면에서 탐색·HTTP·선택자·자바스크립트 오류가 발생했습니다.',
        retryable: true,
      } : null,
    },
    summary: {
      status: summaryStatus(delta.findings, auditFailed),
      changed: delta.changed,
      source_count: sources.length,
      finding_count: delta.findings.length,
    },
    sources,
    findings: delta.findings,
  };
  return { report, auditFailed, strictFailed: options.strict && delta.findings.some((finding) => finding.status !== 'closed') };
}

function markdownEscape(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function buildMarkdown(report) {
  const activeFindings = report.findings.filter((finding) => finding.status !== 'closed');
  const newCount = activeFindings.filter((finding) => finding.current && finding.current.delta === 'new').length;
  const updatedCount = activeFindings.filter((finding) => finding.current && finding.current.delta === 'updated').length;
  const unchangedCount = activeFindings.filter((finding) => finding.current && finding.current.delta === 'unchanged').length;
  const resolvedCount = report.findings.filter((finding) => finding.status === 'closed' && finding.current && finding.current.delta === 'resolved').length;
  const blockedWrites = report.sources.reduce((sum, source) => sum + Number(source.metrics.blocked_external_write_count || 0), 0);
  const screenshotCount = report.sources.filter((source) => !!source.metrics.screenshot).length;
  const lines = [
    '# CocoTrip 주간 디자인 자동감사',
    '',
    `- 실행 상태: **${report.run.status}**`,
    `- 화면 조합: **${report.sources.length}개**`,
    `- 현재 개선점: **${activeFindings.length}개** (새 항목 ${newCount}, 측정 변화 ${updatedCount}, 유지 ${unchangedCount})`,
    `- 해결 확인: **${resolvedCount}개**`,
    `- 첫 화면 스크린샷: **${screenshotCount}장**`,
    `- 브라우저 자동 비읽기 요청 차단: **${blockedWrites}건**`,
    '- 클릭·폼 제출·로그인·결제·외부 알림: **0건**',
    '',
  ];
  if (!activeFindings.length) {
    lines.push('현재 열린 디자인 개선점이 없습니다.', '');
  } else {
    lines.push('| 심각도 | 화면 | 언어 | 화면 크기 | 변화 | 확인 사실 |', '|---|---|---|---|---|---|');
    for (const finding of activeFindings.slice(0, 120)) {
      const current = finding.current || {};
      const viewport = current.viewport && current.viewport.id ? current.viewport.id : '-';
      lines.push(`| ${finding.severity} | ${markdownEscape(current.surface || '-')} | ${markdownEscape(current.lang || '-')} | ${markdownEscape(viewport)} | ${markdownEscape(current.delta || '-')} | ${markdownEscape(finding.fact)} |`);
    }
    if (activeFindings.length > 120) lines.push('', `표에 생략된 항목 ${activeFindings.length - 120}개는 JSON에서 확인합니다.`);
    lines.push('');
  }
  lines.push('> 개선점 자체는 자동으로 고치지 않습니다. 탐색·HTTP·선택자·자바스크립트 오류만 실행 실패로 처리합니다.', '');
  return lines.join('\n');
}

async function writeReport(options, report) {
  const contractErrors = validateOpsSnapshot(report);
  if (contractErrors.length) throw new Error(`ops.v1 계약 위반:\n- ${contractErrors.join('\n- ')}`);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await mkdir(path.dirname(options.markdownPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(options.markdownPath, `${buildMarkdown(report)}\n`, 'utf8');
}

async function main() {
  const options = parseAuditArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'));
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) throw new Error(`화면 정본 계약 위반:\n- ${manifestErrors.join('\n- ')}`);
  const previous = await loadPrevious(options.previousPath);
  const result = await runDesignAudit(options, manifest, previous);
  await writeReport(options, result.report);
  process.stdout.write(`report=${options.outputPath}\nmarkdown=${options.markdownPath}\n`);
  if (result.auditFailed) process.exitCode = 2;
  else if (result.strictFailed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 2;
  });
}
