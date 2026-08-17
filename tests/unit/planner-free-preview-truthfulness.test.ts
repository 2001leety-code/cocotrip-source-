/**
 * The free preview → purchase transition has to own what it claims.
 *
 * Independent browser validation of PR #1275 found one cohesive defect with
 * four faces, all of them in the seam between "look at day one for nothing"
 * and "buy the rest":
 *
 *  0. **The paid panel promised the paid thing for free.** `PurchaseSection`
 *     renders `planner.fullPlanDesc`, and all four locales said the complete
 *     report is sent `100% free via email` — in the same panel that shows the
 *     regular price, the launch price and the charge. A traveller reading it
 *     top to bottom is told the deliverable costs money and is free.
 *  1. **The free action wore the paid costume.** The wizard's last step calls
 *     `/api/ai-planner-quick`, which is free and returns day one only, while
 *     the card above the button showed the full-plan price, said
 *     "Generate AI Itinerary", and closed with "Takes about 15 seconds after
 *     payment" — including while the free preview was loading.
 *  2. **The failure was off-screen.** After the quick endpoint failed its three
 *     attempts, the retry panel rendered *after* the SEO/FAQ body: measured at
 *     1280×720 the panel top was y=2752 with the reader at scrollY 1180, and at
 *     390×844 it was y=2682 at scrollY 1884. Neither reader could see that
 *     anything had failed.
 *  3. **The new controls were too small to hit.** Map links 45×19.5, step ticks
 *     18×44, the hint close 42×44 — all under the 44px floor the design system
 *     already declares as `--ec-touch-min`.
 *
 * Money semantics are deliberately untouched by the fix and by this file: price
 * still comes from `lib/aiPlannerPrice`, the server still verifies it, and
 * `tests/unit/ai-planner-price-parity.test.ts` still owns that contract. What
 * is locked here is what the traveller is *told*.
 *
 * Source assertions rather than a rendered tree, matching the repo's existing
 * design locks (`editorial-planner-journey`, `editorial-home-foundation`): the
 * files under test pull firebase, PayPal and leaflet, and the property being
 * checked is a property of the source. The one behaviour that is genuinely a
 * runtime contract — the error panel taking focus and scrolling itself into
 * view — is covered by `planner-error-panel.component.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/** Comments explain what was removed, so every ban below reads code only. */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');

const LOCALES = ['en', 'ko', 'ja', 'zh'] as const;
type Loc = (typeof LOCALES)[number];

const plannerDict = (l: string) =>
  (JSON.parse(read(`src/i18n/locales/${l}.json`)) as { planner: Record<string, unknown> }).planner;

const PAGE = read('src/pages/PlannerPage/index.tsx');
const REVIEW = read('src/components/WizardForm/WizardStep3Review.tsx');
const LOADING = read('src/pages/PlannerPage/components/TriviaLoadingAnimation.tsx');
const PURCHASE = read('src/pages/PlannerPage/components/PurchaseSection.tsx');
const PREVIEW_CARD = read('src/pages/PlannerPage/components/QuickPreviewCard.tsx');
const HINT = read('src/components/WizardForm/WizardStepHint.tsx');
const HANDLERS = read('src/pages/PlannerPage/hooks/usePlannerHandlers.ts');
const PLANNER_CSS = read('src/styles/editorial-planner.css');
const SHARED_CSS = read('src/styles/editorial.css');
const STATES = read('src/components/ui/states.tsx');

/** "This costs nothing" in each language, for strings that must not say it. */
const FREE_CLAIM = /100\s*%\s*(free|무료)|100\s*%\s*(無料|免费)|무료로\s*발송|完全無料|完全免费/i;
/** A price, in any of the forms this repo prints one. */
const PRICE_LITERAL = /\$\s?\d|₩\s?\d|\d+\.\d{2}/;

/* ── 0. The paid deliverable is never described as free ────────────────── */

