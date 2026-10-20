'use strict';
// Offline guard, phase 2. Loaded before any app module via NODE_OPTIONS=--require by
// Run-Offline.ps1, and re-required through execArgv for approved forks and workers.
// Cooperative, application-level isolation — NOT an OS firewall. Native code (approved
// addons and executables included), internalBinding and inherited raw handles are outside
// what this guard can prove. See README.md. Also preloaded into the internal module.register
// loader thread (role `loader`), which must match a pre-recorded admission (see FULL-UNIT.md).
const KEY = Symbol.for('cocotrip.offline.guard');
if (globalThis[KEY]) return;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const wt = require('worker_threads');

const appendFileSync = fs.appendFileSync;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Strips the \\?\ namespace prefix that the CJS loader adds before process.dlopen.
const norm = (p) => path.resolve(String(p).replace(/^\\\\\?\\/, '')).toLowerCase();

function initFail(msg) {
  process.stderr.write('OFFLINE_GUARD_INIT_FAILED: ' + msg + '\n');
  throw new Error('OFFLINE_GUARD_INIT_FAILED: ' + msg);
}

// ---- config: fixed file written by the supervisor, pinned by its hash in the env ----
const CONFIG_PATH = process.env.OFFLINE_GUARD_CONFIG || '';
const CONFIG_SHA = process.env.OFFLINE_GUARD_CONFIG_SHA256 || '';
if (!CONFIG_PATH || !CONFIG_SHA) initFail('config env missing');
const rawConfig = fs.readFileSync(CONFIG_PATH);
if (sha256(rawConfig) !== CONFIG_SHA) initFail('config hash mismatch');
const cfg = JSON.parse(rawConfig.toString('utf8'));
const LAUNCHER_ENV = cfg.launcherEnv;
if (norm(__filename) !== norm(cfg.guardPath)) initFail('guard path mismatch');
if (sha256(fs.readFileSync(__filename)) !== cfg.guardSha256) initFail('guard hash mismatch');
if (norm(process.execPath) !== norm(cfg.nodePath)) initFail('unexpected node executable');
if (!LAUNCHER_ENV || process.env.NODE_OPTIONS !== LAUNCHER_ENV.NODE_OPTIONS) initFail('NODE_OPTIONS mismatch');
for (const k of ['GOOGLE_APPLICATION_CREDENTIALS', 'ESBUILD_BINARY_PATH', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) {
  if (process.env[k]) initFail('forbidden env present: ' + k);
}
for (const k of ['childRules', 'workerEntries', 'nativeExe', 'nativeAddons', 'loopbackAllowlist']) {
  if (!Array.isArray(cfg[k])) initFail(k + ' must be an array');
}

const NODE = norm(cfg.nodePath);
const LAUNCHER_KEYS = new Set(Object.keys(LAUNCHER_ENV).map((k) => k.toUpperCase()));
const CHILD_RULES = new Map();
for (const r of cfg.childRules) {
  if (!r || typeof r.entry !== 'string' || !path.isAbsolute(r.entry) || !Array.isArray(r.argSets)) initFail('bad child rule');
  if (!r.argSets.every(Array.isArray)) initFail('argSets must be arrays of arrays');
  for (const k of ['execArgvFlags', 'execArgvRequire', 'execArgvPairs', 'envPass']) {
    if (!Array.isArray(r[k])) initFail(k + ' must be an array');
  }
  // Paired flags are limited to exact `--conditions <plain name>`; never bare or open-ended.
  for (const pair of r.execArgvPairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== '--conditions' || !/^[a-z][a-z0-9-]*$/.test(String(pair[1]))) {
      initFail('bad execArgvPairs entry');
    }
  }
  for (const k of r.envPass) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || LAUNCHER_KEYS.has(k) || k.indexOf('OFFLINE_GUARD') === 0) initFail('bad envPass key ' + k);
  }
  CHILD_RULES.set(norm(r.entry), r);
}
const WORKER_ENTRIES = new Set(cfg.workerEntries.map(norm));
const NATIVE_EXE = new Map(cfg.nativeExe.map((r) => [norm(r.path), Object.freeze(r)]));
const NATIVE_ADDONS = new Map(cfg.nativeAddons.map((r) => [norm(r.path), r]));
for (const r of cfg.nativeExe.concat(cfg.nativeAddons)) {
  if (!/^[0-9a-f]{64}$/.test(String(r.sha256)) || !(r.size > 0)) initFail('native entry not pinned: ' + path.basename(String(r.path)));
}
// Browser profile only: nativeExe entries with a `validator` (chromium|ffmpeg) are checked by the fixed
// browser-native-rules.cjs, loaded only after its path and hash match the config. Without validator
// entries nativeRules must be absent and nothing is loaded.
const NATIVE_KINDS = ['chromium', 'ffmpeg'];
const POLICY_KEYS = ['browserPath', 'ffmpegPath', 'origin', 'runRoot'];
const validatorEntries = cfg.nativeExe.filter((r) => r.validator !== undefined);
let NATIVE_VALIDATE = null;
let NATIVE_POLICY = null;
if (validatorEntries.length || (cfg.nativeRules !== undefined && cfg.nativeRules !== null)) {
  const nr = cfg.nativeRules;
  if (!validatorEntries.length) initFail('nativeRules without validator entries');
  if (!nr || typeof nr !== 'object') initFail('nativeRules required for validator entries');
  const rulesPath = path.join(__dirname, 'browser-native-rules.cjs');
  if (typeof nr.path !== 'string' || norm(nr.path) !== norm(rulesPath)) initFail('nativeRules.path mismatch');
  if (!/^[0-9a-f]{64}$/.test(String(nr.sha256))) initFail('nativeRules.sha256 not pinned');
  if (sha256(fs.readFileSync(rulesPath)) !== nr.sha256) initFail('nativeRules hash mismatch');
  if (require.cache[require.resolve('./browser-native-rules.cjs')]) initFail('native rules loaded before the guard');
  const rules = require('./browser-native-rules.cjs');
  if (sha256(fs.readFileSync(rulesPath)) !== nr.sha256) initFail('nativeRules changed while loading');
  if (!Object.isFrozen(rules) || typeof rules.validateNativeInvocation !== 'function' || rules.PLAYWRIGHT_VERSION !== '1.62.1') {
    initFail('native rules module shape');
  }
  const pol = nr.policy;
  if (!pol || typeof pol !== 'object' || Object.keys(pol).sort().join(',') !== POLICY_KEYS.join(',') ||
      !POLICY_KEYS.every((k) => typeof pol[k] === 'string')) {
    initFail('nativeRules.policy must be exactly ' + POLICY_KEYS.join(','));
  }
  const policy = {};
  for (const k of POLICY_KEYS) policy[k] = pol[k];
  NATIVE_POLICY = Object.freeze(policy);
  NATIVE_VALIDATE = rules.validateNativeInvocation;
  const seenKinds = new Set();
  for (const r of validatorEntries) {
    if (NATIVE_KINDS.indexOf(r.validator) === -1 || seenKinds.has(r.validator)) initFail('bad native validator');
    seenKinds.add(r.validator);
    if (r.args !== undefined || r.stdio !== undefined) initFail('validator entry must not carry args/stdio');
    const expected = r.validator === 'chromium' ? NATIVE_POLICY.browserPath : NATIVE_POLICY.ffmpegPath;
    if (norm(r.path) !== norm(expected)) initFail('validator entry path differs from policy: ' + r.validator);
  }
}
// Only exact numeric 127.0.0.1:<port> entries; never localhost, ::1 or a wildcard.
for (const e of cfg.loopbackAllowlist) {
  if (!/^127\.0\.0\.1:\d{4,5}$/.test(String(e))) initFail('bad loopback entry ' + e);
}
const LOOPBACK_ALLOW = new Set(cfg.loopbackAllowlist.map(String)); // empty for every phase-2 profile
// Set only for vite-build / vitest-unit: pinned rollup native.js and the fixed report child.
const ROLLUP = cfg.rollupReport || null;
if (ROLLUP) {
  for (const k of ['nativeJs', 'entry']) {
    if (typeof ROLLUP[k] !== 'string' || !path.isAbsolute(ROLLUP[k])) initFail('rollupReport.' + k + ' must be absolute');
  }
  for (const k of ['nativeJsSha256', 'entrySha256']) {
    if (!/^[0-9a-f]{64}$/.test(String(ROLLUP[k]))) initFail('rollupReport.' + k + ' not pinned');
  }
}
// Set only for vite-build / vitest-unit: pinned vite config.js and the line of its `net use` probe.
const VITE_PROBE = cfg.viteNetUseProbe || null;
if (VITE_PROBE) {
  if (typeof VITE_PROBE.configJs !== 'string' || !path.isAbsolute(VITE_PROBE.configJs)) initFail('viteNetUseProbe.configJs must be absolute');
  if (!/^[0-9a-f]{64}$/.test(String(VITE_PROBE.configJsSha256))) initFail('viteNetUseProbe.configJsSha256 not pinned');
  if (!Number.isInteger(VITE_PROBE.line) || VITE_PROBE.line < 1) initFail('viteNetUseProbe.line must be a positive integer');
}
const HEX64 = /^[0-9a-f]{64}$/;
const FULL_UNIT_PROFILE = (cfg.profile === 'vitest-unit' && cfg.unitSelector === 'full') || cfg.profile === 'fullunit-canary';
// Full-unit profiles only: the fixed full-unit-rules.cjs (exact Node vectors + the 7 Git vectors), loaded
// after its path and hash match the config, with a launcher-owned policy. Absent everywhere else.
const FU_POLICY_KEYS = ['gitPath', 'repoRoot', 'runTmp'];
let FULL_UNIT = null;
if (cfg.fullUnitRules !== undefined && cfg.fullUnitRules !== null) {
  const fu = cfg.fullUnitRules;
  if (!FULL_UNIT_PROFILE) initFail('fullUnitRules outside the full-unit profiles');
  if (!fu || typeof fu !== 'object' || Object.keys(fu).sort().join(',') !== 'path,policy,sha256') {
    initFail('fullUnitRules must be exactly {path,sha256,policy}');
  }
  const rulesPath = path.join(__dirname, 'full-unit-rules.cjs');
  if (typeof fu.path !== 'string' || norm(fu.path) !== norm(rulesPath)) initFail('fullUnitRules.path mismatch');
  if (!HEX64.test(String(fu.sha256))) initFail('fullUnitRules.sha256 not pinned');
  if (sha256(fs.readFileSync(rulesPath)) !== fu.sha256) initFail('fullUnitRules hash mismatch');
  if (require.cache[require.resolve('./full-unit-rules.cjs')]) initFail('full-unit rules loaded before the guard');
  const cacheBefore = Object.keys(require.cache);
  const rules = require('./full-unit-rules.cjs');
  if (sha256(fs.readFileSync(rulesPath)) !== fu.sha256) initFail('fullUnitRules changed while loading');
  const cacheAdded = Object.keys(require.cache).filter((k) => cacheBefore.indexOf(k) === -1);
  if (cacheAdded.length !== 1 || norm(cacheAdded[0]) !== norm(rulesPath)) initFail('full-unit rules: unexpected require.cache entries');
  const pin = rules.GIT_PIN;
  if (!Object.isFrozen(rules) || typeof rules.validateFullUnitNode !== 'function' || typeof rules.validateFullUnitGit !== 'function' ||
      !pin || !Object.isFrozen(pin) || typeof pin.path !== 'string' || !path.isAbsolute(pin.path) || !HEX64.test(String(pin.sha256)) ||
      !(pin.size > 0) || !['NODE_RULE_IDS', 'GIT_RULE_IDS', 'NODE_ENTRY_RELS'].every((k) => Array.isArray(rules[k]) && Object.isFrozen(rules[k]))) {
    initFail('full-unit rules module shape');
  }
  const pol = fu.policy;
  if (!pol || typeof pol !== 'object' || Object.keys(pol).sort().join(',') !== FU_POLICY_KEYS.join(',') ||
      !FU_POLICY_KEYS.every((k) => typeof pol[k] === 'string')) {
    initFail('fullUnitRules.policy must be exactly ' + FU_POLICY_KEYS.join(','));
  }
  // Launcher-owned values only: the repo this guard lives in, the run's own TMP/TEMP, the pinned Git.
  if (norm(pol.repoRoot) !== norm(path.resolve(__dirname, '..', '..'))) initFail('fullUnitRules.policy.repoRoot is not this repo');
  if (pol.runTmp !== LAUNCHER_ENV.TMP || pol.runTmp !== LAUNCHER_ENV.TEMP) initFail('fullUnitRules.policy.runTmp is not the launcher TMP/TEMP');
  if (pol.gitPath !== pin.path) initFail('fullUnitRules.policy.gitPath is not the pinned Git');
  const policy = Object.freeze({ gitPath: pol.gitPath, repoRoot: pol.repoRoot, runTmp: pol.runTmp });
  // The helper checks the policy (canonical, real directories, no overlap) before it looks at an entry.
  const probe = rules.validateFullUnitNode('-', [], undefined, policy);
  if (!probe || probe.reason !== 'unknown entry') initFail('fullUnitRules.policy rejected: ' + (probe && probe.reason));
  for (const rel of rules.NODE_ENTRY_RELS) {
    const abs = norm(path.join(policy.repoRoot, rel));
    if (CHILD_RULES.has(abs) || WORKER_ENTRIES.has(abs)) initFail('static rule overlaps a full-unit entry: ' + rel);
  }
  FULL_UNIT = Object.freeze({
    node: rules.validateFullUnitNode,
    git: rules.validateFullUnitGit,
    policy,
    sha256: fu.sha256,
    gitPin: pin,
    nodeRuleIds: rules.NODE_RULE_IDS,
  });
}
// module.register admission (vitest-unit full, plan-test, loader-canary only): the one pinned caller line
// may register the one pinned loader with exactly the pinned data URLs, once per admitted process.
const LOADER_PROFILE = (cfg.profile === 'vitest-unit' && cfg.unitSelector === 'full') ||
  cfg.profile === 'plan-test' || cfg.profile === 'loader-canary';
