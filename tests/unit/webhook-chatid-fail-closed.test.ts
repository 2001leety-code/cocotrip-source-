/**
 * telegram admin/inquiry webhook chat_id fail-closed 회귀 (2026-06-13 ADM-1/ADM-2).
 * 결함: `if (adminChatId && chatId !== adminChatId)` — TELEGRAM_CHAT_ID 미설정 시 검사 스킵
 *   (fail-open) → 임의 chat 이 어드민 명령(예약생성/배차/매출) 실행 가능.
 * fix: prod(VERCEL_ENV==='production')에선 TELEGRAM_CHAT_ID 미설정 시 모든 chat 거부.
 *   (알림이 이 chat 으로 가므로 prod 에선 항상 설정됨 = 정상 동작 무변경. webhook secret 대안.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const adminSrc = readFileSync(resolve(process.cwd(), 'api/telegram-webhook-admin.js'), 'utf8');
const inquirySrc = readFileSync(resolve(process.cwd(), 'api/telegram-webhook-inquiry.js'), 'utf8');

describe('telegram webhook chat_id fail-closed (ADM-1/ADM-2 소스 가드)', () => {
  it('admin: TELEGRAM_CHAT_ID 미설정 + prod → 거부 (fail-closed)', () => {
    expect(adminSrc).toMatch(/if\s*\(\s*!adminChatId\s*\)/);
    expect(adminSrc).toMatch(/VERCEL_ENV[\s\S]{0,60}production/);
  });
  it('inquiry: 동일 fail-closed', () => {
    expect(inquirySrc).toMatch(/if\s*\(\s*!adminChatId\s*\)/);
    expect(inquirySrc).toMatch(/VERCEL_ENV[\s\S]{0,60}production/);
  });
});
