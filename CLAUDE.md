# CocoTrip AI Planner — Project Rules

> 기능 변경 시 docs/FEATURE-CHANGE-STANDARD.md (완료의 정의 8단계) 를 따른다.

## A. 프로젝트 개요

CocoTripKR — 한국 프라이빗 투어 예약 + 유료 AI 플래너 ($9.90)

**데이터 흐름:**
```
WizardForm → PayPal 결제 → ai-planner-full.js:
  1. Gemini 2.5 Flash 호출 (L800-803)
  2. JSON 파싱 + 수리 (L824-883)
  3. 주소 정리: "대한민국 "/"KR " 제거 (L886-893)
  4. 응답 검증 validateResponse() (L896-898)
  5. 백엔드 DB matcher (L900-956)
  6. RouteAgent: Naver Geocoding + ODsay Transit (L968-1018)
  7. T-money 계산 (L1021-1040)
  8. Firestore 저장 (L1057-1082)
  → PlanDetailPage.tsx 렌더링 + PDF 다운로드
```

**프로덕션:** https://cocotripkr.com (Vercel)
**테스트 계정:** 2001leety@gmail.com (TEST- prefix PayPal 바이패스)

---

## B. 🔴 절대 금지 규칙 (이거 어기면 프로덕션 장애)

1. **`api/_food_index.json` 삭제 또는 .gitignore 추가 금지**
   → DB matcher 전체 사망 (silent fail — 에러 안 나고 그냥 안 됨)

2. **stop 필드를 `name_ko`/`name_en`/`tip_en`으로 되돌리지 말 것**
   → Gemini는 `name`/`display_name`/`tip` 반환
   → 불일치하면 사용자에게 빈칸 표시

3. **PDF 컨테이너를 `left:-9999px` 또는 `display:none`으로 숨기지 말 것**
   → html2canvas는 화면 밖 요소 렌더링 불가 → PDF 백지
   → 현재 정답: `position:absolute; left:0` + overlay(z-index:99998)로 가림
   → `document.fonts.ready` 대기 필수 (한글 폰트 로딩)

4. **Gemini 프롬프트에서 `"verified": true` 규칙 제거 금지**
   → 백엔드 DB matcher가 보정하지만 프롬프트도 함께 작동해야 효과적

---

## C. 필드명 스키마 규칙

| 구 스키마 (사용 금지) | 신 스키마 (현재) | 용도 |
|---|---|---|
| `name_ko` | `name` | 항상 한국어. 네이버맵 검색용 |
| `name_en` | `display_name` | 사용자 언어. UI 표시용 |
| `tip_en` | `tip` | 사용자 언어. 팁 텍스트 |

**코드에서 참조 시 반드시 폴백 패턴 사용** (Firestore 기존 플랜 호환):
```javascript
// 표시용
stop.display_name || stop.name_en || stop.name || stop.name_ko

// 한국어명 (네이버맵 검색용)
stop.name || stop.name_ko

// 팁
stop.tip || stop.tip_en
```

---

## D. 핵심 파일 맵

### AI 플래너 백엔드 (PR #144 이후 모듈 분해됨)
`api/ai-planner-full.js` (307L)는 request shaping + 응답 작성 + post-response side-effect만 남기고 핵심 로직은 `api/_ai_core/` 18개 모듈로 추출됨. **줄 번호 참조 대신 모듈명으로 탐색.**

