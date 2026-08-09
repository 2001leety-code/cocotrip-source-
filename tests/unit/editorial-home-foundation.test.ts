/**
 * Korea Editorial Concierge — home + common shell design contract (2026-08-10).
 *
 * This file replaces `refined-ui-home-desktop.test.ts`, which pinned the
 * `.refined-home` cascade and App.tsx's `REFINED ? 'refined-home' : ''` fork.
 * Both are gone: the home no longer needs a corrective cascade because the
 * surface is built from the design tokens directly. Deleting the old test
 * without a replacement would have removed the regression guard along with the
 * thing it guarded, so the invariants move here in their new form.
 *
 * What is pinned, and why each one is worth a test:
 *   1. Four-language parity — the home dictionary is local (not locales/*.json),
 *      so `check:i18n` does not see it. Nothing else would catch a missing key.
 *   2. Figures on screen == figures in `api/_food_index.json`. The frontend
 *      cannot import that file (api/ and src/ never cross-import — the bundle
 *      would swallow a 3 MB index), so the number is duplicated and this test
 *      is the guard that keeps the two copies honest.
 *   3. No gradient surfaces, gradient text or glow shadows in the new tree.
 *   4. The deleted legacy CSS stays deleted.
 *   5. Every home city chip is a city the wizard actually knows.
 *   6. No invented rating, review count or countdown.
 *
 * Source-text assertions where a real import would drag in firebase/React —
 * the same firebase-free pattern the rest of tests/unit uses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HOME_COPY, HOME_CITIES, HOME_GUIDES, FOOD_DB, pickHomeCopy } from '../../src/sections/home/homeCopy';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const LANGS = ['en', 'ko', 'ja', 'zh'] as const;

/** Every .tsx in the home tree plus the shell files this PR reskinned. */
const HOME_FILES = readdirSync(path.join(ROOT, 'src/sections/home'))
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  .map((f) => `src/sections/home/${f}`);
const SHELL_FILES = [
  'src/sections/Header.tsx',
  'src/sections/Footer.tsx',
  'src/components/MobileBottomNav.tsx',
  'src/components/CookieBanner.tsx',
  'src/components/PromoBanner.tsx',
];

