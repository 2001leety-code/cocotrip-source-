/**
 * K-pop 공연 목록 SSOT + 소진 감시 크론 회귀 가드 (2026-07-25).
 *
 * 배경: kpopConcerts 데이터가 손 갱신인데 갱신 담당이 코드에 없어, 마지막 공연이 지나면
 *   차터 K-pop 탭이 **아무 안내 없이 빈 화면**이 됐다(2026-07 감사: 10건 중 7건 만료, 잔여 1건).
 *   → JSON SSOT + 매월 1일 감시 크론(api/_crons/kpop-calendar-check.js) 도입.
 *
 * 이 테스트가 지키는 것:
 *   1. 데이터 무결성 — 필수 필드·날짜 형식·가격·지도 URL
 *   2. SSOT 1벌 — 프론트(.ts)가 크론과 **같은 JSON** 을 본다 (2벌 갈라짐 방지)
 *   3. 감시견 생존 — 크론이 실제 파일을 실제로 읽어낸다 (경로/번들 깨지면 실패)
 *   4. 임계값 동작 — 목록이 마르면 needsUpdate 가 켜진다
 */
import { describe, it, expect } from 'vitest';
import rawConcerts from '../../src/data/kpopConcerts.json';
import { KPOP_CONCERTS, getUpcomingConcerts } from '../../src/data/kpopConcerts';
import { kpopCalendarTask, splitByDate } from '../../api/_crons/kpop-calendar-check.js';
import frontSpec from '../../src/data/pricing_spec.json';
import backSpec from '../../api/_pricing_spec.json';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe('kpopConcerts 데이터 무결성', () => {
  it('공연이 1건 이상 있다', () => {
    expect(Array.isArray(rawConcerts)).toBe(true);
    expect(rawConcerts.length).toBeGreaterThan(0);
  });

  it('필수 필드·날짜 형식·가격·지도 URL 이 모두 유효하다', () => {
    for (const c of KPOP_CONCERTS) {
      expect(c.id, 'id').toBeTruthy();
      expect(c.artist, `${c.id}.artist`).toBeTruthy();
      expect(c.venue, `${c.id}.venue`).toBeTruthy();
      expect(c.venueKo, `${c.id}.venueKo`).toBeTruthy();

      expect(Array.isArray(c.dates) && c.dates.length > 0, `${c.id}.dates`).toBe(true);
      for (const d of c.dates) {
        expect(d, `${c.id} 날짜 형식`).toMatch(DATE_RE);
        expect(Number.isNaN(Date.parse(d)), `${c.id} 파싱 가능 날짜`).toBe(false);
      }
      // 날짜는 오름차순이어야 "마지막 날짜 = 종료일" 가정이 성립한다.
      const sorted = [...c.dates].sort();
      expect(c.dates, `${c.id} 날짜 오름차순`).toEqual(sorted);

      expect(c.oneWayPrice, `${c.id}.oneWayPrice`).toBeGreaterThan(0);
      expect(c.roundTripPrice, `${c.id}.roundTripPrice`).toBeGreaterThan(0);
      expect(c.naverMapUrl, `${c.id}.naverMapUrl`).toMatch(/^https:\/\//);

      // 셔틀 운행한다고 표시했으면 픽업 장소가 반드시 있어야 한다(빈 목록 노출 방지).
      if (c.shuttleAvailable) {
        expect(c.pickupPoints.length, `${c.id} 픽업(EN)`).toBeGreaterThan(0);
        expect(c.pickupPointsKo.length, `${c.id} 픽업(KO)`).toBeGreaterThan(0);
      }
    }
  });

  it('id 가 중복되지 않는다', () => {
    const ids = KPOP_CONCERTS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('🔴 표시가 == 청구가 (K-pop 셔틀)', () => {
  // 배너는 공연 데이터의 oneWayPrice/roundTripPrice 를 곱해 **표시**하는데,
  // 백엔드(createPaypalOrder.js:104-110)는 공연과 무관하게 **항상 pricing_spec 의
  // kpop_shuttle 값**으로 청구한다. 둘이 어긋나면 손님이 본 금액과 실제 결제액이 달라진다.
  // 2026-07-25: K-pop 셔틀을 로그인 없는 /charter 에 노출하면서 이 가드를 세운다.
  const ow = (frontSpec as { kpop_shuttle: { price_one_way: number } }).kpop_shuttle.price_one_way;
  const rt = (frontSpec as { kpop_shuttle: { price_round_trip: number } }).kpop_shuttle.price_round_trip;

  it('프론트 spec 과 백엔드 spec 의 셔틀 요금이 같다', () => {
    const b = (backSpec as { kpop_shuttle: { price_one_way: number; price_round_trip: number } }).kpop_shuttle;
    expect(b.price_one_way).toBe(ow);
    expect(b.price_round_trip).toBe(rt);
  });

  it('모든 공연의 표시가가 spec 청구가와 일치한다', () => {
    for (const c of KPOP_CONCERTS) {
      expect(c.oneWayPrice, `${c.id} 편도 표시가≠청구가`).toBe(ow);
      expect(c.roundTripPrice, `${c.id} 왕복 표시가≠청구가`).toBe(rt);
    }
  });
});

describe('SSOT — 프론트와 크론이 같은 파일을 본다', () => {
  it('KPOP_CONCERTS 가 kpopConcerts.json 과 동일하다', () => {
    expect(KPOP_CONCERTS.length).toBe(rawConcerts.length);
    expect(KPOP_CONCERTS.map(c => c.id)).toEqual((rawConcerts as { id: string }[]).map(c => c.id));
  });
});

describe('소진 감시 크론', () => {
  it('감시견이 실제 파일을 읽어낸다 (경로/번들 깨지면 실패)', async () => {
    const r = await kpopCalendarTask(true);
    expect(r.statusCode, `크론이 파일을 못 읽음: ${JSON.stringify(r.body)}`).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.total).toBe(rawConcerts.length);
    expect(r.body.sourcePath).toMatch(/kpopConcerts\.json$/);
  });

  it('크론의 지난공연 판정이 프론트 getUpcomingConcerts 와 일치한다', async () => {
    const r = await kpopCalendarTask(true);
    expect(r.body.upcoming).toBe(getUpcomingConcerts().length);
  });

  it('목록이 마르면 needsUpdate 가 켜진다 (임계값 동작)', () => {
    const todayMs = Date.UTC(2026, 6, 25); // 2026-07-25 기준
    const depleted = [
      { id: 'old', dates: ['2026-01-01'] },
      { id: 'old2', dates: ['2026-02-01'] },
    ];
    const { upcoming, past } = splitByDate(depleted, todayMs);
    expect(upcoming.length).toBe(0);
    expect(past.length).toBe(2);
  });

  it('날짜가 깨진 항목을 지난공연으로 분류하고 표시한다', () => {
    const todayMs = Date.UTC(2026, 6, 25);
    const { upcoming, past } = splitByDate([{ id: 'broken', dates: ['not-a-date'] }], todayMs);
    expect(upcoming.length).toBe(0);
    expect(past[0]._badDate).toBe(true);
  });
});
