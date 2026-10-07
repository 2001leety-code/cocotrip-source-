// 셰뱅(#!)은 넣지 않는다 — 실행은 항상 `node scripts/graft.mjs ...` 이고,
// vitest 가 이 파일을 import 해도 수집 단계에서 죽지 않게 하기 위함 (scripts/check-mojibake-docs.mjs 와 같은 이유).
/**
 * Graft(@nanonets/graft) 러너 — 버전 고정 + 텔레메트리 OFF + 읽기 전용 명령만. (2026-10-07)
 *
 * 왜: Graft 는 코드베이스를 tree-sitter 로 파싱해 "코드 지도(graft/ 카드 + wiring.json)"와
 *   "변경 영향 범위(blast radius)"를 오프라인·$0 로 뽑아 준다. PR 템플릿의
 *   "사전 영향 분석 — 간접 영향(호출 체인)" 칸을 채우는 데 쓴다.
 *   그런데 같은 패키지에 위험한 기능이 섞여 있다:
 *     - init       : ~/.claude/settings.json·~/.claude.json 전역 쓰기, .claude/ hooks·SKILL 주입,
 *                    permissions.allow 에 Bash(graft:*) 등 광범위 허용 자동 추가(업그레이드마다 복원)
 *     - trail      : 레포 이력(커밋·PR 스레드·지시 파일)을 외부(Nanonets) 서버로 업로드, CLAUDE.md 수정
 *     - --deep/--name : 소스·심볼 본문을 외부 LLM 으로 전송
 *     - 텔레메트리 : npm 배포본은 기본 ON (PostHog)
 *   그래서 npx 를 직접 부르지 않고 이 래퍼만 쓴다. 허용 목록 밖은 exit 2 로 막는다.
 *
 * 상세(적용 방식·금지 목록·버전 올리기·트러블슈팅): docs/AI-TOOL-GRAFT.md
 *
 * 사용:
 *   npm run graph:build     # src/ + api/ + tests/ 구조 그래프 생성 → graft/ (gitignore 됨, 커밋 금지)
 *   npm run graph:map       # 디렉터리 클러스터·허브 요약
 *   npm run graph:impact    # origin/main 대비 영향 범위 markdown (PR "사전 영향 분석" 용, 커밋된 변경만)
 *   npm run graph:viz       # http://127.0.0.1:4400 로컬 뷰어 (브라우저는 직접 열기, Ctrl-C 종료)
 *   node scripts/graft.mjs callers verifyCaptureIntegrity --depth 2
 *   node scripts/graft.mjs ask "PayPal capture amount verification" --in api/
 *
 * 래퍼가 하는 일: (1) 서브커맨드 허용 목록 + 위험 플래그 차단 + [dir] 는 레포 루트만 + 그래프 없으면 질의 차단
 *   (win32 는 " % ! 줄바꿈 인자도 차단) (2) 버전 고정 npx 실행
 *   (3) 자식 env 정리 — DO_NOT_TRACK=1, GRAFT_* / LLM 키 제거, 레포 .env 로딩 차단
 *   (4) stdout 의 에이전트 대상 "tokens saved" 지시문 제거 (5) 시그널 전달·종료 코드 전달.
 * 끌 수 없는 네트워크: 첫 실행 시 npm 설치(+ tree-sitter-cli 바이너리 GitHub 다운로드),
 *   하루 1회 `npm view @nanonets/graft version` 업데이트 확인(~/.graft/update-check.json).
 *
 * exit 2 = 이 래퍼가 차단함(네트워크·외부 전송·레포 밖 쓰기 위험). 그 외 = graft 의 exit code 그대로.
 *
 * 주의: 이 파일에는 연속 물음표 두 개를 쓰지 않는다 (pre-commit mojibake 가드가 .mjs 를 검사한다).
 */
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