| 모듈 | 주요 기능 |
|---|---|
| `api/ai-planner-full.js` (307L) | 핸들러 진입점, `maxDuration = 800` (Vercel Pro Fluid Compute, P270 2026-05-29), PLANNER_MODE 분기 |
| `api/_ai_core/buildPrompt.js` | Gemini system prompt 조립, logPromptMetrics |
| `api/_ai_core/responseValidator.js` | validateResponse — 식이제한·언어·필드 검증 |
| `api/_ai_core/dbMatcher.js` | Gemini 응답 → `_food_index.json` 매칭 |
| `api/_ai_core/sanitizeName.js` | "대한민국 "/"KR " 주소 prefix 제거 |
| `api/_ai_core/geminiPipeline.js` | Gemini 호출 + 파싱 + 수리 (legacy 1-pass) |
| `api/_ai_core/threePassPipeline.js` | 3-pass 아키텍처 (PLANNER_MODE='3pass' 시) |
| `api/_ai_core/routeEnrichment.js` | RouteAgent 호출 (Naver Geocoding + ODsay Transit) |
| `api/_ai_core/planPersister.js` | T-money 계산 + Firestore 저장 |
| `api/_ai_core/paymentGate.js` | PayPal 검증 + revision 횟수 체크 |
| `api/_ai_core/vehicleAndPrice.js` | selectVehicle, calcPrice, VEHICLE_LABELS |
| `api/_ai_core/recommendedRestaurants.js` | pickRecommendedRestaurants |
| `api/_ai_core/avoidListQuery.js` | buildAvoidClause — 사용자 회피 목록 |
| `api/_ai_core/emailNotifier.js` | sendNotificationEmail, recordLeadToSheets |
| `api/_ai_core/firestoreAdmin.js` | initAdminDb (singleton) |
| `api/_food_index.json` (1.2MB) | ⚠️ 삭제 금지. `build-food-index.js`로 재생성 |
| `api/_food_helper.js` | 식당 DB → 프롬프트 주입. getFoodIndex (lazy), getFoodContext |
| `api/_email-renderer.js` | 확인 이메일 HTML + 텍스트. name/display_name/tip 폴백 |
| `api/_ai_core/agents/RouteAgent.js` | Naver Geocoding + ODsay Transit + Time Stitching |

### 프론트엔드 (PlanDetailPage 폴더 분해됨)
`src/pages/PlanDetailPage.tsx`는 폴더 (`PlanDetailPage/`)로 분해되어 `index.tsx` (325L) + components/ + lib/ + pdfGenerator.ts (933L) 구성. 총 5400L+

| 파일 | 주요 기능 |
|---|---|
| `src/pages/PlanDetailPage/index.tsx` (325L) | UI 진입점, 상태 관리, 라우팅 |
| `src/pages/PlanDetailPage/pdfGenerator.ts` (933L) | PDF 렌더 (position:absolute left:0, font.ready 대기, html2pdf 동적 import) |
| `src/pages/PlanDetailPage/components/` | StopCard / DayTimeline / Lightbox / 광고 슬라이드 등 |
| `src/pages/PlanDetailPage/lib/buildSlides.ts` | 광고 삽입 순서 (eSIM after Intro, airportPickup before Outro) |
| `src/types/plan.ts` (106L) | Stop/Day/Plan 타입 정의 (name, display_name, tip) |

### 스크립트
| 파일 | 주요 기능 |
|---|---|
| `scripts/validate-planner.cjs` (261L) | 품질 검증 러너 (5 시나리오, Gemini 5회 호출) |
| `scripts/build-food-index.js` (117L) | `food_data/*.json` → `api/_food_index.json` (rating≥4.5, reviews≥50) |

### 코드베이스 검색 (qmd)
- 컬렉션 이름: `cocotrip` (이미 등록됨, 440 파일 인덱싱 완료)
- BM25 키워드 검색: `qmd search "PayPal orderId"` (즉시, 모델 불필요)
- 벡터/하이브리드는 임베딩 필요: `qmd embed --chunk-strategy auto` (모델 다운로드 후) → `qmd vsearch` / `qmd query`
- 인덱스 갱신: `qmd update`
- MCP 서버 (Claude 에이전트용): `claude mcp add qmd -- qmd mcp` (사용자 본인이 1회 등록)

### Vercel 플랜 정보
- **Pro 사용 중** — `maxDuration` 최대 800초 (Fluid Compute) 까지 가능
- ai-planner-full.js: `maxDuration = 800` 사용 중 (P270 2026-05-29 — vercel.json + export 동기화, legacy 1-pass 다도시 296s timeout 해소)
- 일반 endpoint: `maxDuration = 15`로 통일 권장 (cold start 비용 + 무한 루프 방지)
- 운영자 액션: Vercel Dashboard → Settings → Functions → **Fluid Compute** 토글 ON 확인 (800s 한도 활용)