let LOADER = null;
function pinnedRef(r, keys) {
  if (!r || typeof r !== 'object' || Object.keys(r).sort().join(',') !== keys.slice().sort().join(',')) return null;
  if (typeof r.path !== 'string' || !path.isAbsolute(r.path) || !HEX64.test(String(r.sha256))) return null;
  return Object.freeze(Object.assign({}, r));
}
if (cfg.loaderAdmission !== undefined && cfg.loaderAdmission !== null) {
  const la = cfg.loaderAdmission;
  if (!LOADER_PROFILE) initFail('loaderAdmission outside the loader profiles');
  if (!la || typeof la !== 'object' || Object.keys(la).sort().join(',') !== 'caller,data,loader,runner,runnerRuleIds') {
    initFail('loaderAdmission must be exactly {runner,runnerRuleIds,caller,loader,data}');
  }
  const runner = pinnedRef(la.runner, ['path', 'sha256']);
  const loader = pinnedRef(la.loader, ['path', 'sha256']);
  const caller = pinnedRef(la.caller, ['path', 'sha256', 'line', 'fn']);
  if (!runner || !loader || !caller) initFail('loaderAdmission runner/loader/caller not pinned');
  if (!Number.isInteger(caller.line) || caller.line < 1 || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(caller.fn))) {
    initFail('loaderAdmission.caller line/fn');
  }
  if (!Array.isArray(la.data) || la.data.length < 1 || la.data.length > 8) initFail('loaderAdmission.data must be 1..8 entries');
  const data = la.data.map((d) => pinnedRef(d, ['key', 'path', 'sha256']));
  const dataKeys = data.map((d) => d && d.key);
  if (data.some((d) => !d || !/^[A-Za-z][A-Za-z0-9]*$/.test(String(d.key))) || new Set(dataKeys).size !== data.length) {
    initFail('loaderAdmission.data entries');
  }
  if (!Array.isArray(la.runnerRuleIds) || !la.runnerRuleIds.every((id) => typeof id === 'string')) initFail('loaderAdmission.runnerRuleIds');
  // full unit: run.mjs is a guarded child launched by those full-unit rule ids; elsewhere it is the main process.
  if (cfg.profile === 'vitest-unit') {
    if (!FULL_UNIT || !la.runnerRuleIds.length || !la.runnerRuleIds.every((id) => FULL_UNIT.nodeRuleIds.indexOf(id) !== -1)) {
      initFail('loaderAdmission.runnerRuleIds must be full-unit rule ids');
    }
  } else if (la.runnerRuleIds.length) {
    initFail('loaderAdmission.runnerRuleIds must be empty outside vitest-unit');
  }
  LOADER = Object.freeze({ runner, loader, caller, data: Object.freeze(data), runnerRuleIds: Object.freeze(la.runnerRuleIds.slice()) });
}
const LAUNCH_ID = process.env.OFFLINE_GUARD_LAUNCH_ID || '';
const TID = wt.threadId;
// `loader` = Node's internal module.register hooks thread (worker_threads.isInternalThread, Node >= 22.14).
const ROLE = wt.isMainThread ? (LAUNCH_ID ? 'child' : 'main') : (wt.isInternalThread === true ? 'loader' : 'worker');
const LEDGER = path.join(cfg.ledgerDir, ROLE + '-' + process.pid + '-t' + TID + '.jsonl');

