---
description: AI가 반복적으로 저질렀던 실수 패턴과 예방 규칙 — 코드 수정 전 반드시 참고
---

# 🚨 AI 반복 실수 방지 체크리스트 (Common Mistakes Prevention)

> 이 문서는 2026년 4월 1일~9일 사이 9개 대화에서 실제로 발생한 AI 코딩 실수를 분류·정리한 것입니다.
> **모든 코드 수정 작업 시작 전에 이 문서를 1회 정독하고 해당 항목을 체크합니다.**

---

## 🔴 카테고리 1: 빌드 에러 (TypeScript)

### 실수 패턴
- `import`한 변수/컴포넌트를 사용하지 않아 **TS6133 unused variable** 에러 발생
- 컴포넌트를 삭제하거나 이름을 바꿨는데 다른 파일의 `import`를 업데이트 안 함
- `interface` 속성을 추가하고 실제 사용처에서 전달하지 않아 타입 에러 발생

### 방지 규칙
```
✅ 코드 수정 후 반드시 `npm run build` 실행
✅ import 추가 시 → 해당 변수를 실제로 사용하는지 확인
✅ import 제거 시 → 다른 파일에서 해당 모듈을 참조하는지 grep 확인
✅ 컴포넌트명 변경 시 → 프로젝트 전체에서 이전 이름 검색 후 모두 교체
```

---

## 🔴 카테고리 2: i18n 번역 누락

### 실수 패턴
- 새 UI 텍스트를 **한국어 또는 영어만** 추가하고 나머지 3개 언어 누락
- `t.section.key` 형태로 사용했지만 `src/i18n/index.ts`에 해당 키를 등록 안 함
- 긴급하다며 하드코딩 문자열 직접 삽입 → 다른 언어에서 한국어/영어 그대로 노출

### 방지 규칙
```
✅ 새 텍스트 추가 시 → ko, en, ja, zh 4개 언어 **동시에** 추가
✅ 하드코딩 텍스트 절대 금지 (예외: console.log, 개발자 전용 메시지)
✅ 수정 완료 후 → 브라우저에서 4개 언어 전환하여 UI 깨짐 확인
```

---

## 🔴 카테고리 3: 데스크톱 ↔ 모바일 분리 위반

### 실수 패턴
- **모바일 전용 컬러**(`#B668FC`, `#FF6B9D`)를 데스크톱 공용 파일에 삽입
- `MobileHome.tsx` 수정하면서 `HeroSlider.tsx` 등 데스크톱 컴포넌트도 동시에 변경
- `index.css`에 모바일 전용 스타일을 미디어 쿼리 없이 글로벌에 추가

### 방지 규칙
```
✅ 모바일 수정 → MobileHome.tsx, MobileBottomNav.tsx 등 모바일 전용 파일만 수정
✅ 데스크톱 컴포넌트(HeroSlider, HeroCards, Services 등)는 절대 건드리지 않음
✅ index.css에 모바일 스타일 추가 시 → 반드시 @media (max-width: 768px) 블록 안에
✅ 수정 후 → PC 브라우저(1200px+)에서 변경사항 없는지 시각 확인
```

---

## 🔴 카테고리 4: 환경변수 파싱 오류

### 실수 패턴
- `GOOGLE_PRIVATE_KEY`를 PowerShell에서 Vercel에 업로드 시 **줄바꿈(`\n`) 깨짐**
- **Sandbox PayPal 키**를 Live 모드에 넣어서 `401 invalid_client` 에러
- `.env` 파일의 값을 코드에 직접 하드코딩
- `process.env`와 `import.meta.env.VITE_` 혼동 (서버 vs 클라이언트)

### 방지 규칙
```
✅ 멀티라인 키(Private Key)는 Vercel 대시보드에서 수동 붙여넣기
✅ PayPal 키 등록 전 → Sandbox인지 Live인지 반드시 확인
✅ 클라이언트 코드에는 VITE_ 접두사만, 서버 코드에는 process.env만 사용
✅ API 키를 절대 코드에 하드코딩하지 않음
```

---

## 🔴 카테고리 5: 가격/데이터 불일치

### 실수 패턴
- `charterPricing.ts`에는 ₩330,000인데 PayPal 주문 생성에서 ₩291,200 사용
- 콤보 패키지 할인율이 UI와 실제 계산 로직에서 다름
- K-pop 셔틀 가격이 `business-logic.md`와 컴포넌트에서 불일치

