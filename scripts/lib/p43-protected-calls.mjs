/**
 * P43 (lint-mistake-patterns) 파일 단위 검사 — 순수 함수라 단위 테스트가 git 샌드박스 없이 부른다.
 * 규칙 설명은 scripts/lint-mistake-patterns.mjs 의 P43_authIdorBodyTrusted 주석.
 */
import ts from 'typescript';

export const P43_PROTECTED = /\/api\/(my-bookings|voucher|cancelBooking|modifyBooking|reviews)\b/;
export const P43_MANAGE_FETCH_PATHS = new Set(['/api/booking-manage', '/api/cancelBooking', '/api/modifyBooking']);

/** 파일 확장자 → 파서 종류. 모르는 확장자는 TSX(가장 너그러운 쪽 — JSX·타입 둘 다). */
function scriptKindFor(file) {
  const f = String(file || '').toLowerCase();
  if (f.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (f.endsWith('.ts') || f.endsWith('.mts') || f.endsWith('.cts')) return ts.ScriptKind.TS;
  if (f.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TSX;
}

/** 파싱 실패 — p43FileViolations 가 위반으로 보고한다(조용히 통과 금지). */
export class P43ParseError extends Error {}

/**
 * 주석 범위 — 설치된 TypeScript 파서로 문법을 분석해 **실제 주석만** 찾는다(2026-10-23).
 * 이전 문자 스캐너는 `/` 가 나눗셈인지 정규식인지를 직전 토큰으로 추정했다(REGEX_PRECEDERS/REGEX_KEYWORDS) —
 * 리뷰 5회차까지 반례가 계속 나왔다. 이제 파서가 정규식·문자열·템플릿(`${}` 중첩)·JSX 텍스트를 토큰으로 가르고,
 * 주석은 토큰 사이 trivia 에만 있으므로 각 토큰 앞 trivia 의 주석 범위를 모은다(JSX 주석 `{/* … *\/}` 포함).
 * JSX 텍스트(`<p>see // here</p>`)는 trivia 가 아니라 토큰 내용이라 건드리지 않는다.
 * @throws {P43ParseError} 문법 오류가 있으면
 */
function commentRanges(content, file) {
  const sf = ts.createSourceFile(
    String(file || 'probe.tsx'),
    content,
    { languageVersion: ts.ScriptTarget.ES2022, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
    scriptKindFor(file),
  );
  if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
    const d = sf.parseDiagnostics[0];
    throw new P43ParseError(`${ts.flattenDiagnosticMessageText(d.messageText, ' ')} @${d.start}`);
  }
  const ranges = [];
  const seen = new Set();
  const visit = (node) => {
    const kids = node.getChildren(sf);
    if (kids.length > 0) { for (const k of kids) visit(k); return; }
    if (node.kind === ts.SyntaxKind.JsxText || seen.has(node.pos)) return; // JSX 텍스트는 trivia 가 없다
    seen.add(node.pos);
    // trivia 앞부분의 같은 줄 주석은 TS 가 "trailing"(앞 토큰 소속), 줄바꿈 뒤는 "leading" 으로 나눈다 — 둘 다 모은다.
    for (const r of ts.getTrailingCommentRanges(content, node.pos) || []) ranges.push(r);
    for (const r of ts.getLeadingCommentRanges(content, node.pos) || []) ranges.push(r);
  };
  visit(sf);
  return ranges.sort((a, b) => a.pos - b.pos);
}

/**
 * 주석 제거 — 줄 수·열 위치 유지. 주석의 각 문자를 공백으로 바꾸고 줄바꿈(\r·\n)만 남긴다.
 * (공백이라 `await/* x *\/manageFetch(` 가 `awaitmanageFetch(` 로 붙어 검사를 빠져나가지 않는다.)
 * 문자열·템플릿·정규식 리터럴·JSX 텍스트 안의 `//`·`/*`·`://` 는 그대로다.
 * 주석 속 "Authorization: Bearer" 로 룰 1 을 통과하지 못하게 하는 것이 목적.
 * 해시뱅(`#!…` 첫 줄)도 주석처럼 비운다 — TS 의 주석 범위 API 는 해시뱅을 범위에 넣지 않아,
 *   `#!/usr/bin/env node // Authorization: Bearer` 가 가짜 근거로 남았다(Astra P43 리뷰 r1).
 * @param {string} content
 * @param {string} [file] 확장자로 TS/TSX/JS/JSX 파서를 고른다(기본 TSX)
 * @returns {string[]} 줄 배열
 * @throws {P43ParseError} 파싱 실패
 */
export function p43StripComments(content, file) {
  const src = String(content || '');
  const shebang = ts.getShebang(src) || '';
  let out = shebang.replace(/[^\r\n]/g, ' ');
  let last = shebang.length;
  for (const r of commentRanges(src, file)) {
    if (r.pos < last) continue;
    out += src.slice(last, r.pos) + src.slice(r.pos, r.end).replace(/[^\r\n]/g, ' ');
    last = r.end;
  }
  out += src.slice(last);
  return out.split(/\r?\n/);
}

/**
 * Rule 3: 모든 `manageFetch(` 호출의 첫 인자 **전체**가 허용 경로 문자열 리터럴 하나여야 한다.
 * 괄호 뒤 공백·줄바꿈은 건너뛴다(여러 줄 호출 허용). 연결식·변수·템플릿 리터럴·허용 밖 경로는 위반.
 * 리터럴에 백슬래시가 하나라도 있으면 위반 — 이스케이프를 풀어 비교하지 않는다(`'\b'` 는 백스페이스).
 * @returns {{ index: number }[]}
 */
function manageFetchViolations(text) {
  const out = [];
  for (const m of text.matchAll(/(?<!function\s+)\bmanageFetch\s*\(/g)) {
    let j = m.index + m[0].length;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    const q = text[j];
    let ok = false;
    if (q === "'" || q === '"') {
      let k = j + 1;
      let value = '';
      let escaped = false;
      while (k < text.length && text[k] !== q && text[k] !== '\n') {
        if (text[k] === '\\') { escaped = true; break; }
        value += text[k];
        k += 1;
      }
      if (!escaped && text[k] === q) {
        k += 1;
        while (k < text.length && /\s/.test(text[k])) k += 1;
        ok = (text[k] === ',' || text[k] === ')') && P43_MANAGE_FETCH_PATHS.has(value);
      }
    }
    if (!ok) out.push({ index: m.index });
  }
  return out;
}

/** @returns {string[]} 위반 메시지(없으면 빈 배열). */
export function p43FileViolations(file, content) {
  const out = [];
  if (!content) return out;

  // 파싱이 먼저다 — 파싱 실패를 통과로 처리하지 않는다(보호 경로가 안 보여도: 주석 범위를 모르면 검사도 믿을 수 없다).
  let lines;
  try {
    lines = p43StripComments(content, file);
  } catch (e) {
    return [`P43: cannot parse ${file} — fix syntax or exclude (${(e && e.message) || 'parse error'})`];
  }
  if (!P43_PROTECTED.test(content) && !/\bmanageFetch\s*\(/.test(content)) return out;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Rule 1: raw fetch( against protected endpoint
    if (/\bfetch\s*\(\s*['"`]\/api\/(my-bookings|voucher|cancelBooking|modifyBooking|reviews)/.test(line)) {
      // window check for 'Authorization' header — admin pages already attach it manually;
      // only flag if Authorization NOT in window (comments stripped).
      const win = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 15)).join('\n');
      if (!/Authorization\s*:\s*['"`]?Bearer/i.test(win)) {
        out.push(`${file}:L${i + 1}: raw fetch() against protected endpoint — use authFetch from @/lib/authFetch`);
      }
    }
    // Rule 2: body/query carrying userEmail or userId to protected endpoint
    // Heuristic — line contains `userEmail:` or `userId:` AND the file
    // touches a protected endpoint. False-positive risk acceptable; remove
    // the property if not actually targeting these endpoints.
    const isCalloutLine =
      /\buserEmail\s*:\s*(user\?{0,1}\.email|email|userEmail)\b/.test(line) ||
      /\buserId\s*:\s*(user\?{0,1}\.uid|uid|userId)\b/.test(line);
    if (isCalloutLine) {
      const window = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 4)).join('\n');
      if (P43_PROTECTED.test(window)) {
        out.push(`${file}:L${i + 1}: body/query carries userEmail/userId to protected endpoint — server uses verified auth.email / auth.uid`);
      }
    }
  }

  // Rule 3: manageFetch — first argument must be exactly one allowed string literal (multi-line calls OK)
  const text = lines.join('\n');
  for (const v of manageFetchViolations(text)) {
    const lineNo = text.slice(0, v.index).split('\n').length;
    out.push(`${file}:L${lineNo}: manageFetch() first argument must be exactly '/api/booking-manage', '/api/cancelBooking' or '/api/modifyBooking'`);
  }
  return out;
}
