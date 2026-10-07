// 셰뱅(#!)은 넣지 않는다 — 실행은 항상 `node scripts/codebase-memory-mcp.mjs ...`(또는 .mcp.json 의
// node -e 부트스트랩)이고, vitest 가 이 파일을 import 해도 수집 단계에서 죽지 않게 하기 위함
// (scripts/check-mojibake-docs.mjs 와 같은 이유).
/**
 * codebase-memory-mcp 런처 — 버전 고정 + SHA-256 검증 설치 + MCP stdio 실행. (2026-10-07)
 *
 * 왜: codebase-memory-mcp(DeusData, MIT)는 레포를 tree-sitter 로 파싱해 함수·호출·라우트 그래프를
 *   로컬 SQLite 에 만들고, MCP 도구(search_graph·trace_path·detect_changes 등)로 조회하게 해 준다.
 *   그런데 공식 설치 경로(install.sh 원라이너, 바이너리의 install/update)는
 *     - releases/latest 를 받는다 (버전 고정 없음, 같은 릴리스의 checksums.txt 와만 대조)
 *     - ~/.claude.json · ~/.claude/settings.json hooks · skills · agents, 셸 rc PATH,
 *       다른 에이전트 설정 파일까지 고쳐 쓴다
 *   그래서 공식 설치기를 쓰지 않고 이 런처가
 *     1) 고정 버전(VERSION) 릴리스 자산을 HTTPS 로만 받고
 *     2) 이 파일에 박아 둔 SHA-256 과 일치할 때만 진행한다 (불일치 = 파일 삭제 + 즉시 중단)
 *     3) 아카이브 멤버 목록이 정확히 기대값인지 확인한 뒤 바이너리 1개만 꺼내
 *     4) 레포 밖 사용자 캐시 폴더에 원자적으로(rename) 설치한다.
 *   PATH · 셸 rc · 에이전트 설정 · 레포 파일은 건드리지 않는다.
 *
 * 상세(연결 방식 · 사용 예시 · 금지 목록 · 데몬 끄기 · 버전 올리기 · 제거): docs/AI-TOOL-CODEBASE-MEMORY-MCP.md
 *
 * 사용:
 *   node scripts/codebase-memory-mcp.mjs setup              # 설치만 (경로·버전은 stderr)
 *   node scripts/codebase-memory-mcp.mjs mcp                # (기본) MCP stdio 서버 — .mcp.json 이 이걸 부른다
 *   node scripts/codebase-memory-mcp.mjs path               # 설치된 바이너리 경로 (stdout)
 *   node scripts/codebase-memory-mcp.mjs run -- --version   # 유지보수용 패스스루
 *   node scripts/codebase-memory-mcp.mjs run -- config set auto_watch false
 *   node scripts/codebase-memory-mcp.mjs run -- daemon status
 *   node scripts/codebase-memory-mcp.mjs run -- daemon stop
 *
 * 환경변수: CBM_HOME = 설치 루트 변경 (기본 <OS 캐시 폴더>/cocotrip-tools). 레포 안은 거부한다.
 *
 * exit 2 = 이 런처가 차단함 (install · update · uninstall 처럼 사용자 설정을 고쳐 쓰는 명령, 잘못된 인자).
 * 그 외   = 바이너리의 exit code 그대로 (시그널로 죽으면 같은 시그널로 종료).
 *
 * mcp 모드에서 stdout 은 JSON-RPC 채널이다. 런처 로그와 설치 중 하위 프로세스 출력은 전부 stderr 로만 간다.
 * 주의: 이 파일에는 연속 물음표 두 개를 쓰지 않는다 (pre-commit mojibake 가드가 .mjs 를 검사한다).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// ── 버전 고정 ─────────────────────────────────────────────────────────────
// 올릴 때는 docs/AI-TOOL-CODEBASE-MEMORY-MCP.md "버전 올리기" 절차대로
// 새 릴리스의 checksums.txt 에서 아래 5개 해시를 통째로 교체하고, 멤버 목록·CLI 변경을 다시 확인한다.
// 해시는 태그가 아니라 "이 바이트"를 고정한다 (릴리스 워크플로가 같은 태그 자산을 재업로드할 수 있음).
export const VERSION = 'v0.11.0';
export const RELEASE_BASE_URL = `https://github.com/DeusData/codebase-memory-mcp/releases/download/${VERSION}`;

const UNIX_MEMBERS = Object.freeze(['codebase-memory-mcp', 'LICENSE', 'install.sh', 'THIRD_PARTY_NOTICES.md']);
const WINDOWS_MEMBERS = Object.freeze(['codebase-memory-mcp.exe', 'LICENSE', 'install.ps1', 'THIRD_PARTY_NOTICES.md']);

// 키 = `${process.platform}-${아키텍처}`. sha256 = v0.11.0 checksums.txt 원문 그대로 (2026-10-07 재확인).
// Linux 는 glibc 의존이 없는 "-portable"(정적) 빌드만 쓴다 — 공식 install.sh 와 같은 선택.
export const ASSETS = Object.freeze({
  'linux-x64': Object.freeze({
    file: 'codebase-memory-mcp-linux-amd64-portable.tar.gz',
    sha256: '1f9e8293eb2bc5c05cfa27a7e8fc033da6d729ffad525ccfcdaa3fd606306683',
    format: 'tar.gz',
    binary: 'codebase-memory-mcp',
    members: UNIX_MEMBERS,
  }),
  'linux-arm64': Object.freeze({
    file: 'codebase-memory-mcp-linux-arm64-portable.tar.gz',
    sha256: 'd62eeb224d5ee3eba3070938ec62cf1033f10b041ec1c4b2fb67f7aef390cc7b',
    format: 'tar.gz',
    binary: 'codebase-memory-mcp',
    members: UNIX_MEMBERS,
  }),
  'darwin-arm64': Object.freeze({
    file: 'codebase-memory-mcp-darwin-arm64.tar.gz',
    sha256: '4dee7f38b63740e6751d7a7ed7eb10291c1f2a3ea2415f599dc68370ca0a2d18',
    format: 'tar.gz',
    binary: 'codebase-memory-mcp',
    members: UNIX_MEMBERS,
  }),
  'darwin-x64': Object.freeze({
    file: 'codebase-memory-mcp-darwin-amd64.tar.gz',
    sha256: 'dbf1c73bfcbde64e7dde4cd1320da7afc02e2c972ee1789ae039521411f5132e',
    format: 'tar.gz',
    binary: 'codebase-memory-mcp',
    members: UNIX_MEMBERS,
  }),
  'win32-x64': Object.freeze({
    file: 'codebase-memory-mcp-windows-amd64.zip',
    sha256: '6eb6beaf261b19e419766e78baf93cbc3cf1c6338cff8fb7c0234859f96d1685',
    format: 'zip',
    binary: 'codebase-memory-mcp.exe',
    members: WINDOWS_MEMBERS,
  }),
});

// 바이너리의 최상위 모드 토큰 (v0.11.0 태그의 src/daemon/bootstrap.c cbm_daemon_process_role 과 같은 규칙:
// 왼쪽부터 처음 만나는 토큰 하나가 모드를 정한다. `cli` 뒤의 인자는 도구 입력이라 무시된다).
// `test-impact` 는 v0.11.0 이후 main 에만 있다 — v0.11.0 에서는 모드가 아니라서 넣으면 `run -- test-impact` 가
// --ui=false 없는 MCP 서버를 띄운다. 버전을 올릴 때 이 목록을 그 태그의 bootstrap.c 와 다시 맞출 것.
const MODE_TOKENS = new Set([
  'cli', 'hook-augment', 'config', 'daemon', '--version', '--help', '-h',
  'install', 'uninstall', 'update', 'allow-root',
]);
const REFUSED_MODES = new Map([
  ['install', '~/.claude.json · ~/.claude/settings.json hooks · skills · agents, 셸 rc PATH, 다른 에이전트 설정을 고쳐 쓴다'],
  ['update', 'releases/latest 로 바꿔 끼우고(버전 고정 해제) 에이전트 설정을 다시 쓴다'],
  ['uninstall', '이 런처가 만들지 않은 사용자 설정 파일들을 고쳐 쓴다 — 제거는 문서의 "제거" 절차로'],
]);
// 바이너리 내부 전용 인자 (데몬·인덱스 워커 역할). 사람이 넘길 일이 없다.
const INTERNAL_ARGS = new Set(['--cbm-daemon-internal', '--cbm-daemon-permanent', '--index-worker']);

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF_PATH), '..');
const LOG_PREFIX = '[codebase-memory-mcp launcher]';
const STALE_STAGING_MS = 60 * 60 * 1000;
const MIN_BINARY_BYTES = 1024 * 1024;

class LauncherError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function log(message) {
  // stdout 금지 — mcp 모드에서 stdout 은 JSON-RPC 프레임 전용.
  process.stderr.write(`${LOG_PREFIX} ${message}\n`);
}

// ── 경로 ─────────────────────────────────────────────────────────────────
export function resolveToolsRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.CBM_HOME) return path.resolve(env.CBM_HOME);
  let cacheBase;
  if (platform === 'win32') {
    cacheBase = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  } else if (platform === 'darwin') {
    cacheBase = path.join(home, 'Library', 'Caches');
  } else {
    const xdg = env.XDG_CACHE_HOME;
    cacheBase = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, '.cache');
  }
  return path.join(cacheBase, 'cocotrip-tools');
}

export function resolveInstallDir(env = process.env) {
  return path.join(resolveToolsRoot(env), 'codebase-memory-mcp', VERSION);
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function assertOutsideRepo(dir) {
  if (isInside(path.resolve(dir), REPO_ROOT)) {
    throw new LauncherError(`설치 경로가 레포 안이다 (${dir}). CBM_HOME 을 레포 밖으로 지정할 것.`, 2);
  }
}

function isRegularFile(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isFile() && st.size >= MIN_BINARY_BYTES;
  } catch {
    return false;
  }
}

// ── 하위 프로세스 ─────────────────────────────────────────────────────────
// capture=false 면 자식의 stdout/stderr 를 둘 다 우리 stderr(fd 2)로 보낸다 → stdout 은 깨끗하게 유지.
function runChild(cmd, args, { capture = false, silent = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let child;
    const out = silent ? 'ignore' : 2;
    try {
      child = spawn(cmd, args, {
        stdio: ['ignore', capture ? 'pipe' : out, capture ? 'pipe' : out],
        windowsHide: true,
      });
    } catch (error) {
      done({ code: null, signal: null, error, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
    }
    child.on('error', (error) => done({ code: null, signal: null, error, stdout, stderr }));
    child.on('close', (code, signal) => done({ code, signal, error: null, stdout, stderr }));
  });
}

async function detectPlatformKey() {
  let arch = process.arch;
  if (process.platform === 'darwin' && arch === 'x64') {
    // Rosetta 아래의 x64 node 라도 실제 기계가 Apple Silicon 이면 arm64 빌드를 받는다 (공식 install.sh 와 같은 판단).
    const r = await runChild('sysctl', ['-in', 'sysctl.proc_translated'], { capture: true });
    if (r.code === 0 && r.stdout.trim() === '1') arch = 'arm64';
  }
  return `${process.platform}-${arch}`;
}

async function resolveAsset() {
  const key = await detectPlatformKey();
  const asset = ASSETS[key];
  if (!asset) {
    throw new LauncherError(`지원하지 않는 플랫폼: ${key} (지원: ${Object.keys(ASSETS).join(', ')})`);
  }
  return asset;
}

// ── 다운로드 + 검증 ──────────────────────────────────────────────────────
async function download(url, dest) {
  // curl 우선: HTTPS_PROXY 를 따르고(클라우드 세션 프록시), https 외 프로토콜·리다이렉트를 거부한다.
  const r = await runChild('curl', [
    '-fsSL', '--proto', '=https', '--proto-redir', '=https',
    '--retry', '3', '--connect-timeout', '30',
    '-o', dest, url,
  ]);
  if (r.error && r.error.code === 'ENOENT') {
    log('curl 이 없어 Node fetch 로 받는다 (주의: Node fetch 는 HTTPS_PROXY 를 따르지 않는다).');
    await fetchDownload(url, dest);
    return;
  }
  if (r.error) throw new LauncherError(`curl 실행 실패: ${r.error.message}`);
  if (r.code !== 0) throw new LauncherError(`다운로드 실패 (curl exit ${r.code}${r.signal ? `, ${r.signal}` : ''}): ${url}`);
}

async function fetchDownload(url, dest) {
  if (typeof fetch !== 'function') throw new LauncherError('curl 도 fetch 도 없어 다운로드할 수 없다.');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new LauncherError(`다운로드 실패 (HTTP ${res.status}): ${url}`);
  if (!String(res.url).startsWith('https://')) throw new LauncherError(`https 가 아닌 곳으로 리다이렉트됨: ${res.url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// 멤버 목록이 정확히 기대 집합과 같아야 한다 (추가·누락·중복·절대경로·'..' 전부 거부).
export function validateMemberList(names, asset) {
  for (const name of names) {
    if (!name || path.isAbsolute(name) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new LauncherError(`아카이브에 위험한 경로가 있다: ${JSON.stringify(name)}`);
    }
  }
  const got = [...names].sort();
  const expected = [...asset.members].sort();
  const same = got.length === expected.length && got.every((n, i) => n === expected[i]);
  if (!same) {
    throw new LauncherError(`아카이브 멤버가 기대와 다르다: ${JSON.stringify(names)} (기대: ${JSON.stringify(asset.members)})`);
  }
}

async function listTarMembers(archive) {
  const r = await runChild('tar', ['-tzf', archive], { capture: true });
  if (r.error || r.code !== 0) {
    throw new LauncherError(`tar 목록 조회 실패: ${(r.error && r.error.message) || r.stderr.trim()}`);
  }
  return r.stdout.split(/\r?\n/).filter((line) => line !== '');
}

async function extractTarMember(archive, member, outDir) {
  const r = await runChild('tar', ['--no-same-owner', '-xzf', archive, '-C', outDir, member]);
  if (r.error || r.code !== 0) {
    throw new LauncherError(`tar 추출 실패 (exit ${r.code}): ${(r.error && r.error.message) || ''}`);
  }
}

// zip 은 Node 만으로 읽는다. Windows 의 PATH 첫 `tar` 가 Git Bash 의 GNU tar(zip 못 읽음)일 수 있어서
// 시스템 도구에 기대지 않는다. 릴리스 zip 은 단일 디스크·zip64 없음·deflate/stored 만 쓴다 — 그 외는 거부.
async function readExactly(fh, length, position) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) throw new LauncherError('zip 읽기 실패 (파일이 잘림)');
  return buf;
}

export async function readZipEntries(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = await readExactly(fh, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new LauncherError('zip 끝 레코드(EOCD)를 찾지 못했다');
    const disk = tail.readUInt16LE(eocd + 4);
    const cdDisk = tail.readUInt16LE(eocd + 6);
    const countHere = tail.readUInt16LE(eocd + 8);
    const total = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (disk !== 0 || cdDisk !== 0 || countHere !== total || total === 0xffff
      || cdSize === 0xffffffff || cdOffset === 0xffffffff || cdOffset + cdSize > size) {
      throw new LauncherError('지원하지 않는 zip 형식 (멀티디스크/zip64/손상)');
    }
    const cd = await readExactly(fh, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < total; i += 1) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new LauncherError('zip 중앙 디렉터리 손상');
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      entries.push({
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
        flags: cd.readUInt16LE(p + 8),
        method: cd.readUInt16LE(p + 10),
        crc32: cd.readUInt32LE(p + 16),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localHeaderOffset: cd.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

export async function extractZipEntry(file, entry, dest) {
  if (entry.flags & 0x1) throw new LauncherError('암호화된 zip 멤버는 거부');
  if (entry.method !== 0 && entry.method !== 8) throw new LauncherError(`지원하지 않는 zip 압축 방식: ${entry.method}`);
  if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.compressedSize === 0) {
    throw new LauncherError('지원하지 않는 zip 멤버 크기 (zip64/빈 파일)');
  }
  const fh = await fs.promises.open(file, 'r');
  let dataStart;
  try {
    const lh = await readExactly(fh, 30, entry.localHeaderOffset);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new LauncherError('zip 로컬 헤더 손상');
    dataStart = entry.localHeaderOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  let written = 0;
  let crc = 0;
  const hasCrc = typeof zlib.crc32 === 'function';
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      // 선언 크기를 넘는 순간 중단 (끝까지 푼 뒤 비교하면 zip bomb 이 디스크를 먼저 채운다).
      if (written > entry.size) {
        cb(new LauncherError(`zip 멤버가 선언 크기(${entry.size})를 넘는다`));
        return;
      }
      if (hasCrc) crc = zlib.crc32(chunk, crc);
      cb(null, chunk);
    },
  });
  const source = fs.createReadStream(file, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
  const sink = fs.createWriteStream(dest, { flags: 'wx', mode: 0o755 });
  if (entry.method === 8) await pipeline(source, zlib.createInflateRaw(), meter, sink);
  else await pipeline(source, meter, sink);
  if (written !== entry.size) throw new LauncherError(`zip 멤버 크기 불일치 (${written} != ${entry.size})`);
  if (hasCrc && (crc >>> 0) !== entry.crc32) throw new LauncherError('zip 멤버 CRC32 불일치');
}

async function listMembers(archive, asset) {
  if (asset.format === 'zip') {
    const entries = await readZipEntries(archive);
    return { names: entries.map((e) => e.name), entries };
  }
  return { names: await listTarMembers(archive), entries: null };
}

async function extractBinary(archive, asset, listing, outDir) {
  if (asset.format === 'zip') {
    const entry = listing.entries.find((e) => e.name === asset.binary);
    await extractZipEntry(archive, entry, path.join(outDir, asset.binary));
  } else {
    await extractTarMember(archive, asset.binary, outDir);
  }
}

function cleanupStaleStaging(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('.staging-')) continue;
      const p = path.join(dir, name);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > STALE_STAGING_MS) fs.rmSync(p, { recursive: true, force: true });
      } catch {
        // 다른 런처가 막 지운 경우 — 무시
      }
    }
  } catch {
    // best-effort
  }
}

// ── 설치 ─────────────────────────────────────────────────────────────────
export async function ensureInstalled() {
  const asset = await resolveAsset();
  const dir = resolveInstallDir();
  assertOutsideRepo(dir);
  const bin = path.join(dir, asset.binary);
  if (isRegularFile(bin)) {
    // 중단된 설치(예: MCP 연결 타임아웃으로 kill)의 staging 잔여물(최대 약 340MB)은 설치가 끝난 뒤에도 지운다.
    cleanupStaleStaging(dir);
    return { bin, fresh: false };
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  cleanupStaleStaging(dir);
  // 같은 폴더 안 임시 폴더 → 마지막 rename 이 같은 파일시스템 안의 원자적 교체가 된다.
  // 동시에 여러 런처가 첫 실행을 해도 각자 자기 staging 에서 검증하고, 먼저 끝난 쪽이 자리를 잡는다.
  const staging = fs.mkdtempSync(path.join(dir, '.staging-'));
  try {
    const started = Date.now();
    const archive = path.join(staging, asset.file);
    const url = `${RELEASE_BASE_URL}/${asset.file}`;
    log(`${VERSION} 첫 설치: ${asset.file} 다운로드 (약 40MB, 압축 해제 후 바이너리 약 300MB)`);
    await download(url, archive);

    const actual = await sha256File(archive);
    if (actual !== asset.sha256) {
      fs.rmSync(archive, { force: true });
      throw new LauncherError(
        `SHA-256 불일치 — 설치 중단, 받은 파일 삭제함.\n  기대: ${asset.sha256}\n  실제: ${actual}\n`
        + '  변조/손상 가능성. 해시를 고치지 말고 docs/AI-TOOL-CODEBASE-MEMORY-MCP.md 의 버전 올리기 절차로 확인할 것.',
      );
    }
    log(`SHA-256 일치 (${actual})`);

    const listing = await listMembers(archive, asset);
    validateMemberList(listing.names, asset);

    const outDir = path.join(staging, 'out');
    fs.mkdirSync(outDir);
    await extractBinary(archive, asset, listing, outDir);
    const staged = path.join(outDir, asset.binary);
    const st = fs.lstatSync(staged);
    if (!st.isFile() || st.size < MIN_BINARY_BYTES) throw new LauncherError('추출된 바이너리가 일반 파일이 아니거나 너무 작다');
    fs.chmodSync(staged, 0o755);

    if (process.platform === 'darwin') {
      // 공식 install.sh 와 같은 처리: 격리 속성 제거 + ad-hoc 서명 (실패해도 진행, 아래 --version 이 최종 판정).
      await runChild('xattr', ['-d', 'com.apple.quarantine', staged], { silent: true });
      await runChild('codesign', ['--sign', '-', '--force', staged], { silent: true });
    }

    const v = await runChild(staged, ['--version'], { capture: true });
    const want = `codebase-memory-mcp ${VERSION.replace(/^v/, '')}`;
    if (v.error || v.code !== 0 || !v.stdout.includes(want)) {
      const detail = v.error ? v.error.message : `${v.stdout}${v.stderr}`.trim();
      throw new LauncherError(`설치 후보의 --version 확인 실패 (기대 "${want}"): ${detail}`);
    }

    if (!isRegularFile(bin)) {
      try {
        fs.renameSync(staged, bin);
      } catch (error) {
        // 동시 실행: 다른 런처가 먼저 자리를 잡았으면 그걸 쓴다 (Windows 는 실행 중 파일 교체 불가).
        if (!isRegularFile(bin)) throw error;
      }
    }
    log(`설치 완료: ${bin} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    return { bin, fresh: true };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// ── 첫 실행 UI 차단 ──────────────────────────────────────────────────────
// 바이너리는 <캐시>/config.json 이 없으면 데몬 시작 시 그래프 UI(127.0.0.1:9749)를 자동으로 켠다 (src/ui/config.c).
// 그리고 --ui=false 는 설정 파일만 고칠 뿐 이미 떠 있는 UI 를 끄지 않는다 (src/daemon/application.c
// application_set_ui_config) → 첫 세션 내내 UI 가 떠 있게 된다 (2026-10-07 daemon log 의 ui.serving 으로 확인).
// 그래서 파일이 없을 때만 바이너리가 쓰는 것과 같은 형식으로 ui_enabled:false 를 미리 만든다. 있으면 손대지 않는다.
// 캐시 경로 규칙은 바이너리와 같다: CBM_CACHE_DIR, 없으면 $HOME(또는 USERPROFILE)/.cache/codebase-memory-mcp.
export function resolveCbmCacheDir(env = process.env) {
  if (env.CBM_CACHE_DIR) return path.resolve(env.CBM_CACHE_DIR);
  return path.join(env.HOME || env.USERPROFILE || os.homedir(), '.cache', 'codebase-memory-mcp');
}

function seedUiDisabledConfig() {
  const cacheDir = resolveCbmCacheDir();
  const file = path.join(cacheDir, 'config.json');
  try {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify({ ui_enabled: false, ui_port: 9749 }, null, 4)}\n`, { flag: 'wx', mode: 0o600 });
    log(`첫 실행: UI 자동 켜짐 방지 설정 생성 ${file} (ui_enabled:false)`);
  } catch (error) {
    if (error.code !== 'EEXIST') log(`경고: UI 설정 파일을 미리 만들지 못했다 (${error.message}) — 첫 데몬이 UI 를 켤 수 있다.`);
  }
}

// ── 인자 검사 ────────────────────────────────────────────────────────────
export function firstModeToken(args) {
  for (const arg of args) if (MODE_TOKENS.has(arg)) return arg;
  return null;
}

// 차단 사유 문자열 또는 null.
export function refusalReason(args) {
  for (const arg of args) {
    if (INTERNAL_ARGS.has(arg)) return `${arg} 는 바이너리 내부 전용 인자다`;
  }
  // 첫 모드 토큰만 보면 부족하다: 바이너리의 handle_subcommand 는 `daemon` 을 모르는 채 왼쪽부터 다시 훑어서
  // `daemon install --help` 같은 인자가 install 코드에 닿는다. 그래서 `cli` 앞이면 위치와 무관하게 막는다
  // (`cli` 뒤는 도구 입력이라 바이너리도 모드로 보지 않는다 — 예: 검색어 "update").
  const cliAt = args.indexOf('cli');
  const mode = (cliAt < 0 ? args : args.slice(0, cliAt)).find((a) => REFUSED_MODES.has(a));
  if (mode) return `\`${mode}\` 차단 — ${REFUSED_MODES.get(mode)}`;
  return null;
}

// ── 실행 (stdio 상속, exit code·시그널 전달) ──────────────────────────────
function execForward(bin, args) {
  return new Promise(() => {
    const child = spawn(bin, args, { stdio: 'inherit', windowsHide: true });
    const handlers = new Map();
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill(sig); } catch { /* 이미 종료 */ }
        }
      };
      handlers.set(sig, handler);
      process.on(sig, handler);
    }
    child.on('error', (error) => {
      log(`바이너리 실행 실패: ${error.message}`);
      process.exit(1);
    });
    child.on('exit', (code, signal) => {
      for (const [sig, handler] of handlers) process.off(sig, handler);
      if (signal) {
        const signum = os.constants.signals[signal] || 1;
        setTimeout(() => process.exit(128 + signum), 200).unref();
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code === null ? 1 : code);
    });
  });
}

