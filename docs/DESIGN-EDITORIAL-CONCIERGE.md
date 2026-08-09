# Korea Editorial Concierge — CocoTrip design foundation

> Status: **phase 1 (foundation + common shell + home)**. The planner, tours, charter,
> guide and community bodies still run on the previous dark system and are converted in
> a later PR. Read "Migration state" before assuming a page follows this document.

Code SSOT: `src/styles/editorial.css` (three token layers) and `tailwind.config.js`
(`ec-*` utilities). Hex values live in the CSS file — do not restate them in components,
and do not restate them here beyond the reference table below.

---

## 1. What this system is for

CocoTrip sells a specific, checkable thing: **we take the trip conditions a traveller
gives us and write a Korea itinerary they can actually execute** — real places, real
transit between them, real coordinates, restaurants filtered by their diet.

So the design's job is not to look intelligent. It is to look **accountable**. Every
screen should read like a well-set travel document produced by someone who knows Korea,
not like a product page for an AI feature.

**Mix:** Swiss Modernism 50% · Editorial Grid 30% · Trust & Authority 20%.

- **Swiss (50%)** — the grid is visible and obeyed. Few type sizes, decisive jumps,
  generous whitespace, hairlines instead of boxes, no ornament that carries no data.
- **Editorial (30%)** — asymmetric columns, eyebrows that name a real category, rules
  that separate real sections, a headline that makes a claim rather than a mood.
- **Trust (20%)** — licence numbers, counted data, sample output shown in full, plain
  prices. Restrained: authority comes from specifics, never from badge density.

---

## 2. Token architecture

Three layers, one direction of reference. **A component never reads a primitive.**

```
--ecp-*   primitive   raw value, no meaning      #5326d6
    ↓
--ec-*    semantic    role in the interface      --ec-brand: var(--ecp-violet-600)
    ↓
--ec-<component>-*    one component's knobs      --ec-button-primary-bg: var(--ec-brand)
```

Why: renaming or retuning a primitive must never require touching a component, and
changing what "brand" means must change every consumer at once. The previous system
failed on exactly this — raw hex was inlined in ~60 components, so every visual change
became a new `!important` cascade layered on top of the last one.

### Reference values

| Role | Token | Value | Measured contrast |
|---|---|---|---|
| Page ground | `--ec-surface-page` | `#F3F1EC` warm paper | — |
| Raised surface | `--ec-surface-raised` | `#FFFFFF` | — |
| Sunken band | `--ec-surface-sunken` | `#E9E5DC` | — |
| Body ink | `--ec-text-primary` | `#14141A` | 16.25:1 on paper |
| Secondary ink | `--ec-text-secondary` | `#4E4E59` | 7.27:1 on paper |
| Muted ink | `--ec-text-muted` | `#63636E` | 5.25:1 on paper |
| Faint ink | `--ec-text-faint` | `#7B7B86` | 3.71:1 — **≥24px or decorative only** |
| Hairline | `--ec-line` | `#DFDACF` | — |
| Brand / CTA | `--ec-brand` | `#5326D6` | 8.03:1 with white text |
| Brand hover | `--ec-brand-hover` | `#4B21C9` | 8.90:1 with white text |
| Success | `--ec-success` | `#1F6B4A` | 6.44:1 with white text |
| Critical | `--ec-critical` | `#B3261E` | 6.54:1 with white text |

Contrast numbers are computed from the hexes above, not estimated. If you change a
value, recompute — `--ec-text-faint` is already at the floor and must not carry body copy.

### Scales

- **Space** — 4px base: `4 8 12 16 24 32 48 64 96 128` (`--ecp-space-1..10`).
- **Radius** — `2 / 4 / 8 / 12` + `pill`. CTAs use `--ec-radius-sm` (4px).
  Pills are for chips and status only. A pill-shaped primary button is out.
