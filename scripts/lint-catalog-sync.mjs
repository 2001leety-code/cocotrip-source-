#!/usr/bin/env node
/**
 * lint-catalog-sync.mjs — R-P133 카탈로그 ↔ DB ↔ 위자드 동기 lint
 *
 * 검사 항목:
 *   (a) data.tsx / WizardStep2Details.tsx 의 10개 상수 키 ↔ WIZARD-INPUT-CATALOG.md SSOT 동기
 *   (b) buildPrompt.js 의 reservation_status="..." ↔ WizardForm/index.tsx onSubmit payload 동기
 *   (c) WizardStep0Reservation.tsx 의 reservationStatus 변경 시 arrivalTime/arrivalAirport 클리어 useEffect
 *   (d) toggleCity 내 hotelByCity stale Record cleanup + wantAccom=true 시 setHotelByCity({}) 호출
 *
 * 사용법:
 *   node scripts/lint-catalog-sync.mjs           # report-only (기본, exit 0)
 *   node scripts/lint-catalog-sync.mjs --strict   # 오류 시 exit 1 (CI 차단용)
 *
 * Pre-push hook 통합: scripts/git-hooks/pre-push 의 mistake-lint 호출 시 자동 실행됨.
 * 호출: node scripts/lint-catalog-sync.mjs (--strict 없이 → report-only, push 차단 X)
 *
 * R-P128 은 PR #516 (block-mode) 이 차지했으므로 카탈로그 동기는 R-P133 사용.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 경로 해석 (Windows + POSIX 공용)
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ → 프로젝트 루트
const root = path.resolve(__dirname, '..');

const strict = process.argv.includes('--strict');

const errors = [];
const warns = [];
let total = 0;
let passCount = 0;

function recordPass(label) {
  total++;
  passCount++;
  console.log(`[OK]  R-P133(${label})`);
}
function recordWarn(label, msg) {
  total++;
  warns.push({ label, msg });
  console.warn(`[WARN] R-P133(${label}): ${msg}`);
}
function recordError(label, msg, hint) {
  total++;
  errors.push({ label, msg, hint });
  console.error(`[LINT] R-P133(${label}): ${msg}`);
  if (hint) console.error(`       hint: ${hint}`);
}

// ---------------------------------------------------------------------------
// 파일 읽기 헬퍼
// ---------------------------------------------------------------------------
function readFile(rel) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  if (!existsSync(abs)) return null;
  try { return readFileSync(abs, 'utf8'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// (a) 카탈로그 sync — data.tsx / WizardStep2Details.tsx ↔ WIZARD-INPUT-CATALOG.md
// ---------------------------------------------------------------------------
function checkCatalogSync() {
  const LABEL = 'a:catalog-sync';
  const dataSrc = readFile('src/components/WizardForm/data.tsx');
  const step2Src = readFile('src/components/WizardForm/WizardStep2Details.tsx');
  const catalogSrc = readFile('docs/WIZARD-INPUT-CATALOG.md');

  if (!dataSrc && !step2Src) {
    recordWarn(LABEL, 'WizardForm/data.tsx 와 WizardStep2Details.tsx 모두 없음 — 검사 skip');
    return;
  }
  if (!catalogSrc) {
    recordError(
      LABEL,
      'docs/WIZARD-INPUT-CATALOG.md 없음 — SSOT 파일이 존재해야 합니다',
      'docs/WIZARD-INPUT-CATALOG.md 를 생성하거나 복원하세요 (R-P133 SSOT)',
    );
    return;
  }

  // 각 상수에서 키 배열 추출 + 카탈로그에 그 키가 언급되는지 확인
  // 형식: export const FOO = ['key1', 'key2', ...] as const
  //       export const FOO: { key: string }[] = [ { key: 'key1' }, ... ]
  function extractKeysFromConst(src, constName) {
    if (!src) return null;

    // 공통: 상수 선언 블록 추출 (중첩 대괄호를 고려한 균형 추출)
    // export const 또는 const 모두 허용 (WizardStep2Details 의 TOUR_PACE_KEYS 는 export 없음)
    const declStart = new RegExp(
      `(?:export\\s+)?const\\s+${constName}[^=]*=\\s*`,
    );
    const startMatch = declStart.exec(src);
    if (!startMatch) return null;

    let pos = startMatch.index + startMatch[0].length;
    // 블록 시작 문자 확인
    const firstChar = src[pos];

    // 패턴 A: 배열 [ ... ] 형태 — 균형 추출
    if (firstChar === '[') {
      let depth = 0;
      let start = pos;
      let end = pos;
      for (let i = pos; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
      const block = src.slice(start + 1, end - 1); // 바깥 [ ] 제거

      // { key: 'val' } 형태 (CITY_CHIPS, ACTIVITY_CHIPS_EXPANDED 등)
      const keyValueMatches = [...block.matchAll(/\bkey\s*:\s*['"`]([^'"`]+)['"`]/g)];
      if (keyValueMatches.length > 0) {
        return keyValueMatches.map((m) => m[1]);
      }
      // 단순 배열 ['val1', 'val2'] 형태 (FOOD_STYLE_KEYS, ALLERGY_KEYS 등)
      // JSX <Tag /> 클래스명 등이 섞이지 않도록 — icon/className 값 제외
      // 값이 단독 배열 요소인 경우만 (콤마 또는 ] 로 끝나는 라인)
      const simpleMatches = [...block.matchAll(/['"`]([^'"`]+)['"`](?:\s*(?:,|\]|as\s+const))/g)];
      if (simpleMatches.length > 0) {
        return simpleMatches.map((m) => m[1]);
      }
      // fallback: 모든 문자열 (오탐 위험 있지만 없는 것보다 낫다)
      return [...block.matchAll(/['"`]([^'"`\s<>]+)['"`]/g)].map((m) => m[1]);
    }

    // 패턴 B: 객체 Record<string, ...> { ... } 형태 (AIRPORT_OPTIONS, AIRPORT_DISPLAY 등)
    if (firstChar === '{') {
      let depth = 0;
      let start = pos;
      let end = pos;
      for (let i = pos; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
      const block = src.slice(start + 1, end - 1);
      // 최상위 키만: 줄 시작 또는 , 다음에 오는 식별자/따옴표 키
      const topKeys = [...block.matchAll(/(?:^|,)\s*\n?\s*(?:['"`]([^'"`]+)['"`]|([a-zA-Z_$][a-zA-Z0-9_$]*))\s*:/gm)]
        .map((m) => m[1] || m[2])
        .filter(Boolean);
      if (topKeys.length > 0) return topKeys;
      return null;
    }

    return null;
  }

  // 카탈로그에서 섹션 키워드 확인 (단순 포함 검사)
  function catalogContainsKey(key) {
    // 카탈로그 내 backtick / 따옴표 / 대소문자 무관 포함 여부
    return catalogSrc.includes(key);
  }

  // 검사할 상수 목록: [파일소스, 상수명, 설명, 카탈로그 섹션 힌트]
  const CHECKS = [
    [dataSrc,  'CITY_CHIPS',             'CITY_CHIPS (도시칩)',           '## 도시 (City)'],
    [dataSrc,  'AIRPORT_OPTIONS',        'AIRPORT_OPTIONS (공항 옵션)',   '## 공항 (Airport)'],
    [dataSrc,  'AIRPORT_DISPLAY',        'AIRPORT_DISPLAY (공항 표시명)', '## 공항 (Airport)'],
    [dataSrc,  'FOOD_STYLE_KEYS',        'FOOD_STYLE_KEYS (음식 스타일)', '## 음식 스타일'],
    [dataSrc,  'ALLERGY_KEYS',           'ALLERGY_KEYS (식이제한)',       '## 식이제한 / 알레르기'],
    [dataSrc,  'SPICE_LEVEL_KEYS',       'SPICE_LEVEL_KEYS (매운맛)',     '## 매운맛'],
    [dataSrc,  'KOREAN_BUCKET_LIST',     'KOREAN_BUCKET_LIST (버킷리스트)', '## 한식 버킷리스트'],
    [dataSrc,  'PRICE_KEYS',             'PRICE_KEYS (가격대)',           '## 가격대'],
    [dataSrc,  'ACTIVITY_CHIPS_EXPANDED','ACTIVITY_CHIPS_EXPANDED (확장 활동)', '## 활동 (Activity)'],
    [step2Src, 'TOUR_PACE_KEYS',         'TOUR_PACE_KEYS (여행 페이스)', '## 여행 페이스'],
  ];

  // CITY_CHIPS 는 key 필드 형태이므로 별도 추출
  let anyFail = false;
  for (const [src, constName, desc, catalogHint] of CHECKS) {
    if (!src) {
      recordWarn(LABEL, `${constName} 소스 파일 없음 — 검사 skip`);
      continue;
    }
    const keys = extractKeysFromConst(src, constName);
    if (!keys || keys.length === 0) {
      recordWarn(LABEL, `${constName}: 키 추출 실패 (정규식 미매칭) — 수동 확인 필요`);
      continue;
    }
    const missing = keys.filter((k) => !catalogContainsKey(k));
    if (missing.length > 0) {
      anyFail = true;
      recordError(
        LABEL,
        `${desc}: 카탈로그 누락 키 ${missing.length}건 — ${missing.join(', ')}`,
        `docs/WIZARD-INPUT-CATALOG.md 의 "${catalogHint}" 섹션에 위 키들을 추가하세요.\n` +
        `       운영자 의도: 위자드 input 키 = DB 카테고리 키 1:1 매칭, 자유 라벨 금지.`,
      );
    } else {
      recordPass(`${LABEL}:${constName}`);
    }
  }
  if (!anyFail && errors.filter((e) => e.label === LABEL).length === 0) {
    // all passed — already recorded per-const
  }
}

// ---------------------------------------------------------------------------
// (b) reservation_status payload 누락 검사
// ---------------------------------------------------------------------------
function checkReservationStatusPayload() {
  const LABEL = 'b:reservation_status-payload';
  const buildPromptSrc = readFile('api/_ai_core/buildPrompt.js');
  const indexSrc = readFile('src/components/WizardForm/index.tsx');

  if (!buildPromptSrc) {
    recordWarn(LABEL, 'api/_ai_core/buildPrompt.js 없음 — 검사 skip');
    return;
  }

  // buildPrompt.js 가 reservation_status 를 사용하는지 확인
  const buildPromptUsesIt = /reservation_status\s*=\s*["']/.test(buildPromptSrc);
  if (!buildPromptUsesIt) {
    // buildPrompt 가 reservation_status 를 전혀 사용 안 하면 검사 필요 없음
    recordPass(`${LABEL}:buildPrompt-check`);
    return;
  }

  if (!indexSrc) {
    recordWarn(LABEL, 'src/components/WizardForm/index.tsx 없음 — 검사 skip');
    return;
  }

  // WizardForm/index.tsx 의 onSubmit payload 에 reservation_status 키 존재 확인
  // 패턴: reservation_status: ... 또는 reservation_status, (shorthand)
  const hasPayload =
    /reservation_status\s*:/.test(indexSrc) ||
    /\breservation_status\b,/.test(indexSrc);

  if (!hasPayload) {
    recordError(
      LABEL,
      'buildPrompt.js 는 reservation_status payload 를 expect 하지만 WizardForm/index.tsx 의 onSubmit 에 미전달 (CATALOG 분기 #1 회귀)',
      'index.tsx 의 payload 객체에 reservation_status: reservationStatus 추가 (또는 reservationStatus shorthand) — ' +
      'buildPrompt.js 의 reservation_status="nothing"/"flight"/"flight_hotel" 분기가 항상 undefined 를 받아 silent fail.',
    );
  } else {
    recordPass(LABEL);
  }
}

// ---------------------------------------------------------------------------
// (c) Reservation cleanup useEffect 검사
// ---------------------------------------------------------------------------
function checkReservationCleanupEffect() {
  const LABEL = 'c:reservation-cleanup-effect';
  const step0Src = readFile('src/components/WizardForm/WizardStep0Reservation.tsx');
  const indexSrc = readFile('src/components/WizardForm/index.tsx');

  // WizardStep0Reservation 은 stateless props 컴포넌트라 cleanup effect 는 index.tsx 에 있을 수도 있음
  // 양쪽 검사
  const srcToCheck = (indexSrc || '') + '\n' + (step0Src || '');

  if (!srcToCheck.trim()) {
    recordWarn(LABEL, '관련 파일 없음 — 검사 skip');
    return;
  }

  // reservationStatus 변경 시 arrivalTime / arrivalAirport 클리어 로직
  // nothing / all_done 으로 전환 시 arrivalTime('') + arrivalAirport('') 호출 필요
  const hasArrivalTimeClear = /setArrivalTime\s*\(\s*['"]?\s*['"]?\s*\)/.test(srcToCheck);
  const hasArrivalAirportClear =
    /setArrivalAirport\s*\(\s*['"]?\s*['"]?\s*\)/.test(srcToCheck) ||
    /setArrivalTerminal\s*\(\s*['"]?\s*['"]?\s*\)/.test(srcToCheck);

  if (!hasArrivalTimeClear || !hasArrivalAirportClear) {
    const missing = [];
    if (!hasArrivalTimeClear) missing.push('setArrivalTime(\'\')');
    if (!hasArrivalAirportClear) missing.push('setArrivalAirport(\'\') 또는 setArrivalTerminal(\'\')');
    recordWarn(
      LABEL,
      `reservationStatus 변경 시 클리어 로직 감지 안 됨: ${missing.join(', ')} — ` +
      'flight → nothing/all_done 전환 시 arrivalTime/arrivalAirport stale 값 잔류 (CATALOG 분기 #2 회귀)',
    );
  } else {
    recordPass(LABEL);
  }
}

// ---------------------------------------------------------------------------
// (d) hotelByCity stale Record cleanup 검사
// ---------------------------------------------------------------------------
function checkHotelByCityCleanup() {
  const LABEL = 'd:hotelByCity-stale-cleanup';
  const indexSrc = readFile('src/components/WizardForm/index.tsx');

  if (!indexSrc) {
    recordWarn(LABEL, 'src/components/WizardForm/index.tsx 없음 — 검사 skip');
    return;
  }

  // 분기 #10: toggleCity 함수 내 setHotelByCity 호출 존재 확인
  // 2026-05-21 (pattern 정밀화): toggleCity 함수 본문 전체 추출 — function 선언부터
  // 다음 top-level `function` 또는 closing brace 까지. 기존 600자 window 는 분기 #10
  // fix (mainCity 재클릭 + extraCities deselect 양쪽 cleanup) 의 함수 길이를 못 커버.
  const toggleMatch = indexSrc.match(/function\s+toggleCity[\s\S]*?\n {2}}/);
  const toggleBlock = toggleMatch ? toggleMatch[0] : '';
  const hasToggleCityCleanup = /setHotelByCity\s*\(/.test(toggleBlock);

  if (!hasToggleCityCleanup) {
    recordWarn(
      LABEL,
      'toggleCity 함수 내 setHotelByCity 호출 없음 — 도시 deselect 시 그 도시 호텔 주소 stale 잔류 (CATALOG 분기 #10 HIGH)',
    );
  } else {
    recordPass(`${LABEL}:toggleCity`);
  }

  // 분기 #23: wantAccom=true 전환 시 setHotelByCity({}) 초기화 확인
  // 2026-05-21 (pattern 정밀화): wantAccom 변경 분기는 WizardStep2Details.tsx 의 onChange
  // 안에 있음 (index.tsx 가 아님). 두 파일 모두 검사.
  const step2Src = readFile('src/components/WizardForm/WizardStep2Details.tsx') || '';
  const combinedWantAccomSrc = indexSrc + '\n' + step2Src;
  const hasWantAccomReset =
    /setWantAccom\s*\([\s\S]{0,500}setHotelByCity\s*\(\s*\{\s*\}\s*\)/.test(combinedWantAccomSrc) ||
    /setHotelByCity\s*\(\s*\{\s*\}\s*\)[\s\S]{0,500}setWantAccom/.test(combinedWantAccomSrc);

  if (!hasWantAccomReset) {
    recordWarn(
      LABEL,
      'wantAccom=true 전환 시 setHotelByCity({}) 초기화 없음 — 이전 hotelByCity Record 가 stale 잔류 (CATALOG 분기 #23)',
    );
  } else {
    recordPass(`${LABEL}:wantAccom-reset`);
  }
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
console.log('R-P133 카탈로그 ↔ DB ↔ 위자드 동기 lint 실행 중...\n');
console.log(`프로젝트 루트: ${root}\n`);

checkCatalogSync();
checkReservationStatusPayload();
checkReservationCleanupEffect();
checkHotelByCityCleanup();

console.log(
  `\n총 검사: ${total} | 통과: ${passCount} | 경고: ${warns.length} | 오류: ${errors.length}`,
);

if (errors.length > 0) {
  console.error(`\n[R-P133] ${errors.length}건 오류 발견.`);
  for (const e of errors) {
    console.error(`  - R-P133(${e.label}): ${e.msg}`);
  }
  if (strict) {
    console.error('\n--strict 모드: exit 1');
    process.exit(1);
  } else {
    console.log('\nreport-only 모드 (기본): exit 0. --strict 로 재실행하면 CI 차단 가능.');
  }
}

if (warns.length > 0 && errors.length === 0) {
  console.log('\n[R-P133] 오류 없음. 위 경고 항목은 수동 확인 권장.');
}

process.exit(0);
