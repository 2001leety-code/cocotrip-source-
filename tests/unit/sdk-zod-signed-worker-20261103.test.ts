import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Inngest, NonRetriableError } from 'inngest';
import { memoryDb } from './helpers/payment-recovery-fixture';
import { claimPlanIssuance, beginPlanCommit, finalizePlanIssuance } from '../../api/_shared/plan-issuance.js';
import { inspectNativeSdk } from '../../scripts/security/inngest-native-v4.mjs';

const require = createRequire(import.meta.url);
const sdkRoot = dirname(require.resolve('inngest'));
const { InngestCommHandler } = await import(pathToFileURL(join(sdkRoot, 'components/InngestCommHandler.js')).href);
const { signDataWithKey } = await import(pathToFileURL(join(sdkRoot, 'helpers/net.js')).href);
let active = { Inngest, NonRetriableError, Handler: InngestCommHandler, sign: signDataWithKey };
const signingKey = `signkey-test-${'a'.repeat(64)}`; // Deliberately fake, local fixture only.
const outbound = vi.fn(async () => { throw new Error('External SDK calls forbidden'); });

beforeEach(() => {
  outbound.mockClear();
  vi.stubGlobal('fetch', outbound);
  expect(inspectNativeSdk(process.cwd()).applied).toBe(true);
});

function fixture(run = vi.fn(async () => ({ planId: 'server-plan' }))) {
  const client = new active.Inngest({ id: 'security-probe', isDev: false, signingKey, fetch: outbound });
  const fn = client.createFunction({ id: 'work', triggers: [{ event: 'probe/work' }], retries: 2 }, run);
  const handler = new active.Handler({ frameworkName: 'offline-probe', client, functions: [fn], handler: (request) => ({
    body: () => request.body,
    headers: (name) => request.headers[name],
    method: () => 'POST',
    url: () => new URL('https://offline.invalid/api/inngest?fnId=security-probe-work&stepId=step'),
    transformResponse: (response) => response,
  }) }).createHandler();
  const event = { name: 'probe/work', data: { planId: 'server-plan' }, id: 'probe-event', ts: Date.now() };
  const body = { version: 2, event, events: [event], steps: {}, ctx: { run_id: 'probe-run', attempt: 0, use_api: false } };
  async function call(payload = body, options: { signatureBody?: unknown; signature?: string; timestamp?: number } = {}) {
    const timestamp = String(options.timestamp || Math.round(Date.now() / 1000));
    const signature = options.signature !== undefined ? options.signature
      : `t=${timestamp}&s=${await active.sign(options.signatureBody || payload, signingKey, timestamp, console)}`;
    return handler({ body: payload, headers: { 'x-inngest-signature': signature, 'x-inngest-req-version': '2' } });
  }
  return { body, call, run };
}

describe.each([
  ['installed native v4 SDK', { Inngest, NonRetriableError, Handler: InngestCommHandler, sign: signDataWithKey }],
])('actual cloud-mode SDK: %s', (_name, implementation) => {
  beforeEach(() => { active = implementation; });
  it('accepts an authentic signature and retains the successful worker response', async () => {
    const f = fixture(); const reply = await f.call();
    expect(reply.status).toBe(200); expect(JSON.parse(reply.body)).toEqual({ planId: 'server-plan' });
    expect(f.run).toHaveBeenCalledOnce(); expect(outbound).not.toHaveBeenCalled();
  });

  it.each(['', 't=1&s=invalid'])('rejects missing/invalid signature %j before worker execution', async (signature) => {
    const f = fixture(); const reply = await f.call(f.body, { signature });
    expect(reply.status).toBe(401); expect(f.run).not.toHaveBeenCalled(); expect(outbound).not.toHaveBeenCalled();
  });

  it('rejects expired signatures and a body changed after signing', async () => {
    const f = fixture();
    expect((await f.call(f.body, { timestamp: Math.round(Date.now() / 1000) - 7200 })).status).toBe(401);
    expect((await f.call({ ...f.body, events: [] }, { signatureBody: f.body })).status).toBe(401);
    expect(f.run).not.toHaveBeenCalled(); expect(outbound).not.toHaveBeenCalled();
  });

  it('keeps malformed signed input rejected without running the worker', async () => {
    const f = fixture();
    const reply = await f.call({ ...f.body, events: [null] } as never);
    expect(reply.status).toBe(500); expect(f.run).not.toHaveBeenCalled(); expect(outbound).not.toHaveBeenCalled();
    expect(reply.body).toContain('Error');
  });

  it.each([
    ['transient', 'false', 500],
    ['nonretriable', 'true', 400],
  ])('preserves retry signaling for %s', async (kind, noRetry, status) => {
    const error = kind === 'nonretriable' ? new active.NonRetriableError('offline deterministic refusal') : new Error('offline transient failure');
    const f = fixture(vi.fn(async () => { throw error; }));
    const reply = await f.call();
    expect(reply.status).toBe(status); expect(reply.headers['x-inngest-no-retry']).toBe(noRetry);
    expect(f.run).toHaveBeenCalledOnce(); expect(outbound).not.toHaveBeenCalled();
  });

  it('retains issuance fencing across duplicate signed worker invocations', async () => {
    const store = memoryDb();
    const run = vi.fn(async () => {
      const reservation = await claimPlanIssuance(store.db, 'OFFLINE-SDK-ORDER', { uid: 'fixture-owner' });
      if (!reservation.claim) return { code: reservation.code };
      const claim = reservation.claim;
      expect((await beginPlanCommit(store.db, claim)).ok).toBe(true);
      await store.db.collection('plans').doc(claim.planId).set({ planId: claim.planId, status: 'ready', input: { paypalOrderId: claim.orderId } });
      expect((await finalizePlanIssuance(store.db, claim)).ok).toBe(true);
      return { planId: claim.planId };
    });
    const f = fixture(run);
    const first = await f.call(); const second = await f.call();
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(JSON.parse(first.body).planId).toBeTruthy();
    expect(JSON.parse(second.body).code).toBe('DUPLICATE_ORDER');
    expect([...store.rows.keys()].filter((key) => key.startsWith('plans/'))).toHaveLength(1);
    expect(outbound).not.toHaveBeenCalled();
  });
});
