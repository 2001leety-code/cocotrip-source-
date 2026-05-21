# Mistake Pattern Lint — `scripts/lint-mistake-patterns.mjs`

CocoTrip 오답노트의 반복 실수 패턴을 PR diff 에 자동 lint. PR 머지 전 차단 (자율 검증 L1 게이트).

## ⚠️ 자율 검증 사각지대 매트릭스 (2026-05-19)

**메타-rule**: 매 P-pattern (오답노트) 추가 시 다음 카테고리 중 어디에 속하는지 분류 +
해당 카테고리의 자동 게이트가 실재하는지 확인. 없으면 후속 PR 에서 도입.

| 카테고리 | 자동 게이트 | 위치 | 잡는 회귀 예 |
|---|---|---|---|
| **L0: 자율 검증 게이트 자체** | mistake-lint R-P118 + pre-push 자체 | `scripts/git-hooks/pre-push` + `scripts/setup-git-hooks.mjs` + `R-P118` | P118 (pre-push 의 vitest/size/lint step 삭제), hook 자체 활성화 누락 |
| **L1: 코드 grep 패턴** | mistake-lint | `scripts/lint-mistake-patterns.mjs` + `pr-mistake-lint.yml` | P5 (food index 삭제), P7 (PDF position), P95 (SDK enable-funding 코드 라인) |
| **L2: 외부 API contract** | SDK preflight | `scripts/preflight-sdk-urls.mjs` + `pr-sdk-preflight.yml` | P95 런타임 (PayPal CDN 400), 미래 Gemini/Naver SDK reject |
| **L3: PDF 런타임** | ⏳ 후속 도입 | (계획) Vercel preview + Playwright + pdf-parse | P92 byte-output cut-off, 한글 폰트 깨짐 |
| **L4: 시각 회귀 / 모바일 viewport** | ⏳ 후속 도입 | (계획) Playwright screenshot diff | P93 모바일 탭 overflow, 다크모드 contrast |
| **L5: E2E user journey** | △ 부분 | `pr-i18n-smoke.yml`, `pr-payment-regression.yml`, `pr-voucher-regression.yml` | 결제·voucher·i18n 회귀 |

**L3/L4 가 미도입** — P92 / P93 같은 런타임 시각 영역은 L1 grep + L5 부분 smoke 만으로는 잡히지 않음.
새 P-pattern 추가 시 L3/L4 영역이면 후속 PR 로 게이트 도입 우선순위 등록.

## P-pattern 메모리 위치

운영자 로컬: `C:\Users\<user>\.claude\projects\E--ai-------\memory\feedback_mistake_p<NN>_*.md`.
인덱스: 같은 dir 의 `MEMORY.md`. 새 P 추가 시 양쪽 모두 업데이트.

## 무엇

- `scripts/lint-mistake-patterns.mjs` 가 base..HEAD diff 를 스캔해 알려진 함정 패턴을 검출
- `.github/workflows/pr-mistake-lint.yml` 이 모든 PR 에서 자동 실행 + 결과를 PR 코멘트로 첨부
- 위반 1건 이상이면 exit 1 → PR 체크 fail → 머지 차단

## 왜

운영자 frustration (2026-05-12): 메모리 `feedback_mistake_log.md` (P1-P27) + `feedback_pdf_korean_lessons.md` + `feedback_proactive_audit.md` 가 있지만 **매 PR 수동 참조라 5/2~5/12 한 달 내내 같은 함정 반복**. 자동 lint 로 영구 차단.

## 현재 룰 (10개)

