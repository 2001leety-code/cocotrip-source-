/**
 * 한라산 예약 URL 회귀 가드 (2026-06-02, A2 딥서치 발견 버그 fix).
 *
 * SAFETY — 한라산(성판악/관음사)은 국립공원공단(knps.or.kr)이 아니라 **제주도청
 * visithalla.jeju.go.kr** 탐방예약시스템을 쓴다. 잘못된 URL = 외국인 등산객 예약 실패.
 * 지리산·북한산 등 다른 국립공원은 knps 가 맞으므로 이 가드는 한라산 파일에만 적용.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const HALLASAN_FILES = [
  'src/data/zone_courses/jeju_hallasan_seongpanak_packed.json',
  'src/data/zone_courses/templates/jeju_hallasan_seongpanak.json',
];

describe('한라산 예약 URL — visithalla.jeju.go.kr (제주도청, knps 아님)', () => {
  for (const f of HALLASAN_FILES) {
    it(`${f}: visithalla.jeju.go.kr 사용 + reservation.knps.or.kr 없음`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf-8');
      expect(src).toContain('visithalla.jeju.go.kr');
      expect(src).not.toContain('reservation.knps.or.kr');
    });
    it(`${f}: 4개 언어(ko/en/ja/zh) 모두 교체됨`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf-8');
      // tips_i18n 4개 언어 각각에 visithalla 포함 (최소 4회 등장)
      const count = (src.match(/visithalla\.jeju\.go\.kr/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(4);
    });
  }
});
