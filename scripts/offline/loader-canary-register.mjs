// Fixed caller for the loader canary (Run-Offline.ps1 -Mode loadercheck). Only the module.register call
// inside registerCanary (line 9) is admitted, by file, line and function; registerElsewhere is the
// wrong-caller negative. Arguments are passed through unchanged so the negatives can vary them.
import { register } from 'node:module';

export const CALLER_URL = import.meta.url;

export function registerCanary(...args) {
  return register(...args);
}

export function registerElsewhere(...args) {
  return register(...args);
}
