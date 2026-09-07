import mark from '@/data/responsiveBrandMark.json';

/** Shared Header needs only the existing brand mark, not every tour photo URL. */
export const RESPONSIVE_BRAND_MARK = {
  src: mark.variants[0].src,
  srcSet: mark.variants.map(({ width, src }) => `${src} ${width}w`).join(', '),
  sizes: '32px',
};
