/**
 * P112 (2026-05-20) regression slot — end_time backfill in planPersister.
 *
 * Source bug (plan 4792076e): 29/29 stops 의 end_time = undefined. UI/PDF/email/
 * voucher 가 end_time 가정 → "15:45-undefined" 류 표시. Gemini/RouteAgent 가
 * 채우지 않은 stop 은 start_time + stay_min 으로 자동 계산.
 *
 * computeEndTime (pure) + backfillStopEndTimes (mutation) 둘 다 export.
 *
 * Verifies:
 *   1. computeEndTime — HH:mm + stay_min → HH:mm (모듈러 24h wrap)
 *   2. 잘못된 input (null, NaN, malformed) → null (graceful)
 *   3. backfillStopEndTimes — 누락된 stop 만 채움, 이미 있는 stop override X
 *   4. stay_min=0 → end_time = start_time
 *   5. 자정 wrap-around 정상 (23:30 + 60min = 00:30)
 */
import { describe, it, expect } from 'vitest';
import { computeEndTime, backfillStopEndTimes } from '../../api/_ai_core/planPersister.js';

describe('computeEndTime — pure HH:mm + stayMin → HH:mm', () => {
  it.each([
    ['09:00', 60, '10:00'],
    ['15:45', 120, '17:45'],
    ['23:30', 60, '00:30'],   // wrap to next day
    ['23:00', 75, '00:15'],
    ['08:00', 0, '08:00'],    // stay=0 → end=start (transit-only stop)
    ['00:00', 30, '00:30'],
    ['12:30', 30, '13:00'],
  ])('computeEndTime(%j, %i) → %j', (start, stay, expected) => {
    expect(computeEndTime(start, stay)).toBe(expected);
  });

  it.each([
    [undefined, 60],
    [null, 60],
    ['', 60],
    ['9:0', 60],         // malformed (no zero pad on minutes — single digit)
    ['25:00', 60],       // out of range hour
    ['12:60', 60],       // out of range minute
    ['abc', 60],
    ['09:00', null],
    ['09:00', undefined],
    ['09:00', NaN],
    ['09:00', -1],       // negative stay
    ['09:00', 'invalid'],
  ])('computeEndTime(%j, %j) → null (malformed input)', (start, stay) => {
    expect(computeEndTime(start as any, stay as any)).toBeNull();
  });

  it('24h+ stay wraps correctly (rare edge case)', () => {
    // 25h stay → next day +1h
    expect(computeEndTime('08:00', 25 * 60 + 30)).toBe('09:30');
  });

  it('floor stayMin for fractional minutes', () => {
    expect(computeEndTime('08:00', 60.7)).toBe('09:00');
  });
});

describe('backfillStopEndTimes — mutation + override-protection', () => {
  it('fills missing end_time on all stops', () => {
    const itinerary = {
      days: [
        {
          stops: [
            { start_time: '09:00', stay_min: 60 },
            { start_time: '11:00', stay_min: 30 },
          ],
        },
        {
          stops: [
            { start_time: '14:00', stay_min: 90 },
          ],
        },
      ],
    };
    const filled = backfillStopEndTimes(itinerary);
    expect(filled).toBe(3);
    expect((itinerary.days[0].stops[0] as any).end_time).toBe('10:00');
    expect((itinerary.days[0].stops[1] as any).end_time).toBe('11:30');
    expect((itinerary.days[1].stops[0] as any).end_time).toBe('15:30');
  });

  it('preserves existing end_time (Gemini/RouteAgent stitched values)', () => {
    const itinerary = {
      days: [{
        stops: [
          { start_time: '09:00', stay_min: 60, end_time: '10:30' },  // already set
          { start_time: '11:00', stay_min: 30 },                      // missing
        ],
      }],
    };
    const filled = backfillStopEndTimes(itinerary);
    expect(filled).toBe(1);
    expect((itinerary.days[0].stops[0] as any).end_time).toBe('10:30');  // unchanged
    expect((itinerary.days[0].stops[1] as any).end_time).toBe('11:30');  // filled
  });

  it('skips malformed stops gracefully (no throw)', () => {
    const itinerary = {
      days: [{
        stops: [
          { start_time: '09:00', stay_min: 60 },         // valid
          { start_time: 'invalid', stay_min: 30 },        // skip
          { start_time: '11:00', stay_min: -10 },         // skip (negative)
          { start_time: '12:00', stay_min: 'abc' },       // skip (NaN)
          { start_time: undefined, stay_min: 30 },        // skip
        ],
      }],
    };
    const filled = backfillStopEndTimes(itinerary);
    expect(filled).toBe(1);
    expect((itinerary.days[0].stops[0] as any).end_time).toBe('10:00');
  });

  it('handles missing itinerary / days / stops arrays safely', () => {
    expect(backfillStopEndTimes(undefined as any)).toBe(0);
    expect(backfillStopEndTimes(null as any)).toBe(0);
    expect(backfillStopEndTimes({} as any)).toBe(0);
    expect(backfillStopEndTimes({ days: [] } as any)).toBe(0);
    expect(backfillStopEndTimes({ days: [{ stops: [] }] } as any)).toBe(0);
    expect(backfillStopEndTimes({ days: [{ stops: null }] } as any)).toBe(0);
  });

  it('end_time format always HH:mm with zero-padding', () => {
    const itinerary = { days: [{ stops: [{ start_time: '08:00', stay_min: 5 }] }] };
    backfillStopEndTimes(itinerary);
    expect((itinerary.days[0].stops[0] as any).end_time).toBe('08:05');  // not '8:5'
    expect((itinerary.days[0].stops[0] as any).end_time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('plan 4792076e regression — 29/29 stops backfilled', () => {
    // Simulate the actual prod plan structure.
    const itinerary = {
      days: Array.from({ length: 5 }, () => ({
        stops: Array.from({ length: 6 }, () => ({
          start_time: '09:00',
          stay_min: 60,
          // no end_time — the bug
        })),
      })),
    };
    const filled = backfillStopEndTimes(itinerary);
    expect(filled).toBe(30);  // 5 days × 6 stops
    for (const day of itinerary.days) {
      for (const stop of day.stops) {
        expect((stop as any).end_time).toBe('10:00');
      }
    }
  });
});