// 버전 고정. 올릴 때는 숫자만 바꾸지 말고 docs/AI-TOOL-GRAFT.md "버전 올리기" 절차
// (CHANGELOG + scripts/postinstall.mjs + src/claude/settings-merge.ts + src/upkeep.ts 재감사,
//  그리고 이 파일의 서브커맨드·플래그 목록을 새 배포본 dist/cli.js 와 대조)를 먼저 끝낸다.
export const GRAFT_PACKAGE = '@nanonets/graft@0.21.1';

const SELF_PATH = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(SELF_PATH), '..');

/** 허용 서브커맨드 — 전부 로컬 tree-sitter 그래프만 읽고/갱신한다($0, LLM 없음). */
export const ALLOWED_SUBCOMMANDS = new Set([
  'build', // graft/ 구조 그래프 생성 (--deep 은 아래 BANNED_FLAGS 로 차단)
  'map', // 디렉터리 클러스터·허브 요약
  'viz', // 127.0.0.1 전용 로컬 뷰어 (--export 는 차단)
  'ask', // 자연어 → 관련 심볼 file:line
  'grep', // 심볼 단위로 묶인 정규식 검색
  'skeleton', // 파일 시그니처 요약
  'callers', // 호출자/피호출자 체인
  'blast', // diff 의 영향 범위 (--name 은 차단)
  'check', // graft/ 가 코드보다 오래됐는지 확인
  'help', // commander 내장 도움말
]);

/** 서브커맨드 없이 단독으로만 허용하는 최상위 플래그. */
export const TOP_LEVEL_FLAGS = new Set(['--help', '-h', '--version', '-v']);

/**
 * 차단 서브커맨드와 이유 (graft 0.21.1 배포본 dist/cli.js 의 program.command(...) 전수).
 * 목록에 없는 새 서브커맨드도 허용 목록 방식이라 자동 차단된다.
 */
export const BLOCKED_SUBCOMMANDS = new Map([
  ['init', '에이전트 연동: ~/.claude 전역 설정·.claude/ hooks·SKILL·.mcp.json 쓰기, permissions.allow 자동 확장 / writes global ~/.claude config, hooks, skill, .mcp.json and broad permission allow-lists'],
  ['uninstall', 'init 되돌리기 전용 — 실행 전 dry-run 검토 필요, 래퍼로는 실행 안 함(문서 절차 참고) / only for undoing init; run it by hand after reviewing the dry-run (see docs)'],
  ['trail', 'Trail(유료 서비스): 레포 이력 업로드·CLAUDE.md/AGENTS.md 수정 / uploads repo history to Nanonets and edits CLAUDE.md/AGENTS.md'],
  ['brain', 'trail 의 옛 이름 (graft 가 trail 로 재작성) / legacy alias of trail'],
  ['claude-md', '숨은 명령 — trail pull 과 동일, CLAUDE.md 수정 / hidden alias of trail pull, edits CLAUDE.md'],
  ['mcp', 'MCP 서버 — 부팅 시 upkeep(연동 재배선) 실행, 프로젝트 MCP 등록은 운영자 결정 사항 / MCP server runs upkeep on boot; registering it is an operator decision'],
  ['upgrade', '전역 npm i -g 실행 — 버전은 이 파일의 GRAFT_PACKAGE 로만 바꾼다 / runs a global npm install; bump GRAFT_PACKAGE instead'],
  ['version', 'npm registry 조회(네트워크) — 고정 버전 확인은 --version / queries the npm registry; use --version for the pinned version'],
  ['telemetry', '텔레메트리 설정 변경 금지 — 래퍼가 DO_NOT_TRACK=1 로 강제 OFF / telemetry is forced off by this wrapper (DO_NOT_TRACK=1)'],
  ['stats', 'init hooks 가 기록하는 에이전트 세션 통계 — 우리는 hooks 미연결 / agent-session stats recorded by init hooks, which we do not install'],
  ['_update-check', '내부 명령(npm registry 조회) / internal: npm registry query'],
  ['_telemetry-flush', '내부 명령(텔레메트리 전송) / internal: sends telemetry'],
  ['_brain-refresh', '내부 명령(Trail 규칙 pull + 지시 파일 재작성) / internal: pulls Trail rules and rewrites agent files'],
]);

