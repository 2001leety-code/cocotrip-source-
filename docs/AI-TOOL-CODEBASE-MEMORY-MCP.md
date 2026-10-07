# codebase-memory-mcp — 로컬 코드 그래프 MCP 서버 (버전 고정 + SHA-256 검증 런처)

> 적용일 2026-10-07. 버전 **v0.11.0 고정**, 실행은 항상 런처 `scripts/codebase-memory-mcp.mjs` 를 거친다.
> 공식 설치기(`install.sh` 원라이너, 바이너리의 `install` / `update` / `uninstall`)는 **쓰지 않는다**.
> 수치는 이 날짜 클라우드 컨테이너(Linux x64, Node v22.22.0, Claude Code 2.1.292) 실측이다. 버전을 올리면 8절 절차대로 다시 확인하고 이 문서를 갱신한다.

---

## 1. 무엇인가 / 무엇이 아닌가

| 소개 글에서 받는 인상 | 실제 (v0.11.0 소스 + 실행으로 확인) |
|---|---|
| "코드베이스 전체를 기억해서 엉뚱한 코드를 고치지 않게 해 준다" | **편집을 막아주지 않는다.** 레포를 tree-sitter(+ TS/JS 타입 보조 해석)로 파싱해 함수·호출·import·HTTP 라우트 그래프를 로컬 SQLite 에 만들고, MCP 도구 17개로 **조회**하게 해 줄 뿐이다. |
| "AI 가 코드베이스를 이해한다" | 바이너리 안에 LLM 이 없다. API 키·계정·호스팅 서비스 없음. 해석은 Claude Code 쪽이 한다. |
| "빠짐없이 찾아준다" | README 스스로 "clean coverage = 기록된 누락이 없다는 뜻일 뿐, 완전성의 증명이 아니다"라고 쓴다. 동적 호출·문자열로 만든 키·`ts/tsx` 바깥 연결은 놓칠 수 있다. |

그래서 이 프로젝트에서의 규칙:

- **결과는 힌트다.** 편집 전에는 반드시 해당 파일을 직접 연다 (AGENTS.md "작업 종류별 SSOT — 코드 만지기 전에 직접 열어라").
- 검증은 지금과 똑같이 `npm run build` / `npm run test:unit` / `npm run plan:test` (필요 시 `verify-surfaces` · `verify-web` 스킬). 그래프 결과로 검증을 대신하지 않는다.
- 쓸모 있는 곳: "이 함수를 누가 부르나"(호출자 추적), "이 diff 가 어디까지 번지나"(영향 범위), 줄번호 대신 **모듈·심볼 이름으로 탐색**(CLAUDE.md "줄번호 참조 금지"와 맞는다). 결제·플래너·식이 코드 수정 전 영향 범위 파악에 특히 유용하다.

출처: GitHub `DeusData/codebase-memory-mcp`, MIT. 릴리스 바이너리에는 tree-sitter 문법·임베딩 모델 등 서드파티 구성요소가 들어 있다 (아카이브의 `THIRD_PARTY_NOTICES.md`).

---

## 2. 연결 방식

```
Claude Code ──(.mcp.json: node -e 부트스트랩)──▶ scripts/codebase-memory-mcp.mjs mcp
                                                   │ 1) 설치돼 있으면 그대로, 없으면 고정 버전 다운로드
                                                   │ 2) SHA-256 대조 → 멤버 목록 검사 → 바이너리 1개만 추출
                                                   │ 3) --version 확인 → 캐시 폴더로 원자적 rename
                                                   ▼
                                 <캐시>/cocotrip-tools/codebase-memory-mcp/v0.11.0/codebase-memory-mcp --ui=false
                                                   │ (stdio 상속, exit code·SIGINT/SIGTERM 전달)
                                                   ▼
                                 계정당 백그라운드 데몬 1개 (인덱스·git watcher 소유)
```

### 레포에 들어간 파일

