// Browser capture profile, guarded main process. Launched only by Run-Capture.ps1 as
// `node.exe browser-profile-main.mjs <pilot|matrix|videos|planner-repair>` with NODE_OPTIONS=--require guard.cjs,
// so the guard is loaded before this module. Starts the offline Vite dev server in THIS process
// (127.0.0.1:5192 only), runs the capture harness as one guarded node child with the fixed argv for
// the mode, waits for it, and always closes the server. No shell, no npm, no caller-chosen code,
// entry, path or argument. See BROWSER.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guard = globalThis[Symbol.for('cocotrip.offline.guard')];
if (!guard || guard.role !== 'main') {
  process.stderr.write('[browser-profile] refused: offline guard is not loaded as main\n');
  process.exit(2);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(REPO, 'scripts', 'integration', 'customer-capture-20261017.mjs');
const VITE_CONFIG = path.join(REPO, 'scripts', 'integration', 'vite-offline-20261017.config.ts');
const HOST = '127.0.0.1';
const PORT = 5192;
const ORIGIN = `http://${HOST}:${PORT}`;
const MINUTE = 60 * 1000;

// Harness selections (customer-capture-20261017.mjs readOptions). Must equal the guard argSets
// that Run-Capture.ps1 writes; the guard compares the child argv exactly.
const MODES = {
  pilot: { timeoutMs: 60 * MINUTE, args: ['--group', 'planner,charter,result', '--width', '390,1440', '--lang', 'ja,en'] },
  matrix: {
    timeoutMs: 420 * MINUTE,
    args: ['--group', 'home,planner,result,tours,charter,map,static,account', '--width', '360,390,430,1024,1440', '--lang', 'ko,en,ja,zh'],
  },
  videos: {
    timeoutMs: 120 * MINUTE,
    args: ['--group', 'video', '--width', '390,1440', '--lang', 'en,ko', '--video-flow', 'home,planner,charter,tours'],
  },
  // 12 planner cells only (360/390/430 x 4 langs): re-capture after a planner fix, not a matrix replacement.
  'planner-repair': { timeoutMs: 60 * MINUTE, args: ['--group', 'planner', '--width', '360,390,430', '--lang', 'ko,en,ja,zh'] },
};
// Harness exit 0/2/3 = receipt written (clean / failures / unverified); mapped so the supervisor can
// tell them apart from a profile error (1) or refusal (2).
const EXIT_MAP = { 0: 0, 2: 12, 3: 13 };

function refuse(message) {
  process.stderr.write(`[browser-profile] refused: ${message}\n`);
  process.exit(2);
}

const mode = process.argv.length === 3 ? process.argv[2] : '';
if (!Object.prototype.hasOwnProperty.call(MODES, mode)) refuse('argv must be exactly one of pilot|matrix|videos|planner-repair');
if (process.env.PRERENDER !== '0' || process.env.COCOTRIP_OFFLINE_PORT !== String(PORT)) refuse(`PRERENDER=0 and COCOTRIP_OFFLINE_PORT=${PORT} required`);
// The run dir is the supervisor-written guard config's directory (the guard verified its hash).
const configPath = process.env.OFFLINE_GUARD_CONFIG || '';
if (path.basename(configPath) !== 'guard-config.json') refuse('unexpected guard config path');
const runDir = path.dirname(configPath);
const out = path.join(runDir, 'capture');
if (fs.existsSync(out)) refuse(`capture dir already exists: ${out}`);
const harnessArgv = [HARNESS, '--base-url', ORIGIN, '--out', out, ...MODES[mode].args];

const result = { mode, harnessArgv, server: null, harness: null, serverClose: null, error: null };

function runHarness() {
  return new Promise((resolve) => {
    let timedOut = false;
    // Exact node.exe + approved entry; env is rebuilt by the guard from the launcher env.
    const child = spawn(process.execPath, harnessArgv, { cwd: REPO, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(); // the only process this module owns; Chromium/ffmpeg are the harness's children
    }, MODES[mode].timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ pid: child.pid || null, code: null, signal: null, timedOut, error: String(error.message || error) });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, code, signal, timedOut });
    });
  });
}

let exitCode = 1;
let server = null;
try {
  const { createServer } = await import('vite');
  // The offline config pins all of this too and refuses to resolve otherwise; repeated inline so a
  // config regression cannot widen the bind.
  server = await createServer({
    configFile: VITE_CONFIG,
    mode: 'development',
    envFile: false,
    clearScreen: false,
    server: { host: HOST, port: PORT, strictPort: true, open: false, hmr: false },
  });
  await server.listen();
  const addr = server.httpServer && server.httpServer.address();
  result.server = addr && typeof addr === 'object' ? { address: addr.address, port: addr.port } : null;
  if (!result.server || result.server.address !== HOST || result.server.port !== PORT) {
    throw new Error(`dev server bound to ${JSON.stringify(result.server)}, expected ${HOST}:${PORT}`);
  }
  result.harness = await runHarness();
  const mapped = result.harness.timedOut ? undefined : EXIT_MAP[result.harness.code];
  exitCode = mapped === undefined ? 1 : mapped;
} catch (error) {
  result.error = String((error && error.message) || error).split('\n')[0].slice(0, 400);
  exitCode = 1;
} finally {
  if (server) {
    try {
      await server.close();
      result.serverClose = 'closed';
    } catch (error) {
      result.serverClose = String((error && error.message) || error).slice(0, 200);
      exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(runDir, 'profile-main.json'), JSON.stringify({ ...result, exitCode }, null, 2));
}
// Explicit exit: a lingering watcher/socket must not keep the profile alive past its verdict.
process.exit(exitCode);
