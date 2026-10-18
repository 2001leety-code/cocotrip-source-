'use strict';
// Bounded argv/options validator for the full-unit (vitest-unit) profile: the fixed Node children
// and the 7 Git vectors that tests/unit spawns. No execution, no network, no env/.env/secret reads;
// the only I/O is lstat/realpath for containment. Required by guard.cjs only when the hashed config
// carries fullUnitRules (vitest-unit full and the fullunit-canary profile); see FULL-UNIT.md.
// Every vector below was read from the test sources named next to it; anything else fails closed.
const fs = require('fs');
const crypto = require('crypto');
const win = require('path').win32;

// Verified by the parent on this machine. The guard pins size+sha256 before every launch; this
// module only checks the path. An exe pin does not prove the DLLs Git loads or OS-level offline.
const GIT_PIN = Object.freeze({
  path: 'C:\\Program Files\\Git\\cmd\\git.exe',
  size: 46480,
  sha256: '81ef35ae005ca9318018d18e3327578ce939fb99feaad6b2d7c8ab15f3de8db5',
  version: '2.54.0.windows.1',
});

const fail = (reason) => Object.freeze({ ok: false, reason });
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};

// ---- projection (tests/unit/apply-brain-guide-projection.test.ts manifest()/secondManifest()) ----
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const FIRST_HTML = '<p class="post-summary"><em>Rain route.</em></p><h2>Plan</h2><p>Use Line 2.</p>';
const SECOND_HTML = '<p class="post-summary"><em>Busan route.</em></p><h2>Plan</h2><p>Start at the beach.</p>';
const FIRST = {
  schemaVersion: 1,
  queueId: 'blog_20260823_rain',
  slug: 'seoul-rainy-day-guide-2026',
  canonicalUrl: 'https://cocotripkr.com/guide/seoul-rainy-day-guide-2026',
  contentSha256: sha256(FIRST_HTML), // = brainGuideHtmlSha256(html); cross-checked by the unit test
  title: 'Seoul Rainy Day Guide 2026',
  description: 'Practical indoor routes for a rainy day in Seoul.',
  published: '2026-08-23',
  labels: ['Rainy Day', 'Seoul'],
  html: FIRST_HTML,
  review: { verdict: 'pass', score: 96 },
  approval: { approvedBy: 'discord:12345', approvedAt: '2026-08-23T10:00:00+09:00' },
  qualityRulesVersion: 'brain-content-quality-v1',
};
// `{ ...manifest(), ... }`: same key order, overridden values.
const SECOND = Object.assign({}, FIRST, {
  queueId: 'blog_20260823_busan',
  slug: 'busan-beach-guide-2026',
  canonicalUrl: 'https://cocotripkr.com/guide/busan-beach-guide-2026',
  contentSha256: sha256(SECOND_HTML),
  title: 'Busan Beach Guide 2026',
  description: 'A practical beach route for a day in Busan.',
  html: SECOND_HTML,
});
const PROJECTION_MANIFESTS = deepFreeze({ first: FIRST, second: SECOND });
const BAD_PROJECTION_ROOT_NAME = 'not-a-cocotrip-projection-root';
const PROJECTION_ROOT_NAME = /^cocotrip-guide-projection-[A-Za-z0-9]{6}$/; // mkdtemp 6-char suffix
const MAX_PAYLOAD_CHARS = 16 * 1024;
// The only three payloads the test sends: parallel pair (600 ms hold, then 0) and the bad root,
// which must reach the worker so it exits 64 before any projection.
const PROJECTION_COMBOS = Object.freeze([
  { id: 'node:projection-worker:first-hold-600', manifest: JSON.stringify(FIRST), holdMs: 600, root: 'temp' },
  { id: 'node:projection-worker:second-hold-0', manifest: JSON.stringify(SECOND), holdMs: 0, root: 'temp' },
  { id: 'node:projection-worker:bad-root-exit-64', manifest: JSON.stringify(FIRST), holdMs: 0, root: 'bad' },
]);

// ---- audit gate (tests/unit/audit-gate.test.ts): mkdtemp(TMP, 'audit-gate-') + '\\audit.json' ----
const AUDIT_DIR_NAME = /^audit-gate-[A-Za-z0-9]{6}$/;
const MAX_AUDIT_BYTES = 1024 * 1024; // helper bound, not from the test; the content is never read

