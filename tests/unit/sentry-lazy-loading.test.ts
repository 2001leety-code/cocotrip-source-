import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  loaded: vi.fn(),
  loadGate: Promise.resolve(),
  loadError: false,
}));

function mockSentrySdk() {
  vi.doMock('@sentry/react', async () => {
    await sdk.loadGate;
    if (sdk.loadError) throw new Error('mock SDK load failed');
    sdk.loaded();
    return { init: sdk.init, captureException: sdk.captureException };
  });
}

afterEach(() => {
  vi.doUnmock('@sentry/react');
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.resetAllMocks();
  sdk.loadGate = Promise.resolve();
  sdk.loadError = false;
});

describe('Sentry lazy loading', () => {
  it.each([
    { prod: true, dsn: '' },
    { prod: false, dsn: 'https://public@example.invalid/1' },
  ])('skips the SDK when disabled (PROD=$prod, DSN=$dsn)', async ({ prod, dsn }) => {
    vi.stubEnv('PROD', prod);
    vi.stubEnv('VITE_SENTRY_DSN', dsn);
    mockSentrySdk();
    const module = await import('../../src/lib/sentry');
    module.initSentry();
    expect(sdk.loaded).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('initializes once, preserves filtering and masking, and delivers captures after pending initialization', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
    let releaseLoad!: () => void;
    sdk.loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    mockSentrySdk();
    const module = await import('../../src/lib/sentry');
    module.initSentry();
    module.initSentry();
    module.captureException(new Error('pending'), { source: 'test' });

    expect(sdk.captureException).not.toHaveBeenCalled();
    releaseLoad();
    await vi.waitFor(() => expect(sdk.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'pending' }),
      { extra: { source: 'test' } },
    ));
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.init.mock.calls[0][0]).toMatchObject({
      dsn: 'https://public@example.invalid/1',
      tracesSampleRate: 0.1,
      ignoreErrors: ['ResizeObserver loop', 'ChunkLoadError'],
    });
    const options = sdk.init.mock.calls[0][0];
    const event = { user: { email: 'guest@example.com', ip_address: '127.0.0.1', id: 'guest-1' } };
    expect(options.beforeSend(event, { originalException: new Error('ordinary') })).toEqual({
      user: { id: 'guest-1' },
    });
    expect(options.beforeSend({}, { originalException: new Error('Missing or insufficient permissions') })).toBeNull();
  });

  it.each(['import', 'init', 'capture'])('contains SDK %s failures', async (failure) => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
    if (failure === 'import') sdk.loadError = true;
    if (failure === 'init') sdk.init.mockImplementation(() => { throw new Error('mock SDK init failed'); });
    if (failure === 'capture') sdk.captureException.mockImplementation(() => { throw new Error('mock SDK capture failed'); });

    mockSentrySdk();
    const module = await import('../../src/lib/sentry');
    module.initSentry();
    module.captureException(new Error('contained'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sdk.loaded).toHaveBeenCalledTimes(failure === 'import' ? 0 : 1);
    expect(sdk.init).toHaveBeenCalledTimes(failure === 'import' ? 0 : 1);
    expect(sdk.captureException).toHaveBeenCalledTimes(failure === 'capture' ? 1 : 0);
  });
});
