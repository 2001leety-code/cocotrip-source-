# 🔥 Vercel 빌드 TS 에러 진단 & 수정 지시

**발생 시각**: 2026-04-21 19:49 (Vercel 빌드 로그)
**상태**: 🔴 **배포 중단** — `tsc --noEmit` 실패로 `npm run build` exit 2
**총 에러 수**: **약 110건**
**원인**: 직전 커밋의 i18n/번역 캐시 리팩터에서 타입 시스템 누락
**긴급도**: 🔴 블로커 — 프로덕션 배포 불가

---

## 🎯 진단 요약

에러 110건은 **표면상 다양해 보이지만 실제 7개의 루트 원인**에서 발생. 루트 원인을 고치면 80% 이상 한 번에 해소됨.

| # | 루트 원인 | 영향 파일 | 에러 수 | 난이도 |
|---|----------|-----------|---------|--------|
| **R1** | `PlannerDict` import 누락 | 17개 | 17 | 🟢 매우 쉬움 |
| **R2** | `PlanDetailDict` 타입 유니온이 너무 느슨 | 13개 | ~30 | 🟡 중간 |
| **R3** | `types.ts` 중복 인터페이스 선언 | 1개 (cascade) | 2 + cascade | 🟢 쉬움 |
| **R4** | Optional 필드 non-null 가드 누락 | 6개 | ~20 | 🟢 쉬움 |
| **R5** | i18n 사전 타입 강제 캐스팅 실패 | 7개 | ~15 | 🟡 중간 |
| **R6** | `tAny` 미정의 참조 (오타) | 1개 | 1 | 🟢 매우 쉬움 |
| **R7** | `useAutoTranslate` 리턴 타입 잔재 | 3개 | ~10 | 🟡 중간 |

---

## 🔍 루트 원인 상세

### R1. `PlannerDict` import 누락 (TS2304)

**증상**:
```
src/pages/PlannerPage/components/AccommodationCard.tsx(6,80):
  error TS2304: Cannot find name 'PlannerDict'.
```

**진단**: 타입 자체는 이미 존재함.
```typescript
// src/pages/PlannerPage/types.ts
export type PlannerDict = Translations['planner'];
```
**하지만 17개 컴포넌트가 import 안 함** → 전역 사용처럼 쓰고 있음.

**해당 파일 전체 리스트** (AG 복사용):
```
src/pages/PlannerPage/components/AccommodationCard.tsx
src/pages/PlannerPage/components/AirportPickupCard.tsx
src/pages/PlannerPage/components/BudgetCard.tsx
src/pages/PlannerPage/components/CharterBanner.tsx
src/pages/PlannerPage/components/ComboPackageBanner.tsx
src/pages/PlannerPage/components/CustomerSupportSection.tsx
src/pages/PlannerPage/components/DailyTipsSection.tsx
src/pages/PlannerPage/components/EnrichingBanner.tsx
src/pages/PlannerPage/components/EsimSection.tsx
src/pages/PlannerPage/components/FlightSearchSection.tsx
src/pages/PlannerPage/components/MealsSection.tsx
src/pages/PlannerPage/components/QuickPreviewCard.tsx
src/pages/PlannerPage/components/RainyDaySection.tsx
src/pages/PlannerPage/components/SeasonalSpotsBanner.tsx
src/pages/PlannerPage/components/TimelineCard.tsx
src/pages/PlannerPage/components/TourRecommendationsSection.tsx
src/pages/PlannerPage/components/TransportBadge.tsx
src/pages/PlannerPage/components/TriviaLoadingAnimation.tsx
```

**수정**: 각 파일 상단에 한 줄 추가
```typescript
import type { PlannerDict } from '../types';
```

---

### R2. `PlanDetailDict` 타입 유니온이 너무 느슨 (TS2339)

**증상**:
```
PlanDetailPage/components/ShareButton.tsx(75,26):
  error TS2339: Property 'shareSuccess' does not exist on
  type 'string | Record<string, string>'.
```

**진단**: `PlanDetailPage/types.ts` L121에 헬퍼 타입이 있음:
```typescript
export type PlanDetailDict = Record<string, string | Record<string, string> | undefined>;
```