// ---- paid Google refusal (tests/unit/paid-google-scripts-consent.test.ts) ----
const SENTINEL_KEY = 'GOOGLE_PLACES_API_KEY';
const SENTINEL = 'must-not-be-used';

// ---- Git (owner-controller-preflight.test.ts:133-141, owner-android-workflow.test.ts:62) ----
const GIT_IGNORE_CANDIDATES = Object.freeze([
  'android-owner/app/upload.jks',
  'android-owner/app/keys/release.keystore',
  'android-owner/deep/signing/release.p12',
  'android-owner/app/release.pfx',
  'android-owner/app/local.properties',
  'android-owner/app/keystore.properties',
]);
// Protective prefix and env the guard adds when it runs the pinned exe (no shell). The repo
// .gitignore alone covers every candidate, so dropping system/global config keeps the results.
const GIT_PROTECT_ARGS = Object.freeze(['--no-optional-locks', '-c', 'core.fsmonitor=false']);
const GIT_FIXED_ENV = Object.freeze({
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
});

// Option shape markers: CWD = must be the repo root; ENV = must carry the sentinel exactly once.
const CWD = Symbol('cwd');
const ENV = Symbol('env');
const IPP = Object.freeze(['ignore', 'pipe', 'pipe']);

const GIT_VECTORS = Object.freeze(GIT_IGNORE_CANDIDATES.map((c) => (
  { id: 'git:check-ignore:' + c, args: ['check-ignore', '-q', c], shape: { cwd: CWD } }
)).concat([
  { id: 'git:ls-files-stage-gradlew', args: ['ls-files', '--stage', 'android-owner/gradlew'], shape: { encoding: 'utf8' } },
]));

// ---- openmontage CLI (openmontage-brief.test.ts:523-538): usage exits before any Vite data load ----
const OPENMONTAGE_SHAPE = Object.freeze({ encoding: 'utf8', cwd: CWD, timeout: 30000 });
// ---- plan-local runner (plan-local-prewrite-quality-gate.test.ts:203-252): two fixed scenarios ----
const PLAN_LOCAL_SHAPE = Object.freeze({ cwd: CWD, stdio: 'pipe' });

const FIXTURES = 'tests\\fixtures\\integration-20261017\\';
// rel is below repoRoot. alias: the exact relative argv[0] the test passes with cwd = repo root.
// argv: the exact argument list a vector accepts (no free-form scenario or flag).
const NODE_RULES = Object.freeze([
  { rel: FIXTURES + 'projection-worker.mjs', vectors: [{ argc: 1, shape: { stdio: IPP }, args: projectionPayload }] },
  { rel: FIXTURES + 'projection-exit.mjs', vectors: [{ id: 'node:projection-exit', argc: 0, shape: {} }] },
  { alias: 'scripts/audit-gate.mjs', rel: 'scripts\\audit-gate.mjs', vectors: [
    { id: 'node:audit-gate:file-utf8', argc: 1, shape: { cwd: CWD, encoding: 'utf8', stdio: IPP }, args: auditFile },
    { id: 'node:audit-gate:file-pipe', argc: 1, shape: { cwd: CWD, stdio: 'pipe' }, args: auditFile },
    { id: 'node:audit-gate:no-file', argc: 0, shape: { cwd: CWD, stdio: 'pipe' } },
  ] },
  { alias: 'scripts/test-quality-metrics.mjs', rel: 'scripts\\test-quality-metrics.mjs', vectors: [
    { id: 'node:test-quality-metrics', argc: 0, shape: { cwd: CWD, stdio: 'pipe' } },
  ] },
  { rel: 'scripts\\enrich-busan.mjs', vectors: [
    { id: 'node:enrich-busan:refusal', argc: 0, shape: { encoding: 'utf8', env: ENV } },
  ] },
  { rel: 'scripts\\enrich-city-restaurants.mjs', vectors: [
    { id: 'node:enrich-city-restaurants:refusal', argc: 0, shape: { encoding: 'utf8', env: ENV } },
  ] },
  { rel: 'scripts\\export-openmontage-brief.mjs', vectors: [
    { id: 'node:openmontage-brief:help', argc: 1, argv: ['--help'], shape: OPENMONTAGE_SHAPE },
    { id: 'node:openmontage-brief:bad-locale', argc: 2, argv: ['--locale', 'fr'], shape: OPENMONTAGE_SHAPE },
  ] },
  { rel: 'scripts\\plan-local\\run.mjs', vectors: [
    { id: 'node:plan-local:sample', argc: 1, argv: ['sample'], shape: PLAN_LOCAL_SHAPE },
    { id: 'node:plan-local:daycount-mismatch', argc: 1, argv: ['__test_daycount_mismatch__'], shape: PLAN_LOCAL_SHAPE },
  ] },
]);
for (const r of NODE_RULES) {
  if (r.alias && !r.vectors.every((v) => v.shape.cwd === CWD)) throw new Error('alias rule without fixed cwd');
}

