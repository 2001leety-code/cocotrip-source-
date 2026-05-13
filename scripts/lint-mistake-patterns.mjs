#!/usr/bin/env node
/**
 * lint-mistake-patterns.mjs — CocoTrip 오답노트 (feedback_mistake_log.md /
 * feedback_pdf_korean_lessons.md / feedback_proactive_audit.md) 의 반복 실수
 * 패턴을 PR diff 에 대해 자동 lint. PR 머지 전 차단 (자율 검증 L1 게이트).
 *
 * 사용법:
 *   node scripts/lint-mistake-patterns.mjs                # base = origin/main
 *   node scripts/lint-mistake-patterns.mjs origin/main    # base 명시
 *   node scripts/lint-mistake-patterns.mjs --self-test    # 인위 위반 6 케이스 검증
 *
 * 산출 형식:
 *   [LINT] R-NAME: 설명           ← 위반 시 stderr 로 1줄
 *   [OK]   R-NAME: 패스           ← 정상 시 stdout
 *   exit 0  — 위반 0건
 *   exit 1  — 위반 ≥ 1건
 *
 * 새 패턴 추가: scripts/README-lint-patterns.md 참조
 */

import { execSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ----------------------------------------------------------------------------
// 인자 + 헬퍼
// ----------------------------------------------------------------------------

const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.includes('--self-test');
const BASE_REF_DEFAULT = ARGS.find((a) => !a.startsWith('--')) ?? 'origin/main';

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
  } catch (err) {
    return err && err.stdout ? err.stdout.toString() : '';
  }
}

/** base..HEAD 사이에 변경된 파일 목록 */
function getChangedFiles(base) {
  if (!base) return [];
  const out = safeExec(`git diff --name-status ${base}...HEAD`);
  if (!out.trim()) return [];
  return out
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(/\t/);
      const status = parts[0];
      const file = parts[parts.length - 1].replace(/\\/g, '/');
      return { status, file };
    });
}

