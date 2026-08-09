/**
 * K-pop 공연 "지난 공연" 판정은 **KST 고정**이다 (2026-08-09).
 *
 * 배경: 공연은 전부 한국에서 열린다. 그런데 프론트 `getUpcomingConcerts()` 는
 *   `new Date()` + `setHours()` 로 **손님 브라우저의 시간대**를 기준으로 판정했고,
 *   크론 `api/_crons/kpop-calendar-check.js` 는 KST 로 판정했다. 둘이 갈라진다.
 *
 * 실제 손님 피해 (CI 실패는 이 버그의 그림자일 뿐):
 *   · 뉴욕(UTC-4) 손님 — `new Date('2026-08-08')` 은 UTC 자정이라 현지로는 08-07 이 되고,
 *     `setHours(23,59,59)` 가 **하루 앞 날**에 찍힌다. 한국에서 아직 열리는 공연이
 *     차터 K-pop 탭에서 **하루 일찍 사라진다**.
 *   · 런던/UTC 손님 — KST 로는 이미 끝난 어제 공연이 **하루 더 남아 보인다**.
 *
 * CI 는 UTC 러너라 `kpop-calendar-watchdog.test.ts` 의 "크론 == 프론트" 가드가
 *   UTC 15:00~24:00 사이에 마지막 날짜가 오늘인 공연이 있으면 빨강이 됐다
 *   (2026-08-08 15:17Z 실패: expected 9 to be 10).
 *
 * 이 테스트는 **벽시계·머신 시간대에 의존하지 않는다** — 시계와 TZ 를 직접 고정한다.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { getUpcomingConcerts } from '../../src/data/kpopConcerts';
import { kpopCalendarTask } from '../../api/_crons/kpop-calendar-check.js';

/** 마지막 공연일이 2026-08-08 인 항목이 딱 1건 있다 — 이 테스트의 경계 재료. */
const BOUNDARY_DATE = '2026-08-08';

/** 손님 브라우저가 있을 법한 시간대. 한국(+9)·UTC(0)·미주(음수)·+14 극단까지. */
const ZONES = ['UTC', 'Asia/Seoul', 'America/New_York', 'Europe/London', 'Pacific/Kiritimati'];

const ORIGINAL_TZ = process.env.TZ;

/** 시계와 시간대를 동시에 고정하고 함수를 돌린다. */
function at<T>(tz: string, iso: string, fn: () => T): T {
  process.env.TZ = tz;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  try {
    return fn();
  } finally {
    vi.useRealTimers();
    process.env.TZ = ORIGINAL_TZ;
  }
}

afterEach(() => { vi.useRealTimers(); process.env.TZ = ORIGINAL_TZ; });
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

describe('getUpcomingConcerts — 판정 기준은 KST (손님 시간대 아님)', () => {
  it('데이터 전제: 마지막 공연일이 2026-08-08 인 공연이 정확히 1건', async () => {
    const { KPOP_CONCERTS } = await import('../../src/data/kpopConcerts');
    const onBoundary = KPOP_CONCERTS.filter(c => c.dates[c.dates.length - 1] === BOUNDARY_DATE);
    expect(onBoundary.length, '경계 재료가 사라지면 아래 기대값을 다시 계산해야 한다').toBe(1);
  });

  // 2026-08-08T14:59:00Z = KST 2026-08-08 23:59 — 경계 공연이 **한국에서 아직 오늘**.
  it.each(ZONES)('[%s] KST 23:59 에는 당일 공연이 아직 남아 있다', (tz) => {
    const all = at(tz, '2026-08-08T14:59:00Z', () => getUpcomingConcerts());
    expect(all.some(c => c.dates[c.dates.length - 1] === BOUNDARY_DATE),
      `${tz}: 한국에서 오늘인 공연이 목록에서 빠졌다`).toBe(true);
  });

  // 2026-08-08T15:17:19Z = KST 2026-08-09 00:17 — CI 가 실제로 실패한 그 순간.
  it.each(ZONES)('[%s] KST 자정을 넘기면 어제 공연이 빠진다', (tz) => {
    const all = at(tz, '2026-08-08T15:17:19Z', () => getUpcomingConcerts());
    expect(all.some(c => c.dates[c.dates.length - 1] === BOUNDARY_DATE),
      `${tz}: 한국에서 끝난 공연이 아직 남아 있다`).toBe(false);
  });

  it.each(ZONES)('[%s] 같은 순간에 시간대가 달라도 결과 수가 같다', (tz) => {
    const seoul = at('Asia/Seoul', '2026-08-08T15:17:19Z', () => getUpcomingConcerts().length);
    const here = at(tz, '2026-08-08T15:17:19Z', () => getUpcomingConcerts().length);
    expect(here, `${tz}: 손님 시간대에 따라 목록이 달라진다`).toBe(seoul);
  });
});

describe('크론 == 프론트 (시간대 무관)', () => {
  // kpop-calendar-watchdog.test.ts 의 같은 가드가 **UTC 러너에서만** 깨졌다.
  // 여기서는 시간대·시각을 고정해 두 구현이 언제나 같은 답을 내는지 못 박는다.
  const MOMENTS = ['2026-08-08T14:59:00Z', '2026-08-08T15:17:19Z', '2026-08-09T02:00:00Z'];

  for (const tz of ZONES) {
    for (const iso of MOMENTS) {
      it(`[${tz}] ${iso} — 크론 upcoming == 프론트 upcoming`, async () => {
        process.env.TZ = tz;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(iso));
        try {
          const r = await kpopCalendarTask(true);
          expect(r.statusCode).toBe(200);
          expect(r.body.upcoming).toBe(getUpcomingConcerts().length);
        } finally {
          vi.useRealTimers();
          process.env.TZ = ORIGINAL_TZ;
        }
      });
    }
  }
});