// ---- paths ----
// Absolute drive path, backslashes only, no empty/./.. segments, no trailing dot/space aliases.
function canonicalPath(p) {
  if (typeof p !== 'string' || !/^[A-Za-z]:\\[^\0/]+$/.test(p) || p.endsWith('\\')) return false;
  return p.slice(3).split('\\').every((s) => s !== '' && s !== '.' && s !== '..' && !/[<>:"|?*]/.test(s) && !/[. ]$/.test(s));
}

// Path below root ('' if equal), or null when p is not inside root.
function relativeInside(root, p) {
  if (!canonicalPath(p)) return null;
  if (same(p, root)) return '';
  return p.toLowerCase().startsWith(root.toLowerCase() + '\\') ? p.slice(root.length + 1) : null;
}

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    return null;
  }
}

// The final path equals p: no symlink/junction/short-name anywhere on the way.
function realOk(p) {
  try {
    return same(fs.realpathSync.native(p), p);
  } catch (e) {
    return false;
  }
}

function realDir(p) {
  const st = lstat(p);
  return !!st && st.isDirectory() && !st.isSymbolicLink() && realOk(p);
}

// ---- plain data copies: no getters, no symbols, no foreign prototypes ----
// The copy has a null prototype, and an own '__proto__' key (JSON.parse/defineProperty) is
// rejected outright: assigning it into a {} would swap the prototype and drop the key before the
// exact-keys check.
function ownData(obj) {
  if (obj === undefined) return Object.create(null);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return null;
  const out = Object.create(null);
  for (const k of Reflect.ownKeys(obj)) {
    if (k === '__proto__') return null;
    const d = typeof k === 'string' ? Object.getOwnPropertyDescriptor(obj, k) : null;
    if (!d || !('value' in d)) return null;
    out[k] = d.value;
  }
  return out;
}

function stringList(list) {
  if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype) return null;
  if (Reflect.ownKeys(list).length !== list.length + 1) return null;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const d = Object.getOwnPropertyDescriptor(list, i);
    if (!d || !('value' in d) || typeof d.value !== 'string' || d.value.indexOf('\0') !== -1) return null;
    out.push(d.value);
  }
  return out;
}

// Only the sentinel key is looked at; every other caller env key is discarded by the guard.
function sentinelEnvOk(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return false;
  let found = 0;
  for (const k of Reflect.ownKeys(env)) {
    if (typeof k !== 'string' || k.toUpperCase() !== SENTINEL_KEY) continue;
    const d = Object.getOwnPropertyDescriptor(env, k);
    if (!d || !('value' in d) || d.value !== SENTINEL) return false;
    found++;
  }
  return found === 1;
}

function optionsProblem(opts, shape, policy) {
  const want = Object.keys(shape).sort().join(',');
  if (Object.keys(opts).sort().join(',') !== want) return 'options must be exactly {' + want + '}';
  for (const k of Object.keys(shape)) {
    const e = shape[k];
    const v = opts[k];
    if (e === CWD) {
      if (!canonicalPath(v) || !same(v, policy.repoRoot) || !realOk(v)) return 'cwd must be the repo root';
    } else if (e === ENV) {
      if (!sentinelEnvOk(v)) return 'env must carry ' + SENTINEL_KEY + '=' + SENTINEL + ' exactly once';
    } else if (Array.isArray(e)) {
      const list = stringList(v);
      if (!list || !sameList(list, e)) return k + ' must be exactly ' + e.join(',');
    } else if (v !== e) {
      return k + ' must be ' + e;
    }
  }
  return '';
}

