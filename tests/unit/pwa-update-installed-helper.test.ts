import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_UPDATE_IDLE_MS,
  INITIAL_UPDATE_STATE,
  UPDATE_REQUEST_TIMEOUT_MS,
  createPwaUpdateGuard,
  type PwaUpdateState,
} from '@/lib/pwaUpdateGuard';

const helperPath = resolve(process.cwd(), 'node_modules/vite-plugin-pwa/dist/client/build/react.js');
const original = readFileSync(helperPath, 'utf8');
const reactImport = 'import { useState } from "react";';
const workboxImport = 'import("workbox-window")';
const helperExport = /export\s*\{\s*useRegisterSW\s*\};\s*$/;

type UpdateFunction = (reloadPage?: boolean) => Promise<void>;
interface RegisterOptions {
  onNeedReload?: () => void;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: () => void;
}
interface InstalledApi {
  useRegisterSW: (options: RegisterOptions) => { updateServiceWorker: UpdateFunction };
}
type WorkerEvent = { isUpdate?: boolean; isExternal?: boolean };

async function installedFixture({ automatic = false, guardEnabled = true } = {}) {
  // Fail visibly if dependency module boundaries change; never substitute a recreated helper.
  expect(original.split(reactImport)).toHaveLength(2);
  expect(original.split(workboxImport)).toHaveLength(2);
  expect(original).toMatch(helperExport);
  const executable = original
    .replace(reactImport, 'const { useState } = ReactBoundary;')
    .replace(workboxImport, 'Promise.resolve({ Workbox: FakeWorkbox })')
    .replace(helperExport, 'globalThis.installedApi = { useRegisterSW };');

  const environment = { editable: false, payment: false, visible: true };
  const reload = vi.fn();
  const directHelperReload = vi.fn();
  const network = vi.fn(() => { throw new Error('Unexpected network access in installed-helper test'); });
  const refreshNotice = vi.fn();
  const offlineReady = vi.fn();
  let state: PwaUpdateState = { ...INITIAL_UPDATE_STATE };
  const guard = createPwaUpdateGuard({
    now: () => Date.now(), editable: () => environment.editable,
    payment: () => environment.payment, visible: () => environment.visible,
    reload, publish: (next) => { state = next; },
    schedule(callback, delay) {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
  });
  guard.mount();

  const workers: FakeWorkbox[] = [];
  class FakeWorkbox {
    listeners = new Map<string, Array<(event: WorkerEvent) => void>>();
    register = vi.fn(async () => ({ scope: 'https://example.invalid/' }));
    messageSkipWaiting = vi.fn();
    constructor() { workers.push(this); }
    addEventListener(type: string, listener: (event: WorkerEvent) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }
    emit(type: string, event: WorkerEvent = {}) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
  }

  // Only the React state boundary is fake. Both useRegisterSW and registerSW execute unchanged.
  const reactStates: unknown[] = [];
  const sandbox: {
    ReactBoundary: { useState: (initial: unknown) => unknown[] };
    FakeWorkbox: typeof FakeWorkbox;
    navigator: { serviceWorker: object };
    window: { location: { reload: typeof directHelperReload } };
    fetch: typeof network;
    installedApi?: InstalledApi;
  } = {
    ReactBoundary: {
      useState(initial) {
        const index = reactStates.length;
        const value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        reactStates.push(value);
        return [value, (next: unknown) => { reactStates[index] = next; }];
      },
    },
    FakeWorkbox, navigator: { serviceWorker: {} },
    window: { location: { reload: directHelperReload } }, fetch: network,
  };
  vm.runInNewContext(executable, sandbox, { filename: helperPath, timeout: 1000 });
  expect(sandbox.installedApi).toBeDefined();

  let resolveRegistration: () => void = () => {};
  const registered = new Promise<void>((resolveRegistrationPromise) => { resolveRegistration = resolveRegistrationPromise; });
  const { updateServiceWorker: update } = sandbox.installedApi!.useRegisterSW({
    onNeedReload: guardEnabled ? guard.onNeedReload : undefined,
    onNeedRefresh() {
      refreshNotice();
      if (automatic) guard.scheduleAutomatic(update);
    },
    onOfflineReady: offlineReady,
    onRegistered: resolveRegistration,
  });
  await registered;
  const worker = workers[0];
  if (!worker) throw new Error('Installed helper did not create the fake Workbox boundary');
  expect(worker.register).toHaveBeenCalledExactlyOnceWith({ immediate: true });
  expect(network).not.toHaveBeenCalled();

  return {
    guard, environment, worker, update, reload, directHelperReload, refreshNotice, offlineReady, network,
    get state() { return state; },
    get needRefresh() { return reactStates[0]; },
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Installed vite-plugin-pwa React/register helper with the live reload guard', () => {
  it('reproduces the dependency default reload without an override as a real-source control', async () => {
    const fixture = await installedFixture({ guardEnabled: false });
    fixture.worker.emit('waiting', { isExternal: true });
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    expect(fixture.needRefresh).toBe(true);
    expect(fixture.refreshNotice).toHaveBeenCalledOnce();
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).toHaveBeenCalledOnce();
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.network).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'installed'] as const)('routes external %s/controlling through the supplied guard, with no local request', async (event) => {
    const fixture = await installedFixture();
    fixture.environment.editable = true;
    fixture.worker.emit(event, { isExternal: true });
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    expect(fixture.needRefresh).toBe(true);
    expect(fixture.state).toMatchObject({ deferred: true, ready: true, reloaded: false, reason: 'editing' });
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it('does not treat first installation/offline readiness as an update', async () => {
    const fixture = await installedFixture({ automatic: true });
    fixture.worker.emit('installed', { isUpdate: false, isExternal: false });
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_MS);
    expect(fixture.offlineReady).toHaveBeenCalledOnce();
    expect(fixture.needRefresh).toBe(false);
    expect(fixture.refreshNotice).not.toHaveBeenCalled();
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it('requests automatic activation only after 1200ms and reloads once only after controlling', async () => {
    const fixture = await installedFixture({ automatic: true });
    fixture.worker.emit('waiting');
    await vi.advanceTimersByTimeAsync(1199);
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(AUTO_UPDATE_IDLE_MS).toBe(1200);
    expect(fixture.worker.messageSkipWaiting).toHaveBeenCalledOnce();
    expect(fixture.state.busy).toBe(true);
    expect(fixture.reload).not.toHaveBeenCalled();
    fixture.worker.emit('controlling', { isUpdate: true });
    expect(fixture.reload).toHaveBeenCalledOnce();
    fixture.worker.emit('waiting');
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    fixture.worker.emit('controlling', { isUpdate: true });
    expect(fixture.reload).toHaveBeenCalledOnce();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
    expect(fixture.state.reloaded).toBe(true);
  });

  it.each(['editable', 'payment'] as const)('blocks automatic activation if %s begins during the 1200ms idle period', async (block) => {
    const fixture = await installedFixture({ automatic: true });
    fixture.worker.emit('waiting');
    await vi.advanceTimersByTimeAsync(600);
    fixture.environment[block] = true;
    if (block === 'editable') fixture.guard.markInteraction();
    await vi.advanceTimersByTimeAsync(600);
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    expect(fixture.state).toMatchObject({ deferred: true, busy: false, reason: block === 'editable' ? 'editing' : 'payment' });
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    expect(fixture.state.ready).toBe(true);
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it.each(['editable', 'payment'] as const)('rechecks %s after automatic skip-waiting, immediately before controlling', async (block) => {
    const fixture = await installedFixture({ automatic: true });
    fixture.worker.emit('waiting');
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_MS);
    expect(fixture.worker.messageSkipWaiting).toHaveBeenCalledOnce();
    fixture.environment[block] = true;
    fixture.worker.emit('controlling', { isUpdate: true });
    expect(fixture.state).toMatchObject({ deferred: true, busy: false, ready: true, reloaded: false, reason: block === 'editable' ? 'editing' : 'payment' });
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it.each(['editable', 'payment', 'interaction'] as const)('does not let a manual activation request authorize reload after new %s', async (block) => {
    const fixture = await installedFixture();
    fixture.worker.emit('waiting');
    await fixture.guard.requestManual(fixture.update);
    expect(fixture.worker.messageSkipWaiting).toHaveBeenCalledOnce();
    if (block === 'interaction') fixture.guard.markInteraction();
    else fixture.environment[block] = true;
    fixture.worker.emit('controlling', { isUpdate: true });
    expect(fixture.state).toMatchObject({ deferred: true, busy: false, ready: true, reloaded: false, reason: block === 'editable' ? 'editing' : block });
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it('lets an explicit safe manual action reload an already active update, without another skip-waiting request', async () => {
    const fixture = await installedFixture();
    fixture.worker.emit('waiting', { isExternal: true });
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    expect(fixture.state).toMatchObject({ ready: true, deferred: true, reloaded: false });
    fixture.guard.markInteraction();
    await fixture.guard.requestManual(fixture.update);
    expect(fixture.reload).toHaveBeenCalledOnce();
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    await fixture.guard.requestManual(fixture.update);
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    expect(fixture.reload).toHaveBeenCalledOnce();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it.each(['editable', 'payment'] as const)('keeps an already active update protected from a manual action while %s', async (block) => {
    const fixture = await installedFixture();
    fixture.worker.emit('waiting', { isExternal: true });
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    fixture.environment[block] = true;
    await fixture.guard.requestManual(fixture.update);
    expect(fixture.state.reason).toBe(block === 'editable' ? 'editing' : 'payment');
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    fixture.environment[block] = false;
    await fixture.guard.requestManual(fixture.update);
    expect(fixture.reload).toHaveBeenCalledOnce();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it('does not reload on a late controlling event after the activation request expired', async () => {
    const fixture = await installedFixture();
    fixture.worker.emit('waiting');
    await fixture.guard.requestManual(fixture.update);
    await vi.advanceTimersByTimeAsync(UPDATE_REQUEST_TIMEOUT_MS);
    expect(fixture.state).toMatchObject({ deferred: true, busy: false, reason: 'expired' });
    fixture.worker.emit('controlling', { isUpdate: true });
    expect(fixture.state.ready).toBe(true);
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });

  it('ignores activation callbacks after unmount and cancels idle work', async () => {
    const fixture = await installedFixture({ automatic: true });
    fixture.worker.emit('waiting');
    fixture.guard.unmount();
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_MS);
    fixture.worker.emit('controlling', { isUpdate: true, isExternal: true });
    expect(fixture.worker.messageSkipWaiting).not.toHaveBeenCalled();
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.directHelperReload).not.toHaveBeenCalled();
  });
});
