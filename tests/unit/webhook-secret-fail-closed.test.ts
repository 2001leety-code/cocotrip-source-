/**
 * verifyWebhookSecret prod fail-closed 회귀 (2026-06-13 버그헌트 FO/ADM).
 * 결함: secret 미설정 시 무조건 true(fail-open) → TELEGRAM_WEBHOOK_SECRET 미설정 시
 *   임의 Telegram 사용자가 admin/driver/inquiry webhook 무인증 호출 가능.
 * fix: 프로덕션(VERCEL_ENV==='production')에선 secret 미설정 시 false(fail-closed).
 *   dev/preview 만 스킵 허용.
 */
import { describe, it, expect, afterEach } from 'vitest';
// @ts-expect-error — ESM .js (Vercel serverless 모듈)
import { verifyWebhookSecret } from '../../api/_shared/telegram-bot.js';

describe('verifyWebhookSecret — prod fail-closed', () => {
  const ENV = process.env.VERCEL_ENV;
  afterEach(() => { if (ENV === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = ENV; });

  it('secret 설정 + 헤더 일치 → true', () => {
    expect(verifyWebhookSecret({ headers: { 'x-telegram-bot-api-secret-token': 's' } } as any, 's')).toBe(true);
  });
  it('secret 설정 + 헤더 불일치 → false', () => {
    expect(verifyWebhookSecret({ headers: { 'x-telegram-bot-api-secret-token': 'wrong' } } as any, 's')).toBe(false);
  });
  it('secret 미설정 + prod → false (fail-closed, 무인증 봇 차단)', () => {
    process.env.VERCEL_ENV = 'production';
    expect(verifyWebhookSecret({ headers: {} } as any, '')).toBe(false);
    expect(verifyWebhookSecret({ headers: {} } as any, undefined as any)).toBe(false);
  });
  it('secret 미설정 + dev/preview → true (로컬 테스트 스킵)', () => {
    process.env.VERCEL_ENV = 'preview';
    expect(verifyWebhookSecret({ headers: {} } as any, '')).toBe(true);
    delete process.env.VERCEL_ENV;
    expect(verifyWebhookSecret({ headers: {} } as any, '')).toBe(true);
  });
});