---

## E. 변경 시 검증 방법

```bash
# 플래너 품질 테스트 (Gemini 5회 호출, ~5분)
node scripts/validate-planner.cjs
# 기준치: 총 이슈 9건 이하, bad_address_prefix 0, language_mismatch ≤1

# TypeScript 빌드
npx tsc --noEmit

# 전체 빌드 (Vercel 배포 전)
npx tsc -b && npx vite build
```

**배포 전 체크리스트:**
- [ ] 프롬프트 필드명: `name`/`display_name`/`tip`만 사용 (`name_ko`/`name_en`/`tip_en` ❌)
- [ ] 코드 필드 참조: 신 || 구 폴백 패턴 유지
- [ ] `api/_food_index.json` 삭제 안 했는지 확인
- [ ] PDF 컨테이너: `position:absolute` + `left:0` 유지 확인
- [ ] 새 텍스트 추가 시 `ko`/`en`/`ja`/`zh` 4개 언어 동시 추가
- [ ] 모바일 전용 수정이 데스크톱에 영향 안 주는지 확인

---

## F. 알려진 약점

- **제주/경주/전주 맛집 DB 부족** → `_food_index.json`에 해당 지역 식당이 적어 `unverified_restaurant` 발생
- **Gemini 비결정성** → 동일 조건에서도 결과 변동 (temperature=0.95)
- **제주 비건 DB**: 5/25 sweep 기준 `tag=vegan + city=jeju` 26 row 존재. 이전 기재 '0건' 은 2026-04 이전 상태 — 이후 수집 완료. 제주 비건 plan 정상 추천 가능.
- **`validatePatternStructure` strict validator + Gemini 비결정성 = intermittent PLAN_VALIDATION_FAILED 위험**
  - 5/12 자율 검증 시스템 (W2 agent) 가 prod 에서 자동 감지
  - 새 validator 추가 시 반드시 **multi-layer fallback** (substring + alternate field + lenient case) 적용
  - 예 (B-13): lodging name OR address OR day.theme OR intercity_transit.to_city OR known hotel chain — 5 fallback
  - **Lesson**: validator strict 1-layer 매칭은 Gemini 응답 다양성에 못 따라감 → false positive → retry 후 throw 500

---

## G. 프로젝트 상태 (2026-04-16)

**Phase 3 완료** — 총 이슈 32→9건 (-71.9%)

| 지표 | Phase 1 기준 | Phase 3 후 |
|---|---|---|
| 총 이슈 | 32 | 9 |
| unverified_restaurant | 21 | 7 |
| language_mismatch | 10 | 1 |
| 다양성 중복률 | 21% | 18% |

**남은 Phase:**
- Phase 4: 3-pass 아키텍처 — 사용자 명시적 승인 후만 시작
- Phase 5: 다양성 개선 — 현재 18%, 목표 달성 상태
- Phase 6: 제주/경주/전주 DB 수집

---

## H. 빌드 비용 절감 워크플로우 (2026-04-28 도입)

**배경**: 04-05~04-27 cycle에 Vercel $158 + GitHub Actions ~3,200 min 사용. 푸시 빈도 폭증이 주 원인.

### 커밋 메시지 규칙 — 4단계 운용

| 상황 | 커밋 메시지 패턴 | 빌드 동작 |
|---|---|---|
| **작업 중간 저장** | `git commit -m "WIP: 정리 중"` | ❌ 빌드 스킵 |
| **임시 푸시** | `git commit -m "fix: foo [skip ci]"` | ❌ 빌드 스킵 |
| **문서/테스트만 변경** | (일반 메시지) | ❌ 자동 스킵 (`docs/`, `tests/`, `*.md`, `.github/`, `.agent/`) |
| **Draft PR 단계** | (일반 메시지) | ❌ PR Tests/Bundle Size 스킵 |
| **정식 검증** | `git commit -m "feat: ..."` | ✅ 정상 빌드 + 테스트 |

