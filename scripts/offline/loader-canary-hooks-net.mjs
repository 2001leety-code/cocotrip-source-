// Negative canary loader (variant loader-network): the loader thread tries a loopback connect and
// swallows the error. The guard denial in the loader thread's ledger must still fail the run.
import net from 'node:net';

export function initialize() {
  try {
    net.connect(9, '127.0.0.1').destroy();
  } catch {
    // swallowed on purpose
  }
}

export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}
