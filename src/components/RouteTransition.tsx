import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/** fade 안전 해제 시간 — CSS 애니메이션(0.18s)보다 넉넉히 길게. */
const FADE_SAFETY_MS = 400;

/**
 * 라우트 전환 fade (2026-08-02).
 *
 * 🔴 여기에 framer-motion `AnimatePresence mode="wait"` 를 다시 넣지 말 것.
 *   mode="wait" 는 "이전 페이지의 exit 애니메이션이 끝나야" 다음 페이지를 mount 한다.
 *   그 완료 신호는 requestAnimationFrame 으로만 온다. 탭이 백그라운드/비가시 상태면
 *   브라우저가 rAF 를 아예 안 돌린다 → exit 이 영원히 안 끝남 → location.pathname 은
 *   바뀌었는데 화면은 이전 페이지 그대로, 에러도 없음.
 *   /community → /community/new 에서 발견됐지만 전 라우트 공통 문제였다.
 *   회귀 잠금: tests/unit/route-transition.component.test.tsx
 *
 * 원칙: **어느 페이지가 보이는지가 애니메이션 완료에 의존하면 안 된다.**
 *   - pathname 이 바뀌면 key 가 바뀌어 React 가 그 커밋에서 즉시 교체한다. 기다리는 것 없음.
 *   - fade 는 CSS 애니메이션(.route-fade)일 뿐이라 안 돌아도 mount 를 막지 않는다.
 *   - 다만 비가시 탭에서는 애니메이션 타임라인 자체가 멈춰 opacity 가 첫 프레임(0)에
 *     갇힌다(로컬 dev 실측: document.hidden=true 에서 700ms 뒤에도 opacity "0").
 *     그래서 setTimeout(비가시 탭에서도 스로틀될 뿐 돌기는 한다)으로 클래스를 걷어내
 *     요소 기본 opacity(1)로 되돌린다. 보이는 탭에선 0.18s 에 이미 끝나 있어 무변화.
 *   - `@keyframes routeFade` 에 to 가 없는 것도 같은 이유(끝나면 요소 기본 opacity).
 *     index.css 잠금 테스트가 to/fill-mode 추가를 막는다.
 *   - opacity 만 사용 (transform 추가 시 모바일 가로 스크롤 위험 — 기존 규칙 유지).
 *   - prefers-reduced-motion 은 index.css 전역 규칙이 처리.
 *
 * 첫 페이지 로드는 fade 생략 — 기존 `initial={false}` 동작 유지.
 * (프리렌더된 콘텐츠가 이미 화면에 있는데 0 → 1 로 다시 밝아지면 깜빡임으로 보인다.)
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  // 지금 그리고 있는 경로 + fade 여부. 렌더 중 상태 조정(React 공식 패턴)이라
  // effect 를 기다리지 않고 "이동한 그 커밋"에서 fade 가 확정된다.
  // 초기값 fade:false = 첫 로드는 fade 없음. 첫 경로로 되돌아올 때도 경로가 바뀐 것이라 fade 적용.
  const [shown, setShown] = useState({ path: pathname, fade: false });
  if (shown.path !== pathname) setShown({ path: pathname, fade: true });

  useEffect(() => {
    if (!shown.fade) return;
    const id = setTimeout(() => setShown((s) => ({ path: s.path, fade: false })), FADE_SAFETY_MS);
    return () => clearTimeout(id);
  }, [shown]);

  // key={pathname} — 경로가 바뀌면 새 요소라서 CSS 애니메이션이 매번 처음부터 돈다.
  // 쿼리스트링만 바뀔 때는(예: /community?tab=) 그대로 두어 불필요한 fade 를 막는다.
  return (
    <div key={pathname} className={shown.fade ? 'route-fade' : undefined}>
      {children}
    </div>
  );
}
