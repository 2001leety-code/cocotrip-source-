// Coverage for api/_shared/log.js — the 4-level logging facade.
// Verifies debug suppression in production and pass-through to console.* otherwise.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('api/_shared/log', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const origNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
    vi.resetModules();
  });

  it('forwards info/warn/error to console.* unconditionally', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { logger } = await import('../../api/_shared/log.js');

    logger.info('info-msg');
    logger.warn('warn-msg');
    logger.error('error-msg');

    expect(logSpy).toHaveBeenCalledWith('info-msg');
    expect(warnSpy).toHaveBeenCalledWith('warn-msg');
    expect(errorSpy).toHaveBeenCalledWith('error-msg');
  });

  it('suppresses debug when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { logger } = await import('../../api/_shared/log.js');

    logger.debug('hidden');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('emits debug when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const { logger } = await import('../../api/_shared/log.js');

    logger.debug('visible');
    expect(logSpy).toHaveBeenCalledWith('visible');
  });

  it('forwards multiple args to underlying console method', async () => {
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const { logger } = await import('../../api/_shared/log.js');

    const obj = { foo: 'bar' };
    logger.warn('label', obj, 42);
    expect(warnSpy).toHaveBeenCalledWith('label', obj, 42);
  });
});
