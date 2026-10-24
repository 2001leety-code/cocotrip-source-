/**
 * 통합 2026-10-17 — tag 만 있는 [HALAL] 은 인증이 아니다 (SAFETY-CRITICAL, .claude/rules/dietary-safety.md).
 *
 * 실제 모듈을 그대로 지난다(가짜 파이프라인 없음). 바꾸는 것은 _food_index.json 내용(합성 행)과 텔레그램뿐:
 *   신뢰 SSOT(dietary-trust) → 프롬프트 컨텍스트(_food_helper) → 프롬프트 원문(buildPrompt / geminiPipeline 재시도)
 *   → validateResponse → applyDBMatcher → Firestore 저장 모양(JSON 왕복).
 * 위 원래 섹션(trust SSOT ~ applyDBMatcher)이 덮지 않는 구간(보고서에 명시): Gemini 호출·재시도 루프 자체,
 *   dietaryCoverageGate 종료 경로, dietaryStopReplacer 교체, finalItineraryGate, planPersister 의 실제
 *   Firestore 쓰기, 프론트 렌더.
 * 뒤에 추가된 Busan #1438 섹션 A–E 는 메모리 내 합성 일정으로 pass2Resolve / dietaryStopReplacer /
 *   finalItineraryGate 중복 게이트 / qualityMetrics 중복 분류 / runGeminiPipeline(3pass, 합성 모델)을 실제 코드로 지난다.
 *   여전히 실제 Firestore 쓰기·네트워크·프론트 렌더는 덮지 않는다.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const F = vi.hoisted(() => {
  const base = { city: 'seoul', rating: 4.7, reviewCount: 120, lat: 37.5636, lng: 126.9827, cuisine: 'Halal' };
  return {
    tagOnly: { ...base, name: '알파 그릴', nameEn: 'Alpha Grill', tag: 'halal', source: 'naver_local', placeId: 'syn-alpha', address: '서울특별시 중구 명동길 11' },
    tagOnlyExplicit: { ...base, name: '델타 식당', nameEn: 'Delta Dining', tag: 'halal', verification_status: 'unverified', placeId: 'syn-delta', address: '서울특별시 중구 명동길 14' },
    friendly: { ...base, name: '베타 키친', nameEn: 'Beta Kitchen', tag: 'halal', verification_status: 'muslim_friendly', placeId: 'syn-beta', address: '서울특별시 중구 명동길 12' },
    certified: { ...base, name: '감마 하우스', nameEn: 'Gamma House', tag: 'halal', verification_status: 'halal_certified', placeId: 'syn-gamma', address: '서울특별시 중구 명동길 13' },
  };
});
const ROWS = [F.tagOnly, F.tagOnlyExplicit, F.friendly, F.certified];

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const rows = [F.tagOnly, F.tagOnlyExplicit, F.friendly, F.certified];
  return {
    ...actual,
    readFileSync: (path: string, enc?: unknown) => {
      if (String(path).includes('_food_index.json')) return JSON.stringify(rows);
      return actual.readFileSync(path, enc as never);
    },
  };
});
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));

import { dietaryEvidenceFor, isDietaryTrusted, isCertifiedDietaryStatus, describeDietaryEvidence } from '../../api/_shared/dietary-trust.js';
import { getFoodContext, getExactCityTrustedFoodContext } from '../../api/_food_helper.js';
import { validateResponse, hasCriticalDietaryViolation } from '../../api/_ai_core/responseValidator.js';
import { applyDBMatcher } from '../../api/_ai_core/dbMatcher.js';

// Busan #1438 repro: threePassPipeline imports geminiPipeline (Sentry/Telegram/Firestore persister),
// the usage recorder (Firestore) and the LLM factory at load time. pass2Resolve uses none of them —
// only those side-effect boundaries are stubbed; pass2Resolve / replacer / gate run as real code.
vi.mock('../../api/_ai_core/geminiPipeline.js', () => ({ extractTextFromResponse: vi.fn(() => '') }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordGeminiUsage: vi.fn(async () => {}), recordUsageFromResponse: vi.fn() }));
vi.mock('../../api/_shared/llm/index.js', () => ({
  createLlmModel: vi.fn(() => { throw new Error('LLM disabled in unit test'); }),
  resolveLlmModel: vi.fn(() => 'unit-test-model'),
  resolveLlmProvider: vi.fn(() => 'mock'),
}));
// Busan #1438 caller tests (section D) run the ACTUAL runGeminiPipeline via vi.importActual. Only its
// remaining side-effect boundaries are stubbed: Firestore persister, Sentry, Telegram alert.
vi.mock('../../api/_ai_core/planPersister.js', () => ({
  selfHealLodgingBookend: vi.fn(),
  updatePlanProgressive: vi.fn(async () => {}),
}));
vi.mock('../../api/_shared/sentry.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureError: vi.fn(async () => {}),
}));
vi.mock('../../api/_telegram.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendErrorAlert: vi.fn(async () => {}),
}));
import { pass2Resolve } from '../../api/_ai_core/threePassPipeline.js';
import { replaceViolatingFoodStops } from '../../api/_ai_core/dietaryStopReplacer.js';
import { extractTextFromResponse } from '../../api/_ai_core/geminiPipeline.js';
import { updatePlanProgressive } from '../../api/_ai_core/planPersister.js';
import { createLlmModel } from '../../api/_shared/llm/index.js';
import { runDuplicateStopGate, assertNoDuplicateStops, FINAL_GATE_DUPLICATE_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { findDuplicateStops, computeQualityScore } from '../../api/_ai_core/qualityMetrics.js';

type Row = Record<string, unknown>;
const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
/** 4개 언어 인증 어휘. 부정형 정직 문구는 별도로 걸러서 본다. */
const CERT_VOCAB = /certif|인증|認証|认证|100\s*%/i;
const AI_CLAIM: Record<(typeof LANGS)[number], string> = {
  ko: '할랄 인증 식당입니다.',
  en: 'Halal certified restaurant.',
  ja: 'ハラール認証のお店です。',
  zh: '清真认证餐厅。',
};
const NEUTRAL = 'Great lunch spot.';

