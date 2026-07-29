/**
 * 회귀 잠금 (2026-07-28) — 개발용 문구가 손님 화면에 노출되던 문제.
 *
 * 실제로 손님이 본 문구: "DB cached: subway 12min (zone_courses)".
 * 경로: api/_ai_core/transitCache.js 가 개발용 로그 문자열을 `summary` 에 넣음
 *   → RouteAgent 가 그 summary 를 instruction/instruction_en 으로 저장
 *   → TransitArrow 가 instruction 을 화면에 raw 로 출력.
 * 즉 "표시 버그"가 아니라 **개발 문구가 손님 데이터 필드에 저장**되고 있었다.
 *
 * 같은 카드에 "차량 12분" + "대중교통 이용 불가" + "DB cached: subway" 가 동시에
 * 뜬 것도 여기서 온다 — 다운그레이드가 method 만 바꾸고 안내문을 안 지웠다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** 주석을 걷어낸 실행 코드만 본다 (제거 사유 주석에 단어가 남아 있음). */
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('손님 데이터 필드에 개발 문구 금지', () => {
  it('transitCache 가 summary 에 캐시 출처를 넣지 않는다', () => {
    const code = codeOf('api/_ai_core/transitCache.js');
    expect(code).not.toContain('DB cached');
    // 캐시 출처는 내부 필드로만 남는다 — 화면에 안 나가는 경로.
    expect(code).toContain('_cacheSource');
  });

  it('플랜 파이프라인이 zone_courses 를 손님 문구로 내보내지 않는다', () => {
    for (const f of ['api/_ai_core/transitCache.js']) {
      const code = codeOf(f);
      // summary/instruction 계열 문자열 안에 zone_courses 가 들어가면 화면에 샌다.
      const leaked = code.match(/(summary|instruction[a-z_]*)\s*:\s*[`'"][^`'"]*zone_courses/i);
      expect(leaked, `${f}: 손님 문구에 zone_courses 노출`).toBeNull();
    }
  });
});

describe('다운그레이드 시 옛 수단 정보 무효화', () => {
  const code = codeOf('api/_ai_core/agents/RouteAgent.js');
  const block = code.slice(code.indexOf('_downgraded_from'), code.indexOf('_downgraded_from') + 1200);

  it('안내문·구간을 비운다 (모순 표시 방지)', () => {
    for (const field of ['instruction', 'instruction_en', 'step_by_step', 'steps_detail']) {
      expect(block, `다운그레이드가 ${field} 를 안 지운다`).toContain(field);
    }
  });

  it('대중교통 요금·환승을 0 으로 되돌린다', () => {
    expect(block).toContain('est_fare_krw = 0');
    expect(block).toContain('transfers = 0');
  });
});

describe('손님 화면 하드코딩 영어 제거', () => {
  it('StopCard 의 대중교통 제목·환승 라벨이 번역을 탄다', () => {
    const code = codeOf('src/pages/PlanDetailPage/components/StopCard.tsx');
    expect(code).not.toContain('>Public Transit Route<');
    expect(code).toContain('publicTransitRoute');
    expect(code).toContain('transitTransfers');
  });

  it('4개 국어 모두 해당 키를 가진다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const dict = read(`src/i18n/locales/${lang}.json`);
      for (const key of ['publicTransitRoute', 'transitTransfers', 'mealCostLabel']) {
        expect(dict, `${lang}.json 에 ${key} 없음`).toContain(`"${key}"`);
      }
    }
  });
});

describe('식당·카페 요금 칩', () => {
  it('먹는 곳은 "무료" 대신 식사비 안내를 쓴다', () => {
    const code = codeOf('src/pages/PlanDetailPage/components/StopCard.tsx');
    expect(code).toContain('isFoodStop');
    expect(code).toContain('mealCostLabel');
    // 무료 칩은 isFoodStop 분기를 통과한 뒤에만 도달해야 한다(먹는 곳은 절대 "무료" 아님).
    const foodBranch = code.indexOf('isFoodStop ?');
    const freeChip = code.indexOf('ui.free');
    expect(foodBranch, 'isFoodStop 분기가 없다').toBeGreaterThan(-1);
    expect(freeChip, 'ui.free 칩이 없다').toBeGreaterThan(-1);
    expect(foodBranch).toBeLessThan(freeChip);
  });
});
