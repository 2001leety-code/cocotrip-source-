// Negative canary loader (variant loader-reregister): the loader thread itself calls module.register and
// swallows the error. The guard denial in the loader thread's ledger must still fail the run.
import { register } from 'node:module';

export function initialize(data) {
  try {
    register(data.probeUrl, import.meta.url);
  } catch {
    // swallowed on purpose
  }
}

export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}
