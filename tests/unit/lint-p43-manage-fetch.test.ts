/**
 * lint P43 — 보호 엔드포인트 클라이언트 호출 규칙 (2026-10-23, 후속 ②a: manageFetch 허용).
 * scripts/lib/p43-protected-calls.mjs 를 직접 부른다(--self-test 의 같은 6 케이스 + 경계 몇 개).
 * 허용 = authFetch / 실제 Bearer 헤더 / manageFetch('/api/booking-manage' | '/api/cancelBooking').
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { p43FileViolations } from '../../scripts/lib/p43-protected-calls.mjs';

const F = 'src/pages/P43Probe.tsx';
const check = (src: string) => p43FileViolations(F, src);

describe('P43 — must fail', () => {
  it('unauthenticated raw fetch', () => {
    expect(check("export const load = () => fetch('/api/my-bookings', { method: 'GET' });\n")).toHaveLength(1);
  });

  it('raw fetch sending only userEmail', () => {
    const v = check("export const c = (user) => fetch('/api/cancelBooking', {\n  method: 'POST',\n  body: JSON.stringify({ bookingID: 'b1', userEmail: user.email }),\n});\n");
    expect(v.some((m: string) => m.includes('raw fetch'))).toBe(true);
    expect(v.some((m: string) => m.includes('userEmail/userId'))).toBe(true);
  });

  it('a comment that only mentions "Authorization: Bearer"', () => {
    expect(check("// Authorization: Bearer is attached by the proxy\nexport const c = () => fetch('/api/cancelBooking', { method: 'POST' });\n")).toHaveLength(1);
    expect(check("/* headers: { Authorization: 'Bearer x' } */\nexport const c = () => fetch('/api/voucher');\n")).toHaveLength(1);
  });

  it("manageFetch('/api/voucher') — outside the allowlist (voucher is member-Bearer only)", () => {
    expect(check("export const d = (t) => manageFetch('/api/voucher', { manageToken: t });\n")).toHaveLength(1);
    expect(check("export const r = (t) => manageFetch('/api/my-bookings', { manageToken: t });\n")).toHaveLength(1);
  });

  it('a raw fetch in a file that also uses manageFetch', () => {
    const v = check("export const ok = (t) => manageFetch('/api/cancelBooking', { manageToken: t });\nexport const bad = () => fetch('/api/my-bookings');\n");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/L2: raw fetch/);
  });

  it('non-literal manageFetch path', () => {
    expect(check("export const e = (p, t) => manageFetch(p, { manageToken: t });\n")).toHaveLength(1);
  });
});

describe('P43 — must pass', () => {
  it("manageFetch('/api/cancelBooking'), ('/api/booking-manage') and ('/api/modifyBooking', ②b)", () => {
    expect(check("export const c = (t, id) => manageFetch('/api/cancelBooking', { manageToken: t, body: { bookingID: id } });\n")).toEqual([]);
    expect(check("export const g = (t) => manageFetch('/api/booking-manage', { manageToken: t });\n")).toEqual([]);
    expect(check("export const m = (t, id, d) => manageFetch('/api/modifyBooking', { manageToken: t, body: { bookingID: id, changes: { tourDate: d } } });\n")).toEqual([]);
  });

  it('authFetch and a real Bearer header are unchanged', () => {
    expect(check("export const c = () => authFetch('/api/cancelBooking', { method: 'POST' });\n")).toEqual([]);
    expect(check("export const c = (tk) => fetch('/api/voucher', {\n  headers: { Authorization: `Bearer ${tk}` },\n});\n")).toEqual([]);
  });

  it('files not touching protected endpoints are skipped; https:// in strings is not a comment', () => {
    expect(check("export const x = fetch('/api/tours');\n")).toEqual([]);
    expect(check("const u = 'https://cocotripkr.com'; export const c = (tk) => fetch('/api/voucher', { headers: { Authorization: `Bearer ${tk}` } });\n")).toEqual([]);
  });

  it('the real page and helper pass', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/BookingManagePage.tsx'), 'utf8');
    expect(p43FileViolations('src/pages/BookingManagePage.tsx', page)).toEqual([]);
    const modal = readFileSync(resolve(process.cwd(), 'src/components/BookingDateChangeModal.tsx'), 'utf8');
    expect(p43FileViolations('src/components/BookingDateChangeModal.tsx', modal)).toEqual([]);
  });
});

