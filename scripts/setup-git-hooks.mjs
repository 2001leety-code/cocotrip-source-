#!/usr/bin/env node
// CocoTrip git hooks 자동 활성화 (오답노트 P118).
// package.json `prepare` 가 npm install 직후 호출 → scripts/git-hooks 가
// .git/hooks 대신 사용되도록 git config core.hooksPath 등록.
//
// CI 또는 git repo 아닌 환경에선 noop. 이미 등록돼 있으면 noop.
// 새 dev 가 clone 후 npm install 만 해도 pre-commit + pre-push 자동 활성.

import { execSync } from 'node:child_process';
import { existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const HOOKS_DIR_REL = 'scripts/git-hooks';
const HOOKS_DIR_ABS = resolve(process.cwd(), HOOKS_DIR_REL);

if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true' || process.env.VERCEL === '1') {
  process.exit(0);
}

try {
  execSync('git rev-parse --git-dir', { stdio: 'ignore' });
} catch {
  process.exit(0);
}

if (!existsSync(HOOKS_DIR_ABS)) {
  console.error(`[setup-git-hooks] WARN: ${HOOKS_DIR_REL} not found — skipping`);
  process.exit(0);
}

let current = '';
try {
  current = execSync('git config core.hooksPath', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {}

if (current !== HOOKS_DIR_REL) {
  execSync(`git config core.hooksPath ${HOOKS_DIR_REL}`, { stdio: 'inherit' });
  console.log(`[setup-git-hooks] core.hooksPath = ${HOOKS_DIR_REL} (pre-commit + pre-push 활성)`);
}

for (const f of ['pre-commit', 'pre-push']) {
  const abs = resolve(HOOKS_DIR_ABS, f);
  if (existsSync(abs)) {
    try {
      chmodSync(abs, 0o755);
    } catch {}
  }
}
