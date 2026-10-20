'use strict';
// Approved child fixture: reachable only through the guard's vetted child_process paths.
const guard = globalThis[Symbol.for('cocotrip.offline.guard')];
const mode = process.argv[2] || 'none';

async function denied(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return !!e && e.code === 'OFFLINE_GUARD_DENIED';
  }
}

async function main() {
  const problems = [];
  if (!guard || guard.role !== 'child' || !guard.launchId) problems.push('guard not ready as child');
  if (!process.env.NODE_OPTIONS) problems.push('NODE_OPTIONS missing');
  if (process.env.CANARY_EXTRA) problems.push('caller env not rebuilt');
  if (!(await denied(() => fetch('https://192.0.2.1/', { signal: AbortSignal.abort() })))) problems.push('fetch not denied');
  if (!(await denied(() => require('dns').promises.lookup('192.0.2.1')))) problems.push('dns not denied');
  return problems;
}

main()
  .catch((e) => ['crashed: ' + (e && e.message)])
  .then((problems) => {
    const ok = problems.length === 0;
    process.stdout.write((ok ? 'CHILD_OK ' : 'CHILD_FAIL ') + mode + (ok ? '' : ' ' + problems.join('; ')) + '\n');
    process.exitCode = ok ? 0 : 1;
    if (process.send) process.send({ ok, mode, problems }, () => process.disconnect());
  });