- **Type** — `.ec-display` / `.ec-h2` / `.ec-h3` / `.ec-body` / `.ec-body-sm` /
  `.ec-eyebrow` / `.ec-figure`. All clamped, so 390px and 1440px share one scale.
  `.ec-figure` is tabular-numeric — numbers in a column must line up.
- **Elevation** — two shadows, both for things floating *over* content
  (`--ec-shadow-raise`, `--ec-shadow-overlay`). Cards get a hairline instead.
  **There is deliberately no glow token.**
- **Motion** — `--ec-duration-fast|base|slow` = 120/180/240ms with three easings.
  CSS transitions only.

---

## 3. Hard rules

**Removed from the visual language — do not reintroduce:**

| Banned | Instead |
|---|---|
| Page or section background gradients | `--ec-surface-page` / `-sunken` flat fills |
| Gradient text (`bg-clip-text`) | Ink, and weight/size for hierarchy |
| Glow shadows (`0 0 20px rgba(...)`) | A hairline, or `--ec-shadow-raise` if it truly floats |
| Glass cards (translucent + blur) | `--ec-surface-raised` + hairline |
| Pill-shaped primary CTAs | `--ec-radius-sm` |
| A row of identical cards | Modules differentiated by weight, media and column span |
| A new `.refined-*` / `!important` cascade | Change the token |
| `framer-motion` / Motion for new UI | CSS transitions on the duration tokens |
| `??` in new code | `||` — the repo's mojibake guard flags `??` (`npm run check:mojibake`) |

**Kept, and only here:** the logo gradient `#6633FC → #E03BAE`. It is brand identity and
it lives in the logo artwork (`public/icons/`), which the header and footer render as an
`<img>`. It is deliberately **not** published as a CSS custom property — a token nobody
reads is how a gradient ends up on a button six months from now. The token layer is
gradient-free, and `tests/unit/editorial-home-foundation.test.ts` asserts that.

**CJK line-breaking.** `.ec-root:lang(ko)` sets `word-break: keep-all` so Korean wraps at
word boundaries; without it Chrome splits Hangul between syllable blocks and a headline
comes out as `알려주세 / 요.` (measured at 390px). The rule is scoped to `:lang(ko)` on
purpose — Japanese and Chinese have no spaces, so `keep-all` there would make a whole
sentence one unbreakable token and push it past the viewport. `overflow-wrap: break-word`
rides along as the safety valve for a single long token.

**Required floor on every new surface:**

- Mobile-first. 390px is the design width, not an afterthought.
- Touch targets ≥ 44×44px (`--ec-touch-min`).
- Text inputs ≥ 16px (`--ec-field-size`) — below that iOS zooms the viewport on focus.
- Visible keyboard focus. `.ec-root` gives `:focus-visible` a ring automatically;
  do not remove it.
- `prefers-reduced-motion` honoured. The media query in `editorial.css` collapses the
  duration tokens, so anything that transitions on a token is covered for free.
- No horizontal overflow at 390 / 768 / 1440.
- Every user-facing string exists in ko / en / ja / zh.

---

## 4. Photography and product evidence

Real Korean photography and real product output are the decoration. Nothing else is.

- Use the existing brand assets in `public/` (`hero-seoul-real.webp`,
  `hero-busan-real.webp`, `hero-hanok-real.webp`, tour thumbnails).
  **Do not generate a new hero image or a new logo.**
- The strongest visual on the homepage is a real itinerary — timed stops, the actual
  transit leg between them, real coordinates — not an illustration of one.
- Photos carry a `1px` hairline or a flat crop, never a gradient scrim over the whole
  frame. If text must sit on a photo, put the text on paper next to it instead.

---

## 5. Copy rules

The product is **"you give us your trip conditions, we write the executable Korea
itinerary"**. "AI planner" is the mechanism, not the headline.

**Name the capability, not the implementation.** The nav entry is `nav.planner` in
`src/i18n/locales/*.json`: `Trip Planner` / `여행 플래너` / `旅行プランナー` / `行程规划`.
The route (`/planner`), the paid gate and the product itself are unchanged — this is
naming only. Two places still say "AI" and are **out of scope on purpose**:

