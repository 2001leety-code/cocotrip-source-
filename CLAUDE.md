# CocoTrip AI Planner — Project Rules

CocoTripKR — 한국 프라이빗 투어 예약 + 유료 AI 플래너. 프로덕션: https://cocotripkr.com (Vercel).
React/Vite 프론트 + `api/` serverless 백엔드 + Firestore.

이 파일은 **항상 로드되는 최소 규칙**만 담는다. 상세 절차는 `.claude/rules/`·관련 Skill 참조.
개인 테스트 계정 등 비공유 값은 gitignore된 `CLAUDE.local.md`에 둔다(있으면).

---

## 🔴 절대 금지 (어기면 prod 장애)

1. **`api/_food_index.json` 삭제·`.gitignore` 추가 금지** — DB matcher 전체 silent fail(에러 없이 매칭 0건).
2. **stop 필드를 `name_ko`/`name_en`/`tip_en`으로 되돌리지 말 것** — Gemini는 `name`/`display_name`/`tip` 반환. 불일치 시 사용자에게 빈칸. (상세 `.claude/rules/planner-schema.md`)
3. **PDF 컨테이너를 `left:-9999px`/`display:none`으로 숨기지 말 것** — html2canvas는 화면 밖 요소 렌더 불가 → PDF 백지. 정답 = `position:absolute; left:0` + overlay로 가림 + `document.fonts.ready` 대기.
4. **Gemini 프롬프트의 `"verified": true` 규칙 제거 금지.**
   - ⚠️ `verified: true`는 "식당이 DB에 존재"라는 뜻일 뿐 — **할랄·비건·알레르기 안전을 보장하지 않는다.**

## 🔴 최상위 안전 경고

- **결제·돈:** 표시가 = 청구가, 서버가 최종 검증, 멱등성 필수. AI는 실결제·실환불·실충전 금지. → Skill `cocotrip-money-safety`.
- **식이(할랄/비건/알레르기):** 잘못 처리 시 고객 건강 위험. **누락 ≠ "없음".** → `.claude/rules/dietary-safety.md`.
- **환경변수:** `FIREBASE_PRIVATE_KEY`·`NCP_CLIENT_ID` 등 손상 시 prod 인증 사망. → `.claude/rules/env-safety.md`.

---

## 핵심 구조 (SSOT — 개수·줄번호는 코드가 진실, 여기 박제 금지)

- **AI 플래너 진입점:** `api/ai-planner-full.js` — request shaping + 응답 작성 + post-response side-effect. 실제 orchestration은 `api/_ai_core/handlerCore.js`. 세부 로직은 `api/_ai_core/*` 모듈로 분해됨(모듈명으로 탐색, 줄번호 참조 금지).
- **Gemini 모델:** 하나로 단정 금지. SSOT = `api/_ai_core/geminiModelResolver.js` + env(`GEMINI_MODEL_OVERRIDE`, `GEMINI_{ROLE}_MODEL`). 모델 ID·temperature는 코드가 진실 — 여기 수치 박제 금지.
- **식당 DB:** `api/_food_index.json` (재생성 = `scripts/build-food-index.js`). `api/_food_helper.js`가 프롬프트에 주입.
- **프론트 플랜 상세:** `src/pages/PlanDetailPage/` (index + `components/` + `pdfGenerator.ts`). 타입 = `src/types/plan.ts`.
- **필드 참조 시 신·구 폴백 유지** (Firestore 기존 플랜 호환). → `.claude/rules/planner-schema.md`.

## 검증 (변경 시)

```bash
npm run build        # tsc -b && vite build — 타입검증은 이것만 신뢰(tsc --noEmit는 solution tsconfig라 no-op)
npm run test:unit    # vitest
npm run plan:test    # 오프라인 플랜 하네스 (키·비용 0)
npm run verify:all   # types + mojibake + unit
```

표면별(스크린/PDF/이메일/공유·OG) 정밀 검증 → Skill `verify-web`·`verify-surfaces`(규모별 빠른/전체 모드).

**미검증은 미검증이라 보고한다.** 외부 인증(구글 로그인)·실결제(PayPal)·크롤러 OG·실기기 PWA는 오프라인으로 증명 불가 → "미검증 — 운영자 확인 필요"로 분리. "됐다 가정" 금지.

**배포 전 체크:**
- [ ] 프롬프트 필드명 `name`/`display_name`/`tip`만 (`name_ko`/`name_en`/`tip_en` ❌)
- [ ] `api/_food_index.json` 안 지웠나
- [ ] PDF 컨테이너 `position:absolute; left:0` 유지
- [ ] 새 사용자노출 텍스트 = ko/en/ja/zh 동시 추가
- [ ] 모바일 수정이 데스크톱 그리드 안 깨뜨리나

---

## ⚠️ 승인 경계 (실행 전 가정 명시 + 확인)

프로덕션·결제·인증·보안·파괴적 데이터 변경·비가역 동작(배포·`git push`·merge·secret rotation·prod API 호출)은 **사용자가 현재 작업에서 명시적으로 요청**했을 때만 수행한다. 그 외엔 멈추고 확인.
검증만 요청받았으면 코드를 자동 수정하지 않는다(특히 돈·식이·인증 코드).