/** 현재 HEAD (working tree) 의 파일 내용 */
function getChangedFileContent(file) {
  try {
    if (!existsSync(file)) return '';
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** base 시점의 파일 내용 ('' 면 base 에 없음) */
function getBaseFileContent(file, base) {
  if (!base) return '';
  return safeExec(`git show ${base}:${file}`);
}

function isModified(file, changed) {
  return changed.some((c) => c.file === file && c.status !== 'D');
}
function isDeleted(file, changed) {
  return changed.some((c) => c.file === file && c.status === 'D');
}

// ----------------------------------------------------------------------------
// 위반 누적 + 룰 러너
// ----------------------------------------------------------------------------

const violations = [];
const passes = [];
const warnings = [];

function fail(rule, msg, hint) {
  violations.push({ rule, msg, hint });
}
function pass(rule, msg = 'OK') {
  passes.push({ rule, msg });
}
function warn(rule, msg) {
  warnings.push({ rule, msg });
}

function runRule(name, fn, ctx) {
  try {
    const result = fn(ctx);
    if (result && result.skipped) {
      pass(name, 'skipped (no relevant changes)');
    } else {
      pass(name);
    }
  } catch (err) {
    fail(name, `rule crashed: ${err && err.message ? err.message : err}`, 'lint 스크립트 자체 버그');
  }
}

// ----------------------------------------------------------------------------
// 룰 — 7개
// ----------------------------------------------------------------------------

/**
 * P1_dateInclusiveExclusive — 메모리 P10 (날짜 inclusive/exclusive 혼동) + P1 (drift)
 * addDays/diffDays/tourDays/endDate/startDate 등 날짜 헬퍼 변경 시
 * inclusive/exclusive 컨벤션 주석 부재면 위반.
 */
function P1_dateInclusiveExclusive({ changed, base }) {
  const dateRe = /\b(addDays|diffDays|tourDays|computeNights|endDate|startDate)\b/;
  const affected = [];
  for (const c of changed) {
    if (c.status === 'D') continue;
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(c.file)) continue;
    const content = getChangedFileContent(c.file);
    if (!dateRe.test(content)) continue;
    // 헬퍼 정의/export 인지 확인 (caller 가 단순히 변수 쓰는 거면 X)
    if (!/export\s+(const|function|default|\{)/.test(content) && !/function\s+(addDays|diffDays|tourDays|computeNights)/.test(content)) continue;
    // 컨벤션 주석 검사
    if (!/\b(inclusive|exclusive)\b/i.test(content)) {
      affected.push(c.file);
    }
  }
  if (affected.length === 0) return changed.some((c) => dateRe.test(getChangedFileContent(c.file))) ? null : { skipped: true };
  for (const f of affected) {
    fail(
      'P1_dateInclusiveExclusive',
      `${f}: 날짜 헬퍼/변수 변경됐는데 inclusive/exclusive 컨벤션 주석 없음`,
      "메모리 P10 — `// endDate inclusive` 류 주석 + 1박2일/2박3일 단위 테스트 추가",
    );
  }
  return null;
}

/**
 * P3_i18nKeyParity — 메모리 P2. 신규 t('NEW_KEY') 가 ko/en/ja/zh 4 locale 모두에
 * 있는지 검사.
 */
function P3_i18nKeyParity({ changed, base }) {
  const tsxChanged = changed.filter(
    (c) => c.status !== 'D' && /\.(tsx|ts)$/.test(c.file) && c.file.startsWith('src/'),
  );
  if (tsxChanged.length === 0) return { skipped: true };

  const locales = {};
  for (const lang of ['ko', 'en', 'ja', 'zh']) {
    const p = `src/i18n/locales/${lang}.json`;
    if (!existsSync(p)) return { skipped: true };
    try {
      locales[lang] = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      locales[lang] = {};
    }
  }

  const tCallRe = /\bt\(\s*['"`]([a-zA-Z0-9_.]+?)['"`]/g;
  const newKeys = new Set();
  for (const c of tsxChanged) {
    const head = getChangedFileContent(c.file);
    const baseContent = getBaseFileContent(c.file, base);
    let m;
    while ((m = tCallRe.exec(head)) !== null) {
      const key = m[1];
      if (
        !baseContent.includes(`'${key}'`) &&
        !baseContent.includes(`"${key}"`) &&
        !baseContent.includes('`' + key + '`')
      ) {
        newKeys.add(key);
      }
    }
  }

  function hasKey(obj, dottedKey) {
    const parts = dottedKey.split('.');
    let cur = obj;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
      else return false;
    }
    return cur !== undefined;
  }

  const missing = [];
  for (const key of newKeys) {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      if (!hasKey(locales[lang], key)) missing.push(`${lang}:${key}`);
    }
  }
  if (missing.length > 0) {
    fail(
      'P3_i18nKeyParity',
      `신규 i18n 키 ${newKeys.size}개 중 ${missing.length}건 locale 누락: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`,
      "메모리 P2 — ko/en/ja/zh 4 lang 동시 추가 + `npm run check:i18n` 통과",
    );
  }
  return null;
}

/**
 * P5_foodIndexProtection — CLAUDE.md B-1 절대 금지 + 메모리 P5 SSOT 보호.
 * api/_food_index.json 삭제·rename·.gitignore 등록 차단.
 */
function P5_foodIndexProtection({ changed }) {
  const FOOD = 'api/_food_index.json';
  let any = false;

  if (isDeleted(FOOD, changed)) {
    any = true;
    fail(
      'P5_foodIndexProtection',
      `${FOOD} 삭제됨 — CLAUDE.md B-1 절대 금지`,
      'DB matcher silent fail. scripts/build-food-index.js 재실행으로 복구',
    );
  }
  for (const c of changed) {
    if (c.status.startsWith('R') && c.file.includes('_food_index') && c.file !== FOOD) {
      any = true;
      fail(
        'P5_foodIndexProtection',
        `${FOOD} rename 감지 → ${c.file}`,
        '_food_helper.js / dbMatcher.js import 경로 동시 갱신 필요',
      );
    }
  }
  if (isModified('.gitignore', changed)) {
    const gi = getChangedFileContent('.gitignore');
    if (/_food_index\.json/.test(gi)) {
      any = true;
      fail(
        'P5_foodIndexProtection',
        `.gitignore 에 _food_index.json 등록됨`,
        'CLAUDE.md B-1 — 이 파일은 git 추적 필수',
      );
    }
  }
  if (!any && !isModified(FOOD, changed) && !changed.some((c) => c.file === '.gitignore')) {
    return { skipped: true };
  }
  return null;
}

/**
 * P7_pdfPositionAbsolute — CLAUDE.md B-3 + 메모리 PDF 가이드.
 * pdfGenerator.ts 변경 시 position:absolute + left:0 유지 + display:none / left:-9999 차단.
 * 주석은 stripping 후 검사 — 가이드 주석 (예: "off-screen placement (left:-9999px)
 * makes blank") 이 false positive 트리거 방지.
 */
function stripComments(src) {
  // /* ... */ block 제거 (DOTALL)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 줄 단위 // ... 제거 (문자열 안 // 는 보존 어렵지만 lint 목적엔 충분)
  out = out
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
  return out;
}

function P7_pdfPositionAbsolute({ changed }) {
  const PDF = 'src/pages/PlanDetailPage/pdfGenerator.ts';
  if (!isModified(PDF, changed)) return { skipped: true };
  const content = stripComments(getChangedFileContent(PDF));

  // CSS (`display: none`) 또는 JS DOM (`style.display = 'none'`) 양쪽 매칭
  if (/display\s*[:=]\s*['"]?none/i.test(content)) {
    fail(
      'P7_pdfPositionAbsolute',
      `${PDF}: PDF 컨테이너에 display:none — html2canvas 가 화면 밖 요소 못 그림 → 백지 PDF`,
      'CLAUDE.md B-3 — position:absolute + left:0 + overlay(z-index:99998) 유지',
    );
  }
  if (/left\s*[:=]\s*['"]?-\s*\d{4,}/i.test(content)) {
    fail(
      'P7_pdfPositionAbsolute',
      `${PDF}: left:-9999px 류 화면 밖 위치 → 백지 PDF 회귀`,
      'CLAUDE.md B-3 — left:0 유지, overlay 로 시각 가림',
    );
  }
  const hasAbs = /position\s*[:=]\s*['"]?absolute/.test(content);
  const hasL0 = /left\s*[:=]\s*['"]?0\b/.test(content);
  if (!hasAbs || !hasL0) {
    fail(
      'P7_pdfPositionAbsolute',
      `${PDF}: position:absolute (${hasAbs}) + left:0 (${hasL0}) 패턴 미감지`,
      'CLAUDE.md B-3 의 PDF 컨테이너 안정 패턴 유지 필수',
    );
  }
  return null;
}

/**
 * PDF_KOREAN_FONT — 메모리 feedback_pdf_korean_lessons.md 가이드 1/3.
 * Noto Sans KR 로딩에 display=swap 사용 차단 / pdfGenerator.ts 가 fonts.ready
 * 만 신뢰하고 글리프 측정 없는 케이스 차단.
 */
function PDF_KOREAN_FONT({ changed }) {
  const targets = ['src/pages/PlanDetailPage/pdfGenerator.ts', 'index.html'];
  const touched = targets.filter((t) => isModified(t, changed));
  if (touched.length === 0) return { skipped: true };

  for (const t of touched) {
    const c = getChangedFileContent(t);
    if (/family=Noto[^"'\s]*display=swap/i.test(c)) {
      fail(
        'PDF_KOREAN_FONT',
        `${t}: Noto Sans KR Google Fonts 로딩에 display=swap — fonts.ready 거짓말 → PDF tofu 회귀`,
        '가이드 1 — display=block 또는 self-host (/fonts/NotoSansKR-*.woff2)',
      );
    }
    if (t.endsWith('pdfGenerator.ts')) {
      const usesReady = /document\.fonts\.ready/.test(c);
      const measuresGlyph = /(offsetWidth|getBoundingClientRect)/.test(c);
      if (usesReady && !measuresGlyph) {
        fail(
          'PDF_KOREAN_FONT',
          `${t}: document.fonts.ready 사용하나 글리프 측정 (offsetWidth / getBoundingClientRect) 없음`,
          '가이드 3 — 더미 한글 span 의 offsetWidth 검증 필수',
        );
      }
      if (/font-family\s*:\s*['"]?Noto Sans KR['"]?\s*[,;]/i.test(c)) {
        const fallback = /Apple SD Gothic|Malgun Gothic|system-ui|sans-serif/i.test(c);
        if (!fallback) {
          fail(
            'PDF_KOREAN_FONT',
            `${t}: font-family 에 Noto Sans KR 만 — CJK fallback 부재`,
            '자가 진단 — Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif 체인 유지',
          );
        }
      }
    }
  }
  return null;
}

/**
 * STOP_SCHEMA — CLAUDE.md B-2 + C. stop 필드를 name_ko / name_en / tip_en 으로
 * 되돌리는 변경 차단. base 에 없던 신규 reference 만 잡음.
 */
function STOP_SCHEMA({ changed, base }) {
  const cands = changed.filter(
    (c) =>
      c.status !== 'D' &&
      /\.(ts|tsx|js|mjs|cjs)$/.test(c.file) &&
      (c.file.startsWith('src/') || c.file.startsWith('api/')),
  );
  if (cands.length === 0) return { skipped: true };

  // base 에서 이미 등장하던 카운트 → head 에서 더 많이 등장하면 신규 추가
  const badRe = /\bstop\.(name_ko|name_en|tip_en)\b/g;
  let triggered = false;
  for (const c of cands) {
    const head = getChangedFileContent(c.file);
    const baseContent = getBaseFileContent(c.file, base);
    const headCount = (head.match(badRe) || []).length;
    const baseCount = (baseContent.match(badRe) || []).length;
    if (headCount > baseCount) {
      triggered = true;
      fail(
        'STOP_SCHEMA',
        `${c.file}: stop.name_ko/name_en/tip_en 신규 reference ${headCount - baseCount}건 — CLAUDE.md B-2 금지`,
        '신 스키마 (name/display_name/tip) 사용. 호환 폴백: stop.display_name || stop.name_en || stop.name || stop.name_ko',
      );
    }
  }
  return triggered ? null : null;
}

/**
 * SURFACE_AUDIT — 메모리 feedback_proactive_audit.md.
 * 도시/공항/모드/dietary 키워드 신규 추가했는데 5 surface (wizard/zone/airport/PDF/email)
 * 대부분 미변경이면 경고 (warning, not fail) — exit code 영향 X.
 */
function SURFACE_AUDIT({ changed, base }) {
  const SENS = ['서울', '부산', '제주', 'ICN', 'GMP', 'PUS', 'CJU', 'halal', 'vegan'];
  const cands = changed.filter(
    (c) =>
      c.status !== 'D' &&
      /\.(ts|tsx|js|mjs|cjs|json)$/.test(c.file) &&
      (c.file.startsWith('src/') || c.file.startsWith('api/')),
  );
  if (cands.length === 0) return { skipped: true };

  const newKw = new Set();
  for (const c of cands) {
    const head = getChangedFileContent(c.file);
    const baseContent = getBaseFileContent(c.file, base);
    for (const kw of SENS) {
      if (!baseContent.includes(kw) && head.includes(kw)) newKw.add(kw);
    }
  }
  if (newKw.size === 0) return { skipped: true };

  const surfaces = {
    wizard: ['src/components/WizardStep', 'src/pages/CharterNewPage', 'src/pages/WizardForm', 'src/components/Step'],
    zone: ['src/components/ZoneCard', 'src/components/RecommendedZone', 'src/data/zone'],
    airport: ['src/components/AirportSelect', 'src/data/airport'],
    pdf: ['src/pages/PlanDetailPage/pdfGenerator', 'src/pages/PlanDetailPage/components/IntroSlide', 'src/pages/PlanDetailPage/components/OutroSlide'],
    email: ['api/_email-renderer', 'api/_send-email', 'api/_telegram'],
  };
  const touched = new Set();
  for (const [name, roots] of Object.entries(surfaces)) {
    for (const root of roots) {
      if (changed.some((c) => c.status !== 'D' && c.file.startsWith(root))) {
        touched.add(name);
      }
    }
  }
  const missed = Object.keys(surfaces).filter((s) => !touched.has(s));
  if (missed.length === 5) {
    warn(
      'SURFACE_AUDIT',
      `신규 키워드 [${[...newKw].join(', ')}] 추가됐는데 wizard/zone/airport/PDF/email 5 surface 변경 0건. feedback_proactive_audit.md 참조`,
    );
  } else if (missed.length >= 4) {
    warn(
      'SURFACE_AUDIT',
      `신규 키워드 [${[...newKw].join(', ')}] 추가됐는데 ${5 - missed.length} surface 만 변경 (${[...touched].join(', ')}). 미변경: ${missed.join(', ')} — 정상인지 audit`,
    );
  }
  return null;
}

/**
 * P32_sprinterGuideDedup — 메모리 P32. sprinter 는 guide_required 자동 가산이라
 * licensed_guide 옵션은 무시되어야 함. useQuoteCalculator.ts 가 licensed_guide
 * 를 push 할 때 vehicle !== 'sprinter' 가드를 잃으면 ₩300K × 2 = ₩600K 중복 가산.
 *
 * 트리거: useQuoteCalculator.ts 의 addons.push({ key: 'licensed_guide', ... })
 * 호출이 vehicle !== 'sprinter' 또는 동등 가드 없이 일어나면 fail.
 */
function P32_sprinterGuideDedup({ changed }) {
  const FILE = 'src/hooks/useQuoteCalculator.ts';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);

  // licensed_guide push 라인 위치 찾기
  const pushMatch = content.match(/addons\.push\(\s*\{\s*key:\s*['"]licensed_guide['"]/);
  if (!pushMatch) {
    // licensed_guide push 자체가 사라졌다면 OK (다른 dedup 방식 가능)
    return null;
  }

  // push 라인 주변 ±400 chars 에 sprinter dedup 가드 있는지 검사
  const idx = pushMatch.index ?? 0;
  const start = Math.max(0, idx - 400);
  const end = Math.min(content.length, idx + 400);
  const window = content.slice(start, end);

  const hasSprinterGuard =
    /vehicle\s*!==\s*['"]sprinter['"]/.test(window) ||
    /vehicle\s*===\s*['"]staria['"]/.test(window) ||
    /licensedGuideApplies/.test(window);

  if (!hasSprinterGuard) {
    fail(
      'P32_sprinterGuideDedup',
      `${FILE}: licensed_guide push 가 sprinter dedup 가드 (vehicle !== 'sprinter') 없이 호출됨 — ₩300K × 2 중복 가산 회귀 위험`,
      "P1 #9 fix — 'const licensedGuideApplies = state.options?.licensedGuide && vehicle !== \\'sprinter\\'' 가드 유지",
    );
  }
  return null;
}

/**
 * P33_comboHardcode — 메모리 P33. 콤보 패키지 (combo_airport_*) 가격은 SSOT
 * pricing_spec.json combo_packages 단일 source 여야 함. UI / backend / shared
 * 어느 곳이든 priceKRW 하드코딩 시 mismatch 회귀 위험 (이전 UI ₩627,300 vs
 * backend ₩517,320 ₩110K 불일치).
 *
 * 트리거: TourPackageInlineAd.tsx / createPaypalOrder.js / _shared/pricing.js
 * 에서 combo_airport_* productType 가까이 priceKRW 정수 hardcode 발견 시 fail.
 */
function P33_comboHardcode({ changed }) {
  const TARGETS = [
    'src/pages/PlanDetailPage/components/ads/TourPackageInlineAd.tsx',
    'api/createPaypalOrder.js',
    'api/_shared/pricing.js',
  ];
  const touched = TARGETS.filter((t) => isModified(t, changed));
  if (touched.length === 0) return { skipped: true };

  for (const f of touched) {
    const content = getChangedFileContent(f);
    // combo_airport_<xxx> 와 같은 줄 또는 ±150 chars 범위에 priceKRW: 숫자 (5~7자리) 발견 시 fail.
    // SSOT 함수 호출 (computeComboPriceKRW) 은 OK.
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/combo_airport_[a-z]+/.test(line)) continue;
      // 같은 라인 또는 다음 2줄 windows 에 priceKRW: 정수 패턴
      const window = lines.slice(i, Math.min(lines.length, i + 3)).join(' ');
      // priceKRW: 100000 또는 priceKRW: 627_300 (숫자/언더스코어) — function 호출이면 X
      const hardcodeRe = /priceKRW\s*:\s*[\d_]{5,}/;
      const functionCall = /computeComboPriceKRW|combo_packages|COMBO_PACKAGES/.test(window);
      if (hardcodeRe.test(window) && !functionCall) {
        fail(
          'P33_comboHardcode',
          `${f}:L${i + 1}: combo_airport_* 가까이 priceKRW 하드코딩 — SSOT pricing_spec.json combo_packages 와 drift 위험`,
          'P1 #10 fix — computeComboPriceKRW(productType) 또는 combo_packages.packages 사용. 직접 priceKRW 정수 금지.',
        );
        return null; // 첫 발견 시 fail, 누적 안 함
      }
    }
  }
  return null;
}

const RULES = [
  ['P1_dateInclusiveExclusive', P1_dateInclusiveExclusive],
  ['P3_i18nKeyParity', P3_i18nKeyParity],
  ['P5_foodIndexProtection', P5_foodIndexProtection],
  ['P7_pdfPositionAbsolute', P7_pdfPositionAbsolute],
  ['PDF_KOREAN_FONT', PDF_KOREAN_FONT],
  ['STOP_SCHEMA', STOP_SCHEMA],
  ['SURFACE_AUDIT', SURFACE_AUDIT],
  ['P32_sprinterGuideDedup', P32_sprinterGuideDedup],
  ['P33_comboHardcode', P33_comboHardcode],
];

function runAll(base) {
  const changed = getChangedFiles(base);
  if (changed.length === 0 && base) {
    process.stdout.write(`[LINT] no changes between ${base}..HEAD — skipping\n`);
    return 0;
  }
  const ctx = { changed, base };
  for (const [name, fn] of RULES) {
    runRule(name, fn, ctx);
  }
  for (const p of passes) {
    process.stdout.write(`[OK]   ${p.rule}: ${p.msg}\n`);
  }
  for (const w of warnings) {
    process.stderr.write(`[WARN] ${w.rule}: ${w.msg}\n`);
  }
  for (const v of violations) {
    process.stderr.write(`[LINT] ${v.rule}: ${v.msg}\n`);
    if (v.hint) process.stderr.write(`       hint: ${v.hint}\n`);
  }
  process.stdout.write(
    `\n[LINT] ${passes.length} OK · ${warnings.length} warning · ${violations.length} violation (base=${base})\n`,
  );
  return violations.length > 0 ? 1 : 0;
}

// ----------------------------------------------------------------------------
// Self-test — sandbox repo 에 인위 위반 시뮬레이션 (6 케이스)
// ----------------------------------------------------------------------------

function gitInSandbox(dir, args) {
  return safeExec(`git -C "${dir}" ${args}`);
}

function setupSandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocotrip-lint-self-'));
  gitInSandbox(dir, 'init -q -b main');
  gitInSandbox(dir, 'config user.email lint@self.test');
  gitInSandbox(dir, 'config user.name "Lint Self Test"');
  gitInSandbox(dir, 'config commit.gpgsign false');
  return dir;
}

function applyFilesAndCommit(dir, files, msg) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    const d = path.dirname(full);
    try { mkdirSync(d, { recursive: true }); } catch {}
    if (content === null) {
      try { unlinkSync(full); } catch {}
      gitInSandbox(dir, `rm -f "${rel}"`);
    } else {
      writeFileSync(full, content, 'utf8');
      gitInSandbox(dir, `add "${rel}"`);
    }
  }
  gitInSandbox(dir, `commit -q --allow-empty -m "${msg}"`);
}

function runRulesInDir(dir, base) {
  const cwd0 = process.cwd();
  violations.length = 0;
  passes.length = 0;
  warnings.length = 0;
  process.chdir(dir);
  try {
    const changed = getChangedFiles(base);
    const ctx = { changed, base };
    for (const [name, fn] of RULES) {
      runRule(name, fn, ctx);
    }
  } finally {
    process.chdir(cwd0);
  }
}

function runSelfTest() {
  const cases = [
    {
      label: 'P5: api/_food_index.json 삭제',
      base: { 'api/_food_index.json': '{"city":"seoul"}\n', 'README.md': 'x' },
      head: { 'api/_food_index.json': null, 'README.md': 'y' },
      expectRule: 'P5_foodIndexProtection',
    },
    {
      label: 'P5: .gitignore 에 _food_index.json 등록',
      base: { 'api/_food_index.json': '{}\n', '.gitignore': 'node_modules\n' },
      head: { 'api/_food_index.json': '{}\n', '.gitignore': 'node_modules\napi/_food_index.json\n' },
      expectRule: 'P5_foodIndexProtection',
    },
    {
      label: 'P7: pdfGenerator.ts 에 display:none 추가',
      base: {
        'src/pages/PlanDetailPage/pdfGenerator.ts':
          "container.style.position = 'absolute';\ncontainer.style.left = '0';\n",
      },
      head: {
        'src/pages/PlanDetailPage/pdfGenerator.ts':
          "container.style.position = 'absolute';\ncontainer.style.left = '0';\ncontainer.style.display = 'none';\n",
      },
      expectRule: 'P7_pdfPositionAbsolute',
    },
    {
      label: 'P7: left:-9999 회귀',
      base: {
        'src/pages/PlanDetailPage/pdfGenerator.ts':
          "container.style.position = 'absolute';\ncontainer.style.left = '0';\n",
      },
      head: {
        'src/pages/PlanDetailPage/pdfGenerator.ts':
          "container.style.position = 'absolute';\ncontainer.style.left = '-9999px';\n",
      },
      expectRule: 'P7_pdfPositionAbsolute',
    },
    {
      label: 'PDF_KOREAN_FONT: index.html 에 display=swap',
      base: {
        'index.html':
          '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR&display=block">\n',
      },
      head: {
        'index.html':
          '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR&display=swap">\n',
      },
      expectRule: 'PDF_KOREAN_FONT',
    },
    {
      label: 'STOP_SCHEMA: src 에 stop.name_ko 신규 reference',
      base: { 'src/components/Foo.tsx': 'const x = stop.display_name || stop.name;\n' },
      head: {
        'src/components/Foo.tsx':
          'const x = stop.display_name || stop.name;\nconst legacy = stop.name_ko;\n',
      },
      expectRule: 'STOP_SCHEMA',
    },
    {
      label: 'P32: useQuoteCalculator licensed_guide push 가 sprinter dedup 없이 호출',
      base: {
        'src/hooks/useQuoteCalculator.ts':
          "const vehicle = state.vehicle;\nconst guard = vehicle !== 'sprinter' && state.options?.licensedGuide;\nif (guard) addons.push({ key: 'licensed_guide', amountKRW: 300000 });\n",
      },
      head: {
        'src/hooks/useQuoteCalculator.ts':
          "const vehicle = state.vehicle;\nif (state.options?.licensedGuide) addons.push({ key: 'licensed_guide', amountKRW: 300000 });\n",
      },
      expectRule: 'P32_sprinterGuideDedup',
    },
    {
      label: 'P33: TourPackageInlineAd 에 combo_airport_busan priceKRW 하드코딩',
      base: {
        'src/pages/PlanDetailPage/components/ads/TourPackageInlineAd.tsx':
          "const list = COMBO_PACKAGES.map(p => ({ productType: 'combo_airport_seoul', priceKRW: computeComboPriceKRW('combo_airport_seoul') }));\n",
      },
      head: {
        'src/pages/PlanDetailPage/components/ads/TourPackageInlineAd.tsx':
          "const list = [{ productType: 'combo_airport_busan', priceKRW: 627300 }];\n",
      },
      expectRule: 'P33_comboHardcode',
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const dir = setupSandbox();
    try {
      applyFilesAndCommit(dir, c.base, 'base');
      // tag base as "main" for diff
      gitInSandbox(dir, 'tag base');
      applyFilesAndCommit(dir, c.head, 'head');
      runRulesInDir(dir, 'base');
      const matched = violations.find((v) => v.rule === c.expectRule);
      if (matched) {
        process.stdout.write(`  [PASS] ${c.label}\n    -> caught: ${matched.msg}\n`);
        pass++;
      } else {
        process.stdout.write(
          `  [FAIL] ${c.label}\n    -> expected rule ${c.expectRule} did NOT fire. ` +
            `actual violations: ${JSON.stringify(violations.map((v) => v.rule))}\n`,
        );
        fail++;
      }
    } catch (err) {
      process.stdout.write(`  [FAIL] ${c.label} — crashed: ${err.message}\n`);
      fail++;
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
  process.stdout.write(`\n[SELF-TEST] ${pass}/${cases.length} cases passed (${fail} failed)\n`);
  return fail > 0 ? 1 : 0;
}

// ----------------------------------------------------------------------------
// 메인
// ----------------------------------------------------------------------------

const exitCode = SELF_TEST ? runSelfTest() : runAll(BASE_REF_DEFAULT);
process.exit(exitCode);