| 파일 | 내용 |
|---|---|
| `.mcp.json` | 프로젝트 MCP 서버 `codebase-memory-mcp`. `command: node`, `args: ["-e", "<부트스트랩>"]`. env·비밀값 없음. |
| `scripts/codebase-memory-mcp.mjs` | 런처. 의존성 없음(ESM, Node 내장 모듈만). 서브커맨드 `setup` / `mcp`(기본) / `path` / `run -- <args>`. `run` 은 유지보수 명령(`--version`, `config ...`, `daemon ...`, `cli ...` 등)만 받는다. `install` · `update` · `uninstall` 은 `cli` 앞이면 위치와 무관하게(예: `daemon install --help` — 바이너리가 `daemon` 을 건너뛰고 install 코드로 보낸다) exit 2 로 막고, 모드 없는 실행(= `--ui=false` 없는 MCP 서버)도 막는다. `mcp` 는 `--ui...` 플래그를 거부한다(바이너리는 마지막 `--ui=` 를 따르고 config.json 에 저장하므로). |
| `.gitignore` | `.codebase-memory/` — `persistence:true` 산출물이 혹시 생겨도 커밋되지 않게. |
| 이 문서 | |

### 왜 `.mcp.json` 이 `node scripts/...` 가 아니라 `node -e` 부트스트랩인가

2026-10-07 에 Claude Code 2.1.292 로 직접 확인한 사실:

- `.mcp.json` 의 `${CLAUDE_PROJECT_DIR}` 는 **펼쳐지지 않는다.** 이 변수는 Claude Code 자기 프로세스 env 에 없고(자식 env 에만 넣어 준다), 기본값 없이 쓰면 `Missing environment variables: CLAUDE_PROJECT_DIR` 경고가 뜨며, `${CLAUDE_PROJECT_DIR:-.}` 는 그냥 `.` 이 된다.
- MCP 서버의 cwd 와 자식 env 의 `CLAUDE_PROJECT_DIR` 는 **claude 를 실행한 폴더**다. `src/` 에서 실행하면 둘 다 `.../src` 였다 (`.mcp.json` 자체는 상위 폴더에서 찾아 읽는다).
- 그래서 `node scripts/codebase-memory-mcp.mjs mcp` 같은 상대 경로는 레포 루트에서만 동작한다.

부트스트랩이 하는 일 (그대로 읽으면 된다): `CLAUDE_PROJECT_DIR`(없으면 cwd)에서 시작해 `scripts/codebase-memory-mcp.mjs` 가 있는 폴더를 위로 찾아 올라가고, 그 파일을 import 해 `main(['mcp'])` 를 부른다. 네트워크·파일 쓰기 없음. 레포 루트와 `src/` 양쪽에서 실행해 MCP 핸드셰이크까지 확인했다. 런처를 찾거나 불러오지 못하면 stdout 에는 아무것도 쓰지 않고 stderr 에 `[codebase-memory-mcp bootstrap] cannot load scripts/codebase-memory-mcp.mjs searching up from <시작 폴더>: <원인>` 한 줄을 남긴 뒤 exit 1 로 끝난다.

### 설치 위치 (레포 밖, OS 캐시 폴더)

| OS | 바이너리 경로 |
|---|---|
| Linux | `${XDG_CACHE_HOME:-~/.cache}/cocotrip-tools/codebase-memory-mcp/v0.11.0/codebase-memory-mcp` |
| macOS | `~/Library/Caches/cocotrip-tools/codebase-memory-mcp/v0.11.0/codebase-memory-mcp` |
| Windows | `%LOCALAPPDATA%\cocotrip-tools\codebase-memory-mcp\v0.11.0\codebase-memory-mcp.exe` |

- `CBM_HOME` 환경변수로 `<캐시>/cocotrip-tools` 부분을 바꿀 수 있다. 레포 안을 가리키면 런처가 거부한다(exit 2).
- PATH · 셸 rc · `~/.claude.json` · `~/.claude/settings.json` · 다른 에이전트 설정은 **건드리지 않는다.**
- 다운로드는 `curl -fsSL --proto =https --proto-redir =https --retry 3` (HTTPS_PROXY 를 따른다). curl 이 없을 때만 Node fetch 로 대체한다(이 경우 프록시 env 를 따르지 않는다).
- 고정 해시(v0.11.0 `checksums.txt` 원문, 2026-10-07 재확인):

