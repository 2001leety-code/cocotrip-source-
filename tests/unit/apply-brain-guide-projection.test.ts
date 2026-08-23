import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — operational .mjs module.
import { applyBrainGuideProjection } from '../../scripts/apply-brain-guide-projection.lib.mjs';
// @ts-expect-error — operational .mjs module.
import { brainGuideHtmlSha256 } from '../../scripts/brain-guide-projection.lib.mjs';
// @ts-expect-error — operational .mjs module.
import { buildIndexFromLocalMeta } from '../../scripts/sync-blog-guides.lib.mjs';

const tempRoots: string[] = [];

function serializeIndex(docs: unknown[]) {
  return JSON.stringify(buildIndexFromLocalMeta(docs), null, 1).replace(/\n/g, '\r\n');
}

function createFixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cocotrip-guide-projection-'));
  tempRoots.push(root);
  const guidesDir = path.join(root, 'src', 'content', 'guides');
  mkdirSync(guidesDir, { recursive: true });
  mkdirSync(path.join(root, 'public'), { recursive: true });
  const seed = {
    slug: 'existing-guide',
    title: 'Existing Guide',
    description: 'Existing guide description.',
    published: '2026-08-01',
    updated: '2026-08-01',
    labels: ['Existing'],
    html: '<p>Existing body.</p>',
    sourceUrl: 'https://cocotripkr.blogspot.com/2026/08/existing-guide.html',
  };
  writeFileSync(path.join(guidesDir, `${seed.slug}.json`), JSON.stringify(seed));
  writeFileSync(path.join(guidesDir, '_index.json'), serializeIndex([seed]));
  writeFileSync(path.join(root, 'public', 'sitemap.xml'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset>',
    '  <url><loc>https://cocotripkr.com/guide</loc></url>',
    '  <url><loc>https://cocotripkr.com/guide/existing-guide</loc></url>',
    '</urlset>',
    '',
  ].join('\n'));
  return root;
}

const html = '<p class="post-summary"><em>Rain route.</em></p><h2>Plan</h2><p>Use Line 2.</p>';
const manifest = () => ({
  schemaVersion: 1,
  queueId: 'blog_20260823_rain',
  slug: 'seoul-rainy-day-guide-2026',
  canonicalUrl: 'https://cocotripkr.com/guide/seoul-rainy-day-guide-2026',
  contentSha256: brainGuideHtmlSha256(html),
  title: 'Seoul Rainy Day Guide 2026',
  description: 'Practical indoor routes for a rainy day in Seoul.',
  published: '2026-08-23',
  labels: ['Rainy Day', 'Seoul'],
  html,
  review: { verdict: 'pass', score: 96 },
  approval: { approvedBy: 'discord:12345', approvedAt: '2026-08-23T10:00:00+09:00' },
  qualityRulesVersion: 'brain-content-quality-v1',
});

function secondManifest() {
  const secondHtml = '<p class="post-summary"><em>Busan route.</em></p><h2>Plan</h2><p>Start at the beach.</p>';
  return {
    ...manifest(),
    queueId: 'blog_20260823_busan',
    slug: 'busan-beach-guide-2026',
    canonicalUrl: 'https://cocotripkr.com/guide/busan-beach-guide-2026',
    contentSha256: brainGuideHtmlSha256(secondHtml),
    title: 'Busan Beach Guide 2026',
    description: 'A practical beach route for a day in Busan.',
    html: secondHtml,
  };
}

const LOCK_ACQUIRED_MARKER = '__LOCK_ACQUIRED__';

/**
 * Spawns a child that runs applyBrainGuideProjection. Windows full-suite runs fork ~600 test
 * files concurrently, so this grandchild's own process-start + ESM-import latency is highly
 * variable — polling for the lock file to appear on disk within a fixed short deadline flaked
 * under that contention (the file only lands once the slow child actually reaches
 * acquireProjectionLock). `lockAcquired` instead resolves off a marker the worker writes to its
 * own stdout from inside `afterLockAcquired` — a deterministic signal tied to the real event,
 * not wall-clock — and rejects immediately (with captured stderr) if the child errors or exits
 * first, so a genuine bug still fails fast instead of hanging.
 */
