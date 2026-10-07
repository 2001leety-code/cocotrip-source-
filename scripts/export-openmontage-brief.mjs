#!/usr/bin/env node
/**
 * OpenMontage 영상 brief 내보내기 CLI.
 *
 *   npm run marketing:video-brief -- --tour gyeongju-day-tour
 *   npm run marketing:video-brief -- --all --locale en,ko --platform youtube --seconds 45
 *
 * 하는 일: src/data/tours.ts(정적 카탈로그)를 Vite ssrLoadModule 로 읽어
 *   <out>/<slug>/<locale>/{brief.json, prompt.md, CREDITS.txt, photos/} 를 만든다.
 *   변환 로직은 전부 scripts/lib/openmontage-brief.mjs(순수 함수). 여기서는 파일 I/O 만 한다.
 *
 * 하지 않는 일: 네트워크·env·Firestore 접근 없음(.env 도 읽지 않게 Vite envDir:false).
 *   어드민(Firestore) 등록 투어는 운영 자격증명이 필요해 범위 밖이다.
 *   OpenMontage 자체는 실행하지 않는다 — 절차는 docs/MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md.
 *
 * 종료 코드: 0 = 전부 생성, 1 = 일부 locale 을 데이터 부족으로 건너뜀, 2 = 잘못된 인자.
 */

import { copyFileSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_BUDGET_USD,
  DEFAULT_PLATFORM,
  DEFAULT_SECONDS,
  LOCALES,
  PLATFORM_PROFILES,
  buildCreditsText,
  buildOpenMontageBrief,
  buildOpenMontagePrompt,
  collectTourPhotoSources,
  validateOpenMontageBrief,
} from './lib/openmontage-brief.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
export const DEFAULT_OUT = 'outputs/openmontage-briefs';
const MAX_BUDGET_USD = 20;
/** 배포·번들에 들어가는 위치 — 여기로는 절대 쓰지 않는다. */
const FORBIDDEN_OUT_DIRS = ['public', 'src', 'api', 'dist'];

export const USAGE = `사용법 / Usage:
  npm run marketing:video-brief -- (--tour <slug|id>[,<slug|id>...] | --all) [옵션]

옵션 / Options:
  --tour <slug|id>     투어 slug 또는 id. 쉼표로 여러 개 / tour slug or id, comma-separated
  --all                정적 투어 전부 / every static tour in src/data/tours.ts
  --locale <list>      ko,en,ja,zh 중 선택 (기본: 4개 전부) / default: all four
  --platform <name>    instagram | youtube | tiktok (기본 ${DEFAULT_PLATFORM})
                       → instagram_reels / youtube_shorts / tiktok 프로필
  --seconds <n>        영상 길이(초), 기본 ${DEFAULT_SECONDS} / video length, default ${DEFAULT_SECONDS}
                       상한: instagram 90, youtube 60, tiktok 600
  --budget <usd>       OpenMontage 유료 호출 예산 상한(0~${MAX_BUDGET_USD}), 기본 ${DEFAULT_BUDGET_USD}
  --out <dir>          출력 폴더, 기본 ${DEFAULT_OUT} (gitignore 대상 outputs/)
  -h, --help           이 도움말 / this help

출력 / Output:
  <out>/<slug>/<locale>/brief.json   OpenMontage brief.schema.json (v1.0) 형식
  <out>/<slug>/<locale>/prompt.md    OpenMontage 에서 연 Claude Code 에 붙여넣을 지시문
  <out>/<slug>/<locale>/CREDITS.txt  사진 출처표기 (파일명 기준 추정, 확인 필요)
  <out>/<slug>/<locale>/photos/      public/ 의 로컬 사진 사본 (http URL 은 복사 안 함)
                                     locale 마다 따로 복사돼 크다 — --all 4개 locale 은 수백 MB
                                     / copied per locale: --all with 4 locales writes several hundred MB

네트워크·env·Firestore 를 쓰지 않는다. 가격·평점 필드는 만들지 않는다.
No network, no env vars, no Firestore. No price or rating fields are produced.
절차 / Runbook: docs/MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md`;

