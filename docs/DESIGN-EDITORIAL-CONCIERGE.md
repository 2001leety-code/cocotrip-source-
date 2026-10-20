# Korea Editorial Concierge — CocoTrip design foundation

> Status: **phase 2 (foundation + common shell + home + planner + tours catalogue + tour detail + community + shared course + region detail + assistant + my-page + not-found)**.
> The charter, guide and admin bodies still run on the previous dark system and are converted
> in later PRs. Public `/tours`, `/tours/:slug`, `/community`, `/mypage`,
> `/community/post/:id`, `/community/new`, `/s/:id`, `/region/:regionId`, `/assistant`, `/map` and both 404 surfaces now follow this document. Read "Migration state" before assuming a page
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
`src/styles/editorial-assistant.css` is the route-scoped assistant presentation layer; it
does not change authentication, analytics or chat request behavior.
`src/styles/editorial-tours-catalog.css` is the route-scoped public tours catalogue layer;
it preserves product, price, filter, inquiry and affiliate behavior.
`src/styles/editorial-mypage.css` is the route-scoped account presentation layer; it keeps
authentication, booking, course, loyalty and review operations behind their existing boundaries.
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
| Tours catalogue (`/tours`) — public directory, filters, cards and empty state | this system; product, price, inquiry and affiliate behavior are unchanged |
| Tour detail (`/tours/:slug`) — public non-payment body, all breakpoints | this system; booking, price and refund controls remain the previous protected money boundary |
| Community (`/community`, `/community/post/:id`, `/community/new`) — public feed, detail, states and compose shell | this system; post, upload, auth and moderation operations are unchanged |
| Shared course (`/s/:id`) — public read-only course document and states | this system; public GET contract and local planner handoff are unchanged |
| Not-found (`api/not-found.js`, app catch-all `*`) — direct server and in-app recovery document | this system; the server keeps HTTP 404 and both surfaces use `noindex, nofollow` |
| My plans (`/my-plans`) — saved itinerary library and list states | this system; the bookings tab, prices, cancellation and refund controls remain the previous protected money boundary |
| My page (`/mypage`) — account overview, tabs and read states | this system; authentication and booking, course, loyalty and review operations are unchanged |
| Assistant (`/assistant`) — signed-out access, conversation, reply-loading and sign-in-error presentation | this system; authentication, analytics and `/api/chat` behavior are unchanged |
| Map (`/map`) — saved itinerary route document and read states | this system; authentication, Firestore paths and queries, itinerary data, map provider and explicit route lookup behavior are unchanged |
| Loading / empty / error / done primitives (`src/components/ui/states.tsx`) | this system; adopted by the app shell (route loading, global error boundary), the planner, guide and public community |
| Charter, guide, admin | previous dark system + `.refined-*` |

Because the shell is shared, a page still on the old system now shows a paper header
over a dark body. That is the intended transitional state, not a bug — mobile already
shipped a light header over dark bodies before this change. It resolves as each body is
converted.

`.refined-home` and the header's global `.refined` glow override were **deleted**, not
disabled: home no longer needs a corrective cascade because its base is correct. The
remaining `.refined-charter|plandetail|page` blocks in `src/index.css` belong to
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

운영 `refined` 모드의 전역 보라색 초점 링이 404의 고대비 검은 윤곽선을 덮지 못하도록
404 범위의 우선순위를 명시한다. 앱 화면 검사는 `refined` 클래스와 전역 보라색 링이 실제로
적용되는지 먼저 확인한 뒤 404 윤곽선을 검사하고, 서버 화면은 같은 최종 초점 계약을 따로 확인한다.

측정(로컬 Vite + 실제 404 핸들러 응답 하네스, 390/768/1440 × ko/en/ja/zh × 서버·앱): **24화면**.
핸들러 생성 404 상태 12/12 ·
네 언어 제목 24/24 · 복구 링크 3개 24/24 · 가로 넘침 0 · 44px 미만 조작 0 ·
계산된 gradient/glass 0 · 의도된 주 문서 404 진단 외 예상 밖 콘솔 오류 0 ·
예상 밖 자체 도메인 4xx/5xx 0 · 쓰기 요청 0. Vercel 함수 묶음과 실제 네트워크 404는 Preview와 Production에서 별도로 확인한다.
잠금은 `tests/e2e/not-found-editorial.spec.ts`, `tests/unit/not-found-editorial-shell.test.ts`,
`tests/unit/not-found-editorial-shell.component.test.tsx`와 기존 404 회귀 테스트다.

### 2026-08-13 — `/my-plans` 저장 일정 보관함

저장 일정 목록은 첫 Firestore 구독이 실패해도 `loading=false` 만 설정해 **실패를 “아직 일정 없음”으로
표시**했고, 다음 페이지를 읽지 못하면 `hasMore=false` 로 바꿔 나머지 일정이 없는 것처럼 끝냈다.
같은 목록은 다크·그라디언트 셸, 44px 미만 탭, 14px 검색 입력도 함께 남아 있었다.

한 근본원인인 “저장 일정 보관함의 표시 상태 계약 불일치”로 묶어 다음처럼 정리한다.

- 첫 구독은 `EcLoading` → 정상/`EcEmpty`/`EcError` 로 분리한다. 오류에는 같은 구독을 다시 여는
  명시적 재시도가 있고, 원문 Firebase 오류는 여행자에게 노출하지 않는다.
- 다음 페이지 실패는 이미 받은 카드를 지우지 않는 부분 오류로 표시하고, 나머지 목록만 다시
  요청한다. 검색 결과 없음도 검색 지우기 동작이 있는 되돌릴 수 있는 빈 상태이며, 아직 읽지
  않은 페이지가 있으면 `더 보기`를 유지해 오래된 일정까지 검색 범위를 넓힐 수 있다.
- 일정 카드는 종이 지면·헤어라인·평면 단색만 사용한다. 탭과 모든 동작은 44px 이상, 검색 입력은
  16px이다. 탭은 방향키·Home·End와 이름 붙은 패널을 지원하고, 역상 예약 경계에서는 밝은
  초점선을 사용해 배경과 3:1 이상 대비를 유지한다. 상태·카드 제목·재시도는 ko/en/ja/zh로 표시한다.
- `/dev/my-plans-editorial`은 `import.meta.env.DEV` 안에서만 존재하는 읽기 전용 화면 하네스다.
  정상·로딩·빈 목록·오류·부분 오류를 실제 Firestore나 로그인 없이 재현하며 운영 번들에는 없다.
- `MyBookingsTab` 파일, 예약 조회, 가격, 결제, 변경, 취소, 환불 동작과 문구는 수정하지 않는다.
  돈과 연결된 그 탭은 별도 승인 전까지 이전 경계 안에 그대로 둔다.

검증은 `tests/unit/my-plans-editorial-shell*.test.*`와
`tests/e2e/my-plans-editorial.spec.ts`가 상태 분기, 재시도, 부분 자료 유지, 390/768/1440,
ko/en/ja/zh, 44px/16px, 넘침·그라디언트·운영 쓰기 0을 잠근다.

### 2026-08-14 — `/assistant` 여행 질문 지면

전면 여행 도우미는 430px 모바일 열을 데스크톱에도 그대로 늘여 놓고, 24~40px 조작과 13px 입력,
gradient·blur·shadow에 의존했다. 인증·채팅·분석 동작은 그대로 두고 **화면 구조와 상태·접근성
계약만** 한 반응형 종이 지면으로 합쳤다.

| 남아 있던 것 | 지금 |
|---|---|
| 390px용 한 열을 768/1440에서도 사용해 넓은 화면 대부분이 빈 공간 | 로그인 전은 안내와 로그인 카드, 로그인 후는 대화와 자주 묻는 질문의 편집형 격자. 959px 아래에서는 같은 DOM이 한 열로 접힘 |
| 뒤로가기 36px, 언어 24.5px, 전송 40px, 메시지 입력 13px | 공개 조작 44px 이상, 메시지 입력 16px. 언어 묶음과 현재 언어를 이름·`aria-pressed`로 명시 |
| 대화 목록과 답변 준비 상태가 이름 없이 보이고, 자동 이동이 문서 전체를 움직일 수 있음 | 이름 있는 `role=log`·`aria-busy`, 읽히는 `role=status`. 새 메시지는 대화칸 내부만 이동 |
| 로그인 오류가 작은 빨간 글씨로만 표시되고 로딩·정상·오류 화면을 로그인/AI 없이 재현할 수 없음 | 오류 `role=alert`. 개발 모드 전용 `signed-out`·`ready`·`loading`·`auth-error` 하네스는 인증·분석·채팅 요청을 끄고 운영 번들에서는 query를 무시 |
| 헤더·버튼·말풍선에 로고 밖 gradient, blur, glow 성격의 그림자 | 종이·잉크·hairline·단색 브랜드 토큰만 사용. 강제 색상과 모션 줄이기에도 초점·상태 유지 |

측정(로컬 Vite, 390/768/1440 × ko/en/ja/zh × 4상태): **48상태 + 실제 로그인 전 경로 1회 + 390px 긴 대화 자동 이동 1회**. 가로 넘침 0 ·
44px 미만 조작 0 · 16px 미만 입력 0 · 계산된 gradient/glass 0 · 앱/콘솔 오류 0 ·
쓰기 요청 0 · 페이지 제목 브랜드 중복 0. 대표 화면을 별도로 눈검수했다. 잠금은
`tests/e2e/assistant-editorial.spec.ts`와
`tests/unit/assistant-editorial-shell.component.test.tsx`다. `useChatSession`, 로그인 제공자,
`/api/chat`, `/api/chat-poll`, 분석 이벤트, FAQ 질문 내용은 변경하지 않았다.

