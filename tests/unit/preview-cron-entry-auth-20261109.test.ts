import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Pure source-level harness: the actual default wrappers are extracted from the
// product files and evaluated with injected mocks. No product module imports,
// no SDKs, no network, no runtime services.

type AuthResult = { ok: true; source: string } | { ok: false; status: number; error: string };

interface MockReq {
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
}

interface MockRes {
  statusCode: number | null;
  body: unknown;
  ended: boolean;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
  end(): MockRes;
}

type Handler = (req: MockReq, res: MockRes) => Promise<unknown>;
type Factory = (...deps: unknown[]) => Handler;

interface WrapperCfg {
  file: string;
  task: string;
  usesDryRun: boolean;
  jsonIsBody: boolean;
}

const IMPORT_LINE = "import { verifyCronRequest } from '../_shared/cron-auth.js';";
const VERIFY_CALL = 'verifyCronRequest(req)';
const OPTIONS_CHECK = "req.method === 'OPTIONS'";
const DENIAL_SHAPE = "res.status(auth.status).json({ ok: false, code: 'AUTH_REQUIRED', error: auth.error })";
const TRY_RE = /\btry\s*\{/;

const DEFAULT_WRAPPERS: WrapperCfg[] = [
  { file: 'daily-report', task: 'dailyReportTask', usesDryRun: false, jsonIsBody: false },
  { file: 'preview-lead-recovery', task: 'previewLeadRecoveryTask', usesDryRun: true, jsonIsBody: true },
  { file: 'refund-reminder', task: 'refundReminderTask', usesDryRun: true, jsonIsBody: true },
  { file: 'review-request', task: 'reviewRequestTask', usesDryRun: true, jsonIsBody: true },
];

function readSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../api/_crons/${name}.js`, import.meta.url)), 'utf8');
}

function defaultSuffix(src: string): string {
  const idx = src.indexOf('export default async function');
  if (idx < 0) throw new Error('default export wrapper not found');
  return src.slice(idx);
}

function handlerName(suffix: string): string {
  const m = /^export default async function (\w+)\s*\(/.exec(suffix);
  if (!m) throw new Error('default handler name not found');
  return m[1];
}

function extractBalancedFunction(suffix: string): string {
  const open = suffix.indexOf('{');
  if (open < 0) throw new Error('function body not found');
  let depth = 0;
  for (let i = open; i < suffix.length; i += 1) {
    const ch = suffix[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return suffix.slice(0, i + 1);
    }
  }
  throw new Error('unbalanced default wrapper');
}

function buildHandler(fnSource: string, name: string, depNames: string[], deps: unknown[]): Handler {
  const body = `${fnSource.replace(/^export default /, '')}\nreturn ${name};`;
  const factory = new Function(...depNames, body) as Factory;
  return factory(...deps);
}

function makeReq(method: string, query: Record<string, string> = {}): MockReq {
  return { method, headers: { 'x-test': '1' }, query };
}

function makeRes(): MockRes {
  const r: MockRes = {
    statusCode: null,
    body: undefined,
    ended: false,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json(body: unknown) {
      r.body = body;
      return r;
    },
    end() {
      r.ended = true;
      return r;
    },
  };
  return r;
}

function makeConsole() {
  return { error: vi.fn(), warn: vi.fn(), log: vi.fn(), info: vi.fn() };
}

function makeVerifier() {
  return vi.fn(async (_req: unknown): Promise<AuthResult> => { void _req; return { ok: true, source: 'test' }; });
}

function denial(status: number, error: string): AuthResult {
  return { ok: false, status, error };
}

function setupDefault(cfg: WrapperCfg) {
  const src = readSource(cfg.file);
  const suffix = defaultSuffix(src);
  const fnSource = extractBalancedFunction(suffix);
  const verify = makeVerifier();
  const task = vi.fn(async (_dryRun?: boolean) => { void _dryRun; return { statusCode: 207, ok: true, body: { marker: cfg.file } }; });
  const con = makeConsole();
  const handler = buildHandler(fnSource, handlerName(suffix), ['verifyCronRequest', cfg.task, 'console'], [verify, task, con]);
  return { src, fnSource, verify, task, con, handler };
}

function setupRetry() {
  const src = readSource('email-retry-sweep');
  const suffix = defaultSuffix(src);
  const tryMatch = TRY_RE.exec(suffix);
  if (!tryMatch) throw new Error('first try block not found in email-retry-sweep wrapper');
  const prefix = suffix.slice(0, tryMatch.index);
  const fnSource = `${prefix}\n  mockWork();\n}`;
  const verify = makeVerifier();
  const isPreviewSuppressed = vi.fn((_channel: string) => { void _channel; return true; });
  const emailSuppressedReceipt = vi.fn(() => ({ suppressed: true, suppressionReason: 'preview' }));
  const initAdminDb = vi.fn(() => ({}));
  const mockWork = vi.fn();
  const con = makeConsole();
  const handler = buildHandler(
    fnSource,
    handlerName(suffix),
    ['verifyCronRequest', 'isPreviewSuppressed', 'emailSuppressedReceipt', 'initAdminDb', 'mockWork', 'console'],
    [verify, isPreviewSuppressed, emailSuppressedReceipt, initAdminDb, mockWork, con],
  );
  return { src, prefix, verify, isPreviewSuppressed, emailSuppressedReceipt, initAdminDb, mockWork, handler };
}

for (const cfg of DEFAULT_WRAPPERS) {
  describe(`cron entry auth: ${cfg.file} default wrapper`, () => {
    it('imports the shared verifier and verifies after OPTIONS, before any work', () => {
      const h = setupDefault(cfg);
      expect(h.src).toContain(IMPORT_LINE);
      const optionsIdx = h.fnSource.indexOf(OPTIONS_CHECK);
      const verifyIdx = h.fnSource.indexOf(VERIFY_CALL);
      const taskIdx = h.fnSource.indexOf(`${cfg.task}(`);
      const tryMatch = TRY_RE.exec(h.fnSource);
      expect(optionsIdx).toBeGreaterThan(-1);
      expect(verifyIdx).toBeGreaterThan(optionsIdx);
      expect(taskIdx).toBeGreaterThan(verifyIdx);
      expect(tryMatch).not.toBeNull();
      if (tryMatch) expect(tryMatch.index).toBeGreaterThan(verifyIdx);
      expect(h.fnSource).toContain(DENIAL_SHAPE);
    });

    for (const status of [401, 403]) {
      it(`denies with ${status} and AUTH_REQUIRED without running the task`, async () => {
        const h = setupDefault(cfg);
        h.verify.mockResolvedValueOnce(denial(status, `denied-${status}`));
        const req = makeReq('GET', { dryRun: '1' });
        const res = makeRes();
        await h.handler(req, res);
        expect(h.verify).toHaveBeenCalledTimes(1);
        expect(h.verify.mock.calls[0][0]).toBe(req);
        expect(res.statusCode).toBe(status);
        expect(res.body).toEqual({ ok: false, code: 'AUTH_REQUIRED', error: `denied-${status}` });
        expect(h.task).not.toHaveBeenCalled();
      });
    }

    it('keeps the existing OPTIONS bypass without verifying or running the task', async () => {
      const h = setupDefault(cfg);
      const res = makeRes();
      await h.handler(makeReq('OPTIONS'), res);
      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.task).not.toHaveBeenCalled();
    });

    it('forwards the original req to the verifier and runs the task when authorized', async () => {
      const h = setupDefault(cfg);
      const req = makeReq('GET', { dryRun: '1' });
      const res = makeRes();
      await h.handler(req, res);
      expect(h.verify).toHaveBeenCalledTimes(1);
      expect(h.verify.mock.calls[0][0]).toBe(req);
      expect(h.task).toHaveBeenCalledTimes(1);
      expect(h.verify.mock.invocationCallOrder[0]).toBeLessThan(h.task.mock.invocationCallOrder[0]);
      if (cfg.usesDryRun) {
        expect(h.task).toHaveBeenCalledWith(true);
      } else {
        expect(h.task).toHaveBeenCalledWith();
      }
      expect(res.statusCode).toBe(207);
      if (cfg.jsonIsBody) {
        expect(res.body).toEqual({ marker: cfg.file });
      } else {
        expect(res.body).toEqual({ statusCode: 207, ok: true, body: { marker: cfg.file } });
      }
    });

    it('fails closed when the verifier rejects: rejection propagates, no task, no response', async () => {
      const h = setupDefault(cfg);
      h.verify.mockImplementationOnce(async () => {
        throw new Error('verifier down');
      });
      const res = makeRes();
      await expect(h.handler(makeReq('GET'), res)).rejects.toThrow('verifier down');
      expect(h.task).not.toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });
  });
}

describe('cron entry auth: email-retry-sweep default wrapper prefix', () => {
  it('imports the shared verifier and verifies on entry before the suppression gate', () => {
    const h = setupRetry();
    expect(h.src).toContain(IMPORT_LINE);
    const verifyIdx = h.prefix.indexOf(VERIFY_CALL);
    const suppressIdx = h.prefix.indexOf("isPreviewSuppressed('email')");
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(suppressIdx).toBeGreaterThan(verifyIdx);
    expect(h.prefix).toContain(DENIAL_SHAPE);
    expect(h.prefix).not.toContain(OPTIONS_CHECK);
  });

  for (const status of [401, 403]) {
    it(`denies with ${status} before suppression, DB init, or work`, async () => {
      const h = setupRetry();
      h.verify.mockResolvedValueOnce(denial(status, `denied-${status}`));
      const req = makeReq('GET');
      const res = makeRes();
      await h.handler(req, res);
      expect(h.verify).toHaveBeenCalledTimes(1);
      expect(h.verify.mock.calls[0][0]).toBe(req);
      expect(res.statusCode).toBe(status);
      expect(res.body).toEqual({ ok: false, code: 'AUTH_REQUIRED', error: `denied-${status}` });
      expect(h.isPreviewSuppressed).not.toHaveBeenCalled();
      expect(h.emailSuppressedReceipt).not.toHaveBeenCalled();
      expect(h.initAdminDb).not.toHaveBeenCalled();
      expect(h.mockWork).not.toHaveBeenCalled();
    });
  }

  it('does not grant an unauthenticated OPTIONS bypass', async () => {
    const h = setupRetry();
    h.verify.mockResolvedValueOnce(denial(401, 'missing'));
    const req = makeReq('OPTIONS');
    const res = makeRes();
    await h.handler(req, res);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.verify.mock.calls[0][0]).toBe(req);
    expect(res.statusCode).toBe(401);
    expect(res.ended).toBe(false);
    expect(h.isPreviewSuppressed).not.toHaveBeenCalled();
    expect(h.mockWork).not.toHaveBeenCalled();
  });

  it('authorized + suppressed returns the existing suppression receipt without work', async () => {
    const h = setupRetry();
    const req = makeReq('GET');
    const res = makeRes();
    await h.handler(req, res);
    expect(h.verify.mock.calls[0][0]).toBe(req);
    expect(h.isPreviewSuppressed).toHaveBeenCalledWith('email');
    expect(h.verify.mock.invocationCallOrder[0]).toBeLessThan(h.isPreviewSuppressed.mock.invocationCallOrder[0]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, swept: 0, suppressed: true, suppressionReason: 'preview' });
    expect(h.mockWork).not.toHaveBeenCalled();
  });

  it('authorized + not suppressed continues to the work continuation', async () => {
    const h = setupRetry();
    h.isPreviewSuppressed.mockReturnValue(false);
    const req = makeReq('GET');
    const res = makeRes();
    await h.handler(req, res);
    expect(h.verify.mock.calls[0][0]).toBe(req);
    expect(h.mockWork).toHaveBeenCalledTimes(1);
    expect(h.verify.mock.invocationCallOrder[0]).toBeLessThan(h.mockWork.mock.invocationCallOrder[0]);
    expect(res.statusCode).toBeNull();
  });

  it('fails closed when the verifier rejects: no suppression check, no DB, no work', async () => {
    const h = setupRetry();
    h.verify.mockImplementationOnce(async () => {
      throw new Error('verifier down');
    });
    const res = makeRes();
    await expect(h.handler(makeReq('GET'), res)).rejects.toThrow('verifier down');
    expect(h.isPreviewSuppressed).not.toHaveBeenCalled();
    expect(h.initAdminDb).not.toHaveBeenCalled();
    expect(h.mockWork).not.toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });
});