function usage() {
  return [
    `codebase-memory-mcp 런처 (고정 버전 ${VERSION}) — 상세: docs/AI-TOOL-CODEBASE-MEMORY-MCP.md`,
    '',
    '  node scripts/codebase-memory-mcp.mjs setup            설치만 (SHA-256 검증)',
    '  node scripts/codebase-memory-mcp.mjs mcp [--flag...]  MCP stdio 서버 (--ui=false 고정, 기본 명령)',
    '  node scripts/codebase-memory-mcp.mjs path             설치된 바이너리 경로',
    '  node scripts/codebase-memory-mcp.mjs run -- <args>    바이너리 패스스루 (install/update/uninstall 차단)',
    '',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const [command = 'mcp', ...rest] = argv;
  try {
    switch (command) {
      case 'setup': {
        if (rest.length) throw new LauncherError('setup 은 인자를 받지 않는다', 2);
        const { bin, fresh } = await ensureInstalled();
        log(`${fresh ? '준비 완료' : '이미 설치됨'}: ${bin} (${VERSION})`);
        process.exitCode = 0;
        return;
      }
      case 'path': {
        if (rest.length) throw new LauncherError('path 는 인자를 받지 않는다', 2);
        const asset = await resolveAsset();
        const bin = path.join(resolveInstallDir(), asset.binary);
        process.stdout.write(`${bin}\n`);
        if (!isRegularFile(bin)) {
          log('아직 설치되지 않았다 — `node scripts/codebase-memory-mcp.mjs setup` 먼저.');
          process.exitCode = 1;
        }
        return;
      }
      case 'mcp': {
        // 추가 인자는 서버 플래그(--tool-profile=analysis 등)만. 모드 토큰이 섞이면 MCP 서버가 아니게 된다.
        // --ui 는 받지 않는다: 바이너리는 마지막 --ui= 를 따르고 그 값을 config.json 에 저장하므로
        // `mcp --ui=true` 가 아래의 --ui=false 를 덮어써 9749 를 열고 다음 세션까지 켜 둔다.
        const bad = rest.find((a) => !a.startsWith('--') || MODE_TOKENS.has(a) || INTERNAL_ARGS.has(a) || /^--ui(=|$)/.test(a));
        if (bad !== undefined) throw new LauncherError(`mcp 모드에는 서버 플래그만 넘길 수 있다 (--ui 는 false 고정): ${bad}`, 2);
        const { bin } = await ensureInstalled();
        seedUiDisabledConfig();
        await execForward(bin, ['--ui=false', ...rest]);
        return;
      }
      case 'run': {
        const args = rest[0] === '--' ? rest.slice(1) : rest;
        const reason = refusalReason(args);
        if (reason) throw new LauncherError(reason, 2);
        // 모드 토큰이 없으면 바이너리는 MCP 서버로 뜬다 (--ui=false 없이). 서버는 `mcp` 로만 띄운다.
        if (!firstModeToken(args)) {
          throw new LauncherError('run 은 유지보수 명령 전용이다 (예: --version, config ..., daemon ..., cli ...). MCP 서버는 `mcp`.', 2);
        }
        const { bin } = await ensureInstalled();
        seedUiDisabledConfig();
        await execForward(bin, args);
        return;
      }
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(usage());
        return;
      default:
        process.stderr.write(usage());
        throw new LauncherError(`알 수 없는 명령: ${command}`, 2);
    }
  } catch (error) {
    if (error instanceof LauncherError) {
      log(`오류: ${error.message}`);
      process.exit(error.exitCode);
    }
    log(`예상하지 못한 오류: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    const norm = (p) => {
      const real = fs.realpathSync(p);
      return process.platform === 'win32' ? real.toLowerCase() : real;
    };
    return norm(process.argv[1]) === norm(SELF_PATH);
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
