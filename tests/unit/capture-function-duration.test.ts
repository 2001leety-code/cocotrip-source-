/**
 * 2026-10-22: a real sandbox payment hit 504 at 30 s — capturePaypalOrder waits up to timeoutMs 45_000 for the
 * booking processor while the "api/*.js" glob capped it at 30 s. Astra: keep 45_000, give the capture function
 * its own 60 s entry placed BEFORE the glob, and keep ≥ 10 s headroom for pre-work and result persistence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
  functions: Record<string, { maxDuration?: number }>;
};
const captureSrc = readFileSync(resolve(process.cwd(), 'api/capturePaypalOrder.js'), 'utf8');

describe('capturePaypalOrder function duration', () => {
  it('has its own 60 s maxDuration', () => {
    expect(vercel.functions['api/capturePaypalOrder.js'].maxDuration).toBe(60);
  });

  it('is declared before the "api/*.js" glob', () => {
    const keys = Object.keys(vercel.functions);
    expect(keys.indexOf('api/capturePaypalOrder.js')).toBeGreaterThan(-1);
    expect(keys.indexOf('api/*.js')).toBeGreaterThan(-1);
    expect(keys.indexOf('api/capturePaypalOrder.js')).toBeLessThan(keys.indexOf('api/*.js'));
  });

  it('leaves at least 10 s after the booking-processor wait (timeoutMs) inside maxDuration', () => {
    const match = captureSrc.match(/timeoutMs:\s*(\d[\d_]*)/);
    expect(match).not.toBeNull();
    const waitMs = Number((match as RegExpMatchArray)[1].replace(/_/g, ''));
    expect(waitMs).toBeGreaterThan(0);
    const maxDurationMs = (vercel.functions['api/capturePaypalOrder.js'].maxDuration as number) * 1000;
    expect(waitMs + 10_000).toBeLessThanOrEqual(maxDurationMs);
  });
});

// 2026-10-23 (②b): 날짜 변경은 커밋 뒤 Puppeteer 바우처 PDF + 메일을 같은 요청에서 만든다(콜드스타트 큼).
//   글롭 30 s 에 걸리면 커밋 뒤 끊겨 메일이 안 간다 → booking-processor·pdf/generate 와 같은 60 s.
describe('modifyBooking function duration', () => {
  it('has its own 60 s maxDuration', () => {
    expect(vercel.functions['api/modifyBooking.js'].maxDuration).toBe(60);
  });

  it('is declared before the "api/*.js" glob', () => {
    const keys = Object.keys(vercel.functions);
    expect(keys.indexOf('api/modifyBooking.js')).toBeGreaterThan(-1);
    expect(keys.indexOf('api/modifyBooking.js')).toBeLessThan(keys.indexOf('api/*.js'));
  });
});
