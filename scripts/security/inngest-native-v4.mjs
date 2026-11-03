// App-scoped compatibility patch for pinned Inngest 4.24.0. No global Zod mutation.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const manifest = JSON.parse(readFileSync(new URL('./inngest-native-v4-manifest.json', import.meta.url), 'utf8'));
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const refuse = (message) => { throw new Error(`INNGEST_NATIVE_V4_REFUSED: ${message}`); };
function inside(parent, target) {
  const delta = relative(parent, target);
  return !!delta && !delta.startsWith('..') && !isAbsolute(delta);
}
function privateFile(modules, path) {
  const state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || !inside(modules, realpathSync(path))) refuse('target is not a private regular file');
}
export function patchSource(source, entry) {
  let result = source;
  for (const edit of [...entry.edits].reverse()) {
    if (result.slice(edit.start, edit.start + edit.before.length) !== edit.before) refuse(`source anchor mismatch: ${entry.file}`);
    result = result.slice(0, edit.start) + edit.after + result.slice(edit.start + edit.before.length);
  }
  if (sha256(result) !== entry.afterSha256) refuse(`patched hash mismatch: ${entry.file}`);
  return result;
}
export function inspectNativeSdk(repoRoot) {
  const modulesPath = join(repoRoot, 'node_modules');
  if (lstatSync(modulesPath).isSymbolicLink()) refuse('node_modules must be private');
  const modules = realpathSync(modulesPath);
  const require = createRequire(join(repoRoot, 'package.json'));
  const sdkRoot = dirname(require.resolve('inngest'));
  if (!inside(modules, realpathSync(sdkRoot))) refuse('SDK escaped private installation');
  const sdk = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'));
  const sdkRequire = createRequire(join(sdkRoot, 'package.json'));
  const zodRoot = dirname(dirname(sdkRequire.resolve('zod/v4')));
  if (!inside(modules, realpathSync(zodRoot))) refuse('Zod escaped private installation');
  const zod = JSON.parse(readFileSync(join(zodRoot, 'package.json'), 'utf8'));
  if (sdk.version !== manifest.sdkVersion || zod.version !== manifest.zodVersion) refuse('unsupported dependency version');
  const files = manifest.files.map((entry) => {
    const path = join(sdkRoot, entry.file);
    privateFile(modules, path);
    const bytes = readFileSync(path);
    const current = sha256(bytes);
    if (current === entry.afterSha256) return { path, bytes, patched: bytes, state: 'patched', name: entry.file };
    if (current !== entry.beforeSha256) refuse(`unrecognized source hash: ${entry.file}`);
    return { path, bytes, patched: Buffer.from(patchSource(bytes.toString('utf8'), entry)), state: 'original', name: entry.file };
  });
  for (const entry of manifest.additions) {
    const source = new URL(`./inngest-native-v4/${entry.file}`, import.meta.url);
    const patched = readFileSync(source);
    if (sha256(patched) !== entry.sha256) refuse(`patch artifact hash mismatch: ${entry.file}`);
    const path = join(sdkRoot, entry.file);
    if (existsSync(path)) {
      privateFile(modules, path);
      const bytes = readFileSync(path);
      if (sha256(bytes) !== entry.sha256) refuse(`unrecognized added file: ${entry.file}`);
      files.push({ path, bytes, patched, state: 'patched', name: entry.file });
    } else files.push({ path, bytes: undefined, patched, state: 'missing', name: entry.file });
  }
  return { sdkRoot, zodRoot, files, applied: files.every((file) => file.state === 'patched') };
}
export function applyNativeSdk(repoRoot) {
  const checked = inspectNativeSdk(repoRoot); // Validate all source and artifact hashes before writes.
  try {
    for (const file of checked.files) if (file.state !== 'patched') writeFileSync(file.path, file.patched);
  } catch (error) {
    for (const file of checked.files) {
      if (file.state === 'original') writeFileSync(file.path, file.bytes);
      if (file.state === 'missing' && existsSync(file.path)) unlinkSync(file.path);
    }
    throw error;
  }
  return inspectNativeSdk(repoRoot);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const mode = process.argv[2];
  if (!['--apply', '--check'].includes(mode)) refuse('use --apply or --check');
  const checked = mode === '--apply' ? applyNativeSdk(root) : inspectNativeSdk(root);
  if (!checked.applied) refuse('SDK patch is not applied; run the reviewed postinstall command');
  console.log(`Inngest ${manifest.sdkVersion}: native Zod ${manifest.zodVersion}, ${checked.files.length} verified patch files`);
}