/**
 * 차단 플래그 (graft 0.21.1 배포본 dist/cli.js 의 .option(...) 에서 도출).
 * 매칭 = 정확히 같거나 `플래그=` 로 시작 (예: --deep=1, --dir=/tmp/x 도 잡힘).
 * 단순 startsWith(플래그) 를 쓰지 않는 이유: '--dir' 이 callers 의 정상 옵션 '--direction' 까지 막는다.
 * commander 는 긴 옵션 약어(--dee 등)를 받지 않으므로 이 두 형태면 충분하다.
 */
export const BANNED_FLAGS = new Map([
  // 외부 LLM 으로 소스/심볼 본문 전송
  ['--deep', 'build --deep: 소스 파일·심볼 본문을 외부 LLM 으로 전송 / sends source and symbol bodies to an external LLM'],
  ['--name', 'blast --name: 영향 영역 이름을 LLM 호출로 생성(코드 전송) / one LLM call over the affected code'],
  ['--api-key', '전역: LLM provider 키 주입 — 키가 생기면 --deep 경로가 열린다 / injects an LLM key'],
  ['--provider', '전역: LLM provider 선택 / selects an LLM provider'],
  ['--base-url', '전역: LLM 엔드포인트 지정(임의 서버로 전송 가능) / points LLM traffic at any endpoint'],
  ['--model', '전역: LLM 모델 지정 / selects an LLM model'],
  // Trail (외부 업로드 + CLAUDE.md 쓰기)
  ['--trail', 'init --trail: Trail 연결(토큰 저장·이력 업로드) / attaches a Trail (stores a token, uploads history)'],
  ['--brain', '--trail 의 옛 이름 / legacy alias of --trail'],
  // graft/ 밖에 쓰거나 출력 위치를 바꿈
  ['--dir', '전역: 그래프 폴더를 임의 경로로 변경(gitignore 밖 커밋·배포 위험) / moves the graph dir anywhere, outside the gitignored /graft/'],
  ['--export', 'viz --export: 코드 구조가 담긴 index.html 을 임의 폴더에 씀(public/ 이면 prod 배포) / writes a self-contained HTML page with code structure anywhere'],
  ['--export-viz', 'blast --export-viz: 위와 동일 / same as viz --export'],
  // .gitignore 자기보호 해제
  ['--no-gitignore', 'build: graft/ 를 .gitignore 에 넣는 자기보호를 끔 — /graft/ 줄이 사라지면 소스 사본(graft/.cache)이 커밋될 수 있음. (인덱싱 범위는 안 바뀜: graft 는 git ls-files --exclude-standard 로 파일을 고르므로 .env 등 gitignore 파일은 어차피 제외) / disables graft re-adding /graft/ to .gitignore'],
]);

/** 래퍼가 막았을 때 쓰는 종료 코드. */
export const EXIT_BLOCKED = 2;

function isFlag(arg) {
  return arg.startsWith('-') && arg !== '-';
}

/** commander 15 의 negativeNumberArg 와 같은 식. 하위 명령(leaf)에서 `-5` 같은 값은 옵션이 아니라 위치 인자다. */
const NEGATIVE_NUMBER = /^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/;

/** commander 가 옵션으로 읽는 인자인지 (= isFlag 이되 음수는 제외). */
function isOptionLike(arg) {
  return isFlag(arg) && !NEGATIVE_NUMBER.test(arg);
}

/**
 * win32 에서 거부하는 문자. 래퍼는 win32 에서만 cmd.exe 로 npx.cmd 를 띄우는데,
 * cmd.exe 는 `\"` 를 이스케이프로 보지 않아 인자 안의 `"` 가 따옴표를 닫고 그 뒤의 `&`·`|` 가 명령으로 실행된다
 * (예: ask 'x" & npx @nanonets/graft init & "'). `%VAR%`·`!VAR!` 는 따옴표 안에서도 환경변수로 펼쳐진다.
 * CR/LF 는 cmd.exe 명령줄을 끊는다. 안전하게 인용할 방법이 없으므로 아예 받지 않는다.
 */
