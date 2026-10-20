# 통합 2026-10-17 — CORE 작업 기록 (🌐웹)

브랜치 `codex/home-llm-integration-20261017`. 이 문서는 CORE 작성자가 **코드를 쓰기만 하고 실행하지 않은** 상태의 기록이다.
테스트·스크립트·빌드는 아무것도 돌리지 않았다. 아래 "PASS" 표현은 없다 — 통과 여부는 root 의 실행 결과가 진실이다.

## 1. 변경 파일

| 파일 | 종류 | 내용 |
|---|---|---|
| `scripts/integration/resolve-source-20261017.ps1` | 신규 | 두 파일 whole-file 충돌 해소 스크립트 (미실행) |
| `api/_shared/llm/mock.js` | 수정 | `mood` 역할 / `mood-parse` 단계 고정 응답 `MOOD_PARSE_FIXTURE` 추가 (기존 `{}`) |
| `scripts/llm-compare-providers.mjs` | 수정 | 실패 시 0 이 아닌 종료 코드, `--evaluate=<json>` 재판정 모드, 결과 JSON 에 `outcome` 추가 |
| `scripts/integration/llm-compare-outcome.mjs` | 신규 (순수 helper) | 결과 행 판정·집계 (`rowFailures`, `evaluateCompareRun`, `formatOutcome`) |
| `tests/fixtures/integration-20261017/llm-compare-all-pass.json` | 신규 픽스처 | 두 공급자 모두 통과 |
| `tests/fixtures/integration-20261017/llm-compare-provider-error.json` | 신규 픽스처 | claude 행 하나가 호출 에러 |
| `tests/unit/integration-20261017-mood-parse-mock-chain.test.ts` | 신규 테스트 | 실제 adapter → 실제 mock → 실제 mood 핸들러 |
| `tests/unit/integration-20261017-halal-tag-only-not-certified.test.ts` | 신규 테스트 | tag 만 있는 [HALAL] ≠ 인증 (부정) + 신뢰 등급 긍정 경로 유지 |
| `tests/unit/integration-20261017-llm-compare-outcome.test.ts` | 신규 테스트 | 판정 함수 + CLI 종료 코드 (고정 파일만 실행) |
| `docs/INTEGRATION-20261017-CORE.md` | 신규 | 이 문서 |

package.json / lock / `resolve-lock-20261017.ps1` / scripts/offline / UI 6개 파일 / 다른 소스·테스트는 건드리지 않았다.

## 2. 머지 정책 (resolve-source-20261017.ps1)

