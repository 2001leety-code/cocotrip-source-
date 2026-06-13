/**
 * AppSplash — 설치된 PWA(standalone) 실행 시 2초 스플래시.
 *
 *  - 진입 경로가 /mood → MOOD 콜라보 스플래시(C×M) / 그 외 → 코코트립 스플래시(C+비행기).
 *    (앱 켤 때 1회만 — 진입 경로 기준. 앱 안에서 이동할 땐 안 뜸.)
 *  - 일반 웹 방문(브라우저 탭)에선 표시 안 함(standalone 일 때만).
 *  - 코코트립 스플래시엔 영어 태그라인 / 무드는 이미지만.
 *  🔴 훅은 전부 early-return 위 (rules-of-hooks).
 */
import { useEffect, useRef, useState } from 'react';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const ios = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || ios;
}

export function AppSplash() {
  const launchPath = useRef(typeof window !== 'undefined' ? window.location.pathname : '/');
  const [show, setShow] = useState(() => isStandalone());
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!show) return;
    const tFade = setTimeout(() => setFading(true), 1600);
    const tDone = setTimeout(() => setShow(false), 2000);
    return () => { clearTimeout(tFade); clearTimeout(tDone); };
  }, [show]);

  if (!show) return null;

  const isMood = launchPath.current.startsWith('/mood');
  const img = isMood ? '/splash-mood.png' : '/splash-cocotrip.png';
  const tagline = isMood ? '' : 'Plan your Korea trip in 60 seconds with AI ✈️';

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: `#0a0412 url('${img}') center / cover no-repeat`,
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.45s ease',
        pointerEvents: 'none',
      }}
    >
      {tagline && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '11%',
            textAlign: 'center',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 0.2,
            opacity: 0.92,
            padding: '0 28px',
            textShadow: '0 2px 10px rgba(0,0,0,0.5)',
          }}
        >
          {tagline}
        </div>
      )}
    </div>
  );
}
