/**
 * 위시리스트 상세링크 정상화 잠금 (2026-07-05).
 *
 * 버그: 위시리스트가 tour.id(예: 'tour-seoul-city')만 저장 → MyPage 가
 *   id.replace('tour-','')='seoul-city' 로 억지 링크 → 실제 slug 'seoul-city-full-day' 와
 *   달라 상세 링크 깨짐. fix: href 저장 + id→slug 매핑 폴백.
 */
import { describe, it, expect } from 'vitest';
import { slugForTourId, TOURS } from '../../src/data/tours';

describe('slugForTourId — 위시리스트 id→slug 폴백', () => {
  it('실제 투어 id → 정확한 slug (억지 replace 아님)', () => {
    // 대표 케이스: 'tour-seoul-city' → 'seoul-city-full-day' (replace('tour-','') 로는 못 만듦)
    expect(slugForTourId('tour-seoul-city')).toBe('seoul-city-full-day');
    // replace 방식이 틀렸음을 명시
    expect('tour-seoul-city'.replace(/^tour-/, '')).not.toBe(slugForTourId('tour-seoul-city'));
  });

  it('모든 투어 id 가 slug 로 매핑됨 (누락 0)', () => {
    for (const t of TOURS) {
      expect(slugForTourId(t.id)).toBe(t.slug);
    }
  });

  it('없는 id → undefined (호출처가 /tours 폴백)', () => {
    expect(slugForTourId('tour-nonexistent-xyz')).toBeUndefined();
  });

  it('href 우선순위 로직 재현 — 저장 href > slug 매핑 > /tours', () => {
    const link = (item: { id: string; productType: string; href?: string }) =>
      item.href
        || (item.productType === 'tour'
          ? (slugForTourId(item.id) ? `/tours/${slugForTourId(item.id)}` : '/tours')
          : item.productType === 'charter' ? '/charter' : '/planner');
    // 저장 href 있으면 그대로
    expect(link({ id: 'tour-seoul-city', productType: 'tour', href: '/tours/custom' })).toBe('/tours/custom');
    // href 없으면 slug 매핑 (기존 데이터)
    expect(link({ id: 'tour-seoul-city', productType: 'tour' })).toBe('/tours/seoul-city-full-day');
    // 매핑 실패 → /tours
    expect(link({ id: 'tour-gone', productType: 'tour' })).toBe('/tours');
    // 비-투어
    expect(link({ id: 'x', productType: 'charter' })).toBe('/charter');
  });
});

describe('위시리스트 소스 배선 불변식', () => {
  it('TourCard 가 href(slug) 를 WishlistToggle 에 전달', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/components/tours/TourCard.tsx'), 'utf8');
    expect(src).toMatch(/href=\{`\/tours\/\$\{tour\.slug\}`\}/);
  });

  it('MyPage wishlist 는 저장 href 우선 + slugForTourId 폴백 (억지 replace 제거)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/pages/MyPage.tsx'), 'utf8');
    expect(src).toMatch(/item\.href/);
    expect(src).toMatch(/slugForTourId/);
    // 옛 억지 변환 제거 확인
    expect(src).not.toMatch(/item\.id\.replace\(\/\^tour-/);
  });

  it('useWishlist WishlistItem 에 href optional + Firestore undefined 제거', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/hooks/useWishlist.ts'), 'utf8');
    expect(src).toMatch(/href\?: string/);
    expect(src).toMatch(/v !== undefined/); // undefined 필드 제거
  });
});
