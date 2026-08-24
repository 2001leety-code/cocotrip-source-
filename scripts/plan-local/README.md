# 로컬 플랜 생성 테스트 하네스 (`scripts/plan-local/`)

플랜 파이프라인(동선·교통·예산·T-money) 변경을 **배포 없이 · Gemini 비용 없이 · 즉시** PC 에서 검증.

## 왜 이게 가능한가

플래너는 Vercel serverless(`api/ai-planner-full.js` → `_ai_core/handlerCore.js`)라 `npm run dev` 로 안 돌고,
매 호출이 Gemini 비용. 하지만 **주력 경로인 block_mode** 는 사전 큐레이트된 `zone_courses`
(Firestore: stop 좌표 + 캐시된 `transit_matrix` 포함)를 쓴다. 한 번 export 하면 **완전 오프라인**.

우리가 고치는 버그(동선·교통·예산·T-money)는 전부 **POST-Gemini 단계**:
- `blockMode.expandBlocksToItinerary` (block stops → itinerary)
- `RouteAgent` / `routeEnrichment` (transit = 캐시 `transit_matrix`)
- `planPersister` 의 budget / T-money 계산

→ 전부 오프라인 테스트 가능. **Gemini 프롬프트 자체를 바꾸는 경우에만** 진짜 호출(`record`)이 필요.

## 워크플로

### 1. record (1회성, 키 필요)

실 Firestore + 실 Gemini 로 fixtures 를 만든다. **비싼/외부 부분만** 1회 실행.

```bash
npm run plan:record -- seoul-busan-5d
```

필요 env (`.env` / `.env.admin.local` / `.env.local` 에서 자동 로드):
`GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.

내장 시나리오: `seoul-busan-5d`, `seoul-3d`. 커스텀은 `fixtures/userinput-<scenario>.json` 을
먼저 작성하면 그 입력으로 record 한다.

생성물 (`fixtures/`):
- `blocks-<scenario>.json` — 해당 도시 published 블록 전체 (transit_matrix 포함)
- `selection-<scenario>.json` — Gemini 가 고른 day 별 `block_id`
- `userinput-<scenario>.json` — 정규화된 userInput (재현용)

### 2. test (영원히 공짜·오프라인)

```bash
npm run plan:test -- seoul-busan-5d
# 또는
node scripts/plan-local/run.mjs seoul-busan-5d
```

fixtures 로드 → `expandBlocksToItinerary` → RouteAgent/routeEnrichment(transit = 캐시 transit_matrix,
**live ODsay/Naver/Google 호출 0**) → backfill + budget self-heal + T-money 계산(**Firestore write 안 함**)
→ `outputs/plan-<scenario>.json` 저장 + **콘솔 요약**:

- day 별 stop 순서(이름 + 좌표 = 동선)
- 구간 transit (분 / 요금 / mode / 캐시 출처)
- intercity (KTX 등)
- 일별 budget + T-money 권장 충전액
- 추천 식당 버킷 수 + quality_warnings

### 3. sample (record 없이 즉시 동작)

`fixtures/sample-*.json` (서울+부산 5일, 실 zone_courses 블록 5개)가 레포에 포함 →

```bash
npm run plan:test -- sample
```

가 **바로** 동작. operator 가 `record` 로 실데이터 fixtures 를 만들면 그게 sample 을 대체(다른 scenario 명).

## 동작 원리 (오프라인 보장)

`run.mjs` 가 prod 모듈 import **전에** `installMocks()` 로 세 boundary 를 치환한다
(`module.register`, Node 20.6+, prod 코드 0 수정):

| 치환 대상 | 효과 |
|---|---|
| `api/_ai_core/firestoreAdmin.js` (+`_shared/firebase-admin.js`) | `initAdminDb()` = mock — fixtures 블록을 `zone_courses` doc 으로 서빙 (transitCache 의 transit_matrix 조회). Firestore write 는 no-op |
| `api/_transit_provider.js` | `searchTransit()` = 항상 null — live ODsay/TMAP 호출 0 (캐시 hit 은 transitCache 가 먼저 처리) |
| `axios` (bare specifier) | Naver geocoding URL → fixture 좌표표에서 응답(오프라인 geocoding 시뮬), 그 외 외부 HTTP → reject → RouteAgent graceful fallback |

추가로 `run.mjs` 가 NAVER 자격증명을 dummy 비-빈 값으로 세팅 → RouteAgent 의 geocoding 분기에
진입(실제 호출은 axios mock 이 처리) → stop 좌표가 채워져 **transitCache lookup 이 활성**(좌표 필요 조건).

## 한계 (무엇을 테스트하나 / 못하나)

✅ **테스트됨 (우리 버그의 ~99%)** — POST-Gemini 파이프라인 전부:
expand 의 동선/cutoff/식당 placeholder 매칭, RouteAgent 의 transit 캐시·intercity·time-stitch,
backfill·lodging bookend, budget·T-money 계산, 추천 식당.

❌ **테스트 안 됨** — Gemini 가 실제로 무엇을 선택/생성하는지:
- block 선택 로직(`selectBlocksWithGemini` 프롬프트) — `selection` fixture 에 고정됨
- legacy(non-block) Gemini 1-pass/3-pass 경로 — block_mode 전용 하네스
- 프롬프트 변경의 출력 영향 — 이건 `record` 재실행(진짜 Gemini 호출)으로만 검증

즉 **Gemini 프롬프트를 바꿨으면 `record` 를 다시 돌려야** 새 선택이 반영된다.
그 외 모든 수정(동선·교통·예산·T-money·식당·backfill)은 `test` 만으로 충분.

## 파일

```
scripts/plan-local/
  record.mjs            # 1회성: 실 Firestore+Gemini → fixtures
  run.mjs               # 오프라인 러너 (plan:test)
  _pipeline.mjs         # POST-Gemini 파이프라인 실행 + 콘솔 요약
  _mocks.mjs            # module.register 설치 + mock adminDb
  _loader.mjs           # Node 20+ ESM import 경계 리다이렉트
  _firestore-admin-mock.mjs
  _transit-provider-mock.mjs
  _axios-mock.mjs       # 하네스 axios (geocoding 좌표표 응답)
  fixtures/
    sample-blocks.json      # 서울+부산 5일 실 zone_courses 블록 5개
    sample-selection.json   # day 별 block_id 선택
    sample-userinput.json   # 정규화 입력
    blocks-<scenario>.json     (record 생성)
    selection-<scenario>.json  (record 생성)
    userinput-<scenario>.json  (record 생성)
  outputs/
    plan-<scenario>.json    # 생성된 플랜 (gitignore 권장)
```
