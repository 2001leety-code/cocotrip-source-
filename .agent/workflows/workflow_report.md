---
description: Auto-Stop 발동 소급 보고서 — PDF 백지 3회 재발 + mojibake 누적 사고
date: 2026-04-17
author: Claude (Anthropic) + 사용자
status: Emergency Exception 적용됨 (상용화 이번 주 데드라인)
---

# 🚨 워크플로우 중단 보고서 — 2026-04-17

## 발동 조건
- [x] **동일 에러 2회 이상 반복** — PDF 백지 3회 재발
- [x] **1변경 → 5개+ 파일 예상 외 파급** — mojibake가 주석 → 문자열 → UI까지 누적 확산
- [x] **빌드/배포 2회 이상 실패** — PDF 기능 배포 후 실제 작동 실패 3회
- [x] **10분 이상 추측으로 진행** — mojibake 근본 원인(이모지 저장 시 치환) 인지까지 누적 수일
- [ ] 같은 심볼 3회 이상 수정 (N/A)

---

## 증상

### 증상 1: PDF 다운로드 백지
- `833635b fix: blank PDF (position fix)` (최초 수정)
- `30aed45 fix(pdf): blank PDF — move container on-screen + wait for font loading` (2차 수정)
- 2026-04-17 현재: **또 백지로 회귀** (3회차 재발)

### 증상 2: `??Grilled chicken` UI 노출
- PlanDetailPage 추천 아이템 노트 앞에 리터럴 `??` 렌더링
- 유료 고객($9.90 결제자)에게 노출됨
- 원인: L966 `>??{item.note}` — 원래 유니코드 기호(`·` 또는 `•`)가 저장 중 ASCII `??`로 치환

### 증상 3: 언어 전환 시 플랜 본문 미번역
- 헤더 언어를 JA로 바꿔도 본문은 영어 원본 유지
- 원인: `useEffect` 의존성 배열이 `[language]` 뿐 → plan 데이터가 Firestore에서 나중에 도착할 때 재발화 안 됨
- 사용자가 언어 버튼을 2번 눌러야만 번역 API 호출됨

---

## 시도한 것 (시간순)

1. **2026-04-10경: `fix: blank PDF (position fix)`** — 컨테이너 `left:-9999px` → `position:absolute; left:0` 변경. 당시 해결됨.
2. **2026-04-12경: `fix(pdf): blank PDF — move container on-screen`** — `document.fonts.ready` 대기 추가. 당시 해결됨.
3. **2026-04-16: schema migration 커밋 (`c76c93a`)** — 이 시점에 에디터가 PlanDetailPage.tsx 저장하면서 유니코드 주석/이모지를 `?`로 치환한 것으로 추정. 이때 L966의 `??` 리터럴도 삽입됨.
4. **2026-04-17: 사용자 발견** — 스크린샷으로 UI에 `??Grilled chicken` 노출 + PDF 백지 재발 확인.
5. **2026-04-17: 직접 패치** (Emergency Exception 적용):
   - Bug 1: translation useEffect 의존성에 `planLoaded` 추가
   - Bug 2: L966 `??` → `·`, PDF HTML 문자열 내 mojibake 10군데 ASCII 치환
   - Bug 3: PDF 버튼 `disabled={isPdfGenerating || isTranslating}` + CJK font-family 체인 확장
   - 검증: `npx tsc --noEmit` → exit 0, diff stat 31+/22- (53줄)

---

## 실패 원인 추정 (Root Cause)

### 표면 원인
- 유니코드 이모지/한글이 일부 에디터에서 **UTF-8 인코딩 에러** 발생 시 `?` 문자로 치환됨
- 같은 파일을 여러 번 수정할수록 누적 악화

### 구조적 원인
1. **파일 비대화**: PlanDetailPage.tsx 1144줄 (수정 금지선 1000줄 초과). `coding-rules.md` §6 위반 상태에서 지속 수정.
2. **이모지 정책 위반**: `coding-rules.md` §1 "Emoji 사용 금지" 규칙이 있지만, PDF HTML 템플릿 리터럴 내부에는 이모지(`✈️`, `📍` 등)가 사용되어 있었음 (규칙 사각지대).
3. **Mojibake 검증 누락**: `npx tsc --noEmit`은 통과하지만 `??` / U+FFFD 문자열은 타입 체크 대상이 아님 → 자동 검증 파이프라인에 없음.
4. **Auto-Stop 미발동**: 같은 버그(PDF 백지) 2회 재발 시점에서 중단+보고 해야 했으나, "핫픽스" 명목으로 계속 땜질.

### 근본 원인
**워크플로우 규칙이 있어도 실행 강제 수단이 없었음**. `.agent/workflows/coding-workflow.md`가 존재하지만:
- 시작 선언 (`[계약서 로드됨]`) 문구가 실제 대화에서 누락
- Auto-Stop 발동 감지가 개인 판단에 의존
- 자동 검증 (mojibake 스캔)이 CI/pre-commit에 없음

