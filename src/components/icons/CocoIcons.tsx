/**
 * CocoTrip Icon System — 운영자 UI/UX 디자인 가이드 p.2 Iconography 복제 + 확장.
 * 규격: 24px 그리드 · 2px 라운드 스트로크 · 퍼플 그라데이션(#7C3AED→#9F7BFF)
 *       · 아이콘당 액센트 최대 1요소(오렌지 #FF9F5A / 핑크 #FF6DB7).
 * 그라데이션은 gradientUnits="userSpaceOnUse" — 수평/수직 단선(높이 0 bbox)에서도
 * 렌더되게 하는 필수 설정 (objectBoundingBox 는 해당 선을 그리지 않음).
 * id 충돌 방지: useId 로 인스턴스별 gradient id 발급.
 */
import { useId, type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function useGrad() {
  const id = useId().replace(/[:]/g, '');
  return {
    id: `cg-${id}`,
    defs: (gid: string) => (
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
          <stop offset="0" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#9F7BFF" />
        </linearGradient>
      </defs>
    ),
  };
}

function base(size: number | undefined, props: IconProps) {
  const { size: _s, ...rest } = props;
  return { width: size || 24, height: size || 24, viewBox: '0 0 24 24', fill: 'none', ...rest };
}

/** 경로 핀 — 가이드 'Route' (투어/일정) */
export function IconRoute({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <path fill={g} d="M7.2 2.8 a3.4 3.4 0 0 1 3.4 3.4 c0 2.4-3.4 5.6-3.4 5.6 s-3.4-3.2-3.4-5.6 a3.4 3.4 0 0 1 3.4-3.4 z" />
      <circle cx="7.2" cy="6.1" r="1.15" fill="#fff" />
      <path fill="none" stroke={g} strokeWidth="1.9" strokeLinecap="round" strokeDasharray="0.2 3.1" d="M7.6 13.6 C8.2 15.6, 10 16.2, 12 16.4 C14 16.6, 15.4 17, 16 18.2" />
      <circle cx="17.2" cy="17.2" r="2.5" fill="none" stroke={g} strokeWidth="1.9" />
      <circle cx="17.2" cy="17.2" r="0.9" fill={g} />
    </svg>
  );
}

/** 번개 — 가이드 'Lightning' (빠름/최적화) */
export function IconLightning({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <path fill={g} stroke={g} strokeWidth="1.4" strokeLinejoin="round" d="M13.4 2.6 L5.8 13.1 H10 L9.4 21.4 L17.6 10.4 H13 L13.4 2.6 Z" />
    </svg>
  );
}

/** 지구본 — 가이드 'Globe' (다국어) */
export function IconGlobe({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <g fill="none" stroke={g} strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.2" />
        <ellipse cx="12" cy="12" rx="3.8" ry="8.2" />
        <line x1="4" y1="12" x2="20" y2="12" />
      </g>
    </svg>
  );
}

/** 침대 — 가이드 'Hotel' (숙소) */
export function IconHotel({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <rect x="3.2" y="5.2" width="2.3" height="13.6" rx="1.15" fill={g} />
      <circle cx="8.6" cy="10" r="1.8" fill={g} />
      <path fill={g} d="M5.5 12.2 H18.2 a2.6 2.6 0 0 1 2.6 2.6 V16 a0.9 0.9 0 0 1 -0.9 0.9 H5.5 Z" />
      <rect x="18.5" y="16.9" width="2.3" height="1.9" rx="0.95" fill={g} />
    </svg>
  );
}

/** 접이 지도 — 가이드 'Map' */
export function IconMap({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <g fill="none" stroke={g} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.6 5.6 L9 3.6 L15 5.6 L20.4 3.6 V18.4 L15 20.4 L9 18.4 L3.6 20.4 Z" />
        <path d="M9 3.6 V18.4" />
        <path d="M15 5.6 V20.4" />
      </g>
    </svg>
  );
}

/** 로봇 — 가이드 'Assistant' (AI 플래너, 오른귀 오렌지 액센트) */
export function IconAssistant({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <rect x="5.2" y="7.4" width="13.6" height="10.6" rx="3.4" fill="none" stroke={g} strokeWidth="2" />
      <path d="M12 7.4 V5.2" stroke={g} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="4" r="1.1" fill={g} />
      <rect x="2.6" y="10.6" width="1.9" height="4.2" rx="0.95" fill={g} />
      <rect x="19.5" y="10.6" width="1.9" height="4.2" rx="0.95" fill="#FF9F5A" />
      <circle cx="9.6" cy="12" r="1.25" fill={g} />
      <circle cx="14.4" cy="12" r="1.25" fill={g} />
      <path d="M9.9 14.9 C10.9 15.9, 13.1 15.9, 14.1 14.9" fill="none" stroke={g} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 구름+해 — 가이드 'Weather' */
export function IconWeather({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <g fill="none" stroke={g} strokeWidth="1.9" strokeLinecap="round">
        <circle cx="16" cy="7.6" r="2.6" />
        <path d="M16 3.4 V2.2 M19 4.6 L19.9 3.7 M20.4 7.6 H21.6 M19 10.6 L19.9 11.5" />
        <path d="M5.6 18 H13.6 A3.5 3.5 0 0 0 14 11 A4.9 4.9 0 0 0 4.5 12.4 A3 3 0 0 0 5.6 18 Z" />
      </g>
    </svg>
  );
}

/** 티켓 — 가이드 'Booking' (핑크 점선 액센트) */
export function IconBooking({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <path fill="none" stroke={g} strokeWidth="2" strokeLinejoin="round" d="M3.4 9.2 A2.2 2.2 0 0 1 5.6 7 H18.4 A2.2 2.2 0 0 1 20.6 9.2 V10 A2 2 0 0 0 20.6 14 V14.8 A2.2 2.2 0 0 1 18.4 17 H5.6 A2.2 2.2 0 0 1 3.4 14.8 V14 A2 2 0 0 0 3.4 10 Z" />
      <path d="M14.8 7.6 V16.4" stroke="#FF6DB7" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="1.6 2.2" />
    </svg>
  );
}

/** 프라이빗 밴 — 확장 (차터) */
export function IconVan({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <g fill="none" stroke={g} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.8 15.8 V9.8 A2 2 0 0 1 4.8 7.8 H13.6 A3 3 0 0 1 16 9 L18.9 12.7 A3.4 3.4 0 0 1 21.2 15.8 H20" />
        <path d="M13.2 8.2 V12.4 H18.6" />
        <path d="M8.5 15.8 H15.3" />
        <path d="M2.8 12.4 H7" />
      </g>
      <circle cx="6.7" cy="16" r="2" fill={g} /><circle cx="6.7" cy="16" r="0.8" fill="#fff" />
      <circle cx="17.1" cy="16" r="2" fill={g} /><circle cx="17.1" cy="16" r="0.8" fill="#fff" />
    </svg>
  );
}

/** 비행기 — 확장 (공항픽업) */
export function IconPlane({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <path fill={g} stroke={g} strokeWidth="1" strokeLinejoin="round" d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
      <circle cx="20" cy="16.5" r="1" fill="none" stroke="#FF6DB7" strokeWidth="1.5" />
    </svg>
  );
}

/** 응원봉+음표 — 확장 (K-pop, 핑크 액센트) */
export function IconKpop({ size, ...props }: IconProps) {
  const { id, defs } = useGrad();
  const g = `url(#${id})`;
  return (
    <svg {...base(size, props)}>
      {defs(id)}
      <circle cx="9.6" cy="7.4" r="3.6" fill="none" stroke={g} strokeWidth="2" />
      <rect x="8.5" y="11.3" width="2.2" height="8.6" rx="1.1" fill={g} />
      <path d="M17.4 5.6 V11" stroke="#FF6DB7" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="11.7" r="1.5" fill="none" stroke="#FF6DB7" strokeWidth="1.7" />
      <path d="M17.4 5.6 C18.3 6.2 19.3 6.3 20 6" stroke="#FF6DB7" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 카테고리 키 → 아이콘 매핑 (홈 Quick Actions 등에서 사용) */
export const COCO_CATEGORY_ICONS = {
  planner: IconAssistant,
  tours: IconRoute,
  charter: IconVan,
  airport: IconPlane,
  kpop: IconKpop,
} as const;
