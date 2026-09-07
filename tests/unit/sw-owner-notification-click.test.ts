import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('workbox-precaching', () => ({ precacheAndRoute: vi.fn(), cleanupOutdatedCaches: vi.fn() }));
vi.mock('workbox-routing', () => ({ registerRoute: vi.fn() }));
vi.mock('workbox-strategies', () => ({ CacheFirst: class {}, NetworkOnly: class {}, StaleWhileRevalidate: class {} }));
vi.mock('workbox-expiration', () => ({ ExpirationPlugin: class {} }));
vi.mock('workbox-cacheable-response', () => ({ CacheableResponsePlugin: class {} }));

const ORIGIN = 'https://cocotripkr.com';
const CONTROLLER = `${ORIGIN}/admin/ai-center`;

interface FakeClickEvent {
  notification: { data: { url: string }; close: () => void };
  waitUntil: (work: Promise<unknown>) => void;
}

function fakeWindow(url: string) {
  return { url, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
}

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

async function clickNotification(target: string, windows: ReturnType<typeof fakeWindow>[]) {
  const listeners = new Map<string, (event: FakeClickEvent) => void>();
  const clients = { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => null) };
  vi.stubGlobal('self', {
    __WB_MANIFEST: [], location: { origin: ORIGIN }, clients,
    addEventListener: (name: string, handler: (event: FakeClickEvent) => void) => listeners.set(name, handler),
  });
  await import('../../src/sw');
  const close = vi.fn();
  let completion: Promise<unknown> | undefined;
  const waitUntil = vi.fn((work: Promise<unknown>) => { completion = work; });
  const handler = listeners.get('notificationclick');
  expect(handler).toBeDefined();
  handler!({ notification: { data: { url: target }, close }, waitUntil });
  expect(waitUntil).toHaveBeenCalledOnce();
  expect(completion).toBeInstanceOf(Promise);
  await completion;
  return { clients, close };
}

describe('Service worker owner notification click routing', () => {
  it('focuses the controller without navigating either the draft screen or controller', async () => {
    const draft = fakeWindow(`${ORIGIN}/charter?draft=active`);
    const controller = fakeWindow(`${CONTROLLER}?period=all#ops-reservation`);
    const originalUrl = controller.url;
    const { clients, close } = await clickNotification('/admin/ai-center', [draft, controller]);
    expect(close).toHaveBeenCalledOnce();
    expect(clients.matchAll).toHaveBeenCalledOnce();
    expect(draft.focus).not.toHaveBeenCalled();
    expect(draft.navigate).not.toHaveBeenCalled();
    expect(controller.focus).toHaveBeenCalledOnce();
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(controller.url).toBe(originalUrl);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new controller instead of navigating an existing payment or other admin page', async () => {
    const payment = fakeWindow(`${ORIGIN}/my-plans?checkout=active`);
    const admin = fakeWindow(`${ORIGIN}/admin/calendar`);
    const { clients } = await clickNotification(CONTROLLER, [payment, admin]);
    expect(payment.focus).not.toHaveBeenCalled();
    expect(payment.navigate).not.toHaveBeenCalled();
    expect(admin.focus).not.toHaveBeenCalled();
    expect(admin.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(CONTROLLER);
  });

  it('keeps the existing first-window focus and navigate behavior for customer notifications', async () => {
    const customer = fakeWindow(`${ORIGIN}/tours`);
    const other = fakeWindow(`${ORIGIN}/charter`);
    const { clients } = await clickNotification('/my-plans?plan=synthetic', [customer, other]);
    expect(clients.matchAll).toHaveBeenCalledExactlyOnceWith({ type: 'window', includeUncontrolled: true });
    expect(customer.focus).toHaveBeenCalledOnce();
    expect(customer.navigate).toHaveBeenCalledExactlyOnceWith('/my-plans?plan=synthetic');
    expect(other.focus).not.toHaveBeenCalled();
    expect(other.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('preserves the next-window fallback when a customer window cannot be focused', async () => {
    const first = fakeWindow(`${ORIGIN}/tours`);
    first.focus.mockRejectedValue(new Error('closed window'));
    const second = fakeWindow(`${ORIGIN}/charter`);
    const { clients } = await clickNotification('/my-plans', [first, second]);
    expect(first.focus).toHaveBeenCalledOnce();
    expect(first.navigate).not.toHaveBeenCalled();
    expect(second.focus).toHaveBeenCalledOnce();
    expect(second.navigate).toHaveBeenCalledExactlyOnceWith('/my-plans');
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('preserves the original openWindow target for customer notifications without windows', async () => {
    const { clients } = await clickNotification('/my-plans?plan=synthetic', []);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith('/my-plans?plan=synthetic');
  });
});