**문제**: `t.planDetail.shareSuccess` 같이 직접 속성 접근 시,  
값이 `string | Record<string, string>` 유니온이라 property access 불가.

**수정 전략 (2가지)**:

#### 전략 A: 사전 구조 고정 (권장)
`PlanDetailDict`을 **실제 존재하는 필드 리스트**로 명시:
```typescript
export interface PlanDetailDict {
  shareButton?: string;
  shareSuccess?: string;
  sharePublic?: string;
  sharePrivate?: string;
  shareReward?: string;
  togglePublicConfirm?: string;
  privateNotice?: string;
  shareCopy?: string;
  // ... (사용되는 모든 키)
  addStop?: string;
  nameLabel?: string;
  addressLabel?: string;
  startTimeLabel?: string;
  stayMinLabel?: string;
  categoryLabel?: string;
  addBtn?: string;
  cancelButton?: string;
  deleteButton?: string;
  deleteConfirm?: string;
  doneEditing?: string;
  editMode?: string;
  introTitle?: string;
  introDaysLabel?: string;
  outroTitle?: string;
  outroPdfCta?: string;
  swipeHint?: string;
  slideCounter?: string;
  userAdded?: string;
  sponsoredLabel?: string;
  routeRecalculating?: string;
  routeStale?: string;
  publicTransitUnavailable?: string;
  hoursLabel?: string;
  suggestHeader?: string;
  suggestBody?: string;
  viewCharterCTA?: string;
}
```

#### 전략 B: Helper 함수 폴백 (빠른 픽스)
`getPlanDetailDict` 함수 결과를 any로 캐스팅하는 대신 structural type으로 고정.

**권장**: 전략 A — 타입 안정성 확보 + 런타임 버그 예방.

---

### R3. `types.ts` 중복 인터페이스 (TS2374)

**증상**:
```
src/pages/PlanDetailPage/types.ts(91,3):
  error TS2374: Duplicate index signature for type 'string'.
src/pages/PlanDetailPage/types.ts(115,3):
  error TS2374: Duplicate index signature for type 'string'.
```

**진단**: `DepartureGuideBlock` 인터페이스가 **L86과 L104에 두 번 선언**됨. L86-92 버전은 간소화, L104-116 버전은 상세 (`luggage_storage` 포함).

**수정**:
- L86-92 블록 삭제
- L104-116 상세 버전만 유지
- `[key: string]: unknown;` 중복 인덱스 시그니처 제거

---

### R4. Optional 필드 non-null 가드 누락 (TS18048 / TS2345)

**증상**:
```
ArrivalGuide.tsx(82,20): 'step.t_money_recommended_load_krw' is possibly 'undefined'.
pdfGenerator.ts(114,11): 'step.est_min' is possibly 'undefined'.
StopCard.tsx(60,14): 'stop.entry_fee_krw' is possibly 'undefined'.
```

**영향 파일**:
- `ArrivalGuide.tsx` (2건)
- `DepartureGuide.tsx` (2건)
- `StopCard.tsx` (7건)
- `TransitArrow.tsx` (3건)
- `pdfGenerator.ts` (8건)
- `RevisionCard.tsx` (2건)

**수정 패턴**: 각 호출부에 nullish coalescing 또는 조건문 추가
```typescript
// Before
`${stop.entry_fee_krw.toLocaleString()}원`

// After
`${(stop.entry_fee_krw ?? 0).toLocaleString()}원`

// 또는 조건 렌더
stop.entry_fee_krw != null && (
  <span>{stop.entry_fee_krw.toLocaleString()}원</span>
)
```

---

### R5. i18n 사전 타입 캐스팅 실패 (TS2352 / TS2322)

**증상**:
```
CharterPage.tsx(181,66): Conversion of type '...{492 more}...' to
  type 'Record<string, string>' may be a mistake
MyPlansPage.tsx(26,13): (동일)
KpopConcertPopup.tsx(236,21): not assignable to
  type 'Record<string, string | undefined>'.
```

