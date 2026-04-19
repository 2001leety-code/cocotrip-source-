---
description: PlanDetailPage.tsx (1144L) decomposition — P2 Lock release (HIGH RISK)
owner: Claude + user
date: 2026-04-18
phase: 1 (Plan) — awaiting user approval
risk: HIGH — file has 3x PDF blank history + mojibake incident + Emergency Exception patches
---

# PlanDetailPage Decomposition — Implementation Plan

## 1. 목표
`src/pages/PlanDetailPage.tsx` (1144줄, P2 Lock) 을 디렉터리 구조로 분리하여 Lock 해제. **단일 책임** 원칙 + locked regions (L93-138, L155-344, L662-670) 의 문법적 이동만 허용 (로직 건드림 금지).

## 2. 현재 구조 (원본 1144줄 해부)

| 라인 | 섹션 | 줄 수 | 설명 |
|------|------|-------|------|
| 1-36   | imports + 상수      | 36  | CAT_ICON, TRANSIT_ICON, formatKRW |
| 42-768 | 메인 컴포넌트       | 727 | **너무 큼** — 추가 분리 필요 |
| ↳ 43-80  | state + Firestore   | 38  | - |
| ↳ 92-139 | **🔴 useEffect translate (LOCKED)** | 48 | L93-138 영역 건드림 금지 |
| ↳ 155-344| **🔴 handleDownloadPDF (LOCKED)** | 190 | PDF HTML 템플릿 + font-family 체인 |
| ↳ 383-768| render JSX          | 386 | Title, Tabs, Days, Budget, CTA |
| 769-829  | ArrivalGuide        | 61  | 독립 컴포넌트 |
| 830-853  | DayTimeline         | 24  | 독립 컴포넌트 |
| 854-878  | TransitArrow        | 25  | 독립 컴포넌트 |
| 879-1047 | StopCard            | 169 | 독립 컴포넌트 (제일 큼) |
| 1048-1094| BudgetTable         | 47  | 독립 컴포넌트 |
| 1095-1143| DepartureGuide      | 49  | 독립 컴포넌트 |

## 3. 분리안 — `src/pages/PlanDetailPage/` 디렉터리

| 파일 | 예상 줄 수 | 역할 | 리스크 |
|------|-----------|------|--------|
| `index.tsx` | ~280 | 컨테이너 (state + Firestore + render JSX) | 중 |
| `constants.tsx` | ~40 | CAT_ICON, TRANSIT_ICON, formatKRW | 낮음 |
| `useAutoTranslate.ts` | ~60 | 🔴 useEffect (L93-138) 이동 — 내용 보존 | **높음** |
| `pdfGenerator.ts` | ~210 | 🔴 handleDownloadPDF (L155-344) 이동 | **매우 높음** |
| `components/ArrivalGuide.tsx` | ~65 | 그대로 이동 | 낮음 |
| `components/DayTimeline.tsx` | ~30 | 그대로 이동 | 낮음 |
| `components/TransitArrow.tsx` | ~30 | 그대로 이동 | 낮음 |
| `components/StopCard.tsx` | ~175 | 그대로 이동 | 중 (큼) |
| `components/BudgetTable.tsx` | ~50 | 그대로 이동 | 낮음 |
| `components/DepartureGuide.tsx` | ~55 | 그대로 이동 | 낮음 |

합계: 10개 파일, 각 <=280줄.

## 4. 🚨 LOCKED 영역 이동 규칙

### L93-138 → `useAutoTranslate.ts` (custom hook)
- 함수 시그니처: `function useAutoTranslate(plan, setPlan, language)` → returns `{ isTranslating }`
- **내부 로직 한 글자도 수정 금지**:
  - `originalItineraryRef` 로직 유지
  - 의존성 `[language, planLoaded]` 유지
  - `planLoaded = !!plan?.itinerary` 조건 유지
  - fetch URL `/api/translate-plan` 유지
  - AbortController 정리 유지

