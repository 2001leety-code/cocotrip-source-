'use strict';
// Phase-1 canary, launched only by Run-Offline.ps1. Every attempt below must be refused
// with OFFLINE_GUARD_DENIED, and the approved child/worker launches must come up guarded.
// The supervisor separately checks exact denial counts per role|category|method, so keep
// this list in sync with $Profiles.canary.Expected in Run-Offline.ps1.
const path = require('path');
const http = require('http');
const https = require('https');
const http2 = require('http2');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const dgram = require('dgram');
const cp = require('child_process');
const { Worker, SHARE_ENV } = require('worker_threads');

const CHILD = path.join(__dirname, 'canary-child.cjs');
const WORKER = path.join(__dirname, 'canary-worker.cjs');
const BLOCKED_IP = '192.0.2.1'; // RFC 5737 TEST-NET-1: no DNS needed, never routed
const guard = globalThis[Symbol.for('cocotrip.offline.guard')];

let passed = 0;
const failures = [];
function check(name, ok) {
  if (ok) passed++;
  else failures.push(name);
}

// If the guard ever lets something through, tear it down synchronously before it can connect.
function cleanup(r) {
  if (!r || typeof r !== 'object') return;
  if (typeof r.destroy === 'function') r.destroy();
  else if (typeof r.terminate === 'function') r.terminate();
  else if (typeof r.close === 'function') r.close();
  else if (typeof r.kill === 'function') r.kill();
}

async function expectDenied(name, fn) {
  try {
    const r = fn();
    cleanup(r);
    if (r && typeof r.then === 'function') await r;
    check(name + ': not denied', false);
  } catch (e) {
    check(name + ': wrong error ' + (e && (e.code || e.message)), !!e && e.code === 'OFFLINE_GUARD_DENIED');
  }
}

function waitChild(child) {
  return new Promise((resolve) => {
    let out = '';
    let msg = null;
    if (child.stdout) child.stdout.on('data', (d) => { out += d; });
    child.on('message', (m) => { msg = m; });
    child.on('error', (e) => resolve({ code: -1, out, msg, err: e.code || e.message }));
    child.on('close', (code) => resolve({ code, out, msg }));
  });
}

function waitWorker(worker) {
  return new Promise((resolve) => {
    let msg = null;
    worker.on('message', (m) => { msg = m; });
    worker.on('error', (e) => resolve({ code: -1, msg, err: e.code || e.message }));
    worker.on('exit', (code) => resolve({ code, msg }));
  });
}

