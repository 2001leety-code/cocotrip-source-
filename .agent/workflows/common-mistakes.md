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
[ ] 새 텍스트를 추가했다면 4개 언어(ko/en/ja/zh) 모두 추가했는가?
[ ] 이모지를 사용하지 않고 lucide-react 아이콘을 사용했는가?
[ ] import한 모든 변수/컴포넌트를 실제로 사용하고 있는가?
[ ] 가격을 변경했다면 charterPricing.ts와 PayPal/UI 동기화했는가?
[ ] API 필드명을 변경했다면 프론트-백엔드 양쪽 모두 수정했는가?
[ ] npm run build가 에러 없이 통과하는가?
[ ] PC(1200px+)와 모바일(375px)에서 모두 정상 렌더링되는가?
```
