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
  ['P47_paypalWebhookRawBody', P47_paypalWebhookRawBody],
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