describe('lint wiring', () => {
  const lint = readFileSync(resolve(process.cwd(), 'scripts/lint-mistake-patterns.mjs'), 'utf8');
  it('P43 delegates to the shared helper and keeps the self-test cases', () => {
    expect(lint).toMatch(/import \{ p43FileViolations \} from '\.\/lib\/p43-protected-calls\.mjs'/);
    expect(lint).toMatch(/p43FileViolations\(file, getChangedFileContent\(file\)\)/);
    expect((lint.match(/expectRule: 'P43_authIdorBodyTrusted'/g) || []).length).toBe(24);
  });
});

describe('P43 — comment stripping is string-aware (review P2)', () => {
  it('"//" inside a string does not hide the raw fetch after it', () => {
    expect(check("const label = 'a // b'; fetch('/api/my-bookings');\n")).toHaveLength(1);
    expect(check('const u = `see http://x // y`; fetch(\'/api/voucher\');\n')).toHaveLength(1);
  });

  it('"/*" inside a string does not hide the raw fetch after it', () => {
    expect(check("const label = \"a /* b\"; fetch('/api/my-bookings');\n")).toHaveLength(1);
  });

  it('escaped quotes and regex literals containing // are not comments', () => {
    expect(check("const s = 'it\\'s // fine'; fetch('/api/my-bookings');\n")).toHaveLength(1);
    expect(check(String.raw`const re = /\/\//; fetch('/api/my-bookings');` + '\n')).toHaveLength(1);
  });

  it('real comments are still removed — "Authorization: Bearer" in a comment is not an exemption', () => {
    expect(check("fetch('/api/voucher'); // Authorization: Bearer x\n")).toHaveLength(1);
    expect(check("/*\n headers: { Authorization: 'Bearer x' }\n*/\nfetch('/api/voucher');\n")[0]).toMatch(/L4: raw fetch/);
  });

  it('line numbers survive multi-line block comments', () => {
    expect(check("/* a\n b\n c */\nfetch('/api/my-bookings');\n")[0]).toMatch(/L4:/);
  });
});

describe('P43 — manageFetch first argument must be exactly one allowed literal (review P2)', () => {
  it('concatenation is rejected', () => {
    expect(check("manageFetch('/api/cancelBooking' + suffix, { manageToken: t });\n")).toHaveLength(1);
  });

  it('template literal is rejected', () => {
    expect(check('manageFetch(`/api/cancelBooking`, { manageToken: t });\n')).toHaveLength(1);
  });

  it('multi-line call with an allowed literal passes; line number points at the call', () => {
    expect(check("export const c = (t) => manageFetch(\n  '/api/cancelBooking',\n  { manageToken: t },\n);\n")).toEqual([]);
    expect(check("const a = 1;\nexport const c = (t) => manageFetch(\n  '/api/voucher',\n  {},\n);\n")[0]).toMatch(/L2:/);
  });

  it('double quotes and a single-argument call are fine', () => {
    expect(check('manageFetch("/api/booking-manage", { manageToken });\n')).toEqual([]);
    expect(check("manageFetch('/api/booking-manage')\n")).toEqual([]);
  });

  it('any backslash in the literal is rejected — escapes are not decoded', () => {
    // '\b' 는 백스페이스: 풀어서 'b' 로 비교하면 허용 목록을 통과해 버린다.
    expect(check(String.raw`manageFetch('/api/\booking-manage', { manageToken: t });` + '\n')).toHaveLength(1);
    expect(check(String.raw`manageFetch('/api/cancel\Booking', { manageToken: t });` + '\n')).toHaveLength(1);
    expect(check("manageFetch('/api/booking-manage', { manageToken: t });\n")).toEqual([]);
  });
});

