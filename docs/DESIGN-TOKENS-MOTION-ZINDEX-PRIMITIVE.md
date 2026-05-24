# Design Tokens: Motion / Z-index / Primitive (2026-05-24)

> 본 문서는 [memory SSOT `project_cocotrip_design_ssot.md`](https://github.com/2001leety-code/cocotrip-source-/blob/main/docs/DESIGN-TOKENS-MOTION-ZINDEX-PRIMITIVE.md) 의 코드 레포 거울. 운영자 / 외부 contributor 가 GitHub 에서 바로 참조 가능. SSOT 변경 시 본 문서도 동기화 의무.

## 의도

figma_tutor 외부 audit (2026-05-24) 에서 도출된 5종 누락 토큰 중 **3종 (Motion / Z-index / Primitive)** 의 SSOT 등록.

- **Anthropic 공식 [frontend-design SKILL.md](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md)** 에서 motion 토큰 강조
- Z-index 임의값 (`z-50`, `z-[9999]`) 사용으로 stacking 충돌 silent bug 위험
- WizardForm/PlannerPage 특이사항 보다 **base primitive 6종 (Modal/Drawer/Toast/Skeleton/Empty/Error)** 통일이 먼저

본 PR은 **스펙 문서만 추가** — 실제 컴포넌트 구현은 별도 PR 에서 진행 (D6 등).

---

## 1. Motion (Transition) 토큰

duration/easing/transform 일관성 → "이 사이트 어디 가도 같은 속도/리듬" 브랜드 체감.

| 토큰 | 값 | 사용처 |
|---|---|---|
| `motion.duration.fast` | 100ms | hover (작은 elem: badge, chip, icon) |
| `motion.duration.base` | 200ms | hover / focus (button, input, card) |
| `motion.duration.slow` | 300ms | modal, drawer, accordion 진입/이탈 |
| `motion.duration.slower` | 500ms | page transition, hero animation |
| `motion.easing.standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | 대부분의 transition (Material 표준) |
| `motion.easing.decelerate` | `cubic-bezier(0, 0, 0.2, 1)` | 진입 (enter) — 빠르게 나타나 천천히 정착 |
| `motion.easing.accelerate` | `cubic-bezier(0.4, 0, 1, 1)` | 이탈 (exit) — 천천히 시작해 빠르게 사라짐 |
| `motion.transform.lift` | `translateY(-1px)` | button hover lift |
| `motion.transform.press` | `scale(0.98)` | button active (눌림) — `:active` |
| `motion.transform.modal` | `scale(0.95) → scale(1)` | modal/popover 진입 |

### Tailwind v4 매핑 예시

`tailwind.config.js` extend 추가 (별도 PR 에서 적용):

```js
theme: {
  extend: {
    transitionDuration: {
      fast: '100ms',
      base: '200ms',
      slow: '300ms',
      slower: '500ms',
    },
    transitionTimingFunction: {
      standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
      decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
      accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    },
  },
}
```

### className 예시

- Primary 버튼: `transition-all duration-base ease-standard hover:-translate-y-px active:scale-[0.98]`
- Modal 진입: `transition-transform duration-slow ease-decelerate scale-95 data-[state=open]:scale-100`
- Card hover: `transition-colors duration-base ease-standard`

### 금지

- 1000ms 이상 duration (사용자 답답함, AI slop 신호)
- `linear` easing (UI 부자연스러움, 진행바/loading 만 허용)
- 동시 5개 이상 element animation (CPU 부담 + 산만)

---

## 2. Z-index Scale

modal/toast/dropdown/nav stacking 갈등 silent bug 차단. raw `z-50` 같은 임의값 금지.

| 토큰 | 값 | 사용처 |
|---|---|---|
| `z.base` | 0 | 기본 content |
| `z.dropdown` | 1000 | select / context menu / autocomplete |
| `z.sticky` | 1100 | sticky header / sticky bottom CTA bar |
| `z.nav` | 1200 | top nav (sticky 보다 위 — 항상 보임) |
| `z.drawer` | 1300 | side drawer (nav 보다 위 — drawer 가 nav 덮음) |
| `z.modal` | 1400 | center modal (overlay 1399 + content 1400) |
| `z.popover` | 1500 | popover / tooltip on modal (modal 위에 떠야 함) |
| `z.toast` | 1600 | toast notification (항상 최상위) |
| `z.debug` | 9999 | dev tool / overlay (운영 환경 X) |

### Tailwind v4 매핑

`tailwind.config.js` (별도 PR):

```js
theme: {
  extend: {
    zIndex: {
      base: '0',
      dropdown: '1000',
      sticky: '1100',
      nav: '1200',
      drawer: '1300',
      modal: '1400',
      popover: '1500',
      toast: '1600',
      debug: '9999',
    },
  },
}
```

### className 예시

- Top nav: `sticky top-0 z-nav`
- Modal overlay: `fixed inset-0 z-modal bg-black/70`
- Toast: `fixed top-4 right-4 z-toast`

### 금지

- `z-[9999]` 임의값 (debug 외 금지)
- 같은 layer 에 다른 토큰 (예: drawer 안에 sticky bottom CTA → drawer 위에 떠버림)
- 인라인 `style={{ zIndex: 999 }}` (토큰 우회)

---

## 3. 재사용 Primitive 스펙

WizardForm/PlannerPage 특이사항 전에 **base primitive 6종** 통일. 한 곳에 정의 → 어디서 불러도 같은 모양.

### 3.1 Modal (center dialog)

**구조**:
- Overlay: `fixed inset-0 z-modal bg-black/70 backdrop-blur-sm`
- Container: `fixed inset-0 z-modal flex items-center justify-center p-4`
- Content: `bg-card border border-border rounded-xl max-w-[480px] w-full p-6 shadow-none`
- 진입: `motion.transform.modal` (scale 0.95→1) + `motion.duration.slow ease-decelerate`

**className 예시**:

```tsx
<div className="fixed inset-0 z-modal bg-black/70 backdrop-blur-sm" />
<div className="fixed inset-0 z-modal flex items-center justify-center p-4">
  <div className="bg-[#111827] border border-[#1e293b] rounded-xl max-w-[480px] w-full p-6
                  transition-transform duration-slow ease-decelerate scale-95
                  data-[state=open]:scale-100">
    {/* h3 title + body + footer CTA row */}
  </div>
</div>
```

**룰**:
- drop-shadow 금지 (border 만)
- `rounded-full` 금지 (rounded-xl 만)
- max-width 700px+ 금지 (480px 기준, 컨텐츠 많으면 modal 대신 page route)
- close 버튼: 우상단 ghost button (lucide-react `X` 20px) + aria-label

### 3.2 Drawer (side panel)

**구조**:
- Overlay: Modal 과 동일
- Container: `fixed top-0 right-0 z-drawer h-full bg-card border-l border-border`
- 모바일: `w-[80%]` (full-screen 금지 — 뒤 컨텐츠 살짝 보여서 닫는 의도 명확)
- 데스크탑 (lg+): `w-[320px]`
- 진입: `translateX(100%) → translateX(0)` + `motion.duration.slow ease-decelerate`

**className 예시**:

```tsx
<div className="fixed top-0 right-0 z-drawer h-full bg-[#111827] border-l border-[#1e293b]
                w-[80%] lg:w-[320px]
                transition-transform duration-slow ease-decelerate
                translate-x-full data-[state=open]:translate-x-0">
  {/* header (title + close X) + body scrollable + footer CTA */}
</div>
```

**룰**:
- 모바일 nav 햄버거 drawer 도 같은 spec 재사용
- 좌측 drawer 금지 (오른쪽만 — 운영자 의도, 한 방향 유지)
- 내부 스크롤: `overflow-y-auto` body 영역만, header/footer 고정

### 3.3 Toast (notification)

**구조**:
- Position: `fixed top-4 right-4 z-toast` (모바일 `top-2 right-2 left-2`)
- Content: `bg-elevated border border-{status} rounded-md p-4 max-w-[400px]`
- Auto-dismiss: 4000ms (status `success`) / 6000ms (`warning`) / 8000ms (`error` — 사용자 읽을 시간)
- 진입: `translateX(100%) → translateX(0)` + `motion.duration.base ease-decelerate`
- 이탈: `opacity 1→0` + `motion.duration.fast ease-accelerate`

**status border 색**:
- success: `border-[#10b981]` (좌측 4px solid + 나머지 border-default)
- warning: `border-[#f59e0b]`
- error: `border-[#ef4444]`
- info: `border-[#7c3aed]`

**className 예시**:

```tsx
<div role="status" aria-live="polite"
     className="fixed top-4 right-4 z-toast max-w-[400px]
                bg-[#1a2235] border-l-4 border-l-[#10b981] border border-[#1e293b]
                rounded-md p-4
                transition-all duration-base ease-decelerate">
  <div className="flex gap-3">
    <CheckCircle className="w-5 h-5 text-[#10b981] flex-shrink-0" />
    <div className="flex-1">
      <p className="text-[#f1f5f9] text-sm font-semibold">Saved</p>
      <p className="text-[#94a3b8] text-xs mt-1">Plan updated successfully</p>
    </div>
  </div>
</div>
```

**룰**:
- 화면당 toast 3개 이상 동시 금지 (stack 시 옛것 제거)
- 키보드 dismiss: `Esc` 키
- a11y: `role="status" aria-live="polite"` (warning/error 는 `assertive`)

### 3.4 Skeleton (loading placeholder)

**구조**:
- Base: `bg-elevated rounded-md animate-pulse`
- 텍스트 라인: `h-4 w-full` (body) / `h-6 w-3/4` (h2) / `h-8 w-1/2` (hero)
- 카드 placeholder: `h-32 w-full rounded-lg`
- 이미지 placeholder: `aspect-video w-full rounded-md`

**className 예시**:

```tsx
{/* 카드 skeleton */}
<div className="bg-[#111827] border border-[#1e293b] rounded-lg p-6">
  <div className="h-32 w-full bg-[#1a2235] rounded-md animate-pulse mb-4" />
  <div className="h-6 w-3/4 bg-[#1a2235] rounded-md animate-pulse mb-2" />
  <div className="h-4 w-full bg-[#1a2235] rounded-md animate-pulse mb-1" />
  <div className="h-4 w-5/6 bg-[#1a2235] rounded-md animate-pulse" />
</div>
```

**룰**:
- skeleton 안에 텍스트 금지 (빈 placeholder 만)
- 실제 컨텐츠 layout 과 정확히 일치 (height/width 동일)
- 5초 이상 skeleton → Empty State 또는 Error State 로 전환

### 3.5 Empty State (no data)

**구조**:
- 중앙 정렬 (`flex flex-col items-center justify-center min-h-[300px]`)
- Icon: lucide-react 48px (`w-12 h-12`) `text-muted` (#7c8a9e)
- h3 title: `text-primary` font-semibold (28px h3 토큰)
- body description: `text-secondary` (#94a3b8) max-width 400px center
- Optional CTA: secondary button (gradient CTA 아님 — primary action 강조 피함)

**className 예시**:

```tsx
<div className="flex flex-col items-center justify-center min-h-[300px] text-center px-6">
  <Inbox className="w-12 h-12 text-[#7c8a9e] mb-4" />
  <h3 className="text-[#f1f5f9] text-2xl font-semibold mb-2">No bookings yet</h3>
  <p className="text-[#94a3b8] text-base max-w-[400px] mb-6">
    Once you confirm a tour, your bookings will appear here.
  </p>
  <button className="border border-[#7c3aed] text-[#7c3aed] rounded-md px-6 py-3
                     hover:bg-[rgba(124,58,237,0.1)] transition-colors duration-base">
    Browse tours
  </button>
</div>
```

**룰**:
- 빈 화면에 gradient CTA 금지 (primary action 강조 = 부담)
- icon 64px+ 금지 (48px 표준)
- 메시지 한국어 X, 영어 primary (외국인 타겟)

### 3.6 Error State (failure)

**구조**:
- 중앙 정렬 (Empty State 와 동일 wrapper)
- Icon: lucide-react `AlertCircle` 또는 `XCircle` 48px `text-error` (#ef4444)
- h3 title: `text-primary` (예: "Something went wrong")
- body description: `text-secondary` 구체적 에러 메시지 (사용자 친화 — 스택 X)
- Retry button: secondary button (가장 흔한 action)
- Support link: ghost button "Contact support" → WhatsApp 또는 email

**className 예시**:

```tsx
<div className="flex flex-col items-center justify-center min-h-[300px] text-center px-6">
  <AlertCircle className="w-12 h-12 text-[#ef4444] mb-4" />
  <h3 className="text-[#f1f5f9] text-2xl font-semibold mb-2">
    Couldn't load your plan
  </h3>
  <p className="text-[#94a3b8] text-base max-w-[400px] mb-6">
    Network issue - your work is saved. Try again, or contact our team.
  </p>
  <div className="flex gap-3">
    <button onClick={retry}
            className="border border-[#7c3aed] text-[#7c3aed] rounded-md px-6 py-3
                       hover:bg-[rgba(124,58,237,0.1)] transition-colors duration-base">
      Try again
    </button>
    <a href="https://wa.me/..."
       className="text-[#94a3b8] underline-offset-4 hover:underline hover:text-[#f1f5f9]
                  transition-colors duration-base px-6 py-3 inline-block">
      Contact support
    </a>
  </div>
</div>
```

**룰**:
- 사용자한테 스택 트레이스 노출 금지
- "Error 500" 같은 코드 표기 금지 (의미 있는 영어 메시지)
- retry 버튼 없이 dead-end 금지 (항상 액션 제공)
- 데이터 저장 안전 안내 (사용자 손실 걱정 차단)

---

## Follow-up 후보 (운영자 결정 영역)

figma_tutor 외부 audit 누락 5종 중 본 PR 미포함 2종:

### 4. Light mode 확장 path (semantic vs raw 2-layer 분리)

- 현재 hex 직접 명시 (`#0a0f1e`) → light mode 추가 시 `bg.base` 의미 깨짐
- 권장: `--color-bg-base` CSS var → `dark { --color-bg-base: #0a0f1e }` / `light { --color-bg-base: #ffffff }` semantic 2-layer
- 운영자 결정 영역: D1-D5 (PR #569) 머지 후 dark only 결정 — light mode 추가 시점 미정

### 5. Gradient fallback solid color / CSS var vs Tailwind config 선택

- 현재 gradient 만 정의 — `prefers-reduced-motion` 또는 노후 브라우저에서 fallback solid 미명시
- 권장: `brand.purple` (#7c3aed) 단색 fallback + `background: var(--brand-gradient, #7c3aed)` 패턴
- CSS var vs Tailwind config 선택: 현재 Tailwind extend 사용. CSS var 전환 시 runtime 테마 swap 가능 (light mode 함께 진행 권장)

운영자 호출 keyword: "**디자인 light mode 추가**" / "**gradient fallback 추가**" → 별도 PR 진행.

---

## 5-step Audit (작업 흐름 추적)

1. 외부 audit (figma_tutor) 결과 검토 → 5종 누락 도출
2. Anthropic 공식 frontend-design SKILL.md 비교 → motion 토큰 강조 확인
3. 우리 SSOT (`project_cocotrip_design_ssot.md`) 검색 → motion / z-index / primitive 섹션 부재 확인
4. SSOT 신규 3 섹션 (motion / z-index / primitive) 작성 — 기존 토큰 변경 X
5. 본 문서 (PR 거울) 생성 → 외부 contributor 참조 가능

---

**관련 메모리**: `project_cocotrip_design_ssot.md` / [Anthropic frontend-design SKILL.md](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md)
