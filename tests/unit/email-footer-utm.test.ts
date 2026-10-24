/**
 * 2026-10-24 (유입·전환 점검) — 거래 메일 하단 사이트 링크에 UTM(email/footer/transactional).
 *   메일에서 들어온 방문이 GA/PostHog 에서 direct 로 섞이지 않게. 복구 메일(preview-lead-recovery)은 자체 UTM 그대로.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const UTM_LINK = 'href="https://cocotripkr.com/?utm_source=email&utm_medium=footer&utm_campaign=transactional"';

describe('transactional email footer links carry UTM', () => {
  it.each([
    ['api/_email-renderer.js', 2],
    ['api/_send-email.js', 1],
  ])('%s: %i footer link(s) with UTM, no bare site link left', (file, count) => {
    const src = read(file);
    expect(src.split(UTM_LINK).length - 1).toBe(count);
    expect(src).not.toContain('href="https://cocotripkr.com"');
  });

  it('the recovery email keeps its own campaign UTM (untouched)', () => {
    expect(read('api/_crons/preview-lead-recovery.js')).toContain("'https://cocotripkr.com/planner?utm_source=email&utm_medium=recovery&utm_campaign=preview_lead'");
  });
});
