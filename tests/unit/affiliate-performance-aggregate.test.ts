import { describe, expect, it } from 'vitest';
import { aggregateAffiliateRows } from '../../api/_shared/affiliatePerformance.js';

describe('aggregateAffiliateRows', () => {
  it('상품과 위치별 노출·클릭·클릭률을 계산한다', () => {
    const result = aggregateAffiliateRows([
      ['affiliate_impression', 'hotel', 'plan_pretrip', 'en', 20],
      ['affiliate_click', 'hotel', 'plan_pretrip', 'en', 4],
      ['affiliate_impression', 'esim', 'home_trip_essentials', 'ko', 10],
      ['affiliate_click', 'esim', 'home_trip_essentials', 'ko', 1],
    ]);

    expect(result.summary).toEqual({ impressions: 30, clicks: 5, ctr: 16.67 });
    expect(result.byProduct).toEqual([
      { key: 'hotel', impressions: 20, clicks: 4, ctr: 20 },
      { key: 'esim', impressions: 10, clicks: 1, ctr: 10 },
    ]);
    expect(result.byPlacement[0]).toEqual({ key: 'plan_pretrip', impressions: 20, clicks: 4, ctr: 20 });
  });

  it('불량 행·알 수 없는 이벤트·음수 합계를 버린다', () => {
    const result = aggregateAffiliateRows([
      null,
      ['pageview', 'hotel', 'x', 'en', 99],
      ['affiliate_click', '', '', '', -2],
      ['affiliate_click', null, null, null, 3],
    ]);
    expect(result.summary).toEqual({ impressions: 0, clicks: 3, ctr: 0 });
    expect(result.byProduct[0].key).toBe('unknown');
  });

  it('입력이 없으면 빈 집계를 반환한다', () => {
    expect(aggregateAffiliateRows(undefined)).toEqual({
      summary: { impressions: 0, clicks: 0, ctr: 0 },
      byProduct: [],
      byPlacement: [],
      byLanguage: [],
    });
  });
});
