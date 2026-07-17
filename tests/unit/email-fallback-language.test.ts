/**
 * 확인 이메일 폴백 템플릿 4언어 회귀 (2026-07-17)
 * - buildDefaultConfirmationEmail 이 영어 하드코딩이던 것을 language 파라미터로 교체.
 *   Gemini 이메일 실패 시 폴백이 고객 UI 언어로 나가는지 고정.
 * - 미지원/미전달 언어는 영어 폴백 (기존 동작 보존).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — api JS 모듈 (타입 선언 없음)
import { buildDefaultConfirmationEmail } from '../../api/_send-email.js';

const BOOKING = {
  bookingRef: 'CT-20260717-123',
  customerName: 'Tanaka',
  product: 'Seoul City Tour',
  tourDate: '2026-08-01',
  pickupLocation: 'L7 Myeongdong',
  paxCount: 2,
  amountUSD: '231.00',
};

describe('buildDefaultConfirmationEmail — 언어별 폴백', () => {
  it('ja: 제목·본문이 일본어', () => {
    const { subject, html, text } = buildDefaultConfirmationEmail(BOOKING, null, null, 'ja');
    expect(subject).toContain('ご予約が確定');
    expect(html).toContain('予約サマリー');
    expect(text).toContain('ご予約が確定');
  });

  it('zh: 제목·본문이 중국어', () => {
    const { subject, html } = buildDefaultConfirmationEmail(BOOKING, null, null, 'zh');
    expect(subject).toContain('预订已确认');
    expect(html).toContain('预订摘要');
  });

  it('ko: 제목·본문이 한국어', () => {
    const { subject, html } = buildDefaultConfirmationEmail(BOOKING, null, null, 'ko');
    expect(subject).toContain('예약이 확정');
    expect(html).toContain('예약 요약');
  });

  it('en 기본값 + 미지원 언어는 영어 폴백', () => {
    const def = buildDefaultConfirmationEmail(BOOKING);
    expect(def.subject).toContain('Your Booking is Confirmed');
    const unknown = buildDefaultConfirmationEmail(BOOKING, null, null, 'fr');
    expect(unknown.subject).toContain('Your Booking is Confirmed');
  });

  it('bookingRef 는 모든 언어 제목에 포함', () => {
    for (const lang of ['en', 'ko', 'ja', 'zh']) {
      const { subject } = buildDefaultConfirmationEmail(BOOKING, null, null, lang);
      expect(subject).toContain('CT-20260717-123');
    }
  });
});
