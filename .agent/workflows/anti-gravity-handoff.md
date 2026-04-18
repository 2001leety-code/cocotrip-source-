---
description: Antigravity 에이전트에게 작업 위임 시 프롬프트 맨 앞에 붙이는 "출입금지" 지시문
priority: MAX — 이 문서 위반 시 작업 즉시 중단 + revert
---

# 🚫 Antigravity Hand-off: 절대 수정 금지 영역 (DO NOT TOUCH)

> **사용법**: Antigravity에 작업 프롬프트 줄 때 이 문서 전체를 **맨 앞에** 붙여넣기.
> 각 섹션의 금지 사항은 누적됨 (하나만 위반해도 전체 작업 reject).

---

## 배경: 왜 이 문서가 존재하는가

**사고 기록** (2026-04 기준):
- PDF 백지 사고 3회 (`833635b` → `30aed45` → `586b149` 이후 재발)
- UI에 `??Grilled chicken` 등 리터럴 `??` 노출 사고 1회
- 원인: 에디터/AI가 파일을 저장할 때 UTF-8 이모지/한글을 `??`로 치환 (mojibake)
- **파일을 많이 만질수록 썩는 구조** → 동일 영역 반복 수정 금지

---

## 1. 파일 단위 수정 금지 (Lock)

### 🔴 `src/pages/PlanDetailPage.tsx` — 수정 금지 (현재 1144줄)
- `coding-rules.md` §6: "1000줄 이상 파일 수정 금지 → 먼저 분리"
- 이 파일은 **분리 태스크가 완료되기 전까지** 어떤 이유로도 수정 금지
- 버그 발견 시: 수정하지 말고 사용자에게 보고 → 분리 후 수정
- **예외**: `Emergency Exception` (`antigravity-4phase.md`) 발동 시만 가능, 48시간 내 보고서 의무

### 🔴 `src/pages/PlannerPage.tsx` — 신규 기능 추가 금지 (현재 1991줄)
- P0 분리 대상. 기존 버그 픽스만 허용, 기능 추가 금지.
- 기능 추가는 분리 완료 후에만.

### 🔴 `api/ai-planner-full.js` — 프롬프트 이외 수정 금지 (현재 1273줄)
- P1 분리 대상. `buildSystemPrompt` 내부 텍스트 튜닝만 허용.
- 로직(`validateResponse`, DB matcher 등) 수정 금지 → 분리 후에만.

---

## 2. 함수/영역 단위 수정 금지

### 🔴 `src/pages/PlanDetailPage.tsx` 내부 특정 영역
분리 전이라도 아래 영역은 특히 민감함:

- **L93-138** (auto-translate useEffect):
  - 의존성 배열 `[language, planLoaded]` 유지. `plan?.itinerary` 같은 객체 identity로 교체 금지.
  - `originalItineraryRef` 로직 건드리지 말 것 (원본 복원 메커니즘).
- **L155-344** (`handleDownloadPDF`):
  - `container.style.cssText`의 font-family 체인 **한 글자도 수정 금지**:
    ```
    "Segoe UI","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",
    "Hiragino Sans","Noto Sans JP","Microsoft JhengHei",
    "Microsoft YaHei","Noto Sans SC",system-ui,sans-serif
    ```
  - `position:absolute;top:0;left:0` 유지. `fixed` / `left:-9999px` / `display:none` 금지.
  - PDF HTML 템플릿 리터럴은 **순수 ASCII만 사용**. 이모지/한글 삽입 금지 (mojibake 재발 원인).
- **L662-670** (PDF 다운로드 버튼):
  - `disabled={isPdfGenerating || isTranslating}` 유지.

### 🔴 `api/translate-plan.js`
- **CommonJS 포맷 유지** (`const { ... } = require(...)` + `module.exports`).
- ESM(`import`/`export`)으로 변환 금지 → Vercel serverless 빌드 깨짐.
- `TRANSLATE_FIELDS` / `TRANSLATE_ITEM_FIELDS` 배열에서 필드 이름 제거 금지.

### 🔴 `src/hooks/useLanguage.ts`
- `STORAGE_KEY = 'cocotrip_lang'` 값 변경 금지 (기존 사용자 언어 선택 손실).
- storage 이벤트 리스너 + `<html lang>` 동기화 이펙트 제거 금지.
- localStorage 폴백 로직 제거 금지.