// Options the guard should launch with: cwd is always the repo root, env is never carried over.
// Vectors without a caller cwd inherit the vitest cwd (= repo root) in the source tests; the guard
// sets it explicitly. This does not widen the caller shape: a caller cwd there is still rejected.
function safeOptions(shape, policy) {
  const out = { cwd: policy.repoRoot };
  for (const k of Object.keys(shape)) {
    if (shape[k] !== CWD && shape[k] !== ENV) out[k] = Array.isArray(shape[k]) ? shape[k].slice() : shape[k];
  }
  return out;
}

function checkPolicy(policy) {
  const p = policy === undefined ? null : ownData(policy);
  if (!p || Object.keys(p).sort().join(',') !== 'gitPath,repoRoot,runTmp') return { reason: 'policy must be exactly {gitPath,repoRoot,runTmp}' };
  for (const k of ['gitPath', 'repoRoot', 'runTmp']) {
    if (!canonicalPath(p[k])) return { reason: 'policy.' + k + ' is not a canonical absolute path' };
  }
  if (!same(p.gitPath, GIT_PIN.path)) return { reason: 'policy.gitPath must be the pinned Git' };
  if (relativeInside(p.repoRoot, p.runTmp) !== null || relativeInside(p.runTmp, p.repoRoot) !== null) {
    return { reason: 'policy.repoRoot and policy.runTmp must not overlap' };
  }
  if (!realDir(p.repoRoot)) return { reason: 'policy.repoRoot must be a real directory (no links)' };
  if (!realDir(p.runTmp)) return { reason: 'policy.runTmp must be a real directory (no links)' };
  return { policy: p };
}

// ---- vector argument checks: return { reason } or { id? } ----
function projectionRootKind(root, policy) {
  if (!canonicalPath(root) || !same(win.dirname(root), policy.runTmp)) return '';
  const name = win.basename(root);
  if (name === BAD_PROJECTION_ROOT_NAME) return 'bad'; // never touched: the worker rejects it lexically
  return PROJECTION_ROOT_NAME.test(name) && realDir(root) ? 'temp' : '';
}

function projectionPayload(args, policy) {
  const b64 = args[0];
  if (b64.length === 0 || b64.length > MAX_PAYLOAD_CHARS) return { reason: 'payload must be 1..' + MAX_PAYLOAD_CHARS + ' chars' };
  if (!/^[A-Za-z0-9_-]+$/.test(b64)) return { reason: 'payload is not base64url' };
  const buf = Buffer.from(b64, 'base64url');
  if (buf.toString('base64url') !== b64) return { reason: 'payload is not canonical base64url' };
  let text = '';
  let p = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
    p = JSON.parse(text);
  } catch (e) {
    return { reason: 'payload is not UTF-8 JSON' };
  }
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).join(',') !== 'root,manifest,holdMs') {
    return { reason: 'payload keys must be exactly root,manifest,holdMs' };
  }
  if (JSON.stringify(p) !== text) return { reason: 'payload is not canonical JSON' };
  const manifest = JSON.stringify(p.manifest);
  const kind = projectionRootKind(p.root, policy);
  if (!kind) return { reason: 'root is not <runTmp>\\cocotrip-guide-projection-<6 alnum> (real dir) or <runTmp>\\' + BAD_PROJECTION_ROOT_NAME };
  const combo = PROJECTION_COMBOS.find((c) => c.manifest === manifest && c.holdMs === p.holdMs && c.root === kind);
  return combo ? { id: combo.id } : { reason: 'manifest/holdMs/root combination is not pinned' };
}

function auditFile(args, policy) {
  const file = args[0];
  const where = { reason: 'audit file must be <runTmp>\\audit-gate-<6 alnum>\\audit.json' };
  if (!canonicalPath(file) || win.basename(file) !== 'audit.json') return where;
  const dir = win.dirname(file);
  if (!same(win.dirname(dir), policy.runTmp) || !AUDIT_DIR_NAME.test(win.basename(dir))) return where;
  if (!realDir(dir)) return { reason: 'audit dir must be a real directory (no links)' };
  const st = lstat(file);
  if (!st || !st.isFile() || st.nlink !== 1 || st.size > MAX_AUDIT_BYTES || !realOk(file)) {
    return { reason: 'audit.json must be a single-link regular file <= ' + MAX_AUDIT_BYTES + ' bytes' };
  }
  return {};
}

