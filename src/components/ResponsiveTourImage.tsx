import type { ImgHTMLAttributes } from 'react';
import { responsiveTourAvif, responsiveTourImage } from '@/lib/responsiveTourImage';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> & {
  source: string;
  sizes: string;
  fallbackWidth?: number;
  wideFrom?: number;
  profile?: 'original' | 'region';
};

/** Same photograph and CSS frame. Older browsers retain the complete WebP fallback. */
export function ResponsiveTourImage({ source, sizes, fallbackWidth = 512, wideFrom, profile = 'original', ...props }: Props) {
  const wide = wideFrom ? responsiveTourAvif(source, 'wide') : undefined;
  const avif = responsiveTourAvif(source, profile);
  return (
    <picture style={{ display: 'contents' }}>
      {wide && <source style={{ display: 'none' }} type="image/avif" media={`(min-width: ${wideFrom}px)`} srcSet={wide} sizes={sizes} />}
      {avif && <source style={{ display: 'none' }} type="image/avif" srcSet={avif} sizes={sizes} />}
      <img {...responsiveTourImage(source, sizes, fallbackWidth)} {...props} />
    </picture>
  );
}
