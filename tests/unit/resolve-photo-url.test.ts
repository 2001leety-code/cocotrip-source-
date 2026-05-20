/**
 * Coverage for src/lib/tours-firestore.ts — resolvePhotoUrl + buildPhotoSrcSet
 * (P109, 2026-05-20). Firebase Extension storage-resize-images 변종 URL 분기.
 *
 * Verifies:
 *   1. Phase 4 backward compat — preferredWidth 미전달 시 기존 동작 그대로.
 *   2. Phase 9 새 동작 — preferredWidth 매칭 + 폴백 우선순위.
 *   3. variants 누락/빈 객체 → 원본 폴백 (Extension 미설치 환경 호환).
 *   4. buildPhotoSrcSet 의 빈/누락 처리 (브라우저 src 만 fallback).
 *   5. legacy_public_path 우선순위 유지 (string URL > http url > legacy).
 */
import { describe, it, expect, vi } from 'vitest';

// CI 호환 (P117 follow-up): tours-firestore.ts → @/lib/firebase 가 top-level
// getAuth() 호출 → VITE_FIREBASE_API_KEY 없으면 throw. 본 테스트는 순수 helper
// (resolvePhotoUrl/buildPhotoSrcSet) 만 검증하므로 firebase client mock.
vi.mock('@/lib/firebase', () => ({
  db: {},
  auth: {},
  storage: {},
  app: {},
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  deleteDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  serverTimestamp: vi.fn(),
}));

import { resolvePhotoUrl, buildPhotoSrcSet } from '../../src/lib/tours-firestore';

describe('resolvePhotoUrl — Phase 4 backward compat', () => {
  it('string input returned verbatim', () => {
    expect(resolvePhotoUrl('/photos/x.jpg')).toBe('/photos/x.jpg');
  });

  it('TourPhoto with http url returns url', () => {
    expect(resolvePhotoUrl({ url: 'https://storage/x.webp' } as any))
      .toBe('https://storage/x.webp');
  });

  it('TourPhoto with non-http url falls back to legacy_public_path', () => {
    expect(resolvePhotoUrl({ url: 'tours/x.jpg', legacy_public_path: '/public/x.jpg' } as any))
      .toBe('/public/x.jpg');
  });

  it('undefined input returns empty string', () => {
    expect(resolvePhotoUrl(undefined)).toBe('');
  });
});

describe('resolvePhotoUrl — P109 preferredWidth matching', () => {
  const photo = {
    url: 'https://storage/orig.webp',
    variants: {
      '400': 'https://storage/400.webp',
      '800': 'https://storage/800.webp',
      '1600': 'https://storage/1600.webp',
    },
  } as any;

  it('preferredWidth=400 returns 400 variant', () => {
    expect(resolvePhotoUrl(photo, '400')).toBe('https://storage/400.webp');
  });

  it('preferredWidth=800 returns 800 variant', () => {
    expect(resolvePhotoUrl(photo, '800')).toBe('https://storage/800.webp');
  });

  it('preferredWidth=1600 returns 1600 variant', () => {
    expect(resolvePhotoUrl(photo, '1600')).toBe('https://storage/1600.webp');
  });

  it('preferredWidth NOT in variants → falls back to original url', () => {
    const partial = {
      url: 'https://storage/orig.webp',
      variants: { '400': 'https://storage/400.webp' }, // 800/1600 absent
    } as any;
    expect(resolvePhotoUrl(partial, '800')).toBe('https://storage/orig.webp');
  });

  it('variants undefined → falls back to original url (Extension 미설치 호환)', () => {
    const noVariants = { url: 'https://storage/orig.webp' } as any;
    expect(resolvePhotoUrl(noVariants, '400')).toBe('https://storage/orig.webp');
  });

  it('preferredWidth=undefined → ignores variants (existing call signature)', () => {
    expect(resolvePhotoUrl(photo)).toBe('https://storage/orig.webp');
  });
});

describe('buildPhotoSrcSet — srcSet attribute builder', () => {
  it('returns srcset string with all 3 variants', () => {
    const photo = {
      variants: {
        '400': 'https://s/400.webp',
        '800': 'https://s/800.webp',
        '1600': 'https://s/1600.webp',
      },
    } as any;
    expect(buildPhotoSrcSet(photo))
      .toBe('https://s/400.webp 400w, https://s/800.webp 800w, https://s/1600.webp 1600w');
  });

  it('partial variants — only includes present widths', () => {
    const photo = {
      variants: { '400': 'https://s/400.webp', '1600': 'https://s/1600.webp' },
    } as any;
    expect(buildPhotoSrcSet(photo))
      .toBe('https://s/400.webp 400w, https://s/1600.webp 1600w');
  });

  it('empty variants object → undefined (caller omits srcSet attr)', () => {
    expect(buildPhotoSrcSet({ variants: {} } as any)).toBeUndefined();
  });

  it('variants missing → undefined', () => {
    expect(buildPhotoSrcSet({ url: 'x' } as any)).toBeUndefined();
  });

  it('string input → undefined (legacy callers safe)', () => {
    expect(buildPhotoSrcSet('/public/x.jpg')).toBeUndefined();
  });

  it('undefined input → undefined', () => {
    expect(buildPhotoSrcSet(undefined)).toBeUndefined();
  });

  it('preserves width ordering (400 < 800 < 1600) even if variants out of order', () => {
    const photo = {
      variants: { '1600': 'X', '400': 'Y', '800': 'Z' },
    } as any;
    // Output order should still be 400 → 800 → 1600 (img tag UA convention).
    expect(buildPhotoSrcSet(photo)).toBe('Y 400w, Z 800w, X 1600w');
  });
});
