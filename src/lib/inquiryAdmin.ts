/**
 * inquiryAdmin — 어드민 문의 목록 순수 로직 (2026-07-04, AdminClaims 에서 추출).
 *
 * 현재 앱 코드의 신규 접수 경로는 서버 API(inquiry-submit) 하나이며 vehicle
 * ('tour_custom'|'bus'|'charter') + status 'NEW' 계약을 쓴다.
 * 과거 차터 배너의 직접 쓰기 문서(status 'pending', vehicle 없음)는 계속 읽는다.
 * 운영자 to-do 크론의 ['pending','NEW'] 호환 쿼리도 과거 자료 때문에 유지한다.
 *
 * 잠금테스트: tests/unit/admin-inquiry-kind.test.ts
 */

export type InquiryKind = 'tour_custom' | 'bus' | 'charter';

/** 문의 유형 판별 — vehicle 필드 우선, 과거 vehicle 없는 문서는 차터로 폴백. */
export function inquiryKind(row: { vehicle?: string | null }): InquiryKind {
  if (row.vehicle === 'tour_custom') return 'tour_custom';
  if (row.vehicle === 'bus') return 'bus';
  return 'charter';
}

/**
 * status 읽기 정규화 — 서버의 대문자 상태와 과거 소문자 상태를 한 화면 계약으로.
 * 이거 없으면 tour_custom/버스 문의가 기본 '대기' 필터에서 숨고, 대기 카운트에서
 * 빠지고, 승인/거절 버튼이 안 뜨고, 뱃지가 거절색(rose) 으로 표시된다(고단가 리드 방치).
 */
export function normalizeInquiryStatus(status: string): string {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'new' ? 'pending' : normalized || 'pending';
}

/** 연락처 표시 폴백 — tour_custom 은 이메일 없이 전화만 가능. */
export function inquiryContact(row: { email?: string | null; phone?: string | null; whatsapp?: string | null }): string {
  return row.email || row.phone || row.whatsapp || '(연락처 없음)';
}

interface InquiryQuoteLike {
  currency?: string;
  amountKRW?: number;
  hours?: number;
  provenance?: string;
  kind?: string;
}

/** 신규 서버 정본 견적인지 판별. 과거 PWA 직접 저장 금액은 항상 미검증으로 남긴다. */
export function isServerVerifiedInquiryQuote(row: {
  vehicle?: string | null;
  contractVersion?: string | null;
  quotedKRW?: number;
  hours?: number;
  quote?: InquiryQuoteLike | null;
}): boolean {
  const quote = row.quote;
  return row.vehicle === 'charter'
    && row.contractVersion === 'inquiry.v2'
    && !!quote
    && quote.currency === 'KRW'
    && quote.provenance === 'server_pricing_spec'
    && quote.kind === 'reference'
    && typeof quote.amountKRW === 'number'
    && Number.isSafeInteger(quote.amountKRW)
    && quote.amountKRW === row.quotedKRW
    && typeof quote.hours === 'number'
    && Number.isFinite(quote.hours)
    && quote.hours === row.hours;
}

export const REGION_LABELS: Record<string, string> = {
  seoul: '서울', busan: '부산', jeju: '제주', other: '기타',
};
