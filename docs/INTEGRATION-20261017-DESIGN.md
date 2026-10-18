# Integration 2026-10-17 — customer page design alignment

Status: **implemented, visual verification pending.** Nothing here was rendered,
built or tested by the UI owner. The root runs fresh local screenshots and both
reviews after the offline guard. Historical screenshots were design inputs only.

## Reference (approved Home, `home-dope.css` v3 layer — read only, unchanged)

Page `#0a0b14`, raised `#11132a`, sunken `#0b1033`; CTA `#c9b8ff` / hover `#e4dbff`;
text white / 80% / 68%; ticket radius `10.8px`, line white 28% (`--ec-card-line`),
fill white 6%, no card shadow; CTA 48px, common 44px.

## Decisions

| Area | File | Selector(s) | Change | Why |
|---|---|---|---|---|
| A. Planner steps 3-5 plate | `src/styles/editorial-planner.css` | `.ec-planner:not(:has(.wizard-stage--dest)):has(.ec-steprail:is([aria-valuenow="3"],[aria-valuenow="4"],[aria-valuenow="5"])) .planner-workspace .planner-question` | radius 22px → `--ec-card-radius`; line → `--ec-card-line` (same 28% value); shadow → none | Outer frame matches Home ticket. Opaque `--ec-surface-raised` fill and `--ec-field-bg` fields kept; no 6% fill on forms. |
| A. Charter outer frames | `src/styles/editorial-charter-funnel.css` | `.charter-funnel-step-nav`, `.charter-funnel-step-panel`, `.charter-funnel-summary-panel` (under `.ec-night .ec-charter .charter-funnel-wizard`) | radius → `--ec-card-radius` (was Tailwind 16/30/28px); line 12% → `--ec-card-line` | Outer frame consistency only. Opaque fill and `box-shadow: none` kept. Receipts, rows, selectable cards, dashed tear lines untouched. |
| B. Recommended restaurants card | `RecommendedRestaurants.tsx` + `src/styles/plan-result-night.css` | `article` class → `plan-night-rec-card border p-3.5 transition-colors`; `.plan-result-night .plan-night-rec-card` | fill `--ec-card-bg`, line `--ec-card-line`, radius `--ec-card-radius`; hover (fine pointer only) neutral `--ec-option-line-hover` instead of purple | Outer card on Home material. Rating badge, cuisine chip, distance, map link, bucket/diet logic untouched. PDF uses its own HTML builder, not this component. |
| C. Tours catalogue card | `src/styles/editorial-tours-catalog.css` | `.tours-catalog-grid > .tour-catalog-card` (+ `.tour-catalog-card-media`, `-body`, `-link:focus-visible`) | raised navy fill, 1px `--ec-card-line`, `--ec-card-radius`, no shadow; photo top corners follow the frame; body gets inner padding (14/16/12, phones 12/14/10) | Scoped to the ToursPage grid. `TourCard` on `TourDetailPage` (related tours) unchanged. No `overflow: hidden` on the card, so focus ring and wishlist paint fully. 3:2 ratio, badges, price, season, columns, filters unchanged. |
| D. Shared tactile press | `src/styles/customer-night.css` | `.ec-night .ec-btn:where(:not([role='tab'], :is(…excluded scopes…) .ec-btn))` | 120ms colour/opacity/transform transition; `:active` 1px sink, not when `:disabled` / `aria-disabled`; reduced motion → no transform transition, no movement | Was absent for generic `.ec-btn`. Exclusions: `.home-dope` (Home + static pages), `.home-dope-chrome`, site `header.ec-no-print` / `footer.ec-no-print`, planner first/destination steps, tabs, PayPal hosts. Exclusion held at zero specificity, so plan-result phone press rules keep priority. No `App.tsx` edit needed. |

## Not changed (deliberately)

- Home, `home-dope.css`, `src/sections/home/*`, Header/Footer, locales, `App.tsx`.
- Planner first step and destination step; price note (radius 16px) left as is.
- `ArrivalGuide.tsx`: gradients are inline `style`, so a class cannot override them
  without `!important`. No clear same-gap fix → left for fresh visual review.
- Result mobile masthead (cloud ticket), route map frame, video, PDF.
- Tour detail page, support/static pages (need fresh visual review first).
- Fixed-bar overlap and WebKit loop-boundary freeze: not reproduced as bugs; no
  speculative fix, no forced play/seek/remount.