const WIN32_UNSAFE_CHARS = /["%!\r\n]/;

function matchBannedFlag(arg) {
  for (const flag of BANNED_FLAGS.keys()) {
    if (arg === flag || arg.startsWith(`${flag}=`)) return flag;
  }
  return null;
}

/** 경로처럼 보이는 인자(절대경로 또는 `..` 세그먼트 포함)가 레포 밖을 가리키는지. */
function pointsOutsideRepo(arg, root) {
  const looksLikePath = isAbsolute(arg) || arg.split(/[\\/]/).includes('..');
  if (!looksLikePath) return false;
  const rel = relative(root, resolve(root, arg));
  if (rel === '') return false;
  return isAbsolute(rel) || rel.split(sep)[0] === '..';
}

/**
 * 인자 검사. 순수 함수 — 네트워크·파일 접근 없음 (테스트에서 import 가능).
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkArgs(args, root = REPO_ROOT, platform = process.platform) {
  if (platform === 'win32') {
    const unsafe = args.find((arg) => WIN32_UNSAFE_CHARS.test(arg));
    if (unsafe !== undefined) {
      return {
        ok: false,
        reason: `Windows 에서는 인자에 " % ! 줄바꿈을 쓸 수 없음 (cmd.exe 를 거치며 명령 주입·환경변수 확장 위험) / on Windows, arguments may not contain " % ! or line breaks (cmd.exe would inject or expand them): ${JSON.stringify(unsafe)}`,
      };
    }
  }
  if (args.length === 0) {
    return { ok: false, reason: `서브커맨드가 필요합니다 / a subcommand is required. 허용 / allowed: ${[...ALLOWED_SUBCOMMANDS].join(', ')}` };
  }
  const [first] = args;

  if (TOP_LEVEL_FLAGS.has(first)) {
    if (args.length === 1) return { ok: true };
    return { ok: false, reason: `${first} 는 단독으로만 허용됩니다 / ${first} is only allowed on its own` };
  }
  if (isFlag(first)) {
    // 전역 옵션(--dir/--provider 등)을 서브커맨드 앞에 두는 형태 자체를 막는다.
    return { ok: false, reason: `첫 인자는 서브커맨드여야 합니다 / the first argument must be a subcommand (got ${first})` };
  }

  if (BLOCKED_SUBCOMMANDS.has(first)) {
    return { ok: false, reason: `'${first}' 차단 / blocked: ${BLOCKED_SUBCOMMANDS.get(first)}` };
  }
  if (!ALLOWED_SUBCOMMANDS.has(first)) {
    return { ok: false, reason: `'${first}' 는 허용 목록에 없음 / not on the allow-list. 허용 / allowed: ${[...ALLOWED_SUBCOMMANDS].join(', ')}` };
  }

  for (const arg of args.slice(1)) {
    const banned = matchBannedFlag(arg);
    if (banned) {
      return { ok: false, reason: `'${banned}' 차단 / blocked: ${BANNED_FLAGS.get(banned)}` };
    }
    // dotenv/config 는 argv 의 `dotenv_config_path=...` 를 env(DOTENV_CONFIG_PATH)보다 우선한다
    // (dotenv 17.4.2 lib/cli-options.js). 이 형태를 허용하면 아래 DOTENV_SINK 가 무력화된다.
    if (/^dotenv_config_/i.test(arg)) {
      return { ok: false, reason: `'${arg.split('=')[0]}' 차단 / blocked: .env 로딩 우회 / would re-enable .env loading` };
    }
    if (!isFlag(arg) && pointsOutsideRepo(arg, root)) {
      return {
        ok: false,
        reason: `레포 밖 경로 차단 / path outside the repo is blocked: ${arg} — graft 는 [dir] 인자 위치에 graft/ 캐시를 만들고 .gitignore 를 고친다 / graft would write its cache and .gitignore there`,
      };
    }
  }

  // [dir] 위치 인자는 레포 루트만 허용한다 (help 제외 — 액션을 실행하지 않는다).
  // build 는 [dir] 에 graft/ 를 만들고 <dir>/.gitignore 를 고친다(`build src` → src/graft/·src/.gitignore).
  // 질의 명령(map/ask/callers/grep/skeleton/blast/check/viz)도 [dir] 에 그래프가 없으면 잠금 파일용으로
  // <dir>/graft/.cache/ 를 mkdir -p 한다 — `map public` 은 public/graft/.cache/, `map -5` 는 새 폴더 -5/ 를 만든다
  // (2026-10-07 실측). /graft/ gitignore 는 루트에만 걸려 있으니 하위 폴더 쪽은 커밋·배포될 수 있다.
  // 범위 좁히기는 build --only-dir <path>, 질의는 --in <path> 로 한다.
  const shape = SUBCOMMAND_SHAPES[first];
  if (shape) {
    for (const positional of positionalArgs(args.slice(1), shape).slice(shape.lead)) {
      if (resolve(root, positional) !== root) {
        return {
          ok: false,
          reason: `[dir] 위치 인자는 레포 루트(.)만 허용 / only the repo root is accepted as [dir] (got ${JSON.stringify(positional)}) — graft 가 그 폴더에 graft/ 를 만든다 / graft would create graft/ there. 범위는 build --only-dir <path>, 질의는 --in <path> / narrow with --only-dir or --in`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * 서브커맨드별 인자 모양 (graft 0.21.1 dist/cli.js 의 .argument(...)/.option(...) 전수에서 도출).
 *   lead     = [dir] 앞에 오는 필수 위치 인자 수 (<query>, <pattern>, <symbol>, <file>)
 *   value    = 값 1개를 받는 옵션 (commander 는 다음 인자를 `-` 로 시작해도 무조건 값으로 먹는다)
 *   variadic = `<x...>` 옵션 (첫 값은 무조건, 이후는 옵션처럼 안 보일 때까지 먹는다)
 * 값 받는 차단 플래그(--dir/--export/--export-viz/--provider 등)는 앞 단계에서 이미 거부되므로 여기 없다.
 * 목적은 [dir] 위치 인자를 골라내는 것뿐이다. 여기 빠진 값 옵션이 있으면 그 값이 위치 인자로 잡혀
 * "더 막는" 쪽으로 틀리므로, 값을 받지 않는 옵션을 절대 value/variadic 에 넣지 않는다.
 */
const SUBCOMMAND_SHAPES = {
  build: { lead: 0, value: ['-j', '--concurrency', '--include-dir', '--only-dir'], variadic: ['-e', '--extensions'] },
  map: { lead: 0, value: ['--max-dirs'] },
  viz: { lead: 0, value: ['-p', '--port', '--title', '--tabs'] },
  check: { lead: 0, variadic: ['-e', '--extensions'] },
  blast: { lead: 0, value: ['--base', '-d', '--depth', '--format', '--title'], variadic: ['--pr-author'] },
  ask: { lead: 1, value: ['-n', '--limit', '--in'] },
  grep: { lead: 1, value: ['--in'] },
  callers: { lead: 1, value: ['--direction', '-d', '--depth', '--in'] },
  skeleton: { lead: 1 },
};

/** 서브커맨드 뒤 인자에서 옵션과 옵션 값을 뺀 위치 인자 목록 (commander 15 parseOptions 규칙). */
function positionalArgs(rest, shape) {
  const value = new Set(shape.value || []);
  const variadic = new Set(shape.variadic || []);
  const out = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--') {
      out.push(...rest.slice(i + 1));
      break;
    }
    if (!isOptionLike(arg)) {
      out.push(arg);
      continue;
    }
    // `--opt=값`·`-n5` 같은 붙은 형태는 정확 일치가 아니라 아래 두 분기에 안 걸린다(다음 인자 소비 없음).
    if (value.has(arg)) {
      i += 1;
      continue;
    }
    if (variadic.has(arg)) {
      i += 1;
      while (i + 1 < rest.length && !isOptionLike(rest[i + 1])) i += 1;
    }
  }
  return out;
}

