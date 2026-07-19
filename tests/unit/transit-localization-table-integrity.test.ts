// 역명·노선명 표(_transit_localization.js) 무결성 테스트 (2026-07-19).
//
// 배경: 표가 큰 객체 리터럴이라 같은 키를 두 번 쓰면 **에러 없이 뒤엣것이 앞을 덮어쓴다.**
// 실제로 '디지털미디어시티' 가 6호선 구역과 공항철도 구역에 각각 정의돼
// 공식 영문역명 'Digital Media City' 가 'DMC' 로 조용히 바뀌어 있었다.
// 값이 같은 무해한 중복도 9건 더 있었는데, 그 상태로 두면 다음 편집에서 또 사고가 난다.
//
// 표 자체는 런타임에 중복이 사라지므로(객체가 접어버림) **소스를 읽어서** 검사한다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { romanizeStation } from '../../api/_transit_localization.js';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../api/_transit_localization.js'),
  'utf8',
);

/** `const NAME = { … }` 블록 본문을 중괄호 균형으로 잘라낸다. */
function objectBody(varName: string): string {
  const start = SRC.indexOf(`const ${varName} = {`);
  expect(start, `${varName} 선언을 찾지 못함`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) return SRC.slice(SRC.indexOf('{', start) + 1, i);
    }
  }
  throw new Error(`${varName} 블록이 닫히지 않음`);
}

/** 주석을 제거한 뒤 `'키':` 형태를 전부 수집 (중복 포함). */
function literalKeys(body: string): string[] {
  const noComments = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...noComments.matchAll(/'((?:[^'\\]|\\.)*)'\s*:/g)].map((m) => m[1]);
}

function duplicates(keys: string[]): string[] {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const k of keys) (seen.has(k) ? dup : seen).add(k);
  return [...dup];
}

describe('_transit_localization 표 무결성', () => {
  it('STATION_OVERRIDES 에 중복 키가 없다 (뒤엣것이 앞을 조용히 덮어쓴다)', () => {
    expect(duplicates(literalKeys(objectBody('STATION_OVERRIDES')))).toEqual([]);
  });

  it('SPECIAL_LINES 에 중복 키가 없다', () => {
    expect(duplicates(literalKeys(objectBody('SPECIAL_LINES')))).toEqual([]);
  });

  it('키를 실제로 수집하고 있다 (정규식이 헛돌아 빈 배열이면 위 테스트가 무의미해진다)', () => {
    expect(literalKeys(objectBody('STATION_OVERRIDES')).length).toBeGreaterThan(100);
    expect(literalKeys(objectBody('SPECIAL_LINES')).length).toBeGreaterThan(20);
  });
});

describe('공식 영문역명 대조 (전국도시철도역사정보표준데이터, 국가철도공단)', () => {
  // 표 172개를 공식 1,099행과 대조해 나온 실제 오류들. 회귀 시 여기서 잡힌다.
  it('중화는 Junghwa — 중랑(Jungnang)의 로마자를 붙여 쓰던 오류', () => {
    expect(romanizeStation('중화', 'en')).toBe('Junghwa');
    expect(romanizeStation('중랑', 'en')).toBe('Jungnang');
  });

  it('디지털미디어시티는 공식 표기 Digital Media City', () => {
    expect(romanizeStation('디지털미디어시티', 'en')).toBe('Digital Media City');
  });

  it('공식과 일치하던 표본은 그대로 유지된다', () => {
    for (const [ko, en] of [
      ['강남', 'Gangnam'], ['서울역', 'Seoul Station'], ['이태원', 'Itaewon'],
      ['홍대입구', 'Hongik Univ.'], ['을지로입구', 'Euljiro 1(il)-ga'],
    ] as const) {
      expect(romanizeStation(ko, 'en'), ko).toBe(en);
    }
  });
});
