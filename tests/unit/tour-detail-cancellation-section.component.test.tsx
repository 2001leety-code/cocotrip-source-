// @vitest-environment jsdom
/**
 * TourCancellationSection — MRT 벤치마킹 P1 (2026-08-19).
 *
 * 이 섹션은 하단 바 RefundPolicyModal 과 같은 표를 페이지에도 노출한다. 값이 두 파일에
 * 각각 있으면(=SSOT 붕괴) 운영자가 한쪽만 고치고 다른 쪽을 놓치는 사고가 난다
 * (참고: feedback_derive_not_dedup_stale_constant.md). 그래서 RefundPolicyModal.tsx 가
 * export 하는 COL_HEADERS/ROWS/HEADING/NOTES 를 이 파일이 import 해서 직접 대조한다 —
 * "같은 문자열을 두 번 타이핑해서 우연히 같다"가 아니라 "같은 객체를 참조해서 항상 같다".
 * (RefundPolicyModal.tsx 는 react-refresh/only-export-components 때문에 표 상수를 직접
 * export 하지 않는다 — 둘 다 refundPolicyData.ts 에서 가져온다.)
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TourCancellationSection } from '../../src/components/tours/TourCancellationSection';
import { COL_HEADERS, ROWS, HEADING, NOTES } from '../../src/components/tours/refundPolicyData';
import type { Language } from '../../src/i18n';

void React;

afterEach(() => cleanup());

const LANGS: Language[] = ['ko', 'en', 'ja', 'zh'];

describe('TourCancellationSection — RefundPolicyModal 과 SSOT 패리티', () => {
  it('id="cancellation" 앵커 타깃으로 렌더된다', () => {
    const { container } = render(<TourCancellationSection language="ko" />);
    expect(container.querySelector('section#cancellation')).toBeTruthy();
  });

  for (const lang of LANGS) {
    it(`${lang}: 표 헤더·행·제목이 RefundPolicyModal export 값과 100% 동일하다`, () => {
      const { container } = render(<TourCancellationSection language={lang} />);
      const text = container.textContent || '';

      expect(text).toContain(HEADING[lang]);
      expect(text).toContain(COL_HEADERS[lang].period);
      expect(text).toContain(COL_HEADERS[lang].refund);
      for (const [label, pct] of ROWS[lang]) {
        expect(text).toContain(label);
        expect(text).toContain(pct);
      }
      for (const note of NOTES[lang]) {
        expect(text).toContain(note);
      }
    });

    it(`${lang}: 배차 실패 자동취소 안내(TourBookingDialog.autoCancelNote 의미와 정렬)가 있다`, () => {
      const { container } = render(<TourCancellationSection language={lang} />);
      const note = container.querySelector('[data-testid="tour-detail-cancellation-dispatch-note"]');
      expect(note, `${lang} dispatch note missing`).toBeTruthy();
      expect(note!.textContent).toMatch(/취소|cancel|キャンセル|取消/i);
    });
  }

  it('ja/zh 렌더 결과에 영어 원문이 새지 않는다 (en 전용 라벨 누출 금지)', () => {
    for (const lang of ['ja', 'zh'] as Language[]) {
      const { container } = render(<TourCancellationSection language={lang} />);
      const text = container.textContent || '';
      expect(text).not.toContain(HEADING.en);
      expect(text).not.toContain(COL_HEADERS.en.period);
      for (const note of NOTES.en) expect(text).not.toContain(note);
      cleanup();
    }
  });
});
