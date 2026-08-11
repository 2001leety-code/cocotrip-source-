// 지역명 뒤 한국어 조사(은/는, 을/를)는 받침 유무로 갈리고 공백 없이 붙는다.
// RegionSeoInfo 가 조사를 하드코딩해서 "서울 은"(공백) 또는 "제주은"(받침 무시) 처럼
// 깨지는 걸 막는 근본 원인 helper — 지역명별 받침 유무를 직접 잠근다.
import { describe, it, expect } from 'vitest';
import { withEunNeun, withEulReul } from '../../src/components/region/koreanParticle';

describe('koreanParticle — 받침 유무로 조사를 고른다', () => {
  it('받침 있는 지역명은 은/을을 공백 없이 붙인다', () => {
    expect(withEunNeun('서울')).toBe('서울은'); // 울 받침 ㄹ
    expect(withEunNeun('부산')).toBe('부산은'); // 산 받침 ㄴ
    expect(withEunNeun('인천')).toBe('인천은'); // 천 받침 ㄴ
    expect(withEulReul('서울')).toBe('서울을');
    expect(withEulReul('인천')).toBe('인천을');
  });

  it('받침 없는 지역명은 는/를을 공백 없이 붙인다', () => {
    expect(withEunNeun('제주')).toBe('제주는'); // 주 받침 없음
    expect(withEunNeun('경주')).toBe('경주는');
    expect(withEunNeun('전주')).toBe('전주는');
    expect(withEulReul('제주')).toBe('제주를');
    expect(withEulReul('경주')).toBe('경주를');
  });

  it('공백을 앞에 끼우지 않는다', () => {
    expect(withEunNeun('서울')).not.toContain(' ');
    expect(withEulReul('제주')).not.toContain(' ');
  });
});
