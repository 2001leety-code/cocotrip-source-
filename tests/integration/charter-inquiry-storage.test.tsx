import React from 'react';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { automaticallyAcknowledgeInquiry } from '../../api/_shared/inquiry-auto-ack.js';
import { hashIp } from '../../api/_shared/ip-rate-limit.js';
import type { WizardState } from '../../src/components/charter/types';

void React;

const EMULATOR_HOST = '127.0.0.1:18089';
const PROJECT_ID = 'demo-cocotrip-inquiry';
const telegramKeys = [
  'TELEGRAM_INQUIRY_BOT_TOKEN', 'INQUIRY_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_INQUIRY_CHAT_ID', 'INQUIRY_CHAT_ID', 'TELEGRAM_CHAT_ID',
];
const state = vi.hoisted(() => ({
  db: null as Firestore | null,
  captureError: vi.fn(async () => undefined),
  translate: vi.fn(async () => ({ sourceLang: 'en', isOriginal: true, translation: null })),
}));

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => state.db }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: state.captureError }));
vi.mock('../../api/_shared/translator.js', () => ({ detectAndTranslate: state.translate }));
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyFirebaseIdentityToken: vi.fn(async () => ({ ok: false, status: 401 })),
}));
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null } }));

const { default: importedHandler } = await import('../../api/inquiry-submit.js');
const { InquiryForm } = await import('../../src/components/charter/InquiryForm');
const handler = importedHandler as (request: unknown, response: unknown) => Promise<void>;

let app: ReturnType<typeof initializeApp>;
let db: ReturnType<typeof getFirestore>;
let server: Server;
let handlerBaseUrl = '';
let handlerRequestCount = 0;
let delayedHandler: { promise: Promise<void>; release: () => void } | null = null;
let browserIp = '';
let browserIpSequence = 80;
const createdInquiryIds: string[] = [];
const usedIps = new Set<string>();
const savedTelegramEnv = new Map<string, string | undefined>();
const nativeFetch = globalThis.fetch.bind(globalThis);

function validBusBody(index = 0) {
  return {
    name: `Guest ${index}`,
    email: `guest${index}@example.com`,
    eventDate: '2026-10-15',
    pax: 20,
    vehicle: 'bus',
    details: 'Airport group transfer',
    language: 'en',
  };
}

async function submit(body: Record<string, unknown>, ip: string) {
  usedIps.add(ip);
  const output = { status: 0, headers: {} as Record<string, string>, body: '' };
  const req = {
    method: 'POST',
    body,
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
  };
  const res = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      output.status = status;
      output.headers = headers;
    },
    end(bodyText = '') { output.body = bodyText; },
  };
  await handler(req, res);
  const json = JSON.parse(output.body || '{}');
  if (json.inquiryId) createdInquiryIds.push(json.inquiryId);
  return { ...output, json };
}

function inquiryFormState(): WizardState {
  return {
    customerName: 'Guest UI',
    startDate: '2026-10-15',
    paxCount: 20,
    notes: 'Airport group transfer',
  } as WizardState;
}

function renderInquiryForm() {
  return render(<InquiryForm vehicle="bus" state={inquiryFormState()} language="en" />);
}

function fillInquiryEmail(container: HTMLElement, email = 'ui-guest@example.com') {
  const input = container.querySelector('input[type="email"]') as HTMLInputElement | null;
  if (!input) throw new Error('Inquiry email input not found');
  fireEvent.change(input, { target: { value: email } });
}

