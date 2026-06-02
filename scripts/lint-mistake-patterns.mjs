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
  readdirSync,
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

// ── P129 (2026-05-21) — ai-planner-full.js 분해 호환 헬퍼 ────────────────────
// ai-planner-full.js (25L wrapper) 는 본체를 api/_ai_core/handlerCore.js +
// requestShaper.js + userMessageBuilder.js + postResponsePipeline.js 4종으로
// 추출. 기존 lint 룰들이 "ai-planner-full.js 의 content" 만 검사하면 P119/
// P120/P123/P125/P128/P96/P102/P112 false-positive 폭주. 본 헬퍼는 wrapper +
// 추출 모듈들 content 를 concat 해서 반환 — 룰은 substring 매칭만 하므로
// 안전. modified 검사도 같은 family 로 확장.
const PLANNER_FAMILY = [
  'api/ai-planner-full.js',
  'api/_ai_core/handlerCore.js',
  'api/_ai_core/requestShaper.js',
  'api/_ai_core/userMessageBuilder.js',
  'api/_ai_core/postResponsePipeline.js',
  'api/_ai_core/airportInference.js',
];

function getPlannerFamilyContent(opts = {}) {
  // 우선 working tree (HEAD) — sandbox self-test 환경 포함.
  // pre-push 본번 호출 시엔 working tree 가 곧 HEAD.
  let out = '';
  for (const f of PLANNER_FAMILY) {
    if (existsSync(f)) {
      try { out += '\n/* ===== ' + f + ' ===== */\n' + readFileSync(f, 'utf8'); } catch {}
    }
  }
  return out;
}

function isPlannerFamilyModified(changed) {
  return PLANNER_FAMILY.some((f) => isModified(f, changed));
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

/**
 * R_A1_7_2_runningRouteValidator — A1-7-2 follow-up (2026-05-24).
 *
 * AdminZoneCourseEditor.tsx 가 handlePublish 에서 zone-course-publish-validation.ts
 * 의 validateZoneCoursePublish 를 import/호출하지 않으면 running_route 코스의
 * recommended_time 누락 상태로 publish 가능 → AI 플래너가 야간 어두운 코스를
 * 새벽/야간 초보자에게 추천 → SAFETY 사고 위험.
 *
 * 룰:
 *   1. AdminZoneCourseEditor.tsx 변경 시 zone-course-publish-validation import 존재 확인.
 *   2. validateZoneCoursePublish 호출 확인.
 *
 * 트리거: src/pages/AdminZoneCourseEditor.tsx 변경 시.
 */
function R_A1_7_2_runningRouteValidator({ changed }) {
  const FILE = 'src/pages/AdminZoneCourseEditor.tsx';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  if (!content.includes('zone-course-publish-validation')) {
    fail(
      'R_A1_7_2_runningRouteValidator',
      `${FILE}: zone-course-publish-validation import 누락 — running_route recommended_time 검증 없이 publish 가능 (A1-7-2 follow-up SAFETY 회귀).`,
      '해결: import { validateZoneCoursePublish } from \'../lib/zone-course-publish-validation\'; 추가 후 handlePublish 에서 호출.',
    );
    return null;
  }

  if (!content.includes('validateZoneCoursePublish')) {
    fail(
      'R_A1_7_2_runningRouteValidator',
      `${FILE}: validateZoneCoursePublish 호출 누락 — import 만 있고 실제 publish 검증 안 됨 (A1-7-2 follow-up SAFETY 회귀).`,
      '해결: handlePublish 내 validateZoneCoursePublish(draft) 호출 추가.',
    );
    return null;
  }

  return null;
}

/**
 * Z01_blockTypeMetaConsistency — PR-A zone_courses schema 확장 회귀 차단 (2026-05-21).
 *
 * src/data/zone_courses/*.json 파일이 변경됐을 때 다음을 검증:
 *   - block_type === 'trekking' 이면 trekking_meta 필수
 *   - block_type === 'running_route' 이면 running_meta 필수
 *   - block_type === 'city_day' (또는 미지정) 이면 trek/run meta 없어야 함
 *   - 모든 stop 의 entry_fee.adult 가 entry_fee_krw 와 일치 (backward compat)
 *   - templates/*.json 은 lat/lng 누락 OK (build 단계에서 채움) — skip
 */
function Z01_blockTypeMetaConsistency({ changed }) {
  const blockFiles = changed.filter(
    (c) =>
      c.status !== 'D' &&
      c.file.startsWith('src/data/zone_courses/') &&
      c.file.endsWith('.json') &&
      !c.file.includes('/templates/'),
  );
  if (blockFiles.length === 0) return { skipped: true };

  const violations = [];
  for (const { file } of blockFiles) {
    if (!existsSync(file)) continue;
    let block;
    try {
      block = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      violations.push(`${file}: invalid JSON — ${err.message}`);
      continue;
    }

    const bt = block.block_type || 'city_day';
    if (bt === 'trekking' && !block.trekking_meta) {
      violations.push(`${file}: block_type='trekking' 이지만 trekking_meta 누락`);
    }
    if (bt === 'running_route' && !block.running_meta) {
      violations.push(`${file}: block_type='running_route' 이지만 running_meta 누락`);
    }
    if (bt === 'city_day' && (block.trekking_meta || block.running_meta)) {
      violations.push(`${file}: block_type='city_day' 인데 trekking/running meta 가 존재함 — 정리 필요`);
    }
    if (!['city_day', 'trekking', 'running_route', 'cycling', 'guided_tour', 'dmz_tour'].includes(bt)) {
      violations.push(`${file}: block_type='${bt}' 알 수 없는 값 — types.ts BlockType 추가 필요`);
    }

    // entry_fee.adult ↔ entry_fee_krw 동기화 검증.
    if (Array.isArray(block.stops)) {
      for (const stop of block.stops) {
        if (stop?.entry_fee && typeof stop.entry_fee === 'object') {
          const adult = stop.entry_fee.adult;
          if (typeof adult === 'number' && adult !== stop.entry_fee_krw) {
            violations.push(
              `${file}: stop order=${stop.order} entry_fee.adult (${adult}) != entry_fee_krw (${stop.entry_fee_krw}) — backward compat 동기화 의무`,
            );
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'Z01_blockTypeMetaConsistency',
      violations.join(' | '),
      'PR-A zone_courses schema 확장 — block_type/meta consistency + entry_fee.adult==entry_fee_krw. types.ts BlockType / TrekkingMeta / RunningMeta / EntryFeeVariants 참조.',
    );
  }
  return null;
}

/**
 * P133_catalogSync — 메모리 P133 (2026-05-21, R-P133).
 * 위자드 input 키 = DB 카테고리 키 1:1 매칭 의무. `docs/WIZARD-INPUT-CATALOG.md` 가 SSOT.
 *
 * 검사 (a): data.tsx / WizardStep2Details.tsx 의 10개 상수 변경 시 WIZARD-INPUT-CATALOG.md 동시 update 강제.
 * 검사 (b): buildPrompt.js 의 reservation_status="..." ↔ WizardForm/index.tsx onSubmit payload 동기.
 * 검사 (c): WizardStep0Reservation.tsx / index.tsx 의 reservationStatus 변경 시 arrivalTime/arrivalAirport 클리어 확인.
 * 검사 (d): toggleCity 내 setHotelByCity 호출 + wantAccom=true 시 setHotelByCity({}) 초기화.
 *
 * 트리거: WizardForm/data.tsx / WizardStep2Details.tsx / WizardForm/index.tsx /
 *         WizardStep0Reservation.tsx / WIZARD-INPUT-CATALOG.md / buildPrompt.js 변경 시.
 * 오류 시: lint-catalog-sync.mjs 위임 (execSync) 또는 inline grep.
 *
 * 예방 회귀: P122/P123 (다도시 호텔), 분기 #1/#2/#10/#23 (카탈로그 전수 audit).
 */
function P133_catalogSync({ changed }) {
  const TRIGGER_FILES = [
    'src/components/WizardForm/data.tsx',
    'src/components/WizardForm/WizardStep2Details.tsx',
    'src/components/WizardForm/index.tsx',
    'src/components/WizardForm/WizardStep0Reservation.tsx',
    'docs/WIZARD-INPUT-CATALOG.md',
    'api/_ai_core/buildPrompt.js',
  ];
  const triggered = changed.some(
    (c) => c.status !== 'D' && TRIGGER_FILES.some((t) => c.file === t || c.file.endsWith(t)),
  );
  if (!triggered) return { skipped: true };

  // lint-catalog-sync.mjs 를 별도 프로세스로 호출해 4 검사 위임 (pre-push hook 단계).
  // 여기서는 inline grep 로 핵심 분기만 빠르게 검사 — 전체 검사는 lint-catalog-sync.mjs 위임.

  // --- inline (b) 검사: buildPrompt + index.tsx payload ---
  const buildPromptSrc = getChangedFileContent('api/_ai_core/buildPrompt.js');
  const indexSrc = getChangedFileContent('src/components/WizardForm/index.tsx');

  if (buildPromptSrc && /reservation_status\s*=\s*["']/.test(buildPromptSrc)) {
    if (indexSrc) {
      const hasPayload =
        /reservation_status\s*:/.test(indexSrc) ||
        /\breservation_status\b,/.test(indexSrc);
      if (!hasPayload) {
        fail(
          'P133_catalogSync',
          'buildPrompt.js 가 reservation_status payload 를 expect 하지만 WizardForm/index.tsx 의 onSubmit 에 미전달 (CATALOG 분기 #1 회귀)',
          'index.tsx onSubmit payload 에 reservation_status: reservationStatus 추가. ' +
          '자세한 검사: node scripts/lint-catalog-sync.mjs',
        );
        return null;
      }
    }
  }

  // --- inline (d) 검사: toggleCity setHotelByCity ---
  if (indexSrc) {
    const toggleMatch = indexSrc.match(/function\s+toggleCity[\s\S]{0,600}/);
    const toggleBlock = toggleMatch ? toggleMatch[0] : '';
    if (toggleMatch && !/setHotelByCity/.test(toggleBlock)) {
      warn(
        'P133_catalogSync',
        'toggleCity 함수 내 setHotelByCity 호출 없음 — 도시 deselect 시 hotelByCity stale (분기 #10). ' +
        'node scripts/lint-catalog-sync.mjs 로 전체 검사.',
      );
    }
  }

  // --- CATALOG.md 존재 여부 (a) 간이 확인 ---
  if (!existsSync('docs/WIZARD-INPUT-CATALOG.md')) {
    fail(
      'P133_catalogSync',
      'docs/WIZARD-INPUT-CATALOG.md 없음 — SSOT 카탈로그 파일 필요. node scripts/lint-catalog-sync.mjs 로 전체 검사.',
      'WizardForm input 키 ↔ DB 카테고리 키 동기 보장 파일. R-P133 필수 산출물.',
    );
    return null;
  }

  return null;
}

// ── P164/P165/P166 (2026-05-23) — Quick wins (latency caps + cache prefix) ─────
// P164: geminiPipeline.js 의 maxOutputTokens 가 16K 초과 (=32K 회귀) 시 fail.
//       실측 출력 2-5K 토큰 — 12K 가 2x safety. 32K = generation overhead.
function P164_geminiOutputTokenCap({ changed }) {
  const file = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  const m = content.match(/maxOutputTokens:\s*(\d+)/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  if (v > 16000) {
    return `R-P164: geminiPipeline.js maxOutputTokens=${v} > 16000. 실측 plan JSON 2-5K 토큰 — 12K=2x safety. 32K 복원 = generation overhead.`;
  }
  return null;
}
// P165: ai-planner-full.js 의 maxDuration 이 600 미만 (=300 회귀) 시 fail.
//       P138 5분 cap fail 위험. Vercel Fluid Compute 800s 까지 OK.
function P165_aiPlannerMaxDurationCap({ changed }) {
  const file = 'api/ai-planner-full.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  const m = content.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  if (v < 600) {
    return `R-P165: ai-planner-full.js maxDuration=${v} < 600. P138 routeEnrich 39s + Gemini 90-150s + retry = 5분 cap fail 위험. 600+ 유지.`;
  }
  return null;
}
// P166: buildSystemPrompt 가 language 외 가변 파라미터 추가 시 fail.
//       systemPrompt 정적 = Gemini 2.5 implicit cache hit (90% cost ↓ + latency ↓).
//       가변 요소 (regions/hotel/dietary/dates) 는 userMessage 에 inject.
function P166_systemPromptStaticPrefix({ changed }) {
  const file = 'api/_ai_core/buildPrompt.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  const m = content.match(/export\s+function\s+buildSystemPrompt\s*\(([^)]*)\)/);
  if (!m) return null;
  const params = m[1]
    .split(',')
    .map((s) => s.trim().split('=')[0].trim())
    .filter(Boolean);
  if (params.length > 1) {
    return `R-P166: buildSystemPrompt(${params.join(', ')}) 가변 파라미터 ${params.length}개. language 만 가능 (Gemini 2.5 implicit cache hit 보존 — 정적 prefix → 90% cost + latency ↓). 가변 요소는 userMessage 에 inject.`;
  }
  return null;
}

// ── P171 (2026-05-23) — admin Test Mode Flash 분기 propagation ─────────────
// handlerCore.js 의 triggerPass3BackgroundIfPending 호출 시 isAdminBypass 인자
// 누락되면 background Pass3 Gemini 호출이 Pro 로 고정 → 운영자 Pro vs Flash
// 품질 비교 시 tip/recommended_items 만 Pro 로 일관성 깨짐.
//
// P173 (2026-05-24) 강화: shorthand `{ isAdminBypass }` 통과 시 runtime ReferenceError
// (handler scope 에 변수 없음 — gate.isAdminBypass 만 정의). 따라서 explicit assignment
// 강제. shorthand 매칭 시 fail.
function P171_adminBypassPropagation({ changed }) {
  const file = 'api/_ai_core/handlerCore.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  const callMatch = content.match(/triggerPass3BackgroundIfPending\s*\(\s*\{([^}]+)\}/);
  if (!callMatch) return null;
  const args = callMatch[1];
  if (!/\bisAdminBypass\b/.test(args)) {
    return `R-P171: handlerCore.js triggerPass3BackgroundIfPending 호출에 isAdminBypass 누락 — admin Test Mode 의 background Pass3 Gemini 호출이 Pro 로 고정. Pro→Flash 품질 비교 시 tip 일관성 깨짐.`;
  }
  // P173: shorthand (`{ isAdminBypass }` 또는 `{ isAdminBypass, ... }`) 금지 — runtime
  // ReferenceError 위험 (handler scope = `gate.isAdminBypass` 만 정의). explicit only.
  if (!/\bisAdminBypass\s*:/.test(args)) {
    return `R-P173: handlerCore.js triggerPass3BackgroundIfPending isAdminBypass 가 shorthand — runtime ReferenceError 위험 (scope 에 isAdminBypass 변수 없음, gate.isAdminBypass 만). explicit assignment 필수: 'isAdminBypass: !!gate.isAdminBypass'.`;
  }
  return null;
}

// ── P172 (2026-05-24) — Flash PCT bucketing identifier propagation ─────────
// handlerCore.js 의 runGeminiPipeline 호출에 identifierForBucketing 인자 누락 시
// PCT bucketing (PLANNER_FLASH_PCT) 동작 안 함 → 일반 사용자 Flash bucket 진입 X
// → 옵션 B prod A/B 측정 의미 손실.
function P172_flashPctBucketingPropagation({ changed }) {
  const file = 'api/_ai_core/handlerCore.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  // pickIdentifier import 확인
  if (!/import\s+\{[^}]*\bpickIdentifier\b[^}]*\}\s+from\s+['"]\.\/plannerMode\.js['"]/.test(content)) {
    return `R-P172: handlerCore.js pickIdentifier import 누락 — PCT bucketing identifier 생성 불가.`;
  }
  // runGeminiPipeline 호출에 identifierForBucketing 인자 포함 확인
  const runMatch = content.match(/runGeminiPipeline\s*\(\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/);
  if (runMatch && !/\bidentifierForBucketing\b/.test(runMatch[1])) {
    return `R-P172: handlerCore.js runGeminiPipeline 호출에 identifierForBucketing 누락 — PCT bucketing 일관성 손실 (main + Pass3 다른 model).`;
  }
  return null;
}

// ── P174 (2026-05-24) — 자율 검증 시스템 silent fail 차단 ────────────────────
// 1) validate-planner.cjs 의 paypalOrderId 가 TEST- prefix 면 prod 에서 403 reject
//    (BRAINTREE_ENV='production' + audit P1-A). 5/12~5/24 12일간 silent fail 의
//    root cause. ADMIN-BYPASS- prefix 강제 (admin email 인증 필수, mode=legacy caveat).
// 2) daily-health-check.mjs 의 issues_within_threshold 단독 검사 결함 — success_count=0
//    (모두 fail) 시 total_issues=0 → `0 <= 9 = true` → silent "healthy" 판정.
//    validation_actually_ok (success_count > 0 + ok != false) 추가 검사 강제.
// ── P184 (2026-05-24) — ODSAY transit_cache (1 month TTL) ────────────────
// 운영자 80% quota 도달 → cache layer 로 -70~85% 감소. 회귀 시 ODSAY 직접 호출
// 반복 → quota 빠르게 소진. cache key (좌표 4자리) + 30-day TTL + lazy update.
function P184_odsayTransitCache({ changed }) {
  const file = 'api/_odsay_helper.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  if (!/buildTransitCacheKey/.test(content)) {
    return `R-P184a: api/_odsay_helper.js buildTransitCacheKey 누락 — ODSAY cache key 생성 helper 회귀.`;
  }
  if (!/getCachedTransit\s*\(\s*cacheKey\s*\)/.test(content)) {
    return `R-P184b: api/_odsay_helper.js searchTransitRoute 안에 getCachedTransit 호출 누락 — cache lookup 우회 회귀.`;
  }
  if (!/setCachedTransit\s*\(/.test(content)) {
    return `R-P184c: api/_odsay_helper.js setCachedTransit 호출 누락 — cache write 회귀.`;
  }
  if (!/TRANSIT_CACHE_TTL_MS\s*=\s*30/.test(content)) {
    return `R-P184d: api/_odsay_helper.js TRANSIT_CACHE_TTL_MS 30 days 누락 — 운영자 의도 "한달에 한번 업데이트" 회귀.`;
  }
  return null;
}

// ── P183 phase 2 (2026-05-24) — Gemini responseSchema typed validation ───
// 운영자 메타 "회귀법칙도 해놨는데 그래도 못 잡네" — prompt-only 한계 인정 후
// Gemini API responseSchema 로 typed validation 강제. wrong-field/missing required
// 자동 reject. 회귀 시 schema 빠짐 → Gemini lenient 출력.
function P183Phase2_geminiResponseSchema({ changed }) {
  const file = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  if (!/PLAN_RESPONSE_SCHEMA/.test(content)) {
    return `R-P183-phase2: geminiPipeline.js PLAN_RESPONSE_SCHEMA constant 누락 — Gemini typed validation 회귀.`;
  }
  if (!/responseSchema:\s*PLAN_RESPONSE_SCHEMA/.test(content)) {
    return `R-P183-phase2: geminiPipeline.js generationConfig 에 responseSchema:PLAN_RESPONSE_SCHEMA 누락 — Gemini lenient 출력 회귀.`;
  }
  if (!/required:\s*\[\s*['"]days['"]\s*\]/.test(content)) {
    return `R-P183-phase2: PLAN_RESPONSE_SCHEMA top-level required=['days'] 누락 — Gemini 가 days 빈 OK 가능.`;
  }
  return null;
}

// ── P185 (2026-05-25) — responseSchema ARRAY 노드 items 필수 ─────────────
// 회귀: PR 이 PLAN_RESPONSE_SCHEMA 에 새 ARRAY field 추가하면서 items 누락 →
// Gemini 3.5 Flash strict schema 가 400 reject (admin-bypass 500).
// Pro 2.5 는 lenient 통과 → CI 에서 안 보이고 admin-bypass 운영 시점만 발견.
// 실 사고: daily_budget_summary: { type: 'ARRAY' } (items 없음) → admin-bypass HTTP 500.
// "GenerateContentRequest.generation_config.response_schema.properties[X].items: missing field"
function P185_responseSchemaArrayItems({ changed }) {
  const file = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  if (!content) return null;

  // PLAN_RESPONSE_SCHEMA = { ... } 블록 추출
  const schemaMatch = content.match(/const\s+PLAN_RESPONSE_SCHEMA\s*=\s*(\{[\s\S]*?\n\};)/);
  if (!schemaMatch) return null; // schema 누락 자체는 R-P183-phase2 가 catch

  const schemaBlock = schemaMatch[1];
  // type: 'ARRAY' 발견 위치마다, 같은 줄 또는 뒤따르는 객체 본문에 items 가 있는지 확인.
  // 단순화: 'ARRAY' 한 줄과 직후 5줄 내에 'items' 가 있어야 함.
  const lines = schemaBlock.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/type:\s*['"]ARRAY['"]/.test(line)) continue;
    // 같은 줄에 items 가 있으면 OK (한 줄 inline 표기)
    if (/items\s*:/.test(line)) continue;
    // 뒤 5줄 안에 items 가 있어야 함 (multi-line 표기)
    const window = lines.slice(i + 1, i + 6).join('\n');
    if (!/items\s*:/.test(window)) {
      const snippet = line.trim().slice(0, 80);
      violations.push(`L~${i + 1}: ${snippet}`);
    }
  }
  if (violations.length > 0) {
    return `R-P185: PLAN_RESPONSE_SCHEMA 에 items 누락 ARRAY 노드 ${violations.length}건 — Gemini 3.5 Flash strict schema 400 reject → admin-bypass 500. 모든 ARRAY 에 items: { type: 'OBJECT' } 또는 적절한 sub-schema 명시 필수. 위치: ${violations.join(' | ')}`;
  }
  return null;
}

// ── P187 (2026-05-25) — Playwright cache HIT 분기 browser binary 누락 ──────
// 회귀: actions/cache@v4 의 restore-keys fallback 으로 partial restore 발생 시
// browser binary 일부 누락 가능 (예: chromium 만 있고 webkit 없음). cache HIT 분기가
// install-deps 만 호출하면 binary 누락 시 runtime "Executable doesn't exist" 발생.
// 실 사고: 2026-05-25 Weekly i18n Audit 실패 — webkit-2287/pw_run.sh missing (run
// 26387169303). Fix: cache HIT 분기에서도 `npx playwright install` 호출 (이미
// 있는 browser fast skip → cache 효과 유지 + 누락 회귀 차단).
function P187_playwrightCacheHitBinaryMissing({ changed }) {
  const files = [
    '.github/workflows/weekly-i18n-audit.yml',
    '.github/workflows/pr-i18n-smoke.yml',
  ];
  const violations = [];
  for (const file of files) {
    if (!isModified(file, changed)) continue;
    const content = getChangedFileContent(file);
    if (!content) continue;
    // cache HIT 조건 분기 존재 시, 다음 15줄 안에 `playwright install ` (browser
    // install, install-deps 아님) 명령 필수.
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/cache-hit['"]?\s*==\s*['"]true['"]/.test(lines[i])) continue;
      const window = lines.slice(i, i + 15).join('\n');
      // playwright install (deps 아님) — 'install' 뒤에 - 가 없어야 함
      // 매치: `playwright install ` / `playwright install\n` / `playwright install\s+chromium`
      const hasBrowserInstall = /npx\s+playwright\s+install(\s+[^-]|\s*$|\s+chromium|\s+webkit|\s+firefox)/m.test(window);
      if (!hasBrowserInstall) {
        violations.push(`${file}:L~${i + 1} cache-hit 분기에 'npx playwright install <browser>' 누락 (install-deps 만으론 binary 회복 불가)`);
        break; // 같은 파일 중복 방지
      }
    }
  }
  if (violations.length > 0) {
    return `R-P187: Playwright cache HIT 분기에서 browser install 누락 ${violations.length}건 — partial cache restore 시 binary 누락 회귀 (5/25 weekly i18n audit run 26387169303 사고). \`npx playwright install chromium webkit\` 명령 동봉 필수: ${violations.join(' | ')}`;
  }
  return null;
}

// ── P188 (2026-05-25) — CITY_MAP dead fallback (yeosu/daegu/gangneung) ────
// 회귀: api/_food_helper.js 의 CITY_MAP 에 yeosu→busan / daegu→busan /
// gangneung→seoul 이 하드코딩돼 있었으나 _food_index.json 에 실제 row 존재:
// yeosu 25 / daegu 43 / gangneung 26. 위자드 도시 선택이 DB 를 사용하지 않고
// 부산/서울 식당을 추천하는 silent bug. 5/25 DB sweep 발견 (P188).
// 룰: CITY_MAP 안에서 yeosu/daegu/gangneung 가 다른 도시 (busan/seoul) 로
//   매핑되면 차단. 자기 자신 매핑 ('yeosu': 'yeosu') 또는 키 삭제만 허용.
function P188_cityMapDeadFallback({ changed }) {
  const file = 'api/_food_helper.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  if (!content) return null;
  const violations = [];
  // CITY_MAP = { ... } 블록 추출
  const map = content.match(/CITY_MAP\s*=\s*\{[\s\S]*?\}/);
  if (!map) return null;
  if (/yeosu\s*:\s*['"](?!yeosu)/.test(map[0])) violations.push('yeosu → 타도시 fallback');
  if (/daegu\s*:\s*['"](?!daegu)/.test(map[0])) violations.push('daegu → 타도시 fallback');
  if (/gangneung\s*:\s*['"](?!gangneung)/.test(map[0])) violations.push('gangneung → 타도시 fallback');
  if (violations.length === 0) return null;
  return `R-P188: CITY_MAP dead fallback ${violations.length}건 — DB row 1+ 존재 (yeosu 25 / daegu 43 / gangneung 26). 자기 매핑 또는 키 제거 필수. ${violations.join(' / ')}`;
}

// ── P186 (2026-05-25) — streaming early response _debug 호환 ─────────────
// 회귀: streaming 모드 (PLANNER_STREAMING_ENABLED=true) 가 handlerCore.js L407
// 의 _debug 주입 분기를 SKIP 시켜 measure script 의 model / plannerMode /
// abReason 자동 식별 불가. 5/25 P138 close-out 측정에서 발견.
// fix: streaming 분기 (L354) 에서도 buildAdminDebug 호출 + sendStreamingEarlyResponse
// 가 debug 매개변수 spread. buildAdminDebug 의 gate.isAdminBypass 조건부는 그대로
// 유지 (일반 user 정보 leak 차단).
function P186_streamingDebugInvisible({ changed }) {
  // (1) handlerCore.js — buildAdminDebug 가 최소 2회 호출 (streaming + 비-streaming)
  const hc = 'api/_ai_core/handlerCore.js';
  if (isModified(hc, changed)) {
    const content = getChangedFileContent(hc);
    if (content && /sendStreamingEarlyResponse\s*\(/.test(content)) {
      const callCount = (content.match(/buildAdminDebug\s*\(/g) || []).length;
      if (callCount < 2) {
        return `R-P186a: handlerCore.js streaming 분기에서 buildAdminDebug 미호출 — measure script 가 streaming 모드 plan 의 model/plannerMode 식별 불가. streaming early response 직전에도 buildAdminDebug 호출 후 sendStreamingEarlyResponse 의 debug 매개변수로 전달 필수.`;
      }
      // sendStreamingEarlyResponse 호출 시 debug 매개변수 전달 확인
      if (!/sendStreamingEarlyResponse\s*\(\s*\{[^}]*\bdebug\s*:/.test(content)) {
        return `R-P186a: handlerCore.js sendStreamingEarlyResponse 호출에 debug 매개변수 미전달 — streaming 모드에서 _debug 영원히 숨겨짐.`;
      }
    }
  }
  // (2) backgroundPipelines.js — sendStreamingEarlyResponse 시그니처에 debug 매개변수
  const bg = 'api/_ai_core/backgroundPipelines.js';
  if (isModified(bg, changed)) {
    const content = getChangedFileContent(bg);
    if (content && /export\s+function\s+sendStreamingEarlyResponse/.test(content)) {
      if (!/export\s+function\s+sendStreamingEarlyResponse\s*\(\s*\{[^}]*\bdebug\b/.test(content)) {
        return `R-P186b: backgroundPipelines.js sendStreamingEarlyResponse 시그니처에 debug 매개변수 없음 — P186 회귀 (streaming 모드 _debug 숨김).`;
      }
      // _debug spread 시 debug 조건부 (debug truthy 일 때만)
      if (!/\.\.\.\(debug\s*\?\s*\{\s*_debug:\s*debug\s*\}\s*:\s*\{\}\)/.test(content)) {
        return `R-P186b: backgroundPipelines.js sendStreamingEarlyResponse 가 debug 조건부 spread 미사용 — 일반 user 응답에 _debug 키 노출 가능 (security leak, P177 가드 위반).`;
      }
    }
  }
  return null;
}

// ── P183 phase 1 (2026-05-24) — dbMatcher cross-city HARD REJECT ─────────
// P180 (prompt strict) + P179 (B-MEAL prompt) 후에도 telegram alert 잔존
// (Gemini 비결정성). 운영자 "오류 좀 잡자 회귀법칙도 해놨는데" 강조 — prompt-only
// 한계 인정 후 runtime hard reject. cross-city fallback 시 match=null 강제.
function P183_dbMatcherCrossCityHardReject({ changed }) {
  const file = 'api/_ai_core/dbMatcher.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  // P183 marker 존재 확인
  if (!/P183[\s\S]{0,200}HARD REJECT/.test(content)) {
    return `R-P183: dbMatcher.js P183 phase 1 HARD REJECT 마커 누락 — cross-city fallback 다시 match=fallback 회귀 위험.`;
  }
  // cross-city 분기 안에 match=fallback 패턴 직접 회귀 차단
  // (cityMismatchCount++ 다음 10 라인 안에 match=fallback 없어야)
  const m = content.match(/cityMismatchCount\+\+[\s\S]{0,500}?(?=\n\s{8}\}|cityMismatchSamples\.push)/);
  if (m && /match\s*=\s*fallback/.test(m[0])) {
    return `R-P183: dbMatcher.js cross-city 분기에 match=fallback 회귀 — P180 verified=false 시그널 + Gemini hallucination address 노출 위험. match=null 유지 필수.`;
  }
  // 분모 변경 검증 (totalFoodWithCityCheck)
  if (!/totalFoodWithCityCheck\s*=\s*dbMatched\s*\+\s*cityMismatchCount/.test(content)) {
    return `R-P183: dbMatcher.js totalFoodWithCityCheck 분모 누락 — P183 후 dbMatched=same-city only 이라 MIN_MATCHES check 회귀 (작은 plan alert silent).`;
  }
  return null;
}

// ── P181 (2026-05-24) — INVALID_JSON zero-tolerance (cap 16K + prompt) ──
// 측정 시 INVALID_JSON 3건/day 발생 (운영자 zero-tolerance 명시 "오류 1도없이").
// maxOutputTokens 16K 이상 유지 + buildPrompt OUTPUT SIZE 강화 검증.
function P181_invalidJsonZeroTolerance({ changed }) {
  // (1) geminiPipeline maxOutputTokens >= 16000
  const gp = 'api/_ai_core/geminiPipeline.js';
  if (isModified(gp, changed)) {
    const content = getChangedFileContent(gp);
    const m = content.match(/maxOutputTokens:\s*(\d+)/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v < 16000) {
        return `R-P181a: geminiPipeline.js maxOutputTokens=${v} < 16000. 다도시 5-day Halal/Meat plan 12K 근접 → INVALID_JSON. zero-tolerance 보장 위해 16K 이상 유지 (P164 raise 후속).`;
      }
    }
  }
  // (2) buildPrompt OUTPUT SIZE P181 ZERO TOLERANCE section 존재
  const bp = 'api/_ai_core/buildPrompt.js';
  if (isModified(bp, changed)) {
    const content = getChangedFileContent(bp);
    if (/OUTPUT SIZE/.test(content) && !/P181 ZERO TOLERANCE/.test(content)) {
      return `R-P181b: buildPrompt.js OUTPUT SIZE section 의 P181 ZERO TOLERANCE 강화 누락 — tip 1 sentence MAX + 다도시 max 5 stops + recommended_items 4 max.`;
    }
  }
  return null;
}

// ── P179 (2026-05-24) — buildPrompt FINAL SELF-CHECK section ─────────────
// telegram alert 10:42 (Day 2/3 저녁 누락) + 11:26 (Day 3 점심 누락) 발견 →
// Gemini 비결정성으로 기존 strict 룰 만으로 부족. final reminder section 강제.
function P179_finalSelfCheckSection({ changed }) {
  const file = 'api/_ai_core/buildPrompt.js';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  if (!/FINAL SELF-CHECK BEFORE RESPONDING/.test(content)) {
    return `R-P179: buildPrompt.js FINAL SELF-CHECK 섹션 누락 — Gemini 가 lunch/dinner 누락 self-check 안 함. telegram alert 10:42/11:26 회귀.`;
  }
  if (!/MINIMUM\s*2\s*food stops/i.test(content)) {
    return `R-P179: buildPrompt.js FINAL SELF-CHECK 의 "MINIMUM 2 food stops per full day" 명시 누락 — Gemini 강제 룰 약화.`;
  }
  return null;
}

// ── P180 (2026-05-24) — food stop city 강제 + dbMatcher threshold 강화 ────
// buildPrompt 의 section 9-bis (다도시 food stop = day.city 일치) 누락 시
// Gemini wrong-city food 회귀. dbMatcher threshold 30%→20% (P180) 동기.
function P180_foodCityEnforcement({ changed }) {
  // (1) buildPrompt section 9-bis 존재
  const bp = 'api/_ai_core/buildPrompt.js';
  if (isModified(bp, changed)) {
    const content = getChangedFileContent(bp);
    // section 9-bis header + P180 reference 둘 다 매칭
    if (!/9-bis[^\n]*FOOD STOP city/.test(content)) {
      return `R-P180a: buildPrompt.js 의 section 9-bis (FOOD STOP city 매칭) 누락 — 다도시 Gemini wrong-city food 출력 → dbMatcher cross-city → verified=false + hallucination address. 사용자 plan 신뢰 손상.`;
    }
    if (!/P180/.test(content) || !/day\.city/.test(content)) {
      return `R-P180a: buildPrompt.js section 9-bis 의 P180 reference 또는 day.city 강제 룰 누락.`;
    }
  }
  // (2) dbMatcher threshold 0.2
  const dm = 'api/_ai_core/dbMatcher.js';
  if (isModified(dm, changed)) {
    const content = getChangedFileContent(dm);
    if (!/CITY_MISMATCH_RATIO_THRESHOLD\s*=\s*0\.2\b/.test(content)) {
      return `R-P180b: dbMatcher.js CITY_MISMATCH_RATIO_THRESHOLD 가 0.2 아님 (P180 30→20% 강화 회귀) — 일반 user 1/5 mismatch 도 alert 발동해야 신뢰 손상 조기 발견.`;
    }
  }
  return null;
}

// ── P177 (2026-05-24) — admin-bypass _debug response leak 차단 ────────────
// handlerCore.js 의 _ok response 에 _debug 객체 (modelMain / plannerMode /
// abReason 등) 추가 시 admin-bypass 조건부 (gate.isAdminBypass) 필수. 무조건
// 노출 시 일반 user 가 Pro vs Flash A/B 정보 알게 됨 (security/UX leak).
// 본 검사: handlerCore.js + debugInfo.js (buildAdminDebug 추출본) 양쪽 audit.
function P177_adminDebugConditional({ changed }) {
  // (1) handlerCore.js — _debug spread 시 buildAdminDebug 호출 결과 사용
  const hc = 'api/_ai_core/handlerCore.js';
  if (isModified(hc, changed)) {
    const content = getChangedFileContent(hc);
    if (/_debug\s*:/.test(content) && !/buildAdminDebug/.test(content)) {
      return `R-P177a: handlerCore.js _debug response 가 buildAdminDebug 헬퍼 미사용 — 직접 객체 작성 시 조건부 누락 위험 (Pro vs Flash A/B leak). debugInfo.js#buildAdminDebug 사용 필수.`;
    }
  }
  // (2) debugInfo.js — gate.isAdminBypass false 시 undefined 반환 강제
  const di = 'api/_ai_core/debugInfo.js';
  if (isModified(di, changed)) {
    const content = getChangedFileContent(di);
    if (/export\s+function\s+buildAdminDebug/.test(content) &&
        !/if\s*\(\s*!gate[^)]*isAdminBypass\s*\)\s*return\s+undefined/.test(content)) {
      return `R-P177b: debugInfo.js buildAdminDebug 가 !gate.isAdminBypass 시 undefined 반환 없음 — 일반 user 도 _debug 정보 노출 (security leak).`;
    }
  }
  return null;
}

// ── P175 (2026-05-24) — daily-health workflow log push silent fail ─────────
// .github/workflows/daily-health.yml 의 `git push || echo "Push failed"` 패턴은
// protected branch reject (GH006) 도 silent → 5/14~5/24 11일간 health-log.jsonl
// commit 누락 발견 지연. 명시적 step output + alert step 필수.
function P175_dailyHealthLogPushSilent({ changed }) {
  const file = '.github/workflows/daily-health.yml';
  if (!isModified(file, changed)) return null;
  const content = getChangedFileContent(file);
  // silent push 패턴 차단: `git push || echo ...` 또는 `git push || true`
  if (/git\s+push\s*\|\|\s*(echo|true)/.test(content)) {
    return `R-P175: .github/workflows/daily-health.yml git push 가 silent fail (|| echo / || true) — protected branch reject (GH006) 5/14~5/24 11일 미발견 root cause. 명시적 'if git push ... else ... output set + alert step' 패턴 사용.`;
  }
  return null;
}

function P174_validatePlannerSilentFail({ changed }) {
  // (1) validate-planner.cjs
  const vp = 'scripts/validate-planner.cjs';
  if (isModified(vp, changed)) {
    const content = getChangedFileContent(vp);
    if (/paypalOrderId\s*:\s*`TEST-/.test(content)) {
      return `R-P174a: scripts/validate-planner.cjs paypalOrderId='TEST-...' 사용 — prod (BRAINTREE_ENV=production) 에서 403 reject (audit P1-A). ADMIN-BYPASS- prefix 사용 필수 (admin email 인증 + LIVE bypass).`;
    }
  }
  // (2) daily-health-check.mjs
  const dh = 'scripts/daily-health-check.mjs';
  if (isModified(dh, changed)) {
    const content = getChangedFileContent(dh);
    // validation_actually_ok 또는 success_count > 0 패턴 둘 다 포함되어야 함
    const hasActuallyOk = /validation_actually_ok|validationActuallyOk/.test(content);
    const hasSuccessCheck = /success_count\s*[><=!]+\s*0|success_count\s*\?/.test(content);
    if (!hasActuallyOk && !hasSuccessCheck) {
      return `R-P174b: scripts/daily-health-check.mjs validation silent fail 차단 누락 — issues_within_threshold 단독 검사 시 success_count=0 (모두 fail) 도 "healthy" 판정. validation_actually_ok 또는 success_count > 0 추가 검사 필수.`;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// R-A1-7-3-* (2026-05-24) — PR #578 follow-up nested 검증 매트릭스
//
// PR #578 머지 후 4번 review 에서 5종 nested 검증 갭 발견:
//   1. stops.name.ko / description.ko 빈 값 미검증 (length≥2 통과 시 빈 stop 통과)
//   2. slots.capacity=0 / price_modifier_krw 음수 통과
//   3. i18n en/ja/zh 미검증 (외국인 손님 본질 — CocoTrip VIP target)
//   4. meeting_point lat/lng 미검증 (손님 위치 못 찾음 → 노쇼)
//   5. cancellation_policy.kind 미지정 (환불 분쟁)
//
// admin-product-publish-validation.ts 변경 시 5종 validator 함수가
// import/호출되는지 확인. AdminProductEditor.tsx 는 validateProductPublish
// 단일 entry 호출 (chain 내부) — 별도 lint 불필요.
// ─────────────────────────────────────────────────────────────────────────────

function R_A1_7_3_stopsNested({ changed }) {
  const FILE = 'src/lib/admin-product-publish-validation.ts';
  if (!isModified(FILE, changed)) return null;
  const content = getChangedFileContent(FILE);
  if (!content) return null;

  if (!/export function validateStopNested/.test(content)) {
    return `R-A1-7-3-stops-nested: ${FILE} 에 validateStopNested export 누락 — A1-7-3 follow-up review 1번 갭 회귀 (각 stop name.ko/en + description.ko/en 빈 값 검증). PR #578 follow-up 5종 validator 매트릭스 일부.`;
  }
  if (!/validateStopNested\(stops\)/.test(content) && !/validateStopNested\(\s*stops\s*\)/.test(content)) {
    return `R-A1-7-3-stops-nested: ${FILE} validateStopNested 호출 누락 (validateProductPublish 내부 chain). export 만 있고 실제 publish 검증 안 됨 — 빈 stop 노출 회귀.`;
  }
  return null;
}

function R_A1_7_3_slotsNumeric({ changed }) {
  const FILE = 'src/lib/admin-product-publish-validation.ts';
  if (!isModified(FILE, changed)) return null;
  const content = getChangedFileContent(FILE);
  if (!content) return null;

  if (!/export function validateSlotNumeric/.test(content)) {
    return `R-A1-7-3-slots-numeric: ${FILE} 에 validateSlotNumeric export 누락 — A1-7-3 follow-up review 2번 갭 회귀 (capacity ≥ 1, price_modifier_krw 음수 차단). PR #578 follow-up 매트릭스.`;
  }
  if (!/validateSlotNumeric\(slots\)/.test(content) && !/validateSlotNumeric\(\s*slots\s*\)/.test(content)) {
    return `R-A1-7-3-slots-numeric: ${FILE} validateSlotNumeric 호출 누락 — capacity=0 slot publish 가능 회귀.`;
  }
  return null;
}

function R_A1_7_3_meetingValidate({ changed }) {
  const FILE = 'src/lib/admin-product-publish-validation.ts';
  if (!isModified(FILE, changed)) return null;
  const content = getChangedFileContent(FILE);
  if (!content) return null;

  if (!/export function validateMeetingPoint/.test(content)) {
    return `R-A1-7-3-meeting-validate: ${FILE} 에 validateMeetingPoint export 누락 — A1-7-3 follow-up review 4번 갭 회귀 (fixed_address lat/lng / hotel_pickup instructions / multi_zone zones). 손님 위치 못 찾으면 노쇼.`;
  }
  if (!/validateMeetingPoint\(draft\.meeting_point\)/.test(content)) {
    return `R-A1-7-3-meeting-validate: ${FILE} validateMeetingPoint(draft.meeting_point) 호출 누락 — meeting_point invalid 상태로 publish 가능 회귀.`;
  }
  return null;
}

/**
 * P191_mountainHelperSafety — 메모리 P191 (2026-05-25, SAFETY-CRITICAL).
 *
 * 외국인 visitor 가 잘못된 등산 정보 (거리/난이도/시간) 로 사고 위험.
 * buildPrompt.js / handlerCore.js 의 Trekking/Hallasan/Mountain 키워드
 * 분기에 _mountain_helper 함수 호출이 빠지면 100% Gemini 생성 = hallucination
 * 안전 위험 회귀.
 *
 * 검사:
 *   1. handlerCore.js 에 Trekking/Hallasan 분기 → getMountainContextForPrompt 호출 확인
 *   2. handlerCore.js 에 _mountain_helper import 확인
 *   3. userMessageBuilder.js 에 mountainContext 파라미터 확인
 *   4. api/_mountain_index.json 존재 확인 (build-mountain-index.js 산출물)
 *
 * 트리거: handlerCore.js / userMessageBuilder.js / buildPrompt.js /
 *          api/_mountain_helper.js 변경 시
 */
function P191_mountainHelperSafety({ changed }) {
  const TRIGGER_FILES = [
    'api/_ai_core/handlerCore.js',
    'api/_ai_core/userMessageBuilder.js',
    'api/_ai_core/buildPrompt.js',
    'api/_mountain_helper.js',
  ];
  const triggered = changed.some(
    (c) => c.status !== 'D' && TRIGGER_FILES.some((t) => c.file === t || c.file.endsWith(t)),
  );
  if (!triggered) return { skipped: true };

  const localViolations = [];

  // (1) handlerCore.js: _mountain_helper import 확인
  const handlerContent = getChangedFileContent('api/_ai_core/handlerCore.js');
  if (handlerContent) {
    if (!/import\s+\{[^}]*getMountainContextForPrompt[^}]*\}\s+from\s+['"].*_mountain_helper/.test(handlerContent)) {
      localViolations.push(
        'api/_ai_core/handlerCore.js: getMountainContextForPrompt import 누락 — ' +
        'Trekking/Hallasan 분기 _mountain_helper 미연결. P191 SAFETY-CRITICAL 회귀.',
      );
    }
    // (2) Trekking/Hallasan 분기에서 getMountainContextForPrompt 호출
    if (!/Trekking|Hallasan/.test(handlerContent) || !/getMountainContextForPrompt\s*\(/.test(handlerContent)) {
      localViolations.push(
        'api/_ai_core/handlerCore.js: Trekking/Hallasan 분기에 getMountainContextForPrompt() 호출 없음 ' +
        '— 외국인 등산 hallucination 차단 불가. P191 SAFETY-CRITICAL.',
      );
    }
  }

  // (3) userMessageBuilder.js: mountainContext 파라미터
  const builderContent = getChangedFileContent('api/_ai_core/userMessageBuilder.js');
  if (builderContent) {
    if (!/mountainContext/.test(builderContent)) {
      localViolations.push(
        'api/_ai_core/userMessageBuilder.js: mountainContext 파라미터 누락 — ' +
        'handlerCore 가 계산한 mountain DB 가 Gemini prompt 에 전달되지 않음. P191 회귀.',
      );
    }
  }

  // (4) api/_mountain_index.json 존재
  if (!existsSync('api/_mountain_index.json')) {
    localViolations.push(
      'api/_mountain_index.json 없음 — node scripts/build-mountain-index.js 로 생성 필요. ' +
      'P191 SAFETY-CRITICAL: 60 row 등산 검증 DB 없으면 _mountain_helper 로드 불가.',
    );
  }

  if (localViolations.length > 0) {
    fail(
      'P191_mountainHelperSafety',
      `SAFETY-CRITICAL 회귀 ${localViolations.length}건 — ${localViolations.join(' | ')}`,
      'P191 (2026-05-25) — 외국인 등산 사고 예방. Trekking/Hallasan 분기는 반드시 ' +
      'getMountainContextForPrompt() (api/_mountain_helper.js) 호출 + mountainContext 를 ' +
      'userMessageBuilder 에 전달해야 함. api/_mountain_index.json 삭제 금지.',
    );
  }
  return null;
}

// ── P192 (2026-05-25) — Gemini thinkingBudget + maxOutputTokens 충돌 방지 ───────
function P192_geminiThinkingOutputConflict({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // Rule 1: Flash 분기에서 thinkingBudget: 0 확인
  const hasFlashZeroThinking =
    /isFlash\s*\?\s*0/.test(content) ||
    /isFlash.*thinkingBudget.*0/s.test(content) ||
    (/isFlash/.test(content) && /thinkingBudget\s*=\s*0/.test(content));
  if (!hasFlashZeroThinking) {
    violations.push('buildModel: Flash 분기 thinkingBudget=0 미적용 (Issue #609)');
  }

  // Rule 2: thinkingBudget > 8000 차단 (Pro 도 침범 위험)
  const proThinkingMatch = content.match(/thinkingBudget\s*[:=]\s*(\d+)/g) || [];
  for (const m of proThinkingMatch) {
    const numMatch = m.match(/(\d+)/);
    if (numMatch) {
      const val = parseInt(numMatch[1], 10);
      if (val > 0 && val > 8000) {
        violations.push(`buildModel: thinkingBudget: ${val} > 8K (Issue #2062)`);
      }
    }
  }

  // Rule 3: maxOutputTokens >= 24000
  const maxOutputMatch = content.match(/maxOutputTokens\s*:\s*(\d+)/);
  if (maxOutputMatch) {
    const val = parseInt(maxOutputMatch[1], 10);
    if (val < 24000) {
      violations.push(`buildModel: maxOutputTokens: ${val} < 24K`);
    }
  } else {
    violations.push('buildModel: maxOutputTokens 설정 없음');
  }

  // Rule 4: responseMimeType + responseSchema (P183 회귀 방지)
  if (!/responseMimeType\s*:\s*['"]application\/json['"]/.test(content)) {
    violations.push('buildModel: responseMimeType json 누락 (P183 회귀)');
  }
  if (!/responseSchema/.test(content)) {
    violations.push('buildModel: responseSchema 미적용 (P183 phase2 회귀)');
  }

  if (violations.length > 0) {
    return createViolation(
      'P192_geminiThinkingOutputConflict',
      `R-P192 위반 ${violations.length}건 — ${violations.join(' | ')}`,
      'R-P192: thinkingBudget > 8K + maxOutputTokens < 24K = Gemini output 침범 위험 (GitHub Issue #609/#2062 / 5/25 prod 회귀). Flash 는 thinkingBudget:0 강제.',
    );
  }
  return null;
}

// ── P193 (2026-05-25) — PDF recommended restaurants SAFETY-CRITICAL ──────────
/**
 * P193_pdfRecommendedRestaurantsSafety — SAFETY-CRITICAL (2026-05-25).
 *
 * pdfGenerator.ts 에 buildRecommendedRestaurantsSection export + generatePDF 본문
 * 호출 + PdfUiDict pdfHalalSection/pdfVeganSection 4-lang 라벨 필수.
 * 누락 시 무슬림/비건 visitor PDF 다운로드 시 식이제한 식당 정보 0건 위험.
 */
function P193_pdfRecommendedRestaurantsSafety({ changed }) {
  const PDF_FILE = 'src/pages/PlanDetailPage/pdfGenerator.ts';
  if (!isModified(PDF_FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(PDF_FILE) || readFileExists(PDF_FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/export function buildRecommendedRestaurantsSection/.test(content)) {
    violations.push('pdfGenerator.ts: buildRecommendedRestaurantsSection export 없음 (SAFETY)');
  }
  if (!/buildRecommendedRestaurantsSection\s*\(/.test(content)) {
    violations.push('pdfGenerator.ts: generatePDF 에서 buildRecommendedRestaurantsSection 호출 없음');
  }
  if (!content.includes('pdfHalalSection')) {
    violations.push('pdfGenerator.ts: pdfHalalSection 4-lang 라벨 없음');
  }
  if (!content.includes('pdfVeganSection')) {
    violations.push('pdfGenerator.ts: pdfVeganSection 4-lang 라벨 없음');
  }

  if (violations.length > 0) {
    fail(
      'P193_pdfRecommendedRestaurantsSafety',
      violations.join(' | '),
      'R-P193 SAFETY-CRITICAL: PDF 의 recommended_restaurants 섹션 누락 — ' +
      '무슬림 visitor 식이제한 식당 정보 미표시 (건강 위험). CLAUDE.md J 준수 필수.',
    );
  }
  return null;
}

// ── R-P206 (2026-05-26) — measure script status=ready polling 의무화 ─────────
// 5/26 시각 검증 발견: HTTP 200 + 35초 = measure "성공" 기록이지만
// data.status='streaming' → 실제 plan 미완성 (background pipeline 계속).
// measure script 가 status=streaming 시 /api/plan-status polling 없으면 hang/timeout
// plan 도 "성공"으로 기록 → 측정 데이터 신뢰성 0.
//
// 검사:
//   1. scripts/measure-flash-stability-5sample.mjs 에 'plan-status' 참조 존재
//   2. 'status.*ready' 또는 'finalStatus' polling 패턴 존재
//   3. 'isSuccess' 변수 → HTTP 200 단순 판정 금지
function P206_measureStatusReadyPolling({ changed }) {
  const FILE = 'scripts/measure-flash-stability-5sample.mjs';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 1) /api/plan-status polling 엔드포인트 참조
  if (!/plan-status/.test(content)) {
    violations.push(
      `${FILE}: /api/plan-status polling 참조 없음 — status=streaming plan 을 미완성으로 기록 못 함. P206 fix 회귀.`,
    );
  }

  // 2) finalStatus 또는 status === 'ready' 확인 패턴
  if (!/finalStatus|status\s*===\s*['"]ready['"]/.test(content)) {
    violations.push(
      `${FILE}: finalStatus 또는 status==='ready' 확인 패턴 없음 — polling 결과 미검증. P206 fix 회귀.`,
    );
  }

  // 3) isSuccess 변수 (HTTP 200 단순 판정 대신 status=ready 확인 의무)
  if (!/isSuccess/.test(content)) {
    violations.push(
      `${FILE}: isSuccess 변수 없음 — s.status===200 단순 판정 회귀 가능. P206 회귀 차단.`,
    );
  }

  if (violations.length > 0) {
    fail(
      'P206_measureStatusReadyPolling',
      `R-P206 위반 ${violations.length}건 — ${violations.join(' | ')}`,
      'P206 (2026-05-26) — measure script HTTP 200 후 status=streaming 이면 /api/plan-status 5초 polling 의무. ' +
      'OpenAI Background Mode / Replicate 동일 패턴. 10분 timeout = Vercel maxDuration 일치. ' +
      '결과: httpSec + pollSec = totalSec 분리 컬럼.',
    );
  }
  return null;
}

// ── R-PlanDetailVisual (2026-05-26) — PlanDetailPage 변경 시 visual spec 존재 의무 ──
// 5/26 cycle close-out: 시각 검증 0 (자율 검증 사각지대). landing spec 만 있고
// PlanDetailPage spec 없어 6건 sleeper bug 미발견. PlanDetailPage/index.tsx 등
// PlanDetailPage 핵심 파일 변경 시 visual spec 존재 의무화.
//
// 트리거: src/pages/PlanDetailPage/ 하위 파일 변경 시.
// 위반: tests/visual/plan-detail-mobile.spec.ts 가 존재하지 않으면 fail.
function R_PlanDetailVisual({ changed }) {
  const PLAN_DETAIL_DIR = 'src/pages/PlanDetailPage/';
  const VISUAL_SPEC = 'tests/visual/plan-detail-mobile.spec.ts';

  const hasPlanDetailChange = changed.some(
    (c) => c.status !== 'D' && c.file.startsWith(PLAN_DETAIL_DIR),
  );
  if (!hasPlanDetailChange) return { skipped: true };

  // visual spec 존재 여부 확인
  if (!existsSync(VISUAL_SPEC)) {
    fail(
      'R_PlanDetailVisual',
      `${PLAN_DETAIL_DIR} 변경 감지됐는데 ${VISUAL_SPEC} 가 없음 — PlanDetailPage 시각 회귀 사각지대 (5/26 cycle "시각 검증 0" 회귀).`,
      `해결: tests/visual/plan-detail-mobile.spec.ts 작성 후 Docker 로 baseline PNG 생성 + commit. ` +
      `README: tests/visual/README.md 참조.`,
    );
    return null;
  }

  // spec 에 최소 1개 toHaveScreenshot 호출 있는지 확인
  const specContent = getChangedFileContent(VISUAL_SPEC) || (() => {
    try { return readFileSync(VISUAL_SPEC, 'utf8'); } catch { return ''; }
  })();
  if (!/toHaveScreenshot/.test(specContent)) {
    fail(
      'R_PlanDetailVisual',
      `${VISUAL_SPEC}: toHaveScreenshot 호출 없음 — 실제 visual assertion 없는 빈 spec.`,
      `spec 에 expect(page).toHaveScreenshot(...) 호출 최소 1개 추가 필수.`,
    );
  }
  return null;
}

// ── R-P246 (2026-05-27) — DMZ style 선택 시 city-mismatch 차단 ──────────────────────────────
// P246 root cause: input=seoul + styles=DMZ 인데 Gemini 가 제주(한림공원/협재해변) stops 생성.
// 진짜 root cause: buildPrompt.js 의 DMZ style 라인에 city 강제 없음 → legacy Gemini path
// 에서 Seoul area + DMZ style 조합이 Jeju stops 를 생성.
//
// 2-layer fix:
//   (1) buildPrompt.js DMZ 라인에 "ALL DMZ stops MUST be in Gyeonggi-do/Paju" 명시.
//   (2) responseValidator.js R-P246 soft guard — Dmz style 시 Jeju/Busan address 감지 + Telegram alert.
//
// 트리거: buildPrompt.js / responseValidator.js / geminiPipeline.js 변경 시.
// 위반 조건:
//   1. buildPrompt.js 의 Dmz style 라인에 "Gyeonggi" city guard 없음.
//   2. responseValidator.js 에 R-P246 / dmz_city_mismatch 마커 없음.
//   3. geminiPipeline.js 의 validateResponse 호출에 styles 미전달.
//
// 검사 위치: api/_ai_core/buildPrompt.js, api/_ai_core/responseValidator.js,
//           api/_ai_core/geminiPipeline.js.

/**
 * P246_dmzCityMismatchGuard — DMZ style + city guard 2-layer 유지 검증.
 */
function P246_dmzCityMismatchGuard({ changed }) {
  const BP = 'api/_ai_core/buildPrompt.js';
  const RV = 'api/_ai_core/responseValidator.js';
  const GP = 'api/_ai_core/geminiPipeline.js';
  const anyChanged = [BP, RV, GP].some((f) => isModified(f, changed));
  if (!anyChanged) return { skipped: true };

  const issues = [];

  const bp = readFileExists(BP);
  if (bp) {
    // Layer 1: buildPrompt.js DMZ line 에 Gyeonggi/Paju city guard 존재 확인.
    if (!(/Dmz.*Gyeonggi/s.test(bp) || /DMZ.*Gyeonggi/s.test(bp))) {
      issues.push(`${BP}: DMZ style 라인에 Gyeonggi city guard 누락 — Jeju/Busan stops 생성 차단 불가 (P246 root cause)`);
    }
  }

  const rv = readFileExists(RV);
  if (rv) {
    // Layer 2: responseValidator.js 에 R-P246 / dmz_city_mismatch 마커 확인.
    if (!rv.includes('dmz_city_mismatch') && !rv.includes('P246')) {
      issues.push(`${RV}: dmz_city_mismatch 또는 P246 validator 마커 누락 — styles=Dmz + 비DMZ stop 감지 불가`);
    }
  }

  const gp = readFileExists(GP);
  if (gp) {
    // geminiPipeline.js validateResponse 호출에 styles 전달 확인.
    // body?.styles 또는 styles: 패턴 찾기.
    if (!/validateResponse\s*\(itinerary,\s*\{[^}]*styles/.test(gp)) {
      issues.push(`${GP}: validateResponse 호출에 styles 미전달 — R-P246 DMZ city guard 작동 불가`);
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P246_dmzCityMismatchGuard',
    severity: 'error',
    file: BP,
    message:
      'R-P246: DMZ city-mismatch guard 2-layer 손상 — input=seoul + styles=Dmz 인데 제주/부산 stops 생성 (prod 사고: 한림공원/곽지해수욕장). ' +
      'Layer 1 (buildPrompt Gyeonggi guard) + Layer 2 (responseValidator dmz_city_mismatch) 반드시 동시 유지. 발견: ' + issues.join(', '),
  };
}

// ── R-P248 (2026-05-27) — Haenyeo style 선택 시 city-mismatch 차단 ──────────────────────────────
// P248 root cause: P246 follow-up. styles=Haenyeo 는 Jeju-only 경험 — _haenyeo_index.json 의
// 모든 row 가 city='jeju'. area=seoul + styles=Haenyeo 조합에서 Gemini 가 서울 stops 생성 가능.
//
// 2-layer fix:
//   (1) buildPrompt.js Haenyeo 라인에 "ALL Haenyeo stops MUST be in Jeju" 명시.
//   (2) responseValidator.js R-P248 soft guard — Haenyeo style 시 서울/부산 address 감지 + Telegram alert.
//
// 트리거: buildPrompt.js / responseValidator.js / geminiPipeline.js 변경 시.
// 위반 조건:
//   1. buildPrompt.js 의 Haenyeo style 라인에 Jeju city guard 없음.
//   2. responseValidator.js 에 haenyeo_city_mismatch 또는 P248 마커 없음.
//
// 검사 위치: api/_ai_core/buildPrompt.js, api/_ai_core/responseValidator.js.

/**
 * P248_haenyeoCityMismatchGuard — Haenyeo style + Jeju-only city guard 2-layer 유지 검증.
 */
function P248_haenyeoCityMismatchGuard({ changed }) {
  const BP = 'api/_ai_core/buildPrompt.js';
  const RV = 'api/_ai_core/responseValidator.js';
  const anyChanged = [BP, RV].some((f) => isModified(f, changed));
  if (!anyChanged) return { skipped: true };

  const issues = [];

  const bp = readFileExists(BP);
  if (bp) {
    // Layer 1: buildPrompt.js Haenyeo line 에 Jeju city guard 존재 확인.
    if (!(/Haenyeo.*Jeju/s.test(bp) || /haenyeo.*Jeju/s.test(bp))) {
      issues.push(`${BP}: Haenyeo style 라인에 Jeju city guard 누락 — 서울/부산 stops 생성 차단 불가 (P248 root cause)`);
    }
  }

  const rv = readFileExists(RV);
  if (rv) {
    // Layer 2: responseValidator.js 에 haenyeo_city_mismatch 또는 P248 마커 확인.
    if (!rv.includes('haenyeo_city_mismatch') && !rv.includes('P248')) {
      issues.push(`${RV}: haenyeo_city_mismatch 또는 P248 validator 마커 누락 — styles=Haenyeo + 비Jeju stop 감지 불가`);
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P248_haenyeoCityMismatchGuard',
    severity: 'error',
    file: BP,
    message:
      'R-P248: Haenyeo city-mismatch guard 2-layer 손상 — styles=Haenyeo 인데 서울/부산 stops 생성 가능 (P246 follow-up). ' +
      '_haenyeo_index.json 모든 row = jeju. ' +
      'Layer 1 (buildPrompt Jeju guard) + Layer 2 (responseValidator haenyeo_city_mismatch) 반드시 동시 유지. 발견: ' + issues.join(', '),
  };
}

// ── R-P244 (2026-05-27) — Playwright visual spec beforeEach networkidle 사용 금지 ──
// P244 root cause: deployment_status trigger 에서 CI 가 auth 없이 실행됨.
// section-tabs-scroll waitForSelector 는 plan 로드 성공 시만 → auth 없으면 항상 timeout.
// 올바른 패턴: waitForFunction(__pageReady) — loading=false 모든 terminal state에서 emit.
//
// 트리거: tests/visual/*.spec.ts 변경 시.
// 위반 조건:
//   1. beforeEach 에 networkidle waitForLoadState 사용.
//   2. beforeEach 에 waitForSelector 만 있고 waitForFunction(__pageReady) 없음.
function R_P244_playwrightPageReadySignal({ changed }) {
  const VISUAL_SPEC_GLOB = 'tests/visual/';
  const violations = [];

  for (const c of changed) {
    if (c.status === 'D') continue;
    if (!c.file.startsWith(VISUAL_SPEC_GLOB) || !c.file.endsWith('.spec.ts')) continue;

    const content = getChangedFileContent(c.file) || (() => {
      try { return readFileSync(c.file, 'utf8'); } catch { return ''; }
    })();

    // 위반 1: networkidle 직접 사용
    if (/waitForLoadState\s*\(\s*['"]networkidle['"]/.test(content)) {
      violations.push(`${c.file}: waitForLoadState('networkidle') 사용 — SPA Firestore WebSocket 이 idle 조건 달성 불가 (P244 root cause)`);
    }

    // 위반 2: beforeEach 내 waitForSelector 만 있고 waitForFunction(__pageReady) 없는 경우
    // (plan-detail-mobile.spec.ts 에만 적용 — PlanDetailPage 에는 __pageReady 의무)
    if (c.file.includes('plan-detail-mobile')) {
      const hasPageReadyWait = /waitForFunction[\s\S]*?__pageReady/.test(content);
      if (!hasPageReadyWait) {
        violations.push(`${c.file}: waitForFunction(window.__pageReady) 누락 — auth 없는 CI 에서 section-tabs-scroll 미노출 시 timeout (P244 패턴 의무)`);
      }
    }
  }

  if (violations.length === 0) return null;
  return `R-P244: Playwright visual spec beforeEach 패턴 위반 ${violations.length}건 — deployment_status trigger 에서 auth 없이 실행 시 chronic timeout 회귀 (P237/P240/P241/P239 4 cycle 동일). 올바른 패턴: waitForFunction(() => window.__pageReady === true): ${violations.join(' | ')}`;
}

/**
 * R_P321 (2026-05-31): blockMode.js tryRunBlockMode 의 regions→cityKey 정규화가 normalizeRegionKey
 * (한/영/일/중→영문) 를 써야 함. raw `.split('_')[0].toLowerCase()` 만 쓰면 한국어 regions('서울')
 * 가 Firestore zone_courses 영문키('seoul') 와 mismatch → 블록 0건 → block_mode silent legacy 폴백
 * (ko/ja/zh 다도시 100% 영향, 5일+ 느림 직접 원인). #727 회귀 차단.
 */
function R_P321_blockModeRegionNormalize(ctx) {
  if (!isModified('api/_ai_core/blockMode.js', ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync('api/_ai_core/blockMode.js', 'utf8'); } catch { return { skipped: true }; }
  const hasRegionsMap = /regions\s*\.\s*map\(/.test(src);
  const usesNormalize = /normalizeRegionKey/.test(src);
  if (hasRegionsMap && !usesNormalize) {
    fail(
      'R_P321_blockModeRegionNormalize',
      'blockMode.js regions 정규화에 normalizeRegionKey 미사용 — 한국어 regions 가 Firestore 영문 cityKey 와 mismatch → block_mode silent legacy 폴백 (P321/#727 회귀)',
      'regions.map((r) => normalizeRegionKey(String(r).split("_")[0])) 패턴 유지 (responseValidator normalizeRegionKey).',
    );
  }
  return null;
}

/**
 * P326_cacheGeoValidation — 메모리 P326 #1 (2026-05-31, transit 경로 품질).
 * block_mode transit cache(P228) hit 을 venue 좌표 지리 검증 없이 재사용하면 food placeholder
 * 치환(matchFoodPlaceholder) 시 옛 거리/시간 오적용("6km 를 23분/3959m") + subway→car 강등.
 * fix: cache hit 후 isCacheGeoConsistent(haversine 실거리 vs cached 거리 ±50%) 게이트 → 벗어나면
 * ODsay 실측 fall-through. 회귀 슬롯: tests/unit/transit-quality-p326.test.ts.
 */
function P326_cacheGeoValidation({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  // transit cache lookup 을 쓰는 경우에만 검사 (lookup 자체가 빠지면 무관).
  if (!/lookupTransitCache/.test(content)) return null;
  const violations = [];
  if (!/isCacheGeoConsistent/.test(content)) {
    violations.push(`${FILE}: transit cache hit 이 isCacheGeoConsistent 지리 검증 없이 재사용 — food placeholder 치환 시 옛 거리/시간 오적용("6km 를 23분") + subway→car 강등 (P326 #1 회귀)`);
  } else if (!/if\s*\(\s*isCacheGeoConsistent\([^)]*\)\s*\)/.test(content)) {
    // helper 는 정의됐는데 cache hit 게이트로 안 쓰는 경우 (연결 누락).
    violations.push(`${FILE}: isCacheGeoConsistent 가 cache hit 게이트(if (isCacheGeoConsistent(...))) 로 사용 안 됨 — cache 폐기 로직 미연결 (P326 #1 회귀)`);
  }
  if (violations.length > 0) {
    fail(
      'P326_cacheGeoValidation',
      violations.join(' | '),
      '메모리 P326 #1 — cache hit 후 _haversineKmPure(prev,curr) vs cached 거리 ±50% 벗어나면 cache 폐기 → _getTransitData ODsay 실측. tests/unit/transit-quality-p326.test.ts.',
    );
  }
  return null;
}

/**
 * P326_intercityMergeBack — 메모리 P326 #2 (2026-05-31, transit 경로 품질).
 * block_mode 다도시는 RouteAgent _enrichMultiCityDays 가 intercity_transit(KTX) 생성하나,
 * routeEnrichment merge-back 루프가 stops/lodging 만 원본 복사하고 intercity_transit 누락 →
 * 생성됐다 손실(서울→부산 KTX 0건). fix: 머지백 상단(enrichedStops>0 가드 **밖** —
 * 도시전환일 stops 0 가능) 에서 복사. 회귀 슬롯: tests/unit/transit-quality-p326.test.ts.
 */
function P326_intercityMergeBack({ changed }) {
  const FILE = 'api/_ai_core/routeEnrichment.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  // merge-back 루프가 존재할 때만 검사 (루프 자체가 사라지면 무관).
  const hasMergeBackLoop = /enrichedDays\.forEach/.test(content) || /enrichedDay\.lodging_to_first/.test(content);
  if (!hasMergeBackLoop) return null;
  const violations = [];
  const copyRe = /itinerary\.days\[i\]\.intercity_transit\s*=\s*enrichedDay\.intercity_transit/;
  if (!copyRe.test(content)) {
    violations.push(`${FILE}: merge-back 루프가 enrichedDay.intercity_transit 를 원본 itinerary.days 로 복사 안 함 — block_mode 다도시 KTX 손실(생성됐다 버려짐, P326 #2 회귀)`);
  } else {
    // 배치 불변식: 복사문이 enrichedStops 가드보다 위(앞)에 있어야 도시전환일(stops 0) 손실 방지.
    const copyIdx = content.search(copyRe);
    const stopsGuardIdx = content.search(/const\s+enrichedStops\s*=\s*enrichedDay\.stops/);
    if (stopsGuardIdx >= 0 && copyIdx > stopsGuardIdx) {
      violations.push(`${FILE}: intercity_transit 복사가 enrichedStops 가드 뒤로 이동됨 — 도시전환일 stops 0 시 KTX 손실 위험 (P326 #2 배치 불변식 회귀)`);
    }
  }
  if (violations.length > 0) {
    fail(
      'P326_intercityMergeBack',
      violations.join(' | '),
      '메모리 P326 #2 — enrichedDays.forEach 상단(enrichedStops>0 조건 밖)에 if (itinerary.days[i] && enrichedDay.intercity_transit) itinerary.days[i].intercity_transit = enrichedDay.intercity_transit 유지. tests/unit/transit-quality-p326.test.ts.',
    );
  }
  return null;
}

/**
 * R_Plaunch_departureAirportDerive (2026-05-31, SAFETY-CRITICAL): WizardForm index.tsx 의
 * 출국 공항이 미선택 시 *입국 공항*을 강제하면 안 됨(`departureTerminal || arrivalTerminal`).
 * 그러면 backend inferDepartureAirport(부산→PUS/김해, 제주→CJU) 가 죽은 코드가 되어 다도시 출국이
 * 잘못된 공항(부산→인천 ICN 143분 = 지리적 불가) 으로 안내 = 비행기 놓침 risk. FIX: 사용자
 * 명시값(미선택 시 '') 만 전달 → requestShaper inferDepartureAirport 가 마지막 도시 기준 도출.
 * 회귀 슬롯: tests/unit/departure-airport-derive-launch.test.ts.
 */
function R_Plaunch_departureAirportDerive(ctx) {
  const FILE = 'src/components/WizardForm/index.tsx';
  if (!isModified(FILE, ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync(FILE, 'utf8'); } catch { return { skipped: true }; }
  // 출국 공항 도출 라인이 존재할 때만 검사 (라인 자체가 리팩터로 사라지면 무관).
  if (!/departureAirport\s*=\s*departureTerminal/.test(src)) return null;
  if (/departureAirport\s*=\s*departureTerminal\s*\|\|\s*arrivalTerminal/.test(src)) {
    fail(
      'R_Plaunch_departureAirportDerive',
      'WizardForm index.tsx 출국 공항이 미선택 시 입국 공항 강제 폴백(departureTerminal || arrivalTerminal) — backend inferDepartureAirport(부산→김해 PUS) 죽은 코드화 → 다도시 출국 잘못된 공항 안내 (비행기 놓침 risk, SAFETY-CRITICAL, P-launch 회귀)',
      'const departureAirport = departureTerminal; (미선택 시 "" 전달). tests/unit/departure-airport-derive-launch.test.ts.',
    );
  }
  return null;
}

/**
 * R_Phase0_flagStringCompare (2026-06-01): Vite env 플래그는 항상 string → boolean truthy 비교 금지,
 * 반드시 `=== 'true'`. 안 그러면 OFF(미설정)가 안 되어 swap-in 패턴 깨짐. PR-A own-tour upsell.
 */
function R_Phase0_flagStringCompare(ctx) {
  const FILE = 'src/pages/PlannerPage/components/OwnTourUpsellSection.tsx';
  if (!isModified(FILE, ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync(FILE, 'utf8'); } catch { return { skipped: true }; }
  if (!/VITE_FEATURE_OWN_TOUR_UPSELL/.test(src)) return null;
  if (!/VITE_FEATURE_OWN_TOUR_UPSELL\s*===\s*['"]true['"]/.test(src)) {
    fail(
      'R_Phase0_flagStringCompare',
      "OwnTourUpsellSection: VITE_FEATURE_OWN_TOUR_UPSELL 를 === 'true' 로 비교 안 함 — Vite env 는 항상 string 이라 truthy 비교 시 OFF(미설정)가 안 됨 (PR-A 플래그 무력화)",
      "const FLAG_ON = import.meta.env.VITE_FEATURE_OWN_TOUR_UPSELL === 'true';",
    );
  }
  return null;
}

/**
 * R_Phase0_jsonldTestNoFirebase (2026-06-01): tour-jsonld 테스트는 순수 모듈 buildTourJsonLd 에서
 * import — TourDetailPage(클라이언트 컴포넌트 → src/lib/firebase getAuth) import 시 CI(키 없음)
 * "0 test" crash. PR-B CI 실패 재발 차단. (교훈: 순수함수 테스트는 firebase-free 모듈만 import.)
 */
function R_Phase0_jsonldTestNoFirebase(ctx) {
  const FILE = 'tests/unit/tour-jsonld-rating-prb.test.ts';
  if (!isModified(FILE, ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync(FILE, 'utf8'); } catch { return { skipped: true }; }
  if (/from\s+['"]@\/pages\/TourDetailPage['"]/.test(src)) {
    fail(
      'R_Phase0_jsonldTestNoFirebase',
      'tour-jsonld 테스트가 TourDetailPage(클라이언트 컴포넌트, firebase getAuth 의존) import — CI(firebase 키 없음) "0 test" crash 재발 (PR-B 회귀)',
      "import { buildTourJsonLd } from '@/pages/buildTourJsonLd'; (firebase-free 순수 모듈)",
    );
  }
  return null;
}

/**
 * R_Phase0_charterPriceSSOT (2026-06-01, SAFETY-가격): RouteAgent est_price_krw 는 반드시
 * airportTransferPriceKRW(loadPricingSpec SSOT) 경유 — 가격 literal/임의 계산 = 신뢰 치명.
 * PR-C 가격 오노출 차단 (미매핑 → null 숨김).
 */
function R_Phase0_charterPriceSSOT(ctx) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync(FILE, 'utf8'); } catch { return { skipped: true }; }
  if (!/est_price_krw/.test(src)) return null;
  if (!/airportTransferPriceKRW/.test(src)) {
    fail(
      'R_Phase0_charterPriceSSOT',
      'RouteAgent est_price_krw 가 airportTransferPriceKRW(SSOT) 없이 설정 — 가격 literal/임의 계산 위험 (PR-C 가격 오노출, 신뢰 치명)',
      'rec.est_price_krw = airportTransferPriceKRW(region) (loadPricingSpec SSOT, 미매핑 → null 숨김).',
    );
  }
  return null;
}

/**
 * R_Phase0_resumeStrictGate (2026-06-01): snapshotContent.ts 는 countMeaningfulWizardSignals(≥2 신호
 * 게이트)를 유지해야 함 — 단일 신호 트리거로 회귀 시 resume 과노출 재발. dirtyExit(라이프사이클 신호)는
 * 콘텐츠 카운트/autosave 에 넣지 말 것(500ms clobber + 과노출). PR-D.
 */
function R_Phase0_resumeStrictGate(ctx) {
  const FILE = 'src/components/WizardForm/snapshotContent.ts';
  if (!isModified(FILE, ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync(FILE, 'utf8'); } catch { return { skipped: true }; }
  if (!/countMeaningfulWizardSignals/.test(src)) {
    fail(
      'R_Phase0_resumeStrictGate',
      'snapshotContent.ts 에서 countMeaningfulWizardSignals(≥2 신호 게이트) 제거 — resume 단일신호 과노출 재발 (PR-D 회귀)',
      'export function countMeaningfulWizardSignals(...) + hasMeaningfulWizardContentStrict (>= 2) 유지.',
    );
  }
  return null;
}

/**
 * R_Phase1_testNoFirebaseClientImport (2026-06-01): 단위 테스트(tests/unit/*.test.ts(x))가
 * firebase 끌어오는 클라이언트 컴포넌트(TourDetailPage/TourBookingDialog/PayPalBookingButton/
 * lib/firebase)를 static/dynamic import 하면 CI(firebase 키 없음) getAuth() throw → "0 test" crash.
 * PR-B(#741)·PR-F(#746) 2회 재발 → 일반화. 순수함수는 firebase-free 모듈로 분리 후 그것만 import.
 */
function R_Phase1_testNoFirebaseClientImport(ctx) {
  const LADEN = ['pages/TourDetailPage', 'tours/TourBookingDialog', 'components/PayPalBookingButton', 'lib/firebase'];
  const tests = (ctx.changed || []).filter((c) => c.status !== 'D' && /tests\/unit\/.*\.test\.tsx?$/.test(c.file));
  const violations = [];
  for (const c of tests) {
    let src = '';
    try { src = readFileSync(c.file, 'utf8'); } catch { continue; }
    for (const mod of LADEN) {
      if (new RegExp(`from\\s+['"][^'"]*${mod}['"]|import\\(\\s*['"][^'"]*${mod}['"]`).test(src)) {
        violations.push(`${c.file}: firebase 의존 클라이언트 모듈(...${mod}) import → CI(firebase 키 없음) "0 test" crash (PR-B/PR-F 재발 class)`);
      }
    }
  }
  if (violations.length > 0) {
    fail(
      'R_Phase1_testNoFirebaseClientImport',
      violations.join(' | '),
      '순수함수는 firebase-free 모듈로 분리(buildTourJsonLd.ts / tourBookingValidation.ts 처럼) 후 테스트가 그 모듈만 import. 클라이언트 컴포넌트 직접 import 금지.',
    );
  }
  return null;
}

/**
 * R_PRE_activityBlockGate (2026-06-01, SAFETY): blockMode.js 트레킹/러닝 편입은
 * (1) isAllowedBlockType (블록 타입 게이트 — FEATURE_ACTIVITY_BLOCKS OFF=byte-identical 보장) +
 * (2) buildActivityMeta (트레킹 난이도/체력/hazards/unsuitable_for → day.activity_meta SAFETY 보존)
 * 둘 다 유지해야 함. 제거 시 플래그 우회 회귀 또는 SAFETY 표기 누락(외국인 사고 risk). PR-E(#748).
 */
function R_PRE_activityBlockGate(ctx) {
  const FILE = 'api/_ai_core/blockMode.js';
  if (!isModified(FILE, ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync(FILE, 'utf8'); } catch { return { skipped: true }; }
  const violations = [];
  if (!/isAllowedBlockType/.test(src)) {
    violations.push('isAllowedBlockType 게이트 제거 — block_type 필터가 FEATURE_ACTIVITY_BLOCKS 플래그 우회 (OFF=byte-identical 깨짐)');
  }
  if (!/buildActivityMeta/.test(src)) {
    violations.push('buildActivityMeta 제거 — 트레킹/러닝 day 의 난이도·체력·hazards·unsuitable_for(activity_meta) SAFETY 표기 누락 (외국인 사고 risk)');
  }
  if (violations.length > 0) {
    fail(
      'R_PRE_activityBlockGate',
      violations.join(' | '),
      'isAllowedBlockType(블록 게이트) + buildActivityMeta(활동 SAFETY 메타) 유지. tests/unit/activity-blocks-pre.test.ts.',
    );
  }
  return null;
}

/**
 * R_PRC2_charterCtaModules (2026-06-01): CharterCTA.tsx 의 일자별 차터 prefill 은 순수 모듈
 * buildCharterCTAUrl(../lib/charterCtaPrefill) 경유 의무. 하드코딩(origin:'SEL_METRO'/day_tour)으로
 * 회귀 시 부산/제주 plan 도 서울 차터 견적 (오견적). PR-C2(#750).
 */
function R_PRC2_charterCtaModules(ctx) {
  const FILE = 'src/pages/PlanDetailPage/components/CharterCTA.tsx';
  if (!isModified(FILE, ctx.changed)) return { skipped: true };
  let src = '';
  try { src = readFileSync(FILE, 'utf8'); } catch { return { skipped: true }; }
  const violations = [];
  if (!/buildCharterCTAUrl/.test(src)) {
    violations.push('buildCharterCTAUrl(charterCtaPrefill 순수 모듈) 미사용 — 차터 CTA prefill 하드코딩 회귀 → 부산/제주 plan 도 서울 견적 (PR-C2)');
  }
  if (/origin:\s*['"]SEL_METRO['"]/.test(src)) {
    violations.push("CharterCTA.tsx 에 origin:'SEL_METRO' 하드코딩 잔존 — charterCtaPrefill.ts 경유해야 함 (PR-C2)");
  }
  if (violations.length > 0) {
    fail(
      'R_PRC2_charterCtaModules',
      violations.join(' | '),
      'CharterCTA 는 buildCharterCTAUrl(../lib/charterCtaPrefill) 경유, 하드코딩 prefill 금지. tests/unit/charter-cta-realroute-prc2.test.ts.',
    );
  }
  return null;
}

/**
 * R_plan4d214e83_blockModeQuality (2026-06-02, 운영자 신고 "플랜 개판"): 다도시 block_mode plan
 * 품질 3종 fix 회귀 가드. ① planPersister.selfHealLodgingBookend 가 day.city 별 lodging
 * (isFirstCityDay 게이트) — 단일 trip-level zone 을 부산 day 에 쓰면 "부산인데 서울 명동역" 지리
 * 파탄. ② blockMode Day1 late-arrival cutoff (pastMidnight 자정 처리) — 밤 도착 새벽 일정 cascade
 * 차단. ③ matchFoodPlaceholder excludeNames(dedup) — 같은 식당 6회 반복 차단 + 다도시 P281
 * (bs.address 직할당 금지) — 식당명에 행정주소("서울특별시 종로구 가회동") 노출 차단.
 * 회귀 슬롯: tests/unit/plan-quality-4d214e83.test.ts + selfheal-lodging-multicity.test.ts.
 */
function R_plan4d214e83_blockModeQuality(ctx) {
  const violations = [];
  if (isModified('api/_ai_core/planPersister.js', ctx.changed)) {
    let src = ''; try { src = readFileSync('api/_ai_core/planPersister.js', 'utf8'); } catch {}
    if (/function selfHealLodgingBookend/.test(src) && !/isFirstCityDay/.test(src)) {
      violations.push('selfHealLodgingBookend 에 isFirstCityDay 게이트 누락 — 다도시 다른 도시 day 가 첫 도시 lodging 폴백 회귀 (부산인데 서울 명동역)');
    }
  }
  if (isModified('api/_ai_core/blockMode.js', ctx.changed)) {
    let src = ''; try { src = readFileSync('api/_ai_core/blockMode.js', 'utf8'); } catch {}
    if (src && !/pastMidnight/.test(src)) {
      violations.push('blockMode Day1 late-arrival cutoff(pastMidnight 자정 처리) 누락 — 밤 도착 새벽 일정 cascade 회귀 (plan 4d214e83)');
    }
    if (src && !/excludeNames/.test(src)) {
      violations.push('matchFoodPlaceholder excludeNames(dedup) 누락 — 같은 식당 반복 회귀 (홍대 깃뜰 6회)');
    }
    if (/^\s+resolvedName = bs\.address \|\| 'Local restaurant'/m.test(src)) {
      violations.push('다도시 expand 행정주소 직할당(bs.address) 잔존 — 식당명에 행정주소 노출 회귀 (P281 다도시 미적용)');
    }
    if (/matchFoodPlaceholder/.test(src) && /r\.type \|\| r\.category/.test(src) && !/r\.cuisine/.test(src)) {
      violations.push('matchFoodPlaceholder type 필터에 r.cuisine 폴백 누락 — food_index.json 은 cuisine 필드("Dessert"/"Cafe") → verified_cafe 전부 placeholder (plan 279c7ce0)');
    }
  }
  if (violations.length > 0) {
    fail(
      'R_plan4d214e83_blockModeQuality',
      violations.join(' | '),
      'plan 4d214e83 다도시 품질 fix 유지: selfHealLodgingBookend isFirstCityDay 게이트 + blockMode Day1 pastMidnight cutoff + matchFoodPlaceholder excludeNames dedup + 다도시 P281 placeholder text. tests/unit/plan-quality-4d214e83.test.ts.',
    );
  }
  return null;
}

/**
 * R_activityMetaDisplay (2026-06-02, SAFETY): 트레킹/러닝 day.activity_meta(난이도/위험/부적합)
 * 사용자 화면 노출 유지. backend buildActivityMeta 가 채우나 그동안 admin 패널(TrekkingMetaTab)에만
 * 있고 사용자 plan 화면 미렌더 + plan.ts 타입도 없었음. ActivityMetaChips(unsuitable_for 경고 배너 +
 * data-testid) + DayTimeline falsy guard(day.activity_meta &&, flag OFF byte-identical) 유지.
 * 회귀 슬롯: tests/unit/activity-meta-chips.component.test.tsx.
 */
function R_activityMetaDisplay(ctx) {
  const violations = [];
  if (isModified('src/pages/PlanDetailPage/components/ActivityMetaChips.tsx', ctx.changed)) {
    let src = ''; try { src = readFileSync('src/pages/PlanDetailPage/components/ActivityMetaChips.tsx', 'utf8'); } catch {}
    if (src && !/unsuitable_for/.test(src)) {
      violations.push('ActivityMetaChips 에 unsuitable_for(부적합 경고 배너) 누락 — SAFETY 노출 의무 (외국인 사고 예방)');
    }
    if (src && !/data-testid="activity-meta"/.test(src)) {
      violations.push('ActivityMetaChips data-testid="activity-meta" 누락 — 회귀 테스트 guard 깨짐');
    }
  }
  if (isModified('src/pages/PlanDetailPage/components/DayTimeline.tsx', ctx.changed)) {
    let src = ''; try { src = readFileSync('src/pages/PlanDetailPage/components/DayTimeline.tsx', 'utf8'); } catch {}
    if (/ActivityMetaChips/.test(src) && !/day\.activity_meta &&/.test(src)) {
      violations.push('DayTimeline ActivityMetaChips falsy guard(day.activity_meta &&) 누락 — flag OFF/city_day byte-identical 깨짐');
    }
  }
  if (violations.length > 0) {
    fail('R_activityMetaDisplay', violations.join(' | '), 'ActivityMetaChips(unsuitable_for 배너 + data-testid) + DayTimeline falsy guard 유지. tests/unit/activity-meta-chips.component.test.tsx.');
  }
  return null;
}

/**
 * R_airportPickupSSOT (2026-06-02): 공항픽업 가격 region→zone 매핑은 SSOT(pricing_spec.json
 * airport_transfer_regions) 단일 출처. RouteAgent.airportTransferPriceKRW 는 SSOT 조회 의무
 * (하드코딩 REGION_TO_AIRPORT_TRANSFER_ZONE 이원화 금지 — 운영자 2곳 수정 = 가격 불일치 위험).
 * 회귀 슬롯: tests/unit/airport-pickup-ssot.test.ts.
 */
function R_airportPickupSSOT(ctx) {
  const violations = [];
  if (isModified('api/_ai_core/agents/RouteAgent.js', ctx.changed)) {
    let src = ''; try { src = readFileSync('api/_ai_core/agents/RouteAgent.js', 'utf8'); } catch {}
    if (/function airportTransferPriceKRW/.test(src)) {
      if (/const REGION_TO_AIRPORT_TRANSFER_ZONE\s*=/.test(src)) {
        violations.push('RouteAgent REGION_TO_AIRPORT_TRANSFER_ZONE 하드코딩 잔존 — pricing_spec.json airport_transfer_regions SSOT 로 이동해야 (가격 매핑 이원화)');
      }
      if (!/airport_transfer_regions/.test(src)) {
        violations.push('airportTransferPriceKRW 가 airport_transfer_regions SSOT 미조회 — region→zone 매핑 이원화');
      }
    }
  }
  if (isModified('src/data/pricing_spec.json', ctx.changed)) {
    let src = ''; try { src = readFileSync('src/data/pricing_spec.json', 'utf8'); } catch {}
    if (/airport_transfer_prices/.test(src) && !/airport_transfer_regions/.test(src)) {
      violations.push('pricing_spec airport_transfer_regions 섹션 누락 — RouteAgent SSOT 조회 깨짐(HERO 가격 숨김)');
    }
  }
  if (violations.length > 0) {
    fail('R_airportPickupSSOT', violations.join(' | '), 'region→zone 매핑은 pricing_spec.json airport_transfer_regions SSOT, RouteAgent.airportTransferPriceKRW 가 조회. tests/unit/airport-pickup-ssot.test.ts.');
  }
  return null;
}

/**
 * P327_arexExpressHero — 메모리 P327 (2026-05-31, AREX 직통 HERO).
 * ICN→서울 중심부 + arex_express 추천 시 ODsay path[0](일반열차→홍대입구→2호선 79분 indirect)
 * 대신 직통 HERO 를 _buildArexExpressHero 로 합성. 회귀 위험: (1) rec.key 게이트 빠지면
 * heavy-luggage(charter)/late-night(limousine) 추천 덮어씀, (2) write 가 heroRoute 대신 route
 * 직접 쓰면 합성 무시, (3) fromStationName 미설정 시 P274 terminal mismatch false-positive.
 * 회귀 슬롯: tests/unit/arex-express-hero-p327.test.ts.
 */
function P327_arexExpressHero({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  // _buildArexExpressHero helper 가 있을 때만 검사 (없으면 P327 미적용 = 무관).
  if (!/_buildArexExpressHero/.test(content)) return null;
  const violations = [];
  if (!/rec\.key\s*===\s*['"]arex_express['"]/.test(content)) {
    violations.push(`${FILE}: AREX 직통 HERO 주입이 rec.key==='arex_express' 게이트 없이 적용 — heavy-luggage(charter)/late-night(limousine) 추천 덮어쓸 위험 (P327 회귀)`);
  }
  if (!/route_to_hotel\s*=\s*\{\s*\.\.\.heroRoute/.test(content)) {
    violations.push(`${FILE}: arrival_guide.route_to_hotel 가 heroRoute 아닌 route 직접 사용 — P327 직통 HERO 합성 결과 누락 (회귀)`);
  }
  if (!/fromStationName:\s*ax\.from_station/.test(content)) {
    violations.push(`${FILE}: _buildArexExpressHero 가 fromStationName=ax.from_station(공항 station) 미설정 — P274 terminal mismatch false-positive (회귀)`);
  }
  if (violations.length > 0) {
    fail(
      'P327_arexExpressHero',
      violations.join(' | '),
      '메모리 P327 — _buildArexExpressHero 직통 HERO 합성, rec.key==="arex_express" 게이트, heroRoute 로 write/P275, fromStationName=ax.from_station. tests/unit/arex-express-hero-p327.test.ts.',
    );
  }
  return null;
}

/**
 * P330_transitProviderSwitch — 메모리 P330 (2026-05-31, ODsay↔TMAP provider 스위치).
 * 운영자 의도: "전환 아직, 구현만 — 언제든 env 로 교체." 회귀 위험: (1) provider 기본값이
 * 'odsay' 아니면 prod 가 의도치 않게 TMAP 으로 ship, (2) 호출부가 _transit_provider.searchTransit
 * 대신 searchTransitRoute 직접 호출하면 스위치 우회. 회귀 슬롯: tests/unit/transit-provider-tmap-p330.test.ts.
 */
function P330_transitProviderSwitch({ changed }) {
  const PROVIDER = 'api/_transit_provider.js';
  const CALLERS = ['api/_ai_core/agents/RouteAgent.js', 'api/recalc-transit.js'];
  const violations = [];
  if (isModified(PROVIDER, changed)) {
    const c = getChangedFileContent(PROVIDER);
    if (c && !/TRANSIT_PROVIDER\s*\|\|\s*['"]odsay['"]/.test(c)) {
      violations.push(`${PROVIDER}: provider 기본값이 'odsay' 아님 — prod 가 의도치 않게 TMAP 으로 ship 될 위험 (P330: 기본 ODsay, 교체는 env TRANSIT_PROVIDER 로만)`);
    }
  }
  for (const FILE of CALLERS) {
    if (!isModified(FILE, changed)) continue;
    const c = getChangedFileContent(FILE);
    if (!c) continue;
    // provider 도입된 파일인데 searchTransitRoute 직접 호출 잔존 = 스위치 우회.
    if (/_transit_provider/.test(c) && /searchTransitRoute\s*\(/.test(c)) {
      violations.push(`${FILE}: provider 도입 후 searchTransitRoute 직접 호출 잔존 — _transit_provider.searchTransit 으로 통일 필요 (P330 스위치 우회)`);
    }
  }
  if (violations.length > 0) {
    fail(
      'P330_transitProviderSwitch',
      violations.join(' | '),
      '메모리 P330 — 대중교통 provider 스위치. 기본 odsay, 호출부는 _transit_provider.searchTransit, 교체는 TRANSIT_PROVIDER env 로만. tests/unit/transit-provider-tmap-p330.test.ts.',
    );
  }
  return null;
}

const RULES = [
  ['P326_cacheGeoValidation', P326_cacheGeoValidation],
  ['P326_intercityMergeBack', P326_intercityMergeBack],
  ['R_Plaunch_departureAirportDerive', R_Plaunch_departureAirportDerive],
  ['R_Phase0_flagStringCompare', R_Phase0_flagStringCompare],
  ['R_Phase0_jsonldTestNoFirebase', R_Phase0_jsonldTestNoFirebase],
  ['R_Phase0_charterPriceSSOT', R_Phase0_charterPriceSSOT],
  ['R_Phase0_resumeStrictGate', R_Phase0_resumeStrictGate],
  ['R_Phase1_testNoFirebaseClientImport', R_Phase1_testNoFirebaseClientImport],
  ['R_PRE_activityBlockGate', R_PRE_activityBlockGate],
  ['R_PRC2_charterCtaModules', R_PRC2_charterCtaModules],
  ['R_plan4d214e83_blockModeQuality', R_plan4d214e83_blockModeQuality],
  ['R_activityMetaDisplay', R_activityMetaDisplay],
  ['R_airportPickupSSOT', R_airportPickupSSOT],
  ['P327_arexExpressHero', P327_arexExpressHero],
  ['P330_transitProviderSwitch', P330_transitProviderSwitch],
  ['R_P321_blockModeRegionNormalize', R_P321_blockModeRegionNormalize],
  ['R_A1_7_2_runningRouteValidator', R_A1_7_2_runningRouteValidator],
  ['Z01_blockTypeMetaConsistency', Z01_blockTypeMetaConsistency],
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
  ['P102_adminBypassForceLegacy', P102_adminBypassForceLegacy],
  ['P107_aiTranslateReverseBackcompat', P107_aiTranslateReverseBackcompat],
  ['P108_slotCapacityPreLockTransaction', P108_slotCapacityPreLockTransaction],
  ['P109_resizeImagesVariantsFallback', P109_resizeImagesVariantsFallback],
  ['P110_adminClaimsRbacFoundation', P110_adminClaimsRbacFoundation],
  ['P111_intercityBookendSilentFailAlert', P111_intercityBookendSilentFailAlert],
  ['P112_endTimeBackfill', P112_endTimeBackfill],
  ['P113_intercityTimeStitch', P113_intercityTimeStitch],
  ['P114_dbMatcherPerDayCity', P114_dbMatcherPerDayCity],
  ['P115_planMarkdownFallback', P115_planMarkdownFallback],
  ['P116_lodgingBookendLabel', P116_lodgingBookendLabel],
  ['P118_prePushHookContent', P118_prePushHookContent],
  ['P119_dayLodgingBackfill', P119_dayLodgingBackfill],
  ['P120_unreasonableStopTimeDetect', P120_unreasonableStopTimeDetect],
  ['P121_qualityWarningsAdminPanel', P121_qualityWarningsAdminPanel],
  ['P122_multiCityLodgingPlaceholder', P122_multiCityLodgingPlaceholder],
  ['P123_hotelByCityForwarding', P123_hotelByCityForwarding],
  ['P124_arrivalDepartureSleepBuffer', P124_arrivalDepartureSleepBuffer],
  ['P125_multiCityArrivalDeparture', P125_multiCityArrivalDeparture],
  ['P126_wizardResumeContent', P126_wizardResumeContent],
  ['P127_lodgingBookendMultiCityAnchor', P127_lodgingBookendMultiCityAnchor],
  ['P128_blockModeIntegration', P128_blockModeIntegration],
  ['P129_aiPlannerFullDecomposeLock', P129_aiPlannerFullDecomposeLock],
  ['P130_intentClassifierMonitoring', P130_intentClassifierMonitoring],
  ['P132_prDescriptionImpactSections', P132_prDescriptionImpactSections],
  ['P133_catalogSync', P133_catalogSync],
  ['P138_routeEnrichPhase1Parallel', P138_routeEnrichPhase1Parallel],
  ['P139_airportBookendException', P139_airportBookendException],
  ['P140_perDayLodgingLabel', P140_perDayLodgingLabel],
  ['P141_lodgingBookendDedup', P141_lodgingBookendDedup],
  ['P142_arrivalDepartureTerminalSplit', P142_arrivalDepartureTerminalSplit],
  ['P143_intercityFirstStopGap', P143_intercityFirstStopGap],
  ['P144_transitFallbackDetail', P144_transitFallbackDetail],
  ['P145_cityChangeTimeClamp', P145_cityChangeTimeClamp],
  ['P164_geminiOutputTokenCap', P164_geminiOutputTokenCap],
  ['P165_aiPlannerMaxDurationCap', P165_aiPlannerMaxDurationCap],
  ['P166_systemPromptStaticPrefix', P166_systemPromptStaticPrefix],
  ['P167_blockModeMultiCitySupport', P167_blockModeMultiCitySupport],
  ['P168_pass3BackgroundAsync', P168_pass3BackgroundAsync],
  ['P169_geminiStreaming', P169_geminiStreaming],
  ['P170_backgroundPipelinesExtract', P170_backgroundPipelinesExtract],
  ['P171_adminBypassPropagation', P171_adminBypassPropagation],
  ['P172_flashPctBucketingPropagation', P172_flashPctBucketingPropagation],
  ['P174_validatePlannerSilentFail', P174_validatePlannerSilentFail],
  ['R_A1_7_3_stopsNested', R_A1_7_3_stopsNested],
  ['R_A1_7_3_slotsNumeric', R_A1_7_3_slotsNumeric],
  ['R_A1_7_3_meetingValidate', R_A1_7_3_meetingValidate],
  ['P175_dailyHealthLogPushSilent', P175_dailyHealthLogPushSilent],
  ['P177_adminDebugConditional', P177_adminDebugConditional],
  ['P180_foodCityEnforcement', P180_foodCityEnforcement],
  ['P179_finalSelfCheckSection', P179_finalSelfCheckSection],
  ['P181_invalidJsonZeroTolerance', P181_invalidJsonZeroTolerance],
  ['P183_dbMatcherCrossCityHardReject', P183_dbMatcherCrossCityHardReject],
  ['P184_odsayTransitCache', P184_odsayTransitCache],
  ['P183Phase2_geminiResponseSchema', P183Phase2_geminiResponseSchema],
  ['P185_responseSchemaArrayItems', P185_responseSchemaArrayItems],
  ['P186_streamingDebugInvisible', P186_streamingDebugInvisible],
  ['P187_playwrightCacheHitBinaryMissing', P187_playwrightCacheHitBinaryMissing],
  ['P188_cityMapDeadFallback', P188_cityMapDeadFallback],
  ['P189_allergenSchemaSafety', P189_allergenSchemaSafety],
  ['P190_attractionsHelperUsage', P190_attractionsHelperUsage],
  ['P191_mountainHelperSafety', P191_mountainHelperSafety],
  ['P192_geminiThinkingOutputConflict', P192_geminiThinkingOutputConflict],
  ['P193_pdfRecommendedRestaurantsSafety', P193_pdfRecommendedRestaurantsSafety],
  ['P194_buildPromptSize', P194_buildPromptSize],
  ['P195_cacheInstrumentation', P195_cacheInstrumentation],
  ['P266_cacheMetadataPersist', P266_cacheMetadataPersist],
  ['P267_streamingChunkUsageMetadataFallback', P267_streamingChunkUsageMetadataFallback],
  ['P268_debugInfoNoCachePop', P268_debugInfoNoCachePop],
  ['P273_userMessageCachePrefixOrder', P273_userMessageCachePrefixOrder],
  ['P274_airportTerminalConsistency', P274_airportTerminalConsistency],
  ['P275_airportStationMismatch', P275_airportStationMismatch],
  ['P276_arrivalGuideRequired', P276_arrivalGuideRequired],
  ['P278_blockModeCacheMetadata', P278_blockModeCacheMetadata],
  ['P279_vercelLogsNdjson', P279_vercelLogsNdjson],
  ['P280_dietaryCoverage', P280_dietaryCoverage],
  ['P281_blockModePlaceholderName', P281_blockModePlaceholderName],
  ['P282_nicheStyleCityMismatch', P282_nicheStyleCityMismatch],
  ['P283_lodgingZoneMultiDay', P283_lodgingZoneMultiDay],
  ['P284_hotelAddressSingleCity', P284_hotelAddressSingleCity],
  ['P285_bdcSoftLog', P285_bdcSoftLog],
  ['P286_arrivalWrapEdge', P286_arrivalWrapEdge],
  ['P290_selfHealLodgingBookendPersonalize', P290_selfHealLodgingBookendPersonalize],
  ['P291_responseSchemaHintFull', P291_responseSchemaHintFull],
  ['P292_planStreamingSweepCron', P292_planStreamingSweepCron],
  ['P297_crossCityLodgingPersonalize', P297_crossCityLodgingPersonalize],
  ['P298_dietaryAllergiesMerge', P298_dietaryAllergiesMerge],
  ['P300_dailyBudgetFieldUnify', P300_dailyBudgetFieldUnify],
  ['P200_schemaPropertyOrdering', P200_schemaPropertyOrdering],
  ['P203_routeEnrichTimeout', P203_routeEnrichTimeout],
  ['P202_lodgingCityConsistency', P202_lodgingCityConsistency],
  ['P201_proEscalate', P201_proEscalate],
  ['P204_streamingPartialNoRepair', P204_streamingPartialNoRepair],
  ['P205_airportNestedSelfHeal', P205_airportNestedSelfHeal],
  ['P207_pdfEmptyPlanGuard', P207_pdfEmptyPlanGuard],
  ['P206_measureStatusReadyPolling', P206_measureStatusReadyPolling],
  ['P210B_inspectStatusField', P210B_inspectStatusField],
  ['P208_notoSansKrBundle', P208_notoSansKrBundle],
  ['P210A_schemaAirportHint', P210A_schemaAirportHint],
  ['P209_serverPdfArrivalDeparture', P209_serverPdfArrivalDeparture],
  ['P214_flashTruncationMitigation', P214_flashTruncationMitigation],
  ['P215_finishReasonDetect', P215_finishReasonDetect],
  ['P219_thoughtPartFilter', P219_thoughtPartFilter],
  ['R_PlanDetailVisual', R_PlanDetailVisual],
  ['P228_transitCacheIntegrity', P228_transitCacheIntegrity],
  ['P231_skeletonInWorkerGuard', P231_skeletonInWorkerGuard],
  ['P234_odsayDirectCallGuard', P234_odsayDirectCallGuard],
  ['P235_firestoreErrorDistinction', checkP235FirestoreErrorDistinction],
  ['P237_runningHelperIntegrity', P237_runningHelperIntegrity],
  ['P239_tourStartTimeFallback', P239_tourStartTimeFallback],
  ['P240_blockModeAllergenSafety', P240_blockModeAllergenSafety],
  ['P245_blockModeTourStartTime', P245_blockModeTourStartTime],
  ['P241_activityHelperIntegrity', P241_activityHelperIntegrity],
  ['P246_dmzCityMismatchGuard', P246_dmzCityMismatchGuard],
  ['P248_haenyeoCityMismatchGuard', P248_haenyeoCityMismatchGuard],
  ['R_P244_playwrightPageReadySignal', R_P244_playwrightPageReadySignal],
  ['P243_zoneBlockStyleCoverage', P243_zoneBlockStyleCoverage],
];

// ----------------------------------------------------------------------------
// P210B_inspectStatusField — inspect-plans.mjs 에 status + _streaming_in_progress 출력 의무
//
// 5/26 sample 5 (eaccffbd, days=0 hang) 에서 inspect script 가 status / streaming flag
// 출력 안 해 → skeleton stuck vs Gemini 완전 실패 판별 불가.
// generic inspect-plans.mjs 에 extractStatusFields helper + 종합 통계 출력 의무.
//
// 룰:
//   1. scripts/inspect-plans.mjs 가 존재해야 함.
//   2. extractStatusFields 함수가 정의되어 있어야 함.
//   3. status + _streaming_in_progress 출력 라인이 있어야 함.
//   4. 종합 통계에 streaming/ready 분리 출력이 있어야 함.
// ----------------------------------------------------------------------------
function P210B_inspectStatusField({ changed }) {
  const SCRIPT = 'scripts/inspect-plans.mjs';
  if (!isModified(SCRIPT, changed)) return { skipped: true };

  const src = readFileExists(SCRIPT) || '';
  const issues = [];

  if (!/export function extractStatusFields/.test(src)) {
    issues.push('extractStatusFields 함수 누락 — Firestore REST 응답 파싱 helper 없음');
  }
  if (!/status.*streamingInProgress|status.*_streaming_in_progress/.test(src)) {
    issues.push('status + _streaming_in_progress 출력 라인 누락 — skeleton stuck 판별 불가');
  }
  if (!/streaming 진행 중|streamingCount/.test(src)) {
    issues.push('종합 통계 streaming/ready 분리 출력 누락 — 5 sample 집계 불완전');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P210B_inspectStatusField',
    severity: 'error',
    file: SCRIPT,
    message:
      'R-P210B: inspect-plans.mjs 에 status + _streaming_in_progress 출력 의무 — ' +
      'sample 5 (eaccffbd, days=0 hang) 같은 skeleton stuck plan 즉시 판별 필수. ' +
      '발견: ' + issues.join(', '),
  };
}

/**
 * P167_blockModeMultiCitySupport — 메모리 P167 (2026-05-23).
 * blockMode.js 의 `multi_city_not_supported` 분기가 재도입되면 운영자 PR #514/#518
 * zone block 18+ 가 다도시 plan 에서 무시 → legacy 3-pass 폴백 4분 30초 회귀.
 *
 * 룰:
 *   1. blockMode.js 에 `'multi_city_not_supported'` literal 이 등장하면 fail.
 *   2. tryRunBlockMode 에서 `return { skipped: true, reason: 'multi_city_not_supported' }`
 *      또는 이와 동등한 분기가 있으면 fail.
 *
 * 트리거: api/_ai_core/blockMode.js 변경 시.
 */
function P167_blockModeMultiCitySupport({ changed }) {
  const FILE = 'api/_ai_core/blockMode.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  // P167 회귀 패턴: multi_city_not_supported reason 재도입
  if (/['"]multi_city_not_supported['"]/.test(content)) {
    fail(
      'P167_blockModeMultiCitySupport',
      `${FILE}: 'multi_city_not_supported' reason 재도입 감지 — P167 회귀. ` +
      '운영자 PR #514/#518 의 zone block 18+ 가 다도시 plan 에서 무시됨.',
      'P167 fix: tryRunBlockMode 는 regions.length >= 2 시 runBlockModeMultiCity 를 호출해야 함. ' +
      'multi_city_not_supported skip 분기 금지.',
    );
    return null;
  }

  return null;
}

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

    // P129 (2026-05-21): ai-planner-full.js 는 thin re-export wrapper —
    // withStep/hangWarn 본체는 api/_ai_core/handlerCore.js. wrapper 가
    // export { default } from './_ai_core/handlerCore.js' 패턴이면
    // handlerCore content 도 검사 대상에 합산.
    let searchContent = content;
    const reexportMatch = content.match(/export\s+\{\s*default\s*\}\s+from\s+['"]([^'"]+)['"]/);
    if (reexportMatch) {
      const reexportPath = reexportMatch[1];
      // api/ai-planner-full.js → './_ai_core/handlerCore.js' resolve.
      const dir = path.dirname(file);
      const resolved = path.posix.join(dir, reexportPath).replace(/\\/g, '/');
      if (existsSync(resolved)) {
        searchContent = content + '\n' + readFileSync(resolved, 'utf8');
      }
    }

    const hasWithStep = /async\s+function\s+withStep\s*\(\s*\w+\s*,\s*\w+\s*\)/.test(searchContent);
    const hasHangAlert =
      /HANG_WARN_MS|hangWarnTimer/.test(searchContent) ||
      /setTimeout\([\s\S]{0,300}throttledTelegramAlert/.test(searchContent);

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
 * P102_adminBypassForceLegacy — 메모리 P102 (2026-05-20, no-PR-yet).
 *
 * Test Mode 5분 timeout 인시던트:
 *   1. Vercel prod PLANNER_MODE env 가 "﻿3pass\r\n" (BOM + literal CRLF) 으로
 *      설정됨 (29일 전 운영자 토글). .trim() 가 ES WhiteSpace 규격에 따라 BOM/
 *      CRLF 제거 → "3pass" 매칭 → 모든 요청 3-pass 파이프라인.
 *   2. 3-pass = Pass1 (gemini ~30s) + Pass2 (DB resolve) + Pass3 (gemini enrich
 *      ~30s) + validate retry → 90~150s + 재시도 시 5분 Vercel cap 도달.
 *   3. handlePaymentSuccess 의 client AbortController timeout=300s 와 maxDuration
 *      =300 이 동일 → 서버 cap 직전 응답해도 client 가 거의 동시에 abort.
 *
 * 회귀 차단:
 *   - api/_ai_core/plannerMode.js: decidePlannerMode 가 isAdminBypass 파라미터
 *     를 첫 precedence 로 처리 (admin-bypass-force-legacy reason).
 *   - api/ai-planner-full.js: decidePlannerMode 호출 시 isAdminBypass 전달.
 *
 * 회귀 슬롯: tests/unit/planner-ab-mode.test.ts ('P102 — isAdminBypass forces
 * legacy' describe 블록 6 케이스).
 */
function P102_adminBypassForceLegacy({ changed }) {
  const violations = [];

  const PM_FILE = 'api/_ai_core/plannerMode.js';
  if (isModified(PM_FILE, changed)) {
    const content = getChangedFileContent(PM_FILE);
    if (content) {
      if (!/isAdminBypass/.test(content)) {
        violations.push(`${PM_FILE}: decidePlannerMode 가 isAdminBypass 파라미터 미수용 — 3-pass A/B override 면역 깨짐`);
      }
      if (!/admin-bypass-force-legacy/.test(content)) {
        violations.push(`${PM_FILE}: reason 'admin-bypass-force-legacy' 누락 — 트레이스/로그에서 식별 불가`);
      }
      // Precedence 0 위치 확인 — env override 체크보다 먼저 isAdminBypass 처리.
      const adminIdx = content.indexOf("admin-bypass-force-legacy");
      const envOverrideIdx = content.indexOf("env-override-3pass");
      if (adminIdx > -1 && envOverrideIdx > -1 && adminIdx > envOverrideIdx) {
        violations.push(`${PM_FILE}: isAdminBypass 분기가 env-override-3pass 보다 뒤에 위치 — Precedence 0 (admin 최우선) 위반`);
      }
    }
  }

  // P129 (2026-05-21): ai-planner-full.js 분해 — handler 본체는 handlerCore.js.
  // 두 파일 중 어디든 변경되면 검사. content 도 양쪽 concat 으로 살핌.
  const PLANNER_FILE = 'api/ai-planner-full.js';
  const HANDLER_CORE = 'api/_ai_core/handlerCore.js';
  if (isModified(PLANNER_FILE, changed) || isModified(HANDLER_CORE, changed)) {
    const a = existsSync(PLANNER_FILE) ? readFileSync(PLANNER_FILE, 'utf8') : '';
    const b = existsSync(HANDLER_CORE) ? readFileSync(HANDLER_CORE, 'utf8') : '';
    const content = a + '\n' + b;
    if (content) {
      // decidePlannerMode 호출 블록에 isAdminBypass 인자 포함 필수.
      const callMatch = content.match(/decidePlannerMode\s*\(\s*\{[\s\S]{0,400}?\}\s*\)/);
      if (callMatch && !/isAdminBypass\s*:/.test(callMatch[0])) {
        violations.push(`${PLANNER_FILE}/${HANDLER_CORE}: decidePlannerMode 호출에 isAdminBypass 인자 누락 — gate.isAdminBypass 가 mode 결정에 반영 안 됨 → admin Test Mode 가 3-pass 로 빠져 5분 cap 회귀`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P102_adminBypassForceLegacy',
      violations.join(' | '),
      '메모리 P102 — admin Test Mode (ADMIN-BYPASS-*) 은 decidePlannerMode Precedence 0 으로 항상 legacy. tests/unit/planner-ab-mode.test.ts 의 P102 describe 블록 참조.',
    );
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
 * P109_resizeImagesVariantsFallback — 메모리 P109 (2026-05-20, no-PR-yet).
 *
 * Firebase Extension storage-resize-images 통합 — TourPhoto.variants 키
 * (`'400' | '800' | '1600'`) + resolvePhotoUrl(photo, preferredWidth?) 시그니처
 * + buildPhotoSrcSet helper 회귀 차단. Extension 미설치 환경 자동 폴백 보장.
 *
 * 회귀 슬롯: tests/unit/resolve-photo-url.test.ts (17 케이스 — 4 backward
 * compat + 7 P109 새 동작 + 6 srcset builder).
 */
function P109_resizeImagesVariantsFallback({ changed }) {
  const violations = [];

  const TYPES = 'src/data/tours.ts';
  if (isModified(TYPES, changed)) {
    const content = getChangedFileContent(TYPES);
    if (content && /export\s+type\s+TourPhoto\s*=/.test(content)) {
      // variants 필드 정의 — Extension 출력과 정확히 매칭되는 키.
      const photoBlock = content.match(/export\s+type\s+TourPhoto\s*=\s*\{[\s\S]+?\n\};/);
      if (photoBlock && !/variants\?:/.test(photoBlock[0])) {
        violations.push(`${TYPES}: TourPhoto.variants 필드 누락 — Extension URL 매칭 불가 → 모바일 LCP 회귀`);
      }
      if (photoBlock) {
        // 3 canonical width 모두 schema 에 있어야 함.
        for (const w of ['400', '800', '1600']) {
          if (!new RegExp(`'${w}'\\?:`).test(photoBlock[0])) {
            violations.push(`${TYPES}: TourPhoto.variants.'${w}' 키 누락 — Extension 이 그 사이즈로 생성한 파일 사용 불가`);
          }
        }
      }
    }
  }

  const LIB = 'src/lib/tours-firestore.ts';
  if (isModified(LIB, changed)) {
    const content = getChangedFileContent(LIB);
    if (content) {
      // resolvePhotoUrl 가 preferredWidth 인자 받는 시그니처 + variants 매칭 분기.
      if (!/resolvePhotoUrl\s*\([\s\S]{0,300}preferredWidth\?:/.test(content)) {
        violations.push(`${LIB}: resolvePhotoUrl 시그니처에 preferredWidth 인자 누락 — srcset 분기 불가`);
      }
      if (!/photo\.variants\?\.\[preferredWidth\]/.test(content)) {
        violations.push(`${LIB}: resolvePhotoUrl 안에 variants[preferredWidth] 매칭 분기 누락 — 항상 원본 url 사용 → resize 효과 없음`);
      }
      if (!/export\s+function\s+buildPhotoSrcSet/.test(content)) {
        violations.push(`${LIB}: buildPhotoSrcSet helper 누락 — <img srcSet> attribute 빌더 부재 → 컴포넌트마다 ad-hoc 재구현`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P109_resizeImagesVariantsFallback',
      violations.join(' | '),
      '메모리 P109 — TourPhoto.variants 키 = Extension 출력 사이즈 (400/800/1600). resolvePhotoUrl(photo, w?) 폴백 chain + buildPhotoSrcSet builder. docs/RESIZE-IMAGES-SETUP.md 운영자 액션 참조.',
    );
  }
  return null;
}

/**
 * P110_adminClaimsRbacFoundation — 메모리 P110 (2026-05-20, no-PR-yet).
 *
 * 하드코드 admin email → Firebase custom claims RBAC 마이그 Phase 1 (Foundation).
 * verifyAdminToken 가 email OR admin claim 양쪽 허용 + role 정규화 export +
 * super-admin self-lockout 방지.
 *
 * 회귀 차단:
 *   - api/_shared/admin-auth.js: extractRoles + requireRole 정규화 함수 유지.
 *     verifyAdminToken 반환값에 claims/roles 노출.
 *   - api/admin-set-claims.js: super-admin role 검증 + 5 canonical role
 *     whitelist (sanitizeRoles) + self-lockout 보호.
 *
 * 회귀 슬롯: tests/unit/admin-set-claims-roles.test.ts (14 케이스).
 */
function P110_adminClaimsRbacFoundation({ changed }) {
  const violations = [];

  const AUTH = 'api/_shared/admin-auth.js';
  if (isModified(AUTH, changed)) {
    const content = getChangedFileContent(AUTH);
    if (content) {
      if (!/export\s+function\s+extractRoles/.test(content)) {
        violations.push(`${AUTH}: extractRoles 미export — token roles 정규화 helper 누락`);
      }
      if (!/export\s+function\s+requireRole/.test(content)) {
        violations.push(`${AUTH}: requireRole 미export — caller 가 role 검증 불가 → set-claims endpoint 우회 가능`);
      }
      if (!/decoded\.admin\s*===\s*true/.test(content)) {
        violations.push(`${AUTH}: admin claim 검증 (decoded.admin === true) 누락 — RBAC 마이그 효과 0`);
      }
      // self-lockout 방지를 위해 caller 의 roles 가 응답에 포함돼야 함.
      if (!/roles\s*,?\s*\}\s*;/.test(content) && !/return\s*\{[\s\S]{0,300}roles[\s\S]{0,200}\}/m.test(content)) {
        violations.push(`${AUTH}: verifyAdminToken 반환값에 roles 미포함 — caller 가 role 검증 불가`);
      }
    }
  }

  const SET_CLAIMS = 'api/admin-set-claims.js';
  if (isModified(SET_CLAIMS, changed)) {
    const content = getChangedFileContent(SET_CLAIMS);
    if (content) {
      // super-admin 보유자만 호출 가능해야 함.
      if (!/requireRole\s*\([^)]+,\s*['"]super-admin['"]\s*\)/.test(content)) {
        violations.push(`${SET_CLAIMS}: requireRole('super-admin') 검증 누락 — 모든 admin 이 임의 권한 부여 가능 → 권한 escalation`);
      }
      // self-lockout 방지 분기.
      if (!/SELF_LOCKOUT_BLOCKED/.test(content)) {
        violations.push(`${SET_CLAIMS}: self-lockout 방지 분기 누락 — super-admin 본인이 자신의 role 회수 가능 → 영구 잠김`);
      }
      // whitelist sanitization.
      if (!/sanitizeRoles\s*\(/.test(content)) {
        violations.push(`${SET_CLAIMS}: sanitizeRoles 호출 누락 — 'ghost-role' 같은 임의값 token 에 박힘 → schema drift`);
      }
      // Audit log.
      if (!/admin_actions/.test(content)) {
        violations.push(`${SET_CLAIMS}: admin_actions audit log 누락 — 권한 부여 추적 불가 → 감사 책임 회피`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P110_adminClaimsRbacFoundation',
      violations.join(' | '),
      '메모리 P110 — RBAC Phase 1. verifyAdminToken 의 email OR admin claim 양쪽 통과 + super-admin 자가 lockout 방지 + 5 role whitelist. tests/unit/admin-set-claims-roles.test.ts 14 케이스 참조. 운영자 액션: node scripts/grant-super-admin.mjs <email>.',
    );
  }
  return null;
}



/**
 * P111_intercityBookendSilentFailAlert — 메모리 P111 (2026-05-20, no-PR-yet).
 *
 * RouteAgent.js Phase 2.4 (city-change day intercity bookend) 의 silent fail
 * 분기에 throttledTelegramAlert 의무. lookupStationCoord null / prevDayHotelCoord
 * null / dayHotel coord null / ODsay throw 4 케이스가 console.warn 만 하고 끝나면
 * 운영자가 Vercel logs 폴링 없이 인지 불가. 사용자 보고 패턴: "서울→부산 KTX
 * 가이드 없음, 그냥 부산 나옴".
 *
 * 회귀 슬롯: tests/unit/intercity-bookend-silent-fail-pr111.test.ts (10 케이스).
 */
function P111_intercityBookendSilentFailAlert({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/from\s*['"]\.\.\/\.\.\/_shared\/telegram-throttle\.js['"]/.test(content)) {
    violations.push(`${FILE}: telegram-throttle import 누락 — P111 silent fail alert 불가`);
  }
  if (!/const\s+bookendFailReasons\s*=\s*\[\]/.test(content)) {
    violations.push(`${FILE}: bookendFailReasons accumulator 누락 — 4 silent-fail 분기 reason 수집 불가`);
  }
  // Phase 2.4a (pre) 4 reasons
  const preReasons = [
    'pre:from_station_missing',
    'pre:prev_hotel_coord_missing',
    'pre:station_coord_missing',
    'pre:odsay_throw',
  ];
  for (const r of preReasons) {
    if (!content.includes(r)) {
      violations.push(`${FILE}: '${r}' reason push 누락 — 해당 silent-fail 케이스 운영자 인지 불가`);
    }
  }
  // Phase 2.4b (post) 4 reasons
  const postReasons = [
    'post:to_station_missing',
    'post:day_hotel_coord_missing',
    'post:station_coord_missing',
    'post:odsay_throw',
  ];
  for (const r of postReasons) {
    if (!content.includes(r)) {
      violations.push(`${FILE}: '${r}' reason push 누락 — 해당 silent-fail 케이스 운영자 인지 불가`);
    }
  }
  // Alert call guard + key pattern
  if (!/if\s*\(\s*bookendFailReasons\.length\s*>\s*0\s*\)\s*\{[\s\S]{0,3000}?throttledTelegramAlert\s*\(/.test(content)) {
    violations.push(`${FILE}: bookendFailReasons.length>0 가드 + throttledTelegramAlert 호출 누락`);
  }
  if (!/key:\s*`intercity-bookend-fail:\$\{firstReason\}:\$\{fromTo\}`/.test(content)) {
    violations.push(`${FILE}: alert key 'intercity-bookend-fail:\${firstReason}:\${fromTo}' 패턴 누락 — dedup 깨짐`);
  }
  // Non-blocking dispatch
  if (!/throttledTelegramAlert\(\{[\s\S]+?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(content)) {
    violations.push(`${FILE}: alert .catch(() => {}) 누락 — alert 실패가 plan 생성 break 가능`);
  }

  if (violations.length > 0) {
    fail(
      'P111_intercityBookendSilentFailAlert',
      violations.join(' | '),
      '메모리 P111 — Phase 2.4 의 8 silent-fail 분기 (pre/post 각 4) 모두 reason push + bookendFailReasons.length>0 시 throttledTelegramAlert (admin/high/dedup by first reason + city pair). tests/unit/intercity-bookend-silent-fail-pr111.test.ts 10 케이스 참조.',
    );
  }
  return null;
}

/**
 * P112_endTimeBackfill — 메모리 P112 (2026-05-20, no-PR-yet).
 *
 * planPersister.js 가 stop.end_time 누락 backfill 안 하면 UI/PDF/email/voucher
 * 가 "15:45-undefined" 류 표시. Gemini/RouteAgent 가 일부만 채우는 비결정성
 * 대비 안전망. ai-planner-full.js 가 calculateTmoney 전에 backfillStopEndTimes
 * 호출 필수.
 *
 * 회귀 슬롯: tests/unit/end-time-backfill-pr112.test.ts (27 케이스).
 */
function P112_endTimeBackfill({ changed }) {
  const violations = [];

  const PERSIST = 'api/_ai_core/planPersister.js';
  if (isModified(PERSIST, changed)) {
    const content = getChangedFileContent(PERSIST);
    if (content) {
      if (!/export\s+function\s+computeEndTime\s*\(/.test(content)) {
        violations.push(`${PERSIST}: computeEndTime 미export — pure helper 누락 → 다른 호출자가 ad-hoc 재구현 위험`);
      }
      if (!/export\s+function\s+backfillStopEndTimes\s*\(/.test(content)) {
        violations.push(`${PERSIST}: backfillStopEndTimes 미export — itinerary mutator helper 누락`);
      }
      // null/undefined explicit reject (Number(null)===0 bypass 차단)
      if (!/stayMin\s*===\s*null\s*\|\|\s*stayMin\s*===\s*undefined/.test(content)) {
        violations.push(`${PERSIST}: computeEndTime null/undefined 명시 거부 분기 누락 — Number(null)=0 통과로 잘못된 end_time 생성`);
      }
      // override-protection check (existing end_time preserved)
      if (!/if\s*\(\s*stop\.end_time\s*&&\s*\/\^\\d/.test(content)) {
        violations.push(`${PERSIST}: backfillStopEndTimes 가 기존 end_time 보존 분기 누락 — Gemini/RouteAgent stitched 결과 override 위험`);
      }
    }
  }

  // P129 (2026-05-21): ai-planner-full.js → handlerCore.js + postResponsePipeline.js
  // 분해. backfillStopEndTimes 호출은 postResponsePipeline.js 의
  // applyBackfillsAndTmoney() 안 — 두 파일 중 어디든 import + 호출 보이면 OK.
  const HANDLER = 'api/ai-planner-full.js';
  if (isPlannerFamilyModified(changed)) {
    const content = getPlannerFamilyContent();
    if (content && /backfillStopEndTimes/.test(content)) {
      // import 와 호출 둘 다 (postResponsePipeline.js 의 import path 는 './planPersister.js').
      if (!/import[^;]*backfillStopEndTimes[^;]*from\s*['"]\.[^'"]*planPersister\.js['"]/.test(content)) {
        violations.push(`${HANDLER}/family: backfillStopEndTimes import 누락 — 호출은 있는데 import 안 함 → ReferenceError`);
      }
      if (!/backfillStopEndTimes\s*\(\s*itinerary\s*\)/.test(content)) {
        violations.push(`${HANDLER}/family: backfillStopEndTimes(itinerary) 호출 누락 — helper 만 import 하고 안 쓰면 의미 없음`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P112_endTimeBackfill',
      violations.join(' | '),
      '메모리 P112 — planPersister 의 computeEndTime + backfillStopEndTimes pair + null/undefined reject + override-protection. ai-planner-full handler 가 calculateTmoney 전에 호출. tests/unit/end-time-backfill-pr112.test.ts 27 케이스 참조.',
    );
  }
  return null;
}

/**
 * P113_intercityTimeStitch — 메모리 P113 (2026-05-20, no-PR-yet).
 *
 * RouteAgent.js Phase 2.4 가 lodging_to_station 채운 직후 intercity_transit.
 * recommended_depart + arrival_at 를 stop1.start_time + lodging_to_station.est_min
 * 기준으로 stitch. Gemini 의 임의 09:00 값 vs 실제 호텔 체크아웃 시간 모순
 * 차단. 사용자 보고 패턴: "호텔 12:25 출발인데 KTX 09:00 어떻게 타나?".
 *
 * 회귀 슬롯: tests/unit/intercity-time-stitch-pr113.test.ts (5 케이스).
 */
function P113_intercityTimeStitch({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // P113 guard: lodging_to_station 존재 + stop1 start_time 존재 확인 후만 stitch.
  if (!/it\.lodging_to_station\s*&&\s*Number\.isFinite\(it\.lodging_to_station\.est_min\)/.test(content)) {
    violations.push(`${FILE}: P113 stitching 의 lodging_to_station presence guard 누락 — Phase 2.4 silent fail 시 잘못된 stitching 위험`);
  }
  // recommended_depart override + arrival_at stitch
  if (!/it\.recommended_depart\s*=\s*formattedDepart/.test(content)) {
    violations.push(`${FILE}: recommended_depart override 누락 — Gemini 의 임의 09:00 값 그대로 → 모순 시각 유지`);
  }
  if (!/it\.arrival_at\s*=\s*formattedArrival/.test(content)) {
    violations.push(`${FILE}: arrival_at stitch 누락 — depart 만 update 하면 KTX 도착 시간 inconsistent`);
  }
  // Audit log
  if (!/intercity recommended_depart.*stitched stop1=/.test(content)) {
    violations.push(`${FILE}: stitch console.log 누락 — prod 검증 어려움 (어느 plan 이 stitch 됐는지 추적 불가)`);
  }

  if (violations.length > 0) {
    fail(
      'P113_intercityTimeStitch',
      violations.join(' | '),
      '메모리 P113 — Phase 2.4 가 lodging_to_station 채운 직후 recommended_depart + arrival_at stitching 의무. tests/unit/intercity-time-stitch-pr113.test.ts 5 케이스. P111 silent fail 시 Gemini 값 그대로 보존 (안전 default).',
    );
  }
  return null;
}

/**
 * P114_dbMatcherPerDayCity — 메모리 P114 (2026-05-20, no-PR-yet).
 *
 * applyDBMatcher 가 trip-level area 만 받으면 multi-city plan 의 다른 city day
 * 식당이 silent 잘못된 도시 foodIndex 와 매칭. plan 4792076e 의 부산 day "자갈치
 * 시장" 이 Seoul "자갈치" (종로구 익선동) 에 매칭되어 사용자가 부산 plan 보면서
 * 서울 주소 안내받는 회귀.
 *
 * Fix: day 단위 iterate + dayMatchCity 헬퍼로 각 stop 의 matchCity 결정 (day.city
 * 우선, 없으면 trip-level area 폴백).
 *
 * 회귀 슬롯: tests/unit/dbmatcher-per-day-city-pr114.test.ts (9 케이스).
 */
function P114_dbMatcherPerDayCity({ changed }) {
  const FILE = 'api/_ai_core/dbMatcher.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  if (!/function\s+dayMatchCity\s*\(/.test(content)) {
    violations.push(`${FILE}: dayMatchCity 헬퍼 미선언 — per-day matchCity 결정 불가`);
  }
  if (!/const\s+tripMatchCity\s*=/.test(content)) {
    violations.push(`${FILE}: tripMatchCity (trip-level area 정규화) 미선언 — alert 용 fallback 깨짐`);
  }
  if (!/for\s*\(\s*const\s+day\s+of\s*\(itinerary\.days\s*\|\|\s*\[\]\)\s*\)/.test(content)) {
    violations.push(`${FILE}: day 단위 iterate 안 함 — 평탄화 (flatMap) 로 인한 day.city 손실`);
  }
  if (!/return\s+dayCity\s*\|\|\s*tripMatchCity/.test(content)) {
    violations.push(`${FILE}: dayMatchCity 의 day.city → tripMatchCity 폴백 누락`);
  }

  if (violations.length > 0) {
    fail(
      'P114_dbMatcherPerDayCity',
      violations.join(' | '),
      '메모리 P114 — applyDBMatcher 가 day 단위 iterate + dayMatchCity 헬퍼로 per-day matchCity 적용. multi-city plan 의 도시별 식당 매칭 정확도 보장. tests/unit/dbmatcher-per-day-city-pr114.test.ts 9 케이스 참조.',
    );
  }
  return null;
}

/**
 * P115_planMarkdownFallback — 메모리 P115 (2026-05-20, no-PR-yet).
 *
 * PDF 깨질 때 Markdown fallback. planToMarkdown + downloadPlanAsMarkdown helper
 * + OutroSlide 의 "텍스트로 다운로드" 버튼 + intercity bookend (P111) 표시 의무.
 * 사용자가 메모장/Notion/Apple Notes 등 어디서나 열 수 있는 텍스트 파일.
 *
 * 회귀 슬롯: tests/unit/plan-to-markdown-pr115.test.ts (12 케이스).
 */
function P115_planMarkdownFallback({ changed }) {
  const violations = [];

  const LIB = 'src/pages/PlanDetailPage/lib/planToMarkdown.ts';
  if (isModified(LIB, changed)) {
    const content = getChangedFileContent(LIB);
    if (content) {
      if (!/export\s+function\s+planToMarkdown/.test(content)) {
        violations.push(`${LIB}: planToMarkdown 미export — pure helper 누락`);
      }
      if (!/export\s+function\s+downloadPlanAsMarkdown/.test(content)) {
        violations.push(`${LIB}: downloadPlanAsMarkdown 미export — 브라우저 download 헬퍼 누락`);
      }
      // intercity bookend (P111 enrichment) 표시 의무
      if (!/lodging_to_station/.test(content) || !/station_to_lodging/.test(content)) {
        violations.push(`${LIB}: intercity bookend (lodging_to_station / station_to_lodging) 표시 누락 — P111 enrichment 결과 사용자 surface 안 됨`);
      }
      // Blob + text/markdown MIME
      if (!/text\/markdown/.test(content)) {
        violations.push(`${LIB}: Blob MIME 'text/markdown' 누락 — 사용자 OS 가 텍스트 앱으로 안 열 수 있음`);
      }
      // Safari setTimeout cleanup pattern — multiline arrow body OK
      if (!/setTimeout\([\s\S]{0,200}URL\.revokeObjectURL/.test(content)) {
        violations.push(`${LIB}: URL.revokeObjectURL setTimeout 누락 — Safari 비동기 timing 으로 download fail 위험`);
      }
    }
  }

  const OUTRO = 'src/pages/PlanDetailPage/components/OutroSlide.tsx';
  if (isModified(OUTRO, changed) && /downloadPlanAsMarkdown/.test(getChangedFileContent(OUTRO) || '')) {
    const content = getChangedFileContent(OUTRO);
    if (content) {
      if (!/from\s*['"]\.\.\/lib\/planToMarkdown['"]/.test(content)) {
        violations.push(`${OUTRO}: planToMarkdown lib import 누락`);
      }
      if (!/handleDownloadMarkdown/.test(content)) {
        violations.push(`${OUTRO}: handleDownloadMarkdown handler 누락 — toast 성공/실패 메시지 + try-catch 안전망`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P115_planMarkdownFallback',
      violations.join(' | '),
      '메모리 P115 — PDF fallback Markdown export. planToMarkdown + downloadPlanAsMarkdown + intercity bookend 표시 + Safari setTimeout cleanup. tests/unit/plan-to-markdown-pr115.test.ts 12 케이스.',
    );
  }
  return null;
}

/**
 * P116_lodgingBookendLabel — 메모리 P116 (2026-05-20, no-PR-yet).
 *
 * lodging bookend 패턴 (매일 호텔 첫+마지막 stop) 사용자 오인 방지. StopCard 가
 * LodgingRole 타입 + 4-lang 라벨 + 가드된 badge 렌더 + DayTimeline 이 computeLodgingRole
 * 헬퍼 + SortableStopCard prop forwarding.
 *
 * 회귀 슬롯: tests/unit/lodging-bookend-label-pr116.test.tsx (13 케이스).
 */
function P116_lodgingBookendLabel({ changed }) {
  const violations = [];

  const STOP = 'src/pages/PlanDetailPage/components/StopCard.tsx';
  if (isModified(STOP, changed)) {
    const content = getChangedFileContent(STOP);
    if (content) {
      if (!/export\s+type\s+LodgingRole\s*=/.test(content)) {
        violations.push(`${STOP}: LodgingRole 타입 미export — DayTimeline/SortableStopCard 에서 type-safe forward 불가`);
      }
      if (!/lodgingRole\?:\s*LodgingRole/.test(content)) {
        violations.push(`${STOP}: lodgingRole?: prop 시그니처 누락`);
      }
      if (!/\{lodgingRole\s*&&\s*\(/.test(content)) {
        violations.push(`${STOP}: 가드된 badge 렌더 (lodgingRole && (...)) 누락 — undefined 시 빈 element 출력 위험`);
      }
      // 4-lang label coverage
      for (const role of ['checkout', 'depart', 'checkin', 'return']) {
        const pattern = new RegExp(`${role}:\\s*\\{\\s*ko:[^}]+,\\s*en:[^}]+,\\s*ja:[^}]+,\\s*zh:`);
        if (!pattern.test(content)) {
          violations.push(`${STOP}: LODGING_ROLE_LABEL.${role} 4-lang 라벨 누락`);
        }
      }
    }
  }

  const DT = 'src/pages/PlanDetailPage/components/DayTimeline.tsx';
  if (isModified(DT, changed)) {
    const content = getChangedFileContent(DT);
    if (content && /lodgingRole/.test(content)) {
      if (!/function\s+computeLodgingRole/.test(content)) {
        violations.push(`${DT}: computeLodgingRole 헬퍼 미선언 — lodgingRole prop 값 계산 불가`);
      }
      // P143 (2026-05-22): intercity 5번째 인자 (checkout vs checkin 시간 비교) 추가.
      // 4-arg `(stop, si, stops, !!intercity)` 또는 5-arg `(stop, si, stops, !!intercity, intercity)`
      // 양쪽 통과 — P116 + P143 backward compat.
      if (!/computeLodgingRole\(stop,\s*si,\s*stops,\s*!!intercity(?:,\s*intercity)?\)/.test(content)) {
        violations.push(`${DT}: computeLodgingRole 호출에 intercity 플래그 미전달 — checkout vs depart 구분 불가`);
      }
    }
  }

  const SORT = 'src/pages/PlanDetailPage/components/SortableStopCard.tsx';
  if (isModified(SORT, changed)) {
    const content = getChangedFileContent(SORT);
    if (content && /lodgingRole/.test(content)) {
      if (!/<StopCard\s+stop=\{stop\}\s+lodgingRole=\{lodgingRole\}/.test(content)) {
        violations.push(`${SORT}: SortableStopCard 가 lodgingRole 을 StopCard 로 forward 안 함`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P116_lodgingBookendLabel',
      violations.join(' | '),
      '메모리 P116 — lodging bookend 호텔 카드 첫/마지막/중간 구분 라벨 (checkout/depart/checkin/return). StopCard LodgingRole 타입 + 4-lang + 가드 badge + computeLodgingRole 헬퍼 + SortableStopCard forward. tests/unit/lodging-bookend-label-pr116.test.tsx 13 케이스.',
    );
  }
  return null;
}

/**
 * P123_hotelByCityForwarding — 메모리 P123 (2026-05-20).
 * Wizard Step2 가 hotelByCity Record (도시별 호텔) 입력받지만 백엔드 buildPrompt 가
 * 처리 X → Gemini 가 단일 hotel_address 만 받음 → 모든 day 에 박힘 회귀.
 * ai-planner-full.js 가 body.hotelByCity destructure + Gemini user message 에 inject
 * + planPersister.backfillDayLodging 가 인자로 받아 우선 lookup 3 layer 검증.
 */
function P123_hotelByCityForwarding({ changed }) {
  const AI_PLANNER = 'api/ai-planner-full.js';
  const PERSIST = 'api/_ai_core/planPersister.js';
  if (!isPlannerFamilyModified(changed) && !isModified(PERSIST, changed)) {
    return { skipped: true };
  }
  const violations = [];

  // P129 (2026-05-21): hotelByCity destructure 는 requestShaper.js,
  // MULTI-CITY HOTELS BY CITY block 은 userMessageBuilder.js, backfillDayLodging
  // 호출은 postResponsePipeline.js. 셋 다 family content 에 포함.
  {
    const c = getPlannerFamilyContent();
    if (!/(const|let)\s+hotelByCity\s*=/.test(c)) {
      violations.push(`${AI_PLANNER}/family: hotelByCity destructure 누락 — body.hotelByCity 처리 안 됨`);
    }
    if (!/MULTI-CITY HOTELS BY CITY/.test(c)) {
      violations.push(`${AI_PLANNER}/family: Gemini user message 에 MULTI-CITY HOTELS BY CITY 블록 누락 — wizard 도시별 호텔 입력 활용 X`);
    }
    if (!/backfillDayLodging\s*\(\s*itinerary\s*,\s*[^)]*hotelByCity[^)]*\)/.test(c)) {
      violations.push(`${AI_PLANNER}/family: backfillDayLodging(itinerary, hotelByCity) 호출 — 두 번째 인자 누락`);
    }
  }

  if (existsSync(PERSIST)) {
    const c = readFileSync(PERSIST, 'utf8');
    if (/backfillDayLodging/.test(c)) {
      if (!/backfillDayLodging\s*\(\s*itinerary\s*,\s*hotelByCity\s*=/.test(c)) {
        violations.push(`${PERSIST}: backfillDayLodging signature 의 hotelByCity 인자 누락`);
      }
      if (!/hbc\[dayCityLc\]/.test(c) && !/P123/.test(c)) {
        violations.push(`${PERSIST}: P123 hotelByCity[day.city] 우선 lookup logic 누락`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P123_hotelByCityForwarding',
      violations.join(' | '),
      '메모리 P123 — wizard 도시별 호텔 input 백엔드 통합. ai-planner-full destructure + Gemini user message inject + planPersister 우선 lookup 3 layer 의무.',
    );
  }
  return null;
}

/**
 * P122_multiCityLodgingPlaceholder — 메모리 P122 (2026-05-20).
 * plan 209de47b: 다도시 plan 의 부산 day 에 "명동 호텔" 박혀있음 회귀.
 * buildPrompt.js 의 stops[0].name 선택 instruction 이 단일 hotel_address 만 강조하고
 * 다도시 city-specific 호텔 placeholder 명시 부족. + planPersister backfillDayLodging
 * 의 city mismatch 가드 검증.
 */
function P122_multiCityLodgingPlaceholder({ changed }) {
  const PROMPT = 'api/_ai_core/buildPrompt.js';
  const PERSIST = 'api/_ai_core/planPersister.js';
  if (!isModified(PROMPT, changed) && !isModified(PERSIST, changed)) {
    return { skipped: true };
  }
  const violations = [];

  if (existsSync(PROMPT)) {
    const c = readFileSync(PROMPT, 'utf8');
    // 다도시 호텔 영역 표 — 최소 4 도시 placeholder 명시 의무.
    const cityPlaceholders = [
      { city: 'Seoul', pattern: /Seoul[^|]+\|\s*명동 호텔[^|]*홍대 호텔/ },
      { city: 'Busan', pattern: /Busan[^|]+\|\s*해운대 호텔[^|]*광안리 호텔/ },
      { city: 'Jeju', pattern: /Jeju[^|]+\|\s*중문 호텔/ },
    ];
    const missing = cityPlaceholders.filter((p) => !p.pattern.test(c));
    if (missing.length > 0) {
      violations.push(
        `${PROMPT}: 다도시 lodging placeholder 표 누락 — ${missing.map((m) => m.city).join(', ')}. buildPrompt LODGING BOOKEND stops[0].name 섹션에 city-specific 호텔 영역 표 + GOOD/BAD 예시 의무.`,
      );
    }
    // P122 명시 (메모리 ref) 의무 — 추후 누군가 instruction 제거 시 즉시 회귀 인지.
    if (!/P122/.test(c)) {
      violations.push(`${PROMPT}: "P122" 마커 누락 — 의도된 instruction 자체 흔적 X`);
    }
  }

  if (existsSync(PERSIST)) {
    const c = readFileSync(PERSIST, 'utf8');
    // backfillDayLodging 에 city mismatch 가드 — wrong-city 호텔 박힘 차단.
    if (/backfillDayLodging/.test(c)) {
      if (!/P122 .*city mismatch/.test(c) && !/cityMatched/.test(c)) {
        violations.push(`${PERSIST}: backfillDayLodging 의 city mismatch 가드 누락 — Gemini wrong-city 호텔 backfill 시 wrong city 박힘.`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P122_multiCityLodgingPlaceholder',
      violations.join(' | '),
      '메모리 P122 — 다도시 plan 의 도시 변경 day 에 wrong-city 호텔 (예: 부산 day 의 "명동 호텔") 박힘 회귀 차단. buildPrompt 표 + backfill 가드 2 layer.',
    );
  }
  return null;
}

/**
 * P121_qualityWarningsAdminPanel — 메모리 P121 (2026-05-20).
 * plan.itinerary.quality_warnings 가 Firestore 에 저장되지만 UI 미노출이라
 * 운영자가 plan detail 보면서 진단 불가했음. PlanDetailPage 의 운영자 전용
 * QualityWarningsPanel 컴포넌트 + isAdminEmail 가드 + PlanDetailPage 통합 검증.
 */
function P121_qualityWarningsAdminPanel({ changed }) {
  const PANEL = 'src/pages/PlanDetailPage/components/QualityWarningsPanel.tsx';
  const INDEX = 'src/pages/PlanDetailPage/index.tsx';
  if (!isModified(PANEL, changed) && !isModified(INDEX, changed)) {
    return { skipped: true };
  }
  const violations = [];

  if (existsSync(PANEL)) {
    const c = readFileSync(PANEL, 'utf8');
    if (!/import\s+\{\s*isAdminEmail\s*\}\s+from\s+['"]@\/lib\/admin['"]/.test(c)) {
      violations.push(`${PANEL}: isAdminEmail import 누락 — 운영자 가드 없음`);
    }
    if (!/isAdminEmail\s*\(/.test(c)) {
      violations.push(`${PANEL}: isAdminEmail 호출 누락 — 일반 사용자에게도 노출 위험`);
    }
    if (!/export\s+function\s+QualityWarningsPanel\s*\(/.test(c)) {
      violations.push(`${PANEL}: QualityWarningsPanel export 누락`);
    }
  }

  if (existsSync(INDEX)) {
    const c = readFileSync(INDEX, 'utf8');
    if (/QualityWarningsPanel/.test(c)) {
      if (!/import\s+\{\s*QualityWarningsPanel\s*\}/.test(c)) {
        violations.push(`${INDEX}: QualityWarningsPanel import 누락`);
      }
      if (!/<QualityWarningsPanel/.test(c)) {
        violations.push(`${INDEX}: <QualityWarningsPanel> 렌더 누락`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P121_qualityWarningsAdminPanel',
      violations.join(' | '),
      '메모리 P121 — QualityWarningsPanel + isAdminEmail 가드 + PlanDetailPage 통합 (ReviewList 직후) 3 layer 유지.',
    );
  }
  return null;
}

/**
 * P124_arrivalDepartureSleepBuffer — 메모리 P124 (2026-05-20).
 * plan 5aeeecef 회귀: arrival 23:05 인데 Day1 stops 01:10/02:03/02:37 새벽 활동.
 * buildPrompt ARRIVAL/DEPARTURE DAY HANDLING block + responseValidator
 * B-LATE-ARRIVAL/B-EARLY-DEPARTURE 룰 3 layer 검증.
 */
function P124_arrivalDepartureSleepBuffer({ changed }) {
  const PROMPT = 'api/_ai_core/buildPrompt.js';
  const VALIDATOR = 'api/_ai_core/responseValidator.js';
  if (!isModified(PROMPT, changed) && !isModified(VALIDATOR, changed)) {
    return { skipped: true };
  }
  const violations = [];

  if (existsSync(PROMPT)) {
    const c = readFileSync(PROMPT, 'utf8');
    if (!/ARRIVAL DAY HANDLING.*STRICT.*P124/s.test(c)) {
      violations.push(`${PROMPT}: ARRIVAL DAY HANDLING (P124) block 누락`);
    }
    if (!/DEPARTURE DAY HANDLING.*STRICT.*P124/s.test(c)) {
      violations.push(`${PROMPT}: DEPARTURE DAY HANDLING (P124) block 누락`);
    }
    if (!/arrival_time \+ 9h|arrival_time 9h sleep|9h sleep buffer/i.test(c)) {
      violations.push(`${PROMPT}: 8h sleep buffer (arrival + 9h) logic 명시 누락`);
    }
    // P124-extended (2026-05-21): 중간 day 새벽 stops 금지 글로벌 룰
    if (!/GLOBAL TIME RULES.*P124-extended/s.test(c)) {
      violations.push(`${PROMPT}: GLOBAL TIME RULES (P124-extended) block 누락 — 중간 day 새벽 활동 금지 명시 누락`);
    }
  }

  if (existsSync(VALIDATOR)) {
    const c = readFileSync(VALIDATOR, 'utf8');
    if (!/B-LATE-ARRIVAL/.test(c)) {
      violations.push(`${VALIDATOR}: B-LATE-ARRIVAL 룰 누락`);
    }
    if (!/B-EARLY-DEPARTURE/.test(c)) {
      violations.push(`${VALIDATOR}: B-EARLY-DEPARTURE 룰 누락`);
    }
    if (!/request\.arrival_time \|\| request\.arrivalTime/.test(c)) {
      violations.push(`${VALIDATOR}: arrival_time / arrivalTime 양쪽 수용 logic 누락`);
    }
    // P124-extended (2026-05-21): 중간 day 새벽 stops 검증 룰
    if (!/B-GLOBAL-DAWN/.test(c)) {
      violations.push(`${VALIDATOR}: B-GLOBAL-DAWN 룰 누락 — 중간 day 새벽 stops 검증 부재`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P124_arrivalDepartureSleepBuffer',
      violations.join(' | '),
      '메모리 P124 + P124-extended (2026-05-21) — Day 1/N 8h sleep buffer + 중간 day 새벽 stops 0건. buildPrompt (ARRIVAL/DEPARTURE/GLOBAL TIME RULES 3 block) + responseValidator (B-LATE-ARRIVAL/B-EARLY-DEPARTURE/B-GLOBAL-DAWN 3 rule) 의무.',
    );
  }
  return null;
}

/**
 * P126_wizardResumeContent — 메모리 P126 (2026-05-21).
 * 사용자 신고: "이어 작성하시겠습니까 아무때나 나와". WizardForm/index.tsx 가
 * dateRange.from = tomorrow 기본값 mount 시 auto-init → useWizardPersistence 가
 * 500ms 후 snapshot 저장 → 재방문 시 hasContent (dateRangeFrom 기반) = true →
 * 모달 발화. fix: hasMeaningfulWizardContent helper 가 dateRangeFrom 제외 + 명시적
 * 사용자 시그널만 인정.
 */
function P126_wizardResumeContent({ changed }) {
  const HELPER = 'src/components/WizardForm/snapshotContent.ts';
  const WIZARD = 'src/components/WizardForm/index.tsx';
  if (!isModified(HELPER, changed) && !isModified(WIZARD, changed)) {
    return { skipped: true };
  }
  const violations = [];

  if (existsSync(HELPER)) {
    const c = readFileSync(HELPER, 'utf8');
    if (!/export\s+function\s+hasMeaningfulWizardContent\s*\(/.test(c)) {
      violations.push(`${HELPER}: hasMeaningfulWizardContent export 누락 — testable helper 부재`);
    }
    // dateRangeFrom 제외 가드 — false positive 회귀 차단
    if (/v\.dateRangeFrom/.test(c)) {
      violations.push(`${HELPER}: hasMeaningfulWizardContent 가 v.dateRangeFrom 참조 — mount 시 tomorrow auto-init 시그널 → false positive 회귀. dateRangeTo 만 인정.`);
    }
    if (!/v\.dateRangeTo/.test(c)) {
      violations.push(`${HELPER}: dateRangeTo 검사 누락 — end-date 사용자 입력 시그널 미인정`);
    }
    if (!/PAX_INPUT_DEFAULT|paxInput\s*!==/.test(c)) {
      violations.push(`${HELPER}: paxInput 기본값 가드 누락 — '2' default 가 false positive 트리거`);
    }
  }

  if (existsSync(WIZARD)) {
    const c = readFileSync(WIZARD, 'utf8');
    if (!/hasMeaningfulWizardContent/.test(c)) {
      violations.push(`${WIZARD}: hasMeaningfulWizardContent import/호출 누락 — inline hasContent regression 위험`);
    }
    // inline hasContent 의 dateRangeFrom 참조 = pre-fix 회귀 시그널
    if (/const hasContent[^;]*v\.dateRangeFrom/s.test(c)) {
      violations.push(`${WIZARD}: hasContent 검사가 v.dateRangeFrom 참조 — P126 회귀. helper hasMeaningfulWizardContent 사용 의무.`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P126_wizardResumeContent',
      violations.join(' | '),
      '메모리 P126 (2026-05-21) — Wizard 이어작성 모달 false positive 차단. helper hasMeaningfulWizardContent (snapshotContent.ts) + WizardForm/index.tsx 사용 의무. dateRangeFrom 검사 금지 (mount 시 auto-init).',
    );
  }
  return null;
}

/**
 * P125_multiCityArrivalDeparture — 메모리 P125 (2026-05-21).
 * 사용자 신고 (5/21): "서울 부산이면 어디서 입국하고 어디서 출국하는지 표시해야되는데
 * 없더라". Wizard cycle UI 로 arrival_city / departure_city 받아서 backend forward
 * + buildPrompt MULTI-CITY ENTRY/EXIT block. 4 layer 검증:
 *   - WizardStep0Destination: arrivalCityKey/departureCityKey props + 배지 UI
 *   - WizardForm/index: state 보유 + body forward (arrival_city/departure_city)
 *   - usePlannerHandlers: revision 에서도 forward
 *   - ai-planner-full: body destructure + MULTI-CITY ENTRY/EXIT inject
 *   - buildPrompt: MULTI-CITY HANDLING 의 P125 city ordering override 명시
 */
function P125_multiCityArrivalDeparture({ changed }) {
  const STEP0 = 'src/components/WizardForm/WizardStep0Destination.tsx';
  const WIZARD = 'src/components/WizardForm/index.tsx';
  const HANDLERS = 'src/pages/PlannerPage/hooks/usePlannerHandlers.ts';
  const BACKEND = 'api/ai-planner-full.js';
  const PROMPT = 'api/_ai_core/buildPrompt.js';
  // P129 (2026-05-21): backend 검사 대상 family 로 확장.
  if (
    !isModified(STEP0, changed) &&
    !isModified(WIZARD, changed) &&
    !isModified(HANDLERS, changed) &&
    !isPlannerFamilyModified(changed) &&
    !isModified(PROMPT, changed)
  ) {
    return { skipped: true };
  }
  const violations = [];

  if (existsSync(STEP0)) {
    const c = readFileSync(STEP0, 'utf8');
    if (!/arrivalCityKey/.test(c) || !/departureCityKey/.test(c)) {
      violations.push(`${STEP0}: arrivalCityKey / departureCityKey props 누락 — 입국/출국 cycle UI 부재`);
    }
    if (!/setArrivalCityKey|setDepartureCityKey/.test(c)) {
      violations.push(`${STEP0}: setArrivalCityKey / setDepartureCityKey 호출 누락 — role cycle 미구현`);
    }
  }

  if (existsSync(WIZARD)) {
    const c = readFileSync(WIZARD, 'utf8');
    if (!/arrival_city:\s*arrivalCityKey/.test(c) && !/arrival_city:\s*\w+CityKey/.test(c)) {
      violations.push(`${WIZARD}: body 에 arrival_city forward 누락 — wizard state → backend 전달 단절`);
    }
    if (!/departure_city:\s*departureCityKey/.test(c) && !/departure_city:\s*\w+CityKey/.test(c)) {
      violations.push(`${WIZARD}: body 에 departure_city forward 누락`);
    }
  }

  if (existsSync(HANDLERS)) {
    const c = readFileSync(HANDLERS, 'utf8');
    if (!/values\.arrival_city/.test(c)) {
      violations.push(`${HANDLERS}: values.arrival_city forward 누락 — revision 경로 P125 미반영`);
    }
    if (!/values\.departure_city/.test(c)) {
      violations.push(`${HANDLERS}: values.departure_city forward 누락`);
    }
  }

  {
    // P129: family (ai-planner-full.js + handlerCore.js + requestShaper.js
    // + userMessageBuilder.js + postResponsePipeline.js + airportInference.js)
    // 합산 content 검사.
    const c = getPlannerFamilyContent();
    if (!/body\.arrival_city\s*\|\|\s*body\.arrivalCity/.test(c)) {
      violations.push(`${BACKEND}/family: body.arrival_city || body.arrivalCity destructure 누락 — backend 가 wizard 입력 무시`);
    }
    if (!/body\.departure_city\s*\|\|\s*body\.departureCity/.test(c)) {
      violations.push(`${BACKEND}/family: body.departure_city || body.departureCity destructure 누락`);
    }
    if (!/MULTI-CITY ENTRY\/EXIT.*P125/s.test(c)) {
      violations.push(`${BACKEND}/family: MULTI-CITY ENTRY/EXIT (P125) Gemini message block 누락`);
    }
  }

  if (existsSync(PROMPT)) {
    const c = readFileSync(PROMPT, 'utf8');
    if (!/P125/.test(c)) {
      violations.push(`${PROMPT}: P125 마커 누락 — MULTI-CITY HANDLING 의 arrival_city/departure_city override 명시 부재`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P125_multiCityArrivalDeparture',
      violations.join(' | '),
      '메모리 P125 (2026-05-21) — wizard 도시 클릭 cycle 로 명시한 arrival_city/departure_city 가 backend buildPrompt 까지 전달돼야 Gemini 가 Day 1/N city 강제. 5 layer (UI props + state + revision handler + backend destructure + buildPrompt instruction) 의무.',
    );
  }
  return null;
}

/**
 * P127_lodgingBookendMultiCityAnchor — 메모리 P127 (2026-05-20).
 * plan 5aeeecef quality_warnings.lodging_bookend_violation = 5건 (multi-city 의도된 패턴).
 * routeEnrichment.js validateLodgingBookend 가 multi-city 일 때 day-level anchor 사용.
 */
function P127_lodgingBookendMultiCityAnchor({ changed }) {
  const ROUTE_ENRICH = 'api/_ai_core/routeEnrichment.js';
  if (!isModified(ROUTE_ENRICH, changed)) return { skipped: true };
  const violations = [];

  if (existsSync(ROUTE_ENRICH)) {
    const c = readFileSync(ROUTE_ENRICH, 'utf8');
    if (!/validateLodgingBookend\s*\(\s*itinerary\s*,\s*anchor\s*,\s*isMultiCity/.test(c)) {
      violations.push(`${ROUTE_ENRICH}: validateLodgingBookend signature 의 isMultiCity 인자 누락`);
    }
    if (!/P127|day-anchor|day-level anchor/i.test(c)) {
      violations.push(`${ROUTE_ENRICH}: P127 day-level anchor logic 마커 누락`);
    }
    if (!/multi-city-day-anchor/.test(c)) {
      violations.push(`${ROUTE_ENRICH}: 다도시 day-anchor 검증 분기 누락`);
    }
    if (!/validateLodgingBookend\s*\(\s*itinerary\s*,\s*anchorCoord\s*,\s*\w+/.test(c)) {
      violations.push(`${ROUTE_ENRICH}: validateLodgingBookend 호출에 isMultiCity 인자 전달 누락`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P127_lodgingBookendMultiCityAnchor',
      violations.join(' | '),
      '메모리 P127 — multi-city plan false-positive 5건 차단. validateLodgingBookend(it, anchor, isMultiCity) signature + day-level anchor logic.',
    );
  }
  return null;
}

/**
 * P128_blockModeIntegration — 메모리 P128 (2026-05-21). zone_courses 기반
 * block-mode 분기. ai-planner-full.js 가 block-mode pipeline 을 도입했다면
 * import + 분기 호출 의무 + legacy fallback path 유지 의무.
 */
function P128_blockModeIntegration({ changed }) {
  const AI_PLANNER = 'api/ai-planner-full.js';
  const BLOCK_MODE = 'api/_ai_core/blockMode.js';
  if (!isPlannerFamilyModified(changed) && !isModified(BLOCK_MODE, changed)) {
    return { skipped: true };
  }
  const violations = [];

  // P129 (2026-05-21): ai-planner-full.js 분해 — block-mode import / 호출은
  // handlerCore.js 안. family content 합산 검사.
  {
    const c = getPlannerFamilyContent();
    const mentionsBlockMode = /block.?mode|runBlockModePipeline|tryRunBlockMode|PLANNER_BLOCK_MODE/i.test(c);
    if (mentionsBlockMode) {
      if (!/import[^;]+(runBlockModePipeline|getBlockModeEnv|tryRunBlockMode)[^;]+from\s+['"][^'"]*blockMode/.test(c)) {
        violations.push(`${AI_PLANNER}/family: blockMode.js import 누락 — block-mode 분기 의존성 부재`);
      }
      if (!/(runBlockModePipeline|tryRunBlockMode)\s*\(/.test(c)) {
        violations.push(`${AI_PLANNER}/family: block-mode pipeline 호출 누락 — 분기만 있고 실행 안 됨`);
      }
      // legacy fallback 패턴 — try/catch 또는 if (!itinerary) 폴백 의무.
      if (!/if\s*\(\s*!\s*itinerary\s*\)|legacy[^.]*fallback|legacy[^.]* path/i.test(c)) {
        violations.push(`${AI_PLANNER}/family: block-mode 실패 시 legacy fallback 분기 누락 — 사용자 plan 손실 위험`);
      }
    }
  }

  // blockMode.js 자체에 SAFETY-CRITICAL dietary 검사 누락 차단.
  if (existsSync(BLOCK_MODE)) {
    const c = readFileSync(BLOCK_MODE, 'utf8');
    if (!/BLOCK_MODE_DIETARY_UNSATISFIED|dietary/i.test(c)) {
      violations.push(`${BLOCK_MODE}: dietary 검사 마커 없음 — SAFETY-CRITICAL (CLAUDE.md J) 위반 위험`);
    }
    if (!/fetchAvailableBlocks|expandBlocksToItinerary|shouldUseBlockMode/.test(c)) {
      violations.push(`${BLOCK_MODE}: 필수 export (fetchAvailableBlocks/expandBlocksToItinerary/shouldUseBlockMode) 누락`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P128_blockModeIntegration',
      violations.join(' | '),
      '메모리 P128 — ai-planner-full block-mode 분기 import + 호출 + legacy fallback + SAFETY-CRITICAL dietary 검사 의무.',
    );
  }
  return null;
}

/**
 * P129_aiPlannerFullDecomposeLock — 메모리 P129 (2026-05-21).
 *
 * api/ai-planner-full.js 가 800L 까지 부풀어 P1 lock 한도 도달 (pre-commit hook).
 * 본 PR 에서 본체를 api/_ai_core/handlerCore.js + requestShaper.js +
 * userMessageBuilder.js + postResponsePipeline.js + airportInference.js 5종으로
 * 추출하고 ai-planner-full.js 는 thin re-export wrapper (~25L) 로 만들었다.
 *
 * 본 룰은 회귀 방지:
 *   1. ai-planner-full.js 가 ≤100L 유지 (handler entry + maxDuration + re-export 만).
 *   2. ai-planner-full.js 가 handlerCore.js 의 default 를 re-export 해야 함.
 *   3. inferDepartureAirport named export 가 airportInference.js 로 forward 필수
 *      (backward-compat — 외부 test 가 이름으로 import 시도할 수 있음).
 *   4. handlerCore.js 가 maxDuration 을 자체 export 하지 않음 (ai-planner-full.js
 *      가 Vercel handler 진입점 — maxDuration 도 거기서 export 해야 Vercel 인식).
 *   5. handlerCore.js 가 ≤500L 유지 (orchestrator 가 너무 부풀면 추가 분리).
 *
 * 카테고리: L1 (코드 grep) — file size + content 시그니처 검사.
 *
 * 회귀 슬롯: tests/unit/planner-step-instrumentation-pr96.test.ts 가 handlerCore.js
 * 의 withStep/hangWarn 패턴 검사 — 본 룰과 협력해서 분해 흐름 보호.
 */
function P129_aiPlannerFullDecomposeLock({ changed: _changed }) {
  const WRAPPER = 'api/ai-planner-full.js';
  const HANDLER_CORE = 'api/_ai_core/handlerCore.js';
  const AIRPORT_INFER = 'api/_ai_core/airportInference.js';

  // 본 룰은 ai-planner-full.js 가 존재하면 항상 검사 — sandbox self-test 에서
  // wrapper 파일 자체를 안 만들면 skip.
  if (!existsSync(WRAPPER)) {
    return { skipped: true };
  }

  const violations = [];

  // 1. WRAPPER size cap — 100L (P1 lock 800→100).
  const wrapperLines = readFileSync(WRAPPER, 'utf8').split(/\r?\n/).length;
  if (wrapperLines > 100) {
    violations.push(
      `${WRAPPER}: ${wrapperLines} lines > 100 — 800L 분해 회귀. handler 본체는 _ai_core/handlerCore.js 로 추출해야 함.`,
    );
  }

  const wrapperContent = readFileSync(WRAPPER, 'utf8');

  // 2. handlerCore re-export 의무.
  if (!/export\s+\{\s*default\s*\}\s+from\s+['"]\.\/_ai_core\/handlerCore(\.js)?['"]/.test(wrapperContent)) {
    violations.push(
      `${WRAPPER}: \`export { default } from './_ai_core/handlerCore.js'\` re-export 누락 — Vercel handler 가 handlerCore 의 default 함수를 노출해야 함.`,
    );
  }

  // 3. inferDepartureAirport named export 도 forward.
  if (!/export\s+\{\s*inferDepartureAirport[^}]*\}\s+from\s+['"]\.\/_ai_core\/airportInference(\.js)?['"]/.test(wrapperContent)) {
    violations.push(
      `${WRAPPER}: \`export { inferDepartureAirport } from './_ai_core/airportInference.js'\` 누락 — backward-compat 깨짐 (외부 test 가 named import 시도 가능).`,
    );
  }

  // 4. maxDuration / config 는 wrapper 에서만 export (Vercel handler entry).
  if (!/export\s+const\s+maxDuration\s*=/.test(wrapperContent)) {
    violations.push(
      `${WRAPPER}: \`export const maxDuration = 300\` 누락 — Vercel 이 본 wrapper 의 maxDuration 을 읽어야 5분 cap 적용.`,
    );
  }

  // 5. handlerCore 가 maxDuration 을 export 하지 않음 (Vercel 은 entry file 만 read).
  if (existsSync(HANDLER_CORE)) {
    const coreContent = readFileSync(HANDLER_CORE, 'utf8');
    if (/export\s+const\s+maxDuration\s*=/.test(coreContent)) {
      violations.push(
        `${HANDLER_CORE}: maxDuration export 발견 — Vercel handler entry (api/ai-planner-full.js) 가 아닌 곳에서 maxDuration export 하면 인식 안 됨. wrapper 에서만 export.`,
      );
    }
    // handlerCore size cap — 500L (P170, 2026-05-23: backgroundPipelines.js 추출로 복귀).
    // P168/P169 Pass3 background + streaming early-response → backgroundPipelines.js.
    // 신규 background/streaming 로직은 backgroundPipelines.js 에 추가 (handlerCore inline X).
    const coreLines = coreContent.split(/\r?\n/).length;
    if (coreLines > 500) {
      violations.push(
        `${HANDLER_CORE}: ${coreLines} lines > 500 — orchestrator 가 부풀면 추가 분리 (backgroundPipelines.js 또는 신규 모듈). P170 cap 복귀.`,
      );
    }
    // handler default export 의무.
    if (!/export\s+default\s+async\s+function\s+handler/.test(coreContent)) {
      violations.push(
        `${HANDLER_CORE}: \`export default async function handler\` 누락 — wrapper 의 re-export 대상 부재.`,
      );
    }
  } else {
    violations.push(
      `${HANDLER_CORE}: 파일 부재 — wrapper 가 re-export 하지만 대상 없음.`,
    );
  }

  // 6. airportInference 가 inferDepartureAirport export 해야 함.
  if (existsSync(AIRPORT_INFER)) {
    const inferContent = readFileSync(AIRPORT_INFER, 'utf8');
    if (!/export\s+function\s+inferDepartureAirport/.test(inferContent)) {
      violations.push(
        `${AIRPORT_INFER}: \`export function inferDepartureAirport\` 누락 — wrapper 의 named re-export 대상 부재.`,
      );
    }
  }

  if (violations.length > 0) {
    fail(
      'P129_aiPlannerFullDecomposeLock',
      violations.join(' | '),
      '메모리 P129 (2026-05-21) — ai-planner-full.js 800L → 25L wrapper 분해. wrapper 는 maxDuration + handlerCore default re-export + inferDepartureAirport named re-export 만 유지. handlerCore.js 는 orchestrator (try/catch + withStep + 합성).',
    );
  }
  return null;
}

/**
 * P130_intentClassifierMonitoring — 메모리 P130 (2026-05-21). ai-planner-modify.js
 * 의 intent classifier 결과를 Firestore `intent_classifier_logs/{logId}` 에
 * fire-and-forget 으로 저장 + admin dashboard `/admin/intent-classifier` + weekly
 * cron 알림. 다음 4 layer 검증:
 *   1. src/lib/intent-classifier-logs.ts: fetchRecentLogs / fetchWeeklyStats /
 *      fetchHighFallbackSamples 3 export.
 *   2. api/ai-planner-modify.js: intent_classifier_logs collection write
 *      (logIntentClassifierAsync 또는 collection('intent_classifier_logs').add).
 *   3. api/_crons/intent-classifier-summary.js 존재 + throttledTelegramAlert 호출.
 *   4. cron-runner.js / vercel.json 에 'intent-classifier-summary' job 등록.
 */
function P130_intentClassifierMonitoring({ changed }) {
  const LIB = 'src/lib/intent-classifier-logs.ts';
  const MODIFY = 'api/ai-planner-modify.js';
  const CRON = 'api/_crons/intent-classifier-summary.js';
  const RUNNER = 'api/cron-runner.js';
  const VERCEL = 'vercel.json';
  const ADMIN_PAGE = 'src/pages/AdminIntentClassifier.tsx';
  const allRelevant = [LIB, MODIFY, CRON, RUNNER, VERCEL, ADMIN_PAGE];
  if (!allRelevant.some((f) => isModified(f, changed))) {
    return { skipped: true };
  }
  const violations = [];

  // 1. src/lib helper — 3 export 필수.
  if (existsSync(LIB)) {
    const c = readFileSync(LIB, 'utf8');
    if (!/export\s+async\s+function\s+fetchRecentLogs\s*\(/.test(c)) {
      violations.push(`${LIB}: fetchRecentLogs export 누락`);
    }
    if (!/export\s+async\s+function\s+fetchWeeklyStats\s*\(/.test(c)) {
      violations.push(`${LIB}: fetchWeeklyStats export 누락`);
    }
    if (!/export\s+async\s+function\s+fetchHighFallbackSamples\s*\(/.test(c)) {
      violations.push(`${LIB}: fetchHighFallbackSamples export 누락`);
    }
  } else if (isModified(MODIFY, changed) || isModified(ADMIN_PAGE, changed)) {
    violations.push(`${LIB}: 파일 누락 — modify endpoint / admin page 가 dependency`);
  }

  // 2. ai-planner-modify.js — intent_classifier_logs write 호출 필수.
  if (existsSync(MODIFY)) {
    const c = readFileSync(MODIFY, 'utf8');
    const hasLogWrite = /collection\(\s*['"]intent_classifier_logs['"]\s*\)\s*\.add\s*\(/.test(c)
      || /logIntentClassifierAsync\s*\(/.test(c);
    if (!hasLogWrite) {
      violations.push(`${MODIFY}: intent_classifier_logs.add 또는 logIntentClassifierAsync 호출 누락 — P130 모니터링 불가`);
    }
  }

  // 3. cron handler — throttledTelegramAlert 호출 + 임계값 정의.
  if (existsSync(CRON)) {
    const c = readFileSync(CRON, 'utf8');
    if (!/throttledTelegramAlert\s*\(/.test(c)) {
      violations.push(`${CRON}: throttledTelegramAlert 호출 누락 — alert dedup pattern (P67) 미사용`);
    }
    if (!/intent_classifier_logs/.test(c)) {
      violations.push(`${CRON}: intent_classifier_logs 컬렉션 참조 누락`);
    }
  } else if (isModified(RUNNER, changed) || isModified(VERCEL, changed)) {
    violations.push(`${CRON}: 파일 누락 — cron-runner / vercel.json 에 'intent-classifier-summary' 등록됐으나 handler 없음`);
  }

  // 4. cron-runner + vercel.json 등록 일관성.
  if (existsSync(RUNNER)) {
    const c = readFileSync(RUNNER, 'utf8');
    if (!/['"]intent-classifier-summary['"]/.test(c)) {
      violations.push(`${RUNNER}: 'intent-classifier-summary' job 등록 누락 — cron handler 호출 불가`);
    }
  }
  if (existsSync(VERCEL)) {
    const c = readFileSync(VERCEL, 'utf8');
    if (!/intent-classifier-summary/.test(c)) {
      violations.push(`${VERCEL}: crons 배열에 intent-classifier-summary 누락 — 스케줄러 미동작`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P130_intentClassifierMonitoring',
      violations.join(' | '),
      '메모리 P130 — intent classifier prod 모니터링: lib export 3개 + modify endpoint 로그 저장 + weekly cron + cron-runner/vercel.json 등록.',
    );
  }
  return null;
}

/**
 * P132_prDescriptionImpactSections — 메모리 P132 (2026-05-21).
 *
 * PR description template (.github/pull_request_template.md) 에 다음 2 섹션
 * 의무 유지 (사용자 가이드 "Code Modification & Regression Prevention Guidelines"
 * 항목 1 + 4 통합):
 *   1. "사전 영향 분석 (Impact Analysis)" — 직접 수정 + 간접 영향 + 사이드 이펙트
 *   2. "가장 취약한 부분 (Most Fragile Spot)" — 회귀 가능성 가장 높은 1-2 지점
 *
 * 누군가 template 에서 위 섹션을 제거하면 PR review 시 사람의 사전 분석 의무가
 * 사라지고 자동 lint 가 못 잡는 영역에 회귀 risk 누적 — 본 룰이 차단.
 */
function P132_prDescriptionImpactSections({ changed }) {
  const TEMPLATE = '.github/pull_request_template.md';
  if (!isModified(TEMPLATE, changed)) return { skipped: true };
  const violations = [];

  if (existsSync(TEMPLATE)) {
    const c = readFileSync(TEMPLATE, 'utf8');
    if (!/##\s+사전 영향 분석/.test(c)) {
      violations.push(`${TEMPLATE}: "## 사전 영향 분석 (Impact Analysis)" 섹션 누락 — PR 사전 분석 의무 회귀`);
    }
    if (!/##\s+가장 취약한 부분/.test(c)) {
      violations.push(`${TEMPLATE}: "## 가장 취약한 부분 (Most Fragile Spot)" 섹션 누락 — 회귀 risk 지점 명시 의무 회귀`);
    }
    // 두 섹션 모두 구조 검증: bullet + commented 가이드 라인 존재
    if (!/직접 수정 영역/.test(c)) {
      violations.push(`${TEMPLATE}: "직접 수정 영역" 하위 항목 누락 — Impact Analysis 구조 회귀`);
    }
    if (!/간접 영향 가능 영역|호출 체인/.test(c)) {
      violations.push(`${TEMPLATE}: "간접 영향 가능 영역" (호출 체인) 하위 항목 누락`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P132_prDescriptionImpactSections',
      violations.join(' | '),
      '메모리 P132 (2026-05-21) — PR description template 의 "사전 영향 분석" + "가장 취약한 부분" 2 섹션 의무 유지. 자동 lint 가 못 잡는 영역의 사람 review 가드.',
    );
  }
  return null;
}

/**
 * P119_dayLodgingBackfill — 메모리 P119 (2026-05-20). plan 4792076e 의 day.lodging
 * 미생성 회귀 → RouteAgent Phase 2.4 prevDayHotelCoord null → KTX bookend 누락.
 * api/_ai_core/planPersister.js 의 backfillDayLodging export + ai-planner-full.js
 * 호출 검증.
 */
function P119_dayLodgingBackfill({ changed }) {
  const PLAN_PERSISTER = 'api/_ai_core/planPersister.js';
  const AI_PLANNER = 'api/ai-planner-full.js';
  if (!isModified(PLAN_PERSISTER, changed) && !isPlannerFamilyModified(changed)) {
    return { skipped: true };
  }
  const violations = [];

  if (existsSync(PLAN_PERSISTER)) {
    const c = readFileSync(PLAN_PERSISTER, 'utf8');
    if (!/export\s+function\s+backfillDayLodging\s*\(/.test(c)) {
      violations.push(`${PLAN_PERSISTER}: backfillDayLodging export 누락 — day.lodging 안전망 부재`);
    }
  }

  // P129 (2026-05-21): backfillDayLodging import + 호출은
  // postResponsePipeline.js (handlerCore 가 합성). family content 검사.
  {
    const c = getPlannerFamilyContent();
    if (/backfillDayLodging/.test(c)) {
      // import 와 call 둘 다 있어야 함
      if (!/import[^;]+backfillDayLodging[^;]+from/.test(c)) {
        violations.push(`${AI_PLANNER}/family: backfillDayLodging import 누락`);
      }
      // P123 (2026-05-20): 두 번째 인자 hotelByCity 추가로 정규식 완화.
      // 호출 자체 있으면 OK (R-P123 가 정확한 인자 검증).
      if (!/backfillDayLodging\s*\(\s*itinerary\b/.test(c)) {
        violations.push(`${AI_PLANNER}/family: backfillDayLodging(itinerary, ...) 호출 누락 — backfillStopEndTimes 다음에 호출 의무`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P119_dayLodgingBackfill',
      violations.join(' | '),
      '메모리 P119 — planPersister 의 backfillDayLodging + ai-planner-full 호출. buildPrompt P119 instruction 의 안전망.',
    );
  }
  return null;
}

/**
 * P120_unreasonableStopTimeDetect — 메모리 P120 (2026-05-20). plan 4792076e 의
 * Day3 00:31, Day4 01:24, 03:26 같은 새벽 시간 stops 회귀. planPersister.js 의
 * detectUnreasonableStopTimes export + ai-planner-full.js 가 호출 후 admin alert
 * 발송 검증.
 */
function P120_unreasonableStopTimeDetect({ changed }) {
  const PLAN_PERSISTER = 'api/_ai_core/planPersister.js';
  const AI_PLANNER = 'api/ai-planner-full.js';
  if (!isModified(PLAN_PERSISTER, changed) && !isPlannerFamilyModified(changed)) {
    return { skipped: true };
  }
  const violations = [];

  if (existsSync(PLAN_PERSISTER)) {
    const c = readFileSync(PLAN_PERSISTER, 'utf8');
    if (!/export\s+function\s+detectUnreasonableStopTimes\s*\(/.test(c)) {
      violations.push(`${PLAN_PERSISTER}: detectUnreasonableStopTimes export 누락`);
    }
    // wrapper export 도 필수 — ai-planner-full.js 가 1줄 호출하도록.
    if (!/export\s+function\s+runUnreasonableStopTimesCheck\s*\(/.test(c)) {
      violations.push(`${PLAN_PERSISTER}: runUnreasonableStopTimesCheck wrapper export 누락 — ai-planner-full.js 라인 폭증 위험`);
    }
  }

  // P129 (2026-05-21): runUnreasonableStopTimesCheck 호출은
  // postResponsePipeline.js 의 applyBackfillsAndTmoney. family content 합산.
  {
    const c = getPlannerFamilyContent();
    if (/runUnreasonableStopTimesCheck/.test(c)) {
      if (!/runUnreasonableStopTimesCheck\s*\(\s*itinerary\s*,\s*[\w.]+\s*\)/.test(c)) {
        violations.push(`${AI_PLANNER}/family: runUnreasonableStopTimesCheck(itinerary, body) 호출 형식 누락`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P120_unreasonableStopTimeDetect',
      violations.join(' | '),
      '메모리 P120 — detectUnreasonableStopTimes 헬퍼 + admin alert (severity:low, dedup key unreasonable-stop-times:<regions>). plan 저장은 non-blocking.',
    );
  }
  return null;
}

/**
 * P118_prePushHookContent — 메모리 P118 (2026-05-20 자율 검증 사각지대 closure).
 * scripts/git-hooks/pre-push 가 Vercel parity 4-piece (tsc -b / vitest / size-limit /
 * mistake-lint) 다 포함하는지 file 전체 검사. + setup-git-hooks.mjs 존재 검사
 * (없으면 hook 활성화 mechanism 자체 부재).
 *
 * 카테고리: L0 (메타 — 자율 검증 게이트 자체 보호).
 *
 * 왜:
 *   - 2026-05-20 6 PR 회귀: 사용자가 `npx tsc --noEmit` 만 돌리고 commit → Vercel
 *     build 단계 (`tsc -b`) 가 noUnusedLocals 검출 → preview build fail. 5 iteration.
 *   - 해결: pre-push 가 `npm run build` 자동 실행 → push 전 차단. 본 lint 가 hook
 *     자체 회귀 (누군가 vitest / size-limit 등 step 삭제) 영구 차단.
 *
 * self-test sandbox 임시 dir 에는 vite.config.ts / vercel.json / package.json 셋 다
 * 없으므로 → 그 환경에선 자동 skip. P118 case 는 명시적으로 hook 파일을 base/head 에
 * 풀어놓는다.
 */
function P118_prePushHookContent({ changed: _changed }) {
  const HOOK = 'scripts/git-hooks/pre-push';
  const SETUP = 'scripts/setup-git-hooks.mjs';

  const isRealRepo =
    existsSync('vite.config.ts') ||
    existsSync('vercel.json') ||
    existsSync(HOOK) ||
    existsSync(SETUP);
  if (!isRealRepo) return { skipped: true };

  const violations = [];

  if (!existsSync(HOOK)) {
    violations.push(
      `${HOOK} 부재 — push 전 Vercel parity 검증 자동화 누락 (build/vitest/size/lint).`,
    );
  } else {
    const content = readFileSync(HOOK, 'utf8');
    const required = [
      { name: 'npm run build (tsc -b + vite build)', pattern: /(npm\s+run\s+build|tsc\s+-b)/ },
      { name: 'vitest run', pattern: /vitest\s+run/ },
      { name: 'size-limit', pattern: /size-limit/ },
      { name: 'lint-mistake-patterns.mjs', pattern: /lint-mistake-patterns\.mjs/ },
    ];
    const missing = required.filter((r) => !r.pattern.test(content));
    if (missing.length > 0) {
      violations.push(
        `${HOOK} 4-piece 검증 중 ${missing.length}개 누락: ${missing.map((m) => m.name).join(', ')}`,
      );
    }
  }

  if (!existsSync(SETUP)) {
    violations.push(
      `${SETUP} 부재 — hook 파일이 있어도 git config core.hooksPath 자동 등록 안 됨 (npm install 후 활성화 mechanism 없음).`,
    );
  }

  if (violations.length > 0) {
    fail(
      'P118_prePushHookContent',
      violations.join(' | '),
      '메모리 P118 — pre-push 4-piece (build / vitest / size-limit / mistake-lint) + setup-git-hooks.mjs (prepare 단계 activation) 둘 다 유지 필수.',
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
  // P180 (2026-05-24): threshold 0.3 → 0.2 강화. P90 lint rule 도 동기.
  if (!/CITY_MISMATCH_RATIO_THRESHOLD\s*=\s*0\.2\b/.test(content)) {
    violations.push(`${FILE}: CITY_MISMATCH_RATIO_THRESHOLD=0.2 누락 → alert 임계 변경 (P180 30→20% 강화)`);
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
  // P114 (2026-05-20): per-day matchCity 도입 — matchCity (per-day) 또는
  // tripMatchCity (trip-level) 둘 다 허용. 기존 PR #466 호환.
  if (!/dbmatcher-city-mismatch:\$\{(matchCity|tripMatchCity)\s*\|\|\s*['"]unknown['"]\}/.test(content)) {
    violations.push(`${FILE}: alert key 'dbmatcher-city-mismatch:${'${matchCity|tripMatchCity}'}' 누락`);
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
  // arrival/departure 가드도 afternoonMealCount 사용 — 2026-05-20 완화:
  // 다른 조건 (breakfastCount, totalFoodCount 등) 이 추가돼도 OK. 핵심은 두 키워드.
  if (!/if\s*\([^)]*afternoonMealCount\s*===\s*0[^)]*dinnerCount\s*===\s*0[^)]*\)/.test(content)) {
    violations.push(`${FILE}: arrival/departure 가드가 afternoonMealCount + dinnerCount 사용 안 함`);
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
  // P171 (2026-05-23): buildModel signature 확장 — (apiKey, temperatureOverride, opts).
  // temperatureOverride 인자 존재 + retryModel 분리 유지 시 OK (opts 는 P171 admin 분기용).
  if (!/export\s+function\s+buildModel\s*\(\s*apiKey\s*,\s*temperatureOverride/.test(content)) {
    violations.push(`${FILE}: buildModel(apiKey, temperatureOverride, ...) signature 누락 — retryModel 분리 불가`);
  }
  if (!/const\s+retryModel\s*=\s*buildModel\(apiKey,\s*RETRY_TEMPERATURE/.test(content)) {
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

/**
 * R-P169 — Gemini Streaming 분기 핵심 요소 유지 검사.
 * geminiPipeline.js 또는 planPersister.js 수정 시 실행.
 *
 * 검사 대상:
 *   1. isStreamingEnabled() 함수 존재 (env flag gate)
 *   2. runGeminiStreaming() 함수 존재 (streaming 분기)
 *   3. savePlanSkeleton() 함수 존재 (early planId 생성)
 *   4. updatePlanProgressive() 함수 존재 (점진 Firestore write)
 *   5. PLANNER_STREAMING_ENABLED 문자열 참조 존재 (env flag 참조)
 */
function P169_geminiStreaming({ changed }) {
  const PIPELINE = 'api/_ai_core/geminiPipeline.js';
  const PERSISTER = 'api/_ai_core/planPersister.js';
  const HANDLER = 'api/_ai_core/handlerCore.js';

  const pipelineModified = isModified(PIPELINE, changed);
  const persisterModified = isModified(PERSISTER, changed);
  const handlerModified = isModified(HANDLER, changed);

  if (!pipelineModified && !persisterModified && !handlerModified) {
    return { skipped: true };
  }

  const violations = [];

  if (pipelineModified) {
    const content = getChangedFileContent(PIPELINE);
    if (content) {
      if (!/function isStreamingEnabled/.test(content)) {
        violations.push(`${PIPELINE}: isStreamingEnabled() 함수 누락 — env flag gate 부재 (P169 rollback 불가)`);
      }
      if (!/async function runGeminiStreaming/.test(content)) {
        violations.push(`${PIPELINE}: runGeminiStreaming() 함수 누락 — streaming 분기 부재`);
      }
      if (!/PLANNER_STREAMING_ENABLED/.test(content)) {
        violations.push(`${PIPELINE}: PLANNER_STREAMING_ENABLED env 참조 누락 — env flag 연결 끊김`);
      }
    }
  }

  if (persisterModified) {
    const content = getChangedFileContent(PERSISTER);
    if (content) {
      if (!/async function savePlanSkeleton/.test(content)) {
        violations.push(`${PERSISTER}: savePlanSkeleton() 누락 — streaming early response 불가`);
      }
      if (!/async function updatePlanProgressive/.test(content)) {
        violations.push(`${PERSISTER}: updatePlanProgressive() 누락 — 점진 Firestore write 불가`);
      }
    }
  }

  if (handlerModified) {
    const content = getChangedFileContent(HANDLER);
    if (content) {
      // P170 (2026-05-23): streaming pipeline 은 backgroundPipelines.js 로 추출됨.
      // handlerCore 는 shouldUseStreaming + tryInitStreamingSkeleton + sendStreamingEarlyResponse 위임.
      if (!/shouldUseStreaming/.test(content)) {
        violations.push(`${HANDLER}: shouldUseStreaming() 호출 누락 — P170 추출 후 backgroundPipelines.js 위임 의무. (isStreamingEnabled 직접 호출 금지)`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P169_geminiStreaming',
      violations.join(' | '),
      'P169 회귀 — Gemini streaming 핵심 요소 누락. PLANNER_STREAMING_ENABLED env flag + isStreamingEnabled + runGeminiStreaming + savePlanSkeleton + updatePlanProgressive 모두 유지 필수.',
    );
  }
  return null;
}

/**
 * R-P170 — backgroundPipelines.js 추출 회귀 차단 (2026-05-23).
 *
 * P170: handlerCore.js 의 P168 Pass3 background IIFE + P169 streaming skeleton/early-response 를
 * backgroundPipelines.js 로 추출. handlerCore.js 는 orchestrator 단일 책임 (P129 cap 500L).
 *
 * 룰:
 *   1. handlerCore.js 에 `_pass3_pending` literal 이 있으면 fail (추출된 영역 inline 재도입).
 *   2. handlerCore.js 에 `runGeminiStreaming` 직접 호출이 있으면 fail (backgroundPipelines 경유해야 함).
 *   3. backgroundPipelines.js 가 존재하지 않으면 fail.
 *   4. backgroundPipelines.js 가 `triggerPass3BackgroundIfPending` export 하지 않으면 fail.
 *   5. backgroundPipelines.js 가 `shouldUseStreaming` export 하지 않으면 fail.
 */
function P170_backgroundPipelinesExtract({ changed }) {
  const HANDLER_CORE = 'api/_ai_core/handlerCore.js';
  const BG_PIPELINES = 'api/_ai_core/backgroundPipelines.js';

  const handlerModified = isModified(HANDLER_CORE, changed);
  const bgModified = isModified(BG_PIPELINES, changed);

  if (!handlerModified && !bgModified) {
    return { skipped: true };
  }

  const violations = [];

  if (handlerModified) {
    const content = getChangedFileContent(HANDLER_CORE);
    if (content) {
      // inline `_pass3_pending` — IIFE 재도입 신호
      if (/_pass3_pending/.test(content)) {
        violations.push(
          `${HANDLER_CORE}: \`_pass3_pending\` literal 발견 — P170 회귀. Pass3 background pipeline 은 backgroundPipelines.js#triggerPass3BackgroundIfPending 로 추출됨. handlerCore.js inline 재도입 금지.`,
        );
      }
      // runGeminiStreaming 직접 호출 (import 는 허용, await runGeminiStreaming(...) 형태)
      if (/await\s+runGeminiStreaming\s*\(/.test(content)) {
        violations.push(
          `${HANDLER_CORE}: \`await runGeminiStreaming(\` 직접 호출 발견 — P170 회귀. streaming pipeline 은 backgroundPipelines.js 경유 의무.`,
        );
      }
    }
  }

  // backgroundPipelines.js 존재 + export contract 검사
  const bgContent = getChangedFileContent(BG_PIPELINES) || (() => {
    try {
      return readFileSync(BG_PIPELINES, 'utf8');
    } catch {
      return null;
    }
  })();

  if (!bgContent) {
    violations.push(
      `${BG_PIPELINES}: 파일 부재 — P170 추출 결과물. triggerPass3BackgroundIfPending + shouldUseStreaming + tryInitStreamingSkeleton + sendStreamingEarlyResponse export 필수.`,
    );
  } else {
    if (!/triggerPass3BackgroundIfPending/.test(bgContent)) {
      violations.push(`${BG_PIPELINES}: \`triggerPass3BackgroundIfPending\` export 누락 — P168 background trigger 계약 불이행.`);
    }
    if (!/shouldUseStreaming/.test(bgContent)) {
      violations.push(`${BG_PIPELINES}: \`shouldUseStreaming\` export 누락 — P169 streaming 판단 계약 불이행.`);
    }
  }

  if (violations.length > 0) {
    fail(
      'P170_backgroundPipelinesExtract',
      violations.join(' | '),
      'P170 회귀 — Pass3 background / streaming pipeline 은 backgroundPipelines.js 로 추출. handlerCore.js inline 재도입 금지. backgroundPipelines.js 삭제 금지.',
    );
  }
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
      label: 'R_plan4d214e83 (true positive): blockMode Day1 cutoff(pastMidnight) 누락',
      base: { 'api/_ai_core/blockMode.js': '// stub\n' },
      head: { 'api/_ai_core/blockMode.js': 'export function matchFoodPlaceholder(a, b, c, d, excludeNames) { return null; }\nfunction x() { const r = `[추천 ${t}]`; }\n' },
      expectRule: 'R_plan4d214e83_blockModeQuality',
    },
    {
      label: 'R_plan4d214e83 (false positive 차단): pastMidnight + excludeNames + P281 정상 — silent',
      base: { 'api/_ai_core/blockMode.js': '// stub\n' },
      head: { 'api/_ai_core/blockMode.js': 'export function matchFoodPlaceholder(a, b, c, d, excludeNames) {}\nconst pastMidnight = lm < dsm;\nconst r = `[추천 ${t}]`;\n' },
      expectRule: 'R_plan4d214e83_blockModeQuality',
      expectClean: true,
    },
    {
      label: 'R_plan4d214e83 cuisine (true positive): matchFoodPlaceholder type 필터 r.cuisine 폴백 누락',
      base: { 'api/_ai_core/blockMode.js': '// stub\n' },
      head: { 'api/_ai_core/blockMode.js': 'export function matchFoodPlaceholder(a, b, c, d, excludeNames) {}\nconst pastMidnight = 1;\nconst rType = String(r.type || r.category || "").toLowerCase();\nconst x = `[추천 ${t}]`;\n' },
      expectRule: 'R_plan4d214e83_blockModeQuality',
    },
    {
      label: 'R_plan4d214e83 cuisine (false positive 차단): r.cuisine 폴백 있음 — silent',
      base: { 'api/_ai_core/blockMode.js': '// stub\n' },
      head: { 'api/_ai_core/blockMode.js': 'export function matchFoodPlaceholder(a, b, c, d, excludeNames) {}\nconst pastMidnight = 1;\nconst rType = String(r.type || r.category || r.cuisine || "").toLowerCase();\nconst x = `[추천 ${t}]`;\n' },
      expectRule: 'R_plan4d214e83_blockModeQuality',
      expectClean: true,
    },
    {
      label: 'R_activityMetaDisplay (true positive): ActivityMetaChips unsuitable_for 배너 누락',
      base: { 'src/pages/PlanDetailPage/components/ActivityMetaChips.tsx': '// stub\n' },
      head: { 'src/pages/PlanDetailPage/components/ActivityMetaChips.tsx': 'export function ActivityMetaChips() { return <div data-testid="activity-meta" />; }\n' },
      expectRule: 'R_activityMetaDisplay',
    },
    {
      label: 'R_activityMetaDisplay (false positive 차단): unsuitable_for + data-testid 정상 — silent',
      base: { 'src/pages/PlanDetailPage/components/ActivityMetaChips.tsx': '// stub\n' },
      head: { 'src/pages/PlanDetailPage/components/ActivityMetaChips.tsx': 'export function ActivityMetaChips() { const u = meta.unsuitable_for; return <div data-testid="activity-meta">{u}</div>; }\n' },
      expectRule: 'R_activityMetaDisplay',
      expectClean: true,
    },
    {
      label: 'R_airportPickupSSOT (true positive): RouteAgent 하드코딩 REGION_TO_AIRPORT_TRANSFER_ZONE 잔존',
      base: { 'api/_ai_core/agents/RouteAgent.js': '// stub\n' },
      head: { 'api/_ai_core/agents/RouteAgent.js': 'const REGION_TO_AIRPORT_TRANSFER_ZONE = { seoul: "seoul-central" };\nexport function airportTransferPriceKRW(region) { return REGION_TO_AIRPORT_TRANSFER_ZONE[region]; }\n' },
      expectRule: 'R_airportPickupSSOT',
    },
    {
      label: 'R_airportPickupSSOT (false positive 차단): airport_transfer_regions SSOT 조회 — silent',
      base: { 'api/_ai_core/agents/RouteAgent.js': '// stub\n' },
      head: { 'api/_ai_core/agents/RouteAgent.js': 'export function airportTransferPriceKRW(region) { const spec = loadPricingSpec(); const regions = spec?.airport_transfer_regions || {}; return regions[region]; }\n' },
      expectRule: 'R_airportPickupSSOT',
      expectClean: true,
    },
    {
      label: 'R_P321: blockMode regions 정규화 누락 (raw toLowerCase → 한글 silent legacy)',
      base: { 'api/_ai_core/blockMode.js': 'const cities = regions.map((r) => String(r).split("_")[0].toLowerCase());\n' },
      head: { 'api/_ai_core/blockMode.js': 'const cities = regions.map((r) => String(r).split("_")[0].toLowerCase()); // edit\n' },
      expectRule: 'R_P321_blockModeRegionNormalize',
    },
    {
      label: 'P326 #1 (true positive): RouteAgent transit cache hit 이 isCacheGeoConsistent 지리 검증 없이 재사용',
      base: { 'api/_ai_core/agents/RouteAgent.js': '// stub\n' },
      head: {
        'api/_ai_core/agents/RouteAgent.js':
          'const cached = await lookupTransitCache(z, a, b);\n'
          + 'if (cached) return { index: i, ...cached };\n',
      },
      expectRule: 'P326_cacheGeoValidation',
    },
    {
      label: 'P326 #1 (false positive 차단): isCacheGeoConsistent 게이트 정상 — 룰 silent',
      base: { 'api/_ai_core/agents/RouteAgent.js': '// stub\n' },
      head: {
        'api/_ai_core/agents/RouteAgent.js':
          'const cached = await lookupTransitCache(z, a, b);\n'
          + 'if (cached) {\n'
          + '  const actualKm = _haversineKmPure(prev.lat, prev.lng, curr.lat, curr.lng);\n'
          + '  if (isCacheGeoConsistent(actualKm, cached)) return { index: i, ...cached };\n'
          + '}\n',
      },
      expectRule: 'P326_cacheGeoValidation',
      expectClean: true,
    },
    {
      label: 'P326 #2 (true positive): routeEnrichment merge-back 가 intercity_transit 복사 누락',
      base: { 'api/_ai_core/routeEnrichment.js': '// stub\n' },
      head: {
        'api/_ai_core/routeEnrichment.js':
          'enrichedDays.forEach((enrichedDay, i) => {\n'
          + '  const enrichedStops = enrichedDay.stops || [];\n'
          + '  if (enrichedDay.lodging_to_first) itinerary.days[i].lodging_to_first = enrichedDay.lodging_to_first;\n'
          + '});\n',
      },
      expectRule: 'P326_intercityMergeBack',
    },
    {
      label: 'P326 #2 (true positive): intercity_transit 복사가 enrichedStops 가드 뒤로 이동 (배치 불변식 위반)',
      base: { 'api/_ai_core/routeEnrichment.js': '// stub\n' },
      head: {
        'api/_ai_core/routeEnrichment.js':
          'enrichedDays.forEach((enrichedDay, i) => {\n'
          + '  const enrichedStops = enrichedDay.stops || [];\n'
          + '  if (itinerary.days[i] && enrichedDay.intercity_transit) itinerary.days[i].intercity_transit = enrichedDay.intercity_transit;\n'
          + '});\n',
      },
      expectRule: 'P326_intercityMergeBack',
    },
    {
      label: 'P326 #2 (false positive 차단): intercity 복사가 enrichedStops 앞 — 룰 silent',
      base: { 'api/_ai_core/routeEnrichment.js': '// stub\n' },
      head: {
        'api/_ai_core/routeEnrichment.js':
          'enrichedDays.forEach((enrichedDay, i) => {\n'
          + '  if (itinerary.days[i] && enrichedDay.intercity_transit) itinerary.days[i].intercity_transit = enrichedDay.intercity_transit;\n'
          + '  const enrichedStops = enrichedDay.stops || [];\n'
          + '});\n',
      },
      expectRule: 'P326_intercityMergeBack',
      expectClean: true,
    },
    {
      label: 'P327 (true positive): write 가 heroRoute 아닌 route 직접 사용 (직통 합성 무시)',
      base: { 'api/_ai_core/agents/RouteAgent.js': '// stub\n' },
      head: {
        'api/_ai_core/agents/RouteAgent.js':
          'async _buildArexExpressHero() { return { fromStationName: ax.from_station }; }\n'
          + 'if (isIcnArrival && rec.key === "arex_express") { heroRoute = await this._buildArexExpressHero(); }\n'
          + 'rawItinerary.arrival_guide.route_to_hotel = { ...route, recommended_option: rec };\n',
      },
      expectRule: 'P327_arexExpressHero',
    },
    {
      label: 'P327 (true positive): rec.key 게이트 누락 (charter/limousine 추천 덮어쓸 위험)',
      base: { 'api/_ai_core/agents/RouteAgent.js': '// stub\n' },
      head: {
        'api/_ai_core/agents/RouteAgent.js':
          'async _buildArexExpressHero() { return { fromStationName: ax.from_station }; }\n'
          + 'heroRoute = await this._buildArexExpressHero();\n'
          + 'rawItinerary.arrival_guide.route_to_hotel = { ...heroRoute, recommended_option: rec };\n',
      },
      expectRule: 'P327_arexExpressHero',
    },
    {
      label: 'P327 (false positive 차단): 게이트+heroRoute+fromStationName 정상 — 룰 silent',
      base: { 'api/_ai_core/agents/RouteAgent.js': '// stub\n' },
      head: {
        'api/_ai_core/agents/RouteAgent.js':
          'async _buildArexExpressHero() { return { fromStationName: ax.from_station }; }\n'
          + 'if (isIcnArrival && rec.key === "arex_express") { heroRoute = await this._buildArexExpressHero(); }\n'
          + 'rawItinerary.arrival_guide.route_to_hotel = { ...heroRoute, recommended_option: rec };\n',
      },
      expectRule: 'P327_arexExpressHero',
      expectClean: true,
    },
    {
      label: 'P330 (true positive): provider 기본값이 odsay 아닌 tmap (prod 의도치 않게 ship)',
      base: { 'api/_transit_provider.js': '// stub\n' },
      head: { 'api/_transit_provider.js': "export function getTransitProvider() { return (process.env.TRANSIT_PROVIDER || 'tmap').trim().toLowerCase() === 'tmap' ? 'tmap' : 'odsay'; }\n" },
      expectRule: 'P330_transitProviderSwitch',
    },
    {
      label: 'P330 (true positive): 호출부에 searchTransitRoute 직접 호출 잔존 (스위치 우회)',
      base: { 'api/recalc-transit.js': '// stub\n' },
      head: { 'api/recalc-transit.js': "import { searchTransit } from './_transit_provider.js';\nconst r = await searchTransitRoute(a, b, c, d);\n" },
      expectRule: 'P330_transitProviderSwitch',
    },
    {
      label: 'P330 (false positive 차단): provider 기본 odsay 정상 — 룰 silent',
      base: { 'api/_transit_provider.js': '// stub\n' },
      head: { 'api/_transit_provider.js': "export function getTransitProvider() { return (process.env.TRANSIT_PROVIDER || 'odsay').trim().toLowerCase() === 'tmap' ? 'tmap' : 'odsay'; }\n" },
      expectRule: 'P330_transitProviderSwitch',
      expectClean: true,
    },
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
    {
      label: 'P118: pre-push hook 부재 + setup-git-hooks.mjs 만 존재 (활성화 mechanism 만)',
      base: {
        'vite.config.ts': '// marker for isRealRepo',
        'scripts/setup-git-hooks.mjs': '// activator',
      },
      head: {
        'vite.config.ts': '// marker for isRealRepo',
        'scripts/setup-git-hooks.mjs': '// activator',
      },
      expectRule: 'P118_prePushHookContent',
    },
    {
      label: 'P118: pre-push 에서 vitest run 행 제거 — 4-piece 위반',
      base: {
        'vite.config.ts': '// marker',
        'scripts/setup-git-hooks.mjs': '// activator',
        'scripts/git-hooks/pre-push':
          '#!/bin/sh\nnpm run build\nnpx vitest run\nnpx size-limit\nnode scripts/lint-mistake-patterns.mjs origin/main\n',
      },
      head: {
        'vite.config.ts': '// marker',
        'scripts/setup-git-hooks.mjs': '// activator',
        'scripts/git-hooks/pre-push':
          '#!/bin/sh\nnpm run build\nnpx size-limit\nnode scripts/lint-mistake-patterns.mjs origin/main\n',
      },
      expectRule: 'P118_prePushHookContent',
    },
    {
      label: 'P118: pre-push + setup-git-hooks 모두 정상 4-piece — false positive 차단',
      base: {
        'vite.config.ts': '// marker',
        'scripts/setup-git-hooks.mjs': '// activator',
        'scripts/git-hooks/pre-push':
          '#!/bin/sh\nnpm run build\nnpx vitest run\nnpx size-limit\nnode scripts/lint-mistake-patterns.mjs origin/main\n',
      },
      head: {
        'vite.config.ts': '// marker',
        'scripts/setup-git-hooks.mjs': '// activator',
        'scripts/git-hooks/pre-push':
          '#!/bin/sh\nnpm run build\nnpx vitest run\nnpx size-limit\nnode scripts/lint-mistake-patterns.mjs origin/main\n',
      },
      expectRule: 'P118_prePushHookContent',
      expectClean: true, // 4-piece 갖춤 — 룰 silent (정상)
    },
    {
      label: 'P119: planPersister.js 에 backfillDayLodging export 누락',
      base: {
        'api/_ai_core/planPersister.js':
          "export function backfillStopEndTimes(it) { return 0; }\n" +
          "export function backfillDayLodging(it) { return 0; }\n",
        'api/ai-planner-full.js':
          "import { backfillStopEndTimes, backfillDayLodging } from './_ai_core/planPersister.js';\n" +
          "backfillDayLodging(itinerary);\n",
      },
      head: {
        'api/_ai_core/planPersister.js':
          "export function backfillStopEndTimes(it) { return 0; }\n",
        'api/ai-planner-full.js':
          "import { backfillStopEndTimes, backfillDayLodging } from './_ai_core/planPersister.js';\n" +
          "backfillDayLodging(itinerary);\n",
      },
      expectRule: 'P119_dayLodgingBackfill',
    },
    {
      label: 'P120: detectUnreasonableStopTimes + runUnreasonableStopTimesCheck wrapper + 1줄 호출 모두 존재 — false positive 차단',
      base: {
        'api/_ai_core/planPersister.js':
          "export function detectUnreasonableStopTimes(it) { return []; }\n" +
          "export function runUnreasonableStopTimesCheck(itinerary, body) { return 0; }\n",
        'api/ai-planner-full.js':
          "import { runUnreasonableStopTimesCheck } from './_ai_core/planPersister.js';\n" +
          "runUnreasonableStopTimesCheck(itinerary, body);\n",
      },
      head: {
        'api/_ai_core/planPersister.js':
          "export function detectUnreasonableStopTimes(it) { return []; }\n" +
          "export function runUnreasonableStopTimesCheck(itinerary, body) { return 0; }\n" +
          "// trivial change\n",
        'api/ai-planner-full.js':
          "import { runUnreasonableStopTimesCheck } from './_ai_core/planPersister.js';\n" +
          "runUnreasonableStopTimesCheck(itinerary, body);\n" +
          "// trivial change\n",
      },
      expectRule: 'P120_unreasonableStopTimeDetect',
      expectClean: true,
    },
    {
      label: 'P121: QualityWarningsPanel 에 isAdminEmail 가드 부재 — 일반 사용자 노출 위험',
      base: {
        'src/pages/PlanDetailPage/components/QualityWarningsPanel.tsx':
          "import { isAdminEmail } from '@/lib/admin';\nexport function QualityWarningsPanel(props) { if (!isAdminEmail(props.userEmail)) return null; return <div />; }\n",
        'src/pages/PlanDetailPage/index.tsx':
          "import { QualityWarningsPanel } from './components/QualityWarningsPanel';\n<QualityWarningsPanel />\n",
      },
      head: {
        'src/pages/PlanDetailPage/components/QualityWarningsPanel.tsx':
          "export function QualityWarningsPanel(props) { return <div />; }\n",
        'src/pages/PlanDetailPage/index.tsx':
          "import { QualityWarningsPanel } from './components/QualityWarningsPanel';\n<QualityWarningsPanel />\n",
      },
      expectRule: 'P121_qualityWarningsAdminPanel',
    },
    {
      label: 'P122: buildPrompt 다도시 호텔 placeholder 표 누락 — 부산/제주 city placeholder 없음',
      base: {
        'api/_ai_core/buildPrompt.js':
          "// P122 (2026-05-20):\n// | Seoul | 명동 호텔 / 홍대 호텔 |\n// | Busan | 해운대 호텔 / 광안리 호텔 |\n// | Jeju | 중문 호텔 |\n",
      },
      head: {
        'api/_ai_core/buildPrompt.js':
          "// hotel_address 단일 placeholder only\n// | Seoul | 명동 호텔 |\n",
      },
      expectRule: 'P122_multiCityLodgingPlaceholder',
    },
    {
      label: 'P123: ai-planner-full 에 hotelByCity destructure + Gemini message inject 누락',
      base: {
        'api/ai-planner-full.js':
          "const hotelByCity = (() => ({}))();\n// MULTI-CITY HOTELS BY CITY block\nbackfillDayLodging(itinerary, hotelByCity);\n",
        'api/_ai_core/planPersister.js':
          "// P123\nexport function backfillDayLodging(itinerary, hotelByCity = {}) { const hbc = hotelByCity; for (const day of itinerary.days) { const dayCityLc = day.city.toLowerCase(); if (hbc[dayCityLc]) return; } }\n",
      },
      head: {
        'api/ai-planner-full.js':
          "// hotelByCity ignored\nbackfillDayLodging(itinerary);\n",
        'api/_ai_core/planPersister.js':
          "export function backfillDayLodging(itinerary) {}\n",
      },
      expectRule: 'P123_hotelByCityForwarding',
    },
    {
      label: 'P124: buildPrompt 의 ARRIVAL DAY HANDLING (9h sleep buffer) block 누락',
      base: {
        'api/_ai_core/buildPrompt.js':
          "// ARRIVAL DAY HANDLING — STRICT (P124, 2026-05-20)\n// arrival_time + 9h sleep buffer\n// DEPARTURE DAY HANDLING — STRICT (P124, 2026-05-20)\n// GLOBAL TIME RULES — STRICT (P124-extended, 2026-05-21)\n",
        'api/_ai_core/responseValidator.js':
          "// B-LATE-ARRIVAL\nrequest.arrival_time || request.arrivalTime\n// B-EARLY-DEPARTURE\n// B-GLOBAL-DAWN\n",
      },
      head: {
        'api/_ai_core/buildPrompt.js':
          "// arrival_time 단순 hint, sleep buffer 명시 X\n",
        'api/_ai_core/responseValidator.js':
          "// B-LATE-ARRIVAL\nrequest.arrival_time || request.arrivalTime\n// B-EARLY-DEPARTURE\n// B-GLOBAL-DAWN\n",
      },
      expectRule: 'P124_arrivalDepartureSleepBuffer',
    },
    {
      label: 'P127: routeEnrichment 의 validateLodgingBookend signature 에 isMultiCity 인자 누락',
      base: {
        'api/_ai_core/routeEnrichment.js':
          "// P127 day-level anchor\nfunction validateLodgingBookend(itinerary, anchor, isMultiCity) { /* multi-city-day-anchor */ }\nvalidateLodgingBookend(itinerary, anchorCoord, isMultiCity);\n",
      },
      head: {
        'api/_ai_core/routeEnrichment.js':
          "function validateLodgingBookend(itinerary, anchor) { }\nvalidateLodgingBookend(itinerary, anchorCoord);\n",
      },
      expectRule: 'P127_lodgingBookendMultiCityAnchor',
    },
    {
      label: 'P128: ai-planner-full block-mode 분기 마커만 있고 import 누락',
      base: {
        'api/ai-planner-full.js':
          "import { runBlockModePipeline, getBlockModeEnv } from './_ai_core/blockMode.js';\nconst env = getBlockModeEnv();\nconst out = await runBlockModePipeline({adminDb, city});\nif (!itinerary) { /* legacy fallback */ }\n",
        'api/_ai_core/blockMode.js':
          "export function shouldUseBlockMode() {}\nexport function fetchAvailableBlocks() {}\nexport function expandBlocksToItinerary() { throw new Error('BLOCK_MODE_DIETARY_UNSATISFIED'); }\n",
      },
      head: {
        'api/ai-planner-full.js':
          "// PLANNER_BLOCK_MODE referenced but no import — broken integration\nif (process.env.PLANNER_BLOCK_MODE === 'enabled') runBlockModePipeline();\n",
        'api/_ai_core/blockMode.js':
          "export function shouldUseBlockMode() {}\nexport function fetchAvailableBlocks() {}\nexport function expandBlocksToItinerary() { throw new Error('BLOCK_MODE_DIETARY_UNSATISFIED'); }\n",
      },
      expectRule: 'P128_blockModeIntegration',
    },
    {
      label: 'P130: intent_classifier_logs.add 호출 누락 — 모니터링 불가',
      base: {
        'src/lib/intent-classifier-logs.ts':
          "export async function fetchRecentLogs() {}\nexport async function fetchWeeklyStats() {}\nexport async function fetchHighFallbackSamples() {}\n",
        'api/ai-planner-modify.js':
          "// P130 log\nadminDb.collection('intent_classifier_logs').add({});\n",
        'api/_crons/intent-classifier-summary.js':
          "// P130\nimport { throttledTelegramAlert } from '../_shared/telegram-throttle.js';\n// intent_classifier_logs\nthrottledTelegramAlert({key:'intent-classifier-fallback-high'});\n",
        'api/cron-runner.js':
          "// 'intent-classifier-summary'\n'intent-classifier-summary': handler\n",
        'vercel.json':
          "{ \"crons\": [ { \"path\": \"/api/cron-runner?job=intent-classifier-summary\", \"schedule\": \"0 21 * * 1\" } ] }\n",
      },
      head: {
        'src/lib/intent-classifier-logs.ts':
          "export async function fetchRecentLogs() {}\nexport async function fetchWeeklyStats() {}\nexport async function fetchHighFallbackSamples() {}\n",
        'api/ai-planner-modify.js':
          "// log 호출 제거\nreturn ok();\n",
        'api/_crons/intent-classifier-summary.js':
          "// P130\nimport { throttledTelegramAlert } from '../_shared/telegram-throttle.js';\n// intent_classifier_logs\nthrottledTelegramAlert({key:'intent-classifier-fallback-high'});\n",
        'api/cron-runner.js':
          "// 'intent-classifier-summary'\n'intent-classifier-summary': handler\n",
        'vercel.json':
          "{ \"crons\": [ { \"path\": \"/api/cron-runner?job=intent-classifier-summary\", \"schedule\": \"0 21 * * 1\" } ] }\n",
      },
      expectRule: 'P130_intentClassifierMonitoring',
    },
    {
      label: 'P132: PR template 의 "사전 영향 분석" 섹션 누락 — 사람 review 가드 회귀',
      base: {
        '.github/pull_request_template.md':
          "## Summary\n\n## 사전 영향 분석 (Impact Analysis)\n\n**직접 수정 영역:**\n- ...\n\n**간접 영향 가능 영역 (호출 체인):**\n- ...\n\n## 가장 취약한 부분 (Most Fragile Spot)\n\n- ...\n",
      },
      head: {
        '.github/pull_request_template.md':
          "## Summary\n\n## Test plan\n- ...\n",
      },
      expectRule: 'P132_prDescriptionImpactSections',
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
// P138-P145 lint rules (R-P138 ~ R-P145, 2026-05-22 세션 fix 박제)
// ----------------------------------------------------------------------------

/**
 * P138_routeEnrichPhase1Parallel — 메모리 P138 (2026-05-22, PR #524).
 * RouteAgent.js Phase 1 (Naver Geocoding) 의 sequential `for (const place of places)`
 * → `Promise.all(places.map(async (place) => ...))` 병렬화. Vercel 5분 cap 차단.
 * 회귀 슬롯: tests/unit/route-agent-phase1-parallel-p138.test.ts (7 케이스).
 */
function P138_routeEnrichPhase1Parallel({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  // Phase 1 부분이 Promise.all(places.map(async (place)...)) 패턴 사용 강제.
  if (!/Phase 1[\s\S]{0,2000}await Promise\.all\(places\.map\(async \(place\) =>/.test(content)) {
    violations.push(`${FILE}: Phase 1 (Naver Geocoding) 의 outer loop = Promise.all(places.map(async (place))) 누락 — sequential 회귀 (Vercel 5분 cap 임박)`);
  }
  // 이전 for-of + axios.get(geoUrl) 회귀 패턴 부재 강제.
  if (/for \(const place of places\)\s*\{[\s\S]{0,500}axios\.get\([^)]*geoUrl/.test(content)) {
    violations.push(`${FILE}: 이전 sequential geocoding 회귀 패턴 (for-of + axios.get(geoUrl)) 잔존 — 병렬화 안 됨`);
  }
  if (violations.length > 0) {
    fail(
      'P138_routeEnrichPhase1Parallel',
      violations.join(' | '),
      '메모리 P138 — Phase 1 Naver Geocoding 병렬화. for-of → Promise.all(places.map). Vercel 5분 cap 차단. tests/unit/route-agent-phase1-parallel-p138.test.ts.',
    );
  }
  return null;
}

/**
 * P139_airportBookendException — 메모리 P139 (2026-05-22, PR #526).
 * validateLodgingBookend 의 airport_transfer/airport 카테고리 false-positive 차단.
 * isAirportTransferStop helper + multi-city / 단도시 양쪽 분기 skip.
 * 회귀 슬롯: tests/unit/route-enrichment-airport-bookend-p139.test.ts (17 케이스).
 */
function P139_airportBookendException({ changed }) {
  const FILE = 'api/_ai_core/routeEnrichment.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  if (!/function\s+isAirportTransferStop/.test(content)) {
    violations.push(`${FILE}: isAirportTransferStop helper 누락 — multi-city Day N airport false-positive 회귀`);
  }
  if (!/cat\s*===\s*['"]airport_transfer['"]\s*\|\|\s*cat\s*===\s*['"]airport['"]/.test(content)) {
    violations.push(`${FILE}: isAirportTransferStop 의 'airport_transfer' || 'airport' 양쪽 매칭 누락`);
  }
  // multi-city + 단도시 양쪽 분기에 isAirportTransferStop check 적용 강제.
  const skipMatches = content.match(/isAirportTransferStop\([^)]+\)\s*\?\s*null\s*:\s*distanceMeters/g) || [];
  if (skipMatches.length < 4) {
    violations.push(`${FILE}: isAirportTransferStop skip 패턴 ${skipMatches.length}회 등장 — 양쪽 분기 (multi-city/단도시) × first/last = 최소 4회 필요`);
  }
  if (violations.length > 0) {
    fail(
      'P139_airportBookendException',
      violations.join(' | '),
      '메모리 P139 — airport_transfer category skip. plan 9845a69e Day 5 인천공항 349km false-positive 차단. tests/unit/route-enrichment-airport-bookend-p139.test.ts.',
    );
  }
  return null;
}

/**
 * P140_perDayLodgingLabel — 메모리 P140 (2026-05-22, PR #522).
 * DayTimeline.tsx 의 getLodgingLabel(plan) 단일 plan-level 회귀 → getLodgingLabelForDay
 * (plan, day) 5-layer 폴백 (day.lodging → hotelByCity → hotel_address → zone).
 */
function P140_perDayLodgingLabel({ changed }) {
  const FILE = 'src/pages/PlanDetailPage/components/DayTimeline.tsx';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  if (!/function\s+getLodgingLabelForDay/.test(content)) {
    violations.push(`${FILE}: getLodgingLabelForDay 헬퍼 누락 — 단일 getLodgingLabel(plan) 회귀 (다도시 부산 day 가 서울 명동역 노출)`);
  }
  // 이전 회귀: getLodgingLabel(plan) 단일 호출 (day 인자 없음) 패턴 부재 강제.
  if (/getLodgingLabel\(\s*plan\s*\)/.test(content) && !/getLodgingLabelForDay/.test(content)) {
    violations.push(`${FILE}: getLodgingLabel(plan) 회귀 패턴 잔존 — getLodgingLabelForDay(plan, day) 로 교체 필수`);
  }
  // hotelByCity 분기 존재 강제.
  if (!/hotelByCity/.test(content)) {
    violations.push(`${FILE}: hotelByCity 폴백 분기 누락 — 다도시 도시별 호텔 라벨 미반영`);
  }
  if (violations.length > 0) {
    fail(
      'P140_perDayLodgingLabel',
      violations.join(' | '),
      '메모리 P140 — getLodgingLabelForDay 5-layer 폴백 (day.lodging → hotelByCity → hotel_address → zone_address → zone). 다도시 plan 도시 mismatch 차단.',
    );
  }
  return null;
}

/**
 * P141_lodgingBookendDedup — 메모리 P141 (2026-05-22, PR #522).
 * 첫/마지막 stop 자체가 category='lodging' 이면 day-level LodgingBookend skip
 * (hotel→hotel hop redundant). stops[0]?.category !== 'lodging' guard.
 */
function P141_lodgingBookendDedup({ changed }) {
  const FILE = 'src/pages/PlanDetailPage/components/DayTimeline.tsx';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  // day.lodging_to_first 가드 + stops[0]?.category !== 'lodging' 확인.
  if (/day\.lodging_to_first\s*&&\s*stops\.length\s*>\s*0\s*&&\s*\(/.test(content)) {
    // dedup 가드 없으면 회귀.
    if (!/day\.lodging_to_first\s*&&\s*stops\.length\s*>\s*0\s*&&\s*stops\[0\]\?\.category\s*!==\s*['"]lodging['"]/.test(content)) {
      violations.push(`${FILE}: day.lodging_to_first BookEnd 의 stops[0]?.category !== 'lodging' guard 누락 — hotel→hotel 4중 카드 회귀`);
    }
  }
  if (/day\.last_to_lodging\s*&&\s*stops\.length\s*>\s*0\s*&&\s*\(/.test(content)) {
    if (!/day\.last_to_lodging\s*&&\s*stops\.length\s*>\s*0\s*&&\s*stops\[stops\.length\s*-\s*1\]\?\.category\s*!==\s*['"]lodging['"]/.test(content)) {
      violations.push(`${FILE}: day.last_to_lodging BookEnd 의 stops[last]?.category !== 'lodging' guard 누락 — hotel→hotel 4중 카드 회귀`);
    }
  }
  if (violations.length > 0) {
    fail(
      'P141_lodgingBookendDedup',
      violations.join(' | '),
      '메모리 P141 — LodgingBookend dedup. 첫/마지막 stop 이 lodging stop 이면 day-level BookEnd skip. 4중 카드 회귀 차단.',
    );
  }
  return null;
}

/**
 * P142_arrivalDepartureTerminalSplit — 메모리 P142 (2026-05-22, PR #522).
 * Wizard 의 `const departureAirport = arrivalTerminal` 하드코딩 회귀.
 * departureTerminal state 분리 + 입국=출국 강제 차단.
 */
function P142_arrivalDepartureTerminalSplit({ changed }) {
  const FILE = 'src/components/WizardForm/index.tsx';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  // 이전 회귀: const departureAirport = arrivalTerminal; (단순 동일 할당)
  if (/const\s+departureAirport\s*=\s*arrivalTerminal\s*;/.test(content)) {
    violations.push(`${FILE}: const departureAirport = arrivalTerminal 하드코딩 회귀 — 입국=출국 강제 (운영자 5/22 신고)`);
  }
  // departureTerminal state 존재 강제.
  if (!/const \[departureTerminal,\s*setDepartureTerminal\]\s*=\s*useState/.test(content)) {
    violations.push(`${FILE}: departureTerminal state 누락 — 입국/출국 공항 분리 불가`);
  }
  if (violations.length > 0) {
    fail(
      'P142_arrivalDepartureTerminalSplit',
      violations.join(' | '),
      '메모리 P142 — 입국/출국 공항 분리. departureTerminal state + departureAirport=departureTerminal||arrivalTerminal 폴백. 운영자 "T1 입국인데 출국도 T1" 회귀 차단.',
    );
  }
  return null;
}

/**
 * P143_intercityFirstStopGap — 메모리 P143 (2026-05-22, PR #522).
 * planPersister.js 의 detectIntercityFirstStopGap + pushIntercityGapWarnings
 * + postResponsePipeline.js 의 hook + DayTimeline computeLodgingRole 5번째 인자.
 */
function P143_intercityFirstStopGap({ changed }) {
  const violations = [];
  const PP = 'api/_ai_core/planPersister.js';
  if (isModified(PP, changed)) {
    const content = getChangedFileContent(PP);
    if (content) {
      if (!/function\s+detectIntercityFirstStopGap/.test(content)) {
        violations.push(`${PP}: detectIntercityFirstStopGap 함수 누락 — KTX 도착→첫 stop 90min+ 공백 detect 부재`);
      }
      if (!/function\s+pushIntercityGapWarnings/.test(content)) {
        violations.push(`${PP}: pushIntercityGapWarnings 함수 누락 — quality_warnings push 부재`);
      }
    }
  }
  const PIPE = 'api/_ai_core/postResponsePipeline.js';
  if (isModified(PIPE, changed)) {
    const content = getChangedFileContent(PIPE);
    if (content && /backfillDayLodging/.test(content)) {
      if (!/pushIntercityGapWarnings\(itinerary\)/.test(content)) {
        violations.push(`${PIPE}: applyBackfillsAndTmoney 안에서 pushIntercityGapWarnings 호출 누락`);
      }
    }
  }
  const DT = 'src/pages/PlanDetailPage/components/DayTimeline.tsx';
  if (isModified(DT, changed)) {
    const content = getChangedFileContent(DT);
    if (content && /computeLodgingRole/.test(content)) {
      // P143 신규 5번째 인자 또는 P116 기존 4번째 인자 시그니처 둘 다 OK.
      // P116 lint 와 동일 패턴 사용 (이미 lint-mistake-patterns 의 다른 룰이 검증).
    }
  }
  if (violations.length > 0) {
    fail(
      'P143_intercityFirstStopGap',
      violations.join(' | '),
      '메모리 P143 — intercity KTX→첫 stop 90min+ 공백 detect. detectIntercityFirstStopGap + pushIntercityGapWarnings + applyBackfillsAndTmoney hook.',
    );
  }
  return null;
}

/**
 * P144_transitFallbackDetail — 메모리 P144-continued (2026-05-22, PR #525).
 * RouteAgent ODsay null fallback 의 step_by_step 빈 배열 회귀.
 * enrichedSteps + 카카오T 권장 + 야간 라벨 stub.
 */
function P144_transitFallbackDetail({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  if (!/let enrichedSteps/.test(content)) {
    violations.push(`${FILE}: enrichedSteps 변수 누락 — step_by_step 빈 배열 회귀 ("차량 17분" 단순 표시)`);
  }
  if (!/카카오T/.test(content)) {
    violations.push(`${FILE}: 카카오T 권장 stub 텍스트 누락 — 택시 권장 미표시`);
  }
  if (!/막차 종료/.test(content)) {
    violations.push(`${FILE}: 야간 라벨 (막차 종료) 누락`);
  }
  if (violations.length > 0) {
    fail(
      'P144_transitFallbackDetail',
      violations.join(' | '),
      '메모리 P144-continued — ODsay null fallback step_by_step enrichment. 거리/택시 추정/카카오T/야간 라벨 stub.',
    );
  }
  return null;
}

/**
 * P145_cityChangeTimeClamp — 메모리 P145 (2026-05-22, PR #523).
 * Phase 3 의 Math.max(arrival+30, Gemini) → upper-bound cap (lodging +240 /
 * activity +90) 추가. KTX 12:15 도착 → 첫 stop 17:43 5h+ 공백 root cause 차단.
 */
function P145_cityChangeTimeClamp({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };
  const violations = [];
  if (!/firstIsLodging/.test(content)) {
    violations.push(`${FILE}: firstIsLodging 변수 누락 — P145 clamp logic 부재 (KTX 5h+ 공백 회귀)`);
  }
  if (!/upperBound\s*=\s*arrivalMin\s*\+\s*\(\s*firstIsLodging\s*\?\s*240\s*:\s*90\s*\)/.test(content)) {
    violations.push(`${FILE}: upperBound = arrivalMin + (firstIsLodging ? 240 : 90) clamp logic 누락`);
  }
  if (!/Math\.max\(lowerBound,\s*Math\.min\(geminiFirstMin,\s*upperBound\)\)/.test(content)) {
    violations.push(`${FILE}: Math.max(lowerBound, Math.min(geminiFirstMin, upperBound)) clamp 패턴 누락`);
  }
  if (violations.length > 0) {
    fail(
      'P145_cityChangeTimeClamp',
      violations.join(' | '),
      '메모리 P145 — city-change day 첫 stop 시각 upper-bound clamp. lodging +240 / activity +90. plan 209de47b 5h+ 공백 회귀의 root cause 차단.',
    );
  }
  return null;
}

/**
 * P168_pass3BackgroundAsync — 메모리 P168 (2026-05-23).
 *
 * 3-pass Pass3 (식당 tip enrichment) 를 plan Firestore 저장 후 background job 으로 분리.
 * env flag PLANNER_PASS3_BACKGROUND default false (안전). 사용자 응답 -30~60초 단축.
 *
 * 검증:
 *   - geminiPipeline.js 수정 시: isPass3BackgroundEnabled 함수 존재 + _pass3_pending 마킹 분기 존재
 *   - planPersister.js 수정 시: updatePlanEnrichment 함수 존재
 *   - handlerCore.js 수정 시: _pass3_pending 체크 분기 + updatePlanEnrichment 호출 존재
 *
 * 회귀 시: -30~60초 단축 효과 손실. tip 미표시.
 */
function P168_pass3BackgroundAsync({ changed }) {
  const violations = [];

  const GP = 'api/_ai_core/geminiPipeline.js';
  if (isModified(GP, changed)) {
    const content = getChangedFileContent(GP);
    if (content) {
      if (!/function\s+isPass3BackgroundEnabled/.test(content)) {
        violations.push(`${GP}: isPass3BackgroundEnabled 함수 누락 — P168 env flag 분기 부재`);
      }
      if (!/_pass3_pending\s*=\s*true/.test(content)) {
        violations.push(`${GP}: _pass3_pending = true 마킹 누락 — Pass3 background 표시 불가`);
      }
      if (!/isPass3BackgroundEnabled\(\)/.test(content)) {
        violations.push(`${GP}: isPass3BackgroundEnabled() 호출 누락 — flag 체크 없이 항상 sync 또는 항상 async`);
      }
    }
  }

  const PP = 'api/_ai_core/planPersister.js';
  if (isModified(PP, changed)) {
    const content = getChangedFileContent(PP);
    if (content) {
      if (!/function\s+updatePlanEnrichment|async function updatePlanEnrichment/.test(content)) {
        violations.push(`${PP}: updatePlanEnrichment 함수 누락 — background Pass3 결과를 Firestore 에 반영 불가`);
      }
    }
  }

  const HC = 'api/_ai_core/handlerCore.js';
  if (isModified(HC, changed)) {
    const content = getChangedFileContent(HC);
    if (content) {
      // P170 (2026-05-23): Pass3 background pipeline 은 backgroundPipelines.js 로 추출됨.
      // handlerCore 는 triggerPass3BackgroundIfPending 호출만 (inline IIFE 금지).
      if (!/triggerPass3BackgroundIfPending/.test(content)) {
        violations.push(`${HC}: triggerPass3BackgroundIfPending 호출 누락 — P170 추출 후 backgroundPipelines.js 위임 의무. (_pass3_pending inline IIFE 재도입 금지)`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      'P168_pass3BackgroundAsync',
      violations.join(' | '),
      'P168 회귀 — Pass3 background flag 분기 누락. 다시 sync 호출 시 -30~60s 단축 효과 손실. tip/recommended_items 지연 표시 불가.',
    );
  }
  return null;
}

// ── P189 (2026-05-25) — Allergen Schema Safety (SAFETY-CRITICAL) ─────────────
/**
 * P189_allergenSchemaSafety — SAFETY-CRITICAL (2026-05-25)
 *
 * _food_helper.js 의 getTagsForDiet 에서 Nuts/Shellfish/Gluten/Dairy 가
 * 'general' 로 fallback 되면 fail.
 *
 * 배경: 위자드 Step2 알레르기 4종 선택 → getTagsForDiet → 'general' 폴백 →
 *       일반 식당 무작위 추천 → 견과 알레르기 손님께 견과 식당 추천 가능 = 건강 위험.
 *
 * 검사:
 *   1. _food_helper.js 수정 시: Nuts/Shellfish/Gluten/Dairy case 에 'general' 폴백 없음
 *   2. _food_helper.js 수정 시: filterByAllergens 함수 존재
 *   3. _food_helper.js 수정 시: ALLERGEN_KEYS 상수 존재
 */
function P189_allergenSchemaSafety({ changed }) {
  const FILE = 'api/_food_helper.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const violations = [];

  // 검사 1: Nuts/Shellfish/Gluten/Dairy case 에서 'general' 로 폴백하는 패턴 금지.
  const ALLERGEN_CASES = ['Nuts', 'Shellfish', 'Gluten', 'Dairy'];
  for (const allergen of ALLERGEN_CASES) {
    const caseStartRe = new RegExp(`case\\s+['"]${allergen}['"]\\s*:`);
    const caseStart = caseStartRe.exec(content);
    if (!caseStart) {
      violations.push(
        `${FILE}: '${allergen}' case 블록 없음 — 알레르기 처리 코드 누락 (P189 SAFETY-CRITICAL)`
      );
      continue;
    }
    const afterCase = content.slice(caseStart.index + caseStart[0].length);
    const breakIdx = afterCase.indexOf('break;');
    const caseBlock = breakIdx >= 0 ? afterCase.slice(0, breakIdx) : afterCase.slice(0, 300);

    const hasAllergenHandling = /allergenPrefs|ALLERGEN_TAG_PREFIX/.test(caseBlock);
    if (!hasAllergenHandling) {
      violations.push(
        `${FILE}: '${allergen}' case 블록에 allergenPrefs 또는 ALLERGEN_TAG_PREFIX 참조 없음 — 'general' 폴백 위험 (P189 SAFETY-CRITICAL)`
      );
    }

    if (/tags\.add\(['"]general['"]\)/.test(caseBlock)) {
      violations.push(
        `${FILE}: '${allergen}' case 블록 내 tags.add('general') 직접 호출 — 알레르기 손님 일반 식당 추천 위험 (P189 SAFETY-CRITICAL)`
      );
    }
  }

  // 검사 2: filterByAllergens 함수 존재
  if (!/function\s+filterByAllergens/.test(content)) {
    violations.push(
      `${FILE}: filterByAllergens 함수 누락 — allergens 필드 기반 식당 제외 불가 (P189)`
    );
  }

  // 검사 3: ALLERGEN_KEYS 상수 존재
  if (!/ALLERGEN_KEYS/.test(content)) {
    violations.push(
      `${FILE}: ALLERGEN_KEYS 상수 누락 — 알레르기 키 목록 관리 불가 (P189)`
    );
  }

  if (violations.length > 0) {
    fail(
      'P189_allergenSchemaSafety',
      violations.join(' | '),
      'P189 SAFETY-CRITICAL — 알레르기 4종 (Nuts/Shellfish/Gluten/Dairy) 은 general 폴백 금지. allergen:<name> 태그 + filterByAllergens + ALLERGEN_KEYS 필수. 메뉴판에 알레르기 표시 없이 견과 손님께 견과 식당 추천 = 건강 위험.',
    );
  }
  return null;
}

// ── P190 (2026-05-25) — Attractions helper usage guard ───────────────────────
/**
 * P190_attractionsHelperUsage — 메모리 P190 (2026-05-25).
 *
 * buildPrompt.js 의 STYLE-DRIVEN 섹션에 Temple/FreeMuseum/Night 키워드가 있으면
 * handlerCore.js 에서 _attractions_helper import + getAttractionsContext 호출 필수.
 * 누락 시 dead data 130 row 가 다시 prompt 에 연결되지 않음 (silent hallucination 회귀).
 */
function P190_attractionsHelperUsage({ changed }) {
  const BP = 'api/_ai_core/buildPrompt.js';
  const HC = 'api/_ai_core/handlerCore.js';
  const UMB = 'api/_ai_core/userMessageBuilder.js';
  const anyModified = isModified(BP, changed) || isModified(HC, changed) || isModified(UMB, changed);
  if (!anyModified) return null;

  const violations = [];

  const bpContent = getChangedFileContent(BP) || readFileExists(BP);
  if (bpContent) {
    const hasStyleDriven = /STYLE-DRIVEN/.test(bpContent);
    if (hasStyleDriven) {
      if (!/Temple.*VERIFIED ATTRACTIONS DATABASE/s.test(bpContent)) {
        violations.push('buildPrompt.js: Temple 스타일 STYLE-DRIVEN 섹션에 VERIFIED ATTRACTIONS DATABASE 주입 지시 없음 — P190 hallucination 차단 무효');
      }
      if (!/FreeMuseum.*VERIFIED ATTRACTIONS DATABASE/s.test(bpContent)) {
        violations.push('buildPrompt.js: FreeMuseum 스타일 STYLE-DRIVEN 섹션에 VERIFIED ATTRACTIONS DATABASE 주입 지시 없음 — P190 hallucination 차단 무효');
      }
      if (!/Night.*VERIFIED ATTRACTIONS DATABASE/s.test(bpContent)) {
        violations.push('buildPrompt.js: Night 스타일 STYLE-DRIVEN 섹션에 VERIFIED ATTRACTIONS DATABASE 주입 지시 없음 — P190 hallucination 차단 무효');
      }
    }
  }

  const hcContent = getChangedFileContent(HC) || readFileExists(HC);
  if (hcContent) {
    if (!/_attractions_helper/.test(hcContent)) {
      violations.push('handlerCore.js: _attractions_helper import 없음 — attractions context 주입 불가. P190 dead data 130 row 미사용.');
    }
    if (!/getAttractionsContext/.test(hcContent)) {
      violations.push('handlerCore.js: getAttractionsContext 호출 없음 — Temple/FreeMuseum/Night 스타일 시 DB 활용 안 됨.');
    }
    if (!/getAttractionsContext\s*\(\s*\{[^}]*styles/.test(hcContent)) {
      violations.push('handlerCore.js: getAttractionsContext 호출에 styles 인자 누락 — 스타일 필터링 불가.');
    }
  }

  const umbContent = getChangedFileContent(UMB) || readFileExists(UMB);
  if (umbContent) {
    if (!/attractionsContext/.test(umbContent)) {
      violations.push('userMessageBuilder.js: attractionsContext 파라미터 없음 — prompt 에 attractions context 미주입.');
    }
  }

  if (violations.length > 0) {
    fail(
      'P190_attractionsHelperUsage',
      violations.join(' | '),
      'P190 회귀 — _attractions_helper.js 130 row DB 가 Gemini prompt 에 연결 안 됨. Temple/FreeMuseum/Night hallucination 차단 무효.',
    );
  }
  return null;
}

/** 변경되지 않은 파일도 읽을 수 있는 헬퍼 (lint 규칙에서 다른 파일 cross-check 시). */
function readFileExists(filePath) {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
// ----------------------------------------------------------------------------
// P194_buildPromptSize — buildPrompt.js 크기 회귀 차단 (2026-05-25)
// 5/25 sweep: buildSystemPrompt() 45,410 chars → 28,266 chars (-37.8%) 압축.
// 이후 prompt 추가 시 50K 초과 warn / 55K 초과 fail.
// ----------------------------------------------------------------------------
/**
 * P194_buildPromptSize — buildPrompt.js file size 회귀 차단.
 * buildPrompt.js 가 변경됐을 때 파일 크기 기준:
 *   > 50,000 chars → WARN (비용 증가 시작 구간)
 *   > 55,000 chars → FAIL (Gemini latency +3~8s + input token 비용 급증)
 *
 * 트리거: api/_ai_core/buildPrompt.js 변경 시.
 */
function P194_buildPromptSize({ changed }) {
  const FILE = 'api/_ai_core/buildPrompt.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const content = readFileExists(FILE);
  if (!content) return { skipped: true };

  const chars = content.length;

  if (chars > 55000) {
    return {
      id: 'P194_buildPromptSize',
      severity: 'error',
      file: FILE,
      message:
        `R-P194: buildPrompt.js ${chars.toLocaleString()} chars > 55,000 — Gemini input token 비용 급증 + latency +3~8s. ` +
        '5/25 sweep 기준 28K 목표. SAFETY-CRITICAL 섹션(P189/P190/P191/LODGING BOOKEND/dietary)만 유지하고 중복 강조 제거.',
    };
  }

  if (chars > 50000) {
    return {
      id: 'P194_buildPromptSize',
      severity: 'warn',
      file: FILE,
      message:
        `R-P194: buildPrompt.js ${chars.toLocaleString()} chars > 50,000 — Gemini input token 비용 증가 구간. ` +
        '압축 여지 검토 권장. SAFETY-CRITICAL 섹션은 보존 필수.',
    };
  }

  return null;
}

// ----------------------------------------------------------------------------
// P195_cacheInstrumentation — Gemini implicit cache metadata 추출 회귀 차단 (2026-05-25)
//
// Phase 0 PR — explicit caching 도입 전 prod hit rate 측정 instrumentation.
// geminiPipeline.js 의 generateContent + retry 호출 / debugInfo.js 의 buildAdminDebug
// 에서 cache metadata 추출/노출 로직이 제거되면 1주일 측정 데이터가 무효 → Phase 1
// 의사결정 (explicit caching 도입 여부) 불가.
// ----------------------------------------------------------------------------

/**
 * P195_cacheInstrumentation — implicit cache metadata 추출/노출 유지 검사.
 *
 * 트리거:
 *   - api/_ai_core/geminiPipeline.js 변경 시 → extractCacheMetadata / accumulateCacheMetadata / logCacheMetrics export 유지
 *   - api/_ai_core/debugInfo.js 변경 시 → buildAdminDebug 가 cacheMetadata 매개변수 받고 cachedInputTokens/cacheHitRate 노출
 */
function P195_cacheInstrumentation({ changed }) {
  const PIPELINE = 'api/_ai_core/geminiPipeline.js';
  const DEBUG_INFO = 'api/_ai_core/debugInfo.js';

  const pipelineChanged = isModified(PIPELINE, changed);
  const debugChanged = isModified(DEBUG_INFO, changed);
  if (!pipelineChanged && !debugChanged) return { skipped: true };

  const issues = [];

  if (pipelineChanged) {
    const src = readFileExists(PIPELINE) || '';

    // 1. extractCacheMetadata export 유지
    if (!/export\s+function\s+extractCacheMetadata/.test(src)) {
      issues.push('extractCacheMetadata helper export 누락 — P195 instrumentation 손상');
    }
    // 2. accumulateCacheMetadata export 유지
    if (!/export\s+function\s+accumulateCacheMetadata/.test(src)) {
      issues.push('accumulateCacheMetadata helper export 누락 — retry 누적 손상');
    }
    // 3. logCacheMetrics export 유지
    if (!/export\s+function\s+logCacheMetrics/.test(src)) {
      issues.push('logCacheMetrics helper export 누락 — Vercel logs grep 손상');
    }
    // 4. itinerary._cache_metadata 부착 유지
    if (!/itinerary\._cache_metadata\s*=\s*cacheMetadata/.test(src)) {
      issues.push('itinerary._cache_metadata 부착 누락 — handlerCore 가 cacheMetadata 받을 수 없음');
    }
    // 5. legacy + retry 분기에서 extractCacheMetadata 호출 (최소 2회 — legacy initial + 최소 1 retry)
    const extractCalls = (src.match(/extractCacheMetadata\(/g) || []).length;
    if (extractCalls < 3) {  // 정의 1 + legacy 1 + retry 최소 1 = 3
      issues.push(`extractCacheMetadata 호출 ${extractCalls}회 — legacy + 2 retry 분기 누락 가능 (최소 3회 필요)`);
    }
  }

  if (debugChanged) {
    const src = readFileExists(DEBUG_INFO) || '';

    // 1. itinerary 매개변수 수신 (handlerCore.js cap 500 위해 _cache_metadata pop 책임이 debugInfo 로 이동)
    if (!/itinerary/.test(src) || !/_cache_metadata/.test(src)) {
      issues.push('buildAdminDebug itinerary 매개변수 또는 _cache_metadata pop 누락 — _debug 응답에 cache 정보 노출 X');
    }
    // 2. cachedInputTokens 노출 유지
    if (!/cachedInputTokens/.test(src)) {
      issues.push('_debug.cachedInputTokens 노출 누락 — measure script 통계 수집 손상');
    }
    // 3. cacheHitRate 노출 유지
    if (!/cacheHitRate/.test(src)) {
      issues.push('_debug.cacheHitRate 노출 누락 — Phase 0 측정 판정 (70% / 30%) 불가');
    }
  }

  if (issues.length === 0) return null;

  return {
    id: 'P195_cacheInstrumentation',
    severity: 'error',
    file: pipelineChanged ? PIPELINE : DEBUG_INFO,
    message:
      'R-P195: Gemini implicit cache metadata instrumentation 손상 — Phase 0 측정 무효. ' +
      'explicit caching 도입 의사결정 (1주일 [P195 CACHE_METRICS] log grep + _debug.cacheHitRate 통계) 불가. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P266_cacheMetadataPersist — P195 cache instrumentation persistence 회귀 차단 (2026-05-28)
//
// P266 cycle root cause (5/25 P195 머지 후 1주 prod 측정 0건):
//   - planPersister.js docToSave 가 _debug.cacheMetrics root field persist 안 함
//   - itinerary._cache_metadata hidden mutation (geminiPipeline.js:1515) 의존
//   - Inngest worker dispatch path 의 step output store reconstruction layer 통과 시 marker 손실 가능
//   - 결과: 100 plans 중 root _debug 0/100, itinerary._cache_metadata 10/100 (legacy 51 plans 의 20%)
//
// P266 진짜 fix: explicit `cacheMetadata` 인자 4-layer pass-through.
//   1. planPersister.js#persistPlan: cacheMetadata 인자 + docToSave._debug.cacheMetrics root field
//   2. handlerCore.js:394 savePlan call: cacheMetadata: itinerary?._cache_metadata || null
//   3. inngestDispatch.js#buildPlanAiCompletePayload: ctx.cacheMetadata explicit field
//   4. processPlanAfterAI.js:219 worker savePlan call: cacheMetadata: ctx.cacheMetadata || itinAfterBackfill?._cache_metadata || null
//
// 5/28 P259 lesson 재발 차단 (측정 marker reconstruction layer 함정).
// ----------------------------------------------------------------------------

function P266_cacheMetadataPersist({ changed }) {
  const PERSISTER = 'api/_ai_core/planPersister.js';
  const HANDLER = 'api/_ai_core/handlerCore.js';
  const DISPATCH = 'api/_ai_core/inngestDispatch.js';
  const WORKER = 'api/_inngest/functions/processPlanAfterAI.js';

  const persisterChanged = isModified(PERSISTER, changed);
  const handlerChanged = isModified(HANDLER, changed);
  const dispatchChanged = isModified(DISPATCH, changed);
  const workerChanged = isModified(WORKER, changed);
  if (!persisterChanged && !handlerChanged && !dispatchChanged && !workerChanged) return { skipped: true };

  const issues = [];

  if (persisterChanged) {
    const src = readFileExists(PERSISTER) || '';
    if (!/persistPlan\s*\(\s*adminDb\s*,\s*\{[\s\S]*?cacheMetadata[\s\S]*?\}\s*\)/.test(src)) {
      issues.push('planPersister.js: persistPlan 가 cacheMetadata 인자 누락 — P266 explicit pass-through 깨짐');
    }
    if (!/_debug:\s*\{[\s\S]*?cacheMetrics:\s*\{/.test(src)) {
      issues.push('planPersister.js: docToSave._debug.cacheMetrics root field persist 코드 누락 — P265 measurement script 손상');
    }
    if (!/cacheHitRate:\s*cacheMetadata\.total\s*>\s*0/.test(src)) {
      issues.push('planPersister.js: cacheHitRate 계산식 누락 — Phase 1 의사결정 baseline 손상');
    }
    if (!/persistedAt:\s*Date\.now\(\)/.test(src)) {
      issues.push('planPersister.js: persistedAt timestamp 누락 — 측정 시점 추적 불가');
    }
    if (!/cacheMetadata\s*&&\s*typeof\s*cacheMetadata\s*===\s*['"]object['"]\s*&&\s*cacheMetadata\.total\s*>\s*0/.test(src)) {
      issues.push('planPersister.js: cacheMetadata silent skip guard (null / total<=0) 누락 — block_mode false positive 위험');
    }
  }

  if (handlerChanged) {
    const src = readFileExists(HANDLER) || '';
    if (!/cacheMetadata:\s*itinerary\?\._cache_metadata\s*\|\|\s*null/.test(src)) {
      issues.push('handlerCore.js: savePlan call 의 cacheMetadata: itinerary?._cache_metadata || null 명시 누락 — 비스트리밍 분기 persist 손실');
    }
  }

  if (dispatchChanged) {
    const src = readFileExists(DISPATCH) || '';
    if (!/const\s+cacheMetadata\s*=\s*\(itinerary\s*&&\s*itinerary\._cache_metadata\)\s*\|\|\s*null/.test(src)) {
      issues.push('inngestDispatch.js: buildPlanAiCompletePayload 의 cacheMetadata 추출 코드 누락 — worker dispatch path persist 손실');
    }
    if (!/\.\.\.\(cacheMetadata\s*\?\s*\{\s*cacheMetadata\s*\}\s*:\s*\{\s*\}\)/.test(src)) {
      issues.push('inngestDispatch.js: ctx.cacheMetadata explicit field 누락 — worker step output store reconstruction 통과 보장 손상');
    }
  }

  if (workerChanged) {
    const src = readFileExists(WORKER) || '';
    if (!/cacheMetadata:\s*ctx\.cacheMetadata\s*\|\|\s*itinAfterBackfill\?\._cache_metadata\s*\|\|\s*null/.test(src)) {
      issues.push('processPlanAfterAI.js: worker savePlan 의 cacheMetadata fallback chain (ctx → itinAfterBackfill → null) 누락');
    }
  }

  if (issues.length === 0) return null;

  return {
    id: 'P266_cacheMetadataPersist',
    severity: 'error',
    file: persisterChanged ? PERSISTER : (handlerChanged ? HANDLER : (dispatchChanged ? DISPATCH : WORKER)),
    message:
      'R-P266: P195 cache instrumentation persistence 4-layer pass-through 깨짐 — 1주 prod 측정 0건 회귀 위험. ' +
      '5/28 P266 cycle (100 plans inspect: root _debug 0/100, itinerary._cache_metadata 10/100) lesson 재발. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P267_streamingChunkUsageMetadataFallback — runGeminiStreaming chunk-level fallback (2026-05-29)
//
// Root cause (P266 cycle 진단):
//   - prod plan faab8777 의 Inngest event payload 의 itinerary._cache_metadata=undefined
//   - Vercel logs 의 [P195 CACHE_METRICS] log 0건
//   - 진단: streamResult.response.usageMetadata=null (Google AI Forum #79312 — Pro streaming bug)
//   - extractCacheMetadata({usageMetadata:null}) = {0,0,0} → logCacheMetrics total=0 skip
//   - P266 fix 의 layer 1 (handler attach) 의 입력 데이터 자체가 손실
//
// P267 fix: chunk loop 안 chunk.usageMetadata 누적 + final null 시 chunk-level fallback.
// ----------------------------------------------------------------------------

function P267_streamingChunkUsageMetadataFallback({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE) || '';
  const issues = [];

  if (!/let\s+lastChunkUsageMetadata\s*=\s*null/.test(src)) {
    issues.push('lastChunkUsageMetadata 변수 정의 누락 — Pro streaming final null bug 우회 불가');
  }
  if (!/if\s*\(chunk\?\.usageMetadata\)\s*lastChunkUsageMetadata\s*=\s*chunk\.usageMetadata/.test(src)) {
    issues.push('chunk loop 안 usageMetadata 저장 코드 누락 — chunk-level fallback 의 데이터 source 손실');
  }
  if (!/cacheMetadata\.total\s*===\s*0\s*&&\s*lastChunkUsageMetadata/.test(src)) {
    issues.push('final usageMetadata=null/0 시 chunk fallback 분기 누락 — Google AI Forum #79312 회귀');
  }
  if (!/logCacheMetrics\(`streaming-\$\{source\}`/.test(src)) {
    issues.push('source label 분기 누락 — final vs chunk-fallback 구분 측정 불가');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P267_streamingChunkUsageMetadataFallback',
    severity: 'error',
    file: FILE,
    message:
      'R-P267: runGeminiStreaming chunk-level usageMetadata fallback 깨짐 — Pro streaming final null bug 회귀. ' +
      'P266 cycle 진단 (prod plan faab8777 [P195 CACHE_METRICS] log 0건) 재발 위험. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P268_debugInfoNoCachePop — buildAdminDebug 의 _cache_metadata delete 제거 (2026-05-29)
//
// Root cause (P266 → P267 → P268 chain):
//   - P267 fix 후 handler 가 cacheMetadata 추출 성공 (response _debug.totalInputTokens=33123 확인)
//   - Inngest event payload 의 itinerary._cache_metadata=undefined → P266 silent skip
//   - 원인: handlerCore.js:343-347 streaming early response 시점에 buildAdminDebug 호출
//           → debugInfo.js:42 의 delete itinerary._cache_metadata → pop
//           → 이후 line 372 dispatch + line 394 savePlan 도달 시 undefined
//
// P268 fix: debugInfo.js 의 delete 제거 — itinerary._cache_metadata 가 final layer 까지 유지.
// _cache_metadata 는 numeric (PII 없음) → response 노출 안전.
// ----------------------------------------------------------------------------

function P268_debugInfoNoCachePop({ changed }) {
  const FILE = 'api/_ai_core/debugInfo.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE) || '';
  const issues = [];

  if (/delete\s+itinerary\._cache_metadata/.test(src)) {
    issues.push('debugInfo.js: delete itinerary._cache_metadata 코드 잔재 — P266 chain 시점 issue 재발 위험');
  }
  if (!/itinerary\._cache_metadata/.test(src)) {
    issues.push('debugInfo.js: itinerary._cache_metadata 읽기 누락 — admin _debug 노출 손상');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P268_debugInfoNoCachePop',
    severity: 'error',
    file: FILE,
    message:
      'R-P268: buildAdminDebug 가 _cache_metadata 를 pop — P266 fix layer 1 silent skip 회귀. ' +
      '5/29 P266→P267→P268 chain (Vercel logs + Inngest event payload 자동 fetch 진단) lesson 재발 위험. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P273_userMessageCachePrefixOrder — userMessage cache-friendly 순서 회귀 차단 (2026-05-29)
//
// Root cause (P195 baseline prod 측정, plan 696b273d):
//   - _debug.cacheMetrics.cacheHitRate = 0% (Gemini implicit cache 0건)
//   - userMessage 가 JSON.stringify(userInput) 으로 시작 → 매 요청 user-unique prefix
//     → Gemini implicit caching (prefix exact match 필요) 0% hit
//
// P273 fix: userMessage 순서 = STATIC PREFIX (spotContext+foodContext+...) → SEMI-STATIC MIDDLE
//   → DYNAMIC SUFFIX (userInput JSON) → RANDOM TAIL (variation_angle).
//   동일 city+styles+diet+language 요청의 prefix 가 byte-level identical → 90% 할인 활성.
//
// 회귀 시: cacheHitRate 0% 회귀 → 일 100 plan × $0.48/day 비용 (현재 90% 할인 대비).
// ----------------------------------------------------------------------------

function P273_userMessageCachePrefixOrder({ changed }) {
  const FILE = 'api/_ai_core/userMessageBuilder.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  // 1. return statement 가 staticPrefix + semiStaticMiddle + userInputJson + variationTail 순서
  if (!/return\s+staticPrefix\s*\+\s*semiStaticMiddle\s*\+\s*userInputJson\s*\+\s*variationTail/.test(src)) {
    issues.push('return statement 가 P273 순서 (staticPrefix + semiStaticMiddle + userInputJson + variationTail) 아님');
  }

  // 2. staticPrefix 변수 정의 + spotContext 로 시작
  if (!/const\s+staticPrefix\s*=\s*[\s\S]{0,80}spotContext/.test(src)) {
    issues.push('staticPrefix 변수 누락 또는 spotContext prefix 아님 (cache key 결정성 깨짐)');
  }

  // 3. userInputJson 변수 정의 + JSON.stringify 사용
  if (!/const\s+userInputJson\s*=\s*JSON\.stringify/.test(src)) {
    issues.push('userInputJson 변수 누락 — userInput 이 명시적 suffix 분리 안 됨');
  }

  // 4. 회귀 차단: return JSON.stringify (이전 패턴) 직접 검사
  if (/return\s+JSON\.stringify/.test(src)) {
    issues.push('return JSON.stringify(...) — P273 이전 prefix=userInput 패턴 회귀 (cache hit 0% 회귀 위험)');
  }

  // 5. P273 reference 명시
  if (!/P273/.test(src)) {
    issues.push('P273 reference 명시 누락 — 후속 lesson 추적 깨짐');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P273_userMessageCachePrefixOrder',
    severity: 'error',
    file: FILE,
    message:
      'R-P273: userMessage cache-friendly 순서 깨짐 — Gemini implicit cache 0% hit 회귀. ' +
      'P195 baseline (plan 696b273d, cacheHitRate=0%) → P273 fix (STATIC PREFIX → DYNAMIC SUFFIX) 의도 손실. ' +
      '운영자 비용 박제 ~$0.48/day → 0.05/day (90% 할인 활성) ROI 손실 위험. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P274_airportTerminalConsistency — arrival/departure airport terminal mismatch 회귀 차단 (2026-05-29)
//
// Root cause (운영자 신고 SAFETY-CRITICAL, prod plan 696b273d 등 4건):
//   - input arrival_airport='ICN' (terminal 미지정) → Gemini hallucinate 'ICN T1' (departure 측)
//     + ODsay 가 T1/T2 좌표 ~260m 인접 → 임의로 '인천공항2터미널' station 추천
//   - 결과 자가 모순: arrival route='T2 station', departure='T1', Day N last stop='T1'
//   - 사용자 비행기 놓침 risk (도착 T2 안내 받고 출국 T1 으로 잘못 이동)
//
// P274 fix 3-layer:
//   1. RouteAgent._normalizeAirportKey: 'ICN' (generic) → 'ICN' 유지 (이전 T1 hardcode 제거)
//   2. postResponsePipeline: arrival/departure_guide.airport mismatch 시 input 으로 override
//   3. buildPrompt: TERMINAL CONSISTENCY rule (Gemini 가 input 정확 echo, terminal swap 금지)
// ----------------------------------------------------------------------------

function P274_airportTerminalConsistency({ changed }) {
  const ROUTE_AGENT = 'api/_ai_core/agents/RouteAgent.js';
  const POST_PIPELINE = 'api/_ai_core/postResponsePipeline.js';
  const BUILD_PROMPT = 'api/_ai_core/buildPrompt.js';

  // 셋 중 하나라도 변경됐을 때 검사
  const anyChanged = isModified(ROUTE_AGENT, changed) || isModified(POST_PIPELINE, changed) || isModified(BUILD_PROMPT, changed);
  if (!anyChanged) return { skipped: true };

  const routeAgentSrc = readFileExists(ROUTE_AGENT);
  const postPipelineSrc = readFileExists(POST_PIPELINE);
  const buildPromptSrc = readFileExists(BUILD_PROMPT);
  if (!routeAgentSrc || !postPipelineSrc || !buildPromptSrc) return { skipped: true };

  const issues = [];

  // Layer 1: RouteAgent._normalizeAirportKey — 'ICN' → 'ICN' (T1 hardcode 회귀 차단)
  if (/if\s*\(k\.startsWith\('ICN'\)\s*\|\|\s*k\s*===\s*'INCHEON'\)\s*return\s+'ICN_T1'\s*;/.test(routeAgentSrc)) {
    issues.push("RouteAgent._normalizeAirportKey: 'ICN' (generic) → 'ICN_T1' hardcode 회귀 (T1/T2 ~260m 임의 station 자가 모순 risk)");
  }

  // Layer 2: postResponsePipeline — arrival/departure airport mismatch override
  if (!/itinerary\.arrival_guide\.airport\s*=\s*arrival_airport/.test(postPipelineSrc) ||
      !/arrival_airport_overridden/.test(postPipelineSrc)) {
    issues.push("postResponsePipeline: arrival_guide.airport mismatch 시 input override (P274) 누락 — Gemini hallucinate 자가 모순 차단 깨짐");
  }
  if (!/itinerary\.departure_guide\.airport\s*=\s*departure_airport/.test(postPipelineSrc) ||
      !/departure_airport_overridden/.test(postPipelineSrc)) {
    issues.push("postResponsePipeline: departure_guide.airport mismatch 시 input override (P274) 누락");
  }

  // Layer 3: buildPrompt — TERMINAL CONSISTENCY rule + 핵심 keyword
  if (!/P274.*TERMINAL CONSISTENCY/.test(buildPromptSrc)) {
    issues.push("buildPrompt: P274 TERMINAL CONSISTENCY section 누락 — Gemini 가 input airport echo 강제 안 됨");
  }
  if (!/696b273d/.test(buildPromptSrc) || !/hallucinate/.test(buildPromptSrc)) {
    issues.push("buildPrompt: P274 사용자 신고 plan 696b273d 또는 'hallucinate' 키워드 누락 (lesson 추적 깨짐)");
  }

  if (issues.length === 0) return null;
  return {
    id: 'P274_airportTerminalConsistency',
    severity: 'error',
    file: ROUTE_AGENT + ' | ' + POST_PIPELINE + ' | ' + BUILD_PROMPT,
    message:
      'R-P274: airport terminal consistency 깨짐 — 사용자 비행기 놓침 risk (SAFETY-CRITICAL). ' +
      'prod plan 696b273d 등 4건 자가 모순 (input ICN → arrival route T2 + departure T1 + Day N stop T1) 회귀 위험. ' +
      'fix 3-layer (RouteAgent normalize + postPipeline override + buildPrompt rule) 모두 유지 의무. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P275_airportStationMismatch — ODsay station mismatch 측정 회귀 차단 (2026-05-29)
//
// P274 (PR #673) 가 우회 fix. 진짜 root cause = AIRPORT_COORDS T1↔T2 ~260m 인접 → ODsay 임의 station.
// P275 Phase A: _routeAirportHotel fromStationName/toStationName extract + _verifyAirportStation +
//   호출 site mismatch quality_warnings 박제. Phase B (별도 cycle): AIRPORT_STATION_COORDS 자동 fix.
// ----------------------------------------------------------------------------

function P275_airportStationMismatch({ changed }) {
  const FILE = 'api/_ai_core/agents/RouteAgent.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  if (!/function\s+_verifyAirportStation\s*\(/.test(src)) {
    issues.push('_verifyAirportStation function 누락 — P275 Phase A 측정 logic 회귀');
  }
  if (!/fromStationName\s*=\s*firstStep/.test(src)) {
    issues.push('_routeAirportHotel fromStationName extract 누락');
  }
  if (!/arrival_station_terminal_mismatch/.test(src) || !/departure_station_terminal_mismatch/.test(src)) {
    issues.push('quality_warnings 박제 (arrival/departure_station_terminal_mismatch) 누락');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P275_airportStationMismatch',
    severity: 'error',
    file: FILE,
    message:
      'R-P275: ODsay station mismatch 측정 깨짐 — 사용자 비행기 놓침 risk 검출 불가 (SAFETY-CRITICAL). ' +
      'P274 우회 fix 의 측정 강화 — Phase B 자동 fix 도입 전 sleeper bug 잠복. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P276_arrivalGuideRequired — buildPrompt arrival_guide / daily_budget_summary 통째 누락 차단 (P276+P277)
// ----------------------------------------------------------------------------

function P276_arrivalGuideRequired({ changed }) {
  const FILE = 'api/_ai_core/buildPrompt.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  if (!/P276[^]*TERMINAL CONSISTENCY|P276[^]*arrival_guide STEPS/.test(src)) {
    issues.push('P276 arrival_guide STEPS 통째 누락 차단 section 누락');
  }
  if (!/P277[^]*daily_budget_summary/.test(src)) {
    issues.push('P277 daily_budget_summary 누락 차단 section 누락');
  }
  if (!/반드시 5개 step/.test(src)) {
    issues.push('arrival_guide.steps 5개 명시 누락');
  }
  if (!/transport_krw|entry_fees_krw/.test(src)) {
    issues.push('daily_budget_summary 6 field 명시 누락');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P276_arrivalGuideRequired',
    severity: 'error',
    file: FILE,
    message:
      'R-P276+P277: buildPrompt arrival_guide / daily_budget_summary REQUIRED 강화 깨짐 — Gemini self_heal 빈도 ↑ 회귀. ' +
      '사용자 personalize 안 된 generic 안내 = quality 저하 + 환불 risk. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P278_blockModeCacheMetadata — block_mode plan _cache_metadata persist sleeper bug 회귀 차단
//
// P266 chain (PR #665-#667) 가 legacy 만 적용 — block_mode 46% plan 측정 누락 1주일 잠복.
// blockMode.js 의 selectBlocksWithGemini / selectBlocksMultiCity 의 cacheMetadata 추출 + itinerary attach.
// ----------------------------------------------------------------------------

function P278_blockModeCacheMetadata({ changed }) {
  const FILE = 'api/_ai_core/blockMode.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  // cacheMetadata 추출 (cachedContentTokenCount + promptTokenCount + candidatesTokenCount)
  if (!/cachedContentTokenCount/.test(src)) {
    issues.push('Gemini usageMetadata.cachedContentTokenCount 추출 누락 (P266 chain layer 1 호환 깨짐)');
  }
  // itinerary._cache_metadata attach (runBlockModePipeline + runBlockModeMultiCity)
  const attachMatches = (src.match(/itinerary\._cache_metadata\s*=\s*selections\.cacheMetadata/g) || []).length;
  if (attachMatches < 2) {
    issues.push(`itinerary._cache_metadata attach ${attachMatches}/2 spot — runBlockModePipeline / runBlockModeMultiCity 둘 다 의무`);
  }

  if (issues.length === 0) return null;
  return {
    id: 'P278_blockModeCacheMetadata',
    severity: 'error',
    file: FILE,
    message:
      'R-P278: block_mode plan _cache_metadata persist 깨짐 — P266 chain sleeper bug 회귀 위험. ' +
      'block_mode 46% plan 측정 누락 → 운영자 P273/P274 효과 측정 불가. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P279_vercelLogsNdjson — scripts/fetch-vercel-logs.mjs NDJSON 파싱 회귀 차단
//
// Vercel runtime-logs API NDJSON 응답 → res.json() SyntaxError. text + split + per-line parse.
// ----------------------------------------------------------------------------

function P279_vercelLogsNdjson({ changed }) {
  const FILE = 'scripts/fetch-vercel-logs.mjs';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  // runtime-logs URL 직접 fetch (api() 안 거침)
  if (!/const\s+logsUrl\s*=\s*`https:\/\/api\.vercel\.com\/v1\/projects\//.test(src)) {
    issues.push('runtime-logs 직접 fetch URL pattern 누락');
  }
  // text() + split('\n') + per-line JSON.parse
  if (!/\.split\('\\n'\)[\s\S]{0,200}JSON\.parse\(line\)/.test(src)) {
    issues.push('NDJSON 처리 패턴 (text + split + per-line JSON.parse) 누락');
  }
  // 회귀: api() 직접 호출 (이전 broken pattern)
  if (/const\s+logsRaw\s*=\s*await\s+api\(`\/v1\/projects\/.*runtime-logs/.test(src)) {
    issues.push('이전 pattern (const logsRaw = await api(...runtime-logs)) 회귀 — SyntaxError 재발');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P279_vercelLogsNdjson',
    severity: 'error',
    file: FILE,
    message:
      'R-P279: fetch-vercel-logs NDJSON 파싱 회귀 — 다음 cycle 진단 도구 broken. ' +
      'Vercel runtime-logs API NDJSON 응답 → res.json() SyntaxError. text + split + per-line parse 의무. ' +
      '발견 항목:\n  - ' + issues.join('\n  - '),
  };
}

// ----------------------------------------------------------------------------
// P280-P286 cycle lint rules (2026-05-29) — Agent 1+2 deep-search sleeper bug
// ----------------------------------------------------------------------------

function P280_dietaryCoverage({ changed }) {
  const FILE = 'api/_ai_core/responseValidator.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  if (!/function\s+checkDietaryCoverage/.test(src)) issues.push('checkDietaryCoverage function 누락');
  if (!/dietary_coverage_low/.test(src)) issues.push('dietary_coverage_low issue type 누락');
  if (!/COVERAGE_THRESHOLD\s*=\s*0\.5/.test(src)) issues.push('COVERAGE_THRESHOLD 0.5 누락');
  if (issues.length === 0) return null;
  return { id: 'P280_dietaryCoverage', severity: 'error', file: FILE,
    message: 'R-P280: dietary coverage depth check 깨짐 — SAFETY-CRITICAL 사용자 건강 위험 회귀. 발견: ' + issues.join(' | ') };
}

function P281_blockModePlaceholderName({ changed }) {
  const FILE = 'api/_ai_core/blockMode.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  if (!/\[추천\s+\$\{placeholderType\}/.test(src)) issues.push('명시적 placeholder text 패턴 누락');
  if (/resolvedName\s*=\s*bs\.address\s*\|\|\s*'Local restaurant'/.test(src)) issues.push('이전 행정 주소 fallback 회귀');
  if (!/block_mode_placeholder_synthesized/.test(src)) issues.push('quality_warnings 박제 누락');
  if (issues.length === 0) return null;
  return { id: 'P281_blockModePlaceholderName', severity: 'error', file: FILE,
    message: 'R-P281: block_mode placeholder fallback 깨짐 — 68% plan stop.name 행정 주소 노출 회귀. 발견: ' + issues.join(' | ') };
}

function P282_nicheStyleCityMismatch({ changed }) {
  const FILE = 'api/_ai_core/responseValidator.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  if (!/HANGANGBIKE_CITY_VIOLATION_PATTERNS/.test(src)) issues.push('HANGANGBIKE_CITY_VIOLATION_PATTERNS 누락');
  if (!/hangangbike_city_mismatch/.test(src)) issues.push('hangangbike_city_mismatch issue type 누락');
  if (!/jjimjilbang_coverage_zero/.test(src)) issues.push('jjimjilbang_coverage_zero (P282-B) 누락');
  if (issues.length === 0) return null;
  return { id: 'P282_nicheStyleCityMismatch', severity: 'error', file: FILE,
    message: 'R-P282: niche style city/coverage 검증 깨짐 — HangangBike/Jjimjilbang 환불 클레임 회귀. 발견: ' + issues.join(' | ') };
}

function P283_lodgingZoneMultiDay({ changed }) {
  const FILE = 'api/_ai_core/userMessageBuilder.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  if (!/EVERY day from Day 1 to Day N/.test(src)) issues.push('EVERY day stops enforce 명시 누락');
  if (!/Day 2 ~ Day N-1.*middle days/.test(src)) issues.push('middle days 명시 누락');
  if (!/P283/.test(src)) issues.push('P283 reference 누락');
  if (issues.length === 0) return null;
  return { id: 'P283_lodgingZoneMultiDay', severity: 'error', file: FILE,
    message: 'R-P283: LODGING ZONE Day 2+ enforce 깨짐 — recommended_zone 무력화 (4/4 myeongdong plan) 회귀. 발견: ' + issues.join(' | ') };
}

function P284_hotelAddressSingleCity({ changed }) {
  const FILE = 'api/_ai_core/responseValidator.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  if (!/hotel_address_single_city_mismatch/.test(src)) issues.push('hotel_address_single_city_mismatch 누락');
  if (!/GENERIC_TOKENS/.test(src)) issues.push('GENERIC_TOKENS exclude logic 누락 (false positive risk)');
  if (issues.length === 0) return null;
  return { id: 'P284_hotelAddressSingleCity', severity: 'error', file: FILE,
    message: 'R-P284: hotel single-city mismatch validator 깨짐 — 사용자 호텔 mismatch silent fail 회귀. 발견: ' + issues.join(' | ') };
}

function P285_bdcSoftLog({ changed }) {
  const FILE = 'api/_ai_core/responseValidator.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  if (!/P285 B-DC mismatch/.test(src)) issues.push('P285 B-DC mismatch console.error 누락');
  if (!/silent mode 차단/.test(src)) issues.push('silent mode 차단 reference 누락');
  if (issues.length === 0) return null;
  return { id: 'P285_bdcSoftLog', severity: 'error', file: FILE,
    message: 'R-P285: B-DC SOFT circuit breaker log 깨짐 — env disabled 시 silent mode 회귀. 발견: ' + issues.join(' | ') };
}

function P286_arrivalWrapEdge({ changed }) {
  const FILE = 'api/_ai_core/responseValidator.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  if (!/arrival-wrap edge/.test(src)) issues.push('arrival-wrap edge 명시 누락');
  if (!/wrapHint/.test(src)) issues.push('wrapHint variable 누락');
  if (issues.length === 0) return null;
  return { id: 'P286_arrivalWrapEdge', severity: 'error', file: FILE,
    message: 'R-P286: arrival-wrap edge 검증 깨짐 — Day 1 새벽 wrap stop 미감지 회귀. 발견: ' + issues.join(' | ') };
}

// ----------------------------------------------------------------------------
// P290_selfHealLodgingBookendPersonalize — selfHealLodgingBookend ctx 확장 회귀 차단
//
// P288 (#697) + P289 (#698) + P290 (#699) = buildPrompt 변경 0 backend self_heal personalize.
// P290 fix: selfHealLodgingBookend(itinerary, ctx = {}) — ctx.hotel_address + ctx.recommendedZone
//   fallback chain (day.lodging 없을 때만 발동). 회귀 = ctx 파라미터 손실 → placeholder generic.
// ----------------------------------------------------------------------------
function P290_selfHealLodgingBookendPersonalize({ changed }) {
  const FILE_PERSISTER = 'api/_ai_core/planPersister.js';
  const FILE_PIPELINE = 'api/_ai_core/postResponsePipeline.js';
  if (!isModified(FILE_PERSISTER, changed) && !isModified(FILE_PIPELINE, changed)) return { skipped: true };
  const persisterSrc = readFileExists(FILE_PERSISTER);
  const pipelineSrc = readFileExists(FILE_PIPELINE);
  if (!persisterSrc || !pipelineSrc) return { skipped: true };
  const issues = [];
  // 1. selfHealLodgingBookend signature 확장
  if (!/selfHealLodgingBookend\(itinerary,\s*ctx\s*=\s*\{\}\)/.test(persisterSrc)) {
    issues.push('selfHealLodgingBookend signature (itinerary, ctx = {}) 손실');
  }
  // 2. ctxFallbackName / ctxFallbackAddress 사용
  if (!/ctxFallbackName/.test(persisterSrc)) issues.push('ctxFallbackName fallback chain 손실');
  if (!/ctxFallbackAddress/.test(persisterSrc)) issues.push('ctxFallbackAddress fallback chain 손실');
  // 3. postResponsePipeline 가 ctx 전달
  if (!/selfHealLodgingBookend\(\s*itinerary,\s*\{/.test(pipelineSrc)) {
    issues.push('postResponsePipeline selfHealLodgingBookend ctx 전달 손실');
  }
  if (issues.length === 0) return null;
  return { id: 'P290_selfHealLodgingBookendPersonalize', severity: 'error', file: FILE_PERSISTER,
    message: 'R-P290: selfHealLodgingBookend personalize 깨짐 — placeholder generic 회귀 (P276+P277 buildPrompt 대안 손실). 발견: ' + issues.join(' | ') };
}

// ----------------------------------------------------------------------------
// P300_dailyBudgetFieldUnify — daily_budget_summary 필드명/위치 통일 회귀 차단
//
// 6월 상용화 audit B2: daily_budget_summary 필드명 5갈래 (BudgetTable transport_krw/
// entry_fees_krw/meals_krw vs selfHeal food/transport vs blockMode food_krw/activity_krw vs
// planToMarkdown food_krw/transit_krw/entry_krw) + selfHeal per-day vs frontend root array
// → 예산표 전부 0원. SSOT = root array + BudgetTable 필드명.
// 회귀 = selfHeal per-day 할당 / blockMode food_krw / BudgetTable 폴백 손실.
// ----------------------------------------------------------------------------
function P300_dailyBudgetFieldUnify({ changed }) {
  const FILE_PERSIST = 'api/_ai_core/planPersister.js';
  const FILE_BLOCK = 'api/_ai_core/blockMode.js';
  const FILE_TABLE = 'src/pages/PlanDetailPage/components/BudgetTable.tsx';
  if (!isModified(FILE_PERSIST, changed) && !isModified(FILE_BLOCK, changed) && !isModified(FILE_TABLE, changed)) {
    return { skipped: true };
  }
  const issues = [];
  const pSrc = readFileExists(FILE_PERSIST);
  if (pSrc) {
    // selfHealDailyBudget root array 할당 + 필드명
    if (!/itinerary\.daily_budget_summary\s*=\s*rows/.test(pSrc)) {
      issues.push('selfHealDailyBudget root array 할당 (itinerary.daily_budget_summary = rows) 손실');
    }
    if (!/meals_krw\s*=\s*foodCount/.test(pSrc)) issues.push('meals_krw 필드명 손실 (food → meals_krw)');
    if (!/entry_fees_krw\s*=\s*attrCount/.test(pSrc)) issues.push('entry_fees_krw 필드명 손실');
    // per-day day.daily_budget_summary 할당 = frontend 0원 회귀
    if (/day\.daily_budget_summary\s*=\s*\{/.test(pSrc)) {
      issues.push('per-day day.daily_budget_summary 할당 회귀 (frontend root array 못 읽음 = 0원)');
    }
  }
  const bSrc = readFileExists(FILE_BLOCK);
  if (bSrc && /daily_budget_summary\s*=\s*days\.map/.test(bSrc)) {
    if (/food_krw:|activity_krw:/.test(bSrc)) {
      issues.push('blockMode food_krw/activity_krw 회귀 (meals_krw/entry_fees_krw 이어야 — BudgetTable 미일치)');
    }
  }
  const tSrc = readFileExists(FILE_TABLE);
  if (tSrc && !/row\.meals_krw\s*\?\?/.test(tSrc)) {
    issues.push('BudgetTable 레거시 폴백 (row.meals_krw ??) 손실 — 옛 Firestore plan 0원');
  }
  if (issues.length === 0) return null;
  return { id: 'P300_dailyBudgetFieldUnify', severity: 'error', file: FILE_PERSIST,
    message: 'R-P300: daily_budget_summary 필드명/위치 통일 깨짐 — 결제 후 예산표 0원 회귀 (audit B2). 발견: ' + issues.join(' | ') };
}

// ----------------------------------------------------------------------------
// P298_dietaryAllergiesMerge — 할랄/비건 allergies 통합 회귀 차단 (SAFETY-CRITICAL)
//
// 6월 상용화 audit B1: 할랄/비건이 WizardForm ALLERGY_KEYS(P10 4/24) → allergies 배열.
// handlerCore 가 dietPrefs 만 식이 체인 전달 → 할랄/비건 검증 죽음 (건강위험 1등급).
// P298 fix: dietaryAll = dietPrefs ∪ allergies (None 제외) → 7지점 전달.
// 회귀 = 7지점 중 하나라도 dietPrefs 단독 → 그 경로 할랄/비건 누락 (CLAUDE.md J).
// ----------------------------------------------------------------------------
function P298_dietaryAllergiesMerge({ changed }) {
  const FILE = 'api/_ai_core/handlerCore.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  // dietaryAll 합집합 선언 (dietPrefs ∪ allergies, None 제외)
  if (!/const dietaryAll\s*=\s*\[\.\.\.new Set/.test(src)) {
    issues.push('dietaryAll 합집합 선언 손실 (할랄/비건 검증 죽음)');
  }
  if (!/!==\s*['"]None['"]/.test(src)) {
    issues.push("'None' 제외 필터 손실");
  }
  // 회귀 차단: 식이 체인 dietPrefs 단독 사용 금지
  if (/getFoodContext\(area,\s*dietPrefs,/.test(src)) {
    issues.push('getFoodContext 가 dietPrefs 단독 (dietaryAll 아님) — 할랄/비건 음식필터 누락');
  }
  if (/dietary:\s*dietPrefs\b/.test(src)) {
    issues.push('runGeminiPipeline/savePlan dietary: dietPrefs 단독 — 할랄/비건 검증/저장 누락');
  }
  if (/applyRecommendedRestaurants\(itinerary,\s*\{\s*area,\s*dietPrefs,/.test(src)) {
    issues.push('applyRecommendedRestaurants dietPrefs 단독 — 할랄/비건 추천 누락');
  }
  if (issues.length === 0) return null;
  return { id: 'P298_dietaryAllergiesMerge', severity: 'error', file: FILE,
    message: 'R-P298 SAFETY-CRITICAL: 할랄/비건 allergies 통합 깨짐 — 무슬림/비건 plan 무검증 통과 회귀 (CLAUDE.md J 건강위험 1등급). 발견: ' + issues.join(' | ') };
}

// ----------------------------------------------------------------------------
// P297_crossCityLodgingPersonalize — cross-city 교정 시 generic placeholder 회귀 차단
//
// 5/29 P296 발견 (plan 03cac32d Day 5): correctCrossCityLodgingStops 가 hbc[dayCityLc]
// 있을 때 newAddress 는 사용자 호텔, newName 은 generic "${city} 호텔" → 자가 불일치.
// P297 fix: hbc 분기에서 newName 도 userHotel 사용 (P290 패턴 동일).
// 회귀 = 사용자 입력 호텔이 cross-city 교정 후 generic placeholder 로 표시.
// ----------------------------------------------------------------------------
function P297_crossCityLodgingPersonalize({ changed }) {
  const FILE = 'api/_ai_core/planPersister.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  // hbc 분기 (correctCrossCityLodgingStops 안) 에서 userHotel 변수 + newName = userHotel
  const hbcBlock = src.match(/if \(hbc\[dayCityLc\][\s\S]{0,800}?\} else if \(rz\[dayCityLc\]\)/);
  if (!hbcBlock) {
    issues.push('correctCrossCityLodgingStops hbc 분기 패턴 손실');
  } else {
    if (!/const\s+userHotel\s*=\s*hbc\[dayCityLc\]\.trim\(\)/.test(hbcBlock[0])) {
      issues.push('userHotel 변수 손실 (hbc[dayCityLc] 사용자 호텔)');
    }
    if (!/newName\s*=\s*userHotel/.test(hbcBlock[0])) {
      issues.push('newName = userHotel 손실 (generic placeholder 회귀 risk)');
    }
  }
  if (issues.length === 0) return null;
  return { id: 'P297_crossCityLodgingPersonalize', severity: 'error', file: FILE,
    message: 'R-P297: cross-city 교정 personalize 깨짐 — 사용자 호텔이 generic "서울 호텔" placeholder 회귀 (P290 패턴 위반). 발견: ' + issues.join(' | ') };
}

// ----------------------------------------------------------------------------
// P291_responseSchemaHintFull — PLAN_RESPONSE_SCHEMA properties hint 확장 회귀 차단
//
// 5/29 P291 deep-search Option A (R1-R5): arrival_guide.steps + departure_guide
// nested + daily_budget_summary.items + days.items 확장 + stops.items propertyOrdering.
// 회귀 = self_heal 의존 ↑ (Gemini 가 통째 누락 = arrival_guide_self_healed 빈도 ↑).
// SAFETY: required 추가 X (P196 회귀 root cause = Flash "satisfy required then stop").
// ----------------------------------------------------------------------------
function P291_responseSchemaHintFull({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };
  const src = readFileExists(FILE);
  if (!src) return { skipped: true };
  const issues = [];
  // R1: arrival_guide.steps array hint
  if (!/arrival_guide:[\s\S]{0,400}propertyOrdering:\s*\[['"]airport['"],\s*['"]steps['"]\]/.test(src)) {
    issues.push('R1: arrival_guide.propertyOrdering airport+steps 손실');
  }
  if (!/arrival_guide:[\s\S]{0,800}steps:\s*\{[\s\S]{0,200}type:\s*['"]ARRAY['"]/.test(src)) {
    issues.push('R1: arrival_guide.properties.steps ARRAY hint 손실');
  }
  // R2: departure_guide nested 확장
  if (!/departure_guide:[\s\S]{0,200}propertyOrdering:[\s\S]{0,300}luggage_storage[\s\S]{0,100}to_airport[\s\S]{0,100}tax_refund/.test(src)) {
    issues.push('R2: departure_guide.propertyOrdering 7 fields 손실');
  }
  if (!/luggage_storage:\s*\{[\s\S]{0,200}propertyOrdering/.test(src)) {
    issues.push('R2: departure_guide.luggage_storage nested propertyOrdering 손실');
  }
  // R3: daily_budget_summary.items 확장
  if (!/daily_budget_summary:\s*\{[\s\S]{0,300}items:\s*\{[\s\S]{0,400}propertyOrdering:\s*\[['"]day['"],\s*['"]transport_krw['"]/.test(src)) {
    issues.push('R3: daily_budget_summary.items.propertyOrdering 7 fields 손실');
  }
  // R4: days.items 확장
  if (!/days:[\s\S]{0,300}items:[\s\S]{0,300}propertyOrdering:\s*\[['"]day['"],\s*['"]date['"],\s*['"]city['"]/.test(src)) {
    issues.push('R4: days.items.propertyOrdering 7 fields 손실');
  }
  // R5: stops.items propertyOrdering
  if (!/stops:[\s\S]{0,500}items:[\s\S]{0,500}propertyOrdering:\s*\[['"]order['"],\s*['"]start_time['"],\s*['"]name['"]/.test(src)) {
    issues.push('R5: stops.items.propertyOrdering 12 fields 손실');
  }
  // SAFETY: nested required 추가 회귀 차단 (P196 패턴)
  // arrival_guide / departure_guide / arrival_guide.steps / nested OBJECT 의 required 추가는 P196 회귀.
  // top-level + days.items.required + stops.items.required 만 허용 (P200 유지).
  const arrivalGuideBlock = src.match(/arrival_guide:\s*\{[\s\S]{0,1500}?(?=\n    (?:departure_guide|daily_budget))/);
  if (arrivalGuideBlock && /\brequired:\s*\[/.test(arrivalGuideBlock[0])) {
    issues.push('SAFETY 위반: arrival_guide nested 에 required 추가됨 (P196 회귀 root cause)');
  }
  if (issues.length === 0) return null;
  return { id: 'P291_responseSchemaHintFull', severity: 'error', file: FILE,
    message: 'R-P291: PLAN_RESPONSE_SCHEMA properties hint 손상 — self_heal 의존 ↑ 회귀 (P276+P277 의도 손상). 발견: ' + issues.join(' | ') };
}

// ----------------------------------------------------------------------------
// P292_planStreamingSweepCron — plans status='streaming' 30분+ stuck 정리 cron 회귀 차단
//
// 5/29 P287 cycle: P280 v1 무한 retry loop → plan 1h30m+ stuck = SAFETY-CRITICAL.
// P292 fix: api/_crons/plan-streaming-sweep.js + cron-runner.js JOBS map + vercel.json crons.
// 회귀 = 자동 sweep 부재 → 사용자 결제 후 plan 영구 미수령.
// ----------------------------------------------------------------------------
function P292_planStreamingSweepCron({ changed }) {
  const FILE_CRON = 'api/_crons/plan-streaming-sweep.js';
  const FILE_RUNNER = 'api/cron-runner.js';
  const FILE_VERCEL = 'vercel.json';
  if (!isModified(FILE_CRON, changed) && !isModified(FILE_RUNNER, changed) && !isModified(FILE_VERCEL, changed)) {
    return { skipped: true };
  }
  const cronSrc = readFileExists(FILE_CRON);
  const runnerSrc = readFileExists(FILE_RUNNER);
  const vercelSrc = readFileExists(FILE_VERCEL);
  if (!cronSrc || !runnerSrc || !vercelSrc) return { skipped: true };
  const issues = [];
  // 1. cron file 의 핵심 패턴
  if (!/STUCK_THRESHOLD_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/.test(cronSrc)) {
    issues.push('STUCK_THRESHOLD_MS=30분 default 손실 (Vercel max 800s × 2.25 안전마진)');
  }
  if (!/['"]streaming_timeout_sweep_p292['"]/.test(cronSrc)) {
    issues.push('_streaming_error="streaming_timeout_sweep_p292" 마커 손실');
  }
  if (/triggerAiPlanner|pending_ai_planner_retries/.test(cronSrc)) {
    issues.push('retry trigger 추가 위반 (P280 v1 무한 loop lesson)');
  }
  if (!/notify\(\s*['"]booking['"]/.test(cronSrc)) {
    issues.push('Telegram alert 호출 손실 (운영자 환불 안내 SAFETY)');
  }
  // 2. cron-runner.js JOBS map 등록
  if (!/['"]plan-streaming-sweep['"]:\s*planStreamingSweep/.test(runnerSrc)) {
    issues.push('cron-runner JOBS map "plan-streaming-sweep" 등록 손실');
  }
  // 3. vercel.json crons 배열 entry
  if (!/plan-streaming-sweep/.test(vercelSrc)) {
    issues.push('vercel.json crons 배열 entry 손실');
  }
  if (issues.length === 0) return null;
  return { id: 'P292_planStreamingSweepCron', severity: 'error', file: FILE_CRON,
    message: 'R-P292: plan-streaming-sweep cron 깨짐 — 사용자 결제 후 plan 영구 미수령 회귀 (SAFETY-CRITICAL). 발견: ' + issues.join(' | ') };
}

// ----------------------------------------------------------------------------
// P200_schemaPropertyOrdering — Gemini responseSchema 의 propertyOrdering + required 회귀 차단
//
// P196 회귀 lesson (2026-05-25): required 단독 fix 가 Flash "satisfy required, then stop"
// 패턴 + schema/prompt mismatch 로 P181 빈도 3.6x ↑.
// P200 진짜 fix: propertyOrdering 명시 (buildPrompt JSON example 순서와 일치) + required 유지.
// ----------------------------------------------------------------------------

/**
 * P200_schemaPropertyOrdering — propertyOrdering + required 회귀 차단.
 *
 * 트리거: api/_ai_core/geminiPipeline.js 변경 시 propertyOrdering 8 key + required 3 key 유지 검증.
 */
function P200_schemaPropertyOrdering({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  // 1. propertyOrdering 존재
  const orderingMatch = src.match(/PLAN_RESPONSE_SCHEMA[\s\S]*?propertyOrdering:\s*\[([^\]]+)\]/);
  if (!orderingMatch) {
    issues.push("propertyOrdering 필드 누락 — schema/prompt mismatch 회귀 (Google docs 경고)");
  } else {
    const orderingContent = orderingMatch[1];
    // 2. 8 key 모두 포함 (buildPrompt JSON example 순서)
    ['tour_title', 'vehicle', 'base_price_krw', 'arrival_guide', 'days', 'departure_guide', 'daily_budget_summary', 't_money_recommended_load'].forEach(key => {
      if (!new RegExp(`['"]${key}['"]`).test(orderingContent)) {
        issues.push(`propertyOrdering 에 '${key}' 누락`);
      }
    });
  }

  // 3. required 3 key (P196 의도 복원 — guides 누락 차단)
  const reqMatch = src.match(/PLAN_RESPONSE_SCHEMA[\s\S]*?required:\s*\[([^\]]+)\]/);
  if (reqMatch) {
    const reqContent = reqMatch[1];
    if (!/['"]days['"]/.test(reqContent)) issues.push("required 에 'days' 누락 (P185 회귀)");
    if (!/['"]arrival_guide['"]/.test(reqContent)) issues.push("required 에 'arrival_guide' 누락 (P196 의도 손실)");
    if (!/['"]departure_guide['"]/.test(reqContent)) issues.push("required 에 'departure_guide' 누락 (P196 의도 손실)");
  } else {
    issues.push("required 배열 패턴 누락");
  }

  if (issues.length === 0) return null;

  return {
    id: 'P200_schemaPropertyOrdering',
    severity: 'error',
    file: FILE,
    message:
      'R-P200: PLAN_RESPONSE_SCHEMA propertyOrdering + required 손상 — P196 회귀 위험 (P181 fallback ↑). ' +
      '발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// P203_routeEnrichTimeout — routeEnrich 180s wall-clock cap 회귀 차단 (2026-05-26)
//
// 5/25 prod alert: step elapsed 26-27분 (1.59-1.67M ms) — Vercel 600s cap 도달 전.
// fix: postResponsePipeline.js 의 runRouteEnrichment 안에서 enrichItineraryWithRoute
//   호출에 Promise.race(180s) wrap. timeout 시 partial 결과 보존 + telegram alert.
// ----------------------------------------------------------------------------

/**
 * P203_routeEnrichTimeout — 180s cap + Promise.race + alert 유지 검증.
 */
function P203_routeEnrichTimeout({ changed }) {
  const FILE = 'api/_ai_core/postResponsePipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];
  if (!/ROUTE_ENRICH_TIMEOUT_MS\s*=\s*180_?000/.test(src)) {
    issues.push("ROUTE_ENRICH_TIMEOUT_MS = 180_000 누락 (180s wall-clock cap)");
  }
  if (!/Promise\.race\(\s*\[\s*enrichItineraryWithRoute/.test(src)) {
    issues.push("Promise.race wrap 누락 — enrichItineraryWithRoute timeout 미적용");
  }
  if (!/new Error\(['"]ROUTE_ENRICH_TIMEOUT['"]\)/.test(src)) {
    issues.push("ROUTE_ENRICH_TIMEOUT error message 누락");
  }
  if (!/key:\s*['"]route-enrich-timeout['"]/.test(src)) {
    issues.push("throttledTelegramAlert key 'route-enrich-timeout' 누락 — prod 모니터링 손상");
  }
  if (!/finally\s*{\s*clearTimeout/.test(src)) {
    issues.push("clearTimeout in finally 누락 — timer leak 위험");
  }

  if (issues.length === 0) return null;
  return {
    id: 'P203_routeEnrichTimeout',
    severity: 'error',
    file: FILE,
    message:
      'R-P203: routeEnrich 180s cap 손상 — 27분 hang 회귀 위험 (Vercel 600s cap 초과). ' +
      '발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// 메인
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// P202_lodgingCityConsistency — buildPrompt 의 Day N city ↔ lodging.address 일관성 명시 회귀 차단
//
// 5/25 23:24 prod alert: Day 3 (city=Busan) + lodging "홍대 호텔|서울특별시 마포구" (B-13).
// fix Phase 1: buildPrompt B-16 STRICT ENFORCEMENT 섹션 강화 + 도시 substring map + GOOD/BAD 예시.
// 옵션 B (nested required) = browser-use #3491 직접 증거로 Flash 실패 패턴 → 보류.
// ----------------------------------------------------------------------------

/**
 * P202_lodgingCityConsistency — prompt 강화 회귀 차단.
 */
function P202_lodgingCityConsistency({ changed }) {
  const FILE = 'api/_ai_core/buildPrompt.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];
  if (!/P202/.test(src)) issues.push("P202 섹션 헤더 누락");
  if (!/Day N city.*lodging\.address/.test(src)) issues.push("Day N city ↔ lodging.address 명시 누락");
  if (!/Seoul[\s\S]{0,20}서울/.test(src)) issues.push("도시 substring map (Seoul/서울) 누락");
  if (!/Busan[\s\S]{0,20}부산/.test(src)) issues.push("도시 substring map (Busan/부산) 누락");
  if (!/GOOD[\s\S]{0,300}Busan/.test(src)) issues.push("GOOD 예시 누락");
  if (!/BAD[\s\S]{0,300}Busan/.test(src)) issues.push("BAD 예시 누락 (B-13 trigger)");

  if (issues.length === 0) return null;
  return {
    id: 'P202_lodgingCityConsistency',
    severity: 'error',
    file: FILE,
    message:
      'R-P202: Day N city ↔ lodging.address 일관성 명시 손상 — B-13 cross-city lodging 회귀 위험. ' +
      '발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// 메인
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// P201_proEscalate — Pro escalate on P181 minimal fallback 회귀 차단
//
// P200 후에도 P181 ~4건/5분 잔여 (Flash long output 한계). fix: P181 발동 시 Pro 2.5
// escalate retry (ENV gate + circuit breaker). 비용 폭증 위험 ($175 → $3,450/월 9-20x)
// 으로 ENV default OFF + circuit breaker 5분 5건 cap 강제 의무.
// ----------------------------------------------------------------------------

/**
 * P201_proEscalate — geminiPipeline.js 변경 시 escalate helper + ENV gate + circuit breaker 유지.
 */
function P201_proEscalate({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];
  if (!/export\s+function\s+isProEscalateEnabled/.test(src)) {
    issues.push("isProEscalateEnabled helper 누락 — ENV gate 손상");
  }
  if (!/export\s+function\s+checkProEscalateCircuit/.test(src)) {
    issues.push("checkProEscalateCircuit 누락 — circuit breaker 손상 (비용 폭증 위험)");
  }
  if (!/export\s+(async\s+)?function\s+tryProEscalate/.test(src)) {
    issues.push("tryProEscalate 누락 — escalate 로직 없음");
  }
  if (!/P181_PRO_ESCALATE_ENABLED/.test(src)) {
    issues.push("ENV P181_PRO_ESCALATE_ENABLED 미참조 — default OFF 안전성 손상");
  }
  if (!/PRO_ESCALATE_WINDOW_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(src)) {
    issues.push("circuit window 5분 (PRO_ESCALATE_WINDOW_MS) 누락");
  }
  if (!/forceModelOverride/.test(src)) {
    issues.push("buildModel forceModelOverride 옵션 누락 — Pro 강제 우회 불가");
  }

  if (issues.length === 0) return null;
  return {
    id: 'P201_proEscalate',
    severity: 'error',
    file: FILE,
    message:
      'R-P201: Pro escalate ENV gate / circuit breaker 손상 — P181 잔여 처리 + 비용 폭증 위험. ' +
      '발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// 메인
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// P204_streamingPartialNoRepair — tryParsePartialJSON 안에서 repairAndParseJSON 호출 금지
//
// 5/26 root cause: tryParsePartialJSON (0.5초 chunk interval) 안에서 repairAndParseJSON
// 호출 → partial chunk 마다 minimal fallback alert fire (fire-and-forget, swallow X)
// → "직전 5분 누적 102건" false positive (실제 P181 발동 ~2-5건).
// fix: tryParsePartialJSON 의 repairAndParseJSON 호출 제거 + _tryExtractPartialDays helper.
// ----------------------------------------------------------------------------

/**
 * P204_streamingPartialNoRepair — tryParsePartialJSON 안에서 repairAndParseJSON 호출 금지.
 */
function P204_streamingPartialNoRepair({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  // tryParsePartialJSON 함수 범위 추출
  const match = src.match(/export function tryParsePartialJSON[\s\S]*?(?=\nexport function|\nfunction [A-Z_])/);
  if (!match) {
    return {
      id: 'P204_streamingPartialNoRepair',
      severity: 'error',
      file: FILE,
      message: 'R-P204: tryParsePartialJSON 함수 추적 불가 — streaming partial parse 손상',
    };
  }
  const fnBody = match[0];

  const issues = [];
  if (/repairAndParseJSON\(/.test(fnBody)) {
    issues.push("tryParsePartialJSON 안에서 repairAndParseJSON 호출 재도입 — minimal fallback alert flood 회귀 (5분당 60-80건)");
  }
  // _tryExtractPartialDays helper 존재 (P204 의 대체 구현)
  if (!/function _tryExtractPartialDays/.test(src)) {
    issues.push("_tryExtractPartialDays helper 누락 — partial chunk 처리 손상");
  }

  if (issues.length === 0) return null;
  return {
    id: 'P204_streamingPartialNoRepair',
    severity: 'error',
    file: FILE,
    message:
      'R-P204: streaming partial parse 가 repairAndParseJSON 호출 시 alert flood 회귀 위험. ' +
      '발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// 메인
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// P205_airportNestedSelfHeal — arrival/departure airport nested 누락 self-heal 유지
//
// 5/26 measure 5/5 sample: departure_guide 객체 있지만 .airport nested field 누락.
// Gemini 가 객체 emit (P200 required 효과) 후 nested 누락 — backend self-heal 의무.
// ----------------------------------------------------------------------------

function P205_airportNestedSelfHeal({ changed }) {
  const POST = 'api/_ai_core/postResponsePipeline.js';
  const PERSIST = 'api/_ai_core/planPersister.js';
  const postChanged = isModified(POST, changed);
  const persistChanged = isModified(PERSIST, changed);
  if (!postChanged && !persistChanged) return { skipped: true };

  const issues = [];
  if (postChanged) {
    const src = readFileExists(POST) || '';
    if (!/departure_guide\.airport\s*=\s*departure_airport/.test(src)) {
      issues.push("postResponsePipeline departure_guide.airport self-heal 누락 (B-16 SAFETY 위반)");
    }
    if (!/!itinerary\.departure_guide\.airport/.test(src)) {
      issues.push("postResponsePipeline nested airport 누락 조건 분기 누락");
    }
  }
  if (persistChanged) {
    const src = readFileExists(PERSIST) || '';
    // selfHealArrivalGuide 안의 P205 분기 확인
    const fnMatch = src.match(/export function selfHealArrivalGuide[\s\S]*?(?=\nexport (function|async function)|\nfunction [A-Z_])/);
    const fnBody = fnMatch ? fnMatch[0] : '';
    if (!/existing\.airport\s*=\s*arrival_airport/.test(fnBody)) {
      issues.push("selfHealArrivalGuide arrival_guide.airport nested self-heal 누락 (B-16 SAFETY 대칭)");
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P205_airportNestedSelfHeal',
    severity: 'error',
    file: postChanged ? POST : PERSIST,
    message: 'R-P205: airport nested self-heal 손상 — Gemini 가 객체 emit 후 .airport 누락 시 PDF 빈 페이지 (B-16). 발견: ' + issues.join(', '),
  };
}

// P210A_schemaAirportHint — arrival/departure_guide.properties.airport hint 존재 감시
//
// 5/26 deep-search RC-2: Gemini Flash 2.0/2.5 OBJECT type 만 명시 시 nested field 누락
// (github.com/google-gemini/cookbook #539, #449).
// P210-A fix: properties.airport: { type: 'STRING' } 명시 → emit 확률 상승.
// 주의: required 추가 X — P196 lesson (3.6x fallback 회귀).
// 감시: 누군가 properties 를 삭제하거나 required 를 추가하면 fail.
// ----------------------------------------------------------------------------

function P210A_schemaAirportHint({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE) || '';
  const issues = [];

  // arrival_guide.properties.airport 존재 여부
  if (!/arrival_guide[\s\S]{0,200}properties[\s\S]{0,100}airport/.test(src)) {
    issues.push('arrival_guide.properties.airport hint 누락 (Gemini Flash nested field emit 확률 하락)');
  }

  // departure_guide.properties.airport 존재 여부
  if (!/departure_guide[\s\S]{0,200}properties[\s\S]{0,100}airport/.test(src)) {
    issues.push('departure_guide.properties.airport hint 누락 (Gemini Flash nested field emit 확률 하락)');
  }

  if (issues.length === 0) return null;
  return {
    id: 'P210A_schemaAirportHint',
    severity: 'error',
    file: FILE,
    message: 'R-P210A: arrival_guide / departure_guide 의 airport properties hint 손상 — PDF 빈 페이지 (B-16) 위험. 발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// P207_pdfEmptyPlanGuard — 메모리 P207 (2026-05-26).
// 5/26 시각 검증: api/pdf/generate.js 가 days=0 plan 도 "성공" PDF 생성 (16KB / header만).
// 결제 사용자가 빈 PDF 받는 충격 경험 → 2-layer defense:
//   Layer 1: server — days.length === 0 → 422 반환 (Puppeteer 호출 전)
//   Layer 2: frontend — generatePDF() 상단 days=0 → toast + early return
//
// 룰:
//   1. api/pdf/generate.js 에 `days.length === 0` 또는 `!daysArr?.length` 존재 의무
//   2. api/pdf/generate.js 에 `.status(422)` 존재 의무
//   3. api/pdf/generate.js 에 `streaming_in_progress` reason 존재 의무
//   4. src/pages/PlanDetailPage/pdfGenerator.ts 에 P207 guard + toast.error 존재 의무
//
// 트리거: api/pdf/generate.js 또는 pdfGenerator.ts 변경 시.
// ----------------------------------------------------------------------------
function P207_pdfEmptyPlanGuard({ changed }) {
  const SERVER = 'api/pdf/generate.js';
  const CLIENT = 'src/pages/PlanDetailPage/pdfGenerator.ts';
  const serverChanged = isModified(SERVER, changed);
  const clientChanged = isModified(CLIENT, changed);
  if (!serverChanged && !clientChanged) return { skipped: true };

  const issues = [];

  if (serverChanged) {
    const src = getChangedFileContent(SERVER);
    if (!src) return { skipped: true };

    // days.length === 0 guard
    const hasDaysGuard =
      /Array\.isArray\(_daysArr\)/.test(src) ||
      /!Array\.isArray/.test(src) ||
      /daysArr\.length === 0/.test(src) ||
      /!daysArr\?\.length/.test(src);
    if (!hasDaysGuard) {
      issues.push('server: days=0 guard 누락 (daysArr.length === 0 또는 !Array.isArray 조건)');
    }

    // 422 status
    if (!/.status\(422\)/.test(src)) {
      issues.push('server: 422 status 반환 누락');
    }

    // streaming_in_progress reason
    if (!/streaming_in_progress/.test(src)) {
      issues.push('server: streaming_in_progress reason 누락');
    }
  }

  if (clientChanged) {
    const src = getChangedFileContent(CLIENT);
    if (!src) return { skipped: true };

    // P207 guard 존재
    const hasDaysCheck =
      /plan\?\.itinerary\?\.days\?\.length/.test(src) ||
      /itinerary\?\.days\?\.length/.test(src);
    if (!hasDaysCheck) {
      issues.push('client pdfGenerator.ts: P207 days=0 guard 누락');
    }

    // toast.error 동반
    if (!/toast\.error/.test(src)) {
      issues.push('client pdfGenerator.ts: toast.error 없이 days=0 guard 추가 (사용자 미통지)');
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P207_pdfEmptyPlanGuard',
    severity: 'error',
    file: serverChanged ? SERVER : CLIENT,
    message: 'R-P207: PDF 빈 plan guard 손상 — days=0 plan 이 16KB 빈 PDF 생성 회귀 위험. 발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// P208_notoSansKrBundle — R-P208 (2026-05-26) cleanup add (squash merge bug 회복).
// ----------------------------------------------------------------------------
function P208_notoSansKrBundle({ changed }) {
  const PDF_FILE = 'api/pdf/generate.js';
  const VERCEL_FILE = 'vercel.json';
  const pdfChanged = isModified(PDF_FILE, changed);
  const vercelChanged = isModified(VERCEL_FILE, changed);
  if (!pdfChanged && !vercelChanged) return { skipped: true };

  const issues = [];

  if (pdfChanged) {
    const src = getChangedFileContent(PDF_FILE);
    if (src) {
      if (!src.includes("font-family: 'Noto Sans KR'") && !src.includes('font-family: "Noto Sans KR"')) {
        issues.push(`${PDF_FILE}: @font-face 'Noto Sans KR' 선언 누락 — @sparticuz/chromium v147 CJK 없음, file:// URL 명시 의무`);
      } else if (!src.includes('file:///var/task/fonts/NotoSansKR')) {
        issues.push(`${PDF_FILE}: @font-face src 에 file:///var/task/fonts/NotoSansKR 경로 누락 — Vercel /var/task = project root, 절대 경로 필수`);
      }
    }
  }

  if (vercelChanged) {
    const src = getChangedFileContent(VERCEL_FILE);
    if (src) {
      let parsed;
      try { parsed = JSON.parse(src); } catch { /* JSON 파싱 실패면 skip */ }
      if (parsed) {
        const pdfFn = parsed?.functions?.['api/pdf/generate.js'];
        if (!pdfFn || pdfFn.maxDuration !== 60) {
          issues.push(`${VERCEL_FILE}: api/pdf/generate.js maxDuration 60 누락 — wildcard api/*.js 30초 적용 시 cold start 5-10s + render 30s = timeout`);
        }
      }
    }
  }

  const regularPath = 'fonts/NotoSansKR-Regular.otf';
  const boldPath = 'fonts/NotoSansKR-Bold.otf';
  if (!existsSync(regularPath)) {
    issues.push(`${regularPath} 파일 없음 — @sparticuz/chromium CJK 없으므로 OTF 번들 의무`);
  }
  if (!existsSync(boldPath)) {
    issues.push(`${boldPath} 파일 없음 — Bold OTF 번들 의무`);
  }

  if (issues.length > 0) {
    fail(
      'P208_notoSansKrBundle',
      `R-P208: Noto Sans KR 번들 ${issues.length}건 누락 — ${issues.slice(0, 3).join(' | ')}${issues.length > 3 ? ' …' : ''}`,
      'P208 fix: fonts/ 디렉토리에 NotoSansKR OTF + @font-face file:///var/task/fonts/ + vercel.json maxDuration:60. sparticuz/chromium Issue #333 참조.',
    );
  }
  return null;
}

// ----------------------------------------------------------------------------
// P209_serverPdfArrivalDeparture — api/pdf/generate.js buildPlanHtml 에
// arrival_guide + departure_guide 섹션 존재 보장.
//
// 5/26 시각 검증: server PDF (Puppeteer) 가 header + days + footer 만 렌더.
// P205 self-heal 이 Firestore 에 ICN_T1/PUS 정상 저장해도 PDF 표시 코드 없음
// → 결제 사용자 PDF 에 입국/출국 가이드 0건. P209 fix 로 추가.
//
// 트리거: api/pdf/generate.js 변경 시.
// R-P209: buildPlanHtml 안에 arrival_guide + departure_guide 키 grep 의무.
// ----------------------------------------------------------------------------

function P209_serverPdfArrivalDeparture({ changed }) {
  const FILE = 'api/pdf/generate.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const content = getChangedFileContent(FILE);
  if (!content) return { skipped: true };

  const issues = [];

  // buildPlanHtml 함수 body 추출 (대략 function 이름 이후)
  const fnStart = content.indexOf('function buildPlanHtml');
  const fnBody = fnStart >= 0 ? content.slice(fnStart) : content;

  if (!fnBody.includes('arrival_guide')) {
    issues.push('buildPlanHtml 에 arrival_guide 키 미참조 — 입국 가이드 PDF 누락 (P209 회귀)');
  }
  if (!fnBody.includes('departure_guide')) {
    issues.push('buildPlanHtml 에 departure_guide 키 미참조 — 출국 가이드 PDF 누락 (P209 회귀)');
  }

  // escapeHtml 적용 의무 — arrival.airport / departure.airport
  if (!/escapeHtml\(\s*arrival\.(airport|steps|steps\[)/.test(fnBody) &&
      !/escapeHtml\(\s*step\.(title|description)/.test(fnBody)) {
    issues.push('arrival steps 텍스트에 escapeHtml 미적용 — XSS 위험 (P209 규칙)');
  }

  if (issues.length === 0) return null;

  fail(
    'P209_serverPdfArrivalDeparture',
    `R-P209: api/pdf/generate.js buildPlanHtml 에 arrival/departure 섹션 누락 또는 XSS 미방어 ${issues.length}건 — ${issues.join(' | ')}`,
    'P209 fix — buildPlanHtml 에 arrival_guide + departure_guide 섹션 추가 + escapeHtml 모든 동적 텍스트 적용. deep-search: reports/visual-2026-05-26/deepsearch-p209.md',
  );
  return null;
}

// ----------------------------------------------------------------------------
// P214_flashTruncationMitigation — maxOutputTokens 다운그레이드 차단 (2026-05-26)
//
// 5/26 측정: Flash 5-day plan 2/5 sample (40%) 가 days=3 만 반환.
// raw 47,597 chars (≈11,900 tokens) 에서 비결정적 truncation — maxOutputTokens 24K 대비 50%.
// 외부 사례: Google AI Forum #81258 "Consistent truncation despite being under limits".
// fix: maxOutputTokens 24K → 32K (실측 peak 의 2.7x — Flash 내부 token budget 여유 인지 개선).
//
// 룰: geminiPipeline.js 의 generationConfig.maxOutputTokens 가 32000 미만이면 fail.
// thinkingBudget:0 보존 의무 (Flash thinking 토큰 competing 방지 — P192 안전장치).
// ----------------------------------------------------------------------------

/**
 * P214_flashTruncationMitigation — maxOutputTokens ≥ 32000 + thinkingBudget Flash=0 유지 검증.
 *
 * 트리거: api/_ai_core/geminiPipeline.js 변경 시.
 */
function P214_flashTruncationMitigation({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  // 1. generationConfig 내 maxOutputTokens 값 확인
  const tokenMatch = src.match(/generationConfig\s*:\s*\{[\s\S]*?maxOutputTokens\s*:\s*(\d+)/);
  if (!tokenMatch) {
    issues.push('generationConfig 내 maxOutputTokens 설정 없음');
  } else {
    const tokenVal = Number(tokenMatch[1]);
    if (tokenVal < 32000) {
      issues.push(`maxOutputTokens=${tokenVal} — 32000 미만 다운그레이드 감지. P214 Flash truncation 회귀 위험 (Google AI Forum #81258)`);
    }
  }

  // 2. Flash thinkingBudget=0 보존 (P192 안전장치)
  if (!/isFlash\s*\?\s*0\s*:/.test(src)) {
    issues.push('Flash thinkingBudget=0 패턴 누락 — thinking 토큰이 output cap 침범 위험 (P192 회귀)');
  }

  if (issues.length === 0) return null;

  fail(
    'P214_flashTruncationMitigation',
    `R-P214: geminiPipeline.js Flash truncation 완화 설정 손상 ${issues.length}건 — ${issues.join(' | ')}`,
    'P214 fix — maxOutputTokens ≥ 32000 유지 + Flash thinkingBudget=0 보존. 외부 사례: Google AI Forum #81258 / LangChain #34100.',
  );
  return null;
}

// ----------------------------------------------------------------------------
// P215_finishReasonDetect — finishReason 감지 코드 회귀 차단 (2026-05-26)
//
// 5/26 deep-search 발견: Gemini Flash 3.5 가 MAX_TOKENS 잘림 발생 시
// finishReason='MAX_TOKENS' 신호를 보내지만 기존 코드는 STOP 과 구분 안 함.
// → 잘린 plan 도 "정상" 처리 → repairAndParseJSON 수리 실패 → minimal fallback → P181 alert.
//
// 외부 사례: github.com/google-gemini/gemini-cli/issues/2104
//
// 룰:
//   1. geminiPipeline.js 에 extractFinishReason export 존재
//   2. handleFinishReason export 존재
//   3. legacy 1-pass 분기 (result.response.text()) 직전에 handleFinishReason 호출
//   4. MAX_TOKENS retry 로직 존재 (retryWithExpandedTokens)
// ----------------------------------------------------------------------------

/**
 * P215_finishReasonDetect — geminiPipeline.js finishReason 감지 회귀 차단.
 * 트리거: api/_ai_core/geminiPipeline.js 변경 시.
 */
function P215_finishReasonDetect({ changed }) {
  const FILE = 'api/_ai_core/geminiPipeline.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE) || getChangedFileContent(FILE);
  if (!src) return { skipped: true };

  const issues = [];

  // 1. extractFinishReason export 존재
  if (!/export function extractFinishReason/.test(src)) {
    issues.push('extractFinishReason export 누락 — Gemini finishReason 추출 함수 회귀');
  }

  // 2. handleFinishReason export 존재
  if (!/export async function handleFinishReason/.test(src)) {
    issues.push('handleFinishReason export 누락 — MAX_TOKENS/SAFETY/RECITATION 처리 함수 회귀');
  }

  // 3. legacy 1-pass 에 handleFinishReason 호출 (result.response.text() 전에)
  if (!/handleFinishReason\s*\(/.test(src)) {
    issues.push('handleFinishReason 호출 없음 — legacy 1-pass 에서 finishReason 감지 안 됨. 잘린 plan 도 STOP 과 동일 처리 회귀');
  }

  // 4. MAX_TOKENS retry 함수 (retryWithExpandedTokens) 존재
  if (!/export async function retryWithExpandedTokens/.test(src)) {
    issues.push('retryWithExpandedTokens export 누락 — MAX_TOKENS 65K retry 함수 회귀');
  }

  if (issues.length === 0) return null;

  fail(
    'P215_finishReasonDetect',
    `R-P215: geminiPipeline.js finishReason 감지 설정 손상 ${issues.length}건 — ${issues.join(' | ')}`,
    'P215 fix — extractFinishReason + handleFinishReason + retryWithExpandedTokens 3종 세트. ' +
    '외부 사례: github.com/google-gemini/gemini-cli/issues/2104 (MAX_TOKENS 잘림 → silent partial plan 전달). ' +
    '비유: "5코스 요리 만들다 재료 떨어진 주방에서 웨이터가 확인도 안 하고 3코스만 들고 손님한테 나가는 상황".',
  );
  return null;
}

// ----------------------------------------------------------------------------
// P219_thoughtPartFilter — Gemini thinking 모드 thought:true part 필터 회귀 차단
//
// 배경 (2026-05-26): Gemini 2.5/3.x thinking 모델은 candidates[0].content.parts[]
// 에 `{thought: true, text: ...}` 메타 part 를 섞어 반환. SDK `response.text()` /
// `chunk.text()` 는 thought 필터링하지 않고 모든 parts concat (공식 docs 확인:
// EnhancedGenerateContentResponse.text "assembled from all Parts").
//
// 위험:
//   - 보안: 모델 chain-of-thought 가 prod 응답에 leak (Raw Logic Leak)
//   - 기능: thought + JSON 혼재 → repairAndParseJSON 실패 → P181 minimal fallback
//   - Compliance: 시스템 prompt 단서 노출 = prompt injection 단서 제공
//
// 출처: googlecloudplatform/generative-ai gemini/getting-started/intro_gemini_2_5_*.ipynb
//   ("for part in response.candidates[0].content.parts: if part.thought: # 메타").
//
// 룰:
//   1. extractTextFromResponse export 존재 (geminiPipeline.js)
//   2. extractTextFromChunk export 존재 (streaming 보안)
//   3. helper 안에 `thought === true` 체크 존재
//   4. geminiPipeline.js / threePassPipeline.js — 변경 시 `result.response.text()`
//      가 가능한 plan 핵심 경로에서는 extractTextFromResponse 로 호출되도록 권장
//      (warning only — 점진 마이그용 — strict 검사는 helper 존재 여부만)
// ----------------------------------------------------------------------------

/**
 * P219_thoughtPartFilter — Gemini SDK thought:true part 필터 회귀 차단.
 * 트리거: api/_ai_core/geminiPipeline.js 또는 threePassPipeline.js 변경 시.
 */
function P219_thoughtPartFilter({ changed }) {
  const GEMINI = 'api/_ai_core/geminiPipeline.js';
  const THREE = 'api/_ai_core/threePassPipeline.js';
  const geminiTouched = isModified(GEMINI, changed);
  const threeTouched = isModified(THREE, changed);
  if (!geminiTouched && !threeTouched) return { skipped: true };

  const geminiSrc = readFileExists(GEMINI) || getChangedFileContent(GEMINI);
  if (!geminiSrc) return { skipped: true };

  const issues = [];

  // 1. extractTextFromResponse export 존재
  if (!/export function extractTextFromResponse/.test(geminiSrc)) {
    issues.push('extractTextFromResponse export 누락 — Gemini thought:true 필터 helper 회귀');
  }

  // 2. extractTextFromChunk export 존재 (streaming 보안 critical)
  if (!/export function extractTextFromChunk/.test(geminiSrc)) {
    issues.push('extractTextFromChunk export 누락 — streaming chunk thought 필터 helper 회귀');
  }

  // 3. helper 안에 thought === true 체크 존재
  if (!/thought\s*===\s*true/.test(geminiSrc)) {
    issues.push('`thought === true` 체크 누락 — Raw Logic Leak 방어 로직 회귀');
  }

  // 4. P219 주석 존재 (맥락 보존)
  if (!/P219/.test(geminiSrc)) {
    issues.push('P219 주석 누락 — fix 맥락 손실');
  }

  // 5. threePassPipeline.js 도 변경됐다면 extractTextFromResponse 사용 의무
  if (threeTouched) {
    const threeSrc = readFileExists(THREE) || getChangedFileContent(THREE);
    if (threeSrc && !/extractTextFromResponse/.test(threeSrc)) {
      issues.push('threePassPipeline.js 가 extractTextFromResponse import/사용 안 함 — Pass1/Pass3 응답에서 thought leak 위험');
    }
  }

  if (issues.length === 0) return null;

  fail(
    'P219_thoughtPartFilter',
    `R-P219: Gemini thought:true part 필터 설정 손상 ${issues.length}건 — ${issues.join(' | ')}`,
    'P219 fix — 보안 critical. Gemini SDK response.text() / chunk.text() 는 thought 필터링 안 함 → ' +
    'extractTextFromResponse / extractTextFromChunk helper 의무. 출처: 3 AI second opinion (Gemini AI 직접 권고) + ' +
    'googlecloudplatform/generative-ai 공식 example. 비유: "녹취록에 발표 원고와 발표자 머릿속 메모가 같이 적혀 나오는 상황 — ' +
    '필터 없이 그대로 청중에게 배포하면 영업비밀이 노출됨".',
  );
  return null;
}

// ----------------------------------------------------------------------------
// P228_transitCacheIntegrity — transit cache 핵심 구조 유지 감시 (2026-05-27)
//
// 운영자 의도: ODsay 매번 호출 안 하고 DB 에서 복붙 = 빠르고 안정.
// Phase 3 transit cache 가 손상되면 ODsay 절감 효과 0 + latency 회귀.
//
// 트리거: api/_ai_core/transitCache.js 또는 RouteAgent.js 변경 시.
// ----------------------------------------------------------------------------

function P228_transitCacheIntegrity({ changed }) {
  const CACHE_FILE = 'api/_ai_core/transitCache.js';
  const ROUTE_FILE = 'api/_ai_core/agents/RouteAgent.js';
  const cacheChanged = isModified(CACHE_FILE, changed);
  const routeChanged = isModified(ROUTE_FILE, changed);
  if (!cacheChanged && !routeChanged) return { skipped: true };

  const issues = [];

  if (cacheChanged) {
    const src = readFileExists(CACHE_FILE) || '';
    // lookupTransitCache export 존재
    if (!/export async function lookupTransitCache/.test(src)) {
      issues.push('lookupTransitCache export 누락 — cache lookup 불가');
    }
    // mock 데이터 miss 처리 (품질 보호 — 15분 기본값 차단)
    if (!/source === 'mock'/.test(src) || !/return null/.test(src)) {
      issues.push('source=mock → null 반환 로직 누락 — mock 데이터가 cache hit 으로 처리될 위험');
    }
    // ENV circuit breaker
    if (!/ROUTE_TRANSIT_CACHE_ENABLED/.test(src)) {
      issues.push('ROUTE_TRANSIT_CACHE_ENABLED circuit breaker 누락');
    }
    // invalidateTransitCache export 존재 (운영자 재시드 후 수동 flush 용)
    if (!/export function invalidateTransitCache/.test(src)) {
      issues.push('invalidateTransitCache export 누락 — 운영자 재시드 후 캐시 갱신 불가');
    }
  }

  if (routeChanged) {
    const src = readFileExists(ROUTE_FILE) || '';
    // transitCache import 존재
    if (!/from ['"]\.\.\/transitCache\.js['"]/.test(src)) {
      issues.push('RouteAgent.js 에서 transitCache import 누락 — cache 비활성 회귀');
    }
    // lookupTransitCache 호출 존재
    if (!/lookupTransitCache\(/.test(src)) {
      issues.push('RouteAgent.js 에서 lookupTransitCache 호출 누락 — cache 완전 비활성');
    }
    // dayZoneId 사용 (day-level zone_id)
    if (!/dayZoneId/.test(src)) {
      issues.push('RouteAgent.js 에 dayZoneId 누락 — block mode zone_id 연결 손상');
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P228_transitCacheIntegrity',
    severity: 'error',
    file: cacheChanged ? CACHE_FILE : ROUTE_FILE,
    message:
      'R-P228: Phase 3 transit cache 손상 — ODsay 절감 효과 0 + latency 회귀 위험 (P228 2026-05-27). ' +
      '발견: ' + issues.join(' | '),
  };
}

// ----------------------------------------------------------------------------
// P231_skeletonInWorkerGuard — skeleton-in-worker 구조 정합성 감시 (2026-05-27)
//
// 운영자 의도: HTTP 응답 경로에서 Firestore full skeleton 저장 1-2s 절감.
//   PLANNER_SKELETON_IN_WORKER=true 시 HTTP handler = stub 저장만,
//   worker Step 0 = full skeleton 저장. ENV off = 기존 동작 100% 보장.
//
// 비유: "접수 창구는 접수증만 발행 (빠름), 뒤에서 담당자가 풀 서류 작성 (worker)".
//
// 핵심 불변식:
//   1. backgroundPipelines.js 에 isSkeletonInWorkerEnabled export 존재
//   2. tryInitStreamingSkeleton 이 isSkeletonInWorkerEnabled() 조건 분기 존재
//   3. processPlanAfterAI.js 에 'skeleton-write' step.run 호출 존재
//   4. processPlanAfterAI.js 에 ctx.skeletonCtx 조건 분기 존재
//   5. inngestDispatch.js buildPlanAiCompletePayload 에 skeletonCtx spread 존재
//
// R-P231 위반 시: HTTP handler 가 full skeleton 저장 + worker 가 중복 저장 →
//   Firestore 2 write (비용 2x) 또는 worker 가 skeletonCtx 없이 stub 방치 → client 404.
//
// 트리거: backgroundPipelines.js / processPlanAfterAI.js / inngestDispatch.js 변경 시.
// ----------------------------------------------------------------------------

function P231_skeletonInWorkerGuard({ changed }) {
  const BP_FILE = 'api/_ai_core/backgroundPipelines.js';
  const WORKER_FILE = 'api/_inngest/functions/processPlanAfterAI.js';
  const DISPATCH_FILE = 'api/_ai_core/inngestDispatch.js';
  const bpChanged = isModified(BP_FILE, changed);
  const workerChanged = isModified(WORKER_FILE, changed);
  const dispatchChanged = isModified(DISPATCH_FILE, changed);
  if (!bpChanged && !workerChanged && !dispatchChanged) return { skipped: true };

  const issues = [];

  if (bpChanged) {
    const src = readFileExists(BP_FILE) || '';
    // isSkeletonInWorkerEnabled export 존재
    if (!/export function isSkeletonInWorkerEnabled/.test(src)) {
      issues.push('backgroundPipelines.js: isSkeletonInWorkerEnabled export 누락 — ENV 토글 비활성 회귀');
    }
    // tryInitStreamingSkeleton 에 isSkeletonInWorkerEnabled() 분기 존재
    if (!/isSkeletonInWorkerEnabled\(\)/.test(src)) {
      issues.push('backgroundPipelines.js: isSkeletonInWorkerEnabled() 호출 누락 — stub 저장 분기 손상');
    }
    // PLANNER_SKELETON_IN_WORKER ENV 참조 존재
    if (!/PLANNER_SKELETON_IN_WORKER/.test(src)) {
      issues.push('backgroundPipelines.js: PLANNER_SKELETON_IN_WORKER ENV 참조 누락 — rollback 안전판 없음');
    }
  }

  if (workerChanged) {
    const src = readFileExists(WORKER_FILE) || '';
    // 'skeleton-write' step.run 존재
    if (!/'skeleton-write'/.test(src)) {
      issues.push("processPlanAfterAI.js: 'skeleton-write' step.run 누락 — stub doc 방치 위험 (P231 regression)");
    }
    // ctx.skeletonCtx 조건 분기 존재
    if (!/ctx\.skeletonCtx/.test(src)) {
      issues.push('processPlanAfterAI.js: ctx.skeletonCtx 조건 분기 누락 — ENV off 시 불필요 step 실행');
    }
    // savePlanSkeleton import 존재
    if (!/savePlanSkeleton/.test(src)) {
      issues.push('processPlanAfterAI.js: savePlanSkeleton import 누락 — skeleton-write step 비활성');
    }
  }

  if (dispatchChanged) {
    const src = readFileExists(DISPATCH_FILE) || '';
    // skeletonCtx spread 존재
    if (!/skeletonCtx/.test(src)) {
      issues.push('inngestDispatch.js: skeletonCtx 전달 코드 누락 — worker 가 ctx.skeletonCtx 못 받음 → stub 방치 위험');
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P231_skeletonInWorkerGuard',
    severity: 'error',
    file: bpChanged ? BP_FILE : workerChanged ? WORKER_FILE : DISPATCH_FILE,
    message:
      'R-P231: skeleton-in-worker 구조 정합성 손상 (P231 2026-05-27). ' +
      '비유: "접수증→담당자 서류 완성" 연결이 끊어지면 client 가 404 또는 stub 방치. ' +
      '발견: ' + issues.join(' | '),
  };
}

// ----------------------------------------------------------------------------
// P234_odsayDirectCallGuard — ODsay 직접 호출 (cache wrapper 없음) 감시 (2026-05-27)
// ----------------------------------------------------------------------------
//
// 목적: ODsay searchPubTransPathT 를 transitCache lookup 없이 직접 호출하는
//   새 site 추가 회귀 감시. P228 cache 우회 → quota 소진 원인.
//
// 허용된 직접 호출 파일:
//   - scripts/build-zone-course.mjs         (시드 전용 — intentional)
//   - api/admin-rebuild-zone-course-transit.js (관리자 API — intentional)
//   - scripts/test-odsay.mjs                (테스트 전용)
//   - api/recalc-transit.js                 (stale 구간 재계산 전용)
//   - api/_ai_core/agents/RouteAgent.js     (P228 cache wrapper 내에 포함됨)
//
// 트리거: api/_ai_core/ 또는 api/ 의 JS 파일 변경 시.
// ----------------------------------------------------------------------------

function P234_odsayDirectCallGuard({ changed }) {
  // 허용된 파일 목록 (ODsay 직접 호출 정당한 컨텍스트)
  const ALLOWED_DIRECT_CALLERS = new Set([
    'scripts/build-zone-course.mjs',
    'api/admin-rebuild-zone-course-transit.js',
    'scripts/test-odsay.mjs',
    'api/recalc-transit.js',
    'api/_ai_core/agents/RouteAgent.js', // cache lookup 내에 있음
    'scripts/verify-odsay-fix.mjs',
    'scripts/audit-transit.mjs',
  ]);

  // api/ 또는 scripts/ 에서 변경된 JS/MJS 파일만 검사 (changed = {file, status}[] 형식)
  const relevantEntries = changed.filter(
    (c) =>
      c.status !== 'D' &&
      (c.file.startsWith('api/') || c.file.startsWith('scripts/')) &&
      (c.file.endsWith('.js') || c.file.endsWith('.mjs')) &&
      !ALLOWED_DIRECT_CALLERS.has(c.file)
  );
  if (relevantEntries.length === 0) return { skipped: true };

  const issues = [];
  for (const { file } of relevantEntries) {
    const src = readFileExists(file) || '';
    // ODsay API endpoint 직접 호출 여부: searchPubTransPathT 사용
    if (/searchPubTransPathT/.test(src)) {
      // transitCache wrapper 를 같이 import 하면 OK
      if (!/transitCache/.test(src) && !/lookupTransitCache/.test(src)) {
        issues.push(
          `${file}: searchPubTransPathT 직접 호출 + transitCache lookup 없음 → ODsay quota 소진 회귀 위험`
        );
      }
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P234_odsayDirectCallGuard',
    severity: 'warning',
    file: issues[0].split(':')[0],
    message:
      'R-P234: ODsay 직접 호출 + cache wrapper 없음 감지 (P234 2026-05-27). ' +
      '비유: "메뉴판 확인 안 하고 매번 주방에 새 요리 주문 = quota 소진". ' +
      '허용 파일(시드/관리자/테스트) 외 신규 직접 호출은 lookupTransitCache() 먼저 호출 필요. ' +
      '발견: ' + issues.join(' | '),
  };
}

// ----------------------------------------------------------------------------
// P237_runningHelperIntegrity — Running 코스 DB 주입 체인 검증 (P237 2026-05-27)
// ----------------------------------------------------------------------------
/**
 * P237_runningHelperIntegrity
 *
 * P237 (2026-05-27): Running/HangangRun 선택 시 _running_helper.js 주입 체인.
 * 비유: "달리기 코스 지도 없이 외국인 서울 러닝 보냄 = 잘못된 거리/경로 hallucination"
 *
 * 검사:
 *   1. _running_helper.js 변경 시 getRunningContextForPrompt export 존재
 *   2. handlerCore.js 에 Running/HangangRun 분기 + getRunningContextForPrompt 호출
 *   3. _running_index.json row count > 0
 */
function P237_runningHelperIntegrity({ changed, readFile, statFile }) {
  const TARGET = 'api/_running_helper.js';
  const HANDLER = 'api/_ai_core/handlerCore.js';
  const INDEX = 'api/_running_index.json';

  const changedFiles = (changed || []).map(c => typeof c === 'string' ? c : c.path || '');
  const affected = changedFiles.some(f => f.includes('_running_helper') || f.includes('_running_index') || f.includes('handlerCore'));
  if (!affected) return null;

  const issues = [];

  // (1) _running_helper.js export check
  if (changedFiles.some(f => f.includes('_running_helper'))) {
    try {
      const src = readFile(TARGET);
      if (!/export\s+function\s+getRunningContextForPrompt/.test(src)) {
        issues.push(`${TARGET}: getRunningContextForPrompt export 누락 — Running 코스 DB 주입 불가`);
      }
    } catch { /* file may not exist yet */ }
  }

  // (2) handlerCore.js integration check
  if (changedFiles.some(f => f.includes('handlerCore'))) {
    try {
      const handler = readFile(HANDLER);
      if (!/getRunningContextForPrompt/.test(handler)) {
        issues.push(`${HANDLER}: getRunningContextForPrompt 호출 없음 — Running/HangangRun DB 주입 미연결 (P237)`);
      }
      if (!/(HangangRun|Running)/.test(handler)) {
        issues.push(`${HANDLER}: HangangRun/Running 분기 없음 — running 코스 조건부 주입 불가`);
      }
    } catch { /* handler might not be changed */ }
  }

  // (3) _running_index.json row count
  if (changedFiles.some(f => f.includes('_running_index'))) {
    try {
      const raw = readFile(INDEX);
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) {
        issues.push(`${INDEX}: 빈 배열 또는 파싱 실패 — 러닝 코스 DB row 0건`);
      }
    } catch { issues.push(`${INDEX}: 읽기 실패`); }
  }

  if (issues.length === 0) return null;
  return {
    rule: 'P237_runningHelperIntegrity',
    file: issues[0].split(':')[0],
    message:
      'R-P237: Running 코스 DB 주입 체인 손상 감지 (P237 2026-05-27). ' +
      '비유: "달리기 코스 지도 없이 외국인 러닝 보냄 = hallucination 위험". ' +
      '_running_helper.js getRunningContextForPrompt + handlerCore 분기 + _running_index.json row > 0 필수. ' +
      '발견: ' + issues.join(' | '),
  };
}

// ----------------------------------------------------------------------------
// P241_activityHelperIntegrity — Activity DB 주입 체인 검증 (P241 2026-05-27)
// ----------------------------------------------------------------------------
/**
 * P241_activityHelperIntegrity
 *
 * P241 (2026-05-27): Kbeauty/DMZ/Haenyeo/Jjimjilbang/HangangBike 선택 시
 * _activity_helper.js 주입 체인 + 각 index JSON 파일 로드 검증.
 * 비유: "K뷰티 쇼핑 안내 없이 외국인 명동 보내는 것 = hallucination 위험"
 *
 * 검사:
 *   1. _activity_helper.js 변경 시 getActivityContextForPrompt export 존재
 *   2. userMessageBuilder.js 에 P241_ACTIVITY_STYLES + buildP241ActivityContext 존재
 *   3. 각 index JSON (_kbeauty/dmz/haenyeo/jjimjilbang/hangang_bike) row > 0
 *
 * NOTE: P241 은 handlerCore.js 미변경 패턴 — userMessageBuilder.js 내부 주입.
 */
function P241_activityHelperIntegrity({ changed, readFile }) {
  const HELPER = 'api/_activity_helper.js';
  const BUILDER = 'api/_ai_core/userMessageBuilder.js';
  const INDEXES = [
    'api/_kbeauty_index.json',
    'api/_dmz_index.json',
    'api/_haenyeo_index.json',
    'api/_jjimjilbang_index.json',
    'api/_hangang_bike_index.json',
  ];

  const changedFiles = (changed || []).map(c => typeof c === 'string' ? c : c.path || '');
  const affected = changedFiles.some(f =>
    f.includes('_activity_helper') || f.includes('_hotel_helper') ||
    f.includes('_kbeauty_index') || f.includes('_dmz_index') ||
    f.includes('_haenyeo_index') || f.includes('_jjimjilbang_index') ||
    f.includes('_hangang_bike_index') || f.includes('_hotel_index') ||
    f.includes('userMessageBuilder'),
  );
  if (!affected) return null;

  const issues = [];

  // (1) _activity_helper.js export check
  if (changedFiles.some(f => f.includes('_activity_helper'))) {
    try {
      const src = readFile(HELPER);
      if (!/export\s+function\s+getActivityContextForPrompt/.test(src)) {
        issues.push(`${HELPER}: getActivityContextForPrompt export 누락 — 활동 DB 주입 불가`);
      }
    } catch { /* file may not exist yet */ }
  }

  // (2) userMessageBuilder.js integration check (P241 handlerCore 미변경 패턴)
  if (changedFiles.some(f => f.includes('userMessageBuilder'))) {
    try {
      const builder = readFile(BUILDER);
      if (!/getActivityContextForPrompt/.test(builder)) {
        issues.push(`${BUILDER}: getActivityContextForPrompt import 없음 — P241 활동 DB 주입 미연결`);
      }
      if (!/P241_ACTIVITY_STYLES/.test(builder)) {
        issues.push(`${BUILDER}: P241_ACTIVITY_STYLES 없음 — Kbeauty/DMZ/Haenyeo 조건부 주입 불가`);
      }
    } catch { /* builder might not be changed */ }
  }

  // (3) index JSON row counts
  for (const indexFile of INDEXES) {
    if (changedFiles.some(f => f.includes(indexFile.replace('api/', '')))) {
      try {
        const raw = readFile(indexFile);
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || arr.length === 0) {
          issues.push(`${indexFile}: 빈 배열 — 활동 DB row 0건`);
        }
      } catch { issues.push(`${indexFile}: 읽기/파싱 실패`); }
    }
  }

  if (issues.length === 0) return null;
  return {
    rule: 'P241_activityHelperIntegrity',
    file: issues[0].split(':')[0],
    message:
      'R-P241: Activity DB 주입 체인 손상 감지 (P241 2026-05-27). ' +
      '비유: "K뷰티 안내 없이 외국인 명동 보냄 = hallucination 위험". ' +
      '_activity_helper.js getActivityContextForPrompt + handlerCore P241_STYLES 분기 + 각 index row > 0 필수. ' +
      '발견: ' + issues.join(' | '),
  };
}

// ----------------------------------------------------------------------------
// R-P235: PWA stale cache — PlanDetailPage Firestore 오류 핸들러 구분
// ----------------------------------------------------------------------------
// P235 lesson (2026-05-27): onSnapshot error handler 가 모든 Firestore 에러를
// 'notfound' 로 처리 → permission-denied (인증 만료 / PWA 스테일 캐시) 도
// "플랜을 찾을 수 없습니다" 오표시. 비유: 열쇠가 맞지 않는데 "문이 없다" 고 안내.
// 픽스: error code 'permission-denied' → 'autherror' 분기 (새로고침 유도).
// 본 lint rule: PlanDetailPage onSnapshot error handler 에서 permission-denied
// 구분 없이 직접 setError('notfound') 를 호출하지 않도록 감시.

/**
 * R-P235: PlanDetailPage onSnapshot error handler 에서 permission-denied 구분 없이
 * setError('notfound') 직접 호출 감지.
 */
function checkP235FirestoreErrorDistinction({ changed }) {
  // PlanDetailPage/index.tsx 만 검사 — 다른 파일은 무관
  const PLAN_DETAIL = 'src/pages/PlanDetailPage/index.tsx';
  const entry = changed.find(
    (c) => c.status !== 'D' && (
      c.file.replace(/\\/g, '/').endsWith(PLAN_DETAIL) ||
      c.file.replace(/\\/g, '/').includes('PlanDetailPage/index')
    ),
  );
  if (!entry) return { skipped: true };

  const content = getChangedFileContent(entry.file);
  if (!content) return null;

  const lines = content.split('\n');
  // 오류 핸들러 콜백 블록에서 직접 setError('notfound') 있고,
  // permission-denied 분기 없으면 위반.
  // 허용 패턴: code === 'permission-denied' 또는 'PERMISSION_DENIED' 분기가 반드시 있어야 함.
  const hasPermissionCheck = lines.some(
    (l) => l.includes('permission-denied') || l.includes('PERMISSION_DENIED'),
  );
  if (!hasPermissionCheck) {
    // onSnapshot 에러 핸들러 내 setError('notfound') 있는지 확인
    const hasDirectNotfound = lines.some(
      (l) => l.includes("setError('notfound')") && !l.trim().startsWith('//'),
    );
    if (hasDirectNotfound) {
      fail(
        'P235_firestoreErrorDistinction',
        `${entry.file}: onSnapshot error handler 에서 permission-denied 구분 없이 setError('notfound') 직접 호출 → P235 fix 후 회귀`,
        'R-P235: PlanDetailPage onSnapshot 에러 핸들러에 permission-denied → autherror 분기 의무. ' +
        '비유: "열쇠가 맞지 않는데 문이 없다고 안내" = 사용자 혼란. error code permission-denied 는 autherror 로 분기 (새로고침 안내) 필수.'
      );
    }
  }
  return null;
}

// R-P240: block_mode allergies 미전달 SAFETY — handlerCore tryRunBlockMode userInput.allergies 의무
// ----------------------------------------------------------------------------
// P240 lesson (2026-05-27): tryRunBlockMode 호출 시 userInput 에 allergies 누락 →
// block 선택 Gemini prompt 에 외국인 알레르기 정보 미전달 = 건강 위험.
// 비유: "땅콩 알레르기 있는 손님 메뉴판에서 알레르기 정보 빼고 주문 받는 웨이터"
// fix: handlerCore.js 구조분해 + tryRunBlockMode userInput 에 allergies 추가.
//
// 룰:
//   1. handlerCore.js 변경 시 shaped 구조분해에 allergies 있어야 함.
//   2. handlerCore.js 변경 시 tryRunBlockMode 호출 userInput 에 allergies 있어야 함.
//   3. blockMode.js 변경 시 selectBlocksWithGemini / selectBlocksMultiCity 의 userMessage 에 food_allergies 있어야 함.

/**
 * R-P240: block_mode allergies 미전달 SAFETY 감시.
 */
function P240_blockModeAllergenSafety({ changed }) {
  const HANDLER = 'api/_ai_core/handlerCore.js';
  const BLOCK = 'api/_ai_core/blockMode.js';

  const changedFiles = (changed || []).map(c => typeof c === 'string' ? c : c.path || c.file || '');
  const handlerChanged = changedFiles.some(f => f.replace(/\\/g, '/').includes('handlerCore'));
  const blockChanged = changedFiles.some(f => f.replace(/\\/g, '/').includes('blockMode'));

  if (!handlerChanged && !blockChanged) return null;

  const issues = [];

  if (handlerChanged) {
    try {
      const handler = (changed || []).find(c => {
        const f = typeof c === 'string' ? c : c.file || c.path || '';
        return f.replace(/\\/g, '/').includes('handlerCore');
      });
      const src = handler && typeof handler === 'object' ? (handler.content || '') : '';
      // 구조분해에 allergies 있어야 함
      if (src && !/dietPrefs,\s*allergies/.test(src) && !/allergies,/.test(src.split('tryRunBlockMode')[0] || src)) {
        issues.push(`${HANDLER}: shaped 구조분해에 allergies 없음 — P240 fix 후 회귀`);
      }
      // tryRunBlockMode 호출 userInput 에 allergies 있어야 함
      const blockModeCall = src && src.match(/tryRunBlockMode\([^)]*userInput\s*:\s*\{[^}]*\}/);
      if (blockModeCall && !/allergies/.test(blockModeCall[0])) {
        issues.push(`${HANDLER}: tryRunBlockMode userInput 에 allergies 없음 — SAFETY-CRITICAL: 외국인 알레르기 block 선택 미반영`);
      }
    } catch { /* file read error — skip */ }
  }

  if (blockChanged) {
    try {
      const blockFile = (changed || []).find(c => {
        const f = typeof c === 'string' ? c : c.file || c.path || '';
        return f.replace(/\\/g, '/').includes('blockMode');
      });
      const src = blockFile && typeof blockFile === 'object' ? (blockFile.content || '') : '';
      // selectBlocksWithGemini 의 userMessage 에 food_allergies 있어야 함
      if (src && /selectBlocksWithGemini/.test(src) && !/food_allergies/.test(src)) {
        issues.push(`${BLOCK}: selectBlocksWithGemini userMessage 에 food_allergies 없음 — P240 fix 후 회귀`);
      }
    } catch { /* skip */ }
  }

  if (issues.length === 0) return null;
  return {
    rule: 'P240_blockModeAllergenSafety',
    file: HANDLER,
    message:
      'R-P240 SAFETY-CRITICAL: block_mode allergies 미전달 회귀 감지. ' +
      '비유: "땅콩 알레르기 손님 메뉴판에서 알레르기 정보 뺀 주문" = 건강 위험. ' +
      'handlerCore.js shaped 구조분해 allergies + tryRunBlockMode userInput.allergies 의무. ' +
      'blockMode.js selectBlocksWithGemini/MultiCity userMessage food_allergies 의무. ' +
      '발견: ' + issues.join(' | '),
  };
}

// ----------------------------------------------------------------------------
// P239_tourStartTimeFallback — 운영자 architectural fix (2026-05-27)
//
// 운영자 의도: "새벽 도착해도 호텔까지 경로만 + 투어 시작시간 부터 stops 작성".
// requestShaper 의 tourStartTime 파싱이 default '09:00' 폴백 의무 — 옛 client 호환.
// 누락 시 backend 가 undefined 전달 → buildPrompt 의 ARRIVAL DAY HANDLING 섹션이
// tour_start_time 무효 처리 → Day1 새벽 stops 회귀 (P159 root cause 재현).
//
// 검사 위치: api/_ai_core/requestShaper.js 의 tourStartTime 변수 (default '09:00').
// 검사 방법: '09:00' 폴백 + HH:MM 정규식 검증 둘 다 존재해야 PASS.
// ----------------------------------------------------------------------------

/**
 * P239_tourStartTimeFallback — requestShaper 의 tourStartTime default '09:00' 폴백 유지.
 */
function P239_tourStartTimeFallback({ changed }) {
  const FILE = 'api/_ai_core/requestShaper.js';
  if (!isModified(FILE, changed)) return { skipped: true };

  const src = readFileExists(FILE);
  if (!src) return { skipped: true };

  const issues = [];
  // tourStartTime 변수 존재 확인.
  if (!/const\s+tourStartTime\s*=/.test(src)) {
    issues.push("const tourStartTime 변수 누락 — backend 가 tour_start_time forward 못 함");
  }
  // default '09:00' 폴백 의무 (옛 client 호환).
  if (!/['"]09:00['"]/.test(src)) {
    issues.push("'09:00' default 폴백 누락 — 옛 client 호환성 손상 (architectural fix 회귀)");
  }
  // HH:MM 정규식 검증 의무 (잘못된 입력 silent fail 방지).
  if (!/\/\^\\d\{2\}:\\d\{2\}\$\//.test(src)) {
    issues.push("HH:MM 정규식 검증 누락 — 잘못된 입력 silent pass 위험");
  }
  // return 객체에 tourStartTime 노출 확인 (handlerCore destructure).
  if (!/return\s*\{[\s\S]*tourStartTime[\s\S]*\}/.test(src)) {
    issues.push("return 객체에 tourStartTime export 누락 — handlerCore 가 destructure 못 함");
  }

  if (issues.length === 0) return null;
  return {
    id: 'P239_tourStartTimeFallback',
    severity: 'error',
    file: FILE,
    message:
      'R-P239: tourStartTime default 09:00 폴백 손상 — 운영자 architectural fix (P159 / P136 / B-13 root cause) 회귀 위험. ' +
      '비유: "투어 시작시간 안 적은 사용자 = 새벽 stops 다시 받음". 발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// P245_blockModeTourStartTime — block_mode 가 P239 tour_start_time 적용 의무 (2026-05-27)
//
// P239 효과 미완료 sleeper bug lesson:
//   - P239 머지 (PR #646) 후에도 prod 에서 P159 새벽 stops alert 지속.
//   - Root cause: blockMode.js (expandBlocksToItinerary + Multi) 가 옛 룰 (arrival + 9h)
//     그대로 사용 → arrival=14:00 + 9h = 23:00 → stops cascade 00:45/02:23/04:10.
//   - P239 fix 가 buildPrompt + RouteAgent 만 update — block_mode 누락 (sleeper bug).
//
// 검사 위치: api/_ai_core/blockMode.js
// 검사 방법:
//   - 옛 룰 (arrival + 9 * 60) 존재 시 FAIL
//   - 신 룰 (arrivalPlus60 vs tourStartTime max) 부재 시 FAIL
//   - tour_start_time pickup default '09:00' 누락 시 FAIL
//
// 동반 의무: planPersister.js 가 input.tour_start_time 저장해야 admin debug + 추적 가능.
// ----------------------------------------------------------------------------

/**
 * P245_blockModeTourStartTime — block_mode 가 P239 tour_start_time 룰 적용.
 */
function P245_blockModeTourStartTime({ changed }) {
  const BLOCK_FILE = 'api/_ai_core/blockMode.js';
  const PERSIST_FILE = 'api/_ai_core/planPersister.js';
  // 둘 중 하나라도 변경되면 검사 — 또는 all-files 모드
  if (changed.length > 0 && !isModified(BLOCK_FILE, changed) && !isModified(PERSIST_FILE, changed)) {
    return { skipped: true };
  }

  const issues = [];

  const blockSrc = readFileExists(BLOCK_FILE);
  if (blockSrc) {
    // 옛 룰 잔존 시 FAIL — arrival + 9h cascade 위험
    if (/addMinutesToHHMM\(\s*arrivalTime\s*,\s*9\s*\*\s*60\s*\)/.test(blockSrc)) {
      issues.push("blockMode.js 옛 룰 (arrival + 9h) 잔존 — P159 새벽 stops cascade 위험");
    }
    // 신 룰 부재 시 FAIL — arrivalPlus60 vs tour_start_time max 비교 필요
    if (!/arrivalPlus60\s*>\s*tourStartTime/.test(blockSrc)) {
      issues.push("blockMode.js 신 룰 (max(tour_start_time, arrival+60)) 누락");
    }
    // tour_start_time pickup default '09:00' 누락 시 FAIL
    if (!/tour_start_time\s*\|\|\s*userInput\?\.tourStartTime\s*\|\|\s*['"]09:00['"]/.test(blockSrc)) {
      issues.push("blockMode.js tour_start_time default '09:00' pickup 누락");
    }
    // 양쪽 (단도시 + 다도시) 모두 적용됐는지 — pickup 2회 이상
    const matches = blockSrc.match(/userInput\?\.tour_start_time\s*\|\|\s*userInput\?\.tourStartTime/g) || [];
    if (matches.length < 2) {
      issues.push(`blockMode.js tour_start_time pickup ${matches.length}회 (단도시 + 다도시 둘 다 필요, 2회 이상)`);
    }
  }

  const persistSrc = readFileExists(PERSIST_FILE);
  if (persistSrc) {
    // planPersister.js 가 Firestore input 에 tour_start_time 저장 의무
    if (!/tour_start_time:\s*body\.tourStartTime/.test(persistSrc)) {
      issues.push("planPersister.js Firestore input.tour_start_time 저장 누락 — admin debug + 추적 불가");
    }
  }

  if (issues.length === 0) return null;
  return {
    id: 'P245_blockModeTourStartTime',
    severity: 'error',
    file: BLOCK_FILE,
    message:
      'R-P245: block_mode 가 P239 tour_start_time 룰 미적용 — Day1 새벽 stops cascade 회귀 위험. ' +
      '비유: "투어 시작시간 메뉴판에 적었는데 주방이 옛 시간표대로 요리". ' +
      '운영자 prod alert (plan 39c7bd3f) arrival=14:00 → 00:45/02:23/04:10 cascade lesson. 발견: ' + issues.join(', '),
  };
}

// ----------------------------------------------------------------------------
// P243_zoneBlockStyleCoverage — P243 zone_courses block seeding 검증 (2026-05-27)
// ----------------------------------------------------------------------------
// P242 SB-1 lesson: _activity_helper.js 의 Kbeauty/DMZ/Jjimjilbang/HangangBike 인덱스가
// block_mode 환경에서 zone_courses blocks 없이는 무시됨.
// zone_courses JSON 에 각 스타일 매칭 블록이 있어야 Gemini 가 선택 가능.
// 비유: "케이뷰티 안내원 고용했지만 케이뷰티 루트 지도를 안 만든 상태"
//
// 검사: src/data/zone_courses/ 에서 각 P243 스타일 카테고리 블록 존재 확인.
//   - kbeauty: best_for 에 "kbeauty_lover" 포함 블록 ≥3
//   - dmz: best_for 에 "dmz_visitor" 포함 블록 ≥2
//   - jjimjilbang: best_for 에 "wellness_seeker" 포함 블록 ≥2
//   - hangang_bike: best_for 에 "hangang_explorer" 포함 블록 ≥2
// zone_courses JSON 파일 추가/삭제 시 재검증.
// ----------------------------------------------------------------------------

/**
 * P243_zoneBlockStyleCoverage
 *
 * P243 (2026-05-27): Kbeauty/DMZ/Jjimjilbang/HangangBike 스타일 블록이
 * zone_courses 에 충분히 시드됐는지 검증.
 * src/data/zone_courses/ JSON 파일 변경 시 또는 전체 검사 시 확인.
 */
function P243_zoneBlockStyleCoverage({ changed }) {
  const ZONE_DIR = 'src/data/zone_courses';
  // JSON 파일 변경이 없고 all-files 모드도 아니면 skip
  const hasZoneChange = changed.some((c) => c.file.includes(ZONE_DIR) && c.file.endsWith('.json'));
  if (!hasZoneChange && changed.length > 0) return { skipped: true };

  const zoneDir = path.join(process.cwd(), ZONE_DIR);
  if (!existsSync(zoneDir)) {
    return {
      rule: 'P243_zoneBlockStyleCoverage',
      severity: 'warning',
      file: ZONE_DIR,
      message: 'R-P243: zone_courses 디렉토리 없음 — src/data/zone_courses/ 필수.',
    };
  }

  let files;
  try {
    files = readdirSync(zoneDir).filter((f) => f.endsWith('.json') && f !== 'templates');
  } catch (e) {
    return { skipped: true };
  }

  const counts = { kbeauty: 0, dmz: 0, jjimjilbang: 0, hangang_bike: 0 };
  const REQUIRED = { kbeauty: ['kbeauty_lover'], dmz: ['dmz_visitor'], jjimjilbang: ['wellness_seeker'], hangang_bike: ['hangang_explorer'] };
  const MINIMUMS = { kbeauty: 3, dmz: 2, jjimjilbang: 2, hangang_bike: 2 };

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(path.join(zoneDir, file), 'utf-8'));
      const bestFor = Array.isArray(data.best_for) ? data.best_for : [];
      for (const [style, keywords] of Object.entries(REQUIRED)) {
        if (keywords.some((k) => bestFor.includes(k))) counts[style]++;
      }
    } catch (_) { /* skip malformed */ }
  }

  const issues = [];
  for (const [style, min] of Object.entries(MINIMUMS)) {
    if (counts[style] < min) {
      issues.push(`${style}: ${counts[style]}/${min} 블록 (부족)`);
    }
  }

  if (issues.length === 0) return null;
  return {
    rule: 'P243_zoneBlockStyleCoverage',
    severity: 'error',
    file: ZONE_DIR,
    message:
      'R-P243: zone_courses 스타일 블록 부족 (P243 2026-05-27). ' +
      '비유: "K뷰티 루트 지도 없이 K뷰티 안내원 채용" — block_mode 에서 style 매칭 불가. ' +
      'src/data/zone_courses/ 에 Kbeauty/DMZ/Jjimjilbang/HangangBike best_for 블록 시드 의무. ' +
      '발견: ' + issues.join(' | '),
  };
}

// ----------------------------------------------------------------------------
// 메인
// ----------------------------------------------------------------------------

const exitCode = SELF_TEST ? runSelfTest() : runAll(BASE_REF_DEFAULT);
process.exit(exitCode);