/** 그래프 없이 돌면 graft 가 상위 폴더로 올라가 다른 graft/ 를 찾는 서브커맨드 (build·help 외 전부). */
export function needsRepoGraph(args) {
  const [first] = args;
  return Object.hasOwn(SUBCOMMAND_SHAPES, first) && first !== 'build';
}

/** 레포 루트에 graft 그래프(graft/.graph/wiring.json)가 있는지. */
export function hasRepoGraph(root = REPO_ROOT) {
  return existsSync(join(root, 'graft', '.graph', 'wiring.json'));
}

/**
 * dotenv 를 무력화하는 경로. graft 의 src/cli.ts 첫 줄이 `import "dotenv/config"` 라서
 * 그냥 두면 cwd(레포 루트)의 .env(FIREBASE_PRIVATE_KEY·PayPal·Gemini 키 등)를 graft 프로세스로 읽는다.
 * graft 0.21.1 이 설치하는 dotenv 17.4.2 의 config.js 는 lib/env-options.js 로 DOTENV_CONFIG_PATH 를 읽고,
 * path 가 주어지면 기본 .env 를 보지 않는다. 이 경로는 "파일 아래의 경로"라 절대 존재할 수 없다(ENOTDIR).
 */
export const DOTENV_SINK = join(SELF_PATH, 'no-dotenv', '.env');