### 2026-08-14 — `/map` 저장 일정 경로 문서

지도 화면은 모바일 전용 밝은 덧칠과 데스크톱 다크 본문이 서로 다른 셸을 사용했고, Firestore 읽기
실패를 빈 목록이나 좌표 없음으로 숨겼다. 저장 자료·권한·지도 호출은 그대로 두고 **읽은 결과를
보여 주는 지면과 상태 계약만** 하나로 합쳤다.

| 남아 있던 것 | 지금 |
|---|---|
| 모바일과 데스크톱이 다른 DOM·색 체계를 쓰고 제목 아이콘·CTA·선택 칩에 장식 배경 사용 | 390/768/1440이 같은 종이·잉크·hairline DOM 사용. 공용 헤더도 이 경로에서는 불투명 단색이며 계산된 장식 배경·glass 0 |
| 플랜 목록·선택 문서 읽기 실패를 빈 목록·좌표 없음으로 표시 | `EcLoading`·`EcEmpty`·`EcError`로 loading, empty, error/retry, permission, not-found를 분리하고 좌표 부족은 중립 partial 상태로 분리 |
| 제목에 브랜드를 직접 붙여 `Route Map — CocoTrip | CocoTrip`으로 중복 | 메타 훅에는 페이지 제목만 전달해 네 언어 모두 브랜드 1회 |
| 플랜·날짜 칩이 44px 미만이고 날짜가 모든 언어에서 영어 `Day` | 모든 조작 44px 이상. 영어 `Day 1`, 한국어 `1일차`, 일본어 `1日目`, 중국어 `第1天`이며 날짜 탭은 방향키·Home·End로 선택과 초점이 함께 이동 |
| 정상 로그아웃 화면만 실측하고 실패·권한·부분 자료를 재현할 수 없음 | 개발 모드 전용 8상태 fixture. 운영 번들에서는 query가 무시되며 인증·Firestore를 우회하지 않음 |

기존 `users/{uid}/plans` 최근 10건 읽기·ready 5건 표시와 `plans/{selectedPlanId}` 본문 읽기 경로는
그대로다. `DayRouteMap`의 지도 제공자, 네이버 링크, 사용자가 명시적으로 누를 때만 실행되는
`/api/course-route`도 변경하지 않았고 Firestore 쓰기는 추가하지 않았다.

측정(로컬 Vite, 390/768/1440 × ko/en/ja/zh × 8상태): **96상태 + 실제 로그아웃 경로 1회**.
가로 넘침 0 · 44px 미만 조작 0(지도 출처의 문장 안 링크 예외) · 계산된 장식 배경/glass 0 ·
앱/콘솔 오류 0 · 자체 도메인 4xx/5xx 0 · 쓰기 요청 0 · 페이지 제목 브랜드 중복 0.
잠금은 `tests/e2e/map-editorial.spec.ts`,
`tests/unit/map-editorial-shell.component.test.tsx`, 기존 공개 문구 회귀 테스트다.

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

### 2026-08-15 — 공용 로그인 필요 지면

`/mypage`, `/my-plans`, `/charter-legacy`가 함께 쓰는 `AuthRequired`는 화면 크기에 따라 서로 다른
디자인처럼 보이던 문제를 하나의 편집형 문서로 통합한다. Firebase 인증, 리디렉션 결과 처리,
LINE 기능 플래그와 휴대전화 로그인 모달의 동작은 바꾸지 않는다.

| 이전 | 지금 |
|---|---|
| 데스크톱은 어두운 배경과 장식 효과, 모바일은 전역 CSS가 덮어쓴 흰색 카드 | 같은 DOM과 종이·잉크·hairline 토큰을 쓰며 959px 아래에서 한 열로 접힘 |
| 로그인 제공자 버튼과 안내 목록의 화면·초점 계약이 경로마다 다름 | 모든 제공자 버튼 48px 이상, 문서 순서대로 Tab 이동, 일반·강제 색상 모드에서 초점 표시 유지 |
| 인증 확인과 실패 상태를 실제 로그인 없이 안전하게 재현하기 어려움 | 개발 모드 전용 `signed-out`·`loading`·`error` fixture. 운영에서는 query를 무시하고 인증을 우회하지 않음 |

측정(로컬 Vite, 390/768/1440 × ko/en/ja/zh): 로그인 전 **12화면**, loading·error **2화면**,
공용 보호 경로 **3개**. 가로 넘침 0 · 44px 미만 조작 0 · 계산된 장식 배경 0 ·
예상 밖 콘솔 오류 0 · 쓰기 요청 0. 검증은
`tests/e2e/auth-required-focus.spec.ts`와
`tests/unit/auth-required-editorial-shell.component.test.tsx`가 담당한다.

### 2026-08-16 — `/tours` 모바일 발견 비용

모바일에서 상품 하나를 보려면 마스트헤드·신뢰 스트립·계절 안내·지역 레일·필터 본문을
전부 지나가야 했다. 필터 본문을 네이티브 `<dialog>` 바텀시트로 옮기고 그 위 블록들을 압축한다.
상품·필터·정렬·가격 의미는 그대로다 — 필터링·정렬 로직도 손대지 않았다.

| 이전 | 지금 |
|---|---|
| 모바일에서 필터 6묶음이 목록 위에 통째로 펼쳐짐 | 44px 필터 트리거 + 정렬 셀렉트 한 줄. 본문은 네이티브 `<dialog>` 바텀시트 |
| 데스크톱 패널과 모바일 시트가 각자 마크업을 가질 위험 | 필드 렌더러 하나(`renderFilterFields`)를 패널과 시트가 같이 씀 |
| 몇 개가 걸려 있는지 접힌 상태에서 알 수 없음 | 활성 개수 배지 — 기존 필터 state 에서 파생(별도 state 없음) |
| 계절 안내가 목록 위 한 블록을 더 차지 | 데스크톱은 그대로, 모바일은 결과 머리말 위 한 줄로 대체 |

모바일 계약: 결과 머리말이 첫 화면 안 · 첫 실제 상품 상단 **≤950px** · 신뢰 스트립 **≤90px** ·
가로 넘침 0 · 조작 44px 이상 · 입력·셀렉트 16px 이상 ·
**본문·설명 등 읽는 글자 13px 이상, eyebrow 라벨·개수 배지 같은 표식은 11px 토큰(`--ec-eyebrow-size`) 유지** ·
시트 본문은 머리말 아래에서 스크롤되어 마지막 필터(주행 언어·정렬)까지 닿는다 ·
Escape·닫기 버튼·backdrop 모두 닫고 초점은 트리거로 복귀. 데스크톱(≥768)은 바를 숨기고
기존 필드·계절 블록·순서를 유지한다. 시트 트리거는 `@media (max-width: 767px)` 안에서만 뜬다.

읽는 글자 13px 하한은 **본문·설명 카피**에만 건다. eyebrow·개수 배지는 읽는 글자가 아니라
표식이라 공용 11px 토큰을 그대로 쓴다 — 모바일에서 10px 로 더 줄이던 로컬 override 는 지웠다.
시트는 flex 열이고 머리말은 `flex-shrink: 0`, 본문은 `min-height: 0` + `overflow-y: auto` 다.
`min-height: 0` 이 빠지면 flex 자식이 안 줄어들어 스크롤 여백이 0 이 되고,
`max-height` + `overflow: hidden` 이 꼬리를 잘라 마지막 필터가 아예 사라진다(JS 스크롤 잠금 없음).

로컬 브라우저 측정(2026-08-16, 360×800·390×844 × ko/en/ja/zh): 결과 머리말 상단 **740–770px**,
첫 실제 상품 카드 상단 **868–898px**, 신뢰 스트립 **87px**, 가로 넘침 **0**,
필터 트리거·시트 컨트롤 44px 이상, 입력·셀렉트 16px 이상, Escape 닫힘·초점 트리거 복귀,
backdrop 닫힘, 활성 개수 **0→1→0**, 데스크톱 768 에서 모바일 바 숨김·데스크톱 필드 노출·
계절 블록이 지역 레일보다 앞. 신뢰 스트립은 여백(`padding-block` 22→18px,
`margin-top` 10→6px)과 설명 행간(1.5→1.35)만 줄여 예산 안으로 들어왔다 —
글자 크기는 13px 그대로이며, 위 e2e 의 `TRUST_STRIP_MAX_HEIGHT = 90` 단언이 잠근다.

도구 검증: 대상 Playwright 파일 **20/20** — 이제 8개 모바일 조합 전부에서 시트 본문의
실제 스크롤 범위·끝까지 내림·바닥의 주행 언어와 정렬 hit-test 까지 포함한다.
집중 유닛 파일 **76/76**, 수정 후 `npm run build` 통과,
전체 Vitest **612 파일 · 7728 통과 + 7 todo · 0 실패**, i18n 패리티 **2199 키 × 4 로케일** 통과,
변경 파일 ESLint **0**, `git diff --check` 통과.
**CI·PR·머지·프로덕션은 아직 검증하지 않았다.**
회귀 잠금은 `tests/e2e/tours-catalog-editorial.spec.ts`(360/390 × 4언어 픽셀 —
시트 본문 스크롤 여백·끝까지 내림·주행 언어 칩과 정렬 셀렉트의 뷰포트 안 hit-test 포함)와
`tests/unit/tours-catalog-editorial.component.test.tsx`(4언어 라벨·dialog/ref/초점 복귀·
backdrop·파생 개수·공유 렌더러·시트 flex/`min-height:0` 선언·`??`/gradient 금지)가 담당한다.

