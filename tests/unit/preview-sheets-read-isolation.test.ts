import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findBookingRowByKey, getTodayTours, getTomorrowTours, getWeekSummary, getYesterdayBookings } from '../../api/_google-sheets.js';

const readers: Array<[string, () => Promise<unknown>]> = [
  ['findBookingRowByKey', () => findBookingRowByKey('fixture-sheet', 'fixture-order')],
  ['getYesterdayBookings', () => getYesterdayBookings()],
  ['getTodayTours', () => getTodayTours()],
  ['getTomorrowTours', () => getTomorrowTours()],
  ['getWeekSummary', () => getWeekSummary()],
];

describe('Preview cannot read inherited Google Sheets', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('GOOGLE_SHEETS_SPREADSHEET_ID', 'fixture-sheet');
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'fixture@example.test');
    vi.stubEnv('GOOGLE_PRIVATE_KEY', '');
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', 'invalid-base64-json-fixture');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  for (const flag of ['', 'false', 'true']) {
    it.each(readers)(`blocks %s before credential parsing/network when suppression flag is ${JSON.stringify(flag)}`, async (_name, read) => {
      vi.stubEnv('VERCEL_ENV', 'preview');
      vi.stubEnv('PREVIEW_SHEETS_SUPPRESS', flag);
      await expect(read()).rejects.toMatchObject({ name: 'SheetsEnvSkipped', message: 'PREVIEW_SHEETS_ACCESS_BLOCKED', skipped: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  for (const env of ['production', 'development']) {
    it.each(readers)(`preserves ${env} %s read path (mock provider)`, async (_name, read) => {
      vi.stubEnv('VERCEL_ENV', env);
      vi.stubEnv('PREVIEW_SHEETS_SUPPRESS', 'true');
      vi.stubEnv('GOOGLE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----');
      const importKey = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
      fetchMock.mockImplementation(async (url: string) => {
        if (url === 'https://oauth2.googleapis.com/token') {
          return { json: async () => ({ access_token: 'fixture-token' }) };
        }
        expect(url).toMatch(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/fixture-sheet\/values\//);
        return { json: async () => ({ values: [] }) };
      });
      await expect(read()).resolves.toBeDefined();
      expect(importKey).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  }
});
