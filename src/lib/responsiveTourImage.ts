import manifest from '@/data/responsiveTourImages.json';

interface Variant { width: number; src: string }
interface ImageEntry { variants: Variant[]; avif?: Record<string, Variant[]> }
interface ResponsiveImageProps { src: string; srcSet?: string; sizes?: string }

/** Exact local-source allowlist only. New/remote photos keep their original src. */
export function responsiveTourImage(source: string, sizes: string, fallbackWidth = 512): ResponsiveImageProps {
  const images = manifest.images as Record<string, ImageEntry>;
  if (!Object.hasOwn(images, source)) return { src: source };
  const variants = images[source].variants;
  const fallback = variants.find((variant) => variant.width >= fallbackWidth) || variants[variants.length - 1];
  return {
    src: fallback.src,
    srcSet: variants.map((variant) => `${variant.src} ${variant.width}w`).join(', '),
    sizes,
  };
}

export function responsiveTourAvif(source: string, profile = 'original'): string | undefined {
  const images = manifest.images as Record<string, ImageEntry>;
  if (!Object.hasOwn(images, source)) return undefined;
  const profiles = images[source].avif;
  if (!profiles || !Object.hasOwn(profiles, profile)) return undefined;
  const variants = profiles[profile];
  return variants?.map((variant) => `${variant.src} ${variant.width}w`).join(', ');
}

/** Match current card/rail CSS; image sizing does not change their layout. */
export const TOUR_CARD_IMAGE_SIZES = '(min-width: 1280px) 355px, (min-width: 1200px) 366px, (min-width: 981px) calc((100vw - 104px) / 3), (min-width: 768px) calc((100vw - 84px) / 2), calc(100vw - 40px)';
export const TOUR_REGION_IMAGE_SIZES = '172px';
export const HOME_TOUR_IMAGE_SIZES = '(min-width: 640px) 128px, 96px';
export const HOME_CITY_IMAGE_SIZES = '(min-width: 1360px) 244px, (min-width: 1024px) 18vw, (min-width: 768px) calc((100vw - 88px) / 3), (min-width: 640px) calc((100vw - 64px) / 3), calc((100vw - 52px) / 2)';
export const HOME_FEATURE_IMAGE_SIZES = '(min-width: 1360px) 487px, (min-width: 1280px) calc(41.6667vw - 80px), (min-width: 1024px) calc(41.6667vw - 67px), (min-width: 768px) calc(100vw - 64px), calc(100vw - 40px)';
