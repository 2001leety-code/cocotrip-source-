# CocoTrip KR — Coding Rules

## 1. Icon & Emoji Policy
- **Emoji 사용 금지** — 모든 아이콘은 `lucide-react`에서 import
- 예: `<Check />`, `<MapPin />`, `<Car />` (NOT ✅, 📍, 🚗)
- `lucide-react` 외 아이콘 라이브러리 추가 금지
- **특히**: 템플릿 리터럴/문자열 내부(PDF HTML, 이메일, 주석)에도 이모지 금지
  - 과거 사고: PDF HTML에 `✈️` `📍` 사용 → 에디터 저장 중 `?�️` `??` 로 mojibake → PDF 백지 + UI에 `??` 리터럴 노출
  - 구분자가 필요하면 ASCII: `·` `—` `|` 또는 영문 단어 사용

## 1.5. Character Encoding Safety (MOJIBAKE 방지) 🆕
- **편집기 인코딩**: UTF-8 (BOM 없음) 고정
- **문자열 리터럴 규칙**:
  - 코드 내부 상수/라벨/PDF HTML/이메일 템플릿 → **순수 ASCII 우선**
  - 사용자-facing 텍스트 → 반드시 `src/i18n/index.ts` 경유 (4개 언어)
  - 한글/일본어/중국어 하드코딩 금지 (i18n 키로)
- **박스 주석 금지**: `// ───── XXX ─────` 형태의 유니코드 박스 주석 신규 추가 금지
- **이미 깨진 주석은 건들지 말 것**: `// ?�?�` 형태로 이미 mojibake된 주석을 "정리"하려고 재저장하면 악화됨 → 그대로 두기
- **매 편집 후 필수 검증**:
  ```bash
  node -e "const f=require('fs').readFileSync('<파일>','utf8'); console.log(/\?\?/.test(f)||/\uFFFD/.test(f) ? 'BAD' : 'CLEAN');"
  ```
  `BAD` 나오면 커밋 금지

## 2. Internationalization (i18n)
- **모든 사용자-facing 텍스트는 i18n 키로 처리**
- 번역 파일: `src/i18n/index.ts` (단일 파일, 4개국어)
- 지원 언어: `ko` (한국어), `en` (English), `ja` (日本語), `zh` (中文)
- 사용 방법:
  ```tsx
  const { t, language } = useLanguage();
  const p = t.planner;  // or t.charterPage, t.header, etc.
  <span>{p.someKey}</span>
  ```
- 새 텍스트 추가 시: 4개 언어 번역 모두 동시에 추가
- 하드코딩 한국어/영어 텍스트 절대 금지
- 긴급 fallback만 ternary 허용:
  ```tsx
  {language === 'ko' ? '...' : language === 'ja' ? '...' : language === 'zh' ? '...' : '...'}
  ```

## 3. Design System

### Colors
- **다크 테마 기반** — 배경: `#080b14`, `#0a1628`, `#0f111a`
- **포인트 컬러**: `#8b6cc7` (primary purple), `#7C5CFC` (vibrant purple)
- **액센트**: `#EA537E` (pink), `#C4956A` (gold)
- **성공**: emerald-400/500
- **에러**: red-400/500

### Gradients & Effects
- 그라디언트 선호: `bg-gradient-to-r from-[#7C5CFC] to-[#EA537E]`
- 글로우 효과: `shadow-[0_0_15px_rgba(124,92,252,0.5)]`
- 글래스모피즘: `bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm`
- 호버: `hover:scale-[1.02]`, `hover:border-[#7C5CFC]/50`

### Typography
- Text colors: `text-white`, `text-white/80`, `text-white/50`, `text-white/30`
- Label style: `text-[11px] uppercase tracking-[.07em] text-white/35 font-semibold`
- Card title: `text-lg font-bold text-white`

### Borders & Rounds
- 카드: `rounded-2xl`
- 버튼: `rounded-xl`
- 작은 뱃지: `rounded-full`
- 기본 border: `border-white/[0.1]`

## 4. Component Conventions
- 파일명: **PascalCase.tsx** (예: `PayPalBookingButton.tsx`)
- 컴포넌트 export: named export 선호, page는 `export default`
- Props 타입: `interface` 선호 (inline `type` OK for simple ones)
- 스타일: **Tailwind 클래스 inline**, CSS 파일 최소화