// One ledger file per process/thread. Sync append, so a denial is on disk before the
// error is thrown even if the app catches it or never awaits it. No headers/bodies/args.
function record(rec) {
  rec.role = ROLE;
  rec.pid = process.pid;
  rec.tid = TID;
  rec.ts = Date.now();
  appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
}

function deny(method, category, target) {
  const t = String(target).slice(0, 200);
  record({ t: 'deny', method, category, target: t });
  const err = new Error('OFFLINE_GUARD_DENIED ' + method + ' [' + category + '] ' + t);
  err.code = 'OFFLINE_GUARD_DENIED';
  return err;
}

// ---- ledger lookups for the loader admission (records of this run only) ----
// Records from files named <role>-<pid>-t<tid>.jsonl (tid null = any). Unparsable lines are skipped here;
// the supervisor fails the run on them.
function ledgerRecords(roles, pid, tid) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(cfg.ledgerDir);
  } catch (e) {
    return out;
  }
  for (const name of names) {
    const m = /^([a-z]+)-(\d+)-t(\d+)\.jsonl$/.exec(name);
    if (!m || roles.indexOf(m[1]) === -1 || Number(m[2]) !== pid || (tid !== null && Number(m[3]) !== tid)) continue;
    let text = '';
    try {
      text = fs.readFileSync(path.join(cfg.ledgerDir, name), 'utf8');
    } catch (e) {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch (e) {
        // counted by the supervisor
      }
    }
  }
  return out;
}
// Launch ids are <pid>.<tid>.<seq> (launchEnv below).
function parseLaunchId(id) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(id));
  return m ? { pid: Number(m[1]), tid: Number(m[2]) } : null;
}
function shaFresh(file, expected) {
  try {
    return sha256(fs.readFileSync(file)) === expected;
  } catch (e) {
    return false;
  }
}

// Admitted process: the pinned runner as this process's main entry with no execArgv. As the main process
// (plan-test, loader-canary) only with no runner rule ids; as a child (full unit) only when the parent's
// launch record for this exact launch id carries one of the admitted full-unit rule ids.
let loaderProcessAdmitted = false;
if (LOADER && (ROLE === 'main' || ROLE === 'child')) {
  const entry = process.argv[1];
  if (typeof entry === 'string' && path.isAbsolute(entry) && norm(entry) === norm(LOADER.runner.path) && process.execArgv.length === 0) {
    if (ROLE === 'main') {
      loaderProcessAdmitted = LOADER.runnerRuleIds.length === 0;
    } else if (FULL_UNIT && LOADER.runnerRuleIds.length) {
      const parent = parseLaunchId(LAUNCH_ID);
      const launches = parent
        ? ledgerRecords(['main', 'child', 'worker'], parent.pid, parent.tid).filter((r) => r.t === 'launch' && r.id === LAUNCH_ID)
        : [];
      loaderProcessAdmitted = launches.length === 1 && launches[0].kind === 'child' &&
        LOADER.runnerRuleIds.indexOf(launches[0].ruleId) !== -1 && launches[0].rulesSha256 === FULL_UNIT.sha256;
    }
  }
}

// Loader thread: only for a launch id that the same process's admitted register wrote as a loader-launch
// (same config, guard and loader hashes) and that no loader thread has used yet. The env flag alone is
// not admission. Fails init (so the register call fails) with a ledger denial.
function loaderThreadProblem() {
  if (!LOADER) return 'no loader admission in this profile';
  if (wt.isMainThread || wt.isInternalThread !== true) return 'not an internal thread';
  if (!Number.isInteger(TID) || TID <= 0) return 'thread id';
  const parent = parseLaunchId(LAUNCH_ID);
  if (!parent || parent.pid !== process.pid || parent.tid === TID) return 'launch id';
  const launches = ledgerRecords(['main', 'child'], process.pid, parent.tid).filter((r) => r.t === 'loader-launch' && r.id === LAUNCH_ID);
  if (launches.length !== 1) return 'loader-launch count ' + launches.length;
  const l = launches[0];
  if (l.configSha256 !== CONFIG_SHA || l.guardSha256 !== cfg.guardSha256 || l.loaderSha256 !== LOADER.loader.sha256) return 'launch hashes';
  if (ledgerRecords(['loader'], process.pid, null).some((r) => r.launchId === LAUNCH_ID)) return 'launch id already used';
  if (!shaFresh(LOADER.loader.path, LOADER.loader.sha256)) return 'loader hash';
  return '';
}
if (ROLE === 'loader') {
  const why = loaderThreadProblem();
  if (why) {
    deny('loader-preload', 'loader-admission', why);
    initFail('loader thread not admitted: ' + why);
  }
}

// ---- network: fetch / http / https / http2 / net / tls / dns / dgram / listen ----
const net = require('net');

function classify(host) {
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '::' || h === '0.0.0.0' || /^127\./.test(h)) {
    return 'loopback';
  }
  return 'external';
}

// Only exact 127.0.0.1:port entries from the (empty) allowlist pass.
function gate(method, t) {
  if (t.pipe) throw deny(method, 'local-pipe', 'pipe');
  const host = String(t.host);
  const hostport = host + ':' + t.port;
  if (host === '127.0.0.1' && LOOPBACK_ALLOW.has(hostport)) return;
  throw deny(method, classify(host), hostport);
}

function urlTarget(input) {
  try {
    const u = new URL(String(input && typeof input === 'object' && input.url ? input.url : input));
    const secure = u.protocol === 'https:' || u.protocol === 'wss:';
    return { host: u.hostname, port: u.port || (secure ? '443' : '80') };
  } catch (e) {
    return { host: 'unknown', port: '' };
  }
}

