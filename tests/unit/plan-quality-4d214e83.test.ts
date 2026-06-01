/**
 * plan 4d214e83 품질 fix 회귀 가드 (2026-06-02, 운영자 신고 "플랜 개판").
 *
 * 신고 plan (서울+부산 5일 block_mode) 의 다중 버그:
 *   ② Day 1 도착 20:29(밤)인데 새벽까지 풀 일정 (02:16 북촌 / 05:39 홍대).
 *   ③ 같은 식당 반복 ('홍대 맛집 깃뜰' 6회) + 다도시 placeholder 미치환 (주소이름 노출).
 * (① 부산 day 가 서울 숙소 = selfheal-lodging-multicity.test.ts 별도 가드)
 *
 * fix: blockMode.js
 *   ② 단도시 + 다도시 expand 에 Day 1 late-arrival cutoff (자정 넘김 처리 포함).
 *   ③ matchFoodPlaceholder excludeNames dedup + 다도시 P281 placeholder text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchFoodPlaceholder } from '../../api/_ai_core/blockMode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');
const src = readFileSync(resolve(ROOT, 'api/_ai_core/blockMode.js'), 'utf-8');

// 자정 처리 cutoff 로직 (소스와 동일 산술) — trim 여부 판정.
function shouldTrim(startTime: string, dayStart: string, cap = '22:00'): boolean {
  const toMin = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m ? +m[1] * 60 + +m[2] : -1; };
  const lm = toMin(startTime); const dsm = toMin(dayStart); const cm = toMin(cap);
  if (lm < 0) return false;
  const pastMidnight = dsm >= 0 && lm < dsm;
  return pastMidnight || lm > cm;
}

describe('plan 4d214e83 ③ — food dedup (matchFoodPlaceholder excludeNames)', () => {
  const foodIndex = [
    { name: '식당A', city: 'seoul', type: 'restaurant', rating: 4.8, reviews: 1000, dietary_tags: [] },
    { name: '식당B', city: 'seoul', type: 'restaurant', rating: 4.6, reviews: 800, dietary_tags: [] },
    { name: '식당C', city: 'seoul', type: 'restaurant', rating: 4.5, reviews: 500, dietary_tags: [] },
  ];
  const ph = { placeholder: 'verified_lunch' };

  it('excludeNames 없으면 1순위(식당A)', () => {
    expect(matchFoodPlaceholder(ph, foodIndex, 'seoul', [])?.name).toBe('식당A');
  });
  it('1순위 used → 차순위(식당B) — "같은 식당 6번" 회귀 차단', () => {
    expect(matchFoodPlaceholder(ph, foodIndex, 'seoul', [], new Set(['식당A']))?.name).toBe('식당B');
  });
  it('1·2순위 used → 3순위(식당C)', () => {
    expect(matchFoodPlaceholder(ph, foodIndex, 'seoul', [], new Set(['식당A', '식당B']))?.name).toBe('식당C');
  });
  it('전부 소진 → 1순위 재사용 (graceful, 식당 부족 도시)', () => {
    expect(matchFoodPlaceholder(ph, foodIndex, 'seoul', [], new Set(['식당A', '식당B', '식당C']))?.name).toBe('식당A');
  });
});

describe('plan 4d214e83 ② — Day 1 late-arrival cutoff', () => {
  it('단도시+다도시 양쪽에 isFirstDay cutoff + pastMidnight 처리 존재', () => {
    expect((src.match(/pastMidnight/g) || []).length, '단도시+다도시 cutoff (pastMidnight 2곳)').toBeGreaterThanOrEqual(2);
    expect(/if \(isFirstDay\)\s*\{/.test(src), 'isFirstDay cutoff 블록 존재').toBe(true);
  });
  it('자정 넘김 처리(pastMidnight) 존재 — "00:29">"22:00" lexical 함정 회피', () => {
    expect(/pastMidnight/.test(src)).toBe(true);
  });
  it('밤 도착(dayStart=21:29): 23:27/00:29/02:16 trim, 21:29 보존', () => {
    expect(shouldTrim('23:27', '21:29')).toBe(true);  // 당일 22:00 이후
    expect(shouldTrim('00:29', '21:29')).toBe(true);  // 자정 넘김(새벽)
    expect(shouldTrim('02:16', '21:29')).toBe(true);  // 자정 넘김(새벽)
    expect(shouldTrim('05:39', '21:29')).toBe(true);  // 자정 넘김(새벽)
    expect(shouldTrim('21:29', '21:29')).toBe(false); // 도착 직후 보존
  });
  it('정상 09:00 plan 무영향: 10:00~18:00 보존', () => {
    expect(shouldTrim('10:00', '09:00')).toBe(false);
    expect(shouldTrim('18:00', '09:00')).toBe(false);
    expect(shouldTrim('21:30', '09:00')).toBe(false); // 22:00 이전 야간 stop 보존
  });
});

describe('plan 4d214e83 ③ — 다도시 P281 (주소이름 노출 차단)', () => {
  it('단도시+다도시 양쪽 "[추천 ..." placeholder text + bs.address 직할당 제거', () => {
    expect((src.match(/\[추천 \$\{placeholderType\}/g) || []).length).toBeGreaterThanOrEqual(2);
    // 주석의 "이전:" 예시(L659)가 아닌 실제 코드 라인만 매칭 (라인 시작 = 주석 // 아님).
    expect(/^\s+resolvedName = bs\.address \|\| 'Local restaurant'/m.test(src),
      '다도시 행정주소 직할당 잔존(주석 아닌 실제 코드) — "서울특별시 종로구 가회동" 노출 회귀').toBe(false);
  });
});
