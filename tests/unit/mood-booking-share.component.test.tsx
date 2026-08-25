// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MoodBookingCopyButton,
  MoodBookingShareCard,
} from '../../src/components/mood/MoodBookingShareCard';
import { MoodCourseShareEditor } from '../../src/components/mood/MoodCourseShareEditor';
import type { MoodBookingShareData } from '../../src/lib/moodBookingShare';

function shareData(phase: 'expected' | 'final' = 'expected'): MoodBookingShareData {
  return {
    bookingRef: 'M-20260815-01',
    phase,
    date: '2026-08-15',
    startTime: '09:30',
    influencerName: '코코',
    serviceLabel: '차량',
    durationHours: 4,
    stops: [
      { address: '서울역 1번 출구', moodPercentage: 100 },
      { address: '성수동 촬영장', label: '촬영', moodPercentage: 50 },
      { address: '인천공항 제2터미널', moodPercentage: 0 },
    ],
    // path/좌표가 없어도 주소 목록과 비용이 남아야 한다.
    route: { km: 68, durationMin: 85, path: null, points: null },
    costs: {
      expected: {
        baseKRW: 120_000,
        distanceSurchargeKRW: 40_800,
        tollKRW: 7_200,
        totalKRW: 168_000,
      },
      final: phase === 'final' ? {
        baseKRW: 120_000,
        distanceSurchargeKRW: 40_800,
        tollKRW: 0,
        tollMode: 'none',
        tollNote: '하이패스 비용 미발생',
        adjustmentKRW: 0,
        totalKRW: 160_800,
      } : null,
    },
    note: '출국장 앞에서 연락해 주세요.',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('MoodBookingShareCard', () => {
  it('지도 좌표가 없어도 번호 주소·거리·예상 비용·코스별 비율·메모를 모두 유지한다', () => {
    render(<MoodBookingShareCard data={shareData()} />);

    expect(screen.getByText('이동 예약 안내')).toBeInTheDocument();
    expect(screen.getByText('코코')).toBeInTheDocument();
    expect(screen.getByText('68km · 약 85분')).toBeInTheDocument();
    expect(screen.getByTestId('mood-share-map-fallback')).toBeInTheDocument();
    expect(screen.getByText('서울역 1번 출구')).toBeInTheDocument();
    expect(screen.getByText('성수동 촬영장')).toBeInTheDocument();
    expect(screen.getByText('인천공항 제2터미널')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '예약 예상 비용' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '최종 정산 비용' })).not.toBeInTheDocument();
    expect(screen.getByText('예상 톨비')).toBeInTheDocument();
    expect(screen.getByText('MOOD 100% · 56,000원')).toBeInTheDocument();
    expect(screen.getByText('MOOD 50% · 28,000원')).toBeInTheDocument();
    expect(screen.getByText('인플루언서(코코) 50% · 28,000원')).toBeInTheDocument();
    expect(screen.getByText('MOOD 부담 합계')).toBeInTheDocument();
    expect(screen.getByText('인플루언서(코코) 부담 합계')).toBeInTheDocument();
    expect(screen.getAllByText('84,000원')).toHaveLength(2);
    expect(screen.getByRole('region', { name: '예상 코스별 비용 분담' })).toBeInTheDocument();
    expect(screen.getByText('출국장 앞에서 연락해 주세요.')).toBeInTheDocument();
  });

  it('정산 완료 카드는 예상·최종 내역, 미지불 톨비, 최종 코스별 부담 합계를 함께 보여 준다', () => {
    render(<MoodBookingShareCard data={shareData('final')} />);

    expect(screen.getByText('이동 정산 안내')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '예약 예상 비용' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '최종 정산 비용' })).toBeInTheDocument();
    expect(screen.getByText('실제 톨비')).toBeInTheDocument();
    expect(screen.getByText('(하이패스 비용 미발생)')).toBeInTheDocument();
    expect(screen.queryByText('기타 조정')).not.toBeInTheDocument();
    expect(screen.getByText('최종 합계')).toBeInTheDocument();
    expect(screen.getByText('MOOD 100% · 53,600원')).toBeInTheDocument();
    expect(screen.getByText('MOOD 50% · 26,800원')).toBeInTheDocument();
    expect(screen.getByText('인플루언서(코코) 50% · 26,800원')).toBeInTheDocument();
    expect(screen.getAllByText('80,400원')).toHaveLength(2);
    expect(screen.getByRole('region', { name: '최종 코스별 비용 분담' })).toBeInTheDocument();
  });

  it('수동 금액 조정이 있을 때만 기타 조정 행을 보여 준다', () => {
    const data = shareData('final');
    if (data.costs.final) {
      data.costs.final.adjustmentKRW = 10_000;
      data.costs.final.adjustmentReason = '추가 주차비';
    }
    render(<MoodBookingShareCard data={data} />);

    expect(screen.getByText('기타 조정')).toBeInTheDocument();
    expect(screen.getByText('(추가 주차비)')).toBeInTheDocument();
  });

  it('전체 차량 일정을 구간별 전체 주소·도착·대기·재출발로 보여 준다', () => {
    const data = shareData();
    data.startTime = '09:00';
    data.routeSchedule = [
      { arrivalTime: null, pickupTime: '09:00' },
      { arrivalTime: '09:40', pickupTime: '11:40' },
      { arrivalTime: '12:20', pickupTime: null },
    ];
    render(<MoodBookingShareCard data={data} />);

    expect(screen.getByRole('region', { name: '전체 차량 일정' })).toBeInTheDocument();
    expect(screen.getByText(/서울역 1번 출구.*성수동 촬영장/)).toBeInTheDocument();
    expect(screen.getByText('출발 09:00 · 도착 09:40')).toBeInTheDocument();
    expect(screen.getByText('대기 2시간 · 재출발(픽업) 11:40')).toBeInTheDocument();
    expect(screen.getByText('도착 09:40 · 재출발 11:40 · 대기 2시간')).toBeInTheDocument();
    expect(screen.getByText('출발 11:40 · 도착 12:20')).toBeInTheDocument();
  });

  it('카드 데이터 계약에 없는 직원 이메일과 잔액은 화면에 나오지 않는다', () => {
    const data = shareData() as MoodBookingShareData & { createdByEmail: string; runningBalanceKRW: number };
    data.createdByEmail = 'secret@example.com';
    data.runningBalanceKRW = 3_000_000;
    render(<MoodBookingShareCard data={data} />);

    expect(screen.queryByText('secret@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText(/3,000,000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/잔액/)).not.toBeInTheDocument();
  });
});