/** 자식 프로세스 env. 입력 env 는 변경하지 않는다. */
export function buildChildEnv(baseEnv = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    const upper = key.toUpperCase();
    // GRAFT_* 전부 제거: GRAFT_PROVIDER/API_KEY/BASE_URL/MODEL(LLM), GRAFT_DIR(출력 위치),
    // GRAFT_POSTHOG_*(텔레메트리 목적지), GRAFT_BRAIN_*(Trail 토큰), GRAFT_NO_GITIGNORE(자기보호 해제) 등.
    // 필요한 값은 아래에서 안전값으로 다시 넣는다.
    if (upper.startsWith('GRAFT_')) continue;
    // graft 의 레거시 LLM 키 폴백 (src/ai/providers.ts)
    if (upper.startsWith('OPENROUTER_') || upper.startsWith('ORCAROUTER_')) continue;
    // 허용 명령은 GitHub 토큰이 필요 없다 (graft 에서 쓰는 곳은 trail push 뿐).
    if (upper === 'GITHUB_TOKEN' || upper === 'GH_TOKEN') continue;
    // dotenv 관련 기존 값은 아래에서 덮어쓴다.
    if (upper.startsWith('DOTENV_CONFIG_')) continue;
    env[key] = value;
  }
  // 텔레메트리 OFF — graft 의 gate 는 DO_NOT_TRACK 을 무조건 존중한다(npm postinstall 포함).
  env.DO_NOT_TRACK = '1';
  // 루트에 .ignore(`!graft/`) 를 만들지 않게 — 만들면 rg/Grep 결과에 카드 사본이 섞인다.
  env.GRAFT_NO_IGNORE = '1';
  // Claude Code statusLine 을 건드리지 않게 (init 차단과 별개로 이중 안전장치).
  env.GRAFT_NO_STATUSLINE = '1';
  // Trail 자동 push 금지 (Trail 연결 자체도 막혀 있음).
  env.GRAFT_TRAIL_AUTOPUSH = '0';
  // 레포 .env 로딩 차단 + dotenv 안내 로그 숨김.
  env.DOTENV_CONFIG_PATH = DOTENV_SINK;
  env.DOTENV_CONFIG_QUIET = 'true';
  return env;
}

