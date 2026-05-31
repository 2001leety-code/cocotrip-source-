/**
 * P-launch (2026-05-31): 오픈 전 planPersister polish 3종 회귀.
 * #3 위치미정 → "지역 숙소" / #4 합성 호텔 stop 4lang tip / #5 block_mode bookend warning suppress flag.
 * 전부 selfHealLodgingBookend(planPersister) — buildPrompt 변경 0 = cache-safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — planPersister.js 는 JS (타입 선언 없음)
import { selfHealLodgingBookend } from '../../api/_ai_core/planPersister.js';

const ROOT = resolve(__dirname, '../..');

function makeItin(city: string) {
  return {
    days: [{
      day: 1, city,
      stops: [
        { category: 'culture', name: '경복궁', start_time: '10:00' },
        { category: 'food', name: '식당', start_time: '12:30' },
      ],
    }],
  } as Record<string, unknown> & { days: Array<{ stops: Array<Record<string, unknown>> }>; quality_warnings?: Array<Record<string, unknown>> };
}

describe('P-launch #3 — 위치미정 → 지역 숙소', () => {
  it('호텔 미입력(seoul) → 합성 lodging 이름 = "명동 지역 숙소", "위치 미정" 없음', () => {
    const itin = makeItin('seoul');
    selfHealLodgingBookend(itin, {});
    const stops = itin.days[0].stops;
    expect(stops[0].category).toBe('lodging');
    expect(String(stops[0].name)).toContain('지역 숙소');
    expect(String(stops[0].name)).not.toContain('위치 미정');
    expect(String(stops[stops.length - 1].name)).not.toContain('위치 미정');
  });
  it('planPersister 소스에 "위치 미정" 잔존 0 (회귀 가드)', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/planPersister.js'), 'utf8');
    expect(src.includes('위치 미정')).toBe(false);
  });
});

describe('P-launch #4 — 합성 호텔 stop 4lang tip', () => {
  for (const lang of ['ko', 'en', 'ja', 'zh']) {
    it(`${lang}: prepend/append 호텔 stop 둘 다 tip 채움 + depart≠return`, () => {
      const itin = makeItin('seoul');
      selfHealLodgingBookend(itin, { language: lang });
      const stops = itin.days[0].stops;
      const first = stops[0], last = stops[stops.length - 1];
      expect(first.category).toBe('lodging');
      expect(last.category).toBe('lodging');
      expect(String(first.tip || '').length).toBeGreaterThan(0);
      expect(String(last.tip || '').length).toBeGreaterThan(0);
      expect(first.tip).not.toBe(last.tip); // 출발(짐맡김) vs 복귀(체크인) 다름
    });
  }
  it('language 미지정 → ko 기본 (tip 비지 않음)', () => {
    const itin = makeItin('seoul');
    selfHealLodgingBookend(itin, {});
    expect(String(itin.days[0].stops[0].tip || '')).toContain('짐'); // ko depart tip
  });
});

describe('P-launch #5 — block_mode bookend warning suppress flag', () => {
  it('blockMode:true → warning.expected_block_mode === true', () => {
    const itin = makeItin('seoul');
    selfHealLodgingBookend(itin, { blockMode: true });
    const w = (itin.quality_warnings || []).find((x) => x.type === 'lodging_bookend_self_healed');
    expect(w).toBeTruthy();
    expect(w!.expected_block_mode).toBe(true);
  });
  it('blockMode 미지정(legacy) → expected_block_mode falsy (손님에게 노출 유지)', () => {
    const itin = makeItin('seoul');
    selfHealLodgingBookend(itin, {});
    const w = (itin.quality_warnings || []).find((x) => x.type === 'lodging_bookend_self_healed');
    expect(w).toBeTruthy();
    expect(w!.expected_block_mode).toBeFalsy();
  });
  it('UserPlanNoticesPanel 가 expected_block_mode 인 bookend 를 손님 패널서 suppress', () => {
    const panel = readFileSync(resolve(ROOT, 'src/pages/PlanDetailPage/components/UserPlanNoticesPanel.tsx'), 'utf8');
    expect(panel).toMatch(/lodging_bookend_self_healed'\s*&&\s*w\?\.expected_block_mode\s*===\s*true.*return false/s);
  });
});
