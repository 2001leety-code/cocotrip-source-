# Coupon Event Ad and Design Brief

Last updated: 2026-07-01 by Codex

## Purpose

This is the handoff file for the Google-login coupon event and related ad/design work.
Update this file whenever the event offer, coupon rules, landing copy, ad copy, banner,
modal, or homepage promo design changes.

## Current Event Offer

When a user signs in with Google, CocoTrip gives three travel coupons:

1. AI auto itinerary coupon
   - 1 use.
   - For a 3-day automatic AI plan.

2. Airport pickup / charter coupon
   - 5% off.

3. Multi-day / long-distance segment coupon
   - 5%+ coupon.
   - Maximum discount messaging: up to 10%.

## Positioning

Do not lead with only "5% off". Trip.com often displays "up to 12%", so our offer can
look weaker if we compete only on percentage.

Lead with the bundle value:

- 3 coupons just for Google sign-in.
- AI itinerary + airport pickup/charter discount + multi-day/long-distance discount.
- Korea trip planning and transportation in one place.

Recommended main message:

```text
Get 3 Korea travel coupons with Google sign-in
AI itinerary coupon + airport pickup 5% + multi-day routes up to 10%
```

Korean operator-facing wording:

```text
구글 로그인만 해도 한국여행 쿠폰 3장
AI 일정표 1회 + 공항픽업 5% + 다일구간 최대 10%
```

## Comparison Guidance

Avoid direct claims like:

```text
Cheaper than Trip.com airport pickup
```

Reason:
- Price can vary by date, vehicle, region, coupon, and Trip.com campaign.
- Direct comparison may create ad review or credibility risk.
- It also frames CocoTrip as a cheaper clone instead of a Korea route/planning platform.

Use safer value copy:

```text
Airport pickup from CocoTrip special rates
Sign in with Google and get a 5% pickup coupon instantly
```

```text
Plan your Korea trip and save on airport pickup
AI itinerary coupon + pickup discount included
```

## Google Ads Copy

### Headlines

Use short variants. Keep the bundle visible.

```text
Korea Travel Coupons
Get 3 Coupons with Google
AI Itinerary + Pickup Coupon
Airport Pickup 5% Off
Korea Routes Up to 10% Off
Plan Korea with AI
Korea Trip Planner Coupon
Save on Korea Airport Pickup
```

### Descriptions

```text
Sign in with Google and get 3 CocoTrip coupons: AI itinerary, airport pickup, and long-route discounts.
```

```text
Build your Korea itinerary and save on transportation. AI plan coupon plus pickup and charter discounts.
```

```text
Get an AI Korea route plan and travel coupons in one place. Great for airport pickup and custom routes.
```

### Korean Reference Copy

```text
구글 로그인만 해도 한국여행 쿠폰 3장 지급
AI 일정표 1회 + 공항픽업 5% + 다일구간 최대 10%
```

```text
한국여행 일정표와 이동 할인쿠폰을 한 번에
AI 플랜, 공항픽업, 차터 이동까지 코코트립에서 준비하세요
```

## Required Fine Print

Always include a small, readable disclaimer near event UI:

```text
Coupon conditions may vary by product. Final discount is confirmed at checkout.
```

Korean:

```text
쿠폰별 적용 조건이 다를 수 있으며 최종 할인은 결제 단계에서 확인됩니다.
```

If using "up to 10%", the page must have supporting condition copy:

```text
Multi-day and long-distance route coupons may receive up to 10% off depending on route and product type.
```

Korean:

```text
다일·장거리 구간 쿠폰은 상품과 구간 조건에 따라 최대 10%까지 적용될 수 있습니다.
```

## Design Direction

The design must match the current CocoTrip dark navy + purple/pink style used in the
charter, tours, and planner redesign. Do not make a loud generic coupon poster.

### Tone

- Premium, compact, travel-app style.
- Similar density to Trip.com mobile cards, not oversized.
- Clear benefit hierarchy:
  1. "3 coupons"
  2. AI itinerary coupon
  3. Pickup/charter 5%
  4. Multi-day up to 10%

### Avoid

