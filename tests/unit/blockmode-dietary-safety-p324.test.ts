/**
 * P324 (2026-05-31): block_mode dietary SAFETY — validateResponse 우회 보완.
 *
 * 버그 (dietary agent 점검): block_mode 는 handlerCore:319 `if(!itinerary)` 가드로
 *   runGeminiPipeline(= validateResponse, 유일한 dietary/allergen 검증처)을 우회 →
 *   dietary_coverage_low / allergen_warning 0건 → 알레르기(견과/갑각류/글루텐/유제품) 무방비.
 *
 * fix: applyBlockModeDietaryWarnings 가 후처리에서 checkDietaryCoverage + checkAllergenWarnings
 *   재사용 (warning-only, P280 retry loop 회피). handlerCore block_mode 경로에서만 호출.
 *
 * 회귀 시: 갑각류 알레르기 손님 + block_mode → 해산물 식당 경고 0 (legacy 면 allergen_warning 박제).
 */
import { describe, it, expect } from 'vitest';
import { applyBlockModeDietaryWarnings } from '../../api/_ai_core/responseValidator.js';

describe('[P324] applyBlockModeDietaryWarnings (block_mode dietary SAFETY)', () => {
  it('알레르기: 갑각류 stop + Shellfish → allergen_warning 박제 (severity=warning)', () => {
    const itin = {
      days: [{ stops: [
        { category: 'food', name: '자갈치 조개구이', tip: '신선한 조개와 새우' },
        { category: 'food', name: '명동 비빔밥', tip: '채소 위주' },
      ] }],
    };
    const n = applyBlockModeDietaryWarnings(itin, ['Shellfish']);
    expect(n).toBeGreaterThanOrEqual(1);
    const aw = (itin.quality_warnings || []).filter((w) => w.type === 'allergen_warning');
    expect(aw.length).toBeGreaterThanOrEqual(1);
    expect(aw[0].allergen).toBe('shellfish');
    expect(aw[0].severity).toBe('warning'); // P280: critical 절대 금지 (retry loop 차단)
    expect(aw[0].stop).toContain('자갈치');
  });

  it('빈 dietary → no-op (0 warning, quality_warnings 미생성)', () => {
    const itin = { days: [{ stops: [{ category: 'food', name: '조개구이' }] }] };
    expect(applyBlockModeDietaryWarnings(itin, [])).toBe(0);
    expect(itin.quality_warnings).toBeUndefined();
  });

  it('Halal (알레르기 아님) → allergen_warning 0 (ALLERGEN_PREF_MAP 미포함)', () => {
    const itin = { days: [{ stops: [{ category: 'food', name: '삼겹살집' }] }] };
    applyBlockModeDietaryWarnings(itin, ['Halal']);
    const aw = (itin.quality_warnings || []).filter((w) => w.type === 'allergen_warning');
    expect(aw.length).toBe(0);
  });

  it('기존 quality_warnings 보존 (push, 덮어쓰기 0)', () => {
    const itin = {
      quality_warnings: [{ type: 'existing_warning' }],
      days: [{ stops: [{ category: 'food', name: '새우튀김 전문점' }] }],
    };
    applyBlockModeDietaryWarnings(itin, ['Shellfish']);
    expect(itin.quality_warnings.some((w) => w.type === 'existing_warning')).toBe(true);
    expect(itin.quality_warnings.some((w) => w.type === 'allergen_warning')).toBe(true);
  });

  // ── #9 (2026-06-20): 사용자 표시 알레르기 고지 (legacy _food_helper.js:352 와 동등) ──
  it('#9: 알레르기 손님 → 모든 food stop tip 에 사용자 표시 고지 주입 (keyword 매칭 안 된 stop 포함)', () => {
    const itin = {
      days: [{ stops: [
        { category: 'food', name: '명동 비빔밥', tip: '채소 위주' }, // shellfish keyword 없음
        { category: 'food', name: '자갈치 조개구이' },              // keyword 있음
        { category: 'culture', name: '경복궁', tip: '한복 대여' },   // food 아님 → 미주입
      ] }],
    };
    applyBlockModeDietaryWarnings(itin, ['Shellfish'], { language: 'en' });
    const stops = itin.days[0].stops;
    // SAFETY: keyword 매칭 여부 무관, 모든 food stop 에 고지 (list 미검증).
    expect(stops[0].tip).toContain('inform the restaurant');
    expect(stops[0].tip).toContain('채소 위주'); // 기존 tip 보존
    expect(stops[1].tip).toContain('inform the restaurant');
    expect(stops[2].tip).toBe('한복 대여'); // culture stop = 미주입
  });

  it('#9: 4언어 — ko/ja/zh 손님 언어로 고지 + allergen 라벨 번역', () => {
    const mk = () => ({ days: [{ stops: [{ category: 'food', name: '식당' }] }] });
    const ko = mk(); applyBlockModeDietaryWarnings(ko, ['Nuts'], { language: 'ko' });
    expect(ko.days[0].stops[0].tip).toContain('알레르기');
    expect(ko.days[0].stops[0].tip).toContain('견과류');

    const ja = mk(); applyBlockModeDietaryWarnings(ja, ['Nuts'], { language: 'ja' });
    expect(ja.days[0].stops[0].tip).toContain('アレルギー');
    expect(ja.days[0].stops[0].tip).toContain('ナッツ');

    const zh = mk(); applyBlockModeDietaryWarnings(zh, ['Nuts'], { language: 'zh' });
    expect(zh.days[0].stops[0].tip).toContain('过敏');
    expect(zh.days[0].stops[0].tip).toContain('坚果');
  });

  it('#9: language 미지정 → en 폴백', () => {
    const itin = { days: [{ stops: [{ category: 'food', name: '식당' }] }] };
    applyBlockModeDietaryWarnings(itin, ['Gluten']);
    expect(itin.days[0].stops[0].tip).toContain('Allergy notice');
    expect(itin.days[0].stops[0].tip).toContain('gluten');
  });

  it('#9: 멱등성 — 두 번 호출해도 고지 1회만 (재dispatch 중복 방지)', () => {
    const itin = { days: [{ stops: [{ category: 'food', name: '식당' }] }] };
    applyBlockModeDietaryWarnings(itin, ['Dairy'], { language: 'en' });
    const tip1 = itin.days[0].stops[0].tip;
    applyBlockModeDietaryWarnings(itin, ['Dairy'], { language: 'en' });
    expect(itin.days[0].stops[0].tip).toBe(tip1); // 동일 — 중복 주입 없음
  });

  it('#9: 알레르기 아닌 dietary(Halal/Vegan)만 → tip 미주입 (활성 allergen 0)', () => {
    const itin = { days: [{ stops: [{ category: 'food', name: '식당', tip: '원본' }] }] };
    applyBlockModeDietaryWarnings(itin, ['Halal', 'Vegan'], { language: 'en' });
    expect(itin.days[0].stops[0].tip).toBe('원본'); // 변경 0
  });
});
