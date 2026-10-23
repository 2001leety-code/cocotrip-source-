/* eslint-disable @typescript-eslint/no-explicit-any -- 메일·바우처 모킹 스캐폴딩. */
/**
 * 날짜 변경 확인 메일 (2026-10-23, 후속 ②b) — api/_shared/booking-change-emails.js.
 * 잠그는 것: 4개 언어 · escape · 게스트 새 관리 링크 / 회원 마이페이지 분기 · "무료 취소는 새 날짜 기준" ·
 *   바우처 입력 매핑(저장 형태 예약 → 이름·상품·거래번호·새 날짜) · 첨부 · 바우처 실패 시 첨부 없이 + 안내 ·
 *   수신자(userEmail → payerEmail) · 발송 실패는 throw 대신 { sent:false }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmailSpy = vi.fn<(args: any) => Promise<any>>(async () => ({ messageId: 'm' }));
const voucherSpy = vi.fn<(booking: any) => Promise<any>>(async () => Buffer.from('%PDF-fake'));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: (args: any) => sendEmailSpy(args) }));
vi.mock('../../api/_generate-voucher.js', () => ({ generateVoucherPDF: (b: any) => voucherSpy(b) }));

const { buildBookingChangeEmail, buildChangeVoucherInput, sendBookingChangeEmail } = await import('../../api/_shared/booking-change-emails.js');

// capturePaypalOrder.js bookingDocPayload 와 같은 저장 형태(게스트 결제).
const STORED = {
  bookingRef: 'ORD-77', orderID: 'ORD-77', captureID: 'CAP-77', userEmail: '', uid: null,
  payerEmail: 'guest@example.com', payerName: 'Kim Minji', status: 'CONFIRMED', productType: 'tour_gyeongbok',
  tourDate: '2099-11-01', tourTime: '', pickupLocation: 'Myeongdong <Hotel>', dropoffLocation: '', paxCount: 2,
  vehicleType: 'van', amountUSD: '100.00', amountKRW: 135000, currency: 'USD', paypalEnvironment: 'live', language: 'ja',
};
const MANAGE = 'https://cocotripkr.com/booking/manage#t=new.token';

beforeEach(() => {
  sendEmailSpy.mockClear();
  voucherSpy.mockReset();
  voucherSpy.mockResolvedValue(Buffer.from('%PDF-fake'));
});

describe('buildBookingChangeEmail', () => {
  const base = { bookingRef: 'ORD-77', label: 'Gyeongbok Tour', oldDate: '2099-11-01', newDate: '2099-11-05', pickupLocation: 'Lobby', paxCount: 2 };

  it.each([
    ['en', 'Booking date changed', 'Free cancellation now follows the new date'],
    ['ko', '예약 날짜 변경 완료', '무료 취소 기한은 이제 새 날짜 기준'],
    ['ja', 'ご予約日を変更しました', '無料キャンセルの期限は新しい日程'],
    ['zh', '预订日期已更改', '免费取消期限现以新日期为准'],
  ])('%s subject + policy line', (language, subject, policy) => {
    const m = buildBookingChangeEmail({ ...base, language, manageUrl: MANAGE });
    expect(m.subject).toContain(subject);
    expect(m.html).toContain(policy);
    expect(m.text).toContain(policy);
    expect(m.text).toContain('2099-11-01 → 2099-11-05');
  });

  it('unknown / region language falls back sensibly', () => {
    expect(buildBookingChangeEmail({ ...base, language: 'fr' }).subject).toContain('Booking date changed');
    expect(buildBookingChangeEmail({ ...base, language: 'zh-CN' }).subject).toContain('预订日期已更改');
  });

  it('guest → new manage link (both html and text), member → My Page link', () => {
    const g = buildBookingChangeEmail({ ...base, language: 'en', manageUrl: MANAGE, myPageUrl: null });
    expect(g.html).toContain(`href="${MANAGE}"`);
    expect(g.text).toContain(MANAGE);
    expect(g.html).toContain('replaces the one in your earlier emails');
    const m = buildBookingChangeEmail({ ...base, language: 'en', manageUrl: null, myPageUrl: 'https://cocotripkr.com/mypage' });
    expect(m.html).toContain('href="https://cocotripkr.com/mypage"');
    expect(m.html).not.toContain('#t=');
  });

  it('escapes user-controlled fields and link attributes', () => {
    const m = buildBookingChangeEmail({ ...base, language: 'en', label: '<script>x</script>', pickupLocation: 'A & "B"', manageUrl: 'https://x/"><img>' });
    expect(m.html).not.toContain('<script>x</script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('A &amp; &quot;B&quot;');
    expect(m.html).not.toContain('"><img>');
  });

  it('voucher attached / not attached wording', () => {
    expect(buildBookingChangeEmail({ ...base, language: 'en' }).text).toContain('updated voucher is attached');
    expect(buildBookingChangeEmail({ ...base, language: 'en', voucherAttached: false }).text).toContain('could not attach the updated voucher');
  });
});

describe('buildChangeVoucherInput — stored booking shape → voucher fields', () => {
  it('fills name / product / transaction id from stored fields and uses the new date', () => {
    const v = buildChangeVoucherInput(STORED, 'ORD-77', '2099-11-05');
    expect(v).toMatchObject({
      tourDate: '2099-11-05', bookingRef: 'ORD-77', customerName: 'Kim Minji', product: 'tour_gyeongbok', transactionId: 'ORD-77',
      pickupLocation: 'Myeongdong <Hotel>', paxCount: 2,
    });
  });

  it('existing voucher fields win', () => {
    const v = buildChangeVoucherInput({ ...STORED, customerName: 'Given', product: 'Nice Label', transactionId: 'TX-1' }, 'ORD-77', '2099-11-05');
    expect(v).toMatchObject({ customerName: 'Given', product: 'Nice Label', transactionId: 'TX-1' });
  });
});

describe('sendBookingChangeEmail', () => {
  it('regenerates the voucher for the new date and attaches it; recipient = payerEmail for guests', async () => {
    const r = await sendBookingChangeEmail({ booking: { ...STORED, tourDate: '2099-11-05' }, bookingID: 'ORD-77', label: 'Gyeongbok', oldDate: '2099-11-01', newDate: '2099-11-05', manageUrl: MANAGE });
    expect(r).toEqual({ sent: true, voucherAttached: true });
    expect(voucherSpy.mock.calls[0][0]).toMatchObject({ customerName: 'Kim Minji', product: 'tour_gyeongbok', transactionId: 'ORD-77', tourDate: '2099-11-05' });
    const mail = sendEmailSpy.mock.calls[0][0];
    expect(mail.to).toBe('guest@example.com');
    expect(mail.subject).toContain('ご予約日を変更しました');
    expect(mail.attachments).toEqual([{ filename: 'CocoTripKR_Voucher.pdf', content: Buffer.from('%PDF-fake'), contentType: 'application/pdf' }]);
    expect(mail.html).toContain(MANAGE);
  });

  it('member recipient = userEmail', async () => {
    await sendBookingChangeEmail({ booking: { ...STORED, userEmail: 'member@example.com', uid: 'u1' }, bookingID: 'ORD-77', label: 'x', oldDate: 'a', newDate: 'b', myPageUrl: 'https://cocotripkr.com/mypage' });
    expect(sendEmailSpy.mock.calls[0][0].to).toBe('member@example.com');
  });

  it('voucher failure → sends without attachment and says so', async () => {
    voucherSpy.mockRejectedValue(new Error('chromium down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await sendBookingChangeEmail({ booking: STORED, bookingID: 'ORD-77', label: 'x', oldDate: 'a', newDate: 'b', manageUrl: MANAGE });
    warn.mockRestore();
    expect(r).toEqual({ sent: true, voucherAttached: false });
    const mail = sendEmailSpy.mock.calls[0][0];
    expect(mail.attachments).toEqual([]);
    expect(mail.text).toContain('新しいバウチャーを添付できませんでした');
  });

  it('send failure → { sent:false } (no throw); no recipient → NO_RECIPIENT', async () => {
    sendEmailSpy.mockRejectedValueOnce(new Error('smtp down'));
    await expect(sendBookingChangeEmail({ booking: STORED, bookingID: 'ORD-77', label: 'x', oldDate: 'a', newDate: 'b' }))
      .resolves.toMatchObject({ sent: false, error: 'smtp down' });
    await expect(sendBookingChangeEmail({ booking: { ...STORED, payerEmail: '' }, bookingID: 'ORD-77', label: 'x', oldDate: 'a', newDate: 'b' }))
      .resolves.toMatchObject({ sent: false, error: 'NO_RECIPIENT' });
  });
});
