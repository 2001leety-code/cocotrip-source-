---
description: AI 에이전시 6대 부서 병렬작업 규칙 — 순서/의존성/병렬 가능 구간 정의
---

# 🏢 부서별 병렬작업 가이드 (Department Parallel Execution Rules)

> 이 문서는 CocoTripKR AI 에이전시 6대 부서가 어떤 순서로, 어떤 구간에서 병렬로 작업할 수 있는지 정의합니다.
> 코드 수정, AI 파이프라인, 예약 처리 등 모든 작업에 이 규칙을 적용합니다.

---

## 📐 전체 파이프라인 흐름도

```
                    ┌───────────────────┐
                    │  1호: 기획팀       │
                    │  (Planner Agent)   │
                    │  일정 JSON 생성    │
                    └────────┬──────────┘
                             │ (순차 — 기획 결과 필수)
                    ┌────────▼──────────┐
                    │  2호: 기술팀       │
                    │  (Route Agent)     │
                    │  네이버API + 동선  │
                    └────────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              │     ★★★ 병렬 가능 구간 ★★★    │
    ┌─────────▼──────────┐  ┌──────────▼─────────┐
    │  3호: 디자인팀      │  │  4호: 마케팅팀      │
    │  (Designer Agent)  │  │  (Marketing Agent)  │
    │  UI Props + 미션   │  │  3줄 요약 + SNS     │
    └─────────┬──────────┘  └──────────┬─────────┘
              │                        │
              └──────────┬─────────────┘
                         │ (양쪽 결과 합류)
                ┌────────▼──────────┐
                │  5호: 검수팀       │
                │  (QA Agent)       │
                │  최종 검증         │
                └────────┬──────────┘
                         │
                ┌────────▼──────────┐
                │  6호: 고객만족팀   │
                │  (CS & Billing)   │
                │  결제/이메일/알림  │
                └───────────────────┘
```

---

## 🚦 의존성 규칙 (Dependency Rules)

### 순차 실행 (Sequential — 반드시 순서 지켜야 함)
| 단계 | 설명 | 이유 |
|------|------|------|
| 기획팀 → 기술팀 | 일정 JSON이 있어야 동선 보강 가능 | 기술팀은 기획팀의 장소 데이터 필요 |
| 디자인+마케팅 → 검수팀 | 4개 부서 결과가 모여야 QA 가능 | 검수팀은 전체 데이터를 교차 검증 |
| 검수팀 → 고객만족팀 | QA 통과 후에만 결제/발송 진행 | 환각 데이터가 고객에게 전달되면 안 됨 |

### 병렬 실행 (Parallel — 동시 처리 가능)
| 병렬 그룹 | 설명 | 코드 패턴 |
|-----------|------|-----------|
| **디자인팀 + 마케팅팀** | 기술팀 결과만 있으면 독립 작업 가능 | `Promise.all([designer, marketing])` |
| **이메일 + 텔레그램 + Sheets** | 결제 후 알림 3종 동시 발송 | `Promise.allSettled([email, telegram, sheets])` |
| **PDF 바우처 + Wallet 패스** | 예약 확정 후 동시 생성 가능 | `Promise.all([pdf, wallet])` |

---

## 🔧 코드에서의 적용 패턴

### A. AI 플래너 파이프라인 (`ai-planner-full.js`)

```
현재 구현:
 1. Gemini (기획팀)          → 순차 (45~240초)
 2. RouteAgent (기술팀)      → 순차 (non-fatal)
 3. T-money 계산             → 순차 (서버 계산)
 4. Firestore 저장           → 순차 (blocking — 필수)
 5. JSON 응답 반환           → 순차
 ─── 여기부터 non-blocking (응답 후 병렬) ───
 6. 이메일 발송              → 병렬 (fire-and-forget)
 7. Google Sheets 리드 기록  → 병렬 (fire-and-forget)
 8. 텔레그램 알림            → 병렬 (fire-and-forget)
```

### B. 예약 처리 오케스트레이터 (`booking-processor.js`)

