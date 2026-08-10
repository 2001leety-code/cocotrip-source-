/**
 * Planner journey — Korea Editorial Concierge phase 2 regression lock.
 *
 * Two things this file exists to stop from coming back:
 *
 *  1. **Positioning drift.** The planner used to sell the mechanism: the mode
 *     card said "Let AI plan everything" / "AI가 전부 짜드려요", the intro modal
 *     was titled "Welcome to the AI Travel Planner", and the ready notification
 *     said "AI가 만든 코스를 확인하세요" to a Japanese reader. What we actually
 *     sell is: give us dates, cities, pace and dietary rules, get a Korea
 *     itinerary you can execute. The model stays in technical and legal context
 *     (loading phases, SEO metadata, terms) and off the marketing surfaces.
 *
 *  2. **Visual drift.** The planner body was dark with a `.planner-mobile-*`
 *     cascade of `!important` overrides correcting it back to light on mobile.
 *     Converting it means the page reads the editorial tokens, and the
 *     correction cascade is deleted rather than extended.
 *
 * Source assertions rather than a rendered tree, matching the repo's existing
 * design locks (`editorial-home-foundation`, `single-theme-no-fake-dark-1272`):
 * these files pull firebase, PayPal and leaflet, and the property under test is
 * a property of the source, not of one render.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/**
 * Comments are where this pass *explains* what it removed, so scanning raw text
 * for a banned pattern flags the explanation. Every ban below reads code only.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');

const PLANNER_PAGE = read('src/pages/PlannerPage/index.tsx');
const PLANNER_CSS = read('src/styles/editorial-planner.css');
const WIZARD = read('src/components/WizardForm/index.tsx');
const WIZARD_NAV = read('src/components/WizardForm/WizardNav.tsx');
const WIZARD_HINT = read('src/components/WizardForm/WizardStepHint.tsx');
const INTRO_MODAL = read('src/components/AIIntroModal.tsx');
const COUPON_MODAL = read('src/components/OnboardingCouponModal.tsx');
const LOADING = read('src/pages/PlannerPage/components/TriviaLoadingAnimation.tsx');
const PREVIEW = read('src/pages/PlannerPage/components/QuickPreviewCard.tsx');
const PURCHASE = read('src/pages/PlannerPage/components/PurchaseSection.tsx');
const PRICING_NOTE = read('src/pages/PlannerPage/components/AiPlannerPricingNote.tsx');
const INDEX_CSS = read('src/index.css');

const LOCALES = ['en', 'ko', 'ja', 'zh'] as const;
const locale = (l: string) =>
  JSON.parse(read(`src/i18n/locales/${l}.json`)) as Record<string, Record<string, unknown>>;

/** Every planner source file this pass owns. */
const PLANNER_SOURCES: [string, string][] = [
  ['PlannerPage/index.tsx', PLANNER_PAGE],
  ['WizardForm/index.tsx', WIZARD],
  ['WizardForm/WizardNav.tsx', WIZARD_NAV],
  ['WizardForm/WizardStepHint.tsx', WIZARD_HINT],
  ['AIIntroModal.tsx', INTRO_MODAL],
  ['TriviaLoadingAnimation.tsx', LOADING],
  ['QuickPreviewCard.tsx', PREVIEW],
  ['AiPlannerPricingNote.tsx', PRICING_NOTE],
];

/* ── 1. Positioning ────────────────────────────────────────────────────── */