/** Structural key path list — value-independent, so translations can differ. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => keyPaths(v, `${prefix}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((k) => keyPaths((value as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe('홈 카피 — 4언어 parity', () => {
  it('ko/en/ja/zh 가 완전히 같은 키 구조를 갖는다 (배열 길이 포함)', () => {
    const reference = keyPaths(HOME_COPY.en);
    expect(reference.length).toBeGreaterThan(40); // guard against an empty reference
    for (const lang of LANGS) {
      expect(keyPaths(HOME_COPY[lang]), `${lang} diverged from en`).toEqual(reference);
    }
  });

  it('어떤 언어에도 빈 문자열이 없다', () => {
    for (const lang of LANGS) {
      const blanks = keyPaths(HOME_COPY[lang]).filter((p) => {
        const value = p
          .replace(/\[(\d+)\]/g, '.$1')
          .split('.')
          .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], HOME_COPY[lang]);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(blanks, `${lang} has blank copy`).toEqual([]);
    }
  });

  it('도시 칩 라벨이 4언어 전부 존재한다', () => {
    for (const city of HOME_CITIES) {
      for (const lang of LANGS) {
        expect(city.label[lang], `${city.key}.${lang}`).toBeTruthy();
      }
    }
  });

  it('pickHomeCopy 는 모르는 언어를 en 으로 폴백한다', () => {
    expect(pickHomeCopy('ko')).toBe(HOME_COPY.ko);
    expect(pickHomeCopy('de')).toBe(HOME_COPY.en);
    expect(pickHomeCopy('')).toBe(HOME_COPY.en);
  });
});

describe('식당 DB 수치 — 화면 숫자 ↔ 실제 JSON', () => {
  // Recomputed, not hard-coded twice: if someone regenerates the index with
  // scripts/build-food-index.js and the counts move, this fails and the copy
  // has to move with it.
  const index = JSON.parse(read('api/_food_index.json')) as { city?: string }[];

  it('FOOD_DB.restaurants == _food_index.json 레코드 수', () => {
    expect(Array.isArray(index)).toBe(true);
    expect(FOOD_DB.restaurants).toBe(index.length);
  });

  it('FOOD_DB.cities == distinct city 수', () => {
    const cities = new Set(index.map((r) => r.city).filter(Boolean));
    expect(FOOD_DB.cities).toBe(cities.size);
  });

  it('4언어 원장 숫자가 FOOD_DB 와 일치한다 (천단위 구분 무시)', () => {
    const digits = (s: string) => s.replace(/[^\d]/g, '');
    for (const lang of LANGS) {
      const items = HOME_COPY[lang].ledger.items;
      expect(digits(items[0].figure), `${lang} restaurants`).toBe(String(FOOD_DB.restaurants));
      expect(digits(items[1].figure), `${lang} cities`).toBe(String(FOOD_DB.cities));
    }
  });
});

describe('도시 칩 — 위저드가 아는 도시만', () => {
  it('HOME_CITIES 의 key 가 전부 CITY_CHIPS 에 있다', () => {
    // Source-text parse: importing data.tsx would pull lucide-react + React
    // into a node-environment test for five string literals.
    const src = read('src/components/WizardForm/data.tsx');
    const block = src.slice(src.indexOf('CITY_CHIPS'), src.indexOf('CITY_PHOTO'));
    const known = [...block.matchAll(/key:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(known.length).toBeGreaterThanOrEqual(5);
    for (const city of HOME_CITIES) {
      expect(known, `${city.key} is not a wizard city`).toContain(city.key);
    }
  });

  it('칩은 prefillRegions 딥링크를 만들고, PlannerPage 가 revision 밖에서도 그것을 읽는다', () => {
    expect(read('src/sections/home/EditorialHero.tsx')).toMatch(/\/planner\?prefillRegions=\$\{city\.key\}/);
    // The parameter used to be parsed only inside `revisionMode ? {...} : undefined`,
    // which made every chip a link to an empty wizard. Measured in the browser,
    // then fixed — this keeps it fixed.
    const planner = read('src/pages/PlannerPage/index.tsx');
    expect(planner).toMatch(/deepLinkRegions/);
    expect(planner).toMatch(/deepLinkRegions\.length\s*\?\s*\{\s*regions:\s*deepLinkRegions\s*\}/);
  });

  it('가이드 링크는 상대 /guide 경로다', () => {
    expect(HOME_GUIDES.length).toBeGreaterThanOrEqual(3);
    for (const g of HOME_GUIDES) expect(g.to.startsWith('/guide/')).toBe(true);
  });
});

describe('시각 언어 — 그라데이션·글로우 금지', () => {
  const FORBIDDEN: [RegExp, string][] = [
    [/bg-clip-text/, 'gradient text'],
    [/\bbg-gradient-to-/, 'tailwind gradient background'],
    [/linear-gradient|radial-gradient|conic-gradient/, 'CSS gradient'],
    [/shadow-glow/, 'glow shadow'],
    [/drop-shadow-\[/, 'arbitrary glow'],
  ];

  it('홈 트리와 공용 셸에 그라데이션 배경/글자·글로우가 없다', () => {
    const offences: string[] = [];
    for (const file of [...HOME_FILES, ...SHELL_FILES]) {
      // Comments are prose about the ban; only real code counts.
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const [re, label] of FORBIDDEN) {
        if (re.test(code)) offences.push(`${file}: ${label}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('editorial.css 토큰층에도 그라데이션이 없다 (로고 자산은 CSS 밖)', () => {
    const css = read('src/styles/editorial.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/linear-gradient|radial-gradient/);
  });

  it('한국어만 word-break: keep-all — ja/zh 에 걸면 한 문장이 통째로 안 쪼개진다', () => {
    // Measured at 390px: without keep-all the Korean headline split as
    // "알려주세 / 요." and body copy split 한 / 국. Scope matters as much as the
    // rule — ja/zh have no spaces, so keep-all there overflows the column.
    const css = read('src/styles/editorial.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.ec-root:lang\(ko\)\s*\{[^}]*word-break:\s*keep-all/);
    expect(css).not.toMatch(/:lang\((ja|zh)\)[^}]*keep-all/);
    // safety valve for a single unbreakable token (URL, email)
    expect(css).toMatch(/\.ec-root:lang\(ko\)\s*\{[^}]*overflow-wrap:\s*break-word/);
  });

  it('새 코드는 nullish 병합 연산자를 쓰지 않는다 (mojibake 가드 오탐 회피)', () => {
    // The operator is spelled with String.fromCharCode on purpose. The repo's
    // mojibake guard treats two literal ASCII question marks as a corrupted-text
    // signature, so a test that wrote the operator out would flag itself — the
    // same reason scripts/lint-mistake-patterns.mjs sits on the hook's allowlist.
    const NULLISH = new RegExp(String.fromCharCode(63, 63).replace(/./g, '\\$&'));
    for (const file of [...HOME_FILES, 'src/components/ui/states.tsx', 'src/styles/editorial.css']) {
      expect(read(file), `${file} uses the nullish coalescing operator`).not.toMatch(NULLISH);
    }
  });
});

describe('삭제한 legacy CSS 는 삭제된 채로 남는다', () => {
  // Comments in index.css deliberately mention these selectors ("do not bring
  // this back"), so strip comments before asserting — otherwise the tombstone
  // would fail the test that the tombstone exists for.
  const cssRules = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it.each([
    ['.refined-home', /\.refined-home/],
    ['.mobile-app-light-header', /\.mobile-app-light-header/],
    ['.mobile-menu-light', /\.mobile-menu-light/],
    ['.refined header [style*="box-shadow"]', /\.refined header \[style\*="box-shadow"\]/],
  ])('%s 규칙이 없다', (_name, re) => {
    expect(cssRules).not.toMatch(re);
  });

  it('되살리지 말라는 근거 주석은 남아 있다', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/refined-home/);              // only inside a comment now
    expect(css).toMatch(/mobile-app-light-header/);
  });

  it('아직 전환 안 된 페이지의 .refined-* 는 그대로 살아 있다', () => {
    // Deleting these together with the home cascade would have un-styled
    // planner/tours/charter/plandetail, which this PR does not touch.
    for (const sel of ['.refined-planner', '.refined-plandetail', '.refined-charter', '.refined-tours', '.refined-page']) {
      expect(cssRules).toContain(sel);
    }
  });

  it('main.tsx 는 editorial.css 를 index.css 앞에서 import 한다', () => {
    const main = read('src/main.tsx');
    expect(main.indexOf("'./styles/editorial.css'")).toBeGreaterThan(-1);
    expect(main.indexOf("'./styles/editorial.css'")).toBeLessThan(main.indexOf("'./index.css'"));
  });

  it('Fraunces 웹폰트는 REFINED_LEGACY 플래그 안에서만 주입된다', () => {
    // The flag was OFF in production and the font was fetched on every load
    // anyway. One mention, and it has to sit inside the guard.
    const main = read('src/main.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const guardStart = main.indexOf('if (REFINED_LEGACY)');
    expect(guardStart).toBeGreaterThan(-1);
    const guardEnd = main.indexOf('\n}', guardStart);
    expect(main.slice(guardStart, guardEnd)).toMatch(/Fraunces/);
    expect(main.match(/Fraunces/g)?.length, 'Fraunces referenced outside the guard').toBe(1);
  });
});

describe('근거 없는 주장 금지', () => {
  it('후기 섹션에 평점·후기 수 같은 숫자가 없다', () => {
    for (const lang of LANGS) {
      const c = HOME_COPY[lang].closing;
      for (const [key, value] of Object.entries({
        reviewsEyebrow: c.reviewsEyebrow,
        reviewsHeading: c.reviewsHeading,
        reviewsBody: c.reviewsBody,
        reviewsCta: c.reviewsCta,
      })) {
        expect(value, `${lang}.${key} contains a number`).not.toMatch(/\d/);
      }
      for (const item of c.trust) expect(item, `${lang} trust item`).not.toMatch(/\d/);
    }
  });

  it('한계 문장이 4언어 전부에 있다 (실시간 정보·알레르기 보증을 주장하지 않음)', () => {
    for (const lang of LANGS) {
      expect(HOME_COPY[lang].ledger.limits.length, lang).toBeGreaterThan(20);
    }
  });

  it('예시 일정에는 "예시" 배지가 붙는다', () => {
    for (const lang of LANGS) expect(HOME_COPY[lang].specimen.sampleBadge).toBeTruthy();
    expect(read('src/sections/home/ItinerarySpecimen.tsx')).toMatch(/c\.sampleBadge/);
  });

  it('홈 트리에 카운트다운/재고 같은 인위적 긴급성 문구가 없다', () => {
    const urgency = /(only \d+ left|hurry|last chance|마감 임박|선착순|残りわずめ|残りわずか|仅剩|限时)/i;
    for (const lang of LANGS) {
      expect(JSON.stringify(HOME_COPY[lang]), `${lang}`).not.toMatch(urgency);
    }
  });
});

describe('제품 명칭 — 구현이 아니라 능력으로 부른다', () => {
  it('공용 셸 nav 라벨 폴백이 "AI Planner" 가 아니다', () => {
    for (const file of ['src/sections/Header.tsx', 'src/sections/Footer.tsx', 'src/components/MobileBottomNav.tsx']) {
      expect(read(file), file).not.toMatch(/'AI Planner'|'AI 플래너'/);
    }
  });

  it('4언어 nav.planner 가 중립 명칭이다', () => {
    for (const lang of LANGS) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`)) as { nav: { planner: string } };
      expect(locale.nav.planner, lang).not.toMatch(/AI/i);
      expect(locale.nav.planner.trim().length, lang).toBeGreaterThan(1);
    }
  });

  it('홈 카피는 AI 를 전면에 내세우지 않는다', () => {
    for (const lang of LANGS) {
      expect(JSON.stringify(HOME_COPY[lang]), lang).not.toMatch(/\bAI\b/);
    }
  });
});
