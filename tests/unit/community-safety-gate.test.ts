/**
 * 커뮤니티 안전 게이트 회귀 (2026-07-13, P9 실전화)
 * - 연락처 유도 감지(CONTACT_RE)가 메신저·전화번호를 잡고, 정상 여행 글(가격·시간 숫자)은
 *   오탐하지 않는지 고정. 이 정규식이 무너지면 광고봇 글이 즉시 공개되므로 SAFETY 성격.
 * - api/community-posts.js 와 community-post-actions.js 는 동일 정규식을 가져야 함(복제 검증).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const r = (p: string) => resolve(__dirname, '../../', p);

function extractContactRe(file: string): RegExp {
  const src = readFileSync(r(file), 'utf8');
  const m = src.match(/const CONTACT_RE = (\/.+\/i);/);
  if (!m) throw new Error(`CONTACT_RE not found in ${file}`);
  // eslint-disable-next-line no-eval
  return eval(m[1]) as RegExp;
}

describe('community CONTACT_RE — 연락처 유도 감지', () => {
  const re = extractContactRe('api/community-posts.js');

  it('두 endpoint 의 정규식이 동일하다 (복제 드리프트 방지)', () => {
    const re2 = extractContactRe('api/community-post-actions.js');
    expect(re.source).toBe(re2.source);
  });

  it('메신저 유도를 잡는다', () => {
    expect(re.test('Best tour! Contact me on Telegram for discount')).toBe(true);
    expect(re.test('카톡 주세요 aabbcc')).toBe(true);
    expect(re.test('WhatsApp +82 10-1234-5678')).toBe(true);
    expect(re.test('加我 wechat: abc123')).toBe(true);
  });

  it('전화번호(연속 9자리+ 숫자)를 잡는다', () => {
    expect(re.test('call me 010-1234-5678')).toBe(true);
    expect(re.test('+821012345678')).toBe(true);
  });

  it('정상 여행 글(가격·시간·주소 숫자)은 오탐하지 않는다', () => {
    expect(re.test('입장료는 15,000원이고 09:00-18:00 운영해요')).toBe(false);
    expect(re.test('The tour costs $231 and takes 5 hours from 9am')).toBe(false);
    expect(re.test('Bus 7016 from Hongdae, exit 3, about 40 minutes')).toBe(false);
    expect(re.test('2026년 7월 13일에 5일 일정으로 서울 부산 다녀왔어요')).toBe(false);
  });
});