### 2026-08-16 — `/mypage` 모바일 위계

`/mypage` 는 폰에서도 데스크톱용 정적 프로필과 줄바꿈 탭 밀도를 그대로 썼다. 390×844 실측으로
첫 실제 여행자 동작(다음 여행 카드)이 **ko 681px · en/ja/zh 729px** 에서 시작했고, 7개 탭은
**93px(ko) / 141px(그 외)** 로 줄바꿈돼 언어마다 그 아래가 통째로 밀렸다. 색만 바뀌었을 뿐
실루엣은 일반 계정 대시보드였다. 한 근본원인 — **폰에 데스크톱 밀도** — 로 묶어 정리한다.

| 이전 | 지금 |
|---|---|
| 헤더 로고·하단 홈 탭에 더해 본문 상단에 세 번째 홈 링크 | `<768` 에서만 접는다. 헤더 로고와 하단 홈은 그대로 |
| 420px 아래에서 프로필이 단일 열로 접혀 아바타·이름·등급이 세로로 쌓임 | 모든 폰 폭에서 가로 한 줄. 아바타 44px, 패딩 14/16px, 이메일은 말줄임 |
| 등급 혜택 블록이 적립률을 한 번 더 표기 | `<768` 에서만 접는다. 적립률은 아래 진실한 집계 카드에 그대로 있다(문구·값 무변경) |
| 탭 7개가 2~3줄로 줄바꿈 | 한 줄 가로 스크롤, 스크롤바 비표시, 언어 무관 같은 높이 |
| `?tab=reviews` 딥링크의 활성 탭이 줄 밖에 남음 | 컨테이너 `scrollLeft` 만 옮긴다(애니메이션·문서 세로 스크롤 없음). 웹폰트가 붙은 뒤 한 번 더 맞춘다 |
| 집계 eyebrow 10px, 숫자 폭이 흔들림 | 폰에서 공용 11px 토큰과 `tabular-nums`. D-day·제목 16px 로 소폭 강조 |

모바일 계약(360×800 · 390×844 × ko/en/ja/zh): 프로필 **≤150px** · 탭 한 줄 **≤52px** ·
첫 동작 상단 **≤430px** · 집계 상단 **≤620px** · 문서 길이 **≤1800px** · 가로 넘침 **≤1** ·
본문 조작 **44×44 이상** · 언어별 첫 동작 상단 편차 **≤16px** ·
페이지/콘솔 오류·자체 도메인 4xx/5xx·쓰기 요청 **0**.

**데스크톱(≥768)은 손대지 않았다.** eyebrow 11px, `tabular-nums`, D-day 강조, 접힌 두 블록은
전부 `@media (max-width: 767px)` 안에만 있고, 768 에서는 홈 링크와 등급 혜택이 그대로 보인다 —
e2e 가 양쪽을 함께 잠근다. 인증·Firestore·예약·코스·쿠폰·리뷰·적립 동작과 가격 의미는 무변경이고
fixture 는 여전히 DEV 전용 읽기 전용이다.

측정(로컬 Vite, 2026-08-16, 360×800·390×844 × ko/en/ja/zh — 두 폭이 같은 값):
프로필 298→**110px**, 아바타 52→44px, 탭 줄 93px(ko)·141px(en/ja/zh, 2~3줄)→**45px 한 줄**(전 언어),
첫 동작 상단 681px(ko)·729px(en/ja/zh)→**345px**(언어 편차 48→**0px**), 집계 상단 852/900→**518px**,
문서 길이 2034/2082→**1703px**. 같은 하네스로 잰 데스크톱은 전후 동일하다 —
768: 프로필 250px·첫 동작 612px(ko/zh)·660px(en/ja), 1440: 프로필 255px·첫 동작 617px, eyebrow 10px. 잠금은
`tests/e2e/mypage-editorial.spec.ts`(360/390 × 4언어 픽셀 + 언어 편차 + 딥링크 탭 가시성 +
768 데스크톱 가드, 기존 768/1440 검사 유지)와
`tests/unit/mypage-editorial-shell.component.test.tsx`(폰 전용 CSS 계약·420px override 부재·
탭 레일 소스 계약)가 담당한다.

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


## 2026-10-07 — 홈 dope 레퍼런스 로컬 시안 (사용자 최신 지시)

기존 지도 시범 대신 dope.security 배치·황혼 구름·혼합 제목·반투명 일정 패스를 홈에서만 구현했다. `home/index.tsx`에서 `home-dope.css`를 불러오며 `.home-dope`/`.home-dope-chrome` 범위만 변경한다. 이전 문서의 종이 배경·유리 효과 금지는 이번 명시된 홈 시안에 적용하지 않는다. 다른 페이지 전역 `editorial.css`는 그대로다. `EXAMPLE_PLANS[0]`의 실제 정류장과 명시적 예시 표기를 사용하며 기존 링크·가격 계산·계정 일치 보호는 변경하지 않았다. 출처·대체 폰트 차이는 `public/home-dope/ASSET-SOURCES.md`에 있다.

오답 기록: 루트에서 계산된 카드/버튼/헤더 토큰은 하위 색 변수만 바꿔도 바뀌지 않아 홈 범위에서 실제 별칭도 지정했다. 그리드의 자동 최소 폭은 도시 목록 때문에 390px 카드가 649px로 늘어났으므로 `minmax(0,1fr)`와 목록 `min-width:0`로 해결했다. 1024px에서는 상단 메뉴가 문의 버튼을 밀어냈으므로 홈의 768–1279px만 기존 전체 메뉴로 접는다. 메뉴 표시가 사라질 때 열린 상태도 초기화해 스크롤 잠금을 남기지 않는다. 글자 잘림은 행 높이보다 실제 Range 영역과 잘리는 부모 영역을 비교한다.

로컬 회귀: 기존 홈·계정 전환 40PASS, 신규 브라우저 검사 13PASS(4언어×390/768/1024/1172/1440=20화면 조합 포함), 마지막 메뉴 상태 수정 관련 5PASS. 변경 파일 ESLint 및 타입 포함 `npm run build`는 종료 기록의 실제 결과를 참조한다. 운영 통신이 차단된 로컬 검사이며 로그인 제공자·실제 결제·예약·실기기 Safari·운영 배포 성공을 뜻하지 않는다. 이번 브랜치는 `codex/home-dope-local-20261007`; push/PR/merge/배포하지 않는다.

### home-dope motion (Fable 설계 §1–6 구현, Opus 5.5)

- 구조: h1 하나를 4행(`hero.headlineLines`, 세리프/산세리프 혼합)으로 그리고 `aria-label`=`headline`(세그먼트 연결과 동일, 소요시간 표현 없음). 행 피치 390 38px → 1440 70.4px, 4행 고정. 4행 아래 비행 궤적은 1회만 그려진다.
- 하늘: 옵션 B(영상 아님) — 남색→분홍 CSS 바탕·별, 라이선스 사진 luminosity 합성·확대 흐름, 자체 SVG 구름 2개 이동, 점선 항로 흐름(`SkyLayer.tsx`). 영상 요청 없음.
- 패스: `EXAMPLE_PLANS` 5초 순환(`useCyclingPlan`), 일시정지 버튼·점 선택, 내용 hover/focus·탭 숨김·감속 설정 시 정지. CTA href(`/planner`, `#sample-day`) 고정. 390은 접힌 64px 스텁+펼침 버튼, 첫 화면 주 CTA는 리드 아래 하나.
- 스크램블(`ScrambleText`): 서비스 eyebrow·kicker·추천 투어 제목·h1 4행만, 가격·CTA 제외, sr-only 원문 유지.
- 서비스 스토리: ≥1024+모션 허용 시 300vh 트랙의 sticky 프레임에서 세로 스크롤로 가로 레일 이동(framer-motion `useScroll`), 진행바·01/03·비행기. 링크 focus 시 해당 패널이 보이도록 스크롤. 그 외/감속 설정은 `--flow` 일반 흐름. 가격은 기존 `priceLabel` 그대로.
- 실패와 원인: ① 4언어 parity 테스트가 빈 `' '` 세그먼트와 언어별 `serif` 키 유무 차이를 잡아 모든 세그먼트에 `serif` 명시·빈 세그먼트 제거. ② 기존 감속 테스트가 DOM 첫 `.home-dope-btn`(1440에서 숨는 모바일 CTA)을 집어 `:visible`로 대상만 조정(전 버튼 타이밍 검사는 유지). ③ 신규 감속 테스트에서 가장자리 정렬 스크롤이 0.997 비율 → 중앙 정렬 후 ratio 1 유지.
- 로컬 검사(이번 패스): build PASS, 관련 unit 43PASS(기존 40+신규 3), scoped ESLint PASS, E2E 19PASS(기존 13+신규 6). 시각 승인은 Fable/사용자 검토 대상.
- Fable v2 검토 HOLD 수리 2건:
  - 하늘: 원인 = 세로 스크림이 70%부터 `#090909`로 덮어 분홍 띠가 사라졌고, 구름은 흰색 0.5/0.38 불투명도 + blur 14 → 형태가 안 읽힘. 수정 = 스크림 0.35→0.15→0.08(75%)→0.1(94%)→검정(마지막 6%), 사진은 하단 1/3 mask로 걷어 분홍을 회색화하지 않음, 구름 fill `#f3e6f7`·blur 7/6·불투명도 0.7/0.55(폰 0.3 유지)·주기 60s/90s. 결과 1440에서 구름 a 3초 이동 147.6px(테스트 하한 60px 추가). 한계: 왼쪽 가독 스크림이 하늘 위 레이어라 왼쪽 구름은 회보라 톤.
  - EN "plannedfor you.": 원인 = 마지막 행 세그먼트가 `.home-dope-scramble`(inline-grid) 안에 들어가 그리드 셀이 블록화되며 `'planned '`의 끝 공백이 줄끝 공백으로 제거됨. 수정 = 세그먼트 앞뒤 공백을 그리드 밖 텍스트로 렌더(`EditorialHero.tsx`), CJK는 공백 없는 세그먼트라 영향 없음. 결과 1440 단어 간격 EN 15.4px·KO 18.4px(원문 공백 복원), JA/ZH 0px, h1 높이 EN 291.6 / CJK 330.9 그대로 4행. 실제 간격 assert 추가.