## Risks to check

- D needs `:where()`, complex `:not()` and `:has()`, and they don't all fail the
  same way. Without `:where()` or complex `:not()`, the whole rule is dropped
  (no press). The `:has()` entries, though, sit inside `:is(...)`, which takes a
  forgiving selector list. An engine that supports `:is()` but not `:has()` drops
  only `.ec-planner:has(.wizard-stage--dest)` and
  `.ec-planner:has(.wizard-res-ticket)` and keeps the other exclusions. The rule
  then still applies and **the planner first/destination-step exclusions are
  lost**, so those buttons get the transition and the 1px press. This is a
  correction to the earlier "drops entirely" note. The CSS is unchanged, and
  which browser versions are affected hasn't been checked.
- C: pressed photo still moves 1px inside the frame (existing rule), which may show
  a 1px navy line at the top while pressed.
- C: framed cards plus the existing 32px phone gap; check density.

## Repair cycle 1 — from the actual-capture review (implemented, runtime pending)

Evidence: Fable's review of the ~30 actual screenshots, plus Astra's source and
pixel checks. Only the four findings it confirmed are repaired here. Nothing was
rendered, built or tested by the UI owner; the root re-captures them.

| # | Finding (capture) | File | Change | Source cause |
|---|---|---|---|---|
| 1 | Planner 390 en, dates: calendar chevrons sit on the Sa header | `WizardStep2Details.tsx` (`DayPicker` `classNames`) | Each overridden key now starts with its own default class: `rdp-months`, `rdp-month_caption`, `rdp-weekday`, `rdp-button_previous`, `rdp-button_next`, `rdp-day_button`, `rdp-disabled`. Custom classes kept. | react-day-picker 9 merges `{ ...getDefaultClassNames(), ...props.classNames }` (shallow), so the custom strings replaced the `rdp-*` names. Without `rdp-month_caption` the caption lost `height: var(--rdp-nav-height)`, so the absolute `.rdp-nav` overlapped the weekday row. Key names checked against installed `dist/esm/UI.js` / `src/style.css` (read only). `rdp-disabled` adds only `opacity: var(--rdp-disabled-opacity)`, already `1` in `RDP_STYLE_VARS`. Restoring `rdp-day_button` also turns the library's range-endpoint fill back on (`--rdp-accent-color` = `--ec-brand`, default text white ≈ 1.8:1 on night `#c9b8ff`), so `--rdp-range_start-color` / `--rdp-range_end-color` → `var(--ec-button-primary-fg)` in `RDP_STYLE_VARS`. Restored `rdp-button_previous` / `rdp-button_next` also read the installed `--rdp-nav_button-height` / `-width` default `2.25rem` (36px), so `RDP_STYLE_VARS` now sets both explicitly to `44px` (day / day_button vars were already 44px; nav row `--rdp-nav-height` default `2.75rem` = 44px, kept). `disabled`/`mode`/selection/keyboard logic unchanged. |
| 2 | Planner 1440 ja, food step: masthead title breaks inside あなた | `editorial-planner.css` (≥1024px block) | `html:lang(ja) .ec-planner .planner-masthead .planner-title-sans { display: block; }` | The break now falls between the two existing `PlannerMasthead` spans. No `keep-all` / `nowrap`. `PlannerMasthead.tsx` and Home hero untouched. |
| 3 | Result 390 ja: WhatsApp CTA has an orphan ズ and left-aligned lines | `IntroSlide.tsx`, `plan-result-night.css` | Link gets `plan-intro-whatsapp`; label wrapped in `span.plan-intro-whatsapp-label` (`min-width: 0`, `text-align: center`, `text-wrap: balance`); icon `flex-shrink: 0` | The raw text was an anonymous flex item with start alignment. Text, `href`, `target`, `rel` and locales unchanged. |
| 4 | Desktop en, review step heading 19px vs 28px on other steps | `editorial-planner.css` (≥768px block) | `.ec-planner .planner-question .wizard-stage--review > h2.ec-question { font-size: 28px; line-height: 1.2; }` | `.planner-question .wizard-step-viewport h2` (19px, 0-3-1) beat `.wizard-stage > h2` (0-2-1); other steps' `div:first-child > h2` (0-3-2) won. New rule is 0-4-1. Phone stays 19px; shared `.ec-question` untouched. |
| 5 | Planner 360, dates (runs `2bf3230b`, `aee684d0`): month label's first glyph and the left of column 1 (zh selected 19) cut | `editorial-planner.css` (<390px block) | Kept: `.rdp-months` `safe center`, `.rdp-day` padding 0 (grid 308px, buttons 44×44), calendar `margin-inline: -8px`. Added: `.wizard-step-viewport:has(.wizard-stage--details)` `margin-inline: -8px; padding-inline: 8px`, so the clip box grows by 8px each side and the content stays put. 390/430 rules unchanged. | `.wizard-step-viewport { overflow-x: clip }` (`index.css`) is the clipping ancestor. Its padding box was 294px (x33–327), and the calendar's −8px margin put the panel at x25–335, so 8px a side was cut. The panel's own scroll matched (308 = 308), so the panel and card rects looked fine. Run `45713c24`: viewport clip x25–335, panel padding box x26–334, every month glyph, weekday, 31 day and 2 nav buttons inside, 44×44 visible, root overflow 0. |

