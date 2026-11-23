/**
 * 2026-11-23 운영 첫 셈(#1516, 세기만)에서 나온 것:
 * - 시트 읽기 실패에 코드가 없어 기록이 `Error` 뿐 → 상태 번호 코드(SHEETS_READ_400). 없는 탭 = tabMissing.
 * - 일정 기록(Leads) 줄이 저장되지 않음: google-auth-library 10 의 JWT 는 옵션 객체만 받는다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { google } from 'googleapis';
import { readRetentionSheetRows, writeRetentionSheetCells } from '../../api/_google-sheets.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function sheetsReturning(status: number, body: string) {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('GOOGLE_SHEETS_SPREADSHEET_ID', 'test-sheet');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'svc@example.test');
  vi.stubEnv('GOOGLE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----');
  vi.spyOn(globalThis.crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
  vi.spyOn(globalThis.crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => (String(url).startsWith('https://oauth2.googleapis.com/token')
    ? { ok: true, status: 200, json: async () => ({ access_token: 't' }) }
    : { ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body) })));
}

describe('보관 기간 시트 읽기·쓰기 실패 = 상태 번호 코드', () => {
  it('없는 탭(400 Unable to parse range) → SHEETS_READ_400 + tabMissing, 응답 글은 오류에 안 넣음', async () => {
    sheetsReturning(400, '{"error":{"code":400,"message":"Unable to parse range: Leads!A:G","status":"INVALID_ARGUMENT"}}');
    const error = await readRetentionSheetRows('leads').catch((e: unknown) => e) as Error & Record<string, unknown>;
    expect(error).toMatchObject({ code: 'SHEETS_READ_400', status: 400, tabMissing: true });
    expect(error.message).toBe('SHEETS_READ_400');
  });

  it('다른 실패(403·다른 400)는 tabMissing 아님 — 오류로 남김', async () => {
    sheetsReturning(403, '{"error":{"code":403,"message":"The caller does not have permission"}}');
    await expect(readRetentionSheetRows('bookings')).rejects.toMatchObject({ code: 'SHEETS_READ_403', tabMissing: false });
    sheetsReturning(400, '{"error":{"code":400,"message":"Invalid value"}}');
    await expect(writeRetentionSheetCells('leads', [{ row: 2, column: 'B', value: '' }])).rejects.toMatchObject({ code: 'SHEETS_WRITE_400', tabMissing: false });
  });
});

describe('일정 기록(Leads) 시트 인증 — JWT 옵션 객체', () => {
  it('옵션 객체면 이메일·키·범위가 들어가고, 옛 자리 인자는 비어 버린다', () => {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
    const ok = new google.auth.JWT({ email: 'svc@example.test', key: 'k', scopes });
    expect({ email: ok.email, key: ok.key, scopes: ok.scopes }).toEqual({ email: 'svc@example.test', key: 'k', scopes });
    // 11/23 전 emailNotifier 꼴 — 라이브러리 10 은 첫 인자만 옵션으로 읽어 인증 없이 요청했다.
    const positional = new (google.auth.JWT as unknown as new (...args: unknown[]) => { email?: string; key?: string })('svc@example.test', undefined, 'k', scopes);
    expect(positional.email).toBeUndefined();
    expect(positional.key).toBeUndefined();
  });
});