### 2026-10-07 — v3 실제 홈 통합 + customer-night 범위

- 승인된 standalone v3를 실제 React 홈에 통합. `customer-night.css`는 App에서 `src/lib/customerNight.ts` 범위 헬퍼로만 적용. 대상 고객 템플릿 25종(404 포함). 제외: admin, Mood, DEV, preview, charter-legacy.
- 고객 페이지 확장법: 기존 `ec-*` 토큰 우선. 새 페이지면 실제 라우트를 범위 헬퍼에 추가. 포털로 뜨는 고객 컨트롤은 `ec-night`를 opt-in. 공유 base는 바꾸지 않음.
- 포털 `MobileSelectDrawer`: opt-in 클래스 prop(기본 빈 값), 호출은 planner만, legacy는 제외.
- 변경 없음: 기존 timeline, `useNextTrip` 가드, 가격/API/예약/결제/인증/PDF.
- 함정: ① 테마 inverse alias 때문에 투어 띠가 흰 배경+흰 글자. ② 실제 데이터+gap이 고정 576 카드를 넘쳤는데 Playwright `isVisible`은 통과 → CTA rect 포함 여부와 `elementFromPoint`로 검사. 올바른 CSS 압축으로 해결.
- 현재 root 최종 브라우저 fit: en/ko/ja/zh 3플랜 전부 4PASS, planner selected base 1PASS, charter required origin 1PASS. unit 32PASS.
- 실제 main PC/폰 스크린샷은 외부 rollout 산출물에 있음. 25종 전체 시각·Safari·운영 완료는 주장하지 않음.

### 홈 A안 — 히어로 아래 재구성 (2026-10-07, Opus 5.5, 로컬 검증 완료·시각 승인 대기)

- 순서: 히어로(변경 없음) → `ServiceRows`(전폭 3행 `/planner`·`/tours`·`/charter`, 모노 대문자 제목, 112px/모바일 88px, 1px 테두리, 오른쪽 화살표) → `ProofStrip`(실제 투어 3개, `getTourPriceKRW`+`formatPrice`·KO `₩…~` 그대로, 운영자·결제/전세차량 차량 단위 가격/식이·영업시간 비보증 문장은 항상 노출, 원료 수치·노트는 `<details>`에 원문 그대로) → `#sample-day`(첫 예시 즉시, 3지역 ARIA 탭, 지도 링크 유지) → `#regions` → 압축 후기·신뢰·가이드 → 최종 CTA(플래너·WhatsApp).
- 300vh 핀 가로 스토리와 해당 CSS는 삭제. `CapabilityLedger.tsx`·`ServiceModules.tsx`는 렌더하지 않지만 단위 테스트가 import/read 하므로 남겨 둠.
- 모션: 행 제목 글리프 해소(영숫자·구두점 → 실제 제목, 약 0.6s, 진입 1회 + 마우스 hover/키보드 focus, `glyphResolve.ts`), 샘플 제목 단어 분할 등장(ReactBits SplitText 동작 번안, framer-motion `animate`). 감속 설정·IntersectionObserver 부재 시 최종 정적 텍스트.
- 함정(환경): 패키지 단위·범위 단위 junction 때문에 이 worktree의 `npm install`이 공용 런타임(소유 worktree `cocotrip-design-lint-20261005`)을 바꿨다. 복구 = 소유 worktree를 원래 lock 그대로 `npm ci`, 홈 worktree는 독립 `node_modules`로 자체 `npm ci`, GSAP 설치. 소유 쪽 `package.json`·lock은 변경 없음, 복구된 타입 패키지 존재 확인. 백업은 각 `node_modules/.recovery-before-gsap` 아래.
- 함정(백업): 백업을 `Move-Item`으로 옮기자 junction 내용까지 따라가 소유 쪽 두 번째 `npm ci`가 필요했다. junction이 섞인 의존성 백업은 절대 재귀 이동·삭제하지 말 것. root는 경로 확인 후 `Directory.Move`로 원자 이동했다.
- 함정(Vite): 첫 브라우저 실행 25건 전부 connection refused — `node_modules` 밖으로 이름만 바꾼 백업을 Vite가 스캔했다. 백업을 무시되는 `node_modules` 안으로 옮겨 해결. Vite는 현재 소스를 서빙한다(빌드 없이는 오래된 preview라는 이전 서술은 틀림).
- 현재 검증: root `npm run build` PASS, unit 3파일 47PASS, 대상 ESLint PASS. 홈 브라우저 2차 25건 중 20PASS·5FAIL — 5건 모두 `assertLayout`이 v3 이전의 390 접힌 패스(높이 ≥56)를 기대한 낡은 단언(v3는 767px 이하에서 `.home-dope-pass-wrap` 숨김). 헬퍼를 승인된 계약(폰: 패스 숨김·플래너 CTA+샘플 링크 뷰포트 안·가려지지 않음, 태블릿/데스크톱: 기존 패스 검사)으로 수정했고 5건 재실행 전이다. 브라우저 전체 PASS는 아직 주장하지 않는다.

- 최종 확인(15:36): 위 브라우저 미완 상태는 후속 결과로 대체한다. Opus가 폰 패스 숨김/실제 반투명 카드 대비4.5 이상/스크롤 전 첫 화면 위치로 낡은 검사 헬퍼를 보정했다. 기존20PASS 후 해당5개만 재실행5PASS(23.9s). 고유25개를 분할 실행한 결과이며, 단일 최신 전체25 재실행은 아니다. 마지막 테스트 파일 ESLint 및 diff PASS. 제품 변경 없이 검사/기록만 갱신해 빌드는 재실행하지 않았다. 사용자 실제 디자인 승인·실폰Safari·운영 검증은 남았다.

### 홈 브라우저 코멘트 3건 (2026-10-07, Opus 5.5 구현 · 검증 전)
- 교통: `#sample-day` 각 leg를 묶음 행으로 — 실제 `이전 정류지 → 현재 정류지`, 아이콘, 기존 `transit.label` 그대로(파싱·노선·실시간 생성 없음), 차량 leg만 "차량 기준" 꼬리표. leg마다 `naverMapDirectionsUrl([prev, stop], 'transit')`(정확히 2점) 외부 링크, 새 탭, 44px, 전체 경로 접근 이름. 예시/추정/비실시간 안내는 시트 상단 1회(4개 언어). `EXAMPLE_PLANS` 무변경.
- 푸터: **홈에서만** 1행(회사·연락처·결제·빠른링크)을 닫힌 네이티브 `<details>`로 감쌈. summary = COCOTRIP + 기존 `f.about · f.cs`(i18n 번들 무변경), 44px, 셰브론 회전. 법적 링크·쿠키 설정은 밖에서 항상 노출. 다른 페이지는 같은 JSX를 감싸지 않고 그대로 렌더(마크업 복제 없음).
- 하늘: `SkyLayer`에 aria-hidden 밖 재생/일시정지 버튼(44px, 히어로 우상단 헤더 아래). 상태는 `playing`/`pause` 미디어 이벤트로만, `play()` 거부는 catch 후 재생 아님 유지. 첫 `canplay`에서 1회만 자동 재생 시도, 사용자 일시정지 이후 재시도 없음. 감속모션·Save-Data·onError 시 비디오와 버튼 모두 없음(포스터). 밝기는 필터를 `.home-dope-sky` 한 곳(saturate .95 brightness 1.08)으로 옮겨 포스터·비디오 동일, 이중 필터 없음. 상단 오버레이 .75/35%, 하단 페이드 90%, 좌측 .55/45%.
- 실수 메모: Fable 브리프 5행의 "모든 페이지 푸터 적용"은 범위 오류로 홈 한정으로 정정. 브라우저 pause 원인은 미확인(코덱·자동재생 정책 단정 안 함). 레이어 필터는 `::before` 오버레이도 1.08배 밝힌다(의도된 근사). 빌드·unit·브라우저 결과는 root 실행 전이라 PASS를 주장하지 않는다.

- 주석3건 최종 로컬 확인 (2026-10-07 16:14 KST): root 최종 build/변경 ESLint/diff PASS, annotation 브라우저9PASS(14.4초, skip0). 실제390/1440에서 밝은구름·영상재생/정지·푸터열기/닫기·제주교통구간을 확인. 기존교통값/가격/다른페이지 구조 유지. 영상빠른실패 시 실제 error 초기상태도 읽어404폴백 통과; 원래 사용자탭이 멈춘 정확한계기는 미확인. 로컬 시안이며 사용자디자인승인/실폰Safari/운영은 미완.

