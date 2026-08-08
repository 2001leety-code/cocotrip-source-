/**
 * "오늘" 경계 = **KST 자정의 실제 epoch** — 프론트·크론 공통 계약 (2026-08-09).
 *
 * 배경(#1263 후속): #1263 은 손님 브라우저 시간대 의존을 없앴지만, 양쪽 모두 오늘 경계를
 *   `Date.UTC(kstY, kstM, kstD)` 로 뒀다 — KST 달력일을 **UTC 자정**에 찍은 가짜 epoch 다.
 *   비교 상대인 `Date.parse('<날짜>T23:59:59+09:00')` 는 **실제** epoch 라, 한 비교식 안에서
 *   시계 두 개를 섞은 꼴이었다.
 *
 * 지금 답이 맞는 건 우연이다:
 *   · 가짜 경계는 실제 KST 자정보다 정확히 9시간 **뒤**에 있다.
 *   · 그런데 비교 상대가 "그 날 23:59:59" 라 9시간 이상의 여유를 만들어 상쇄해 준다.
 *   → 여유가 사라지는 순간 당일 공연이 사라진다. 예: 종료 시각 표현을 "그 날 00:00" 으로
 *     바꾸는 흔한 리팩터 — 오늘 00:00 KST 는 가짜 경계보다 9시간 **앞**이라 곧바로 탈락한다.
 *
 * 그래서 여기서 못 박는 것:
 *   1. 오늘 경계 == `Date.parse('<KST 오늘>T00:00:00+09:00')` — 양쪽 다 실제 epoch
 *   2. 프론트 경계 == 크론 경계 (코드는 두 벌, 값은 한 개)
 *   3. 오늘 KST 달력일의 **첫 밀리초**도 경계 이상 — 위 함정의 직접 방어
 *   4. KST 자정 앞뒤 1ms — 당일 공연은 23:59:59 KST 까지 남고 그 다음 ms 에 빠진다
 *   5. runwayDays = KST 달력일 차이 (실제 KST 자정 기준)
 *
 * 벽시계·머신 시간대에 의존하지 않는다 — 시계(`vi.setSystemTime`)와 `process.env.TZ` 를 고정한다.
 * (구현 자체가 `Date.now` + 명시 오프셋 파싱뿐이라 머신 TZ 와 무관해야 정상이다.)
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import rawConcerts from '../../src/data/kpopConcerts.json';
import { getUpcomingConcerts, todayKstMs } from '../../src/data/kpopConcerts';
import { kpopCalendarTask, todayKstMs as cronTodayKstMs } from '../../api/_crons/kpop-calendar-check.js';

const DAY_MS = 86400000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 마지막 공연일이 이 날짜인 항목이 딱 1건 있다 — 경계 재료. */
const BOUNDARY_DATE = '2026-08-08';

/** KST 2026-08-09 00:00:00.000 — 경계 정각. */
const KST_MIDNIGHT = '2026-08-08T15:00:00.000Z';
/** 그 1ms 전 = KST 2026-08-08 23:59:59.999 — 경계 공연이 한국에서 아직 오늘. */
const KST_JUST_BEFORE = '2026-08-08T14:59:59.999Z';

const ZONES = ['UTC', 'Asia/Seoul', 'America/New_York'];
const MOMENTS = [KST_JUST_BEFORE, KST_MIDNIGHT, '2026-08-09T02:00:00.000Z'];

const ORIGINAL_TZ = process.env.TZ;

/** 원래 TZ 로 되돌린다. 원래 미설정이면 **지워야** 한다 — 대입하면 문자열 'undefined' 가 박힌다. */
function restoreTz() {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
}

/** 시계가 멈추기 **전에** 계산한 기대값 — 오라클이 가짜 타이머에 오염되지 않게. */
function expectedBoundary(iso: string): number {
  const kstDay = new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 10);
  return Date.parse(`${kstDay}T00:00:00+09:00`);
}

/** 시계와 시간대를 동시에 고정하고 함수를 돌린다. */
function at<T>(tz: string, iso: string, fn: () => T): T {
  process.env.TZ = tz;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  try {
    return fn();
  } finally {
    vi.useRealTimers();
    restoreTz();
  }
}

/** at() 의 async 판 — 크론 task 는 fs 를 읽으므로 await 가 필요하다. */
async function atAsync<T>(tz: string, iso: string, fn: () => Promise<T>): Promise<T> {
  process.env.TZ = tz;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
    restoreTz();
  }
}

afterEach(() => { vi.useRealTimers(); restoreTz(); });
afterAll(restoreTz);

