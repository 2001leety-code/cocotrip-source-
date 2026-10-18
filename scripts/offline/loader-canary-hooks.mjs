// Canary loader (loader-canary profile). Runs in Node's internal loader thread under the guard. Maps the
// one specifier offline-loader-canary:probe to the pinned probe file, tagged with what this thread sees
// (dummy key, internal status, thread id, launch id), so the canary main can check the loader side.
import { isInternalThread, threadId } from 'node:worker_threads';

let probeUrl = null;

export function initialize(data) {
  probeUrl = data.probeUrl;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'offline-loader-canary:probe') {
    const seen = new URLSearchParams({
      gemini: process.env.GEMINI_API_KEY === undefined ? 'absent' : 'present',
      internal: String(isInternalThread === true),
      tid: String(threadId),
      launch: process.env.OFFLINE_GUARD_LAUNCH_ID || '',
    });
    return { url: `${probeUrl}?${seen}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
