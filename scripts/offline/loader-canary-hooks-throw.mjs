// Negative canary loader (variant register-throws): initialize fails after the guard is ready in the
// loader thread, so the synchronous register throws. The canary main catches it and exits 0; the
// guard's register-threw denial and the missing loader-complete must still fail the run.
export function initialize() {
  throw new Error('LOADER_CANARY_INITIALIZE_FAILED');
}

export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}
