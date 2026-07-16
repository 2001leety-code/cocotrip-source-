---
description: 식이제한(할랄/비건/알레르기) SAFETY-CRITICAL 데이터 전달·신뢰등급 규칙. dietary/halal/vegan/allergy 관련 코드 변경 시.
paths:
  - "src/components/WizardForm/**"
  - "src/pages/PlannerPage/**"
  - "api/ai-planner*.js"
  - "api/_ai_core/**"
  - "api/_food_helper.js"
  - "api/_shared/dietary-trust.js"
---

# SAFETY-CRITICAL — 식이 선호 데이터 (할랄 / 비건 / 알레르기)

식이제한·알레르기 데이터는 **잘못 처리되면 고객 건강 위험** 등급. 다른 어떤 필드보다 우선.

> 옛 `CLAUDE.md` J절이 이 파일로 이관됨 — 코드 주석의 "(CLAUDE.md J)"는 이 규칙을 가리킨다.

## 신뢰 등급이 SSOT — `api/_shared/dietary-trust.js`

**태그만으로 "인증"을 판정하는 것은 금지.** 실제 감사에서 dietary 태그 상당수가 키워드검색·AI 큐레이션 산출물이라 인증 근거가 0이었다(생선회집 vegan, 치킨집 halal 등 실증). 그래서 등급으로 분리한다 — `verification_status`:

| 등급 | 의미 |
|---|---|
| `halal_certified` / `vegan_restaurant` | 운영자가 source_url 검증 후 **수동 부여**(최우선) |
| `muslim_friendly` / `vegan_options` | Google Places 기반(실존·평점) 자동 — **인증 아님, "친화" 등급** |
| `unverified` | naver_local / ai_curated — 매칭·프롬프트·검증 증거에서 **제외** |

- `TRUSTED_DIETARY_STATUS` = unverified 제외 전부. `isDietaryTrusted(row)`로 판정.
- **fail-safe 원칙:** `verification_status` 필드 부재가 신뢰 승격이 되면 안 된다 — 없으면 source로 폴백 파생하고, 격리 소스면 `false`.
- ⚠️ 이 모듈은 **"증거 강화"용 — 검증 완화 용도로 절대 사용 금지.**

**`verified: true`와 혼동 금지:** `verified:true`는 "식당이 DB에 존재"라는 뜻일 뿐, 식이 안전과 무관하다. 식이 안전은 위 `verification_status` 등급이 판정한다.

## 전달 체인 — 매 변경마다 전체 검증

```
src/components/WizardForm/WizardStep1Food.tsx   UI 입력
  → src/components/WizardForm/index.tsx          state
  → src/pages/PlannerPage/                       요청 페이로드 (hooks/usePlannerHandlers.ts)
  → /api/ai-planner-full → api/_ai_core/handlerCore.js → requestShaper.js   백엔드 진입·정규화
  → api/_ai_core/dietaryCoverageGate.js          사전 게이트: trusted 후보 0이면 Gemini 호출 전 종료
  → api/_food_helper.js                          식당 컨텍스트 주입
  → api/_ai_core/buildPrompt.js                  Gemini system instruction
  → api/_ai_core/responseValidator.js            validateResponse — 위반 검출
  → api/_ai_core/dietaryStopReplacer.js          위반 stop 을 trusted DB 식당으로 결정론적 교체
  → api/_ai_core/planPersister.js                Firestore 저장
```

- `dietaryCoverageGate`: 요청 도시×dietary 에 trusted 후보가 없으면 **명확한 코드로 종료**한다. **이름 지어내기·일반식당으로 완화 금지.**
- `_food_helper.js`의 allowlist는 spice/bucket/pace 키에 대한 **prompt-injection 가드**다 — 식이 안전 검증 장치가 아니다(혼동 금지).

## 절대 규칙

- **"누락"과 "명시적 없음"을 구분한다.** 알레르기 미입력 ≠ 알레르기 없음.
  - 이 전달 체인(요청 경계·안전 검증 지점)에서 `dietary || []` 같은 빈배열/nullish 폴백으로 **누락을 조용히 "제한 없음"으로 강등하지 말 것.** 누락은 감지되어 명시적으로 처리(에러 또는 명시적 "none" 신호)돼야 한다.
  - ⚠️ 이 금지는 **전달 체인·안전 경계에 한정**이다. 식이와 무관한 렌더링에서 빈 배열이 정상 기본값인 경우까지 무조건 금지하는 것은 아니다. 기준 = "이 폴백이 안전 정보를 숨기는가".
- **silent drop 금지** — 검증 실패 시 명시적 throw.
- **완화 금지** — 커버리지 부족을 "그냥 일반식당 추천"으로 메우지 않는다. 없으면 없다고 종료.
- 변경 시 grep으로 일관성 확인: `grep -rn "halal\|vegan\|allerg\|dietary" src api`

## 변경 PR 체크리스트

- [ ] WizardStep1Food → WizardForm state 전달 라인
- [ ] PlannerPage → API 페이로드 포함
- [ ] 새 dietary 값/소스의 `verification_status` 파생이 `dietary-trust.js`에 반영 (기본은 unverified 쪽으로 안전하게)
- [ ] `dietaryCoverageGate` 통과/종료 동작 확인
- [ ] Gemini prompt instruction 반영
- [ ] `validateResponse`가 응답의 식이 위반 검출
- [ ] i18n 4-lang(ko/en/ja/zh) 동시 업데이트

검증만 요청받은 경우 식이 코드를 자동 수정하지 않는다 — ❌ + 원인만 보고하고 멈춘다.