describe('오늘 경계는 KST 자정의 실제 epoch 다', () => {
  it('데이터 전제: 마지막 공연일이 2026-08-08 인 공연이 정확히 1건', () => {
    const onBoundary = (rawConcerts as { dates: string[] }[])
      .filter(c => c.dates[c.dates.length - 1] === BOUNDARY_DATE);
    expect(onBoundary.length, '경계 재료가 사라지면 아래 기대값을 다시 계산해야 한다').toBe(1);
  });

  it('KST 자정 정각에는 경계 == 지금 (UTC-자정 가짜 epoch 이면 9시간 어긋난다)', () => {
    at('UTC', KST_MIDNIGHT, () => {
      expect(todayKstMs(), '프론트 경계').toBe(Date.parse(KST_MIDNIGHT));
    });
  });

  for (const tz of ZONES) {
    for (const iso of MOMENTS) {
      it(`[${tz}] ${iso} — 프론트 경계 = Date.parse('<KST 오늘>T00:00:00+09:00')`, () => {
        const want = expectedBoundary(iso);
        at(tz, iso, () => {
          expect(todayKstMs(), '가짜 epoch 면 정확히 9시간 크다').toBe(want);
        });
      });

      it(`[${tz}] ${iso} — 크론 경계 == 프론트 경계 (코드 두 벌, 값 하나)`, () => {
        at(tz, iso, () => {
          expect(cronTodayKstMs(), '두 구현이 갈라졌다').toBe(todayKstMs());
        });
      });
    }
  }

  it.each(ZONES)('[%s] 오늘 KST 달력일의 첫 밀리초도 경계 이상이다', (tz) => {
    at(tz, '2026-08-09T02:00:00.000Z', () => {  // KST 2026-08-09 11:00
      const firstMsOfKstToday = Date.parse('2026-08-09T00:00:00+09:00');
      expect(
        firstMsOfKstToday,
        '경계가 KST 자정보다 뒤면, 종료 시각을 "그 날 00:00" 으로 바꾸는 순간 당일 공연이 사라진다',
      ).toBeGreaterThanOrEqual(todayKstMs());
    });
  });
});

describe('당일 공연은 23:59:59 KST 까지 남는다 (1ms 경계)', () => {
  const lastMsOfBoundaryConcert = Date.parse(`${BOUNDARY_DATE}T23:59:59+09:00`);

  it.each(ZONES)('[%s] KST 23:59:59.999 — 당일 공연이 아직 목록에 있다', (tz) => {
    const kept = at(tz, KST_JUST_BEFORE, () =>
      getUpcomingConcerts().some(c => c.dates[c.dates.length - 1] === BOUNDARY_DATE));
    expect(kept, `${tz}: 한국에서 오늘인 공연이 빠졌다`).toBe(true);
  });

  it.each(ZONES)('[%s] KST 00:00:00.000 — 어제가 된 공연이 빠진다', (tz) => {
    const kept = at(tz, KST_MIDNIGHT, () =>
      getUpcomingConcerts().some(c => c.dates[c.dates.length - 1] === BOUNDARY_DATE));
    expect(kept, `${tz}: 한국에서 끝난 공연이 아직 남아 있다`).toBe(false);
  });

  it('공연 종료(23:59:59 KST)와 다음날 경계 사이는 정확히 1초다', () => {
    at('UTC', KST_MIDNIGHT, () => {
      expect(todayKstMs() - lastMsOfBoundaryConcert).toBe(1000);
    });
  });

  it.each(ZONES)('[%s] 경계 앞뒤 1ms 에서 크론 upcoming == 프론트 upcoming', async (tz) => {
    for (const iso of [KST_JUST_BEFORE, KST_MIDNIGHT]) {
      const r = await atAsync(tz, iso, async () => {
        const cron = await kpopCalendarTask(true);
        return { cron, front: getUpcomingConcerts().length };
      });
      expect(r.cron.statusCode).toBe(200);
      expect(r.cron.body.upcoming, `${tz} ${iso}: 크론과 프론트가 갈라졌다`).toBe(r.front);
    }
  });
});

describe('runwayDays = KST 달력일 차이', () => {
  /** 독립 오라클: 두 KST 자정(실제 epoch) 사이의 날짜 수. 한국은 서머타임이 없어 정수로 떨어진다. */
  function kstDaysBetween(fromDate: string, toDate: string): number {
    return (Date.parse(`${toDate}T00:00:00+09:00`) - Date.parse(`${fromDate}T00:00:00+09:00`)) / DAY_MS;
  }

  const maxLastDate = (rawConcerts as { dates: string[] }[])
    .map(c => c.dates[c.dates.length - 1])
    .reduce((a, b) => (b > a ? b : a));

  it('KST 오늘부터 마지막 공연일까지의 날짜 수와 같다', async () => {
    const want = kstDaysBetween('2026-08-09', maxLastDate);
    const r = await atAsync('UTC', KST_MIDNIGHT, () => kpopCalendarTask(true));
    expect(r.statusCode).toBe(200);
    expect(Number.isInteger(want), '오라클이 정수가 아니면 날짜 데이터가 깨진 것').toBe(true);
    expect(r.body.runwayDays).toBe(want);
  });

  it('KST 자정 1ms 전에는 하루 더 남아 있다', async () => {
    const want = kstDaysBetween('2026-08-08', maxLastDate);
    const r = await atAsync('UTC', KST_JUST_BEFORE, () => kpopCalendarTask(true));
    expect(r.body.runwayDays, 'KST 자정을 넘길 때 정확히 1 줄어야 한다').toBe(want);
  });

  it.each(ZONES)('[%s] 같은 순간이면 머신 시간대가 달라도 runwayDays 가 같다', async (tz) => {
    const seoul = await atAsync('Asia/Seoul', KST_MIDNIGHT, () => kpopCalendarTask(true));
    const here = await atAsync(tz, KST_MIDNIGHT, () => kpopCalendarTask(true));
    expect(here.body.runwayDays, `${tz}: 머신 시간대에 따라 달라진다`).toBe(seoul.body.runwayDays);
  });
});