const planWith = (food: Row) => ({ days: [{ day: 1, city: 'seoul', stops: [
  { name: 'Synthetic Culture A', category: 'culture', start_time: '10:00' },
  { category: 'food', start_time: '12:00', stay_min: 60, ...food },
  { name: 'Synthetic Culture B', category: 'culture', start_time: '14:00' },
  { name: 'Synthetic Culture C', category: 'culture', start_time: '16:00' },
] }] });
const proseOf = (s: Row) => ['tip', 'tip_en', 'description', 'reason'].map((k) => (typeof s[k] === 'string' ? s[k] : '')).join(' ');

/** AI 가 위조해 올 수 있는 필드까지 실은 stop — 서버가 지우고 DB 증거로만 다시 채워야 한다. */
function forgedStop(row: Row, lang: (typeof LANGS)[number]) {
  return {
    name: row.name, display_name: row.nameEn,
    tip: `${AI_CLAIM[lang]} ${NEUTRAL}`, reason: `${AI_CLAIM[lang]}`,
    dietary_tags: ['halal'], verification_status: 'halal_certified',
    dietary_evidence: [{ diet: 'halal', tag: 'halal', verification_status: 'halal_certified' }],
    certification_type: 'JAKIM', verified_by: 'ai',
  };
}
function matchAndStore(row: Row, lang: (typeof LANGS)[number]) {
  const plan = planWith(forgedStop(row, lang));
  applyDBMatcher(plan, ROWS, 'seoul', lang);
  return JSON.parse(JSON.stringify(plan)).days[0].stops[1] as Row; // planPersister 가 쓰는 모양(JSON 직렬화 가능 객체)
}

describe('trust SSOT: tag alone is never evidence, friendly is never certified', () => {
  it('tag-only rows (quarantined source / explicit unverified) give no halal evidence', () => {
    for (const r of [F.tagOnly, F.tagOnlyExplicit]) {
      expect(dietaryEvidenceFor(r, 'halal')).toBeNull();
      expect(isDietaryTrusted(r)).toBe(false);
    }
  });
  it('friendly tier is trusted evidence but not certification; certified tier is both', () => {
    expect(dietaryEvidenceFor(F.friendly, 'halal')?.verification_status).toBe('muslim_friendly');
    expect(isCertifiedDietaryStatus('muslim_friendly')).toBe(false);
    expect(dietaryEvidenceFor(F.certified, 'halal')?.verification_status).toBe('halal_certified');
    expect(isCertifiedDietaryStatus('halal_certified')).toBe(true);
  });
});

describe('prompt context (_food_helper)', () => {
  it('main planner list: tag-only rows are excluded; [HALAL] lines carry no certification wording', () => {
    const ctx = getFoodContext('seoul', ['Halal']);
    expect(ctx).toContain('Beta Kitchen');
    expect(ctx).toContain('Gamma House');
    expect(ctx).not.toContain('Alpha Grill');
    expect(ctx).not.toContain('Delta Dining');
    expect(ctx).toMatch(/Beta Kitchen\) \[HALAL\]/);
    // 이 목록의 [HALAL] 은 tag 파생 표시라 friendly 행과 certified 행이 같은 표시를 받는다
    // → 표시만으로 인증을 말하면 안 된다는 것이 재시도 프롬프트 정책의 근거.
    expect(ctx).toMatch(/Gamma House\) \[HALAL\]/);
    // handlerCore → geminiPipeline 경로는 이 목록만 쓴다: 어떤 줄도 인증을 말하지 않으므로
    // 재시도 프롬프트 규칙상 이 경로에서 AI 가 인증을 주장할 근거는 없다(인증 문구는 dbMatcher 가 DB 등급으로 붙임).
    expect(ctx).not.toMatch(CERT_VOCAB);
  });

  it.each(LANGS)('exact-city trusted list (%s): honest tiers, tag-only absent', (lang) => {
    const { contextString, candidates } = getExactCityTrustedFoodContext({ cityKey: 'seoul', dietaryList: ['Halal'], language: lang });
    expect(candidates.map((c) => c.row.nameEn).sort()).toEqual(['Beta Kitchen', 'Gamma House']);
    expect(contextString).not.toContain('Alpha Grill');
    expect(contextString).not.toContain('Delta Dining');
    const [bi, gi] = [contextString.indexOf('Beta Kitchen'), contextString.indexOf('Gamma House')];
    expect(bi).toBeGreaterThan(-1);
    expect(gi).toBeGreaterThan(bi); // index order: friendly row before certified row
    const beta = contextString.slice(bi, gi);
    expect(beta).toContain('[HALAL — FRIENDLY (not certified)]');
    expect(beta).toContain(describeDietaryEvidence('muslim_friendly', lang));
    expect(beta).not.toContain('[HALAL — CERTIFIED]');
    // 재시도 프롬프트가 참조하는 HALAL 전용 인증 표시는 이 trusted 목록의 halal_certified 등급 라벨 그대로다
    expect(contextString.slice(gi)).toContain('[HALAL — CERTIFIED]');
  });
});