- 홈 주석2건 (2026-10-07): 사용자 요청으로 푸터 직전 최종 CTA("1일차부터 시작하세요") 섹션을 `ClosingSections.tsx`에서 통째로 제거(카피 필드는 유지, 히어로·서비스의 플래너/문의 진입점 유지). 히어로 하늘 표기(bellergy / Pixabay)의 화면 노출 제거 — Pixabay 라이선스상 저작자 표시는 선택 사항. 내부 출처 기록(`public/home-dope/ASSET-SOURCES.md`)과 `photoCredit` 데이터는 보존. 교훈: 선택적 저작자 표시는 필수 UI 요소가 아니다.

- 홈 chrome 후속 (2026-10-07, Opus 5.5 구현 · root 검증 전): 챗 트리거를 홈에서만 44px 12px 라운드 어두운 타일(`.home-dope-chat-trigger`, raised 면·line-strong·잔그림자, `MessageSquareText`/`X` 20)로 교체 — 위치·핸들러·trackChatOpen·전역 open 이벤트·채팅 코어 무변경, aria-label 열림 시 `a11y.close`, aria-expanded/aria-controls=`chat-widget-panel`. 메뉴 열림(`html[data-menu-open]`) 동안 트리거·패널 `visibility:hidden`+pointer-events none, 열림 상태는 유지. 챗 입력 지연 포커스(100ms·50ms setTimeout) 콜백에서 `data-menu-open`이면 건너뛰어 메뉴 포커스 탈취 방지. 햄버거는 홈에서만 CSS 2줄 → X(220ms), 메뉴 패널은 진입만 220ms fade+6px, 메인 nav 소폭 stagger, 상단(헤더띠+로그인 영역 ~120px)에 기존 `v3-cloud-poster.jpg` 어두운 오버레이 장식. 닫힘은 기존대로 즉시. 감속모션 시 모두 정지. 원인 기록: 메뉴가 "끊겨 보인" 이유는 이미지 누락·깨진 URL이 아니라 구현상 기존 평면 리스트(이미지 요소·애니메이션 없음)였기 때문이다. 교훈: 시각 이질감은 리소스 결함보다 먼저 실제 마크업을 확인한다.

- 2026-10-07 추가 홈주석 최종 검증: CTA/선택적 출처 제거 단계 build+린트+기존2화면검사 PASS. 문의/메뉴 수정 후 최종 build+린트+관련7브라우저 PASS(9.2초,skip0). 실제 메뉴 구름/모션/문의숨김과 원복 확인, 검색·찜·언어 팝업 연결 확인. CSS폭325 모바일 실물/IAB 확대 상태와 자동390검사 구분. 로컬만, 실발송/운영배포 없음. 신규 포커스 검사는 모든 경쟁 타이밍을 결정적으로 재현한다는 뜻은 아님.

- 홈 메뉴 내용·열린 챗 패널 재디자인 (2026-10-07, Opus 5.5 구현 · **root 검증 전 / PASS 미주장**): `Header.tsx` 메뉴에 홈 전용 중립 래퍼(`home-dope-menu__account/main/groups/admin/strip`)만 추가 — href·라벨·admin/user 조건·로그아웃·언어·인증 핸들러·포커스트랩/Esc/스크롤잠금 무변경, 비홈은 클래스 없는 div라 기존 외관. 폰 1열(주 경로 20px, 내 여행/혜택 2열), ≥768 2열(1.4fr/1fr, max 1040, gap 32), 언어·지원·법적은 하단 띠, 모든 항목 44px. DOM 순서 유지로 데스크톱 탭 순서는 우상단 계정 → 좌측 경로(시각 순서와 다름, 수용). `ChatWidget.tsx` 열린 패널은 홈에서만 `skin()`으로 인라인 룩 대신 `.home-dope-chat__*`(기존 `--ec-*` 토큰, 그라데이션 없음, 컨트롤 44px, Google 흰 버튼 유지, 게스트 게이트 자동 높이, 160ms 진입·감속모션 해제). 아이콘 버튼 4개 언어 aria-label 추가. useChatSession·인증·분석·/assistant 무변경. e2e 2개(4언어×390/1024 메뉴, 390/1024 챗 무전송) 추가. 교훈: 공유 마크업은 래퍼+클래스 훅으로만 분기해 비홈 회귀면을 줄인다.

- 홈 메뉴본문·상담패널 최종 로컬 확인(2026-10-07): build/린트/diff PASS, 기존게스트gate4PASS, 관련17브라우저PASS/skip0(4언어390/1024 메뉴전href/44px/넘침 및 채팅FAQ/입력/닫기/확장,기존메뉴회귀 포함). 실제390x667 상담top68/가로넘침0 확인. 마지막1줄 input aria-label은 기존4언어PLACEHOLDER로추가, 그후최종build/린트/실제AX 이름확인;17검사재실행아님. useChatSession전후hash동일,실발송0/운영배포0. 디자인승인은사용자판단.

- 플래너 입력면 (2026-10-07, 로컬 시안 검증 완료·사용자 디자인 판단 대기): Fable 5.1 구성 / Opus 5.5 구현 / Astra 읽기 검토. 데스크톱은 안내 3.5/12 + 입력 8.5/12, 모바일 제목 28px·본문 14–15px·44px 이상 버튼. 긴 소개·다섯 입력 설명·모드 설명은 기존 문구를 보존한 닫힌 details로 입력 아래 이동. 선택형 WizardStepHint도 본문·다음 버튼 뒤로 이동했으며 초기 펼침/닫기/다시 열기·key는 유지한다. 각 단계의 필수·식이 안전 안내는 그대로다.
  - 기능 보존: 가격 고지는 무수정·항상 폼 앞, Wizard는 idle/error/loadingQuick 중 단일 인스턴스. 상태·요청·revision/snapshot·prefillRegions·5단계·오류 복원·직접 코스·결제·인증 변경 없음. WizardForm 변경은 도움말 JSX 위치뿐. 홈/Header/Footer/Chat 기존 승인 디자인 보존.
  - 실측과 검사: 390×844 한/영/일/중, 768 일본어·1024 중국어·1172 영어·1440 한국어 조합, 도시 사전입력·단계 잠금·직접 코스·움직임 감소 포함 브라우저 12 PASS. 기존 관련 5파일/61검사 PASS, npm run build·변경 파일 ESLint·git diff --check PASS. 실제 390 모바일/1440 PC 확인. 외부 통신 차단한 로컬 검사이며 실제 결제·생성·저장·Safari 실기기는 검증하지 않음. 원격 반영 없음.
  - 오답 기록: 중첩 grid의 암묵 auto 열이 자식 최소 너비를 강제해 1024/1172 화면에서 넘쳤다. 안쪽도 minmax(0,1fr)와 자식 min-width:0으로 수정했고 overflow 숨김은 쓰지 않았다. 새 테스트는 모바일에서 안 열리는 소개창을 기다렸으므로 실제 768px 조건에 맞췄다. 첫 선택지는 1.2화면이 아닌 하단 내비를 제외한 첫 화면으로 검사하며, 긴 선택형 도움말을 입력 뒤로 옮겨 통과했다. 모션은 기존 duration 토큰 사용·감소 설정 유지.

- 홈/플래너 일체감 후속 (2026-10-07, 로컬 첫 입력 시안): 실제 Fable5.1 규칙 정리, Astra 범위 검토, Opus5.5 제품/검사 코드. isHomeChromePath는 정확히 / 및 /planner에서만 기존 Header 메뉴와 Footer 접힘/외형을 공유한다. ChatWidget은 기존 App의 홈 전용 장착 유지, 모바일 Footer 추가 없음. Planner 직접 진입에도 기존 home-dope.css를 불러온다.
  - 공유 방식: Home의 실제 CJK serif/Latin 이탤릭·반투명 재질·10.8px 모서리·48px 캡슐 CTA 선언을 선택자로 공유. 기존 홈 크기·영상·메뉴·버튼 값은 보존. 첫 예약 상태는 중첩 카드/아이콘 상자 없이 4개 전체폭 행과 선택 체크, 설명 말줄임 제거. 첫 단계 marker가 있을 때만 구름 정지 이미지/티켓 재질, CTA 위 점선. 마스크로 입력/초점/오류를 자르지 않음. 제목/질문 스크램블 추가 없음.
  - 기능: 가격/무료/쿠폰/환율 안내 전체는 폼 앞에 무수정, 입력 상태·예약 선택 정리·누락 초점·5단계·뒤로/수정/도시 사전입력·직접 코스 유지. 2~5단계 재디자인 안 함. 핵심 상태/금액/식이/수정/직접코스/상담 8파일 해시 동일, WizardForm/index.tsx도 직전 시안과 동일.
  - 검증: 최종 build/변경 ESLint/diff PASS, 관련7단위파일78 PASS. 브라우저 고유29개 최종 PASS(첫 묶음28 PASS/1실패 후 해당검사 포함3 PASS, 동작영상1 PASS 별도): 홈4언어*5폭/메뉴, Planner390 네언어+768/1024/1172/1440, 외형 범위·기존 단계/오류·뒤로 선택보존·직접코스·감속. 모든 외부 차단/로컬 API mock. 실제390/1440 화면 및 메뉴 열기/닫기·초점복귀 확인. 실폰Safari/운영·실생성·결제·저장 미검증. 로컬 시안이며 디자인 최종승인은 사용자 판단.
  - 오답 기록: 넓은 workspace 구름 선택자가 다음 단계/직접코스까지 번짐 -> firststep :has로 제한. 기존 ec-option 글자 규칙 삭제는 목적지 단계에도 영향 -> 복원. 영상 설정은 describe 안이 아닌 worker 설정 위치에 둠. 오래된 gradient 전면 금지 검사는 승인된 첫 단계 장식의 alpha mask 두 선언만 예외, 배경/글자 gradient 금지는 유지. 투어의 기존 POST reviews aggregate는 조회이므로 새검사가 저장으로 오인; 해당 한 요청의 정확한 본문만 확인하고 나머지 nonGET 차단/검사를 유지.
