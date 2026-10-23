/* eslint-disable @typescript-eslint/no-explicit-any -- nodemailer 모킹 스캐폴딩. */
/**
 * 확인 메일의 게스트 "예약 관리(취소)" 링크 (2026-10-23, 후속 ②a).
 * 잠그는 것: HTML·텍스트 둘 다 링크 · </body> 없으면 끝에 붙임 · href 이스케이프 · 4개 언어 라벨(기본 en) ·
 *   manage 없으면 기존 메일 그대로 · 발급은 storedBooking + isGuestManagedBooking + #t= 프래그먼트 ·
 *   publicSiteOrigin 환경별 · vercel.json 헤더/rewrite(404 폴백 앞).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sendMailSpy = vi.fn<(opts: any) => Promise<any>>(async () => ({ messageId: 'm1' }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: (opts: any) => sendMailSpy(opts) }) } }));
vi.mock('../../api/_shared/gmail-quota.js', () => ({
  checkGmailQuota: async () => ({ ok: true }), incrementGmailSentCount: async () => undefined, GMAIL_QUOTA_EXCEEDED: 'GMAIL_QUOTA_EXCEEDED',
}));

const { sendBookingConfirmation } = await import('../../api/_send-email.js');
const { publicSiteOrigin } = await import('../../api/_shared/internal-base-url.js');

const LINK = 'https://cocotripkr.com/booking/manage#t=abc.def';
const content = { subject: 'Booked', html: '<html><body><p>Hi</p></body></html>', text: 'Hi' };
const saved = { U: process.env.GMAIL_USER, P: process.env.GMAIL_APP_PASSWORD, VE: process.env.VERCEL_ENV, VU: process.env.VERCEL_URL };
let logSpy: { mockRestore: () => void };

beforeEach(() => {
  process.env.GMAIL_USER = 'bot@example.com';
  process.env.GMAIL_APP_PASSWORD = 'pw';
  sendMailSpy.mockClear();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  for (const [k, v] of [['GMAIL_USER', saved.U], ['GMAIL_APP_PASSWORD', saved.P], ['VERCEL_ENV', saved.VE], ['VERCEL_URL', saved.VU]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  logSpy.mockRestore();
});

const sent = () => sendMailSpy.mock.calls[0][0];

describe('sendBookingConfirmation — manage link', () => {
  it('HTML button before </body> + text line, English default label', async () => {
    await sendBookingConfirmation('g@x.com', content, '', null, null, { url: LINK, language: 'fr' });
    const { html, text } = sent();
    expect(html).toContain(`href="${LINK}"`);
    expect(html.indexOf('Manage booking (cancel)')).toBeLessThan(html.indexOf('</body>'));
    expect(text).toContain(`Manage booking (cancel): ${LINK}`);
    expect(text.startsWith('Hi')).toBe(true);
  });

  it('4 languages (region suffix tolerated); no date-change wording', async () => {
    const expected: Record<string, string> = { ko: '예약 관리(취소)', en: 'Manage booking (cancel)', ja: '予約管理（キャンセル）', zh: '管理预订（取消）' };
    for (const [language, label] of Object.entries({ ...expected, 'zh-CN': expected.zh })) {
      sendMailSpy.mockClear();
      await sendBookingConfirmation('g@x.com', content, '', null, null, { url: LINK, language });
      expect(sent().html).toContain(label);
      expect(sent().text).toContain(`${label}: ${LINK}`);
      expect(sent().text).not.toMatch(/date change|change date|날짜 변경|日付変更|改期/i);
    }
  });

  it('HTML without </body> → appended at the end', async () => {
    await sendBookingConfirmation('g@x.com', { ...content, html: '<p>Hi</p>' }, '', null, null, { url: LINK, language: 'en' });
    expect(sent().html.startsWith('<p>Hi</p>')).toBe(true);
    expect(sent().html).toContain(LINK);
  });

  it('wallet button and manage link both present, both before </body>', async () => {
    await sendBookingConfirmation('g@x.com', content, '', null, 'https://pay.google.com/x', { url: LINK, language: 'en' });
    const { html } = sent();
    expect(html).toContain('Add to Google Wallet');
    expect(html).toContain(LINK);
    expect(html.trim().endsWith('</body></html>')).toBe(true);
  });

  it('href is attribute-escaped', async () => {
    await sendBookingConfirmation('g@x.com', content, '', null, null, { url: 'https://x/"><script>', language: 'en' });
    expect(sent().html).not.toContain('"><script>');
  });

  it('no manage arg → html/text unchanged (members, manual bookings)', async () => {
    await sendBookingConfirmation('m@x.com', content, '', null, null);
    expect(sent().html).toBe(content.html);
    expect(sent().text).toBe(content.text);
  });
});

describe('publicSiteOrigin', () => {
  it('production → prod domain; preview → deployment LINK; nothing → prod domain', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_URL = 'x-preview.vercel.app';
    expect(publicSiteOrigin()).toBe('https://cocotripkr.com');
    process.env.VERCEL_ENV = 'preview';
    expect(publicSiteOrigin()).toBe('https://x-preview.vercel.app');
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_URL;
    expect(publicSiteOrigin()).toBe('https://cocotripkr.com');
  });
});

describe('booking-processor wiring (source)', () => {
  const src = readFileSync(resolve(process.cwd(), 'api/booking-processor.js'), 'utf8');
  const start = src.indexOf('let manage = null;');
  const block = src.slice(start, src.indexOf('sendBookingConfirmation(', start) + 200);

  it('issues only for guest-managed bookings, from the Firestore original (storedBooking)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/storedBooking\s*&&\s*isGuestManagedBooking\(storedBooking\)/);
    expect(block).toMatch(/version:\s*Number\(storedBooking\.manageTokenVersion\)\s*\|\|\s*0/);
    expect(block).toMatch(/paypalEnvironment:\s*storedBooking\.paypalEnvironment === 'sandbox'/);
    expect(block).toMatch(/tourDate:\s*storedBooking\.tourDate/);
  });

  it('link = publicSiteOrigin()/booking/manage#t=<token> (fragment, never a query), passed as the 6th arg', () => {
    expect(block).toContain('`${publicSiteOrigin()}/booking/manage#t=${token}`');
    expect(block).not.toMatch(/booking\/manage\?/);
    expect(block).toMatch(/sendBookingConfirmation\(payerEmail, emailContent, voucherText, pdfBuffer, walletUrl, manage\)/);
  });

  it('a token failure only drops the link (mail still sent)', () => {
    expect(block).toMatch(/catch \(tokenErr\)\s*\{\s*console\.warn/);
  });
});

describe('vercel.json', () => {
  const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));

  it('/booking/manage gets no-store + no-referrer', () => {
    const rule = vercel.headers.find((h: any) => h.source === '/booking/manage');
    const map = Object.fromEntries(rule.headers.map((h: any) => [h.key, h.value]));
    expect(map).toEqual({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  });

  it('/booking/manage → /index.html, before the 404 fallback', () => {
    const idx = vercel.rewrites.findIndex((r: any) => r.source === '/booking/manage' && r.destination === '/index.html');
    const fallback = vercel.rewrites.findIndex((r: any) => r.source === '/((?!api/).*)');
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(fallback);
  });
});
