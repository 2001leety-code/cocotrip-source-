// Data target of the loader canary: imported only through loader-canary-hooks.mjs, which appends what the
// loader thread saw as the URL query.
export const PROBE = 'loader-canary-probe';
export const SEEN = Object.fromEntries(new URL(import.meta.url).searchParams);
