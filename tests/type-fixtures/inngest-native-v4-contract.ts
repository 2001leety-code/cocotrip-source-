// Compile-only. Never executed: this fixture makes no API requests.
import { Inngest, NonRetriableError, eventType, staticSchema } from 'inngest';
import type { FunctionConfig, IncomingOp } from '../../node_modules/inngest/types.js';
import type { z } from 'zod/v4';
import { record } from '../../node_modules/inngest/_cocotrip-zod-v4.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type IncomingId = Expect<Equal<IncomingOp['id'], string>>;
export type Runtime = Expect<Equal<FunctionConfig['steps'][string]['runtime'], { type: 'http' | 'ws'; url: string }>>;
type NumericRecord = ReturnType<typeof record<z.ZodNumber>>;
export type RecordOutput = Expect<Equal<z.output<NumericRecord>, Record<string, number>>>;
// The prevalidation pipeline accurately exposes unknown input; it does not imply unchecked output.
export type RecordInput = Expect<Equal<z.input<NumericRecord>, unknown>>;

const validOperation: IncomingOp = { id: 'persist-plan', data: { planId: 'server-plan' } };
// @ts-expect-error IncomingOp requires its string ID.
const invalidOperation: IncomingOp = { id: 1 };
const validRuntime: FunctionConfig['steps'][string]['runtime'] = { type: 'http', url: 'https://offline.invalid' };
// @ts-expect-error SDK function step runtime discriminant remains constrained.
const invalidRuntime: FunctionConfig['steps'][string]['runtime'] = { type: 'arbitrary', url: 'https://offline.invalid' };

const work = eventType('plan/ai.complete', { schema: staticSchema<{ planId: string; orderId: string }>() });
const client = new Inngest({ id: 'compile-only' });
void client.send(work.create({ planId: 'server-plan', orderId: 'server-order' }));
// @ts-expect-error The typed event still rejects a numeric planId.
void client.send(work.create({ planId: 1, orderId: 'server-order' }));
// @ts-expect-error Event names remain strings.
void client.send({ name: 42 });

client.createFunction({ id: 'compile-only-worker', triggers: [work], retries: 2 }, async ({ event, step }) => {
  const planId: string = event.data.planId;
  // @ts-expect-error Handler event data retains the trigger's schema.
  const wrongPlanId: number = event.data.planId;
  const persisted = await step.run('persist-plan', async () => ({ planId, committed: true }));
  const resultId: string = persisted.planId;
  // @ts-expect-error Step output does not become any through the migrated schema declarations.
  const wrongResult: string = persisted.committed;
  const refusal: Error = new NonRetriableError('compile-only refusal');
  return { planId: resultId, validOperation, invalidOperation, validRuntime, invalidRuntime, wrongPlanId, wrongResult, refusal: refusal.name };
});