**진단**: `Translations` 전체 객체를 `Record<string, string>`으로 캐스팅 시도.  
하지만 `Translations` 안에 nested object (`nav.home`, `slide1.title`)가 섞여 있어 구조 불일치.

**영향 파일**:
- `KpopConcertPopup.tsx` L236
- `PayPalBookingButton.tsx` L215
- `PlannerForm.tsx` L182, 183, 428, 453, 468, 469
- `CharterPage.tsx` L181, 223, 466
- `MyPlansPage.tsx` L26
- `PurchaseSection.tsx` L117
- `HeroSlider.tsx` L76
- `Regions.tsx` L66, 85
- `Services.tsx` L37

**수정 패턴**:
```typescript
// ❌ Bad
const dict = t as Record<string, string>;

// ✅ Good — unknown 경유
const dict = t as unknown as Record<string, string>;

// ✅ Best — 전용 타입 정의
const dict: Pick<Translations, 'nav' | 'planner'> = t;
```

전체에 걸쳐 `as unknown as Record<string, string>` 적용하는 게 가장 빠른 픽스.

---

### R6. `tAny` 미정의 참조 (TS2304)

**증상**:
```
src/components/ReviewWriteModal.tsx(116,21):
  error TS2304: Cannot find name 'tAny'.
```

**진단**: 오타 또는 리팩터 중 누락. `tAny`라는 변수 선언 없음.

**수정**: `t as any` 또는 정상 `t` 사용. L116 직전에 선언 추가:
```typescript
const tAny = t as any;
```
또는 `tAny` 치환을 `(t as any)` 로 변경.

---

### R7. `useAutoTranslate` 리턴 / 인라인 타입 문제 (TS2769 / TS2322)

**증상**:
```
useAutoTranslate.ts(59,30): No overload matches this call.
useAutoTranslate.ts(90,32): No overload matches this call.
```

**진단**: Firestore `doc(db, 'plans', planId, 'translations', targetLang)` 호출에서 `planId` 가 `string | undefined`일 가능성.

**수정**:
```typescript
// 루프 전 가드
if (!planId) return;
const cacheRef = doc(db, 'plans', planId, 'translations', targetLang);
```

L32에 `const planId = plan?.id || ''` 있지만 `''` 빈 문자열도 Firestore는 거부 → 명시 가드 필요.

---

### 추가 — 그 외 산발 에러

| 파일:라인 | 에러 | 수정 |
|-----------|------|------|
| `PayPalBookingButton.tsx:215` | SetStateAction string/undefined | `?? null` 추가 |
| `WizardForm/WizardStep3Review.tsx:63` | filter 후 undefined 포함 | `.filter((x): x is string => !!x)` |
| `ads/CharterBanner.tsx:13` | PlanStop[] 타입 mismatch | wrapper type 정의 |
| `StopCard.tsx:18` | undefined 인덱스 | optional chaining |
| `OutroSlide.tsx:41` | BudgetRow[] import 경로 다름 | 같은 모듈 import 통일 |
| `IntroSlide.tsx:69` | ArrivalGuideBlock vs ArrivalGuideData | 타입 통일 |
| `DayTimeline.tsx:64,89` | TransitSegment vs TransitFromPrev | 타입 별칭 정리 |

---

## 🔧 수정 실행 순서 (AG 지시)

### Phase 1 — 쉬운 것부터 (1시간)
```
[x] Step 1: R1 — 17개 파일에 `import type { PlannerDict } from '../types';` 추가
[x] Step 2: R3 — types.ts L86-92 `DepartureGuideBlock` 첫번째 선언 삭제
[x] Step 3: R6 — ReviewWriteModal.tsx L116 `tAny` 치환
[x] Step 4: R7 — useAutoTranslate.ts `planId` 가드 강화
```

**중간 검증**:
```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
# 목표: 110 → ~60
```

### Phase 2 — 중간 난이도 (2시간)
```
[x] Step 5: R4 — 6개 파일 optional 가드 추가 (nullish coalescing)
[x] Step 6: R5 — i18n 캐스팅 `as unknown as Record<string, string>` 변경
```

**중간 검증**:
```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
# 목표: 60 → ~20
```