| 규칙 | 메모리 출처 | 위반 조건 | 검사 범위 |
|---|---|---|---|
| `P1_dateInclusiveExclusive` | P10 + P1 | `addDays`/`diffDays`/`tourDays`/`computeNights` 헬퍼 **정의·호출** 또는 `startDate`/`endDate` **사용** (할당·메소드·산술) 변경 시 `inclusive`/`exclusive` 주석 없음 | **changed lines** (PR #391 정밀화 — type field declaration 제외) |
| `P3_i18nKeyParity` | P2 | 신규 `t('NEW_KEY')` 가 ko/en/ja/zh 4 locale 중 일부에만 존재 | changed lines |
| `P5_foodIndexProtection` | CLAUDE.md B-1 + P5 | `api/_food_index.json` 삭제 · rename · `.gitignore` 등록 | file 전체 |
| `P7_pdfPositionAbsolute` | CLAUDE.md B-3 + PDF 가이드 | `pdfGenerator.ts` 에 `display:none` / `left:-9999` / `position:absolute + left:0` 부재 (주석 stripping 후 검사) | specific file |
| `PDF_KOREAN_FONT` | feedback_pdf_korean_lessons 가이드 1/3 | Noto Sans KR 로딩에 `display=swap` / `fonts.ready` 만 신뢰하고 글리프 측정 부재 / CJK fallback chain 부재 | specific file |
| `STOP_SCHEMA` | CLAUDE.md B-2 + C | `stop.name_ko` / `name_en` / `tip_en` 신규 reference (base 대비 카운트 증가) | base 대비 |
| `SURFACE_AUDIT` | feedback_proactive_audit.md | 도시/공항/모드/dietary 키워드 신규 추가했는데 wizard/zone/airport/PDF/email 5 surface 대부분 미변경 (경고만, exit 0) | 키워드 기반 |
| `P32_sprinterGuideDedup` | P32 | `useQuoteCalculator.ts` 의 `licensed_guide` push 라인 주변 ±400 chars 에 sprinter dedup 가드 (`vehicle !== 'sprinter'`) 부재 | specific file + 위치 window |
| `P33_comboHardcode` | P33 | `TourPackageInlineAd.tsx` / `createPaypalOrder.js` / `_shared/pricing.js` 에 `combo_airport_*` 가까이 `priceKRW: <정수 5자리+>` 하드코딩 (SSOT 함수 호출 X) | specific TARGETS |
| `P34_priceUsdConsistency` | P34 | `pricing_spec.json` 의 `priceUSD` 가 `policy_krw_per_usd` 환율 기준 `round(priceKRW / rate) ± 1` 와 drift | SSOT file |
| `P118_prePushHookContent` | P118 (메타) | `scripts/git-hooks/pre-push` 부재 또는 4-piece (npm run build / vitest run / size-limit / lint-mistake-patterns.mjs) 중 누락. `scripts/setup-git-hooks.mjs` (prepare 활성화기) 부재 | file 전체 (sandbox 임시 dir 자동 skip) |
| `P119_dayLodgingBackfill` | P119 | `api/_ai_core/planPersister.js` 의 `backfillDayLodging` export 누락 또는 `api/ai-planner-full.js` 의 import/호출 누락 | 변경된 file 의 export/import grep |
| `P120_unreasonableStopTimeDetect` | P120 | `api/_ai_core/planPersister.js` 의 `detectUnreasonableStopTimes` export 누락 또는 `api/ai-planner-full.js` 가 호출 없이 또는 admin alert 발송 없이 사용 | 변경된 file 의 export/호출/alert grep |
| `P121_qualityWarningsAdminPanel` | P121 | `QualityWarningsPanel.tsx` 의 `isAdminEmail` import/호출 누락 → 일반 사용자 노출 위험. 또는 `PlanDetailPage/index.tsx` 의 import/렌더 누락 | 변경된 file 의 import/호출 grep |
| `P122_multiCityLodgingPlaceholder` | P122 | `buildPrompt.js` 의 다도시 city-specific 호텔 영역 표 (Seoul/Busan/Jeju 등) 누락. 또는 `planPersister.js` backfillDayLodging 의 city mismatch 가드 누락 — wrong-city 호텔 박힘 회귀 | 변경된 file 의 표 / 가드 grep |
| `P123_hotelByCityForwarding` | P123 | `ai-planner-full.js` 의 hotelByCity destructure / MULTI-CITY HOTELS BY CITY 블록 / backfillDayLodging(., hotelByCity) 인자 누락. 또는 `planPersister.js` 의 backfillDayLodging signature 의 hotelByCity 인자 / hbc[dayCityLc] lookup 누락 — wizard 도시별 호텔 입력 백엔드 무시 | 변경된 file 의 destructure / inject / lookup grep |
| `P124_arrivalDepartureSleepBuffer` | P124 + P124-extended (2026-05-21) | `buildPrompt.js` 의 ARRIVAL/DEPARTURE DAY HANDLING + GLOBAL TIME RULES (P124-extended) 3 block 누락 또는 8h sleep buffer (arrival+9h) logic 부재. 또는 `responseValidator.js` 의 B-LATE-ARRIVAL/B-EARLY-DEPARTURE/B-GLOBAL-DAWN (중간 day 새벽 stops) 3 rule 누락 | 변경된 file 의 block / rule grep |
| `P127_lodgingBookendMultiCityAnchor` | P127 | `routeEnrichment.js` 의 validateLodgingBookend signature 에 isMultiCity 인자 누락. day-level anchor 분기 logic 또는 호출처에서 isMultiCity 전달 누락 — multi-city false-positive 5건 잔존 | 변경된 file 의 signature / 분기 grep |

## 실행 방법

```bash
# 로컬 PR 머지 전 확인
node scripts/lint-mistake-patterns.mjs                 # base = origin/main
node scripts/lint-mistake-patterns.mjs origin/develop  # base 명시

# 인위 위반 6 케이스 검증 (CI 가 항상 정상 동작하는지 확인)
node scripts/lint-mistake-patterns.mjs --self-test
```

CI 는 `pull_request` (opened, synchronize, reopened) 이벤트에 자동 실행.

## 새 패턴 추가 — 5 step

0. **카테고리 분류** (자율 검증 사각지대 매트릭스 참조)
   - 본 P-pattern 이 L1 ~ L5 중 어디에 속하는지 확정.
   - 해당 카테고리 자동 게이트가 실재하면 → 1번부터 진행.
   - **L3/L4 미도입 영역이면** → 게이트 도입 후속 PR 등록 + 본 PR 은 L1 grep rule 만 추가 (best-effort cover).
1. **메모리 등록**
   - `C:\Users\<user>\.claude\projects\E--ai-------\memory\feedback_mistake_log.md` 의 `## 패턴 P-NN` 섹션에 새 카테고리 추가 (증상 / 원인 / 교훈 / 예방 + **L? 카테고리 명시**).
2. **룰 함수 추가**
   - `scripts/lint-mistake-patterns.mjs` 에 `function P-NN_xxx({ changed, base }) { ... }` 작성. `fail(rule, msg, hint)` 또는 `warn(rule, msg)` 호출.
   - **검사 범위 결정** (아래 "검사 범위 가이드" 참조):
     - 단순 type/interface 변경에 false positive 위험 있으면 → **changed lines 기반** (P1 패턴, PR #391 참조)
     - Specific file 의 정책 위반만 검사하면 → **file 전체** (P32/P33/P34 패턴)
   - `RULES` 배열에 `['P-NN_xxx', P-NN_xxx]` 추가.
3. **self-test 케이스 추가**
   - `runSelfTest()` 의 `cases` 배열에 인위 위반 1건 추가 (`base` / `head` 파일 맵 + `expectRule`).
   - **False positive 차단 검증도 권장** — 비슷한 패턴인데 위반 X 인 케이스 (`expectClean: true`) 추가. PR #391 의 P1 false positive 차단 케이스 참조.
   - `node scripts/lint-mistake-patterns.mjs --self-test` 통과 확인.
4. **README 표 업데이트**
   - 이 파일의 "현재 룰" 표에 새 행 추가 (검사 범위 column 포함).

### 검사 범위 가이드 (PR #391 학습)

**Changed lines 기반 검사** (`git diff base...HEAD -- <file>` 의 + 라인 추출):
- 사용 시점: 헬퍼 함수 정의/호출 또는 변수 사용 패턴이 핵심인데, 같은 file 의 무관한 type field 가 비슷한 키워드 가지는 경우
- 예: P1 의 `startDate?: string` (type field) vs `startDate = addDays(...)` (실 사용)
- 코드 패턴:
  ```js
  const diff = safeExec(`git diff ${base}...HEAD -- "${c.file}"`);
  const addedLines = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
  // addedLines 만 검사
  ```

**File 전체 검사** (`getChangedFileContent`):
- 사용 시점: Specific file 의 정책 위반을 잡는 룰 (P32: `useQuoteCalculator.ts` sprinter dedup / P33: combo hardcode TARGETS / P34: pricing_spec.json drift)
- 회귀가 의도라면 file 전체 — 기존 line 이라도 잔존하면 trigger 해야 함
- changed lines 로 바꾸면 기존 hardcode 가 silently 통과 — 위험

## 출력 형식

- `[OK]   R-NAME: 메시지` — stdout, 정상 통과
- `[WARN] R-NAME: 메시지` — stderr, 경고만 (exit code 영향 X)
- `[LINT] R-NAME: 메시지` — stderr, 위반 (exit 1 차단)

위반은 PR 코멘트에 자동 첨부 — workflow `pr-mistake-lint.yml` 가 `peter-evans/create-or-update-comment@v4` 로 게시.

## 운영 노트

- **거짓 양성 줄이기**: regex 가 comment 안 텍스트도 잡으면 P7 처럼 `stripComments()` 적용. 검출 패턴 강화보다 거짓 양성 우선 제거.
  - P1 정밀화 (PR #391) 사례: file 전체 grep → changed lines 기반 + type field 제외로 전환. PR #387 의 `startDate?: string` field 추가가 falsely trigger 되던 회귀를 self-test `expectClean: true` 케이스로 영구 차단.
- **base 시점 비교 필수**: STOP_SCHEMA / SURFACE_AUDIT 처럼 "신규 reference" 를 잡는 룰은 `getBaseFileContent()` 로 base 대비 증가만 잡아 legacy 유지 코드 보호.
- **메모리 동기화**: 룰 추가 시 메모리 P-NN 도 같이 추가해야 미래 세션이 패턴 자체를 인지함 (lint 는 "차단" 만 담당, "이해" 는 메모리 담당).
- **검사 범위 일관성**: 비슷한 의도의 룰들은 같은 검사 범위 사용. P1 (헬퍼 사용 패턴) = changed lines, P32-P34 (specific file 정책) = file 전체. 새 룰 작성 시 어느 카테고리인지 명시.
