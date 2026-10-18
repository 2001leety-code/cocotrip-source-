// Loader canary main (Run-Offline.ps1 -Mode loadercheck, profile loader-canary). One fixed variant per
// run (argv[2], from the supervisor's enumerated list). `ok` must PASS the supervisor; every other variant
// must FAIL it with exactly its expected ledger evidence, even though this process catches the error and
// exits 0. The forging variants write records into the run's own ledger the way hostile app code could.
// Exit 1 only when this process's own checks fail (e.g. a call that should be denied was not).
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CALLER_URL, registerCanary, registerElsewhere } from './loader-canary-register.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const url = (name) => pathToFileURL(join(HERE, name)).href;
const VARIANT = process.argv[2] || '';
// Same mapping as $LoaderCanaryHooks in Run-Offline.ps1.
const HOOKS = {
  'loader-network': 'loader-canary-hooks-net.mjs',
  'loader-reregister': 'loader-canary-hooks-reregister.mjs',
  'register-throws': 'loader-canary-hooks-throw.mjs',
};
const LOADER_URL = url(HOOKS[VARIANT] || 'loader-canary-hooks.mjs');
const PROBE_URL = url('loader-canary-probe.mjs');
const PID = process.pid;
// The first launch id this main thread hands out (no child/worker/loader launched before).
const NEXT_ID = `${PID}.0.1`;
const cfg = JSON.parse(readFileSync(process.env.OFFLINE_GUARD_CONFIG, 'utf8'));
const LEDGER_DIR = cfg.ledgerDir;

const failures = [];
const check = (name, ok) => { if (!ok) failures.push(name); };
const opts = () => ({ data: { probeUrl: PROBE_URL } });

function expectDenied(name, fn) {
  try {
    fn();
    check(`${name}: not denied`, false);
  } catch (e) {
    check(`${name}: wrong error ${e && (e.code || e.message)}`, !!e && e.code === 'OFFLINE_GUARD_DENIED');
  }
}
function expectThrows(name, fn) {
  try {
    fn();
    check(`${name}: did not throw`, false);
  } catch {
    // any error: the ledger, not this process, decides
  }
}