### 스킵 트리거 키워드 (vercel.json `ignoreCommand`)

- 커밋 메시지에 `[skip ci]`, `[skip vercel]`, `[no deploy]` 또는 `WIP` 접두 → Vercel 빌드 스킵
- 변경 파일이 `docs/`, `.github/`, `.agent/`, `tests/`, `*.md`만이면 → 자동 스킵

### Draft PR 활용

```bash
gh pr create --draft  # PR Tests/Bundle Size 안 돎
# ... 작업 진행 중 푸시 자유롭게
gh pr ready           # "Ready for review" 시점부터 검증 시작
```

### 워크플로우 최적화 (이미 적용됨)

- 모든 PR 워크플로우에 `concurrency.cancel-in-progress: true` 적용 → 같은 PR 새 푸시 시 이전 run 즉시 취소
- daily-health: 매일 → 월/수/금 (주3회)

### Vercel 프로젝트 1개 원칙

- canonical 본진: **`cocotrip-source_2026`** (cocotripkr.com 연결)
- 이외 중복 프로젝트 생성 금지 — 매 푸시마다 N배 빌드 비용 발생

### 모니터링 위치

- Vercel Dashboard → Usage → Build Minutes
- GitHub → Settings → Billing → Plans and usage

---

## I. 환경변수 안전 규칙 (CRITICAL — 어기면 prod 인증 사망)

### `FIREBASE_PRIVATE_KEY` — Vercel Dashboard에서 직접 입력만
- **CLI(`vercel env add`)로 설정 금지** — 줄바꿈/특수문자 손상으로 cert() invalid → Firebase 인증 전체 401
- 기존 사고: PR #171/#172/#173 — helper에서 `.trim()`/PEM reformat 한 줄 잘못 건드려서 prod 다운
- 정답 패턴: `(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')` (trim 금지)

### `NCP_CLIENT_ID` (Naver Maps NCP 키)
- **`process.env.NCP_CLIENT_ID.trim()` 필수** — 보이지 않는 개행문자(`\n`)로 401 발생
- 키 종류 혼용 금지: NCP 키와 Naver Developers 키는 다른 시스템

### 일반 원칙
- 23개 env 키 모두 Vercel Dashboard에서만 관리 (Git 저장 금지)
- 신규 키 추가 시 모든 환경(production/preview/development)에 동시 등록 — preview만 빠지면 PR 빌드 silent fail
- 시크릿 rotation 권장: PayPal 90일, Firebase 키 1년

---

## J. SAFETY-CRITICAL — 음식 선호도 데이터 (Halal / Vegan / 알레르기)

식이제한·알레르기 데이터는 **잘못 처리되면 고객 건강 위험** 등급. 다른 어떤 필드보다 우선.

### 데이터 흐름 — 매 변경마다 전체 체인 검증
```
WizardStep1Food (UI 입력)
  → WizardForm state
  → PlannerPage (요청 페이로드)
  → /api/ai-planner-full (백엔드 진입)
  → _food_helper.js (allowlist 검증)
  → Gemini prompt (system instruction에 명시)
  → 응답 검증 (validateResponse)
  → Firestore 저장
```

### 절대 규칙
- ❌ `dietary || []` / nullish-coalescing fallback — 빈 배열 폴백 금지. **누락 자체가 에러**여야 함
- ❌ silent drop — 검증 실패 시 명시적 throw, 절대 무시 금지
- ❌ "기본값으로 처리" — 알레르기 미입력 ≠ 알레르기 없음
- ✅ 변경 시 5개 지점 모두 grep해서 일관성 확인: `grep -rn "halal\|vegan\|allergy\|dietary" src api`

### 변경 PR 체크리스트
- [ ] WizardStep1Food → WizardForm state 전달 라인 검증
- [ ] PlannerPage → API 페이로드에 포함 검증
- [ ] _food_helper.js allowlist에 새 값 추가됨
- [ ] Gemini prompt instruction에 반영됨
- [ ] validateResponse가 응답에서 식이제한 위반 검출함
- [ ] i18n 4-lang (ko/en/ja/zh) 동시 업데이트