실행: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\integration\resolve-source-20261017.ps1 -DryRun` → 검토 → `-DryRun` 없이.
스크립트는 ASCII 전용(한글은 `\uXXXX` 로 생성)이라 Windows PowerShell 5.1 과 pwsh 7 이 같은 바이트로 읽는다.
스테이징·git 조작 없음. 실행 뒤에도 index 는 unmerged 상태 — root 가 검토 후 stage.

공통 검사(쓰기 전 전부): 고정 root(스크립트 위치에서 계산한 root 와 일치 + AGENTS.md/CLAUDE.md/.git 존재), root 밖 경로·reparse point 거부,
BOM 없음, UTF-8 엄격 디코딩 + 무손실 왕복, 충돌 마커 각 1개, 형태 `<<<<<<< ours\n` OURS `=======\n` THEIRS `>>>>>>> theirs`,
OURS = 순수 LF, THEIRS = 순수 CRLF(맨 LF·맨 CR 없음).
**입력 SHA 고정(대소문자 무시):** geminiPipeline `2689E9BA…5DD75040`, DayRouteMap `9252589C…15E28E7` (전체 값은 스크립트 `$ApprovedInSha`). 다르면 중단.
**쓰기 전 preflight(두 대상 모두 먼저):** root 안·reparse point 아님, 읽기 전용 아님, 현재 해시 = 검증 해시 = 승인 해시(TOCTOU),
임시 경로(`<대상>.resolve-20261017.tmp`) 없음·상위 디렉터리 존재·root 안. 하나라도 실패하면 아무것도 쓰지 않는다. -DryRun 도 이 검사를 돌리지만 읽기만 한다.
**트랜잭션 아님:** 쓰기 단계(임시 파일 → 해시 확인 → 덮어쓰기 → 재확인)가 중간에 실패하면 "nothing written" 이라고 말하지 않고,
각 대상의 현재 SHA 와 상태(`WRITTEN`/`unchanged`/`MODIFIED`)·남은 임시 파일을 출력한 뒤 중단한다. 첫 파일만 쓰인 상태가 남을 수 있다 — 출력된 상태가 진실.
콘솔에 입력/OURS/THEIRS/출력 SHA-256 영수증을 찍는다.

### `api/_ai_core/geminiPipeline.js` — OURS 기준 + HOME 식이 보강(교정본)

- 기준 = OURS (LF): `createLlmModel`/`resolveLlmModel`/`resolveLlmProvider` import, `buildModel` 의 어댑터 경로,
  사용량 라벨(`resolveLlmProvider('main') === 'gemini'`), `PLAN_RESPONSE_SCHEMA` export 1회 — 전부 유지.
- 스크립트가 양쪽 줄 집합을 비교해, 차이가 참조 diff(`integration-gemini-ours-vs-home.diff`)의 hunk 와 **정확히 같을 때만** 진행한다.
  다른 차이가 하나라도 있으면 중단.
- `buildDietaryReinforcedPrompt` 3줄만 교체 (HOME 의 HALAL/비건 보강을 가져오되 모순 제거):
  - HOME 원문은 `[HALAL] (DB-verified halal; most are halal-friendly, not certified)` 라고 해 놓고 바로 뒤에
    `... unless the restaurant line is marked [HALAL] (DB-certified)` 라고 써서 **같은 표시를 "인증 아님"과 "인증"으로 동시에** 불렀다.
  - `getFoodContext` 의 `[HALAL]` 은 `r.tag` 에서만 만들어진다 (`api/_food_helper.js:351` dietMarker) — muslim_friendly 행과 halal_certified 행이 같은 표시를 받고, 인증 표기는 없다.
  - **HALAL 정책:** `[HALAL]` 표시만으로는 인증이 아니다. "certified"/"100%"/"인증" 은 **그 식당 줄 자체가 할랄 인증을 말할 때만** —
    코드에 이미 있는 유일한 해당 표기는 `getExactCityTrustedFoodContext` 의 등급 라벨 `[HALAL — CERTIFIED]` (`_food_helper.js:504-506`, halal_certified).
    같은 함수의 라벨은 `[${diet} — CERTIFIED]` 형식이라 `[VEGAN — CERTIFIED]`(vegan_restaurant)도 있다 → 식이 무관한 "CERTIFIED" 는 할랄 근거가 아니라고 프롬프트에 명시.
    (이전 교정본의 "explicitly says CERTIFIED (operator-verified)" 는 식이를 구분하지 않아 제거.) 새 표기·새 등급 없음.
  - 현재 연결 사실: `handlerCore.js` → geminiPipeline 경로의 컨텍스트는 `getFoodContext` 뿐이라 이 경로에서는 인증 표기 줄이 나오지 않는다 → AI 인증 주장 근거 0.
    기존 긍정 동작은 그대로: `applyDBMatcher` 가 DB 의 halal_certified 행에 `describeDietaryEvidence('halal_certified')` 문구를 붙이고 AI 인증 문장을 보존한다(테스트로 잠금).
  - **VEGAN:** HOME 의 `[VEGAN]` 줄을 **바이트 그대로** 가져온다(스크립트가 THEIRS 에 원문이 있는지, 출력에 정확히 1회인지 검사). 이전 교정본의 비건 CERTIFIED 정책은 철회.
    한계(이번 범위 밖, 미변경): `[VEGAN]` 도 tag 파생이라 vegan_options 행도 받는다. HOME 줄은 `[VEGAN]` 이면 "vegan restaurant" 를 허용하므로 등급 구분은
    dbMatcher 의 vegan_options 정직 문구에 의존한다.
  - 기존 잠금 테스트 `tests/unit/prompt-no-certification-claims.test.ts` 의 정규식(`Never write "certified", "100%", or "인증" unless the restaurant line is marked \[HALAL\]`,
    `whose line is marked \[HALAL\]`, `NEVER claim "100% vegan"`, pork 금지어 규칙, `mention "halal" or "할랄" in the tip`)을 그대로 만족하도록 문장 앞부분을 유지했다.
- 연결 확인(OURS 현재 호출 기준, 가정 아님): `validateResponse(itinerary, {…dietary…}, foodIndex)` 는 선택된 DB 행만 긍정 증거로 쓰고
  (`dietaryEvidenceFor`), `applyDBMatcher(itinerary, foodIndex, area, language)` 는 day 별 `day.city` 로 매칭하며 trusted 행에서만
  `dietary_tags`/`dietary_evidence`/정직 문구를 채운다. `verified:true` = DB 존재 규칙 유지. 재시도 호출부 수가 바뀌지 않았는지 스크립트가 검사.
- HOME 쪽 `buildPrompt.js`·`responseValidator.js` 는 이미 반영돼 있어 손대지 않았다. `buildPrompt.js:651` 의 "most are halal-friendly, not certified" 는
  "Do not describe any restaurant as certified unless its line says so" 와 함께 있어 새 정책과 충돌하지 않는다 (main 목록 줄은 CERTIFIED 를 말하지 않음).

### `src/pages/PlanDetailPage/components/DayRouteMap.tsx` — THEIRS(HOME) 원본, CRLF 유지

- THEIRS 는 OURS 의 상위집합: 같은 CARTO voyager 기본지도(`@/lib/basemap`) + 429 `rateLimited`, 부분 결과 재시도(`retryMissing`/`partial`/`capped`),
  늦게 온 응답 무시(`isCurrent()` + AbortController + generation), 경로 step 검증(`isRouteStep`/`chunkPath`), 이미 받은 구간 보존(`{ ...fetchedLegs }`), `routeScopeKey`.
- 스크립트 검사: OURS 의 모든 줄이 THEIRS 에 있거나, THEIRS 가 대체한 줄 목록(구 state 훅·구 fetchRoute 본문·구 라벨 줄 등)에 해당해야 함. 아니면 중단.
- 현재 호출부 `DayTimeline.tsx:257`, `MapPage.tsx:569` 가 이미 `routeScopeKey` 를 넘기므로 OURS 를 고르면 타입이 깨진다. `src/lib/routeSegments.ts` 에
  `chunkPath`/`stepsToSegments`/`pointsToSegments` export 존재를 스크립트가 확인.
- 재설계 없음. 바이트는 THEIRS 측 그대로.

## 3. mood mock (작업 2)

- `MOOD_PARSE_FIXTURE`: 3 stop (`pickup`→`arrive`→`dropoff`, 마지막 인천공항 T2), `flights: []`. action 은 핸들러 `ALLOWED_ACTIONS` 안의 값만.
  좌표·`needsConfirm`·`serviceGuess` 는 넣지 않는다 — 핸들러가 계산한다. `mood-smoke.mjs` 의 기대(serviceGuess=airport) 와 맞춘 것.
- 테스트는 `firebase-admin`(db), `runtime-flags`, `apiUsageRecorder`, `user-auth`, `mood-route.geocodeAddress`, `place-search`, `sentry` 만 import 전에 stub.
  adapter(`createLlmModel` + 킬스위치 가드)·mock·핸들러는 실제 코드.
  검증: `needsConfirm===true`, serviceGuess/airportCode/direction, stop 필드, 주소록 매칭 vs 지오코딩 호출 인자, DB 컬렉션 순서
  (`mood_config`, `mood_places` — `llm_guard` 없음 = mock 은 일일 상한 카운트 안 함), `initAdminDb('llm')` → `getRuntimeFlags(db)` 1회,
  fire-and-forget `recordUsageFromResponse('mood-parse', 'mock:mood', usage)` 정산. 부정: 킬스위치 on → `AI_PARSE_FAILED` + 정산 없음,
  헤더 없음 → mock 아님(claude 키 없음 실패), 401/403(미검증)/403(allowlist 밖)은 LLM 가드 이전에 종료.
- **발견(미수정, 소유 범위 밖):** `mood-parse-schedule.js` 는 `resolveLlmApiKey('mood')` 를 mock 컨텍스트 **밖**에서 부른다. env 공급자가 gemini(기본)이고
  `GEMINI_API_KEY` 가 없으면 `x-llm-mock: 1` 요청도 `AI_NOT_CONFIGURED` 로 끝난다(유료 호출은 0). 테스트는 `LLM_PROVIDER=claude`(키 없음)로 이 분기를 피했다.

## 4. HALAL 부정 테스트 (작업 3)

덮는 체인: `dietary-trust`(SSOT) → `_food_helper.getFoodContext` / `getExactCityTrustedFoodContext` (ko/en/ja/zh) → 프롬프트 원문(`buildPrompt.js`, `geminiPipeline.js` 재시도)
→ `validateResponse` → `applyDBMatcher` → JSON 직렬화(저장 모양). 합성 행 4개를 `_food_index.json` 읽기 자리에 주입(기존 테스트 관례).

- tag-only(`source: naver_local` / `verification_status: unverified`) 행: 증거 없음, main 목록·exact-city 목록에서 제외, validator critical,
  dbMatcher 후 `verified:true`(DB 존재) 이지만 `dietary_tags`/`dietary_evidence`/위조 필드 없음, 4개 언어 인증 어휘 0.
- 긍정 유지: muslim_friendly 는 통과 + 정직한 "인증 아님" 문구만 남음, halal_certified 는 인증 문장·등급 보존.

**덮지 않는 구간:** Gemini 실제 호출과 재시도 루프, `dietaryCoverageGate` 종료 코드, `dietaryStopReplacer` 교체, `finalItineraryGate`, `planPersister` 의 실제 Firestore 쓰기,
WizardForm→PlannerPage 페이로드, 프론트 렌더. `geminiPipeline.js` 원문 잠금 케이스는 **resolve 스크립트 적용 전에는 실패한다**(현재 파일은 충돌 마커 상태).

## 5. compare-providers 종료 코드 (작업 4)

- 이전: 공급자 호출 에러를 `row.error` 로 남기고 항상 exit 0.
- 지금: 0 = 모든 행 통과 · 1 = 행 하나라도 실패(에러, 파싱 실패, 필수 키 누락, 일수 불일치, 식이 critical, 언어 불일치 — 근거 필드 부재도 실패)
  또는 scenario×provider 행 누락·행 0개·요청 안 한 공급자 행 · 2 = `--confirm-cost` 없음 · 3 = 사전 추정 초과 · 4 = `--evaluate` 입력 불량.
- 결과 JSON 은 판정 전에 같은 경로에 저장(기존 `at/providers/results` + `outcome`). 실 호출 경로는 `process.exitCode` 로 끝나 출력이 잘리지 않는다.
- `--evaluate=<json>` 은 API 모듈 import 전에 종료 → 호출 0. 테스트는 이 모드를 고정 픽스처로 `node <script> --evaluate=<file>` 실행(`-e` 없음).
- 새 비용 상한은 추가하지 않았다.

## 6. 운영 한계 (활성화·우회 없음, 사실 기록)

- **`--max-usd`(기본 $5) 는 실행 전 추정치 검사**다(입력 chars/4 + 출력 8K 토큰 가정). 실제 누적 지출 상한이 아니며 실 호출 중 초과를 막지 않는다.
- **일일 호출 상한 `LLM_DAILY_CALL_LIMIT`**(`api/_shared/llm/index.js` `checkDailyCallLimit`): DB 없음·Firestore 오류 시 **허용(fail-open)**,
  `get` 후 `set` 의 read-then-write 라 동시 요청 몇 건은 카운트가 누락될 수 있다(트랜잭션 아님). mock 은 카운트 제외.
- **킬스위치** 런타임 플래그 읽기 실패도 fail-open(`isLlmKillSwitchOn` → false). env `LLM_KILL_SWITCH=1` 은 DB 와 무관하게 막는다.
- **`api/_crons/content-draft.js`** 는 `@google/generative-ai` 를 직접 쓴다(`llm-no-direct-sdk-import` 테스트 ALLOW 목록). 공용 adapter 밖이라
  요청 단위 mock·킬스위치·일일 상한이 **적용되지 않는다**. `CONTENT_WORKER_ENABLED='true'` 일 때만 동작 — 운영에서 켜져 있는지는 **확인 못 함(미확인)**.
- **`api/translate-plan.js` 의 `x-llm-mock`** 은 헤더만으로 mock 이 된다(엔드포인트 자체가 무인증 + IP 시간당 20건). MOOD(`mood-parse-schedule`) 는
  인증·이메일검증·allowlist 를 통과한 뒤에만 mock 을 탄다 — **두 경로의 게이트는 같지 않다.** mock 은 유료 호출 0 이라 비용 우회는 아니지만 동일 보장으로 문서화하면 안 된다.
- **Windows Playwright WebKit 26.5:** 첫 루프에서 멈추는 현상이 있고, 순수 네이티브 `<video>` 페이지에서도 재현됐다 → 앱 버그로 **증명되지 않음**.
  실제 Safari / iPhone 은 **미검증 — 운영자 확인 필요.**

## 7. 실행하지 않은 것

- 교정본 resolve 스크립트(-DryRun 포함 — root 의 이전 DryRun 성공은 교정 전 스크립트 기준), 모든 vitest, `npm run build`, `plan:test`, node, git. 결과는 root 의 오프라인 canary 이후 실행으로 확인해야 한다.
- 운영 AI·DB·결제·메일·지도·푸시·배포 호출 없음.
