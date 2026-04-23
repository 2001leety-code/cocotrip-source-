---
description: Antigravity 에이전트에 부여하는 4-Phase PM 워크플로우 — 외부 Antigravity 스펙을 프로젝트 내부 규칙과 병합
priority: 이 문서 = coding-workflow.md와 동급. 충돌 시 더 엄격한 쪽(보수적인 쪽)을 따름.
---

# 🚀 Antigravity 4-Phase Workflow

> **이 문서의 역할**: Antigravity 에이전트에게 작업을 위임할 때 적용하는 PM(Product Manager)형 4단계 승인 플로우.
> `coding-workflow.md`의 3대 원칙(질문 쪼개기 / 파일 나누기 / 병렬 작업)과 **동시에** 준수해야 함.
> 한 쪽이라도 어기면 작업 중단 + `workflow_report.md` 작성.

---

## 📌 Phase 0: 작업 시작 전 필수 (Pre-Flight)

Antigravity가 어떤 작업이든 시작하기 전에 반드시:

1. **계약서 로드**: 아래 3개 문서를 순서대로 읽고 `[계약서 로드됨]` 선언
   - `.agent/rules/coding-rules.md`
   - `.agent/rules/project-context.md`
   - `.agent/rules/business-logic.md` (결제/예약 관련 작업 시)
2. **워크플로우 로드**: 
   - `.agent/workflows/coding-workflow.md` (마스터)
   - `.agent/workflows/antigravity-4phase.md` (이 문서)
   - `.agent/workflows/anti-gravity-handoff.md` (절대 수정 금지 영역)
   - `.agent/workflows/common-mistakes.md` (AI 반복 실수 체크리스트)
3. **작업 성격별 추가 문서 로드** (`coding-workflow.md` §작업 시작 프로토콜 참조)

Phase 0 없이 Phase 1~4 진입 금지. 시작 선언 문구:

```
[계약서 로드됨] .agent/rules/ + .agent/workflows/ 읽었음.
3대 원칙(쪼개기/나누기/병렬) + 4-Phase 워크플로우 + 출입금지 영역 준수 시작.
```

---

## Phase 1: 기획 및 아키텍처 설계 (GStack Mode)

**산출물**: `docs/plans/<feature>-implementation-plan.md` (Artifact)

### 해야 할 일
- 사용자가 요구사항을 제시하면 **절대 즉시 코드 작성 금지**.
- 다각도로 분석: 기술 스택, 폴더 구조, DB 스키마, 핵심 로직, 예외 처리, i18n 영향, 파일 크기 영향.
- **수정 대상 파일이 600줄 이상**이면 → Phase 1 안에서 "분리 태스크"를 먼저 계획에 포함시킬 것. 분리 없이 바로 수정 금지.
- **수정 대상 파일이 1000줄 이상**이면 → 수정 태스크 자체 금지. Phase 1은 오직 "분리 설계"만 다룸.

### Implementation Plan 문서 템플릿
```markdown
# [Feature Name] Implementation Plan

## 1. 목표
(무엇을 달성하려고 하는가)

## 2. 영향 범위
- 수정 파일 목록 + 현재 줄 수
- 신규 파일 목록 + 예상 줄 수
- i18n 키 추가 (ko/en/ja/zh 4개 필수)
- DB 스키마 변경 여부

## 3. 파일 크기 사전 체크 (필수)
| 파일 | 현재 줄 수 | 수정 후 예상 | 판정 |
|------|-----------|-------------|------|
| X.tsx | 450 | 490 | 🟢 OK |
| Y.tsx | 1100 | - | 🔴 수정 금지 → 분리 선행 |

## 4. 아키텍처 다이어그램
(데이터 흐름 or 컴포넌트 트리)

## 5. 리스크 & 예외 처리
- 절대 금지 규칙(CLAUDE.md §B) 저촉 여부
- Auto-Stop rule 발동 가능성
- 롤백 시나리오

## 6. 승인 체크박스
- [ ] 사용자 승인
- [ ] 파일 크기 제한 통과
- [ ] i18n 4개 언어 준비 확인
- [ ] 다음 Phase 진행 가능
```

### Phase 1 마무리
```
"설계가 마음에 드시나요? 수정할 부분이 없다면 Phase 2(Master Task List)로 넘어갈까요?"
→ 사용자 승인 대기
```

---

## Phase 2: 마이크로 태스크 분할 (Superpowers Mode)

**산출물**: `docs/plans/<feature>-master-task-list.md` (Artifact)

### 해야 할 일
- Phase 1 승인 후, 설계를 **1 태스크 = 1 파일 = 단일 AI가 에러 없이 처리 가능한 크기**로 쪼갬.
- 각 태스크에 다음 메타데이터 부여:
  - 선행 태스크 (의존성)
  - 병렬 가능 여부
  - 예상 수정 줄 수
  - 검증 커맨드

### Master Task List 템플릿
```markdown
# [Feature Name] Master Task List

## 실행 순서 그래프
```
[T1: types 정의] → [T2: 유틸 함수] ┐
                                    ├─→ [T5: UI 연결]
                   [T3: API 훅]    ┘
                                    
                   [T4: i18n 키] (병렬)
```

## 태스크 목록
### T1. `src/types/plan.ts`에 `AccommodationRec` 인터페이스 추가
- 의존성: 없음
- 병렬: T3/T4와 병렬 가능
- 예상 수정: +12줄
- 검증: `npx tsc --noEmit`
- DoD: 신규 타입이 PlanDetailPage에서 import 가능

### T2. ...
```

