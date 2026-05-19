# PDF Golden CI — `scripts/pdf-golden-check.mjs`

자율 검증 사각지대 매트릭스 **L3 (PDF 런타임)** 게이트. 매 PR Vercel preview deploy 후 fixture plan 의 PDF 를 server endpoint (`api/pdf/generate.js`, Puppeteer + Chromium) 로 생성 → `pdf-parse` 로 페이지수 + 텍스트 + 글리프 검증.

## 검증 항목 (4 assertion)

| ID | 항목 | 차단 회귀 |
|---|---|---|
| A1 | PDF 페이지 수 >= 5 | P92 cut-off (Day 6 후반 + Day 7 누락) |
| A2 | PDF 텍스트 글자수 >= 1000 | P92 cut-off (페이지 수는 OK 인데 내용 짧음) |
| A3 | locale keyword 존재 (ko OR en) | font 미로딩 → 전부 □ tofu |
| A4 | tofu glyph 비율 < 0.5% | PDF_KOREAN_FONT 회귀 |

## 운영자 후속 작업 (인프라 PR 머지 후)

본 인프라 PR 머지 시점에서는 GitHub Secrets 가 등록 안 됐으므로 workflow 가 SKIP 모드. 아래 4 step 완료 후 strict active.

### Step 1: Fixture plan 생성

운영자 본인 (admin bypass 가능 email) 으로 prod 또는 preview 에서 plan 1건 생성:

1. `https://cocotripkr.com/planner` 접속
2. wizard 입력: 임의의 안정된 도시 + 짧은 duration (1-2 day) — long-lived 안정성
3. Test Mode 또는 admin bypass 로 결제 우회
4. plan 생성 완료 후 plan detail URL 에서 `planId` 복사 (e.g. `https://cocotripkr.com/plan/abc123XYZ` → `abc123XYZ`)
5. Plan 이 너무 자주 expire/delete 되지 않도록 운영자 Firestore 에서 별도 표시 (예: `metadata.do_not_delete: true`)

### Step 2: GitHub Secrets 등록

`Settings → Secrets and variables → Actions → New repository secret`:

| Secret name | 값 |
|---|---|
| `FIREBASE_WEB_API_KEY` | Vercel env `VITE_FIREBASE_API_KEY` 와 동일 |
| `HEALTH_CHECK_EMAIL` | fixture plan 소유자 email (admin bypass) |
| `HEALTH_CHECK_PASSWORD` | 동일 사용자 password |
| `PDF_GOLDEN_PLAN_ID` | Step 1 에서 복사한 planId |

⚠️ `FIREBASE_WEB_API_KEY` / `HEALTH_CHECK_EMAIL` / `HEALTH_CHECK_PASSWORD` 는 `pr-payment-regression.yml` 이 이미 사용 — 등록되어 있을 가능성 높음. `PDF_GOLDEN_PLAN_ID` 만 신규.

### Step 3: 첫 PR 에서 active 확인

Secrets 등록 후 첫 PR 에서 workflow `pdf-golden` check 가 SUCCESS 로 통과해야 함. `Actions` 탭에서 PDF generate 시간 (~30-60s) + assertion 결과 확인.

### Step 4: Strict 모드 전환 (이미 본 PR 부터 strict)

본 workflow 는 fail 시 PR 머지 차단. SKIP 모드는 env 누락 시만 — 정상 운영 시 strict.

## 로컬 실행

```bash
export FIREBASE_WEB_API_KEY="..."
export HEALTH_CHECK_EMAIL="..."
export HEALTH_CHECK_PASSWORD="..."
export PDF_GOLDEN_PLAN_ID="..."
export BASE_URL="https://cocotripkr.com"  # 또는 preview URL
node scripts/pdf-golden-check.mjs
```

## 위반 시

PR 머지 차단 + `GITHUB_STEP_SUMMARY` 표에서 어느 assertion 이 fail 했는지 확인:
- A1 fail → P92 cut-off 재발. `tryServerPdf` 의 `force: true` 분기 동작 안 함 또는 server endpoint 자체 회귀
- A2 fail → 비슷한 cut-off (페이지는 OK)
- A3 fail → font 미로딩. `tests/unit/pdf-capture-cutoff-pr92.test.ts` 의 `document.fonts.ready` assertion 도 같이 fail 확인
- A4 fail → CJK font fallback 회귀. `PDF_KOREAN_FONT` lint rule 도 trigger 됐는지 확인

## 알려진 제약

- **시간**: PDF 생성 ~30-60s + parse ~1s. CI 시간 +1분.
- **fixture plan TTL**: 운영자 Firestore 에 plan 살아있어야 함. `do_not_delete: true` flag 권장.
- **server endpoint 의존**: `api/pdf/generate.js` 가 maxDuration=60s. 큰 plan (10+ day) 은 timeout 가능 → fixture 는 1-2 day 권장.

## 참조

- 메모리 P92: `feedback_mistake_p92_pdf_capture_cutoff.md`
- 메모리 PDF 한글: `feedback_pdf_korean_lessons.md`
- 매트릭스: `scripts/README-lint-patterns.md` 의 L3 카테고리