describe('P43 — review round 5 (spread `...` is not property access)', () => {
  it('`[... typeof /[/*]/]` — typeof after spread leads a regex; the raw fetch after it is caught', () => {
    expect(check("const r = [... typeof /[/*]/]; fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("const r = [...typeof /[/*]/]; fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("const r = [.../[/*]/.source]; fetch('/api/voucher');\n")).toHaveLength(1);
  });

  it('single `.` / `?.` keyword names stay properties → division', () => {
    expect(check("obj.typeof / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("obj?.typeof / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
  });
});

describe('P43 — review round 4 (token-based lookback, keyword-named properties)', () => {
  it('no fixed-length lookback: `return` + 80 spaces + regex with "/*"', () => {
    expect(check(`function t(x) { return${' '.repeat(80)}/[/*]/.test(x); }\nfetch('/api/voucher');\n`)).toHaveLength(1);
    expect(check(`const ok = (x) =>${' '.repeat(200)}/[/*]/.test(x);\nfetch('/api/voucher');\n`)).toHaveLength(1);
    expect(check("function t(x) { return /* why */\n  /[/*]/.test(x); }\nfetch('/api/voucher');\n")).toHaveLength(1);
  });

  it('a keyword after `.` (spaces / comments skipped) is a property name → division', () => {
    expect(check("const r = obj. return / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("const r = obj./*x*/return / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("const r = obj\n  .typeof / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("const r = obj?.in / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
  });

  it('keywords that merely contain a regex-lead keyword are plain identifiers (returned / x)', () => {
    expect(check("const r = returned / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
  });
});

describe('P43 — review round 3 (regex start after keywords / =>)', () => {
  it('regex after `return` inside a template interpolation — "/*" in it is not a comment', () => {
    expect(check("const s = `${(() => { return /[/*]/.test(input); })()}`; fetch('/api/voucher');\n")).toHaveLength(1);
  });

  it('regex after `=>` — "/*" in it is not a comment', () => {
    expect(check("const ok = (input) => /[/*]/.test(input); fetch('/api/my-bookings');\n")).toHaveLength(1);
  });

  it('other regex-leading keywords (typeof, case, throw, await …)', () => {
    expect(check("switch (k) { case /[/*]/.source: break; } fetch('/api/my-bookings');\n")).toHaveLength(1);
    expect(check("async function f() { await /[/*]/.exec(x); } fetch('/api/my-bookings');\n")).toHaveLength(1);
  });

  it('division is still division — the real comment after it is stripped (no Bearer exemption)', () => {
    expect(check("const r = a / b; /* real comment with Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("const r = (a) / 2 / c[0] / 1; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
  });

  it('a property named like a keyword is not a regex lead (obj.return / 2)', () => {
    expect(check("const r = obj.return / 2; /* Authorization: Bearer */ fetch('/api/voucher');\n")).toHaveLength(1);
  });
});

describe('P43 — review round 2 (comments glued to code, template interpolation)', () => {
  it('a block comment becomes one space — await/* x */manageFetch(path) is still a Rule 3 violation', () => {
    const v = check('export const c = async (path) => await/* note */manageFetch(path);\n');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/manageFetch\(\) first argument/);
    expect(check("export const c = async (t) => await/* note */manageFetch('/api/cancelBooking', { manageToken: t });\n")).toEqual([]);
  });

  it('comments inside template ${ } are stripped — no Bearer exemption from them', () => {
    expect(check("const label = `${ /* Authorization: Bearer x */ 'label' }`; fetch('/api/voucher');\n")).toHaveLength(1);
    expect(check("const label = `${ 'a' // Authorization: Bearer x\n}`; fetch('/api/voucher');\n")).toHaveLength(1);
  });

  it('nested braces, strings and backticks inside ${ } keep the template state right', () => {
    // 보간 안의 객체·중첩 템플릿 뒤에도 템플릿 텍스트의 `//` 는 주석이 아니고, 그 뒤 fetch 는 검출된다.
    expect(check("const s = `${ fn({ a: '}', b: `x${1}y` }) } // text`; fetch('/api/my-bookings');\n")).toHaveLength(1);
    // 템플릿 텍스트 안의 Bearer 문구는 문자열이라 남는다(실제 헤더로 쓰는 경우) — 기존 동작 유지.
    expect(check("const h = { Authorization: `Bearer ${tk}` }; fetch('/api/voucher', { headers: h });\n")).toEqual([]);
  });
});