| 플랫폼 키 | 자산 | SHA-256 |
|---|---|---|
| linux-x64 | `codebase-memory-mcp-linux-amd64-portable.tar.gz` | `1f9e8293eb2bc5c05cfa27a7e8fc033da6d729ffad525ccfcdaa3fd606306683` |
| linux-arm64 | `codebase-memory-mcp-linux-arm64-portable.tar.gz` | `d62eeb224d5ee3eba3070938ec62cf1033f10b041ec1c4b2fb67f7aef390cc7b` |
| darwin-arm64 | `codebase-memory-mcp-darwin-arm64.tar.gz` | `4dee7f38b63740e6751d7a7ed7eb10291c1f2a3ea2415f599dc68370ca0a2d18` |
| darwin-x64 | `codebase-memory-mcp-darwin-amd64.tar.gz` | `dbf1c73bfcbde64e7dde4cd1320da7afc02e2c972ee1789ae039521411f5132e` |
| win32-x64 | `codebase-memory-mcp-windows-amd64.zip` | `6eb6beaf261b19e419766e78baf93cbc3cf1c6338cff8fb7c0234859f96d1685` |

- 아카이브 멤버는 정확히 4개여야 한다: 바이너리(`codebase-memory-mcp` 또는 `.exe`), `LICENSE`, `install.sh`(Windows 는 `install.ps1`), `THIRD_PARTY_NOTICES.md`. 추가·누락·중복·절대경로·`..` 가 있으면 중단. 5개 자산 모두 실제로 받아 멤버 목록을 확인했다.
- 해시가 다르면 받은 파일을 지우고 중단한다. **해시를 고쳐서 넘어가지 말 것** — 릴리스 워크플로가 같은 태그 자산을 다시 올릴 수 있는 구조라, 해시가 바뀌었다는 것 자체가 조사 대상이다 (8절).
- **검증은 설치할 때 1회다.** 이후 실행에서는 바이너리가 "1MB 이상 일반 파일"인지만 보고 다시 해시하지 않는다. 약 300MB 를 매번 해시하면 실행마다 0.38~0.45초(이 컨테이너, warm/cold)가 붙는데, 설치 폴더(0700, 사용자 캐시)를 바꿔치기할 수 있는 주체는 이미 `.mcp.json`·런처·셸 rc·`~/.claude` 훅도 고칠 수 있어 막아 주는 것이 없다고 판단했다. 의심되면 버전 폴더를 지우고 `npm run cbm:setup` 으로 다시 받거나, Linux x64 는 직접 대조한다: `sha256sum "$(node scripts/codebase-memory-mcp.mjs path)"` → `ce11c141431aeadd788506c3a7e6942db8fd438dec369d0707a39ec9fd8c6510` (v0.11.0 portable 아카이브에서 꺼낸 바이너리).
- 중단된 설치(예: 첫 MCP 연결이 타임아웃으로 kill 됨)의 임시 폴더 `.staging-*` 는 1시간이 지나면 다음 실행 때 지운다.

---

## 3. 첫 실행

1. (권장) 미리 설치해 둔다 — 첫 MCP 연결이 다운로드를 기다리지 않게:
   ```bash
   npm run cbm:setup                              # = node scripts/codebase-memory-mcp.mjs setup
   node scripts/codebase-memory-mcp.mjs run -- --version   # → codebase-memory-mcp 0.11.0
   ```
   이 컨테이너에서 다운로드 + 검증 + 추출 = **5.0초**. 디스크는 바이너리만 약 300MB (압축 약 40MB).
2. 레포 루트(또는 하위 폴더)에서 `claude` 를 실행하면 **프로젝트 MCP 승인 프롬프트**가 뜬다. 승인 전에는 `claude mcp list` 에 `⏸ Pending approval` 로만 보이고 연결·헬스체크를 하지 않는다. 승인/거절 선택을 되돌리려면 `claude mcp reset-project-choices`.
   - 레포에는 `enableAllProjectMcpServers` / `enabledMcpjsonServers` 를 **넣지 않았다.** 각자 승인한다.
3. 승인 후 `/mcp` 에서 `codebase-memory-mcp` 가 connected, 도구 17개인지 본다.
4. 첫 연결 시간: 데몬 콜드 스타트(실행 파일 해시 계산 포함) 약 **6.8초**. 바이너리가 없으면 여기에 설치 시간이 더해진다 (실측: 설치부터 `initialize` 응답까지 **11.9초**, 그동안 stdout 에는 JSON-RPC 외 아무것도 나가지 않음). Claude Code 의 MCP 연결 제한은 기본 30초(`MCP_TIMEOUT`, ms 단위)다. 느린 네트워크에서 첫 연결이 실패하면 1번(미리 setup)을 하거나 `MCP_TIMEOUT=120000 claude` 로 한 번 띄운다.
5. 도구 호출마다 Claude Code 권한 확인이 뜬다. 읽기 전용 도구를 허용 목록에 넣는 것은 개인 선택(`.claude/settings.local.json`)이며 레포에 커밋하지 않는다.