describe('paid deliverable is never described as free', () => {
  it('planner.fullPlanDesc does not promise the charged report for nothing', () => {
    for (const l of LOCALES) {
      const s = plannerDict(l).fullPlanDesc as string;
      expect(typeof s, `${l}.planner.fullPlanDesc missing`).toBe('string');
      expect(`${l}: ${FREE_CLAIM.test(s)}`).toBe(`${l}: false`);
    }
  });

  it('planner.fullPlanDesc says the report arrives after the purchase', () => {
    const AFTER_PURCHASE: Record<Loc, RegExp> = {
      en: /after your purchase/i,
      ko: /결제 후/,
      ja: /ご購入後/,
      zh: /购买后/,
    };
    for (const l of LOCALES) {
      const s = plannerDict(l).fullPlanDesc as string;
      expect(`${l}: ${AFTER_PURCHASE[l].test(s)}`).toBe(`${l}: true`);
    }
  });

  it('planner.fullPlanDesc still leaves the amount to the price SSOT', () => {
    // The panel prints the figure from `lib/aiPlannerPrice` two blocks above.
    // A number typed into the copy is a second source that drifts silently.
    for (const l of LOCALES) {
      const s = plannerDict(l).fullPlanDesc as string;
      expect(`${l}: ${PRICE_LITERAL.test(s.replace(/3-page|3\s?페이지|3ページ|3\s?页/g, ''))}`).toBe(`${l}: false`);
    }
  });

  it('no other live planner string in any locale gives the full plan away', () => {
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(plannerDict(l))) {
        if (typeof v !== 'string') continue;
        expect(`${l}.${k}: ${FREE_CLAIM.test(v)}`).toBe(`${l}.${k}: false`);
      }
    }
  });

  it('the purchase panel keeps every money contract it had', () => {
    // Presentation changed; semantics did not. Guarded here as well as in
    // ai-planner-price-parity so a copy edit can never quietly reach them.
    expect(PURCHASE).toMatch(/expectedUSD=\{AI_PLANNER_FULL_USD\}/);
    expect(PURCHASE).toMatch(/priceKRW=\{AI_PLANNER_REFERENCE_KRW\}/);
    expect(PURCHASE).toMatch(/productType="ai-planner-full"/);
    expect(PURCHASE).toMatch(/aiPlanNoRefundNotice/);
    expect(PURCHASE).toMatch(/p\.fullPlanDesc/);
  });
});

/* ── 1. The wizard's final action is an explicitly free day-one preview ── */

describe('the wizard final action is a free day-one preview', () => {
  it('the pre-preview action card shows no price and no payment note', () => {
    const code = codeOf(REVIEW);
    expect(`price helper: ${/formatAiPlannerUsd|formatAiPlannerApproxKrw/.test(code)}`).toBe('price helper: false');
    expect(`price module: ${/aiPlannerPrice/.test(code)}`).toBe('price module: false');
    expect(`payment note: ${/wizardPaymentNote/.test(code)}`).toBe('payment note: false');
    expect(`paid plan label: ${/wizardAiPlan/.test(code)}`).toBe('paid plan label: false');
    expect(`paid generate label: ${/wizardGenerateBtn/.test(code)}`).toBe('paid generate label: false');
  });

  it('it reads its labels from the four-language planner copy', () => {
    expect(REVIEW).toMatch(/pickPlannerCopy/);
    for (const key of ['previewEyebrow', 'previewLede', 'previewCta', 'previewBusy', 'previewNote']) {
      expect(REVIEW, `WizardStep3Review uses wizard.${key}`).toMatch(new RegExp(`wizard\\.${key}`));
    }
  });

  it('every locale calls the action free and names no amount', async () => {
    const { PLANNER_COPY } = await import('../../src/pages/PlannerPage/plannerCopy');
    const FREE_WORD: Record<Loc, RegExp> = { en: /\bfree\b/i, ko: /무료/, ja: /無料/, zh: /免费/ };
    for (const l of LOCALES) {
      const w = PLANNER_COPY[l].wizard;
      expect(`${l} eyebrow free: ${FREE_WORD[l].test(w.previewEyebrow)}`).toBe(`${l} eyebrow free: true`);
      expect(`${l} cta free: ${FREE_WORD[l].test(w.previewCta)}`).toBe(`${l} cta free: true`);
      expect(`${l} busy free: ${FREE_WORD[l].test(w.previewBusy)}`).toBe(`${l} busy free: true`);
      for (const [name, s] of Object.entries({
        eyebrow: w.previewEyebrow, lede: w.previewLede, cta: w.previewCta,
        busy: w.previewBusy, note: w.previewNote,
      })) {
        expect(`${l}.${name} price: ${PRICE_LITERAL.test(s)}`).toBe(`${l}.${name} price: false`);
      }
    }
  });

  it('the rail names the step by what it produces, free', async () => {
    const WIZARD = read('src/components/WizardForm/index.tsx');
    expect(codeOf(WIZARD)).not.toMatch(/planner_generate_cta/);
    expect(WIZARD).toMatch(/c\.wizard\.previewStep/);
    const { PLANNER_COPY } = await import('../../src/pages/PlannerPage/plannerCopy');
    const FREE_WORD: Record<Loc, RegExp> = { en: /\bfree\b/i, ko: /무료/, ja: /無料/, zh: /免费/ };
    for (const l of LOCALES) {
      expect(`${l}: ${FREE_WORD[l].test(PLANNER_COPY[l].wizard.previewStep)}`).toBe(`${l}: true`);
    }
  });

  it('the note still admits the full itinerary is the paid step', async () => {
    const { PLANNER_COPY } = await import('../../src/pages/PlannerPage/plannerCopy');
    const PAID_STEP: Record<Loc, RegExp> = { en: /\bpaid\b/i, ko: /결제/, ja: /有料/, zh: /付费/ };
    for (const l of LOCALES) {
      expect(`${l}: ${PAID_STEP[l].test(PLANNER_COPY[l].wizard.previewNote)}`).toBe(`${l}: true`);
    }
  });

  it('the pricing disclosure above the brief keeps the real price', () => {
    const NOTE = read('src/pages/PlannerPage/components/AiPlannerPricingNote.tsx');
    expect(NOTE).toMatch(/formatAiPlannerUsd/);
    expect(NOTE).toMatch(/\{price\}/);
    expect(PAGE).toMatch(/<AiPlannerPricingNote/);
  });
});

