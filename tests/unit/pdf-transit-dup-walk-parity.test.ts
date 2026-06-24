/**
 * PDF transit duplicate-walk parity (cross-surface) — 회귀 차단.
 *
 * 배경: 화면(TransitArrow.tsx)은 "Exit X → walk Ymin → 목적지" final-arrival 콜아웃이
 * 마지막 도보 leg 를 렌더하면, per-step 리스트에서 그 같은 도보 leg 를 숨긴다
 * (arrivalConsumesLastWalk → i === lastWalkIdx 면 skip). 안 그러면 도보줄이 두 번 뜬다.
 *
 * 클라이언트 PDF(pdfGenerator.ts)는 자체 HTML 문자열을 만들며, 한동안 이 dedupe 가
 * 없어 마지막 도보가 per-step + final-arrival 두 곳에 중복 렌더됐다(운영자 신고
 * "Walk 도보 약 276m" 중복). 이 테스트가 화면과 PDF 의 dedupe parity 를 강제한다.
 *
 * source-level 검사 — pdfGenerator.ts 는 브라우저 의존(html2pdf 동적 import)이라
 * 직접 import 대신 소스 파싱으로 dedupe 코드 존재를 보장한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PDF_SRC = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'),
  'utf8',
);
const ARROW_SRC = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/components/TransitArrow.tsx'),
  'utf8',
);

describe('PDF transit dedupe — duplicate trailing walk 차단 (화면 parity)', () => {
  it('화면(TransitArrow)에 arrivalConsumesLastWalk dedupe 가 있다', () => {
    expect(ARROW_SRC).toMatch(/arrivalConsumesLastWalk/);
    expect(ARROW_SRC).toMatch(/i === lastWalkIdx/);
  });

  it('PDF(pdfGenerator)에 동일한 arrivalConsumesLastWalk dedupe 가 있다', () => {
    expect(PDF_SRC).toMatch(/arrivalConsumesLastWalk/);
  });

  it('PDF 가 마지막 도보 인덱스를 계산해 per-step 리스트에서 skip 한다', () => {
    // lastWalkIdx 계산 + 그 인덱스 skip (idx === lastWalkIdx → return '')
    expect(PDF_SRC).toMatch(/lastWalkIdx/);
    expect(PDF_SRC).toMatch(/arrivalConsumesLastWalk\s*&&\s*idx === lastWalkIdx/);
  });

  it('PDF final-arrival 콜아웃이 showFinalArrival 게이트를 쓴다 (중복 조건 단일화)', () => {
    expect(PDF_SRC).toMatch(/showFinalArrival/);
  });
});
