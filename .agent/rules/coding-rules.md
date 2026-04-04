# CocoTrip KR — Coding Rules

## 1. Icon & Emoji Policy
- **Emoji 사용 금지** — 모든 아이콘은 `lucide-react`에서 import
- 예: `<Check />`, `<MapPin />`, `<Car />` (NOT ✅, 📍, 🚗)
- `lucide-react` 외 아이콘 라이브러리 추가 금지

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

## 6. File Organization
```
src/components/   → 재사용 가능 컴포넌트
src/sections/     → 랜딩 페이지 섹션 (Header, Footer, etc.)
src/pages/        → 라우트 레벨 페이지
src/hooks/        → Custom React hooks
src/data/         → 정적 데이터 (가격표 등)
src/config/       → 설정 (제휴 링크 등)
src/i18n/         → 번역 파일
api/              → Vercel serverless functions
api/_crons/       → Cron job handlers
api/_ai_core/     → AI agent system prompts
```

## 7. Build Rules
- `tsc -b` 에러 = 빌드 실패 (unused vars도 error)
- unused import 반드시 제거
- `// @ts-ignore` 사용 금지
- 빌드 전 항상 `npm run build` 로컬 확인

## 8. Git Conventions
- Commit prefix: `feat:`, `fix:`, `refactor:`, `chore:`
- 한 커밋에 관련 변경만 포함
- 배포 전 반드시 빌드 성공 확인 후 push
