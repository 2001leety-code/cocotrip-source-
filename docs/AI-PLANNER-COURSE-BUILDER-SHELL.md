# AI Planner Course Builder Shell

Last updated: 2026-07-01 by Codex

## Purpose

This document is the handoff memory for the `/planner` course-builder direction.
Update this file every time the course-builder UI, flow, data contract, map behavior,
sharing behavior, or AI recommendation behavior changes.

The current implementation is intentionally a UI shell only. It is meant to give
Claude or another agent clear attachment points for the hard logic later.

## Product Direction

The planner should support two modes:

1. `Let AI plan everything`
   - Existing survey-style AI itinerary flow.
   - User answers trip questions, then the AI creates a complete itinerary.

2. `Build from my places`
   - New route-builder/platform direction.
   - User can add restaurants, addresses, hotels, venues, map links, and fixed times.
   - AI helps beside the user with nearby recommendations and route warnings.
   - Final output should show a full map, day tabs, editable stops, transit legs,
     Naver/Google route links, and a shareable course page.

## Current Files

- `src/pages/PlannerPage/index.tsx`
  - Adds the mode switch above the planner body.
  - Keeps the existing `WizardForm` flow untouched.
  - Renders `CourseBuilderShell` only when mode is `Build from my places`
    and planner status is `idle`.

- `src/pages/PlannerPage/components/CourseBuilderShell.tsx`
  - Static shell UI only.
  - Contains map mock, day tabs, add-place method cards, stop cards, transit option
    placeholders, AI recommendation cards, and share/publish controls.
  - No real map, save, AI recommendation, place lookup, sharing, or route calculation
    is connected yet.
  - 2026-07-01 v2 additions:
    - Add method cards: type place, paste map link, ask AI nearby.
    - Transit comparison placeholder: subway, taxi, charter.
    - AI recommendation action chips: Add, Why?, Skip.
    - Share/publish placeholder: private/public, preview, share.

- `src/components/WizardForm/index.tsx`
  - Visual-only progress indicator redesign.
  - Existing autosave, revision, submit, and step logic should remain untouched.

- `src/components/WizardForm/WizardStep0Reservation.tsx`
  - Visual-only first-step card density update.
  - Existing reservation status behavior remains unchanged.

## Desired Future Data Shape

Suggested shape for a future route builder state:

```ts
type CourseBuilderStop = {
  id: string;
  day: number;
  time?: string;
  title: string;
  address?: string;
  placeId?: string;
  source: 'manual' | 'map_link' | 'ai_suggestion';
  locked?: boolean;
  lat?: number;
  lng?: number;
  note?: string;
};

type CourseBuilderLeg = {
  fromStopId: string;
  toStopId: string;
  mode: 'walk' | 'transit' | 'taxi' | 'charter';
  durationMin?: number;
  distanceKm?: number;
  fareKRW?: number;
  naverUrl?: string;
  googleUrl?: string;
};

type CourseBuilderPlan = {
  id?: string;
  title: string;
  visibility: 'private' | 'public';
  days: number;
  startPoint?: CourseBuilderStop;
  stops: CourseBuilderStop[];
  legs: CourseBuilderLeg[];
};
```

## UI Attachment Points

Use these existing shell areas as integration targets:

- Add method cards:
  - `Type a place`
  - `Paste map link`
  - `Ask AI nearby`

- Stop cards:
  - Replace static `SAMPLE_STOPS` with persisted stop state.
  - Add edit/delete/reorder behavior.
  - Preserve the source labels: manual, map link, AI suggestion, fixed plan.

- Transit comparison:
  - Replace `TRANSIT_OPTIONS` with route engine results.
  - Add Naver and Google route links per leg.
  - Add charter comparison/upsell where useful.

- AI route helper:
  - Replace `RECOMMENDATIONS` with real AI suggestions.
  - Actions should map to `Add`, `Why?`, and `Skip`.

- Share and publish:
  - Connect private/public visibility.
  - Generate share URL.
  - Support "copy this route into my planner" later.

## Guardrails

- Do not break the existing survey planner flow.
- Do not touch PayPal, coupon, purchase, autosave, or revision logic unless the task
  explicitly targets those systems.
- Keep map/provider logic isolated from `PlannerPage/index.tsx`; prefer a dedicated
  service/helper or child component.
- Every visual change should be checked on mobile and desktop.
- Update this document and `E:\CocoTrip-Brain\shared-memory\SHARED-WORKLOG.md`
  after each meaningful course-builder task.

## Latest Validation

2026-07-01:
- `npx tsc --noEmit --pretty false`: passed.
- `git diff --check`: passed.
- `/planner` mode switch checked by screenshot.
- Captures:
  - `planner-course-builder-mobile-clean.png`
  - `planner-course-builder-desktop-clean.png`
  - `planner-course-builder-mobile-full.png`
  - `planner-course-builder-mobile-v2.png`
  - `planner-course-builder-desktop-v2.png`
  - `planner-course-builder-mobile-v2-full.png`

## 다음 세션 작업 범위 (운영자 확정 2026-07-02)

코스 빌더 셸에 아래 기능을 구현한다. (이번 세션은 문서 기록만 — 코드 구현 없음.)

- Day별 장소 **추가 / 수정 / 삭제 / 순서변경**
- 장소별 **시간·체류시간** 입력
- **이동구간 표시** (장소 사이 이동 수단·소요시간 슬롯)
- 장소별 **Google 지도 / Naver 지도 링크**
- **local state 저장** (새로고침 후 복원 — localStorage 기반, 서버 저장은 이후 단계)
- **API 연결지점 표시** (추후 geocoding/transit/저장 API 가 붙을 자리를 코드 주석 + UI placeholder 로 명시)
- **완성본 보기**: 지도 + 일정 리스트 + Day 탭 + 공유 + 수정 진입
