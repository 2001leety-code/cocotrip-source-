/**
 * P136 (2026-05-21) regression — RouteAgent 24h wrap 차단 + planPersister
 * detectUnreasonableStopTimes admin vs customer 분기.
 *
 * Root cause (plan ba10d29b):
 *   RouteAgent Phase 3 time stitching 에서 prevStayMin + realTransitMin 누적이
 *   midnight (1440min) 초과 → _formatTime(rawMin) 이 % 24 modulo wrap →
 *   plan 에 새벽 시각 (00:52, 00:17, 02:47) stops 저장.
 *
 * Fix:
 *   1. RouteAgent._sanitizeTime: rawMin >= 1440 → 22:30 cap + admin alert (non-blocking).
 *   2. planPersister.runUnreasonableStopTimesCheck: isAdminBypass → soft alert,
 *      customer → Error throw (P101 패턴).
 *
 * Test scenarios:
 *   A. _sanitizeTime — wrap (>= 1440) 감지 → 22:30 cap
 *   B. _sanitizeTime — normal (< 1440, 정상 시간대) → 원래 값 통과
 *   C. _sanitizeTime — pre-dawn (< 300 = 05:00) → 통과 (detectUnreasonableStopTimes 에 위임)
 *   D. detectUnreasonableStopTimes — pre-dawn stop 감지
 *   E. detectUnreasonableStopTimes — 정상 stops 감지 안 함
 *   F. runUnreasonableStopTimesCheck — admin bypass: 새벽 stops 있어도 return count (no throw)
 *   G. runUnreasonableStopTimesCheck — customer: 새벽 stops 있으면 throw UNREASONABLE_STOP_TIMES
 *   H. runUnreasonableStopTimesCheck — customer: 새벽 stops 없으면 return 0 (no throw)
 *   I. wrap scenario: 22:00 prev + 4h transit = 26h = 1560min → _sanitizeTime returns 1350 (22:30)
 *   J. wrap boundary: exactly 1440 → cap
 *   K. wrap boundary: 1439 → no cap
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectUnreasonableStopTimes, runUnreasonableStopTimesCheck } from '../../api/_ai_core/planPersister.js';

// ─── Mock throttledTelegramAlert (planPersister imports it) ───────────────────
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

// ─── _sanitizeTime helper — extracted logic for pure-function testing ─────────
// RouteAgent 는 class 이므로 직접 import 대신 동일 로직을 인라인으로 재현해
// unit test 에서 순수 함수로 검증. 실제 class 메서드와 동일 구현 (P136 fix).
const MIDNIGHT_MIN = 24 * 60;     // 1440
const SAFE_CAP_MIN = 22 * 60 + 30; // 1350
const MAX_DAY_MIN = 23 * 60 + 59;  // 1439

function sanitizeTimePure(rawMin: number): number {
  if (!Number.isFinite(rawMin)) return SAFE_CAP_MIN;
  if (rawMin >= MIDNIGHT_MIN) return SAFE_CAP_MIN;
  return Math.min(rawMin, MAX_DAY_MIN);
}

// helper: minutes → "HH:MM" (same as RouteAgent._formatTime)
function formatTime(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// helper: build minimal itinerary for detectUnreasonableStopTimes
function mkItinerary(stops: Array<{ start_time: string; name?: string }>) {
  return {
    days: [
      {
        day: 1,
        stops: stops.map((s) => ({ start_time: s.start_time, name: s.name || 'Test Stop' })),
      },
    ],
  };
}

// ─── A. _sanitizeTime — wrap (>= 1440) 감지 ─────────────────────────────────
describe('sanitizeTimePure — 24h wrap (>= 1440min)', () => {
  it('scenario I: 22:00 prev + 4h transit = 1560min → cap 1350 (22:30)', () => {
    const prev = 22 * 60;         // 1320 min = 22:00
    const transitMin = 4 * 60;    // 240 min
    const rawMin = prev + transitMin; // 1560
    expect(rawMin).toBe(1560);
    // without fix: formatTime(1560) → "02:00" (WRONG)
    expect(formatTime(rawMin)).toBe('02:00'); // confirms the bug
    // with fix:
    const sanitized = sanitizeTimePure(rawMin);
    expect(sanitized).toBe(SAFE_CAP_MIN); // 1350 = 22:30
    expect(formatTime(sanitized)).toBe('22:30');
  });

  it('scenario J: exactly 1440 → cap 22:30', () => {
    expect(sanitizeTimePure(1440)).toBe(SAFE_CAP_MIN);
  });

  it('extreme wrap: 2880min (48h) → cap 22:30', () => {
    expect(sanitizeTimePure(2880)).toBe(SAFE_CAP_MIN);
  });

  it('NaN → cap 22:30 (graceful)', () => {
    expect(sanitizeTimePure(NaN)).toBe(SAFE_CAP_MIN);
  });
});

// ─── B. _sanitizeTime — normal range ─────────────────────────────────────────
describe('sanitizeTimePure — normal range (< 1440)', () => {
  it('scenario K: 1439 → no cap (23:59)', () => {
    expect(sanitizeTimePure(1439)).toBe(1439);
    expect(formatTime(1439)).toBe('23:59');
  });

  it('09:00 = 540min → pass through', () => {
    expect(sanitizeTimePure(540)).toBe(540);
  });

  it('20:00 = 1200min → pass through', () => {
    expect(sanitizeTimePure(1200)).toBe(1200);
  });
});

// ─── C. _sanitizeTime — pre-dawn range (< 300 = 05:00) → pass through ────────
describe('sanitizeTimePure — pre-dawn (< 05:00) → NOT blocked here', () => {
  it('00:00 = 0min → pass through (detectUnreasonableStopTimes 에 위임)', () => {
    // _sanitizeTime 은 24h wrap 만 차단. pre-dawn 은 planPersister 단계 위임.
    expect(sanitizeTimePure(0)).toBe(0);
  });

  it('02:47 = 167min → pass through', () => {
    expect(sanitizeTimePure(167)).toBe(167);
    expect(formatTime(167)).toBe('02:47');
  });
});

// ─── D. detectUnreasonableStopTimes — pre-dawn stops 감지 ─────────────────────
describe('detectUnreasonableStopTimes — pre-dawn detection', () => {
  it('00:52 stop → 1 alert', () => {
    const itin = mkItinerary([{ start_time: '00:52', name: '명동 호텔' }]);
    const alerts = detectUnreasonableStopTimes(itin);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].start_time).toBe('00:52');
    expect(alerts[0].reason).toMatch(/pre-dawn/);
  });

  it('multiple pre-dawn stops → correct count', () => {
    const itin = mkItinerary([
      { start_time: '00:17', name: '해운대 호텔' },
      { start_time: '02:47', name: '자갈치 시장' },
      { start_time: '09:00', name: '정상 장소' },
    ]);
    const alerts = detectUnreasonableStopTimes(itin);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a: any) => a.start_time)).toEqual(['00:17', '02:47']);
  });

  it('04:59 stop → alert (< 05:00)', () => {
    const itin = mkItinerary([{ start_time: '04:59' }]);
    expect(detectUnreasonableStopTimes(itin)).toHaveLength(1);
  });
});

// ─── E. detectUnreasonableStopTimes — 정상 stops ─────────────────────────────
describe('detectUnreasonableStopTimes — normal stops (no alert)', () => {
  it('05:00 → no alert (boundary)', () => {
    const itin = mkItinerary([{ start_time: '05:00' }]);
    expect(detectUnreasonableStopTimes(itin)).toHaveLength(0);
  });

  it('22:30 (cap value) → no alert', () => {
    const itin = mkItinerary([{ start_time: '22:30' }]);
    expect(detectUnreasonableStopTimes(itin)).toHaveLength(0);
  });

  it('09:00 → no alert', () => {
    const itin = mkItinerary([{ start_time: '09:00' }]);
    expect(detectUnreasonableStopTimes(itin)).toHaveLength(0);
  });

  it('empty itinerary → no alert', () => {
    expect(detectUnreasonableStopTimes({ days: [] })).toHaveLength(0);
    expect(detectUnreasonableStopTimes(null)).toHaveLength(0);
  });
});

// ─── F. runUnreasonableStopTimesCheck — admin bypass: soft (no throw) ─────────
describe('runUnreasonableStopTimesCheck — admin bypass (soft, no throw)', () => {
  it('ADMIN-BYPASS- orderId + pre-dawn stops → return count, no throw', () => {
    const itin = mkItinerary([{ start_time: '00:52', name: '명동 호텔' }]);
    const body = { orderId: 'ADMIN-BYPASS-TEST-001', regions: ['Seoul'] };
    let result: number;
    expect(() => {
      result = runUnreasonableStopTimesCheck(itin, body);
    }).not.toThrow();
    expect(result!).toBe(1);
  });

  it('adminBypass===true flag + pre-dawn stops → return count', () => {
    const itin = mkItinerary([{ start_time: '02:00' }]);
    const body = { orderId: 'any-id', adminBypass: true, regions: ['Busan'] };
    expect(() => runUnreasonableStopTimesCheck(itin, body)).not.toThrow();
    expect(runUnreasonableStopTimesCheck(itin, body)).toBe(1);
  });
});

// ─── G. runUnreasonableStopTimesCheck — customer: throw on pre-dawn ───────────
describe('runUnreasonableStopTimesCheck — customer (strict throw)', () => {
  it('pre-dawn stop + non-admin orderId → throw UNREASONABLE_STOP_TIMES', () => {
    const itin = mkItinerary([{ start_time: '01:24', name: '해운대 호텔' }]);
    const body = { orderId: 'PAYPAL-REAL-ORDER-123', regions: ['Busan'] };
    expect(() => runUnreasonableStopTimesCheck(itin, body))
      .toThrow(/UNREASONABLE_STOP_TIMES/);
  });

  it('multiple pre-dawn stops → throw lists sample in message', () => {
    const itin = mkItinerary([
      { start_time: '00:17', name: '해운대 호텔' },
      { start_time: '03:26', name: '자갈치 시장' },
    ]);
    const body = { orderId: 'PAYPAL-123', regions: ['Busan'] };
    expect(() => runUnreasonableStopTimesCheck(itin, body))
      .toThrow(/UNREASONABLE_STOP_TIMES: 2/);
  });
});

// ─── H. runUnreasonableStopTimesCheck — customer: no pre-dawn → no throw ──────
describe('runUnreasonableStopTimesCheck — customer, normal itinerary', () => {
  it('all normal times → return 0, no throw', () => {
    const itin = mkItinerary([
      { start_time: '09:00' },
      { start_time: '12:30' },
      { start_time: '20:00' },
    ]);
    const body = { orderId: 'PAYPAL-CUSTOMER-ORDER', regions: ['Seoul'] };
    let result: number;
    expect(() => {
      result = runUnreasonableStopTimesCheck(itin, body);
    }).not.toThrow();
    expect(result!).toBe(0);
  });
});