- 홈/플래너 첫 입력 최종 보완 (2026-10-07): 실제 Fable5.1 디자인 판단/Astra 읽기 검토/Opus5.5 제품 및 검사 코드. 승인 홈은 보존. editorial-planner.css에서 흰 산세리프 제목, 캡슐 모드 버튼, 첫 카드 양옆 13px 장식 및 조금 진한 절취선을 적용. 바코드/마스크/새 기능은 추가하지 않음. ChatWidget은 홈 전용 장착 유지(입력 CTA 가림을 피하며 플래너에 기능을 새로 붙이지 않음). 2~5단계와 항공편 추가 입력 내부는 기존 스타일이며 전체 디자인 완료가 아님.
  - 최종 검증: npm run build(tsc -b 포함), 변경 검사파일 ESLint, diff PASS. 관련 3파일49 unit PASS. 브라우저 고유16개 최종 PASS는 15PASS/감속1FAIL 뒤 수정된 감속1PASS 및 녹화상태1PASS 분할 실행 근거. 새 실패는 전역 0.01ms!important와 로컬0초 충돌; 처음 !important 교정은 기존 금지 계약에 실패했으므로 폐기하고 transition-property:none으로 실제 전환을 제거했다. 기존 계약 유지, 새 브라우저 검사는 행/CTA/모드7개의 실제 전환 없음 확인. 핵심8파일 해시 유지. 외부 차단/로컬 API mock, 유료생성/발송/결제0.
  - 화면 원본: outputs/home-dope-local-20261007/cohesion-final/final-home-1440.png 및 final-planner-1440.png는 각1440x1000, final-home-390.png 및 final-planner-390.png는 각390x844. 원본 PNG 직접 확인. final-interaction-v2.mp4는 실제 브라우저 녹화390x844/H264/7초이며 동작 프레임을 별도 확인. 초기 녹화는 단계이동 뒤 FAQ가 보여 녹화 전용으로 입력 상태까지 스크롤해 재녹화(제품 스크롤 수정 아님). 영상과 정지화면 증거를 구분한다.
  - 대비: 캡처에 해당하는 계산색/배경을 사용한 표시중 글자·버튼문구36개 표본 최소7.24:1(선택행 보조문구), 일반문자4.5:1 기준 충족. 전체 사이트 AA/모든 배경·시간·언어 인증 아님. 단독 tsc --noEmit은 저장소 규칙상 실행하지 않음, build 실제 타입단계 통과. Android 원격 전달은 별도 Library 연결 확인 대기; E:/ 및 localhost를 휴대폰 전달 완료라 하지 않음. Safari 실기기/운영 미검증, 배포0. 이번 최종 보완 Claude API환산USD1.2784621(실제구독 청구액 아님).

- 플래너 첫 입력 선택 중심 간소화 (2026-10-07): 사용자 승인 후 Fable5.1 설계/Opus5.5 제품·검사/Astra 범위검토. 이번 제품 변경은 editorial-planner.css의 첫 marker(:has(.wizard-res-ticket)) 범위뿐. 도입/모드·가격소제목/예약맞춤문장/선택지보조문장/20%/막대를 첫 단계에서만 숨기고 1of5+기존5단계버튼을 한 그룹으로 정리. 질문·4선택·계속을 우선하며 56px행/48pxCTA/44px컨트롤과 글씨 크기 유지. 가격3항목+환율고지는 원문/formatter 그대로 설문전 노출, 줄선과 행여백만 정리. 홈/다음4단계/직접코스/로직/가격문구 TSX 미변경.
  - 검증: 보호32파일+대상입력/가격TSX6파일 해시 동일. 관련8파일139unit PASS; 최종초점CSS수정뒤 해당31계약 재검사 PASS. 최종코드 npm run build(tsc -b), ESLint/diff PASS; 최종브라우저16개 전체 한 번에PASS(40.9초) 및 실제녹화1PASS(12.8초). 390네언어+768/1024/1172/1440, 가격선행/44px/넘침/CTA/단계잠금/공항누락/선택복원/도시미리입력/직접코스/감속/첫단계범위 확인. 원격접속/유료생성/실전송/결제/배포0. 실기기Safari 미확인.
  - 직접 확인한 개선: 한국어390x844 계속 버튼 y885.30→709.61px, 높이48px 그대로로 첫화면 하단탭 위에 네 선택과 함께 노출. 모든 언어에서 처음부터 전체폼이 한화면에 들어온다는 뜻은 아님; 긴언어는 스크롤 후 CTA가림 검사. 읽히는 제목·버튼27표본 최소11.00:1. 가격 rgba.8/.68는 실제계산색으로 확인, 흰포스터가 opacity.22로 깔린 보수적 상한 배경에서도 각각7.23/5.74:1(전사이트AA인증아님).
  - 오답: 영상재실행에서56px가55.9999389648로측정돼실패→측정값소수2자리 반올림, 실제44px최소기준불변. 실제키보드Tab에서 ol overflow가바깥초점그림자를잘라오른쪽선만남음→첫단계버튼에안쪽2px outline/offset-2/그림자제거, 네면직접확인/브라우저회귀추가. 단위/화면검사실패를숨기지않았고기존검사삭제없음.
  - 원본 E:/ai에이젼시만들기/outputs/home-dope-local-20261007/planner-choice-20261007/before 및 after: 각 final-planner-1440.png(1440x1000), final-planner-390.png(390x844), Home동일크기쌍. 최종 after/final-interaction.mp4(H264/390x844/9.64초)/.webm은 실제 동작녹화, 선택/오류/step2/Back 프레임 직접확인; 녹화용 상태별 스크롤 포함. IAB초점전후별도원본 보존. 이번 실제Claude API환산USD2.4404725(실제구독청구아님; 첫Fable상한종료뒤재조사없이짧은판단회수 포함). 사용자검토전추가확대0. Library전달은조율세션담당, 이세션업로드0/ID없음; 로컬경로는휴대폰전달완료아님.

- 플래너 모바일 첫 입력 마지막 정리 (2026-10-07): Fable5.1 문구·구성, Opus5.5 제품/검사 코드, Astra 읽기검토. 질문4언어와 한국어 선택문구를 짧게 하고, 첫 화면에만 단축 번역키를 적용(공유 resTitle/res*Title 원본 유지). 모바일 단계 수는 화면낭독용, 기존 5개44px 버튼은 한 줄. 첫 단계 반복힌트/마케팅 신뢰목록만 숨김; 공항/시각/오류/재개 안내 보존. 가격3행+환율 고지 모두 설문 전에 표시, 첫 단계만 짧은 문구, 다음 단계 원문과 실제금액 formatter 유지. 새 의존성/상태/업무로직 없음.
  - 실측390: 질문19px/선택15px/계속15px 그대로, 요금13->14px/환율12->14px. 한국어 계속 y709.61->680.36px, 높이48px 동일. 요금 rgba.8/환율.68, 구름opacity.22와 흰 배경 상한 계산에서도 대비7.23/5.74:1(해당 안내만, 전체AA 아님). 홈/돈/주요핸들러 보호32파일 해시 동일. PC구조/2~5단계 유지.
  - 최종검사: npm run build(tsc-b), 변경 ESLint, diff PASS. 관련8단위파일139 PASS, 번역2226키4언어정합 PASS. 최종35브라우저 한 묶음 PASS(1.1분): 360/390/430/1440 네언어와 중간폭, 누락/단계잠금/선택보존/도시사전입력/직접코스/감속/초점/가림. 외부차단/로컬API mock. 200% CSSzoom은 두배viewport에서, 150%문자크기는 실제px배율변경으로 검증한 모사이며 실제Safari/native browserzoom 확인이 아님. 최종35묶음 전 녹화1PASS/11.04초 실제 동작영상도 확인. 마지막 번역키 복제는 기존fallback과12값완전동일 확인; 영상 내 표시 동일.
  - 오답: (1) 공유 resTitle/KO선택제목 변경은 후기검토에도 퍼짐 -> 첫화면 전용키+기존키복구. (2) 한국어 금액 뒤 조사오류 -> 콜론형 참고원화표기로 수정. (3) 축약키를KO만추가하라는 주담당 지시로 번역정합12오류 -> 다른3언어 기존표시문구를 그대로 복제, checker유지. (4) 확대검사 scrollIntoViewIfNeeded는 고정하단메뉴를 계산하지 않아390zh CTA hit검사1실패 -> 중앙까지 실제스크롤+trial click+동일hit검사로 도달가능성확인. 제품변경/검사삭제/기준완화로 통과시킨 것이 아님. 새검사 literalUSD는 중국어美元를 인정하고 new ??는 ||로 교정. 최초31PASS/1FAIL, 보완8PASS, 마지막35전체PASS 근거를 구분.
  - 전달원본 E:/ai에이젼시만들기/outputs/home-dope-local-20261007/planner-mobile-final-20261007/{before,after}/final-planner-1440.png(1440x1000)/final-planner-390.png(390x844), after/final-interaction.mp4(H264390x844/11.04s) 및webm. 전후Home쌍/계산글자데이터/실제녹화프레임 보존. before/computed-fonts-390.json의 실제viewport390x844 확인, 다른IAB파일은 각실제viewport기록으로 구분. Library 업로드는 조율세션 담당, 이 세션 업로드0. Claude API환산USD2.8834568(실제구독청구아님; 읽기제한으로1회무수정종료포함). 로컬미커밋, push/merge/배포/실API0. 실폰Safari/운영 미확인, 사용자 디자인확정 전 다음단계 확대 없음.

