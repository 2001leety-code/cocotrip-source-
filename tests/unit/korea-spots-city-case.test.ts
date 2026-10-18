/**
 * 2026-10-10 — api/_korea_spots.json has groups whose city key is "Seoul"/"Busan" (capitalised). Every reader in
 * api/_spots_helper.js filters with `s.city === 'seoul'`, so those 20 places were silently unreachable. The helper now
 * lower-cases city at load; this pins both the data shape and the reader behaviour. Offline, real JSON.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSpotContext } from '../../api/_spots_helper.js';

const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_korea_spots.json'), 'utf8')) as { city: string; dongEn: string }[];

describe('korea_spots city key casing', () => {
  it('the shipped file still has mixed-case city keys (documented data debt) …', () => {
    const mixed = raw.filter((s) => s.city !== s.city.toLowerCase());
    expect(mixed.length).toBeGreaterThan(0);
  });

  it('… but every mixed-case group is reachable through the city filter after load-time normalisation', () => {
    const mixed = raw.filter((s) => s.city !== s.city.toLowerCase());
    for (const group of mixed) {
      const ctx = getSpotContext(group.city.toLowerCase(), 500);
      expect(ctx, `${group.city}/${group.dongEn} missing from "${group.city.toLowerCase()}" context`).toContain(group.dongEn);
    }
  });
});
