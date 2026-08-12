// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  allocateMoodShareCostByCourse,
  copyTextWithFallback,
  formatMoodBookingShareText,
  getMoodShareTollPresentation,
  type MoodBookingShareData,
  type MoodBookingShareStop,
} from '../../src/lib/moodBookingShare';

function expectedData(): MoodBookingShareData {
  return {
    bookingRef: 'M-1234',
    phase: 'expected',
    date: '2026-08-15',
    startTime: '09:30',
    influencerName: '홍길동',
    serviceLabel: '차량',
    durationHours: 4,
    stops: [
      { address: '서울역', label: '출발', time: '09:30', moodPercentage: 100 },
      { address: '성수동', label: '촬영', time: '11:00', moodPercentage: 50 },
      { address: '인천공항 T2', label: '도착', time: '15:00', moodPercentage: 0 },
    ],
    route: { km: 68, durationMin: 85, path: null, points: null },
    costs: {
      expected: {
        baseKRW: 120_000,
        distanceSurchargeKRW: 40_800,
        tollKRW: 7_200,
        totalKRW: 168_000,
      },
    },
    mapUrl: 'https://map.naver.com/example',
    note: 'T2 출국장 하차',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('MOOD 예약 공유 문구', () => {
  it('정산 전에는 상세 예상 비용과 번호 코스별 비율·각자 금액을 복사한다', () => {
    const data = expectedData() as MoodBookingShareData & { createdByEmail: string; runningBalanceKRW: number };
    data.createdByEmail = 'staff@example.com';
    data.runningBalanceKRW = 9_999_999;
    const text = formatMoodBookingShareText(data);

    expect(text).toContain('[MOOD 이동 예상 안내]');
    expect(text).toContain('탑승 인플루언서: 홍길동');
    expect(text).toContain('일시: 2026. 8. 15. (토) 09:30');
    expect(text).toContain('1. [출발] 서울역 · 09:30 · MOOD 100% 56,000원 · 인플루언서(홍길동) 0% 0원');
    expect(text).toContain('2. [촬영] 성수동 · 11:00 · MOOD 50% 28,000원 · 인플루언서(홍길동) 50% 28,000원');
    expect(text).toContain('이동: 68km · 약 85분');
    expect(text).toContain('- 예상 톨비: 7,200원');
    expect(text).toContain('예상 코스별 비용 분담');
    expect(text).toContain('- 계산: 168,000원 ÷ 3코스');
    expect(text).toContain('- MOOD 부담 합계: 84,000원');
    expect(text).toContain('- 인플루언서(홍길동) 부담 합계: 84,000원');
    expect(text).toContain('동선 지도: https://map.naver.com/example');
    expect(text).toContain('전달 메모: T2 출국장 하차');
    expect(text).not.toContain('staff@example.com');
    expect(text).not.toContain('9,999,999');
    expect(text).not.toContain('잔액');
  });

  it('정산 후에는 예약 예상과 최종 비용을 함께 남기고 실제 톨비 상태를 밝힌다', () => {
    const data = expectedData();
    data.phase = 'final';
    data.costs.final = {
      baseKRW: 120_000,
      distanceSurchargeKRW: 40_800,
      tollKRW: 0,
      tollMode: 'none',
      tollNote: '예상 톨비 미지불',
      adjustmentKRW: 0,
      totalKRW: 160_800,
    };
    const text = formatMoodBookingShareText(data);

    expect(text).toContain('[MOOD 이동 정산 안내]');
    expect(text).toContain('예약 예상 비용');
    expect(text).toContain('최종 정산 비용');
    expect(text).toContain('- 실제 톨비: 0원 (예상 톨비 미지불)');
    expect(text).not.toContain('기타 조정');
    expect(text).toContain('- 최종 합계: 160,800원');
    expect(text).toContain('최종 코스별 비용 분담');
    expect(text).toContain('2. [촬영] 성수동 · 11:00 · MOOD 50% 26,800원 · 인플루언서(홍길동) 50% 26,800원');
    expect(text).toContain('- MOOD 부담 합계: 80,400원');
    expect(text).toContain('- 인플루언서(홍길동) 부담 합계: 80,400원');
  });

  it('수동 금액 조정은 톨비 사유와 분리해 복사한다', () => {
    const data = expectedData();
    data.phase = 'final';
    data.costs.final = {
      tollKRW: 5_000,
      tollMode: 'actual',
      tollNote: '실제 톨게이트 영수증',
      adjustmentKRW: 10_000,
      adjustmentReason: '추가 주차비',
      totalKRW: 175_000,
    };

    const text = formatMoodBookingShareText(data);
    expect(text).toContain('- 실제 톨비: 5,000원 (실제 톨게이트 영수증)');
    expect(text).toContain('- 기타 조정: +10,000원 (추가 주차비)');
  });

  it('5코스·10만원에서 100·50·33·0·67 비율을 코스별로 반영한다', () => {
    const stops: MoodBookingShareStop[] = [100, 50, 33, 0, 67]
      .map((moodPercentage, index) => ({ address: `코스 ${index + 1}`, moodPercentage }));
    const result = allocateMoodShareCostByCourse(100_000, stops);

    expect(result.basePerCourseKRW).toBe(20_000);
    expect(result.courses.map((course) => course.amountKRW)).toEqual([20_000, 20_000, 20_000, 20_000, 20_000]);
    expect(result.courses.map((course) => course.moodKRW)).toEqual([20_000, 10_000, 6_600, 0, 13_400]);
    expect(result.mood).toEqual({ totalKRW: 50_000 });
    expect(result.influencer).toEqual({ totalKRW: 50_000 });
  });

  it('원 단위 나머지는 마지막 코스에 배정하고 코스 합은 전체 금액과 정확히 같다', () => {
    const stops: MoodBookingShareStop[] = [
      { address: '코스 1', payer: 'mood' },
      { address: '코스 2', payer: 'influencer' },
      { address: '코스 3', payer: 'influencer' },
    ];
    const result = allocateMoodShareCostByCourse(10_001, stops);

    expect(result.basePerCourseKRW).toBe(3_333);
    expect(result.remainderKRW).toBe(2);
    expect(result.courses.map((course) => course.amountKRW)).toEqual([3_333, 3_333, 3_335]);
    expect(result.courses.reduce((sum, course) => sum + course.amountKRW, 0)).toBe(10_001);
    expect(result.mood.totalKRW + result.influencer.totalKRW).toBe(10_001);
  });

  it('명시 상태가 없어도 예상·실제 톨비 차이로 안내를 구분한다', () => {
    expect(getMoodShareTollPresentation(7_200, { tollKRW: 7_200, totalKRW: 1 }).detail).toBe('예상대로 지불');
    expect(getMoodShareTollPresentation(7_200, { tollKRW: 0, totalKRW: 1 }).detail).toBe('미지불');
    expect(getMoodShareTollPresentation(7_200, { tollKRW: 5_500, totalKRW: 1 }).detail).toBe('실제 금액 반영');
  });
});

describe('MOOD 예약 공유 클립보드', () => {
  it('Clipboard API를 먼저 사용한다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await expect(copyTextWithFallback('상세 예약 내용')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('상세 예약 내용');
  });

  it('Clipboard API가 막히면 숨은 textarea와 execCommand로 복사하고 흔적을 지운다', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('권한 거절'));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await expect(copyTextWithFallback('모바일 폴백')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('복사할 내용이 비어 있으면 DOM을 만들지 않고 실패를 반환한다', async () => {
    await expect(copyTextWithFallback('')).resolves.toBe(false);
    expect(document.body.querySelector('textarea')).toBeNull();
  });
});