### 방지 규칙
```
✅ 가격 관련 수정 시 → charterPricing.ts가 유일한 진실의 원천(Source of Truth)
✅ 변경 후 → business-logic.md, createPaypalOrder.js, CharterPage.tsx 3곳 모두 동기화
✅ USD/KRW 환율 변동에 주의 — 고정 환율 사용 (₩1,350 ≈ $1)
```

---

## 🟡 카테고리 6: API 필드명 불일치 (프론트-백엔드)

### 실수 패턴
- 백엔드(RouteAgent)가 `itinerary.days[].stops[]` 형식으로 보내는데
  프론트엔드에서 `itinerary.days[].places[]`로 읽어서 데이터 누락
- Gemini AI에 `address_en` 필드를 요청했지만 프론트에서 `addressEnglish`로 접근
- 네이버 Map URL에 좌표 대신 주소를 넘겨서 지도 로딩 실패

### 방지 규칙
```
✅ API 수정 시 → 응답 JSON 스키마를 먼저 문서화한 후 프론트 코드 수정
✅ 필드명 변경 시 → 프론트엔드에서 해당 필드를 사용하는 모든 곳 grep 확인
✅ AI 프롬프트에서 필드 추가 시 → 프론트 타입 정의(types/)도 동시에 업데이트
```

---

## 🟡 카테고리 7: 이모지 사용 금지 위반

### 실수 패턴
- UI 텍스트에 🚗, ✨, 📍 등 이모지를 넣어서 프리미엄 느낌 훼손
- i18n 번역 문자열 안에 이모지를 포함시킴
- 아이콘 대신 이모지로 임시 대체하고 수정 안 함

### 방지 규칙
```
✅ 모든 아이콘은 lucide-react에서 import하여 <IconName /> 컴포넌트로 사용
✅ i18n 번역 문자열에 이모지 포함 금지
✅ 커밋 전 → 소스코드에서 이모지 패턴 grep 검색
```

---

## 🟡 카테고리 8: Vite 빌드 설정 오류

### 실수 패턴
- `vite.config.ts`에서 `base: '/planner/'` 등 서브경로 설정 → 다른 페이지 에셋 404
- CSS 파일에 잘못된 import 경로 사용
- `react-day-picker` 등 새 패키지 설치 후 `package.json`에 기록 안 됨

### 방지 규칙
```
✅ vite.config.ts의 base는 항상 '/' 유지 (SPA이므로)
✅ 새 패키지 설치 시 → npm install 명령어 사용 (수동 추가 금지)
✅ CSS import는 상대 경로 또는 @/ alias 사용
```

---

## 🟡 카테고리 9: 타임아웃 / API 성능

### 실수 패턴
- 6개 AI 에이전트 순차 실행 → Vercel Hobby 60초 한도 초과
- Gemini API 호출에 thinkingBudget 설정 안 해서 응답 시간 폭증
- SSE 스트리밍 미적용 → 사용자에게 빈 화면만 60초 노출

### 방지 규칙
```
✅ Vercel API 함수는 maxDuration 설정 필수 (vercel.json 또는 코드 내)
✅ Gemini 호출 시 thinkingBudget: 0 또는 최소값 설정
✅ 30초 이상 걸리는 작업은 SSE 스트리밍 또는 비동기 처리 적용
✅ 프런트에 로딩 인디케이터 + 단계별 진행률 표시 필수
```

---

## 🔴 카테고리 11: `??` (nullish coalescing) 사용 → pre-commit 차단

> **추가일**: 2026-04-24 (Phase 4 batch 1 작업 중 발생)

### 실수 패턴
- `s.dayIndex ?? 0` 같은 **nullish coalescing (??)** 사용
- pre-commit hook이 `??`를 mojibake 시그니처로 잡아서 commit 거부
- "이건 정상 ES2020 문법인데" 라며 `--no-verify` 우회 시도 가능성

### 왜 막혀있는가
`scripts/git-hooks/pre-commit`은 `??`를 mojibake 패턴으로 검사함 — 과거 사고에서 한국어/이모지가 저장 시 `??`로 치환되어 UI에 그대로 노출된 적이 있어, 차이 없는 두 ASCII `?`를 일률 차단하는 게 안전하기 때문. 일부 레거시 파일(Header/CookieBanner 등)은 allowlist에 등재됨.

### 방지 규칙
```
✅ 신규 코드: `??` 대신 `||` 또는 `typeof x === 'number' ? x : 0` 패턴
✅ falsy 0/'' 보존이 꼭 필요한 경우: 명시적 `x !== undefined && x !== null ? x : fallback`
✅ pre-commit이 막으면 절대 --no-verify 하지 말고 코드 수정으로 통과
✅ 새 파일이 하위 호환을 위해 ?? 필요하면 hook의 allowlist에 추가 PR 제출
```

