/**
 * 2026-11-22 운영자 결정: "이미 예약했어요 → 무료 플랜" 신청을 닫는다(화면은 #255 에서 없어짐).
 * - firestore.rules: pending_free_claims 새로 만들기만 막고, 관리자 읽기·승인/거절(update)·삭제는 그대로.
 * - storage.rules: free_claims/ 올리기 막음, 관리자 다운로드는 그대로.
 * - api/notify-claim.js: 텔레그램 안 보내고 410, 요청 내용을 읽거나 남기지 않음.
 * 규칙은 정적 검사(firestore-rules-pr420.test.ts 와 같은 방식) — 실제 반영은 운영자가 firebase deploy 로.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import handler from '../../api/notify-claim.js';

function blockFor(text: string, matchSpec: string): string {
  const start = text.indexOf(`match ${matchSpec}`);
  if (start === -1) throw new Error(`match block not found: ${matchSpec}`);
  const open = text.indexOf('{', start + `match ${matchSpec}`.length);
  let depth = 1;
  let i = open + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  // 주석은 빼고 본다(주석 속 'create' 글자에 속지 않게).
  return text.slice(open, i).split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
}

describe('firestore.rules — pending_free_claims', () => {
  const block = blockFor(readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'), '/pending_free_claims/{claimId}');

  it('새로 만들기는 누구도 못 함', () => {
    expect(block).toMatch(/allow create:\s*if false;/);
    expect(block).not.toMatch(/request\.resource\.data\.status\s*==\s*'pending'/);
  });

  it('관리자 승인·거절(update)·삭제와 읽기는 그대로', () => {
    expect(block).toMatch(/allow update, delete:\s*if isAdminEmail\(\);/);
    expect(block).toMatch(/allow read:\s*if isAdminEmail\(\)/);
    expect(block).not.toMatch(/allow write/);
  });
});

describe('storage.rules — free_claims/', () => {
  const block = blockFor(readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8'), '/free_claims/{emailSlug}/{allPaths=**}');

  it('올리기 막음, 관리자 다운로드는 그대로', () => {
    expect(block).toMatch(/allow write:\s*if false;/);
    expect(block).toMatch(/allow read:\s*if request\.auth != null\s*&& request\.auth\.token\.email == '2001leety@gmail\.com';/);
  });
});

describe('POST /api/notify-claim — 닫음', () => {
  const res = () => {
    const out = { code: 0, body: null as unknown, headers: {} as Record<string, string> };
    const api = {
      setHeader: (k: string, v: string) => { out.headers[k] = v; return api; },
      status: (code: number) => { out.code = code; return api; },
      json: (body: unknown) => { out.body = body; return api; },
    };
    return { out, api };
  };

  it('410 으로 끝나고 요청 내용을 남기지 않는다', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const req of [
      { method: 'POST', headers: {}, body: { claimId: 'c1', email: 'claim@example.test', flightRef: 'PNR1' } },
      { method: 'POST', headers: {}, body: '{"claimId":"c1","email":"claim@example.test"}' },
      { method: 'GET', headers: {} },
    ]) {
      const { out, api } = res();
      await handler(req as never, api as never);
      expect(out.code).toBe(410);
      expect(out.body).toEqual({ ok: false, error: 'FREE_CLAIM_CLOSED' });
      expect(out.headers['Cache-Control']).toBe('no-store');
    }
    expect(fetchSpy).not.toHaveBeenCalled(); // 텔레그램 안 보냄
    expect([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]).toEqual([]);
    for (const spy of [log, warn, error, fetchSpy]) spy.mockRestore();
  });

  it('텔레그램·속도 제한 기록(IP 해시)을 부르지 않는다', () => {
    const src = readFileSync(resolve(process.cwd(), 'api/notify-claim.js'), 'utf8');
    expect(src).not.toMatch(/import/);
    expect(src).not.toMatch(/callBot|checkIpRateLimit|req\.body/);
  });
});