// ---- public API ----
/**
 * entry: argv[0] after the fixed node.exe; argv: the arguments after entry; options: the caller's
 * spawn options; policy: { repoRoot, runTmp, gitPath } from the hashed guard config.
 * Returns { ok: true, ruleId, entry (absolute), argv, options, fixedEnv? } or { ok: false, reason }.
 */
function validateFullUnitNode(entry, argv, options, policy) {
  const pol = checkPolicy(policy);
  if (pol.reason) return fail(pol.reason);
  const p = pol.policy;
  // The entry is identified first: 'unknown entry' is the only result the guard may hand on to its
  // older static rules, so it must not depend on the shape of argv/options.
  let rule = null;
  if (typeof entry === 'string') {
    rule = NODE_RULES.find((r) => r.alias === entry) || null;
    const rel = rule ? null : relativeInside(p.repoRoot, entry);
    if (rel) rule = NODE_RULES.find((r) => !r.alias && same(rel, r.rel)) || null;
  }
  if (!rule) return fail('unknown entry');
  const args = stringList(argv);
  if (!args) return fail('argv must be an array of plain strings');
  const opts = ownData(options);
  if (!opts) return fail('options must be plain data');
  const abs = win.join(p.repoRoot, rule.rel);
  const st = lstat(abs);
  if (!st || !st.isFile() || !realOk(abs)) return fail('entry must be a regular file inside the repo (no links)');
  let reason = 'argv length ' + args.length + ' matches no vector';
  for (const v of rule.vectors) {
    if (v.argc !== args.length) continue;
    if (v.argv && !sameList(args, v.argv)) continue;
    const problem = optionsProblem(opts, v.shape, p);
    if (problem) { reason = problem; continue; }
    const r = v.args ? v.args(args, p) : {};
    if (r.reason) return fail(r.reason);
    const out = { ok: true, ruleId: r.id || v.id, entry: abs, argv: args, options: safeOptions(v.shape, p) };
    if (v.shape.env === ENV) out.fixedEnv = { [SENTINEL_KEY]: SENTINEL };
    return deepFreeze(out);
  }
  return fail(reason);
}

/**
 * file: 'git' or the pinned absolute git.exe; argv/options/policy as above.
 * Returns { ok: true, ruleId, entry (pinned exe), argv (protective prefix + vector), options, fixedEnv }.
 */
function validateFullUnitGit(file, argv, options, policy) {
  const pol = checkPolicy(policy);
  if (pol.reason) return fail(pol.reason);
  const p = pol.policy;
  if (file !== 'git' && !(canonicalPath(file) && same(file, GIT_PIN.path))) return fail('git must be "git" or the pinned git.exe');
  const args = stringList(argv);
  if (!args) return fail('argv must be an array of plain strings');
  const opts = ownData(options);
  if (!opts) return fail('options must be plain data');
  const v = GIT_VECTORS.find((g) => sameList(g.args, args));
  if (!v) return fail('git argv is not one of the 7 pinned vectors');
  const problem = optionsProblem(opts, v.shape, p);
  if (problem) return fail(problem);
  return deepFreeze({
    ok: true, ruleId: v.id, entry: GIT_PIN.path, argv: GIT_PROTECT_ARGS.concat(args), options: safeOptions(v.shape, p),
    fixedEnv: Object.assign({}, GIT_FIXED_ENV),
  });
}

module.exports = Object.freeze({
  GIT_PIN,
  GIT_PROTECT_ARGS,
  GIT_FIXED_ENV,
  GIT_IGNORE_CANDIDATES,
  PROJECTION_MANIFESTS,
  BAD_PROJECTION_ROOT_NAME,
  NODE_RULE_IDS: Object.freeze(PROJECTION_COMBOS.map((c) => c.id).concat(
    ...NODE_RULES.map((r) => r.vectors.filter((v) => v.id).map((v) => v.id)))),
  // Repo-relative entry files; the guard refuses a config whose static child rules overlap them.
  NODE_ENTRY_RELS: Object.freeze(NODE_RULES.map((r) => r.rel)),
  GIT_RULE_IDS: Object.freeze(GIT_VECTORS.map((v) => v.id)),
  validateFullUnitNode,
  validateFullUnitGit,
});
