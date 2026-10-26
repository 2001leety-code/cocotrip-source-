/**
 * 2026-10-26 운영 정리 (Astra A·D4).
 *
 * A — Daily Health 다양성: 서버가 mock LLM 실행을 "확인"한 비교쌍(rep1/rep2 둘 다)만 미평가(실패 판정 제외).
 *     mock 은 같은 입력에 같은 블록을 고르므로 중복률이 구조적으로 높다(api/_shared/llm/mock.js 결정적 순환).
 *     헤더 요청만으로는 확인이 아니다 — 서버 _debug.llmMock === true 일 때만. 생성 증거(stops)는 계속 필수.
 * D4 — 텔레그램 HTML 메시지 5곳의 동적 값은 escapeTelegram 으로 감싼다('<'·'&' 로 parse 실패 방지).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { callBot, setDoc } = vi.hoisted(() => ({
  callBot: vi.fn(async () => ({ result: { message_id: 7 } })),
  setDoc: vi.fn(async () => {}),
}));
vi.mock('../../api/_shared/telegram-bot.js', () => ({ callBot }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({ collection: () => ({ doc: () => ({ set: setDoc, get: async () => ({ exists: false }) }) }) }),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));

import { calcDiversity, extractPlannerDiagnostics } from '../../scripts/validate-planner.cjs';
import { evaluateHealthRecord } from '../../scripts/daily-health-check.mjs';
import { buildAdminDebug } from '../../api/_ai_core/debugInfo.js';
import { runWithLlmContext } from '../../api/_shared/llm/index.js';
import { sendDispatchToDriver } from '../../api/_shared/dispatch-helpers.js';

const stops = (names: string[]) => names.map((name) => ({ name }));
const SAME = ['도선사', '백운대 정상', '임진각', '헤이리', '오두산통일전망대', '인수봉 전망대', '명동 숙소', 'A', 'B'];
const rep = (id: string, names: string[], llmMock?: boolean) => ({
  scenario: { id }, ok: true, stops: stops(names),
  planner_diagnostics: { plannerPath: 'block_mode', ...(llmMock ? { llmMock: true } : {}) },
});

describe('A — calcDiversity: 확인된 mock 비교쌍만 미평가', () => {
  it('둘 다 서버 확인 mock → evaluated:false·ok:true, 중복률은 표시용으로 남는다', () => {
    const d = calcDiversity([rep('seoul-meat-rep1', SAME, true), rep('seoul-meat-rep2', SAME, true)]);
    expect(d).toMatchObject({ evaluated: false, skip_reason: 'llm_mock', ok: true, reason: null, overlap_ratio: 100 });
    expect(d.note).toContain('미평가');
  });
  it('한쪽만 mock 확인 → 종전대로 평가(중복 ≥30% 실패)', () => {
    const d = calcDiversity([rep('seoul-meat-rep1', SAME, true), rep('seoul-meat-rep2', SAME)]);
    expect(d).toMatchObject({ evaluated: true, ok: false });
    expect(d.reason).toContain('30%');
  });
  it('mock 확인이어도 생성 증거(stops) 결측이면 실패', () => {
    const d = calcDiversity([rep('seoul-meat-rep1', SAME, true), { ...rep('seoul-meat-rep2', [], true) }]);
    expect(d.ok).toBe(false);
    expect(d.overlap_ratio).toBeNull();
  });
  it('실 LLM(표시 없음) → 낮은 중복은 통과', () => {
    const d = calcDiversity([rep('seoul-meat-rep1', ['a', 'b', 'c', 'd']), rep('seoul-meat-rep2', ['e', 'f', 'g', 'a'])]);
    expect(d).toMatchObject({ evaluated: true, ok: true, overlap_ratio: 25 });
  });
});

describe('A — extractPlannerDiagnostics: llmMock 은 정확히 true 일 때만', () => {
  it('true → llmMock:true, 그 밖의 값은 키 없음', () => {
    expect(extractPlannerDiagnostics({ data: { _debug: { blockModeUsed: true, llmMock: true } } }).llmMock).toBe(true);
    expect(extractPlannerDiagnostics({ data: { _debug: { blockModeUsed: true, llmMock: 'true' } } })).not.toHaveProperty('llmMock');
    expect(extractPlannerDiagnostics({ _debug: { blockModeUsed: false, plannerMode: 'legacy' } })).not.toHaveProperty('llmMock');
  });
});

describe('A — buildAdminDebug: 요청 컨텍스트가 mock 일 때만 llmMock', () => {
  const gate = { isAdminBypass: true };
  it('provider=mock 컨텍스트 → llmMock:true', () => {
    const d = runWithLlmContext({ mockRequested: true, provider: 'mock' }, () => buildAdminDebug({ gate, blockModeUsed: true }));
    expect(d).toMatchObject({ isAdminBypass: true, llmMock: true });
  });
  it('헤더만 요청(mockRequested)·provider 미전환 → 키 없음', () => {
    const d = runWithLlmContext({ mockRequested: true }, () => buildAdminDebug({ gate, blockModeUsed: true }));
    expect(d).not.toHaveProperty('llmMock');
  });
  it('관리자 우회가 아니면 _debug 자체가 없다', () => {
    expect(runWithLlmContext({ provider: 'mock' }, () => buildAdminDebug({ gate: { isAdminBypass: false } }))).toBeUndefined();
  });
});

describe('A — evaluateHealthRecord: 미평가 다양성은 실패 사유가 아니다', () => {
  const okPings = [{ name: 'home', ok: true, status: 200, elapsed_ms: 10 }];
  const base = {
    ok: true, total_issues: 2, total_scenarios: 5, success_count: 5, fail_count: 0, failed_scenario_ids: [],
    departure_overrun_total: 0, diversity_overlap: 77.78, diversity_ok: true, diversity_reason: null,
    diversity_evaluated: false,
  };
  it('diversity_ok=true(미평가) → HEALTHY', () => {
    const g = evaluateHealthRecord({ pings: okPings, validation: base, expectedScenarioCount: 5 });
    expect(g.ok).toBe(true);
    expect(g.reasons).toEqual([]);
  });
});

describe('D4 — 배차 메시지 동적 값 escape (직접 callBot 발송)', () => {
  beforeEach(() => { callBot.mockClear(); });
  it('고객 메모·픽업의 < & > 가 HTML 엔티티로 바뀐다', async () => {
    const r = await sendDispatchToDriver({
      orderID: 'ORD<1>', driverChatId: '42', driverBotToken: 'tkn',
      driver: { name: '기사', active: true },
      booking: { product: 'Tour & <b>VIP</b>', tourDate: '2026-11-01', paxCount: 3, pickupLocation: 'Hotel <Lotte>', memo: 'A&B <script>' },
    });
    expect(r.ok).toBe(true);
    const text = String((callBot.mock.calls[0] as unknown[])[2] && ((callBot.mock.calls[0] as unknown[])[2] as { text: string }).text);
    expect(text).toContain('예약번호: <code>ORD&lt;1&gt;</code>');
    expect(text).toContain('상품: Tour &amp; &lt;b&gt;VIP&lt;/b&gt;');
    expect(text).toContain('픽업: Hotel &lt;Lotte&gt;');
    expect(text).toContain('메모: A&amp;B &lt;script&gt;');
    expect(text).toMatch(/^<b>새 배차 요청<\/b>/);
  });
});

describe('D4 — 나머지 4곳은 동적 값을 escapeTelegram 으로 감싼다 (소스 가드)', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  it('기사 거절 어드민 알림', () => {
    const s = read('api/telegram-webhook-driver.js');
    expect(s).toContain('<code>${esc(orderID)}</code>');
    expect(s).toContain("거절 기사: ${esc(dispatch.driverName || '-')}");
  });
  it('Inngest 최종 실패 알림', () => {
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toContain("error=${escapeTelegram((error?.message || 'unknown').slice(0, 200))}");
  });
  it('booking-processor 단계 실패 알림', () => {
    const s = read('api/booking-processor.js');
    expect(s).toContain("<code>${escapeTelegram(bookingRef || '-')}</code>");
    expect(s).toContain("${escapeTelegram(failedSteps.join('\\n'))}");
  });
  it('수동 배차 명령(기사 거절 알림이 안내하는 경로)도 같은 값을 escape', () => {
    const s = read('api/telegram-webhook-admin.js');
    expect(s).toContain('예약번호: <code>${escapeHtmlLocal(orderID)}</code>');
    expect(s).toContain("픽업: ${escapeHtmlLocal(booking.pickupLocation || '-')}");
    expect(s).toContain('메모: ${escapeHtmlLocal(booking.memo)}');
  });
  it('같은 파일의 나머지 HTML 알림도 escape (형제 경로)', () => {
    const b = read('api/booking-processor.js');
    expect(b).toContain("<b>상품:</b> ${escapeTelegram(product || '(미지정)')}");
    expect(b).toContain('<b>BookingRef:</b> <code>${escapeTelegram(bookingRef)}</code>');
    expect(b).toContain('오류: ${escapeTelegram(err.code || err.message)}');
    const p = read('api/_inngest/functions/processPlanAfterAI.js');
    expect(p).toContain('err=${escapeTelegram(skErr.message)}');
    expect(p).toContain('err=${escapeTelegram(markErr.message)}');
    const d = read('api/telegram-webhook-driver.js');
    expect(d).toContain('${esc(orderID)} → ${esc(dispatch.driverName)}');
  });
  it('ai-planner-modify 처리 안 된 오류 알림', () => {
    expect(read('api/ai-planner-modify.js')).toContain("${escapeTelegram(err?.message || 'unknown')}");
  });
});
