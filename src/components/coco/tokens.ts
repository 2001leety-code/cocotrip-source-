/* 값 SSOT = src/index.css :root --coco-* 블록. 여기는 var 참조만 (파생, 중복 금지). */
export const COCO = {
  purple: 'var(--coco-purple)',            /* #7C5CFF */
  pink: 'var(--coco-pink)',                /* #FF6DB7 */
  lavender: 'var(--coco-lavender)',        /* #D9D3FF */
  navy: 'var(--coco-navy)',                /* #0F1230 */
  muted: 'var(--coco-muted)',              /* #6E6A8F */
  ctaGradient: 'var(--coco-cta-gradient)', /* 보라→핑크 100deg */
  ctaShadow: 'var(--coco-cta-shadow)',
  cardBorder: 'var(--coco-card-border)',
  cardShadow: 'var(--coco-card-shadow)',
  pageBg: 'var(--coco-page-bg)',
} as const;