export class UsageError extends Error {}

function takeValue(argv, i, flag) {
  const arg = argv[i];
  const eq = arg.indexOf('=');
  if (eq !== -1) return { value: arg.slice(eq + 1), next: i };
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} 에 값이 없습니다 / ${flag} needs a value`);
  return { value, next: i + 1 };
}

function splitList(value) {
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/** argv(node, script 제외) → 옵션. 잘못되면 UsageError. */
export function parseArgs(argv) {
  const opts = {
    help: false,
    all: false,
    tours: [],
    locales: [...LOCALES],
    platform: DEFAULT_PLATFORM,
    seconds: DEFAULT_SECONDS,
    budgetUsd: DEFAULT_BUDGET_USD,
    out: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (flag === '-h' || flag === '--help') {
      opts.help = true;
      continue;
    }
    if (flag === '--all') {
      opts.all = true;
      continue;
    }
    if (!['--tour', '--locale', '--platform', '--seconds', '--budget', '--out'].includes(flag)) {
      throw new UsageError(`알 수 없는 인자 / unknown argument: ${arg}`);
    }
    const { value, next } = takeValue(argv, i, flag);
    i = next;
    if (flag === '--tour') {
      opts.tours.push(...splitList(value));
    } else if (flag === '--locale') {
      const list = splitList(value);
      const bad = list.filter((l) => !LOCALES.includes(l));
      if (list.length === 0 || bad.length > 0) {
        throw new UsageError(`--locale 은 ${LOCALES.join(',')} 중에서 / --locale must be from ${LOCALES.join(',')} (got: ${value})`);
      }
      opts.locales = Array.from(new Set(list));
    } else if (flag === '--platform') {
      if (!Object.prototype.hasOwnProperty.call(PLATFORM_PROFILES, value)) {
        throw new UsageError(`--platform 은 ${Object.keys(PLATFORM_PROFILES).join(' | ')} / --platform must be ${Object.keys(PLATFORM_PROFILES).join(' | ')} (got: ${value})`);
      }
      opts.platform = value;
    } else if (flag === '--seconds') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) throw new UsageError(`--seconds 는 1 이상의 숫자 / --seconds must be a number >= 1 (got: ${value})`);
      opts.seconds = n;
    } else if (flag === '--budget') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > MAX_BUDGET_USD) {
        throw new UsageError(`--budget 은 0~${MAX_BUDGET_USD} USD / --budget must be 0 to ${MAX_BUDGET_USD} USD (got: ${value})`);
      }
      opts.budgetUsd = n;
    } else if (flag === '--out') {
      if (!value.trim()) throw new UsageError('--out 이 비었습니다 / --out is empty');
      opts.out = value;
    }
  }
  if (opts.help) return opts;
  if (opts.all && opts.tours.length > 0) throw new UsageError('--tour 와 --all 은 함께 쓸 수 없습니다 / use either --tour or --all');
  if (!opts.all && opts.tours.length === 0) throw new UsageError('--tour <slug|id> 또는 --all 이 필요합니다 / --tour <slug|id> or --all is required');
  const max = PLATFORM_PROFILES[opts.platform].max_seconds;
  if (opts.seconds > max) {
    throw new UsageError(`${opts.platform} 는 최대 ${max}초 / ${opts.platform} allows at most ${max} seconds (got: ${opts.seconds})`);
  }
  return opts;
}

/** 존재하는 가장 가까운 조상까지 realpath 로 풀고 아직 없는 나머지를 붙인다(심볼릭 링크 경유 차단용). */
function realpathLoose(p) {
  const rest = [];
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p;
      rest.unshift(basename(cur));
      cur = parent;
    }
  }
}

function dirIdentity(p) {
  try {
    const st = statSync(p, { bigint: true });
    return st.ino === 0n ? null : `${st.dev}:${st.ino}`; // ino 를 못 주는 FS 에서는 비교하지 않는다
  } catch {
    return null;
  }
}

/** target 자신 또는 그 조상이 dir 과 같은 디렉터리(dev+ino)인가 — 대소문자 무시 FS("PUBLIC/") 우회 차단. */
function isSameOrInsideDir(target, dir) {
  const want = dirIdentity(dir);
  if (!want) return false;
  for (let cur = target; ; cur = dirname(cur)) {
    if (dirIdentity(cur) === want) return true;
    if (dirname(cur) === cur) return false;
  }
}

/**
 * --out 을 절대경로로(기본값은 레포 루트 기준, 직접 준 값은 cwd 기준). 배포 디렉터리 안이면 거부.
 * 글자 비교만 하면 public/ 을 가리키는 심볼릭 링크(또는 그 링크 아래 경로)로 우회되므로 realpath·inode 로도 본다.
 */
export function resolveOutDir(out, cwd = process.cwd()) {
  const abs = out === DEFAULT_OUT ? resolve(ROOT, out) : resolve(cwd, out);
  const real = realpathLoose(abs);
  const inside = (p, dir) => p === dir || p.startsWith(dir + sep);
  for (const d of FORBIDDEN_OUT_DIRS) {
    const forbidden = join(ROOT, d);
    if (inside(abs, forbidden) || inside(real, realpathLoose(forbidden)) || isSameOrInsideDir(real, forbidden)) {
      throw new UsageError(`--out 을 ${d}/ 안에 둘 수 없습니다(배포 대상) / --out must not be inside ${d}/`);
    }
  }
  const rootId = dirIdentity(ROOT);
  if (abs === ROOT || real === realpathLoose(ROOT) || (rootId && dirIdentity(real) === rootId)) {
    throw new UsageError('--out 을 레포 루트로 둘 수 없습니다 / --out must not be the repo root');
  }
  return abs;
}

/** /public 기준 경로 → 절대경로. public/ 밖으로 나가면 null. */
function publicFile(source) {
  const abs = resolve(PUBLIC_DIR, `.${source}`);
  if (!abs.startsWith(PUBLIC_DIR + sep)) return null;
  return abs;
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** src/data/tours.ts 를 Vite 로 읽는다('@' alias 는 vite.config.ts 와 같게). 서버는 finally 에서 닫는다. */
async function loadTourData() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    configFile: false,
    envDir: false,
    appType: 'custom',
    logLevel: 'error',
    clearScreen: false,
    resolve: { alias: { '@': resolve(ROOT, 'src') } },
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [], entries: [] },
  });
  try {
    const mod = await server.ssrLoadModule('/src/data/tours.ts');
    if (!Array.isArray(mod.TOURS) || typeof mod.isUngroundedBadgeTag !== 'function') {
      throw new Error('src/data/tours.ts 에서 TOURS / isUngroundedBadgeTag 를 찾지 못했습니다');
    }
    return { tours: mod.TOURS, isUngroundedBadgeTag: mod.isUngroundedBadgeTag };
  } finally {
    await server.close();
  }
}

function selectTours(all, wanted, opts) {
  if (opts.all) return { selected: all, unknown: [] };
  const selected = [];
  const unknown = [];
  for (const key of wanted) {
    const t = all.find((x) => x.slug === key || x.id === key);
    if (!t) unknown.push(key);
    else if (!selected.includes(t)) selected.push(t);
  }
  return { selected, unknown };
}

function writeLocale(outDir, tour, locale, result, prompt, credits) {
  const dir = join(outDir, tour.slug, locale);
  const photosDir = join(dir, 'photos');
  rmSync(photosDir, { recursive: true, force: true });
  mkdirSync(photosDir, { recursive: true });
  for (const p of result.photos) {
    const src = publicFile(p.source);
    if (!src) throw new Error(`public/ 밖 경로는 복사하지 않습니다 / refusing to copy outside public/: ${p.source}`);
    copyFileSync(src, join(dir, p.file));
  }
  writeFileSync(join(dir, 'brief.json'), `${JSON.stringify(result.brief, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'prompt.md'), prompt, 'utf8');
  writeFileSync(join(dir, 'CREDITS.txt'), credits, 'utf8');
  return dir;
}