function httpTarget(args, defPort) {
  const a = args[0];
  if (typeof a === 'string' || a instanceof URL) return urlTarget(a);
  if (a && typeof a === 'object') {
    if (a.socketPath) return { pipe: true };
    return { host: a.hostname || a.host || 'localhost', port: String(a.port || a.defaultPort || defPort) };
  }
  return { host: 'unknown', port: '' };
}

function netTarget(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0]; // internal normalized-args form
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) {
    return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: String(a) };
  }
  if (typeof a === 'string') return { pipe: true };
  if (a && typeof a === 'object') {
    if (a.path) return { pipe: true };
    return { host: a.host || a.hostname || 'localhost', port: String(a.port || '') };
  }
  return { host: 'unknown', port: '' };
}

function wrap(obj, key, method, target) {
  const orig = obj && obj[key];
  if (typeof orig !== 'function') return;
  obj[key] = function () {
    gate(method, target(arguments));
    return orig.apply(this, arguments);
  };
}

wrap(net, 'connect', 'net.connect', netTarget);
wrap(net, 'createConnection', 'net.createConnection', netTarget);
wrap(net.Socket.prototype, 'connect', 'net.Socket.connect', netTarget); // backstop for every TCP/TLS path
wrap(require('tls'), 'connect', 'tls.connect', netTarget);
for (const [name, defPort] of [['http', '80'], ['https', '443']]) {
  const mod = require(name);
  const target = (args) => httpTarget(args, defPort);
  wrap(mod, 'request', name + '.request', target);
  wrap(mod, 'get', name + '.get', target);
  wrap(mod.Agent.prototype, 'createConnection', name + '.Agent.createConnection', target);
}
wrap(require('http2'), 'connect', 'http2.connect', (args) => httpTarget(args, '443'));

// Every TCP/HTTP/WS server listens through net.Server. An omitted host is a wildcard bind.
function listenTarget(args) {
  const a = args[0];
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) {
    return { host: typeof args[1] === 'string' ? args[1] : 'wildcard', port: String(a) };
  }
  if (typeof a === 'string') return { pipe: true };
  if (a && typeof a === 'object') {
    if (a.path) return { pipe: true };
    if (a._handle || a.handle || a.fd !== undefined) return { host: 'handle', port: '' };
    return { host: a.host || 'wildcard', port: String(a.port === undefined ? '' : a.port) };
  }
  return { host: 'wildcard', port: '' };
}
const origListen = net.Server.prototype.listen;
// Set only while an approved exact 127.0.0.1:<port> listen runs synchronously (see dns.lookup below).
let listenLookup = null;
net.Server.prototype.listen = function listen() {
  const t = listenTarget(arguments);
  if (t.pipe) throw deny('net.Server.listen', 'local-pipe', 'pipe');
  const hostport = t.host + ':' + t.port;
  if (t.host !== '127.0.0.1' || !LOOPBACK_ALLOW.has(hostport)) throw deny('net.Server.listen', 'listen', hostport);
  const prev = listenLookup;
  listenLookup = { used: false };
  try {
    return origListen.apply(this, arguments);
  } finally {
    listenLookup = prev;
  }
};

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
}
if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  setGlobal('fetch', async function fetch(input) {
    gate('fetch', urlTarget(input));
    return origFetch.apply(this, arguments);
  });
}
for (const name of ['WebSocket', 'EventSource']) {
  if (typeof globalThis[name] !== 'function') continue;
  setGlobal(name, function (u) {
    const t = urlTarget(u);
    throw deny(name, classify(t.host), t.host + ':' + t.port);
  });
}

const DNS_METHODS = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa',
  'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
function denyDns(obj, label, isPromise) {
  if (!obj) return;
  for (const m of DNS_METHODS) {
    if (typeof obj[m] !== 'function') continue;
    const method = label + '.' + m;
    obj[m] = isPromise
      ? function (name) { return Promise.reject(deny(method, 'dns', name)); }
      : function (name) { throw deny(method, 'dns', name); };
  }
}
const dns = require('dns');
denyDns(dns, 'dns', false);
denyDns(dns.Resolver.prototype, 'dns.Resolver', false);
for (const p of new Set([dns.promises, require('dns/promises')])) {
  denyDns(p, 'dns.promises', true);
  denyDns(p.Resolver && p.Resolver.prototype, 'dns.promises.Resolver', true);
}
// Node 22 Server.listen(port, host) goes through net.js lookupAndListen (v22.15.0 lib/net.js
// 2190-2208), which calls dns.lookup(address, { all: true }, cb) even for a literal IP. Only inside
// an approved listen (scope above, synchronous, once), with exactly ('127.0.0.1', { all: true }, fn)
// and node:net lookupAndListen as the direct caller, the callback gets the all:true answer shape:
// nextTick(cb, null, [{ address, family: 4 }]), return {}. Nothing is resolved and no DNS query
// exists; the TCP bind itself was already gated by listen. Everything else, including
// dns.promises and Resolver, stays denied.
function isAllTrueOptions(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(o);
  if (keys.length !== 1 || keys[0] !== 'all') return false;
  const d = Object.getOwnPropertyDescriptor(o, 'all');
  return !!d && d.enumerable === true && 'value' in d && d.value === true && !d.get && !d.set;
}
const denyLookup = dns.lookup;
dns.lookup = function lookup(name, options, cb) {
  const s = listenLookup;
  if (!s || s.used || arguments.length !== 3 || name !== '127.0.0.1' || typeof cb !== 'function' || !isAllTrueOptions(options)) {
    return denyLookup.apply(this, arguments);
  }
  const f = callerFrame(lookup);
  if (!f || f.raw !== 'node:net' || f.fn !== 'lookupAndListen') return denyLookup.apply(this, arguments);
  s.used = true;
  process.nextTick(cb, null, [{ address: '127.0.0.1', family: 4 }]);
  return {};
};

const dgram = require('dgram');
dgram.createSocket = function () { throw deny('dgram.createSocket', 'udp', '-'); };
for (const m of ['bind', 'connect', 'send']) {
  dgram.Socket.prototype[m] = function () { throw deny('dgram.Socket.' + m, 'udp', '-'); };
}

// ---- native: pinned files only, re-hashed once per process before first use ----
const verified = new Set();
function pinnedFileOk(rule) {
  const key = norm(rule.path);
  if (verified.has(key)) return true;
  try {
    const buf = fs.readFileSync(rule.path);
    if (buf.length !== rule.size || sha256(buf) !== rule.sha256) return false;
  } catch (e) {
    return false;
  }
  verified.add(key);
  return true;
}
function pinnedShaOk(file, expected) {
  const key = norm(file) + '|' + expected;
  if (verified.has(key)) return true;
  try {
    if (sha256(fs.readFileSync(file)) !== expected) return false;
  } catch (e) {
    return false;
  }
  verified.add(key);
  return true;
}
// No per-process cache: re-read and re-hashed before every launch (Git).
function pinnedFileFresh(rule) {
  try {
    const buf = fs.readFileSync(rule.path);
    return buf.length === rule.size && sha256(buf) === rule.sha256;
  } catch (e) {
    return false;
  }
}

const BLOCKED_BINDINGS = new Set(['tcp_wrap', 'udp_wrap', 'pipe_wrap', 'tls_wrap', 'cares_wrap',
  'process_wrap', 'spawn_sync', 'stream_wrap', 'js_stream']);
if (typeof process.binding === 'function') {
  const origBinding = process.binding;
  process.binding = function binding(name) {
    if (BLOCKED_BINDINGS.has(String(name))) throw deny('process.binding', 'native', name);
    return origBinding.apply(this, arguments);
  };
}
const origDlopen = process.dlopen;
process.dlopen = function dlopen(module, filename) {
  const base = path.basename(String(filename));
  const rule = NATIVE_ADDONS.get(norm(filename));
  if (!rule) throw deny('process.dlopen', 'native', base);
  if (!pinnedFileOk(rule)) throw deny('process.dlopen', 'native-hash', base);
  record({ t: 'native-load', entry: base, sha256: rule.sha256 });
  return origDlopen.apply(this, arguments);
};
if (typeof process.execve === 'function') {
  process.execve = function execve() { throw deny('process.execve', 'child-exe', '-'); };
}