### Phase 2 마무리
```
"이 태스크 리스트로 진행할까요? 승인해주시면 Phase 3로 넘어가겠습니다."
→ 사용자 승인 대기
```

---

## Phase 3: 독립적 단일 실행 (Focused Execution)

### 해야 할 일
- 사용자가 **T1 해줘** 또는 **병렬로 T1,T3,T4 해줘** 라고 지시하면 **지시받은 태스크만** 실행.
- 다른 태스크에 손대지 마. "이왕 하는 김에" 금지.
- 여러 태스크 병렬 실행 시 `coding-workflow.md` §3 병렬 안전 규칙 필수 준수:
  - 서로 import 관계가 있으면 병렬 금지
  - 같은 파일을 2개 도구가 동시 수정 금지

### Phase 3 실행 중 규칙
- 파일 수정 전: 대상 파일 줄 수 재확인 (Phase 1 계획과 차이 있으면 중단)
- 수정 후: `npx tsc --noEmit` 즉시 실행
- 절대 금지: "계획에 없는 파일"에 손대기 → 보이면 바로 Phase 1로 복귀

---

## Phase 4: 자율 검증 및 시각적 보고 (Self-Verification & TDD)

### 해야 할 일
각 태스크 완료 시 **아래 검증을 전부 통과한 증거와 함께** 보고. 증거 없이 "완료" 선언 금지.

### 필수 검증 스위트
```bash
# 1. 타입 체크 (모든 태스크)
npx tsc --noEmit
# → 출력 로그 전체 캡처

# 2. Mojibake 스캔 (편집한 모든 .ts/.tsx/.js 파일)
node -e "
const fs=require('fs');
const files=process.argv.slice(1);
let bad=0;
files.forEach(f=>{
  const c=fs.readFileSync(f,'utf8');
  if(/\?\?/.test(c)||/\uFFFD/.test(c)||/\?\u0080-\u00FF/.test(c)){
    console.error('MOJIBAKE in',f);bad++;
  }
});
process.exit(bad);
" <수정한 파일 목록>

# 3. 빌드 테스트 (배포 직전 1회만, Vercel 비용 아낌)
npx tsc -b && npx vite build

# 4. 브라우저 실사 (UI 태스크만)
# Antigravity Browser Control로 로컬 서버(localhost:5173) 띄운 뒤:
#   - 해당 페이지 로드
#   - 수정한 기능 1회 시연
#   - 스크린샷 2장 (수정 전 / 후)
#   - 콘솔 에러 0 확인

# 5. 플래너 품질 (AI 프롬프트 수정 시만)
node scripts/validate-planner.cjs
# 기준치: 총 이슈 ≤9, bad_address_prefix=0, language_mismatch≤1
```

### 보고 템플릿
```markdown
## T[N] 완료 보고

### 변경 요약
- 수정 파일: X.tsx (L120-145 / +18줄 -3줄)
- 신규 파일: 없음

### 검증 결과
- [x] `tsc --noEmit` → exit 0 (로그 첨부)
- [x] Mojibake 스캔 → CLEAN
- [x] Browser 실사 → 스크린샷 2장
- [x] 콘솔 에러 → 0건

### 스크린샷
![before](...)  ![after](...)

### 다음 단계
"T[N] 완료했습니다. 체크박스 ✅ 처리하고 T[N+1]로 넘어갈까요?"
```

사용자가 **"다음"** 이라고 승인하면:
- Master Task List의 해당 태스크 체크박스를 ✅로 변경
- 다음 태스크 Phase 3로 진입

---

## 🚨 Emergency Exception (상용화/프로덕션 장애 시)

**이런 경우만** 4-Phase 생략 가능:
1. 프로덕션 서비스 장애 (결제 안 됨, 페이지 크래시 등)
2. 유료 사용자에게 노출된 심각한 버그
3. 보안 이슈
4. 상용화 윈도우 데드라인 임박 (48시간 이내)

Emergency 시 허용되는 것:
- Phase 1/2 생략 → 즉시 핫픽스
- **단, 수정은 최소한의 surgical edit (50줄 이내, 단일 파일 선호)**
- **단, `npx tsc --noEmit` + mojibake 스캔은 반드시 통과**

Emergency 후 **48시간 이내** 의무사항:
- [ ] `workflow_report.md`에 Emergency 적용 사유 + 변경 diff 기록
- [ ] Phase 1 소급 계획서 작성 (후속 정식 작업용)
- [ ] 수정된 파일이 1000줄 초과 상태면 "분리 채무" 티켓 생성

---

## 🔗 타 문서와의 관계

| 이 문서 | 관련 문서 | 관계 |
|---|---|---|
| Phase 0 (계약서 로드) | `.agent/rules/*` | 반드시 먼저 읽음 |
| Phase 1 (설계) | `coding-workflow.md` §원칙 2 (파일 나누기) | 600/1000줄 체크는 Phase 1에서 |
| Phase 3 (실행) | `coding-workflow.md` §원칙 3 (병렬) | 병렬 안전 규칙 준수 |
| Phase 4 (검증) | `quality-check.md` | 검증 항목 구체는 quality-check 참조 |
| 모든 Phase | `anti-gravity-handoff.md` | 수정 금지 영역 항상 준수 |
| Auto-Stop | `coding-workflow.md` §🚨 | 발동 조건 동일 |

---

## 위반 시

- Phase 0 생략 → 즉시 중단, 계약서 로드 후 재시작
- Phase 1 스킵 후 Phase 3 직행 → 작업 revert, Phase 1부터
- Phase 4 검증 누락 → 커밋 거부
- 수정 금지 파일 수정 → `anti-gravity-handoff.md` §절대 금지 위반 → PR reject
