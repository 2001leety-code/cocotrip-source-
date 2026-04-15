# CocoTrip AI 플래너 개선 — NOTES

## Phase 0 — 코드베이스 실사 ✅

### 구조 요약
```
Gemini 호출       : api/ai-planner-full.js:793 (model.generateContent)
프롬프트 빌드      : api/ai-planner-full.js:199 (buildSystemPrompt)
언어 규칙 분기     : api/ai-planner-full.js:170-197 (LANG_INSTRUCTION)
컨텍스트 주입      : api/ai-planner-full.js:739-755 (spots + food DB)
userMessage 조립  : api/ai-planner-full.js:757-777
JSON 파싱         : api/ai-planner-full.js:813-876
JSON 수리(truncate): api/ai-planner-full.js:830-874
응답 검증          : api/ai-planner-full.js:129-167 (validateResponse)
RouteAgent transit: api/_ai_core/agents/RouteAgent.js:32-197
  - Phase 1: Naver Geocoding → 좌표 확보 (:38-67)
  - Phase 2: ODsay + Naver 경로 병렬 호출 (:72-91)
  - Phase 3: Dynamic Time Stitching (:96-181)
Route merge       : api/ai-planner-full.js:894-944
PDF 렌더          : src/pages/PlanDetailPage.tsx:103-288
Stop UI (card)    : src/pages/PlanDetailPage.tsx:616-771
이메일 렌더        : api/_email-renderer.js:60-80
타입 정의          : src/types/plan.ts (Stop, Day, Plan 인터페이스)
```

### 필드 참조 위치 (Phase 3 일괄 교체 대상)

| 필드 | 파일 | 줄 | 컨텍스트 |
|------|------|-----|---------|
| `name_ko` | PlanDetailPage.tsx | 186,187,645,657,747,755 | PDF + UI + 네이버맵 |
| `name_en` | PlanDetailPage.tsx | 186,187,645,657,747,759 | PDF + UI + 네이버맵 fallback |
| `tip_en` | PlanDetailPage.tsx | 193,664 | PDF + UI 팁 표시 |
| `name_ko` | RouteAgent.js | 40,65,207 | Geocoding + 네이버맵 URL |
| `name_en` | RouteAgent.js | 40,65,207 | fallback 이름 |
| `name_ko` | _email-renderer.js | 66,330 | 이메일 본문 |
| `name_en` | _email-renderer.js | 67,330 | 이메일 본문 |
| `tip_en` | _email-renderer.js | 68,331 | 이메일 팁 |
| `name_ko` | ai-planner-full.js | 136,140,144,152,156 | validateResponse |
| `name_en` | ai-planner-full.js | 136,140,146,152,156 | validateResponse |
| `tip_en` | ai-planner-full.js | 151,360,439,482,488,496 | validateResponse + 프롬프트 |
| `name_ko` | _food_helper.js | 227 | "EXACT name_ko" 프롬프트 |

**총 교체 필요 위치: 약 37곳 (5개 파일)**

### 발견한 불일치
1. **plan.ts 타입은 이미 `name`, `display_name`, `tip` (Phase 3 신규 스키마)**
2. **실제 코드/프롬프트는 아직 `name_ko`, `name_en`, `tip_en` 사용 중**
3. **Gemini 프롬프트 스키마(L262-343)는 `name`, `display_name`, `tip`을 사용** — 이미 새 스키마
4. **하지만 프롬프트 규칙(L360,396,439,482,488,496)은 `tip_en`, `name_ko` 참조** — 구 스키마 잔존

---

## Phase 1 — 계측 ✅

### 변경 파일
1. `api/ai-planner-full.js` — logPromptMetrics(L112-127) + validateResponse(L129-167) 이미 삽입
2. `scripts/validate-planner.js` — 5개 시나리오 검증 러너

### 기준점 측정 결과 (2026-04-16 02:17 KST)

```
API: https://cocotripkr.com/api/ai-planner-full
성공: 5/5
총 이슈: 32건
평균 응답: 61.0초
```

#### 이슈 분류 (기준점)

