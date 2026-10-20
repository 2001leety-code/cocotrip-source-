/**
 * LLM 공급자 전환 (2026-10-13) 오답노트: vitest(esbuild) 는 중복 export 를 통과시키지만 Node 의 진짜 ESM
 * 로더는 "Duplicate export" 로 모듈 로드를 거부한다 → 운영 FUNCTION_INVOCATION_FAILED. 유닛 테스트 전부
 * 초록이어도 운영이 죽는 구멍이라, 핵심 서버 모듈을 **실제 node 프로세스**로 import 해 본다.
 *
 * 통합 2026-10-17: `node -e` 는 offline guard 가 거부하므로 고정 러너 파일로 바꿨다.
 *   - 자식 = `node <절대경로 러너>` 뿐 (인자·-e·--import 없음). 러너가 모듈 목록/경로를 고정으로 가진다.
 *   - 자식 env = 현재 env 그대로(guard 키 NODE_OPTIONS·OFFLINE_GUARD_CONFIG 유지) + METADATA_SERVER_DETECTION=none,
 *     자격증명 키만 제거 → firebase-admin 부트스트랩이 앱을 만들지 않아 import 시 DB/메타데이터 접근 없음.
 *     가짜 API 키는 넣지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(__dirname, '..', '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'integration-20261017');
const CORE_RUNNER = join(FIX, 'esm-load-core.mjs');
const DUP_RUNNER = join(FIX, 'esm-load-dup.mjs');
const DUP_SOURCE = join(FIX, 'esm-dup-export.mjs');

const CORE = [
  'api/_shared/llm/index.js', 'api/_ai_core/geminiPipeline.js', 'api/_ai_core/blockMode.js', 'api/_ai_core/handlerCore.js',
  'api/ai-planner-full.js', 'api/ai-planner-quick.js', 'api/chat.js', 'api/translate-plan.js', 'api/course-ai.js',
  'api/mood-parse-schedule.js', 'api/_shared/translator.js', 'api/_crons/weekly-quality-report.js',
];

const CREDENTIAL_KEYS = [
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
];

function childEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env, METADATA_SERVER_DETECTION: 'none' };
  for (const k of Object.keys(env)) if (CREDENTIAL_KEYS.includes(k.toUpperCase())) delete env[k];
  return env;
}

function runFixed(runner: string) {
  return spawnSync(process.execPath, [runner], { cwd: ROOT, env: childEnv(), encoding: 'utf8', timeout: 120_000 });
}

const guardDenied = (r: { stderr: string; stdout: string; error?: Error }) =>
  /OFFLINE_GUARD_DENIED/.test(`${r.stderr}${r.stdout}${r.error ? r.error.message : ''}`);

describe('real Node ESM load of core server modules', () => {
  it('the fixed runner lists exactly the 12 CORE modules (no drift, no skipped module)', () => {
    const src = readFileSync(CORE_RUNNER, 'utf8');
    const listed = [...src.matchAll(/'(api\/[^']+\.js)'/g)].map((m) => m[1]);
    expect(listed).toEqual(CORE);
    expect(listed).toHaveLength(12);
    expect(src).not.toMatch(/process\.argv\[/);
  });

  it('child env keeps the guard keys unchanged and carries no credentials', () => {
    const env = childEnv();
    for (const k of ['NODE_OPTIONS', 'OFFLINE_GUARD_CONFIG']) expect(env[k]).toBe(process.env[k]);
    expect(env.METADATA_SERVER_DETECTION).toBe('none');
    for (const k of Object.keys(env)) expect(CREDENTIAL_KEYS).not.toContain(k.toUpperCase());
  });

  it('core modules import without a loader error (duplicate export / bad import path)', () => {
    const r = runFixed(CORE_RUNNER);
    expect(r.error, r.error && r.error.message).toBeUndefined();
    expect(guardDenied(r), r.stderr.slice(-400)).toBe(false);
    expect(r.status, r.stderr.split('\n').find((l) => /ESM_LOAD_FAILED|Error/.test(l)) || r.stderr.slice(-400)).toBe(0);
    expect(r.stdout).toContain(`LOADED ${CORE.length}`);
    expect(r.stderr).not.toMatch(/ESM_LOAD_FAILED/);
  }, 130_000);

  it('self-check: the same runner style reports the real Duplicate export loader error', () => {
    const r = runFixed(DUP_RUNNER);
    expect(r.error, r.error && r.error.message).toBeUndefined();
    // 가드 거부나 아무 비정상 종료가 아니라, 실제 로더의 SyntaxError 여야 한다.
    expect(guardDenied(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ESM_LOAD_FAILED esm-dup-export\.mjs SyntaxError: Duplicate export of 'A'/);
    expect(r.stdout).not.toContain('LOADED');
  }, 130_000);

  it('negative control stores the exact fixed invalid source and loads it only via a native data: import', async () => {
    const mod: { DUPLICATE_EXPORT_SOURCE?: unknown } = await import(pathToFileURL(DUP_SOURCE).href);
    expect(mod.DUPLICATE_EXPORT_SOURCE).toBe('export const A = 1;\nexport { A };\n');
    expect(Object.keys(mod)).toEqual(['DUPLICATE_EXPORT_SOURCE']);

    const runner = readFileSync(DUP_RUNNER, 'utf8');
    expect(runner).toContain("import { DUPLICATE_EXPORT_SOURCE } from './esm-dup-export.mjs';");
    expect(runner).toContain('await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(DUPLICATE_EXPORT_SOURCE)}`);');
    expect(runner).toMatch(/if \(process\.argv\.length > 2\) \{[\s\S]*?process\.exit\(64\);/);
    // 외부 입력·eval·자식 프로세스·네트워크·로더 등록 없음.
    expect(runner).not.toMatch(/process\.argv\[|process\.env|\beval\(|new Function|child_process|node:module|register\(|fetch\(|https?:/);
  });
});
