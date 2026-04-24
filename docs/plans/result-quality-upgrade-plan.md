---
plan: AI 플래너 결과 퀄리티 업그레이드 (system prompt + reasoning + 광고 축소)
created: 2026-04-24
trigger: Phase 4에서 추가한 신규 입력(spice/bucket/pace/예약상태/P9칩) 5개가 system prompt 미언급 → Gemini가 무시. 결과 JSON에 personalization 부재. 광고 슬라이드 5개로 본문 흐름 단절.
related-mistake-cat: 14 (큰 변경 — 사용자 승인 받음 "이거진행하자"), 19 (계획서 파일로 작성)
phase-5-spec: docs/plans/phase5-conversational-planner.md (별도 작성, 1주 작업)
---

# AI Planner 결과 퀄리티 업그레이드 계획

## 1. 목표
Phase 4에서 폼은 풍부해졌지만 결과는 옛날 그대로인 갭 메우기. 즉시 가능한 3개 작업 (반나절 내):
1. **system prompt 패치** — 새 필드 5개 사용 지시 추가 + temperature/thinking 튜닝
2. **`personalization_reasoning` 필드** — Gemini가 stop별 "왜 골랐는지" 1줄 적게
3. **광고 슬라이드 5개 → 2개** + Outro에 "여행 준비" 카드 그리드로 통합 (옵션 D)

Phase 5 (자연어 챗) 별도 spec 파일에 문서화 후 별 세션.

## 2. 영향 범위

### 백엔드 (Gemini 인풋/아웃풋 연결)
| 파일 | 현재 | 변경 | 판정 |
|---|---|---|---|
| [api/_ai_core/buildPrompt.js](api/_ai_core/buildPrompt.js) | 357줄 | +60줄 (5개 신규 필드 instruction 섹션) | 🟢 |
| [api/ai-planner-full.js](api/ai-planner-full.js) | 500줄 (Lock!) | **+0** (config 1줄만 수정 in-place) | ⚠️ Lock 한도, 추가 줄 금지 |
| [api/_food_helper.js](api/_food_helper.js) | 250줄 | +0 (이미 buildFoodPrefSnippet 통과) | 🟢 |

### 프론트엔드 (결과 렌더링)
| 파일 | 현재 | 변경 |
|---|---|---|
| [src/pages/PlanDetailPage/types.ts](src/pages/PlanDetailPage/types.ts) | 139 | +1 (`personalization_reasoning?: string` 필드) |
| [src/pages/PlanDetailPage/components/StopCard.tsx](src/pages/PlanDetailPage/components/StopCard.tsx) | 231 | +6 (tip 옆에 "Why" 박스) |
| [src/pages/PlanDetailPage/lib/buildSlides.ts](src/pages/PlanDetailPage/lib/buildSlides.ts) | 83 | -25/+15 (광고 5→2 압축) |
| [src/pages/PlanDetailPage/components/OutroSlide.tsx](src/pages/PlanDetailPage/components/OutroSlide.tsx) | 77 | +30 (Extras 카드 그리드) |
| 광고 컴포넌트 5개 | 35-130 | i18n + 작은 카드 모드 prop 추가 |
| [api/_ai_core/responseValidator.js](api/_ai_core/responseValidator.js) | 보존 | reasoning 누락 시 fallback OK (선택 필드) |

### i18n (이전 ads-i18n-plan.md와 통합)
| 그룹 | 신규 키 |
|---|---|
| Ad i18n (이전 plan) | 16개 키 × 4 lang = 64 strings |
| Personalization | `pdfWhyChose`, `whyChoseLabel` (~3 keys × 4 = 12) |
| Outro Extras | `outroExtrasTitle`, `outroExtrasSub` (~2 × 4 = 8) |
| **합계** | ~84 strings |

## 3. 파일 크기 사전 체크 (cat 12)
- `ai-planner-full.js` 500줄 (Lock 한도) — config 수정만 (in-place edit, 줄 추가 금지)
- 나머지 모두 ≤300줄 — Lock 미저촉

## 4. 아키텍처 다이어그램

### 데이터 흐름
```
WizardForm 입력 (15+ 필드)
    │
    ├─ spiceLevel + bucketDishes + tourPace
    │       ↓ buildFoodPrefSnippet() (이미 작동)
    │       ↓ userMessage.spice_tolerance / bucket_list_dishes / tour_pace / daily_tour_hours
    │       ↓
    ├─ system prompt (NEW SECTIONS)
    │       § Spice tolerance: hot=불닭/극매운, mild=김치미만, none=완전 안매운
    │       § Bucket list: 사용자 선택 메뉴를 plan에 1회 이상 자연스럽게 배치
    │       § Tour pace: half=1-2 stops/day, full=5-6, action=7+
    │       § Reservation status: 항공만이면 hotel 추천 우선, all_done이면 (이 케이스 안 옴 — UI 분기)
    │       § P9 city chips: Jagalchi=자갈치 시장, Gamcheon=감천문화마을 ...
    │       § Output: stop마다 personalization_reasoning (1줄, why this for this user)
    │       ↓
    ├─ Gemini 2.5 Flash (NEW: thinkingBudget 8000, temperature 0.7)
    │       ↓
    └─ JSON itinerary (NEW: stops[i].personalization_reasoning)
            ↓
    Frontend StopCard (NEW: "Why" 박스 below tip)
```