## 5. API & Security
- **API 키 하드코딩 절대 금지**
- 서버 환경변수: `process.env.VARIABLE_NAME`
- 클라이언트 환경변수: `import.meta.env.VITE_VARIABLE_NAME`
- PayPal client ID만 클라이언트 노출 허용 (`VITE_PAYPAL_CLIENT_ID`)
- CORS: Vercel 자동 처리, 추가 CORS 설정 불필요

## 6. File Size Limits
- **신규 파일**: 400줄(20KB) 이내로 생성
- **기존 파일 수정 시**: 600줄 초과 파일은 수정 전 분리 제안
- **1000줄 이상 파일**: 수정 금지 → 반드시 먼저 컴포넌트 분리
- **목표**: 페이지 100~200줄, 컴포넌트 150~300줄, 훅 50~150줄

## 6.1. 파일 수정 Lock (현재 적용 중) 🆕
아래 파일은 **분리 태스크 완료 전까지 수정 금지**. 버그 발견 시 사용자에게 보고만 하고 수정하지 말 것.

| 파일 | 현재 줄 수 | Lock 사유 | 해제 조건 |
|---|---|---|---|
| ~~`src/pages/PlannerPage.tsx`~~ | ~~1991~~ | **[P0 Released 2026-04-19]** -> `src/pages/PlannerPage/` 22 files (max 283L) | - |
| `api/ai-planner-full.js` | ~~1273~~ → 461 | **[P1 Released 2026-04-19]** -> `api/_ai_core/` 6 modules (max 347L) | - |
| ~~`src/pages/PlanDetailPage.tsx`~~ | ~~1144~~ | **[해제 완료 2026-04-19]** → `src/pages/PlanDetailPage/` 10파일 분리 (max 521L) | - |
| ~~`src/components/WizardForm.tsx`~~ | ~~807~~ | **[해제 완료 2026-04-18]** → `src/components/WizardForm/` 7파일 분리 (각 <=245L) | - |

**예외**: `Emergency Exception` (`antigravity-4phase.md` §🚨) 발동 시만 수정 가능.  
Emergency 후 48시간 내 `workflow_report.md` 작성 + 분리 채무 티켓 등록 의무.

세부 금지 영역은 `.agent/workflows/anti-gravity-handoff.md` 참조.

## 7. File Organization
```
src/components/   → 재사용 가능 컴포넌트
src/sections/     → 랜딩 페이지 섹션 (Header, Footer, etc.)
src/pages/        → 라우트 레벨 페이지 (조립용, 200줄 이내)
src/features/     → 기능별 분리 컴포넌트 (planner/, charter/, payment/)
src/shared/       → 공통 상수, 타입, 훅
src/hooks/        → Custom React hooks
src/data/         → 정적 데이터 (가격표 등)
src/config/       → 설정 (제휴 링크 등)
src/i18n/         → 번역 파일
api/              → Vercel serverless functions
api/_crons/       → Cron job handlers
api/_ai_core/     → AI agent system prompts
api/_shared/      → 서버 공통 헬퍼 (PayPal, 이메일 등)
```

## 8. Build Rules
- `tsc -b` 에러 = 빌드 실패 (unused vars도 error)
- unused import 반드시 제거
- `// @ts-ignore` 사용 금지
- **일상 검증**: `npx tsc --noEmit` (무료, 빠름)
- **Mojibake 스캔** (`§1.5` 참조) — 편집 후 필수, tsc만으로는 잡히지 않음
- **`npm run build` / `vite build`는 배포 직전 1회만** (Vercel 빌드 비용 절감)
- 중복 상수 금지: TEST_ACCOUNTS 등 공통 값은 shared/constants에서만 관리

## 9. Git Conventions
- Commit prefix: `feat:`, `fix:`, `refactor:`, `chore:`
- 한 커밋에 관련 변경만 포함
- 배포 전 `npx tsc --noEmit` 통과 확인 후 push
- **git push는 모든 수정 완료 후 1회만** (Vercel 빌드 비용 절감)
- **push 후 배포 검증 필수**: `.agent/workflows/post-push-verification.md` 참조
  - Vercel 빌드 Ready 확인 (브라우저로 직접)
  - cocotripkr.com 프로덕션 페이지 로드 확인 (브라우저로 직접)
  - 변경된 페이지 UI 정상 확인
  - 결과를 표로 정리하여 사용자에게 보고