- `PromoBanner` (`free 1–3 day AI plan … · limited`) is held byte-identical to
  `api/_shared/promo-config.js` by a parity test, and its wording is tied to a discount
  policy. Changing it means changing both files together — an operator/marketing call,
  not a design one. The `· limited` half is also unsupported urgency by the rule below.
- `pageMeta.planner` (`AI Travel Planner …`) is SEO metadata where the term is the search
  query people actually type.

Claims must be backed by code that exists. Verified at the time of writing:

| Claim you may make | Backed by |
|---|---|
| Korea restaurant database, 3,166 places across 25 cities | `api/_food_index.json` (array length + distinct `city`) |
| Allergen flags per restaurant (nuts / shellfish / gluten / dairy) | `allergens` object on every record |
| Halal and vegetarian/vegan filtering | `api/_ai_core/dietaryCoverageGate.js`, `dietaryStopReplacer.js` |
| Real public-transit leg between stops | `api/_transit_provider.js` → ODsay / TMAP, `_ai_core/agents/RouteAgent.js` |
| Real coordinates and a map link per stop | stop `lat`/`lng` through `routeEnrichment.js` |
| Intercity legs (KTX / SRT / ITX / bus / air) with booking links | `api/_ai_core/buildPrompt.js` intercity block |

**Not backed — do not claim:** live opening hours, real-time train seat availability,
live pricing, guaranteed dietary safety (`verified: true` in a plan means "this
restaurant exists in our database", nothing more — see `CLAUDE.md`), or any count of
customers, bookings or ratings that is not read from a real source.

Also banned: fake urgency ("3 seats left" without a live seat count), invented review
scores, countdowns that reset, and "trusted by N travellers" without N.

Voice: plain verbs, sentence case, active. Name what the traveller controls. An action
keeps the same word from button to confirmation.

---

## 6. Migration state

| Area | State |
|---|---|
| Tokens, `.ec-*` primitives, `ec-root` | this system |
| Header, mobile menu, bottom nav, footer, cookie banner | this system |
| Home (`/`), all breakpoints | this system |
| Loading / empty / error / done primitives (`src/components/ui/states.tsx`) | this system, not yet adopted by callers |
| Planner, tours, charter, guide, community, my-page, admin | previous dark system + `.refined-*` |

Because the shell is shared, a page still on the old system now shows a paper header
over a dark body. That is the intended transitional state, not a bug — mobile already
shipped a light header over dark bodies before this change. It resolves as each body is
converted.

`.refined-home` and the header's global `.refined` glow override were **deleted**, not
disabled: home no longer needs a corrective cascade because its base is correct. The
remaining `.refined-planner|tours|charter|plandetail|page` blocks in `src/index.css`
belong to pages this PR does not touch and are removed with those pages.

**One functional fix rode along with the visual work.** The home destination rail links to
`/planner?prefillRegions=<cityKey>`, but `PlannerPage` parsed every `prefill*` parameter
only inside `revisionMode ? {…} : undefined`. Without `revision=true` the deep link
resolved to nothing and the chip dropped the traveller on an empty city step — the one
question they had already answered. Outside revision the page now honours
`prefillRegions` alone; every other prefill parameter still belongs exclusively to the
revision flow. Verified in a browser: the chip opens the wizard on step 2/5 with Seoul
selected as the main base.

---

## 7. Checklist before merging a visual change

- [ ] No new hex in a component — a token, or a new token
- [ ] No gradient outside the logo, no glow, no glass
- [ ] Rendered and compared at 390 / 768 / 1440; no horizontal overflow
- [ ] Keyboard tab order reaches every control and the ring is visible
- [ ] `prefers-reduced-motion` checked
- [ ] ko / en / ja / zh all present and not truncated
- [ ] `npm run build` · `npm run test:unit` · `node scripts/lint-mistake-patterns.mjs origin/main`
- [ ] Console clean on the changed routes