| 이슈 유형 | 개수 | 비율 | 설명 |
|-----------|------|------|------|
| **unverified_restaurant** | 21 | 65.6% | 식당이 food_index.json DB에 없음 |
| **language_mismatch** | 10 | 31.3% | ko 요청인데 tip이 영어로 생성됨 |
| **address_missing_number** | 1 | 3.1% | 주소에 건물번호 없음 |
| **bad_address_prefix** | 0 | 0.0% | ✅ 모든 주소가 시/도로 시작 |
| **unrealistic_stay** | 0 | 0.0% | ✅ stay_min 범위 정상 |

#### 시나리오별 결과

| 시나리오 | Stops | Food | Issues | 응답시간 | 핵심 문제 |
|---------|-------|------|--------|---------|----------|
| seoul-meat (ko) | 10 | 4 | 4 | 52.3s | unverified 4 |
| busan-halal (ko) | 16 | 6 | 7 | 67.3s | unverified 6, addr 1 |
| jeju-vegan (en) | 12 | 4 | 4 | 79.9s | unverified 4 |
| seoul-meat-rep1 (ko) | 11 | 3 | 13 | 47.1s | **lang_mismatch 10**, unverified 3 |
| seoul-meat-rep2 (ko) | 14 | 4 | 4 | 58.5s | unverified 4 |

#### 다양성 점수
- **중복률: 21%** (3/14 stops — 봉은사, 리움미술관, 페트라)
- 목표: < 30% ⇒ ✅ 달성

#### 핵심 발견

1. **unverified_restaurant(21건)이 최대 이슈** — Gemini가 DB 식당을 무시하고 자체 생성
   - 서울: 명동교자, 바토스, 마포정대포 → DB에 없음
   - 부산: 할랄 식당 대부분 DB에 없음 (DB 자체에 부산 할랄 부족)
   - 제주: 비건 식당 DB 없음 (DB 자체에 제주 비건 부족)
   
2. **language_mismatch(10건)** — ko 요청인데 tip이 영어로 생성 (rep1에서 집중 발생)
   - 프롬프트에 `tip_en` 필드명 자체가 영어 편향 유발 가능
   - 동일 조건인데 rep1에서만 10건 발생 → **LLM 비결정성 문제**

3. **Gemini가 "verified": true를 반환하지 않음** — 프롬프트 규칙은 있지만 실제 준수율 0%
   - DB 식당을 선택했을 수 있으나 verified 플래그를 설정하지 않음

4. **주소 품질은 양호** — bad_address_prefix 0건, address_missing_number 1건만

---

## Phase 2 — 저위험 즉시 개선 ✅

### 변경 파일
1. `api/ai-planner-full.js` — 프롬프트 슬림화 + 백엔드 DB matcher 추가
2. `api/_food_helper.js` — 프롬프트 주입 텍스트 name_ko → name 교체

### 변경 내역
- **2-1**: TRANSIT NOTE 섹션 제거, transit 중복 지시 제거 (프롬프트 -16.5%)
- **2-2**: address optional 명시, address_en 제거, tip_en → tip 통일
- **2-3**: RESTAURANT SELECTION 규칙 강화 + 예시 추가
- **2-추가**: 백엔드 DB matcher — food stop을 _food_index.json과 매칭 (exact+fuzzy)

### 재측정 결과 (2026-04-16 02:33 KST)

| 이슈 유형 | 기준점 | Phase 2 | 변화 |
|-----------|--------|---------|------|
| unverified_restaurant | 21 | 9 | **-57.1%** ✅ |
| language_mismatch | 10 | 0 | **-100%** 🎉 |
| address_missing_number | 1 | 1 | 0% |
| **총 이슈** | **32** | **10** | **-68.8%** ✅ |

### 시나리오별 비교
| 시나리오 | Before | After |
|---------|--------|-------|
| seoul-meat | 4 | **0** 🎉 |
| busan-halal | 7 | 5 |
| jeju-vegan | 4 | **0** 🎉 |
| seoul-meat-rep1 | **13** | **1** 🎉 |
| seoul-meat-rep2 | 4 | 4 |

다양성: 25% (목표 <30% ✅), 평균 응답: 57.6초 (-5.6%)

---

## Phase 3 대기
- language_mismatch: 이미 0건 (Phase 2에서 해결)
- 남은 작업: name_ko/name_en → name/display_name 프론트엔드 일괄 교체 (37곳)
