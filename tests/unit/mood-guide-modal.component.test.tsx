// @vitest-environment jsdom
/**
 * MoodGuideModal 잠금 (2026-07-05 — 직원용 이용 안내 & Q&A).
 *
 * 1. 요금 표기가 moodPricing 상수에서 파생 — 요율 개정 시 안내 자동 갱신 (하드코딩 회귀 방지).
 * 2. 핵심 섹션(요금·예약법·정산·Q&A) 렌더.
 * 3. 취소 안내 = "운영자 연락" (포털 취소 API 없음 — 잘못된 셀프서비스 안내 방지).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { MoodGuideModal } from '../../src/components/mood/MoodGuideModal';
import {
  MOOD_RATES, MOOD_SURCHARGE_PER_KM, MOOD_DISTANCE_THRESHOLD_KM,
  MOOD_AIRPORT_PRICE_KRW, MOOD_AIRPORT_LABEL, MOOD_AIRPORT_CODES, formatKRW,
} from '../../src/lib/moodPricing';

describe('MoodGuideModal', () => {
  it('요금 숫자가 상수에서 파생돼 렌더 (차량·매니저·공항·거리요금)', () => {
    render(<MoodGuideModal open onClose={() => {}} />);
    expect(screen.getByText(new RegExp(`${formatKRW(MOOD_RATES.vehicle)}/시간`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`${formatKRW(MOOD_RATES.manager)}/시간`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`${MOOD_DISTANCE_THRESHOLD_KM}km 이상.*${formatKRW(MOOD_SURCHARGE_PER_KM)}`))).toBeTruthy();
  });

  it('공항별 정액이 전부 안내에 나온다 (인천 110,000 / 김포 80,000 — 하나만 적으면 오해)', () => {
    render(<MoodGuideModal open onClose={() => {}} />);
    for (const code of MOOD_AIRPORT_CODES) {
      expect(
        screen.getByText(new RegExp(`${MOOD_AIRPORT_LABEL[code]} ${formatKRW(MOOD_AIRPORT_PRICE_KRW[code])}`)),
      ).toBeTruthy();
    }
  });

  it('핵심 섹션 + 취소·변경 셀프서비스 안내 (2026-07-05 취소 기능 추가)', () => {
    render(<MoodGuideModal open onClose={() => {}} />);
    expect(screen.getByText(/이용 안내/)).toBeTruthy();
    expect(screen.getByText(/예약하는 법/)).toBeTruthy();
    expect(screen.getByText(/자주 묻는 질문/)).toBeTruthy();
    // 취소 = 포털에서 직접 (버튼 안내), 변경 = 복사→재예약→기존 취소
    expect(screen.getByText(/전액이 잔액으로 즉시 환불/)).toBeTruthy();
    expect(screen.getByText(/기존 예약을 취소하세요/)).toBeTruthy();
    expect(screen.getByText(/날짜별로 각각/)).toBeTruthy();
  });

  it('open=false 면 렌더 안 함', () => {
    const { container } = render(<MoodGuideModal open={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
    expect(document.body.textContent).not.toContain('이용 안내');
  });
});
