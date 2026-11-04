import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { applyNativeSdk, inspectNativeSdk, manifest, sha256 } from '../../scripts/security/inngest-native-v4.mjs';

const actual = inspectNativeSdk(process.cwd());
const temporary = mkdtempSync(join(tmpdir(), 'cocotrip-sdk-native-'));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function originalSource(entry) {
  const patched = readFileSync(join(actual.sdkRoot, entry.file), 'utf8');
  let result = '', originalOffset = 0, patchedOffset = 0;
  for (const edit of entry.edits) {
    const unchanged = edit.start - originalOffset;
    result += patched.slice(patchedOffset, patchedOffset + unchanged) + edit.before;
    patchedOffset += unchanged + edit.after.length;
    originalOffset = edit.start + edit.before.length;
  }
  result += patched.slice(patchedOffset);
  expect(sha256(result)).toBe(entry.beforeSha256);
  return result;
}
function installation(name) {
  const root = join(temporary, name), sdk = join(root, 'node_modules/inngest'), zod = join(root, 'node_modules/zod');
  mkdirSync(sdk, { recursive: true }); mkdirSync(join(zod, 'v4'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: 'inngest', version: '4.24.0', main: 'index.cjs' }));
  writeFileSync(join(sdk, 'index.cjs'), '// Resolution-only fixture, never executed.');
  writeFileSync(join(zod, 'package.json'), JSON.stringify({ name: 'zod', version: '4.6.7', exports: { './v4': './v4/index.cjs' } }));
  writeFileSync(join(zod, 'v4/index.cjs'), '// Resolution-only fixture, never executed.');
  for (const entry of manifest.files) {
    const path = join(sdk, entry.file);
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, originalSource(entry));
  }
  return { root, sdk, zod };
}

describe('pinned native SDK installation guards', () => {
  it('requires applied artifacts, applies idempotently and verifies every target hash', () => {
    const f = installation('idempotent');
    expect(inspectNativeSdk(f.root).applied).toBe(false);
    const first = applyNativeSdk(f.root);
    expect(first.applied).toBe(true);
    expect(first.files).toHaveLength(46);
    expect(applyNativeSdk(f.root).files.map((file) => sha256(readFileSync(file.path))))
      .toEqual(first.files.map((file) => sha256(readFileSync(file.path))));
  });
  it('refuses source drift before writing any earlier target', () => {
    const f = installation('source-drift');
    const first = join(f.sdk, manifest.files[0].file), last = join(f.sdk, manifest.files.at(-1).file);
    const before = readFileSync(first);
    writeFileSync(last, readFileSync(last, 'utf8') + '\n// unreviewed source\n');
    expect(() => applyNativeSdk(f.root)).toThrow('unrecognized source hash');
    expect(readFileSync(first)).toEqual(before);
  });
  it.each([['SDK', '4.26.2'], ['Zod', '3.25.76']])('refuses unsupported %s version %s', (kind, version) => {
    const f = installation(`version-${kind}`);
    const path = join(kind === 'SDK' ? f.sdk : f.zod, 'package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf8')); pkg.version = version; writeFileSync(path, JSON.stringify(pkg));
    expect(() => applyNativeSdk(f.root)).toThrow('unsupported dependency version');
  });
  it('wires install application and a failclosed check before the actual build', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.postinstall).toBe('node scripts/security/inngest-native-v4.mjs --apply');
    expect(pkg.scripts.build).toBe('node scripts/security/inngest-native-v4.mjs --check && tsc -b && vite build');
  });
});

const sdkRequire = createRequire(join(actual.sdkRoot, 'package.json'));
describe.each([
  ['ESM', await import(join(actual.sdkRoot, '_cocotrip-zod-v4.js'))],
  ['CJS', sdkRequire('./_cocotrip-zod-v4.cjs')],
])('executed SDK %s native security bounds', (_mode, { z }) => {
  it.each(['max', 'length'])('rejects oversized .%s before child parsing and preserves the custom issue', (bound) => {
    let visits = 0;
    const out = z.object({ items: z.array(z.number().refine(() => { visits++; return false; }))[bound](1, 'size budget') })
      .safeParse({ items: Array(100).fill(1) });
    expect(visits).toBe(0);
    expect(out.error.issues).toEqual([expect.objectContaining({ code: 'too_big', path: ['items'], maximum: 1, message: 'size budget' })]);
  });
  it.each(['array', 'set'])('does not invoke sync or async %s elements above an upper bound', async (kind) => {
    for (const async of [false, true]) {
      let visits = 0;
      const callback = () => { visits++; return false; };
      const schema = z[kind](z.number().refine(async ? async () => callback() : callback)).max(1);
      const values = Array.from({ length: 100 }, (_value, i) => i);
      const input = kind === 'set' ? new Set(values) : values;
      const out = async ? await schema.safeParseAsync(input) : schema.safeParse(input);
      expect(out.success).toBe(false); expect(out.error.issues).toHaveLength(1); expect(visits).toBe(0);
    }
  });
  it('preserves ordinary transforms, defaults, optional, union, catch and lower bounds', async () => {
    await expect(z.array(z.coerce.number().transform(async (n) => n + 1)).max(2).parseAsync(['1', 2])).resolves.toEqual([2, 3]);
    expect(z.array(z.number()).max(2).default([1]).parse(undefined)).toEqual([1]);
    expect(z.object({ items: z.array(z.number()).optional() }).parse({})).toEqual({});
    expect(z.union([z.array(z.string()).max(1), z.string()]).parse('ordinary')).toBe('ordinary');
    expect(z.array(z.string()).max(1).catch(['fallback']).parse([1, 2])).toEqual(['fallback']);
    expect(z.array(z.string()).min(2, 'lower').safeParse(['one']).error.issues[0]).toMatchObject({ code: 'too_small', message: 'lower' });
  });
  it('does not claim a global bound on an unbounded collection', () => {
    expect(z.array(z.string()).safeParse(Array(100).fill(1)).error.issues).toHaveLength(100);
  });
});