/* ── 1b. Loading says which thing is being made ────────────────────────── */

describe('free-preview loading does not borrow the paid plan\'s promises', () => {
  it('the loading state has a preview mode with its own heading', () => {
    expect(LOADING).toMatch(/preview\?: boolean/);
    expect(LOADING).toMatch(/c\.loading\.previewEyebrow/);
    expect(LOADING).toMatch(/c\.loading\.previewHeading/);
  });

  it('preview mode drops the full-plan estimate and the agent counter', () => {
    // `timeLabel` is derived from durationDays for the paid pipeline; quoting
    // it over a day-one preview is a number nothing measured.
    expect(LOADING).toMatch(/!preview && [\s\S]{0,80}timeLabel/);
    expect(LOADING).toMatch(/!preview && streamStep/);
  });

  it('the page asks for preview mode on the free call and not on the paid one', () => {
    const quick = PAGE.match(/<TriviaLoadingAnimation[\s\S]*?\/>/)?.[0] || '';
    expect(`page preview flag: ${/\bpreview\b/.test(quick)}`).toBe('page preview flag: true');
    const paid = PURCHASE.match(/<TriviaLoadingAnimation[\s\S]*?\/>/)?.[0] || '';
    expect(`purchase preview flag: ${/\bpreview\b/.test(paid)}`).toBe('purchase preview flag: false');
  });

  it('every locale has the preview loading copy', async () => {
    const { PLANNER_COPY } = await import('../../src/pages/PlannerPage/plannerCopy');
    const FREE_WORD: Record<Loc, RegExp> = { en: /\bfree\b/i, ko: /무료/, ja: /無料/, zh: /免费/ };
    for (const l of LOCALES) {
      const load = PLANNER_COPY[l].loading;
      expect(`${l} eyebrow: ${FREE_WORD[l].test(load.previewEyebrow)}`).toBe(`${l} eyebrow: true`);
      expect(typeof load.previewHeading, `${l} previewHeading`).toBe('string');
      expect(load.previewHeading.length).toBeGreaterThan(4);
    }
  });

  it('the slow note stops offering an email the free preview never sends', async () => {
    const { PLANNER_COPY } = await import('../../src/pages/PlannerPage/plannerCopy');
    const EMAIL: Record<Loc, RegExp> = { en: /e-?mail/i, ko: /메일/, ja: /メール/, zh: /邮件/ };
    for (const l of LOCALES) {
      const load = PLANNER_COPY[l].loading;
      // The paid run is emailed and still says so; the free preview is not.
      expect(`${l} paid: ${EMAIL[l].test(load.slowNote)}`).toBe(`${l} paid: true`);
      expect(`${l} preview: ${EMAIL[l].test(load.previewSlowNote)}`).toBe(`${l} preview: false`);
    }
    expect(LOADING).toMatch(/preview \? c\.loading\.previewSlowNote : c\.loading\.slowNote/);
  });
});

