/**
 * P281 (2026-05-29): block_mode seed block placeholder 매칭 실패 시 명시적 placeholder text + quality_warnings 박제 회귀 차단.
 *
 * Agent 2 deep-search 발견: 68% (15/22 post-P245) block_mode plan 의 stop.name 가
 *   "서울특별시 종로구 가회동" 같은 행정 주소 직접 노출 — 운영자 시점 "이름이 빠진 가게" sleeper bug.
 *
 * Root cause: `blockMode.js:489` 의 graceful fallback `resolvedName = bs.address || 'Local restaurant'`
 *   가 placeholder 의 행정 주소를 그대로 stop.name 으로 사용.
 *
 * Fix: 명시적 `[추천 <placeholderType> - <지역명>]` text + quality_warnings 박제 (severity=medium,
 *   kind=block_mode_placeholder_synthesized) → 운영자 admin panel (P121 QualityWarningsPanel) 즉시 발견.
 *
 * 회귀 시: 사용자 plan 의 stop.name 에 행정 주소 노출 회귀 → 운영자 환불 클레임 위험.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P281 block_mode placeholder fallback — 명시적 text + quality_warnings 박제', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/blockMode.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — 명시적 placeholder text fix 적용 (행정 주소 직접 사용 회귀 차단)', () => {
    // 회귀 차단 의도: 새 패턴 (`[추천`) 가 코드에 존재 + 명시적 fallback 적용.
    // 'Local restaurant' literal 이 fallback default 로 직접 사용 X (코멘트 안 history 는 OK).
    // 진짜 회귀 = `resolvedName = bs.address || 'Local restaurant'` literal assignment 회귀.
    // 본 검사 = 새 패턴 1개 더 확인 (이미 #2 test 가 충분 검증).
    expect(src).toContain("`[추천 ${placeholderType} - ${addrShort}]`");
  });

  it('source — 명시적 placeholder text 패턴 (`[추천 ... - ...]`) 적용', () => {
    expect(src).toContain('[추천');
    expect(src).toMatch(/resolvedName\s*=\s*`\[추천\s*\$\{placeholderType\}\s*-\s*\$\{addrShort\}\]`/);
  });

  it('source — placeholderSynthesizedCount 카운터 정의 + increment', () => {
    expect(src).toMatch(/let\s+placeholderSynthesizedCount\s*=\s*0/);
    expect(src).toMatch(/placeholderSynthesizedCount\+\+/);
  });

  it('source — quality_warnings 박제 (block_mode_placeholder_synthesized)', () => {
    expect(src).toContain('block_mode_placeholder_synthesized');
    expect(src).toContain('quality_warnings');
    expect(src).toMatch(/severity:\s*'medium'/);
    expect(src).toMatch(/count:\s*placeholderSynthesizedCount/);
  });

  it('source — P281 reference + Agent 2 68% 영향 명시', () => {
    expect(src).toContain('P281');
    expect(src).toContain('68%');
    expect(src).toContain('Agent 2');
  });

  // ── runtime — expandBlocksToItinerary 직접 호출 ────────────────────────────

  it('runtime — placeholder 매칭 실패 + dietary 강제 X → 명시적 text + quality_warnings', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');

    const blocks = [
      {
        id: 'TEST_BLOCK_1',
        city: 'seoul',
        zone: '종로',
        theme: 'Cultural',
        stops: [
          {
            order: 1,
            category: 'food',
            placeholder: 'korean_bbq',
            address: '서울특별시 종로구 가회동',  // 행정 주소
            // name 없음 → placeholder 매칭 시도
          },
        ],
      },
    ];
    const selections = {
      day_selections: [{ day: 1, block_id: 'TEST_BLOCK_1', tweak_notes: '' }],
      language: 'ko',
      cacheMetadata: { cached: 0, total: 0, output: 0 },
    };
    const userInput = {
      language: 'ko',
      area: 'seoul',
      dietPrefs: [],  // dietary 강제 X — graceful fallback 진입
      foodIndex: [],  // matchFoodPlaceholder 실패 → 본 fallback 진입
      startDate: '2026-06-15',
    };

    const itinerary = expandBlocksToItinerary(selections, blocks, userInput);
    const firstStop = itinerary.days[0].stops[0];

    // 이전: stop.name = '서울특별시 종로구 가회동' (행정 주소 직접 노출)
    // 현재: stop.name = '[추천 korean_bbq - ...]' (명시적 placeholder text)
    expect(firstStop.name).toMatch(/^\[추천\s+korean_bbq/);
    expect(firstStop.name).not.toBe('서울특별시 종로구 가회동');

    // quality_warnings 박제 확인
    expect(Array.isArray(itinerary.quality_warnings)).toBe(true);
    const placeholderWarning = itinerary.quality_warnings.find(
      (w) => w.kind === 'block_mode_placeholder_synthesized',
    );
    expect(placeholderWarning).toBeDefined();
    expect(placeholderWarning.count).toBe(1);
    expect(placeholderWarning.severity).toBe('medium');
  });

  it('runtime — placeholder 0건 (모든 stop name 있음) → quality_warnings 박제 X', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');

    const blocks = [
      {
        id: 'TEST_BLOCK_2',
        city: 'seoul',
        zone: '명동',
        theme: 'Foodie',
        stops: [
          {
            order: 1,
            category: 'food',
            name: '명동교자',
            address: '서울특별시 중구 명동 25-2',
          },
        ],
      },
    ];
    const selections = {
      day_selections: [{ day: 1, block_id: 'TEST_BLOCK_2', tweak_notes: '' }],
      language: 'ko',
      cacheMetadata: { cached: 0, total: 0, output: 0 },
    };
    const userInput = { language: 'ko', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15' };

    const itinerary = expandBlocksToItinerary(selections, blocks, userInput);
    expect(itinerary.days[0].stops[0].name).toBe('명동교자');

    // quality_warnings 가 있어도 placeholder_synthesized 는 없음
    const placeholderWarning = (itinerary.quality_warnings || []).find(
      (w) => w.kind === 'block_mode_placeholder_synthesized',
    );
    expect(placeholderWarning).toBeUndefined();
  });
});