describe('prompt source: [HALAL] is not certification', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../../api/_ai_core', f), 'utf8');

  it('buildPrompt (HOME-applied, unchanged here) forbids certified wording unless the line says so', () => {
    const bp = read('buildPrompt.js');
    expect(bp).toMatch(/whose line is marked \[HALAL\] \(DB-verified halal; most are halal-friendly, not certified\)/);
    expect(bp).toMatch(/Do not describe any restaurant as "certified" unless its line says so/);
    expect(bp).not.toMatch(/100%\s*halal/i);
  });

  // ⚠️ scripts/integration/resolve-source-20261017.ps1 적용 후에만 통과한다(적용 전 파일은 충돌 마커 상태).
  it('geminiPipeline dietary retry prompt: [HALAL] alone is never certification; only a HALAL-specific certified label counts', () => {
    const src = read('geminiPipeline.js');
    expect(src).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
    expect(src).toContain("'- Halal: ONLY recommend restaurants from the provided list whose line is marked [HALAL].',");
    expect(src).toContain('it is NOT halal certification.');
    expect(src).toContain('unless the restaurant line is marked [HALAL] AND that same line states halal certification for that restaurant ([HALAL — CERTIFIED]).');
    expect(src).toContain('A [HALAL] marker by itself is never certification; a CERTIFIED label for another diet (e.g. [VEGAN — CERTIFIED]) is never halal certification.');
    // 식이 무관 CERTIFIED 문구(다른 식이의 인증 표시를 할랄 인증으로 오인 가능)는 없어야 한다
    expect(src).not.toContain('explicitly says CERTIFIED (operator-verified)');
    expect(src).not.toContain('(DB-certified)');
    expect(src).not.toContain('explicitly certified or verified Halal');
    expect(src).not.toMatch(/100%\s*halal/i);
    // VEGAN: HOME 줄 그대로 (새 인증 정책 없음)
    expect(src).toContain(
      `'- Vegan: ONLY plant-based restaurants. NEVER claim "100% vegan"/"vegan restaurant" unless the line is marked [VEGAN] in the provided list. NEVER recommend places serving',`,
    );
    // 유지되어야 하는 OURS 기준선
    expect(src).toContain("import { createLlmModel, resolveLlmModel, resolveLlmProvider } from '../_shared/llm/index.js';");
    expect(src).not.toContain('@google/generative-ai');
  });
});

describe('validateResponse (selected DB row is the only positive evidence)', () => {
  const critical = (row: Row, tip: string) =>
    hasCriticalDietaryViolation(validateResponse(planWith({ name: row.name, display_name: row.nameEn, tip }), { lang: 'en', dietary: ['Halal'] }, ROWS));

  it.each([F.tagOnly, F.tagOnlyExplicit])('tag-only row is a critical halal violation even with certified prose: %#', (row) => {
    expect(critical(row, `${AI_CLAIM.en} ${NEUTRAL}`)).toBe(true);
    expect(critical(row, NEUTRAL)).toBe(true);
  });
  it('friendly and certified rows still pass (positive trust behavior preserved)', () => {
    expect(critical(F.friendly, 'halal-friendly menu')).toBe(false);
    expect(critical(F.certified, 'halal menu')).toBe(false);
  });
});

describe('applyDBMatcher -> stored stop shape', () => {
  it.each(LANGS)('tag-only row (%s): DB existence kept as verified:true, but zero dietary evidence and no certified vocabulary', (lang) => {
    for (const row of [F.tagOnly, F.tagOnlyExplicit]) {
      const s = matchAndStore(row, lang);
      expect(s.verified).toBe(true); // "DB 에 있다" — 식이 안전과 별개 (AGENTS.md §1-4)
      expect(s.dietary_tags).toBeUndefined();
      expect(s.dietary_evidence).toBeUndefined();
      expect(s.verification_status).toBeUndefined();
      expect(s.certification_type).toBeUndefined();
      expect(s.verified_by).toBeUndefined();
      expect(proseOf(s)).not.toMatch(CERT_VOCAB);
      expect(String(s.tip)).toContain(NEUTRAL); // 주장 문장만 제거, 나머지 문장은 보존
    }
  });

  it.each(LANGS)('friendly row (%s): AI certification claim removed; only the honest negated tier note mentions certification', (lang) => {
    const s = matchAndStore(F.friendly, lang);
    const note = describeDietaryEvidence('muslim_friendly', lang);
    expect(s.dietary_tags).toEqual(['halal']);
    expect(s.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    expect(String(s.tip)).toContain(note);
    expect(proseOf(s).split(note).join(' ')).not.toMatch(CERT_VOCAB);
  });

  it.each(LANGS)('certified row (%s): operator-verified certification wording is preserved (no loosening, no over-stripping)', (lang) => {
    const s = matchAndStore(F.certified, lang);
    expect(s.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'halal_certified' }]);
    expect(String(s.tip)).toContain(AI_CLAIM[lang]);
    expect(String(s.tip)).toContain(describeDietaryEvidence('halal_certified', lang));
  });
});

/* ──────────────────────────────────────────────────────────────────────────────
 * Busan #1438 (2026-10-19) — identity reservation RED repro. Public run only shows
 * HTTP 422 DUPLICATE_STOP_VIOLATION "ROYAL INDIA HAEUNDAE×2"; the prod plan, mode and
 * deployed API version are unknown. These itineraries are deliberately constructed —
 * they show local paths reaching the same code, not the prod root cause.
 * Busan rows are passed directly to the modules (the fs mock above only serves Seoul rows).
 * ────────────────────────────────────────────────────────────────────────────── */