---

## 4. 사용 예시 (CocoTrip 실제 심볼, 2026-10-07 실행 결과)

Claude Code 에게 자연어로 시키면 된다 ("이 레포 인덱싱해줘", "verifyCaptureIntegrity 호출자 보여줘"). 내부적으로 아래 도구가 불린다.

### 4-1. 인덱싱 — `index_repository`

```json
{ "repo_path": "/home/user/cocotrip-source-" }
```

- 경로는 **절대경로**. 기본 mode `full`. `persistence` 는 절대 켜지 않는다 (5절).
- 결과: 노드 39,938 / 엣지 100,972, **15.5초**. `.gitignore` · 내장 skip 목록을 따른다 (`node_modules`, `.git`, `graft`, `reports`, `.claude` 등 제외, 717개 파일 미색인).
- 프로젝트 이름은 경로에서 만든다 (여기서는 `home-user-cocotrip-source`). 각자 clone 경로가 다르니 `list_projects` 로 확인해서 이후 호출의 `project` 에 넣는다.
- 인덱스는 세션이 끝나도 남는다. 레포 루트에서 띄운 새 세션은 데몬이 레포를 다시 watch 했지만 `src/` 에서 띄운 세션은 watch 하지 않았다(데몬 로그 실측). 큰 변경 뒤나 확신이 없으면 `index_repository` 를 다시 부른다 (재색인 17.8초).

### 4-2. 심볼 찾기 — `search_graph`

```json
{ "project": "home-user-cocotrip-source", "name_pattern": "verifyCaptureIntegrity" }
```
→ `api/_shared/paypal-capture-verify.js` 64-129 행의 Function 1건 (20ms).

`{"query": "PayPal capture amount verification", "limit": 8}` 처럼 자연어(BM25)로도 찾는다 → `verifyCaptureIntegrity`, `toMinorUnits`, `api/paypal-webhook.js` 의 `extractAmountUSD`, `api/_shared/paypal-refund.js` 의 `refundPaypalCapture` 등.

### 4-3. 결제 코드 변경 영향 — `trace_path`

```json
{ "project": "home-user-cocotrip-source", "function_name": "verifyCaptureIntegrity", "direction": "inbound", "depth": 2 }
```
→ 호출자 4개 (17ms):
- hop 1: `api/capturePaypalOrder.js` handler, `api/captureCartOrder.js` handler, `api/_ai_core/paymentGate.js` `enforcePaymentAndRevision`
- hop 2: `api/_ai_core/handlerCore.js` handler

`grep -rn verifyCaptureIntegrity api src` 결과(직접 호출 파일 3개)와 일치했다. 이 함수를 고치면 카트 결제·단건 결제·AI 플래너 결제 게이트가 같이 바뀐다는 뜻이다 → `cocotrip-money-safety` 스킬 절차를 따른다.

플래너 쪽 예: `{"function_name": "resolveGeminiModel", "direction": "inbound", "depth": 1}` → 호출 함수 12개(10개 파일: `api/_ai_core/blockMode.js`, `geminiPipeline.js`, `debugInfo.js`, `api/ai-planner-quick.js`, `api/course-ai.js`, `api/mood-quote-parse.js`, `api/admin-translate.js`, `api/_crons/content-draft.js`, `api/_shared/inquiry-response.js`, `src/ai_planner/intent-classifier-llm.ts`). 모델 SSOT(`api/_ai_core/geminiModelResolver.js`) 변경이 어디까지 번지는지 한 번에 본다.

### 4-4. 지금 diff 의 영향 — `detect_changes`

```json
{ "project": "home-user-cocotrip-source", "base_branch": "main", "depth": 1 }
```
→ `main` 과의 merge-base 기준 변경 파일 목록 + 그 파일의 심볼에 의존하는 코드(hop 1)를 준다 (105ms). PR 템플릿의 "사전 영향 분석" 칸을 채울 때 출발점으로 쓰고, 나온 파일은 직접 열어 확인한다.

### 4-5. 구조 개요 — `get_architecture`

```json
{ "project": "home-user-cocotrip-source", "aspects": ["overview"] }
```
→ 언어별 파일 수(TypeScript 1,492 / JavaScript 369 / YAML 30 …), 패키지별 노드 수(`unit`, `components`, `pages`, `_shared`, `lib`, `_ai_core` …), 엔트리포인트, 엣지 종류(CALLS 16,166 / IMPORTS 7,237 / HTTP_CALLS 246 …) (174ms).