- 승인 확장: 플래너 후속 단계·결과·투어 (2026-10-08, 로컬 구현 및 검증 완료, 실폰 디자인 판단 대기)
  - 최신 사용자 승인으로 기존 첫 단계 전용 제한을 확장했다. Fable5.1 설계, 실제 Claude Opus5.5 세 담당 병렬(Planner2~5 / result+preview / tours) 및 한 명의 공유스타일 통합, Astra 최종 읽기 검토. root는 제품/검사 코드 작성 없이 조율·실행검사·화면/영상·기존문서만 담당. E:/cocotrip-home-dope-20261007 / codex/home-dope-local-20261007 / fe12bef3 미커밋 유지.
  - 구성: Wizard 단계 표식/선택·요약을 짧은 섹션과 기존 캡슐 버튼으로 통일; 결과에는 plan-result-night/plan-preview-night만 적용; 투어 목록은 모바일 사진+핵심정보 행, 상세는 단정한 사진/정보/고정 예약 표시. 후속 질문의 유리 재질은 home-dope.css 선택자만 공유하고 홈 선언은 유지했다. 금액·조건·입력·검증·인증·PDF/공유·번역 원문/실제 링크/핸들러 변경 없음. 새 의존성 없음.
  - 범위: 기존 사본215항목은 정규화204파일. 제품13TSX 표시/클래스와 CSS5개, 검사5개, 이 기존문서1개. 기존사본18파일 변경 외186해시동일(이 문서 갱신 전). QuickPreview 조건·팁은 기존14px를 유지. 가격은 기존 첫 단계용 짧은 안내를 후속 단계에서도 쓰되 무료/신규쿠폰/유료/USD실결제/참고원화/카드환율 조건과 formatter 유지.
  - 검사: 관련20단위파일242PASS, CSS 최종보완뒤5파일60재확인PASS. 브라우저64묶음PASS + 새360/430/768폭6PASS + lazy상태1PASS + 실제입력→요청생성→mock무료미리보기1PASS = 고유72PASS(분할실행); 마지막프레임변경4PASS/결과앵커변경1PASS. 390/1440 네언어와 선택360/430/768/1024/1172폭, 단계누락/잠금/뒤로보존/직접코스/탭/펼치기/필터/갤러리/FAQ/44px/가로넘침/키보드초점/감속 확인. 확대는 기존 첫단계 CSSzoom/text모사로 실Safari검증 아님. 최종 npm run build(tsc-b), 변경ESLint, diff,2226번역키4언어 정합PASS; html2pdf 큰번들 경고 남음. plan:test sample은 실제외부차단 offlinePASS와 기존fixture경고12로 구분.
  - 오답: reviews POST list/aggregate 읽기를 새 결과검사가 저장으로 오인해 최초2PASS9FAIL -> 정확한경로/본문읽기만인정, 다른쓰기차단유지. 모바일투어계절안내겹침 -> 배치보완. 새 :has(.wizard-stage)는 lazy시부재로옛40%막대/설명이flash -> 로딩중에도있는progress aria-valuenow로후속범위판단, 실제모듈지연검사. preview13px는원래14px보다작아짐 -> 14px복구/실브라우저값확인. usePlannerHandlers의 기존100ms뒤smoothscroll이헤더아래제목을가림 -> #planner-quick-result에기존wizard와같은5rem scroll-margin, 실제자동scroll좌표검사. 검사촬영용수동scroll제거. 새test ?? -> ||. 기존기능검사삭제/실패은폐/외부보호완화 없음.
  - Claude 통합CLI는 80turn상한(exit1/error_max_turns)으로 끝났고 완료 응답이 없었다. 파일을 보존한 채 root가 검사를 이어받고 재현된 작은 결함만 실제Opus로 교정했다. 제품 최종빌드/검사통과와 이 CLI종료를 구분한다. Astra 초기통합읽기검토 이후 마지막3CSS차이도 추가확인, 직접검사실행했다고 보고하지 않는다. Claude API환산총USD10.7439456은 실제구독청구액이 아니다.
  - 전달 원본: E:/ai에이젼시만들기/outputs/home-dope-local-20261007/expansion-20261007/final. 단계PNG는 {390,1440}-ko-{2-destination,3-food,4-details,5-review}.png; 결과는 plan-result-night/{390,1440}-ko-{top,timeline}.png; 투어는 tours-{catalog,detail}-{390,1440}-ko.png. 최종 무료미리보기 quick-preview-390-ko.png. preview-journey.mp4는 실제브라우저 H264390x844/11.12초, 가짜응답을쓴입력→무료미리보기이며 원본WebM/8초프레임 확인. 동폴더 local-interaction.mp4는 마지막앵커교정 전 편집본으로 최종전달용 아님. home-first의 홈/첫화면도 재확인(PC첫화면은이전PNG와pixel동일, 모바일은스타일/배치보존 및실화면비교; 영상·안티앨리어싱때문에모든pixel동일이라하지않음).
  - 남은 경계: 실제폰디자인승인/Safari/운영/실AI생성/실저장/실예약·결제 미검증. 테스트는 서비스워커와 모든외부통신차단, API 경계만mock; 일부외부사진/지도타일대체화면/저장공개자료안내는격리환경상태다. 운영DB/유료제품API/발송/push/PR/merge/배포/예약변경0. main...origin/main=0 0은로컬추적값, 원격OPEN PR미조회. localhost와E:/는휴대폰Library전달완료가아니다. 새보고서/Desktop파일없음. 다음은사용자화면판단후작은보완, 무관한페이지나운영반영 자동시작안함.

- 2026-10-08 전달 영상만 추가: 기존 최종 preview-journey.mp4 + 기존 유효 일정결과/투어 raw WebM을 이어 붙인 final/final-interaction-all.mp4 (H264390x844/19.36초/989200바이트). 마지막 CSS 변경은 QuickPreview 14px/스크롤앵커와 Planner 로딩 프레임뿐이므로 기존 결과·투어 영상 유효. 새 구현/재녹화/재설계/검사재실행 없음. 세 별도 시연(실제입력+mock응답 미리보기 / 합성 결과예시 탐색 / 공개정적 투어 탐색)의 편집본이며 실제유료생성·예약 성공영상 아님. preview-journey.mp4와 기존 raw 모두 보존, 예전 local-interaction.mp4는 전달하지 않음. 최종합본14/19초프레임 직접확인. Library업로드는코코담당, 이세션업로드0.

- 2026-10-08 PC 캡처 규격 보완: 실제Opus가 planner-expansion-local.spec.ts:114의 desktop height900->1000 한값만수정, 제품코드변경0. 기존1440ko case 1회11.3s PASS로단계2~5/누락화면6PNG재캡처. 최종PC는 outputs/home-dope-local-20261007/expansion-20261007/final/planner-pc-1440x1000/의1440-ko-{2-destination,3-food,4-details,5-review}.png; 실제치수1440x1000 전부확인/5단계화면직접확인. 기존900높이PNG원본보존. 모바일기존4PNG는모두390x844확인. 전체검사/빌드반복0. 이추가Claude API환산USD0.041077(구독청구액아님), 확대작업누적USD10.7850226. 최종영상final-interaction-all.mp4 그대로유효.


### 2026-10-08 후속 화면 절제 재검토 (02:48 KST, 로컬)

