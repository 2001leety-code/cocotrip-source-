/**
 * inquiryAdmin 회귀 슬롯 (2026-07-04 — 어드민 맞춤투어 문의 표시 fix).
 *
 * 잠금 대상:
 *   1. normalizeInquiryStatus — 서버 저장 'NEW' 를 읽기 시점에 'pending' 정규화.
 *      이거 무너지면 tour_custom/버스 문의가 기본 '대기' 필터에서 숨음(고단가 리드 방치).
 *   2. inquiryKind — vehicle 필드 기반 유형 판별(뱃지·필터의 근거).
 *   3. inquiryContact — tour_custom 은 이메일 없이 전화만 가능 → 폴백 체인.
 */
import { describe, it, expect } from 'vitest';

import { inquiryKind, normalizeInquiryStatus, inquiryContact, REGION_LABELS } from '../../src/lib/inquiryAdmin';

describe('normalizeInquiryStatus — NEW→pending 읽기 정규화', () => {
  it("'NEW'(서버 API 저장값)는 'pending' 으로", () => {
    expect(normalizeInquiryStatus('NEW')).toBe('pending');
  });

  it('나머지 상태는 그대로 (차터 배너 pending, 처리 후 approved/rejected)', () => {
    expect(normalizeInquiryStatus('pending')).toBe('pending');
    expect(normalizeInquiryStatus('approved')).toBe('approved');
    expect(normalizeInquiryStatus('rejected')).toBe('rejected');
  });
});

describe('inquiryKind — 문의 유형 판별', () => {
  it('vehicle=tour_custom → 맞춤 투어', () => {
    expect(inquiryKind({ vehicle: 'tour_custom' })).toBe('tour_custom');
  });

  it('vehicle=bus → 버스', () => {
    expect(inquiryKind({ vehicle: 'bus' })).toBe('bus');
  });

  it('vehicle=charter 및 과거 vehicle 없음 문서 → charter', () => {
    expect(inquiryKind({ vehicle: 'charter' })).toBe('charter');
    expect(inquiryKind({})).toBe('charter');
    expect(inquiryKind({ vehicle: null })).toBe('charter');
    expect(inquiryKind({ vehicle: 'unknown-future' })).toBe('charter');
  });
});

describe('inquiryContact — 연락처 폴백 (tour_custom 은 email null 가능)', () => {
  it('email > phone > whatsapp > 없음 순', () => {
    expect(inquiryContact({ email: 'a@b.c', phone: '010' })).toBe('a@b.c');
    expect(inquiryContact({ email: null, phone: '010-1234' })).toBe('010-1234');
    expect(inquiryContact({ email: null, phone: null, whatsapp: '+82 10' })).toBe('+82 10');
    expect(inquiryContact({})).toBe('(연락처 없음)');
  });
});

describe('REGION_LABELS — TourInquireModal 저장값과 쌍', () => {
  it('폼이 보내는 4개 값 전부 커버', () => {
    for (const r of ['seoul', 'busan', 'jeju', 'other']) {
      expect(REGION_LABELS[r]).toBeTruthy();
    }
  });
});