### 터미널에서 (MCP 없이)

```bash
node scripts/codebase-memory-mcp.mjs run -- cli --quiet trace_path '{"project":"home-user-cocotrip-source","function_name":"verifyCaptureIntegrity","direction":"inbound","depth":2}'
```
(데몬 콜드 스타트 포함 약 7초, 위와 같은 결과)

---

## 5. 금지

| 금지 | 이유 |
|---|---|
| `curl -fsSL .../install.sh \| bash` (공식 원라이너), 아카이브 안의 `install.sh` / `install.ps1` 실행 | `releases/latest` 를 받는다(버전 고정 없음, 같은 릴리스의 checksums.txt 와만 대조). 이어서 바이너리 `install` 을 돌린다. |
| 바이너리 `install` / `update` / `uninstall` | `~/.claude.json` mcpServers, `~/.claude/settings.json` hooks(Grep/Glob/Bash 가로채기, SessionStart 등), `~/.claude/skills`·`agents`, 셸 rc PATH, 다른 에이전트 설정 파일까지 고쳐 쓴다 → CLAUDE.md 승인 경계 위반. 런처의 `run` 은 이 세 개를 **exit 2** 로 막는다. |
| `index_repository` 에 `persistence: true` | 레포 안에 `.codebase-memory/graph.db.zst` · `.gitattributes` 를 만들고 `.git/config` 에 `merge.ours.driver` 를 넣는다. `.gitignore` 에 `.codebase-memory/` 가 있지만 애초에 켜지 않는다. |
| `daemon start` (상시 데몬), `--ui=true`, `config set auto_index true` | 아래 6절. 필요하면 운영자와 먼저 상의. (런처 `mcp` 는 `--ui...` 를 exit 2 로 거부한다. `run -- config set ...` 은 막지 않으니 규칙으로 지킨다.) |
| `.mcp.json` 에 env·키 추가, 레포에 `enableAllProjectMcpServers` · `enabledMcpjsonServers` 추가 | 키가 필요 없는 도구다. 승인은 각자. |
| SessionStart hook 로 바이너리 다운로드 | 모든 개발자 PC 에서 돌고, MCP 연결과 경쟁한다. 런처의 첫 실행 설치로 충분하다. |
| npm `codebase-memory-mcp` 패키지(npx) 와 섞어 쓰기 | 모든 CBM 프로세스는 정확히 같은 빌드여야 데몬에 붙는다. 섞으면 버전 충돌로 연결이 거부된다. |

---

## 6. 데몬 · watcher · UI

- **데몬**: 첫 MCP 연결이 계정당 백그라운드 데몬 1개를 띄운다(분리된 세션). 기본은 session-managed — **마지막 클라이언트가 끊기면 스스로 종료**한다 (실측: `daemon.runtime_stopping reason=last_committed_client_disconnected`, 이후 남은 프로세스 0). `daemon start` 로 띄운 상시(permanent) 데몬은 계속 남는다.
  ```bash
  node scripts/codebase-memory-mcp.mjs run -- daemon status
  node scripts/codebase-memory-mcp.mjs run -- daemon stop     # 연결된 세션이 있으면 "NOT stopped" — 세션을 먼저 닫는다
  ```
- **watcher**: 데몬이 살아 있는 동안 레포를 git 폴링으로 감시해 변경을 다시 색인한다 (`auto_watch` · `watcher_enabled` 기본 true). 끄려면:
  ```bash
  node scripts/codebase-memory-mcp.mjs run -- config set auto_watch false
  node scripts/codebase-memory-mcp.mjs run -- config list
  ```
  `watcher_enabled` 는 데몬 시작 때 한 번 읽으니 바꾼 뒤 `daemon stop`. `auto_index`(세션 시작 시 자동 색인)는 기본 false 그대로 둔다.
