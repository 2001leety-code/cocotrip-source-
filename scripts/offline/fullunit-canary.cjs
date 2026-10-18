'use strict';
// Full-unit boundary canary (Run-Offline.ps1 -Mode fullunit-canary). Runs the guard with the full-unit
// rules helper and no loader admission. Approved vectors must launch through the normalized invocation and
// give their real domain result; the listed misuses must be denied before any spawn. The supervisor checks
// the exact denial table ($FullUnitCanaryExpected) and the Git/Node rule ids in the ledger.
const path = require('path');
const cp = require('child_process');

const R = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(R, 'tests', 'fixtures', 'integration-20261017');
const PROJECTION_EXIT = path.join(FIXTURES, 'projection-exit.mjs');
const MONTAGE = path.join(R, 'scripts', 'export-openmontage-brief.mjs');
const RUN_MJS = path.join(R, 'scripts', 'plan-local', 'run.mjs');
const MONTAGE_OPTS = () => ({ encoding: 'utf8', cwd: R, timeout: 30000 });
const guard = globalThis[Symbol.for('cocotrip.offline.guard')];

let passed = 0;
const failures = [];
function check(name, ok) {
  if (ok) passed++;
  else failures.push(name);
}
function expectDenied(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.kill === 'function') r.kill();
    check(name + ': not denied', false);
  } catch (e) {
    check(name + ': wrong error ' + (e && (e.code || e.message)), !!e && e.code === 'OFFLINE_GUARD_DENIED');
  }
}

check('guard ready as main', !!guard && guard.role === 'main');

// Approved: the caller's spawn is replaced by the helper's invocation (fixed node.exe, cwd = R).
const exit = cp.spawnSync(process.execPath, [PROJECTION_EXIT]);
check('projection-exit status ' + exit.status, exit.status === 0);
const help = cp.spawnSync(process.execPath, [MONTAGE, '--help'], MONTAGE_OPTS());
check('openmontage --help status ' + help.status, help.status === 0 && String(help.stdout).includes('Usage'));
const fr = cp.spawnSync(process.execPath, [MONTAGE, '--locale', 'fr'], MONTAGE_OPTS());
check('openmontage --locale fr status ' + fr.status, fr.status === 2 && (String(fr.stdout) + String(fr.stderr)).includes('Usage'));
try {
  cp.execFileSync('git', ['check-ignore', '-q', 'android-owner/app/upload.jks'], { cwd: R });
  check('git check-ignore', true);
} catch (e) {
  check('git check-ignore: ' + (e && (e.code || e.status)), false);
}
let stage = '';
try {
  stage = cp.execFileSync('git', ['ls-files', '--stage', 'android-owner/gradlew'], { encoding: 'utf8' });
} catch (e) {
  stage = 'error ' + (e && (e.code || e.status));
}
check('git ls-files --stage gradlew is 100755', /^100755 /.test(stage));

// Denied (5x full-unit spawnSync, 1x full-unit-git, 1x child-exe, 1x full-unit fork, 1x module.register).
expectDenied('projection-exit extra arg', () => cp.spawnSync(process.execPath, [PROJECTION_EXIT, 'x']));
expectDenied('projection-exit extra option', () => cp.spawnSync(process.execPath, [PROJECTION_EXIT], { cwd: R }));
expectDenied('openmontage other locale', () => cp.spawnSync(process.execPath, [MONTAGE, '--locale', 'de'], MONTAGE_OPTS()));
expectDenied('audit-gate alias outside the repo cwd',
  () => cp.spawnSync(process.execPath, ['scripts/audit-gate.mjs'], { cwd: path.join(R, 'scripts'), stdio: 'pipe' }));
expectDenied('plan-local free scenario', () => cp.spawnSync(process.execPath, [RUN_MJS, 'other'], { cwd: R, stdio: 'pipe' }));
expectDenied('git status', () => cp.execFileSync('git', ['status'], { cwd: R }));
expectDenied('other git.exe', () => cp.spawnSync('C:\\Program Files\\Git\\bin\\git.exe', ['ls-files', '--stage', 'android-owner/gradlew'], { encoding: 'utf8' }));
expectDenied('fork of a full-unit entry', () => cp.fork(PROJECTION_EXIT));
expectDenied('module.register outside an admitted process',
  () => require('module').register('data:text/javascript,', 'file:///' + __filename.replace(/\\/g, '/')));

process.stdout.write('FULLUNIT_CANARY passed=' + passed + ' failed=' + failures.length + '\n');
for (const f of failures) process.stdout.write('  FAIL ' + f + '\n');
process.exitCode = failures.length ? 1 : 0;
