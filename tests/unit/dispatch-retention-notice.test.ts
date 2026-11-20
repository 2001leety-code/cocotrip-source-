/**
 * 2026-11-21 처리방침 제3·7조 — 렌터카 회사·기사에게 준 정보는 운행 끝난 뒤 1개월.
 * 회사·기사 기기는 우리가 지울 수 없으니 배차 글 3곳(자동 배차·수동 /dispatch·수락 뒤 글) 모두
 * 같은 문장(DISPATCH_RETENTION_NOTICE)으로 지워 달라고 부탁한다. 한쪽만 고침 방지.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { callBot } = vi.hoisted(() => ({ callBot: vi.fn(async () => ({ result: { message_id: 7 } })) }));
vi.mock('../../api/_shared/telegram-bot.js', () => ({ callBot }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({ collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false }) }) }) }),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));

import { sendDispatchToDriver, DISPATCH_RETENTION_NOTICE } from '../../api/_shared/dispatch-helpers.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('배차 글 — 운행 끝나면 1개월 안에 지워 달라는 한 줄', () => {
  it('문장이 1개월 삭제를 말한다', () => {
    expect(DISPATCH_RETENTION_NOTICE).toContain('1개월');
    expect(DISPATCH_RETENTION_NOTICE).toContain('지워');
  });

  it('자동 배차 글 끝에 붙는다', async () => {
    const r = await sendDispatchToDriver({
      orderID: 'ORD1', driverChatId: '42', driverBotToken: 'tkn',
      driver: { name: '기사', active: true },
      booking: { product: 'Tour', tourDate: '2026-11-01', paxCount: 2, pickupLocation: 'Hotel' },
    });
    expect(r.ok).toBe(true);
    const text = ((callBot.mock.calls[0] as unknown[])[2] as { text: string }).text;
    expect(text.endsWith(DISPATCH_RETENTION_NOTICE)).toBe(true);
  });

  it('수동 /dispatch 글과 수락 뒤 글도 같은 상수를 쓴다', () => {
    const admin = read('api/telegram-webhook-admin.js');
    expect(admin).toContain('`\\n10분 내 응답 부탁드립니다.\\n${DISPATCH_RETENTION_NOTICE}`');
    const driver = read('api/telegram-webhook-driver.js');
    expect(driver).toContain('`당일 정시에 픽업 장소에서 대기해 주세요.\\n${DISPATCH_RETENTION_NOTICE}`');
  });
});
