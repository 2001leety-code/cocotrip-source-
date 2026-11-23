/**
 * plans/{planId}/translations/{lang} — the owner's translation cache.
 *
 * Static check of firestore.rules (same style as firestore-rules-pr420.test.ts):
 * the owner may write only the 4 app languages and exactly the fields
 * useAutoTranslate.ts writes. If the hook gains a field, or the rule loosens
 * back to a bare `allow write`, this fails before the change reaches main.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const rules = read('firestore.rules');
const hook = read('src/pages/PlanDetailPage/useAutoTranslate.ts');

function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`not found: ${marker}`);
  const open = source.indexOf('{', start + marker.length);
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(open, i);
}

const block = blockAfter(rules, 'match /translations/{lang}');
const listIn = (text: string, re: RegExp) => {
  const m = text.match(re);
  if (!m) throw new Error(`list not found: ${re}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
};

describe('translations cache rules', () => {
  it('has no bare allow write', () => {
    expect(block).not.toMatch(/allow\s+write\s*:/);
    expect(block).toMatch(/allow create, update:/);
    expect(block).toMatch(/allow delete:/);
  });

  it('allows only the 4 app languages (same as i18n Language)', () => {
    const langs = listIn(block, /lang in \[([^\]]+)\]/);
    const appLangs = listIn(read('src/i18n/index.ts'), /export type Language = ([^;]+);/);
    expect(langs).toEqual(['en', 'ja', 'ko', 'zh']);
    expect(langs).toEqual(appLangs);
  });

  it('hasOnly and hasAll match exactly the fields the hook writes', () => {
    const only = listIn(block, /hasOnly\(\[([^\]]+)\]\)/);
    const all = listIn(block, /hasAll\(\[([^\]]+)\]\)/);
    const write = hook.slice(hook.indexOf("setDoc(doc(db, 'plans', planId, 'translations', language), {"));
    const body = blockAfter(write, "'translations', language),");
    // `key: value,` or shorthand `key,`
    const hookKeys = [...body.matchAll(/^\s*(\w+)\s*[:,]/gm)].map(m => m[1]).sort();
    expect(hookKeys.length).toBe(5);
    expect(only).toEqual(hookKeys);
    expect(all).toEqual(hookKeys);
  });

  it('fingerprint pattern matches what translationSourceFingerprint returns', () => {
    const pattern = block.match(/sourceFingerprint\.matches\('([^']+)'\)/)?.[1];
    expect(pattern).toBeTruthy();
    const re = new RegExp(pattern as string);
    expect(re.test(`sha256:${'a1'.repeat(32)}`)).toBe(true);
    expect(re.test('sha256:short')).toBe(false);
    expect(re.test(`x${'a1'.repeat(32)}`)).toBe(false);
  });

  it('every write still requires the plan owner', () => {
    const owner = 'get(/databases/$(database)/documents/plans/$(planId)).data.uid == request.auth.uid';
    for (const rule of block.split(/allow /).slice(1)) expect(rule).toContain(owner);
  });
});
