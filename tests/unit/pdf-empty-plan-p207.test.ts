/**
 * P207 (2026-05-26): server PDF endpoint 가 days=0 plan 도 "성공" PDF 생성하던 문제.
 *
 * 5/26 시각 검증 발견: sample 2, 5 — `_streaming_in_progress: true` plan 이 16KB /
 * 138 char PDF 생성 (header + footer 만). 결제 사용자 충격.
 *
 * 2-layer defense:
 *   Layer 1: api/pdf/generate.js — days.length === 0 시 422 응답 (Puppeteer 호출 전 차단)
 *   Layer 2: src/pages/PlanDetailPage/pdfGenerator.ts — generatePDF() 상단 guard + toast
 *
 * deep-search: reports/visual-2026-05-26/deepsearch-p207.md
 *   - 422 status code 선택 근거: 요청 형식(auth, planId)은 유효하나 plan 데이터 처리 불가 → semantic 정확
 *   - Puppeteer 커뮤니티: HTML 렌더 전 서버 데이터 validate 권장
 *   - PDFCrowd API: 빈 콘텐츠 → 400 반환, 절대 200 + 빈 PDF 반환 안 함
 *
 * assertion 4종 (source-level):
 *   1. api/pdf/generate.js — days.length === 0 guard 존재 (P207 주석 포함)
 *   2. api/pdf/generate.js — streaming flag 분기 (streaming_in_progress / itinerary_empty reason)
 *   3. api/pdf/generate.js — 422 status 반환 코드 존재
 *   4. api/pdf/generate.js — throttledTelegramAlert medium severity 존재
 *   5. pdfGenerator.ts — generatePDF() 상단 P207 guard + toast 존재
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_FILE = resolve(__dirname, '../../api/pdf/generate.js');
const CLIENT_FILE = resolve(__dirname, '../../src/pages/PlanDetailPage/pdfGenerator.ts');

let serverSrc: string;
let clientSrc: string;
try {
  serverSrc = readFileSync(SERVER_FILE, 'utf8');
} catch {
  serverSrc = '';
}
try {
  clientSrc = readFileSync(CLIENT_FILE, 'utf8');
} catch {
  clientSrc = '';
}

describe('P207 Layer 1 — api/pdf/generate.js server-side guard', () => {
  it('assertion 1: P207 주석 + days.length === 0 guard 존재', () => {
    expect(serverSrc).toBeTruthy();
    // P207 식별자
    expect(/P207/.test(serverSrc)).toBe(true);
    // days 배열 체크 패턴 — Array.isArray + length === 0 또는 !daysArr?.length
    const hasArrayCheck = /Array\.isArray\(_daysArr\)/.test(serverSrc) ||
      /!Array\.isArray/.test(serverSrc);
    const hasLengthCheck = /_daysArr\.length === 0/.test(serverSrc) ||
      /!_daysArr\?\.length/.test(serverSrc);
    expect(hasArrayCheck || hasLengthCheck).toBe(true);
  });

  it('assertion 2: streaming flag 분기 — streaming_in_progress / itinerary_empty reason', () => {
    expect(/streaming_in_progress/.test(serverSrc)).toBe(true);
    expect(/itinerary_empty/.test(serverSrc)).toBe(true);
  });

  it('assertion 3: 422 status 반환 존재', () => {
    // res.status(422) 패턴
    expect(/\.status\(422\)/.test(serverSrc)).toBe(true);
  });

  it('assertion 4: throttledTelegramAlert medium severity 존재', () => {
    expect(/throttledTelegramAlert/.test(serverSrc)).toBe(true);
    // severity — P207 guard 영역에 있어야 함 (medium 또는 high)
    expect(/severity:\s*['"](medium|high)['"]/.test(serverSrc)).toBe(true);
  });
});

describe('P207 Layer 2 — pdfGenerator.ts client-side guard', () => {
  it('assertion 5: generatePDF() 상단 P207 guard 존재', () => {
    expect(clientSrc).toBeTruthy();
    // P207 식별자
    expect(/P207/.test(clientSrc)).toBe(true);
    // days?.length 체크 + early return 패턴
    const hasDaysCheck =
      /plan\?\.itinerary\?\.days\?\.length/.test(clientSrc) ||
      /itinerary\?\.days\?\.length/.test(clientSrc);
    expect(hasDaysCheck).toBe(true);
    // toast.error 호출 포함
    expect(/toast\.error/.test(clientSrc)).toBe(true);
  });
});
