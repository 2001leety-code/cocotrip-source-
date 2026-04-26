// CocoTrip 브랜드 디자인 토큰
//
// 이전 상태: 그라데이션 색상이 16+ 위치에 인라인 지정. 모바일/데스크톱
// 분기 (#B668FC/FF6B9D vs #7C5CFC/EA537E) 가 같은 페이지 안에서 페이지마다
// 다르게 보였음 → 사용자가 "뒤죽박죽" 인상.
//
// 이 파일은 single source of truth. 모든 브랜드 그라데이션은 여기서 import.

const PURPLE = '#7C5CFC';
const PINK = '#EA537E';

export const BRAND = {
  /** 주 그라데이션 — CTA / 헤딩 / 액티브 상태 */
  gradient: {
    primary: `linear-gradient(135deg, ${PURPLE}, ${PINK})`,
    primaryHorizontal: `linear-gradient(90deg, ${PURPLE}, ${PINK})`,
    primaryVertical: `linear-gradient(180deg, ${PURPLE}, ${PINK})`,
  },
  color: {
    purple: PURPLE,
    pink: PINK,
    /** 정보성 보라 (예: 강조 박스 배경) */
    purpleSoft: 'rgba(124, 92, 252, 0.1)',
    pinkSoft: 'rgba(234, 83, 126, 0.1)',
  },
  /** 로딩 스피너 통일 — 모든 곳에서 같은 색 */
  spinnerBorder: PURPLE,
} as const;
