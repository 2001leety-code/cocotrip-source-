# AI 개발 도구 — 외부 GitHub 도구 4종 적용 현황

2026-10-07, 운영자 요청("인스타 게시물에 나온 깃허브 도구 4개 다 적용")으로 검토하고 적용한 결과다.
각 도구의 원본 소스를 읽어 설치 경로·텔레메트리·쓰는 파일을 확인했고, CocoTrip 규칙(CLAUDE.md 승인 경계, pre-commit 가드, Vercel 비용)과 충돌하는 부분은 걸러서 넣었다.

> **공통 원칙:** 아래 도구의 결과는 **힌트**다. 편집 전에는 실제 파일을 직접 읽고, 검증은 지금처럼 `npm run build` · `npm run test:unit` · `npm run plan:test` 로 한다. 코드 그래프나 서브에이전트가 "괜찮다"고 해도 그것이 검증은 아니다.

## 한눈에 보기

| 도구 (인스타 설명) | 원본 · 라이선스 | CocoTrip 에 적용한 방식 | 쓰는 법 | 상세 |
|---|---|---|---|---|
| **Agency Agents** — "230여 명의 AI 직원" | [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) · MIT | 282개 중 CocoTrip 업무에 맞는 **16개만** 골라 `.claude/agents/` 에 프로젝트 서브에이전트로 넣었다. 전부 CocoTrip 가드레일과 최소 권한 `tools` 를 넣어 고쳐 썼다. | Claude Code 가 설명을 보고 자동 위임한다. 직접 부르려면 "code-reviewer 에이전트로 이 diff 봐줘"처럼 요청한다. `/agents` 에서 목록을 본다. | [PROVENANCE](third-party/agency-agents/PROVENANCE.md) |
| **Graft** — "폴더를 지도처럼 시각화" | [trailhq/Graft](https://github.com/trailhq/Graft) (`@nanonets/graft`) · MIT | 버전을 고정한 래퍼 `scripts/graft.mjs` 를 통해 **읽기 전용 코드 지도·영향 범위 분석만** 쓴다. 텔레메트리는 끈다. `graft init`(전역 설정·훅 주입)은 차단했다. | `npm run graph:build` 다음 `graph:map` / `graph:impact` / `graph:viz` | [AI-TOOL-GRAFT.md](AI-TOOL-GRAFT.md) |
| **Codebase Memory MCP** — "코드를 통째로 기억" | [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) · MIT | 프로젝트 MCP 서버(`.mcp.json`)로 등록했다. 런처 `scripts/codebase-memory-mcp.mjs` 가 **고정 버전 바이너리를 SHA-256 검증 후** 사용자 캐시에 설치한다. 공식 설치 스크립트(전역 설정·셸 rc 수정)는 쓰지 않는다. | (권장) `npm run cbm:setup` 으로 미리 설치 → Claude Code 첫 실행 때 프로젝트 MCP 승인 → "이 프로젝트 index 해줘" → `search_graph` / `trace_path` / `detect_changes` | [AI-TOOL-CODEBASE-MEMORY-MCP.md](AI-TOOL-CODEBASE-MEMORY-MCP.md) |
| **OpenMontage** — "주제만 주면 영상 자동 제작" | [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) · **AGPL-3.0** | 레포에 넣지 않는다(AGPL·Python·용량). 레포 **밖** 별도 작업공간에서 쓰고, CocoTrip 쪽에는 실제 투어 데이터를 영상 브리프로 뽑는 생성기만 넣었다. | `npm run marketing:video-brief -- --tour <slug>` → 런북 절차 | [MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md](MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md) |

## 서브에이전트 16개 (`.claude/agents/`)

모든 파일 앞에 **CocoTrip 가드레일 블록**이 있다. 가드레일 내용: 절대 금지 4개, 배포·push·merge·secret·prod 호출·실결제 금지, 식이 안전, ko/en/ja/zh 동시, pre-commit 가드, 미검증 보고. 가드레일이 본문보다 우선한다.

| 에이전트 | 모드 | tools | 언제 |
|---|---|---|---|
| `code-reviewer` | 읽기 전용 | Read, Grep, Glob, Bash | PR·diff 리뷰. 배포 전 체크, 표면 간 영향, PR 템플릿 영향 분석 초안 |
| `payments-reviewer` | 읽기 전용 | Read, Grep, Glob, Bash | PayPal·쿠폰·가격·MOOD 충전·정산 diff. `cocotrip-money-safety` 를 먼저 읽는다 |
| `ai-code-security-auditor` | 읽기 전용 | Read, Grep, Glob, Bash | firestore/storage rules, `VITE_` 노출, 어드민 인증, Gemini 프롬프트 인젝션, SSRF. 유출은 보고만 한다 |
| `codebase-archaeologist` | 읽기 전용 | Read, Grep, Glob, Bash | 문서-코드 드리프트, 뒤집힌 폴백, 중복 로직. 레거시 폴백은 삭제 대상이 아니다 |
| `minimal-change-engineer` | 구현 | Read, Grep, Glob, Edit, Write, Bash | 최소 diff 버그픽스. 범위 밖은 후속 항목으로 보고 |
| `i18n-engineer` | 구현 | Read, Grep, Glob, Edit, Write, Bash | 사용자 노출 텍스트·locale 키·숫자/통화 포맷 (기존 `src/i18n` 안에서) |
| `planner-prompt-engineer` | 구현 | Read, Grep, Glob, Edit, Write, Bash | `api/_ai_core` 플래너 프롬프트·스키마. 검증은 오프라인 `plan:test`. 유료 Gemini 호출은 승인 필요 |
| `e2e-test-engineer` | 구현 | Read, Grep, Glob, Edit, Write, Bash | Playwright·vitest 작성, flaky 원인 분석. prod·실 PayPal·실 Firebase 금지. dev 서버도 `/api` 를 운영으로 proxy 하므로 `/api` mock 필수 |
| `accessibility-auditor` | 읽기 전용 | Read, Grep, Glob, Bash | WCAG 2.2 AA (예약·플래너·페이월·어드민) |
| `persona-walkthrough` | 읽기 전용 | Read, Grep, Glob | 일본·중국·미국·무슬림·재외동포 여행자 시뮬레이션 (실사용자 조사가 아님) |
| `performance-benchmarker` | 읽기 전용 | Read, Grep, Glob, Bash | size-limit, 번들 청크, PWA precache, Lighthouse 설정. 로컬 측정만 |
| `seo-specialist` | 구현 | Read, Grep, Glob, Edit, Write, WebSearch, WebFetch | 메타/OG, canonical, JSON-LD, sitemap·robots 메타, prerender. llms.txt·AI 크롤러 규칙은 `aeo-foundations`. IndexNow 실행 금지 |
| `aeo-foundations` | 구현 | Read, Grep, Glob, Edit, Write, WebSearch, WebFetch | `public/llms.txt`, AI 크롤러 정책(허용/차단 결정은 운영자) |
| `instagram-curator` | 초안만 | Read, Grep, Glob, WebSearch, WebFetch | 릴스·피드 기획, 캡션 초안. 게시는 하지 않는다 |
| `xiaohongshu-specialist` | 초안만 | Read, Grep, Glob, WebSearch, WebFetch | 샤오홍슈 노트 초안 (간체 zh). 게시는 하지 않는다 |
| `guest-reply-drafter` | 초안만 | Read, Grep, Glob | 고객 문의 답장 초안 (ko/en/ja/zh). 환불·할인·보상 약속 금지, 운영자에게 에스컬레이션 |

- **MCP 도구는 어떤 에이전트에도 주지 않았다.** 이 환경의 MCP 도구(Vercel 배포, GitHub merge, Gmail 발송 등)를 서브에이전트가 상속하지 않게 하기 위해서다.
- "읽기 전용" 에이전트의 Bash 는 `git diff/log/show` 와 로컬 검증용이다. 이 제한은 프롬프트와 Claude Code 권한 프롬프트로 지켜지며, 기술적으로 막혀 있지는 않다.
- 에이전트 설명(description)은 세션마다 시스템 프롬프트에 들어간다. 16개 기준 약 4천 자 정도다. 282개 전체를 넣으면 약 7만 자가 매 세션에 붙는다. 이 비용 때문에 선별했다.

## 일부러 하지 않은 것

| 하지 않은 것 | 이유 |
|---|---|
| agency-agents 282개 전체 설치, 업스트림 `install.sh` 실행 | 매 세션 약 17K 토큰 추가. 265개 에이전트가 `tools` 줄이 없어 Bash·모든 MCP 를 상속한다. 결제 실행·자동 게시("Zero Confirmation") 에이전트가 섞여 있다. |
| `graft init` (어떤 옵션이든) | `~/.claude/settings.json`·`~/.claude.json` 전역 쓰기, 레포 `.claude/settings.json` 훅 4종 + 광범위한 `permissions.allow` (`graft trail push` 업로드까지 무승인). 새 clone 에서 전역 쓰기가 자동으로 다시 일어난다. 모든 프롬프트에 graft 결과가 주입된다. |
| codebase-memory-mcp 공식 설치(`install.sh` 원라이너, 바이너리 `install`/`update`) | `releases/latest` 를 같은 릴리스의 checksums 로만 검증한다(고정 아님). 사용자 `~/.claude.json`·훅·스킬·에이전트, 셸 rc PATH, Claude Code 를 포함한 에이전트 클라이언트 설정 최대 45곳(업스트림 README 기준)을 수정한다. |
| OpenMontage 코드를 레포에 복사·서브모듈 | AGPL-3.0. 작업 트리 약 92MB(+ `.git` 약 72MB)에 Python·Node 의존성이 더 붙는다. 웹앱 빌드와 무관하다. 자체 `.claude/`·`CLAUDE.md` 가 CocoTrip 규칙과 충돌한다. |
| 그래프 캐시(`graft/`)·인덱스 커밋 | 재생성 가능한 캐시이고 수십 MB 다. 코드를 인용하므로 pre-commit 가드에 걸린다. `/graft/`·`/.graft/`·`.codebase-memory/` 는 `.gitignore` 에 추가했다. |

## 비용 · CI 영향

- `.claude/`, `docs/`, `scripts/`, `tests/`, `*.md`, `.gitignore` 만 바꾸면 Vercel 빌드를 건너뛴다 (`scripts/vercel-ignore.sh`).
- 이번 변경에는 **`package.json`(npm script 6줄)과 루트 `.mcp.json`** 이 들어 있다. 그래서 PR 에서 **Vercel preview 빌드가 1회** 돌고, 이어서 smoke·visual·pdf-golden·lighthouse 가 preview 대상으로 실행된다. 의존성은 추가하지 않았다(lockfile 변경 없음).
- 도구 실행 자체는 무료다. Graft 구조 분석·codebase-memory-mcp 는 LLM·API 키를 쓰지 않는다. OpenMontage 의 유료 생성(이미지·영상·TTS)은 별도 마케팅 키와 예산 상한으로 운영자가 직접 결정한다(런북 참고).

## 로컬에 생기는 것 (레포 밖 / gitignore)

| 위치 | 내용 | 정리 |
|---|---|---|
| `graft/`, `.graft/` (레포 루트, gitignore) | `graft/` = Graft 코드 그래프 캐시 (2026-10-07 측정 71MB). `.graft/` = Trail 로컬 설정 — 허용 명령으로는 생기지 않는다 | `rm -rf graft .graft` |
| `~/.npm/_npx/<해시>/` | `@nanonets/graft@0.21.1` npx 설치본 (약 400MB) | `grep -l '@nanonets/graft' ~/.npm/_npx/*/package.json` 로 찾은 그 폴더만 삭제 — `npm cache clean` 은 `_npx` 를 지우지 않는다 ([AI-TOOL-GRAFT.md](AI-TOOL-GRAFT.md) 참고) |
| `~/.graft/` | Graft 업데이트 확인 기록 (텔레메트리는 꺼짐) | 폴더 삭제 |
| `~/.cache/cocotrip-tools/codebase-memory-mcp/` (macOS: `~/Library/Caches/cocotrip-tools/…`, Windows: `%LOCALAPPDATA%\cocotrip-tools\…`) | 고정 버전 바이너리 | 상세 문서 제거 절 참고 |
| `~/.cache/codebase-memory-mcp/` | 코드 인덱스 DB (코드 사본처럼 다룬다) | 상세 문서 제거 절 참고 |
| `outputs/openmontage-briefs/` (gitignore) | 영상 브리프 + 사진 사본 | 사용 후 삭제 |

## 미검증 — 운영자 확인 필요

- 서브에이전트가 실제 Claude Code 세션의 `/agents` 에 뜨는지, 설명 기반 자동 위임이 의도대로 동작하는지 (라이브 세션에서만 확인 가능).
- 프로젝트 MCP 승인 프롬프트 UX: 로컬 Claude Code 와 claude.ai/code 클라우드 세션 각각. 핸드셰이크·색인·검색은 이 컨테이너에서 실제로 확인했다.
- Windows·macOS 실기기에서 `scripts/graft.mjs` · `scripts/codebase-memory-mcp.mjs` 실행 (Linux x64 에서만 실측).
- OpenMontage 설치·렌더링 자체, Remotion 상업 라이선스, KTO 사진 출처표기 조건.

## 서드파티 고지

- agency-agents: MIT, Copyright (c) 2025 AgentLand Contributors. 원문 [`third-party/agency-agents/LICENSE`](third-party/agency-agents/LICENSE). 수정본 출처는 [`PROVENANCE.md`](third-party/agency-agents/PROVENANCE.md).
- Graft · codebase-memory-mcp: MIT. 레포에 코드를 포함하지 않는다. 실행 시점에 npm / GitHub Releases 에서 고정 버전을 받는다.
- OpenMontage: AGPL-3.0. 레포에 코드를 포함하지 않는다. 별도 작업공간에서 실행한다.