describe('planner positioning — the capability is the headline, not the mechanism', () => {
  /** Marketing phrasings that put the mechanism in front of the traveller. */
  const BANNED_MARKETING = [
    /Let AI plan everything/i,
    /AI가 전부/,
    /AI 일정 만들기/,
    /AI Travel Planner/i,
    /AI itinerary/i,
    /AI가 만든/,
    /AIがすべて/,
    /AI帮你全部/,
    /AI旅程/,
    /AI行程规划/,
  ];

  it('no banned marketing phrasing survives in the planner sources', () => {
    for (const [name, src] of PLANNER_SOURCES) {
      const code = codeOf(src);
      for (const pattern of BANNED_MARKETING) {
        expect(`${name}: ${code.match(pattern)?.[0] || 'clean'}`).toBe(`${name}: clean`);
      }
    }
  });

  it('the mode cards name what the traveller gets, in all four languages', () => {
    const copy = read('src/pages/PlannerPage/plannerCopy.ts');
    for (const pattern of BANNED_MARKETING) {
      expect(copy).not.toMatch(pattern);
    }
    // The four inputs are the promise. Each language states all four.
    for (const l of LOCALES) {
      expect(copy).toMatch(new RegExp(`\\b${l}: \\{`));
    }
  });

  it('intro modal + ready notification are re-framed in every locale', () => {
    for (const l of LOCALES) {
      const p = locale(l).planner as Record<string, string>;
      for (const key of ['aiIntroTitle', 'aiIntroStep2Title', 'notifyPlanReadyBody']) {
        expect(typeof p[key], `${l}.planner.${key}`).toBe('string');
        for (const pattern of BANNED_MARKETING) {
          expect(`${l}.${key}: ${p[key].match(pattern)?.[0] || 'clean'}`).toBe(`${l}.${key}: clean`);
        }
      }
    }
  });

  it('keeps the mechanism where it is a technical or legal fact', () => {
    // SEO metadata is where people type "AI travel planner" — out of scope on
    // purpose (docs/DESIGN-EDITORIAL-CONCIERGE.md §5), and the loading phases
    // name the real engine as transparency, not as a sales line.
    expect((locale('en').pageMeta as Record<string, { title: string }>).planner.title).toMatch(/AI/i);
    expect((locale('en').planner as Record<string, string>).loading_step1).toMatch(/Gemini/i);
  });

  it('planner copy exists in four languages with the same shape', async () => {
    const { PLANNER_COPY } = await import('../../src/pages/PlannerPage/plannerCopy');
    const shape = (o: unknown): string =>
      o && typeof o === 'object' && !Array.isArray(o)
        ? `{${Object.keys(o as object).sort().map((k) => `${k}:${shape((o as Record<string, unknown>)[k])}`).join(',')}}`
        : Array.isArray(o)
          ? `[${(o as unknown[]).map(shape).join('|')}]`
          : typeof o;
    const en = shape(PLANNER_COPY.en);
    for (const l of LOCALES) expect(shape(PLANNER_COPY[l]), l).toBe(en);
    // Four inputs, named — this is the product promise, not decoration.
    for (const l of LOCALES) expect(PLANNER_COPY[l].masthead.inputs).toHaveLength(4);
  });

  it('does not print one language at readers of another', () => {
    // The old code shipped Korean string literals as the *fallback* for every
    // locale: an English reader whose plan had no narrative got
    // `여행 일정을 생성했습니다.`, and the ready notification said
    // `AI가 만든 코스를 확인하세요` in Japanese and Chinese too.
    expect(codeOf(PREVIEW)).not.toMatch(/여행 일정을 생성했습니다/);
    expect(codeOf(PLANNER_PAGE)).not.toMatch(/여행 일정이 준비됐어요|AI가 만든 코스/);
    // Both now read the four-language dictionary instead.
    expect(PLANNER_PAGE).toMatch(/c\.ready\.notifyTitle/);
    expect(PLANNER_PAGE).toMatch(/c\.ready\.notifyBody/);
    // The planner page renders no Korean literal at all — every string it shows
    // arrives from `plannerCopy` or the locale files.
    expect(codeOf(PLANNER_PAGE)).not.toMatch(/[가-힣]/);
  });
});

/* ── 2. Editorial conversion ───────────────────────────────────────────── */