async function main() {
  check('guard ready as main', !!guard && guard.role === 'main');

  // 1) Direct transports: refused before any DNS lookup or socket is created.
  await expectDenied('fetch', () => fetch('https://' + BLOCKED_IP + '/', { signal: AbortSignal.abort() }));
  await expectDenied('http.get', () => http.get('http://' + BLOCKED_IP + '/'));
  await expectDenied('https.request', () => https.request({ host: BLOCKED_IP, port: 443 }));
  await expectDenied('http2.connect', () => http2.connect('https://' + BLOCKED_IP));
  await expectDenied('net.connect loopback', () => net.connect(9, '127.0.0.1'));
  await expectDenied('net.connect pipe', () => net.connect({ path: '\\\\.\\pipe\\offline-canary' }));
  await expectDenied('net.Socket.connect', () => new net.Socket().connect(443, BLOCKED_IP));
  await expectDenied('net.createConnection localhost', () => net.createConnection({ host: 'localhost', port: 9 }));
  await expectDenied('tls.connect', () => tls.connect(443, BLOCKED_IP));
  await expectDenied('dns.lookup', () => dns.lookup(BLOCKED_IP, () => {}));
  await expectDenied('dns.promises.lookup', () => dns.promises.lookup(BLOCKED_IP));
  const resolver = new dns.Resolver();
  resolver.setServers(['127.0.0.1']); // even with a broken guard, no query leaves loopback
  await expectDenied('dns.Resolver.resolveTxt', () => resolver.resolveTxt('example.invalid', () => {}));
  const presolver = new dns.promises.Resolver();
  presolver.setServers(['127.0.0.1']);
  await expectDenied('dns.promises.Resolver.resolve4', () => presolver.resolve4('example.invalid'));
  await expectDenied('dgram.createSocket', () => dgram.createSocket('udp4'));
  await expectDenied('process.binding tcp_wrap', () => process.binding('tcp_wrap'));
  const esmHttp = await import('node:http'); // proves syncBuiltinESMExports
  await expectDenied('ESM http.request', () => esmHttp.request('http://' + BLOCKED_IP + '/'));

  // 2) Child processes: only exact node.exe + canary-child.cjs, guard env re-injected.
  const cmdExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  await expectDenied('exec (shell)', () => cp.exec('echo offline'));
  await expectDenied('spawn node -e', () => cp.spawn(process.execPath, ['-e', '1']));
  await expectDenied('spawn cmd.exe', () => cp.spawn(cmdExe, ['/c', 'exit']));
  await expectDenied('spawn env strips NODE_OPTIONS',
    () => cp.spawn(process.execPath, [CHILD], { env: { SystemRoot: process.env.SystemRoot } }));
  await expectDenied('fork execArgv', () => cp.fork(CHILD, [], { execArgv: ['--no-warnings'] }));
  await expectDenied('spawn shell:true', () => cp.spawn(process.execPath, [CHILD], { shell: true }));
  await expectDenied('spawnSync other entry', () => cp.spawnSync(process.execPath, [WORKER]));
  await expectDenied('ChildProcess.spawn direct', () => new cp.ChildProcess().spawn({
    file: process.execPath, args: [process.execPath, '-e', '1'], stdio: 'ignore',
  }));
  const esmCp = await import('node:child_process');
  await expectDenied('ESM execFileSync --eval', () => esmCp.execFileSync(process.execPath, ['--eval', '1']));

  // Ambient env stripping must not matter: the guard rebuilds env from the launcher config.
  const savedOptions = process.env.NODE_OPTIONS;
  let spawned;
  try {
    delete process.env.NODE_OPTIONS;
    spawned = cp.spawn(process.execPath, [CHILD, 'spawn'], { stdio: ['ignore', 'pipe', 'inherit'], timeout: 30000 });
  } finally {
    process.env.NODE_OPTIONS = savedOptions;
  }
  const a = await waitChild(spawned);
  check('approved spawn (code ' + a.code + ')', a.code === 0 && a.out.includes('CHILD_OK spawn'));

  const b = await waitChild(cp.fork(CHILD, ['fork'], { timeout: 30000 }));
  check('approved fork ipc (code ' + b.code + ')', b.code === 0 && !!b.msg && b.msg.ok === true);

  // Caller env with guard keys intact is accepted, but extra keys are dropped (child checks).
  const c = cp.spawnSync(process.execPath, [CHILD, 'sync'], {
    encoding: 'utf8', timeout: 30000, env: Object.assign({}, process.env, { CANARY_EXTRA: '1' }),
  });
  check('approved spawnSync (status ' + c.status + ')', c.status === 0 && String(c.stdout).includes('CHILD_OK sync'));

  // 3) Workers: only canary-worker.cjs, guard forced into execArgv and env.
  await expectDenied('Worker execArgv []', () => new Worker(WORKER, { execArgv: [] }));
  await expectDenied('Worker env {}', () => new Worker(WORKER, { env: {} }));
  await expectDenied('Worker SHARE_ENV', () => new Worker(WORKER, { env: SHARE_ENV }));
  await expectDenied('Worker eval', () => new Worker('1', { eval: true }));
  await expectDenied('Worker other entry', () => new Worker(CHILD));
  const w = await waitWorker(new Worker(WORKER, { workerData: { from: 'canary-main' } }));
  check('approved worker (code ' + w.code + ')', w.code === 0 && !!w.msg && w.msg.ok === true);
}

main()
  .catch((e) => { failures.push('canary crashed: ' + (e && e.message)); })
  .then(() => {
    process.stdout.write('CANARY passed=' + passed + ' failed=' + failures.length + '\n');
    for (const f of failures) process.stdout.write('  FAIL ' + f + '\n');
    process.exitCode = failures.length ? 1 : 0;
  });
