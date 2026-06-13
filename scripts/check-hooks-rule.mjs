#!/usr/bin/env node
/**
 * pre-push step 5 — react-hooks/rules-of-hooks 게이트 (변경 파일 한정).
 *
 * 배경(2026-06-13): MoodPortal 이 useCallback 훅을 early-return 아래에 둬서
 * "Rendered more hooks than during the previous render" 런타임 크래시 → 페이지
 * 화이트아웃 → prod 장애. 같은 부류(CharterBanner)도 잠복해 있었음.
 *
 * 왜 전체 eslint 가 아니라 이 규칙만?
 *   `eslint .` 는 기존 에러 1500+ (대부분 타입/스타일) 라 게이트로 못 씀.
 *   rules-of-hooks 는 **런타임 크래시**를 일으키는 정확성 규칙이라 이것만 hard-fail.
 *   변경(ACMR) 된 .ts/.tsx/.js/.jsx 에만 적용 → 기존 무관 파일은 막지 않음.
 *
 * exit 1 = 위반 발견(푸시 차단). exit 0 = clean / 대상 없음 / 진단불가(다른 단계가 커버).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const base = process.argv[2] || 'origin/main';
const RULE = 'react-hooks/rules-of-hooks';

let changed = [];
try {
  const out = execSync(`git diff --name-only --diff-filter=ACMR ${base}...HEAD`, { encoding: 'utf8' });
  changed = out
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => /\.(tsx|ts|jsx|js)$/.test(f) && existsSync(f));
} catch {
  console.log('[hooks-rule] git diff 불가 (shallow 등) — skip');
  process.exit(0);
}

if (changed.length === 0) {
  console.log('[hooks-rule] 변경된 JS/TS 없음 — OK');
  process.exit(0);
}

// eslint 는 에러 있으면 non-zero exit → stdout(json)을 catch 에서 회수.
let raw = '[]';
try {
  raw = execSync(
    `npx --no-install eslint ${changed.map((f) => `"${f}"`).join(' ')} -f json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
} catch (e) {
  raw = (e && e.stdout) ? e.stdout : '[]';
}

let results;
try {
  results = JSON.parse(raw);
} catch {
  console.log('[hooks-rule] eslint 출력 파싱 실패 — skip (build/lint 단계가 커버)');
  process.exit(0);
}

const violations = [];
for (const r of results) {
  for (const m of r.messages || []) {
    if (m.ruleId === RULE && m.severity === 2) {
      violations.push(`  ${r.filePath}:${m.line}:${m.column}  ${m.message}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`[hooks-rule] ❌ ${RULE} 위반 ${violations.length}건 — React 훅 순서 오류 (런타임 크래시 유발):`);
  console.error(violations.join('\n'));
  console.error('  → 훅을 모든 조건/early-return 보다 위에서 호출하세요.');
  process.exit(1);
}

console.log(`[hooks-rule] ✅ 변경 ${changed.length}개 파일 — rules-of-hooks clean`);
process.exit(0);
