import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { deserialize } from 'node:v8';
import registryBaseline from '../fixtures/sdk-security/registry-inngest-4.24.0-zod-3.25.76.json';

const require = createRequire(import.meta.url);
const nativeRoot = dirname(require.resolve('inngest'));
const adapter = await import(join(nativeRoot, '_cocotrip-zod-v4.js'));
const cjsAdapter = require(join(nativeRoot, '_cocotrip-zod-v4.cjs'));
const relativeFiles = ['api/schema.js', 'components/execution/streaming.js', 'components/InngestStepTools.js',
  'components/sandbox/protocol.js', 'components/sandbox/validation.js', 'helpers/functions.js', 'types.js'];
const nativeJsonError = (await import(join(nativeRoot, 'types.js'))).jsonErrorSchema;

const sites: { id: string; expression: string }[] = [];
for (const file of relativeFiles) {
  const text = readFileSync(join(nativeRoot, file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(ast) === 'z' && node.expression.name.text === 'record' && node.arguments.length === 1) {
      sites.push({ id: `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`, expression: node.arguments[0].getText(ast) });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
expect(sites).toHaveLength(15);

// Evaluate only the exact schema factory expressions from the pinned, trusted installed SDK.
// No request/user strings enter this function. This is a test of original factory semantics.
function valueSchema(expression: string, z, jsonErrorSchema) {
  return new Function('z', 'jsonErrorSchema', `return (${expression});`)(z, jsonErrorSchema);
}
const inputs = [undefined, null, [], new Map(), {}, { key: 'text' }, { key: 1 }, { key: false },
  { key: null }, { key: undefined }, { 0: 'text' }, { key: { abortable: true } }, { key: { abortable: 'bad' } },
  { key: { type: 'data', data: 0 } }, { key: { type: 'input', input: false } },
  { key: { type: 'error', error: { name: 'Error', message: 'fixture' } } },
  { key: { id: 's', name: 'step', runtime: { type: 'http', url: 'https://offline.invalid' } } },
  { key: { id: 's', name: 1, runtime: { type: 'invalid', url: 'https://offline.invalid' } } },
  { key: { unknown: true } }, JSON.parse('{"__proto__":{"polluted":true},"constructor":"value"}'),
  { [Symbol('ignored')]: 'text' }, Object.assign(Object.create(null), { key: 'text' }),
];
const restore = Object.getPrototypeOf({});
afterAll(() => expect(Object.getPrototypeOf({})).toBe(restore));

describe.each(sites)('record value semantics: $id', ({ id, expression }) => {
  const baselineSite = registryBaseline.sites.find((site) => site.id === id)!;
  expect(expression).toBe(baselineSite.expression);
  const newValue = valueSchema(expression, adapter.z, nativeJsonError);
  const newRecord = adapter.record(newValue);

  it('uses string keys and the actual first argument as the value validator', () => {
    expect(newRecord.keyType._def.type).toBe('string');
    expect(newRecord.valueType).toBe(newValue);
  });

  it.each(inputs.map((input, index) => [index, input]))('preserves acceptance and parsed value for boundary input %i', (_index, input) => {
    const baseline = baselineSite.results[_index];
    const native = newRecord.safeParse(input);
    if (_index === 19 || _index === 20) {
      // Explicit security tightening: own reserved keys and non-JSON symbol keys.
      expect(native.success).toBe(false);
    } else expect(native.success).toBe(baseline.success);
    if (baseline.success && native.success) expect(native.data).toEqual(deserialize(Buffer.from(baseline.data!, 'base64')));
  });

  it.each([['ESM', adapter], ['CJS', cjsAdapter]])('rejects own reserved keys before parsing values in %s sync and async', async (_format, sdkAdapter) => {
    let calls = 0;
    const record = sdkAdapter.record(sdkAdapter.z.unknown().transform((value) => { calls++; return value; }));
    const own = JSON.parse('{"__proto__":"previously-valid"}');
    expect(record.safeParse(own).success).toBe(false);
    expect((await record.safeParseAsync(own)).success).toBe(false);
    expect(calls).toBe(0);
    for (const input of [{}, { constructor: 'ordinary', prototype: 'ordinary' }, Object.create({ inherited: true })]) {
      expect(record.safeParse(input).success).toBe(true);
      expect((await record.safeParseAsync(input)).success).toBe(true);
    }
  });
});

it('wires every original record site through the SDK-local adapter in both module formats', () => {
  for (const file of relativeFiles) {
    for (const ext of ['js', 'cjs']) {
      const source = readFileSync(join(nativeRoot, file.replace(/\.js$/, `.${ext}`)), 'utf8');
      expect(source).toContain(`_cocotrip-zod-v4.${ext}`);
      expect(source).not.toContain('zod/v3');
      const originalCount = sites.filter((site) => site.id.startsWith(`${file}:`)).length;
      expect((source.match(/z\.record\(/g) || []).length).toBe(originalCount);
    }
  }
});

it.each(['js', 'cjs'])('preserves realtime ping missing, undefined and null values in %s', async (ext) => {
  const nextRealtime = ext === 'js' ? await import(join(nativeRoot, 'components/realtime/types.js')) : require(join(nativeRoot, 'components/realtime/types.cjs'));
  for (const fixture of registryBaseline.realtime) {
    expect(nextRealtime.Realtime.messageSchema.parse(deserialize(Buffer.from(fixture.input, 'base64')))).toEqual(deserialize(Buffer.from(fixture.output, 'base64')));
  }
});

it.each([['js', adapter], ['cjs', cjsAdapter]])('retains the actual Remix two-argument env record factory in %s', async (extension, sdkAdapter) => {
  const source = readFileSync(join(nativeRoot, `remix.${extension}`), 'utf8');
  expect(source).toContain(`_cocotrip-zod-v4.${extension}`);
  const ast = ts.createSourceFile(`remix.${extension}`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const factories: ts.CallExpression[] = [];
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'record') factories.push(node);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  expect(factories).toHaveLength(1);
  expect(factories[0].arguments).toHaveLength(2);
  const expression = factories[0].getText(ast).replaceAll('zod_v3.z', 'z');
  const envRecord = new Function('z', `return ${expression};`)(sdkAdapter.z);
  for (const input of [{}, { text: 'value', number: 42, object: { nested: true }, optional: undefined }, { constructor: 1, prototype: false }]) {
    expect(envRecord.parse(input)).toEqual(input);
    expect(await envRecord.parseAsync(input)).toEqual(input);
  }
  for (const input of [null, [], 1, JSON.parse('{"__proto__":{"invalid":true}}')]) {
    expect(envRecord.safeParse(input).success).toBe(false);
    expect((await envRecord.safeParseAsync(input)).success).toBe(false);
  }
  // The two-argument branch must also retain a restrictive value schema.
  expect(sdkAdapter.record(sdkAdapter.z.string(), sdkAdapter.z.number()).safeParse({ key: 'invalid' }).success).toBe(false);
});