describe('MoodBookingCopyButton', () => {
  it('버튼 한 번으로 상세 문구를 복사하고 성공 상태를 보여 준다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MoodBookingCopyButton data={shareData()} />);

    fireEvent.click(screen.getByRole('button', { name: '상세 내용 복사' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '상세 내용 복사 완료' })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledOnce();
    expect(String(writeText.mock.calls[0][0])).toContain('[MOOD 이동 예상 안내]');
    expect(String(writeText.mock.calls[0][0])).toContain('예상 코스별 비용 분담');
    expect(String(writeText.mock.calls[0][0])).toContain('MOOD 50% 28,000원');
    expect(String(writeText.mock.calls[0][0])).toContain('인플루언서(코코) 50% 28,000원');
  });
});

describe('MoodCourseShareEditor', () => {
  function EditorHarness() {
    const [percentages, setPercentages] = React.useState([100, 100, 100]);
    return (
      <MoodCourseShareEditor
        items={[
          { address: '서울역', percentageIndex: 0 },
          { address: '성수동', percentageIndex: 1 },
          { address: '인천공항', percentageIndex: 2 },
        ]}
        percentages={percentages}
        totalKRW={101}
        influencerName="코코"
        onChange={setPercentages}
      />
    );
  }

  it('프리셋·직접 비율·현재 비율 전체 적용을 모바일 입력으로 제공한다', () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole('button', { name: /공동 탑승/ }));
    expect(screen.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value)).toEqual(['50', '50', '50']);
    expect(screen.getByText('MOOD 부담 합계').nextSibling).toHaveTextContent('52원');
    expect(screen.getByText('코코 부담 합계').nextSibling).toHaveTextContent('49원');

    fireEvent.change(screen.getByRole('spinbutton', { name: '2번 코스 MOOD 부담 비율' }), { target: { value: '33' } });
    expect(screen.getByText('직접 수정됨')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2번 코스 MOOD 33%를 전체 코스에 적용' }));
    expect(screen.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value)).toEqual(['33', '33', '33']);

    fireEvent.click(screen.getByRole('button', { name: /행사/ }));
    expect(screen.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value)).toEqual(['0', '0', '0']);
    expect(screen.getByText('프리셋 적용')).toBeInTheDocument();
  });
});