---

## 🔴 카테고리 12: 파일 크기 Lock 위반

> **추가일**: 2026-04-24 (Phase 4 batch 1 작업 중 발생)

### 실수 패턴
- `api/ai-planner-full.js` (lock 500줄)에 +10줄 추가 → 510줄 → pre-commit reject
- "10줄밖에 안 됐는데?" 라는 안일함
- Lock 파일은 분리 채무가 있다는 신호 — 단 1줄도 추가 부담임

### 방지 규칙
```
✅ 작업 시작 전: 수정 대상 파일이 `coding-rules.md` §6.1 Lock 표에 있는지 확인
✅ Lock 파일에 로직 추가가 필요하면 → 별도 helper 모듈로 빼고 import만 추가
✅ Lock 파일에서 net +0줄로 통과시키는 트릭: 기존 줄에 spread/inline 합치기
✅ Emergency Exception은 진짜 프로덕션 장애에만 (`workflow_report.md` 의무)
```

### 이번 세션 사례
- ai-planner-full.js에 spice/bucket 검증 로직 +10줄 → reject
- → `_food_helper.js`로 `buildFoodPrefSnippet()` 추출 + spread 패턴 (`{...buildFoodPrefSnippet(body)}`)으로 net +0줄 통과
- 결과적으로 코드 응집도가 더 좋아짐 (food validation이 food helper에 모임)

---

## 🔴 카테고리 13: i18n 키 추가 누락 → UI에 영어 폴백 노출

> **추가일**: 2026-04-24 (P10 음식 칩 작업 중 사용자가 스크린샷으로 발견)

### 실수 패턴
- 새 UI 텍스트 추가 시 **컴포넌트에는 fallback 영어**, **i18n에는 등록 안 함**
- `{p.spiceLabel || 'Spice tolerance'}` 패턴이 위험 — 한국어 UI에서 영어 그대로 표시
- 자동 검증으로 안 잡힘 (TypeScript는 fallback이 string이라 OK)
- 사용자가 스크린샷 보내고 나서야 발견

