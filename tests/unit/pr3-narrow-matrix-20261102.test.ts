import { describe, it, expect, vi } from 'vitest';
import { isAbsolute } from 'node:path';
import { writeFileSync, appendFileSync } from 'node:fs';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in probe'); }, resolveLlmModel: () => 'mock' }));

import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { BLOCKS, ARRIVALS0, allKeys, runOne, legMin, setScenario, getTransitLookups, resetTransitLookups, recordTransitLookup, type AnyRec } from '../helpers/pr3-offline-pipeline';

describe('PR3 offline matrix recorder', () => {
  it('records the pipeline for each requested input without classifying outcomes', async () => {
    const all = allKeys();
    expect(all).toHaveLength(12800);
    const sample: string[] = [
  "BUSAN_DAY_YEONGDO_LOCAL_STANDARD|A1530|1d|none|single",
  "ANDONG_DAY_HAHOE_STANDARD|A0900|1d|none|single",
  "SEOUL_DAY_NIGHT_EXPERIENCE_STANDARD|A0900|1d|none|single",
  "BUSAN_DAY_FULL_ACTION|A1530|1dDep|Halal|single",
  "BUSAN_DAY_GAMCHEON_STANDARD|I1200|1dDep|none|single",
  "BUSAN_DAY_GAMCHEON_STANDARD|A1530|1d|none|single",
  "GANGNEUNG_DAY_ANMOKBEACH_STANDARD|A1530|1d|none|single",
  "GANGNEUNG_DAY_ANMOKBEACH_STANDARD|I1200|3d|none|single",
  "JEJU_DAY_FULL_ACTION|A0900|1d|none|single",
  "DAEJEON_DAY_EUNHAENGDONG_STANDARD|E1300|1d|none|single",
  "GYEONGJU_DAY_BULGUKSA_STANDARD|I0800|1d|none|single",
  "JEJU_DAY_HANLIM_STANDARD|I1600|1dDep|none|single",
  "SEOUL_DAY_MUSEUM_ART_STANDARD|I1200|3d|none|single",
  "BUSAN_DAY_JJIMJILBANG_HAEUNDAE_STANDARD|A1800|1dDep|Halal|single",
  "JEJU_DAY_TEMPLE_NIGHT_STANDARD|A1530|3d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|A0900|3d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|A1530|3d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|I1200|3d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|I1600|3d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|E1300|3d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|Anone|1d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|A0900|1dDep|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|A1530|1d|none|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|A0900|3d|none|multi",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|I1200|1d|none|single",
  "SEOUL_DAY_TEMPLE_CULTURE_STANDARD|I1200|3d|none|single",
  "SEOUL_DAY_TEMPLE_CULTURE_STANDARD|I1200|1d|none|single",
  "SEOUL_DAY_TEMPLE_CULTURE_STANDARD|A0900|1d|none|single",
  "SEOUL_DAY_TEMPLE_CULTURE_STANDARD|I0800|1dDep|none|single",
  "BUSAN_DAY_HAEUNDAE_STANDARD|I1200|3d|none|single",
  "BUSAN_DAY_HAEUNDAE_STANDARD|A1530|1dDep|none|single",
  "BUSAN_DAY_HAEUNDAE_STANDARD|I0800|1d|none|single",
  "BUSAN_DAY_HAEUNDAE_STANDARD|A0900|3d|Halal|single",
  "ANDONG_DAY_HAHOE_STANDARD|A0900|3d|none|single",
  "ANDONG_DAY_HAHOE_STANDARD|I1200|3d|none|single",
  "ANDONG_DAY_HAHOE_STANDARD|A1530|1d|none|single",
  "SEOUL_DAY_DMZ_TOUR_STANDARD|I1200|3d|none|single",
  "SEOUL_DAY_DMZ_TOUR_STANDARD|I1200|1d|none|single",
  "SEOUL_DAY_DMZ_TOUR_STANDARD|A0900|3d|none|single",
  "SEOUL_DAY_NIGHT_EXPERIENCE_STANDARD|I0800|1dDep|none|single",
  "SEOUL_DAY_NIGHT_EXPERIENCE_STANDARD|I1200|3d|none|single",
  "SEOUL_DAY_NIGHT_EXPERIENCE_STANDARD|A0900|3d|none|single",
  "SEOUL_DAY_HONGDAE_STANDARD|I0800|1dDep|none|single",
  "SEOUL_DAY_HONGDAE_STANDARD|I1200|1dDep|none|single",
  "SEOUL_DAY_HONGDAE_STANDARD|A0900|1d|none|single",
  "BUSAN_DAY_YEONGDO_LOCAL_STANDARD|I1200|3d|none|single",
  "BUSAN_DAY_YEONGDO_LOCAL_STANDARD|I1200|3d|none|multi",
  "DAEJEON_DAY_EXPO_STANDARD|I1200|3d|none|single",
  "GUNSAN_DAY_MODERN_STANDARD|I1200|1d|none|single",
  "ANDONG_DAY_DOSANSEOWON_PACKED|A1530|1dDep|Halal|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|A1530|1dDep|Halal|single",
  "SEOUL_DAY_MUSEUM_HISTORY_STANDARD|A0900|3d|Halal|single",
  "BUSAN_DAY_HAEUNDAE_STANDARD|I1200|1dDep|none|single",
  "ICHEON_DAY_CERAMIC_STANDARD|I1200|1dDep|none|single"
];
    expect(sample.length).toBeGreaterThanOrEqual(35);
    const requested = process.env.PR3_MATRIX_LIMIT || 'sample';
    if (requested !== 'all' && requested !== 'sample' && !/^[1-9]\d*$/.test(requested)) throw new Error('PR3_MATRIX_LIMIT must be all, sample, or a positive integer');
    const selected = process.env.PR3_MATRIX_KEYS;
    const keys = selected ? selected.split(',').map((key) => key.trim()) : requested === 'all' ? all : requested === 'sample' ? sample : sample.slice(0, Number(requested));
    if (new Set(keys).size !== keys.length || keys.some((key) => !all.includes(key))) throw new Error('PR3_MATRIX_KEYS contains duplicate or unknown keys');
    const output = process.env.PR3_MATRIX_OUTPUT;
    if (output && !isAbsolute(output)) throw new Error('PR3_MATRIX_OUTPUT must be an absolute path');
    if (output) writeFileSync(output, '', { flag: 'wx' });
    const oldTsp = process.env.ROUTE_TSP_ENABLED;
    process.env.ROUTE_TSP_ENABLED = 'false';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline fetch'));
    const transit = vi.spyOn(RouteAgent.prototype as AnyRec, '_getTransitData').mockImplementation((async (p: AnyRec, c: AnyRec, _a: unknown, _b: unknown, index: number) => {
      recordTransitLookup();
      return { index, durationMin: legMin(p, c), verifiedRouteDurationMin: legMin(p, c), verifiedRouteSegment: { method: "bus" }, distanceKm: 2, publicTransit: null, drivingMin: null };
    }) as never);
    const airport = vi.spyOn(RouteAgent.prototype as AnyRec, '_routeAirportHotel').mockImplementation((async () => null) as never);
    const quiet = (['log', 'warn', 'error', 'info'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    let count = 0;
    let buffer: string[] = [];
    const flush = () => { if (output && buffer.length) { appendFileSync(output, buffer.join('')); buffer = []; } };
    try {
      for (const key of keys) {
        const [blockId, arrId, dur, dietId, kind] = key.split('|');
        const block = BLOCKS.find((b) => b.id === blockId);
        const arr = ARRIVALS0.find((a) => a.id === arrId);
        if (!block || !arr) throw new Error(`Invalid fixture key: ${key}`);
        for (const leg of ['20', '30', '45', '60', 'mixA', 'mixB', 'distA', 'distB']) {
          let first: AnyRec | undefined;
          for (const departure of ['17:00', '19:00', '21:00', '23:00']) {
            setScenario(leg, departure);
            let rec: AnyRec;
            if (process.env.PR3_MATRIX_DEDUP === '1' && dur !== '1dDep' && first) {
              rec = structuredClone(first);
              rec.reusedFrom = { key, leg, departure: '17:00' };
            } else {
              resetTransitLookups();
              try { rec = await runOne(block, arr, dur, dietId === 'none' ? [] : [dietId], kind); }
              catch (e: AnyRec) { rec = { stage: 'crash', err: String(e?.stack || e).slice(0, 1000) }; }
              rec.key = key; rec.leg = leg; rec.departure = departure; rec.transitLookups = getTransitLookups();
              if (process.env.PR3_MATRIX_DEDUP === '1' && dur !== '1dDep') first = structuredClone(rec);
            }
            rec.key = key; rec.leg = leg; rec.departure = departure;
            if (output) { buffer.push(JSON.stringify(rec) + '\n'); if (buffer.length >= 256) flush(); }
            count++;
          }
        }
      }
      expect(count).toBe(keys.length * 32);
    } finally {
      try { flush(); } finally {
        transit.mockRestore(); airport.mockRestore(); fetchMock.mockRestore(); quiet.forEach((q) => q.mockRestore());
        if (oldTsp === undefined) delete process.env.ROUTE_TSP_ENABLED; else process.env.ROUTE_TSP_ENABLED = oldTsp;
      }
    }
  }, 3_600_000);
});