- 홈과 승인된 플래너 첫 입력을 보존하고 플래너2~5/결과/투어만 개선. Fable5.1 초기 방향, 실제Claude Opus5.5 3담당 병렬 구현/일반검증, Astra 마지막 통합검수. root 제품/검사코드 작성0, 조율·검사실행·화면/영상·기존기록 담당. 제품10파일은 범위CSS/표시클래스/투어사진 순서만; 입력/검증/계정/식이/금액/환율/취소/공유/PDF 로직과 기존미커밋 보존. 기존240파일 해시대조에서 범위외변경0, 승인된 첫 입력CSS prefix동일.
- 반복 외곽카드/테두리/칩 장식 축소, 후속질문20px/PC28px·500굵기, 사진 선택과 단순 검토행, 시간→장소→이동 타임라인, 투어 큰사진→상품·조건 흐름. 보라색은 주요행동/선택 중심. 중요 예약문구12px→14px는 실제 펼친 가상조건에서 확인; 금액·내용변경0. 실제표본 대비최소9.15:1은 전체AA 인증이 아님.
- 최종관련28unit/342PASS, 전체92browserPASS 후 마지막 예약문구 관련20결과+대표플래너/투어 재확인PASS, npm run build 타입/빌드PASS, 변경파일eslint/diff/4언어2226키PASS. 360/390/430/1440 및 일부태블릿, 줄바꿈/넘침/앞뒤·입력유지/가격·조건/실키보드·44px/감속 확인. 기존 큰PDF번들·혼합import·HeroSlider duration 경고 남음. 실폰Safari/운영/실유료생성·저장·예약 미검증.
- 오답: 서울2일/요약1일은 가상데이터 불일치라 2일/4장소로 교정(제품일수로직수정0). 다중지도 strict selector와 옛외곽radius/배경 검사 교정; 기존승인 alpha mask를 색칠 gradient로 오인하던 테스트만 한정수정. 추가포커스의 없는 .ec-option-sm을 실제도시버튼으로 교정. 예약조건 검사가 없는 class를 찾던 문제는 실제가상조건+펼침·가시성·14px 확인으로 교정. 기존기능검사삭제/외부보호완화0.
- 원본 E:/ai에이젼시만들기/outputs/home-dope-local-20261007/refinement-20261008. before/screens와after의같은크기 PNG, mobile-before-after.png(390x844각화면), pc-before-after.png(1440x1000각화면), final-interaction.mp4(H264390x844/20.87초/1042406바이트). 모바일투어전후는양쪽조회실패상태이며 정상fixture캡처는따로보존. 외부지도회색/일부사진차단은격리상태이지복구완료가아님. 영상은실제입력·탭·사진전환을편집한독립3로컬시연/API mock이며실생성·예약성공영상아님. 원본WebM/실프레임확인. 최종디자인승인은사용자판단이며검사통과와구분.
- Claude사용량API가격환산USD7.36137495는이번재검토분이며실제구독청구아님. 새유료제품API/라이브러리/운영DB/push/merge/배포/예약변경/새보고서/Desktop파일0. 09시전완료했고새작업시작안함. 다음우선순위: 사용자폰디자인판단, 실제Safari, 승인된환경에서실데이터연결검증.


### 2026-10-08 09:39 KST Fable 후속 의견 로컬 반영

- 사용자 최신 승인으로 읽기 전용 제한을 해제. 기존 실제 Fable5.1 리뷰와 Astra의 한 번 읽기 합의 후 실제 Claude Opus5.5가 결과/미식/목록을 병렬 구현. 제품13파일·검사7파일, root 제품·검사코드 작성0. 기존 미커밋 유지, 새 의존성/새 제품파일0. 보호547파일과 승인된 첫 입력 CSS prefix 동일.
- 결과: 일수·장소·인원·날짜 요약을 제목 영역에 한 번만 표시, 날짜4언어 현지화(UTC 날짜 밀림 방지), placesUnit 경로/WhatsApp4언어 교정. 차량·전체 다도시·T-money·공유/번역/도착 안내 유지. 지도3행을 compact 한 행으로, 접근성 이름에 실제 표시 Naver/Google 포함, 링크 우선순위·44px·소유자 행동·제휴·팁/조건 보존.
- 미식: 중복 장식 경고아이콘만 제거, 필수 식이 선택·누락위험 문구14px 그대로, 매운맛을 내용 폭에 맞는 줄바꿈 선택으로. 제한/비활성/가격값/상태 전달 변경0. 투어: 필터→상품→지역 순서로 이동, 모바일 첫 상품 사진·이름 화면내 확인, 결과 수15px/짧은 목록 제목/계절 전문 접근 보존. 상세/예약조건/계산 변경0.
- 최종28unit351PASS, 56후속browser+6홈/첫입력 보존browser=62고유PASS, 마지막 날짜/영문문구 뒤 좁은3case재확인PASS. npm run build 타입/빌드·변경범위eslint·4언어2227키·diff PASS. 360/390/430/1440 네언어, 일부768/1024, 초점·44px·감속·앞뒤/누락·필터·지역·지도주소·공유/PDF 관련 회귀 확인. 실폰/Safari/외부 지도타일/실시간 상품조회/실생성·예약·결제 미검증.
- 오답: flex만 바꾸고 공통 width100%를 남겨 매운맛이 길게 쌓임→범위width auto; map행 공통버튼padding/font로2줄→범위grid/여백; 새 날짜 helper export가 FastRefresh린트 위반→private함수+실제컴포넌트4언어검사; 360영문 Directions 단어갈림→기존 EN키 Route. 검사삭제·게이트완화0. grep앞앵커로검사0선택은실행선택오류로구분. 자동생성된 기존 tests/report/index.html은 clean baseline HEAD 원본으로만 복원/생성본증거보존, 사용자변경복원·삭제0.
- 증거 `E:/ai에이젼시만들기/outputs/home-dope-local-20261007/fable-followup-20261008`: mobile-before-after.png와 pc-1/2/3-before-after.png는 원본같은크기 비교. 원본PNG/WebM, final-interaction.mp4=390x844/H26421초 실제3독립로컬시연(API mock), 지도가회색인격리상태를복구로보고하지않음. 검사진행으로디자인최종승인대신하지않음.
- 실제 Claude 이번 API가격 환산 USD2.906093, 실제 구독청구액 미확인. 새 유료제품API/운영DB/실전송/push/merge/배포0. branch codex/home-dope-local-20261007/fe12bef3 미커밋 로컬보존. main...origin/main 로컬참조0 0(fetch0), 새PR0/기존원격PR미조회.

### 2026-10-08 T-money 빈 행·투어 지역 선택 후속 보완 (로컬)

- 사용자 승인 두 항목만 실제 Claude Sonnet5.5가 제품2·기존 검사4파일 수정. IntroSlide는 유효한 양수 권장액일 때만 행을 표시하며 공유 formatKRW·금액 계산은 유지. 투어 아래 지역 선택 후 결과 영역으로 이동하고, 키보드 선택은 결과 제목으로 초점을 옮겨 다음 Tab이 상품으로 이어지게 함. 동일 지역 재선택·검색/필터/정렬·감속 설정 보존.
- 지역 선택 전 서울 결과 제목 y=-1094/첫 상품 y=-1055로 화면 밖에 남는 문제를 격리390px에서 재현. 수정 후 지역8case(360/390/430/1440 KO·390 EN/JA/ZH·키보드/감속) 및 T-money 화면2case(0원 행 없음·35,000원 표시), 최종 관련 unit94·변경 ESLint·4언어2227키·diff·npm run build 모두 PASS. 초기 TS2345는 지역 키 union을 반영해 수정, 마지막 빌드에서 통과. 실제 폰/Safari·운영 데이터/거래 미검증, 기존 청크 크기 경고 유지.
- root 최종2386해시 대조에서 제품2/검사4 외 변경·누락0, 기존 tests/report/index.html 동일. 모바일·PC 지역 결과와 두 T-money PNG 직접 확인. 근거는 outputs/home-dope-local-20261007/tmoney-region-followup-20261008; Claude 영수증3회 API가격 환산USD1.0171502(실제 구독 청구액 아님). 실행 초기 npx·환경접두사·복합 Bash의 허용목록 불일치 및 20회 제한은 기존 변경에서 인계해 해결; 설치된 로컬 명령과 Read/Edit를 사용하고 보안 완화·검사 삭제0. 새 의존성/운영DB/유료제품API/실거래/push/merge/배포0.


### 2026-10-08 18:00 KST 검색 조건 복원·키보드 질문 초점 보완 (로컬)

- 기존 미커밋 보존, 실제 Claude Sonnet5.5 제품2/기존 검사2/새 로컬 검사1 구현, Luna 조율·Astra 읽기 최종 검토. Tours는 q/region/sort를 기존 URL로 복원하고 빠른 입력은 즉시 표시, 기본값·잘못된 값·다른 URL 변수 보존. 상세 뒤 Back의 DMZ/price-asc/1건과 검색어가 바뀌는 Back/Forward를 실제 UI로 확인.
- Wizard는 키보드 단계 변경 때 실제 질문이 준비된 뒤 제목을 중앙에 즉시 표시하고 초점 이동. 최초 진입·포인터·자동 복원·검증 잠금 유지. 오답: DOM 초점만 확인하면 제목 top0.11/header57px 가림을 놓침; 기본 focus도 헤더를 고려하지 못해 기존 표준 scrollIntoView(center, instant)+focus(preventScroll)로 보완. 모바일 소개창은 원래 없음, 공항 선택창 Tab 순서는 별도 미확인으로 보존하며 공항은 실제 tap으로 선택한 뒤 질문 전환을 검증.
- 최종 소스 unit110(투어90/기존 Wizard20), 최종 질문 Chrome4+WebKit1 및 투어 복원2 PASS. 관련 ESLint/4언어2227키/diff/npm run build 타입·빌드 PASS. PC1280px/모바일393px 질문 가시성·다음 Tab, 투어390px 실제 UI·외부 차단/API mock. 초기 CLI npx/복합 명령 거절은 기존 허용 Node로 동일 Claude에서 실행, 허용목록 확장·다른 실행자 우회0.
- 근거 outputs/home-dope-local-20261007/local-ui-fixes-20261008: 투어 같은390x844 전후PNG, planner/final-{pc,mobile}.png, 실제 투어5.8초 tour-back-final.mp4. 범위 외 파일·누락0/기존 tests/report 동일, 사업조건·홈·첫입력 스타일 보존. 기존 큰 PDF/혼합 import/duration 경고, 실제 폰 Safari/운영·실거래/모바일 공항 전체키보드/기존200%문자모사 넘침 원인은 미검증. 새 의존성/운영DB/유료제품API/실전송/push/merge/배포/바탕화면 보고서0. Claude13회 가격환산USD2.427726은 실제 구독청구액 아님.
