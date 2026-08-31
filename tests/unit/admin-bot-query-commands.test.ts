/**
 * 어드민 텔레그램 봇 — 조회 확장 명령 6종 배선 + 검증노트 불변식 회귀 (2026-06-13).
 *
 * 추가 명령: 검색(/search) · 예약상세(/booking) · 운행(/upcoming) ·
 *           추이(/trend) · 문의(/inquiries) · 환불(/refunds).
 *
 * 전부 읽기 전용(환불/캡처/송금 등 금융 자동실행 없음). 이 테스트는
 * 적대 검증 에이전트가 짚은 "조용히 틀리는" 함정들을 소스 가드로 박제:
 *   - 추이: status==='confirmed' 하드필터 금지 → aggregateAdminSales SSOT 재사용
 *           (confirmed 필터 시 PayPal 실매출 대부분 누락)
 *   - 문의: charter_inquiries 는 writer 2종(pending/NEW) → 'NEW' 누락 시 버스/VIP 전량 miss
 *   - 운행: status 대/소문자·빈값 혼재 → lowercase 후 canceled 만 제외 (CONFIRMED 하드필터 금지)
 *   - 환불: 환불액은 refundedKRW(KRW) 필드 (USD 직접 필드 없음)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/telegram-webhook-admin.js'), 'utf8');

describe('admin bot 조회 확장 — 배선', () => {
  const aliasCmds = ['/search', '/booking', '/upcoming', '/trend', '/inquiries', '/refunds'];

  it('KOREAN_ALIASES 에 6개 명령 한글 별칭 등록', () => {
    for (const cmd of aliasCmds) {
      expect(src).toMatch(new RegExp(`cmd:\\s*'${cmd}'`));
    }
    // 핵심 한글 트리거 단어
    for (const word of ['검색', '예약상세', '운행', '추이', '문의', '환불']) {
      expect(src).toContain(word);
    }
  });

  it('routeCommand switch 에 6개 case + 핸들러 연결', () => {
    const handlers = [
      ['/search', 'handleSearchCommand'],
      ['/booking', 'handleBookingDetailCommand'],
      ['/upcoming', 'handleUpcomingCommand'],
      ['/trend', 'handleTrendCommand'],
      ['/inquiries', 'handleInquiriesCommand'],
      ['/refunds', 'handleRefundsCommand'],
    ];
    for (const [cmd, fn] of handlers) {
      expect(src).toMatch(new RegExp(`case '${cmd}':[\\s\\S]{0,80}${fn}\\(`));
      expect(src).toMatch(new RegExp(`function ${fn}\\(`));
    }
  });

  it("'예약 상세' 별칭이 '예약'(/bookings)보다 먼저 매칭 (배열 순서)", () => {
    const bookingIdx = src.indexOf("cmd: '/booking'");
    const bookingsIdx = src.indexOf("cmd: '/bookings'");
    expect(bookingIdx).toBeGreaterThan(0);
    expect(bookingsIdx).toBeGreaterThan(0);
    expect(bookingIdx).toBeLessThan(bookingsIdx);
  });
});

describe('admin bot 조회 확장 — 검증노트 불변식 (조용히 틀리는 함정 가드)', () => {
  it('추이: aggregateAdminSales SSOT 재사용 (confirmed 하드필터 금지)', () => {
    expect(src).toMatch(/import\s*\{[^}]*aggregateAdminSales[^}]*\}\s*from\s*'\.\/_shared\/adminSalesAggregate\.js'/);
    expect(src).toMatch(/function handleTrendCommand[\s\S]{0,1200}aggregateAdminSales\(/);
    // 추이 핸들러 안에서 status==='confirmed' 류 하드필터를 쓰지 않음
    const trendBody = src.slice(src.indexOf('function handleTrendCommand'), src.indexOf('function handleInquiriesCommand'));
    expect(trendBody).not.toMatch(/['"]confirmed['"]/i);
  });

  it('문의: charter_inquiries 를 pending + NEW 둘 다로 조회 (NEW 누락 방지)', () => {
    const body = src.slice(src.indexOf('function handleInquiriesCommand'), src.indexOf('function handleRefundsCommand'));
    expect(body).toContain('charter_inquiries');
    expect(body).toContain('cs_tickets');
    expect(body).toMatch(/\[\s*'pending'\s*,\s*'NEW'\s*\]/);
    // 신규 inquiry-submit 문서는 요청 본문을 details 에 저장한다. 이 폴백이 없으면
    // Telegram /inquiries 에서 bus/tour_custom 문의 요약이 빈 줄로 보인다.
    expect(body).toMatch(/c\.message\s*\|\|\s*c\.notes\s*\|\|\s*c\.details\s*\|\|\s*c\.route/);
  });

  it('운행: status lowercase 후 canceled 만 제외 (CONFIRMED 하드필터 금지)', () => {
    const body = src.slice(src.indexOf('function handleUpcomingCommand'), src.indexOf('function handleTrendCommand'));
    expect(body).toMatch(/adminStatus\s*\|\|\s*b\.status[\s\S]{0,40}toLowerCase\(\)/);
    expect(body).toMatch(/canceled|cancelled/);
    // tourDate 문자열 범위 쿼리 사용 (composite index 불필요한 단일필드 range)
    expect(body).toMatch(/where\('tourDate',\s*'>='/);
  });

  it('환불: 환불액은 refundedKRW(KRW) 필드 사용', () => {
    const body = src.slice(src.indexOf('function handleRefundsCommand'), src.indexOf('// /sales'));
    expect(body).toContain('refundedKRW');
    expect(body).toMatch(/REFUND/);
  });

  it('예약상세: 배차 이력을 where(orderID) 로 조인 (doc id 가 {orderID}_{driverChatId} 라 직접 get 불가)', () => {
    const body = src.slice(src.indexOf('function handleBookingDetailCommand'), src.indexOf('function handleUpcomingCommand'));
    expect(body).toMatch(/dispatch_messages[\s\S]{0,80}where\('orderID',\s*'=='/);
  });

  it('전부 읽기 전용 — 조회 핸들러에 금융 변경 호출 없음', () => {
    const block = src.slice(src.indexOf('function handleSearchCommand'), src.indexOf('// /sales'));
    // 환불/캡처/상태변경 부작용 함수 미사용
    expect(block).not.toMatch(/refundPaypalCapture|capturePaypalOrder|confirmBookingAsPaid|\.update\(|\.set\(|runTransaction/);
  });
});