- Giant single pink gradient block.
- Too many confetti/orb decorations.
- Beige/brown travel agency look.
- Claiming direct superiority over Trip.com.
- Showing only "5%" as the main hero number.
- Hiding coupon conditions in unreadable text.

## Homepage Event Banner

### Desktop Layout

Use a slim full-width promo band under or near the header, not a huge hero.

Structure:

```text
[Gift icon] Google sign-in bonus
Get 3 Korea travel coupons
AI itinerary coupon · Airport pickup 5% · Multi-day routes up to 10%
[Get coupons]
```

Sizing:
- Max width: match page content width.
- Height: 64-76px desktop.
- Border radius: 18-22px.
- Background: navy/purple surface, subtle pink accent.
- CTA: compact gradient pill.

Suggested colors:

```css
background: linear-gradient(135deg, rgba(18,45,88,.92), rgba(26,12,43,.88));
border: 1px solid rgba(182,104,252,.24);
accent: linear-gradient(135deg, #B668FC, #FF6B9D);
text-primary: #FFFFFF;
text-muted: rgba(255,255,255,.56);
```

### Mobile Layout

Use a compact card, not a tall ad.

Structure:

```text
Google sign-in bonus
3 Korea travel coupons
AI plan · Pickup 5% · Routes up to 10%
[Get coupons]
```

Sizing:
- Width: page content width with 16px side margin.
- Padding: 14-16px.
- CTA can be full width only if the card is stacked.
- Keep the full banner visible in one mobile viewport without pushing core product cards too far down.

## Coupon Cards

Show three small coupon cards after login or inside the coupon modal.

### Card 1: AI Itinerary

```text
AI itinerary
1 free 3-day auto plan
```

Visual:
- Icon: Sparkles / Route / Map.
- Accent: purple.
- Badge: `1 use`.

### Card 2: Airport Pickup / Charter

```text
Pickup & charter
5% off
```

Visual:
- Icon: Car / Plane.
- Accent: blue-purple.
- Badge: `transport`.

### Card 3: Multi-Day Routes

```text
Multi-day routes
Up to 10% off
```

Visual:
- Icon: Route / Calendar.
- Accent: pink.
- Badge: `long routes`.

Desktop:
- 3 columns.
- Card height 112-130px.

Mobile:
- Horizontal scroll cards or 1-column compact list.
- Each card height 76-92px.

## Modal / Sign-In Prompt

When prompting sign-in, make it feel like a benefit, not an account wall.

Title:

```text
Get your 3 Korea travel coupons
```

Subtitle:

```text
Sign in with Google to claim your AI itinerary coupon, pickup discount, and route coupon.
```

CTA:

```text
Continue with Google
```

Secondary:

```text
Maybe later
```

Fine print:

```text
Coupon conditions may vary by product. Final discount is confirmed at checkout.
```

## Planner Integration

On `/planner`, place the promo near the mode switch or purchase section.

Good locations:
- Under the compact planner hero.
- Near the `Let AI plan everything / Build from my places` mode switch.
- In purchase section if user is not signed in.

Do not place it between every step of the form. That will make the planner feel spammy.

## Charter / Airport Pickup Integration

On `/charter`, the coupon should appear near the quote or final price, not at the top of
every wizard step.

Suggested copy:

```text
Google sign-in coupon available
Use your 5% pickup/charter coupon at checkout.
```

For multi-day/long-distance:

```text
Long route coupon
Multi-day and long-distance routes may receive up to 10% off.
```

## Implementation Notes for Claude

- Keep coupon logic separate from visual components.
- Do not hardcode discount calculation into UI cards.
- UI should display available coupons from the user's coupon state when possible.
- If coupon state is not loaded, show the event claim CTA instead of fake applied coupons.
- Avoid direct competitor comparison text unless legally and operationally approved.
- All new user-facing copy must eventually be localized for ko/en/ja/zh.

## Update Rule

Whenever coupon event work changes:

1. Update this file.
2. Update `E:\CocoTrip-Brain\shared-memory\SHARED-WORKLOG.md`.
3. Save screenshots for desktop and mobile if visual UI changed.
