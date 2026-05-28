/**
 * P270 (2026-05-28): selfHealLodgingBookend dead code 복구.
 *
 * 배경: planPersister.js 에 selfHealLodgingBookend 가 define 되어 있지만 어디서도
 * 호출 안 됨 → block_mode plan 의 Day 마지막 stop 이 food/culture (zone_courses
 * JSON 의 stops 자체에 lodging 없음) 일 때 self_heal 발동 X → 운영자 SSOT
 * "호텔=동선 anchor, Day 시작/마지막 호텔" 위반.
 *
 * 운영자 검증: 5/28 dispatch 5 plan (14c7bac1 / fb33722e / 9b29f4b5 / 92dac6ee /
 * ad10de4a) 모두 quality_warnings 에 `lodging_bookend_violation` 만 있고
 * `lodging_bookend_self_healed` 없음 = self_heal 호출 안 됨.
 *
 * P270 fix:
 *   - postResponsePipeline.js: selfHealLodgingBookend import + applyBackfillsAndTmoney
 *     call chain 에 추가 (backfillDayLodging → selfHealDailyBudget → selfHealLodgingBookend
 *     → calculateTmoney 순).
 *
 * 회귀 시: block_mode 모든 plan 의 Day 마지막 stop 이 lodging 아닌 채로 persisted
 *         → 사용자 동선 마지막 끊김 + 운영자 SSOT 위반.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('P270 selfHealLodgingBookend call chain dead code 복구', () => {
  const pipelineSrc = readFileSync(
    resolve(ROOT, 'api/_ai_core/postResponsePipeline.js'),
    'utf8',
  );
  const persisterSrc = readFileSync(
    resolve(ROOT, 'api/_ai_core/planPersister.js'),
    'utf8',
  );

  it('postResponsePipeline.js: selfHealLodgingBookend import 정의', () => {
    expect(pipelineSrc).toMatch(/selfHealLodgingBookend/);
    // import 라인 안에 포함 (라인 단위 매치)
    expect(pipelineSrc).toMatch(
      /import\s*\{[^}]*selfHealLodgingBookend[^}]*\}\s*from\s*['"]\.\/planPersister\.js['"]/s,
    );
  });

  it('postResponsePipeline.js: applyBackfillsAndTmoney 안에서 호출', () => {
    // selfHealLodgingBookend(itinerary) 호출 패턴 (전체 source 안 어디든 OK — import + call 둘 다 검증)
    expect(pipelineSrc).toMatch(/selfHealLodgingBookend\s*\(\s*itinerary\s*\)/);
  });

  it('호출 순서: backfillDayLodging → selfHealLodgingBookend → calculateTmoney', () => {
    // day.lodging 이 채워진 후 selfHealLodgingBookend 가 default name 사용 가능,
    // calculateTmoney 가 lodging stop 거리 고려.
    const fnBody = pipelineSrc.slice(
      pipelineSrc.indexOf('export function applyBackfillsAndTmoney'),
      pipelineSrc.length,
    );
    const idxBackfill = fnBody.indexOf('backfillDayLodging');
    const idxBookend = fnBody.indexOf('selfHealLodgingBookend');
    const idxTmoney = fnBody.indexOf('calculateTmoney');
    expect(idxBackfill).toBeGreaterThan(-1);
    expect(idxBookend).toBeGreaterThan(idxBackfill);
    expect(idxTmoney).toBeGreaterThan(idxBookend);
  });

  it('planPersister.js: selfHealLodgingBookend 정의 + Day 마지막 lodging append 로직', () => {
    expect(persisterSrc).toMatch(/export function selfHealLodgingBookend/);
    // last category != lodging/travel/airport 시 append 조건
    expect(persisterSrc).toMatch(
      /!\s*\[\s*['"]lodging['"]\s*,\s*['"]travel['"]\s*,\s*['"]airport['"]\s*\]\s*\.includes\(\s*last\.category\s*\)/,
    );
    // _self_healed 마커 + lodging_bookend_self_healed quality_warnings emit
    expect(persisterSrc).toMatch(/_self_healed:\s*true/);
    expect(persisterSrc).toMatch(/lodging_bookend_self_healed/);
  });

  it('P270 주석 + 회귀 차단 의도 명시', () => {
    expect(pipelineSrc).toMatch(
      /P270[^\n]*lodging bookend self-heal|P270[^\n]*dead code 복구/,
    );
    expect(pipelineSrc).toMatch(
      /운영자 의도|호텔=동선 anchor|Day 시작\/마지막 호텔/,
    );
  });
});
