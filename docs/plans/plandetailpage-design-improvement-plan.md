# PlanDetailPage 디자인·UX 개선 계획서

**작성일**: 2026-04-26
**대상 페이지**: `/my-plans/:planId` (`src/pages/PlanDetailPage/`)
**한줄 요약**: 사용자가 결제하고 받는 AI 여행 플래너 결과 페이지가 가장 문제. **정보 밀도·시각 위계·인터랙션 어포던스** 3축이 동시에 약함.

---

## 0. 문제 진단 (요약)

| 축 | 핵심 문제 | 현 상태 | 목표 |
|---|---|---|---|
| **정보 밀도** | StopCard 기본값 `expanded={true}` — 한 stop으로 viewport 초과 | 8 섹션 동시 노출 | collapsed default + section drill-down |
| **시각 위계** | 그라데이션 색상 수십 곳 인라인, 모바일/데스크톱 색상 다름 (#B668FC vs #7C5CFC) | 변수화 0%, 일관성 없음 | design tokens 시스템 (색·타이포·spacing) |
| **인터랙션** | Edit toggle 거의 안 보임, drag handle 모바일 off-screen, StopCard 클릭 어포던스 약함 | 발견성 낮음 | Hover/active 강화 + 모바일 우선 placement |
| **네비게이션 충돌** | Slide swipe + 내부 scroll + SectionTabs 동시 — 사용자 혼란 | 3중 네비 | swipe 단일화 + scroll 보조 |
| **PDF 출력** | 한글 폰트 로딩 불안정, 16000px 초과 silent fail, 웹/PDF 스타일 따로 | 첫 시도 실패율 높음 | 폰트 preload + 길이 가드 + 스타일 공유 |

---

## 1. 영역별 상세 진단

### 1.1 정보 밀도 (information-density)

#### A. StopCard 기본값 펼침 — `StopCard.tsx:18`
```tsx
const [expanded, setExpanded] = useState(true);  // ❌ 기본 펼침
```

**현상**: 펼쳐진 stop 한 개당 8개 섹션 (주소·팁·예약·추천 음식·대중교통·Naver Map 등) → `max-h-[800px]`. iPhone 14 (812px) 기준 한 stop 으로 viewport 거의 가득 참. Day 1에 stop 5개면 4000px+ 스크롤.

**개선**: collapsed default → 사용자 클릭 시 expand. 첫 stop 1개만 자동 expand 옵션 (스타일은 동일하지만 첫 인상에서 풍부함 보존).

#### B. 슬라이드 vs 스크롤 혼재 — `SwipeContainer.tsx:43,75`
```tsx
touchAction: editMode ? 'auto' : 'pan-y'  // 수직만 허용
maxHeight: 'calc(100vh - 180px)'           // 고정값
```

**현상**: 페이지는 좌우 swipe slide 기반인데 각 slide 내부는 세로 스크롤. SectionTabs + SlideProgress 동시 표시 → 사용자가 어떻게 이동하는지 인지 비용 높음.

**개선**:
- SlideProgress는 페이지 단위(intro/day1.../outro) 위치, SectionTabs는 day 그룹 jump 전용으로 역할 분리
- 또는 SlideProgress 제거하고 SectionTabs 단일 네비게이션
- 모바일에서 `maxHeight` 반응형: `calc(100vh - 200px)` (mobile) / `calc(100vh - 220px)` (desktop)

### 1.2 시각 위계 (visual-hierarchy)

#### A. 색상 인라인 지정 만연 — 영향: 전체 컴포넌트
| 위치 | 현 코드 |
|---|---|
| `StopCard.tsx:39-46` | `linear-gradient(180deg,#7C5CFC,#EA537E)` (accent bar) |
| `IntroSlide.tsx:39` | 모바일 `linear-gradient(135deg,#B668FC,#FF6B9D)` vs 데스크톱 `linear-gradient(135deg,#a78bfa,#ec4899)` |
| `TransitArrow.tsx:252-257` | 인라인 그라데이션 |
| `BudgetTable.tsx`, `SectionTabs.tsx` | 동일 패턴 반복 |

**문제**: 모바일은 `#B668FC #FF6B9D` 데스크톱은 `#7C5CFC #EA537E`. 두 디바이스 사용자가 같은 화면을 보지 않음. **브랜드 일관성 파괴**.

**개선**: `src/lib/design-tokens.ts` 신설 — 단일 SOURCE-OF-TRUTH.
```ts
export const BRAND = {
  gradient: {
    primary: 'linear-gradient(135deg, #7C5CFC, #EA537E)',  // 단일화
    accent: 'linear-gradient(180deg, #7C5CFC, #EA537E)',   // 세로 accent
  },
  color: {
    purple: '#7C5CFC',
    pink: '#EA537E',
    purpleLight: '#A78BFA',
    pinkLight: '#FF6B9D',
  },
};
```

#### B. 타이포그래피 불규칙
| 컴포넌트 | 현 사이즈 | 문제 |
|---|---|---|
| IntroSlide 제목 | `text-2xl sm:text-3xl` | OK |
| OutroSlide 제목 | `text-xl` | Intro와 위계 차이 ❌ |
| StopCard 시간 | `text-[14px] sm:text-[15px]` | 중요도 비해 작음 |
| 부제목 | `text-[11px]`, `text-xs`, `text-[10px]` 혼용 | 하나로 통일 필요 |

**개선**: `TYPOGRAPHY` scale 정의 — pageTitle / sectionHead / cardTitle / body / meta / hint 6단계로 통일.

#### C. Spacing 비대칭
- StopCard padding: `p-3.5 sm:p-4` (14→16px) — 모바일 답답
- Card 사이 gap: `gap-2.5 sm:gap-3` (10→12px) — 너무 타이트
- TransitArrow margin: `ml-4 my-1` — 좌우 비대칭

**개선**: `SPACING` 상수 — section / card / itemGap / inline 4단계.

### 1.3 인터랙션 어포던스 (interaction-affordance)

#### A. StopCard 클릭 가능 표시 약함 — `StopCard.tsx:38-102`
**현상**:
- 전체 카드 onClick → toggle expand
- Hover: `hover:border-[#7C5CFC]/35 hover:bg-white/[0.06]` — 매우 희미
- 시각적 단서: ChevronDown 회전만 — 초보자 인지 어려움
- 패딩 14px → 모바일 44px 터치 영역 미달

**개선**:
```tsx
className="... cursor-pointer
  hover:bg-white/[0.08] hover:border-[#7C5CFC]/50
  hover:shadow-lg hover:shadow-[#7C5CFC]/10
  active:scale-[0.99]
  p-4 sm:p-5"  // 16-20px padding
```

#### B. EditModeToggle 비활성 상태 invisible — `EditModeToggle.tsx:19-23`
**현상**: 비활성 `bg-white/5 text-white/50` → **거의 안 보임**. 사용자가 편집 가능 자체 인지 못 함.

**개선**:
```tsx
'bg-white/[0.10] text-white/70 hover:bg-white/[0.15] border border-white/15'
// + 아이콘 명확히 (Pencil), 라벨 항상 표시
```

#### C. DayTimeline drag handle 모바일에서 off-screen — `SortableStopCard.tsx:54-65`
**현상**: `absolute -left-8` → md+ 화면에서만 보임. 모바일 사용자는 drag-to-reorder 발견조차 불가.

**개선**: 모바일에서는 카드 우측 상단에 작은 GripVertical 표시.
```tsx
{editMode && isMobile && (
  <button className="absolute right-2 top-2" {...attributes} {...listeners}>
    <GripVertical className="w-4 h-4 text-white/40" />
  </button>
)}
```

#### D. PDF 다운로드 실패 시 confirm() 팝업 — `OutroSlide.tsx:57-68`
**현상**: 실패 시 `confirm('PDF failed. Try WhatsApp?')` 네이티브 팝업 — 거슬림 + UX 구식.

**개선**: `sonner` toast 라이브러리 이미 설치됨 → 사용. inline error + retry 버튼.

### 1.4 모바일 대응 (mobile-responsiveness)

#### A. Swipe + Scroll 제스처 충돌
- `touchAction: 'pan-y'` 만 허용 (좌우 swipe → 슬라이드 이동)
- 하지만 SortableStopCard drag도 좌우/상하 모두 — 충돌 가능

#### B. 모바일 가로 모드 미고려
- `maxHeight: 'calc(100vh - 180px)'` — 가로에서 실제 사용 영역 부족
- 가로 모드는 길 찾기 사용 시 자주 발생 (운전자/조수석)

#### C. 메타 칩 줄 깨짐 — `StopCard.tsx:85-100`
- 모바일 375px 가로에서 "45min · Free" 등이 2줄
- 태블릿 768px에서도 어색

### 1.5 PDF 생성 (pdf-output)

#### A. 한글 폰트 로딩 불안정 — `pdfGenerator.ts:479-501`
- `document.fonts.ready` + 500ms + 600ms 추가 대기 → **첫 시도 실패율 높음** (특히 느린 네트워크)
- 실패 시 시스템 폰트 fallback → 토후 박스 발생 가능

**개선**:
```ts
await Promise.all([
  document.fonts.load('16px "Noto Sans KR"'),
  document.fonts.load('16px "Noto Sans JP"'),
  document.fonts.load('16px "Noto Sans SC"'),
]);
// 그 후 추가 200ms 안정화
```

#### B. 16000px 초과 silent fail — `pdfGenerator.ts:507-513`
- 8일+ 여행은 height 초과 → html2canvas OOM (iOS Safari 특히)
- 현재는 console.warn만 → 사용자는 빈 PDF 받음

**개선**: 12000px 초과 시 confirm + WhatsApp 대안 제시.

#### C. 웹/PDF 스타일 분리 — `pdfGenerator.ts:105-466`
- 웹: dark theme 그라데이션
- PDF: light theme 검은 텍스트
- 두 곳 따로 관리 → 동기화 깨짐

**개선**: design-tokens.ts 공유 → 동일 색상 팔레트, 라이트/다크만 토글.

### 1.6 광고/CTA 배치 (monetization)

#### A. 광고 slide가 day 사이에 끼어 있음 — `lib/buildSlides.ts`
- 현재: [Intro] → [Day1] → [Ad] → [Day2] → [Day3] → [Ad] → [Day4] → [Outro]
- 사용자가 Day2 → Day3 swipe 시 광고를 가로지름 → 짜증

**개선**:
- [Intro] → [Day 1-N (모두)] → [Ad collapsible 섹션] → [Outro]
- 광고는 사용자가 itinerary 만족스럽게 본 후 outro 직전에 집중

#### B. CharterCTA 일관성 부족 — `DayTimeline.tsx:48`
- "복잡한 대중교통 day" 조건에만 표시 → 사용자 입장에서 일관성 없어 보임
- 위치도 day title 바로 아래 → 본문과 헷갈림

**개선**: 모든 day에 표시하되 visual weight 낮춤 (작은 chip 형태) + 클릭 시 detail bottom sheet.

### 1.7 Edge cases

| 케이스 | 현 처리 | 개선 |
|---|---|---|
| 빈 itinerary | [Intro] → [Outro]만 노출 (어색) | Empty state 명시 ("No days yet") |
| Single-day 여행 | SectionTabs 3개 (Intro/Day1/Outro) — 과한 UI | tabs 1 이하면 숨김 (이미 부분 처리) |
| Translation 실패 | 원본 영어 노출 (사용자 혼란) | 작은 warning chip + retry 옵션 |
| GeoCoding 실패 stop | NaverMap URL 없음 | "지도에서 찾기" disabled state + 수동 검색 링크 |

---

## 2. 우선순위 + 실행 로드맵

### Phase 1 — Quick Wins (1-2일, 영향 큼)

| # | 항목 | 파일 | 수정 줄 | 영향 |
|---|---|---|---|---|
| 1 | StopCard `expanded` 기본값 false | `StopCard.tsx:18` | 1 | 모바일 스크롤 50%↓ |
| 2 | StopCard padding 16-20px + cursor-pointer + hover 강화 | `StopCard.tsx:49` | 5 | 터치 영역·발견성 |
| 3 | EditModeToggle 비활성 색상 강화 | `EditModeToggle.tsx:19-23` | 3 | 편집 기능 발견성 2배 |
| 4 | `design-tokens.ts` 도입 + IntroSlide 색상 통일 | `src/lib/design-tokens.ts` (신설) + `IntroSlide.tsx:39` | ~30 | 모바일/데스크톱 일관성 |
| 5 | PDF 폰트 explicit preload | `pdfGenerator.ts:479` | ~10 | 첫 시도 성공률 ↑ |

**예상 결과**: PR 1-2개로 대부분 적용. 사용자 첫인상 + 메인 사용 흐름 개선.

### Phase 2 — Structural (3-5일, 모바일 UX 핵심)

| # | 항목 | 변경 범위 |
|---|---|---|
| 6 | 모바일 drag handle 우측 상단 이동 | SortableStopCard 전면 수정 |
| 7 | 광고 slide 위치 재배치 (Intro → Days → Ad → Outro) | `lib/buildSlides.ts` |
| 8 | SlideProgress + SectionTabs 역할 분리 또는 단일화 | `index.tsx`, `SectionTabs.tsx` |
| 9 | PDF length guard (12000px 초과 시 분할 안내) | `pdfGenerator.ts` |
| 10 | confirm() 팝업 → sonner toast 통일 | `OutroSlide.tsx`, `pdfGenerator.ts` |

### Phase 3 — Polish + Edge cases (1주)

| # | 항목 | 비고 |
|---|---|---|
| 11 | Translation 실패 visible warning | useAutoTranslate hook 확장 |
| 12 | Empty state UI (빈 itinerary) | index.tsx loading/error 분기 |
| 13 | 가로 모드 viewport 재계산 | SwipeContainer maxHeight 동적 |
| 14 | Keyboard navigation Tab 지원 | StopCard tabIndex |
| 15 | PDF 스타일을 웹과 design-tokens 공유 | pdfGenerator 리팩터 |

### Phase 4 — Long-term (선택, 1-2주)

- A/B 테스트: 광고 배치 위치 (mid-journey vs end-concentrated)
- WCAG AA contrast 감사 (`text-white/30` 등 대비비 4.5:1 미달 항목 점검)
- 사용자 행동 분석 (PostHog/Amplitude) — slide별 이탈률 측정 후 재설계

---

## 3. 실행 시 체크리스트

각 PR마다:
- [ ] 4언어(ko/en/ja/zh) 시각 확인 — 새 텍스트 i18n 키 추가
- [ ] 모바일(Pixel 5, iPhone 14 Pro) + 데스크톱 모두 검증 (Playwright project 3개)
- [ ] PDF 다운로드 실제 시도 (테스트 계정 PayPal sandbox)
- [ ] `npm run check:types` + `npm run test:unit:coverage` + `npm run check:size` 통과
- [ ] Lighthouse a11y ≥ 0.85 유지 (Round 8b 임계치)

## 4. 비측정 지표 (사용자가 직접 느끼는 것)

> **"결제하고 받은 결과가 만족스러운가?"** — 이 한 질문이 모든 변경의 북극성.

- 첫인상 5초: IntroSlide에서 "이 여행 좋겠다" 인상 형성 → 그라데이션·카피 통일성
- 본문 30초: 첫 stop 정보 빠르게 파악 → collapsed default + 명확 클릭 어포던스
- PDF 출력: 첫 시도에 깔끔한 결과 → 폰트 preload + length guard
- 공유 욕구: Share 버튼이 자연스럽게 보임 → 위치·visibility 점검 (현재 OK)

---

## 5. 문서 연관

- `plandetailpage-decomposition-plan.md`: 파일 구조 분할 (이미 진행 중)
- `result-quality-upgrade-plan.md`: 플래너 출력 품질 (Gemini 단)
- `cocotrip-v2-transit-first.md`: TransitArrow 기능 (이미 적용)
- 본 문서는 **위 3 문서가 보장한 데이터/구조 기반에서 시각·인터랙션 층을 다룸**

## 6. 첫 PR 제안 (즉시 시작 가능)

**제목**: `fix(plan-detail): collapse stop cards by default + tighten click affordance`

**변경**:
- `StopCard.tsx:18` — `useState(true)` → `useState(false)`
- `StopCard.tsx:49` — padding `p-4 sm:p-5`, `cursor-pointer`, hover 강화
- `EditModeToggle.tsx:19-23` — 비활성 색상 강화

**리스크**: 거의 없음. 기존 사용자가 "왜 이거 펼쳐봐야 하지?" 약간의 학습 비용. 그러나 모바일 스크롤 절감 + 발견성 향상이 훨씬 큼.

**측정**:
- before/after 모바일 Pixel 5에서 Day 1 끝까지 스크롤 횟수 비교
- 가능하면 PostHog session recording으로 expand 클릭률 측정

---

**다음 단계**: 사용자 승인 후 Phase 1 첫 PR 시작.
