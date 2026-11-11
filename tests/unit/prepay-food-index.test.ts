import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const io = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: io.read }));

beforeEach(() => {
  vi.resetModules();
  io.read.mockReset();
});

describe('prepay food index availability', () => {
  it.each(['missing', 'unreadable', 'invalid JSON', 'wrong shape', 'empty'])('%s is explicit 503, not dietary 422; failed reads can recover', async failure => {
    const { loadPrepayFoodIndex } = await import('../../api/_shared/prepay-coverage.js');
    if (failure === 'missing' || failure === 'unreadable') io.read.mockRejectedValueOnce(new Error(failure));
    else io.read.mockResolvedValueOnce(failure === 'invalid JSON' ? '{bad' : failure === 'empty' ? '[]' : '{}');
    await expect(loadPrepayFoodIndex()).rejects.toMatchObject({ code: 'PREPAY_CHECK_UNAVAILABLE', status: 503 });
    io.read.mockResolvedValueOnce('[{"city":"seoul"}]');
    expect(await loadPrepayFoodIndex()).toEqual([{ city: 'seoul' }]);
    expect(await loadPrepayFoodIndex()).toEqual([{ city: 'seoul' }]);
    expect(io.read).toHaveBeenCalledTimes(2);
    expect(String(io.read.mock.calls[0][0])).toMatch(/api\/_food_index\.json$/);
  });

  it('concurrent cold reads share a single read', async () => {
    const { loadPrepayFoodIndex } = await import('../../api/_shared/prepay-coverage.js');
    io.read.mockResolvedValue('[{"city":"seoul"}]');
    await Promise.all([loadPrepayFoodIndex(), loadPrepayFoodIndex()]);
    expect(io.read).toHaveBeenCalledTimes(1);
  });

  it('all three payment functions explicitly include the restaurant file', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    for (const file of ['createPaypalOrder', 'capturePaypalOrder', 'manual-payment-request']) {
      expect(config.functions[`api/${file}.js`].includeFiles).toBe('api/_food_index.json');
    }
    expect(config.functions['api/capturePaypalOrder.js'].maxDuration).toBe(60);
  });
});
