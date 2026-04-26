// Coverage for api/_shared/response.js — the standard JSON response wrappers.
// Verifies success/fail/methodGuard contracts with a minimal Vercel-shaped res mock.
import { describe, it, expect } from 'vitest';
import { success, fail, methodGuard, _ok, _err } from '../../api/_shared/response.js';

interface MockRes {
  statusCode?: number;
  headers: Record<string, string>;
  body?: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: (k: string, v: string) => void;
}

function makeRes(): MockRes {
  const res: MockRes = {
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
}

describe('api/_shared/response', () => {
  describe('_ok / _err', () => {
    it('_ok wraps data in { ok: true, data }', () => {
      expect(_ok({ x: 1 })).toEqual({ ok: true, data: { x: 1 } });
    });
    it('_err wraps message + code in { ok: false, error, code }', () => {
      expect(_err('boom', 'X')).toEqual({ ok: false, error: 'boom', code: 'X' });
    });
    it('_err defaults code to UNKNOWN_ERROR', () => {
      expect(_err('boom')).toEqual({ ok: false, error: 'boom', code: 'UNKNOWN_ERROR' });
    });
  });

  describe('success', () => {
    it('writes 200 + ok-wrapped JSON by default', () => {
      const res = makeRes();
      success(res, { hello: 'world' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, data: { hello: 'world' } });
    });
    it('honors custom status code', () => {
      const res = makeRes();
      success(res, { id: 'abc' }, 201);
      expect(res.statusCode).toBe(201);
    });
  });

  describe('fail', () => {
    it('writes 400 + err-wrapped JSON by default', () => {
      const res = makeRes();
      fail(res, 'bad input');
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ ok: false, error: 'bad input', code: 'UNKNOWN_ERROR' });
    });
    it('honors custom code + status', () => {
      const res = makeRes();
      fail(res, 'forbidden', 'FORBIDDEN', 403);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ ok: false, error: 'forbidden', code: 'FORBIDDEN' });
    });
  });

  describe('methodGuard', () => {
    it('returns true when method matches single allowed', () => {
      const res = makeRes();
      const ok = methodGuard({ method: 'POST' }, res, 'POST');
      expect(ok).toBe(true);
      expect(res.statusCode).toBeUndefined();
    });
    it('returns true when method matches one of array', () => {
      const res = makeRes();
      const ok = methodGuard({ method: 'GET' }, res, ['GET', 'POST']);
      expect(ok).toBe(true);
    });
    it('returns false + writes 405 + Allow header when method disallowed', () => {
      const res = makeRes();
      const ok = methodGuard({ method: 'DELETE' }, res, ['GET', 'POST']);
      expect(ok).toBe(false);
      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toBe('GET, POST');
      expect(res.body).toEqual({
        ok: false,
        error: 'DELETE not allowed',
        code: 'METHOD_NOT_ALLOWED',
      });
    });
  });
});
