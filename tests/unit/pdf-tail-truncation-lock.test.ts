import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 2026-06-10 5일 plan PDF 꼬리 잘림 회귀 잠금.
//
// root cause: html2pdf 가 pagebreak(before/avoid) 여백을 클론에 삽입한 "뒤" html2canvas 를
// 돌리는데, html2canvas 옵션 height:measuredHeight 가 삽입 전 높이로 canvas 를 클리핑
// -> Day 후반/예산표/추천식당/출국가이드 소실 (5일 실측 +2400px 인플레이션, 11p 중 마지막
// 페이지 sliver+백지). B9-34(day-break) 도입 이후 긴 plan 에서 잠재하던 silent 데이터 손실.
//
// 잠금 3종: (1) height 강제 재유입 금지 (2) end-sentinel 마커 존재 (3) fail-closed 바닥 검사 존재.
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/pages/PlanDetailPage/pdfGenerator.ts'),
  'utf8',
);

describe('PDF 꼬리 잘림 잠금 (pagebreak 인플레이션 클리핑)', () => {
  it('2-pass 캡처: toContainer 로 클론 실높이 측정 후 height 재설정', () => {
    // height 를 measuredHeight(인플레이션 전)로만 캡처하면 클리핑, 아예 빼면 일부 환경
    // canvas h=0 (2026-05-12/06-10 실측) — 그래서 클론 실측 2-pass 가 유일한 정답.
    expect(SRC).toContain('await worker.toContainer()');
    expect(/clonedH\s*=\s*clonedEl\?\.scrollHeight/.test(SRC)).toBe(true);
    expect(/height:\s*captureH/.test(SRC)).toBe(true);
    // toContainer(측정)가 toCanvas(캡처)보다 먼저
    expect(SRC.indexOf('await worker.toContainer()')).toBeLessThan(SRC.indexOf('worker.toCanvas()'));
  });

  it('빌더 맨 끝 end-sentinel 마커 존재', () => {
    expect(SRC).toContain('pdf-end-sentinel');
  });

  it('캡처 후 sentinel 바닥 검사 = fail-closed (잘림 시 다운로드 차단)', () => {
    expect(SRC).toContain('end-sentinel missing');
    // 검사 실패 경로가 사용자 안내(offerWhatsapp) + 중단으로 이어지는지
    expect(/end-sentinel missing[\s\S]{0,400}offerWhatsapp/.test(SRC)).toBe(true);
  });

  it('클론 측정 실패 시 보수적 fallback (h=0 캡처 회귀 금지)', () => {
    expect(/forcedWindowHeight = Math\.ceil\(measuredHeight \* 1\.5\) \+ 800/.test(SRC)).toBe(true);
    expect(/clonedH >= measuredHeight \? clonedH : forcedWindowHeight/.test(SRC)).toBe(true);
  });
});