- **그래프 UI (127.0.0.1:9749)**: 바이너리는 `<cbm 캐시>/config.json` 이 없으면 데몬 시작 때 UI 를 **자동으로 켠다**. `--ui=false` 는 설정 파일만 고치고 이미 떠 있는 UI 는 끄지 않는다 — 공식 방식대로 처음 실행하면 첫 세션 내내 9749 가 열려 있다 (실측: 설정 파일 없이 바이너리를 직접 `--ui=false` 로 띄웠을 때 `ui.serving` 로그 + LISTEN 확인).
  - 그래서 런처는 `mcp` / `run` 실행 전, 그 파일이 **없을 때만** `{"ui_enabled": false, "ui_port": 9749}` 를 미리 만든다(바이너리가 쓰는 것과 같은 형식, 있으면 손대지 않음). 런처 경유 첫 실행에서는 9749 LISTEN 0회, `ui.serving` 없음을 확인했다.
  - 다만 `mcp` 가 넘기는 `--ui=false` 때문에 **바이너리(데몬)는 MCP 세션마다 config.json 을 다시 쓴다**: 이미 있던 파일의 `ui_enabled:true` 도 `false` 로 바뀌고, `ui_port` 외의 다른 키는 사라진다(실측: `{"ui_enabled": true, "ui_port": 18749, "custom": 1}` → `{"ui_enabled": false, "ui_port": 18749}`). 이 캐시 폴더를 공식 설치본과 같이 쓰고 있다면 그쪽 UI 설정도 꺼진다.
  - 루프백 전용이고 Origin 검사가 있지만, 색인 POST 경로가 있는 로컬 웹 서버라 켜 두지 않는다.

---

## 7. 데이터 위치 · 개인정보

| 위치 | 내용 |
|---|---|
| `<cocotrip-tools>/codebase-memory-mcp/v0.11.0/` | 바이너리 (약 300MB). 런처만 쓴다. |
| `~/.cache/codebase-memory-mcp/<프로젝트>.db` (+`-wal`/`-shm`) | 그래프 인덱스 (CocoTrip 약 123MB). 바이너리는 `HOME`(없으면 `USERPROFILE`) 아래 `.cache` 를 쓴다 — Windows 에서는 보통 `%USERPROFILE%\.cache\codebase-memory-mcp\`. `CBM_CACHE_DIR` 로 이동 가능. |
| `~/.cache/codebase-memory-mcp/_config.db`, `config.json` | `config set` 값, UI 설정. |
| `~/.cache/codebase-memory-mcp/logs/` | 데몬 로그, 색인 로그 (파일 경로가 들어 있다). |
| `/tmp/cbm-daemon-<uid>/` | 데몬 소켓·락 (소유자 전용 0700). |

- 인덱스는 **암호화되지 않은 SQLite** 다. 실측으로는 심볼 이름·파일 경로·행 범위·시그니처·메트릭·임베딩 벡터가 들어 있고 함수 본문 전체는 보이지 않았지만, 버전마다 달라질 수 있으니 **코드 사본과 같은 등급으로 취급**한다 (공유·업로드·커밋 금지).
- `.gitignore` 를 따른다. CocoTrip 은 `.env`, `.env*.local`, `.env.admin.local`, `service-account.json`, `*.pem` 을 이미 무시하므로 색인되지 않는다. 다만 **gitignore 되지 않은 untracked 파일은 색인된다** — 비밀값을 레포 폴더에 임시로 두지 말 것.
- 네트워크: v0.11.0 소스 검토상 런타임 업데이트 체크·텔레메트리 코드가 릴리스 빌드에 컴파일되지 않는다. 네트워크를 쓰는 건 이 런처의 최초 다운로드뿐이다. (바이너리를 strace 로 추적하지는 않았다 — 미검증.)

---

## 8. 버전 올리기

1. 새 태그의 릴리스 노트를 읽고 CLI 변경(특히 `install`/`update`/`uninstall`, 새 최상위 모드 토큰, UI 설정 동작, `--ui` 플래그)을 확인한다. 런처의 `MODE_TOKENS` 를 **그 태그의** `src/daemon/bootstrap.c` `cbm_daemon_process_role` 과 다시 맞추고(`main` 브랜치가 아니라 태그 기준 — 예: `test-impact` 는 v0.11.0 이후에 생겼다), 사용자 설정을 쓰는 새 명령이 있으면 `REFUSED_MODES` 에 넣는다. `src/main.c` `handle_subcommand` 가 인자를 훑는 순서도 확인한다.
2. `https://github.com/DeusData/codebase-memory-mcp/releases/download/<새 태그>/checksums.txt` 를 받아, 런처 `ASSETS` 의 **5개 해시와 파일 이름을 통째로 교체**하고 `VERSION` 을 바꾼다. 해시는 사람이 checksums.txt 원문과 한 글자씩 대조한다.
3. (선택, 더 강한 검증) Sigstore 서명 확인 — 이번 적용에서는 실행하지 않았다:
   ```bash
   cosign verify-blob --bundle checksums.txt.bundle \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com \
     --certificate-identity-regexp '^https://github.com/DeusData/codebase-memory-mcp/\.github/workflows/release\.yml@' \
     checksums.txt
   gh attestation verify <자산 파일> --repo DeusData/codebase-memory-mcp
   ```