function createDeferredHandler() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function withFailedInquiryCreate(realDb: Firestore): Firestore {
  const boundary = {
    collection(name: string) {
      const collection = realDb.collection(name);
      if (name !== 'charter_inquiries') return collection;
      return {
        doc(id: string) {
          const ref = collection.doc(id);
          return {
            ...ref,
            create: async () => {
              throw new Error('synthetic Firestore write failure');
            },
          };
        },
      };
    },
    runTransaction: realDb.runTransaction.bind(realDb),
  };
  return boundary as unknown as Firestore;
}

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== EMULATOR_HOST
    || process.env.GCLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`Local inquiry integration requires FIRESTORE_EMULATOR_HOST=${EMULATOR_HOST} and GCLOUD_PROJECT=${PROJECT_ID}`);
  }
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'FIREBASE_PRIVATE_KEY']) {
    if (process.env[key]) throw new Error(`Local inquiry integration refuses credential environment variable: ${key}`);
  }
  for (const key of telegramKeys) savedTelegramEnv.set(key, process.env[key]);
  app = initializeApp({ projectId: PROJECT_ID }, 'charter-inquiry-local-integration');
  db = getFirestore(app);
  state.db = db;
  server = createServer(async (request, response) => {
    handlerRequestCount += 1;
    request.headers['x-forwarded-for'] = browserIp;
    usedIps.add(browserIp);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    (request as typeof request & { body?: string }).body = Buffer.concat(chunks).toString('utf8');
    const responseWithBody = response as unknown as {
      end: (chunk?: unknown, ...args: unknown[]) => unknown;
    };
    const originalEnd = responseWithBody.end.bind(response);
    responseWithBody.end = (chunk?: unknown, ...args: unknown[]) => {
      const body = typeof chunk === 'string' ? chunk : Buffer.from(chunk || []).toString('utf8');
      try {
        const json = JSON.parse(body);
        if (json.inquiryId) createdInquiryIds.push(json.inquiryId);
      } catch { /* handler response parsing is asserted by the browser caller */ }
      return originalEnd(chunk, ...args);
    };
    const delay = delayedHandler;
    delayedHandler = null;
    if (delay) await delay.promise;
    await handler(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  handlerBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  state.db = db;
  state.captureError.mockClear();
  state.translate.mockClear();
  handlerRequestCount = 0;
  delayedHandler = null;
  browserIpSequence += 1;
  browserIp = `198.51.100.${browserIpSequence}`;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof URL ? input.toString() : String(input);
    if (target !== '/api/inquiry-submit') throw new Error(`Unexpected browser fetch target: ${target}`);
    return nativeFetch(`${handlerBaseUrl}${target}`, init);
  });
  for (const key of telegramKeys) delete process.env[key];
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(createdInquiryIds.splice(0).map(async (id) => {
    await db.collection('charter_inquiries').doc(id).delete();
  }));
  await Promise.all([...usedIps].map(async (ip) => {
    await db.collection('inquiry_rate_limits').doc(hashIp(ip)).delete();
  }));
  usedIps.clear();
  for (const key of telegramKeys) delete process.env[key];
  cleanup();
});

afterAll(async () => {
  for (const [key, value] of savedTelegramEnv) {
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  }
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await deleteApp(app);
});