// ---- child launches: env is always rebuilt from the fixed launcher env ----
let launchSeq = 0;
function launchEnv() {
  const id = process.pid + '.' + TID + '.' + (++launchSeq);
  const env = Object.assign({}, LAUNCHER_ENV, { OFFLINE_GUARD_CONFIG_SHA256: CONFIG_SHA, OFFLINE_GUARD_LAUNCH_ID: id });
  return { id, env };
}

// A caller-supplied env must carry the guard keys unchanged; otherwise it is a strip attempt.
function envKeeps(env) {
  if (!env || typeof env !== 'object') return false;
  for (const key of ['NODE_OPTIONS', 'OFFLINE_GUARD_CONFIG']) {
    const found = Object.keys(env).filter((k) => k.toUpperCase() === key);
    if (found.length !== 1 || env[found[0]] !== LAUNCHER_ENV[key]) return false;
  }
  return true;
}

// Rule-listed keys (e.g. VITEST, NODE_ENV) are carried over, uppercased, with plain values only.
const ENV_VALUE = /^[A-Za-z0-9_.:-]{0,64}$/;
function passEnv(method, env, keys, base) {
  const out = {};
  if (!keys || !keys.length) return out;
  for (const k of Object.keys(env)) {
    const up = k.toUpperCase();
    if (keys.indexOf(up) === -1) continue;
    const v = env[k];
    if (Object.prototype.hasOwnProperty.call(out, up) || typeof v !== 'string' || !ENV_VALUE.test(v)) {
      throw deny(method, 'child-env', base);
    }
    out[up] = v;
  }
  return out;
}

// Fork execArgv: only rule-listed flags, `--require <rule-listed absolute path>`, and rule-listed
// exact `--conditions <name>` pairs (each at most once). The guard itself is stripped here and
// always re-added first by the caller.
function vetExecArgv(method, rule, list, base) {
  if (!Array.isArray(list)) throw deny(method, 'child-execargv', base);
  const flags = rule.execArgvFlags || [];
  const reqs = (rule.execArgvRequire || []).map(norm);
  const pairs = rule.execArgvPairs || [];
  const seenPairs = new Set();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const next = list[i + 1];
    if (v === '--require' && typeof next === 'string' && path.isAbsolute(next)) {
      if (norm(next) === norm(__filename)) { i++; continue; }
      if (reqs.indexOf(norm(next)) !== -1) { out.push(v, next); i++; continue; }
    } else if (v === '--conditions' && typeof next === 'string') {
      const id = v + ' ' + next;
      if (!seenPairs.has(id) && pairs.some((p) => p[0] === v && p[1] === next)) {
        seenPairs.add(id);
        out.push(v, next);
        i++;
        continue;
      }
    } else if (typeof v === 'string' && flags.indexOf(v) !== -1) {
      out.push(v);
      continue;
    }
    throw deny(method, 'child-execargv', base);
  }
  return out;
}

// argSets lists every allowed argv tail. An element is an exact string, or
// { prefix, path } for `--flag=<absolute path>` compared case-insensitively on the path.
function argMatches(actual, expected) {
  if (typeof expected === 'string') return actual === expected;
  return !!expected && actual.indexOf(expected.prefix) === 0 && norm(actual.slice(expected.prefix.length)) === norm(expected.path);
}
function argsAllowed(sets, tail) {
  return sets.some((set) => set.length === tail.length && set.every((e, i) => argMatches(tail[i], e)));
}

const cp = require('child_process');
const CHILD_KEYS = new Set(['cwd', 'env', 'stdio', 'timeout', 'signal', 'killSignal', 'maxBuffer', 'encoding',
  'serialization', 'input', 'windowsHide', 'shell', 'execPath', 'execArgv', 'silent']);

function splitArgs(list) {
  const out = { file: list[0], args: [], options: undefined, cb: undefined, bad: false };
  for (let i = 1; i < list.length; i++) {
    const v = list[i];
    if (Array.isArray(v) && i === 1) out.args = v;
    else if (typeof v === 'function' && !out.cb) out.cb = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && !out.options) out.options = v;
    else if (v !== undefined && v !== null) out.bad = true;
  }
  return out;
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// Validator natives (browser profile): async spawn only; argv/options checked by the pinned rules
// module, then the file hash. The env is rebuilt from the launcher env without NODE_OPTIONS or any
// guard key (the caller's env is discarded); stdio as validated; no cwd, shell, detach or window.
function vetValidatedNative(method, rule, base, argv, options) {
  if (method !== 'child_process.spawn') throw deny(method, 'native-validator', base + ': spawn only');
  let v = null;
  try {
    v = NATIVE_VALIDATE(rule.validator, argv, options, NATIVE_POLICY);
  } catch (e) {
    v = null;
  }
  if (!v || v.ok !== true) throw deny(method, 'native-validator', base + ': ' + (v && v.reason ? v.reason : 'validator error'));
  if (!pinnedFileOk(rule)) throw deny(method, 'native-hash', base);
  const env = {};
  for (const k of Object.keys(LAUNCHER_ENV)) {
    const up = k.toUpperCase();
    if (up !== 'NODE_OPTIONS' && up.indexOf('OFFLINE_GUARD') !== 0) env[k] = LAUNCHER_ENV[k];
  }
  const launch = launchEnv();
  const safe = { stdio: options.stdio.slice(), env, shell: false, windowsHide: true, detached: false };
  record({ t: 'launch', kind: 'native', id: launch.id, method, entry: base, sha256: rule.sha256, validator: rule.validator, argv: argv.slice() });
  return safe;
}

// Pinned native executables (esbuild): exact args, exact stdio, no env/shell. The process
// itself cannot preload the guard; the launch and the file hash are logged instead.
function vetNative(method, exe, argv, options) {
  const base = path.basename(String(exe));
  const rule = NATIVE_EXE.get(norm(exe));
  if (!rule) throw deny(method, 'child-exe', base);
  if (rule.validator) return vetValidatedNative(method, rule, base, argv, options);
  if (!sameList(argv, rule.args)) throw deny(method, 'native-args', base);
  const opts = options === undefined ? {} : options;
  for (const k of Object.keys(opts)) {
    if (k !== 'cwd' && k !== 'stdio' && k !== 'windowsHide') throw deny(method, 'native-option', k);
  }
  if (!sameList(opts.stdio, rule.stdio)) throw deny(method, 'native-option', 'stdio');
  if (opts.cwd !== undefined && typeof opts.cwd !== 'string') throw deny(method, 'native-option', 'cwd');
  if (!pinnedFileOk(rule)) throw deny(method, 'native-hash', base);
  const launch = launchEnv();
  const safe = { stdio: rule.stdio.slice(), env: Object.assign({}, LAUNCHER_ENV), shell: false, windowsHide: true };
  if (opts.cwd !== undefined) safe.cwd = opts.cwd;
  record({ t: 'launch', kind: 'native', id: launch.id, method, entry: base, sha256: rule.sha256 });
  return safe;
}