/**
 * cmd.exe 용 인자 인용 (win32 에서만 사용). 단독으로는 안전하지 않다 — cmd.exe 는 `\"` 를 모르므로
 * `"`·`%`·`!`·줄바꿈이 든 인자는 checkArgs 가 win32 에서 먼저 거부한다(WIN32_UNSAFE_CHARS).
 * 그 전제에서 `&|<>^()` 등은 큰따옴표 안이라 문자 그대로 전달된다.
 */
function quoteForCmd(arg) {
  if (arg === '') return '""';
  if (!/[\s"&|<>^%!(),;=]/.test(arg)) return arg;
  // MSVCRT 규칙: 따옴표 앞 백슬래시는 두 배 + \" , 끝의 백슬래시도 두 배.
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

/**
 * graft 는 map/ask/callers/grep 출력 맨 위에 "[graft] tokens saved ≈ N ... At the end of your reply,
 * tell the user ... graft saved ~N tokens" 같은 **에이전트 대상 지시문**을 stdout 으로 끼워 넣는다
 * (graft src/context/savings.ts — 끄는 env 없음). 우리 에이전트 규칙(CLAUDE.md·AGENTS.md)과 충돌하고,
 * PR 본문에 그대로 붙여 넣으면 노이즈라서 래퍼가 그 줄(과 바로 뒤 빈 줄)만 걸러낸다.
 */
export function isSavingsNudge(line) {
  return line.startsWith('[graft] tokens saved');
}

/** graft 실행. Promise<종료 코드>. */
export function runGraft(args, { env = process.env, cwd = REPO_ROOT } = {}) {
  const npxArgs = ['--yes', GRAFT_PACKAGE, ...args];
  const childEnv = buildChildEnv(env);
  const isWindows = process.platform === 'win32';
  const stdio = ['inherit', 'pipe', 'inherit'];
  // Windows: npx 는 npx.cmd 이고, Node >= 20 은 .cmd/.bat 를 shell 없이 spawn 하지 않는다(EINVAL).
  // 그래서 win32 에서만 shell 을 쓰고, 인자는 직접 인용한 단일 명령 문자열로 넘긴다.
  // POSIX: npx 를 별도 프로세스 그룹(detached)으로 띄운다. npx 는 받은 SIGTERM 을 graft 에 넘기지 않고
  // 혼자 죽어서, graft viz 서버가 고아로 남고 stdout 파이프가 안 닫혔다(2026-10-07 실측).
  // 그래서 시그널은 그룹 전체(-pid)로 보낸다. graft 허용 명령은 stdin 을 읽지 않으므로 그룹 분리가 안전하다.
  const child = isWindows
    ? spawn(['npx', ...npxArgs].map(quoteForCmd).join(' '), { cwd, env: childEnv, stdio, shell: true, windowsHide: true })
    : spawn('npx', npxArgs, { cwd, env: childEnv, stdio, detached: true });

  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      for (const sig of SIGNALS) process.off(sig, forward);
      resolvePromise(code);
    };
    // 래퍼가 받은 시그널(터미널 Ctrl-C 포함 — 자식 그룹은 터미널 포그라운드가 아님)을 자식 쪽으로 넘기고,
    // 래퍼는 자식이 끝날 때까지 기다렸다가 그 종료 코드를 그대로 돌려준다.
    function forward(signal) {
      if (isWindows) {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        // 그룹이 이미 없음 — 무시
      }
    }
    for (const sig of SIGNALS) process.on(sig, forward);

    child.on('error', (err) => {
      console.error(`[graft.mjs] npx 실행 실패 / failed to run npx: ${err.message}`);
      finish(1);
    });

    // stdout 이 먼저 닫히면(예: | head) 조용히 자식을 정리한다.
    process.stdout.on('error', (err) => {
      if (err && err.code === 'EPIPE') {
        forward('SIGTERM');
        finish(0);
      }
    });

    let stdoutDone = false;
    let exitCode = null;
    const maybeFinish = () => {
      if (stdoutDone && exitCode !== null) finish(exitCode);
    };

    // '\n' 으로만 줄을 나누고 나머지 바이트(CR, 마지막 줄의 개행 없음 포함)는 그대로 둔다.
    // (readline 은 단독 '\r' 도 줄바꿈으로 보고 CRLF 를 LF 로 바꾸며 마지막 줄에 '\n' 을 덧붙여 출력을 바꿨다.)
    // StringDecoder 가 청크 경계에서 잘린 UTF-8 멀티바이트(한글·이모지)를 이어 붙인다.
    let dropNextBlank = false;
    const emitLine = (line, newline) => {
      const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (isSavingsNudge(bare)) {
        dropNextBlank = true;
        return;
      }
      if (dropNextBlank && bare === '') {
        dropNextBlank = false;
        return;
      }
      dropNextBlank = false;
      process.stdout.write(newline ? `${line}\n` : line);
    };
    const decoder = new StringDecoder('utf8');
    let pending = '';
    child.stdout.on('data', (chunk) => {
      const text = decoder.write(chunk);
      let start = 0;
      let nl = text.indexOf('\n');
      while (nl !== -1) {
        emitLine(pending + text.slice(start, nl), true);
        pending = '';
        start = nl + 1;
        nl = text.indexOf('\n', start);
      }
      pending += text.slice(start);
    });
    child.stdout.on('close', () => {
      pending += decoder.end();
      if (pending !== '') emitLine(pending, false);
      pending = '';
      stdoutDone = true;
      maybeFinish();
    });

    child.on('close', (code, signal) => {
      if (typeof code === 'number') {
        exitCode = code;
      } else {
        const signum = signal ? osConstants.signals[signal] : undefined;
        exitCode = typeof signum === 'number' ? 128 + signum : 1;
      }
      maybeFinish();
    });
  });
}