/* ── 2. The failure is where the traveller already is ──────────────────── */

describe('the quick error panel sits with the wizard, not after the SEO body', () => {
  it('renders after the wizard and before the long SEO block', () => {
    const wizard = PAGE.indexOf('<WizardSeenProbe');
    const error = PAGE.indexOf('<PlannerErrorPanel');
    const seo = PAGE.indexOf('<PlannerSeoInfo');
    expect(wizard, 'wizard block not found').toBeGreaterThan(-1);
    expect(error, 'error panel not found').toBeGreaterThan(-1);
    expect(seo, 'SEO block not found').toBeGreaterThan(-1);
    expect(error).toBeGreaterThan(wizard);
    expect(error).toBeLessThan(seo);
  });

  it('the panel takes focus and scrolls itself in, motion preference honoured', () => {
    const PANEL = read('src/pages/PlannerPage/components/PlannerErrorPanel.tsx');
    const MOTION = read('src/lib/motion.ts');
    expect(PANEL).toMatch(/tabIndex=\{-1\}/);
    expect(PANEL).toMatch(/focusAndReveal/);
    // `scrollIntoView({ behavior: 'smooth' })` animates whatever the media
    // query says, so the preference has to be read in JS, not left to CSS.
    expect(MOTION).toMatch(/prefers-reduced-motion/);
    expect(MOTION).toMatch(/\.focus\(\{ preventScroll: true \}\)/);
    expect(MOTION).toMatch(/scrollIntoView/);
    expect(MOTION).toMatch(/'auto' : 'smooth'/);
    // The shared error state already announces itself; the panel must keep it.
    expect(PANEL).toMatch(/EcError/);
    expect(STATES).toMatch(/aria-live/);
  });

  it('the wizard stays mounted through the error, so the answers survive', () => {
    expect(PAGE).toMatch(/status === 'idle' \|\| status === 'error' \|\| status === 'loadingQuick'/);
    // Retry resets the request state only — it never clears the wizard's own
    // snapshot or remounts it.
    expect(codeOf(HANDLERS)).not.toMatch(/clearWizardSnapshot|clearPlannerWizardSnapshot/);
  });

  it('retry returns to the brief instead of throwing the page back to the top', () => {
    // Comment only — the hook explains what it stopped doing and why.
    expect(`handler scrolls to top: ${/window\.scrollTo\(\s*\{\s*top:\s*0/.test(codeOf(HANDLERS))}`)
      .toBe('handler scrolls to top: false');
    expect(PAGE).toMatch(/wizardRef/);
    expect(PAGE).toMatch(/handleRetry/);
  });
});

/* ── 3. Planner-only controls clear the 44px floor ─────────────────────── */

describe('planner-only controls clear the 44px touch floor', () => {
  it('the floor is a token, declared once', () => {
    expect(SHARED_CSS).toMatch(/--ec-touch-min:\s*44px/);
    expect(SHARED_CSS).toMatch(/--ec-button-height:\s*44px/);
  });

  it('a step tick is 44 wide as well as 44 tall', () => {
    const block = PLANNER_CSS.match(/\n\.ec-steptick \{[^}]*\}/)?.[0] || '';
    expect(block).toMatch(/min-height:\s*var\(--ec-touch-min\)/);
    expect(block).toMatch(/min-width:\s*var\(--ec-touch-min\)/);
  });

  it('the map link keeps its 13px type and still takes a 44px tap', () => {
    // Padding would push the timeline row open, so the hit area is a centred
    // pseudo-element: full size, 44px floor, zero layout cost.
    const after = PLANNER_CSS.match(/\.ec-maplink::after \{[^}]*\}/)?.[0] || '';
    expect(after, '.ec-maplink::after missing').not.toBe('');
    expect(after).toMatch(/min-width:\s*var\(--ec-touch-min\)/);
    expect(after).toMatch(/min-height:\s*var\(--ec-touch-min\)/);
    expect(PREVIEW_CARD).toMatch(/ec-maplink/);
  });

  it('the hint close control is 44 wide, and says so in the reader\'s language', () => {
    expect(HINT).toMatch(/min-w-\[44px\]/);
    expect(HINT).toMatch(/hintClose/);
    expect(`hardcoded english label: ${/aria-label="Close hint"/.test(HINT)}`).toBe('hardcoded english label: false');
  });

  it('the retry action is a full-height editorial button', () => {
    expect(STATES).toMatch(/ec-btn ec-btn-secondary/);
    const btn = SHARED_CSS.match(/\n\.ec-btn \{[^}]*\}/)?.[0] || '';
    expect(btn).toMatch(/min-height:\s*var\(--ec-button-height\)/);
  });
});

