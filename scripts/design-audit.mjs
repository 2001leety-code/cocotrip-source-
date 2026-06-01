#!/usr/bin/env node
/**
 * design-audit.mjs — impeccable detector wrapper, CocoTrip-tuned (2026-06-01).
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
 *   node scripts/design-audit.mjs                         # prod 홈 스캔
 *   node scripts/design-audit.mjs https://example.com     # URL 스캔
 *   node scripts/design-audit.mjs --from report.json      # 저장된 detect --json 재분류 (네트워크 불필요)
 *   node scripts/design-audit.mjs --strict                # TRUE 1건+ 이면 exit 1 (CI/사전점검)
 *
 * 주의: --from 없이는 `npx --yes impeccable detect <url> --json` 실행 (최초 1회 다운로드 + Puppeteer).
 *       비용/시간 때문에 자동 CI 게이트보다 on-demand 감사 권장.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
  const fromIdx = args.indexOf('--from');
  const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : null;
  const url = args.find((a) => !a.startsWith('--') && a !== fromFile) || 'https://cocotripkr.com';

  let raw = '';
  if (fromFile) {
    raw = readFileSync(fromFile, 'utf8');
  } else {
    try {
      raw = execSync(`npx --yes impeccable detect ${url} --json`, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
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
