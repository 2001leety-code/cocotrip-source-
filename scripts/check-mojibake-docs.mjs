#!/usr/bin/env node
/**
 * 문서 인코딩 검사 — UTF-8 인가, 깨진 글자(mojibake)가 있는가. (2026-07-29)
 *
 * 왜: 한글 문서를 Windows 도구로 다루다 보면 cp949 로 잘못 읽혀 저장되는 일이 있다.
 *   그러면 한글이 라틴 문자 쓰레기로 바뀌는데, 화면에서만 이상해 보일 뿐
 *   내용은 조용히 사라진다. 감사 문서에서 이게 나면 기록으로서 값이 없다.
 *
 * 검사 항목
 *   1. UTF-8 BOM 금지 — 다른 도구가 첫 글자를 깨뜨린다
 *   2. U+FFFD (디코딩 실패 흔적) 가 없는가
 *   3. latin1/cp949 오독 패턴 — UTF-8 선두 바이트(U+00C0~U+00FF)가
 *      연속 바이트 범위(U+0080~U+00BF) 문자를 끌고 오는 조합이 없는가
 *   4. 짝 없는 서러게이트가 없는가
 *
 * ⚠️ 예시로 깨진 글자를 이 파일에 **직접 쓰지 않는다.**
 *    레포 pre-commit 가드가 이 소스 자체를 깨진 문서로 오인한다(실제로 한 번 막혔다).
 *    패턴은 전부 \\uXXXX 이스케이프로 적는다.
 *
 * 사용:
 *   node scripts/check-mojibake-docs.mjs                 # 기본 대상(docs/loyalty-remediation)
 *   node scripts/check-mojibake-docs.mjs <파일 또는 폴더> …
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_TARGETS = ['docs/loyalty-remediation'];
const TEXT_FILE = /\.(md|json|txt)$/i;

/** cp949 로 읽힌 UTF-8 이 다시 UTF-8 로 저장될 때 나오는 앞바이트 + 연속바이트 조합. */
const CP949_MISDECODE = /[\u00c0-\u00ff][\u0080-\u00bf]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** @returns {string[]} 어긋난 이유. 빈 배열이면 깨끗하다. */
export function inspectBuffer(buf) {
  const problems = [];
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    problems.push('utf8_bom_present');
  }
  // Buffer#toString 은 실패해도 던지지 않고 U+FFFD 를 넣는다 → 그게 곧 디코딩 실패 신호다.
  const text = buf.toString('utf8');
  if (text.includes('\uFFFD')) problems.push('replacement_char_u_fffd');
  if (CP949_MISDECODE.test(text)) problems.push('cp949_misdecode_pattern');
  if (LONE_SURROGATE.test(text)) problems.push('lone_surrogate');
  return problems;
}

/** 폴더면 재귀로 텍스트 파일만 모은다. */
export function collectFiles(target) {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return TEXT_FILE.test(target) ? [target] : [];
  return readdirSync(target).flatMap((n) => collectFiles(join(target, n)));
}

/** @returns {{files: number, bad: Array<{file: string, problems: string[]}>}} */
export function scan(targets) {
  const files = targets.flatMap(collectFiles);
  const bad = [];
  for (const file of files) {
    const problems = inspectBuffer(readFileSync(file));
    if (problems.length) bad.push({ file, problems });
  }
  return { files: files.length, bad };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('check-mojibake-docs.mjs');
if (isDirectRun) {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS;
  const { files, bad } = scan(targets);
  for (const b of bad) console.error(`MOJIBAKE ${b.file} — ${b.problems.join(', ')}`);
  console.log(`인코딩 검사: ${files}개 파일 · 깨진 글자 ${bad.length}건`);
  process.exit(bad.length > 0 ? 1 : 0);
}
