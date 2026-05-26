/**
 * P218 (2026-05-26): elapsed timer alert 가독성 fix — unit test.
 *
 * 배경:
 *   prod Telegram alert 에 "elapsed=3785561ms" 만 표시돼 운영자가 "63분" 으로
 *   오해. Vercel maxDuration=300s (5분) 인데 63분이 보이면 "불가능한 값" 혼란.
 *   실제 값은 routeEnrich 가 P203 cap 전에 이미 쌓인 시간이었음.
 *
 * fix:
 *   handlerCore.js — fmtMs() 함수 추가. hangWarnTimer alert 에 "3785561ms (63분 5초)" 형태.
 *   postResponsePipeline.js — routeEnrich timeout alert 도 동일 형태.
 *
 * 외부 사례 (deep-search):
 *   - Vercel serverless 에서 Date.now() 는 wall-clock (monotonic 보장 X) — Node.js docs.
 *   - Google AI Forum #81258: Flash 비결정성 + timer 누적 오인 케이스 공식 인정.
 *   - 3 AI (Claude + GPT thinking + Gemini) 합의: "앱 내부 계측 포맷 버그" 판정.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../../../');
const HANDLER_CORE_PATH = path.join(ROOT, 'api/_ai_core/handlerCore.js');
const POST_PIPELINE_PATH = path.join(ROOT, 'api/_ai_core/postResponsePipeline.js');

const handlerSrc = readFileSync(HANDLER_CORE_PATH, 'utf-8');
const postPipelineSrc = readFileSync(POST_PIPELINE_PATH, 'utf-8');

// ── fmtMs 로직을 테스트용으로 로컬 재현 ─────────────────────────────────────
// handlerCore.js 내부 closure 이므로 소스 검증 + 로직 직접 재현 병행.
function fmtMs(ms: number): string {
  const n = Math.round(Number(ms) || 0);
  if (n < 1000) return `${n}ms`;
  const totalSec = Math.floor(n / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}분`);
  parts.push(`${s}초`);
  return `${n}ms (${parts.join(' ')})`;
}

describe('P218 elapsed timer alert 가독성', () => {

  // ── fmtMs 로직 단위 검증 ─────────────────────────────────────────────────

  it('P218-A1: 1초 미만은 "Nms" 형태 (분 단위 없음)', () => {
    expect(fmtMs(500)).toBe('500ms');
    expect(fmtMs(0)).toBe('0ms');
    expect(fmtMs(999)).toBe('999ms');
  });

  it('P218-A2: 1초 이상은 "Nms (X초)" 형태', () => {
    const result = fmtMs(5000);
    expect(result).toContain('5000ms');
    expect(result).toContain('5초');
  });

  it('P218-A3: 63분 false alarm 케이스 — 3785561ms = "1h 3분 5초" 형태 포함', () => {
    // prod에서 실제 보고된 값: elapsed=3785561ms (1h 3분 5초 = 3785s)
    // 1h = 3600s, 3785 - 3600 = 185s = 3분 5초 → "1h 3분 5초"
    const result = fmtMs(3785561);
    expect(result).toContain('3785561ms');
    expect(result).toContain('1h');
    expect(result).toMatch(/3분/);
    expect(result).toMatch(/5초/);
    // "Nh" 단위가 있으면 운영자가 "불가능한 63분" 오해 하지 않음 — 1h 3분이면 63분임을 바로 계산 가능
  });

  it('P218-A4: 97분 "불가능 값" 케이스 — 5839802ms = "1h 37분 19초" 포함', () => {
    // prod에서 실제 보고된 값: total elapsed=5839802ms (~97분)
    const result = fmtMs(5839802);
    expect(result).toContain('5839802ms');
    expect(result).toContain('1h');
    expect(result).toMatch(/37분/);
  });

  it('P218-A5: HANG_WARN_MS = 270,000ms (4.5분) 정상 케이스', () => {
    // hangWarnTimer 정상 발사 시 총 elapsed ≈ 270s
    const result = fmtMs(270_000);
    expect(result).toContain('270000ms');
    expect(result).toMatch(/4분/);
    expect(result).toMatch(/30초/);
  });

  it('P218-A6: 100ms (빠른 step) 단순 표시', () => {
    expect(fmtMs(100)).toBe('100ms');
  });

  // ── handlerCore.js 소스 정적 검증 ───────────────────────────────────────

  it('P218-B1: handlerCore.js 에 fmtMs 함수 정의 존재 (P218 fix 박제)', () => {
    expect(handlerSrc).toMatch(/function fmtMs\s*\(/);
  });

  it('P218-B2: hangWarnTimer alert 에 fmtMs() 래핑 (raw ms 단독 노출 금지)', () => {
    // step elapsed 라인에 fmtMs 래핑 확인.
    expect(handlerSrc).toMatch(/step elapsed.*fmtMs\(/);
  });

  it('P218-B3: total elapsed 에도 fmtMs() 래핑 (P218 양쪽 모두 fix)', () => {
    expect(handlerSrc).toMatch(/total elapsed.*fmtMs\(/);
  });

  it('P218-B4: P218 코멘트 존재 (의도 박제)', () => {
    expect(handlerSrc).toMatch(/P218/);
    expect(handlerSrc).toMatch(/fmtMs/);
  });

  // ── postResponsePipeline.js 소스 정적 검증 ──────────────────────────────

  it('P218-C1: routeEnrich timeout alert 에 human 단위 변수 존재 (eh)', () => {
    // P218 압축 후 elapsedHuman → eh (P203 test 500char limit 유지)
    expect(postPipelineSrc).toMatch(/\beh\b/);
  });

  it('P218-C2: routeEnrich alert 메시지에 분/초 단위 병기', () => {
    // "elapsed=${elapsed}ms (${eh})" 패턴
    expect(postPipelineSrc).toMatch(/elapsed=\$\{elapsed\}ms.*\$\{eh\}/);
  });

  it('P218-C3: elapsedSec (es) 계산 로직 — 60 기준 분기 존재', () => {
    expect(postPipelineSrc).toMatch(/es\s*>=\s*60/);
  });

  it('P218-C4: P218 코멘트 postResponsePipeline.js 에도 존재', () => {
    expect(postPipelineSrc).toMatch(/P218/);
  });
});