// Full-unit Node vectors. The helper identifies the entry first; only 'unknown entry' goes on to the static
// child rules, so a recognized entry with other argv/options can never fall through to a broader rule. The
// launch is the helper's normalized invocation: the fixed node.exe (never the caller's), [entry, ...argv],
// its options (cwd = repo root), the fresh launcher env plus only its fixedEnv; no shell, hidden window.
function vetFullUnitNode(method, argv, options, isFork) {
  const entry = argv[0];
  let v = null;
  try {
    v = FULL_UNIT.node(entry, argv.slice(1), options, FULL_UNIT.policy);
  } catch (e) {
    v = null;
  }
  if (v && v.ok !== true && v.reason === 'unknown entry') return null;
  const base = path.basename(String(entry));
  if (!v || v.ok !== true) throw deny(method, 'full-unit', base + ': ' + (v && v.reason ? v.reason : 'validator error'));
  if (isFork) throw deny(method, 'full-unit', base + ': fork is not a full-unit vector');
  // Only the enrich-* vectors carry a caller env (validated by the helper); its guard keys must be unchanged.
  if (options && options.env !== undefined && !envKeeps(options.env)) throw deny(method, 'child-env', base);
  const fixed = {};
  for (const k of Object.keys(v.fixedEnv || {})) {
    const up = k.toUpperCase();
    if (LAUNCHER_KEYS.has(up) || up.indexOf('OFFLINE_GUARD') === 0 || typeof v.fixedEnv[k] !== 'string') {
      throw deny(method, 'full-unit', base + ': fixedEnv ' + k);
    }
    fixed[k] = v.fixedEnv[k];
  }
  const launch = launchEnv();
  const opts = {};
  for (const k of Object.keys(v.options)) opts[k] = Array.isArray(v.options[k]) ? v.options[k].slice() : v.options[k];
  opts.env = Object.assign({}, launch.env, fixed);
  opts.shell = false;
  opts.windowsHide = true;
  record({ t: 'launch', kind: 'child', id: launch.id, method, entry: path.basename(v.entry), ruleId: v.ruleId, rulesSha256: FULL_UNIT.sha256 });
  return { file: cfg.nodePath, args: [v.entry].concat(v.argv), options: opts };
}

// Full-unit Git: 'git' or the pinned git.exe, one of the 7 helper vectors. Launched directly (no shell, no
// PATH lookup) as the pinned exe, re-hashed (size + SHA-256) before every launch, with the helper's
// protective argv, cwd = repo root, and a minimal env: launcher env minus NODE_OPTIONS/OFFLINE_GUARD*, plus
// the helper's GIT_* fixedEnv. Caller env is discarded; no ambient GIT_* or credential helper config.
function vetGit(method, exe, argv, options) {
  let v = null;
  try {
    v = FULL_UNIT.git(exe, argv, options, FULL_UNIT.policy);
  } catch (e) {
    v = null;
  }
  if (!v || v.ok !== true) throw deny(method, 'full-unit-git', 'git: ' + (v && v.reason ? v.reason : 'validator error'));
  const pin = FULL_UNIT.gitPin;
  if (norm(v.entry) !== norm(pin.path) || !pinnedFileFresh(pin)) throw deny(method, 'native-hash', 'git.exe');
  const env = {};
  for (const k of Object.keys(LAUNCHER_ENV)) {
    const up = k.toUpperCase();
    if (up !== 'NODE_OPTIONS' && up.indexOf('OFFLINE_GUARD') !== 0) env[k] = LAUNCHER_ENV[k];
  }
  for (const k of Object.keys(v.fixedEnv || {})) {
    if (!/^GIT_[A-Z_]+$/.test(k) || typeof v.fixedEnv[k] !== 'string') throw deny(method, 'full-unit-git', 'fixedEnv ' + k);
    env[k] = v.fixedEnv[k];
  }
  const launch = launchEnv();
  const opts = {};
  for (const k of Object.keys(v.options)) opts[k] = v.options[k];
  opts.env = env;
  opts.shell = false;
  opts.windowsHide = true;
  record({
    t: 'launch', kind: 'native', id: launch.id, method, entry: path.basename(pin.path), sha256: pin.sha256,
    ruleId: v.ruleId, rulesSha256: FULL_UNIT.sha256, argv: v.argv.slice(),
  });
  return { file: pin.path, args: v.argv.slice(), options: opts };
}

// exe must be the fixed node.exe (or a pinned native exe); argv[0] must be an approved entry
// (so no -e/-p/--eval/--import/--require before it); options are allowlisted, shell never.
// Returns the complete invocation { file, args, options } that the wrapper executes.
function vetChild(method, exe, argv, options, isFork) {
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string' || a.indexOf('\0') !== -1)) {
    throw deny(method, 'child-args', '-');
  }
  if (typeof exe !== 'string') throw deny(method, 'child-exe', '-');
  if (FULL_UNIT && !isFork && (exe === 'git' || norm(exe) === norm(FULL_UNIT.gitPin.path))) return vetGit(method, exe, argv, options);
  if (norm(exe) !== NODE) return { file: exe, args: argv, options: vetNative(method, exe, argv, options) };
  const entry = argv[0];
  if (!entry || entry.charAt(0) === '-') throw deny(method, 'child-args', '-');
  if (FULL_UNIT) {
    const inv = vetFullUnitNode(method, argv, options, isFork);
    if (inv) return inv;
  }
  const rule = path.isAbsolute(entry) ? CHILD_RULES.get(norm(entry)) : undefined;
  if (!rule) throw deny(method, 'child-entry', path.basename(entry));
  const opts = options === undefined ? {} : options;
  const base = path.basename(entry);
  const safe = {};
  let execArgv = [];
  for (const k of Object.keys(opts)) {
    if (!CHILD_KEYS.has(k)) throw deny(method, 'child-option', k);
    if (k === 'shell') {
      if (opts.shell) throw deny(method, 'child-shell', base);
    } else if (k === 'execPath') {
      if (norm(opts.execPath) !== NODE) throw deny(method, 'child-exe', base);
    } else if (k === 'execArgv') {
      if (isFork) execArgv = vetExecArgv(method, rule, opts.execArgv, base);
      else if (!Array.isArray(opts.execArgv) || opts.execArgv.length) throw deny(method, 'child-execargv', base);
    } else if (k === 'env') {
      if (!envKeeps(opts.env)) throw deny(method, 'child-env', base);
    } else if (k !== 'windowsHide') {
      safe[k] = opts[k]; // cwd/stdio(ipc)/timeout/signal/serialization/... preserved as given
    }
  }
  if (!argsAllowed(rule.argSets, argv.slice(1))) throw deny(method, 'child-args', base);
  const passed = passEnv(method, opts.env || process.env, rule.envPass, base);
  const launch = launchEnv();
  safe.env = Object.assign(passed, launch.env);
  safe.shell = false;
  safe.windowsHide = true;
  if (isFork) safe.execArgv = ['--require', __filename].concat(execArgv);
  // Registered before the launch: a launch that never reports ready fails the run.
  record({ t: 'launch', kind: 'child', id: launch.id, method, entry: base });
  return { file: exe, args: argv, options: safe };
}

let approvedDepth = 0;
function approvedCall(fn, args) {
  approvedDepth++;
  try {
    return fn.apply(cp, args);
  } finally {
    approvedDepth--;
  }
}

// Rollup's native.js asks a `node -p <script>` child for the process-report header on Windows.
// Only that exact call (pinned native.js as the direct caller, exact argv and options) is
// translated into `node <fixed rollup-platform.cjs>` with the fresh launcher env. The child
// preloads the guard and prints the real header. Every other -p/-e stays denied (child-args).
const ROLLUP_SCRIPT = "console.log(JSON.stringify(require('node:process').report.getReport().header));";

