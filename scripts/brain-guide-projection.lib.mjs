import { createHash } from 'node:crypto';
import { auditGuideHtml } from './guide-html-safety.mjs';
import { GUIDE_CANONICAL_BASE } from './sync-blog-guides.lib.mjs';

export const BRAIN_GUIDE_PROJECTION_SCHEMA_VERSION = 1;
export const BRAIN_GUIDE_QUALITY_RULES_VERSION = 'brain-content-quality-v1';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isoWithTimezone(value) {
  return nonEmpty(value)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function compareText(a, b) {
  const left = String(a);
  const right = String(b);
  const leftFolded = left.toLowerCase();
  const rightFolded = right.toLowerCase();
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function labelKey(value) {
  return String(value).normalize('NFKC').toLowerCase();
}

function kstDateFromIso(value) {
  if (!isoWithTimezone(value)) return '';
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  return new Date(Date.parse(value) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Brain/web slug fixture SSOT for new canonical guides. */
export function slugifyBrainGuideTitle(title) {
  const normalized = String(title || '')
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length <= 100) return normalized;
  let truncated = normalized.slice(0, 100);
  if (normalized[100] !== '-' && truncated.includes('-')) {
    truncated = truncated.slice(0, truncated.lastIndexOf('-'));
  }
  return truncated.replace(/-+$/g, '');
}

/** Contract hash = exact final safe HTML UTF-8 bytes, no JSON/key-order ambiguity. */
export function brainGuideHtmlSha256(html) {
  return createHash('sha256').update(String(html || ''), 'utf8').digest('hex');
}

export function validateBrainGuideProjection(manifest) {
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: [{ field: '$', message: 'manifest must be one JSON object' }], guide: null };
  }

  if (manifest.schemaVersion !== BRAIN_GUIDE_PROJECTION_SCHEMA_VERSION) {
    fail('schemaVersion', `must be numeric ${BRAIN_GUIDE_PROJECTION_SCHEMA_VERSION}`);
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(manifest.queueId || ''))) {
    fail('queueId', 'must match ^[A-Za-z0-9_-]{1,64}$');
  }
  if (!nonEmpty(manifest.title) || manifest.title.trim().length > 200 || /[<>]/.test(manifest.title)) {
    fail('title', 'must be 1-200 plain-text characters without angle brackets');
  }
  if (!nonEmpty(manifest.description)
    || manifest.description.trim().length > 500
    || /[<>]/.test(manifest.description)) {
    fail('description', 'must be 1-500 plain-text characters without angle brackets');
  }

  const expectedSlug = slugifyBrainGuideTitle(manifest.title);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(manifest.slug || ''))
    || String(manifest.slug || '').length > 100) {
    fail('slug', 'must match lowercase ASCII kebab-case and be at most 100 characters');
  } else if (manifest.slug !== expectedSlug) {
    fail('slug', `must equal deterministic title slug: ${expectedSlug}`);
  }

  const expectedCanonical = expectedSlug ? `${GUIDE_CANONICAL_BASE}/${expectedSlug}` : '';
  if (manifest.canonicalUrl !== expectedCanonical) {
    fail('canonicalUrl', `must equal ${expectedCanonical || `${GUIDE_CANONICAL_BASE}/<slug>`}`);
  }
  if (!validDateOnly(manifest.published)) fail('published', 'must be a real YYYY-MM-DD date');

  if (!Array.isArray(manifest.labels) || manifest.labels.length > 10
    || manifest.labels.some((label) => !nonEmpty(label)
      || label !== label.trim() || label.length > 60)) {
    fail('labels', 'must contain at most 10 trimmed non-empty strings of at most 60 characters');
  } else {
    const sorted = [...manifest.labels].sort(compareText);
    if (JSON.stringify(sorted) !== JSON.stringify(manifest.labels)) fail('labels', 'must be deterministically sorted');
    if (new Set(manifest.labels.map(labelKey)).size !== manifest.labels.length) {
      fail('labels', 'must not contain case-insensitive duplicates');
    }
  }

  if (!nonEmpty(manifest.html)) {
    fail('html', 'is required');
  } else {
    const htmlAudit = auditGuideHtml(manifest.html);
    if (htmlAudit.changed) fail('html', 'contains markup outside the shared safe allowlist');
  }

  const expectedHash = brainGuideHtmlSha256(manifest.html);
  if (!/^[a-f0-9]{64}$/.test(String(manifest.contentSha256 || ''))
    || manifest.contentSha256 !== expectedHash) {
    fail('contentSha256', `must equal SHA-256 of exact final HTML: ${expectedHash}`);
  }

  const review = manifest.review;
  if (!review || typeof review !== 'object' || review.verdict !== 'pass'
    || typeof review.score !== 'number' || !Number.isFinite(review.score) || review.score < 92) {
    fail('review', 'requires verdict=pass and numeric score>=92');
  }

  const approval = manifest.approval;
  if (!approval || typeof approval !== 'object'
    || !/^(?:discord|telegram):[0-9]{1,32}$/.test(String(approval.approvedBy || ''))
    || !isoWithTimezone(approval.approvedAt)) {
    fail('approval', 'requires discord:<uid> or telegram:<uid> and timezone-qualified ISO approvedAt');
  } else if (manifest.published !== kstDateFromIso(approval.approvedAt)) {
    fail('published', 'must equal the KST date of approval.approvedAt');
  }
  if (manifest.qualityRulesVersion !== BRAIN_GUIDE_QUALITY_RULES_VERSION) {
    fail('qualityRulesVersion', `must equal ${BRAIN_GUIDE_QUALITY_RULES_VERSION}`);
  }

  return { ok: errors.length === 0, errors, guide: errors.length === 0 ? manifest : null };
}
