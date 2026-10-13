/**
 * LLM 공급자 전환 (2026-10-13) 오답노트: vitest(esbuild) 는 중복 export 를 통과시키지만 Node 의 진짜 ESM
 * 로더는 "Duplicate export" 로 모듈 로드를 거부한다 → 운영 FUNCTION_INVOCATION_FAILED. 유닛 테스트 전부
 * 초록이어도 운영이 죽는 구멍이라, 핵심 서버 모듈을 **실제 node 프로세스**로 import 해 본다.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(__dirname, '..', '..');
const CORE = [
  'api/_shared/llm/index.js', 'api/_ai_core/geminiPipeline.js', 'api/_ai_core/blockMode.js', 'api/_ai_core/handlerCore.js',
  'api/ai-planner-full.js', 'api/ai-planner-quick.js', 'api/chat.js', 'api/translate-plan.js', 'api/course-ai.js',
  'api/mood-parse-schedule.js', 'api/_shared/translator.js', 'api/_crons/weekly-quality-report.js',
];

function nodeImport(specifiers: string[], cwd: string) {
  const code = `for (const m of ${JSON.stringify(specifiers)}) { await import(m); } console.log('LOADED');`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8', timeout: 120_000 });
}

describe('real Node ESM load of core server modules', () => {
  it('core modules import without a loader error (duplicate export / bad import path)', () => {
    const r = nodeImport(CORE.map((f) => './' + f), ROOT);
    expect(r.status, r.stderr.split('\n').find((l) => /Error/.test(l)) || r.stderr.slice(-400)).toBe(0);
    expect(r.stdout).toContain('LOADED');
  }, 130_000);

  it('self-check: the harness does fail on a duplicate export', () => {
    const dir = mkdtempSync(join(tmpdir(), 'esm-dup-'));
    writeFileSync(join(dir, 'dup.mjs'), "export const A = 1;\nexport { A };\n");
    const r = nodeImport(['./dup.mjs'], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Duplicate export/);
  });
});