### Phase 3 — 타입 확장 (2시간)
```
[x] Step 7: R2 — PlanDetailDict을 전용 인터페이스로 확장
[x] Step 8: 잔여 산발 에러 개별 처리
```

**최종 검증**:
```bash
npx tsc --noEmit
# 목표: 에러 0
npm run build
# 목표: exit 0
```

### Phase 4 — 배포
```
[x] Step 9: 커밋 분할 (Phase별 커밋 3~4개)
[x] Step 10: git push → Vercel 자동 배포 → 빌드 성공 확인
[x] Step 11: 프로덕션 스모크
  - 홈 로딩
  - 플래너 위저드 진입
  - 플랜 상세 페이지 i18n 전환
  - MyPage 탭 전부
```

---

## 📊 에러 원인 주석

### 왜 이렇게 많이 터졌나?

직전 스프린트에서 두 가지 대형 리팩터 동시 실행:
1. **BUG-1 i18n 수정**: 번역 캐시 기반 플랜 결과 다국어화 (`useAutoTranslate.ts`, `api/translate-plan.js`, `PlanDetailDict` 타입 도입)
2. **UX-1 홈 개편**: 호텔/비행기/차터 CTA 추가 (HomePage + PlannerPage 재구성)

**문제**: 로컬에서 `tsc --noEmit` 최종 실행 누락 → 중간 리팩터 상태로 커밋/푸시됨.

### 재발 방지

1. **Pre-commit hook**: `tsc --noEmit` 통과 못하면 커밋 차단 (`husky` + `lint-staged`)
2. **CI 초기 단계**: PR에서 `tsc --noEmit` 실패 시 배포 차단
3. **대형 리팩터 체크리스트**: 
   - [ ] 새 타입 정의 시 반드시 해당 모듈에 export 확인
   - [ ] 기존 인터페이스 수정 시 중복 선언 검사
   - [ ] Optional 필드 추가 시 모든 호출부 가드 확인

---

## 🚫 본 수정 세션 금지 사항

1. **신규 기능 추가 금지** — 빌드 복구만
2. **LOCKED 영역** (`PayPalBookingButton.tsx` L164~225) 수정 금지
   - 단, L215의 SetStateAction 픽스는 LOCKED 영역 밖 → 허용
3. **Firestore Rules 변경 금지**
4. **의존성 추가/업그레이드 금지**
5. **i18n 문자열 신규 추가 금지** — 기존 키 재사용만

---

## ✅ 완료 기준

- [ ] `npx tsc --noEmit` 에러 0
- [ ] `npm run build` exit 0
- [ ] Vercel 배포 성공 (초록 체크)
- [ ] 프로덕션 `https://cocotripkr.com` 로딩 정상
- [ ] 플랜 상세 페이지 4개 언어 전환 정상 (BUG-1 검증)
- [ ] 홈 호텔/비행기/차터 CTA 정상 렌더 (UX-1 검증)

---

## 📞 사용자에게 보고할 내용

AG는 수정 완료 후 다음 양식으로 보고:

```markdown
## 빌드 에러 수정 완료

| 루트 원인 | 해결 여부 | 커밋 |
|----------|----------|------|
| R1 PlannerDict import | ✅ | <hash> |
| R2 PlanDetailDict 확장 | ✅ | <hash> |
| R3 중복 인터페이스 | ✅ | <hash> |
| ... | ... | ... |

**이전**: 110 에러
**이후**: 0 에러
**배포**: ✅ <vercel url>
```

---

## 📚 관련 문서

- `docs/HANDOFF-ux-critical-fixes.md` — BUG-1 원본 설계 (useAutoTranslate 유래)
- `docs/LAUNCH-FINAL-QA-CHECKLIST.md` — QA 체크리스트 (빌드 복구 후 재개)
- `CLAUDE.md §B, E` — 필드 스키마 + 4-lang i18n 규칙

---

**긴급도**: 🔴 **상용 블로커** — 이 수정이 최우선.
**예상 소요**: 5시간 (Phase 1+2+3+4)
**에러 감소 예상**: 110 → 0
