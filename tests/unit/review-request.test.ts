import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js in api/, no type decls
import { detectLanguage, reviewTargetDateKST, qualifiesForReview } from '../../api/_crons/review-request.js';

// 2026-06-10 자가운영 에이전시 배치 B — 리뷰요청 cron 순수 헬퍼 머지 전 검증($0).

describe('reviewTargetDateKST — 어제 KST 날짜', () => {
  it('2026-06-10 11:00 KST → 어제 2026-06-09', () => {
    expect(reviewTargetDateKST(new Date('2026-06-10T02:00:00Z'))).toBe('2026-06-09');
  });
  it('KST 자정 직후도 어제로 정확', () => {
    // 2026-06-10 00:30 KST = 2026-06-09 15:30 UTC → 어제 = 2026-06-09
    expect(reviewTargetDateKST(new Date('2026-06-09T15:30:00Z'))).toBe('2026-06-09');
  });
});

describe('qualifiesForReview — 대상 자격', () => {
  const target = '2026-06-09';
  const base = { status: 'CONFIRMED', tourDate: target, payerEmail: 'a@b.com' };
  it('CONFIRMED + 어제 투어 + 미발송 + 이메일 → 자격 O', () => {
    expect(qualifiesForReview(base, target)).toBe(true);
  });
  it('이미 발송됨 → 제외 (중복 방지)', () => {
    expect(qualifiesForReview({ ...base, reviewRequestSent: 123 }, target)).toBe(false);
  });
  it('다른 날 투어 → 제외', () => {
    expect(qualifiesForReview({ ...base, tourDate: '2026-06-08' }, target)).toBe(false);
  });
  it('CONFIRMED 아님(취소/대기) → 제외', () => {
    expect(qualifiesForReview({ ...base, status: 'CANCELED' }, target)).toBe(false);
    expect(qualifiesForReview({ ...base, status: 'PENDING' }, target)).toBe(false);
  });
  it('이메일 없음 → 제외', () => {
    expect(qualifiesForReview({ ...base, payerEmail: '' }, target)).toBe(false);
  });
  it('null/undefined → 제외 (throw 없음)', () => {
    expect(qualifiesForReview(null, target)).toBe(false);
    expect(qualifiesForReview(undefined, target)).toBe(false);
  });
});

describe('detectLanguage — 4언어', () => {
  it('일본어: .jp 도메인 또는 가나 이름', () => {
    expect(detectLanguage('a@b.jp', '')).toBe('ja');
    expect(detectLanguage('a@b.com', 'たなか')).toBe('ja');
  });
  it('중국어: .cn 또는 한자 이름', () => {
    expect(detectLanguage('a@b.cn', '')).toBe('zh');
    expect(detectLanguage('a@b.com', '王伟')).toBe('zh');
  });
  it('한국어: 한글 이름', () => {
    expect(detectLanguage('a@b.com', '김철수')).toBe('ko');
  });
  it('기본 영어', () => {
    expect(detectLanguage('a@b.com', 'John')).toBe('en');
    expect(detectLanguage('', '')).toBe('en');
  });
});
