# Visual Regression — `tests/visual/`

CocoTrip 자율 검증 사각지대 L4 (시각 회귀 / 모바일 viewport) 게이트.

P93 (모바일 section 탭 horizontal overflow) 같은 layout 회귀가 사용자에게 도달하기 전, PR 머지 단계에서 pixel-diff 로 자동 차단.

## 무엇

- `playwright.visual.config.ts` — visual 전용 Playwright 설정 (e2e 와 분리)
- `tests/visual/*.spec.ts` — 페이지별 snapshot 검증
  - `landing-mobile.spec.ts` — landing (/) 모바일 회귀 (P93)
  - `plan-detail-mobile.spec.ts` — PlanDetailPage 모바일 회귀 (5/26 P206-P210 후속)
- `tests/visual/*-snapshots/` — baseline PNG (Linux/chromium 기반)
- `.github/workflows/pr-visual-regression.yml` — Vercel preview deploy 후 자동 비교

## 왜

P92 (PDF cut-off) / P93 (모바일 탭 overflow) 같은 시각 영역 회귀는 정적 grep (`mistake-lint`) 으로는 잡히지 않음. `enable-funding=googlepay,applepay` 같은 코드 패턴은 lint 가능하지만 CSS overflow 한 줄 차이는 실 브라우저 렌더링 없이 감지 불가.

## 실행

### CI (자동)

`pr-visual-regression.yml` 가 Vercel preview deploy success 시 자동 실행. baseline 없으면 PR 코멘트로 "Run baseline generation locally" 안내 (PR block 안 함).

### 로컬 (baseline 생성 / 의도적 UI 변경 시)

**중요**: baseline PNG 는 generation OS (font rendering) 에 묶임. **반드시 CI 와 동일한 Linux/chromium 환경에서 생성**. Windows native PowerShell 에서 생성한 baseline 은 Ubuntu CI 와 픽셀 매칭 안 됨.

#### Docker (권장)

```bash
# Linux/macOS
docker run --rm -it -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v1.60.0-noble \
  bash -c "npm ci && npx playwright test --config=playwright.visual.config.ts --update-snapshots"

# Windows PowerShell
docker run --rm -it -v "${PWD}:/work" -w /work mcr.microsoft.com/playwright:v1.60.0-noble bash -c "npm ci && npx playwright test --config=playwright.visual.config.ts --update-snapshots"
```

생성된 `tests/visual/*-snapshots/` 디렉토리를 commit.

#### WSL2 Ubuntu (대안)

```bash
# WSL2 안에서
cd "/mnt/e/ai에이젼시만들기/홈페이지 클로드ai/홈페이지 사이트 최근"
npm ci
npx playwright install --with-deps chromium
npx playwright test --config=playwright.visual.config.ts --update-snapshots
```

#### CI 에서 자동 baseline (대안)

PR 코멘트에 `[visual-baseline-regenerate]` 포함 시 CI 가 자동 `--update-snapshots` 후 commit-back. **현재 미구현** — 후속 PR 후보.

## 새 페이지 추가 — 절차

1. `tests/visual/<page>-mobile.spec.ts` 작성 (landing-mobile.spec.ts 참조)
2. **above-the-fold viewport clip 만 capture** — full-page 는 동적 콘텐츠 (광고/가격/추천) 로 매번 baseline drift
3. **인증 필요 페이지** (PlanDetailPage 등): `injectFirebaseAuth(page)` 헬퍼 패턴 사용 (plan-detail-mobile.spec.ts 참조).
   - `VITE_FIREBASE_API_KEY`, `HEALTH_CHECK_EMAIL`, `HEALTH_CHECK_PASSWORD` env 필수.
   - Firebase REST → idToken → localStorage `firebase:authUser:<apiKey>:[DEFAULT]` inject.
4. Docker 로 baseline 생성 (위 명령). env 는 Docker `-e` 플래그로 주입:
   ```bash
   docker run --rm -it \
     -e VITE_FIREBASE_API_KEY=xxx \
     -e HEALTH_CHECK_EMAIL=xxx \
     -e HEALTH_CHECK_PASSWORD=xxx \
     -e PDF_GOLDEN_PLAN_ID=d064bbc6-dbe9-4bed-9e06-8db77f27ab4b \
     -e BASE_URL=https://cocotripkr.com \
     -v "${PWD}:/work" -w /work \
     mcr.microsoft.com/playwright:v1.60.0-noble \
     bash -c "npm ci && npx playwright test --config=playwright.visual.config.ts --update-snapshots"
   ```
5. baseline PNG 들 + spec 같이 commit
6. PR 에서 CI 자동 비교 시작

### PlanDetailPage baseline 생성 주의사항

- `PDF_GOLDEN_PLAN_ID` fixture plan (`d064bbc6-...`) 이 `arrival_guide` / `departure_guide` 포함하는지 확인 (A5/A6 PDF assertion 연동).
- 동적 콘텐츠 (광고 슬라이드 / 환율 가격) 는 clip 으로 제외. T1/T2/T3 clip 좌표 유지.
- PlanDetailPage 핵심 파일 변경 시 `R_PlanDetailVisual` lint rule 이 spec 존재를 자동 검사.

## 위반 시

`maxDiffPixelRatio: 0.01` (1%) 초과 픽셀 차이 발생 시 CI fail. tests/visual-report/ artifact 다운로드 → diff PNG 확인:
- 의도된 UI 변경 → 로컬 `--update-snapshots` + 새 baseline commit
- 회귀 → 코드 fix

## 알려진 제약

- **단일 엔진 (chromium)** — webkit/firefox 픽셀 매칭 어려움
- **단일 OS (Linux)** — CI 환경과 baseline 환경 일치 필수
- **시간/난수 의존 페이지 차단 권장** — `Math.random()` / `new Date()` 직접 사용 페이지는 viewport clip 으로 그 영역 제외
- **framer-motion / CSS transition** — config `animations: 'disabled'` 로 freeze. 그래도 hover/focus state 는 명시적 처리 필요

## 참조

- 메모리 P93: `feedback_mistake_p93_section_tabs_mobile_overflow.md`
- 메모리 매트릭스: `scripts/README-lint-patterns.md` (L4 카테고리)
- Playwright visual docs: https://playwright.dev/docs/test-snapshots