### 광고 D안 구조
```
BEFORE:
  Intro → eSIM → Flight → Day 1 → Hotel → Day 2 → Charter → Day 3 → CarRental → Day 4 → AirportPickup → Outro
  (12 슬라이드 중 5개 광고 = 41%)

AFTER:
  Intro → eSIM → Day 1 → Day 2 → Day 3 → Day 4 → AirportPickup → Outro+Extras
  (8 슬라이드 중 2개 광고 = 25%)
  Outro 안: [Hotel | Flight | Charter | CarRental] 카드 그리드 (필요한 것만 노출, 컨텍스트 룰 그대로 적용)
```

## 5. 리스크 & 예외 처리

### 리스크 1: temperature 0.95 → 0.7 → 다양성 감소
**완화**: validate-planner.cjs의 다양성 중복률 < 30% 기준치 통과 확인. 예전 18% 였으므로 0.7에서도 25% 이내로 유지될 것.

### 리스크 2: thinkingBudget 8000 → 응답 시간 +5초
**완화**: maxDuration 60s 한도 충분. 사용자에 로딩 인디케이터 이미 있음.

### 리스크 3: personalization_reasoning 누락 시 UI 깨짐
**완화**: optional 필드 (`?: string`) + 폴백 패턴 `{stop.personalization_reasoning && (<div>...)}`.

### 리스크 4: P9 신규 칩 (Jagalchi 등) 영문 키만 prompt에 들어가면 Gemini가 의미 못 잡음
**완화**: prompt에 매핑 추가 — `Jagalchi=자갈치 시장 회 노점`, `Gamcheon=감천문화마을 컬러풀 사진 명소` 등.

### 리스크 5: 광고 D안에서 Outro 안 보면 광고 노출 0 → 수익 손실
**완화**: GA4 트래킹 — Outro slide 도달률 vs 광고 카드 클릭률 모니터링. 30일 후 재평가. 그래도 우려되면 Day 슬라이드 하단 인라인 추가 (옵션 B 보강).

### 리스크 6: validate-planner.cjs 기준치 (≤9 이슈) 깨짐
**완화**: PR 머지 전 1회 실행. 깨지면 prompt 롤백 또는 점진 적용.

## 6. 실행 순서 (3 단계)

### Step A: 백엔드 prompt + 모델 config (~30분)
1. `buildPrompt.js` — 5개 섹션 추가 (Spice 4단계 / Bucket / Tour pace / 예약상태 힌트 / P9 칩 매핑) + Output 섹션에 `personalization_reasoning` 필수 명시
2. `ai-planner-full.js` — generationConfig: temperature 0.7, thinkingConfig.thinkingBudget 8000 (Lock 한도 고려해 in-place)
3. tsc 통과 확인

### Step B: 프론트 reasoning 렌더 + 광고 D안 (~1.5시간)
4. `types.ts` — Stop interface에 `personalization_reasoning?: string`
5. `StopCard.tsx` — tip 박스 위에 "💡 Why" 박스 (어두운 보라색 배경, 사용자 입력 강조)
6. `buildSlides.ts` — 광고 5→2 (eSIM intro 직후, airportPickup outro 직전만 슬라이드)
7. `OutroSlide.tsx` — 새 섹션 "여행 준비 추천" 카드 그리드 (Hotel/Flight/Charter/CarRental — 컨텍스트 적용된 것만 표시)
8. 광고 컴포넌트 5개 — i18n 적용 + `compact?: boolean` prop 추가 (Outro 안에서 작은 모드)

### Step C: i18n + 검증 + 배포 (~1시간)
9. en/ko/ja/zh.json — ~20개 신규 키 (광고 16 + reasoning 3 + outro extras 2 — 일부는 ads-i18n-plan.md와 합산)
10. tsc + vite build
11. **`node scripts/validate-planner.cjs`** — 기준치 통과 (이슈 ≤9)
12. branch `feat/result-quality-upgrade` + PR + 머지 + Vercel 배포

## 7. 승인 체크박스 (cat 14)
- [x] 사용자 승인 ("이거진행하자" 2026-04-24)
- [ ] Lock 파일 한도 통과 (ai-planner-full.js 500줄 유지)
- [ ] i18n 4개 언어 동시 추가 (cat 13)
- [ ] PR 단위 머지 (cat 16)
- [ ] validate-planner.cjs 기준치 통과
- [ ] 머지 후 local main reset --hard origin/main (cat 17)

## 8. 예상 작업량
- Step A: 30분
- Step B: 1.5시간
- Step C: 1시간 (validate-planner는 ~5분 자동)
- **합계: 3시간** (1세션 내 완수 가능)

## 9. Phase 5 (별도 spec)
자연어 입력 + 챗 정제 패턴 (Mindtrip 스타일) — `docs/plans/phase5-conversational-planner.md`로 분리 작성.