---

## 적용한 수정 (Emergency Exception)

### 파일 수정 목록
- `src/pages/PlanDetailPage.tsx` — 31+ / 22- 줄 (총 53줄 변경)

### 검증 결과
- `npx tsc --noEmit` → **exit 0** (타입 에러 0)
- Mojibake 재스캔 → **해당 영역 CLEAN** (L93-138, L155-344, L662-670)
- Diff 규모: surgical (53줄, 단일 파일)

### 변경 요약
| Bug | 위치 | 수정 |
|---|---|---|
| 1. 번역 미발화 | L93-138 useEffect | deps에 `planLoaded` 추가 |
| 2. `??` UI 노출 | L966 | `>??{item.note}` → `>· {item.note}` |
| 2. PDF mojibake | L193/199/226/235/240/241/242/243/244/253/278/280/283/286/293/294 | 이모지/mojibake → ASCII 치환 |
| 3. PDF 백지 A | L170 container font-family | CJK fallback 체인 추가 |
| 3. PDF 백지 B | L662 button | `disabled`에 `isTranslating` 조건 추가 |

---

## 제안 (후속 조치)

### Emergency Exception 적용 사유
- [x] 상용화 윈도우 이번 주 데드라인 (48시간 내)
- [x] 유료 사용자에게 버그 노출 (환불 리스크)
- [x] 수정 규모 작고 surgical (53줄, 검증 통과)

### 48시간 내 의무사항 (체크리스트)
- [x] `workflow_report.md` 작성 (이 문서)
- [x] `.agent/workflows/antigravity-4phase.md` 신설 (PM 4-Phase 공식화)
- [x] `.agent/workflows/anti-gravity-handoff.md` 신설 (수정 금지 영역 공식화)
- [x] `.agent/rules/coding-rules.md` 업데이트 (mojibake 정책 §1.5, 파일 락 §6.1 추가)
- [ ] 사용자 승인 후 커밋 + 배포
- [ ] 다음 Phase 1 계획 진입: PlanDetailPage 분리 설계

### 분리 채무 (Debt) — 큐잉
우선순위 순 (상용화 스테이블화 이후 Phase 1부터 정식 시작):

| 순위 | 파일 | 현재 | 목표 | 예상 공수 |
|---|---|---|---|---|
| P0 | `src/pages/PlannerPage.tsx` | 1991줄 | 6-7파일 × 300줄 | 1-2일 |
| P1 | `api/ai-planner-full.js` | 1273줄 | 3-4모듈 × 300줄 | 1일 |
| P2 | `src/pages/PlanDetailPage.tsx` | 1144줄 | 4-5파일 × 230줄 | 1일 |
| P3 | `src/components/WizardForm.tsx` | 807줄 | 3파일 × 270줄 | 0.5일 |

### 재발 방지 (체계 개선)
1. **Pre-commit hook 추가** (권장):
   ```bash
   #!/bin/sh
   # Mojibake 스캔
   git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|md)$' | while read f; do
     if grep -q '??\|\uFFFD' "$f"; then
       echo "ERROR: Mojibake detected in $f"; exit 1
     fi
   done
   # tsc 체크
   npx tsc --noEmit || exit 1
   ```
2. **이모지 Lint 룰 추가** — ESLint custom rule 또는 grep-based pre-commit 훅으로 `.tsx`/`.ts`/`.js` 내 이모지 사용 차단.
3. **파일 크기 Lint** — 1000줄 초과 파일 수정 시 커밋 차단.
4. **작업 시작 선언 의무화** — Antigravity 프롬프트 템플릿에 `[계약서 로드됨]` 문구 자동 포함.

---

## 승인

- [ ] 사용자 확인: 2026-04-17
- [ ] 현재 패치 유지 (Option A) 동의
- [ ] 분리 채무 큐 동의
- [ ] 재발 방지책 우선순위 논의 후 Phase 1 진입

**서명**: (사용자 확인 후 기입)

---

## Emergency Exception 로그

### 2026-04-28 — `api/ai-planner-full.js` 500줄 한도 초과 (504줄)

**상황**: 상용화 D-3 모니터링 강화 PR. Gemini quota exhausted 감지 + 즉시 telegram alert
+ 503 응답 코드 추가. 핵심 4줄 추가로 499→504줄.

**예외 사유**:
- 운영 안전망 (사용자 트래픽 폭증 시 무성 장애 차단) 즉시 필요
- Gemini API 한도 도달 시 서비스 전체 멈춤 → 즉시 인지가 필수
- 파일 분해 (validateResponse / buildSystemPrompt 분리)는 별도 PR로 진행 예정

**채무 큐 추가**: `api/ai-planner-full.js` 분해 (504→<400줄 목표)
- buildSystemPrompt (L171-488) 별도 모듈 추출
- validateResponse (L129-169) 별도 모듈 추출
- 예상: 1-2일 작업, 상용화 후 진행
