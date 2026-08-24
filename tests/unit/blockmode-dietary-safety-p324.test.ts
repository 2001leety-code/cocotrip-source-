/**
 * P324 (2026-05-31): block_mode dietary SAFETY — validateResponse 우회 보완.
 *
 * 버그 (dietary agent 점검): block_mode 는 handlerCore:319 `if(!itinerary)` 가드로
 *   runGeminiPipeline(= validateResponse, 유일한 dietary 검증처)을 우회 →
 *   dietary_coverage_low 0건 → 할랄/비건/채식 coverage 미박제.
 *
 * fix: applyBlockModeDietaryWarnings 가 후처리에서 checkDietaryCoverage 재사용
 *   (warning-only, P280 retry loop 회피). handlerCore block_mode 경로에서만 호출.
 *
 * 2026-08-24 (planner trust): 알레르겐 4종(Nuts/Shellfish/Gluten/Dairy) 검출·사용자
 * 표시 고지(#9)는 이 함수에서 제거됨 — DB allergen 필드 미수집이라 실효가 없었고
 * "알레르기 대응"으로 오인될 위험만 있었다. 이 파일은 남은 coverage 경고만 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { applyBlockModeDietaryWarnings } from '../../api/_ai_core/responseValidator.js';

describe('[P324] applyBlockModeDietaryWarnings (block_mode dietary SAFETY)', () => {
  it('Halal 요청 + 미인증 food stop 다수 → dietary_coverage_low 박제 (severity=warning)', () => {
    const itin = {
      days: [{ stops: [
        { category: 'food', name: '삼겹살집', tip: '고기 맛집' },
        { category: 'food', name: '명동 비빔밥', tip: '채소 위주' },
      ] }],
    };
    const n = applyBlockModeDietaryWarnings(itin, ['Halal']);
    expect(n).toBeGreaterThanOrEqual(1);
    const cw = (itin.quality_warnings || []).filter((w) => w.type === 'dietary_coverage_low');
    expect(cw.length).toBeGreaterThanOrEqual(1);
    expect(cw[0].severity).toBe('warning'); // P280: critical 절대 금지 (retry loop 차단)
    expect(cw[0].dietary_pref).toBe('halal');
  });

  it('빈 dietary → no-op (0 warning, quality_warnings 미생성)', () => {
    const itin = { days: [{ stops: [{ category: 'food', name: '조개구이' }] }] };
    expect(applyBlockModeDietaryWarnings(itin, [])).toBe(0);
    expect(itin.quality_warnings).toBeUndefined();
  });

  it('기존 quality_warnings 보존 (push, 덮어쓰기 0)', () => {
    const itin = {
      quality_warnings: [{ type: 'existing_warning' }],
      days: [{ stops: [{ category: 'food', name: '삼겹살집' }] }],
    };
    applyBlockModeDietaryWarnings(itin, ['Halal']);
    expect(itin.quality_warnings.some((w) => w.type === 'existing_warning')).toBe(true);
    expect(itin.quality_warnings.some((w) => w.type === 'dietary_coverage_low')).toBe(true);
  });

  it('food stop 이 halal 인증 태그를 가지면 coverage warning 미발생', () => {
    const itin = {
      days: [{ stops: [
        { category: 'food', name: '이태원 할랄 레스토랑', dietary_tags: ['halal'] },
      ] }],
    };
    applyBlockModeDietaryWarnings(itin, ['Halal']);
    const cw = (itin.quality_warnings || []).filter((w) => w.type === 'dietary_coverage_low');
    expect(cw.length).toBe(0);
  });
});
