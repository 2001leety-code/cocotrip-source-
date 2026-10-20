'use strict';
// Fixed child for Rollup's Windows platform probe (node_modules/rollup/dist/native.js getReportHeader).
// guard.cjs translates ONLY that exact `node -p <report script>` call into `node <this file>`, so no
// -p/-e is ever allowed. Runs with the guard preloaded and the fresh launcher env (nothing passed
// through). Prints what the original script prints: the real process.report header as one JSON line.
// No arguments (else 64); refuses to run without the guard (65). Rollup treats any non-zero as "no header".
if (process.argv.length !== 2) {
  process.stderr.write('rollup-platform.cjs takes no arguments\n');
  process.exit(64);
}
if (!globalThis[Symbol.for('cocotrip.offline.guard')]) {
  process.stderr.write('rollup-platform.cjs must run under the offline guard\n');
  process.exit(65);
}
console.log(JSON.stringify(require('node:process').report.getReport().header));
