'use strict';
// Approved worker fixture: must run with the guard re-required through execArgv.
const { parentPort, isMainThread } = require('worker_threads');
const net = require('net');
const guard = globalThis[Symbol.for('cocotrip.offline.guard')];

async function main() {
  const problems = [];
  if (isMainThread) problems.push('not running as a worker');
  if (!guard || guard.role !== 'worker' || !guard.launchId) problems.push('guard not ready as worker');
  if (process.execArgv[0] !== '--require') problems.push('guard missing from execArgv');
  if (!process.env.NODE_OPTIONS) problems.push('NODE_OPTIONS missing');
  try {
    net.connect(9, '127.0.0.1').destroy();
    problems.push('net.connect not denied');
  } catch (e) {
    if (!e || e.code !== 'OFFLINE_GUARD_DENIED') problems.push('net.connect wrong error');
  }
  try {
    await fetch('https://192.0.2.1/', { signal: AbortSignal.abort() });
    problems.push('fetch not denied');
  } catch (e) {
    if (!e || e.code !== 'OFFLINE_GUARD_DENIED') problems.push('fetch wrong error');
  }
  return problems;
}

main()
  .catch((e) => ['crashed: ' + (e && e.message)])
  .then((problems) => {
    if (parentPort) parentPort.postMessage({ ok: problems.length === 0, problems });
    else process.exitCode = 1;
  });
