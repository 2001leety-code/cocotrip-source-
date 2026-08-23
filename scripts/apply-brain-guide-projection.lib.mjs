import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateBrainGuideProjection } from './brain-guide-projection.lib.mjs';
import { buildIndexFromLocalMeta, GUIDE_CANONICAL_BASE } from './sync-blog-guides.lib.mjs';

const PROJECTION_LOCK_NAME = '.guide-projection.lock';
const DEFAULT_LOCK_WAIT_MS = 15_000;
const DEFAULT_LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_POLL_MS = 50;
const LOCK_SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function projectionError(message) {
  return new Error(`Brain guide projection refused: ${message}`);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw projectionError(`${label} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function serializeIndex(docs) {
  return JSON.stringify(buildIndexFromLocalMeta(docs), null, 1).replace(/\n/g, '\r\n');
}

function sitemapGuideCount(sitemap, canonicalUrl) {
  const escaped = canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (sitemap.match(new RegExp(`<loc>${escaped}</loc>`, 'g')) || []).length;
}

function appendGuideToSitemap(sitemap, canonicalUrl) {
  if (sitemapGuideCount(sitemap, canonicalUrl) !== 0) {
    throw projectionError(`sitemap already contains ${canonicalUrl}`);
  }
  const newline = sitemap.includes('\r\n') ? '\r\n' : '\n';
  const lines = sitemap.split(/\r?\n/);
  let lastGuide = -1;
  lines.forEach((line, index) => {
    if (line.includes(`${GUIDE_CANONICAL_BASE}/`)) lastGuide = index;
  });
  if (lastGuide === -1) throw projectionError('sitemap has no existing /guide/<slug> entry');
  lines.splice(lastGuide + 1, 0, `  <url><loc>${canonicalUrl}</loc></url>`);
  return lines.join(newline);
}

/** Exact public guide document produced from one already-validated Brain manifest. */
export function brainProjectionToGuideDoc(manifest) {
  const validation = validateBrainGuideProjection(manifest);
  if (!validation.ok) {
    const details = validation.errors.map((error) => `${error.field}: ${error.message}`).join('; ');
    throw projectionError(details);
  }

  return {
    slug: manifest.slug,
    title: manifest.title,
    description: manifest.description,
    published: manifest.published,
    updated: manifest.published,
    labels: [...manifest.labels],
    contentSha256: manifest.contentSha256,
    projection: {
      schemaVersion: manifest.schemaVersion,
      // Raw queue/approver IDs stay only in Brain, the audit SSOT. The public bundle keeps
      // a one-way queue reference solely for same-queue idempotence.
      queueIdSha256: sha256Text(manifest.queueId),
    },
    html: manifest.html,
  };
}

function assertTargetWithinRoot(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw projectionError(`write target escapes project root: ${target}`);
  }
}

function removeIfExists(file) {
  if (existsSync(file)) unlinkSync(file);
}

function sleepSync(milliseconds) {
  if (milliseconds > 0) Atomics.wait(LOCK_SLEEP_BUFFER, 0, 0, milliseconds);
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this user cannot signal it. Only ESRCH is
    // proof that the recorded owner is gone; every ambiguous result stays fail-closed.
    return !(error && error.code === 'ESRCH');
  }
}

function inspectProjectionLock(lockPath, staleAfterMs) {
  let stats;
  try {
    stats = lstatSync(lockPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) return { state: 'busy', reason: 'lock path is not a regular file' };

  const raw = readFileSync(lockPath, 'utf8');
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    return { state: 'busy', reason: 'lock metadata is malformed' };
  }
  if (!metadata
    || !Number.isInteger(metadata.pid)
    || metadata.pid <= 0
    || !Number.isFinite(metadata.acquiredAtMs)
    || typeof metadata.token !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(metadata.token)) {
    return { state: 'busy', reason: 'lock metadata is invalid' };
  }

  const ageMs = Date.now() - metadata.acquiredAtMs;
  if (ageMs <= staleAfterMs || processIsRunning(metadata.pid)) {
    return { state: 'busy', reason: `owned by pid ${metadata.pid}` };
  }
  return { state: 'stale', raw, metadata };
}

function reclaimStaleProjectionLock(lockPath, observed) {
  const quarantinePath = `${lockPath}.${randomUUID()}.stale`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }

  const movedRaw = readFileSync(quarantinePath, 'utf8');
  if (movedRaw !== observed.raw) {
    // Never delete a lock whose identity changed between inspection and atomic rename.
    if (!existsSync(lockPath)) renameSync(quarantinePath, lockPath);
    throw projectionError('projection lock changed during stale recovery');
  }
  unlinkSync(quarantinePath);
  return true;
}

function acquireProjectionLock(root, { lockWaitMs, lockStaleMs } = {}) {
  const waitMs = Number.isFinite(lockWaitMs) && lockWaitMs >= 0
    ? lockWaitMs
    : DEFAULT_LOCK_WAIT_MS;
  const staleAfterMs = Number.isFinite(lockStaleMs) && lockStaleMs > 0
    ? lockStaleMs
    : DEFAULT_LOCK_STALE_MS;
  const lockPath = path.join(root, PROJECTION_LOCK_NAME);
  assertTargetWithinRoot(root, lockPath);
  const token = randomUUID();
  const deadline = Date.now() + waitMs;

  while (true) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (!(error && error.code === 'EEXIST')) throw error;
      const observed = inspectProjectionLock(lockPath, staleAfterMs);
      if (observed.state === 'missing') continue;
      if (observed.state === 'stale' && reclaimStaleProjectionLock(lockPath, observed)) continue;
      if (Date.now() >= deadline) {
        throw projectionError(`projection lock busy (${observed.reason || 'another apply is running'})`);
      }
      sleepSync(Math.min(LOCK_POLL_MS, Math.max(1, deadline - Date.now())));
      continue;
    }

    let writeError;
    try {
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAtMs: Date.now(), token }), 'utf8');
      fsyncSync(descriptor);
    } catch (error) {
      writeError = error;
    } finally {
      closeSync(descriptor);
    }
    if (writeError) {
      removeIfExists(lockPath);
      throw writeError;
    }
    return { path: lockPath, token };
  }
}

function releaseProjectionLock(lock) {
  if (!existsSync(lock.path)) throw projectionError('projection lock disappeared before release');
  const metadata = parseJson(readFileSync(lock.path, 'utf8'), 'projection lock');
  if (metadata.token !== lock.token || metadata.pid !== process.pid) {
    throw projectionError('projection lock ownership changed before release');
  }
  unlinkSync(lock.path);
}

/**
 * Stage every byte before replacing any target. Caught write failures roll every target back.
 * `afterCommitStep` exists only so the rollback guarantee can be regression-tested.
 */
function commitProjectionFilesAtomically(root, files, { afterCommitStep } = {}) {
  const token = `${process.pid}-${randomUUID()}`;
  const staged = files.map((file) => ({
    ...file,
    temp: `${file.path}.${token}.tmp`,
    backup: `${file.path}.${token}.bak`,
    hadOriginal: file.original !== null,
    committed: false,
  }));

  for (const file of staged) assertTargetWithinRoot(root, file.path);

  try {
    for (const file of staged) {
      const exists = existsSync(file.path);
      if (exists !== file.hadOriginal) throw projectionError(`concurrent target change: ${file.path}`);
      if (exists && readFileSync(file.path, 'utf8') !== file.original) {
        throw projectionError(`concurrent content change: ${file.path}`);
      }
      writeFileSync(file.temp, file.next, { encoding: 'utf8', flag: 'wx' });
      if (file.hadOriginal) copyFileSync(file.path, file.backup);
    }

    for (let index = 0; index < staged.length; index += 1) {
      const file = staged[index];
      // rename is atomic per file on the same volume; every temp lives beside its target.
      renameSync(file.temp, file.path);
      file.committed = true;
      if (afterCommitStep) afterCommitStep(index, file.path);
    }

    for (const file of staged) removeIfExists(file.backup);
  } catch (error) {
    const rollbackErrors = [];
    for (const file of [...staged].reverse()) {
      try {
        if (file.hadOriginal && existsSync(file.backup)) {
          copyFileSync(file.backup, file.path);
        } else if (!file.hadOriginal && file.committed) {
          removeIfExists(file.path);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const file of staged) {
      try {
        removeIfExists(file.temp);
        if (rollbackErrors.length === 0) removeIfExists(file.backup);
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'Brain guide projection failed and rollback was incomplete');
    }
    throw error;
  } finally {
    for (const file of staged) removeIfExists(file.temp);
  }
}

function indexMatches(raw, docs) {
  const actual = parseJson(raw, '_index.json');
  return jsonEqual(actual, buildIndexFromLocalMeta(docs));
}

/**
 * Validate → preflight every collision/derived file → stage → all-or-nothing local projection.
 * Existing guide files are never updated. An exact same queueId+hash+document is an idempotent no-op;
 * if a previous process stopped after the guide file landed, the same manifest may repair only its
 * missing index/sitemap projection.
 */
function applyBrainGuideProjectionLocked({ root, expectedDoc, afterCommitStep }) {
  const projectRoot = path.resolve(root);
  const guidesDir = path.join(projectRoot, 'src', 'content', 'guides');
  const indexPath = path.join(guidesDir, '_index.json');
  const sitemapPath = path.join(projectRoot, 'public', 'sitemap.xml');
  const guidePath = path.join(guidesDir, `${expectedDoc.slug}.json`);
  assertTargetWithinRoot(projectRoot, guidePath);

  const localFiles = readdirSync(guidesDir)
    .filter((file) => file.endsWith('.json') && file !== '_index.json');
  const localDocs = localFiles.map((file) => parseJson(
    readFileSync(path.join(guidesDir, file), 'utf8'),
    file,
  ));
  const indexRaw = readFileSync(indexPath, 'utf8');
  const sitemapRaw = readFileSync(sitemapPath, 'utf8');
  const canonicalUrl = `${GUIDE_CANONICAL_BASE}/${expectedDoc.slug}`;
  const existing = localDocs.find((doc) => doc.slug === expectedDoc.slug);

  const queueCollision = localDocs.find((doc) => doc.projection
    && doc.projection.queueIdSha256 === expectedDoc.projection.queueIdSha256
    && doc.slug !== expectedDoc.slug);
  if (queueCollision) {
    throw projectionError(`queueId already belongs to slug ${queueCollision.slug}`);
  }

  if (existing) {
    if (!existing.projection
      || existing.projection.queueIdSha256 !== expectedDoc.projection.queueIdSha256
      || existing.contentSha256 !== expectedDoc.contentSha256) {
      throw projectionError(`slug ${expectedDoc.slug} already exists with a different queueId or content hash`);
    }
    if (!jsonEqual(existing, expectedDoc)) {
      throw projectionError(`slug ${expectedDoc.slug} exists but is not byte-equivalent projection content`);
    }

    const withoutExisting = localDocs.filter((doc) => doc.slug !== expectedDoc.slug);
    const indexFull = indexMatches(indexRaw, localDocs);
    const indexPreCommit = indexMatches(indexRaw, withoutExisting);
    const sitemapCount = sitemapGuideCount(sitemapRaw, canonicalUrl);
    if (indexFull && sitemapCount === 1) return { status: 'unchanged', slug: expectedDoc.slug };
    if ((!indexFull && !indexPreCommit) || sitemapCount > 1) {
      throw projectionError('existing idempotent guide has unrelated index or sitemap drift');
    }

    const repairedSitemap = sitemapCount === 0
      ? appendGuideToSitemap(sitemapRaw, canonicalUrl)
      : sitemapRaw;
    const repairFiles = [];
    if (!indexFull) repairFiles.push({ path: indexPath, original: indexRaw, next: serializeIndex(localDocs) });
    if (sitemapCount === 0) repairFiles.push({ path: sitemapPath, original: sitemapRaw, next: repairedSitemap });
    commitProjectionFilesAtomically(projectRoot, repairFiles, { afterCommitStep });
    return { status: 'repaired', slug: expectedDoc.slug };
  }

  if (!indexMatches(indexRaw, localDocs)) {
    throw projectionError('_index.json does not exactly match current local guide documents');
  }
  if (sitemapGuideCount(sitemapRaw, canonicalUrl) !== 0) {
    throw projectionError(`sitemap contains ${canonicalUrl} without its guide document`);
  }

  const nextIndex = serializeIndex([...localDocs, expectedDoc]);
  const nextSitemap = appendGuideToSitemap(sitemapRaw, canonicalUrl);
  commitProjectionFilesAtomically(projectRoot, [
    { path: guidePath, original: null, next: JSON.stringify(expectedDoc) },
    { path: indexPath, original: indexRaw, next: nextIndex },
    { path: sitemapPath, original: sitemapRaw, next: nextSitemap },
  ], { afterCommitStep });
  return { status: 'added', slug: expectedDoc.slug };
}

/**
 * The repository lock covers the complete read/preflight/stage/rename window. A second apply
 * waits, then rereads the new index/sitemap instead of deriving output from a stale snapshot.
 * `afterLockAcquired` is test-only failure/concurrency injection.
 */
export function applyBrainGuideProjection({
  root,
  manifest,
  afterCommitStep,
  afterLockAcquired,
  lockWaitMs,
  lockStaleMs,
}) {
  const projectRoot = path.resolve(root);
  const expectedDoc = brainProjectionToGuideDoc(manifest);
  const lock = acquireProjectionLock(projectRoot, { lockWaitMs, lockStaleMs });
  let result;
  let primaryError;

  try {
    if (afterLockAcquired) afterLockAcquired(lock.path);
    result = applyBrainGuideProjectionLocked({
      root: projectRoot,
      expectedDoc,
      afterCommitStep,
    });
  } catch (error) {
    primaryError = error;
  }

  try {
    releaseProjectionLock(lock);
  } catch (releaseError) {
    if (primaryError) {
      throw new AggregateError(
        [primaryError, releaseError],
        'Brain guide projection failed and its repository lock could not be released safely',
      );
    }
    throw releaseError;
  }
  if (primaryError) throw primaryError;
  return result;
}
