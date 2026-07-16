/**
 * Coverage for src/pages/buildGallerySlides.ts — 전환 감사 E1 (2026-07-16).
 *
 * 계약 고정:
 *   1. photos[] 존재 → photos 우선 (Tour 타입: "images[] 보다 우선").
 *      variants 있으면 src=800 variant + srcSet string, 없으면 srcSet undefined.
 *   2. photos 빈 배열/undefined → legacy images[] 그대로, srcSet 항상 undefined
 *      (정적 투어 무영향 — 회귀 가드).
 */
import { describe, it, expect, vi } from 'vitest';

// CI 호환: tours-firestore.ts → @/lib/firebase 가 top-level getAuth() 호출 →
// VITE_FIREBASE_API_KEY 없으면 throw. resolve-photo-url.test.ts 와 동일 mock.
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

import { buildGallerySlides } from '../../src/pages/buildGallerySlides';

const LEGACY_IMAGES = ['/a.webp', '/b.jpg'];

describe('buildGallerySlides — photos[] 우선 (variants 배선)', () => {
  it('photos with variants → src=800 variant, srcSet=400/800/1600 string', () => {
    const photos = [{
      url: 'https://s/orig.webp',
      variants: {
        '400': 'https://s/400.webp',
        '800': 'https://s/800.webp',
        '1600': 'https://s/1600.webp',
      },
    }] as any;
    const slides = buildGallerySlides(LEGACY_IMAGES, photos);
    expect(slides).toHaveLength(1);
    expect(slides[0].src).toBe('https://s/800.webp');
    expect(slides[0].srcSet)
      .toBe('https://s/400.webp 400w, https://s/800.webp 800w, https://s/1600.webp 1600w');
  });

  it('photos without variants (backfill 안 된 사진) → src=원본 url, srcSet=undefined', () => {
    const photos = [{ url: 'https://s/orig.webp' }] as any;
    const slides = buildGallerySlides(LEGACY_IMAGES, photos);
    expect(slides).toEqual([{ src: 'https://s/orig.webp', srcSet: undefined }]);
  });

  it('legacy_public_path 사진 (정적 → Firestore import) → legacy 경로 폴백', () => {
    const photos = [{ url: '/x.jpg', legacy_public_path: '/x.jpg' }] as any;
    const slides = buildGallerySlides(LEGACY_IMAGES, photos);
    expect(slides[0].src).toBe('/x.jpg');
    expect(slides[0].srcSet).toBeUndefined();
  });
});

describe('buildGallerySlides — legacy images[] 폴백 (정적 투어 무영향)', () => {
  it('photos undefined → images 그대로, srcSet 없음', () => {
    expect(buildGallerySlides(LEGACY_IMAGES)).toEqual([
      { src: '/a.webp' },
      { src: '/b.jpg' },
    ]);
  });

  it('photos 빈 배열 → images 폴백 (Tour 타입: "비어있으면 images[] 폴백")', () => {
    expect(buildGallerySlides(LEGACY_IMAGES, [])).toEqual([
      { src: '/a.webp' },
      { src: '/b.jpg' },
    ]);
  });

  it('둘 다 빈 배열 → 빈 슬라이드 (렌더 크래시 없음)', () => {
    expect(buildGallerySlides([], [])).toEqual([]);
  });
});