Still to check at runtime: 1 at 390 and 1440 (two months), with selection and
disabled days; 2 at 1024 and 1440 ja (title fits the rail, other languages
unchanged); 3 at 360/390 ja/ko and wide widths; 4 at 768 and 1440 for every
language.

## Repair cycle 2 — three P2s from Fable's fresh pixels (implemented, measured, pixels pending)

| # | Finding | File | Change | Cause / measurement |
|---|---|---|---|---|
| A | Result 390 ja: the WhatsApp CTA breaks inside 旅程 (旅 / 程) | `IntroSlide.tsx`, `plan-result-night.css` | If the label contains `旅程` (not at index 0), it's split into two `span.plan-intro-whatsapp-chunk` (`display: inline-block`): `WhatsAppでこの` and `旅程をカスタマイズ`. Otherwise the label renders exactly as before. | A line break is allowed only between the chunks. An inline-block wider than the line still wraps inside, so it can't overflow. No `keep-all`/`nowrap`. Text, `href`, locales and other languages unchanged (zh `此行程` has no 旅程). |
| B | Charter payment 390 en: Destination value ellipsised | `editorial-charter-funnel.css` | Scoped to `.charter-funnel-payment .charter-funnel-payment-summary`: row `align-items: flex-start`; value `min-width: 0; max-width: 100%; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; text-align: right` (edit button right-aligned too). | Tailwind `truncate` on `Row`'s value. The total row is a separate element and unchanged. Measured: 390 en Destination is 2 lines (40px), clipped=false in all 4 cells. |
| C | Charter payment ≤768px: PayPal-blue button amount navy, KRW/VAT grey | `editorial-charter-funnel.css` | The initial book button (`.cocotrip-mobile-paypal > button:has(> .flex-col)`) gets `color: #fff !important`; `[class*="text-white/"]` inside it → `rgba(255,255,255,.82)`; `.line-through` → `.72` (strike kept); VAT last span → `#fff` (13px rule kept). | `index.css` `@media (max-width: 768px)` sets `:is(…, .cocotrip-mobile-paypal, …) [class*="text-white"] { color: #15143d !important }` and `[class*="text-white/"] { color: #756d96 !important }` (0-2-0 + !important), which beat the earlier non-important rule. The new rules are 0-5-1+ !important and scoped to the charter payment panel. Emerald promo amount, disabled opacity, background, handlers and amounts are untouched. Measured: 390/1440 ja/en amount and VAT `rgb(255,255,255)` on `rgb(0,112,186)` = 5.22:1, VAT 13px. |

Remaining limits: KRW secondary line 4.03:1 at 12px (below 4.5 for small text; unchanged size and copy, flagged for Fable). The promo state (strike + emerald `#6ee7b7` on blue ≈ 3.4:1, pre-existing) isn't captured. A is verified in source only (no DOM metric); 360/430 not captured in the pilot. Visual PASS awaits Fable's fresh pixels.

## Acceptance pending (root, under guard)

360 / 390 / 430 / 1024 / 1440 × ko / en / ja / zh; normal / selected / error /
loading / disabled / focus; no cut CTA, price or overflow; short normal and
reduced-motion videos for the press. Surfaces: planner steps 3-5, charter wizard
steps + summary, plan result (restaurants), `/tours` grid, plus a regression look
at Home, `/tours/:slug` related cards and the planner first/destination steps.
