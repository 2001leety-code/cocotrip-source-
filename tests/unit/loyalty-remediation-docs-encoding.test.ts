/**
 * 감사 문서 인코딩·개인정보 잠금 (2026-07-29, FAIL-17 문서 항목).
 *
 * 한글 문서가 cp949 로 잘못 읽혀 저장되면 내용이 조용히 사라진다.
 * 감사 기록에서 그러면 기록으로서 값이 없으므로 깨진 글자 0건을 테스트로 고정한다.
 * 같은 김에 개인정보(이메일·전화·주문 ID)가 새지 않는 것도 함께 잠근다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectBuffer, collectFiles, scan } from '../../scripts/check-mojibake-docs.mjs';

const DOCS = 'docs/loyalty-remediation';

/**
 * 정상적인 액센트 라틴 문자 — 검사기가 이걸 오탐하면 안 된다.
 * 글자를 소스에 그대로 넣지 않는다 — 레포 pre-commit 가드가
 * 소스 자체를 깨진 문서로 오인하기 때문이다.
 */
const LATIN_OK = 'caf' + '\u00e9 \u00b7 na\u00efve \u2014 Z\u00fcrich \u00bfqu\u00e9? \u00c5ngstr\u00f6m';

/** UTF-8 문서를 latin1 로 오독해 다시 저장한 꼴. */
const misdecode = (s: string) => Buffer.from(Buffer.from(s, 'utf8').toString('latin1'), 'utf8');

describe('감사 문서 인코딩', () => {
  it('🔴 docs/loyalty-remediation 에 깨진 글자가 0건이다', () => {
    const { files, bad } = scan([DOCS]);
    expect(files).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  it('검사기가 실제로 깨진 글자를 잡는다 (허수 통과 방지)', () => {
    expect(inspectBuffer(Buffer.from('보정 실행 승인', 'utf8'))).toEqual([]);
    // 정상 라틴 문자·기호는 오탐하지 않는다.
    expect(inspectBuffer(Buffer.from(LATIN_OK, 'utf8'))).toEqual([]);

    expect(inspectBuffer(misdecode('보정 실행 승인'))).toEqual(['cp949_misdecode_pattern']);
    expect(inspectBuffer(misdecode('決済'))).toEqual(['cp949_misdecode_pattern']);
    expect(inspectBuffer(Buffer.from('보정 \uFFFD 승인', 'utf8'))).toEqual(['replacement_char_u_fffd']);
    expect(inspectBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x', 'utf8')])))
      .toEqual(['utf8_bom_present']);
  });

  it('🔴 감사 문서에 개인정보 형태의 문자열이 없다', () => {
    const files = collectFiles(DOCS);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(text, `${f}: 이메일`).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(text, `${f}: 전화번호`).not.toMatch(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/);
      expect(text, `${f}: PayPal 주문 ID`).not.toMatch(/\b[0-9A-Z]{17}\b/);
    }
  });
});
