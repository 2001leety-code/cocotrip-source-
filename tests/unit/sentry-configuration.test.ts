import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

function mockSentrySdk() {
  vi.doMock('@sentry/react', () => {
    return { init: sdk.init, captureException: sdk.captureException };
  });
}

afterEach(() => {
  vi.doUnmock('@sentry/react');
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.resetAllMocks();
});

describe('Sentry initialization gating', () => {
  it.each([
    { prod: true, dsn: '' },
    { prod: false, dsn: 'https://public@example.invalid/1' },
  ])('skips initialization and capture when disabled (PROD=$prod, DSN=$dsn)', async ({ prod, dsn }) => {
    vi.stubEnv('PROD', prod);
    vi.stubEnv('VITE_SENTRY_DSN', dsn);
    mockSentrySdk();
    const module = await import('../../src/lib/sentry');
    module.initSentry();
    module.captureException(new Error('disabled'));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('initializes once, preserves filtering and masking, and captures after initialization', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
    mockSentrySdk();
    const module = await import('../../src/lib/sentry');
    module.captureException(new Error('before init'));
    expect(sdk.captureException).not.toHaveBeenCalled();
    module.initSentry();
    module.initSentry();
    module.captureException(new Error('reported'), { source: 'test' });
    expect(sdk.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'reported' }),
      { extra: { source: 'test' } },
    );
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

  it.each(['init', 'capture'])('contains SDK %s failures', async (failure) => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
    if (failure === 'init') sdk.init.mockImplementation(() => { throw new Error('mock SDK init failed'); });
    if (failure === 'capture') sdk.captureException.mockImplementation(() => { throw new Error('mock SDK capture failed'); });

    mockSentrySdk();
    const module = await import('../../src/lib/sentry');
    module.initSentry();
    module.captureException(new Error('contained'));
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.captureException).toHaveBeenCalledTimes(failure === 'capture' ? 1 : 0);
  });
});
