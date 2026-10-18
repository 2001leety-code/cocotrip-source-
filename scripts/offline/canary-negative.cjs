'use strict';
// Negative fixture: attempts egress, swallows the guard error, fires and forgets a
// second attempt, and exits 0. The supervisor MUST still fail this run from the ledger.
try {
  require('net').connect(443, '192.0.2.1');
} catch (e) {
  // swallowed on purpose
}
fetch('https://192.0.2.1/', { signal: AbortSignal.abort() }).catch(() => {});
process.exitCode = 0;