### 방지 규칙 (카테고리 2 보강)
```
✅ 새 UI 키는 4개 언어 (ko/en/ja/zh) 모두 동시 추가 — fallback에만 영어 박지 말 것
✅ 작업 완료 직후 KO 모드로 1회 시각 확인 (영어 폴백 보이면 i18n 누락)
✅ 동적 키 생성 (`p[`spice${key}`]`) 사용 시 모든 가능한 키를 i18n에 등록했는지 체크
✅ Lighthouse i18n / 수동 grep `(p\[?\.|p\.\w+\) \|\| ['"]` 로 누락 패턴 스캔
```

### 이번 세션 사례
P10 spice 4단계 + bucket 8칩 추가 시 컴포넌트에만 영어 fallback 박고 ko/ja/zh 누락 → 한국어 UI에 "Spice tolerance", "Korean BBQ" 영어 그대로 노출. 사용자 스크린샷으로 발견 후 후속 커밋(`3d779ac`)에서 4개 언어 풀 번역 추가.

---

## 🔴 카테고리 14: 사용자 명시 승인 없이 큰 변경 시작

> **추가일**: 2026-04-24 (폼 P6/P9 재구성 시작 직전 사용자 중단)

### 실수 패턴
- "다 진행해" 같은 포괄 지시를 받으면 안전한 작은 변경(i18n fix 등)부터가 아니라 폼 전체 재구성 같은 아키텍처 변경에 즉시 착수
- `antigravity-4phase.md` Phase 1 (계획서 작성 + 승인) 생략
- "auto mode = 자율 = 큰 결정도 자율"이라 오해

### 올바른 패턴 (`coding-workflow.md` §원칙 1 + Phase 1)
```
큰 변경 = 다음 중 하나라도 해당:
  - 새 컴포넌트 ≥1개 + 라우팅 변경
  - 4개 이상 파일 동시 수정
  - 사용자 흐름(UX 시퀀스) 자체 변경
  - DB/Firestore 스키마 신규
  - 1일 이상 추정 작업
→ 계획서 먼저 (수정 파일 + 줄 수 + 결정사항 + 영향 범위) → 승인 → 실행
```

### 방지 규칙
```
✅ "다 진행해" 받아도, 큰 변경은 계획서 먼저 → 승인 후 실행
✅ Auto mode는 작은 결정의 자율이지 아키텍처 결정의 자율이 아님
✅ 계획서가 50줄 이상이면 사용자가 한 줄씩 읽도록 충분히 작아야 함
✅ 사용자가 "바로 실행해" 명시 답하면 그때 진행
```

### 이번 세션 사례
폼 P6 (예약 상태 Step 0) + P9 (도시별 동적 칩) 작업을 사용자 명시 승인 없이 즉시 코딩 시작 → 사용자가 "모든지 먼지 실행하지마 계획서 작성하고 승인받고 진행해" 명시 중단 → 계획서 작성 후 "바로 실행해" 받고 재개.

---

## 🟡 카테고리 15: 서드파티 자동화에 대한 부정확한 안내

> **추가일**: 2026-04-24 (Netlify preview URL 안내 사고)

### 실수 패턴
- Vercel preview가 401 (deployment protection)으로 막히자 **"Netlify preview가 공개라 거기서 테스트하세요"** 라고 안내
- 사용자: "우리 Netlify 안 쓰는데?" → 사실 확인 결과 GitHub App이 자동으로 Netlify deploy 만들고 있었음
- 프로젝트 실제 배포 환경(Vercel)이 아닌 부수적 통합(Netlify)을 권장한 셈

### 방지 규칙
```
✅ 프리뷰 URL 안내 전 → 어떤 플랫폼인지 + 사용자가 그 플랫폼을 실제 사용 중인지 확인
✅ "이 프로젝트는 X 배포만 사용" 같은 명시 정보(`project-context.md`)를 먼저 참조
✅ 막힌 인증 우회보다 → 인증 해제 방법 또는 사용자에게 직접 접속 요청
✅ 이상한 URL 토큰(임의 단어 조합 *.netlify.app 등) 보이면 의심하고 확인
```

### 이번 세션 사례
PR #6에 Vercel + Netlify 둘 다 자동 배포됨 (Netlify는 잊혀진 통합). 사용자에게 Netlify URL을 "스모크 테스트용"으로 안내 → 사용자가 즉시 "우리 Netlify 안 쓰는데?" 라고 지적하여 정정.

---

## 🟡 카테고리 10: 배포 전 검증 누락

### 실수 패턴
- 로컬 빌드 성공 후 바로 배포 → Vercel에서 환경변수 미설정으로 런타임 에러
- 배포 후 라이브 사이트 확인 안 함 → 고객이 에러 페이지를 볼 수 있음
- git commit 메시지에 변경사항 미기술

### 방지 규칙
```
✅ 배포 전 → quality-check.md 워크플로우 실행 (빌드 5회 + 번역 + 색상 검수)
✅ 배포 후 → cocotripkr.com 라이브 접속하여 핵심 흐름 수동 테스트
✅ git commit 시 → feat: / fix: / refactor: 접두사 + 변경사항 명확히 기술
✅ "배포해"라는 지시가 있을 때만 배포 진행
```

---

## 📋 작업 전 Quick Checklist (복사용)

```
[ ] 수정 대상 파일이 모바일 전용인지 PC 전용인지 확인했는가?
[ ] 수정 대상 파일이 coding-rules §6.1 Lock 표에 있는지 확인했는가? (cat 12)
[ ] 새 텍스트를 추가했다면 4개 언어(ko/en/ja/zh) 모두 추가했는가? (fallback 영어 박지 마, cat 13)
[ ] 큰 변경(컴포넌트 추가 + 라우팅 + 4파일+) 인 경우 계획서 작성 후 사용자 승인 받았는가? (cat 14)
[ ] 이모지를 사용하지 않고 lucide-react 아이콘을 사용했는가?
[ ] `??` 연산자를 신규 코드에 사용하지 않았는가? (cat 11, pre-commit이 차단)
[ ] import한 모든 변수/컴포넌트를 실제로 사용하고 있는가?
[ ] 가격을 변경했다면 charterPricing.ts와 PayPal/UI 동기화했는가?
[ ] API 필드명을 변경했다면 프론트-백엔드 양쪽 모두 수정했는가?
[ ] 프리뷰 URL 안내 시 → 그 플랫폼을 실제 사용 중인지 확인했는가? (cat 15)
[ ] npm run build가 에러 없이 통과하는가?
[ ] PC(1200px+)와 모바일(375px)에서 모두 정상 렌더링되는가?
[ ] 작업 완료 후 KO 모드로 1회 시각 확인했는가? (영어 fallback 노출 검출)
```
