# Mistake Pattern Lint — `scripts/lint-mistake-patterns.mjs`

CocoTrip 오답노트의 반복 실수 패턴을 PR diff 에 자동 lint. PR 머지 전 차단 (자율 검증 L1 게이트).

## 무엇

- `scripts/lint-mistake-patterns.mjs` 가 base..HEAD diff 를 스캔해 알려진 함정 패턴을 검출
- `.github/workflows/pr-mistake-lint.yml` 이 모든 PR 에서 자동 실행 + 결과를 PR 코멘트로 첨부
- 위반 1건 이상이면 exit 1 → PR 체크 fail → 머지 차단

## 왜

운영자 frustration (2026-05-12): 메모리 `feedback_mistake_log.md` (P1-P27) + `feedback_pdf_korean_lessons.md` + `feedback_proactive_audit.md` 가 있지만 **매 PR 수동 참조라 5/2~5/12 한 달 내내 같은 함정 반복**. 자동 lint 로 영구 차단.

## 현재 룰 (7개)

| 규칙 | 메모리 출처 | 위반 조건 |
|---|---|---|
| `P1_dateInclusiveExclusive` | P10 + P1 | `addDays`/`diffDays`/`endDate` 등 헬퍼 변경 시 `inclusive`/`exclusive` 컨벤션 주석 없음 |
| `P3_i18nKeyParity` | P2 | 신규 `t('NEW_KEY')` 가 ko/en/ja/zh 4 locale 중 일부에만 존재 |
| `P5_foodIndexProtection` | CLAUDE.md B-1 + P5 | `api/_food_index.json` 삭제 · rename · `.gitignore` 등록 |
| `P7_pdfPositionAbsolute` | CLAUDE.md B-3 + PDF 가이드 | `pdfGenerator.ts` 에 `display:none` / `left:-9999` / `position:absolute + left:0` 부재 (주석 stripping 후 검사) |
| `PDF_KOREAN_FONT` | feedback_pdf_korean_lessons 가이드 1/3 | Noto Sans KR 로딩에 `display=swap` / `fonts.ready` 만 신뢰하고 글리프 측정 부재 / CJK fallback chain 부재 |
| `STOP_SCHEMA` | CLAUDE.md B-2 + C | `stop.name_ko` / `name_en` / `tip_en` 신규 reference (base 대비 카운트 증가) |
| `SURFACE_AUDIT` | feedback_proactive_audit.md | 도시/공항/모드/dietary 키워드 신규 추가했는데 wizard/zone/airport/PDF/email 5 surface 대부분 미변경 (경고만, exit 0) |

## 실행 방법

```bash
# 로컬 PR 머지 전 확인
node scripts/lint-mistake-patterns.mjs                 # base = origin/main
node scripts/lint-mistake-patterns.mjs origin/develop  # base 명시

# 인위 위반 6 케이스 검증 (CI 가 항상 정상 동작하는지 확인)
node scripts/lint-mistake-patterns.mjs --self-test
```

CI 는 `pull_request` (opened, synchronize, reopened) 이벤트에 자동 실행.

## 새 패턴 추가 — 4 step

1. **메모리 등록**
   - `C:\Users\<user>\.claude\projects\E--ai-------\memory\feedback_mistake_log.md` 의 `## 패턴 P-NN` 섹션에 새 카테고리 추가 (증상 / 원인 / 교훈 / 예방).
2. **룰 함수 추가**
   - `scripts/lint-mistake-patterns.mjs` 에 `function P-NN_xxx({ changed, base }) { ... }` 작성. `fail(rule, msg, hint)` 또는 `warn(rule, msg)` 호출.
   - `RULES` 배열에 `['P-NN_xxx', P-NN_xxx]` 추가.
3. **self-test 케이스 추가**
   - `runSelfTest()` 의 `cases` 배열에 인위 위반 1건 추가 (`base` / `head` 파일 맵 + `expectRule`).
   - `node scripts/lint-mistake-patterns.mjs --self-test` 통과 확인.
4. **README 표 업데이트**
   - 이 파일의 "현재 룰" 표에 새 행 추가.

## 출력 형식

- `[OK]   R-NAME: 메시지` — stdout, 정상 통과
- `[WARN] R-NAME: 메시지` — stderr, 경고만 (exit code 영향 X)
- `[LINT] R-NAME: 메시지` — stderr, 위반 (exit 1 차단)

위반은 PR 코멘트에 자동 첨부 — workflow `pr-mistake-lint.yml` 가 `peter-evans/create-or-update-comment@v4` 로 게시.

## 운영 노트

- **거짓 양성 줄이기**: regex 가 comment 안 텍스트도 잡으면 P7 처럼 `stripComments()` 적용. 검출 패턴 강화보다 거짓 양성 우선 제거.
- **base 시점 비교 필수**: STOP_SCHEMA / SURFACE_AUDIT 처럼 "신규 reference" 를 잡는 룰은 `getBaseFileContent()` 로 base 대비 증가만 잡아 legacy 유지 코드 보호.
- **메모리 동기화**: 룰 추가 시 메모리 P-NN 도 같이 추가해야 미래 세션이 패턴 자체를 인지함 (lint 는 "차단" 만 담당, "이해" 는 메모리 담당).
