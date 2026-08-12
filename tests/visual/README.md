# Visual Regression — `tests/visual/`

CocoTrip 자율 검증 사각지대 L4 (시각 회귀 / 모바일 viewport) 게이트. 정적인 화면은 픽셀 기준선으로 비교하고, 인증·실시간 데이터 화면은 결정적 fixture로 구조와 실제 치수를 검사한 뒤 현재 화면을 artifact로 남긴다.

P93 (모바일 section 탭 horizontal overflow) 같은 layout 회귀가 사용자에게 도달하기 전, PR 머지 단계에서 pixel-diff 로 자동 차단.

## 무엇

- `playwright.visual.config.ts` — visual 전용 Playwright 설정 (e2e 와 분리)
- `tests/visual/*.spec.ts` — 페이지별 snapshot 또는 결정적 시각 smoke 검증
  - `landing-mobile.spec.ts` — landing (/) 모바일 회귀 (P93)
  - `plan-detail-mobile.spec.ts` — PlanDetailPage 문서 셸의 overflow·44px·상태 검증 + 현재 화면 artifact
- `tests/visual/*-snapshots/` — baseline PNG (Linux/chromium 기반)
- `.github/workflows/pr-visual-regression.yml` — Vercel preview deploy 후 자동 비교

## 왜

P92 (PDF cut-off) / P93 (모바일 탭 overflow) 같은 시각 영역 회귀는 정적 grep (`mistake-lint`) 으로는 잡히지 않음. `enable-funding=googlepay,applepay` 같은 코드 패턴은 lint 가능하지만 CSS overflow 한 줄 차이는 실 브라우저 렌더링 없이 감지 불가.

## 실행

### CI (자동)

`pr-visual-regression.yml` 가 Vercel preview deploy success 시 자동 실행. 픽셀 비교 spec은 baseline과 대조하고, PlanDetailPage처럼 데이터 의존성이 큰 spec은 route fixture로 같은 화면을 만든 뒤 구조·치수 assertion을 실행한다.

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

1. `tests/visual/<page>-mobile.spec.ts` 작성
2. 정적인 화면은 `landing-mobile.spec.ts`처럼 viewport clip과 Linux baseline을 사용한다.
3. 인증·실시간 데이터 화면은 `plan-detail-mobile.spec.ts`처럼 요청을 결정적 fixture로 가로채고, overflow·touch target·상태 종료를 직접 단정한다. 운영 계정이나 가변 운영 문서에 의존하지 않는다.
4. 픽셀 비교 spec을 추가했다면 Docker로 baseline을 생성한다:
   ```bash
   docker run --rm -it \
     -e BASE_URL=https://cocotripkr.com \
     -v "${PWD}:/work" -w /work \
     mcr.microsoft.com/playwright:v1.60.0-noble \
     bash -c "npm ci && npx playwright test --config=playwright.visual.config.ts --update-snapshots"
   ```
5. baseline PNG 들 + spec 같이 commit. assertion 기반 spec은 `testInfo.attach`로 현재 화면을 CI artifact에 남긴다.
6. PR 에서 CI 자동 비교 시작

### PlanDetailPage 주의사항

- `/api/get-plan`, 리뷰 목록, 지도 타일, 외부 폰트를 spec 안에서 고정해 운영 데이터와 계정에 의존하지 않는다.
- 문서 상단·일차 지도·권한 오류 상태의 screenshot을 artifact로 남겨 사람이 최종 화면을 확인할 수 있게 한다.
- PlanDetailPage 핵심 파일 변경 시 `R_PlanDetailVisual` lint rule 이 spec 존재를 자동 검사한다.

## 위반 시

픽셀 비교 spec은 `maxDiffPixelRatio: 0.01` (1%) 초과 시 실패한다. assertion 기반 spec은 overflow·44px·상태·DOM 계약이 깨지면 실패한다. `tests/visual-report/` artifact에서 diff 또는 현재 화면 PNG를 확인한다:
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