function forge(file, rec) {
  appendFileSync(join(LEDGER_DIR, file), `${JSON.stringify(rec)}\n`);
}
function loaderRecords() {
  const out = [];
  for (const name of readdirSync(LEDGER_DIR)) {
    if (!new RegExp(`^loader-${PID}-t\\d+\\.jsonl$`).test(name)) continue;
    let text = '';
    try {
      text = readFileSync(join(LEDGER_DIR, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) if (line) out.push(JSON.parse(line));
  }
  return out;
}
const sortedEnv = () => JSON.stringify(Object.entries(process.env).sort());

// What run.mjs does: a dummy key is set before installMocks, then the register. The caller's env object
// must come back identical and exactly restored, whether the register returns or throws.
function withEnvRestoreChecks(fn) {
  process.env.GEMINI_API_KEY = 'offline-dummy-key';
  const envObject = process.env;
  const before = sortedEnv();
  fn();
  check('same env object', process.env === envObject);
  check('caller env restored exactly', sortedEnv() === before);
  check('caller dummy restored', process.env.GEMINI_API_KEY === 'offline-dummy-key');
}

function registerAdmitted() {
  withEnvRestoreChecks(() => registerCanary(LOADER_URL, CALLER_URL, opts()));
  const readies = loaderRecords().filter((r) => r.t === 'loader-ready' && r.launchId === NEXT_ID);
  check('exactly one loader-ready for the fresh launch id', readies.length === 1);
  return readies[0];
}

async function registerAndImport() {
  const ready = registerAdmitted();
  const probe = await import('offline-loader-canary:probe');
  check('ESM import through the admitted loader', probe.PROBE === 'loader-canary-probe');
  check('loader thread did not inherit the dummy key', probe.SEEN.gemini === 'absent');
  check('loader thread is internal', probe.SEEN.internal === 'true');
  check('loader tid matches its ready', !!ready && Number(probe.SEEN.tid) > 0 && String(ready.tid) === probe.SEEN.tid);
  check('loader launch id is fresh', probe.SEEN.launch === NEXT_ID && probe.SEEN.launch !== (process.env.OFFLINE_GUARD_LAUNCH_ID || ''));
  return ready;
}

async function main() {
  check('guard ready as main', globalThis[Symbol.for('cocotrip.offline.guard')]?.role === 'main');
  switch (VARIANT) {
    case 'ok':
      await registerAndImport();
      break;
    case 'wrong-caller':
      expectDenied(VARIANT, () => registerElsewhere(LOADER_URL, CALLER_URL, opts()));
      break;
    case 'wrong-specifier':
      expectDenied(VARIANT, () => registerCanary(url('loader-canary-hooks-throw.mjs'), CALLER_URL, opts()));
      break;
    case 'wrong-parent':
      expectDenied(VARIANT, () => registerCanary(LOADER_URL, import.meta.url, opts()));
      break;
    case 'wrong-data':
      expectDenied(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL, { data: { probeUrl: url('loader-canary-main.mjs') } }));
      break;
    case 'extra-option':
      expectDenied(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL, { ...opts(), transferList: [] }));
      break;
    case 'own-proto':
      // JSON.parse makes "__proto__" an own data key
      expectDenied(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL,
        JSON.parse(`{"data":${JSON.stringify({ probeUrl: PROBE_URL })},"__proto__":{}}`)));
      break;
    case 'overload':
      expectDenied(VARIANT, () => registerCanary(LOADER_URL, { parentURL: CALLER_URL, ...opts() }));
      break;
    case 'not-admitted':
      expectDenied(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL, opts()));
      break;
    case 'second':
      await registerAndImport();
      expectDenied(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL, opts()));
      break;
    case 'loader-network':
    case 'loader-reregister':
      registerAdmitted();
      break;
    case 'register-throws':
      withEnvRestoreChecks(() => expectThrows(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL, opts())));
      break;
    case 'reuse-id':
      forge(`loader-${PID}-t99999.jsonl`, { t: 'loader-ready', launchId: NEXT_ID, role: 'loader', pid: PID, tid: 99999, ts: Date.now() });
      expectThrows(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL, opts()));
      break;
    case 'missing-ready':
      // The loader thread's ledger file cannot be created, so its ready is never written.
      for (let t = 1; t <= 8; t++) mkdirSync(join(LEDGER_DIR, `loader-${PID}-t${t}.jsonl`));
      expectThrows(VARIANT, () => registerCanary(LOADER_URL, CALLER_URL, opts()));
      break;
    case 'dup-ready': {
      const ready = await registerAndImport();
      if (ready) forge(`loader-${PID}-t99999.jsonl`, ready);
      break;
    }
    case 'mismatch-ready': {
      // A complete forged registration whose ready names the wrong guard hash; nothing is registered.
      const la = cfg.loaderAdmission;
      const common = { pid: PID, ts: Date.now() };
      forge(`main-${PID}-t0.jsonl`, {
        t: 'loader-launch', id: NEXT_ID, parentLaunchId: '', entry: 'loader-canary-hooks.mjs', callerSha256: la.caller.sha256,
        loaderSha256: la.loader.sha256, configSha256: process.env.OFFLINE_GUARD_CONFIG_SHA256, guardSha256: cfg.guardSha256,
        role: 'main', tid: 0, ...common,
      });
      forge(`loader-${PID}-t99999.jsonl`, {
        t: 'loader-ready', launchId: NEXT_ID, internal: true, node: process.version, guardSha256: '0'.repeat(64),
        configSha256: process.env.OFFLINE_GUARD_CONFIG_SHA256, loaderSha256: la.loader.sha256, execArgv: [],
        role: 'loader', tid: 99999, ...common,
      });
      forge(`main-${PID}-t0.jsonl`, { t: 'loader-complete', id: NEXT_ID, readyTid: 99999, role: 'main', tid: 0, ...common });
      break;
    }
    case 'unregistered-ready': {
      const ready = await registerAndImport();
      if (ready) forge(`loader-${PID}-t99999.jsonl`, { ...ready, launchId: `${PID}.0.77`, tid: 99999 });
      break;
    }
    default:
      check(`unknown variant ${VARIANT}`, false);
  }
}

main()
  .catch((e) => { failures.push(`loader canary crashed: ${e && e.message}`); })
  .then(() => {
    process.stdout.write(`LOADER_CANARY variant=${VARIANT} failed=${failures.length}\n`);
    for (const f of failures) process.stdout.write(`  FAIL ${f}\n`);
    process.exitCode = failures.length ? 1 : 0;
  });