### L155-344 → `pdfGenerator.ts`
- Export: `async function generatePDF(plan, options): Promise<void>`
- **건드리지 않는 것**:
  - container.style.cssText font-family 체인 전체 (CJK 폴백)
  - `position:absolute;top:0;left:0` 유지
  - PDF HTML 템플릿 리터럴 내용 (ASCII 상태 유지, mojibake 재삽입 금지)
  - html2canvas import + options
- **수정 가능한 것**:
  - 함수 시그니처 (외부 호출용 파라미터)
  - 에러 핸들링 → caller에게 throw 대신 alert 유지

### L662-670 → `index.tsx` 내 PDF 버튼
- `disabled={isPdfGenerating || isTranslating}` 조건 한 글자도 수정 금지
- `isTranslating` 은 useAutoTranslate에서 return, PDF 함수는 파라미터로 받음

## 5. 영향 범위

### 수정 파일
- `src/pages/PlanDetailPage.tsx` — **삭제**
- `src/App.tsx` — `lazyRetry(() => import('@/pages/PlanDetailPage'))` — **변경 없음** (디렉터리로 자동 resolve)

### 신규 파일: 10개 (위 표)

### i18n / API / DB 영향
- **없음** — 순수 리팩토링.

## 6. 파일 크기 사전 체크

| 파일 | 예상 | 판정 |
|------|------|------|
| index.tsx | 280 | 🟢 |
| pdfGenerator.ts | 210 | 🟢 |
| StopCard.tsx | 175 | 🟢 |
| 나머지 7개 | <=65 | 🟢 |

## 7. 리스크 & 롤백 전략

### 리스크 요인
1. **PDF 백지 재발** — 가장 위험. 함수 외부 이동 시 container DOM 조작 경로 달라짐.
2. **translate race condition** — useEffect를 custom hook으로 뺄 때 순서 변경 금지.
3. **mojibake 재삽입** — Write 시 에디터가 CJK 리터럴 치환 가능 → pre-commit hook이 차단.

### 롤백 전략
- 각 단계별 커밋 분리 (T1~T10)
- 문제 발생 시 `git revert <커밋>` 한 번으로 복원
- 최후: 전체 커밋 revert → 원본 PlanDetailPage.tsx 복원

### 검증
- `npx tsc --noEmit` — 각 태스크 후
- Pre-commit hook — mojibake + Lock size + tsc
- **수동 실사 (필수)**:
  - [ ] 플랜 페이지 로드
  - [ ] 언어 전환 시 자동 번역
  - [ ] PDF 다운로드 → 내용 있는 PDF (백지 아님)
  - [ ] 이미지 있는 경우 모바일 렌더링

## 8. Phase 2 태스크 분할 예고

```
T1: constants.tsx 추출 (낮은 위험, 병렬 가능)
T2: components/ 6개 컴포넌트 추출 (병렬 가능, 서로 독립)
T3: useAutoTranslate.ts 추출 (🔴 LOCKED, 단일 커밋)
T4: pdfGenerator.ts 추출 (🔴 LOCKED, 단일 커밋, 최대 신중)
T5: index.tsx 재구성 (모든 import 연결)
T6: 원본 PlanDetailPage.tsx 삭제
T7: 실사 검증 + Lock 해제
```

## 9. 예상 공수

- T1~T2: 30분
- T3: 30분 (신중)
- T4: 60분 (매우 신중)
- T5: 30분
- T6~T7: 30분
- **합계: ~3시간** (중간 tsc 검증 포함)

## 10. 승인 체크박스

- [ ] 사용자 승인 — 분리 그 자체
- [ ] 사용자 승인 — LOCKED 영역 이동 (구조만 이동, 로직 불변)
- [ ] 푸시 전 실사 검증 동의 (PDF + 번역 테스트)

---

**Phase 1 마무리 질문**:
> 이 설계로 진행할까요? LOCKED 영역(translate + PDF)은 **이동만** 하고 **로직 수정은 하지 않습니다**. 승인하시면 T1부터 순차 실행합니다.
>
> 대안: Phase 4 (3-pass 플래너) 같은 **기능 개선**을 우선할 수도 있습니다. 분리는 리스크 있고 시간 걸리는 작업이므로.