4. 5개 자산의 멤버 목록이 여전히 4개(2절)인지 `tar -tzf` / zip 목록으로 확인한다. 바뀌었으면 런처의 멤버 상수도 같이 고친다.
5. 실행 확인: 기존 데몬 정지(`run -- daemon stop`, 버전이 다르면 같은 데몬에 붙지 못한다) → `setup` → `run -- --version` → Claude Code 에서 `/mcp` 연결 + `index_repository` · `trace_path` 한 번.
6. 이 문서의 해시 표·측정값·날짜를 갱신한다. 예전 버전 폴더(`<cocotrip-tools>/codebase-memory-mcp/<옛 버전>/`)는 지워도 된다.

---

## 9. 제거

```bash
node scripts/codebase-memory-mcp.mjs run -- daemon stop
rm -rf ~/.cache/cocotrip-tools/codebase-memory-mcp      # macOS: ~/Library/Caches/cocotrip-tools/codebase-memory-mcp
rm -rf ~/.cache/codebase-memory-mcp                     # 인덱스·설정·로그
claude mcp reset-project-choices                        # (선택) 이 프로젝트의 승인 선택 초기화
```

Windows (PowerShell): `Remove-Item -Recurse $env:LOCALAPPDATA\cocotrip-tools\codebase-memory-mcp`, `Remove-Item -Recurse $env:USERPROFILE\.cache\codebase-memory-mcp`.

- `XDG_CACHE_HOME` · `CBM_HOME` 을 썼다면 바이너리 폴더는 `node scripts/codebase-memory-mcp.mjs path` 가 출력하는 경로의 두 단계 위(`.../cocotrip-tools/codebase-memory-mcp`)다. `CBM_CACHE_DIR` 을 썼다면 인덱스 폴더도 그 경로다. 출력이 비어 있으면 아무것도 지우지 말 것.
- `~/.cache/codebase-memory-mcp` 는 이 레포 전용이 아니다. 다른 프로젝트에서 공식 설치본이나 npm 패키지로 codebase-memory-mcp 를 쓰고 있다면 같은 폴더(다른 프로젝트 인덱스·설정)를 공유하므로 통째로 지우지 말고, MCP `delete_project`(또는 `run -- cli delete_project '{"project":"<list_projects 의 이름>"}'`)로 이 레포 인덱스만 지운다.

레포에서 빼려면 `.mcp.json` 의 `codebase-memory-mcp` 항목, `scripts/codebase-memory-mcp.mjs`, `package.json` 의 `cbm:setup` 스크립트를 함께 지운다. 공식 `uninstall` 은 쓰지 않는다(애초에 공식 설치를 하지 않았으므로 지울 사용자 설정도 없다).

---

## 10. Windows / macOS 메모 (둘 다 실기기 미검증)

- **Windows x64**: zip 은 런처가 Node 만으로 읽는다(PATH 첫 `tar` 가 Git Bash 의 GNU tar 면 zip 을 못 읽기 때문). Linux 에서 실제 Windows zip 으로 추출해 Python `zipfile` 결과와 SHA-256 이 같음을 확인했다. `curl.exe` 는 Windows 10 이상에 기본 포함. Defender 가 이 바이너리를 `Trojan:Script/Wacatac.B!ml` 로 오탐한 사례를 vendor 가 공개하고 있다 — 해시가 맞으면 오탐일 가능성이 높지만, 판단은 운영자가 한다. **Windows arm64 는 런처가 지원하지 않는다**(자산 표에 없음 → 안내 후 종료).
- **macOS**: 공식 install.sh 처럼 `xattr -d com.apple.quarantine` + `codesign --sign - --force`(ad-hoc)를 실패 무시로 실행한 뒤 `--version` 으로 최종 확인한다. Rosetta 아래 x64 Node 라도 Apple Silicon 이면 arm64 빌드를 받는다(`sysctl.proc_translated`).
- 경로의 공백·한글은 Node `path`/`pathToFileURL` 로 처리하지만 실기기에서 확인하지 않았다.

