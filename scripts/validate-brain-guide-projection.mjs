// Read-only contract validator for Brain content_queue → web /guide handoff.
// It intentionally does not create guide JSON, modify Blogger, commit, push, or deploy.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateBrainGuideProjection } from './brain-guide-projection.lib.mjs';

const args = process.argv.slice(2);
const manifestArg = args.find((arg) => arg.startsWith('--brain-manifest='));
const unknown = args.filter((arg) => !arg.startsWith('--brain-manifest='));
if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);

if (!manifestArg) {
  console.log('No Brain projection manifest supplied. Audit only; no files changed.');
  console.log('Usage: npm run guide:brain-check -- --brain-manifest=<path>');
  process.exit(0);
}

const manifestPath = manifestArg.slice('--brain-manifest='.length).trim();
if (!manifestPath) throw new Error('--brain-manifest requires a path');
const resolved = path.resolve(manifestPath);
const manifest = JSON.parse(readFileSync(resolved, 'utf8'));
const result = validateBrainGuideProjection(manifest);
if (!result.ok) {
  for (const error of result.errors) console.error(`INVALID ${error.field}: ${error.message}`);
  console.error('Brain projection rejected. No files changed.');
  process.exit(1);
}

console.log(`Brain projection valid: queueId=${manifest.queueId}`);
console.log(`Canonical: ${manifest.canonicalUrl}`);
console.log(`Content SHA-256: ${manifest.contentSha256}`);
console.log('Validation only. No files changed.');
