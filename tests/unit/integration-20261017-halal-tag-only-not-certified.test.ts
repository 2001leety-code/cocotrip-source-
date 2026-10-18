/**
 * 통합 2026-10-17 — tag 만 있는 [HALAL] 은 인증이 아니다 (SAFETY-CRITICAL, .claude/rules/dietary-safety.md).
 *
 * 실제 모듈을 그대로 지난다(가짜 파이프라인 없음). 바꾸는 것은 _food_index.json 내용(합성 행)과 텔레그램뿐:
 *   신뢰 SSOT(dietary-trust) → 프롬프트 컨텍스트(_food_helper) → 프롬프트 원문(buildPrompt / geminiPipeline 재시도)
 *   → validateResponse → applyDBMatcher → Firestore 저장 모양(JSON 왕복).
 * 덮지 않는 구간(보고서에 명시): Gemini 호출·재시도 루프 자체, dietaryCoverageGate 종료 경로,
 *   dietaryStopReplacer 교체, finalItineraryGate, planPersister 의 실제 Firestore 쓰기, 프론트 렌더.
 */
import { describe, it, expect, vi } from 'vitest';
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
