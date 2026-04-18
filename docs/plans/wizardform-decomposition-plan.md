---
description: WizardForm.tsx (798L) decomposition — P3 Lock release
owner: Claude + user
date: 2026-04-18
phase: 1 (Plan) — awaiting user approval before Phase 2
---

# WizardForm Decomposition — Implementation Plan

## 1. 목표
`src/components/WizardForm.tsx` (현재 798줄, P3 Lock) 을 7개 파일로 분리하여 파일당 200줄 이내로 축소. Lock 해제 조건 충족 + 이후 기능 추가/수정 안전성 확보.

## 2. 영향 범위

### 수정 파일 (1개)
| 파일 | 현재 | 수정 후 | 비고 |
|------|------|---------|------|
| `src/components/WizardForm.tsx` | 798 | 삭제 또는 re-export shim | index.tsx로 흡수 |

### 신규 파일 (7개, 디렉터리 `src/components/WizardForm/`)
| 파일 | 예상 줄 수 | 역할 |
|------|-----------|------|
| `WizardForm/index.tsx` | ~180 | 컨테이너 (state + step router + 제출 핸들러) |
| `WizardForm/data.ts` | ~120 | CITY_CHIPS / AIRPORT_OPTIONS / ACTIVITY_KEYS 등 상수 |
| `WizardForm/helpers.ts` | ~50 | getAirportOptions / getCityName / formatDateShort |
| `WizardForm/WizardStep0Destination.tsx` | ~130 | Step 0 (도시 + 날짜) |
| `WizardForm/WizardStep1Food.tsx` | ~110 | Step 1 (음식/다이어트/알레르기/예산) |
| `WizardForm/WizardStep2Details.tsx` | ~125 | Step 2 (공항 + 숙박 + 여행 스타일) |
| `WizardForm/WizardStep3Review.tsx` | ~120 | Step 3 (요약 + 제출) + SummaryCard |

### import 영향
- `src/components/WizardForm.tsx` 를 import 하는 파일은 경로 변경 없이 동작 (index.tsx가 자동 resolve)
- 내부 PlannerForm.tsx 도 영향 없음 (named export `WizardForm` 유지)

### i18n 영향
- **변경 없음**. 각 Step 컴포넌트가 `useLanguage()` 를 내부에서 호출 (기존과 동일 패턴).
- 4개 언어 키 추가/삭제 없음.

### DB 스키마 / API 영향
- **없음** — 순수 UI 리팩토링.

## 3. 파일 크기 사전 체크

| 파일 | 현재 | 수정 후 예상 | 판정 |
|------|------|-------------|------|
| WizardForm.tsx | 798 | 0 (삭제) | 🟢 |
| WizardForm/index.tsx | - | 180 | 🟢 |
| WizardForm/data.ts | - | 120 | 🟢 |
| WizardForm/helpers.ts | - | 50 | 🟢 |
| WizardStep0Destination.tsx | - | 130 | 🟢 |
| WizardStep1Food.tsx | - | 110 | 🟢 |
| WizardStep2Details.tsx | - | 125 | 🟢 |
| WizardStep3Review.tsx | - | 120 | 🟢 |

모든 파일 400줄 (신규 파일 기준) 이내. coding-rules.md §6 준수.

## 4. 아키텍처 다이어그램

```
PlannerPage.tsx
  └─ WizardForm (from @/components/WizardForm)
       └─ WizardForm/index.tsx (컨테이너)
            ├─ data.ts ── 상수 import
            ├─ helpers.ts ── 순수 함수 import
            ├─ <WizardStep0Destination />
            ├─ <WizardStep1Food />
            ├─ <WizardStep2Details />
            └─ <WizardStep3Review />
```

### Step 컴포넌트 props 계약
각 step은 동일한 props 형태:
```tsx
interface WizardStepProps {
  formData: PlannerFormValues;
  setFormData: (update: Partial<PlannerFormValues>) => void;
  onNext: () => void;
  onPrev?: () => void;
  // 추가 step별 props
}
```

## 5. 리스크 & 예외 처리

### 절대 금지 규칙 저촉 여부
- [x] `coding-rules.md §1` (이모지 금지) — Step 파일 옮기면서 신규 이모지 추가 금지
- [x] `coding-rules.md §1.5` (mojibake) — 파일 신규 생성 시 ASCII 우선
- [x] `coding-rules.md §6.1` (Lock) — 분리 작업 자체가 Lock 해제 조건
- [x] `CLAUDE.md §B` — 이 작업은 UI만, 프롬프트/DB 비건드림

### Auto-Stop 발동 가능성
- 낮음. 순수 리팩토링이고 각 태스크가 독립적.
- 주의: 한 번에 여러 step 컴포넌트 추출 금지 (병렬 import 충돌)

### 롤백 시나리오
- 각 태스크(T1~T7) 별 커밋 분리 → 문제 발생 시 해당 커밋만 revert
- 최악의 경우: 모든 커밋 revert → 원본 WizardForm.tsx 복원

## 6. 검증 기준

### 자동 검증 (각 태스크 완료 후)
```bash
npx tsc --noEmit  # exit 0 필수
node -e "..."     # mojibake scan (pre-commit hook이 자동 수행)
```

### 수동 검증 (T7 완료 후)
- [ ] 플래너 페이지 로드 성공
- [ ] Step 0 → Step 1 → Step 2 → Step 3 이동 가능
- [ ] 각 step에서 데이터 입력 후 다음 step으로 값 유지
- [ ] 최종 제출 시 PlannerForm.tsx 의 handleSubmit 수신
- [ ] 브라우저 콘솔 에러 0건
- [ ] 모바일/데스크톱 반응형 동작

## 7. Phase 2 예고 (Master Task List)

```
T1: data.ts 추출 (constants만) — 의존 없음, 병렬 가능
T2: helpers.ts 추출 (getAirportOptions 등) — T1 이후
T3: WizardStep0Destination.tsx 추출 — T1+T2 이후
T4: WizardStep1Food.tsx 추출 — T1+T2 이후, T3과 병렬 가능
T5: WizardStep2Details.tsx 추출 — T1+T2 이후, T3/T4와 병렬 가능
T6: WizardStep3Review.tsx 추출 — T1+T2 이후, 병렬 가능
T7: WizardForm.tsx → index.tsx 이동 + 컨테이너 정리
T8: 원본 WizardForm.tsx 삭제 또는 re-export shim 확인
```

Phase 3 실행 시 T3/T4/T5/T6 는 병렬로 돌릴 수 있음 (상호 의존 없음).

## 8. 예상 공수

- T1~T2: 20분
- T3~T6: 60분 (병렬 시)
- T7~T8: 30분
- 브라우저 실사: 15분
- **합계: 2시간 이내**

## 9. 승인 체크박스

- [ ] 사용자 승인 — 이 계획으로 진행해도 되는지
- [ ] 파일 크기 제한 통과 (모두 🟢)
- [ ] i18n 4개 언어 영향 없음 확인
- [ ] Phase 2 (Master Task List) 생성 진입 가능

---

**Phase 1 마무리 질문**:
> 이 설계로 진행할까요? 수정/의견 있으면 말씀해 주시고, 없으면 Phase 2 (상세 태스크 리스트) 로 넘어가겠습니다.
