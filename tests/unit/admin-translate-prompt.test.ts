/**
 * Coverage for api/admin-translate.js — Phase 5 (2026-05-20) source-aware
 * translation prompt builder + body resolver.
 *
 * Verifies:
 *   1. resolveSourceAndTargets accepts Phase 5 body shape (source object).
 *   2. resolveSourceAndTargets accepts legacy body shape (korean field).
 *   3. self-target lang is always stripped from targets.
 *   4. invalid bodies surface as null source (handler emits 400).
 *   5. buildPrompt embeds source.lang label + only emits requested targets.
 *   6. buildPrompt JSON example reflects actual target list (helps Gemini stay
 *      on-schema when ja/zh are excluded).
 */
import { describe, it, expect } from 'vitest';
import { buildPrompt, resolveSourceAndTargets, ALL_LANGS } from '../../api/admin-translate.js';

describe('resolveSourceAndTargets — Phase 5 body shape', () => {
  it('accepts { source: { lang, text }, targets } and strips self-target', () => {
    const r = resolveSourceAndTargets({
      source: { lang: 'en', text: 'Royal Palace Tour' },
      targets: ['ko', 'ja', 'zh', 'en'],
    });
    expect(r.source).toEqual({ lang: 'en', text: 'Royal Palace Tour' });
    expect(r.targets).toEqual(['ko', 'ja', 'zh']);
    expect(r.targets).not.toContain('en');
  });

  it('defaults targets to ALL_LANGS minus source.lang when omitted', () => {
    const r = resolveSourceAndTargets({ source: { lang: 'ja', text: '景福宮ツアー' } });
    expect(r.targets.sort()).toEqual(['en', 'ko', 'zh']);
  });

  it('trims whitespace on source.text', () => {
    const r = resolveSourceAndTargets({ source: { lang: 'ko', text: '  경복궁 투어  ' } });
    expect(r.source).toEqual({ lang: 'ko', text: '경복궁 투어' });
  });

  it('filters invalid lang codes from requested targets', () => {
    const r = resolveSourceAndTargets({
      source: { lang: 'ko', text: '안녕' },
      targets: ['en', 'fr', 'invalid', 'ja'],
    });
    expect(r.targets).toEqual(['en', 'ja']);
  });
});

describe('resolveSourceAndTargets — legacy backward compat', () => {
  it('legacy { korean: ... } body resolves to source.lang=ko', () => {
    const r = resolveSourceAndTargets({ korean: '한국 텍스트' });
    expect(r.source).toEqual({ lang: 'ko', text: '한국 텍스트' });
    // legacy default: 3-target (en/ja/zh); ko self-stripped.
    expect(r.targets.sort()).toEqual(['en', 'ja', 'zh']);
  });

  it('legacy + explicit targets', () => {
    const r = resolveSourceAndTargets({ korean: '안녕', targets: ['en'] });
    expect(r.targets).toEqual(['en']);
  });
});

describe('resolveSourceAndTargets — invalid bodies → null source', () => {
  it.each([
    {},
    { source: {} },
    { source: { lang: 'ko' } },           // missing text
    { source: { lang: 'ko', text: '' } }, // empty text
    { source: { lang: 'fr', text: 'x' } }, // unsupported lang
    { korean: '' },                       // empty legacy
    { korean: '   ' },                    // whitespace-only legacy
  ])('rejects malformed body %j', (body) => {
    const r = resolveSourceAndTargets(body as any);
    expect(r.source).toBeNull();
  });

  it('Phase 5 body takes precedence over legacy korean field when both present', () => {
    // Defensive: client sending both shouldn't double-translate. source wins.
    const r = resolveSourceAndTargets({
      source: { lang: 'en', text: 'Royal Palace' },
      korean: '경복궁',
    } as any);
    expect(r.source).toEqual({ lang: 'en', text: 'Royal Palace' });
  });
});

describe('buildPrompt — source-aware prompt construction', () => {
  it('embeds source.lang label (English)', () => {
    const p = buildPrompt({ lang: 'en', text: 'Royal Palace Tour' }, ['ko', 'ja', 'zh']);
    expect(p).toContain('Source (English):');
    expect(p).toContain('Royal Palace Tour');
  });

  it('embeds source.lang label (Korean)', () => {
    const p = buildPrompt({ lang: 'ko', text: '경복궁 투어' }, ['en']);
    expect(p).toContain('Source (Korean');
    expect(p).toContain('경복궁 투어');
  });

  it('embeds source.lang label (Japanese)', () => {
    const p = buildPrompt({ lang: 'ja', text: '景福宮ツアー' }, ['ko', 'en']);
    expect(p).toContain('Source (Japanese');
    expect(p).toContain('景福宮ツアー');
  });

  it('embeds source.lang label (Simplified Chinese)', () => {
    const p = buildPrompt({ lang: 'zh', text: '景福宫之旅' }, ['ko', 'en']);
    expect(p).toContain('Source (Simplified Chinese');
    expect(p).toContain('景福宫之旅');
  });

  it('lists only requested targets in Targets: line', () => {
    const p = buildPrompt({ lang: 'en', text: 'x' }, ['ko']);
    expect(p).toContain('Targets: "ko"');
    expect(p).not.toContain('"ja"');
    expect(p).not.toContain('"zh"');
  });

  it('self-target lang is filtered from output even if passed', () => {
    // Defense in depth — resolveSourceAndTargets already strips, but buildPrompt
    // re-filters too (so direct callers don\'t accidentally emit { en: ... }
    // when source is en).
    const p = buildPrompt({ lang: 'en', text: 'x' }, ['ko', 'en', 'ja']);
    expect(p).toContain('"ko"');
    expect(p).toContain('"ja"');
    // The Targets list should not name English as a target alongside its own source.
    const targetsLine = p.split('\n').find((l) => l.startsWith('Targets:'));
    expect(targetsLine).not.toMatch(/"en":\s*English/);
  });

  it('JSON example reflects actual target list (helps Gemini stay on-schema)', () => {
    const pOne = buildPrompt({ lang: 'en', text: 'x' }, ['ko']);
    expect(pOne).toContain('{"ko":"..."}');
    // 3-target case
    const pThree = buildPrompt({ lang: 'en', text: 'x' }, ['ko', 'ja', 'zh']);
    expect(pThree).toContain('{"ko":"...","ja":"...","zh":"..."}');
  });

  it('context line appears when context provided', () => {
    const p = buildPrompt({ lang: 'ko', text: 'x' }, ['en'], '투어 제목');
    expect(p).toContain('Context: This is the 투어 제목');
  });

  it('omits context line when context absent', () => {
    const p = buildPrompt({ lang: 'ko', text: 'x' }, ['en']);
    expect(p).not.toContain('Context: This is the');
  });
});

describe('ALL_LANGS export — schema canonical set', () => {
  it('exposes 4 canonical lang codes', () => {
    expect(ALL_LANGS).toEqual(['ko', 'en', 'ja', 'zh']);
  });
});
