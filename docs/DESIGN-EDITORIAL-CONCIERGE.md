# Korea Editorial Concierge — CocoTrip design foundation

> Status: **phase 2 (foundation + common shell + home + planner + tour detail + community + shared course + region detail + not-found)**.
> The tours catalogue, charter, guide, my-page and admin bodies still run on the previous
> dark system and are converted in later PRs. Public `/tours/:slug`, `/community`,
> `/community/post/:id`, `/community/new`, `/s/:id`, `/region/:regionId` and both 404 surfaces now follow this document. Read "Migration state" before assuming a page
> follows this document.

Code SSOT: `src/styles/editorial.css` (three token layers) and `tailwind.config.js`
(`ec-*` utilities), plus `src/styles/editorial-planner.css` for the planner's own layer-3
component tokens. Hex values live in the CSS files — do not restate them in components,
and do not restate them here beyond the reference table below.
`src/styles/editorial-community.css` is the route-scoped migration layer for the public
community body; it does not style the moderation app.
`src/styles/editorial-shared-course.css` is the route-scoped read-only document layer for
public shared courses; it does not change course creation or storage.
`src/styles/editorial-region.css` is the route-scoped public region layer; it keeps the
existing region facts, product-derived tour details and links while replacing the split
mobile/desktop skins with one responsive document.
`src/lib/notFoundEditorial.js` is the shared copy, language and self-contained visual contract
for both the real server 404 and the in-app catch-all page. It is the one deliberate CSS-string
exception: a real error response must render correctly without depending on the app bundle or
a second asset request.

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
naming only. One place still says "AI" and is **kept on purpose**:

- `planner.loading_step1..4` names the real engine while it runs. That is transparency
  about mechanism, and it appears only once the traveller has already committed.

2026-08-10 phase 2: the planner's own surfaces were re-framed. The mode card said
`Let AI plan everything` / `AI가 전부 짜드려요`, the intro modal was titled
`Welcome to the AI Travel Planner`, and the ready notification told a Japanese reader
`AI가 만든 코스를 확인하세요` — Korean, to every locale, because the fallback was a
literal. All of it now leads with what the traveller gets: **four answers — dates,
cities, pace, diet — become a Korea itinerary they can execute.**
`tests/unit/editorial-planner-journey.test.ts` fails if any of it returns, and the same
file pins the exception above so "keep it out of marketing" never turns into
"delete the transparency".

