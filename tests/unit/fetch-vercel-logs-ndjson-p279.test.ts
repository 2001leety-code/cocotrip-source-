/**
 * P279 (2026-05-29): scripts/fetch-vercel-logs.mjs NDJSON 파싱 fix 회귀 차단.
 *
 * Root cause: Vercel runtime-logs API 가 NDJSON (newline-delimited JSON) 응답.
 *   이전: api() 가 res.json() 호출 → multi-line JSON 첫 줄만 파싱 → SyntaxError.
 *   현재: text() + split('\n') + per-line JSON.parse 패턴.
 *
 * 회귀 시: P266-P274 cycle 검증 시 Vercel logs 0 entries (실제로는 logs 있는데 파싱 실패).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P279 fetch-vercel-logs.mjs NDJSON 파싱 fix', () => {
  const srcPath = resolve(__dirname, '../../scripts/fetch-vercel-logs.mjs');
  const src = readFileSync(srcPath, 'utf8');

  it('runtime-logs fetch — text() + split + per-line JSON.parse 패턴', () => {
    // runtime-logs URL 직접 fetch (api() 안 거침)
    expect(src).toMatch(/const\s+logsUrl\s*=\s*`https:\/\/api\.vercel\.com\/v1\/projects\//);
    expect(src).toMatch(/const\s+logsRes\s*=\s*await\s+fetch\(logsUrl,\s*\{\s*headers\s*\}\)/);
    // text() 호출
    expect(src).toMatch(/const\s+logsText\s*=\s*await\s+logsRes\.text\(\)/);
    // split('\n') + filter + per-line JSON.parse
    expect(src).toMatch(/\.split\('\\n'\)[\s\S]{0,200}\.map\(line\s*=>\s*\{[\s\S]{0,100}JSON\.parse\(line\)/);
  });

  it('runtime-logs fetch — api() 직접 호출 회귀 차단', () => {
    // 이전 패턴: const logsRaw = await api(`/v1/projects/.../runtime-logs...`)
    // 본 패턴이 회귀 시 NDJSON 파싱 실패.
    expect(src).not.toMatch(/const\s+logsRaw\s*=\s*await\s+api\(`\/v1\/projects\/.*runtime-logs/);
  });

  it('P279 reference + NDJSON 키워드 명시', () => {
    expect(src).toContain('P279');
    expect(src).toContain('NDJSON');
  });
});
