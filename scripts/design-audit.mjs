/**
 * design-audit.mjs — impeccable detector wrapper, CocoTrip-tuned (2026-06-01).
 * 실행: `node scripts/design-audit.mjs [url]` (shebang 제거 — vitest 가 순수함수 import 가능하게).
 *
 * `npx impeccable detect` 는 우리 브랜드(보라 그라데/글로우)와 측정 아티팩트(gradient-clip
 * 텍스트, backdrop-filter, 둥근모서리 클리핑)를 slop 으로 과다 보고한다. 이 래퍼는 2026-06-01
 * 수동 트리아지(메모리 project_cocotrip_design_deepsearch_2026_06_01)를 코드화해 findings 를:
 *   🔴 TRUE  — 진짜 actionable 품질 버그 (이것만 게이트)
 *   🎨 BRAND — 운영자 의도적 브랜드/디자인 방향 (ai-color-palette / dark-glow / icon-tile) — 버그 아님
 *   ⚪ NOISE — detector 아티팩트(FP): gradient-clip 흰-on-흰, backdrop/gradient contrast, rounded clip
 * 로 분류한다.
 *
 * Usage:
 *   node scripts/design-audit.mjs                         # 로컬 홈 스캔
 *   node scripts/design-audit.mjs https://example.com     # URL 스캔
 *   node scripts/design-audit.mjs https://cocotripkr.com --allow-prod-readonly
 *   node scripts/design-audit.mjs --from report.json      # 저장된 detect --json 재분류 (네트워크 불필요)
 *   node scripts/design-audit.mjs --strict                # TRUE 1건+ 이면 exit 1 (CI/사전점검)
 *
 * 주의: --from 없이는 `npx --yes impeccable detect <url> --json` 실행 (최초 1회 다운로드 + Puppeteer).
 *       비용/시간 때문에 자동 CI 게이트보다 on-demand 감사 권장.
 *       URL 은 execFileSync 인자로 넘겨 셸 명령 삽입을 막고, 운영 URL 은 명시 승인 플래그가 필요하다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_DESIGN_BASE_URL = 'http://127.0.0.1:4173';
export const PRODUCTION_DESIGN_ORIGINS = new Set([
  'https://cocotripkr.com',
  'https://www.cocotripkr.com',
]);

/** URL 을 안전하게 정규화하고 http(s) 외 스킴·내장 자격증명을 거부한다. */
export function normalizeDesignBaseUrl(value = DEFAULT_DESIGN_BASE_URL) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`올바르지 않은 감사 URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`감사 URL 은 http 또는 https 만 허용: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('감사 URL 에 아이디나 비밀번호를 넣을 수 없습니다.');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/';
  const normalized = parsed.href.replace(/\/$/, '');
  // Windows 에서는 npx.cmd 실행에 셸이 필요하다. 셸 메타문자·환경변수 확장 문자를
  // 아예 URL 관문에서 거부해, 아래 execFileSync 인자가 명령으로 재해석되지 않게 한다.
  if (!/^[a-zA-Z0-9:/._~-]+$/.test(normalized)) {
    throw new Error('감사 URL 에 허용하지 않는 특수문자가 있습니다.');
  }
  return normalized;
}

/** 운영 주소는 명시적인 읽기 전용 승인 플래그 없이는 열지 않는다. */
export function assertReadonlyDesignTarget(baseUrl, allowProdReadonly = false) {
  const normalized = normalizeDesignBaseUrl(baseUrl);
  const origin = new URL(normalized).origin;
  if (PRODUCTION_DESIGN_ORIGINS.has(origin) && !allowProdReadonly) {
    throw new Error('운영 사이트 감사에는 --allow-prod-readonly 를 명시해야 합니다.');
  }
  return normalized;
}

// 운영자 의도적 선택 (Anthropic/impeccable 가 slop 이라 하나 우리 브랜드 정체성) + 디자인 방향(Bento Aurora).
export const BRAND = new Set(['ai-color-palette', 'dark-glow', 'icon-tile-stack', 'gradient-text']);

/** 한 finding 이 detector 아티팩트(false positive)인지 판정. */
export function isNoise(f) {
  const s = (f.snippet || '').toLowerCase();
  // 둥근모서리(rounded-2xl)용 의도적 overflow-hidden — 대부분 무해.
  if (f.antipattern === 'clipped-overflow-container') return true;
  // low-contrast 중: gradient-clip 텍스트(흰-on-흰) + backdrop/gradient 위 픽셀측정 = 측정 아티팩트.
  if (f.antipattern === 'low-contrast'
      && (s.includes('#ffffff on #ffffff')
          || s.includes('backdrop filter')
          || s.includes('gradient background')
          || s.includes('on filter'))) return true;
  return false;
}

/** findings → { TRUE, BRAND, NOISE, trueUniq }. 순수 함수 (테스트 가능). */
export function categorize(findings) {
  const cat = { TRUE: [], BRAND: [], NOISE: [] };
  for (const f of findings) {
    if (BRAND.has(f.antipattern)) cat.BRAND.push(f);
    else if (isNoise(f)) cat.NOISE.push(f);
    else cat.TRUE.push(f);
  }
  const trueUniq = [...new Map(cat.TRUE.map((f) => [f.antipattern + '|' + f.snippet, f])).values()];
  return { ...cat, trueUniq };
}

function main() {
  const args = process.argv.slice(2);
  const STRICT = args.includes('--strict');
  const allowProdReadonly = args.includes('--allow-prod-readonly');
  const fromIdx = args.indexOf('--from');
  const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : null;
  const rawUrl = args.find((a) => !a.startsWith('--') && a !== fromFile) || DEFAULT_DESIGN_BASE_URL;
  const url = fromFile ? rawUrl : assertReadonlyDesignTarget(rawUrl, allowProdReadonly);

  let raw = '';
  if (fromFile) {
    raw = readFileSync(fromFile, 'utf8');
  } else {
    try {
      raw = execFileSync('npx', ['--yes', 'impeccable', 'detect', url, '--json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
        shell: process.platform === 'win32',
      });
    } catch (e) { raw = (e && e.stdout && e.stdout.toString()) || ''; }
  }

  let findings;
  try { findings = JSON.parse(raw); } catch { console.error('detect 출력 JSON 파싱 실패'); process.exit(2); }

  const { TRUE, BRAND: brand, NOISE, trueUniq } = categorize(findings);
  console.log(`\nimpeccable design audit — ${fromFile ? `(cached: ${fromFile})` : url}`);
  console.log(`총 ${findings.length} findings → 🔴 TRUE ${TRUE.length} / 🎨 BRAND ${brand.length} / ⚪ NOISE(FP) ${NOISE.length}`);
  console.log(`\n🔴 TRUE (actionable, ${trueUniq.length} unique):`);
  if (!trueUniq.length) console.log('  (없음)');
  for (const f of trueUniq) console.log(`  [${f.antipattern}] ${(f.snippet || '').slice(0, 120)}`);
  console.log(`\n🎨 BRAND/방향 (운영자 결정, 버그 아님): ${[...new Set(brand.map((f) => f.antipattern))].join(', ') || '없음'}`);
  console.log(`⚪ NOISE/FP (무시): ${[...new Set(NOISE.map((f) => f.antipattern))].join(', ') || '없음'}`);

  if (STRICT && trueUniq.length > 0) {
    console.error(`\n--strict: TRUE ${trueUniq.length}건 → exit 1`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