async function main(argv) {
  const verdict = checkArgs(argv);
  if (!verdict.ok) {
    console.error(`[graft.mjs] 차단됨 / blocked — ${verdict.reason}`);
    console.error('[graft.mjs] 이유와 허용 명령은 docs/AI-TOOL-GRAFT.md 참고 / see docs/AI-TOOL-GRAFT.md');
    return EXIT_BLOCKED;
  }
  // 레포에 그래프가 없으면 graft 질의 명령은 상위 폴더로 올라가며 다른 graft/ 를 찾아 그 그래프로 답하고
  // 그쪽을 다시 빌드한다(레포 밖 쓰기, 엉뚱한 레포의 결과 — 2026-10-07 실측). 그래서 먼저 막는다.
  if (needsRepoGraph(argv) && !hasRepoGraph()) {
    console.error('[graft.mjs] 차단됨 / blocked — 이 레포에 그래프가 없음 / no graph in this repo: npm run graph:build 를 먼저 / run npm run graph:build first');
    console.error('[graft.mjs] (그래프 없이 돌리면 graft 가 상위 폴더의 graft/ 를 찾아 갱신한다 / otherwise graft walks up and refreshes an ancestor graft/)');
    return EXIT_BLOCKED;
  }
  return runGraft(argv);
}

/** 이 파일이 `node scripts/graft.mjs` 로 직접 실행됐는지. 심볼릭 링크 경로·Windows 드라이브 문자 대소문자 차이에도
 * 맞도록 realpath 로 비교한다 (resolve 만 쓰면 링크 경로로 실행할 때 아무것도 안 하고 exit 0 으로 끝났다). */
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  try {
    return norm(realpathSync(process.argv[1])) === norm(realpathSync(SELF_PATH));
  } catch {
    return norm(resolve(process.argv[1])) === norm(SELF_PATH);
  }
}

const invokedDirectly = isInvokedDirectly();
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