type Plan = { days: { day: number; city: string; stops: Row[] }[] };
const fresh = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// Business metadata from audit busan-candidate-evidence.json (unchanged tiers/status).
const BUSAN = {
  royal: { name: 'ROYAL INDIA HAEUNDAE', nameEn: 'ROYAL INDIA HAEUNDAE', city: 'busan', tag: 'halal', verification_status: 'muslim_friendly', source: null, placeId: 'ChIJh2EMbgCNaDURcljdrxOhz70', lat: 35.1605987, lng: 129.1616518, address: '부산광역시 해운대구 해운대해변로 287', rating: 4.9, reviewCount: 643 },
  seomyeon: { name: 'ROYAL INDIA SEOMYEON (Indian +Nepali & Halal Cuisine)', nameEn: 'ROYAL INDIA SEOMYEON', city: 'busan', tag: 'general', verification_status: null, source: null, placeId: 'ChIJ_ewpcwDraDURH60R8d6-AzA', lat: 35.1530115, lng: 129.0596058, address: '부산광역시 부산진구 6th floor 672 중앙대로', rating: 4.9, reviewCount: 365 },
  yoogane: { name: '유가네닭갈비 해운대점(Yoogane', nameEn: 'Yoogane Dakgalbi Haeundae', city: 'busan', tag: 'halal', verification_status: 'muslim_friendly', source: null, placeId: 'ChIJbWKYEW6NaDURjjQXSowc3Iw', lat: 35.1620835, lng: 129.1597925, address: '부산광역시 해운대구 구남로 20', rating: 4.8, reviewCount: 331 },
  thai: { name: 'Thai House', nameEn: 'Thai House', city: 'busan', tag: 'halal', verification_status: 'muslim_friendly', source: null, placeId: 'ChIJW7qnVwCNaDURkgK9YFqrCUE', lat: 35.1613715, lng: 129.1610228, address: '부산광역시 해운대구 3rd floor 31 구남로', rating: 4.8, reviewCount: 64 },
};
const ROYAL = BUSAN.royal.name;
// Synthetic negative controls near Haeundae, all out-ranking Thai House — each must stay ineligible.
const CTRL_BASE = { rating: 5.0, reviewCount: 9999, lat: 35.1600, lng: 129.1610 };
const CONTROLS = {
  general: { ...CTRL_BASE, name: '합성 일반식당', nameEn: 'Synthetic General', city: 'busan', tag: 'general', verification_status: null, address: '부산광역시 해운대구 구남로 1' },
  unverified: { ...CTRL_BASE, name: '합성 미검증', nameEn: 'Synthetic Unverified', city: 'busan', tag: 'halal', verification_status: 'unverified', source: 'naver_local', address: '부산광역시 해운대구 구남로 2' },
  crossCity: { ...CTRL_BASE, name: '합성 서울행', nameEn: 'Synthetic Seoul Row', city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly', address: '서울특별시 중구 명동길 20' },
  addressMismatch: { ...CTRL_BASE, name: '합성 용인행', nameEn: 'Synthetic Yongin Row', city: 'busan', tag: 'halal', verification_status: 'muslim_friendly', address: '경기도 용인시 처인구 포곡읍 에버랜드로 199' },
  beyond8km: { ...CTRL_BASE, name: '합성 기장', nameEn: 'Synthetic Gijang', city: 'busan', tag: 'halal', verification_status: 'muslim_friendly', lat: 35.2440, lng: 129.2220, address: '부산광역시 기장군 기장읍 1' },
};

const lodging = () => ({ name: 'Haeundae Stay', display_name: 'Haeundae Stay', category: 'lodging' });
const culture = (n: string) => ({ name: n, display_name: n, category: 'culture', lat: 35.15, lng: 129.1 });
/** Synthetic halal-violating stop near Haeundae (not in the index). */
const porkStop = (n: string) => ({ name: n, display_name: `${n} (pork)`, category: 'food', start_time: '12:30', stay_min: 60, lat: 35.1590, lng: 129.1600, address: '부산광역시 해운대구 해운대로 1' });
const violation = (stop: string) => ({ type: 'dietary_violation', severity: 'critical', diet: 'halal', stop });
const foodStopsOf = (p: Plan) => p.days.flatMap((d) => d.stops.filter((s) => s.category === 'food'));

/** Busan 3-day plan: day-1 holds `existing` food stops, day-2 (and optionally day-3) the given stops. */
function busanPlan(existing: Row[], day2Food: Row, day3Food?: Row): Plan {
  return fresh({ days: [
    { day: 1, city: 'busan', stops: [lodging(), culture('Haedong Yonggungsa Temple'), ...existing, culture('Dongbaekseom Island')] },
    { day: 2, city: 'busan', stops: [lodging(), culture('Gamcheon Culture Village'), day2Food, culture('Jagalchi Market')] },
    { day: 3, city: 'busan', stops: [lodging(), ...(day3Food ? [day3Food] : []), { name: 'Busan Station', display_name: 'Busan Station', category: 'travel' }] },
  ] });
}
const royalAt = (fields: Row) => ({ category: 'food', start_time: '12:00', stay_min: 60, lat: BUSAN.royal.lat, lng: BUSAN.royal.lng, address: BUSAN.royal.address, verified: true, ...fields });

describe('Busan #1438 A — pass2Resolve must not re-resolve a restaurant already named in the plan', () => {
  const slot = { name: 'FOOD_SLOT', category: 'food', start_time: '12:30', stay_min: 60, food_intent: 'Royal India Haeundae', cuisine: 'indian', price_range: 'moderate' };

  it('day-2 FOOD_SLOT whose intent names the day-1 restaurant resolves to the unused trusted row; final duplicate gate clean', () => {
    const index = fresh([BUSAN.royal, BUSAN.thai]);
    const before = fresh(index);
    const p = pass2Resolve(busanPlan([royalAt({ name: ROYAL, display_name: ROYAL })], slot), index, 'busan') as Plan;
    const resolved = p.days[1].stops[2];
    expect(resolved._resolvedFrom).toBe('pass2');
    expect(resolved.name).toBe('Thai House');
    expect(resolved.display_name).toBe('Thai House');
    expect(foodStopsOf(p).filter((s) => s.name === ROYAL)).toHaveLength(1);
    expect(runDuplicateStopGate(p)).toEqual({ ok: true, code: null, duplicates: [] });
    expect(index).toEqual(before); // index rows are never mutated
  });

  it('guard: without a pre-existing Royal stop the same intent still resolves to Royal (no blanket ban)', () => {
    const p = pass2Resolve(busanPlan([], slot), fresh([BUSAN.royal, BUSAN.thai]), 'busan') as Plan;
    expect(p.days[1].stops[2].name).toBe(ROYAL);
  });

  it('control: an unrepaired exact ROYAL INDIA HAEUNDAE×2 still fails the final duplicate gate with 422', () => {
    const p = busanPlan([royalAt({ name: ROYAL, display_name: ROYAL })], royalAt({ name: ROYAL, display_name: ROYAL, start_time: '12:30' }));
    let err: (Error & { code?: string; statusCode?: number; details?: unknown }) | undefined;
    try { assertNoDuplicateStops(p, '3pass'); } catch (e) { err = e as typeof err; }
    expect(err?.code).toBe(FINAL_GATE_DUPLICATE_CODE);
    expect(err?.statusCode).toBe(422);
    expect(err?.message).toContain('ROYAL INDIA HAEUNDAE×2');
    expect(err?.details).toEqual([{ name: ROYAL, count: 2 }]);
  });
});

describe('Busan #1438 B — replaceViolatingFoodStops reserves identities already in the plan', () => {
  const PORK = '해운대 돼지국밥';
  const replace = (p: Plan, index: Row[], labels = [PORK]) =>
    replaceViolatingFoodStops(p, labels.map(violation), index, ['Halal'], 'busan', 'ko');

  it('the constructed violating stop is a real critical halal violation per validateResponse', () => {
    const p = busanPlan([], porkStop(PORK));
    expect(hasCriticalDietaryViolation(validateResponse(p, { lang: 'ko', dietary: ['Halal'] }, [BUSAN.royal, BUSAN.thai]))).toBe(true);
  });

  // The final gate now also groups case / surrounding-whitespace variants (section E), but these
  // cases assert the replacer's own selection directly rather than relying on that later backstop.
  it.each([
    ['case-only', { name: 'Royal India Haeundae', display_name: 'Royal India Haeundae' }],
    ['case + surrounding whitespace', { name: '  royal india haeundae ', display_name: ' Royal India Haeundae  ' }],
    ['display_name only differs in case', { name: '로얄 인디아', display_name: 'royal india haeundae' }],
  ])('existing Royal (%s) is reserved; the unused trusted Thai House is chosen', (_label, fields) => {
    const index = fresh([BUSAN.royal, BUSAN.thai]);
    const before = fresh(index);
    const p = busanPlan([royalAt(fields)], porkStop(PORK));
    const r = replace(p, index);
    const target = p.days[1].stops[2];
    expect(r).toMatchObject({ replaced: 1, failed: 0 });
    expect(target.name).toBe('Thai House');
    expect(target.display_name).toBe('Thai House');
    // friendly evidence stays friendly: verified:true is only DB existence
    expect(target.verified).toBe(true);
    expect(target.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    expect(isCertifiedDietaryStatus((target.dietary_evidence as Row[])[0].verification_status as string)).toBe(false);
    expect(target.tip).toBe(describeDietaryEvidence('muslim_friendly', 'ko'));
    expect(index).toEqual(before);
  });

  it('explicit pipe alias of the Royal row already in the plan reserves that row', () => {
    // Synthetic Korean alias appended to the audit row name (name/tier/coords unchanged).
    const royalPiped = { ...BUSAN.royal, name: `${ROYAL}|로얄 인디아 해운대` };
    const p = busanPlan([royalAt({ name: '로얄 인디아 해운대', display_name: '로얄 인디아 해운대' })], porkStop(PORK));
    replace(p, fresh([royalPiped, BUSAN.thai]));
    expect(p.days[1].stops[2].name).toBe('Thai House');
  });

  it('legacy name_ko/name_en Royal stop is reserved; final duplicate gate stays clean', () => {
    const p = busanPlan([royalAt({ name_ko: ROYAL, name_en: ROYAL })], porkStop(PORK));
    replace(p, fresh([BUSAN.royal, BUSAN.thai]));
    expect(p.days[1].stops[2].name).toBe('Thai House');
    // the gate reads name_ko, so picking Royal here would reproduce ROYAL INDIA HAEUNDAE×2
    expect(runDuplicateStopGate(p).ok).toBe(true);
  });

  it('repeated replacements reserve both pre-existing and newly chosen identities', () => {
    const PORK2 = '해운대 삼겹살';
    const p = busanPlan([royalAt({ name: 'Royal India Haeundae', display_name: 'Royal India Haeundae' })], porkStop(PORK), porkStop(PORK2));
    const r = replace(p, fresh([BUSAN.royal, BUSAN.yoogane, BUSAN.thai]), [PORK, PORK2]);
    const picks = [p.days[1].stops[2].name, p.days[2].stops[1].name];
    expect(r).toMatchObject({ replaced: 2, failed: 0 });
    expect(picks).toEqual([BUSAN.yoogane.name, 'Thai House']);
    expect(picks).not.toContain(ROYAL);
    expect(runDuplicateStopGate(p).ok).toBe(true);
  });

  // 2026-10-24 재방문 정책(운영자 결정): 적격 행이 전부 다른 날 쓰였으면 실패 대신 **다른 날 재방문**(revisit: true, 가장 가까운 행).
  //   같은 날 이미 쓴 행은 여전히 후보가 아니다 → 오늘 전부 썼으면 failed(이름 생성·완화 금지 그대로).
  it('all eligible rows already used on another day (case-variant) => revisit of the nearest one, flagged; index untouched', () => {
    const index = fresh([BUSAN.royal, BUSAN.thai]);
    const before = fresh(index);
    const p = busanPlan([
      royalAt({ name: 'Royal India Haeundae', display_name: 'Royal India Haeundae' }),
      royalAt({ name: ' thai house ', display_name: 'THAI HOUSE', start_time: '18:00' }),
    ], porkStop(PORK));
    const r = replace(p, index);
    expect(r).toMatchObject({ replaced: 1, failed: 0 });
    expect(r.detail).toEqual([`replaced halal:${PORK} -> ${ROYAL} [revisit-other-day]`]); // Royal 이 돼지집 좌표에 더 가깝다(~0.24km vs ~0.28km)
    expect(p.days[1].stops[2]).toMatchObject({ name: ROYAL, revisit: true, verified: true });
    expect(index).toEqual(before);
  });

  it('all eligible rows already used on the SAME day => failed, violating stop and index untouched', () => {
    const index = fresh([BUSAN.royal, BUSAN.thai]);
    const before = fresh(index);
    const p = busanPlan([], porkStop(PORK));
    p.days[1].stops.push(royalAt({ name: ROYAL, start_time: '18:00' }), royalAt({ name: 'Thai House', start_time: '20:00' }));
    const targetBefore = fresh(p.days[1].stops[2]);
    const r = replace(p, index);
    expect(r).toMatchObject({ replaced: 0, failed: 1 });
    expect(r.detail).toContain(`no-candidate halal:${PORK}`);
    expect(p.days[1].stops[2]).toEqual(targetBefore);
    expect(index).toEqual(before);
  });

  it('guard: a distinct branch of the same brand is not reserved (no brand fuzzy match)', () => {
    const p = busanPlan([royalAt({ name: BUSAN.seomyeon.name, display_name: BUSAN.seomyeon.nameEn, lat: BUSAN.seomyeon.lat, lng: BUSAN.seomyeon.lng })], porkStop(PORK));
    replace(p, fresh([BUSAN.royal, BUSAN.thai, BUSAN.seomyeon]));
    expect(p.days[1].stops[2].name).toBe(ROYAL);
  });

  // 2026-10-24 (재방문 정책 F): 8km 는 이제 **1단계** — 8km 안 미사용 적격 행이 있으면 그게 이기고(동선 보존),
  //   없을 때만 같은 도시의 먼 행(2단계 city-unused)을 쓴다. 일반·미검증·타도시·주소모순 행은 어느 단계에서도 후보 아님.
  it('guard: general / unverified / cross-city / address-mismatch rows never become candidates; a >8km row only when nothing is near', () => {
    const all = fresh([...Object.values(CONTROLS), BUSAN.thai]);
    const p = busanPlan([], porkStop(PORK));
    replace(p, all);
    expect(p.days[1].stops[2].name).toBe('Thai House');
    const far = busanPlan([], porkStop(PORK));
    expect(replace(far, fresh([CONTROLS.beyond8km])).detail).toEqual([`replaced halal:${PORK} -> 합성 기장 [city-unused]`]);
    for (const [key, row] of Object.entries(CONTROLS).filter(([k]) => k !== 'beyond8km')) {
      const q = busanPlan([], porkStop(PORK));
      const r = replace(q, fresh([row]));
      expect({ key, ...r }).toMatchObject({ key, replaced: 0, failed: 1 });
      expect(q.days[1].stops[2].name).toBe(PORK);
    }
  });
});

type GateErr = Error & { code?: string; statusCode?: number; stage?: string; reason?: string; details?: unknown };
// Existing final-gate user sentence — the exhaustion error must not claim a duplicate was found.
const EXHAUSTED_MESSAGE = 'To keep quality, we did not save this plan. Please try again or contact support.';
function expectExhausted(err: GateErr | undefined) {
  expect(err?.code).toBe(FINAL_GATE_DUPLICATE_CODE);
  expect(err?.statusCode).toBe(422);
  expect(err?.stage).toBe('pass2');
  expect(err?.reason).toBe('UNUSED_FOOD_CANDIDATES_EXHAUSTED');
  expect(err?.message).toBe(EXHAUSTED_MESSAGE);
  expect(err?.details).toBeUndefined(); // no manufactured duplicate counts
}
const catchSync = (fn: () => unknown): GateErr | undefined => {
  try { fn(); } catch (e) { return e as GateErr; }
  return undefined;
};

describe('Busan #1438 C — pass2Resolve fails closed when only used rows remain', () => {
  const slot = { name: 'FOOD_SLOT', category: 'food', start_time: '12:30', stay_min: 60, food_intent: 'Royal India Haeundae', cuisine: 'indian', price_range: 'moderate' };

  // Before the fix this resolved straight to Royal: 'Royal India Haeundae' + 'ROYAL INDIA HAEUNDAE'
  // — a case-only duplicate the raw-name final gate does not catch.
  it('existing case-variant Royal + index holding only Royal => 422 before any fallback; food stops and index untouched', () => {
    const index = fresh([BUSAN.royal]);
    const before = fresh(index);
    const p = busanPlan([royalAt({ name: 'Royal India Haeundae', display_name: 'Royal India Haeundae' })], slot);
    expectExhausted(catchSync(() => pass2Resolve(p, index, 'busan')));
    expect(foodStopsOf(p)).toHaveLength(2);
    expect(p.days[1].stops[2]).toMatchObject({ name: 'FOOD_SLOT', food_intent: 'Royal India Haeundae' });
    expect(index).toEqual(before);
  });

  // Before the fix the second slot fell back to free text 'Royal India Haeundae' (the intent),
  // i.e. a case-variant of the row already resolved for the first slot.
  it('second slot after the only row was used in the same pass => 422 instead of free-text fallback', () => {
    const index = fresh([BUSAN.royal]);
    const before = fresh(index);
    const p = busanPlan([], slot, { ...slot, start_time: '12:00' });
    expectExhausted(catchSync(() => pass2Resolve(p, index, 'busan')));
    expect(p.days[1].stops[2].name).toBe(ROYAL);
    expect(p.days[2].stops[1]).toMatchObject({ name: 'FOOD_SLOT', food_intent: 'Royal India Haeundae' });
    expect(foodStopsOf(p)).toHaveLength(2);
    expect(index).toEqual(before);
  });

  it('guard: empty index keeps the original no-op behavior (no throw, slot untouched)', () => {
    const p = busanPlan([royalAt({ name: ROYAL, display_name: ROYAL })], slot);
    const snapshot = fresh(p);
    expect(pass2Resolve(p, [], 'busan')).toBe(p);
    expect(p).toEqual(snapshot);
  });

  it('guard: an unresolved FOOD_SLOT does not reserve anything; general scoring still picks the top row', () => {
    const p = busanPlan([], slot, { ...slot, start_time: '12:00', food_intent: 'Thai House dinner' });
    pass2Resolve(p, fresh([BUSAN.royal, BUSAN.thai]), 'busan');
    expect([p.days[1].stops[2].name, p.days[2].stops[1].name]).toEqual([ROYAL, 'Thai House']);
  });

  it('within one pass a row sharing an explicit alias (case / pipe) with an already chosen row is reserved', () => {
    // Synthetic duplicate index row for the same restaurant (case-variant name + pipe alias).
    const royalDup = { ...BUSAN.royal, name: 'royal india haeundae|로얄 인디아 해운대', nameEn: 'Royal India Haeundae', placeId: 'syn-royal-dup' };
    const p = busanPlan([], slot, { ...slot, start_time: '12:00' });
    pass2Resolve(p, fresh([BUSAN.royal, royalDup, BUSAN.thai]), 'busan');
    expect([p.days[1].stops[2].name, p.days[2].stops[1].name]).toEqual([ROYAL, 'Thai House']);
    expect(runDuplicateStopGate(p).ok).toBe(true);
  });
});

/* Section D — caller propagation through the ACTUAL runGeminiPipeline (3pass). The model is a
 * deterministic synthetic responder (no network); the fs mock serves the four Seoul rows above. */
describe('Busan #1438 D — runGeminiPipeline propagates pass2 exhaustion from all three pass2 calls', () => {
  type GP = typeof import('../../api/_ai_core/geminiPipeline.js');
  let actualGP: GP;
  beforeAll(async () => {
    actualGP = await vi.importActual<GP>('../../api/_ai_core/geminiPipeline.js');
  });

  const food = (row: Row, start: string) => ({ name: row.name, display_name: row.nameEn, category: 'food', start_time: start, stay_min: 60 });
  const stay = (start: string) => ({ name: 'Synthetic Stay', display_name: 'Synthetic Stay', category: 'lodging', start_time: start });
  const seoulFood = [food(F.tagOnly, '11:00'), food(F.tagOnlyExplicit, '12:30'), food(F.friendly, '14:00'), food(F.certified, '15:30')];
  /** Every index row already concrete in the plan + one unresolved slot => pass2 must fail closed. */
  const exhaustedPlan = { days: [{ day: 1, city: 'seoul', stops: [
    stay('09:00'), ...seoulFood,
    { name: 'FOOD_SLOT', category: 'food', start_time: '18:00', stay_min: 60, food_intent: 'Halal dinner', cuisine: 'halal' },
    stay('21:00'),
  ] }] };
  /** Tag-only Alpha Grill is a critical halal violation; both trusted rows are already used => replacer fails => dietary retry. */
  const dietaryInitial = { days: [{ day: 1, city: 'seoul', stops: [stay('09:00'), ...seoulFood, stay('21:00')] }] };
  /** One-stop day => pattern violation => pattern retry. */
  const patternInitial = { days: [{ day: 1, city: 'seoul', stops: [{ name: 'Synthetic Culture A', category: 'culture', start_time: '10:00' }] }] };

  let llmCalls: string[] = [];
  function queueModel(plans: unknown[]) {
    const queue = plans.map((x) => JSON.stringify(x));
    const generateContent = vi.fn(async (req: { systemInstruction?: { parts?: { text?: string }[] } }) => {
      const sys = String(req?.systemInstruction?.parts?.[0]?.text || '');
      llmCalls.push(sys.includes('Korean food and restaurant expert') ? 'pass3' : 'pass1');
      const text = queue.length > 0 ? String(queue.shift()) : '[]';
      return { response: { candidates: [{ content: { parts: [{ text }] } }] } };
    });
    vi.mocked(createLlmModel).mockImplementation((() => ({ generateContent })) as never);
  }
  const run = (dietary: string[], isAdminBypass: boolean) =>
    actualGP.runGeminiPipeline({
      apiKey: 'unit-test', systemPrompt: 'SYNTHETIC SYSTEM', userMessage: 'SYNTHETIC USER', area: 'seoul', language: 'en',
      mode: '3pass', dietary, body: { area: 'seoul' }, isAdminBypass, adminDb: null, planId: null, identifierForBucketing: 'unit-test',
    } as never).then(() => undefined, (e: unknown) => e as GateErr);

  beforeEach(() => {
    llmCalls = [];
    vi.stubEnv('PLANNER_PASS3_BACKGROUND', ''); // sync Pass 3, so any enrichment after a failed pass2 would be visible
    vi.mocked(extractTextFromResponse).mockImplementation(actualGP.extractTextFromResponse);
    vi.mocked(updatePlanProgressive).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(extractTextFromResponse).mockImplementation(() => '');
    vi.mocked(createLlmModel).mockImplementation(() => { throw new Error('LLM disabled in unit test'); });
  });

  it.each([false, true])('initial pass2 (admin=%s): 422 propagates; no Pass 3, no persistence', async (admin) => {
    queueModel([exhaustedPlan]);
    expectExhausted(await run([], admin));
    expect(llmCalls).toEqual(['pass1']);
    expect(updatePlanProgressive).not.toHaveBeenCalled();
  });

  it.each([false, true])('dietary retry pass2 (admin=%s): 422 is rethrown, not swallowed into DIETARY_VIOLATION; no enrichment after it', async (admin) => {
    queueModel([dietaryInitial, [], exhaustedPlan]);
    expectExhausted(await run(['Halal'], admin));
    expect(llmCalls).toEqual(['pass1', 'pass3', 'pass1']);
    expect(updatePlanProgressive).not.toHaveBeenCalled();
  });

  it.each([false, true])('pattern retry pass2 (admin=%s): 422 is rethrown (admin soft-accept cannot keep partial pass2 state)', async (admin) => {
    queueModel([patternInitial, exhaustedPlan]);
    expectExhausted(await run([], admin));
    expect(llmCalls).toEqual(['pass1', 'pass1']);
    expect(updatePlanProgressive).not.toHaveBeenCalled();
  });
});

/* Section E — final duplicate gate / duplicate_stops metric grouping (2026-10-19). Sections A–C only
 * stop pass2/replacer from re-picking a used row; a plan that already carries case / surrounding-
 * whitespace variants (initial model output, legacy fields) reaches the gate unchanged. Real
 * findDuplicateStops / runDuplicateStopGate / assertNoDuplicateStops / computeQualityScore, no mocks.
 * Not proof of the prod #1438 root cause. Branch names, lodging exemption and label fields unchanged. */
describe('Busan #1438 E — final duplicate gate groups case / surrounding-whitespace label variants', () => {
  const metricOf = (p: Plan) => computeQualityScore(p, [], 'busan', [], { lang: 'en' }).metrics.duplicate_stops;
  /** Runs every real entry point once; returns results plus whether the input was left untouched. */
  function gateAll(p: Plan) {
    const snapshot = fresh(p);
    const found = findDuplicateStops(p);
    const gate = runDuplicateStopGate(p);
    const metric = metricOf(p);
    const err = catchSync(() => assertNoDuplicateStops(p, '3pass'));
    return { found, gate, metric, err, untouched: JSON.stringify(p) === JSON.stringify(snapshot) };
  }

  // RED until qualityMetrics groups on a trimmed, case-folded key; the reported name is the first
  // trimmed label seen (no new user copy), so the existing "ROYAL INDIA HAEUNDAE×2" sentence is kept.
  it.each([
    ['case-only (name)', { name: ROYAL, display_name: ROYAL }, { name: 'Royal India Haeundae', display_name: 'Royal India Haeundae' }],
    ['surrounding whitespace only (name)', { name: ROYAL, display_name: ROYAL }, { name: `  ${ROYAL} `, display_name: ROYAL }],
    ['case + surrounding whitespace (name)', { name: ROYAL, display_name: ROYAL }, { name: ' royal india haeundae  ', display_name: 'Royal India Haeundae' }],
    ['legacy name_ko fallback', { name_ko: ROYAL, name_en: ROYAL }, { name_ko: 'Royal India Haeundae ', name_en: 'Royal India Haeundae' }],
    ['display_name fallback', { display_name: ROYAL }, { display_name: 'royal india haeundae' }],
  ])('food across days, %s => count 2, DUPLICATE_STOP_VIOLATION 422, input not mutated', (_label, day1, day2) => {
    const r = gateAll(busanPlan([royalAt(day1)], royalAt({ ...day2, start_time: '12:30' })));
    expect(r.found).toEqual([{ name: ROYAL, count: 2 }]);
    expect(r.gate).toEqual({ ok: false, code: FINAL_GATE_DUPLICATE_CODE, duplicates: [{ name: ROYAL, count: 2 }] });
    expect(r.metric.count).toBe(1);
    expect(r.err?.code).toBe(FINAL_GATE_DUPLICATE_CODE);
    expect(r.err?.statusCode).toBe(422);
    expect(r.err?.stage).toBe('3pass');
    expect(r.err?.message).toContain('ROYAL INDIA HAEUNDAE×2');
    expect(r.err?.details).toEqual([{ name: ROYAL, count: 2 }]);
    expect(r.untouched).toBe(true);
  });

  it('three variants across three days => one group, count 3, first trimmed label reported', () => {
    const r = gateAll(busanPlan(
      [royalAt({ name: ` ${ROYAL} `, display_name: ROYAL })],
      royalAt({ name: 'Royal India Haeundae', start_time: '12:30' }),
      royalAt({ name: 'royal india haeundae', start_time: '12:00' }),
    ));
    expect(r.found).toEqual([{ name: ROYAL, count: 3 }]);
    expect(r.metric.count).toBe(2);
    expect(r.err?.message).toContain('ROYAL INDIA HAEUNDAE×3');
    expect(r.untouched).toBe(true);
  });

  it('non-food attraction case/whitespace variant gets the same classification in gate and metric', () => {
    // day-2 already holds 'Gamcheon Culture Village'; day-3 repeats it with case + whitespace drift.
    const r = gateAll(busanPlan([], royalAt({ name: ROYAL, display_name: ROYAL }), culture(' GAMCHEON CULTURE VILLAGE')));
    expect(r.found).toEqual([{ name: 'Gamcheon Culture Village', count: 2 }]);
    expect(r.gate.code).toBe(FINAL_GATE_DUPLICATE_CODE);
    expect(r.metric.count).toBe(1);
    expect(r.err?.statusCode).toBe(422);
    expect(r.untouched).toBe(true);
  });

  it('whitespace-only labels are blank and ignored, like empty labels', () => {
    // identical raw blank label on two days — today it is grouped as a duplicate named '  '
    const r = gateAll(busanPlan([culture('  ')], culture('  ')));
    expect(r.found).toEqual([]);
    expect(r.gate).toEqual({ ok: true, code: null, duplicates: [] });
    expect(r.metric.count).toBe(0);
    expect(r.err).toBeUndefined();
  });

  // ── guards (expected to pass before and after the fix) ──
  it('guard: exact unmodified ROYAL INDIA HAEUNDAE×2 is still detected by findDuplicateStops and the metric', () => {
    const r = gateAll(busanPlan([royalAt({ name: ROYAL, display_name: ROYAL })], royalAt({ name: ROYAL, display_name: ROYAL, start_time: '12:30' })));
    expect(r.found).toEqual([{ name: ROYAL, count: 2 }]);
    expect(r.metric.count).toBe(1);
    expect(r.err?.message).toContain('ROYAL INDIA HAEUNDAE×2');
  });

  it('guard: distinct branches (Haeundae vs Seomyeon, any case) stay distinct', () => {
    const r = gateAll(busanPlan(
      [royalAt({ name: ROYAL, display_name: ROYAL })],
      royalAt({ name: 'royal india seomyeon', display_name: BUSAN.seomyeon.nameEn, lat: BUSAN.seomyeon.lat, lng: BUSAN.seomyeon.lng, start_time: '12:30' }),
      royalAt({ name: BUSAN.seomyeon.name, display_name: BUSAN.seomyeon.nameEn, lat: BUSAN.seomyeon.lat, lng: BUSAN.seomyeon.lng }),
    ));
    expect(r.found).toEqual([]);
    expect(r.gate.ok).toBe(true);
    expect(r.metric.count).toBe(0);
    expect(r.err).toBeUndefined();
  });

  it('guard: repeated lodging (including case/whitespace variants) stays exempt from gate and metric', () => {
    const p = busanPlan([], royalAt({ name: ROYAL, display_name: ROYAL }));
    p.days[2].stops[0] = { name: ' HAEUNDAE STAY ', display_name: 'haeundae stay', category: 'lodging' };
    const r = gateAll(p);
    expect(r.found).toEqual([]);
    expect(r.gate.ok).toBe(true);
    expect(r.metric.count).toBe(0);
    expect(r.metric.total).toBe(p.days.flatMap((d) => d.stops).filter((s) => s.category !== 'lodging').length);
  });

  it('guard: stops with no label at all are ignored (current contract)', () => {
    const r = gateAll(busanPlan([{ category: 'culture', name: '' }], { category: 'culture', display_name: '' }));
    expect(r.found).toEqual([]);
    expect(r.gate.ok).toBe(true);
    expect(r.metric.count).toBe(0);
  });
});
