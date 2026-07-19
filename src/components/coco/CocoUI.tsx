/**
 * CocoTrip 공용 UI — 운영자 UI/UX 가이드 p.10 'Reusable Components' 구현.
 * 팔레트(가이드 p.2): #7C5CFF 퍼플 · #FF6DB7 핑크 · #D9D3FF 라벤더 · #0F1230 딥네이비.
 * 새 화면(위자드·투어·차터·결제·커뮤니티 스킨)은 이 컴포넌트를 재사용 — 중복 정의 금지.
 */
import type { ReactNode, CSSProperties } from 'react';
import { Link } from 'react-router-dom';

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

/** 상태칩 — 가이드 p.10 Tags/Badges. variant 별 파스텔 톤. */
const CHIP_STYLE: Record<string, { bg: string; color: string }> = {
  purple: { bg: 'rgba(124,92,255,0.12)', color: '#7C5CFF' },   // Best Match 등
  pink: { bg: 'rgba(255,109,183,0.14)', color: '#E8509B' },    // 42 min faster 등
  green: { bg: 'rgba(52,199,123,0.14)', color: '#1F9D5B' },    // Popular·Confirmed
  blue: { bg: 'rgba(84,140,255,0.14)', color: '#3D6FE0' },     // New
  gray: { bg: 'rgba(110,106,143,0.12)', color: '#6E6A8F' },
};

export function StatusChip({ tone = 'purple', children, className = '' }: {
  tone?: keyof typeof CHIP_STYLE; children: ReactNode; className?: string;
}) {
  const s = CHIP_STYLE[tone] || CHIP_STYLE.purple;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[9.5px] font-bold ${className}`}
      style={{ background: s.bg, color: s.color }}
    >
      {children}
    </span>
  );
}

/** 보라→핑크 그라데이션 CTA — 가이드 p.10 Primary CTA Button. to 있으면 Link, 없으면 button. */
export function GradientCTA({ to, onClick, children, className = '', style, type = 'button' }: {
  to?: string; onClick?: () => void; children: ReactNode; className?: string;
  style?: CSSProperties; type?: 'button' | 'submit';
}) {
  const cls = `flex items-center justify-center gap-1.5 rounded-full py-3 text-[13px] font-bold text-white active:scale-[0.98] transition-transform ${className}`;
  const sty: CSSProperties = { background: COCO.ctaGradient, boxShadow: COCO.ctaShadow, ...style };
  if (to) {
    return <Link to={to} onClick={onClick} className={cls} style={sty}>{children}</Link>;
  }
  return <button type={type} onClick={onClick} className={cls} style={sty}>{children}</button>;
}

/** 흰 카드 — 가이드 공통 카드(라벤더 보더 + 소프트 섀도). */
export function CocoCard({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-[18px] bg-white ${className}`}
      style={{ border: COCO.cardBorder, boxShadow: '0 10px 24px rgba(48,39,118,0.08)', ...style }}
    >
      {children}
    </div>
  );
}