```
현재 구현 (순차):
 1. 환율 조회               → 순차
 2. Google Sheets 기록      → 순차 (non-fatal)
 3. 텔레그램 알림           → 순차 (non-fatal)
 4. PDF 바우처 생성         → 순차
 5. Google Wallet 패스      → 순차
 6. 이메일 발송 (PDF첨부)   → 순차
 7. Sheets 상태 업데이트    → 순차
 8. 로열티 포인트 적립      → 순차 (non-fatal)

최적화 가능 (병렬):
 1. 환율 조회                           → 순차
 2. [Sheets 기록 + 텔레그램 알림]       → ★ 병렬 가능
 3. [PDF 바우처 + Wallet 패스]          → ★ 병렬 가능
 4. 이메일 발송 (2,3 결과 합류 필요)    → 순차
 5. [Sheets 업데이트 + 로열티 적립]     → ★ 병렬 가능
```

### C. Python 오케스트레이터 (`orchestrator.py`)

```
현재 구현 (전부 순차):
 planner → route → designer → marketing → qa

최적화 가능:
 planner → route → [designer || marketing] → qa

코드 적용:
 import asyncio
 # designer와 marketing을 asyncio.gather로 동시 실행
 designer_task = asyncio.create_task(designer.call(prompt))
 marketing_task = asyncio.create_task(marketing.call(prompt))
 designer_result, marketing_result = await asyncio.gather(designer_task, marketing_task)
```

---

## 🚫 병렬화 금지 항목

| 절대 병렬 불가 | 이유 |
|---------------|------|
| 기획팀 → 기술팀 | 기획 결과 없으면 동선 보강 불가 |
| 결제 검증 → 서비스 제공 | 미결제 상태에서 리포트 생성 방지 |
| Firestore 저장 → 응답 반환 | planId가 없으면 프론트에서 접근 불가 |
| QA 검증 → 고객 이메일 발송 | 환각 데이터 발송 방지 |

---

## 📊 Cron Job 병렬 구조

```
매일 07:00 KST (daily-report.js):
  → Promise.allSettled([
      yesterdayRows,    // Sheets에서 어제 데이터 읽기
      todayTours,       // 오늘 투어 목록 조회
      weekSummary,      // 주간 요약 조회
      rateInfo          // 환율 정보 조회
    ])
  → Gemini AI 리포트 생성 (4개 결과 합류 후)
  → 텔레그램 전송

매일 18:00 KST (weather-check.js):
  → Open-Meteo 날씨 조회
  → Gemini 대체 코스 생성
  → 텔레그램 전송

Reddit 모니터링 (reddit-monitor.js):
  → 1시간마다 실행
  → Promise.allSettled([
      r/koreatravel 스캔,
      r/korea 스캔,
      r/kpop 스캔
    ])
  → 관련 게시물 발견 시 텔레그램 알림
```

---

## ⚡ 프론트엔드 병렬 규칙

### 페이지 로드 시 병렬 fetch
```typescript
// ✅ 좋은 예: 독립적인 데이터를 동시에 가져옴
const [userData, plans, availability] = await Promise.all([
  fetchUserProfile(uid),
  fetchUserPlans(uid),
  checkAvailability(date),
]);

// ❌ 나쁜 예: 하나씩 순차적으로 가져옴
const userData = await fetchUserProfile(uid);
const plans = await fetchUserPlans(uid);
const availability = await checkAvailability(date);
```

### 컴포넌트 렌더링 병렬
```
모바일 홈 (MobileHome.tsx):
  → 프로모 배너                 (즉시 렌더)
  → 서비스 버튼 3개             (즉시 렌더)
  → 전세차량 카드               (즉시 렌더 — 정적 데이터)
  → AI 플래너 데모              (즉시 렌더 — 하드코딩)
  → 날씨 위젯                   (API 호출 후 렌더 — Suspense)
  → 포토 리뷰                   (즉시 렌더)
  → 인증 상태 분기 섹션          (Firebase Auth 상태 후 렌더)
```

---

## 📋 병렬 작업 체크리스트 (코드 수정 시)

```
[ ] 이 작업은 이전 단계 결과에 의존하는가? → 순차
[ ] 이 작업은 독립적으로 실행 가능한가? → 병렬 후보
[ ] 병렬 실행 시 Promise.allSettled 사용했는가? (일부 실패 허용)
[ ] non-fatal 작업은 try-catch로 감싸서 메인 플로우 차단 안 하는가?
[ ] 응답 반환 후 실행할 작업은 fire-and-forget (.catch() 처리) 했는가?
[ ] Vercel 함수 maxDuration 안에 병렬 작업이 모두 완료되는가?
```
