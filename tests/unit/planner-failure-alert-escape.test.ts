/**
 * AI 플래너 처리 실패 텔레그램 알림 — 오류 메시지 HTML escape (2026-10-23).
 * 잠그는 것: 메시지에 `<`·`>`·`&` 가 있으면 escape 되어 전달(텔레그램 "can't parse entities" 로 알림이 사라지던 회귀),
 *   handler catch 본문(planCloseout.js)이 이 빌더를 쓴다(원문 error.message 직접 삽입 금지).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plannerFailureAlertMessage } from '../../api/_ai_core/plannerFailureAlert.js';

describe('plannerFailureAlertMessage', () => {
  it('escapes <, > and & in the error message (our own <b> tag stays)', () => {
    const msg = plannerFailureAlertMessage('Unexpected token <html> & "x"', 'legacy');
    expect(msg).toContain('Unexpected token &lt;html&gt; &amp; "x"');
    expect(msg).not.toContain('<html>');
    expect(msg.startsWith('🔴 <b>AI 플래너 처리 실패</b>')).toBe(true);
    expect(msg).toContain('모드: legacy');
  });

  it('lone ">" and lone "&" are escaped too', () => {
    expect(plannerFailureAlertMessage('a > b', 'legacy')).toContain('a &gt; b');
    expect(plannerFailureAlertMessage('R&D', 'legacy')).toContain('R&amp;D');
    expect(plannerFailureAlertMessage('a > b', 'legacy')).not.toContain('a > b');
  });

  it('<script> is neutralised while the fixed <b> header tag stays', () => {
    const msg = plannerFailureAlertMessage('<script>alert(1)</script>', 'legacy');
    expect(msg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(msg).not.toContain('<script>');
    expect(msg).toContain('<b>AI 플래너 처리 실패</b>');
    // 우리가 넣은 태그는 <b> 한 쌍뿐이어야 한다.
    expect((msg.match(/<[^>]+>/g) || [])).toEqual(['<b>', '</b>']);
  });

  it('missing message → fallback text', () => {
    expect(plannerFailureAlertMessage(undefined, '3pass')).toContain('알 수 없는 오류');
  });

  // 2026-10-23 plan-error-closeout: catch 본문은 planCloseout.js(runHandlerFailureCleanup)로 옮겨졌다.
  it('planCloseout (handler catch body) uses the builder; handlerCore has no raw alert template', () => {
    const closeout = readFileSync(resolve(process.cwd(), 'api/_ai_core/planCloseout.js'), 'utf8');
    const core = readFileSync(resolve(process.cwd(), 'api/_ai_core/handlerCore.js'), 'utf8');
    expect(closeout).toMatch(/import\s+\{\s*plannerFailureAlertMessage\s*\}\s+from\s+['"]\.\/plannerFailureAlert\.js['"]/);
    expect(closeout).toMatch(/message:\s*plannerFailureAlertMessage\(error\.message,\s*plannerMode\)/);
    expect(core).not.toContain('AI 플래너 처리 실패');
    for (const src of [closeout, core]) expect(src).not.toContain('${error.message');
  });
});
