# Quality Score Diagnosis — 2026-05-12 17:00 KST

> 자율 검증 시스템 (PR #365 Tier 1-A 일일 quality monitoring) **첫 발동 알람** 진단 보고서. 코드 변경 없음. 운영자 의사결정용.

## 1. 증상

| 지표 | 값 | 임계 | 판정 |
|---|---|---|---|
| 24h 평균 점수 | **77.6** | hard floor `80` | **HARD 미달** |
| 24h scoredCount | 20 | min 5 | OK |
| 24h min/max | 63 / 88 | — | spread 25점 (큰 편차) |
| 7d 평균 점수 | 82.4 | — | 베이스라인 |
| 24h vs 7d drop | −4.8 | regression `−10` | 미달 (regression 임계 아님) |

**결론**: `regression` 이 아니라 `hard_floor` 단독 트리거. drop 4.8 점은 임계 안이지만 hard floor 80 을 밑돌아 fail.

알람 발송 — quality-alert workflow → GitHub Issue + Telegram alert (PR #365 spec).

윈도우: **2026-05-11 11:27 KST ~ 2026-05-12 11:27 KST** (UTC 11:27).

## 2. 데이터 수집

### 2-1. metricFrequency 비교 (24h vs 7d avgRate)

| metric | 24h | 7d | Δ (24h − 7d) | 평가 |
|---|---|---|---|---|
| **unverified_restaurant** | **0.417** | 0.306 | **+0.111** | 🔴 최대 회귀 |
| **route_failure** | **0.473** | 0.413 | **+0.060** | 🔴 두 번째 |
| field_completeness | 0.339 | 0.286 | +0.053 | 🟡 |
| duplicate_stops | 0.126 | 0.102 | +0.024 | 🟡 |
| loose_schedule | 0.134 | 0.080 | +0.054 | 🟡 |
| tight_schedule | 0.710 | 0.740 | −0.030 | 🟢 개선 |
| bad_address_prefix | 0.002 | 0.002 | 0 | 🟢 OK |
| language_mismatch | 0 | 0 | 0 | 🟢 OK |
| dietary_violation | 0 | 0 | 0 | 🟢 OK (SAFETY-CRITICAL) |

핵심 회귀 2종: **`unverified_restaurant` 41.7% (+11.1pp)** 과 **`route_failure` 47.3% (+6.0pp)**.

### 2-2. byArea breakdown (24h)

| area | count | avgScore | worstMetric | 7d 비교 |
|---|---|---|---|---|
| seoul | 16 | 78.4 | tight_schedule (132) | 7d 78.4 → 동일 |
| seoul_city | 3 | **73.7** | route_failure (45) | 7d 86.5 → **−12.8 회귀** |
| busan | 1 | 77.0 | route_failure (17) | 7d 84.6 → −7.6 |

- 회귀 주범: **`seoul_city`** (다도시 plan / 서울 시내 day) — 7d 평균 대비 12.8점 추락
- `busan` 단 1 plan 만 — 통계적 신뢰도 낮음
- `seoul` 본진은 7d 와 같은 78.4 — 신규 회귀 부재 (이미 만성)

### 2-3. worstPlans (24h, score 63-80)

10건 모두 동일 패턴 — 100% `route_failure` (count == total):

| id 일부 | score | area | created (KST) | route_failure |
|---|---|---|---|---|
| f32a0cbd | 63 | seoul_city | 5/11 22:31 | 15/15 |
| 0d7379c6 | 66 | seoul | 5/12 11:27 | 13/13 |
| 7dfa6ea9 | 66 | seoul | 5/12 02:05 | 11/11 |
| 43e29c05 | 67 | seoul | 5/12 10:42 | 13/13 |
| 199b9526 | 67 | seoul | 5/12 10:38 | 15/15 |
| ff370ddb | 67 | seoul | 5/12 02:07 | 13/13 |
| 6e201f4c | 77 | busan | 5/12 11:16 | 17/17 |
| c48658a2 | 79 | seoul_city | 5/12 11:31 | 19/19 |
| 380db218 | 79 | seoul_city | 5/11 22:54 | 11/11 |
| fe6e15ea | 80 | seoul | 5/12 02:13 | 14/14 |

**모든 worst plan 이 100% route_failure** — 단 1 stop 도 transit 안 채워짐. **+ 모든 plan 이 PR #355 (cce73cb, B-11 TDZ fix, 5/12 11:47 KST) 머지 BEFORE 생성됨.** 11:31 의 c48658a2 가 cutoff 직전.

### 2-4. 최근 commit 시간 매칭

윈도우 (5/11 11:27 ~ 5/12 11:27 KST) 내 head 머지:

| 시각 (KST) | PR | 영향 영역 |
|---|---|---|
| **5/10 02:33** | #339 (TourBookingDialog autosave) | UX |
| **5/10 14:00** | #343 (PDF Day 분할) | PDF |
| **5/10 17:14** | #344 (transit silent skip) | Route |
| **5/12 01:58** | #348-#350 (B-2/B-5/B-6/B-7/B-8) | Plan 구조 / PDF |
| **5/12 11:19** | #351 (PDF Day 5 누락) | PDF |
| **5/12 11:19** | #352 (B-9 Test Mode 401) | Auth |
| **5/12 11:47** | **#353 (B-10/B-12 prompt 강화) — lodging bookend + 4 stops/day** | **AI Prompt** |
| **5/12 11:47** | **#354 (PDF rev 2 windowHeight)** | PDF |
| **5/12 11:47** | **#355 (B-11 TDZ fix) — RouteAgent `isCityChangeDay` 선언 위치** | **RouteAgent (root cause)** |

윈도우 후반 fix:
| 5/12 12:24 | #356 (PDF rev 3) | PDF |
| 5/12 13:18 | #357-#359 (PDF white canvas, validation, regression suite) | Pattern validator |
| 5/12 17:20 | #360 (B-13/B-15 validator) | Pattern validator |
| 5/12 17:20 | #361 (Playwright cache) | CI |
| 5/12 19:16-37 | #362-#368 (quality alert + 4-layer fallback) | Monitoring |

### 2-5. food_index / DB matcher / RouteAgent 변경 이력

지난 3일 (5/9~5/12) 변경:
- `api/_ai_core/agents/RouteAgent.js` — **PR #331 (5/10 00:09)**, #344 (5/10 17:14), **#355 (5/12 11:47)**
- `api/_ai_core/routeEnrichment.js` — #355 (5/12 11:47)
- `api/_food_index.json` — 변경 없음
- `api/_food_helper.js` — 변경 없음
- `api/_ai_core/dbMatcher.js` — 변경 없음

## 3. 가설 (확률 순)

### 🥇 가설 1 — B-11 TDZ 버그가 5/10 ~ 5/12 11:47 까지 모든 plan 의 transit 을 망친 잔여 효과 (확률 85%)

**증거:**
- PR #331 (5/10 00:09) 가 `isCityChangeDay` 변수를 RouteAgent.js Phase 3 사용처 위에 안 두고 들여썼음 → 매 day 마다 `ReferenceError: Cannot access 'isCityChangeDay' before initialization`
- `routeEnrichment.js` 의 try/catch 가 silent swallow → plan 은 정상 200 응답이지만 모든 stop 에 transit 미부착
- PR #355 (5/12 11:47) 가 root cause 확정 + fix
- **24h 윈도우 worst 10 plan 중 9 개가 5/12 11:47 이전 생성** — 완전히 일치
- worstPlans 의 100% `route_failure` (count == total) 패턴 = transit_from_prev 가 단 1 건도 채워지지 않음 = TDZ silent swallow 시그니처
- `seoul_city` 회귀 12.8점 = 다도시 plan 진입 (PR #331 다도시 지원) 시 트리거 빈도 ↑

**예측 검증법:** TDZ fix 직후 (5/12 12:00 ~ 5/12 19:00) 생성된 plan 들의 route_failure 비율을 별도로 측정 — 0.473 → 정상 ~0.15 수준이면 가설 확정.

### 🥈 가설 2 — `unverified_restaurant` 회귀는 별도 원인 (확률 40%, 가설 1 과 공존 가능)

**증거:**
- `_food_index.json` 변경 없음 → DB 자체는 무관
- 그러나 `unverified_restaurant` 가 +11.1pp (가장 큰 회귀) — TDZ 와 무관한 metric (RouteAgent 안 거침)
- PR #353 (5/12 11:47) prompt 강화에서 lodging bookend + `4 stops/day` 명시 → AI 가 stop 채우려고 verified 식당 cap 을 초과한 stop 생성하면서 `verified=false` 식당 비율 ↑ 가능
- PR #331 다도시 plan 처리 — 서울+부산/제주 식당이 cross-region 분배되며 unverified 비율 ↑ (PR #349 가 city 별 분배 fix 했지만 5/12 01:58 머지 → 윈도우 일부만 cover)

**후보 trigger:**
- (a) PR #353 prompt 가 stop 수 강제 → verified pool 부족할 때 `verified=false` 채움
- (b) PR #331 다도시 + 부산/제주 식당 DB 부족 (CLAUDE.md F 참조)

### 🥉 가설 3 — `field_completeness` +5.3pp 는 TDZ 의 부수 효과 (확률 70%)

- transit_from_prev / transit_to_next 가 빈 stop = field_completeness violation 카운트에 포함될 가능성
- worstPlans top metric 에 `field_completeness` 가 항상 등장 (route_failure 와 함께)
- TDZ 해결되면 부수적으로 함께 정상화 예상

### 가설 4 — 단순 통계 변동 (확률 10%)

- 24h sample 20 / 7d sample 33 — 표본 작음
- min=63 (worstPlans top 1) 단독으로 평균 ~1점 끌어내림
- 다음 24h 윈도우에서 자연 정상화 가능

## 4. 권장 fix

### A — **Verify (no code change)** ⭐ 1순위
**Effort:** 30분
**Action:**
1. 5/12 12:00 KST 이후 (TDZ fix 후) 생성된 plan 별도 측정. `/api/admin-quality-summary` 에 `since` 또는 `from` 파라미터 추가하든가, worstPlans createdAt 으로 직접 분리
2. 후 6h 자연 회복 확인 시 가설 1 확정 — **추가 fix 불필요**

**근거:** B-11 root cause 는 PR #355 로 이미 fix. 24h 윈도우가 buggy plan 을 여전히 포함하고 있어 평균이 깎였을 뿐. 윈도우가 굴러가면 자연 회복.

### B — `unverified_restaurant` 추가 점검 (가설 2 확인 시)
**Effort:** 1시간
**Action:**
1. PR #353 buildPrompt.js 의 "AT LEAST 4 stops" rule 이 verified pool 작을 때 어떻게 behave 하는지 검토 — 식당 부족 도시 (제주/경주/전주, 그리고 가능하면 부산) 에서 stop 채우기 위해 unverified fallback 했나
2. `dbMatcher.js` 에서 verified=false 비율 prod 로그 확인
3. 필요 시: prompt 에 "if verified pool < 4, prefer non-restaurant stops over unverified" rule 추가

### C — Quality endpoint 개선 — 시간대 분리
**Effort:** 2시간
**Action:**
1. `/api/admin-quality-summary` 에 `?createdAfter=ISO` 또는 `?excludePlanIds=` 파라미터 추가 — 단일 PR/fix 의 효과 측정 가능하게
2. 또는 worstPlans 응답에 `createdAt` 기준 sliding window summary 추가

**근거:** 다음 회귀 알람 발동 시 fix 효과 측정 자동화. 현재는 24h fixed window 만 있어 부분 회복을 못 본다.

### D — Hard floor 동적 조정 (보류)
- 현재 80 은 phase 3 평균 ~90 가정. 7d 평균 82.4 라면 현실적 floor 는 75-78.
- 단, 80 미달 = 진짜 회귀가 맞으므로 **임계 자체는 유지**. 알람 시 자동 진단 자체가 valuable (지금처럼).

## 5. 시스템화 후속

### 새 회귀 assertion 후보 (regression suite 추가)
- **B-11 회귀 가드**: `validate-prod-regression.mjs` 에 "100% route_failure plan 생성 시 fail" assertion — TDZ 같은 silent swallow 재발 즉시 catch (자율 검증 24h 안 기다리고 매 PR)
- **`unverified_restaurant > 0.40` 가드**: 24h avg rate hard ceiling

### 새 lint rule 후보 (P-패턴)
- **P-NN (RouteAgent TDZ): try/catch 가 ReferenceError 를 silent swallow 하면 lint fail** — `catch (e) { ... console.log(...) ... }` 에서 ReferenceError 무시 패턴 검출
- **P-NN (변수 선언 위치): const/let 선언이 같은 scope 의 사용처보다 아래에 있으면 lint fail** — ESLint 의 `no-use-before-define` 강화

### 메모리 P-NN 후보 (오답노트)
- **P-11/P-12 후보**: "Gemini 비결정성으로 silent swallow + monitor 부재 시 prod 회귀가 사용자 도달까지 갈 수 있다" — 5/12 사례를 단일 인용 가능한 lesson 으로

### CLAUDE.md F 추가 lesson
- **TDZ silent swallow 패턴**: RouteAgent.js / routeEnrichment.js 류는 try/catch 가 silent fail 하므로, 새 변수 추가 시 반드시 **선언 위치 검증** + **로컬 sanity test** 1회 (실제 dev request 1건). PR #331 처럼 다도시 추가 같은 "조용한" refactor 가 가장 위험.

## 6. 운영자 의사결정 요청

| 옵션 | 내용 | 권장 |
|---|---|---|
| **1. 대기 + 재측정** | 5/13 00:00 KST 자동 재실행 후 회복 여부 확인 | ✅ 1순위 |
| **2. 수동 admin-quality-summary 호출** | now `?createdAfter=2026-05-12T03:00Z` 같은 추가 파라미터로 fix 후 plan 만 측정 | 추가 endpoint 작업 필요 |
| **3. unverified_restaurant 별도 점검** | 가설 2 검증 — _food_index 보강 vs prompt rule 보강 | 가설 1 검증 후 결정 |
| **4. Hard floor 임시 70 으로 완화** | 알람 fatigue 회피 | ❌ 비추 — 알람 의미 약해짐 |

**1순위 결정**: 옵션 1 + 다음 24h 윈도우 (5/13 11:00 KST 자동) 결과 보고 옵션 2/3 진행 여부 결정.

---

생성: 2026-05-12 20:30 KST · 자율 검증 PR #365 첫 발동 진단 · 분석만 (코드 변경 없음)