// The frame directly above `wrapper`: normalized file, line and function name (null if unknown).
function callerFrame(wrapper) {
  const prevPrepare = Error.prepareStackTrace;
  const prevLimit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 2;
    Error.prepareStackTrace = (e, frames) => frames;
    const holder = {};
    Error.captureStackTrace(holder, wrapper);
    const frames = holder.stack;
    const f = Array.isArray(frames) && frames[0] ? frames[0] : null;
    const raw = f ? f.getFileName() : '';
    let file = raw;
    if (typeof file === 'string' && file.indexOf('file:') === 0) file = fileURLToPath(file);
    if (typeof file !== 'string' || !file) return null;
    return { file: norm(file), raw, line: f.getLineNumber(), fn: f.getFunctionName() };
  } catch (e) {
    return null;
  } finally {
    Error.prepareStackTrace = prevPrepare;
    Error.stackTraceLimit = prevLimit;
  }
}
function callerFile(wrapper) {
  const f = callerFrame(wrapper);
  return f ? f.file : '';
}

function isRollupReport(p) {
  return !!ROLLUP && typeof p.file === 'string' && norm(p.file) === NODE && sameList(p.args, ['-p', ROLLUP_SCRIPT]);
}

function rollupReportCall(method, p, wrapper) {
  const o = p.options;
  const keys = o && typeof o === 'object' ? Object.keys(o).sort().join(',') : '';
  if (p.cb || keys !== 'encoding,timeout,windowsHide' || o.encoding !== 'utf8' || o.timeout !== 3000 || o.windowsHide !== true) {
    throw deny(method, 'rollup-report', 'options');
  }
  if (callerFile(wrapper) !== norm(ROLLUP.nativeJs)) throw deny(method, 'rollup-report', 'caller');
  if (!pinnedShaOk(ROLLUP.nativeJs, ROLLUP.nativeJsSha256)) throw deny(method, 'rollup-report', 'native.js-hash');
  if (!pinnedShaOk(ROLLUP.entry, ROLLUP.entrySha256)) throw deny(method, 'rollup-report', 'entry-hash');
  const launch = launchEnv();
  record({ t: 'launch', kind: 'child', id: launch.id, method, entry: path.basename(ROLLUP.entry), translated: 'rollup-report' });
  return [cfg.nodePath, [ROLLUP.entry], { encoding: 'utf8', timeout: 3000, windowsHide: true, shell: false, env: launch.env }];
}

// Rollup swallows a failed probe, so a spawn error, timeout (ETIMEDOUT + SIGTERM), signal or non-zero
// status is recorded as a denial (fails the run) even if the child already reported ready. Not thrown:
// Rollup still gets the real result.
function rollupReportResult(method, res) {
  let problem = '';
  if (!res || typeof res !== 'object') problem = 'result-missing';
  else if (res.error) problem = 'result-error:' + (res.error.code || 'unknown');
  else if (res.signal) problem = 'result-signal:' + res.signal;
  else if (res.status !== 0) problem = 'result-status:' + res.status;
  if (problem) deny(method, 'rollup-report', problem);
  return res;
}

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const orig = cp[name];
  const method = 'child_process.' + name;
  cp[name] = function guardedChild() {
    const p = splitArgs(arguments);
    if (p.bad) throw deny(method, 'child-args', '-');
    if (name === 'spawnSync' && isRollupReport(p)) {
      return rollupReportResult(method, approvedCall(orig, rollupReportCall(method, p, guardedChild)));
    }
    // Executes exactly the vetted invocation (for static rules: the caller's file/args with safe options).
    const inv = vetChild(method, p.file, p.args, p.options, false);
    return approvedCall(orig, p.cb ? [inv.file, inv.args, inv.options, p.cb] : [inv.file, inv.args, inv.options]);
  };
}
const origFork = cp.fork;
cp.fork = function fork() {
  const p = splitArgs(arguments);
  if (p.bad || p.cb) throw deny('child_process.fork', 'child-args', '-');
  // Static rules only (full-unit vectors are denied for fork), so file/args are the vetted entry/argv.
  const inv = vetChild('child_process.fork', process.execPath, [p.file].concat(p.args), p.options, true);
  inv.options.execPath = cfg.nodePath;
  return approvedCall(origFork, [p.file, p.args, inv.options]);
};
// Vite's optional Windows mapped-drive optimization (config.js optimizeSafeRealPathSync) runs
// exec('net use', cb) and returns on any callback error, keeping fs.realpathSync. Only that exact
// call (two args, pinned config.js as the direct caller at the pinned line) gets an async callback
// error with empty output; no child or shell is started and nothing is returned. It is logged as a
// separate `compat` record. Any other exec, and every execSync, stays a child-shell denial.
const VITE_PROBE_CODE = 'OFFLINE_PLATFORM_PROBE_DISABLED';
function viteNetUseProbe(args, wrapper) {
  const M = 'child_process.exec';
  const cb = args[1];
  if (args.length !== 2 || typeof cb !== 'function') throw deny(M, 'vite-probe', 'arguments');
  const f = callerFrame(wrapper);
  if (!f || f.file !== norm(VITE_PROBE.configJs) || f.line !== VITE_PROBE.line || f.fn !== 'optimizeSafeRealPathSync') {
    throw deny(M, 'vite-probe', 'caller');
  }
  if (!pinnedShaOk(VITE_PROBE.configJs, VITE_PROBE.configJsSha256)) throw deny(M, 'vite-probe', 'config.js-hash');
  record({
    t: 'compat', compat: 'vite-net-use-probe', method: M, caller: path.basename(VITE_PROBE.configJs),
    line: f.line, sourceSha256: VITE_PROBE.configJsSha256, result: VITE_PROBE_CODE,
  });
  const err = new Error(VITE_PROBE_CODE + ': `net use` is unavailable offline; no process was started');
  err.code = VITE_PROBE_CODE;
  err.cmd = 'net use';
  err.killed = false;
  err.signal = null;
  process.nextTick(cb, err, '', '');
  return undefined;
}
cp.exec = function exec(command) {
  if (VITE_PROBE && command === 'net use') return viteNetUseProbe(arguments, exec);
  throw deny('child_process.exec', 'child-shell', '-');
};
cp.execSync = function () { throw deny('child_process.execSync', 'child-shell', '-'); };
const origCpSpawn = cp.ChildProcess.prototype.spawn;
cp.ChildProcess.prototype.spawn = function () {
  if (!approvedDepth) throw deny('ChildProcess.spawn', 'child-direct', '-');
  return origCpSpawn.apply(this, arguments);
};

// ---- worker_threads: only approved entries, guard forced into execArgv and env ----
const OrigWorker = wt.Worker;
const WORKER_KEYS = new Set(['argv', 'env', 'execArgv', 'stdin', 'stdout', 'stderr', 'workerData', 'transferList',
  'resourceLimits', 'name', 'trackUnmanagedFds']);

function vetWorker(filename, options) {
  const M = 'worker_threads.Worker';
  const opts = options === undefined ? {} : options;
  if (!opts || typeof opts !== 'object') throw deny(M, 'worker-option', '-');
  if (opts.eval) throw deny(M, 'worker-eval', '-');
  let file = '';
  try {
    file = filename instanceof URL ? fileURLToPath(filename) : String(filename);
  } catch (e) {
    file = '';
  }
  if (!path.isAbsolute(file) || !WORKER_ENTRIES.has(norm(file))) throw deny(M, 'worker-entry', path.basename(file) || '-');
  const base = path.basename(file);
  const safe = {};
  for (const k of Object.keys(opts)) {
    if (!WORKER_KEYS.has(k)) throw deny(M, 'worker-option', k);
    if (k === 'execArgv') {
      const a = opts.execArgv;
      if (!Array.isArray(a) || a.length !== 2 || a[0] !== '--require' || norm(a[1]) !== norm(__filename)) {
        throw deny(M, 'worker-execargv', base);
      }
    } else if (k === 'env') {
      if (!envKeeps(opts.env)) throw deny(M, 'worker-env', base); // also rejects SHARE_ENV
    } else {
      safe[k] = opts[k];
    }
  }
  const launch = launchEnv();
  safe.env = launch.env;
  safe.execArgv = ['--require', __filename];
  return { file, options: safe, id: launch.id };
}

