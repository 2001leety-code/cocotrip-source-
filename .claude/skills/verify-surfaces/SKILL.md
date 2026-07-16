---
name: verify-surfaces
description: CocoTrip 웹 플래너 변경을 머지 전 정밀 검증한다 — 빌드 + 오프라인 플랜 하네스 + (필요 시) 표면 간(cross-surface) read-only 감사를 돌리고 PASS/gap을 보고. "정밀검사", "verify the change", "검증해", "전 표면 검증", plan-detail/PDF/이메일/공유 변경 머지 전 호출. 라이브 방문자 수 확인용 아님 — CODE 정확성 검증.
---

# 정밀 cross-surface 검증 (CocoTrip 웹 플래너)

"빌드 통과"는 검증이 아니다. 플랜 페이지는 스크린 React / PDF html-string / 이메일 / 공유·OG / markdown export가 **서로 다른 코드 경로**로 렌더된다 — 스크린만 고치면 나머지가 조용히 빠진다.

## 저장소 루트 (하드코딩 금지)
- 이 스킬은 CocoTrip **웹 플래너** 저장소 전용이다.
- 루트를 실행 시 구한다: `git -C <cwd> rev-parse --show-toplevel`.
- 그 루트에 `api/ai-planner-full.js`가 있어야 웹 플래너 repo다. 없으면(상위 에이전시 폴더 등에서 시작했을 수 있음) 웹 플래너 repo로 이동한 뒤 다시 루트를 구한다.
- 이후 모든 git/npm은 그 루트에서(`git -C "<root>"` 또는 루트로 이동). 경로에 한글이 있으니 파일 도구는 절대경로 우선.

## 모드
### 빠른 검증 (작은 변경 — 로직 1~2줄, 스타일, 카피)
1. **Build gate:** 루트에서 `npm run build`(= `tsc -b && vite build`) green. 새/변경 `api/*.js`는 `node --check`.
2. **Render gate:** `npm run plan:test`(오프라인 하네스, 키·비용 0). unhandled throw 없고 내장 체크 통과(특히 multi-city KTX bookend). 요약의 ❌ 플래그 확인.
3. 시각 변경이면 → Skill `verify-web`(dev 실물 확인, 읽기전용).
→ 여기까지면 충분한 변경은 "빠른 검증으로 충분"이라고 명시하고 끝낸다.

### 전체 검증 (plan-detail / PDF / email / share·OG / 돈·식이 코드)
위 1~2 + 아래 표면 간 감사:
3. **Cross-surface audit (read-only):** 지원 워크플로우를 scriptPath로 호출한다:
   ```
   Workflow({
     scriptPath: '<root>/.claude/skills/verify-surfaces/cross-surface-audit.js',
     args: { repoRoot: '<root>', change: '<빠른 검증 1단계에서 파악한 변경 내용>' }
   })
   ```
   PDF / email / share-OG / edit-mode / undefined-sweep / component-robustness 표면에 read-only Explore 에이전트를 펼쳐 gap 목록(severity + file:line + fix)을 반환한다. 워크플로우와 스킬은 같은 폴더에 있어 어디서 시작해도 루트만 구하면 호출된다.
4. 시각 변경이면 `verify-web` 병행.

## 보고 (검증한 것 vs 못한 것 분리)
- 단일 PASS/gap 요약: build ✅/❌, 하네스 ✅/❌(+어떤 체크), 감사 findings를 severity로 그룹(🔴 머지 전 수정 / 🟡 gap / 🟢 parity / ✅ 안전확인). 🔴/🟡엔 구체적 fix.
- **미검증을 명확히 분리한다.** 외부 의존 표면(NCP/Google static map, 크롤러 OG, 라이브 PayPal/transit, 실기기 PWA)은 오프라인으로 증명 불가 → "미검증 — 라이브 확인 필요"로 표기하고 증명 전까지 feature-flag OFF 유지. "verified"를 과장하지 않는다.

## 규칙
- **검증-not-parrot:** 실제 build/하네스/감사 출력에서 단정. 메모리나 "괜찮을 것"에서 X.
- **read-only 기본:** 이 스킬과 감사 워크플로우는 코드를 수정하지 않는다. 수정이 필요하면 gap으로 보고하고, 실제 수정은 사용자 요청/`verify-web --fix` 경로에서.
- **right-size:** 전체 감사는 ~6 에이전트 — 실제 cross-surface 변경에 적합. 한 줄 tweak엔 빠른 검증이면 충분(그렇게 말한다).
- **돈·식이 안전 코드**(PayPal, halal/vegan/allergy)는 diff가 작아도 전체 감사 + 자동수정 금지. → Skill `cocotrip-money-safety`, `.claude/rules/dietary-safety.md`.
