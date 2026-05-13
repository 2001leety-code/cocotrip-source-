// Coverage for api/_generate-voucher.js — PDF buffer 생성 검증.
// pdfkit + qrcode 는 native lib — Node 환경에서 실제 실행하되 외부 네트워크 호출 없음.
// 4-lang 분기 함수는 현재 voucher.js 가 lang 파라미터 무시 (Helvetica only) 이므로
// "lang 무관 동일 PDF 출력" 도 단위 검증 (회귀 시 lang 별 분기 추가 후 검증 강화).
import { describe, it, expect } from 'vitest';
import { generateVoucherPDF } from '../../api/_generate-voucher.js';

const BASE_BOOKING = {
  bookingRef: 'CT-20260512-001',
  transactionId: 'TEST-TX-001',
  customerName: 'Test Guest',
  customerEmail: 'test@example.com',
  product: 'Charter — Seoul City',
  tourDate: '2026-06-15',
  pickupLocation: 'Hotel Lotte Myeongdong',
  dropoffLocation: 'Incheon Airport T1',
  paxCount: 2,
  vehicleType: 'Staria',
  amountUSD: '120.00',
  amountKRW: 165600,
  exchangeRate: 1380,
  couponApplied: '',
  memo: '',
};

// PDF size 하한: standard booking voucher 의 실측치는 ~4.3KB (Helvetica only +
// safeText 가 라틴 외 문자 '?' 치환 → 텍스트 압축률 매우 높음 + QR 100x100 ~2KB).
// 3KB 하한은 "헤더/예약박스/8행 정보/QR/푸터 모두 실제 렌더됐는지" 회귀 감지가
// 목적 — 5KB 는 과잉 추정 (PR #379 도입 시 실측 안 함, PR #388 5/13 회귀 fix
// 에서 4346 bytes 실측 후 3KB 로 정정). 향후 약관 박스/언어별 폰트 추가로 PDF
// 가 커져도 하한은 동일 (회귀 방지가 목적이지 상한이 아님 — 상한은 50KB).
const MIN_VOUCHER_PDF_BYTES = 3 * 1024;

describe('api/_generate-voucher — generateVoucherPDF', () => {
  it('returns a non-empty PDF Buffer for standard booking', async () => {
    const buf = await generateVoucherPDF(BASE_BOOKING);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThanOrEqual(MIN_VOUCHER_PDF_BYTES);
  });

  it('produces output with %PDF- magic bytes (valid PDF header)', async () => {
    const buf = await generateVoucherPDF(BASE_BOOKING);
    const magic = buf.slice(0, 5).toString('ascii');
    expect(magic).toBe('%PDF-');
  });

  it('includes reconciliation notice when requiresReconciliation=true', async () => {
    const withReco = { ...BASE_BOOKING, requiresReconciliation: true };
    const a = await generateVoucherPDF(BASE_BOOKING);
    const b = await generateVoucherPDF(withReco);
    // reconciliation 박스가 추가되어 b 가 더 큼 (>1KB 차이 expected — 실제 약관 텍스트 + box)
    expect(b.length).toBeGreaterThan(a.length);
  });

  it('handles missing optional fields without throwing', async () => {
    const minimal = {
      bookingRef: 'CT-MIN-001',
      transactionId: 'TX-MIN',
      customerName: 'Minimal',
      customerEmail: 'min@example.com',
      product: 'Charter',
      tourDate: '2026-06-15',
      paxCount: 1,
      amountUSD: '50.00',
      // pickupLocation/dropoffLocation/vehicleType/amountKRW 누락 — safeText/default 가 처리
    };
    const buf = await generateVoucherPDF(minimal);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(3 * 1024);
  });

  it('output is deterministic-enough for 4-lang resilience (현재 lang 무시)', async () => {
    // voucher.js 는 현재 lang 파라미터를 처리하지 않음 — 모든 언어가 동일 Helvetica PDF.
    // booking 객체에 다른 customerName (영문/한글/일문/중문) 을 넣어도 safeText() 가
    // 라틴+CJK 외 문자를 '?' 로 치환하므로 출력 PDF 가 일관된 크기/구조를 유지해야 함.
    const langSamples = [
      { ...BASE_BOOKING, customerName: 'Hong Gildong' },           // en
      { ...BASE_BOOKING, customerName: '홍길동' },                   // ko (safeText → ??? 라틴 외)
      { ...BASE_BOOKING, customerName: '山田太郎' },                  // ja
      { ...BASE_BOOKING, customerName: '王小明' },                    // zh
    ];
    const buffers = await Promise.all(langSamples.map((b) => generateVoucherPDF(b)));
    for (const buf of buffers) {
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThanOrEqual(MIN_VOUCHER_PDF_BYTES);
      expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
    }
    // 4 lang 모두 3-50KB 범위 (Helvetica only — non-Latin 은 safeText 로 치환).
    // 실측: 모든 lang 동일 출력 (~4346 bytes), CJK 는 '?' 치환됨.
    for (const buf of buffers) {
      expect(buf.length).toBeLessThan(50 * 1024);
    }
  });
});
