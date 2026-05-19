## Summary

<!-- 1-3 bullet points: what changed + why -->

## 분류 (해당 시)

<!-- 이 PR 이 prod incident / 메모리 P-pattern 의 fix 라면 해당 카테고리 체크.
     자율 검증 사각지대 메타-rule: 매 fix 마다 해당 카테고리의 자동 게이트가
     실재하는지 확인. 없으면 후속 PR 에서 도입. -->

- [ ] **L1: 코드 grep 패턴** (`scripts/lint-mistake-patterns.mjs`) — 정적으로 잡힘 ✅ 기존 게이트
- [ ] **L2: 외부 API contract** (`scripts/preflight-sdk-urls.mjs` + `pr-sdk-preflight.yml`) — third-party SDK fetch 200 검증 ✅ 기존 게이트
- [ ] **L3: PDF 런타임** (PDF golden test, 후속 — Vercel preview + Playwright + pdf-parse) — ⏳ 미도입
- [ ] **L4: 시각 회귀 / 모바일 viewport** (Playwright screenshot diff, 후속) — ⏳ 미도입
- [ ] **L5: E2E user journey** (i18n smoke 부분 cover, voucher/payment regression 부분 cover) — △ 일부

**본 fix 의 회귀 카테고리는 위 L? 입니다.**

**해당 카테고리 자동 게이트 보강 여부:**
- [ ] 새 회귀 assertion 추가 (test/unit/integration)
- [ ] mistake-lint 새 rule 추가 (정적 grep 패턴)
- [ ] manifest 또는 fixture 업데이트 (preflight / golden)
- [ ] 메모리 P-NN 추가 ([P-pattern 인덱스](https://github.com/2001leety-code/cocotrip-source-/wiki) 참조)
- [ ] 카테고리 게이트 자체 부재 — 후속 PR 로 도입 (이슈/태스크 링크: ...)

## Test plan

- [ ] ...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