/* ── 4. The last wizard step describes the free action it triggers ─────── */

describe('the final wizard hint matches the button underneath it', () => {
  const hint4 = async () => {
    const { WIZARD_STEP_HINTS } = await import('../../src/components/WizardForm/stepHints');
    return WIZARD_STEP_HINTS[4].body;
  };

  it('quotes no turnaround time, because nothing measures one', async () => {
    const body = await hint4();
    const CLOCK = /\d+\s*(seconds?|secs?|minutes?|초|秒)/i;
    for (const l of LOCALES) expect(`${l}: ${CLOCK.test(body[l])}`).toBe(`${l}: false`);
  });

  it('stops telling the reader to press a Generate button', async () => {
    // The step's only action is `/api/ai-planner-quick`. Naming the paid verb
    // here is what made the free preview look like the purchase.
    const body = await hint4();
    const GENERATE: Record<Loc, RegExp> = { en: /\bgenerate\b/i, ko: /생성/, ja: /生成/, zh: /生成/ };
    for (const l of LOCALES) expect(`${l}: ${GENERATE[l].test(body[l])}`).toBe(`${l}: false`);
  });

  it('names the free day-one preview and says no card is involved', async () => {
    const body = await hint4();
    const FREE: Record<Loc, RegExp> = { en: /\bfree\b/i, ko: /무료/, ja: /無料/, zh: /免费/ };
    const DAY_ONE: Record<Loc, RegExp> = { en: /day[\s-]?one|day 1/i, ko: /1일차|첫날/, ja: /初日|1日目/, zh: /第一天|首日/ };
    const NO_CHARGE: Record<Loc, RegExp> = {
      en: /no (payment|card|charge)/i,
      ko: /(결제|카드)[^.]{0,14}(없|불필요|필요 없)/,
      ja: /(支払|カード)[^。]{0,14}(不要|いりません|必要ありません)/,
      zh: /(无需|不用|不需要)[^。]{0,12}(付款|付费|绑卡|银行卡)/,
    };
    for (const l of LOCALES) {
      expect(`${l} free: ${FREE[l].test(body[l])}`).toBe(`${l} free: true`);
      expect(`${l} day one: ${DAY_ONE[l].test(body[l])}`).toBe(`${l} day one: true`);
      expect(`${l} no charge: ${NO_CHARGE[l].test(body[l])}`).toBe(`${l} no charge: true`);
    }
  });

  it('leaves buying the full itinerary as a separate later decision', async () => {
    const body = await hint4();
    const FULL: Record<Loc, RegExp> = { en: /full itinerary/i, ko: /전체 일정/, ja: /全旅程/, zh: /完整行程/ };
    for (const l of LOCALES) {
      expect(`${l}: ${FULL[l].test(body[l])}`).toBe(`${l}: true`);
      expect(`${l} price: ${PRICE_LITERAL.test(body[l])}`).toBe(`${l} price: false`);
    }
  });

  it('en ties the purchase decision to having read day one, not an AI-translated aside', async () => {
    const body = await hint4();
    expect(body.en).toMatch(/after reading day[\s-]?one, you can decide whether to buy/i);
    expect(body.en).not.toMatch(/is a separate call, later/i);
  });
});

/* ── 4b. Two wizard labels that pointed at the wrong deliverable ───────── */

describe('the step-3 next label and the brief heading name the right thing', () => {
  it('planner.wizardNextGenerate points at the brief, not at generation', () => {
    const GENERATE: Record<Loc, RegExp> = { en: /generate/i, ko: /생성/, ja: /生成/, zh: /生成/ };
    const REVIEW: Record<Loc, RegExp> = { en: /review/i, ko: /확인|검토/, ja: /確認/, zh: /确认|核对/ };
    for (const l of LOCALES) {
      const s = plannerDict(l).wizardNextGenerate as string;
      expect(`${l} generate: ${GENERATE[l].test(s)}`).toBe(`${l} generate: false`);
      expect(`${l} review: ${REVIEW[l].test(s)}`).toBe(`${l} review: true`);
    }
  });

  it('planner.wizardWhatYouGet says the list is the paid full itinerary', () => {
    // Sitting directly above the free-preview button, "What You'll Get" read as
    // a promise about the button. The list is the purchase, so it says so.
    const FULL: Record<Loc, RegExp> = { en: /full itinerary/i, ko: /전체 일정/, ja: /全旅程/, zh: /完整行程/ };
    for (const l of LOCALES) {
      const s = plannerDict(l).wizardWhatYouGet as string;
      expect(`${l}: ${FULL[l].test(s)}`).toBe(`${l}: true`);
    }
  });

  it('both keys are still the live ones, fallbacks included', () => {
    const DETAILS = read('src/components/WizardForm/WizardStep2Details.tsx');
    expect(DETAILS).toMatch(/p\.wizardNextGenerate \|\| 'Next: Review'/);
    expect(REVIEW).toMatch(/p\.wizardWhatYouGet \|\| 'The full itinerary includes'/);
  });
});

