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
 * addDays/diffDays/tourDays/computeNights 등 **날짜 헬퍼** 정의·호출 변경 시
 * inclusive/exclusive 컨벤션 주석 부재면 위반.
 *
 * 2026-05-13 정밀화 (PR #391):
 * - 이전: file 전체 content 가 dateRe 매칭 → trigger. type field 만 있어도 over-trigger
 *   (예: PR #387 의 IntercityTransitSegment 추가가 file 의 무관한 `startDate?: string`
 *   field 때문에 trigger 됨)
 * - 이후: **changed lines (git diff 의 + 라인) 만** 검사 + **type field declaration 제외**.
 *   단순 `startDate?: string` / `endDate: Date | null` 같은 type/interface field 는 skip.
 *   헬퍼 정의 (`function addDays`/`const addDays =`) 또는 호출 (`addDays(...)`/`startDate =`)
 *   만 trigger.
 */
function P1_dateInclusiveExclusive({ changed, base }) {
  // 헬퍼 함수 정의 (실제 위험 — inclusive/exclusive 컨벤션 명시 필수)
  const HELPER_DEFINE = /\b(function\s+(addDays|diffDays|tourDays|computeNights)|const\s+(addDays|diffDays|tourDays|computeNights)\s*=)/;
  // 헬퍼 함수 호출 (caller 도 컨벤션 인지 필요)
  const HELPER_CALL = /\b(addDays|diffDays|tourDays|computeNights)\s*\(/;
  // 단순 type field declaration — inclusive/exclusive 무관 (skip 대상)
  const DATE_FIELD_TYPE_ONLY = /^\s*\/?\*?\s*(startDate|endDate)\s*\??:\s*(string|Date|number|null|undefined|[A-Z][\w<>|& ]*)\s*;?\s*$/;
  // startDate/endDate 변수 할당 또는 메소드 호출 — 실제 계산 컨텍스트
  const DATE_USE = /\b(startDate|endDate)\s*(=(?!=)|\.\w+|\[|\+|-(?!=))/;
  // 변경된 파일에 날짜 관련 키워드가 하나라도 있나 (skip 여부 결정용)
  const ANY_DATE_KEYWORD = /\b(addDays|diffDays|tourDays|computeNights|startDate|endDate)\b/;

  const affected = [];
  let anyDateRelevant = false;

  for (const c of changed) {
    if (c.status === 'D') continue;
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(c.file)) continue;

    // changed lines (git diff hunk 의 + 라인) — file 전체 content 가 아닌 변경분만 검사.
    const diff = safeExec(`git diff ${base}...HEAD -- "${c.file}"`);
    const addedLines = diff
      .split(/\r?\n/)
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1));

    if (addedLines.length === 0) continue;

    // 변경된 line 중 dateRe 매칭이 있나? (skip 여부 추적)
    if (addedLines.some((line) => ANY_DATE_KEYWORD.test(line))) {
      anyDateRelevant = true;
    }

    // trigger 조건: helper define/call 또는 startDate/endDate 사용 (할당·메소드·산술).
    // type field declaration 만 추가됐으면 skip (PR #387 같은 false positive 방지).
    const triggerLines = addedLines.filter((line) => {
      if (DATE_FIELD_TYPE_ONLY.test(line)) return false;
      return HELPER_DEFINE.test(line) || HELPER_CALL.test(line) || DATE_USE.test(line);
    });

    if (triggerLines.length === 0) continue;

    // 컨벤션 주석 검사 — file 전체에서 inclusive/exclusive 키워드 1회 이상.
    const content = getChangedFileContent(c.file);
    if (!/\b(inclusive|exclusive)\b/i.test(content)) {
      affected.push(c.file);
    }
  }

  if (affected.length === 0) {
    // 어떤 file 도 trigger 안 됐으면 — date 관련 변경이 아예 없으면 skip 처리.
    return anyDateRelevant ? null : { skipped: true };
  }
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
 *
 * 2026-05-13 PR #400 강화 (UI/UX 점검 #4):
 * - 검사 대상 확장: 신규 HTML→PDF 모듈 (`*pdf*Generator*.ts`, `*Pdf*.tsx`) 추가 시 자동 검사
 * - PR #82/#104/#106/#110/#111/#115/#131/#139/#212/#305 (10회 회귀) 사례 — 새 PDF
 *   컴포넌트 작성 시 같은 함정 빠짐. 자동 lint 로 영구 차단.
 * - 본 룰은 html2canvas/html2pdf 사용 모듈만 — PDFKit (api/_generate-voucher.js)
 *   는 글리프 측정 무관 (서버사이드, 라틴 only).
 */
function PDF_KOREAN_FONT({ changed }) {
  // 1) 고정 target file (기존)
  const FIXED_TARGETS = ['src/pages/PlanDetailPage/pdfGenerator.ts', 'index.html'];
  // 2) PR #400 신규: 새 HTML-PDF 모듈 자동 감지
  //    pattern: src/**/*pdf*Generator*.ts OR src/**/*PdfGen*.ts OR src/components/**/*Pdf*.tsx
  //    (PDFKit 서버 모듈 api/_generate-voucher.js 는 글리프 무관 — 제외)
  const newPdfModules = changed
    .filter((c) => c.status !== 'D')
    .filter((c) =>
      /^src\/.+(pdf|Pdf|PDF).*\.(ts|tsx)$/.test(c.file)
      && !c.file.endsWith('.test.ts')
      && !c.file.endsWith('.test.tsx')
    )
    .map((c) => c.file);
  const targets = [...new Set([...FIXED_TARGETS, ...newPdfModules])];
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
    // html2canvas / html2pdf 사용 모듈 — 글리프 측정 필수
    const isHtmlToPdfModule =
      t.endsWith('pdfGenerator.ts')
      || /html2canvas|html2pdf|html-to-image/.test(c);
    if (isHtmlToPdfModule) {
      const usesReady = /document\.fonts\.ready/.test(c);
      const measuresGlyph = /(offsetWidth|getBoundingClientRect)/.test(c);
      if (usesReady && !measuresGlyph) {
        fail(
          'PDF_KOREAN_FONT',
          `${t}: document.fonts.ready 사용하나 글리프 측정 (offsetWidth / getBoundingClientRect) 없음`,
          '가이드 3 — 더미 한글 span 의 offsetWidth 검증 필수 (e.g. testEl.textContent="한"; expect(testEl.offsetWidth > 0))',
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
      // PR #400 신규 검사: html2canvas/html2pdf 사용 모듈이 fonts.ready 자체를 안 함
      // (가장 흔한 회귀 — Phase 1 PDF 백지 사고)
      if (/html2(canvas|pdf)|html-to-image/.test(c) && !usesReady) {
        fail(
          'PDF_KOREAN_FONT',
          `${t}: html2canvas/html2pdf 사용하나 document.fonts.ready 대기 부재 — 한글 폰트 로딩 전 캡처 → tofu (□)`,
          '가이드 2 — await document.fonts.ready 후 글리프 측정 (offsetWidth) 까지 검증',
        );
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

/**
 * P34_priceUsdConsistency — 메모리 P34. pricing_spec.json 의 priceUSD 는
 * policy_krw_per_usd 환율 기준 round(priceKRW / rate) 와 ±1 이내여야 함.
 * 한쪽만 변경 시 환율 drift 회귀 위험 (P1 #5).
 *
 * 트리거: pricing_spec.json 변경 시 SSOT policy_krw_per_usd 와 비교.
 * 위반 시 fail.
 */
function P34_priceUsdConsistency({ changed }) {
  const SPEC = 'src/data/pricing_spec.json';
  if (!isModified(SPEC, changed)) return { skipped: true };
  let spec;
  try {
    spec = JSON.parse(getChangedFileContent(SPEC));
  } catch {
    return { skipped: true }; // JSON parse 오류는 다른 룰/CI 가 잡음
  }
  const rate = spec.policy_krw_per_usd;
  if (!rate || typeof rate !== 'number') {
    fail(
      'P34_priceUsdConsistency',
      `${SPEC}: policy_krw_per_usd 필드 누락 또는 비정상`,
      'P1 #5 fix — pricing_spec.json 최상위에 policy_krw_per_usd: 1430 필수',
    );
    return null;
  }
  const violations = [];
  // airport_transfer_prices 검사
  if (spec.airport_transfer_prices && typeof spec.airport_transfer_prices === 'object') {
    for (const [k, entry] of Object.entries(spec.airport_transfer_prices)) {
      if (k === 'comment' || typeof entry !== 'object' || !entry) continue;
      const krw = entry.priceKRW;
      const usd = entry.priceUSD;
      if (typeof krw !== 'number' || typeof usd !== 'number') continue;
      const expected = Math.round(krw / rate);
      if (Math.abs(usd - expected) > 1) {
        violations.push(`airport_transfer_prices.${k}: KRW=${krw} USD=${usd} (rate=${rate} → expected ${expected})`);
      }
    }
  }
  // daily_tour_prices 검사
  if (spec.daily_tour_prices && typeof spec.daily_tour_prices === 'object') {
    for (const [k, entry] of Object.entries(spec.daily_tour_prices)) {
      if (k === 'comment' || typeof entry !== 'object' || !entry) continue;
      const krw = entry.priceKRW;
      const usd = entry.priceUSD;
      if (typeof krw !== 'number' || typeof usd !== 'number') continue;
      const expected = Math.round(krw / rate);
      if (Math.abs(usd - expected) > 1) {
        violations.push(`daily_tour_prices.${k}: KRW=${krw} USD=${usd} (rate=${rate} → expected ${expected})`);
      }
    }
  }
  if (violations.length > 0) {
    fail(
      'P34_priceUsdConsistency',
      `${SPEC}: priceUSD ↔ priceKRW / policy_krw_per_usd ${violations.length}건 drift — ${violations.slice(0, 3).join(' | ')}${violations.length > 3 ? ' …' : ''}`,
      'P1 #5 fix — priceUSD = round(priceKRW / policy_krw_per_usd). KRW 변경 시 USD 도 함께.',
    );
  }
  return null;
}

/**
 * P43_authIdorBodyTrusted — 메모리 P43 (PR #418, Audit W-C1~C4).
 * IDOR 회귀 차단: user-scoped endpoint (my-bookings / voucher / cancelBooking /
 * modifyBooking / reviews) 를 호출할 때 body/query 에 `userEmail` 또는 `userId`
 * 를 넣는 패턴 = 서버가 body 신뢰하던 옛 IDOR 패턴 부활.
 *
 * 룰:
 *   1. client 가 위 5개 endpoint 에 raw `fetch(...)` 사용 — `authFetch` 써야 함.
 *   2. client body 또는 query 에 `userEmail: ` / `userId: ` 직접 전달 — 서버는
 *      verified auth.email / auth.uid 만 사용해야 함.
 *
 * 트리거: 변경된 .ts/.tsx/.js/.jsx 파일.
 * 위반 시 fail.
 */
function P43_authIdorBodyTrusted({ changed }) {
  const targets = (changed || []).filter((c) =>
    c.status !== 'D' && /\.(ts|tsx|js|jsx)$/.test(c.file) &&
    !c.file.startsWith('api/') &&  // server-side files use verifyUserToken directly
    !c.file.startsWith('scripts/') &&
    !c.file.startsWith('tests/') &&
    !c.file.endsWith('authFetch.ts'),  // the helper itself
  );
  if (targets.length === 0) return { skipped: true };

  const PROTECTED = /\/api\/(my-bookings|voucher|cancelBooking|modifyBooking|reviews)\b/;
  const localViolations = [];

  for (const { file } of targets) {
    const content = getChangedFileContent(file);
    if (!content) continue;
    if (!PROTECTED.test(content)) continue;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Rule 1: raw fetch( against protected endpoint
      if (/\bfetch\s*\(\s*['"`]\/api\/(my-bookings|voucher|cancelBooking|modifyBooking|reviews)/.test(line)) {
        // window check ±15 lines for 'Authorization' header — admin pages already
        // attach it manually; only flag if Authorization NOT in window.
        const win = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 15)).join('\n');
        if (!/Authorization\s*:\s*['"`]?Bearer/i.test(win)) {
          localViolations.push(`${file}:L${i + 1}: raw fetch() against protected endpoint — use authFetch from @/lib/authFetch`);
        }
      }
      // Rule 2: body/query carrying userEmail or userId to protected endpoint
      // Heuristic — line contains `userEmail:` or `userId:` AND the file
      // touches a protected endpoint. False-positive risk acceptable; remove
      // the property if not actually targeting these endpoints.
      const isCalloutLine =
        /\buserEmail\s*:\s*(user\??\.email|email|userEmail)\b/.test(line) ||
        /\buserId\s*:\s*(user\??\.uid|uid|userId)\b/.test(line);
      if (isCalloutLine) {
        // Check ±10 lines window to confirm protected endpoint context
        const window = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 4)).join('\n');
        if (PROTECTED.test(window)) {
          localViolations.push(`${file}:L${i + 1}: body/query carries userEmail/userId to protected endpoint — server uses verified auth.email / auth.uid`);
        }
      }
    }
  }

  if (localViolations.length > 0) {
    fail(
      'P43_authIdorBodyTrusted',
      `IDOR regression ${localViolations.length}건 — ${localViolations.slice(0, 3).join(' | ')}${localViolations.length > 3 ? ' …' : ''}`,
      'PR #418 IDOR fix — protected endpoint 호출은 authFetch(/api/...) + body 에서 userEmail/userId 제거. server 는 Authorization Bearer 만 사용.',
    );
  }
  return null;
}

/**
 * P44_cronAuthGate — 메모리 P44 (PR #419, Audit CZ3 / WC5).
 * 새 cron 엔드포인트 (api/cron-runner.js + 향후 api/_crons/*) 또는 dispatcher
 * 가 verifyCronRequest 없이 export default handler 패턴을 가지면 fail.
 *
 * 트리거: api/cron-runner.js 또는 api/_crons/*.js 변경/신규.
 * 위반 시 fail.
 */
function P44_cronAuthGate({ changed }) {
  const targets = (changed || []).filter((c) =>
    c.status !== 'D' && /\.js$/.test(c.file) &&
    (c.file === 'api/cron-runner.js' || c.file.startsWith('api/_crons/')),
  );
  if (targets.length === 0) return { skipped: true };

  const violations = [];
  for (const { file } of targets) {
    const content = getChangedFileContent(file);
    if (!content) continue;
    // dispatcher 만 verifyCronRequest 필요 (개별 job 핸들러는 dispatcher 가 보호).
    if (file === 'api/cron-runner.js') {
      if (!/verifyCronRequest|cron-auth/.test(content)) {
        violations.push(`${file}: missing verifyCronRequest import — dispatcher must auth-gate before invoking jobs (PR #419 CZ3/WC5)`);
      }
      if (!/await\s+verifyCronRequest\s*\(/.test(content)) {
        violations.push(`${file}: handler must call \`await verifyCronRequest(req)\` before dispatching`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P44_cronAuthGate',
      `Cron auth gate missing — ${violations.length}건: ${violations.slice(0, 3).join(' | ')}${violations.length > 3 ? ' …' : ''}`,
      'PR #419 — api/cron-runner.js 는 verifyCronRequest(req) 로 CRON_SECRET / x-vercel-cron / admin token 셋 중 하나를 검증해야 mass email/Telegram spam 차단됨.',
    );
  }
  return null;
}

/**
 * P45_firestoreRulesFieldAllowlist — 메모리 P45 (PR #420, Audit WC7/WC8/WC9 + H20).
 * firestore.rules 변경 시 users/tours/plans 의 hardening predicate 가
 * 제거되면 fail (catch-all default-deny + affectedKeys().hasOnly() allowlists).
 */
function P45_firestoreRulesFieldAllowlist({ changed }) {
  const RULES_FILE = 'firestore.rules';
  if (!isModified(RULES_FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(RULES_FILE);
  if (!content) return { skipped: true };

  const checks = [
    {
      label: 'WC7 tours update affectedKeys hasOnly currentBookings',
      re: /match\s+\/tours\/\{tourId\}[\s\S]*?affectedKeys\(\)\s*\.\s*hasOnly\s*\(\s*\[\s*'currentBookings'/,
    },
    {
      label: "WC8 tours/bookings create status=='pending'",
      re: /match\s+\/bookings\/\{bookingId\}[\s\S]*?request\.resource\.data\.status\s*==\s*'pending'/,
    },
    {
      label: 'WC9 users create tier=Bronze default',
      re: /match\s+\/users\/\{uid\}[\s\S]*?request\.resource\.data\.tier\s*==\s*'Bronze'/,
    },
    {
      label: 'WC9 users update hasOnly allowlist',
      re: /match\s+\/users\/\{uid\}[\s\S]*?allow update[\s\S]*?affectedKeys\(\)\s*\.\s*hasOnly/,
    },
    {
      label: 'H20 plans update hasOnly allowlist',
      re: /match\s+\/plans\/\{planId\}[\s\S]*?allow update[\s\S]*?affectedKeys\(\)\s*\.\s*hasOnly/,
    },
  ];

  const missing = checks.filter((c) => !c.re.test(content));
  if (missing.length > 0) {
    fail(
      'P45_firestoreRulesFieldAllowlist',
      `firestore.rules: ${missing.length}건 hardening missing — ${missing.map((m) => m.label).join(' | ')}`,
      'PR #420 (WC7/WC8/WC9/H20) — tours/users/plans 의 affectedKeys().hasOnly() 필드 allowlist 및 default 값 검증을 복원하세요.',
    );
  }
  return null;
}

/**
 * P46_unescapedHtmlInterpolation — 메모리 P46 (PR #421, Audit CZ2).
 * api/_send-email.js / api/pdf/generate.js 등 server HTML 템플릿에서
 * booking 필드 등 user input 을 raw 로 interpolate 하면 XSS / 레이아웃 깨짐.
 *
 * 트리거: api 디렉터리 내 .js 파일에서 `\${booking.foo}` 같이
 * 흔히 user-controlled 인 객체 필드를 HTML 백틱 안에 escape 없이 흘리는 경우.
 *
 * Heuristic — 정확도 < 1.0:
 *  - api/_send-email.js / api/pdf/generate.js / api/_telegram.js / api/_shared/notify.js
 *    파일만 검사 (HTML 템플릿 경로).
 *  - 위 risky field 패턴이 escapeHtml/escapeAttr/escapeTelegram 안에
 *    없으면 violation.
 *
 * False-positive 가능 — 의도된 raw HTML (script 가 아닌 알려진 값) 은
 * 주석 PR-421-safe 로 silence.
 */
function P46_unescapedHtmlInterpolation({ changed }) {
  const TARGETS = new Set([
    'api/_send-email.js',
    'api/pdf/generate.js',
  ]);
  const targets = (changed || []).filter((c) => c.status !== 'D' && TARGETS.has(c.file));
  if (targets.length === 0) return { skipped: true };

  // Look for `${booking.<field>}` outside an escapeHtml(/escapeAttr/escapeTelegram(...)) call.
  // Conservative: only flag clear user-input fields.
  const RISKY_FIELDS = /\$\{(booking\.(customerName|product|tourDate|pickupLocation|dropoffLocation|paxCount|bookingRef|amountUSD|customerEmail)|customerName|customerEmail|userEmail|guestName)\b[^}]*\}/g;
  const SAFE_WRAPPED = /escape(Html|Attr|Telegram)\(/;
  // Track which template literal we're inside: `const html = \`...\`` vs
  // `const text = \`...\``. Plain-text literals don't need HTML escape.
  const HTML_LITERAL_START = /(?:^|\s)(const|let)\s+(html|finalHtml|body|walletBtn|walletSection|reconciliationNotice)\s*[+=]?=\s*`/;
  const TEXT_LITERAL_START = /(?:^|\s)(const|let)\s+(text|subject)\s*[+=]?=\s*`/;
  const LITERAL_END = /`/;

  const violations = [];
  for (const { file } of targets) {
    const content = getChangedFileContent(file);
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    let context = 'unknown'; // 'html' | 'text' | 'unknown'
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('PR-421-safe')) { /* fall-through to flag check (silenced) */ }
      // Detect template-literal boundaries to track context.
      if (HTML_LITERAL_START.test(line)) context = 'html';
      else if (TEXT_LITERAL_START.test(line)) context = 'text';
      // A closing backtick that's not part of a `${...}` resets context.
      // Heuristic: line ends with backtick-semicolon (`;) or backtick-comma.
      if (/`\s*[;,)]\s*$/.test(line) && context !== 'unknown') context = 'unknown';

      if (line.includes('PR-421-safe')) continue;
      if (!line.includes('${')) continue;
      // Skip plain-text contexts — XSS doesn't apply.
      if (context === 'text' || context === 'unknown') continue;

      const matches = line.match(RISKY_FIELDS);
      if (!matches) continue;
      for (const m of matches) {
        const pos = line.indexOf(m);
        const before = line.slice(Math.max(0, pos - 30), pos);
        if (!SAFE_WRAPPED.test(before)) {
          violations.push(`${file}:L${i + 1}: ${m.trim()} — unescaped user input in HTML template`);
          break;
        }
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P46_unescapedHtmlInterpolation',
      `${violations.length}건 HTML 템플릿에 escape 없는 user input — ${violations.slice(0, 3).join(' | ')}${violations.length > 3 ? ' …' : ''}`,
      'PR #421 — escapeHtml(...) / escapeAttr(...) 로 wrap. 의도된 raw HTML 이면 // PR-421-safe 주석 추가.',
    );
  }
  return null;
}

/**
 * P47_paypalWebhookRawBody — 메모리 P47 (PR #423, Audit CZ6).
 * api/paypal-webhook.js 의 raw body 가 Vercel auto-parse + re-stringify
 * 되면 canonical form 차이로 signature verify 실패 → 자동 결제 확인 fail.
 * `api: { bodyParser: false }` 설정 누락 또는 readRawBody 가 다시
 * JSON.stringify(req.body) 패턴으로 회귀하면 fail.
 */
function P47_paypalWebhookRawBody({ changed }) {
  const FILE = 'api/paypal-webhook.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];
  if (!/api\s*:\s*\{\s*bodyParser\s*:\s*false\s*\}/.test(content)) {
    violations.push(`${FILE}: missing \`api: { bodyParser: false }\` — PayPal signed bytes must reach the verify API unmodified`);
  }
  if (/return\s+JSON\.stringify\(\s*req\.body\s*\)/.test(content)) {
    violations.push(`${FILE}: re-stringifying req.body breaks PayPal signature canonicalisation (CZ6 regression)`);
  }
  if (violations.length > 0) {
    fail(
      'P47_paypalWebhookRawBody',
      `${violations.length}건 — ${violations.join(' | ')}`,
      'PR #423 — Vercel bodyParser off + raw stream read. Re-stringify 한 body 는 verify-webhook-signature 가 reject (canonical form drift).',
    );
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
  ['P34_priceUsdConsistency', P34_priceUsdConsistency],
  ['P43_authIdorBodyTrusted', P43_authIdorBodyTrusted],
  ['P44_cronAuthGate', P44_cronAuthGate],
  ['P45_firestoreRulesFieldAllowlist', P45_firestoreRulesFieldAllowlist],
  ['P46_unescapedHtmlInterpolation', P46_unescapedHtmlInterpolation],
  ['P47_paypalWebhookRawBody', P47_paypalWebhookRawBody],
  ['P48_voucherCjkFont', P48_voucherCjkFont],
  ['P49_paymentIntegrity', P49_paymentIntegrity],
  ['P50_refundTourTime', P50_refundTourTime],
  ['P51_couponPreLock', P51_couponPreLock],
  ['P52_swNoApiCache', P52_swNoApiCache],
  ['P53_complaintRateLimit', P53_complaintRateLimit],
  ['P54_foodIndexCache', P54_foodIndexCache],
  ['P55_webhookExchangeRate', P55_webhookExchangeRate],
  ['P56_manualPaymentRateLimit', P56_manualPaymentRateLimit],
  ['P57_aiPlannerCouponGate', P57_aiPlannerCouponGate],
  ['P58_globalPromoRaceCapCheck', P58_globalPromoRaceCapCheck],
  ['P60_bookingProcessorFireAndForget', P60_bookingProcessorFireAndForget],
  ['P61_adminCorsWildcard', P61_adminCorsWildcard],
  ['P62_paypalWebhookDirectFlowMatch', P62_paypalWebhookDirectFlowMatch],
  ['P63_customerEmailSilentFail', P63_customerEmailSilentFail],
  ['P64_paypalWebhookVerifyFailedRetryStorm', P64_paypalWebhookVerifyFailedRetryStorm],
  ['P65_adminAuthColdStartInit', P65_adminAuthColdStartInit],
  ['P66_pushVapidAuthFailedCleanup', P66_pushVapidAuthFailedCleanup],
  ['P67_telegramThrottleFailClosed', P67_telegramThrottleFailClosed],
  ['P68_bookingsWriteRetryAlert', P68_bookingsWriteRetryAlert],
  ['P69_firestoreFieldLengthCaps', P69_firestoreFieldLengthCaps],
  ['P70_appCatchAllRoute', P70_appCatchAllRoute],
  ['P71_gmailSmtpQuotaGuard', P71_gmailSmtpQuotaGuard],
  ['P72_chatRateLimitNatImmune', P72_chatRateLimitNatImmune],
  ['P73_useAuthForegroundTokenRefresh', P73_useAuthForegroundTokenRefresh],
  ['P74_planDetailListenerStableDep', P74_planDetailListenerStableDep],
  ['P75_notifyTelegram4096Truncate', P75_notifyTelegram4096Truncate],
  ['P76_bookingAmountNanGuard', P76_bookingAmountNanGuard],
  ['P77_triggerDownstreamSilentPaths', P77_triggerDownstreamSilentPaths],
  ['P78_pdfImageProxyCorsGuard', P78_pdfImageProxyCorsGuard],
  ['P79_wizardPersistenceQuotaSweep', P79_wizardPersistenceQuotaSweep],
  ['P80_iosBlobPopupBlocker', P80_iosBlobPopupBlocker],
  ['P81_refundAllSettledInspect', P81_refundAllSettledInspect],
  ['P82_pdfCanvasPerBandCheck', P82_pdfCanvasPerBandCheck],
  ['P83_routeEnrichmentSilentCatch', P83_routeEnrichmentSilentCatch],
  ['P84_planPersisterTruncateSurface', P84_planPersisterTruncateSurface],
  ['P85_geminiRetryDeterministicModel', P85_geminiRetryDeterministicModel],
  ['P86_repairDroppedGuidesAlert', P86_repairDroppedGuidesAlert],
  ['P87_routeBlindFallbackRatio', P87_routeBlindFallbackRatio],
  ['P88_bmealSnackSlot', P88_bmealSnackSlot],
  ['P89_avoidListIndexAlert', P89_avoidListIndexAlert],
  ['P90_dbmatcherCityGuard', P90_dbmatcherCityGuard],
  ['P91_templateLiteralBacktickEscape', P91_templateLiteralBacktickEscape],
  ['P92_pdfCaptureCutoff', P92_pdfCaptureCutoff],
  ['P93_sectionTabsMobileOverflow', P93_sectionTabsMobileOverflow],
  ['P94_vercelIgnoreShallowCloneSafe', P94_vercelIgnoreShallowCloneSafe],
  ['P95_paypalSdkNoUnverifiedWallets', P95_paypalSdkNoUnverifiedWallets],
  ['P96_longRunningEndpointInstrumentation', P96_longRunningEndpointInstrumentation],
  ['P107_aiTranslateReverseBackcompat', P107_aiTranslateReverseBackcompat],
  ['P108_slotCapacityPreLockTransaction', P108_slotCapacityPreLockTransaction],
];

/**
 * P92_pdfCaptureCutoff — 메모리 P92 (2026-05-18, no-PR-yet).
 * src/pages/PlanDetailPage/pdfGenerator.ts 의 html2canvas capture 가 늦게
 * 로드된 이미지/폰트 layout reflow 전에 측정한 scrollHeight 만큼만 캡처해
 * Day 후반/Wrap-up 잘리는 회귀 차단.
 *   - 단일 측정 (`const measuredHeight = container.scrollHeight;` 만 있고 이후
 *     stabilize 루프가 없음) 패턴 검출 시 fail.
 *   - expectedMinHeight hard gate (`days.length * 800` 식 비교) 누락 시 fail.
 *   - 알림 endpoint 호출 (`/api/alert-pdf-cutoff`) 누락 시 fail.
 *
 * 회귀 슬롯: tests/unit/pdf-capture-cutoff-pr92.test.ts
 */
function P92_pdfCaptureCutoff({ changed }) {
  const FILE = 'src/pages/PlanDetailPage/pdfGenerator.ts';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1) scrollHeight stabilize 루프 — `while (h1 !== h2 ...)` 같은 안정화 패턴 필수.
  //    단일 측정 (`const measuredHeight = container.scrollHeight;` 만 있고
  //    이후 재측정 없음) 으로 회귀하면 늦은 이미지 reflow 가 다시 잘림.
  const hasStabilizeLoop =
    /while\s*\(\s*h1\s*!==\s*h2[\s\S]{0,300}container\.scrollHeight/.test(content);
  if (!hasStabilizeLoop) {
    violations.push(
      `${FILE}: scrollHeight stabilize loop 누락 — late-image reflow 가 measuredHeight 측정 후 layout 늘리면 capture 잘림 (P92 회귀)`,
    );
  }

  // 2) image load/error 진짜 await 필요. setTimeout 추정만으론 부족.
  const hasImageAwait =
    /addEventListener\(\s*['"]load['"][\s\S]{0,200}addEventListener\(\s*['"]error['"]/.test(
      content,
    ) ||
    /addEventListener\(\s*['"]error['"][\s\S]{0,200}addEventListener\(\s*['"]load['"]/.test(
      content,
    );
  if (!hasImageAwait) {
    violations.push(
      `${FILE}: img load+error 이벤트 await 누락 — setTimeout 추정만으론 늦은 이미지 reflow 보장 X`,
    );
  }

  // 3) expectedMinHeight hard gate — scrollH < expectedMinH 비교 + abort.
  const hasMinHeightGate =
    /expectedMinH\s*=\s*days\.length\s*\*\s*800/.test(content) &&
    /scrollH\s*<\s*expectedMinH/.test(content);
  if (!hasMinHeightGate) {
    violations.push(
      `${FILE}: expectedMinHeight hard gate (days*800 + arrival*600 + departure*800) 누락 — 잘린 PDF 가 그대로 다운로드됨`,
    );
  }

  // 4) /api/alert-pdf-cutoff alert 호출 — 운영자 즉시 감지 위함.
  if (!/fetch\(\s*['"]\/api\/alert-pdf-cutoff['"]/.test(content)) {
    violations.push(
      `${FILE}: backend alert endpoint (/api/alert-pdf-cutoff) 호출 누락 — capture cut-off 운영자 알림 침묵`,
    );
  }

  // 5) 자동 server escalate — cut-off 시 VITE flag 무시하고 server endpoint
  //    force 호출. 사용자 손에 잘린 PDF 못 가게 자동 복구하는 게 P92 의 본질.
  const hasForceServer =
    /tryServerPdf\(\s*plan\s*,\s*\{\s*force\s*:\s*true\s*\}\s*\)/.test(content);
  const hasForceFlag = /if\s*\(\s*!opts\.force\s*&&\s*import\.meta\.env\.VITE_USE_SERVER_PDF/.test(content);
  if (!hasForceServer || !hasForceFlag) {
    violations.push(
      `${FILE}: cut-off 시 tryServerPdf({force:true}) 자동 escalate + force-bypass-VITE 둘 다 필요 — 운영자 env 켜둠 여부와 무관하게 자동 복구되어야 사용자가 잘린 PDF 안 받음`,
    );
  }

  // 6) alert payload 에 recoveredViaServer 플래그 — 운영자가 자동복구 hit 와
  //    수동개입 critical hit 구분 가능해야 함.
  if (!/recoveredViaServer/.test(content)) {
    violations.push(
      `${FILE}: alert payload 에 recoveredViaServer 누락 — 운영자가 auto-recovered vs manual-intervention 구분 불가`,
    );
  }

  if (violations.length > 0) {
    fail(
      'P92_pdfCaptureCutoff',
      `${violations.length}건 — ${violations.join(' | ')}`,
      '메모리 P92 — image onload await + scrollHeight stabilize + expectedMinHeight hard gate + /api/alert-pdf-cutoff + 자동 server escalate + recoveredViaServer 플래그 6종 모두 유지.',
    );
  }
  return null;
}

/**
 * P93_sectionTabsMobileOverflow — 메모리 P93 (2026-05-18, no-PR-yet).
 * src/pages/PlanDetailPage/components/SectionTabs.tsx 의 모바일 가로스크롤
 * 탭바 가시성 회귀 차단.
 *   - active tab `scrollIntoView({inline:'center'})` 누락 → Day 6+ 탭이 영영 viewport 밖.
 *   - 우측 fade gradient 누락 → 사용자가 가로 스크롤 가능성 인지 못 함 (scrollbar-hide 와 결합 시 치명적).
 *
 * 회귀 슬롯: tests/unit/section-tabs-mobile-overflow-pr93.test.ts
 */
function P93_sectionTabsMobileOverflow({ changed }) {
  const FILE = 'src/pages/PlanDetailPage/components/SectionTabs.tsx';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1) activeKey 변화 시 scrollIntoView(center). 유일한 신호.
  const hasAutoScroll =
    /scrollIntoView\(\s*\{[^}]*inline\s*:\s*['"]center['"][^}]*\}\s*\)/.test(content) &&
    /\}\s*,\s*\[activeKey\]\s*\)/.test(content);
  if (!hasAutoScroll) {
    violations.push(
      `${FILE}: active tab scrollIntoView({inline:'center'}) on [activeKey] 누락 — 모바일에서 Day 후반 탭이 viewport 밖에 잔류`,
    );
  }

  // 2) 우측 fade gradient — 가로 스크롤 가능 시각 신호. scrollbar-hide 만 있으면 가시성 0.
  const hasFade =
    /bg-gradient-to-l/.test(content) &&
    /pointer-events-none/.test(content) &&
    /aria-hidden=["']true["']/.test(content);
  if (!hasFade) {
    violations.push(
      `${FILE}: 우측 fade gradient (bg-gradient-to-l + pointer-events-none + aria-hidden) 누락 — scrollbar-hide 와 결합 시 가로 스크롤 가능성 시각 신호 0`,
    );
  }

  if (violations.length > 0) {
    fail(
      'P93_sectionTabsMobileOverflow',
      `${violations.length}건 — ${violations.join(' | ')}`,
      '메모리 P93 — useEffect([activeKey]) scrollIntoView + 우측 fade gradient 둘 다 유지.',
    );
  }
  return null;
}

/**
 * P94_vercelIgnoreShallowCloneSafe — 메모리 P94 (2026-05-19, no-PR-yet).
 * scripts/vercel-ignore.sh 가 set -e + VERCEL_GIT_PREVIOUS_SHA (shallow clone 에
 * 없는 abandoned/recreated PR 의 이전 deploy SHA 가능) + git diff 실패 조합으로
 * non-binary exit 코드 → Vercel "Error" 상태로 PR preview 빌드 차단되는 회귀.
 *
 * 실제 발현: PR #410 (dependabot dev-deps recreate) — Builds 0ms + status Error.
 * 영향: required `smoke` check 가 Vercel preview 의존 → mergeStateStatus UNSTABLE
 * → branch protection 머지 차단 → admin override 필요.
 *
 * 회귀 슬롯: scripts/test-vercel-ignore.sh (12 case, 핵심: Case 5 unreachable SHA).
 */
function P94_vercelIgnoreShallowCloneSafe({ changed }) {
  const FILE = 'scripts/vercel-ignore.sh';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1) set -e 사용 금지 — command substitution 실패가 non-binary exit 로 propagate.
  //    명시적 || true / if/then 으로 분기해야 fail-safe 보장.
  if (/^\s*set\s+-e\s*$/m.test(content)) {
    violations.push(
      `${FILE}: \`set -e\` 사용 — git diff 실패 시 non-binary exit → Vercel "Error". 명시적 fallback (|| true + exit code 변수 체크) 사용.`,
    );
  }

  // 2) is_commit_reachable 헬퍼 함수 존재 — BASE SHA 가 shallow clone 에 있는지
  //    확인 후 사용해야 함. 헬퍼 함수 정의 검출.
  const hasReachableFn =
    /is_commit_reachable\s*\(\s*\)\s*\{[\s\S]{0,200}git\s+rev-parse\s+--verify[\s\S]{0,80}\^\{commit\}/.test(
      content,
    );
  if (!hasReachableFn) {
    violations.push(
      `${FILE}: \`is_commit_reachable()\` 헬퍼 누락 — git rev-parse --verify --quiet \$SHA^{commit} 로 도달성 확인 후 사용해야 abandoned PR 의 stale VERCEL_GIT_PREVIOUS_SHA 안전 처리`,
    );
  }

  // 3) VERCEL_GIT_PREVIOUS_SHA 사용 전 is_commit_reachable 호출 — unreachable 시
  //    fallback 으로 origin/main merge-base 사용.
  const hasGuardedPrev =
    /\[\s*-n\s+"\$VERCEL_GIT_PREVIOUS_SHA"\s*\]\s*&&\s*is_commit_reachable\s+"\$VERCEL_GIT_PREVIOUS_SHA"/.test(
      content,
    );
  if (!hasGuardedPrev) {
    violations.push(
      `${FILE}: VERCEL_GIT_PREVIOUS_SHA 도달성 미검증 사용 — \`[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && is_commit_reachable "$VERCEL_GIT_PREVIOUS_SHA"\` 패턴 필요. 미검증 시 stale SHA 가 git diff 실패 유발 → Vercel "Error".`,
    );
  }

  // 4) git diff 실패 시 fail-safe — || true 로 exit code 흡수 + 변수 체크로 분기.
  const hasDiffFailSafe =
    /git\s+diff\s+--name-only\s+"\$BASE"\s+HEAD\s+2>\/dev\/null\s+\|\|\s+true/.test(
      content,
    ) || /CHANGED=\$\([^)]*git\s+diff[^)]*\|\|\s+true\)/.test(content);
  if (!hasDiffFailSafe) {
    violations.push(
      `${FILE}: git diff fail-safe 누락 — \`git diff ... 2>/dev/null || true\` 로 exit code 흡수 필요. 미적용 시 BASE 가 unreachable 일 때 (예: race condition) 스크립트 non-binary exit.`,
    );
  }

  // 5) 모든 exit 분기는 0 또는 1 만 반환해야 함 (Vercel 의 binary contract).
  //    exit 2 같은 우발 케이스 검출.
  const otherExits = content.match(/^\s*exit\s+([2-9]|\d{2,})\b/gm);
  if (otherExits && otherExits.length > 0) {
    violations.push(
      `${FILE}: non-binary exit 코드 검출 (${otherExits.join(', ')}) — Vercel 은 0=skip, 1=build 만 인식. 그 외는 "Error" 로 처리됨.`,
    );
  }

  if (violations.length > 0) {
    fail(
      'P94_vercelIgnoreShallowCloneSafe',
      `${violations.length}건 — ${violations.join(' | ')}`,
      '메모리 P94 — set -e 금지 + is_commit_reachable 헬퍼 + VERCEL_GIT_PREVIOUS_SHA 도달성 검증 + git diff || true fail-safe + binary exit (0/1) 모두 유지. abandoned/recreated PR 시나리오 PR #410 (#477 이후) 사례.',
    );
  }
  return null;
}

/**
 * P95_paypalSdkNoUnverifiedWallets — 메모리 P95 (2026-05-19, PR after #478).
 * src/components/PayPalBookingButton.tsx 의 PayPal SDK script URL 에
 * `enable-funding=googlepay,applepay` (또는 `applepay,googlepay`) 재추가 차단.
 *
 * 원인: Apple Pay/Google Pay 활성화는 PayPal 머천트 대시보드 도메인 등록 +
 * /.well-known/apple-developer-merchantid-domain-association 호스팅 둘 다 필수.
 * cocotripkr.com 미등록 상태에서 SDK URL 에 enable-funding=applepay 포함하면
 * PayPal CDN 이 HTTP 400 반환 → SDK 로드 실패 → 결제 페이지 사망.
 *
 * 회귀 슬롯: tests/unit/paypal-sdk-no-unverified-wallets-pr95.test.ts
 */
function P95_paypalSdkNoUnverifiedWallets({ changed }) {
  const FILE = 'src/components/PayPalBookingButton.tsx';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1) 코드 라인 (코멘트 제외) 에 enable-funding=googlepay,applepay (또는 역순) 검출.
  //    회귀 시 PayPal CDN 이 SDK js 요청에 400 반환 → 결제 surface 전부 사망.
  const lines = content.split(/\r?\n/);
  let codeLineViolations = 0;
  let firstViolatingLine = '';
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (
      /enable-funding=googlepay,applepay/.test(line) ||
      /enable-funding=applepay,googlepay/.test(line)
    ) {
      codeLineViolations++;
      if (!firstViolatingLine) firstViolatingLine = `L${idx + 1}: ${trimmed.slice(0, 100)}`;
    }
  });
  if (codeLineViolations > 0) {
    violations.push(
      `${FILE}: \`enable-funding=googlepay,applepay\` 코드 라인 재등장 (${codeLineViolations}건, 예: ${firstViolatingLine}) — PayPal 머천트 대시보드 도메인 등록 + Apple Pay merchantid-domain-association 호스팅 안 됐으면 SDK CDN HTTP 400 → 결제 페이지 사망 회귀`,
    );
  }

  // 2) components=buttons 핵심 SDK 컴포넌트 유지 (회귀 시 결제 자체 안 됨).
  if (!/components=buttons/.test(content)) {
    violations.push(
      `${FILE}: \`components=buttons\` 누락 — PayPal 버튼 SDK 자체 미실행. enable-funding 만 제거하고 components 도 같이 떨어뜨리면 SDK 가 아무것도 실행 안 함.`,
    );
  }

  // 3) live PayPal URL 유지 (sandbox 분기 회귀 시 prod 결제 실패).
  if (!/https:\/\/www\.paypal\.com\/sdk\/js/.test(content)) {
    violations.push(
      `${FILE}: PayPal live SDK URL (https://www.paypal.com/sdk/js) 누락 — sandbox 분기 회귀 시 prod 결제 영구 실패. 2026-05-03 PR 에서 의도적으로 sandbox 분기 제거됨.`,
    );
  }

  if (violations.length > 0) {
    fail(
      'P95_paypalSdkNoUnverifiedWallets',
      `${violations.length}건 — ${violations.join(' | ')}`,
      '메모리 P95 — enable-funding=googlepay,applepay 코드 라인 회귀 차단 (머천트 대시보드 도메인 등록 + .well-known 호스팅 둘 다 완료 후만 재추가). components=buttons + live PayPal URL 유지.',
    );
  }
  return null;
}

/**
 * P96_longRunningEndpointInstrumentation — 메모리 P96 (PR #482, 2026-05-19).
 *
 * api/*.js 중 `export const maxDuration >= 180` (3분 이상) endpoint 에
 * step-level elapsed log (withStep helper) + cap 도달 직전 admin alert
 * 둘 다 부재하면 fail. 2026-05-19 ai-planner-full 5분 hang 인시던트 진단
 * 사각지대 회귀 차단.
 *
 * Rationale: maxDuration=300 (Vercel Pro cap) endpoint 가 hang 했을 때
 * START + TOTAL 두 로그만 있으면 prod logs 도 어느 step 에서 멈췄는지
 * 알 수 없음. withStep('label', fn) 패턴이 ENTER/DONE/FAILED elapsed 로그
 * 의무. 추가로 setTimeout((maxDuration-30s), () => admin alert) 로 cap
 * 도달 전 last step 정보 노출 필수.
 *
 * Threshold = 180s: 3분 이하 endpoint 는 hang risk 낮음 + 진단 ROI 작음.
 * 현재 trigger: api/ai-planner-full.js (300s) 만 해당. 미래 새 long-running
 * endpoint 추가 시 자동 cover (L5 자율 검증 카테고리).
 *
 * 회귀 슬롯: tests/unit/planner-step-instrumentation-pr96.test.ts (specific file).
 */
function P96_longRunningEndpointInstrumentation({ changed }) {
  const apiFiles = changed
    .filter((c) => c.file.startsWith('api/') && c.file.endsWith('.js') && c.status !== 'D')
    .map((c) => c.file);

  for (const file of apiFiles) {
    const content = getChangedFileContent(file);
    if (!content) continue;

    const maxDurMatch = content.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
    if (!maxDurMatch) continue;
    const maxDur = parseInt(maxDurMatch[1], 10);
    if (maxDur < 180) continue;

    const hasWithStep = /async\s+function\s+withStep\s*\(\s*\w+\s*,\s*\w+\s*\)/.test(content);
    const hasHangAlert =
      /HANG_WARN_MS|hangWarnTimer/.test(content) ||
      /setTimeout\([\s\S]{0,300}throttledTelegramAlert/.test(content);

    if (!hasWithStep || !hasHangAlert) {
      const missing = [];
      if (!hasWithStep) missing.push('withStep helper');
      if (!hasHangAlert) missing.push('hang alert setTimeout (cap-30s)');
      fail(
        'P96_longRunningEndpointInstrumentation',
        `${file}: maxDuration=${maxDur}s endpoint 에 ${missing.join(' + ')} 부재 — P96 hang 진단 사각지대 회귀`,
        '메모리 P96 (PR #482) — 5분 cap 도달 시 어느 step 에서 멈췄는지 prod logs/Telegram 으로 즉시 식별 가능해야 함. ai-planner-full.js 의 withStep + hangWarnTimer 패턴 참조.',
      );
    }
  }
  return null;
}

/**
 * P107_aiTranslateReverseBackcompat — 메모리 P107 (2026-05-20, no-PR-yet).
 *
 * Phase 5 reverse translation (admin-translate.js) 가 Phase 4 backward compat
 * 깨지면 fail. resolveSourceAndTargets 가 두 body 형태 (Phase 5 source object
 * + Phase 4 korean string) 모두 받아야 함. 클라이언트 헬퍼 (translateKoreanToOthers)
 * 가 미배포 client 와 함께 작동.
 *
 * 또한 buildPrompt + ALL_LANGS 가 named export 되어야 unit test 가 import 가능.
 *
 * 회귀 슬롯: tests/unit/admin-translate-prompt.test.ts (24 케이스).
 */
function P107_aiTranslateReverseBackcompat({ changed }) {
  const violations = [];

  const API_FILE = 'api/admin-translate.js';
  if (isModified(API_FILE, changed)) {
    const content = getChangedFileContent(API_FILE);
    if (content) {
      if (!/export\s+function\s+resolveSourceAndTargets/.test(content)) {
        violations.push(`${API_FILE}: resolveSourceAndTargets 미export — Phase 5 body resolver 회귀 (legacy korean field 폴백 깨질 수 있음)`);
      }
      if (!/export\s+function\s+buildPrompt/.test(content)) {
        violations.push(`${API_FILE}: buildPrompt 미export — unit test 가 prompt 회귀 검출 불가`);
      }
      if (!/export\s+const\s+ALL_LANGS/.test(content)) {
        violations.push(`${API_FILE}: ALL_LANGS 미export — schema canonical set drift 가능`);
      }
      // legacy backcompat: body.korean 경로가 코드에 남아 있어야 함 (Phase 4 미배포
      // client 가 보내는 { korean: ... } body 처리). resolveSourceAndTargets 안에서.
      if (!/body\.korean/.test(content)) {
        violations.push(`${API_FILE}: legacy body.korean 분기 누락 — Phase 4 client 호환성 깨짐`);
      }
      // 4-lang canonical: ko/en/ja/zh — Phase 5 source 가 모두 받을 수 있어야 함.
      if (!/\['ko',\s*'en',\s*'ja',\s*'zh'\]/.test(content)) {
        violations.push(`${API_FILE}: ALL_LANGS 4-lang canonical 배열 형태 누락 — schema drift`);
      }
    }
  }

  const LIB_FILE = 'src/lib/admin-translate.ts';
  if (isModified(LIB_FILE, changed)) {
    const content = getChangedFileContent(LIB_FILE);
    if (content) {
      if (!/export\s+async\s+function\s+translateFromSource/.test(content)) {
        violations.push(`${LIB_FILE}: translateFromSource 미export — Phase 5 클라이언트 호출 경로 누락`);
      }
      if (!/export\s+async\s+function\s+translateKoreanToOthers/.test(content)) {
        violations.push(`${LIB_FILE}: translateKoreanToOthers 미export — Phase 4 호환 wrapper 누락 (기존 I18nField 호출처 break)`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P107_aiTranslateReverseBackcompat',
      violations.join(' | '),
      '메모리 P107 — Phase 5 4-lang any-direction 번역. Phase 4 backward compat 유지 필수 (legacy { korean } body + translateKoreanToOthers wrapper). tests/unit/admin-translate-prompt.test.ts 24 케이스 참조.',
    );
  }
  return null;
}

/**
 * P108_slotCapacityPreLockTransaction — 메모리 P108 (2026-05-20, no-PR-yet).
 *
 * TourSlot 별 잔여석 차감 로직이 createPaypalOrder.js / capturePaypalOrder.js /
 * cron-runner.js 에서 빠지면 overbooking 회귀. 슬롯 사용 투어 (어드민 상품
 * 시스템 Phase 1 의 TourSlot.capacity) 의 동시 결제 race condition 차단.
 *
 * 회귀 차단:
 *   - api/_shared/slot-capacity.js: acquireSlotLock + confirmSlotLock +
 *     sweepExpiredPending 3 export 유지 + runTransaction 호출 (race-safe).
 *   - api/createPaypalOrder.js: acquireSlotLock import + 호출 분기 (4 필드
 *     모두 있을 때만 발화 — backward compat).
 *   - api/capturePaypalOrder.js: confirmSlotLock import + 호출 분기.
 *   - api/cron-runner.js: slot-pending-sweep job 등록 (Vercel cron, 5분 간격).
 *
 * 회귀 슬롯: tests/unit/slot-capacity.test.ts (22 케이스 — capacity gate /
 * expired pending overwrite / status fully_booked guard / lost-lock re-validate /
 * cron sweep idempotency).
 */
function P108_slotCapacityPreLockTransaction({ changed }) {
  const violations = [];

  const HELPER = 'api/_shared/slot-capacity.js';
  if (isModified(HELPER, changed)) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/export\s+async\s+function\s+acquireSlotLock/.test(content)) {
        violations.push(`${HELPER}: acquireSlotLock 미export — pre-lock 진입점 누락 → overbooking 회귀`);
      }
      if (!/export\s+async\s+function\s+confirmSlotLock/.test(content)) {
        violations.push(`${HELPER}: confirmSlotLock 미export — capture 시 pending→confirmed 전환 불가 → counter drift`);
      }
      if (!/export\s+async\s+function\s+sweepExpiredPending/.test(content)) {
        violations.push(`${HELPER}: sweepExpiredPending 미export — cron sweep 불가 → 만료 lock 영구 누적`);
      }
      if (!/adminDb\.runTransaction/.test(content)) {
        violations.push(`${HELPER}: runTransaction 호출 누락 — read-then-write race condition → 동시 결제 overbooking`);
      }
    }
  }

  const CREATE = 'api/createPaypalOrder.js';
  if (isModified(CREATE, changed)) {
    const content = getChangedFileContent(CREATE);
    if (content && /tourSlotId/.test(content)) {
      // tourSlotId 분기가 추가됐다면 acquireSlotLock 호출 + import 필수.
      if (!/from\s*['"]\.\/_shared\/slot-capacity\.js['"]/.test(content)) {
        violations.push(`${CREATE}: tourSlotId 분기는 도입됐지만 slot-capacity.js import 누락 — pre-lock 무력화`);
      }
      if (!/acquireSlotLock\s*\(/.test(content)) {
        violations.push(`${CREATE}: acquireSlotLock 호출 누락 — tourSlotId 받아도 capacity 검증 X → silent overbooking`);
      }
    }
  }

  const CAPTURE = 'api/capturePaypalOrder.js';
  if (isModified(CAPTURE, changed)) {
    const content = getChangedFileContent(CAPTURE);
    if (content && /tourSlotId/.test(content)) {
      if (!/from\s*['"]\.\/_shared\/slot-capacity\.js['"]/.test(content)) {
        violations.push(`${CAPTURE}: tourSlotId 분기는 도입됐지만 slot-capacity.js import 누락 — pending 영구 누적`);
      }
      if (!/confirmSlotLock\s*\(/.test(content)) {
        violations.push(`${CAPTURE}: confirmSlotLock 호출 누락 — capture 후 pending→confirmed 전환 X → counter drift`);
      }
    }
  }

  const RUNNER = 'api/cron-runner.js';
  if (isModified(RUNNER, changed)) {
    const content = getChangedFileContent(RUNNER);
    if (content && /slot-capacity\.js/.test(getChangedFileContent(HELPER) || '')) {
      if (!/slot-pending-sweep/.test(content)) {
        violations.push(`${RUNNER}: slot-pending-sweep job 등록 누락 — pending lock 만료 후 영구 누적`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P108_slotCapacityPreLockTransaction',
      violations.join(' | '),
      '메모리 P108 — TourSlot 동시 결제 overbooking 차단. 3 endpoint 동기화 (createPaypalOrder pre-lock + capturePaypalOrder confirm + cron sweep). tests/unit/slot-capacity.test.ts 22 케이스 + transaction 안에서만 read-modify-write.',
    );
  }
  return null;
}

/**
 * P55_webhookExchangeRate — 메모리 P55 (PR #431, Audit Y-H6).
 * api/paypal-webhook.js 가 KRW/USD 환율을 1380 로 하드코딩하면 fail.
 * pricing_spec.json policy_krw_per_usd (현재 1430) 와 drift → amount_mismatch
 * false positive + 환불 KRW 잘못 계산.
 */
function P55_webhookExchangeRate({ changed }) {
  const FILE = 'api/paypal-webhook.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  // 코드 라인에서 1380 검색 (주석은 제외).
  const codeLines = content.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });
  if (codeLines.some((l) => /\b1380\b/.test(l))) {
    fail(
      'P55_webhookExchangeRate',
      `${FILE}: stale 1380 hardcoded rate — should use Number(env.KRW_USD_RATE) || Number(env.VITE_USD_KRW_RATE) || 1430`,
      'PR #431 (Y-H6) — capturePaypalOrder 와 동일한 env precedence + 1430 default 유지.',
    );
  }
  return null;
}

/**
 * P54_foodIndexCache — 메모리 P54 (PR #430, Audit X-C4).
 * api/_ai_core/geminiPipeline.js 의 loadFoodIndex 가 module-scope 캐시
 * 누락하면 fail. 매 요청 1.27MB JSON parse → ai-planner cold-start latency
 * + warm path 불필요 CPU/IO. 캐시 + in-flight promise 패턴 강제.
 */
function P54_foodIndexCache({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  if (!/let\s+_foodIndexCache\s*=/.test(content)) {
    violations.push(`${FILE}: module-scope _foodIndexCache missing — 매 요청 1.27MB parse (X-C4)`);
  }
  if (!/if\s*\(\s*_foodIndexCache\s*!==\s*null\s*\)/.test(content)) {
    violations.push(`${FILE}: cached-value early-return missing in loadFoodIndex`);
  }
  if (violations.length > 0) {
    fail(
      'P54_foodIndexCache',
      violations.join(' | '),
      'PR #430 (X-C4) — module-scope 캐시 + in-flight promise 패턴 유지. Vercel warm instance 재사용 활용.',
    );
  }
  return null;
}

/**
 * P83_routeEnrichmentSilentCatch — 메모리 P83 (PR #459, Audit X-H5).
 * routeEnrichment.js 의 RouteAgent throw 가 silent catch 만 되면 fail.
 * console.error 외에 throttledTelegramAlert (errType+regionsKey 키 dedup) 필수.
 */
function P83_routeEnrichmentSilentCatch({ changed }) {
  const FILE = 'api/_ai_core/routeEnrichment.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/from\s*['"]\.\.\/_shared\/telegram-throttle\.js['"]/.test(content)) {
    violations.push(`${FILE}: telegram-throttle import 누락 — X-H5 silent catch 회귀`);
  }
  const catchIdx = content.indexOf('catch (routeErr)');
  if (catchIdx > -1) {
    const block = content.slice(catchIdx, catchIdx + 2500);
    if (!/throttledTelegramAlert\s*\(\s*\{/.test(block)) {
      violations.push(`${FILE}: catch (routeErr) 가 throttledTelegramAlert 호출 안 함 — transit info 0건 silent`);
    }
    if (!/key:\s*`route-enrich-fail:\$\{errType\}:\$\{regionsKey\}`/.test(block)) {
      violations.push(`${FILE}: dedup key 'route-enrich-fail:\${errType}:\${regionsKey}' 패턴 누락 — storm 차단 약화`);
    }
    if (!/channel:\s*['"]admin['"]/.test(block)) {
      violations.push(`${FILE}: alert channel admin 누락 — booking 채널 다운 시 도달 불가`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P83_routeEnrichmentSilentCatch',
      violations.join(' | '),
      'PR #459 (X-H5) — RouteAgent throw → throttledTelegramAlert(admin/high/errType+regions dedup) 유지.',
    );
  }
  return null;
}

/**
 * P91_templateLiteralBacktickEscape — 메모리 P91 (PR #471 hot-fix, 5/17).
 * api/**\/*.js 의 template literal 내부에 unescaped backtick 이 있으면 fail.
 * 도입 경로: PR #417 (5/13) buildPrompt.js:550 raw \`duration_days\` → ESM
 * SyntaxError → ai-planner-full HTTP 500 FUNCTION_INVOCATION_FAILED, 4일 latent.
 *
 * 알고리즘: file 의 raw backtick (escape 안 된 것) 카운트. 짝수가 아니면 fail
 * (open/close 짝 안 맞으면 = unterminated template).
 */
function P91_templateLiteralBacktickEscape({ changed }) {
  const targets = (changed || []).filter((c) =>
    c.file.startsWith('api/') &&
    c.file.endsWith('.js') &&
    c.status !== 'D',
  );
  if (targets.length === 0) return { skipped: true };

  const violations = [];
  for (const { file } of targets) {
    const content = getChangedFileContent(file);
    if (!content) continue;
    let count = 0;
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (c === '\\') { i++; continue; }
      if (c === '`') count++;
    }
    if (count % 2 !== 0) {
      violations.push(`${file}: backtick count=${count} (odd) — unterminated template literal 가능`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P91_templateLiteralBacktickEscape',
      violations.join(' | '),
      'PR #471 hot-fix (P91) — template literal 안 backtick 은 \\\` 로 escape.',
    );
  }
  return null;
}

/**
 * P90_dbmatcherCityGuard — 메모리 P90 (PR #466, Audit X-H8).
 * api/_ai_core/dbMatcher.js 의 1차/2차 matcher 가 city 필터 누락하면 fail.
 * findFoodIndexMatch helper + same-city preferred + other-city flagged
 * + address/coords override skip on mismatch + 30% threshold admin alert.
 */
function P90_dbmatcherCityGuard({ changed }) {
  const FILE = 'api/_ai_core/dbMatcher.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/.test(content)) {
    violations.push(`${FILE}: throttledTelegramAlert import 누락 — operator silent (X-H8)`);
  }
  if (!/CITY_MISMATCH_RATIO_THRESHOLD\s*=\s*0\.3/.test(content)) {
    violations.push(`${FILE}: CITY_MISMATCH_RATIO_THRESHOLD=0.3 누락 → alert 임계 변경`);
  }
  if (!/CITY_MISMATCH_MIN_MATCHES\s*=\s*3/.test(content)) {
    violations.push(`${FILE}: CITY_MISMATCH_MIN_MATCHES=3 누락 → 작은 plan false positive`);
  }
  if (!/function\s+findFoodIndexMatch\s*\(\s*foodIndex\s*,\s*stopName\s*,\s*stopDisplayName\s*,\s*cityFilter\s*\)/.test(content)) {
    violations.push(`${FILE}: findFoodIndexMatch helper 누락 — cityFilter param signature 깨짐`);
  }
  // 3 tiers must all check cityOk
  const helperBlock = content.slice(content.indexOf('function findFoodIndexMatch'), content.indexOf('export function applyDBMatcher'));
  if (helperBlock) {
    const cityOkCount = (helperBlock.match(/cityOk\(/g) || []).length;
    if (cityOkCount < 3) {
      violations.push(`${FILE}: findFoodIndexMatch 의 cityOk 호출 < 3 — 1차/2차/3차 tier 중 일부 city 필터 누락`);
    }
  }
  // applyDBMatcher must call helper twice (with city then without)
  if (!/findFoodIndexMatch\(foodIndex,\s*stopName,\s*stopDisplayName,\s*matchCity\)/.test(content)) {
    violations.push(`${FILE}: applyDBMatcher 가 same-city 우선 호출 안 함`);
  }
  if (!/findFoodIndexMatch\(foodIndex,\s*stopName,\s*stopDisplayName,\s*null\)/.test(content)) {
    violations.push(`${FILE}: applyDBMatcher 가 no-city fallback 호출 안 함`);
  }
  // address/coord skip on mismatch
  if (!/if\s*\(\s*match\.address\s*&&\s*!isCityMismatch\s*\)/.test(content)) {
    violations.push(`${FILE}: address 덮어쓰기에 !isCityMismatch 가드 누락 → 사용자 잘못된 도시로 안내 위험`);
  }
  if (!/if\s*\(\s*!isCityMismatch\s*\)\s*\{[\s\S]*?match\.lat[\s\S]*?match\.googleMapsUrl/.test(content)) {
    violations.push(`${FILE}: lat/lng/mapUrl 덮어쓰기 block 의 !isCityMismatch 가드 누락`);
  }
  if (!/stop\._db_city_mismatch\s*=\s*\{[\s\S]*?dbCity[\s\S]*?requestedCity/.test(content)) {
    violations.push(`${FILE}: stop._db_city_mismatch 마킹 누락 → 다운스트림 detect 불가`);
  }
  if (!/stop\.verified\s*=\s*!isCityMismatch/.test(content)) {
    violations.push(`${FILE}: city-mismatch 가 verified=false 처리 안 함 → 사용자/UI 잘못된 verified 배지`);
  }
  if (!/dbmatcher-city-mismatch:\$\{matchCity\s*\|\|\s*['"]unknown['"]\}/.test(content)) {
    violations.push(`${FILE}: alert key 'dbmatcher-city-mismatch:${'${matchCity}'}' 누락`);
  }
  const alertBlock = content.slice(content.indexOf('dbmatcher-city-mismatch'), content.indexOf('dbmatcher-city-mismatch') + 2000);
  if (alertBlock && !/channel:\s*['"]admin['"]/.test(alertBlock)) {
    violations.push(`${FILE}: admin 채널 누락`);
  }
  if (alertBlock && !/severity:\s*['"]high['"]/.test(alertBlock)) {
    violations.push(`${FILE}: severity:'high' 누락`);
  }
  if (!/throttledTelegramAlert\(\{[\s\S]*?dbmatcher-city-mismatch[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(content)) {
    violations.push(`${FILE}: alert 가 .catch(()=>{}) fire-and-forget 아님`);
  }

  if (violations.length > 0) {
    fail(
      'P90_dbmatcherCityGuard',
      violations.join(' | '),
      'PR #466 (X-H8) — findFoodIndexMatch + cityOk 3-tier + override skip + verified=false + admin alert 유지.',
    );
  }
  return null;
}

/**
 * P89_avoidListIndexAlert — 메모리 P89 (PR #465, Audit X-H7).
 * api/_ai_core/avoidListQuery.js 의 Firestore composite-index 누락 silent
 * catch 면 fail. 또한 firestore.indexes.json 의 plans.uid/email 인덱스 누락 검출.
 * - isFirestoreIndexMissingError + extractIndexCreationUrl export 필수
 * - catch 에서 alert 호출 + fail-OPEN (return '') 보존
 * - plans.uid+createdAt / plans.email+createdAt 인덱스 firestore.indexes.json 에 존재
 */
function P89_avoidListIndexAlert({ changed }) {
  const CODE = 'api/_ai_core/avoidListQuery.js';
  const INDEXES = 'firestore.indexes.json';
  const touched = isModified(CODE, changed) || isModified(INDEXES, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(CODE, changed)) {
    const c = getChangedFileContent(CODE);
    if (c) {
      if (!/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/.test(c)) {
        violations.push(`${CODE}: throttledTelegramAlert import 누락 — operator silent (X-H7)`);
      }
      if (!/export\s+function\s+isFirestoreIndexMissingError\s*\(/.test(c)) {
        violations.push(`${CODE}: isFirestoreIndexMissingError export 누락 — test 표면 없음`);
      }
      if (!/export\s+function\s+extractIndexCreationUrl\s*\(/.test(c)) {
        violations.push(`${CODE}: extractIndexCreationUrl export 누락 — alert 메시지에 URL 못 넣음`);
      }
      if (!/code\s*===\s*['"]FAILED_PRECONDITION['"]\s*\|\|\s*code\s*===\s*['"]9['"]/.test(c)) {
        violations.push(`${CODE}: FAILED_PRECONDITION || code 9 detector 누락 — 다른 Firestore 에러로 false positive`);
      }
      if (!/avoid-list-index-missing:\$\{queryKind\}/.test(c)) {
        violations.push(`${CODE}: alert key 'avoid-list-index-missing:${'${queryKind}'}' 누락 → dedup 깨짐`);
      }
      const alertBlock = c.slice(c.indexOf('avoid-list-index-missing'), c.indexOf('avoid-list-index-missing') + 2000);
      if (alertBlock && !/channel:\s*['"]admin['"]/.test(alertBlock)) {
        violations.push(`${CODE}: admin 채널 누락`);
      }
      if (alertBlock && !/severity:\s*['"]high['"]/.test(alertBlock)) {
        violations.push(`${CODE}: severity:'high' 누락`);
      }
      if (!/throttledTelegramAlert\(\{[\s\S]*?avoid-list-index-missing[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(c)) {
        violations.push(`${CODE}: alert 가 .catch(()=>{}) fire-and-forget 아님`);
      }
      // fail-OPEN preserved — catch 안에 return ''
      if (!/return\s+['"]['"]\s*;/.test(c)) {
        violations.push(`${CODE}: catch 안의 return '' 누락 — fail-OPEN 깨짐 (non-critical path 보장 X)`);
      }
    }
  }

  if (isModified(INDEXES, changed)) {
    const c = getChangedFileContent(INDEXES);
    if (c) {
      try {
        const idx = JSON.parse(c);
        const hasIndex = (collectionGroup, fields) =>
          idx.indexes?.some((entry) =>
            entry.collectionGroup === collectionGroup &&
            entry.fields?.length === fields.length &&
            entry.fields.every((f, i) => f.fieldPath === fields[i].fieldPath && f.order === fields[i].order),
          );
        if (!hasIndex('plans', [
          { fieldPath: 'uid', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ])) {
          violations.push(`${INDEXES}: plans.uid+createdAt DESC 인덱스 누락 → avoidListQuery 매 호출 fail (X-H7)`);
        }
        if (!hasIndex('plans', [
          { fieldPath: 'email', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ])) {
          violations.push(`${INDEXES}: plans.email+createdAt DESC 인덱스 누락 → guest 사용자 avoidListQuery fail`);
        }
      } catch (parseErr) {
        violations.push(`${INDEXES}: JSON parse 실패 (${parseErr.message}) — firebase deploy 거부`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P89_avoidListIndexAlert',
      violations.join(' | '),
      'PR #465 (X-H7) — index 누락 detector + admin alert + fail-OPEN 보존 + 인덱스 정의 유지.',
    );
  }
  return null;
}

/**
 * P88_bmealSnackSlot — 메모리 P88 (PR #464, Audit X-H6).
 * api/_ai_core/responseValidator.js 의 B-MEAL validator 가 15:00-16:59
 * snack slot 무시하면 fail. snackCount 추가 + afternoonMealCount = lunch + snack
 * + 점심 가드는 afternoonMealCount === 0 사용 필수.
 */
function P88_bmealSnackSlot({ changed }) {
  const FILE = 'api/_ai_core/responseValidator.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // snack slot 필터 [15, 17)
  if (!/snackCount\s*=\s*foodStops\.filter\(\(s\)\s*=>\s*matchHour\(s,\s*15,\s*17\)\)/.test(content)) {
    violations.push(`${FILE}: snackCount [15,17) 필터 누락 — afternoon meal silent ignore (X-H6)`);
  }
  // lunchCount + snackCount = afternoonMealCount
  if (!/afternoonMealCount\s*=\s*lunchCount\s*\+\s*snackCount/.test(content)) {
    violations.push(`${FILE}: afternoonMealCount = lunchCount + snackCount 누락`);
  }
  // full-day 가드는 afternoonMealCount 사용
  if (!/if\s*\(\s*afternoonMealCount\s*===\s*0\s*\)\s*errors\.push/.test(content)) {
    violations.push(`${FILE}: full-day 점심 가드가 afternoonMealCount 사용 안 함 → snack false-positive 회귀`);
  }
  // arrival/departure 가드도 afternoonMealCount 사용
  if (!/if\s*\(\s*afternoonMealCount\s*===\s*0\s*&&\s*dinnerCount\s*===\s*0\s*\)/.test(content)) {
    violations.push(`${FILE}: arrival/departure 가드가 afternoonMealCount 사용 안 함`);
  }
  // dinner boundary 변경 금지 (메인 식사 분명)
  if (!/dinnerCount\s*=\s*foodStops\.filter\(\(s\)\s*=>\s*matchHour\(s,\s*17,\s*22\)\)/.test(content)) {
    violations.push(`${FILE}: dinnerCount [17,22) 변경됨 — 저녁 boundary 보존 필요`);
  }
  // lunch boundary 보존 (subset)
  if (!/lunchCount\s*=\s*foodStops\.filter\(\(s\)\s*=>\s*matchHour\(s,\s*11,\s*15\)\)/.test(content)) {
    violations.push(`${FILE}: lunchCount [11,15) 변경됨 — lunch+snack 분리 telemetry 깨짐`);
  }
  // 텔레메트리 snack 포함
  if (!/lunch=\$\{lunchCount\}\s*snack=\$\{snackCount\}/.test(content)) {
    violations.push(`${FILE}: 텔레메트리 로그에 snack=N 누락 → 운영자 분석 어려움`);
  }
  // env flag 보존
  if (!/process\.env\.VALIDATOR_BMEAL_ENABLED\s*!==\s*['"]false['"]/.test(content)) {
    violations.push(`${FILE}: VALIDATOR_BMEAL_ENABLED env flag 제거됨 — 비상 circuit breaker 손실`);
  }

  if (violations.length > 0) {
    fail(
      'P88_bmealSnackSlot',
      violations.join(' | '),
      'PR #464 (X-H6) — snack slot [15,17) + afternoonMealCount + telemetry 유지.',
    );
  }
  return null;
}

/**
 * P87_routeBlindFallbackRatio — 메모리 P87 (PR #463, Audit X-H4).
 * api/_ai_core/agents/RouteAgent.js 가 blind 25min/5km fallback 을
 * silent 하면 fail (transit_from_prev 에 _blind_fallback 플래그 필수).
 * api/_ai_core/routeEnrichment.js 는 RouteAgent 출력 후 blind 비율 집계 +
 * 40% 초과 시 admin alert 필수.
 */
function P87_routeBlindFallbackRatio({ changed }) {
  const AGENT = 'api/_ai_core/agents/RouteAgent.js';
  const ENRICH = 'api/_ai_core/routeEnrichment.js';
  const touched = isModified(AGENT, changed) || isModified(ENRICH, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(AGENT, changed)) {
    const c = getChangedFileContent(AGENT);
    if (c) {
      // isBlindFallback 식별 (4-input AND chain)
      if (!/const\s+isBlindFallback\s*=/.test(c)) {
        violations.push(`${AGENT}: isBlindFallback boolean 누락 — 25min/5km path 식별 불가 (X-H4)`);
      }
      if (!/source:\s*isBlindFallback\s*\?\s*['"]blind_25_no_coords['"]\s*:\s*['"]naver_fallback['"]/.test(c)) {
        violations.push(`${AGENT}: naver_fallback 분기 source flag 누락 (blind_25_no_coords vs naver_fallback)`);
      }
      if (!/_blind_fallback:\s*true/.test(c)) {
        violations.push(`${AGENT}: _blind_fallback:true 마킹 누락 → routeEnrichment 가 비율 못 잼`);
      }
    }
  }

  if (isModified(ENRICH, changed)) {
    const c = getChangedFileContent(ENRICH);
    if (c) {
      if (!/blindFallbackStops\s*=\s*allStops\.filter\(\(s\)\s*=>\s*s\.transit_from_prev\?\._blind_fallback\s*===\s*true\)\.length/.test(c)) {
        violations.push(`${ENRICH}: blindFallbackStops 집계 누락`);
      }
      if (!/const\s+BLIND_RATIO_THRESHOLD\s*=\s*0\.4/.test(c)) {
        violations.push(`${ENRICH}: BLIND_RATIO_THRESHOLD=0.4 누락 → alert 임계 변경`);
      }
      if (!/const\s+MIN_TRANSITS_FOR_ALERT\s*=\s*5/.test(c)) {
        violations.push(`${ENRICH}: MIN_TRANSITS_FOR_ALERT=5 누락 → arrival-day 1-transit edge false positive`);
      }
      if (!/route-blind-fallback:\$\{regionsKey\}/.test(c)) {
        violations.push(`${ENRICH}: dedup key 'route-blind-fallback:${'${regionsKey}'}' 누락`);
      }
      const alertBlock = c.slice(c.indexOf('route-blind-fallback'), c.indexOf('route-blind-fallback') + 2500);
      if (alertBlock && !/channel:\s*['"]admin['"]/.test(alertBlock)) {
        violations.push(`${ENRICH}: admin 채널 누락`);
      }
      if (alertBlock && !/severity:\s*['"]high['"]/.test(alertBlock)) {
        violations.push(`${ENRICH}: severity:'high' 누락`);
      }
      if (!/throttledTelegramAlert\(\{[\s\S]*?route-blind-fallback[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(c)) {
        violations.push(`${ENRICH}: alert 가 .catch(()=>{}) fire-and-forget 아님`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P87_routeBlindFallbackRatio',
      violations.join(' | '),
      'PR #463 (X-H4) — _blind_fallback flag + 집계 + 40%/5건 threshold + admin alert 유지.',
    );
  }
  return null;
}

/**
 * P86_repairDroppedGuidesAlert — 메모리 P86 (PR #462, Audit X-H3).
 * api/_ai_core/responseValidator.js 의 repairAndParseJSON 가 truncated JSON 복구 후
 * 누락된 arrival_guide/departure_guide 를 silent 하면 fail.
 * - throttledTelegramAlert import 필수
 * - detectDroppedKeys + classifyMissingKeys export 필수
 * - alert key 'repair-dropped-guides:${droppedKey}' 패턴 필수
 * - result.__repair_dropped_keys flag 필수
 */
function P86_repairDroppedGuidesAlert({ changed }) {
  const FILE = 'api/_ai_core/responseValidator.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/.test(content)) {
    violations.push(`${FILE}: throttledTelegramAlert import 누락 — operator silent (X-H3)`);
  }
  if (!/CRITICAL_TOP_LEVEL_KEYS\s*=\s*\[\s*['"]arrival_guide['"]\s*,\s*['"]departure_guide['"]\s*\]/.test(content)) {
    violations.push(`${FILE}: CRITICAL_TOP_LEVEL_KEYS = ['arrival_guide','departure_guide'] 누락`);
  }
  if (!/export\s+function\s+detectDroppedKeys\s*\(/.test(content)) {
    violations.push(`${FILE}: detectDroppedKeys export 누락 — test 표면 없음`);
  }
  if (!/export\s+function\s+classifyMissingKeys\s*\(/.test(content)) {
    violations.push(`${FILE}: classifyMissingKeys export 누락 — lost-after-emit vs never-emitted 구분 불가`);
  }
  if (!/result\.__repair_dropped_keys\s*=\s*droppedKeys/.test(content)) {
    violations.push(`${FILE}: result.__repair_dropped_keys 플래그 누락 → UI/debugger 감지 어려움`);
  }
  if (!/repair-dropped-guides:\$\{droppedKey\}/.test(content)) {
    violations.push(`${FILE}: alert key 'repair-dropped-guides:${'${droppedKey}'}' 패턴 누락 → dedup 깨짐`);
  }
  // alert config — admin / high / fire-and-forget
  const alertBlock = content.slice(content.indexOf('repair-dropped-guides'), content.indexOf('repair-dropped-guides') + 2000);
  if (alertBlock && !/channel:\s*['"]admin['"]/.test(alertBlock)) {
    violations.push(`${FILE}: admin 채널 누락 — booking 다운 시 도달 X`);
  }
  if (alertBlock && !/severity:\s*['"]high['"]/.test(alertBlock)) {
    violations.push(`${FILE}: severity:'high' 누락`);
  }
  if (!/throttledTelegramAlert\(\{[\s\S]*?repair-dropped-guides[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(content)) {
    violations.push(`${FILE}: alert 가 .catch(()=>{}) fire-and-forget 아님 → parse latency 위험`);
  }

  if (violations.length > 0) {
    fail(
      'P86_repairDroppedGuidesAlert',
      violations.join(' | '),
      'PR #462 (X-H3) — detectDroppedKeys + classifyMissingKeys + admin alert + result flag 유지.',
    );
  }
  return null;
}

/**
 * P85_geminiRetryDeterministicModel — 메모리 P85 (PR #461, Audit X-H2).
 * api/_ai_core/geminiPipeline.js 의 retry 사이트들이 같은 temperature=0.5
 * model 을 재사용하면 fail. retryModel (temperature=0.1) + recordRetryAttempt
 * (5분 sliding window, threshold 10) + admin alert 필수.
 */
function P85_geminiRetryDeterministicModel({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/const\s+RETRY_TEMPERATURE\s*=\s*0\.1/.test(content)) {
    violations.push(`${FILE}: RETRY_TEMPERATURE=0.1 상수 누락 — retry quota burn 위험 (X-H2)`);
  }
  if (!/const\s+RETRY_RATE_WINDOW_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(content)) {
    violations.push(`${FILE}: RETRY_RATE_WINDOW_MS=5분 누락 → retry storm 감지 약화`);
  }
  if (!/const\s+RETRY_RATE_THRESHOLD\s*=\s*10/.test(content)) {
    violations.push(`${FILE}: RETRY_RATE_THRESHOLD=10 누락 → alert 임계 변경`);
  }
  if (!/export\s+function\s+buildModel\s*\(\s*apiKey\s*,\s*temperatureOverride\s*\)/.test(content)) {
    violations.push(`${FILE}: buildModel(apiKey, temperatureOverride) signature 누락 — retryModel 분리 불가`);
  }
  if (!/const\s+retryModel\s*=\s*buildModel\(apiKey,\s*RETRY_TEMPERATURE\)/.test(content)) {
    violations.push(`${FILE}: retryModel 미생성 — retry 가 동일 0.5 model 재사용`);
  }
  // 4 retry types must each register a recordRetryAttempt call.
  const requiredTypes = ['dietary-3pass', 'pattern-3pass', 'dietary-legacy', 'pattern-legacy'];
  for (const t of requiredTypes) {
    const re = new RegExp(`recordRetryAttempt\\(\\s*['\"]${t.replace(/[-]/g, '\\-')}['\"]\\s*\\)`);
    if (!re.test(content)) {
      violations.push(`${FILE}: recordRetryAttempt('${t}') 누락 → 해당 retry 카운트 누락`);
    }
  }
  // Each retry call must use retryModel.
  if (!/pass1Intent\(\s*retryModel\s*,/.test(content)) {
    violations.push(`${FILE}: 3pass retry 가 pass1Intent(retryModel, ...) 아님 — 동일 model 재사용 (X-H2 회귀)`);
  }
  if (!/retryModel\.generateContent/.test(content)) {
    violations.push(`${FILE}: legacy retry 가 retryModel.generateContent 호출 안 함 — model.generateContent 재사용`);
  }
  if (!/gemini-retry-rate-high:\$\{retryType\}/.test(content)) {
    violations.push(`${FILE}: alert key 'gemini-retry-rate-high:${'${retryType}'}' 누락`);
  }

  if (violations.length > 0) {
    fail(
      'P85_geminiRetryDeterministicModel',
      violations.join(' | '),
      'PR #461 (X-H2) — retryModel (temperature 0.1) + recordRetryAttempt (5min/10건 window, admin alert) 유지.',
    );
  }
  return null;
}

/**
 * P84_planPersisterTruncateSurface — 메모리 P84 (PR #460, Audit X-H1).
 * api/_ai_core/planPersister.js 의 900KB 가드가 silent truncate 면 fail.
 * - throttledTelegramAlert import 필수
 * - admin channel, severity:'high' 로 발송
 * - dedup key 패턴 `plan-persister-truncate:${regionKey}:${durationKey}` 필수
 * - root-level __truncated / __truncated_days_count / __truncated_original_days
 *   필수 (PlanDetailPage 가 itinerary 깊이 탐색 없이 banner 표시)
 * - 900_000-byte 한계 + legacy itinerary._truncated_days 유지
 */
function P84_planPersisterTruncateSurface({ changed }) {
  const FILE = 'api/_ai_core/planPersister.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/.test(content)) {
    violations.push(`${FILE}: throttledTelegramAlert import 누락 — operator silent (X-H1)`);
  }
  if (!/plan-persister-truncate:\$\{regionKey\}:\$\{durationKey\}/.test(content)) {
    violations.push(`${FILE}: dedup key 'plan-persister-truncate:${'${regionKey}'}:${'${durationKey}'}' 누락 → storm 차단 X`);
  }
  if (!/channel:\s*['"]admin['"]/.test(content)) {
    violations.push(`${FILE}: admin 채널 알림 누락 — booking 채널 다운 시 도달 X`);
  }
  if (!/severity:\s*['"]high['"]/.test(content)) {
    violations.push(`${FILE}: severity:'high' 누락`);
  }
  if (!/docToSave\.__truncated\s*=\s*true/.test(content)) {
    violations.push(`${FILE}: root-level __truncated=true 누락 → UI banner 감지 어려움`);
  }
  if (!/docToSave\.__truncated_days_count/.test(content)) {
    violations.push(`${FILE}: __truncated_days_count 누락`);
  }
  if (!/docToSave\.__truncated_original_days/.test(content)) {
    violations.push(`${FILE}: __truncated_original_days 누락 → 잘린 day 추적 불가`);
  }
  if (!/SIZE_LIMIT_BYTES\s*=\s*900_000/.test(content)) {
    violations.push(`${FILE}: SIZE_LIMIT_BYTES 900_000 변경 — Firestore 1MB 안전 margin 깨짐`);
  }
  // Back-compat — UI 의 기존 탐색 경로 유지.
  if (!/itinerary\._truncated_days\s*=/.test(content)) {
    violations.push(`${FILE}: legacy itinerary._truncated_days 누락 — 기존 UI 경로 깨짐`);
  }
  // Fire-and-forget — alert infra fail 이 plan 저장 latency 영향 X
  if (!/throttledTelegramAlert\(\{[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(content)) {
    violations.push(`${FILE}: throttledTelegramAlert 가 .catch(()=>{}) fire-and-forget 아님 → plan-save latency 위험`);
  }

  if (violations.length > 0) {
    fail(
      'P84_planPersisterTruncateSurface',
      violations.join(' | '),
      'PR #460 (X-H1) — root __truncated 플래그 + admin throttledTelegramAlert + 900KB 한계 + legacy back-compat 유지.',
    );
  }
  return null;
}

/**
 * P82_pdfCanvasPerBandCheck — 메모리 P82 (PR #458, Audit Z-H10).
 * pdfGenerator.ts 의 5% 전체 non-white threshold 가 partial-blank PDF 못 잡음.
 * BANDS=10 / PER_BAND_SAMPLES=20 / BLANK_BAND_NONWHITE=0.02 / MAX_BLANK_BAND_RATIO=0.25
 * 패턴 유지 + structured warn-log 필수.
 */
function P82_pdfCanvasPerBandCheck({ changed }) {
  const FILE = 'src/pages/PlanDetailPage/pdfGenerator.ts';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/const\s+BANDS\s*=\s*10/.test(content)) {
    violations.push(`${FILE}: BANDS=10 누락 — partial-blank PDF 못 잡음 (Z-H10)`);
  }
  if (!/const\s+PER_BAND_SAMPLES\s*=\s*20/.test(content)) {
    violations.push(`${FILE}: PER_BAND_SAMPLES=20 누락`);
  }
  if (!/const\s+BLANK_BAND_NONWHITE\s*=\s*0\.02/.test(content)) {
    violations.push(`${FILE}: BLANK_BAND_NONWHITE=0.02 누락`);
  }
  if (!/const\s+MAX_BLANK_BAND_RATIO\s*=\s*0\.25/.test(content)) {
    violations.push(`${FILE}: MAX_BLANK_BAND_RATIO=0.25 누락`);
  }
  if (!/partial-blank suspected \(band check\)/.test(content)) {
    violations.push(`${FILE}: 'partial-blank suspected (band check)' structured warn 누락 — Sentry grep-friendly`);
  }

  if (violations.length > 0) {
    fail(
      'P82_pdfCanvasPerBandCheck',
      violations.join(' | '),
      'PR #458 (Z-H10) — 10-band sampling + 25% blank-band 임계 + structured warn 유지.',
    );
  }
  return null;
}

/**
 * P81_refundAllSettledInspect — 메모리 P81 (PR #457, Audit Y-H13).
 * cancelBooking.js sendRefundTelegram 의 Promise.allSettled 결과를 unwrap 안 하면 fail.
 * 개별 notify 의 {ok:false} / 'rejected' silent → 환불 알림 일부 채널 누락.
 */
function P81_refundAllSettledInspect({ changed }) {
  const FILE = 'api/cancelBooking.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // Result array destructuring required
  if (!/const\s*\[\s*bookingResult\s*,\s*dispatchResult\s*,\s*operatorResult\s*\]\s*=\s*await\s+Promise\.allSettled/.test(content)) {
    violations.push(`${FILE}: Promise.allSettled 결과 destructure 누락 — 개별 notify silent fail (Y-H13)`);
  }
  // Both failure shapes inspected
  if (!/result\.status\s*===\s*['"]rejected['"]/.test(content)) {
    violations.push(`${FILE}: result.status === 'rejected' 체크 누락`);
  }
  if (!/value\.ok\s*===\s*false/.test(content)) {
    violations.push(`${FILE}: value.ok === false 체크 누락 — semantic failure 감지 못 함`);
  }
  // Fallback alert
  if (!/key:\s*['"]refund-telegram-partial-fail['"]/.test(content)) {
    violations.push(`${FILE}: 'refund-telegram-partial-fail' throttledTelegramAlert 누락`);
  }
  if (!/channel:\s*['"]admin['"]/.test(content)) {
    violations.push(`${FILE}: admin 채널 fallback 누락 — booking/dispatch 다운 시 도달 불가`);
  }
  // notifyOperator catch must return failure shape (so allSettled inspection sees it)
  if (!/notifyOperator\(\s*['"]refund['"]\s*,[\s\S]{0,300}?\.catch\(\s*\(err\)\s*=>\s*\{[\s\S]{0,300}?return\s*\{\s*ok:\s*false/.test(content)) {
    violations.push(`${FILE}: notifyOperator catch 가 {ok:false} 반환 안 함 → inspect()에서 silent`);
  }

  if (violations.length > 0) {
    fail(
      'P81_refundAllSettledInspect',
      violations.join(' | '),
      'PR #457 (Y-H13) — Promise.allSettled 결과 unwrap + per-channel inspect + admin fallback alert.',
    );
  }
  return null;
}

/**
 * P80_iosBlobPopupBlocker — 메모리 P80 (PR #456, Audit Z-H14).
 * pdfGenerator.ts 에서 raw `window.open(blob:url)` 패턴이 회귀하면 fail —
 * iOS Safari popup blocker 가 silent block. openBlobSafely helper 사용 필수.
 */
function P80_iosBlobPopupBlocker({ changed }) {
  const PDFGEN = 'src/pages/PlanDetailPage/pdfGenerator.ts';
  const HELPER = 'src/lib/openBlobSafely.ts';
  const touched = isModified(PDFGEN, changed) || isModified(HELPER, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(PDFGEN, changed)) {
    const content = getChangedFileContent(PDFGEN);
    if (content) {
      if (!/from\s*['"]@\/lib\/openBlobSafely['"]/.test(content)) {
        violations.push(`${PDFGEN}: openBlobSafely import 누락 — iOS popup blocker silent loss (Z-H14)`);
      }
      if (!/openBlobSafely\s*\(\s*\{/.test(content)) {
        violations.push(`${PDFGEN}: openBlobSafely 호출 누락`);
      }
      // Regression guard: 구 UA-conditional window.open(blob:) 패턴
      const oldIosBranch = /if\s*\(\/iPhone\|iPad\|iPod\/i\.test\(navigator\.userAgent\)\)\s*\{[\s\S]{0,200}?window\.open\(\s*url\s*,/;
      if (oldIosBranch.test(content)) {
        violations.push(`${PDFGEN}: UA-conditional window.open(blob:) 회귀 — openBlobSafely 사용`);
      }
    }
  }

  if (isModified(HELPER, changed)) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/export\s+function\s+openBlobSafely/.test(content)) {
        violations.push(`${HELPER}: openBlobSafely export 누락`);
      }
      if (!/<a download>/i.test(content) && !/a\.download\s*=/.test(content)) {
        violations.push(`${HELPER}: <a download> 우선 strategy 누락 — iOS popup blocker 우회 핵심`);
      }
      if (!/popup-blocked/.test(content)) {
        violations.push(`${HELPER}: popup-blocked 감지 (win === null) 누락 — silent loss 방지`);
      }
      if (!/REVOKE_AFTER_MS/.test(content)) {
        violations.push(`${HELPER}: URL.revokeObjectURL timer 누락 — blob URL leak`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P80_iosBlobPopupBlocker',
      violations.join(' | '),
      'PR #456 (Z-H14) — openBlobSafely (<a download> 우선 + popup-blocker 감지 + user alert).',
    );
  }
  return null;
}

/**
 * P79_wizardPersistenceQuotaSweep — 메모리 P79 (PR #455, Audit W-H15).
 * src/hooks/useWizardPersistence.ts 가 setItem 실패를 silent `catch {}` 처리하면
 * fail. quota error 감지 + stale snapshot sweep + structured warn-log 필수.
 */
function P79_wizardPersistenceQuotaSweep({ changed }) {
  const FILE = 'src/hooks/useWizardPersistence.ts';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/function\s+isQuotaError/.test(content)) {
    violations.push(`${FILE}: isQuotaError helper 누락 — 모든 브라우저 quota 플레이버 감지 필요 (W-H15)`);
  }
  if (!/QuotaExceededError/.test(content)) {
    violations.push(`${FILE}: QuotaExceededError 문자열 누락 — modern browser quota detection`);
  }
  if (!/NS_ERROR_DOM_QUOTA_REACHED/.test(content)) {
    violations.push(`${FILE}: NS_ERROR_DOM_QUOTA_REACHED 누락 — Firefox quota 플레이버`);
  }
  if (!/function\s+sweepStaleWizardSnapshots/.test(content)) {
    violations.push(`${FILE}: sweepStaleWizardSnapshots helper 누락 — quota 회복 path`);
  }
  if (!/function\s+safeWizardSetItem/.test(content)) {
    violations.push(`${FILE}: safeWizardSetItem helper 누락`);
  }
  // The hook must call the safe helper, not raw localStorage.setItem.
  if (/localStorage\.setItem\(\s*STORAGE_PREFIX\s*\+/.test(content)) {
    violations.push(`${FILE}: raw localStorage.setItem(STORAGE_PREFIX + ...) — safeWizardSetItem 사용`);
  }
  // Structured warn so Sentry surfaces the silent-loss pattern instead of /* silent */.
  if (!/console\.warn\(\s*['"]\[wizard-persistence\] localStorage quota exceeded/.test(content)) {
    violations.push(`${FILE}: structured warn log 누락 — quota 도달이 silent 면 Sentry 가 잡지 못함`);
  }

  if (violations.length > 0) {
    fail(
      'P79_wizardPersistenceQuotaSweep',
      violations.join(' | '),
      'PR #455 (W-H15) — quota error 감지 + stale snapshot sweep + retry + structured warn-log.',
    );
  }
  return null;
}

/**
 * P78_pdfImageProxyCorsGuard — 메모리 P78 (PR #454, Audit Z-H11).
 * pdfGenerator.ts Phase 2 preload 가 외부 origin 이미지를 직접 fetch 하면 fail.
 * /api/image-proxy 통과 필수 (CORS-blocked CDN 이미지 → 빈 PDF 박스 방지).
 * image-proxy.js 의 allowlist + 보안 헤더 회귀도 같이 가드.
 */
function P78_pdfImageProxyCorsGuard({ changed }) {
  const PDFGEN = 'src/pages/PlanDetailPage/pdfGenerator.ts';
  const PROXY = 'api/image-proxy.js';
  const touched = isModified(PDFGEN, changed) || isModified(PROXY, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(PDFGEN, changed)) {
    const content = getChangedFileContent(PDFGEN);
    if (content) {
      if (!/toFetchableUrl/.test(content)) {
        violations.push(`${PDFGEN}: toFetchableUrl 헬퍼 누락 — Z-H11 CORS-blocked CDN 이미지 (Tripadvisor 등) 빈 PDF 회귀`);
      }
      if (!/\/api\/image-proxy\?url=\$\{encodeURIComponent/.test(content)) {
        violations.push(`${PDFGEN}: /api/image-proxy?url=... routing 누락`);
      }
      if (!/u\.origin\s*===\s*sameOrigin/.test(content)) {
        violations.push(`${PDFGEN}: same-origin short-circuit 누락 (불필요한 proxy 호출 → 더 느림)`);
      }
    }
  }

  if (isModified(PROXY, changed)) {
    const content = getChangedFileContent(PROXY);
    if (content) {
      if (!/ALLOWED_HOST_SUFFIXES/.test(content)) {
        violations.push(`${PROXY}: ALLOWED_HOST_SUFFIXES allowlist 누락 — SSRF risk`);
      }
      if (!/ALLOWED_PROTOCOLS/.test(content) || !/['"]http:['"]/.test(content) || !/['"]https:['"]/.test(content)) {
        violations.push(`${PROXY}: ALLOWED_PROTOCOLS (http/https only) 누락 — file://, gopher:// 등 우회 가능`);
      }
      if (!/MAX_BYTES/.test(content)) {
        violations.push(`${PROXY}: MAX_BYTES 누락 — 거대 이미지로 운영자 burning 위험`);
      }
      if (!/AbortController/.test(content)) {
        violations.push(`${PROXY}: AbortController 누락 — 외부 호출 timeout 부재`);
      }
      // Security headers
      if (!/'Access-Control-Allow-Origin':\s*'\*'/.test(content)) {
        violations.push(`${PROXY}: CORS 헤더 (Access-Control-Allow-Origin: *) 누락 — html2canvas 가 픽셀 못 읽음`);
      }
      if (!/'X-Content-Type-Options':\s*'nosniff'/.test(content)) {
        violations.push(`${PROXY}: X-Content-Type-Options: nosniff 누락 — MIME confusion guard`);
      }
      // Anonymous proxy — no cookie/auth forwarding
      if (/credentials:\s*['"]include['"]/.test(content)) {
        violations.push(`${PROXY}: credentials: 'include' 사용 — proxy 는 anonymous 여야 함`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P78_pdfImageProxyCorsGuard',
      violations.join(' | '),
      'PR #454 (Z-H11) — image-proxy SSRF allowlist + nosniff + anonymous fetch + pdfGenerator 외부 origin routing 유지.',
    );
  }
  return null;
}

/**
 * P77_triggerDownstreamSilentPaths — 메모리 P77 (PR #453, Audit Z-H7).
 * booking-confirm.js 의 triggerDownstreamEffects 3가지 silent path 회귀 시 fail.
 *   - AI Planner fetch().catch() raw 패턴
 *   - itineraryData 누락 시 alert 없음
 *   - 외부 try/catch console.warn only
 *
 * Helper / cron / Firestore rules 도 같은 lint 가 cover.
 */
function P77_triggerDownstreamSilentPaths({ changed }) {
  const CONFIRM = 'api/_shared/booking-confirm.js';
  const HELPER = 'api/_shared/ai-planner-trigger.js';
  const CRON = 'api/_crons/ai-planner-retry-sweep.js';
  const touched = isModified(CONFIRM, changed)
    || isModified(HELPER, changed)
    || isModified(CRON, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(CONFIRM, changed)) {
    const content = getChangedFileContent(CONFIRM);
    if (content) {
      if (!/from\s*['"]\.\/ai-planner-trigger\.js['"]/.test(content)) {
        violations.push(`${CONFIRM}: ai-planner-trigger helper import 누락 — Z-H7 silent loss 회귀`);
      }
      if (!/triggerAiPlanner\s*\(/.test(content)) {
        violations.push(`${CONFIRM}: triggerAiPlanner() 호출 누락`);
      }
      // Regression guard: raw fetch().catch() on /api/ai-planner-full
      const silentAiFetch = /fetch\(\s*`?\$\{[^}]*\}\/api\/ai-planner-full`?[\s\S]*?\}\s*\)\s*\.\s*catch\(/;
      if (silentAiFetch.test(content)) {
        violations.push(`${CONFIRM}: raw fetch('/api/ai-planner-full').catch() — use triggerAiPlanner helper`);
      }
      if (!/key:\s*['"]ai-planner-itinerary-missing['"]/.test(content)) {
        violations.push(`${CONFIRM}: 'ai-planner-itinerary-missing' alert 누락 — itineraryData missing path silent`);
      }
      if (!/key:\s*['"]booking-confirm-downstream-throw['"]/.test(content)) {
        violations.push(`${CONFIRM}: 'booking-confirm-downstream-throw' alert 누락 — outer try/catch silent`);
      }
      // Drive-by P55 — no bare /1380 remaining in this file
      if (/\/\s*1380(?![0-9])/.test(content)) {
        violations.push(`${CONFIRM}: stale 1380 KRW/USD literal — use Number(env.KRW_USD_RATE) || Number(env.VITE_USD_KRW_RATE) || 1430 (P55)`);
      }
    }
  }

  if (isModified(HELPER, changed)) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/AbortController/.test(content)) {
        violations.push(`${HELPER}: AbortController missing — long ai-planner-full call needs timeout`);
      }
      if (!/r\.ok|response\.ok|!r\.ok|!response\.ok/.test(content)) {
        violations.push(`${HELPER}: response.ok check missing — non-2xx must be treated as failure`);
      }
      if (!/pending_ai_planner_retries/.test(content)) {
        violations.push(`${HELPER}: 'pending_ai_planner_retries' retry queue collection 누락`);
      }
    }
  }

  if (isModified(CRON, changed)) {
    const content = getChangedFileContent(CRON);
    if (content) {
      if (!/MAX_ATTEMPTS/.test(content)) {
        violations.push(`${CRON}: MAX_ATTEMPTS missing — must escalate eventually`);
      }
      if (!/manual-intervention/.test(content)) {
        violations.push(`${CRON}: escalation status 'manual-intervention' missing`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P77_triggerDownstreamSilentPaths',
      violations.join(' | '),
      'PR #453 (Z-H7) — booking-confirm 의 3 silent path 모두 helper / alert / cron 으로 가시화.',
    );
  }
  return null;
}

/**
 * P76_bookingAmountNanGuard — 메모리 P76 (PR #452, Audit Z-H9).
 * api/booking-processor.js 가 `parseFloat(amount || 0)` 패턴 회귀 시 fail.
 * NaN propagation → $NaN sheets/email/voucher + loyalty silent no-op.
 * safeParseAmountUSD helper + invalid 시 throttledTelegramAlert 필수.
 */
function P76_bookingAmountNanGuard({ changed }) {
  const FILE = 'api/booking-processor.js';
  const HELPER = 'api/_shared/amount-guard.js';
  const touched = isModified(FILE, changed) || isModified(HELPER, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(FILE, changed)) {
    const content = getChangedFileContent(FILE);
    if (content) {
      if (!/from\s*['"]\.\/_shared\/amount-guard\.js['"]/.test(content)) {
        violations.push(`${FILE}: amount-guard helper import 누락 — Z-H9 NaN guard 회귀`);
      }
      if (!/safeParseAmountUSD\(\s*amount\s*\)/.test(content)) {
        violations.push(`${FILE}: safeParseAmountUSD(amount) 호출 누락`);
      }
      // 구 패턴 회귀 차단
      if (/parseFloat\(\s*amount\s*\|\|\s*0\s*\)/.test(content)) {
        violations.push(`${FILE}: parseFloat(amount || 0) 회귀 — safeParseAmountUSD 사용 (Z-H9)`);
      }
      // operator alert
      if (!/key:\s*['"]booking-amount-nan['"]/.test(content)) {
        violations.push(`${FILE}: 'booking-amount-nan' throttledTelegramAlert 누락 — invalid amount silent`);
      }
    }
  }

  if (isModified(HELPER, changed)) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/export\s+function\s+safeParseAmountUSD/.test(content)) {
        violations.push(`${HELPER}: safeParseAmountUSD export 누락`);
      }
      if (!/Number\.isFinite/.test(content)) {
        violations.push(`${HELPER}: Number.isFinite 사용 안 함 — 실제 NaN 차단 불가`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P76_bookingAmountNanGuard',
      violations.join(' | '),
      'PR #452 (Z-H9) — safeParseAmountUSD + invalid 시 operator alert + 구 parseFloat(amount||0) 회귀 금지.',
    );
  }
  return null;
}

/**
 * P75_notifyTelegram4096Truncate — 메모리 P75 (PR #451, Audit Z-H13).
 * api/_shared/notify.js 가 text 길이 검사 없이 Telegram sendMessage 호출하면 fail.
 * 4096 char 초과 시 "MESSAGE_TOO_LONG" → silent loss. safeTruncateForTelegram
 * helper 로 4090 cap + 마지막 newline 경계 trim + "...(truncated)" suffix 필수.
 */
function P75_notifyTelegram4096Truncate({ changed }) {
  const FILE = 'api/_shared/notify.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/TELEGRAM_TEXT_HARD_LIMIT\s*=\s*4096/.test(content)) {
    violations.push(`${FILE}: TELEGRAM_TEXT_HARD_LIMIT=4096 상수 누락 — Z-H13 silent MESSAGE_TOO_LONG 회귀`);
  }
  if (!/export\s+function\s+safeTruncateForTelegram/.test(content)) {
    violations.push(`${FILE}: safeTruncateForTelegram export 누락`);
  }
  if (!/safeTruncateForTelegram\(\s*text\s*\)/.test(content)) {
    violations.push(`${FILE}: notify() 가 safeTruncateForTelegram(text) 호출 누락`);
  }
  if (!/text:\s*safeText/.test(content)) {
    violations.push(`${FILE}: sendMessage payload 가 safeText 대신 raw text 사용 — truncate 가 적용 안 됨`);
  }
  // Regression guard — `text: text` (raw) 패턴이 sendMessage body 에 들어가면 안 됨.
  if (/JSON\.stringify\(\s*\{[\s\S]*?text:\s*text(?!Length)/.test(content)) {
    violations.push(`${FILE}: sendMessage body 에 raw text 사용 — safeText 로 변경 필요`);
  }

  if (violations.length > 0) {
    fail(
      'P75_notifyTelegram4096Truncate',
      violations.join(' | '),
      'PR #451 (Z-H13) — notify() 가 safeTruncateForTelegram 으로 4096-cap 적용, sendMessage body 는 safeText 사용.',
    );
  }
  return null;
}

/**
 * P74_planDetailListenerStableDep — 메모리 P74 (PR #450, Audit W-H16).
 * PlanDetailPage onSnapshot effect 가 `user` (객체 ref) 를 deps 에 직접 넣으면 fail.
 * Firebase User 객체 reference 가 token refresh 시 변하므로 매 refresh 마다
 * onSnapshot teardown + re-subscribe → listener leak. `user?.uid` (stable string) 사용.
 */
function P74_planDetailListenerStableDep({ changed }) {
  const FILE = 'src/pages/PlanDetailPage/index.tsx';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // const uid = user?.uid ?? null; 필수
  if (!/const\s+uid\s*=\s*user\?\.uid\s*\?\?\s*null/.test(content)) {
    violations.push(`${FILE}: \`const uid = user?.uid ?? null\` hoist 누락 — onSnapshot effect 가 user 객체 ref dep 사용 시 listener leak (W-H16)`);
  }

  // onSnapshot effect deps array 에 user (bare) 가 있으면 fail
  const onSnapshotIdx = content.indexOf('const unsub = onSnapshot(');
  if (onSnapshotIdx > -1) {
    const depMatch = content.slice(onSnapshotIdx).match(/\}\s*,\s*\[(.*?)\]\s*\)\s*;/);
    if (depMatch) {
      const deps = depMatch[1];
      if (/\buser\b/.test(deps) && !/\buid\b/.test(deps)) {
        violations.push(`${FILE}: onSnapshot effect deps 에 user (object ref) — uid 사용 필요 (W-H16 listener leak)`);
      } else if (!/\buid\b/.test(deps)) {
        violations.push(`${FILE}: onSnapshot effect deps 에 uid 누락`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P74_planDetailListenerStableDep',
      violations.join(' | '),
      'PR #450 (W-H16) — onSnapshot effect deps 는 user?.uid (stable string) 사용. user 객체 ref 회귀 금지.',
    );
  }
  return null;
}

/**
 * P73_useAuthForegroundTokenRefresh — 메모리 P73 (PR #449, Audit W-H17).
 * src/hooks/useAuth.ts 가 onAuthStateChanged 만 구독하고 periodic + visibility
 * 기반 token refresh 누락하면 fail. 1h Firebase token expiry 후 API 401 storm.
 */
function P73_useAuthForegroundTokenRefresh({ changed }) {
  const FILE = 'src/hooks/useAuth.ts';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/setInterval\(/.test(content) || !/50\s*\*\s*60\s*\*\s*1000/.test(content)) {
    violations.push(`${FILE}: 50-min setInterval token refresh missing — token expires at 60min (W-H17)`);
  }
  if (!/getIdToken\(\s*true\s*\)/.test(content)) {
    violations.push(`${FILE}: getIdToken(true) (force refresh) missing — lazy refresh insufficient`);
  }
  if (!/clearInterval\s*\(/.test(content)) {
    violations.push(`${FILE}: clearInterval cleanup missing — leak on re-render`);
  }
  if (!/visibilitychange/.test(content)) {
    violations.push(`${FILE}: visibilitychange listener missing — tab return after 1h+ stays on expired token`);
  }
  if (!/visibilityState\s*===\s*['"]visible['"]/.test(content)) {
    violations.push(`${FILE}: must guard refresh on document.visibilityState === 'visible' (avoid double-fire on hide)`);
  }
  if (!/removeEventListener\(\s*['"]visibilitychange['"]/.test(content)) {
    violations.push(`${FILE}: visibilitychange listener cleanup missing — leak across renders`);
  }

  if (violations.length > 0) {
    fail(
      'P73_useAuthForegroundTokenRefresh',
      violations.join(' | '),
      'PR #449 (W-H17) — useAuth 가 50-min periodic + visibility-driven getIdToken(true) 호출 유지.',
    );
  }
  return null;
}

/**
 * P72_chatRateLimitNatImmune — 메모리 P72 (PR #448, Audit W-H14).
 * api/chat.js daily cap 키가 `ip:${ip}:${dayKey}` 패턴으로 회귀하면 fail.
 * Vercel NAT 뒤 IP 공유로 같은 카페/회사 user 모두 차단되는 문제.
 * `usr:${userId}:${dayKey}` 패턴 유지.
 */
function P72_chatRateLimitNatImmune({ changed }) {
  const FILE = 'api/chat.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // IP-keyed daily cap 회귀 차단
  if (/doc\(\s*`ip:\$\{ip\}:\$\{dayKey\}`\s*\)/.test(content)) {
    violations.push(`${FILE}: 'ip:\${ip}:\${dayKey}' doc key 회귀 — Vercel NAT 공유 IP 로 정상 user 차단 (W-H14)`);
  }
  if (/RATE_IP_DAILY_MAX/.test(content)) {
    violations.push(`${FILE}: RATE_IP_DAILY_MAX 회귀 — RATE_USER_DAILY_MAX 사용`);
  }
  // RATE_LIMIT_IP code 도 제거 (caller/UI 가 IP-keyed 로 오해 차단)
  if (/RATE_LIMIT_IP\b/.test(content)) {
    violations.push(`${FILE}: RATE_LIMIT_IP error code 회귀 — RATE_LIMIT_USER_DAILY 사용`);
  }

  // userId-keyed daily cap 강제
  if (!/doc\(\s*`usr:\$\{userId\}:\$\{dayKey\}`\s*\)/.test(content)) {
    violations.push(`${FILE}: 'usr:\${userId}:\${dayKey}' doc key 누락 — NAT-immune daily cap (W-H14)`);
  }
  if (!/RATE_USER_DAILY_MAX\s*=\s*\d+/.test(content)) {
    violations.push(`${FILE}: RATE_USER_DAILY_MAX 상수 누락`);
  }

  if (violations.length > 0) {
    fail(
      'P72_chatRateLimitNatImmune',
      violations.join(' | '),
      'PR #448 (W-H14) — daily cap 은 userId 기준 (Vercel NAT-immune). IP 기준 키 회귀 금지.',
    );
  }
  return null;
}

/**
 * P71_gmailSmtpQuotaGuard — 메모리 P71 (PR #447, Audit Z-H8).
 * api/_send-email.js 가 quota pre-check + post-success increment 누락하면 fail.
 * Gmail 500/day cap 초과 시 24h 계정 lockout — 모든 customer email silent loss.
 */
function P71_gmailSmtpQuotaGuard({ changed }) {
  const SEND = 'api/_send-email.js';
  const HELPER = 'api/_shared/gmail-quota.js';
  const touched = isModified(SEND, changed) || isModified(HELPER, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(SEND, changed)) {
    const content = getChangedFileContent(SEND);
    if (content) {
      if (!/from\s*['"]\.\/_shared\/gmail-quota\.js['"]/.test(content)) {
        violations.push(`${SEND}: missing gmail-quota helper import — Z-H8 quota guard absent`);
      }
      if (!/checkGmailQuota\s*\(/.test(content)) {
        violations.push(`${SEND}: checkGmailQuota() pre-check missing — would hit Gmail 500/day cap silently`);
      }
      if (!/incrementGmailSentCount\s*\(/.test(content)) {
        violations.push(`${SEND}: incrementGmailSentCount() post-send call missing — daily counter never advances`);
      }
      // Pre-check must run BEFORE sendMail
      const checkIdx = content.indexOf('checkGmailQuota(');
      const sendMailIdx = content.indexOf('transporter.sendMail(');
      if (checkIdx > -1 && sendMailIdx > -1 && checkIdx > sendMailIdx) {
        violations.push(`${SEND}: checkGmailQuota must run BEFORE transporter.sendMail (wasted SMTP connection on overage)`);
      }
      // Increment must run AFTER sendMail (failed sends don't consume quota)
      const incrIdx = content.indexOf('incrementGmailSentCount(');
      if (incrIdx > -1 && sendMailIdx > -1 && incrIdx < sendMailIdx) {
        violations.push(`${SEND}: incrementGmailSentCount must run AFTER sendMail (failed sends would still count)`);
      }
    }
  }

  if (isModified(HELPER, changed)) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/DEFAULT_DAILY_QUOTA\s*=\s*500/.test(content)) {
        violations.push(`${HELPER}: DEFAULT_DAILY_QUOTA must be 500 (Gmail free-tier cap)`);
      }
      if (!/FieldValue\.increment\(\s*1\s*\)/.test(content)) {
        violations.push(`${HELPER}: FieldValue.increment(1) missing — race-unsafe manual increment risk`);
      }
      if (!/process\.env\.GMAIL_DAILY_QUOTA/.test(content)) {
        violations.push(`${HELPER}: GMAIL_DAILY_QUOTA env override missing — Workspace accounts can't raise to 2000`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P71_gmailSmtpQuotaGuard',
      violations.join(' | '),
      'PR #447 (Z-H8) — sendEmail pre-checks quota + post-success increment, helper uses FieldValue.increment + env override.',
    );
  }
  return null;
}

/**
 * P70_appCatchAllRoute — 메모리 P70 (PR #446, Audit W-H18).
 * src/App.tsx 가 `<Route path="*">` catch-all 누락하면 fail. NotFoundPage
 * 누락 시도 fail. 알려지지 않은 URL → 빈 페이지 → SEO soft-404 + UX dead-end.
 */
function P70_appCatchAllRoute({ changed }) {
  const APP = 'src/App.tsx';
  const NF = 'src/pages/NotFoundPage.tsx';
  const touched = isModified(APP, changed) || isModified(NF, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(APP, changed)) {
    const content = getChangedFileContent(APP);
    if (content) {
      if (!/<Route\s+path=["']\*["']/.test(content)) {
        violations.push(`${APP}: catch-all <Route path="*"> missing — unknown URLs render blank (W-H18)`);
      }
      if (!/NotFoundPage/.test(content)) {
        violations.push(`${APP}: NotFoundPage component not imported / mounted`);
      }
      // The catch-all must be the LAST <Route> before </Routes>.
      const closeIdx = content.indexOf('</Routes>');
      const catchAllIdx = content.lastIndexOf('path="*"');
      if (closeIdx > -1 && catchAllIdx > -1 && catchAllIdx > closeIdx) {
        violations.push(`${APP}: <Route path="*"> appears after </Routes> — not mounted`);
      }
    }
  }

  if (isModified(NF, changed)) {
    const content = getChangedFileContent(NF);
    if (content) {
      if (!/meta\[name="robots"\]/.test(content) || !/['"]noindex/.test(content)) {
        violations.push(`${NF}: noindex robots meta missing — soft-404 still indexed by crawlers`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P70_appCatchAllRoute',
      violations.join(' | '),
      'PR #446 (W-H18) — App.tsx catch-all <Route path="*"> + NotFoundPage with noindex meta.',
    );
  }
  return null;
}

/**
 * P69_firestoreFieldLengthCaps — 메모리 P69 (PR #445, Audit W-H19).
 * firestore.rules 의 tours/{tourId} update + tours/{tourId}/bookings/{bookingId}
 * create 룰에 currentBookings/amountUSD range cap + memo/note size cap 누락 시 fail.
 */
function P69_firestoreFieldLengthCaps({ changed }) {
  const FILE = 'firestore.rules';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // tours.currentBookings range
  if (!/currentBookings\s+is\s+int/.test(content)) {
    violations.push(`${FILE}: tours.currentBookings type check (is int) missing — W-H19 DoS via type-mismatch`);
  }
  if (!/currentBookings\s*>=\s*0/.test(content)) {
    violations.push(`${FILE}: tours.currentBookings >= 0 cap missing — counter underflow risk`);
  }
  if (!/currentBookings\s*<=\s*9999/.test(content)) {
    violations.push(`${FILE}: tours.currentBookings <= 9999 cap missing — capacity DoS risk`);
  }

  // tours/bookings amountUSD cap + memo/note size
  if (!/amountUSD\s*<=\s*100000/.test(content)) {
    violations.push(`${FILE}: tours/bookings.amountUSD <= 100000 sanity cap missing — sales aggregate / Firestore quota DoS`);
  }
  if (!/memo\.size\(\)\s*<=\s*1000/.test(content)) {
    violations.push(`${FILE}: tours/bookings.memo size cap (<=1000) missing — 1MB doc spam-write risk`);
  }
  if (!/note\.size\(\)\s*<=\s*1000/.test(content)) {
    violations.push(`${FILE}: tours/bookings.note size cap (<=1000) missing — 1MB doc spam-write risk`);
  }

  if (violations.length > 0) {
    fail(
      'P69_firestoreFieldLengthCaps',
      violations.join(' | '),
      'PR #445 (W-H19) — tours.currentBookings int 0-9999 + amountUSD <=100000 + memo/note size <=1000 유지.',
    );
  }
  return null;
}

/**
 * P68_bookingsWriteRetryAlert — 메모리 P68 (PR #444, Audit Y-H14).
 * capturePaypalOrder.js 의 bookings/{orderID}.set 가 silent catch 로 회귀하면 fail.
 * 반드시 retry 루프 + throttledTelegramAlert (critical) + orderID/captureID 안내.
 */
function P68_bookingsWriteRetryAlert({ changed }) {
  const FILE = 'api/capturePaypalOrder.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // Retry shape
  if (!/BOOKING_WRITE_BACKOFF_MS\s*=\s*\[\s*200\s*,\s*500\s*,\s*1000\s*\]/.test(content)) {
    violations.push(`${FILE}: BOOKING_WRITE_BACKOFF_MS [200, 500, 1000] missing — Y-H14 needs retry-with-backoff`);
  }
  if (!/let\s+bookingWriteOk\s*=\s*false/.test(content)) {
    violations.push(`${FILE}: bookingWriteOk tracker missing`);
  }
  if (!/for\s*\(\s*let\s+attempt\s*=\s*0\s*;\s*attempt\s*<\s*BOOKING_WRITE_BACKOFF_MS\.length/.test(content)) {
    violations.push(`${FILE}: retry loop over BOOKING_WRITE_BACKOFF_MS missing`);
  }

  // Critical alert wire-up
  if (!/throttledTelegramAlert\s*\(\s*\{[\s\S]*?key:\s*['"]bookings-doc-write-fail['"]/.test(content)) {
    violations.push(`${FILE}: throttledTelegramAlert with key='bookings-doc-write-fail' missing — operator must learn of payment-without-booking`);
  }
  // The alert must mention admin-replay-booking-notifications (operator recovery path)
  if (!/admin-replay-booking-notifications/.test(content)) {
    violations.push(`${FILE}: alert message must include admin-replay-booking-notifications recovery path`);
  }
  // The bookings-write-fail branch must NOT refund (different semantics from PROMO_LIMIT_EXCEEDED).
  const writeFailIdx = content.indexOf('if (!bookingWriteOk)');
  if (writeFailIdx > -1) {
    const block = content.slice(writeFailIdx, writeFailIdx + 1500);
    if (/refundPaypalCapture\s*\(/.test(block)) {
      violations.push(`${FILE}: bookings-write-fail branch must NOT refund (payment was captured; operator recovers booking via admin-replay)`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P68_bookingsWriteRetryAlert',
      violations.join(' | '),
      'PR #444 (Y-H14) — bookings/{orderID}.set 3x retry + critical throttled alert + 운영자 복구 안내.',
    );
  }
  return null;
}

/**
 * P67_telegramThrottleFailClosed — 메모리 P67 (PR #443, Audit Z-H12).
 * api/_shared/telegram-throttle.js 의 fail-open 경로 (!adminDb / transaction
 * throw / !key) 가 in-memory throttle 없이 바로 notify() 호출하면 fail.
 * Firestore 다운 + 고빈도 에러 조합에서 운영자 채팅 flood.
 */
function P67_telegramThrottleFailClosed({ changed }) {
  const FILE = 'api/_shared/telegram-throttle.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/_inMemoryThrottle\s*=\s*new\s+Map\(\)/.test(content)) {
    violations.push(`${FILE}: in-memory Map fallback missing — Firestore outage + high-rate errors will flood operator (Z-H12)`);
  }
  if (!/function\s+_checkInMemoryThrottle/.test(content)) {
    violations.push(`${FILE}: _checkInMemoryThrottle helper missing`);
  }
  // The three fail-open call sites must all consult the in-memory throttle.
  const checkCalls = (content.match(/_checkInMemoryThrottle\s*\(/g) || []).length;
  if (checkCalls < 3) {
    violations.push(`${FILE}: _checkInMemoryThrottle must be consulted at all 3 fail-open sites (!key, !adminDb, catch); got ${checkCalls}`);
  }
  if (!/__resetInMemoryThrottleForTests/.test(content)) {
    violations.push(`${FILE}: __resetInMemoryThrottleForTests test helper missing — vitest can't clear state between cases`);
  }
  // Bounded map (no memory leak)
  if (!/_IN_MEMORY_MAX_KEYS/.test(content)) {
    violations.push(`${FILE}: _IN_MEMORY_MAX_KEYS cap missing — unbounded Map can leak`);
  }

  if (violations.length > 0) {
    fail(
      'P67_telegramThrottleFailClosed',
      violations.join(' | '),
      'PR #443 (Z-H12) — fail-open 경로 (!key / !adminDb / catch) 모두 in-memory Map throttle 통과해야 함.',
    );
  }
  return null;
}

/**
 * P66_pushVapidAuthFailedCleanup — 메모리 P66 (PR #442, Audit Z-H15).
 * api/_send-push.js 가 401/403 (VAPID 회전 / 권한 취소) 응답을 expired (410/404)
 * 와 동등 처리하면 fail. mass-cleanup 위험. 분리된 authFailed 플래그 + failedAttempts
 * 카운터 (MAX 5) + throttled operator alert (telegram-throttle helper) 패턴 유지.
 */
function P66_pushVapidAuthFailedCleanup({ changed }) {
  const FILE = 'api/_send-push.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1. 401/403 must be separated from 410/404 (no instant mass-delete).
  if (!/AUTH_FAILED_STATUS\s*=\s*new\s+Set\(\[\s*401\s*,\s*403\s*\]\)/.test(content)) {
    violations.push(`${FILE}: AUTH_FAILED_STATUS set with 401+403 missing (Z-H15 needs separate auth-failed bucket)`);
  }
  if (!/PERMANENT_GONE_STATUS\s*=\s*new\s+Set\(\[\s*404\s*,\s*410\s*\]\)/.test(content)) {
    violations.push(`${FILE}: PERMANENT_GONE_STATUS set with 404+410 missing`);
  }

  // 2. failedAttempts counter required (not immediate delete on auth-failed).
  if (!/failedAttempts/.test(content)) {
    violations.push(`${FILE}: failedAttempts counter missing — would mass-delete on VAPID rotate (Z-H15)`);
  }
  if (!/MAX_AUTH_FAILED_ATTEMPTS\s*=\s*\d+/.test(content)) {
    violations.push(`${FILE}: MAX_AUTH_FAILED_ATTEMPTS threshold constant missing`);
  }
  if (!/if\s*\(\s*nextAttempts\s*>=\s*MAX_AUTH_FAILED_ATTEMPTS\s*\)/.test(content)) {
    violations.push(`${FILE}: must only delete subscription when nextAttempts >= MAX_AUTH_FAILED_ATTEMPTS`);
  }

  // 3. Throttled operator alert via existing helper.
  if (!/from\s*['"]\.\/_shared\/telegram-throttle\.js['"]/.test(content)) {
    violations.push(`${FILE}: must import throttledTelegramAlert from _shared/telegram-throttle.js (dedup operator alert)`);
  }
  if (!/throttledTelegramAlert\s*\(\s*\{[\s\S]*?key:\s*['"]push-vapid-auth-failed['"]/.test(content)) {
    violations.push(`${FILE}: throttledTelegramAlert with key='push-vapid-auth-failed' missing — operator can't tell VAPID misconfig`);
  }

  if (violations.length > 0) {
    fail(
      'P66_pushVapidAuthFailedCleanup',
      violations.join(' | '),
      'PR #442 (Z-H15) — 401/403 vs 410/404 분리, failedAttempts 5회 누적 후 삭제, throttled operator alert.',
    );
  }
  return null;
}

/**
 * P65_adminAuthColdStartInit — 메모리 P65 (PR #441, Audit Y-H12).
 * api/_shared/admin-auth.js 가 dynamic `await import('firebase-admin/...')`
 * + GOOGLE_SERVICE_ACCOUNT_KEY 만 시도하는 패턴으로 회귀하면 fail.
 * Module-level static import + FIREBASE_* 우선 fallback + 캐시 패턴 유지.
 */
function P65_adminAuthColdStartInit({ changed }) {
  const FILE = 'api/_shared/admin-auth.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1. Top-level static imports — no per-request `await import('firebase-admin/...')`.
  if (/await\s+import\(\s*['"]firebase-admin\/(app|auth)['"]/.test(content)) {
    violations.push(`${FILE}: dynamic await import('firebase-admin/...') in handler — use module-top static import (Y-H12 cold-start)`);
  }
  if (!/^import\s*\{[^}]*initializeApp[^}]*\}\s*from\s*['"]firebase-admin\/app['"]/m.test(content)) {
    violations.push(`${FILE}: top-level static import of initializeApp from 'firebase-admin/app' missing`);
  }
  if (!/^import\s*\{[^}]*getAuth[^}]*\}\s*from\s*['"]firebase-admin\/auth['"]/m.test(content)) {
    violations.push(`${FILE}: top-level static import of getAuth from 'firebase-admin/auth' missing`);
  }

  // 2. FIREBASE_* tuple must be tried (canonical pattern matching firebase-admin.js).
  if (!/cert\(\{\s*projectId\s*,\s*clientEmail\s*,\s*privateKey\s*\}\)/.test(content)) {
    violations.push(`${FILE}: cert({projectId,clientEmail,privateKey}) call missing — FIREBASE_* triple must be tried first`);
  }

  // 3. Existing-app reuse via getApps() — no double-init.
  if (!/getApps\(\)\.length/.test(content)) {
    violations.push(`${FILE}: getApps().length check missing — double-init risk with firebase-admin.js`);
  }

  // 4. Module-level cache.
  if (!/let\s+_adminAuth\s*=\s*null/.test(content)) {
    violations.push(`${FILE}: module-level _adminAuth cache missing — per-request init overhead`);
  }

  if (violations.length > 0) {
    fail(
      'P65_adminAuthColdStartInit',
      violations.join(' | '),
      'PR #441 (Y-H12) — admin-auth bootstrap: static import + FIREBASE_* 우선 + getApps() 재사용 + module 캐시.',
    );
  }
  return null;
}

/**
 * P64_paypalWebhookVerifyFailedRetryStorm — 메모리 P64 (PR #440, Audit Y-H9).
 * paypal-webhook.js 가 verify_failed 분기에서 401 응답하면 fail. PayPal IPN
 * 정책상 4xx 는 retry trigger → 25회 재시도 → PayPal API quota storm.
 * 200 ack + status=verify_failed 로깅 + dedup operator alert 가 옳은 패턴.
 *
 * 또한 alertVerifyFailedDedup helper 의 sha256 + 1시간 throttle 형태 유지 가드.
 */
function P64_paypalWebhookVerifyFailedRetryStorm({ changed }) {
  const FILE = 'api/paypal-webhook.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1. verify_failed 분기에서 401 응답 금지.
  const verifyIdx = content.indexOf("status: 'verify_failed'");
  if (verifyIdx > -1) {
    const block = content.slice(verifyIdx, verifyIdx + 2000);
    if (/res\.writeHead\(\s*401\s*,/.test(block)) {
      violations.push(`${FILE}: verify_failed branch responds 401 → PayPal 25x retry storm (Y-H9). Use res.writeHead(200, ...) + alertVerifyFailedDedup.`);
    }
    if (!/res\.writeHead\(\s*200\s*,/.test(block)) {
      violations.push(`${FILE}: verify_failed branch missing 200 ack response`);
    }
    if (!/alertVerifyFailedDedup\s*\(/.test(block)) {
      violations.push(`${FILE}: verify_failed branch must call alertVerifyFailedDedup (dedup operator alert)`);
    }
  }

  // 2. Dedup helper shape.
  if (/alertVerifyFailedDedup/.test(content)) {
    if (!/createHash\(\s*['"]sha256['"]/.test(content)) {
      violations.push(`${FILE}: alertVerifyFailedDedup must hash reason with sha256 (dedup doc key)`);
    }
    if (!/runTransaction\s*\(/.test(content)) {
      violations.push(`${FILE}: alertVerifyFailedDedup must use runTransaction for race-safe throttle`);
    }
    if (!/60\s*\*\s*60\s*\*\s*1000|WINDOW_MS/.test(content)) {
      violations.push(`${FILE}: alertVerifyFailedDedup throttle window must be 1 hour (60*60*1000)`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P64_paypalWebhookVerifyFailedRetryStorm',
      violations.join(' | '),
      'PR #440 (Y-H9) — verify_failed 는 deterministic → 200 ack 로 PayPal 재시도 storm 차단 + dedup alert.',
    );
  }
  return null;
}

/**
 * P63_customerEmailSilentFail — 메모리 P63 (PR #439, Audit Z-H16).
 * api/_shared/booking-confirm.js 가 sendCustomerConfirmEmail 를 silent
 * `.catch(()=>{})` 패턴으로 호출하면 fail. 반드시 api/_shared/customer-email-trigger.js
 * 의 sendCustomerEmailWithAlert (실패 시 운영자 알림 + retry queue 등록) 사용.
 *
 * Helper 자체 + 5분 cron 도 같이 가드:
 *   - helper: notify('booking', ...) + pending_email_retries 등록 패턴 유지
 *   - cron: MAX_ATTEMPTS + manual-intervention escalation
 */
function P63_customerEmailSilentFail({ changed }) {
  const CONFIRM = 'api/_shared/booking-confirm.js';
  const HELPER = 'api/_shared/customer-email-trigger.js';
  const CRON = 'api/_crons/email-retry-sweep.js';
  const touched = isModified(CONFIRM, changed) || isModified(HELPER, changed) || isModified(CRON, changed);
  if (!touched) return { skipped: true };

  const violations = [];

  if (isModified(CONFIRM, changed)) {
    const content = getChangedFileContent(CONFIRM);
    if (content) {
      if (!/from\s*['"]\.\/customer-email-trigger\.js['"]/.test(content)) {
        violations.push(`${CONFIRM}: customer-email-trigger helper import missing — silent .catch(()=>{}) drift risk`);
      }
      // Forbid the original silent-loss pattern.
      if (/sendCustomerConfirmEmail\s*\([^)]*\)\s*\.\s*catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(content)) {
        violations.push(`${CONFIRM}: silent .catch(()=>{}) on sendCustomerConfirmEmail — use sendCustomerEmailWithAlert helper (Z-H16)`);
      }
    }
  }

  if (isModified(HELPER, changed)) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/export\s+async\s+function\s+sendCustomerEmailWithAlert/.test(content)) {
        violations.push(`${HELPER}: sendCustomerEmailWithAlert export missing`);
      }
      if (!/notify\s*\(\s*['"]booking['"]/.test(content)) {
        violations.push(`${HELPER}: operator notify('booking', ...) call missing — failures must be visible`);
      }
      if (!/pending_email_retries/.test(content)) {
        violations.push(`${HELPER}: retry-queue collection 'pending_email_retries' missing`);
      }
    }
  }

  if (isModified(CRON, changed)) {
    const content = getChangedFileContent(CRON);
    if (content) {
      if (!/MAX_ATTEMPTS/.test(content)) {
        violations.push(`${CRON}: MAX_ATTEMPTS missing — retries must escalate eventually`);
      }
      if (!/manual-intervention/.test(content)) {
        violations.push(`${CRON}: escalation status 'manual-intervention' missing`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P63_customerEmailSilentFail',
      violations.join(' | '),
      'PR #439 (Z-H16) — sendCustomerEmailWithAlert + pending_email_retries + 5분 cron sweep 유지.',
    );
  }
  return null;
}

/**
 * P62_paypalWebhookDirectFlowMatch — 메모리 P62 (PR #438, Audit Y-H7).
 * paypal-webhook.js 가 PayPal-direct flow (capturePaypalOrder) 의 capture
 * 이벤트를 매칭 못 해서 silent-unmatched alert 발사하면 fail.
 * - extractPaypalOrderId helper 필요
 * - PAYMENT.CAPTURE.COMPLETED 의 memo-miss 경로에 supplementary_data.related_ids.order_id
 *   기반 bookings/{paypalOrderId} 조회 분기 필요
 * - PAYMENT.CAPTURE.REFUNDED 가 where('captureID','==',captureId) 조회 필요
 * - refund update 는 bookingsDocId (matched doc) 기준 — bookings/{captureId} blind write 금지
 */
function P62_paypalWebhookDirectFlowMatch({ changed }) {
  const FILE = 'api/paypal-webhook.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/function\s+extractPaypalOrderId/.test(content)) {
    violations.push(`${FILE}: extractPaypalOrderId helper missing — PayPal-direct flow can't be matched (Y-H7)`);
  }
  if (!/supplementary_data[\s?.]*related_ids[\s?.]*order_id/.test(content)) {
    violations.push(`${FILE}: supplementary_data.related_ids.order_id lookup missing — needed for PayPal-direct capture match`);
  }
  if (!/already_confirmed_via_capture_endpoint/.test(content)) {
    violations.push(`${FILE}: 'already_confirmed_via_capture_endpoint' status missing — webhook should ack silently after capturePaypalOrder already confirmed`);
  }
  if (!/where\(\s*['"]captureID['"]\s*,\s*['"]==['"]\s*,\s*captureId/.test(content)) {
    violations.push(`${FILE}: refund handler must query bookings.where('captureID','==',captureId) for PayPal-direct refunds`);
  }
  // Blind write to bookings/{captureId} = the original Y-H7 orphan bug.
  if (/collection\(['"]bookings['"]\)\.doc\(\s*captureId\s*\)\.set\(\s*updates/.test(content)) {
    violations.push(`${FILE}: refund handler must NOT blind-write to bookings/{captureId} — use the matched bookingsDocId`);
  }

  if (violations.length > 0) {
    fail(
      'P62_paypalWebhookDirectFlowMatch',
      violations.join(' | '),
      'PR #438 (Y-H7) — PayPal-direct flow (supplementary_data.related_ids.order_id + captureID field) 매칭 유지, refund 는 matched doc id 로만 write.',
    );
  }
  return null;
}

/**
 * P61_adminCorsWildcard — 메모리 P61 (PR #437, Audit W-H11).
 * api/admin-*.js 가 `Access-Control-Allow-Origin: '*'` 로 회귀하면 fail.
 * 모든 admin endpoint 는 api/_shared/cors.js 의 buildAdminCors / buildAdminJsonCors
 * 를 import 해서 사용해야 함. 신규 admin-*.js 파일이 추가될 때도 자동 검출.
 */
function P61_adminCorsWildcard({ changed }) {
  const touched = changed.filter((c) =>
    c.status !== 'D' && /^api\/admin-[\w-]+\.js$/.test(c.file),
  );
  if (touched.length === 0) return { skipped: true };

  const violations = [];
  for (const { file: FILE } of touched) {
    const content = getChangedFileContent(FILE);
    if (!content) continue;
    if (/'Access-Control-Allow-Origin'\s*:\s*['"]\*['"]/.test(content)) {
      violations.push(`${FILE}: wildcard 'Access-Control-Allow-Origin': '*' detected — use buildAdminCors helper (W-H11)`);
    }
    if (!/from\s*['"]\.\/_shared\/cors\.js['"]/.test(content)) {
      violations.push(`${FILE}: missing api/_shared/cors.js import — admin endpoints must use the shared origin allowlist`);
    }
  }
  if (violations.length > 0) {
    fail(
      'P61_adminCorsWildcard',
      violations.join(' | '),
      'PR #437 (W-H11) — admin endpoints 은 buildAdminCors/buildAdminJsonCors 사용. wildcard CORS 금지 (defense in depth).',
    );
  }
  return null;
}

/**
 * P60_bookingProcessorFireAndForget — 메모리 P60 (PR #436, Audit Y-H8).
 * capturePaypalOrder + booking-confirm 이 booking-processor 를 raw fetch().catch()
 * 패턴으로 호출하면 회귀. HTTP 500/504 응답에 .catch 가 발화 안 함 → 모든
 * downstream side-effect (sheets / email / voucher / Telegram) silent loss.
 * 반드시 api/_shared/booking-processor-trigger.js 의 triggerBookingProcessor 사용.
 */
function P60_bookingProcessorFireAndForget({ changed }) {
  const TARGETS = ['api/capturePaypalOrder.js', 'api/_shared/booking-confirm.js'];
  const HELPER = 'api/_shared/booking-processor-trigger.js';
  const CRON = 'api/_crons/processor-retry-sweep.js';
  const touchedAny = TARGETS.some((t) => isModified(t, changed))
    || isModified(HELPER, changed)
    || isModified(CRON, changed);
  if (!touchedAny) return { skipped: true };

  const violations = [];

  for (const FILE of TARGETS) {
    if (!isModified(FILE, changed)) continue;
    const content = getChangedFileContent(FILE);
    if (!content) continue;
    // Banned: raw fetch on /api/booking-processor followed by .catch — the
    // silent-failure pattern Y-H8 closed.
    const silentFetch = /fetch\(\s*`?\$\{[^}]*\}\/api\/booking-processor`?[\s\S]*?\}\s*\)\s*\.\s*catch\(/;
    if (silentFetch.test(content)) {
      violations.push(`${FILE}: raw fetch('/api/booking-processor').catch() detected — use triggerBookingProcessor helper (Y-H8 silent fail)`);
    }
    // Must import + call the helper.
    if (!/from\s*['"](?:\.\/_shared|\.)\/booking-processor-trigger\.js['"]/.test(content)) {
      violations.push(`${FILE}: missing booking-processor-trigger import`);
    }
    if (!/triggerBookingProcessor\s*\(/.test(content)) {
      violations.push(`${FILE}: triggerBookingProcessor() call missing`);
    }
  }

  if (isModified(HELPER, changed)) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/AbortController/.test(content)) {
        violations.push(`${HELPER}: AbortController missing — without it 504/hung server stalls function for full maxDuration`);
      }
      if (!/r\.ok|response\.ok|!r\.ok|!response\.ok/.test(content)) {
        violations.push(`${HELPER}: response.ok check missing — non-2xx must be treated as failure (Y-H8 root cause)`);
      }
      if (!/pending_processor_retries/.test(content)) {
        violations.push(`${HELPER}: retry-queue collection name 'pending_processor_retries' missing — required for cron sweep`);
      }
    }
  }

  if (isModified(CRON, changed)) {
    const content = getChangedFileContent(CRON);
    if (content) {
      if (!/MAX_ATTEMPTS/.test(content)) {
        violations.push(`${CRON}: MAX_ATTEMPTS missing — retries must escalate to manual-intervention eventually`);
      }
      if (!/manual-intervention/.test(content)) {
        violations.push(`${CRON}: escalation status 'manual-intervention' missing`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P60_bookingProcessorFireAndForget',
      violations.join(' | '),
      'PR #436 (Y-H8) — triggerBookingProcessor + retry queue + 5분 cron sweep 유지. raw fetch().catch() 회귀 금지.',
    );
  }
  return null;
}

/**
 * P58_globalPromoRaceCapCheck — 메모리 P58 (PR #434, Audit Y-H11).
 * applyPromoCode 의 read-only gate 만으로는 N 명이 동시 capturePaypalOrder 에
 * 도달 시 모두 +1 → cap 초과. capturePaypalOrder 의 promo increment 가 같은
 * transaction 안에서 cap 을 체크하지 않으면 회귀.
 *
 * - capturePaypalOrder 가 incrementGlobalPromoUsage (shared helper) 를
 *   import + 호출하는지
 * - PROMO_LIMIT_EXCEEDED 분기에서 refundPaypalCapture 호출하는지
 * - applyPromoCode 가 GLOBAL_PROMO_DEFAULTS 를 helper 에서 import 하는지
 *   (inline 재정의 시 두 endpoint cap 이 drift)
 * - helper 자체가 transaction 내 cap check + PROMO_LIMIT_EXCEEDED throw 패턴
 *   유지하는지
 */
function P58_globalPromoRaceCapCheck({ changed }) {
  const CAPTURE = 'api/capturePaypalOrder.js';
  const APPLY = 'api/applyPromoCode.js';
  const HELPER = 'api/_shared/global-promo.js';
  const touchedCapture = isModified(CAPTURE, changed);
  const touchedApply = isModified(APPLY, changed);
  const touchedHelper = isModified(HELPER, changed);
  if (!touchedCapture && !touchedApply && !touchedHelper) return { skipped: true };

  const violations = [];

  if (touchedCapture) {
    const content = getChangedFileContent(CAPTURE);
    if (content) {
      if (!/from\s*['"]\.\/_shared\/global-promo\.js['"]/.test(content)) {
        violations.push(`${CAPTURE}: shared global-promo helper import missing`);
      }
      if (!/incrementGlobalPromoUsage\s*\(/.test(content)) {
        violations.push(`${CAPTURE}: incrementGlobalPromoUsage() call missing — cap-LESS increment race risk (Y-H11)`);
      }
      // The PROMO_LIMIT_EXCEEDED branch must refund.
      if (/PROMO_LIMIT_EXCEEDED/.test(content) && !/refundPaypalCapture\s*\(/.test(content)) {
        violations.push(`${CAPTURE}: PROMO_LIMIT_EXCEEDED branch missing refundPaypalCapture call`);
      }
      // Regression guard: no cap-less inline increment of usedCount.
      if (/tx\.set\s*\([^)]*usedCount\s*:\s*cur\s*\+\s*1/s.test(content)) {
        violations.push(`${CAPTURE}: inline cap-less usedCount++ detected — use incrementGlobalPromoUsage helper`);
      }
    }
  }

  if (touchedApply) {
    const content = getChangedFileContent(APPLY);
    if (content) {
      if (!/from\s*['"]\.\/_shared\/global-promo\.js['"]/.test(content)) {
        violations.push(`${APPLY}: must import GLOBAL_PROMO_DEFAULTS / resolveGlobalPromoLimit from the shared helper`);
      }
      // Inline EARLY50 limit redefinition would drift from the helper.
      if (/EARLY50[^\n]*limit\s*:\s*\d+/.test(content)) {
        violations.push(`${APPLY}: inline EARLY50 limit redefinition — defaults live in api/_shared/global-promo.js`);
      }
    }
  }

  if (touchedHelper) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/export\s+async\s+function\s+incrementGlobalPromoUsage/.test(content)) {
        violations.push(`${HELPER}: incrementGlobalPromoUsage export missing`);
      }
      if (!/PROMO_LIMIT_EXCEEDED/.test(content)) {
        violations.push(`${HELPER}: PROMO_LIMIT_EXCEEDED error string missing — caller string-matches on it`);
      }
      if (!/runTransaction\s*\(/.test(content)) {
        violations.push(`${HELPER}: runTransaction missing — cap check must be inside a transaction`);
      }
      // Must read both usage and admin/limits docs inside the tx.
      const txGets = (content.match(/tx\.get\s*\(/g) || []).length;
      if (txGets < 2) {
        violations.push(`${HELPER}: expected ≥2 tx.get calls (usage + admin/global_promo_limits) — got ${txGets}`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P58_globalPromoRaceCapCheck',
      violations.join(' | '),
      'PR #434 (Y-H11) — capturePaypalOrder 의 promo increment 가 transaction 내 cap-check + refund 분기 유지, applyPromoCode 는 helper import.',
    );
  }
  return null;
}

/**
 * P57_aiPlannerCouponGate — 메모리 P57 (PR #433, Audit Y-H10).
 * AI Planner = 디지털 상품 → 모든 쿠폰/프로모 reject. PayPal create + capture
 * 두 endpoint 모두 api/_shared/ai-planner-policy.js 의 checkAiPlannerCouponPolicy
 * 호출. 한 쪽만 검증하면 (구버전) capture-time 우회로 쿠폰 소비 + AI plan 발급
 * 가능 (Y-H10 exploit).
 */
function P57_aiPlannerCouponGate({ changed }) {
  const ENDPOINTS = ['api/createPaypalOrder.js', 'api/capturePaypalOrder.js'];
  const HELPER = 'api/_shared/ai-planner-policy.js';
  const touched = ENDPOINTS.filter((f) => isModified(f, changed));
  const helperTouched = isModified(HELPER, changed);
  if (touched.length === 0 && !helperTouched) return { skipped: true };

  const violations = [];

  for (const FILE of touched) {
    const content = getChangedFileContent(FILE);
    if (!content) continue;
    if (!/from\s*['"]\.\/_shared\/ai-planner-policy\.js['"]/.test(content)) {
      violations.push(`${FILE}: shared helper import (api/_shared/ai-planner-policy.js) missing — inline coupon gate drift risk`);
    }
    if (!/checkAiPlannerCouponPolicy\s*\(/.test(content)) {
      violations.push(`${FILE}: checkAiPlannerCouponPolicy() call missing — coupon-on-AI-planner exploit (Y-H10)`);
    }
    // Don't re-inline the startsWith check next to a coupon/promo neighbour.
    if (/startsWith\(\s*['"]ai_planner['"]\s*\)\s*&&\s*\(?\s*(promoCode|couponDocId)/.test(content)) {
      violations.push(`${FILE}: inline startsWith('ai_planner') + (promoCode|couponDocId) detected — use the shared helper instead`);
    }
  }

  if (helperTouched) {
    const content = getChangedFileContent(HELPER);
    if (content) {
      if (!/export\s+function\s+isAiPlannerProduct/.test(content)) {
        violations.push(`${HELPER}: isAiPlannerProduct export missing`);
      }
      if (!/export\s+function\s+checkAiPlannerCouponPolicy/.test(content)) {
        violations.push(`${HELPER}: checkAiPlannerCouponPolicy export missing`);
      }
      if (!/AI_PLANNER_NO_COUPON/.test(content)) {
        violations.push(`${HELPER}: AI_PLANNER_NO_COUPON code constant missing — callers depend on it for client routing`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P57_aiPlannerCouponGate',
      violations.join(' | '),
      'PR #433 (Y-H10) — create + capture 양 endpoint 가 같은 helper 호출. 운영자 정책 바뀌면 helper 한 곳만 수정.',
    );
  }
  return null;
}

/**
 * P53_complaintRateLimit — 메모리 P53 (PR #429, Audit WC10; refactor PR #432).
 * api/submit-plan-complaint.js 가 IP rate limit wire-up 을 누락 회귀하면 fail.
 * 익명 spam → 운영자 Telegram 채널 spam + Firestore writes 폭주.
 *
 * PR #432 (W-H13) 에서 inline 코드를 api/_shared/ip-rate-limit.js 로 추출 →
 * endpoint 는 import + checkIpRateLimit 호출만, helper 자체는 P56 가 별도로
 * shape (hash + transaction + fail-open) 을 검증.
 */
function P53_complaintRateLimit({ changed }) {
  const FILE = 'api/submit-plan-complaint.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];
  if (!/from\s*['"]\.\/_shared\/ip-rate-limit\.js['"]/.test(content)) {
    violations.push(`${FILE}: shared helper import (api/_shared/ip-rate-limit.js) missing — inline rate-limit drift risk`);
  }
  if (!/checkIpRateLimit\s*\(/.test(content)) {
    violations.push(`${FILE}: checkIpRateLimit() call missing — endpoint can be spammed (WC10)`);
  }
  if (!/collection\s*:\s*['"]complaint_rate_limits['"]/.test(content)) {
    violations.push(`${FILE}: must pass collection='complaint_rate_limits' to checkIpRateLimit`);
  }
  // The call must run before the Telegram notify + Firestore add.
  const checkIdx = content.indexOf('checkIpRateLimit(');
  const notifyIdx = content.indexOf("notify('booking'");
  if (checkIdx > -1 && notifyIdx > -1 && checkIdx > notifyIdx) {
    violations.push(`${FILE}: checkIpRateLimit must run before the Telegram notify (currently after)`);
  }
  if (violations.length > 0) {
    fail(
      'P53_complaintRateLimit',
      violations.join(' | '),
      'PR #429 (WC10) — IP rate limit (5/h) helper import + 매 호출 첫 단계로 유지.',
    );
  }
  return null;
}

/**
 * P56_manualPaymentRateLimit — 메모리 P56 (PR #432, Audit W-H13).
 * api/manual-payment-request.js 가 IP rate limit 누락 회귀하면 fail. 익명
 * payment claim endpoint — 어떤 인증 흐름 시도 *전에* rate limit 적용해야
 * Telegram booking 채널 + pending_bookings spam blast radius 제한됨.
 *
 * 동시에 shared helper (api/_shared/ip-rate-limit.js) 가 hash + transaction
 * + fail-open shape 을 유지하는지도 같은 rule 에서 확인 — helper 가 silently
 * 약해지면 두 endpoint 모두 drift.
 */
function P56_manualPaymentRateLimit({ changed }) {
  const FILE = 'api/manual-payment-request.js';
  const HELPER = 'api/_shared/ip-rate-limit.js';
  const touchedEndpoint = isModified(FILE, changed);
  const touchedHelper = isModified(HELPER, changed);
  if (!touchedEndpoint && !touchedHelper) return { skipped: true };

  const violations = [];

  if (touchedEndpoint) {
    const content = getChangedFileContent(FILE);
    if (!content) return { skipped: true };
    if (!/from\s*['"]\.\/_shared\/ip-rate-limit\.js['"]/.test(content)) {
      violations.push(`${FILE}: shared helper import missing — inline rate-limit drift risk`);
    }
    if (!/checkIpRateLimit\s*\(/.test(content)) {
      violations.push(`${FILE}: checkIpRateLimit() call missing — manual payment endpoint can be spammed (W-H13)`);
    }
    if (!/collection\s*:\s*['"]manual_payment_rate_limits['"]/.test(content)) {
      violations.push(`${FILE}: must pass collection='manual_payment_rate_limits' to checkIpRateLimit`);
    }
    // Rate-limit must precede pending_bookings write + Telegram notify.
    const rateIdx = content.indexOf('checkIpRateLimit(');
    const writeIdx = content.indexOf("collection('pending_bookings')");
    const notifyIdx = content.indexOf("notify('booking'");
    if (rateIdx > -1 && writeIdx > -1 && rateIdx > writeIdx) {
      violations.push(`${FILE}: checkIpRateLimit must run before pending_bookings write`);
    }
    if (rateIdx > -1 && notifyIdx > -1 && rateIdx > notifyIdx) {
      violations.push(`${FILE}: checkIpRateLimit must run before Telegram notify`);
    }
  }

  if (touchedHelper) {
    const content = getChangedFileContent(HELPER);
    if (!content) return violations.length > 0
      ? fail('P56_manualPaymentRateLimit', violations.join(' | '), 'PR #432 (W-H13)')
      : null;
    if (!/createHash\s*\(\s*['"]sha256['"]/.test(content)) {
      violations.push(`${HELPER}: sha256 hashing of IP missing — plaintext-IP-at-rest privacy regression`);
    }
    if (!/runTransaction\s*\(/.test(content)) {
      violations.push(`${HELPER}: Firestore transaction missing — race on the counter at cap (two requests pass)`);
    }
    if (!/degraded\s*:\s*true/.test(content)) {
      violations.push(`${HELPER}: fail-OPEN path (degraded:true) missing — Firestore outage would lock out users`);
    }
    if (!/status\s*:\s*429/.test(content)) {
      violations.push(`${HELPER}: 429 status missing — caller can't tell 429 from generic error`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P56_manualPaymentRateLimit',
      violations.join(' | '),
      'PR #432 (W-H13) — manual-payment-request 3/h cap + shared helper shape (hash + transaction + fail-open + 429) 유지.',
    );
  }
  return null;
}

/**
 * P52_swNoApiCache — 메모리 P52 (PR #428, Audit CZ4).
 * src/sw.ts 가 /api/* runtime 캐시 (NetworkFirst / StaleWhileRevalidate /
 * CacheFirst) 로 회귀하면 fail. 교차 사용자 PII 누출 위험.
 */
function P52_swNoApiCache({ changed }) {
  const FILE = 'src/sw.ts';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const routeRe = /registerRoute\(\s*\(\s*\{\s*url\s*\}\s*\)\s*=>\s*url\.pathname\.startsWith\(\s*['"]\/api\/['"]\s*\)[\s\S]*?\)\s*\)/;
  const m = content.match(routeRe);
  if (!m) {
    fail(
      'P52_swNoApiCache',
      `${FILE}: /api/* registerRoute missing — should explicitly opt out via NetworkOnly (CZ4)`,
      'PR #428 — `/api/*` 경로는 NetworkOnly 사용. SW 가 API 응답 캐시하면 cross-user PII 누출.',
    );
    return null;
  }
  if (/new\s+(NetworkFirst|StaleWhileRevalidate|CacheFirst)\s*\(/.test(m[0])) {
    fail(
      'P52_swNoApiCache',
      `${FILE}: /api/* route uses a caching strategy — CZ4 regression (PII leak via shared SW cache)`,
      'PR #428 — `/api/*` 경로는 NetworkOnly. NetworkFirst/SWR/CacheFirst 사용 금지.',
    );
  }
  return null;
}

/**
 * P51_couponPreLock — 메모리 P51 (PR #427, Audit CY4).
 * api/capturePaypalOrder.js 가 쿠폰을 capture 이후에 mark-used 하면 fail.
 * 동시 요청 race 발생 시 결제는 됐는데 쿠폰 못 받는 사용자 발생 → 운영자
 * 수동 환불. capture 전 pre-lock 으로 안전하게 처리.
 */
function P51_couponPreLock({ changed }) {
  const FILE = 'api/capturePaypalOrder.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // coupon lock 호출 (couponLockRef 또는 couponRef + runTransaction) 이
  // capture fetch 호출보다 먼저 등장하는지 확인.
  const couponIdx = content.search(/couponLockRef|couponRef\s*=\s*db/);
  const captureIdx = content.indexOf('/v2/checkout/orders/');
  if (couponIdx > -1 && captureIdx > -1 && couponIdx > captureIdx) {
    violations.push(`${FILE}: coupon mark-used runs AFTER capture — CY4 race regression`);
  }

  // 옛 patterns: couponWarning 또는 'coupon-warning' notifyOperator 채널.
  // 이들이 등장하면 post-capture handling 으로 회귀한 것.
  if (/couponWarning\s*:\s*code/.test(content)) {
    violations.push(`${FILE}: couponWarning post-capture pattern reappeared — pre-lock should have prevented this`);
  }
  if (/notifyOperator\(\s*['"]coupon-warning['"]/.test(content)) {
    violations.push(`${FILE}: 'coupon-warning' operator alert reappeared — pre-lock path uses 'coupon-race' instead`);
  }

  if (violations.length > 0) {
    fail(
      'P51_couponPreLock',
      violations.join(' | '),
      'PR #427 (CY4) — 쿠폰 lock 을 capture 전 runTransaction 으로 acquire + capture 실패 시 release.',
    );
  }
  return null;
}

/**
 * P50_refundTourTime — 메모리 P50 (PR #426, Audit CY3).
 * cancelBooking / modifyBooking / my-bookings 가 evaluateRefundPolicy 호출
 * 시 booking.tourTime 전달 누락하면 fail. 00:00 KST 기본값으로 cutoff 수
 * 시간 어긋남 (오후 6시 투어가 환불 윈도우 닫힘으로 잘못 표시).
 */
function P50_refundTourTime({ changed }) {
  const FILES = ['api/cancelBooking.js', 'api/modifyBooking.js', 'api/my-bookings.js'];
  const targets = FILES.filter((f) => isModified(f, changed));
  if (targets.length === 0) return { skipped: true };

  const violations = [];
  for (const file of targets) {
    const content = getChangedFileContent(file);
    if (!content) continue;
    const callRe = /evaluateRefundPolicy\s*\(\s*\{[\s\S]*?\}\s*\)/g;
    let m;
    while ((m = callRe.exec(content)) !== null) {
      const callArgs = m[0];
      if (!/tourTime/.test(callArgs)) {
        violations.push(`${file}: evaluateRefundPolicy() called without tourTime — refund cutoff defaults to 00:00 KST (CY3)`);
        break;
      }
    }
  }
  if (violations.length > 0) {
    fail(
      'P50_refundTourTime',
      violations.join(' | '),
      'PR #426 (CY3) — evaluateRefundPolicy({ tourDate, tourTime: booking.tourTime || undefined, tier }) 패턴 유지.',
    );
  }
  return null;
}

/**
 * P48_voucherCjkFont — 메모리 P48 (PR #424, Audit CZ5).
 * api/_generate-voucher.js 가 PDFKit Helvetica + safeText() 로 회귀하면 fail.
 * 한국어 이름/주소가 ? 로 깨지는 CZ5 원래 버그 복귀 차단.
 */
function P48_voucherCjkFont({ changed }) {
  const FILE = 'api/_generate-voucher.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  if (/function\s+safeText\s*\(/.test(content)) {
    violations.push(`${FILE}: safeText() returned — that was the CZ5 bug (strips non-Latin to '?')`);
  }
  const hasPuppeteer = /puppeteer-core|@sparticuz\/chromium/.test(content);
  const hasRegisteredFont = /registerFont\s*\(/.test(content);
  if (!hasPuppeteer && !hasRegisteredFont) {
    violations.push(`${FILE}: neither Puppeteer pipeline nor PDFKit registerFont() — CJK chars will render as missing glyphs`);
  }
  if (violations.length > 0) {
    fail(
      'P48_voucherCjkFont',
      violations.join(' | '),
      'PR #424 — Puppeteer + @sparticuz/chromium (CJK system fonts) 또는 PDFKit registerFont 로 한글/CJK 렌더링 보장.',
    );
  }
  return null;
}

/**
 * P49_paymentIntegrity — 메모리 P49 (PR #425, Audit CY1/CY2/CY5).
 * 결제 무결성 회귀 차단:
 *   - capturePaypalOrder.js: used_paypal_orders lock 이 runTransaction 빠짐 (CY1)
 *     또는 amountKRW 저장 누락 (CY2)
 *   - admin-booking-action.js: mark-refunded 가 refundPaypalCapture 호출 없이
 *     status='REFUNDED' 쓰면 (CY5) fail
 */
function P49_paymentIntegrity({ changed }) {
  const violations = [];

  if (isModified('api/capturePaypalOrder.js', changed)) {
    const content = getChangedFileContent('api/capturePaypalOrder.js');
    if (content) {
      const lockBlock = content.match(/used_paypal_orders[\s\S]{0,1200}/);
      if (lockBlock && !/runTransaction/.test(lockBlock[0])) {
        violations.push("api/capturePaypalOrder.js: used_paypal_orders lock missing runTransaction — race-safe acquire required (CY1)");
      }
      if (!/amountKRW\s*[,:]/.test(content)) {
        violations.push("api/capturePaypalOrder.js: amountKRW missing from booking doc — cancelBooking will refund ₩0 (CY2)");
      }
    }
  }

  if (isModified('api/admin-booking-action.js', changed)) {
    const content = getChangedFileContent('api/admin-booking-action.js');
    if (content) {
      const idx = content.indexOf("action === 'mark-refunded'");
      if (idx > -1) {
        const section = content.slice(idx, idx + 4000);
        if (!/refundPaypalCapture\s*\(/.test(section)) {
          violations.push("api/admin-booking-action.js: mark-refunded missing refundPaypalCapture() — PayPal funds not actually returned (CY5)");
        }
      }
    }
  }

  if (violations.length === 0) {
    const touched = isModified('api/capturePaypalOrder.js', changed)
      || isModified('api/admin-booking-action.js', changed);
    if (!touched) return { skipped: true };
    return null;
  }

  fail(
    'P49_paymentIntegrity',
    violations.join(' | '),
    'PR #425 (CY1/CY2/CY5) — runTransaction lock + amountKRW persist + refundPaypalCapture 호출 유지.',
  );
  return null;
}

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
    {
      label: 'P34: pricing_spec.json priceUSD ↔ priceKRW / policy_krw_per_usd drift',
      base: {
        'src/data/pricing_spec.json':
          '{"policy_krw_per_usd":1430,"airport_transfer_prices":{"seoul-central":{"priceKRW":124800,"priceUSD":87}}}',
      },
      head: {
        // priceKRW 만 변경, priceUSD 갱신 안 됨 → drift
        'src/data/pricing_spec.json':
          '{"policy_krw_per_usd":1430,"airport_transfer_prices":{"seoul-central":{"priceKRW":150000,"priceUSD":87}}}',
      },
      expectRule: 'P34_priceUsdConsistency',
    },
    {
      label: 'P1 (true positive): addDays 헬퍼 정의 신규 추가, inclusive/exclusive 주석 없음',
      base: {
        'src/lib/dates.ts': "// stub\nexport const X = 1;\n",
      },
      head: {
        'src/lib/dates.ts':
          "// stub\nexport const X = 1;\nexport function addDays(d, n) { return new Date(d.getTime() + n*86400000); }\n",
      },
      expectRule: 'P1_dateInclusiveExclusive',
    },
    {
      label: 'P1 (false positive 차단): type field 만 추가 — PR #387 회귀 시나리오',
      base: {
        'src/types/plan.ts':
          "export interface Plan {\n  startDate?: string;\n  name: string;\n}\n",
      },
      head: {
        // IntercityTransitSegment 추가 (PR #387 와 동일 패턴) — 무관한 field 만 추가
        'src/types/plan.ts':
          "export interface Plan {\n  startDate?: string;\n  name: string;\n  intercity_transit?: { from_city?: string; to_city?: string } | null;\n}\n",
      },
      expectRule: null, // P1 trigger 되면 안 됨
      expectClean: true,
    },
    {
      label: 'PDF_KOREAN_FONT (PR #400 강화): 신규 HTML-PDF 모듈 html2canvas + fonts.ready 부재',
      base: {
        // 빈 base — head 에서 새 PDF 모듈 신규 추가 시나리오
        'src/components/InvoicePdfGenerator.tsx': "// stub\nexport const X = 1;\n",
      },
      head: {
        'src/components/InvoicePdfGenerator.tsx':
          "import html2canvas from 'html2canvas';\n"
          + "export async function generateInvoice(el) {\n"
          + "  const canvas = await html2canvas(el);\n"
          + "  return canvas.toDataURL('image/png');\n"
          + "}\n",
      },
      expectRule: 'PDF_KOREAN_FONT',
    },
    {
      label: 'PDF_KOREAN_FONT (false positive 차단): PDFKit 서버 모듈 — 글리프 측정 무관',
      base: {
        'api/_generate-voucher.js': "// stub\n",
      },
      head: {
        // PDFKit 사용 — 서버사이드, fonts.ready 무관 (PDFKit 가 자체 폰트 처리)
        'api/_generate-voucher.js':
          "import PDFDocument from 'pdfkit';\n"
          + "export function generateVoucher() {\n"
          + "  const doc = new PDFDocument();\n"
          + "  doc.text('voucher');\n"
          + "  return doc;\n"
          + "}\n",
      },
      expectRule: 'PDF_KOREAN_FONT',
      expectClean: true, // api/ 경로 — 본 룰 검사 대상 X
    },
    {
      label: 'P96 (true positive): maxDuration=300 endpoint 신규 withStep + hangWarn 부재',
      base: {
        // 빈 stub — head 에서 새 long-running endpoint 추가 시나리오
        'api/new-long-handler.js': "// stub\n",
      },
      head: {
        'api/new-long-handler.js':
          "export const maxDuration = 300;\n"
          + "export default async function handler(req, res) {\n"
          + "  // 핵심 step elapsed log 부재 → hang 진단 사각지대\n"
          + "  const data = await someExpensiveCall();\n"
          + "  res.json({ ok: true, data });\n"
          + "}\n",
      },
      expectRule: 'P96_longRunningEndpointInstrumentation',
    },
    {
      label: 'P96 (false positive 차단): maxDuration=30 endpoint — 3분 threshold 미달',
      base: {
        'api/short-handler.js': "// stub\n",
      },
      head: {
        // 짧은 endpoint — instrumentation 불필요. lint 검사 대상 X.
        'api/short-handler.js':
          "export const maxDuration = 30;\n"
          + "export default async function handler(req, res) {\n"
          + "  res.json({ ok: true });\n"
          + "}\n",
      },
      expectRule: 'P96_longRunningEndpointInstrumentation',
      expectClean: true, // maxDuration<180 — 룰 미적용 (정상)
    },
    {
      label: 'P96 (false positive 차단): maxDuration=300 + withStep + hangWarn 정상 구현',
      base: {
        'api/proper-long-handler.js': "// stub\n",
      },
      head: {
        // ai-planner-full.js 패턴 — withStep + hangWarnTimer 둘 다 있음. 정상 통과.
        'api/proper-long-handler.js':
          "export const maxDuration = 300;\n"
          + "export default async function handler(req, res) {\n"
          + "  const handlerStart = Date.now();\n"
          + "  let currentStep = 'init';\n"
          + "  let currentStepStart = handlerStart;\n"
          + "  async function withStep(label, fn) {\n"
          + "    currentStep = label;\n"
          + "    currentStepStart = Date.now();\n"
          + "    return await fn();\n"
          + "  }\n"
          + "  const HANG_WARN_MS = 270_000;\n"
          + "  const hangWarnTimer = setTimeout(() => { /* admin alert */ }, HANG_WARN_MS);\n"
          + "  try {\n"
          + "    const data = await withStep('main', () => someExpensiveCall());\n"
          + "    res.json({ ok: true, data });\n"
          + "  } finally {\n"
          + "    clearTimeout(hangWarnTimer);\n"
          + "  }\n"
          + "}\n",
      },
      expectRule: 'P96_longRunningEndpointInstrumentation',
      expectClean: true, // 패턴 모두 갖춤 — 룰 silent (정상)
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
      if (c.expectClean) {
        // false-positive 차단 검증 — expectRule 가 발화 **안 해야** PASS.
        // P1 정밀화 같은 over-trigger 회귀 방지에 필수.
        const falselyTriggered = violations.find((v) => v.rule === c.expectRule);
        if (!falselyTriggered) {
          process.stdout.write(`  [PASS] ${c.label}\n    -> no false positive (${c.expectRule} stayed silent)\n`);
          pass++;
        } else {
          process.stdout.write(
            `  [FAIL] ${c.label}\n    -> ${c.expectRule} falsely triggered: ${falselyTriggered.msg}\n`,
          );
          fail++;
        }
      } else {
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