describe('guest bus inquiry storage through the local Firestore emulator', () => {
  it('stores a valid guest bus inquiry and blocks the actual automatic acknowledgement sender', async () => {
    const result = await submit(validBusBody(1), '198.51.100.21');

    expect(result).toMatchObject({ status: 200, json: { success: true, status: 'NEW' } });
    const stored = await db.collection('charter_inquiries').doc(result.json.inquiryId).get();
    expect(stored.data()).toMatchObject({
      vehicle: 'bus',
      source: 'charter_wizard',
      status: 'NEW',
      submissionProvenance: 'api:inquiry-submit.v1',
      rateLimitVerifiedForAutoAck: true,
      recipientVerifiedForAutoAck: false,
      autoAckCandidate: false,
    });

    const send = vi.fn();
    const acknowledgement = await automaticallyAcknowledgeInquiry(db, result.json.inquiryId, {
      gateEnabled: true,
      now: Date.now(),
      activationAtMs: Date.now() - 60_000,
      maxAgeMs: 60 * 60 * 1000,
      dailyCap: 10,
      send,
    });
    expect(acknowledgement.code).toBe('AUTO_ACK_NOT_CANDIDATE');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects required fields before rate storage and returns a stored-write failure without a document', async () => {
    const ip = '198.51.100.22';
    const invalid = await submit({ ...validBusBody(2), name: '' }, ip);
    expect(invalid).toMatchObject({ status: 400, json: { code: 'INVALID_NAME' } });
    expect((await db.collection('inquiry_rate_limits').doc(hashIp(ip)).get()).exists).toBe(false);

    state.db = withFailedInquiryCreate(db);
    const failed = await submit(validBusBody(2), ip);
    expect(failed).toMatchObject({ status: 500, json: { code: 'INTERNAL_ERROR' } });
    expect(state.captureError).toHaveBeenCalledOnce();
    expect(createdInquiryIds).toHaveLength(0);
  });

  it('rejects an all-whitespace required event date before rate storage', async () => {
    const ip = '198.51.100.27';
    const result = await submit({ ...validBusBody(27), eventDate: '   ' }, ip);

    expect(result).toMatchObject({ status: 400, json: { code: 'INVALID_DATE' } });
    expect((await db.collection('inquiry_rate_limits').doc(hashIp(ip)).get()).exists).toBe(false);
  });

  it('keeps a saved inquiry successful when the isolated Telegram boundary fails', async () => {
    process.env.TELEGRAM_INQUIRY_BOT_TOKEN = 'local-test-token';
    process.env.TELEGRAM_INQUIRY_CHAT_ID = 'local-test-chat';
    const fetchMock = vi.fn(async () => { throw new Error('synthetic Telegram outage'); });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submit(validBusBody(3), '198.51.100.23');
    expect(result).toMatchObject({ status: 200, json: { success: true } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await db.collection('charter_inquiries').doc(result.json.inquiryId).get()).exists).toBe(true);
  });

  it('retries a real Firestore already-exists collision without overwriting the existing inquiry', async () => {
    const now = new Date();
    const id = `INQ-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-1000`;
    await db.collection('charter_inquiries').doc(id).create({ sentinel: 'keep' });
    createdInquiryIds.push(id);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.1);

    const result = await submit(validBusBody(4), '198.51.100.24');
    expect(result).toMatchObject({ status: 200, json: { success: true } });
    expect(result.json.inquiryId).not.toBe(id);
    expect((await db.collection('charter_inquiries').doc(id).get()).data()).toMatchObject({ sentinel: 'keep' });
  });

  it('enforces the real per-IP cap for both sequential and concurrent guest submissions', async () => {
    const serialIp = '198.51.100.25';
    const serial = [];
    for (let index = 0; index < 5; index += 1) serial.push(await submit(validBusBody(index + 10), serialIp));
    expect(serial.every((result) => result.status === 200)).toBe(true);
    const capped = await submit(validBusBody(20), serialIp);
    expect(capped).toMatchObject({ status: 429, json: { code: 'RATE_LIMITED' } });
    expect(capped.headers['Retry-After']).toMatch(/^\d+$/);

    const parallelIp = '198.51.100.26';
    const concurrent = await Promise.all(Array.from({ length: 7 }, (_, index) => submit(validBusBody(index + 30), parallelIp)));
    expect(concurrent.filter((result) => result.status === 200)).toHaveLength(5);
    expect(concurrent.filter((result) => result.status === 429)).toHaveLength(2);
  });
});

describe('guest bus inquiry form through authFetch and the local handler', () => {
  it('shows the actual success state after the browser form reaches the handler and emulator', async () => {
    const view = renderInquiryForm();
    fillInquiryEmail(view.container);
    fireEvent.click(screen.getByRole('button', { name: 'Submit Inquiry' }));

    await screen.findByText('We will respond shortly');
    expect(handlerRequestCount).toBe(1);
    expect(createdInquiryIds).toHaveLength(1);
    expect((await db.collection('charter_inquiries').doc(createdInquiryIds[0]).get()).exists).toBe(true);
  });

  it('keeps the browser submit disabled when a required guest field is missing', () => {
    const view = renderInquiryForm();
    const name = view.container.querySelector('input[type="text"]') as HTMLInputElement | null;
    if (!name) throw new Error('Inquiry name input not found');
    fireEvent.change(name, { target: { value: '' } });
    fillInquiryEmail(view.container);

    const submitButton = screen.getByRole('button', { name: 'Submit Inquiry' });
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);
    expect(handlerRequestCount).toBe(0);
  });

  it('shows the handler storage failure in the real form without a successful document', async () => {
    state.db = withFailedInquiryCreate(db);
    const view = renderInquiryForm();
    fillInquiryEmail(view.container, 'failed-ui@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Submit Inquiry' }));

    expect(await screen.findByText(/Submission failed\. Please try again\. \(HTTP 500\)/)).toBeTruthy();
    expect(state.captureError).toHaveBeenCalledOnce();
    expect(createdInquiryIds).toHaveLength(0);
  });

  it('sends one request while the real form is waiting for a delayed handler response', async () => {
    const delay = createDeferredHandler();
    delayedHandler = delay;
    const view = renderInquiryForm();
    fillInquiryEmail(view.container, 'pending-ui@example.com');
    const submitButton = screen.getByRole('button', { name: 'Submit Inquiry' });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => expect(handlerRequestCount).toBe(1));
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    delay.release();
    await screen.findByText('We will respond shortly');
    expect(createdInquiryIds).toHaveLength(1);
  });
});
