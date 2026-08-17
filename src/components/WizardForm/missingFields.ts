/**
 * 위저드에서 "아직 안 채운 칸"을 가리키는 값과 이동 (2026-08-18).
 *
 * 그리는 쪽은 `WizardMissing.tsx`. 여기가 따로 있는 이유는 스타일이 아니라 규칙이다 —
 * `react-refresh/only-export-components` 는 컴포넌트 파일이 컴포넌트 외의 값을
 * 내보내는 것을 막는다(`src/lib/motion.ts` 가 lib 으로 빠진 것과 같은 이유).
 */
import type { RefObject } from 'react';
import { focusAndReveal } from '@/lib/motion';

export type MissingField = {
  /** 안정적인 식별자 (테스트·React key). */
  key: string;
  /** 사람이 읽는 안내 문구. 항목마다 다르게 — "여기 작성해주세요" 는 어디를 말하는지 알려주지 않는다. */
  label: string;
  /** 그 칸을 감싼 요소. `tabIndex={-1}` 이 있어야 포커스를 받는다. */
  ref: RefObject<HTMLElement | null>;
};

/** 비어 있는 첫 항목으로 스크롤 + 포커스. 목록이 비면 아무것도 하지 않는다. */
export function revealFirstMissing(missing: MissingField[]): void {
  if (missing.length === 0) return;
  focusAndReveal(missing[0].ref.current);
}
