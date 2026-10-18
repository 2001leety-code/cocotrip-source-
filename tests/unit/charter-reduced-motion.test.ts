// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import type { AtRule, Node as PostcssNode, Rule } from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';

// LOGICAL simulation only, not browser or pixel validation: the real customer-night.css is parsed with
// PostCSS, `:active` is rewritten to a data attribute so JSDOM can match selectors, and @media ancestors
// are evaluated against a {reduce, width} flag. getComputedStyle is deliberately never used.
type Env = { reduce: boolean; width: number };

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function findFile(dir: string, name: string): string | undefined {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (e.name === name) return p;
  }
  return undefined;
}

function loadRules(): Rule[] {
  const file = findFile(join(REPO, 'src'), 'customer-night.css');
  if (!file) throw new Error('customer-night.css not found under src/');
  const rules: Rule[] = [];
  postcss.parse(readFileSync(file, 'utf8')).walkRules((r) => {
    rules.push(r);
  });
  return rules;
}
const ALL_RULES = loadRules();

function mediaChain(rule: Rule): string[] {
  const out: string[] = [];
  for (let n: PostcssNode | undefined = rule.parent; n; n = n.parent) {
    if (n.type === 'atrule' && (n as AtRule).name === 'media') out.push((n as AtRule).params);
  }
  return out;
}

function mediaMatches(list: string, env: Env): boolean {
  return list.split(',').some((q) => {
    const rest = q.replace(/\([^)]*\)/g, '').replace(/\band\b/g, '').trim();
    if (rest && rest !== 'screen' && rest !== 'all') return false;
    return [...q.matchAll(/\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)/g)].every(([, feature, value]) => {
      if (feature === 'prefers-reduced-motion') return value === 'reduce' ? env.reduce : value === 'no-preference' ? !env.reduce : false;
      if (feature === 'min-width') return env.width >= parseFloat(value);
      if (feature === 'max-width') return env.width <= parseFloat(value);
      return false;
    });
  });
}

const simSelector = (sel: string) => sel.replace(/:active(?![\w-])/g, '[data-sim-active]');

function matchesSelector(el: Element, rule: Rule): boolean {
  return rule.selectors.some((sel) => {
    try {
      return el.matches(simSelector(sel));
    } catch {
      return false; // selectors JSDOM cannot parse (e.g. pseudo-elements) cannot target these fixtures
    }
  });
}

function matchingRules(el: Element, env: Env): Rule[] {
  return ALL_RULES.filter((r) => mediaChain(r).every((m) => mediaMatches(m, env)) && matchesSelector(el, r));
}

function transformOf(el: Element, env: Env): string | undefined {
  let value: string | undefined;
  for (const rule of matchingRules(el, env)) rule.walkDecls('transform', (d) => { value = d.value; });
  return value;
}

function mount(wrappers: string[], tag: string, cls: string, active: boolean): Element {
  let parent: Element = document.body;
  for (const w of wrappers) {
    const div = document.createElement('div');
    div.className = w;
    parent.appendChild(div);
    parent = div;
  }
  const el = document.createElement(tag);
  el.setAttribute('class', cls);
  if (active) el.setAttribute('data-sim-active', '');
  parent.appendChild(el);
  return el;
}

const targets = [
  { name: 'CharterPage legacy anchor', file: 'src/pages/CharterPage.tsx', tag: 'a', wrappers: ['customer-charter-legacy'], action: 'customer-charter-action', token: 'active:scale-95', wrongToken: 'active:scale-[0.99]', otherRoots: [['customer-tours'], ['customer-home'], ['ec-night', 'ec-charter']] },
  { name: 'CharterWizard funnel button', file: 'src/components/charter/CharterWizard.tsx', tag: 'button', wrappers: ['ec-night', 'ec-charter', 'charter-funnel-wizard'], action: 'charter-funnel-action', token: 'active:scale-[0.99]', wrongToken: 'active:scale-95', otherRoots: [['ec-night', 'ec-tours'], ['ec-night', 'ec-home'], ['ec-charter', 'charter-funnel-wizard'], ['customer-charter-legacy']] },
];
const widths = [390, 1440];

afterEach(() => {
  document.body.innerHTML = '';
});

describe.each(targets)('charter reduced-motion: $name', (t) => {
  const cls = `${t.action} ${t.token}`;

  it.each(widths)('active + reduce at %ipx resolves transform to none', (width) => {
    const el = mount(t.wrappers, t.tag, cls, true);
    expect(transformOf(el, { reduce: true, width })).toBe('none');
  });

  it.each(widths)('inactive or non-reduced at %ipx never applies transform:none', (width) => {
    const idle = mount(t.wrappers, t.tag, cls, false);
    expect(transformOf(idle, { reduce: true, width })).toBeUndefined();
    const active = mount(t.wrappers, t.tag, cls, true);
    expect(transformOf(active, { reduce: false, width })).toBeUndefined();
  });

  it('matching reduce rules are scoped to reduced motion and not width constrained', () => {
    const el = mount(t.wrappers, t.tag, cls, true);
    const hits = matchingRules(el, { reduce: true, width: 390 }).filter((r) => r.some((n) => n.type === 'decl' && n.prop === 'transform'));
    expect(hits.length).toBeGreaterThan(0);
    for (const r of hits) {
      const chain = mediaChain(r);
      expect(chain.some((m) => m.includes('prefers-reduced-motion: reduce'))).toBe(true);
      expect(chain.some((m) => /(min|max)-width/.test(m))).toBe(false);
    }
  });

  it.each(widths)('non-targets at %ipx are untouched', (width) => {
    const env = { reduce: true, width };
    for (const roots of t.otherRoots) {
      expect(transformOf(mount(roots, t.tag, cls, true), env)).toBeUndefined();
      document.body.innerHTML = '';
    }
    const bad = [`${t.action}-other ${t.token}`, t.action, `${t.action} ${t.wrongToken}`, `${t.action} active:scale-90`];
    for (const c of bad) {
      expect(transformOf(mount(t.wrappers, t.tag, c, true), env)).toBeUndefined();
      document.body.innerHTML = '';
    }
  });

  it('TSX source still carries the exact active token and action class on the native element', () => {
    const src = readFileSync(join(REPO, t.file), 'utf8');
    const re = /<(a|button)\b(?:(?!<[A-Za-z])[\s\S])*?className="([^"]*)"/g;
    const found = [...src.matchAll(re)].some(([, tag, classes]) => {
      const tokens = classes.split(/\s+/);
      return tag === t.tag && tokens.includes(t.action) && tokens.includes(t.token);
    });
    expect(found).toBe(true);
  });
});