### 🔴 `api/_food_index.json`
- 삭제 / `.gitignore` 추가 / 파일명 변경 전부 금지.
- 1.2MB 파일이어서 커지다 보이지만 삭제 시 백엔드 DB matcher 전체 죽음.

### 🔴 `vercel.json`
- `rewrites` 블록에 `/api/(.*) → /api/$1` 같은 자가참조 rewrite 추가 금지.
- 현재는 SPA rewrite `/((?!api/).*) → /index.html` 한 줄만 존재. 이 상태 유지.

---

## 3. 문자 인코딩 안전 (MOJIBAKE 방지)

### 3-A. 이모지 사용 금지
- `coding-rules.md` §1: "Emoji 사용 금지 — 모든 아이콘은 `lucide-react`"
- **특히 금지**: 템플릿 리터럴/문자열 내부에 이모지 (`✈️`, `📍`, `📝`, `🔹` 등)
- 이유: 에디터 저장 시 인코딩 실수 → `?�️`, `??` 로 치환 → UI 깨짐 + PDF 백지

### 3-B. 주석 한국어 사용 제한
- 박스 주석 (`// ─── ... ───`) 및 이모지 prefix 주석 신규 추가 금지
- 기존 `// ?�?�` 형태의 이미 깨진 주석은 **그대로 두기** (지우면 또 저장하면서 악화됨)
- 주석이 필요하면 **순수 ASCII 영문**으로만 작성

### 3-C. 문자열 리터럴 ASCII 우선
- PDF HTML, 이메일 템플릿 등 **렌더 결과물에 포함되는 문자열**은 ASCII 우선
- 사용자-facing 텍스트는 `src/i18n/index.ts`의 i18n 키로 처리 (4개 언어)
- 코드 내부 상수/라벨은 영문

### 3-D. 저장 설정 체크리스트 (매 편집마다)
- 편집기 인코딩: **UTF-8 (BOM 없음)** 고정
- 줄 끝: LF 또는 CRLF 통일 (프로젝트 기존 값 유지)
- 저장 직후 검증:
  ```bash
  node -e "const f=require('fs').readFileSync('<수정한 파일>','utf8'); console.log(/\?\?/.test(f) ? 'MOJIBAKE DETECTED' : 'CLEAN');"
  npx tsc --noEmit
  ```
- 둘 중 하나라도 실패 → 커밋 금지 → 원인 조사 후 원복 고려

---

## 4. 비즈니스 로직 절대 금지 (`CLAUDE.md §B` 요약)

1. **`api/_food_index.json` 삭제 / `.gitignore` 금지** → DB matcher silent fail
2. **stop 필드 스키마 되돌리기 금지** (`name_ko`/`name_en`/`tip_en` 금지, `name`/`display_name`/`tip` 유지)
3. **PDF 컨테이너 `left:-9999px` / `display:none` 금지** → html2canvas 백지
4. **Gemini 프롬프트에서 `"verified": true` 규칙 제거 금지**

---

## 5. 변경 시 필수 검증 (모든 수정 공통)

```bash
# 1. 타입 체크
npx tsc --noEmit
# → exit 0 필수

# 2. Mojibake 스캔 (수정한 파일별로)
node -e "const f=require('fs').readFileSync(process.argv[1],'utf8'); console.log(/\?\?/.test(f)||/\uFFFD/.test(f) ? 'BAD' : 'CLEAN');" <file>
# → CLEAN 필수

# 3. 프롬프트 수정 시
node scripts/validate-planner.js
# → 기준치 통과 필수
```

---

## 6. 위반 시 절차

1. Antigravity가 위반 감지 → **즉시 작업 중단**
2. `workflow_report.md` (또는 `docs/reports/incident-<date>.md`) 작성
3. 변경 내용 revert 후 사용자에게 보고
4. 재발 방지책 이 문서에 추가

---

## 변경 이력

| 날짜 | 변경자 | 내용 |
|------|--------|------|
| 2026-04-17 | Claude + user | 최초 작성 (PDF 백지 3회 + mojibake 사고 후) |
