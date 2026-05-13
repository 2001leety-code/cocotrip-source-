# RUNBOOK — AI Planner Validator 비상 비활성 (Circuit Breaker)

**대상**: 운영자 (Vercel Dashboard 접근 권한)
**작성일**: 2026-05-13 (PR #412)
**상황**: AI planner validator (B-DC / B-MEAL / R-TSP) 가 prod 에서 false-positive 다발 → 사용자 plan 생성 실패 / 환불 발생

---

## 🚨 트리거 신호

다음 중 하나 이상 발생 시 본 매뉴얼 검토:

1. **Telegram alert 다발** — `🔴 AI plan validation failed` 1시간 내 5건+ (정상 < 1건)
2. **Sentry alert** — `PLAN_VALIDATION_FAILED` (500) 빈도 임계 초과
3. **사용자 신고** — "AI 플래너 실패 / retry 안 됨"
4. **Vercel function logs** — `[validator] B-MEAL` 또는 `B-DC` 로그 다발

---

## 🩹 즉시 비활성 절차 (5분 이내)

### Step 1: Vercel Dashboard 진입
```
https://vercel.com/2001leety-3613s-projects/cocotrip-source_2026/settings/environment-variables
```

### Step 2: 해당 validator env flag 추가
**해당하는 것만 추가** (모두 false 권장 X — false-positive 의심되는 것만):

| Validator | Env Key | Value | 영향 |
|---|---|---|---|
| **B-DC** (Day count match) | `VALIDATOR_BDC_ENABLED` | `false` | Day 누락 검출 OFF — Gemini 가 4일 응답해도 통과 |
| **B-MEAL** (Lunch + dinner) | `VALIDATOR_BMEAL_ENABLED` | `false` | 식사 시간대 검증 OFF — 식사 누락 plan 통과 |
| **R-TSP** (Stop reorder) | `ROUTE_TSP_ENABLED` | `false` | Intra-day 거리 최적화 OFF — Gemini 순서 그대로 |

각 flag: Environment = **Production** 체크 + Save.

### Step 3: Redeploy (자동 또는 수동)
- Vercel 가 env 변경 시 자동 prompt
- 또는 GitHub main 에 빈 commit push → 자동 redeploy
- 약 2분 후 prod 반영

### Step 4: 검증
- TEST_ACCOUNTS (2001leety@gmail.com) 로 plan 생성
- `PLAN_VALIDATION_FAILED` 사라지는지 확인
- Sentry / Telegram alert 멈춤 확인

---

## 🔬 근본 원인 진단 (비활성 후)

### B-DC false-positive 의심
- Vercel logs `[validator] B-MEAL Day N` 검색 → Gemini 가 실제로 day 누락하는지
- 사용자 wizard 의 `durationDays` 값 vs Gemini 응답 `days.length` 비교
- 만약 Gemini 가 일관되게 truncate → buildPrompt 재작성 필요

### B-MEAL false-positive 의심
- Vercel logs `[validator] B-MEAL Day N: foodStops=X lunch=Y dinner=Z times=[...]` 검색
- `times` 배열의 실제 식사 시각 분포 확인
- 만약 14:30+ lunch / 21:30+ dinner 흔함 → boundary widening 검토 (현재 [11,15) + [17,22))

### R-TSP 문제 의심
- Vercel logs `[Route] Day N: intra-day TSP reorder applied` 검색
- 사용자 PDF 동선 비교 (변경 전후)
- 시간 역전 발견 시 → PR #413 chronological preserve 확인 (이미 반영)

---

## ⏩ 복구 절차 (비활성 → 재활성)

근본 원인 fix PR 머지 후:

### Step 1: prod 모니터링 24h
- false-positive 빈도 감소 확인
- 신규 Sentry / Telegram alert 0건 확인

### Step 2: env flag 제거 (재활성)
- Vercel Dashboard → Environment Variables → 해당 flag **Remove** 또는 `true` 변경
- Redeploy → 약 2분 후 반영

### Step 3: 사후 검증
- TEST_ACCOUNTS 로 plan 1회 생성
- Telegram alert 미발생 확인

---

## 📋 자율 검증 시스템 (Validator) 전체 목록

| ID | 설명 | Hard/Soft | Env Flag | PR |
|---|---|---|---|---|
| B-10 | Lodging bookend | Hard | — | (legacy) |
| B-12 | Min 4 stops per day | Hard | — | (legacy) |
| B-13 | Multi-city lodging city match | Hard | — | (legacy) |
| B-14 | start_time hour < 24 | Hard | — | (legacy) |
| B-15 | Last day airport stop | Hard | — | (legacy) |
| B-16 | Arrival/departure guide airport | Hard | — | (legacy) |
| B-18 | Local_tag diversity ≥ 30% | Soft | — | (legacy) |
| **B-DC** | **Day count match (durationDays)** | **Hard** | `VALIDATOR_BDC_ENABLED=false` | **#407** |
| **B-MEAL** | **Lunch + dinner per full day** | **Hard** | `VALIDATOR_BMEAL_ENABLED=false` | **#407 / #412** |
| **R-TSP** | **Intra-day stop reorder** | **N/A (도구)** | `ROUTE_TSP_ENABLED=false` | **#409 / #413** |

---

## 🛡️ 안전 원칙

- **하나씩 비활성**: 모두 false 권장 X — 의심되는 validator 만
- **24h 모니터링**: 비활성 후 다른 측면 (다른 validator / dietary 등) 영향 없는지 확인
- **재활성 전 prod 검증**: TEST_ACCOUNTS 로 sample plan 5+ 생성 후 통계 검토
- **dietary (SAFETY-CRITICAL J)는 절대 비활성 X**: halal/vegan/vegetarian violation 은 건강 위험

---

## 📞 에스컬레이션

- Telegram alert 다발 + 본 매뉴얼 적용 후에도 해결 X → 즉시 Claude 호출 (또는 GitHub PR `git revert`)
- `git revert <PR sha>` 후 push → Vercel 자동 redeploy → validator 코드 자체 제거

호출 키워드: "**validator 비상 비활성**" / "**circuit breaker**" / "**B-DC false-positive**" / "**B-MEAL false-positive**"