2026-08-10 P2 (#1272): `PromoBanner` (`free 1–3 day AI plan … · limited`) used to be the
other exception — it said "AI plan" and appended `· limited`/`· 선착순` even when
`endDate` was empty. Both were fixed: the banner now says "Korea itinerary" in all four
languages, and the urgency tail (`urgency()` in `PromoBanner.tsx`) renders nothing unless
a real `endDate` is set. `api/_shared/promo-config.js` stays byte-identical to the front
constant; its `getPromoConfig` normalizes a Firestore `admin_config/promo_banner` doc to
the new copy only when a language's stored value exactly matches the pre-2026-08-10
default (`LEGACY_DEFAULT_PROMO_COPY`) — an operator's own custom wording is left alone.

2026-08-11: the phase-2 pass above re-framed the planner's *own* components but not
the strings the wizard prints, and those were still casting the model as the party
doing the work — `AI will suggest accommodations`, `AI가 그 근처를 거점으로 일정을
짭니다`, `AIがプランを完成できませんでした`, `只需要AI行程`. Ten keys across
`planner.errors.GEMINI_*`, the reservation quadrants, the accommodation opt-in, the
zone recommender and the value banner now name the itinerary instead, in all four
languages **and** in the English literals the components fall back to. Three related
fixes rode along: `planner.wizardNoAnchorHint` existed in no locale at all, so ko / ja
/ zh readers got the component's English literal; `pageMeta.planner.description` and
`PlannerSeoInfo`'s `keepIntro` sold themselves by comparison to AI itineraries and now
lead with Korean transit and restaurant data against the traveller's own dates, cities,
pace and diet; and `pageMeta.planner.title` dropped "AI" too — it now names Korea, local
data and a custom itinerary, same as the rest of the copy. `tests/unit/editorial-planner-journey.test.ts`
§5 pins all of it, including fallback-to-`en.json` parity so a literal cannot drift back
on its own.

Claims must be backed by code that exists. Verified at the time of writing:

| Claim you may make | Backed by |
|---|---|
| Korea restaurant database, 3,166 places across 25 cities | `api/_food_index.json` (array length + distinct `city`) |
| Allergen flags per restaurant (nuts / shellfish / gluten / dairy) | `allergens` object on every record |
| A cuisine type on nearly all restaurants — not claimed on all 3,166 | `cuisine` field is present on 3,153 of 3,166 records |
| Halal and vegetarian/vegan filtering | `api/_ai_core/dietaryCoverageGate.js`, `dietaryStopReplacer.js` |
| A transit leg between stops, measured where the lookup succeeds and marked as an estimate where it does not | `api/_transit_provider.js` → ODsay / TMAP first; `_ai_core/agents/RouteAgent.js` falls back to `naver_fallback` / `blind_25_no_coords` / haversine when a lookup fails or a coordinate is missing, and `shouldShowFallbackWarning` in `PlanDetailPage/components/TransitArrow.tsx` labels those legs on screen |
| Real coordinates and a map link per stop | stop `lat`/`lng` through `routeEnrichment.js` |
| Intercity legs (KTX / SRT / ITX / bus / air) with booking links | `api/_ai_core/buildPrompt.js` intercity block |

**Not backed — do not claim:** live opening hours, real-time train seat availability,
live pricing, guaranteed dietary safety (`verified: true` in a plan means "this
restaurant exists in our database", nothing more — see `CLAUDE.md`), a live routing
result on *every* leg (the fallback chain above is real and the plan says so — pinned by
`tests/unit/editorial-home-foundation.test.ts`), or any count of customers, bookings or
ratings that is not read from a real source.

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
| Planner (`/planner`) — masthead, mode choice, wizard, loading, preview, purchase | this system (phase 2) |
| Tour detail (`/tours/:slug`) — public non-payment body, all breakpoints | this system; booking, price and refund controls remain the previous protected money boundary |
| Community (`/community`, `/community/post/:id`, `/community/new`) — public feed, detail, states and compose shell | this system; post, upload, auth and moderation operations are unchanged |
| Shared course (`/s/:id`) — public read-only course document and states | this system; public GET contract and local planner handoff are unchanged |
| Not-found (`api/not-found.js`, app catch-all `*`) — direct server and in-app recovery document | this system; the server keeps HTTP 404 and both surfaces use `noindex, nofollow` |
| Loading / empty / error / done primitives (`src/components/ui/states.tsx`) | this system; adopted by the app shell (route loading, global error boundary), the planner, guide and public community |
| Tours catalogue (`/tours`), charter, guide, my-page, admin | previous dark system + `.refined-*` |

Because the shell is shared, a page still on the old system now shows a paper header
over a dark body. That is the intended transitional state, not a bug — mobile already
shipped a light header over dark bodies before this change. It resolves as each body is
converted.

`.refined-home` and the header's global `.refined` glow override were **deleted**, not
disabled: home no longer needs a corrective cascade because its base is correct. The
remaining `.refined-tours|charter|plandetail|page` blocks in `src/index.css` belong to
pages that are still on the old system and are removed with those pages — which is what
happened to `.refined-planner` in phase 2, together with the ~90-line
`.planner-mobile-*` block that repainted the dark planner light on phones. A
`.refined-*` block lives exactly as long as the page it corrects.

**One functional fix rode along with the visual work.** The home destination rail links to
`/planner?prefillRegions=<cityKey>`, but `PlannerPage` parsed every `prefill*` parameter
only inside `revisionMode ? {…} : undefined`. Without `revision=true` the deep link
resolved to nothing and the chip dropped the traveller on an empty city step — the one
question they had already answered. Outside revision the page now honours
`prefillRegions` alone; every other prefill parameter still belongs exclusively to the
revision flow. Verified in a browser: the chip opens the wizard on step 2/5 with Seoul
selected as the main base.

### 2026-08-11 — `/tours` 카탈로그 P3 정리 (표시·접근성·진실성)

`/tours` 의 **몸통은 아직 이전 다크 시스템**이다. 이 패스는 그 전환이 아니라, #1279/#1280 이후
프로덕션에 남아 있던 P3 4건을 이 문서의 floor 기준으로 맞춘 것이다.

| 남아 있던 것 | 지금 |
|---|---|
| 카드 제목 `line-clamp-1` — en 3뷰포트·ja 768/1440 에서 멀티시티 상품명이 잘렸다 | 2줄 + `min-h: 2.75em`(= leading-snug × 2줄). 1줄 제목도 2줄 자리를 잡아 카드 정렬이 제목 길이에 흔들리지 않는다 |
| 필터 칩 30~40px | 지역·기간·관심사·페이스·언어·정렬·검색·지우기·카드 위시리스트·CTA 전부 44×44 |
| 근거 없는 `Popular` 필터칩 | 칩 목록을 `isUngroundedBadgeTag`(카드 배지와 같은 SSOT)로 걸러 Popular/Best Value/AI-Curated 는 공개 필터에 못 나온다. `tour.tags`·검색·어드민 편집은 그대로 |
| ko/ja/zh 에 `NIGHT` `NATURE` `HISTORY` `MULTI-CITY` `Tolls` `Parking` `Tips` 영어 누출 | 4언어. 공용 `src/i18n/locales/*.json` 이 아니라 `TourCard`/`ToursPage` 안의 route-local 사전 — 타입이 `Record<Language, string>` 이라 부분 번역이 컴파일되지 않고, 사전에 없는 태그는 영어 원문을 흘리는 대신 배지를 안 낸다 |

측정(로컬 production preview, 390/768/1440 × ko/en/ja/zh 12조합): 잘린 제목 0 · 44px 미만 컨트롤 0 ·
Popular 칩 0 · 영어 누출 0 · 가로 넘침 0. 근거는 `tests/screenshots/tours-catalog-editorial-20260811/`,
잠금은 `tests/e2e/tours-catalog-editorial.spec.ts`(픽셀)와
`tests/unit/tours-catalog-editorial.component.test.tsx`(렌더).

새 gradient·glow·glass 는 넣지 않았다. 기존 다크 시스템의 그라디언트는 `.refined-tours` 와 함께
그 페이지가 전환될 때 사라진다 — 여기서 부분적으로 걷어내면 보정 cascade 가 한 겹 더 생긴다.

### 2026-08-12 — `/tours/:slug` 공개 비결제 상세

같은 상세 화면이 모바일에서는 밝은 별도 덧칠, 데스크톱에서는 이전 다크 몸통을 써서 구조와 상태
계약이 갈라져 있었다. 이를 **한 반응형 종이 셸**로 합쳤다. 결제 바깥 본문만 바꾸고 예약·가격·환불
경계는 그대로 둔다.

| 남아 있던 것 | 지금 |
|---|---|
| `useTour` 의 loading/error/source 가 화면에서 사라져 실패도 404처럼 보임 | loading · error/retry · permission · not-found · partial-data · empty-itinerary 를 공용 `EcLoading`/`EcError`/`EcEmpty` 로 분리 |
| 모바일 밝은 override와 데스크톱 다크 본문이 서로 다른 정보 구조 | breadcrumb → masthead → gallery → facts → overview → itinerary → meeting/FAQ/reviews 순서의 한 지면. 390/768/1440 모두 같은 DOM과 토큰 사용 |
| 지역명이 원문 `tour.region` 으로 새어 ko/ja/zh 에 영어 표시 | 기존 `TOUR_REGIONS` 4언어 사전으로 표시하고 상품 데이터는 변경하지 않음 |
| 갤러리·FAQ·지도 조작이 44px 미만이고 빈 일정이 오류처럼 보임 | 공개 비결제 조작과 Leaflet 확대/축소 44px 이상, 빈 일정은 중립 empty 상태 |
| 정상 화면만 눈으로 확인해 실패·부분 데이터 회귀가 잠기지 않음 | localhost 전용 결정적 fixture. 운영 주소에서는 query가 무시되어 실제 데이터 경로를 우회하지 않음 |
| 모든 투어에 가이드 동행을 암시하던 공용 신뢰 배지와 출처보다 강한 후기 문구 | 상품마다 가이드 포함 여부가 다르고 내부 후기 작성에 예약 번호가 필수가 아니므로 제거. 실제 집계 출처 칩만 표시 |
| 이전 다크 본문을 전제로 투명하게 끝나던 고정 예약 바 상단 | 밝은 지면에서도 배지·예약 마감 문구가 읽히도록 두 줄 뒤에 불투명 단색 받침만 추가. 가격·예약·환불 동작과 문구는 그대로 |

측정(로컬 production preview): 9개 정적 공개 투어 × 390/768/1440 × ko/en/ja/zh = 108회,
대표 투어 7상태 × 같은 12조합 = 84회, 합계 **192회**. 문서 200 · 가로 넘침 0 · 본문
44px 미만 조작 0 · 앱 페이지 오류 0 · 자체 도메인 4xx/5xx 0 · 운영 변경 요청 0.
잠금은 `tests/e2e/tour-detail-editorial.spec.ts` 와
`tests/unit/tour-detail-editorial-shell.test.ts` 다. 가격·상품·PayPal·예약·환불의 의미와 동작은 변경하지 않았다.

### 2026-08-12 — `/charter` Step 3 표시 언어

차터 몸통은 아직 이전 다크 시스템이다. 이 패스는 가격·상품·결제 구조를 바꾸지 않고, 목적지를
고르는 Step 3의 표시 계층만 바로잡는다. 가격 자료가 `ko/en` 이름만 갖고 있어서 일본어·중국어가
영어로 접히고, 장거리 경로는 네 언어 모두 `GANGNEUNG` 같은 내부 키가 그대로 보였다.

- `destinationDisplayLabels.ts`가 공항 권역, 당일 투어, 장거리 도시, 공연장 이름을 네 언어로 표시한다.
- 기존 `destinationKey`, 가격, 거리, 시간, 결제 상품 코드는 그대로 유지한다.
- 긴 현지어 이름은 모바일에서 두 줄까지 보이고, 제목 영역은 늘 두 줄 높이를 유지한다. 카드 높이는 72px라 44px 터치 기준을 넘는다.
- `tests/unit/charter-destination-i18n.component.test.tsx`가 현재 가격 자료의 카드 수, 원래 선택 키,
  ko/en 회귀, ja/zh 영어 fallback 제거를 함께 잠근다.

### 2026-08-13 — `/community`·`/community/post/:id`·`/community/new` 공개 셸

공개 커뮤니티만 자체 레거시 셸을 유지해 공용 상태·접근성 계약과 갈라져 있었다. 글 조회·작성·업로드·
인증·신고의 동작은 그대로 두고, **표시 계층과 결정적 로컬 검증 경로만** 이 문서의 지면으로 옮겼다.
운영 주소에서는 `__fixture=compose`가 무시되므로 로그인이나 쓰기 경로를 우회하지 않는다.

| 남아 있던 것 | 지금 |
|---|---|
| 피드 loading은 이름 없는 spinner, empty/error는 페이지 안쪽 임시 카드 | `EcLoading`·`EcEmpty`·`EcError`로 통일하고 loading `aria-busy`, 빈 화면 CTA, 오류 재시도를 명시 |
| 자체 헤더·토픽·탭·글 액션이 30~43px, 검색·댓글·작성 입력이 12~13px | 공개 조작 44px 이상, 실제 입력 16px 이상. 390/768/1440이 같은 DOM과 토큰 사용 |
| CTA·상품 연결 카드·모바일 작성 아이콘의 gradient, 헤더와 하단탭의 glass | 로고 이미지만 기존 gradient. 나머지는 단색 종이·잉크·hairline이며 blur/glow 없음 |
| `CocoTrip Together`, 소유자 삭제와 좋아요 이름, 댓글 삭제가 영어로 고정 | ko/en/ja/zh route-local 사전으로 화면 문구와 접근성 이름을 함께 제공 |
| 작성 화면이 인증 확인 전에 로그인 요구를 번쩍 표시하고 서버 오류 원문을 노출 | 인증 확인 상태를 먼저 표시하고 여행자용 실패 문구만 노출. 개발 모드 전용 무쓰기 작성 fixture로 실제 폼을 검증 |
| 신고 선택·작성 종류가 모양만 선택지이고 신고창이 키보드 닫기·첫 포커스 없음 | `radiogroup`/`radio`·`aria-checked`·화살표 이동, 첫 포커스·초점 가두기/복귀, Escape 닫기를 명시 |
| 글 상세의 일시 오류와 실제 404가 같은 안내로 끝남 | 일시 오류는 재시도, 404는 없는 글 안내로 분리하고 같은 공용 상태 계약 사용 |

측정(로컬 Vite, 390/768/1440 × ko/en/ja/zh): 피드 normal/loading/empty/error + 로그아웃 작성
**60회**, 개발 전용 실제 작성 폼 1회. 가로 넘침 0 · 44px 미만 공개 조작 0 · 16px 미만 입력 0 ·
gradient 0 · 앱/콘솔 오류 0 · 쓰기 요청 0. 잠금은
`tests/e2e/community-editorial.spec.ts`와
`tests/unit/community-editorial-shell.component.test.tsx`다.

### 2026-08-13 — `/s/:id` 공개 공유 코스

공개 공유 코스만 32~36px 조작과 다크 카드로 남아 공용 셸과 갈라져 있었고, 일시적 서버 실패도
없는 링크와 같은 화면으로 끝났다. 공유를 만드는 POST, 저장 자료, 로그인, 플래너 쓰기는 건드리지
않고 **공개 GET 결과를 읽어 보여 주는 지면과 상태 계약만** 옮겼다.

| 남아 있던 것 | 지금 |
|---|---|
| 텍스트 한 줄 loading, 실패·404를 모두 not-found로 처리 | `EcLoading`·`EcEmpty`·`EcError`로 loading, empty, error/retry, not-found, partial-data를 분리 |
| 모바일 전용 밝은 덧칠과 데스크톱 다크 본문, CTA gradient | 390/768/1440이 같은 종이 지면·단색 토큰·DOM 사용. 로고 밖 gradient·blur·glow 없음 |
| 날짜 탭 32~36px, 지도 링크 10px, 홈 버튼 36px, Leaflet 확대/축소 30px | 실제 조작 44px 이상. 지도 출처의 문장 안 링크만 WCAG 인라인 링크 예외로 유지 |
| 날짜 탭에 `role=tab`만 있고 화살표 키 이동 없음 | 좌우·상하 화살표, Home, End로 선택과 초점이 함께 이동 |
| ko/ja/zh 상태 일부가 영어식 `Day` 표기 | 상태·메타·날짜·분류·지도·CTA를 네 언어 route-local 사전으로 제공. 영어는 `Day 1`, 한국어·일본어·중국어는 각 언어 어순 |
| 일부 잘못된 장소가 있으면 전체 자료를 그대로 신뢰하거나 빈 화면 | 잘못된 항목만 제외하고 partial 안내. 유효 장소가 하나도 없으면 별도 empty 화면 |

측정(로컬 Vite, 390/768/1440 × ko/en/ja/zh × 6상태): **72회**. 가로 넘침 0 ·
44px 미만 공개 조작 0(지도 인라인 출처 예외) · 앱/예상 밖 콘솔 오류 0 · 예상 밖 4xx/5xx 0 ·
쓰기 요청 0. 잠금은 `tests/e2e/shared-course-editorial.spec.ts`,
`tests/unit/shared-course-editorial-shell.component.test.tsx`, 기존 공유 회귀 테스트다.

### 2026-08-13 — `/region/:regionId` 공개 지역 상세

지역 상세만 모바일과 데스크톱이 서로 다른 다크 덧칠과 겹친 사진 본문을 사용해 공용 종이 셸과
갈라져 있었다. 지역 사실·사진·상품에서 가져온 투어 설명·가격·환불 문구와 이동 링크는 그대로 두고,
**표시 구조와 접근성 계약만 하나의 반응형 지면으로 합쳤다.**

| 남아 있던 것 | 지금 |
|---|---|
| 모바일·데스크톱이 서로 다른 DOM과 보정 CSS를 사용하고 사진 위 글자·gradient·glass에 의존 | 390/768/1440이 같은 DOM과 종이·잉크·hairline 토큰 사용. 사진과 본문을 분리하고 로고 밖 gradient·blur·glow 없음 |
| 대표 사진·명소·갤러리·긴 근거 문단의 읽기 순서가 화면 폭마다 달라짐 | 돌아가기 → 지역 소개 → 필수 명소 5곳 → 기존 사진 전체(지역별 갤러리 8~21장) → 기존 상품 근거 → 다음 단계의 한 문서 흐름 |
| 잘못된 지역 주소가 기존 다크 화면과 고정 영어 보조문구로 끝남 | 네 언어 제목·설명과 홈/지역 목록 CTA를 가진 별도 not-found 상태 |
| `constructor` 같은 객체 기본 키나 번역 UI 키를 지역 ID로 오인할 여지 | 소유한 9개 지역 ID와 실제 지역 자료 형태를 함께 검사해 모든 잘못된 주소를 not-found로 제한 |
| 자동 일정 미지원 4개 지역도 플래너에서 일정을 만들 수 있다고 안내 | 플래너 도시 원본 `CITY_CHIPS`를 그대로 확인. 지원 지역만 플래너 CTA, 나머지는 투어 목록·문의 CTA |
| 공개 조작의 초점 표시와 반응형 품질을 정상 화면 한 종류로만 확인 | 키보드 초점 고리, 44px 조작, 가로 넘침, 자체 도메인 오류, 쓰기 요청을 정상·not-found와 9개 지역에서 함께 잠금 |

측정(로컬 Vite, 390/768/1440 × ko/en/ja/zh × 정상·임의 오류·번역 키 충돌·객체 키 충돌): **48회**,
9개 지역 전체 사진 순회 1회. 페이지 제목 브랜드 중복 0 · CTA 대비 4.5:1 이상 ·
가로 넘침 0 · 44px 미만 공개 조작 0 · 16px 미만 입력 0 · 계산된 gradient/glass 0 ·
앱/콘솔 오류 0 · 자체 도메인 4xx/5xx 0 · 쓰기 요청 0. 사진·지역 자료와
`RegionSeoInfo`의 가격·상품·환불 의미는 변경하지 않았다. 잠금은
`tests/e2e/region-editorial.spec.ts`, `tests/unit/region-editorial-shell.test.ts`,
`tests/unit/region-editorial-shell.component.test.tsx`다.

### 2026-08-13 — 서버·앱 404 공용 복구 문서

존재하지 않는 주소를 직접 열면 서버의 어두운 영문 전용 화면이 나오고, 앱 안에서 잘못된 주소로
이동하면 네 언어 종이 화면이 나와 같은 오류가 서로 다른 서비스처럼 보였다. 실제 HTTP 상태와
검색 제외 정책은 그대로 두고, **문구·언어 판정·복구 동선·시각·접근성 계약을 한 원본으로 합쳤다.**

| 남아 있던 것 | 지금 |
|---|---|
| 직접 주소는 영문 한 언어·다크 배경·gradient CTA·홈 링크 하나, 앱 404는 별도 문구와 세 링크 | 두 화면 모두 ko/en/ja/zh, 같은 404 지면과 홈·투어·차량 복구 링크 3개. 서버 화면에는 언어 선택 4개 추가 |
| 서버와 앱의 제목·설명·복구 문구가 각각 관리되어 다시 어긋날 수 있음 | `src/lib/notFoundEditorial.js` 한 곳에서 문구·언어·CSS·서버 HTML을 제공하고 앱도 같은 원본 사용 |
| 앱 404는 `noindex, follow`, 서버는 `noindex, nofollow` | 둘 다 `noindex, nofollow`; 직접 주소는 HTTP 404와 `X-Robots-Tag`를 그대로 유지 |
| 키보드 초점·44px 조작·가로 넘침·계산된 gradient를 두 화면에서 함께 확인하지 않음 | 서버와 앱을 같은 검사로 묶어 44px 조작, 보이는 초점 고리, 넘침·gradient·glass·쓰기 요청 0을 잠금 |

측정(로컬 Vite + 실제 404 핸들러 응답 하네스, 390/768/1440 × ko/en/ja/zh × 서버·앱): **24화면**.
핸들러 생성 404 상태 12/12 ·
네 언어 제목 24/24 · 복구 링크 3개 24/24 · 가로 넘침 0 · 44px 미만 조작 0 ·
계산된 gradient/glass 0 · 의도된 주 문서 404 진단 외 예상 밖 콘솔 오류 0 ·
예상 밖 자체 도메인 4xx/5xx 0 · 쓰기 요청 0. Vercel 함수 묶음과 실제 네트워크 404는 Preview와 Production에서 별도로 확인한다.
잠금은 `tests/e2e/not-found-editorial.spec.ts`, `tests/unit/not-found-editorial-shell.test.ts`,
`tests/unit/not-found-editorial-shell.component.test.tsx`와 기존 404 회귀 테스트다.

### 2026-08-11 — 공통 상태 + 전역 셸 (한 근본원인)

앞 문단의 "Open item — shared header touch targets (P3)" 는 **해소**됐다. 같은 뿌리에서
나온 세 증상을 한 PR 로 묶는다: `src/components/ui/states.tsx` 가 로딩·빈·오류·완료의
계약을 정의해 놓았는데 **앱 셸이 그걸 한 번도 채택하지 않았다.**

| 남아 있던 것 | 지금 |
|---|---|
| lazy 라우트 51곳이 `PlannerSkeleton`(다크 `#080b14`, 위저드 모양) 로 폴백. `role=status`·`aria-busy`·라벨 없음 → 라우트 전환이 스크린리더에 무음. 종이로 전환된 `/planner` 앞에서도 검은 판이 번쩍였다 | 공용 `EcRouteFallback` 하나. announce 하고, 그 라우트가 실제로 여는 지면(종이/legacy) 위에 그린다. `PageSkeleton.tsx` 삭제, 손으로 덧댄 폴백 3개(홈·`/guide`·`/mood`)도 같은 컴포넌트로 |
| 전역 `ErrorBoundary` 가 다크 패널 + retry 버튼에 로고 그라디언트(`#7C5CFC→#EA537E`)를 칠하고, 원문 `Error.message` 를 여행자에게 노출 | 공용 `EcError`(종이·assertive·재시도+WhatsApp). 원문·스택은 `import.meta.env.DEV` 에서만. Sentry 보고 경로 무변경 |
| 공용 셸 조작 target 이 44px 미만: Wishlist·Cart 36×36 이고 아이콘이 `text-white/70` — 종이 헤더 위 대비 ~1.06:1 로 사실상 안 보였다. 데스크톱 nav 38.5px, 로고 32px, 로그인·1:1 문의·쿠키 배너 버튼 36px(`ec-btn-sm`), 푸터 전화 36px, 프로모 띠 38px | 전부 44×44 이상, 잉크 토큰. `--ec-button-height-sm`(36px) 토큰은 그대로 둔다 — 플래너 코스빌더·구매 패널이 쓰고 있고 그건 이 PR 밖이다. 공용 셸에서만 `ec-btn-sm` 을 뺐다 |
| 모바일 메뉴가 전체 화면을 덮으면서 `role`·이름·포커스 반환이 없었다 | `role="dialog"` + `aria-modal` + `aria-label`, 열 때 패널로 포커스, 닫을 때 햄버거로 복귀. 기존 Esc·body 스크롤 잠금·cleanup 은 잠금 테스트로 보존 |

측정(로컬 production preview, 390/768/1440 × ko/en/ja/zh × `/`·`/planner`·`/tours`·`/charter`·
`/community`·`/guide` = 72 로드): **셸 44px 미만 0 · 셸 16px 미만 입력 0 · 가로 넘침 0 ·
own-origin 4xx/5xx 0 · own-origin console error 0.** 잠금은
`tests/unit/editorial-common-state-shell.test.ts`(소스 계약)와
`tests/e2e/common-state-shell.spec.ts`(실측 지오메트리 + 강제 상태).

`--ec-legacy-page-bg`(`#0A0412`) 를 하나 추가했다. 아직 다크인 몸통이 여는 지면이고,
**마지막 `.refined-*` 페이지와 함께 사라진다.** 폴백 말고 아무도 읽으면 안 된다.

#### 후속 큐 — page-specific (이 PR 범위 밖, 실측 목록)

몸통은 아직 이전 다크 시스템이라 여기서 손대면 보정 cascade 가 한 겹 더 생긴다.

| 화면 | 실측 |
|---|---|
| `/` 목적지 레일 | "지도에서 열기" 링크 14×14 (15개) |
| `/tours` | 필터 `select` font-size 11px (16px 미만 → iOS 확대) |
| `/charter` | 안내 링크 30px·15px |
| 전역 쿠폰 모달(`OnboardingCouponModal`) | `ec-btn-sm` 36px — 쿠폰 화면이라 별도 PR |
| 페이지별 skeleton | 라우트 폴백은 공용 masthead 모양이다. 화면별 skeleton 은 그 페이지가 전환될 때 |
| 헤더 행 1024~1279 대역 | **이 시스템 이전부터 가로로 넘친다** — origin/main(ef3ce7c5) 실측 1024/ko +34px, 1024/en +103px, 1100/en +27px. nav 5개 + 유틸 6개 + CTA 2개가 그 폭에 안 들어간다. 이번 PR 은 Wishlist 를 36→44 로 올린 만큼(+8px) 늘렸고 그 외는 baseline 폭을 유지했다. 해소하려면 그 폭에서 무엇을 접을지 정해야 하므로 제품 결정이다 |

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
