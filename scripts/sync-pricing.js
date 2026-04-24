#!/usr/bin/env node
/**
 * sync-pricing.js — pricing_spec.json 동기화
 *
 * src/data/pricing_spec.json (SSOT)을 다음 위치에 복사:
 *   1. api/_pricing_spec.json  (Vercel Node API routes가 require 가능한 동일 디렉토리)
 *   2. 프로젝트 루트 ../../pricing_spec.json  (Python 파이프라인 pricing.py가 읽음)
 *
 * 실행:
 *   node scripts/sync-pricing.js
 *
 * package.json의 prebuild/predeploy에 연결 권장:
 *   "scripts": { "sync-pricing": "node scripts/sync-pricing.js" }
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');              // 홈페이지 클로드ai/홈페이지 사이트 최근/
const PYTHON_ROOT  = resolve(__dirname, '..', '..', '..');  // E:/ai에이젼시만들기/

const SRC     = join(PROJECT_ROOT, 'src', 'data', 'pricing_spec.json');
const API_DST = join(PROJECT_ROOT, 'api', '_pricing_spec.json');
const PY_DST  = join(PYTHON_ROOT,  'pricing_spec.json');

if (!existsSync(SRC)) {
  console.error(`[sync-pricing] SSOT missing: ${SRC}`);
  process.exit(1);
}

const body = readFileSync(SRC, 'utf-8');
const parsed = JSON.parse(body);
console.log(`[sync-pricing] SSOT version ${parsed.version} (${body.length} bytes)`);

writeFileSync(API_DST, body, 'utf-8');
console.log(`[sync-pricing] → ${API_DST}`);

try {
  writeFileSync(PY_DST, body, 'utf-8');
  console.log(`[sync-pricing] → ${PY_DST}`);
} catch (err) {
  console.warn(`[sync-pricing] Python root copy skipped: ${err.message}`);
}

console.log('[sync-pricing] done.');