function runProjectionWorker(root: string, candidate: ReturnType<typeof manifest>, holdMs: number) {
  const workerPath = path.join(root, 'projection-worker.mjs');
  const moduleUrl = new URL('../../scripts/apply-brain-guide-projection.lib.mjs', import.meta.url).href;
  writeFileSync(workerPath, [
    `import { applyBrainGuideProjection } from ${JSON.stringify(moduleUrl)};`,
    'const payload = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8"));',
    'try {',
    '  const result = applyBrainGuideProjection({',
    '    root: payload.root,',
    '    manifest: payload.manifest,',
    '    lockWaitMs: 5000,',
    '    afterLockAcquired: () => {',
    `      process.stdout.write(${JSON.stringify(LOCK_ACQUIRED_MARKER)});`,
    '      if (payload.holdMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, payload.holdMs);',
    '    },',
    '  });',
    '  process.stdout.write(JSON.stringify(result));',
    '} catch (error) {',
    '  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));',
    '  process.exitCode = 1;',
    '}',
  ].join('\n'));
  const payload = Buffer.from(JSON.stringify({ root, manifest: candidate, holdMs }), 'utf8').toString('base64url');
  const child = spawn(process.execPath, [workerPath, payload], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let spawnError: Error | null = null;
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.on('error', (error) => { spawnError = error; });
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (code) => resolve({
      code,
      stdout,
      stderr: spawnError ? `${stderr}\n[spawn error] ${spawnError.message}` : stderr,
    }));
  });
  const lockAcquired = new Promise<void>((resolve, reject) => {
    const settle = () => {
      child.stdout.off('data', onData);
      child.off('close', onClose);
      child.off('error', onError);
    };
    const onData = () => {
      if (stdout.includes(LOCK_ACQUIRED_MARKER)) {
        settle();
        resolve();
      }
    };
    const onClose = (code: number | null) => {
      settle();
      reject(new Error(
        `worker exited (code ${code}) before acquiring the projection lock: ${stderr || spawnError?.message || '(no stderr)'}`,
      ));
    };
    const onError = (error: Error) => {
      settle();
      reject(error);
    };
    if (stdout.includes(LOCK_ACQUIRED_MARKER)) {
      resolve();
      return;
    }
    child.stdout.on('data', onData);
    child.on('close', onClose);
    child.on('error', onError);
  });
  return { child, done, lockAcquired };
}

function bytes(root: string) {
  const guidePath = path.join(root, 'src', 'content', 'guides', 'seoul-rainy-day-guide-2026.json');
  return {
    guide: existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : null,
    index: readFileSync(path.join(root, 'src', 'content', 'guides', '_index.json'), 'utf8'),
    sitemap: readFileSync(path.join(root, 'public', 'sitemap.xml'), 'utf8'),
  };
}

afterEach(() => {
  const safePrefix = path.join(os.tmpdir(), 'cocotrip-guide-projection-');
  while (tempRoots.length) {
    const root = path.resolve(tempRoots.pop() || '');
    if (root.startsWith(safePrefix)) rmSync(root, { recursive: true, force: true });
  }
});

