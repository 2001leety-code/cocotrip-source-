/**
 * P43 (lint-mistake-patterns) 파일 단위 검사 — 순수 함수라 단위 테스트가 git 샌드박스 없이 부른다.
 * 규칙 설명은 scripts/lint-mistake-patterns.mjs 의 P43_authIdorBodyTrusted 주석.
 */
export const P43_PROTECTED = /\/api\/(my-bookings|voucher|cancelBooking|modifyBooking|reviews)\b/;
export const P43_MANAGE_FETCH_PATHS = new Set(['/api/booking-manage', '/api/cancelBooking']);

// 이 문자 뒤(또는 줄 시작)의 `/` 는 나눗셈이 아니라 정규식 리터럴의 시작으로 본다(단순 휴리스틱).
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';']);
// 직전 토큰이 이 키워드이거나 `=>` 여도 정규식 시작이다(`return /[/*]/`·`=> /x/`). 식별자·숫자·`)`·`]` 뒤는 나눗셈.
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/** 지금까지 내보낸 코드의 끝이 `=>` 또는 정규식을 앞세우는 키워드인가. `obj.return` 같은 속성 이름은 제외. */
function regexAfterToken(out) {
  const tail = out.slice(-64);
  if (/=>\s*$/.test(tail)) return true;
  const m = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*$/.exec(tail);
  return Boolean(m && REGEX_KEYWORDS.has(m[1]));
}

/**
 * 주석 제거(줄 수 유지) — 문자 스캐너. 작은/큰따옴표·백틱 문자열(이스케이프 포함)과 정규식 리터럴 안의
 * `//`·`/*` 는 주석이 아니다. 문자열 밖의 `//…` 는 지우고, `/* … *\/`(여러 줄 포함)는 **공백 1개**로 바꾼다
 * (줄바꿈 유지 — `await/* x *\/manageFetch(` 가 `awaitmanageFetch(` 로 붙어 검사를 빠져나가지 않게).
 * 백틱의 `${ … }` 실행식 안은 코드로 다시 스캔한다(중첩 `{}`·문자열·백틱 재귀).
 * 주석 속 "Authorization: Bearer" 로 룰 1 을 통과하지 못하게 하는 것이 목적.
 * `://`(JSX 텍스트의 URL)는 예전처럼 주석으로 보지 않는다.
 */
export function p43StripComments(content) {
  const src = String(content || '');
  let out = '';
  let i = 0;

  /** 따옴표 문자열 하나를 그대로 복사. 닫히지 않으면 줄 끝에서 끝낸다. */
  function quoted(q) {
    out += q;
    i += 1;
    while (i < src.length) {
      const c = src[i];
      out += c;
      i += 1;
      if (c === '\\' && i < src.length) { out += src[i]; i += 1; continue; }
      if (c === q || c === '\n') return;
    }
  }

  /** 백틱 템플릿 하나를 복사하되 `${ … }` 안은 code(true) 로 스캔한다. */
  function template() {
    out += '`';
    i += 1;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { out += c; i += 1; if (i < src.length) { out += src[i]; i += 1; } continue; }
      if (c === '`') { out += c; i += 1; return; }
      if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        code(true);
        if (i < src.length) { out += '}'; i += 1; }
        continue;
      }
      out += c;
      i += 1;
    }
  }

  /** 코드 모드. inInterpolation 이면 짝 없는 `}`(보간 끝) 앞에서 멈춘다(소비하지 않음). */
  function code(inInterpolation) {
    let prev = ''; // 문자열·주석 밖에서 마지막으로 본 공백 아닌 문자. '' = 줄 시작.
    let depth = 0;
    while (i < src.length) {
      const ch = src[i];
      const next = src[i + 1];
      if (ch === '/' && next === '/' && prev !== ':') {
        while (i < src.length && src[i] !== '\n') i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        out += ' ';
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
          if (src[i] === '\n') out += '\n';
          i += 1;
        }
        i += 2;
        continue;
      }
      if (ch === '/' && next !== '>' && (prev === '' || REGEX_PRECEDERS.has(prev) || regexAfterToken(out))) {
        out += ch;
        i += 1;
        let inClass = false;
        while (i < src.length && src[i] !== '\n') {
          const c = src[i];
          out += c;
          i += 1;
          if (c === '\\') { if (i < src.length && src[i] !== '\n') { out += src[i]; i += 1; } continue; }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
        }
        prev = '/';
        continue;
      }
      if (ch === "'" || ch === '"') {
        quoted(ch);
        prev = out.endsWith('\n') ? '' : ch;
        continue;
      }
      if (ch === '`') {
        template();
        prev = '`';
        continue;
      }
      if (inInterpolation && ch === '{') depth += 1;
      if (inInterpolation && ch === '}') {
        if (depth === 0) return;
        depth -= 1;
      }
      out += ch;
      if (ch === '\n') prev = '';
      else if (!/\s/.test(ch)) prev = ch;
      i += 1;
    }
  }

  code(false);
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
  if (!P43_PROTECTED.test(content) && !/\bmanageFetch\s*\(/.test(content)) return out;

  const lines = p43StripComments(content);
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
    out.push(`${file}:L${lineNo}: manageFetch() first argument must be exactly '/api/booking-manage' or '/api/cancelBooking'`);
  }
  return out;
}