/* ── 4c. The focused retry target lands below the sticky header ─────────── */

describe('focus targets clear the sticky header', () => {
  const HEADER = read('src/sections/Header.tsx');
  const PANEL = read('src/pages/PlannerPage/components/PlannerErrorPanel.tsx');

  it('the header this has to clear is 56px mobile, 64px desktop, plus a rule', () => {
    expect(HEADER).toMatch(/sticky top-0/);
    expect(HEADER).toMatch(/h-14 md:h-16/);
    expect(HEADER).toMatch(/border-b border-ec-line/);
  });

  it('neither scroll target still reserves 16px', () => {
    // `focusAndReveal` scrolls the element to the viewport top, so scroll-margin
    // is the only thing keeping it out from under a position:sticky header.
    // 16px cleared neither 57px nor 65px.
    for (const [name, src] of [['error panel', PANEL], ['wizard wrapper', PAGE]] as const) {
      expect(`${name}: ${/scroll-mt-4\b/.test(src)}`).toBe(`${name}: false`);
    }
  });

  it('both reserve 80px — the header plus a readable gap', () => {
    expect(PANEL).toMatch(/tabIndex=\{-1\} className="scroll-mt-20"/);
    expect(PAGE).toMatch(/ref=\{wizardRef\} tabIndex=\{-1\} className="scroll-mt-20"/);
  });
});

/* ── 5. House rules this commit must not break ─────────────────────────── */

describe('the follow-up stays inside the house rules', () => {
  const TOUCHED = [
    'src/components/WizardForm/stepHints.ts',
    'src/pages/PlannerPage/index.tsx',
    'src/pages/PlannerPage/plannerCopy.ts',
    'src/pages/PlannerPage/components/PlannerErrorPanel.tsx',
    'src/lib/motion.ts',
    'src/pages/PlannerPage/components/TriviaLoadingAnimation.tsx',
    'src/pages/PlannerPage/components/QuickPreviewCard.tsx',
    'src/pages/PlannerPage/hooks/usePlannerHandlers.ts',
    'src/components/WizardForm/WizardStep3Review.tsx',
    'src/components/WizardForm/WizardStepHint.tsx',
    'src/styles/editorial-planner.css',
  ];

  it('carries no nullish-coalescing operator, in code or in comment', () => {
    // The pre-commit mojibake guard flags the operator. Built from escapes so
    // this file does not trip the rule it enforces.
    const NULLISH = new RegExp('\\u003f\\u003f');
    for (const rel of TOUCHED) {
      expect(`${rel}: ${NULLISH.test(read(rel))}`).toBe(`${rel}: false`);
    }
  });

  it('introduces no animation dependency', () => {
    for (const rel of TOUCHED) {
      const src = read(rel);
      expect(`${rel}: ${/framer-motion|from 'motion/.test(src)}`).toBe(`${rel}: false`);
    }
  });

  it('keeps the Korea Editorial Concierge surface, not a generic AI dashboard', () => {
    for (const rel of TOUCHED) {
      const code = codeOf(read(rel));
      expect(`${rel} gradient: ${/linear-gradient|radial-gradient/.test(code)}`).toBe(`${rel} gradient: false`);
      expect(`${rel} glow: ${/0 0 \d+px rgba/.test(code)}`).toBe(`${rel} glow: false`);
      expect(`${rel} blur: ${/backdrop-blur|backdropFilter/.test(code)}`).toBe(`${rel} blur: false`);
      expect(`${rel} white ink: ${/text-white/.test(code)}`).toBe(`${rel} white ink: false`);
    }
  });
});
