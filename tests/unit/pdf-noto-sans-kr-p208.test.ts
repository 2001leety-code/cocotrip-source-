/**
 * P208 (2026-05-26): PDF Noto Sans KR 번들 검증.
 *
 * 배경:
 * - @sparticuz/chromium v147 = Open Sans 1개만 번들 (CJK 0개)
 * - 기존 코드 주석 "CJK 자동 fallback" 이 거짓 → 한글 PDF 글리프 누락
 * - vercel.json pdf/generate.js 전용 maxDuration 미설정 → wildcard 30초 적용
 *
 * fix:
 * - fonts/ 디렉토리에 NotoSansKR Regular + Bold OTF 번들
 * - buildPlanHtml @font-face 에 file:///var/task/fonts/ URL 명시
 * - vercel.json "api/pdf/generate.js": { maxDuration: 60 } 추가
 *
 * 회귀 시: buildPlanHtml CSS 에 @font-face 없으면 한글 PDF 공백 재현.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// generate.js 는 ESM import + firebase-admin 의존성 → 직접 import 불가.
// buildPlanHtml 출력을 readFileSync 로 소스 분석하는 방식으로 검증.
const GENERATE_SRC = readFileSync(
  resolve(process.cwd(), 'api/pdf/generate.js'),
  'utf-8',
);

const VERCEL_JSON = JSON.parse(
  readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf-8'),
);

describe('P208 — Noto Sans KR 번들 + maxDuration:60', () => {
  // ── 1. 폰트 파일 존재 확인 ──────────────────────────────────────────────
  it('fonts/NotoSansKR-Regular.otf 파일 존재', () => {
    const path = resolve(process.cwd(), 'fonts/NotoSansKR-Regular.otf');
    expect(existsSync(path), `${path} 파일 없음`).toBe(true);
  });

  it('fonts/NotoSansKR-Bold.otf 파일 존재', () => {
    const path = resolve(process.cwd(), 'fonts/NotoSansKR-Bold.otf');
    expect(existsSync(path), `${path} 파일 없음`).toBe(true);
  });

  // ── 2. @font-face CSS 선언 검증 ─────────────────────────────────────────
  it('generate.js buildPlanHtml 에 @font-face Noto Sans KR Regular 선언 존재', () => {
    expect(GENERATE_SRC).toContain("font-family: 'Noto Sans KR'");
    expect(GENERATE_SRC).toContain('NotoSansKR-Regular.otf');
  });

  it('generate.js buildPlanHtml 에 @font-face Noto Sans KR Bold 선언 존재', () => {
    expect(GENERATE_SRC).toContain('font-weight: 700');
    expect(GENERATE_SRC).toContain('NotoSansKR-Bold.otf');
  });

  it('generate.js @font-face src 에 file:///var/task/fonts/ 경로 사용', () => {
    expect(GENERATE_SRC).toContain('file:///var/task/fonts/NotoSansKR-Regular.otf');
    expect(GENERATE_SRC).toContain('file:///var/task/fonts/NotoSansKR-Bold.otf');
  });

  it('generate.js body font-family 가 Noto Sans KR 우선순위', () => {
    // body 에 system-ui 만 있으면 CJK fallback 없음 → P208 회귀
    const bodyMatch = GENERATE_SRC.match(/body\s*\{[^}]*font-family\s*:[^}]*\}/);
    expect(bodyMatch, 'body CSS 블록 없음').toBeTruthy();
    const bodyCSS = bodyMatch![0];
    // Noto Sans KR 이 system-ui 보다 앞에 와야 함
    const notoIdx = bodyCSS.indexOf('Noto Sans KR');
    const systemIdx = bodyCSS.indexOf('system-ui');
    expect(notoIdx, "body font-family 에 'Noto Sans KR' 없음 — P208 회귀").toBeGreaterThan(-1);
    if (systemIdx !== -1) {
      expect(notoIdx, 'Noto Sans KR 이 system-ui 보다 뒤에 있음').toBeLessThan(systemIdx);
    }
  });

  // ── 3. vercel.json maxDuration 검증 ────────────────────────────────────
  it('vercel.json api/pdf/generate.js maxDuration = 60', () => {
    const pdfFn = VERCEL_JSON?.functions?.['api/pdf/generate.js'];
    expect(pdfFn, 'api/pdf/generate.js functions 설정 없음').toBeTruthy();
    expect(pdfFn.maxDuration, 'maxDuration 값 불일치 — 30초 wildcard 적용됨').toBe(60);
  });

  it('vercel.json api/pdf/generate.js includeFiles 에 fonts 포함', () => {
    const pdfFn = VERCEL_JSON?.functions?.['api/pdf/generate.js'];
    expect(pdfFn?.includeFiles, 'includeFiles 없음').toBeTruthy();
    expect(
      pdfFn.includeFiles,
      'fonts/** 패턴 없음 — fonts/ OTF 가 Vercel 번들에서 제외됨',
    ).toMatch(/fonts/);
  });

  // ── 4. R-P208 lint rule: chromium.font() 는 더 이상 필요 없음 확인 ──────
  // @sparticuz/chromium.font() API 는 Lambda Layer 전용 — Vercel file:// 방식과 충돌 없음.
  // fonts/ 디렉토리 자동 fc-cache + @font-face file:// 병행 전략 사용.
  it('generate.js 에 P208 패치 주석 존재 (회귀 추적용)', () => {
    expect(GENERATE_SRC).toContain('P208');
    expect(GENERATE_SRC).toContain('@sparticuz/chromium');
  });
});
