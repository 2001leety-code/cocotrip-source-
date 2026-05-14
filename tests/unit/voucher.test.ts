// Coverage for api/_generate-voucher.js — Puppeteer-based voucher generator.
//
// PR #424 (Audit CZ5) migrated from PDFKit + Helvetica + safeText() to
// Puppeteer + @sparticuz/chromium. Vitest can't spawn Chromium in the unit
// environment, so we mock puppeteer-core + @sparticuz/chromium and assert
// the HTML template wiring (CJK survives, escape() applied, reconciliation
// notice toggled) plus the Buffer contract.
//
// The "really renders a valid PDF" check now lives in smoke (Chromium
// available there).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setContentSpy = vi.fn();
const pdfBuffer = Buffer.from('%PDF-1.4\n%mock voucher buffer\n%%EOF\n');
const pdfSpy = vi.fn(async () => pdfBuffer);
const closeSpy = vi.fn();
const evaluateHandleSpy = vi.fn();

const fakePage = {
  setContent: setContentSpy,
  pdf: pdfSpy,
  evaluateHandle: evaluateHandleSpy,
};
const fakeBrowser = {
  newPage: vi.fn(async () => fakePage),
  close: closeSpy,
};

vi.mock('puppeteer-core', () => ({
  default: { launch: vi.fn(async () => fakeBrowser) },
}));
vi.mock('@sparticuz/chromium', () => ({
  default: {
    args: [],
    executablePath: async () => '/mock/path/chromium',
    headless: true,
  },
}));

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
};

describe('api/_generate-voucher — generateVoucherPDF (Puppeteer)', () => {
  beforeEach(() => {
    setContentSpy.mockClear();
    pdfSpy.mockClear();
    closeSpy.mockClear();
    evaluateHandleSpy.mockClear();
  });

  it('returns a Buffer with PDF magic bytes', async () => {
    const { generateVoucherPDF } = await import('../../api/_generate-voucher.js');
    const buf = await generateVoucherPDF(BASE_BOOKING);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('templates booking fields into HTML (latin text preserved)', async () => {
    const { generateVoucherPDF } = await import('../../api/_generate-voucher.js');
    await generateVoucherPDF(BASE_BOOKING);
    expect(setContentSpy).toHaveBeenCalled();
    const html = setContentSpy.mock.calls[0]?.[0] as string;
    expect(html).toContain('CT-20260512-001');
    expect(html).toContain('Test Guest');
    expect(html).toContain('Hotel Lotte Myeongdong');
  });

  it('preserves CJK characters (no longer stripped to ?) — the CZ5 fix', async () => {
    const { generateVoucherPDF } = await import('../../api/_generate-voucher.js');
    const langSamples = [
      { ...BASE_BOOKING, customerName: '홍길동' },      // ko Hangul
      { ...BASE_BOOKING, customerName: '山田太郎' },     // ja
      { ...BASE_BOOKING, customerName: '王小明' },       // zh
    ];
    for (const booking of langSamples) {
      setContentSpy.mockClear();
      await generateVoucherPDF(booking);
      const html = setContentSpy.mock.calls[0]?.[0] as string;
      // Each non-Latin name must appear verbatim in the HTML (pre-fix it
      // would have been replaced with `?` characters by safeText()).
      expect(html, `${booking.customerName} should not be stripped`)
        .toContain(booking.customerName);
    }
  });

  it('includes reconciliation notice only when requiresReconciliation=true', async () => {
    const { generateVoucherPDF } = await import('../../api/_generate-voucher.js');

    setContentSpy.mockClear();
    await generateVoucherPDF(BASE_BOOKING);
    const htmlA = setContentSpy.mock.calls[0]?.[0] as string;
    expect(htmlA).not.toContain('Reconciliation Notice');

    setContentSpy.mockClear();
    await generateVoucherPDF({ ...BASE_BOOKING, requiresReconciliation: true });
    const htmlB = setContentSpy.mock.calls[0]?.[0] as string;
    expect(htmlB).toContain('Reconciliation Notice');
  });

  it('handles missing optional fields without throwing', async () => {
    const { generateVoucherPDF } = await import('../../api/_generate-voucher.js');
    const minimal = {
      bookingRef: 'CT-MIN-001',
      customerName: 'Minimal',
      product: 'Charter',
      tourDate: '2026-06-15',
      paxCount: 1,
      amountUSD: '50.00',
    };
    const buf = await generateVoucherPDF(minimal);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('always closes the browser to avoid leaking child processes', async () => {
    const { generateVoucherPDF } = await import('../../api/_generate-voucher.js');
    await generateVoucherPDF(BASE_BOOKING);
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('escapes user-controlled fields (PR #421 helper still active)', async () => {
    const { generateVoucherPDF } = await import('../../api/_generate-voucher.js');
    setContentSpy.mockClear();
    await generateVoucherPDF({ ...BASE_BOOKING, customerName: '<img src=x onerror=alert(1)>' });
    const html = setContentSpy.mock.calls[0]?.[0] as string;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });
});
