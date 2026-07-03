/**
 * inquiryAdmin — 어드민 문의 목록 순수 로직 (2026-07-04, AdminClaims 에서 추출).
 *
 * charter_inquiries 컬렉션엔 writer 가 2종:
 *   - 서버 API(inquiry-submit): vehicle('tour_custom'|'bus') + status 'NEW' 저장
 *   - 차터 배너 모달(클라 직접): recommendedTour 계열 + status 'pending'
 * 어드민 화면은 이 차이를 읽기 시점에만 정규화한다 — Firestore 원본 불변
 * (텔레그램 /inquiries 명령·운영자 to-do 크론이 ['pending','NEW'] in-쿼리 의존).
 *
 * 잠금테스트: tests/unit/admin-inquiry-kind.test.ts
 */

export type InquiryKind = 'tour_custom' | 'bus' | 'charter';

/** 문의 유형 판별 — vehicle 필드(서버 API 경유) 우선, 없으면 차터(배너 모달). */
export function inquiryKind(row: { vehicle?: string | null }): InquiryKind {
  if (row.vehicle === 'tour_custom') return 'tour_custom';
  if (row.vehicle === 'bus') return 'bus';
  return 'charter';
}

/**
 * status 읽기 정규화 — 서버 저장값 'NEW' 를 표시용 'pending' 으로.
 * 이거 없으면 tour_custom/버스 문의가 기본 '대기' 필터에서 숨고, 대기 카운트에서
 * 빠지고, 승인/거절 버튼이 안 뜨고, 뱃지가 거절색(rose) 으로 표시된다(고단가 리드 방치).
 */
export function normalizeInquiryStatus(status: string): string {
  return status === 'NEW' ? 'pending' : status;
}

/** 연락처 표시 폴백 — tour_custom 은 이메일 없이 전화만 가능. */
export function inquiryContact(row: { email?: string | null; phone?: string | null; whatsapp?: string | null }): string {
  return row.email || row.phone || row.whatsapp || '(연락처 없음)';
}

export const REGION_LABELS: Record<string, string> = {
  seoul: '서울', busan: '부산', jeju: '제주', other: '기타',
};