export async function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  let opts;
  let outDir;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      io.log(USAGE);
      return 0;
    }
    outDir = resolveOutDir(opts.out);
  } catch (err) {
    if (err instanceof UsageError) {
      io.error(`오류 / Error: ${err.message}\n`);
      io.error(USAGE);
      return 2;
    }
    throw err;
  }

  const { tours, isUngroundedBadgeTag } = await loadTourData();
  const { selected, unknown } = selectTours(tours, opts.tours, opts);
  if (unknown.length > 0) {
    io.error(`오류 / Error: 알 수 없는 투어 / unknown tour: ${unknown.join(', ')}`);
    io.error(`가능한 slug / valid slugs: ${tours.map((t) => t.slug).join(', ')}\n`);
    io.error(USAGE);
    return 2;
  }

  // KTO 재인코딩본(id_제목.webp) 크레딧 복원용: public/ 루트의 Type*_ 원본 파일명
  const knownFiles = readdirSync(PUBLIC_DIR).filter((f) => /^Type[1-4]_/.test(f));
  const generatedAt = new Date().toISOString();
  const relOut = relative(ROOT, outDir) || '.';
  if (relOut.startsWith('..') || !(relOut === 'outputs' || relOut.startsWith(`outputs${sep}`))) {
    io.log(`참고 / Note: ${outDir} 는 기본 outputs/ 밖입니다 — git 에 올라가지 않게 직접 확인하세요 / outside outputs/, make sure it is not committed.`);
  }

  let failed = 0;
  let written = 0;
  for (const tour of selected) {
    const missing = collectTourPhotoSources(tour).filter((s) => {
      if (!s.startsWith('/') || s.startsWith('//')) return false; // 원격·상대 경로는 lib 가 skipped 로 처리
      const abs = publicFile(s);
      return !abs || !isFile(abs);
    });
    for (const locale of opts.locales) {
      const result = buildOpenMontageBrief(tour, locale, {
        isUngroundedBadgeTag,
        platform: opts.platform,
        seconds: opts.seconds,
        budgetUsd: opts.budgetUsd,
        generatedAt,
        knownFiles,
        missing,
      });
      const schemaErrors = validateOpenMontageBrief(result.brief);
      for (const w of result.warnings) io.log(`  ! ${w}`);
      if (result.missingRequired.length > 0 || schemaErrors.length > 0) {
        failed += 1;
        io.error(`  x ${tour.slug}/${locale}: 건너뜀 / skipped (missing: ${result.missingRequired.join(', ') || '-'}; schema: ${schemaErrors.join('; ') || '-'})`);
        continue;
      }
      const prompt = buildOpenMontagePrompt(result.brief);
      const credits = buildCreditsText(result);
      const dir = writeLocale(outDir, tour, locale, result, prompt, credits);
      written += 1;
      const review = result.photos.filter((p) => p.needs_review).length;
      const shown = relative(ROOT, dir);
      io.log(`  ok ${shown && !shown.startsWith('..') ? shown : dir}  (photos ${result.photos.length}, needs review ${review}, skipped ${result.skippedPhotos.length})`);
    }
  }
  io.log(`\n완료 / Done: ${written} written, ${failed} skipped → ${outDir}`);
  if (written > 0) io.log('다음 단계 / Next: docs/MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md');
  return failed > 0 ? 1 : 0;
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
})();
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err && err.stack ? err.stack : err);
      process.exitCode = 1;
    },
  );
}