describe('approved Brain guide atomic projection', () => {
  it('강제 종료 lock 찌꺼기만 저장소 루트에서 정확히 ignore한다', () => {
    const ignore = readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('/.guide-projection.lock');
    expect(ignore).toContain('/.guide-projection.lock.*.stale');
  });

  it('guide JSON + public index + sitemap을 함께 추가하고 같은 manifest는 멱등 no-op', () => {
    const root = createFixtureRoot();
    const first = applyBrainGuideProjection({ root, manifest: manifest() });
    expect(first).toEqual({ status: 'added', slug: 'seoul-rainy-day-guide-2026' });

    const afterFirst = bytes(root);
    const doc = JSON.parse(afterFirst.guide || '{}');
    expect(doc.contentSha256).toBe(manifest().contentSha256);
    expect(doc.queueId).toBeUndefined();
    expect(doc.review).toBeUndefined();
    expect(doc.approval).toBeUndefined();
    expect(doc.projection.queueIdSha256).toBe(
      createHash('sha256').update(manifest().queueId, 'utf8').digest('hex'),
    );

    const index = JSON.parse(afterFirst.index);
    expect(index.map((item: { slug: string }) => item.slug)).toContain(doc.slug);
    expect(JSON.stringify(index)).not.toContain('queueId');
    expect(afterFirst.sitemap.match(/seoul-rainy-day-guide-2026/g)).toHaveLength(1);

    expect(applyBrainGuideProjection({ root, manifest: manifest() })).toEqual({
      status: 'unchanged',
      slug: doc.slug,
    });
    expect(bytes(root)).toEqual(afterFirst);
  });

  it('같은 slug의 queue/hash/content가 하나라도 다르면 기존 파일을 덮어쓰지 않는다', () => {
    const root = createFixtureRoot();
    applyBrainGuideProjection({ root, manifest: manifest() });
    const before = bytes(root);
    const changedHtml = `${html}<p>Different body.</p>`;
    const changed = {
      ...manifest(),
      html: changedHtml,
      contentSha256: brainGuideHtmlSha256(changedHtml),
    };
    expect(() => applyBrainGuideProjection({ root, manifest: changed })).toThrow(/different queueId or content hash/);
    expect(bytes(root)).toEqual(before);
  });

  it('검증 실패는 어떤 파일도 만들거나 바꾸기 전에 끝난다', () => {
    const root = createFixtureRoot();
    const before = bytes(root);
    const unsafeHtml = '<p onclick="alert(1)">x</p><script>alert(1)</script>';
    const invalid = {
      ...manifest(),
      html: unsafeHtml,
      contentSha256: brainGuideHtmlSha256(unsafeHtml),
    };
    expect(() => applyBrainGuideProjection({ root, manifest: invalid })).toThrow(/html:/);
    expect(bytes(root)).toEqual(before);
  });

  it.each([0, 1, 2])('%i번째 파일 교체 뒤 강제 오류도 guide/index/sitemap을 원래 바이트로 롤백한다', (failAfter) => {
    const root = createFixtureRoot();
    const before = bytes(root);
    expect(() => applyBrainGuideProjection({
      root,
      manifest: manifest(),
      afterCommitStep: (index: number) => {
        if (index === failAfter) throw new Error('injected transaction failure');
      },
    })).toThrow(/injected transaction failure/);
    expect(bytes(root)).toEqual(before);
    expect(readdirSync(path.join(root, 'src', 'content', 'guides')).some((file) => /\.(?:tmp|bak)$/.test(file)))
      .toBe(false);
    expect(readdirSync(path.join(root, 'public')).some((file) => /\.(?:tmp|bak)$/.test(file))).toBe(false);
  });

  it('동일 guide가 먼저 도착한 중단 상태는 같은 manifest만 index/sitemap까지 복구한다', () => {
    const root = createFixtureRoot();
    applyBrainGuideProjection({ root, manifest: manifest() });
    const complete = bytes(root);
    const doc = complete.guide as string;

    // 직전 상태를 재현: guide 파일만 존재하고 파생 파일은 아직 이전 바이트다.
    const clean = createFixtureRoot();
    const cleanBefore = bytes(clean);
    writeFileSync(
      path.join(clean, 'src', 'content', 'guides', 'seoul-rainy-day-guide-2026.json'),
      doc,
    );
    const result = applyBrainGuideProjection({ root: clean, manifest: manifest() });
    expect(result.status).toBe('repaired');
    expect(bytes(clean).index).not.toBe(cleanBefore.index);
    expect(bytes(clean).sitemap).not.toBe(cleanBefore.sitemap);
  });

  // 전체 스위트(fork 640개) 경합에서 grandchild 프로세스 2개(각자 own ESM import)를 spawn하는
  // 이 테스트의 실측 최악치는 12.3s (vitest.config.ts 의 cold-import 실측과 같은 종류의 부하,
  // 다만 grandchild spawn 이 겹쳐 더 큼). 같은 1.8배 여유 방식을 적용해 25s로 고정.
  it('병렬 apply 두 개를 repo lock으로 직렬화해 index/sitemap 항목을 모두 보존한다', async () => {
    const root = createFixtureRoot();
    const first = runProjectionWorker(root, manifest(), 600);
    expect(first.child.pid).toBeTypeOf('number');
    await first.lockAcquired;
    const second = runProjectionWorker(root, secondManifest(), 0);

    const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
    expect(firstResult, firstResult.stderr).toMatchObject({ code: 0 });
    expect(secondResult, secondResult.stderr).toMatchObject({ code: 0 });
    expect(existsSync(path.join(root, '.guide-projection.lock'))).toBe(false);

    const index = JSON.parse(readFileSync(path.join(root, 'src', 'content', 'guides', '_index.json'), 'utf8'));
    expect(index.map((item: { slug: string }) => item.slug)).toEqual(expect.arrayContaining([
      manifest().slug,
      secondManifest().slug,
    ]));
    const sitemap = readFileSync(path.join(root, 'public', 'sitemap.xml'), 'utf8');
    expect(sitemap.match(new RegExp(manifest().slug, 'g'))).toHaveLength(1);
    expect(sitemap.match(new RegExp(secondManifest().slug, 'g'))).toHaveLength(1);
  }, 25_000);

  it('오래됐고 소유 process가 끝난 lock만 회수하며 finally에서 새 lock을 지운다', async () => {
    const root = createFixtureRoot();
    const exited = spawn(process.execPath, ['-e', '']);
    const exitedPid = exited.pid;
    expect(exitedPid).toBeTypeOf('number');
    await new Promise<void>((resolve) => exited.on('close', () => resolve()));
    writeFileSync(path.join(root, '.guide-projection.lock'), JSON.stringify({
      pid: exitedPid,
      acquiredAtMs: Date.now() - 60_000,
      token: '00000000-0000-4000-8000-000000000000',
    }));

    expect(applyBrainGuideProjection({
      root,
      manifest: manifest(),
      lockWaitMs: 0,
      lockStaleMs: 1_000,
    })).toEqual({ status: 'added', slug: manifest().slug });
    expect(readdirSync(root).some((file) => file.includes('.guide-projection.lock'))).toBe(false);
  });
});