describe('planner is converted to the editorial system', () => {
  it('the page renders on the editorial root, not a hardcoded dark canvas', () => {
    expect(PLANNER_PAGE).toMatch(/ec-root/);
    expect(PLANNER_PAGE).toMatch(/ec-planner/);
    expect(codeOf(PLANNER_PAGE)).not.toMatch(/#080b14/);
    expect(PLANNER_PAGE).toMatch(/editorial-planner\.css/);
  });

  it('the legacy correction cascade is deleted, not extended', () => {
    // `.refined-planner` and the mobile light-shell overrides existed only to
    // repaint a dark planner. A converted planner needs neither.
    expect(PLANNER_PAGE).not.toMatch(/refined-planner/);
    expect(PLANNER_PAGE).not.toMatch(/VITE_FEATURE_REFINED_UI/);
    expect(INDEX_CSS).not.toMatch(/\.refined-planner/);
    expect(INDEX_CSS).not.toMatch(/\.planner-mobile-ai/);
    expect(INDEX_CSS).not.toMatch(/\.planner-mobile-form/);
    // The bottom nav is fixed over the page, so the planner still reserves its
    // height — that was the one thing the deleted shell was doing that mattered.
    expect(PLANNER_CSS).toMatch(/safe-area-inset-bottom/);
  });

  it('no banned visual language in the converted sources', () => {
    for (const [name, src] of [...PLANNER_SOURCES, ['editorial-planner.css', PLANNER_CSS]] as [string, string][]) {
      const code = codeOf(src);
      expect(`${name} gradient: ${/linear-gradient|radial-gradient/.test(code)}`).toBe(`${name} gradient: false`);
      expect(`${name} gradient-text: ${/bg-clip-text/.test(code)}`).toBe(`${name} gradient-text: false`);
      expect(`${name} glow: ${/0 0 \d+px rgba/.test(code)}`).toBe(`${name} glow: false`);
      expect(`${name} backdrop-blur: ${/backdrop-blur|backdropFilter/.test(code)}`).toBe(`${name} backdrop-blur: false`);
    }
  });

  it('the files this pass authored carry no nullish-coalescing operator', () => {
    // `npm run check:mojibake` (and the pre-commit guard) flag the operator, so
    // new code uses `||`. Scoped to the files written here — the wizard
    // container predates the rule and rewriting its 18 existing uses is a
    // different change.
    //
    // The pattern is built from escapes rather than written literally: the same
    // guard scans this file, and a literal would make the test that enforces
    // the rule the one thing that breaks it.
    const NULLISH = new RegExp('\\u003f\\u003f');
    for (const rel of [
      'src/styles/editorial-planner.css',
      'src/pages/PlannerPage/plannerCopy.ts',
      'src/pages/PlannerPage/components/PlannerMasthead.tsx',
      'src/pages/PlannerPage/index.tsx',
      'src/pages/PlannerPage/components/TriviaLoadingAnimation.tsx',
      'src/pages/PlannerPage/components/QuickPreviewCard.tsx',
      'src/pages/PlannerPage/components/PurchaseSection.tsx',
      'src/components/AIIntroModal.tsx',
      'src/components/OnboardingCouponModal.tsx',
    ]) {
      expect(`${rel}: ${NULLISH.test(read(rel))}`).toBe(`${rel}: false`);
    }
  });

  it('an overridable colour is declared at zero specificity, so a caller wins', () => {
    // editorial-planner.css ships in the planner's async chunk, so it lands
    // after the eager Tailwind layer. At equal specificity the component class
    // wins every tie and `className="ec-error-note text-ec-notice"` silently
    // does nothing — which is exactly what happened: five informational notices
    // in WizardStep2Details rendered in critical red and the calendar's invalid
    // border never appeared. `:where()` contributes zero specificity and
    // inverts the tie.
    for (const cls of ['.ec-error-note', '.ec-option', '.ec-panel', '.ec-panel-quiet', '.ec-question', '.ec-help', '.ec-steptick', '.ec-timeline-time']) {
      expect(PLANNER_CSS, cls).toContain(`:where(${cls})`);
      // …and the normal-specificity block must not re-declare what it hands
      // over. That includes the `border` / `background` shorthands: `border:
      // 1px solid transparent` also sets border-color, and at (0,1,0) it beats
      // the `:where()` colour — measured, `.ec-panel`'s hairline came out
      // `rgba(0,0,0,0)` and the card lost its edge entirely.
      const block = PLANNER_CSS.match(new RegExp(`\\n\\${cls} \\{[^}]*\\}`))?.[0] || '';
      expect(`${cls} colour: ${/(^|[^-])color:/.test(block)}`).toBe(`${cls} colour: false`);
      expect(`${cls} border shorthand: ${/\n\s*border:/.test(block)}`).toBe(`${cls} border shorthand: false`);
      expect(`${cls} border-side shorthand: ${/\n\s*border-(top|right|bottom|left):/.test(block)}`).toBe(`${cls} border-side shorthand: false`);
      expect(`${cls} background shorthand: ${/\n\s*background:/.test(block)}`).toBe(`${cls} background shorthand: false`);
    }
  });

  it('no dark-system text colour survives on a paper surface', () => {
    // `text-white` on a converted page is invisible, and it is the single most
    // likely leftover from a class-by-class conversion.
    for (const rel of [
      'src/pages/PlannerPage/index.tsx',
      'src/pages/PlannerPage/components/PlannerMasthead.tsx',
      'src/pages/PlannerPage/components/QuickPreviewCard.tsx',
      'src/pages/PlannerPage/components/TriviaLoadingAnimation.tsx',
      'src/pages/PlannerPage/components/PurchaseSection.tsx',
      'src/pages/PlannerPage/components/AiPlannerPricingNote.tsx',
      'src/pages/PlannerPage/components/CourseBuilderShell.tsx',
      'src/pages/PlannerPage/components/PlannerSeoInfo.tsx',
      'src/components/WizardForm/index.tsx',
      'src/components/WizardForm/WizardNav.tsx',
      'src/components/WizardForm/WizardStepHint.tsx',
      'src/components/WizardForm/WizardStep0Reservation.tsx',
      'src/components/WizardForm/WizardStep0Destination.tsx',
      'src/components/WizardForm/WizardStep1Food.tsx',
      'src/components/WizardForm/WizardStep2Details.tsx',
      'src/components/WizardForm/WizardStep3Review.tsx',
      'src/components/WizardForm/ZoneRecommender.tsx',
      'src/components/WizardForm/HotelSuggestInput.tsx',
      'src/components/AIIntroModal.tsx',
      'src/components/OnboardingCouponModal.tsx',
      'src/components/MobileSelectDrawer.tsx',
    ]) {
      expect(`${rel}: ${/text-white/.test(codeOf(read(rel)))}`).toBe(`${rel}: false`);
    }
  });

  it('the planner stylesheet stays inside the token layers', () => {
    // No raw hex, and no raw durations — reduced-motion is honoured for free
    // only while every transition rides a duration token.
    const css = codeOf(PLANNER_CSS);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const durations = css.match(/transition:[^;]+;/g) || [];
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(d).toMatch(/var\(--ec-duration-/);
    expect(css).not.toMatch(/!important/);
    // Touch and field floors are declared once, here.
    expect(css).toMatch(/min-height:\s*var\(--ec-touch-min\)/);
  });

  it('no animation library is introduced and step visibility never waits on one', () => {
    for (const [name, src] of PLANNER_SOURCES) {
      const imports = src.match(/^import[\s\S]*?from '[^']+';$/gm)?.join('\n') || '';
      expect(`${name}: ${/framer-motion|from 'motion/.test(imports)}`).toBe(`${name}: false`);
      expect(`${name} AnimatePresence: ${/<AnimatePresence/.test(src)}`).toBe(`${name} AnimatePresence: false`);
    }
    expect(codeOf(WIZARD)).not.toMatch(/mode=["']wait["']/);
  });
});

/* ── 3. Journey states ─────────────────────────────────────────────────── */

describe('planner journey states', () => {
  it('the wizard announces where the traveller is', () => {
    expect(WIZARD).toMatch(/aria-current=\{[^}]*'step'/);
    expect(WIZARD).toMatch(/ec-steprail/);
    // A visible "step n of total" label, from copy, in four languages.
    expect(WIZARD).toMatch(/formatStepOf|stepOf/);
  });

  it('errors are recoverable and announced, not a red box that dead-ends', () => {
    expect(PLANNER_PAGE).toMatch(/EcError/);
    expect(PLANNER_PAGE).toMatch(/onRetry/);
    // The retry hint tells the traveller nothing was charged.
    expect(PLANNER_PAGE).toMatch(/retryHint/);
  });

  it('loading is a live region, names the wait, and admits when it runs long', () => {
    expect(LOADING).toMatch(/aria-live/);
    expect(LOADING).toMatch(/role="status"/);
    expect(LOADING).toMatch(/slowNote/);
  });

  it('the preview falls back in the reader\'s own language', () => {
    expect(PREVIEW).toMatch(/narrativeFallback/);
    expect(PREVIEW).toMatch(/pickPlannerCopy/);
  });

  it('the two modals are dialogs a keyboard can leave', () => {
    for (const [name, src] of [['AIIntroModal', INTRO_MODAL], ['OnboardingCouponModal', COUPON_MODAL]] as [string, string][]) {
      expect(`${name} role: ${/role="dialog"/.test(src)}`).toBe(`${name} role: true`);
      expect(`${name} modal: ${/aria-modal/.test(src)}`).toBe(`${name} modal: true`);
      expect(`${name} escape: ${/Escape/.test(src)}`).toBe(`${name} escape: true`);
      expect(`${name} labelled: ${/aria-labelledby/.test(src)}`).toBe(`${name} labelled: true`);
    }
  });
});

/* ── 4. Money is untouched ─────────────────────────────────────────────── */

describe('purchase area — visual only, money semantics preserved', () => {
  it('price still comes from the SSOT and the server still checks it', () => {
    expect(PURCHASE).toMatch(/from '@\/lib\/aiPlannerPrice'/);
    expect(PURCHASE).toMatch(/expectedUSD=\{AI_PLANNER_FULL_USD\}/);
    expect(PURCHASE).toMatch(/priceKRW=\{AI_PLANNER_REFERENCE_KRW\}/);
    expect(PURCHASE).toMatch(/productType="ai-planner-full"/);
    // No price literal may be typed into the component.
    expect(PURCHASE).not.toMatch(/\$\s?\d+\.\d{2}/);
  });

  it('the payment gate, the coupon path and the refund notice all survive', () => {
    expect(PURCHASE).toMatch(/guestCheckoutEnabled/);
    expect(PURCHASE).toMatch(/!user && !guestCheckoutEnabled/);
    expect(PURCHASE).toMatch(/couponApplied/);
    expect(PURCHASE).toMatch(/onPaymentSuccess\('', aiCoupon\.code\)/);
    expect(PURCHASE).toMatch(/aiPlanNoRefundNotice/);
    expect(PURCHASE).toMatch(/isSending/);
  });

  it('the welcome coupon modal still states the coupons that are actually issued', () => {
    for (const key of ['welcomeModalCoupon0', 'welcomeModalCoupon1', 'welcomeModalCoupon2', 'welcomeModalExpiry']) {
      expect(COUPON_MODAL).toMatch(new RegExp(key));
    }
    expect(COUPON_MODAL).toMatch(/5%/);
  });

  it('the free / coupon / paid split is still stated before the brief', () => {
    expect(PRICING_NOTE).toMatch(/formatAiPlannerUsd/);
    expect(PRICING_NOTE).toMatch(/formatAiPlannerApproxKrw/);
    expect(PRICING_NOTE).toMatch(/\{price\}/);
  });
});