---

## 11. 클라우드 세션 (claude.ai/code) 메모

- 새 컨테이너마다 바이너리가 없으므로 첫 MCP 연결 때 약 40MB 를 받는다 (이 컨테이너: 프록시 경유 5.0초). `github.com/.../releases/download/` 는 프록시로 열려 있었다. `api.github.com` 은 필요 없다.
- 인덱스도 컨테이너와 함께 사라진다 → 세션마다 `index_repository` 한 번 (약 15초).
- 클라우드 환경의 Setup script 에 `node scripts/codebase-memory-mcp.mjs setup` 을 넣으면 첫 연결 대기가 줄어든다 — 운영자 선택, 미검증.
- 클라우드 세션에서 프로젝트 MCP 승인 프롬프트가 어떻게 뜨는지는 확인하지 못했다 (미검증 — 운영자 확인 필요).

### PR · 배포 영향

- `scripts/`, `docs/`, `*.md` 는 `scripts/vercel-ignore.sh` 의 `IGNORE_RE` 에 걸려 빌드를 건너뛰지만, 루트의 **`.mcp.json` 과 `package.json`(scripts 추가) 은 걸리지 않는다** → 이 파일들이 들어간 PR 은 Vercel preview 빌드 1회를 쓴다. 런타임 코드(`src/`, `api/`)·`package.json` 의 dependencies 는 바꾸지 않았다.

---

## 12. 이번 측정값 (2026-10-07)

환경: claude.ai/code 클라우드 컨테이너, Linux x64, RAM 16GB, Node v22.22.0, Claude Code 2.1.292, 레포 HEAD `fe12bef`.

| 항목 | 값 |
|---|---|
| 첫 설치 (다운로드 + SHA-256 + 멤버 검사 + 추출 + `--version`) | 5.0초 |
| 바이너리 크기 | 299,891,744 bytes (약 300MB) |
| 데몬 콜드 스타트 → `initialize` 응답 | 6.8~6.9초 (바이너리 없는 상태에서 mcp 모드로 첫 실행: 설치 포함 11.9초) |
| 동시 첫 실행 2개 (`setup` 병렬) | 둘 다 exit 0, 바이너리 1개, staging 잔여물 없음 |
| `tools/list` | 17개 (index_repository, search_graph, query_graph, trace_path, get_code_snippet, get_file_outline, get_graph_schema, compare_graphs, get_architecture, search_code, list_projects, delete_project, index_status, check_index_coverage, detect_changes, manage_adr, ingest_traces) |
| `index_repository` (full) | 첫 회 15.5초, 재색인 17.8초 |
| 그래프 크기 | 노드 39,938 / 엣지 100,972 (미색인 파일 717, 부분 파싱 13) |
| 인덱스 DB | `~/.cache/codebase-memory-mcp/home-user-cocotrip-source.db` 128,843,776 bytes (약 123MB) |
| 조회 응답 | search_graph 20~41ms, trace_path 16~17ms, detect_changes 105ms, get_architecture 174ms |
| stdout 프레이밍 | JSON-RPC 외 줄 0 (런처 로그는 stderr 로만) |
| 하위 폴더(`src/`) 실행 | 부트스트랩이 레포 루트를 찾아 연결 성공. 실제 Claude Code 2.1.292 가 `src/` 에서 이 `.mcp.json` 을 띄워 initialize · tools/list · prompts/list 성공 (데몬 로그) |
| 9749 LISTEN | 런처 경유 0회 / 설정 파일 없이 바이너리 직접 실행 시 LISTEN 발생 |
| 세션 종료 후 | 데몬 자동 종료, cbm 프로세스 0 |
| 차단 | `run -- install` / `update` / `uninstall` → exit 2, 다운로드 전에 차단. `run -- daemon install --help` · `daemon uninstall --help` · `daemon update --help`(차단 전에는 바이너리의 install/uninstall/update 코드까지 갔다) · `run -- test-impact`(v0.11.0 에서는 모드가 아니라 MCP 서버가 떴다) · `mcp --ui=true`(차단 전에는 9749 LISTEN + config.json 에 `ui_enabled:true` 저장) → 모두 exit 2 |
| 해시 불일치 시 | 파일 삭제 + exit 1, 설치 폴더에 바이너리 없음 (해시를 0 으로 바꾼 사본으로 확인) |