class Worker extends OrigWorker {
  constructor(filename, options) {
    const v = vetWorker(filename, options);
    super(v.file, v.options);
    // Registered after super() because the thread id only exists now. If the record is
    // never written, the worker's own ready record is "unregistered" and the run fails.
    record({ t: 'launch', kind: 'worker', id: v.id, threadId: this.threadId, entry: path.basename(v.file) });
  }
}
wt.Worker = Worker;

// ---- module.register: denied unless admitted (one exact call per admitted process) ----
// Node 22.15 starts an internal loader thread on the first register (no env/execArgv options: it gets a
// copy of process.env and the parent's preloads, so this guard runs there as role `loader` before the
// loader module is imported) and waits synchronously until the loader is initialized. The admitted call:
// direct caller = the pinned file/line/function, parentURL = that caller's own module URL, specifier = the
// pinned loader URL, options exactly { data } with exactly the pinned data keys/URLs, all files re-hashed,
// no execArgv and unchanged guard env. Admission is consumed before any check, so a failed or second call
// stays denied. Every loader thread, ordinary worker and unadmitted process is denied.
const Module = require('module');
const origRegister = Module.register;
let registerConsumed = false;

// Exact own enumerable data keys in this order, Object.prototype only: no symbols, accessors, own
// __proto__ (it would be an extra key) or extra options such as transferList.
function exactData(o, keys) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) return null;
  const own = Reflect.ownKeys(o);
  if (own.length !== keys.length || !own.every((k, i) => k === keys[i])) return null;
  const out = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || !('value' in d) || !d.enumerable) return null;
    out[k] = d.value;
  }
  return out;
}
// A canonical file: URL (round-trips unchanged, so no query/fragment/alternate spelling) naming exactly file.
function isFileUrl(u, file) {
  if (typeof u !== 'string' || u.indexOf('file:') !== 0) return false;
  try {
    const p = fileURLToPath(u);
    return pathToFileURL(p).href === u && norm(p) === norm(file);
  } catch (e) {
    return false;
  }
}

// Before the original register: a dedicated loader-launch record with a fresh id (never this process's
// own launch id). process.env is then replaced IN PLACE by the launcher env + config hash + that id (the
// internal thread copies the env object's store, so reassigning process.env would not help), and the
// caller's exact keys/values are restored on the same object in finally. This keeps app-set keys (run.mjs's
// dummy GEMINI_API_KEY) out of the loader thread; the saved env is never logged. After the synchronous
// register returns, exactly one matching loader-ready must exist; a throw, a missing/duplicate ready or any
// mismatch is a ledger denial (sticky, even if the caller catches and exits 0). On success a loader-complete
// binds the ready's thread id.
function admittedRegister(M, specifier, parentURL, data) {
  const launch = launchEnv();
  record({
    t: 'loader-launch', id: launch.id, parentLaunchId: LAUNCH_ID, entry: path.basename(LOADER.loader.path),
    callerSha256: LOADER.caller.sha256, loaderSha256: LOADER.loader.sha256, configSha256: CONFIG_SHA, guardSha256: cfg.guardSha256,
  });
  const env = process.env;
  const saved = Object.keys(env).map((k) => [k, env[k]]);
  let result;
  let failure = null;
  try {
    for (const k of Object.keys(env)) delete env[k];
    for (const k of Object.keys(launch.env)) env[k] = launch.env[k];
    result = origRegister(specifier, parentURL, { data: Object.assign({}, data) });
  } catch (e) {
    failure = e;
  } finally {
    for (const k of Object.keys(env)) delete env[k];
    for (const [k, v] of saved) env[k] = v;
  }
  const readies = ledgerRecords(['loader'], process.pid, null).filter((r) => r.t === 'loader-ready' && r.launchId === launch.id);
  let problem = '';
  if (failure) problem = 'register threw';
  else if (readies.length !== 1) problem = 'loader-ready count ' + readies.length;
  else {
    const r = readies[0];
    if (r.role !== 'loader' || r.pid !== process.pid || !Number.isInteger(r.tid) || r.tid <= 0 || r.tid === TID ||
        r.internal !== true || r.guardSha256 !== cfg.guardSha256 || r.configSha256 !== CONFIG_SHA ||
        r.loaderSha256 !== LOADER.loader.sha256) {
      problem = 'loader-ready mismatch';
    }
  }
  if (problem) {
    const err = deny(M, 'loader-register', problem);
    throw failure || err;
  }
  record({ t: 'loader-complete', id: launch.id, readyTid: readies[0].tid });
  return result;
}

if (typeof origRegister === 'function') {
  Module.register = function register(specifier, parentURL, options) {
    const M = 'module.register';
    if (ROLE === 'loader' || ROLE === 'worker') throw deny(M, 'loader-register', ROLE + ' thread');
    if (!LOADER || !loaderProcessAdmitted) throw deny(M, 'loader-register', 'process not admitted');
    if (registerConsumed) throw deny(M, 'loader-register', 'second call');
    registerConsumed = true;
    const f = callerFrame(register);
    if (!f || f.file !== norm(LOADER.caller.path) || f.line !== LOADER.caller.line || f.fn !== LOADER.caller.fn) {
      throw deny(M, 'loader-register', 'caller');
    }
    if (arguments.length !== 3) throw deny(M, 'loader-register', 'arguments');
    if (parentURL !== f.raw || !isFileUrl(parentURL, LOADER.caller.path)) throw deny(M, 'loader-register', 'parent');
    if (!isFileUrl(specifier, LOADER.loader.path)) throw deny(M, 'loader-register', 'specifier');
    const opts = exactData(options, ['data']);
    const data = opts && exactData(opts.data, LOADER.data.map((d) => d.key));
    if (!data) throw deny(M, 'loader-register', 'options');
    for (const d of LOADER.data) {
      if (!isFileUrl(data[d.key], d.path)) throw deny(M, 'loader-register', 'data ' + d.key);
    }
    if (process.execArgv.length !== 0 || process.env.NODE_OPTIONS !== LAUNCHER_ENV.NODE_OPTIONS ||
        process.env.OFFLINE_GUARD_CONFIG !== LAUNCHER_ENV.OFFLINE_GUARD_CONFIG || process.env.OFFLINE_GUARD_CONFIG_SHA256 !== CONFIG_SHA) {
      throw deny(M, 'loader-register', 'preload state');
    }
    for (const pin of [LOADER.runner, LOADER.caller, LOADER.loader].concat(LOADER.data)) {
      if (!shaFresh(pin.path, pin.sha256)) throw deny(M, 'loader-register', 'hash ' + path.basename(pin.path));
    }
    return admittedRegister(M, specifier, parentURL, data);
  };
}

// ---- finalize: reflect patches into builtin ESM namespaces, then report ready ----
// (after the module.register patch, so `import { register } from 'node:module'` gets the wrapper)
require('module').syncBuiltinESMExports();
Object.defineProperty(globalThis, KEY, { value: Object.freeze({ role: ROLE, launchId: LAUNCH_ID }) });
if (ROLE === 'loader') {
  // Distinct record type: matched to its loader-launch by the supervisor, never to a child/worker launch.
  record({
    t: 'loader-ready',
    launchId: LAUNCH_ID,
    internal: wt.isInternalThread === true,
    node: process.version,
    guardSha256: cfg.guardSha256,
    configSha256: CONFIG_SHA,
    loaderSha256: LOADER.loader.sha256,
    execArgv: process.execArgv,
  });
} else {
  record({
    t: 'ready',
    launchId: LAUNCH_ID,
    node: process.version,
    guardSha256: cfg.guardSha256,
    configSha256: CONFIG_SHA,
    execArgv: process.execArgv,
  });
}
