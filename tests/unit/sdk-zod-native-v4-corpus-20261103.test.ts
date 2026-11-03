import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deserialize } from 'node:v8';
import registryBaseline from '../fixtures/sdk-security/registry-inngest-4.24.0-zod-3.25.76.json';

const require = createRequire(import.meta.url);
const nativeRoot = dirname(require.resolve('inngest'));
const candidate = await import(pathToFileURL(join(nativeRoot, 'helpers/functions.js')).href);
const candidateSchemas = await import(pathToFileURL(join(nativeRoot, 'api/schema.js')).href);
const candidateTypes = await import(pathToFileURL(join(nativeRoot, 'types.js')).href);
const logger = { error: () => {}, warn: () => {}, debug: () => {} };
const good = { version: 2, event: { name: 'plan/ai.complete', data: { planId: 'server-plan' } },
  events: [{ name: 'plan/ai.complete', data: { planId: 'server-plan' } }], steps: {}, ctx: { run_id: 'offline-run' } };

describe('actual SDK worker schema corpus with native v4 runtime imports', () => {
  it.each([
    ['normal', good],
    ['default events and steps', { version: 2, event: good.event }],
    ['default version', { event: good.event }],
    ['version one', { ...good, version: 1 }],
    ['null context', { ...good, ctx: null }],
    ['empty valid records', { ...good, event: {}, events: [{}], ctx: { run_id: 'r', stack: null } }],
    ['context and step defaults', { ...good, steps: { first: { data: 123 } }, ctx: { run_id: 'r', stack: { stack: null, current: 0 } } }],
    ['record input and error variants', { ...good, steps: { first: { type: 'input', input: null }, second: { type: 'error', error: { name: 'Error', message: 'offline', code: 'X' } } } }],
    ['additional protocol fields', { ...good, ctx: { ...good.ctx, attempt: 1, max_attempts: 3, use_api: false, qi_id: 'q', unknown: true }, unknown: true }],
    ['defers', { ...good, defers: { op1: { abortable: true }, op2: {} } }],
  ])('retains accepted output: %s', (_name, body) => {
    const baseline = deserialize(Buffer.from(registryBaseline.corpus.worker[_name], 'base64'));
    expect(candidate.parseFnData(body, undefined, logger)).toEqual(baseline);
  });

  it.each([
    ['null body', null], ['array body', []], ['missing event', { version: 2 }],
    ['event null', { ...good, event: null }], ['event array', { ...good, event: [] }],
    ['bad event batch', { ...good, events: [null] }], ['events object', { ...good, events: {} }],
    ['bad version', { ...good, version: 9 }], ['retired version', { ...good, version: 0 }],
    ['bad context run ID', { ...good, ctx: { run_id: 10 } }],
    ['bad attempt', { ...good, ctx: { run_id: 'r', attempt: 'one' } }],
    ['bad stack', { ...good, ctx: { run_id: 'r', stack: { stack: [1], current: 0 } } }],
    ['bad defers', { ...good, defers: { op1: { abortable: 'yes' } } }],
  ])('does not accept a registry-invalid worker payload: %s', (_name, body) => {
    expect(() => candidate.parseFnData(body, undefined, logger)).toThrow();
  });

  it.each([
    ['empty batch', []], ['event batch', [{ name: 'a', data: { day: 1 } }]],
    ['step-data', { a: { data: null } }], ['step-input', { a: { type: 'input', input: false } }],
    ['step-error', { a: { type: 'error', error: { name: 'Error', message: 'nope' } } }],
  ])('retains API hydration schema output: %s', (name, input) => {
    const key = name.includes('batch') ? 'batchSchema' : 'stepSchema';
    expect(candidateSchemas[key].parse(input)).toEqual(deserialize(Buffer.from(registryBaseline.corpus.hydration[name], 'base64')));
  });

  it.each([
    { name: 'Error', message: 'transient', code: 'OFFLINE', stack: 'fixed', cause: { name: 'Error', message: 'cause' } },
    { name: 'NonRetriableError', message: 'refusal', details: ['day one'], retryAfter: '1m' },
    { error: 'legacy error', message: 'legacy message' },
  ].map((input, index) => [input, index]))('retains SDK error serialization schema input/output', (input, index) => {
    expect(candidateTypes.jsonErrorSchema.parse(input)).toEqual(deserialize(Buffer.from(registryBaseline.corpus.errors[index], 'base64')));
  });

  it('proves the migrated SDK resolves native v4 and executes early bound checks', () => {
    const sdkRequire = createRequire(join(nativeRoot, 'index.js'));
    expect(sdkRequire.resolve('zod/v4')).toBe(require.resolve('zod/v4'));
    const { z } = sdkRequire('zod/v4');
    let visits = 0;
    const checked = z.array(z.number().refine(() => { visits++; return false; })).max(1).safeParse(Array(100).fill(1));
    expect(visits).toBe(0); expect(checked.error.issues).toHaveLength(1);
  });
});
