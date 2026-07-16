/**
 * buildGallerySlides — TourDetailPage ImageGallery 슬라이드 소스 빌더 (순수 함수).
 *
 * 전환 감사 E1 (2026-07-16): 어드민 등록 투어의 photos[] 는 storage-resize-images
 * 가 생성한 400/800/1600 webp variants 를 보유하는데, 갤러리가 tour.images
 * (string[]) 만 소비해 buildPhotoSrcSet 이 죽은 코드였다. photos[] 가 있으면
 * 우선 사용(Tour 타입 계약: "images[] 보다 우선"), 없으면 legacy images[]
 * 그대로 — 정적 투어(variants 없음)는 srcSet 이 omit 되어 동작 무변.
 */
import type { TourPhoto } from '@/data/tours';
import { buildPhotoSrcSet, resolvePhotoUrl } from '@/lib/tours-firestore';

export interface GallerySlide {
  /** <img src> — variants 있으면 800(모바일 갤러리 기준) 폴백, 없으면 원본/legacy 경로 */
  src: string;
  /** <img srcSet> — variants 1+ 일 때만 string. undefined 면 attribute 자체 omit */
  srcSet?: string;
}

export function buildGallerySlides(images: string[], photos?: TourPhoto[]): GallerySlide[] {
  if (photos && photos.length > 0) {
    return photos.map((photo) => ({
      src: resolvePhotoUrl(photo, '800'),
      srcSet: buildPhotoSrcSet(photo),
    }));
  }
  return images.map((src) => ({ src }));
}
