/**
 * Offline full-unit rule helper (통합 2026-10-17) — scripts/offline/full-unit-rules.cjs.
 * The helper is imported directly; nothing here spawns Node/Git or reads env/secrets. Filesystem
 * cases (real dirs, junctions, hardlinks) only run on win32, where the guard runs; elsewhere that
 * suite is reported as skipped, not passed. Dynamic artifacts live in one owned mkdtemp root.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — operational .mjs module.
import { brainGuideHtmlSha256 } from '../../scripts/brain-guide-projection.lib.mjs';

type Result = {
  ok: boolean;
  reason?: string;
  ruleId?: string;
  entry?: string;
  argv?: string[];
  options?: Record<string, unknown>;
  fixedEnv?: Record<string, string>;
};
type Validate = (entry: unknown, argv: unknown, options: unknown, policy: unknown) => Result;
type Rules = {
  GIT_PIN: { path: string; size: number; sha256: string; version: string };
  GIT_PROTECT_ARGS: string[];
  GIT_FIXED_ENV: Record<string, string>;
  GIT_IGNORE_CANDIDATES: string[];
  PROJECTION_MANIFESTS: { first: Record<string, unknown>; second: Record<string, unknown> };
  BAD_PROJECTION_ROOT_NAME: string;
  NODE_RULE_IDS: string[];
  NODE_ENTRY_RELS: string[];
  GIT_RULE_IDS: string[];
  validateFullUnitNode: Validate;
  validateFullUnitGit: Validate;
};

const require = createRequire(import.meta.url);
const rules = require('../../scripts/offline/full-unit-rules.cjs') as Rules;
const { validateFullUnitNode: node, validateFullUnitGit: git, GIT_PIN } = rules;

// Rebuilt exactly as tests/unit/apply-brain-guide-projection.test.ts builds them.
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
const secondHtml = '<p class="post-summary"><em>Busan route.</em></p><h2>Plan</h2><p>Start at the beach.</p>';
const secondManifest = () => ({
  ...manifest(),
  queueId: 'blog_20260823_busan',
  slug: 'busan-beach-guide-2026',
  canonicalUrl: 'https://cocotripkr.com/guide/busan-beach-guide-2026',
  contentSha256: brainGuideHtmlSha256(secondHtml),
  title: 'Busan Beach Guide 2026',
  description: 'A practical beach route for a day in Busan.',
  html: secondHtml,
});

const payload = (root: string, m: unknown, holdMs: number) =>
  Buffer.from(JSON.stringify({ root, manifest: m, holdMs }), 'utf8').toString('base64url');
const IPP = ['ignore', 'pipe', 'pipe'];
// A real own '__proto__' data key (an object literal `__proto__:` would set the prototype instead).
const withOwnProto = (o: object, value: unknown) =>
  Object.defineProperty({ ...o }, '__proto__', { value, enumerable: true, writable: true, configurable: true });
const parsedWithProto = (o: object, protoJson: string) =>
  JSON.parse(JSON.stringify(o).replace(/\}$/, `${Object.keys(o).length ? ',' : ''}"__proto__":${protoJson}}`));
const source = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('full-unit rules: pins (all platforms)', () => {
  it('exports a frozen API and the verified Git pin', () => {
    expect(Object.isFrozen(rules)).toBe(true);
    expect(GIT_PIN).toEqual({
      path: 'C:\\Program Files\\Git\\cmd\\git.exe',
      size: 46480,
      sha256: '81ef35ae005ca9318018d18e3327578ce939fb99feaad6b2d7c8ab15f3de8db5',
      version: '2.54.0.windows.1',
    });
    expect(rules.GIT_RULE_IDS).toHaveLength(7);
    expect(new Set(rules.GIT_RULE_IDS).size).toBe(7);
    expect(new Set(rules.NODE_RULE_IDS).size).toBe(rules.NODE_RULE_IDS.length);
  });

  it('pinned projection manifests are byte-identical to the projection test manifests', () => {
    expect(JSON.stringify(rules.PROJECTION_MANIFESTS.first)).toBe(JSON.stringify(manifest()));
    expect(JSON.stringify(rules.PROJECTION_MANIFESTS.second)).toBe(JSON.stringify(secondManifest()));
    expect(Object.isFrozen(rules.PROJECTION_MANIFESTS.first.labels)).toBe(true);
  });

  it('every pinned vector still appears in its source test (drift fails here)', () => {
    const projection = source('tests/unit/apply-brain-guide-projection.test.ts');
    for (const m of [manifest(), secondManifest()]) {
      for (const [key, value] of Object.entries(m)) {
        if (key === 'contentSha256') continue;
        const strings = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
        for (const s of strings) expect(projection, `${key}`).toContain(`'${s}'`);
      }
    }
    expect(projection).toContain("path.join(os.tmpdir(), 'not-a-cocotrip-projection-root')");
    expect(projection).toContain("mkdtempSync(path.join(os.tmpdir(), 'cocotrip-guide-projection-'))");
    expect(projection).toContain("spawn(process.execPath, [PROJECTION_WORKER, payload], { stdio: ['ignore', 'pipe', 'pipe'] })");
    expect(projection).toContain('runProjectionWorker(root, manifest(), 600)');
    expect(projection).toContain('runProjectionWorker(root, secondManifest(), 0)');
    expect(projection).toContain('runProjectionWorker(outside, manifest(), 0)');
    expect(projection).toContain('spawn(process.execPath, [PROJECTION_EXIT])');
    expect(source('tests/fixtures/integration-20261017/projection-worker.mjs')).toContain("keys !== 'holdMs,manifest,root'");

    const audit = source('tests/unit/audit-gate.test.ts');
    expect(audit).toContain("mkdtempSync(join(tmpdir(), 'audit-gate-'))");
    expect(audit).toContain("join(dir, 'audit.json')");
    expect(audit).toContain("cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']");
    expect(audit).toContain("['scripts/audit-gate.mjs', file], { cwd: process.cwd(), stdio: 'pipe' }");
    expect(audit).toContain("['scripts/audit-gate.mjs'], { cwd: process.cwd(), stdio: 'pipe' }");
    expect(source('tests/unit/quality-metrics-structural-false-positives.test.ts')).toContain("['scripts/test-quality-metrics.mjs']");

    const google = source('tests/unit/paid-google-scripts-consent.test.ts');
    expect(google).toContain("['enrich-busan.mjs', 'enrich-city-restaurants.mjs']");
    expect(google).toContain("env: { ...process.env, GOOGLE_PLACES_API_KEY: 'must-not-be-used' }");

    const owner = source('tests/unit/owner-controller-preflight.test.ts');
    for (const c of rules.GIT_IGNORE_CANDIDATES) expect(owner).toContain(`'${c}'`);
    expect(owner).toContain("execFileSync('git', ['check-ignore', '-q', candidate], { cwd: process.cwd() })");
    expect(source('tests/unit/owner-android-workflow.test.ts'))
      .toContain("execFileSync('git', ['ls-files', '--stage', 'android-owner/gradlew'], { encoding: 'utf8' })");

    const montage = source('tests/unit/openmontage-brief.test.ts');
    expect(montage).toContain("spawnSync(process.execPath, [join(ROOT, 'scripts', 'export-openmontage-brief.mjs'), ...args], {");
    expect(montage).toMatch(/\.\.\.args\], \{\r?\n\s*encoding: 'utf8',\r?\n\s*cwd: ROOT,\r?\n\s*timeout: 30000, \/\/[^\n]*\r?\n\s*\}\);/);
    expect(montage).toContain("runCli(['--locale', 'fr'])");
    expect(montage).toContain("runCli(['--help'])");

    const plan = source('tests/unit/plan-local-prewrite-quality-gate.test.ts');
    expect(plan).toContain("const RUN_MJS = resolve(ROOT, 'scripts/plan-local/run.mjs');");
    expect(plan).toContain("const passScenario = 'sample';");
    expect(plan).toContain("const failScenario = '__test_daycount_mismatch__';");
    expect(plan).toContain('execFileSync(process.execPath, [RUN_MJS, passScenario], { cwd: ROOT, stdio: \'pipe\' })');
    expect(plan).toContain('execFileSync(process.execPath, [RUN_MJS, failScenario], { cwd: ROOT, stdio: \'pipe\' })');
  });

  it('exports the openmontage and plan-local rule ids and their entries', () => {
    for (const id of ['node:openmontage-brief:help', 'node:openmontage-brief:bad-locale', 'node:plan-local:sample',
      'node:plan-local:daycount-mismatch']) {
      expect(rules.NODE_RULE_IDS).toContain(id);
    }
    expect(rules.NODE_ENTRY_RELS).toContain('scripts\\export-openmontage-brief.mjs');
    expect(rules.NODE_ENTRY_RELS).toContain('scripts\\plan-local\\run.mjs');
    expect(Object.isFrozen(rules.NODE_ENTRY_RELS)).toBe(true);
  });

  it('rejects malformed policies before any filesystem check', () => {
    const lexical = { repoRoot: 'C:\\repo', runTmp: 'C:\\run\\tmp', gitPath: GIT_PIN.path };
    const cases: [unknown, RegExp][] = [
      [undefined, /exactly \{gitPath,repoRoot,runTmp\}/],
      [{ ...lexical, extra: 'x' }, /exactly/],
      [{ ...lexical, repoRoot: 'repo' }, /repoRoot is not a canonical/],
      [{ ...lexical, runTmp: 'C:/run/tmp' }, /runTmp is not a canonical/],
      [{ ...lexical, runTmp: 'C:\\run\\..\\tmp' }, /runTmp is not a canonical/],
      [{ ...lexical, gitPath: 'C:\\Program Files\\Git\\bin\\git.exe' }, /pinned Git/],
      [{ ...lexical, runTmp: 'C:\\repo\\tmp' }, /must not overlap/],
      // own '__proto__' must not vanish into a prototype swap and pass the exact-keys check
      [withOwnProto(lexical, {}), /exactly \{gitPath,repoRoot,runTmp\}/],
      [withOwnProto(lexical, null), /exactly \{gitPath,repoRoot,runTmp\}/],
      [parsedWithProto(lexical, '{}'), /exactly \{gitPath,repoRoot,runTmp\}/],
      [parsedWithProto(lexical, '"x"'), /exactly \{gitPath,repoRoot,runTmp\}/],
      [Object.create(lexical), /exactly \{gitPath,repoRoot,runTmp\}/],
      [{ ...lexical, [Symbol('extra')]: 1 }, /exactly \{gitPath,repoRoot,runTmp\}/],
    ];
    for (const [policy, reason] of cases) {
      expect(node('scripts/test-quality-metrics.mjs', [], { cwd: 'C:\\repo', stdio: 'pipe' }, policy).reason).toMatch(reason);
      expect(git('git', ['ls-files', '--stage', 'android-owner/gradlew'], { encoding: 'utf8' }, policy).reason).toMatch(reason);
    }
  });
});

describe.runIf(process.platform === 'win32')('full-unit rules: filesystem-backed vectors (win32)', () => {
  const OWNED_PREFIX = 'full-unit-rules-';
  let owned = '';
  let repoRoot = '';
  let runTmp = '';
  let outside = '';
  let policy: { repoRoot: string; runTmp: string; gitPath: string };
  let projRoot = '';
  let badRoot = '';
  let auditJson = '';
  const worker = () => path.join(repoRoot, 'tests', 'fixtures', 'integration-20261017', 'projection-worker.mjs');
  const exitEntry = () => path.join(repoRoot, 'tests', 'fixtures', 'integration-20261017', 'projection-exit.mjs');
  const runWorker = (root: string, m: unknown, holdMs: number, options: unknown = { stdio: IPP }) =>
    node(worker(), [payload(root, m, holdMs)], options, policy);
  const gate = (args: string[], options: unknown) => node('scripts/audit-gate.mjs', args, options, policy);
  const auditDir = (name: string) => {
    const dir = path.join(runTmp, name);
    mkdirSync(dir);
    return dir;
  };

  beforeAll(() => {
    repoRoot = realpathSync.native(process.cwd());
    owned = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), OWNED_PREFIX)));
    runTmp = path.join(owned, 'tmp');
    outside = path.join(owned, 'outside');
    mkdirSync(runTmp);
    mkdirSync(outside);
    policy = { repoRoot, runTmp, gitPath: GIT_PIN.path };
    projRoot = path.join(runTmp, 'cocotrip-guide-projection-Ab12Cd');
    mkdirSync(projRoot);
    badRoot = path.join(runTmp, rules.BAD_PROJECTION_ROOT_NAME);
    auditJson = path.join(auditDir('audit-gate-Xy34Zw'), 'audit.json');
    writeFileSync(auditJson, '{not json'); // never parsed by the helper
  });

  afterAll(() => {
    // Only the exact owned mkdtemp root; link targets all live inside it.
    if (owned && path.basename(owned).startsWith(OWNED_PREFIX) && path.dirname(owned) === realpathSync.native(os.tmpdir())) {
      rmSync(owned, { recursive: true, force: true });
    }
  });

  describe('projection worker', () => {
    it('accepts exactly the three pinned payloads, including the bad root that must reach exit 64', () => {
      const first = runWorker(projRoot, manifest(), 600);
      expect(first).toMatchObject({ ok: true, ruleId: 'node:projection-worker:first-hold-600', entry: worker() });
      expect(first.options).toEqual({ cwd: repoRoot, stdio: IPP }); // canonical cwd although the caller passes none
      expect(first.fixedEnv).toBeUndefined();
      expect(runWorker(projRoot, secondManifest(), 0)).toMatchObject({ ok: true, ruleId: 'node:projection-worker:second-hold-0' });
      expect(runWorker(badRoot, manifest(), 0)).toMatchObject({ ok: true, ruleId: 'node:projection-worker:bad-root-exit-64' });
    });

    it('rejects unpinned manifest/holdMs/root combinations and manifest mutations', () => {
      const changedHtml = `${html}<p>x</p>`;
      const mutations: unknown[] = [
        { ...manifest(), title: 'Other' },
        { ...manifest(), html: changedHtml, contentSha256: brainGuideHtmlSha256(changedHtml) },
        { ...manifest(), labels: ['Seoul', 'Rainy Day'] },
        { ...manifest(), review: { verdict: 'pass', score: 97 } },
        { ...manifest(), extra: true },
        { ...manifest(), schemaVersion: '1' },
      ];
      for (const m of mutations) expect(runWorker(projRoot, m, 600).reason).toMatch(/combination is not pinned/);
      expect(runWorker(projRoot, manifest(), 0).reason).toMatch(/combination is not pinned/);
      expect(runWorker(projRoot, secondManifest(), 600).reason).toMatch(/combination is not pinned/);
      expect(runWorker(badRoot, secondManifest(), 0).reason).toMatch(/combination is not pinned/);
      expect(runWorker(badRoot, manifest(), 600).reason).toMatch(/combination is not pinned/);
    });

    it('rejects oversized, non-canonical and non-JSON payloads', () => {
      const good = payload(projRoot, manifest(), 600);
      const original = Buffer.from(good, 'base64url');
      const twin = good.length % 4 === 0
        ? `${good}A`
        : [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_']
          .map((c) => good.slice(0, -1) + c)
          .find((alt) => alt !== good && Buffer.from(alt, 'base64url').equals(original));
      expect(twin).toBeTypeOf('string');
      const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
      const cases: [string, RegExp][] = [
        [payload(projRoot, { ...manifest(), html: 'x'.repeat(16 * 1024) }, 600), /1\.\.16384 chars/],
        [`${good}=`, /not base64url/],
        [`+${good}`, /not base64url/],
        [twin as string, /not canonical base64url/],
        [Buffer.from([0xff, 0xfe, 0x7b]).toString('base64url'), /not UTF-8 JSON/],
        [b64(JSON.stringify({ root: projRoot, manifest: manifest(), holdMs: 600 }, null, 1)), /not canonical JSON/],
        [b64(JSON.stringify({ manifest: manifest(), root: projRoot, holdMs: 600 })), /keys must be exactly/],
        [b64(JSON.stringify({ root: projRoot, manifest: manifest(), holdMs: 600, extra: 1 })), /keys must be exactly/],
        [b64('[]'), /keys must be exactly/],
        // JSON.parse turns "__proto__" into an own data key; it must count as an extra key
        [b64(JSON.stringify(withOwnProto({ root: projRoot, manifest: manifest(), holdMs: 600 }, {}))), /keys must be exactly/],
        [b64(JSON.stringify({ root: projRoot, manifest: withOwnProto(manifest(), {}), holdMs: 600 })), /combination is not pinned/],
        [b64(JSON.stringify({ root: projRoot, manifest: withOwnProto(manifest(), null), holdMs: 600 })), /combination is not pinned/],
      ];
      for (const [arg, reason] of cases) expect(node(worker(), [arg], { stdio: IPP }, policy).reason).toMatch(reason);
      expect(node(worker(), [''], { stdio: IPP }, policy).reason).toMatch(/1\.\.16384 chars/);
    });

    it('rejects roots outside <runTmp>\\cocotrip-guide-projection-<6>, traversal, links and missing dirs', () => {
      const sibling = path.join(owned, 'cocotrip-guide-projection-Zz99Zz');
      mkdirSync(sibling);
      const nestedParent = path.join(runTmp, 'nested');
      mkdirSync(nestedParent);
      const nested = path.join(nestedParent, 'cocotrip-guide-projection-Nn00Nn');
      mkdirSync(nested);
      const junction = path.join(runTmp, 'cocotrip-guide-projection-Jn01Jn');
      symlinkSync(outside, junction, 'junction'); // junctions need no symlink privilege
      const fileRoot = path.join(runTmp, 'cocotrip-guide-projection-Fi01Fi');
      writeFileSync(fileRoot, '');
      const roots = [
        sibling,
        nested,
        junction,
        fileRoot,
        path.join(runTmp, 'cocotrip-guide-projection-Mi55Mi'), // valid name, not created
        path.join(runTmp, 'cocotrip-guide-projection-abc'),
        path.join(runTmp, 'cocotrip-guide-projection-Ab12Cd7'),
        `${runTmp}\\..\\tmp\\cocotrip-guide-projection-Ab12Cd`,
        projRoot.replace(/\\/g, '/'),
        `${projRoot}\\`,
        'cocotrip-guide-projection-Ab12Cd',
        path.join(outside, rules.BAD_PROJECTION_ROOT_NAME),
      ];
      for (const root of roots) expect(runWorker(root, manifest(), 600).reason, root).toMatch(/root is not/);
    });

    it('rejects extra/missing args, other options and accessor options', () => {
      const p = payload(projRoot, manifest(), 600);
      expect(node(worker(), [p, 'extra'], { stdio: IPP }, policy).reason).toMatch(/matches no vector/);
      expect(node(worker(), [], { stdio: IPP }, policy).reason).toMatch(/matches no vector/);
      expect(runWorker(projRoot, manifest(), 600, {}).reason).toMatch(/options must be exactly \{stdio\}/);
      expect(runWorker(projRoot, manifest(), 600, { stdio: 'pipe' }).reason).toMatch(/stdio must be exactly/);
      expect(runWorker(projRoot, manifest(), 600, { stdio: IPP, shell: false }).reason).toMatch(/options must be exactly/);
      expect(runWorker(projRoot, manifest(), 600, { stdio: IPP, cwd: repoRoot }).reason).toMatch(/options must be exactly/);
      expect(runWorker(projRoot, manifest(), 600, { get stdio() { return IPP; } }).reason).toMatch(/plain data/);
      expect(runWorker(projRoot, manifest(), 600, Object.create({ stdio: IPP })).reason).toMatch(/plain data/);
      expect(runWorker(projRoot, manifest(), 600, { stdio: IPP, [Symbol('cwd')]: repoRoot }).reason).toMatch(/plain data/);
      expect(runWorker(projRoot, manifest(), 600, withOwnProto({ stdio: IPP }, {})).reason).toMatch(/plain data/);
      expect(runWorker(projRoot, manifest(), 600, withOwnProto({}, { stdio: IPP })).reason).toMatch(/plain data/);
      expect(runWorker(projRoot, manifest(), 600, parsedWithProto({ stdio: IPP }, '{"shell":true}')).reason).toMatch(/plain data/);
      expect(node(worker(), [p], { stdio: IPP }, policy).argv).toEqual([p]);
      expect(node(worker().replace(/\\/g, '/'), [p], { stdio: IPP }, policy).reason).toBe('unknown entry');
    });

    it('projection-exit takes no args and no options, and launches with the canonical cwd', () => {
      const r = node(exitEntry(), [], undefined, policy);
      expect(r).toMatchObject({ ok: true, ruleId: 'node:projection-exit' });
      expect(r.options).toEqual({ cwd: repoRoot });
      expect(node(exitEntry(), [], {}, policy).options).toEqual({ cwd: repoRoot });
      expect(node(exitEntry(), ['x'], undefined, policy).reason).toMatch(/matches no vector/);
      expect(node(exitEntry(), [], { stdio: 'pipe' }, policy).reason).toMatch(/options must be exactly \{\}/);
      expect(node(exitEntry(), [], { cwd: repoRoot }, policy).reason).toMatch(/options must be exactly \{\}/);
      expect(node(exitEntry(), [], { shell: true }, policy).reason).toMatch(/options must be exactly \{\}/);
      // previously copied into {} as a prototype swap and accepted as "{}"
      for (const proto of ['{}', 'null', '1', '{"shell":true}']) {
        expect(node(exitEntry(), [], parsedWithProto({}, proto), policy).reason, proto).toMatch(/plain data/);
      }
      expect(node(exitEntry(), [], withOwnProto({}, { cwd: runTmp }), policy).reason).toMatch(/plain data/);
      expect(node(exitEntry(), [], Object.create({ shell: true }), policy).reason).toMatch(/plain data/);
      expect(node(exitEntry(), [], undefined, withOwnProto(policy, {})).reason).toMatch(/exactly \{gitPath,repoRoot,runTmp\}/);
    });
  });

  describe('audit gate and quality metrics (relative aliases with cwd = repo root)', () => {
    it('accepts the three audit-gate vectors without parsing the file and maps the alias to an absolute entry', () => {
      const abs = path.join(repoRoot, 'scripts', 'audit-gate.mjs');
      expect(gate([auditJson], { cwd: process.cwd(), encoding: 'utf8', stdio: IPP }))
        .toMatchObject({ ok: true, ruleId: 'node:audit-gate:file-utf8', entry: abs, options: { cwd: repoRoot, encoding: 'utf8', stdio: IPP } });
      const pipe = gate([auditJson], { cwd: process.cwd(), stdio: 'pipe' });
      expect(pipe).toMatchObject({ ok: true, ruleId: 'node:audit-gate:file-pipe' });
      expect(pipe.options).toEqual({ cwd: repoRoot, stdio: 'pipe' });
      expect(gate([], { cwd: process.cwd(), stdio: 'pipe' })).toMatchObject({ ok: true, ruleId: 'node:audit-gate:no-file' });
      expect(gate([], { cwd: process.cwd(), encoding: 'utf8', stdio: IPP }).reason).toMatch(/options must be exactly \{cwd,stdio\}/);
    });

    it('rejects other entry spellings, cwd values and extra options', () => {
      const ok = { cwd: repoRoot, stdio: 'pipe' };
      for (const entry of [path.join(repoRoot, 'scripts', 'audit-gate.mjs'), 'scripts\\audit-gate.mjs', './scripts/audit-gate.mjs',
        'scripts/../scripts/audit-gate.mjs', 'SCRIPTS/audit-gate.mjs']) {
        expect(node(entry, [], ok, policy).reason, entry).toBe('unknown entry');
      }
      for (const cwd of [runTmp, `${repoRoot}\\`, repoRoot.replace(/\\/g, '/'), path.join(repoRoot, 'scripts'), 'scripts']) {
        expect(gate([], { cwd, stdio: 'pipe' }).reason, cwd).toBe('cwd must be the repo root');
      }
      expect(gate([], { stdio: 'pipe' }).reason).toMatch(/options must be exactly/);
      expect(gate([], { ...ok, shell: false }).reason).toMatch(/options must be exactly/);
      expect(gate([auditJson, 'extra'], ok).reason).toMatch(/matches no vector/);
      expect(gate([], withOwnProto(ok, {})).reason).toMatch(/plain data/);
      expect(gate([], withOwnProto({ stdio: 'pipe' }, { cwd: repoRoot })).reason).toMatch(/plain data/);
      expect(gate([], parsedWithProto(ok, '{"shell":true}')).reason).toMatch(/plain data/);
      expect(gate([], Object.create(ok)).reason).toMatch(/plain data/);
      expect(gate([], { ...ok, [Symbol('shell')]: true }).reason).toMatch(/plain data/);
    });

    it('rejects audit files outside <runTmp>\\audit-gate-<6>\\audit.json, links, hardlinks and oversized files', () => {
      const ok = { cwd: repoRoot, stdio: 'pipe' };
      const sideDir = path.join(owned, 'audit-gate-Ou00Ou');
      mkdirSync(sideDir);
      writeFileSync(path.join(sideDir, 'audit.json'), '{}');
      writeFileSync(path.join(outside, 'audit.json'), '{}');
      const junction = path.join(runTmp, 'audit-gate-Jn00Jn');
      symlinkSync(outside, junction, 'junction');
      const hard = path.join(auditDir('audit-gate-Hl00Hl'), 'audit.json');
      linkSync(path.join(outside, 'audit.json'), hard);
      const big = path.join(auditDir('audit-gate-Bg00Bg'), 'audit.json');
      writeFileSync(big, Buffer.alloc(1024 * 1024 + 1, 0x20));
      const cases: [string, RegExp][] = [
        [path.join(sideDir, 'audit.json'), /must be <runTmp>/],
        [path.join(path.dirname(auditJson), 'report.json'), /must be <runTmp>/],
        [path.join(runTmp, 'audit-gate-abc', 'audit.json'), /must be <runTmp>/],
        [`${path.dirname(auditJson)}\\..\\audit-gate-Xy34Zw\\audit.json`, /must be <runTmp>/],
        [auditJson.replace(/\\/g, '/'), /must be <runTmp>/],
        ['audit.json', /must be <runTmp>/],
        [path.join(junction, 'audit.json'), /real directory/],
        [path.join(auditDir('audit-gate-Em00Em'), 'audit.json'), /single-link regular file/],
        [hard, /single-link regular file/],
        [big, /single-link regular file/],
      ];
      for (const [file, reason] of cases) expect(gate([file], ok).reason, file).toMatch(reason);
    });

    it('rejects a symlinked audit.json (needs symlink privilege; skipped, not passed, without it)', (ctx) => {
      const link = path.join(auditDir('audit-gate-Sy00Sy'), 'audit.json');
      try {
        symlinkSync(path.join(outside, 'audit.json'), link, 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') ctx.skip('file symlink needs Developer Mode or admin');
        throw error;
      }
      expect(gate([link], { cwd: repoRoot, stdio: 'pipe' }).reason).toMatch(/single-link regular file/);
    });

    it('test-quality-metrics: exact alias, no args, cwd + stdio pipe only', () => {
      const run = (args: string[], options: unknown) => node('scripts/test-quality-metrics.mjs', args, options, policy);
      expect(run([], { cwd: process.cwd(), stdio: 'pipe' })).toMatchObject({
        ok: true, ruleId: 'node:test-quality-metrics', entry: path.join(repoRoot, 'scripts', 'test-quality-metrics.mjs'),
      });
      expect(run(['--json'], { cwd: repoRoot, stdio: 'pipe' }).reason).toMatch(/matches no vector/);
      expect(run([], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }).reason).toMatch(/options must be exactly/);
      expect(run([], { stdio: 'pipe' }).reason).toMatch(/options must be exactly/);
    });
  });

  describe('paid Google early refusal scripts', () => {
    const scripts = ['enrich-busan', 'enrich-city-restaurants'];
    const entryOf = (s: string) => path.join(repoRoot, 'scripts', `${s}.mjs`);

    it('accepts no-arg runs carrying only the exact sentinel and returns only that fixed env', () => {
      for (const s of scripts) {
        const r = node(entryOf(s), [], { encoding: 'utf8', env: { FOO: 'bar', GOOGLE_PLACES_API_KEY: 'must-not-be-used' } }, policy);
        expect(r).toMatchObject({ ok: true, ruleId: `node:${s}:refusal` });
        expect(r.fixedEnv).toEqual({ GOOGLE_PLACES_API_KEY: 'must-not-be-used' });
        expect(r.options).toEqual({ cwd: repoRoot, encoding: 'utf8' }); // canonical cwd, never the caller env
      }
    });

    it('rejects a fake real-looking key, missing/duplicate keys, args and extra options', () => {
      const e = entryOf('enrich-busan');
      const envReason = /env must carry GOOGLE_PLACES_API_KEY=must-not-be-used exactly once/;
      expect(node(e, [], { encoding: 'utf8', env: { GOOGLE_PLACES_API_KEY: 'AIzaSyFAKE-not-a-real-key-0000000000000' } }, policy).reason).toMatch(envReason);
      expect(node(e, [], { encoding: 'utf8', env: {} }, policy).reason).toMatch(envReason);
      expect(node(e, [], { encoding: 'utf8', env: { GOOGLE_PLACES_API_KEY: 'must-not-be-used', google_places_api_key: 'must-not-be-used' } }, policy).reason).toMatch(envReason);
      expect(node(e, [], { encoding: 'utf8', env: { get GOOGLE_PLACES_API_KEY() { return 'must-not-be-used'; } } }, policy).reason).toMatch(envReason);
      expect(node(e, [], { encoding: 'utf8' }, policy).reason).toMatch(/options must be exactly/);
      expect(node(e, ['--allow-paid-google-places', '--max-paid-requests=1'], { encoding: 'utf8', env: { GOOGLE_PLACES_API_KEY: 'must-not-be-used' } }, policy).reason).toMatch(/matches no vector/);
      expect(node(e, [], { cwd: repoRoot, encoding: 'utf8', env: { GOOGLE_PLACES_API_KEY: 'must-not-be-used' } }, policy).reason).toMatch(/options must be exactly/);
      // an inherited sentinel (own "__proto__" env key from JSON.parse) is not the own key
      expect(node(e, [], { encoding: 'utf8', env: JSON.parse('{"__proto__":{"GOOGLE_PLACES_API_KEY":"must-not-be-used"}}') }, policy).reason).toMatch(envReason);
      const env = { GOOGLE_PLACES_API_KEY: 'must-not-be-used' };
      expect(node(e, [], withOwnProto({ encoding: 'utf8', env }, {}), policy).reason).toMatch(/plain data/);
      expect(node(e, [], parsedWithProto({ encoding: 'utf8', env }, '{"shell":true}'), policy).reason).toMatch(/plain data/);
      expect(node(e, [], Object.create({ encoding: 'utf8', env }), policy).reason).toMatch(/plain data/);
      expect(node(e, [], { encoding: 'utf8', env, shell: true }, policy).reason).toMatch(/options must be exactly/);
    });
  });

  describe('openmontage CLI and plan-local runner (exact argv, exact options)', () => {
    const montage = () => path.join(repoRoot, 'scripts', 'export-openmontage-brief.mjs');
    const runMjs = () => path.join(repoRoot, 'scripts', 'plan-local', 'run.mjs');
    const montageOpts = () => ({ encoding: 'utf8', cwd: repoRoot, timeout: 30000 });

    it('openmontage: only --help and --locale fr, with exactly {encoding, cwd, timeout}', () => {
      const help = node(montage(), ['--help'], montageOpts(), policy);
      expect(help).toMatchObject({ ok: true, ruleId: 'node:openmontage-brief:help', entry: montage(), argv: ['--help'] });
      expect(help.options).toEqual({ cwd: repoRoot, encoding: 'utf8', timeout: 30000 });
      expect(help.fixedEnv).toBeUndefined();
      expect(node(montage(), ['--locale', 'fr'], montageOpts(), policy))
        .toMatchObject({ ok: true, ruleId: 'node:openmontage-brief:bad-locale', argv: ['--locale', 'fr'] });
      for (const args of [[], ['-h'], ['--locale', 'de'], ['--locale=fr'], ['--help', '--locale', 'fr'], ['--all'], ['fr', '--locale']]) {
        expect(node(montage(), args, montageOpts(), policy).reason, args.join(' ')).toMatch(/matches no vector/);
      }
      const extra: unknown[] = [
        { encoding: 'utf8', cwd: repoRoot },
        { encoding: 'utf8', cwd: repoRoot, timeout: 30000, shell: false },
        { encoding: 'utf8', cwd: repoRoot, timeout: 30000, env: { ...process.env } },
      ];
      for (const o of extra) expect(node(montage(), ['--help'], o, policy).reason).toMatch(/options must be exactly/);
      expect(node(montage(), ['--help'], { encoding: 'utf8', cwd: repoRoot, timeout: 60000 }, policy).reason).toMatch(/timeout must be 30000/);
      expect(node(montage(), ['--help'], { encoding: 'utf8', cwd: runTmp, timeout: 30000 }, policy).reason).toBe('cwd must be the repo root');
      expect(node(montage(), ['--help'], withOwnProto(montageOpts(), {}), policy).reason).toMatch(/plain data/);
      expect(node(montage(), ['--help'], parsedWithProto(montageOpts(), '{"shell":true}'), policy).reason).toMatch(/plain data/);
      expect(node(montage(), ['--help'], Object.create(montageOpts()), policy).reason).toMatch(/plain data/);
      expect(node('scripts/export-openmontage-brief.mjs', ['--help'], montageOpts(), policy).reason).toBe('unknown entry');
    });

    it('plan-local: only the sample and day-count-mismatch scenarios, with exactly {cwd, stdio:pipe}', () => {
      const ok = () => ({ cwd: repoRoot, stdio: 'pipe' });
      const sample = node(runMjs(), ['sample'], ok(), policy);
      expect(sample).toMatchObject({ ok: true, ruleId: 'node:plan-local:sample', entry: runMjs(), argv: ['sample'] });
      expect(sample.options).toEqual({ cwd: repoRoot, stdio: 'pipe' });
      expect(sample.fixedEnv).toBeUndefined();
      expect(node(runMjs(), ['__test_daycount_mismatch__'], ok(), policy))
        .toMatchObject({ ok: true, ruleId: 'node:plan-local:daycount-mismatch' });
      // no free-form scenario: the runner reads fixtures/<kind>-<scenario>.json for any name
      for (const args of [[], ['other'], ['Sample'], ['sample', 'x'], ['../sample'], ['__test_daycount_mismatch__ ']]) {
        expect(node(runMjs(), args, ok(), policy).reason, JSON.stringify(args)).toMatch(/matches no vector/);
      }
      expect(node(runMjs(), ['sample'], { cwd: repoRoot }, policy).reason).toMatch(/options must be exactly \{cwd,stdio\}/);
      expect(node(runMjs(), ['sample'], { cwd: repoRoot, stdio: IPP }, policy).reason).toMatch(/stdio must be pipe/);
      expect(node(runMjs(), ['sample'], { cwd: repoRoot, stdio: 'pipe', env: {} }, policy).reason).toMatch(/options must be exactly/);
      expect(node(runMjs(), ['sample'], { cwd: path.join(repoRoot, 'scripts'), stdio: 'pipe' }, policy).reason).toBe('cwd must be the repo root');
      expect(node(runMjs(), ['sample'], withOwnProto(ok(), {}), policy).reason).toMatch(/plain data/);
      expect(node(runMjs(), ['sample'], { ...ok(), [Symbol('shell')]: true }, policy).reason).toMatch(/plain data/);
      expect(node('scripts/plan-local/run.mjs', ['sample'], ok(), policy).reason).toBe('unknown entry');
    });

    it('a recognized entry reports its own reason (never "unknown entry") even for malformed options', () => {
      // The guard hands only "unknown entry" on to its static rules; anything else is a denial.
      expect(node(runMjs(), ['sample'], 'pipe', policy).reason).toMatch(/plain data/);
      expect(node(montage(), 'x', montageOpts(), policy).reason).toMatch(/argv must be/);
    });
  });

  it('unknown entries and non-string input fail closed', () => {
    for (const entry of [path.join(repoRoot, 'scripts', 'plan-local', 'record.mjs'), path.join(outside, 'projection-worker.mjs'),
      '-e', 'scripts/apply-brain-guide-projection.lib.mjs', repoRoot, 42]) {
      expect(node(entry, [], undefined, policy).reason).toBe('unknown entry');
    }
    // unknown entries are reported before argv/options are looked at
    expect(node(path.join(repoRoot, 'scripts', 'llm-compare-providers.mjs'), [], 'not-options', policy).reason).toBe('unknown entry');
    expect(node(worker(), 'x', { stdio: IPP }, policy).reason).toMatch(/argv must be/);
    expect(node(worker(), [1], { stdio: IPP }, policy).reason).toMatch(/argv must be/);
    expect(node(worker(), ['a\0b'], { stdio: IPP }, policy).reason).toMatch(/argv must be/);
  });

  it('policy runTmp behind a junction is rejected', () => {
    const link = path.join(owned, 'tmp-link');
    symlinkSync(runTmp, link, 'junction');
    expect(node(exitEntry(), [], undefined, { ...policy, runTmp: link }).reason).toMatch(/runTmp must be a real directory/);
  });

  describe('Git vectors', () => {
    it('accepts the 7 vectors via "git" or the pinned exe and returns the pinned launch', () => {
      const ids = new Set<string>();
      for (const file of ['git', GIT_PIN.path]) {
        for (const c of rules.GIT_IGNORE_CANDIDATES) {
          const r = git(file, ['check-ignore', '-q', c], { cwd: process.cwd() }, policy);
          expect(r).toMatchObject({ ok: true, entry: GIT_PIN.path });
          expect(r.options).toEqual({ cwd: repoRoot });
          expect(r.argv).toEqual([...rules.GIT_PROTECT_ARGS, 'check-ignore', '-q', c]);
          expect(r.fixedEnv).toEqual(rules.GIT_FIXED_ENV);
          ids.add(r.ruleId as string);
        }
        const ls = git(file, ['ls-files', '--stage', 'android-owner/gradlew'], { encoding: 'utf8' }, policy);
        expect(ls).toMatchObject({ ok: true, ruleId: 'git:ls-files-stage-gradlew' });
        expect(ls.options).toEqual({ cwd: repoRoot, encoding: 'utf8' });
        ids.add(ls.ruleId as string);
      }
      expect([...ids].sort()).toEqual([...rules.GIT_RULE_IDS].sort());
    });

    it('rejects other executables, argv and options', () => {
      const ci = ['check-ignore', '-q', rules.GIT_IGNORE_CANDIDATES[0]];
      const opt = { cwd: repoRoot };
      for (const file of ['git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:/Program Files/Git/cmd/git.exe',
        path.join(outside, 'git.exe'), 'node']) {
        expect(git(file, ci, opt, policy).reason, file).toMatch(/pinned git.exe/);
      }
      for (const args of [['check-ignore', rules.GIT_IGNORE_CANDIDATES[0]], ['check-ignore', '-q', 'android-owner/app/other.jks'],
        [...ci, 'extra'], ['-c', 'core.fsmonitor=evil', ...ci], ['ls-files', '--stage'], ['status']]) {
        expect(git('git', args, opt, policy).reason).toMatch(/7 pinned vectors/);
      }
      expect(git('git', ci, {}, policy).reason).toMatch(/options must be exactly \{cwd\}/);
      expect(git('git', ci, { cwd: runTmp }, policy).reason).toBe('cwd must be the repo root');
      expect(git('git', ci, { cwd: repoRoot, shell: true }, policy).reason).toMatch(/options must be exactly/);
      expect(git('git', ci, { cwd: repoRoot, encoding: 'utf8' }, policy).reason).toMatch(/options must be exactly/);
      const ls = ['ls-files', '--stage', 'android-owner/gradlew'];
      expect(git('git', ls, { cwd: repoRoot, encoding: 'utf8' }, policy).reason).toMatch(/options must be exactly \{encoding\}/);
      expect(git('git', ls, { encoding: 'buffer' }, policy).reason).toMatch(/encoding must be utf8/);
      expect(git('git', ls, { encoding: 'utf8', shell: true }, policy).reason).toMatch(/options must be exactly/);
      expect(git('git', ls, withOwnProto({ encoding: 'utf8' }, { cwd: runTmp }), policy).reason).toMatch(/plain data/);
      expect(git('git', ls, parsedWithProto({ encoding: 'utf8' }, '{"shell":true}'), policy).reason).toMatch(/plain data/);
      expect(git('git', ls, parsedWithProto({ encoding: 'utf8' }, 'null'), policy).reason).toMatch(/plain data/);
      expect(git('git', ci, withOwnProto(opt, {}), policy).reason).toMatch(/plain data/);
      expect(git('git', ci, Object.create(opt), policy).reason).toMatch(/plain data/);
      expect(git('git', ci, { get cwd() { return repoRoot; } }, policy).reason).toMatch(/plain data/);
      expect(git('git', ci, { ...opt, [Symbol('shell')]: true }, policy).reason).toMatch(/plain data/);
      expect(git('git', ci, opt, withOwnProto(policy, {})).reason).toMatch(/exactly \{gitPath,repoRoot,runTmp\}/);
      expect(git('git', ci, opt, parsedWithProto(policy, '{}')).reason).toMatch(/exactly \{gitPath,repoRoot,runTmp\}/);
    });
  });
});

// ---- browser-native-rules.cjs ffmpeg vectors + capture planner-repair mode (2026-10-18) ----
// Pure validator calls and source reads only; nothing is launched. The expected recorder argv is
// rebuilt here from the coreBundle.js:36868-36869 template, independently of the rules file.
type NativeRules = {
  PLAYWRIGHT_VERSION: string;
  validateNativeInvocation: (kind: unknown, argv: unknown, options: unknown, policy: unknown) => { ok: boolean; reason?: string };
};
const native = require('../../scripts/offline/browser-native-rules.cjs') as NativeRules;

describe('browser native rules: ffmpeg recorder argv (all platforms)', () => {
  const runRoot = 'E:\\runs\\20261018-000000-capture-videos-abcdef12';
  const policy = { runRoot, origin: 'http://127.0.0.1:5192', browserPath: 'C:\\pw\\chromium\\chrome-headless-shell.exe', ffmpegPath: 'C:\\pw\\ffmpeg-1011\\ffmpeg-win64.exe' };
  const opts = { detached: false, env: {}, stdio: ['pipe', 'pipe', 'pipe'] };
  const guid = '0123456789abcdef0123456789abcdef';
  const out = (cell = '390-en', flow = 'planner', motion = 'reduce', tail = `page@${guid}.webm`) =>
    `${runRoot}\\capture\\videos\\${flow}\\${cell}-${motion}\\raw\\${tail}`;
  const vfOf = (w: number, h: number) => `pad=${w}:${h}:0:0:gray,crop=${w}:${h}:0:0`;
  const recorder = (w: number, h: number, output: string, vf = vfOf(w, h)) => {
    const args = `-loglevel error -f matroska -fpsprobesize 0 -probesize 32 -analyzeduration 0 -i pipe:0 -y -an -r 25 -c:v vp8 -qmin 0 -qmax 50 -crf 8 -deadline realtime -speed 8 -b:v 1M -threads 1 -vf ${vf}`.split(' ');
    args.push(output);
    return args;
  };
  const ff = (argv: unknown, options: unknown = opts, p: unknown = policy) => native.validateNativeInvocation('ffmpeg', argv, options, p);
  const swap = (argv: string[], from: string, to: string) => argv.map((a) => (a === from ? to : a));

  it('the expected filter is the Chromium recorder default in the installed coreBundle', () => {
    const bundle = source('node_modules/playwright-core/lib/coreBundle.js');
    expect(native.PLAYWRIGHT_VERSION).toBe('1.62.1');
    expect(bundle).toContain('page.getFFmpegVideoFilterArgs?.({ width: w, height: h }) ?? `pad=${w}:${h}:0:0:gray,crop=${w}:${h}:0:0`');
    expect(bundle).toContain('-i pipe:0 -y -an -r ${fps} -c:v vp8 -qmin 0 -qmax 50 -crf 8 -deadline realtime -speed 8 -b:v 1M -threads 1 -vf ${videoFilterArgs}');
    const rulesText = source('scripts/offline/browser-native-rules.cjs');
    expect(rulesText).toContain('const vf = `pad=${w}:${h}:0:0:gray,crop=${w}:${h}:0:0`;');
    expect(rulesText).not.toContain('scale=');
  });

  it('accepts exactly the corrected 390x844 (390-en) and 1440x1000 (1440-ko) recorder argv', () => {
    for (const flow of ['home', 'planner', 'charter', 'tours']) {
      for (const motion of ['no-preference', 'reduce']) {
        expect(ff(recorder(390, 844, out('390-en', flow, motion)))).toEqual({ ok: true });
        expect(ff(recorder(1440, 1000, out('1440-ko', flow, motion)))).toEqual({ ok: true });
      }
    }
  });

  it('rejects the old BiDi filter, altered dimensions and any changed/extra filter expression', () => {
    const o = out();
    const bidi = "scale=w='min(iw,390)':h='min(ih,844)':force_original_aspect_ratio=decrease:eval=frame,pad=390:844:0:0:gray";
    for (const vf of [
      bidi, vfOf(1440, 1000), vfOf(391, 844), vfOf(390, 845), 'pad=390:844:0:0:gray,crop=1440:1000:0:0',
      'pad=390:844:0:0:black,crop=390:844:0:0', 'pad=390:844:0:0,crop=390:844:0:0', 'pad=390:844:1:0:gray,crop=390:844:0:0',
      'pad=390:844:0:0:gray,crop=390:844:0:1', 'pad=390:844:0:0:gray', 'crop=390:844:0:0',
      'pad=390:844:0:0:gray,crop=390:844:0:0,scale=390:844', 'null,pad=390:844:0:0:gray,crop=390:844:0:0',
      "pad=390:844:0:0:gray,crop=390:844:0:0,drawtext=text='x'", 'pad=390:844:0:0:gray;crop=390:844:0:0',
    ]) {
      expect(ff(recorder(390, 844, o, vf)).ok, vf).toBe(false);
    }
    expect(ff(recorder(390, 844, out('1440-ko'))).ok).toBe(false);
    expect(ff(recorder(1440, 1000, o)).ok).toBe(false);
  });

  it('rejects any other input, reordered/missing/additional args and extra outputs', () => {
    const o = out();
    const good = recorder(390, 844, o);
    for (const input of ['pipe:1', 'C:\\x.mkv', 'http://127.0.0.1:9/x', 'tcp://127.0.0.1:9', 'concat:a|b', 'file:pipe:0']) {
      expect(ff(swap(good, 'pipe:0', input)).ok, input).toBe(false);
    }
    const at = good.indexOf('-i');
    const th = good.indexOf('-threads');
    const variants: string[][] = [
      [...good.slice(0, at), '-i', 'C:\\x.mkv', ...good.slice(at)],
      [...good.slice(0, at), '-f', 'lavfi', ...good.slice(at)],
      good.map((a) => (a === '-y' ? '-an' : a === '-an' ? '-y' : a)),
      good.filter((a) => a !== '-an'),
      good.filter((_, i) => i !== th && i !== th + 1),
      [...good.slice(0, -1), out('390-en', 'home'), o],
      [...good, out('390-en', 'home')],
      [...good.slice(0, -1), '-f', 'webm', o],
      [...good.slice(0, -1), 'C:\\elsewhere\\x.webm', o],
      ['-y', ...good],
      [],
    ];
    for (const argv of variants) expect(ff(argv).ok, argv.join(' ')).toBe(false);
  });

  it('rejects outputs outside the run cell layout', () => {
    for (const output of [
      out().replace(runRoot, 'E:\\runs\\20261018-000000-capture-videos-other123'),
      out().replace(runRoot, runRoot + 'x'),
      out().replace('\\raw\\', '\\raw\\..\\..\\raw\\'),
      out().replace('\\raw\\', '\\.\\raw\\'),
      '\\\\host\\share' + out().slice(2),
      'file:///' + out().replace(/\\/g, '/'),
      out().replace(/\\/g, '/'),
      out() + ':evil',
      out('390-en', 'planner', 'reduce', `page@${guid}.webm:stream`),
      out('390-ko'), out('1440-en'), out('360-en'), out('390-en', 'result'), out('390-en', 'video'),
      out('390-en', 'planner', 'auto'),
      out('390-en', 'planner', 'reduce', `page@${guid.toUpperCase()}.webm`),
      out('390-en', 'planner', 'reduce', `page@${guid.slice(1)}.webm`),
      out('390-en', 'planner', 'reduce', `${guid}.webm`),
      out('390-en', 'planner', 'reduce', `page@${guid}.mp4`),
      out('390-en', 'planner', 'reduce', `page@${guid}.webm.exe`),
      out().replace('\\raw\\', '\\'),
      out().replace('\\capture\\videos\\', '\\capture\\shots\\'),
    ]) {
      expect(ff(recorder(390, 844, output)).ok, output).toBe(false);
    }
  });

  it('rejects shell, detached, cwd, unknown options and non-exact stdio', () => {
    const argv = recorder(390, 844, out());
    for (const options of [
      { ...opts, shell: true }, { ...opts, shell: 'cmd.exe' }, { ...opts, detached: true }, { env: {}, stdio: opts.stdio },
      { ...opts, cwd: 'C:\\' }, { ...opts, windowsHide: true }, { ...opts, argv0: 'x' },
      { ...opts, stdio: ['pipe', 'pipe', 'inherit'] }, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] },
      { ...opts, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }, { ...opts, stdio: 'pipe' }, { ...opts, env: null },
      null, [], 'pipe',
    ]) {
      expect(ff(argv, options).ok, JSON.stringify(options)).toBe(false);
    }
    expect(native.validateNativeInvocation('ffmpeg.exe', argv, opts, policy).ok).toBe(false);
    expect(native.validateNativeInvocation('chromium', argv, { ...opts, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] }, policy).ok).toBe(false);
    expect(ff(argv, opts, { ...policy, origin: 'http://localhost:5192' }).ok).toBe(false);
    expect(ff(argv, opts, { ...policy, ffmpegPath: runRoot + '\\ffmpeg-win64.exe' }).ok).toBe(false);
  });
});

describe('capture planner-repair mode: fixed enum in both mappings (source)', () => {
  const ps1 = source('scripts/offline/Run-Capture.ps1');
  const mjs = source('scripts/offline/browser-profile-main.mjs');
  const repairArgs = ['--group', 'planner', '--width', '360,390,430', '--lang', 'ko,en,ja,zh'];
  const quoted = (list: string) => [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);

  it('adds only planner-repair to the PowerShell ValidateSet and mode table', () => {
    const set = /\[ValidateSet\(([^)]*)\)\]\[string\]\$Mode/.exec(ps1);
    expect(set && quoted(set[1])).toEqual(['pilot', 'matrix', 'videos', 'planner-repair']);
    const param = /param\(\s*([\s\S]*?)\r?\n\)/.exec(ps1);
    expect(param && param[1].trim().split(/\r?\n/)).toHaveLength(1);
    const row = /^ {2}'planner-repair' = @\{ TimeoutMs = 65 \* 60000; Ffmpeg = 0; Args = @\(([^)]*)\) \}\r?$/m.exec(ps1);
    expect(row && quoted(row[1])).toEqual(repairArgs);
    expect(ps1).toContain("  pilot  = @{ TimeoutMs = 65 * 60000; Ffmpeg = 0; Args = @('--group', 'planner,charter,result', '--width', '390,1440', '--lang', 'ja,en') }");
    expect(ps1).toContain("  matrix = @{ TimeoutMs = 425 * 60000; Ffmpeg = 0; Args = @('--group', 'home,planner,result,tours,charter,map,static,account', '--width', '360,390,430,1024,1440', '--lang', 'ko,en,ja,zh') }");
    expect(ps1).toContain("  videos = @{ TimeoutMs = 125 * 60000; Ffmpeg = 16; Args = @('--group', 'video', '--width', '390,1440', '--lang', 'en,ko', '--video-flow', 'home,planner,charter,tours') }");
    expect(ps1).toContain("$harnessArgs = @('--base-url', $Origin, '--out', $captureDir) + $def.Args");
    expect(ps1).toContain('entry = $HarnessPath; argSets = (New-List $harnessArgs)');
    expect(ps1).toContain('$argv = @($MainPath, $Mode)');
    expect(ps1).toContain('if ($ffmpegCount -ne $def.Ffmpeg)');
  });

  it('browser-profile-main maps the same fixed args with a shorter child timeout and rejects other argv', () => {
    const row = /^ {2}'planner-repair': \{ timeoutMs: 60 \* MINUTE, args: \[([^\]]*)\] \},\r?$/m.exec(mjs);
    expect(row && quoted(row[1])).toEqual(repairArgs);
    const modes = /const MODES = \{([\s\S]*?)\r?\n\};/.exec(mjs);
    const keys = modes ? [...modes[1].matchAll(/^ {2}'?([a-z-]+)'?: \{/gm)].map((m) => m[1]) : [];
    expect(keys).toEqual(['pilot', 'matrix', 'videos', 'planner-repair']);
    expect(mjs).toContain("pilot: { timeoutMs: 60 * MINUTE, args: ['--group', 'planner,charter,result', '--width', '390,1440', '--lang', 'ja,en'] },");
    expect(mjs).toContain("args: ['--group', 'home,planner,result,tours,charter,map,static,account', '--width', '360,390,430,1024,1440', '--lang', 'ko,en,ja,zh'],");
    expect(mjs).toContain("args: ['--group', 'video', '--width', '390,1440', '--lang', 'en,ko', '--video-flow', 'home,planner,charter,tours'],");
    expect(mjs).toContain("const mode = process.argv.length === 3 ? process.argv[2] : '';");
    expect(mjs).toContain('if (!Object.prototype.hasOwnProperty.call(MODES, mode)) refuse(');
    expect(mjs).toContain("const harnessArgv = [HARNESS, '--base-url', ORIGIN, '--out', out, ...MODES[mode].args];");
  });
});
