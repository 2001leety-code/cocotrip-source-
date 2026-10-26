/**
 * 2026-10-26 — 플래너 텔레그램 알림(HTML)의 검증기 유래 문자열 이스케이프 + 런타임 Node 버전 로그.
 *   B-18 소프트경고("local_tag 비율 0% (0/9) < 30% 목표")·구조 검증 실패("stops.length=3 < 4 minimum")의 `<` 가
 *   Telegram HTML 파싱을 깨 알림이 안 갔다. 우리가 쓴 마크업(<b> 헤더)은 그대로, 문자열만 escapeTelegram. 소스 검사.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeTelegram } from '../../api/_shared/escape.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const count = (src: string, needle: string) => src.split(needle).length - 1;

describe('geminiPipeline alerts escape validator strings', () => {
  const src = read('api/_ai_core/geminiPipeline.js');
  it('imports escapeTelegram', () => {
    expect(src).toMatch(/import \{ escapeTelegram \} from '\.\.\/_shared\/escape\.js';/);
  });
  it('both B-18 soft-warning alerts and both structure-failure alerts wrap the strings', () => {
    expect(count(src, 'softWarnings.map((w) => escapeTelegram(w.message))')).toBe(2);
    expect(count(src, 'patternErrors.slice(0, 5).map((e) => escapeTelegram(String(e)))')).toBe(2);
    expect(src).not.toMatch(/softWarnings\.map\(\(w\) => w\.message\)/);
    expect(src).not.toMatch(/patternErrors\.slice\(0, 5\)\.join\(/);
    expect(count(src, '<b>Plan 다양성 미달 (B-18)</b>')).toBe(2); // 헤더 마크업은 그대로(이스케이프하지 않음)
  });
  it('the real B-18 message becomes safe HTML text', () => {
    const out = escapeTelegram('local_tag 비율 0% (0/9) < 30% 목표 (B-18)');
    expect(out).toContain('&lt;');
    expect(out).not.toContain('<');
  });
});

describe('runtime node version log (once per cold start, module top level)', () => {
  it.each(['api/plan-status.js', 'api/_ai_core/handlerCore.js'])('%s logs it exactly once', (file) => {
    const src = read(file);
    expect(count(src, 'console.log(`[runtime] node=${process.version} region=${process.env.VERCEL_REGION || \'-\'}`);')).toBe(1);
    const at = src.indexOf('[runtime] node=');
    // 최상위: 첫 함수/핸들러 정의보다 앞(요청마다 찍지 않는다).
    const firstFn = src.search(/\n(export )?(default )?(async )?function /);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(firstFn);
  });
});
