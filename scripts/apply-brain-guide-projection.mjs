// Explicit write path for one approved Brain content_queue projection.
// Validation and every collision check complete before the staged file transaction begins.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyBrainGuideProjection } from './apply-brain-guide-projection.lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const manifestArgs = args.filter((arg) => arg.startsWith('--brain-manifest='));
const unknown = args.filter((arg) => arg !== '--apply' && !arg.startsWith('--brain-manifest='));
if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);
if (!args.includes('--apply')) throw new Error('write refused: explicit --apply is required');
if (manifestArgs.length !== 1) throw new Error('write refused: exactly one --brain-manifest=<path> is required');

const manifestPath = manifestArgs[0].slice('--brain-manifest='.length).trim();
if (!manifestPath) throw new Error('--brain-manifest requires a path');
const manifest = JSON.parse(readFileSync(path.resolve(manifestPath), 'utf8'));
const result = applyBrainGuideProjection({ root: ROOT, manifest });
console.log(`Brain guide projection ${result.status}: ${result.slug}`);
console.log('No Blogger mutation, commit, push, merge, or deploy was performed.');
