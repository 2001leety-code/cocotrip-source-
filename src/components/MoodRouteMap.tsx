/**
 * MoodRouteMap — MOOD 경로 지도 (네이버 길찾기 느낌: 실제 경로 선 + 출발/경유/도착 마커 + 소요시간).
 *
 * 백엔드 /api/mood-route 가 준 route.path(폴리라인 좌표)·points(마커 좌표) 를 그린다.
 * (지오코딩·경로계산은 백엔드가 하므로 프론트 중복 호출 없음 = API 비용 절약.)
 *   1. VITE_NCP_MAP_CLIENT_ID 설정 + NCP 콘솔에 도메인 등록 시 → 인라인 지도에 경로 그림.
 *   2. 키 없음/인증 실패/경로 없음 → "네이버 지도에서 보기" 링크 폴백(키 불필요, 항상 동작).
 *
 * 🔴 NCP 콘솔에 도메인(cocotripkr.com) 미등록이면 window.navermap_authFailure 발화 → 인앱에
 *    "NCP 등록 필요" 안내(자가진단). 원격으로는 도메인 등록 여부를 못 읽으므로 앱이 스스로 알림.
 * 🔴 훅은 전부 early-return 위.
 */
import { useEffect, useRef, useState } from 'react';
import { loadNaverMaps, getNaver, naverMapSearchUrl } from '@/lib/naverMap';

interface RoutePoint {
  lat: number;
  lng: number;
  role: 'origin' | 'waypoint' | 'destination';
  index?: number;
}
interface RouteData {
  km: number;
  durationMin: number;
  path: [number, number][]; // [lng, lat]
  points: RoutePoint[];
}

interface MoodRouteMapProps {
  origin: string;
  waypoints: string[];
  destination: string;
  route: RouteData | null;
  accent: string;
  inputBg: string;
  inputBorder: string;
  textDim: string;
}

const ROLE_COLOR: Record<string, string> = { origin: '#22c55e', waypoint: '#f59e0b', destination: '#ef4444' };
const ROLE_LABEL: Record<string, string> = { origin: '출발', waypoint: '경유', destination: '도착' };

export function MoodRouteMap({ origin, waypoints, destination, route, accent, inputBg, inputBorder, textDim }: MoodRouteMapProps) {
  const clientId = import.meta.env.VITE_NCP_MAP_CLIENT_ID as string | undefined;
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [authFailed, setAuthFailed] = useState(false);

  // 네이버 지도 인증 실패(NCP 도메인 미등록 등) 자가진단 — 전역 콜백을 SDK 가 호출.
  useEffect(() => {
    (window as unknown as { navermap_authFailure?: () => void }).navermap_authFailure = () => setAuthFailed(true);
  }, []);

  const hasRoute = !!(route && route.path && route.path.length > 1 && route.points && route.points.length > 0);

  useEffect(() => {
    if (!clientId || !hasRoute || authFailed || !route) { setStatus('idle'); return; }
    let cancelled = false;
    setStatus('loading');
    loadNaverMaps(clientId)
      .then(() => {
        if (cancelled || !mapRef.current) return;
        const naver = getNaver();
        if (!naver || !mapRef.current) { setStatus('error'); return; }

        const map = new naver.maps.Map(mapRef.current, {
          center: new naver.maps.LatLng(route.points[0].lat, route.points[0].lng),
          zoom: 12,
          zoomControl: true,
        });
        const bounds = new naver.maps.LatLngBounds();

        // 경로 선 — path 는 [lng,lat] 이므로 LatLng(lat,lng) 로 변환.
        const linePath = route.path.map(([lng, lat]) => new naver.maps.LatLng(lat, lng));
        new naver.maps.Polyline({ map, path: linePath, strokeColor: '#7C5CFC', strokeWeight: 5, strokeOpacity: 0.9 });
        linePath.forEach((ll) => bounds.extend(ll));

        // 출발/경유/도착 마커 (색·라벨 구분).
        for (const p of route.points) {
          const ll = new naver.maps.LatLng(p.lat, p.lng);
          const label = (ROLE_LABEL[p.role] || '') + (p.role === 'waypoint' && typeof p.index === 'number' ? String(p.index + 1) : '');
          new naver.maps.Marker({
            position: ll,
            map,
            icon: {
              content: `<div style="background:${ROLE_COLOR[p.role]};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.45)">${label}</div>`,
              anchor: new naver.maps.Point(14, 12),
            },
          });
          bounds.extend(ll);
        }
        (map as { fitBounds?: (b: unknown) => void }).fitBounds?.(bounds);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [clientId, hasRoute, authFailed, route]);

  const linkTarget = destination.trim() || origin.trim() || waypoints.find((w) => w.trim()) || '';
  const linkUrl = naverMapSearchUrl(linkTarget);
  const showEmbed = !!clientId && hasRoute && !authFailed && status !== 'error';

  if (!linkTarget && !hasRoute) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {showEmbed && (
        <div
          ref={mapRef}
          className="w-full rounded-xl overflow-hidden"
          style={{ height: 340, border: inputBorder, background: inputBg }}
        />
      )}
      {showEmbed && route && (
        <span className="text-[11px] font-semibold" style={{ color: textDim }}>
          🚗 {route.km}km · {route.durationMin}분
        </span>
      )}
      {authFailed && (
        <span className="text-[11px]" style={{ color: '#f59e0b' }}>
          지도 인증 실패 — NCP 콘솔에 도메인(cocotripkr.com) 등록 필요. 우선 아래 링크로 확인하세요.
        </span>
      )}
      <div className="flex items-center gap-2">
        {linkTarget && (
          <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] underline" style={{ color: accent }}>
            📍 네이버 지도에서 보기
          </a>
        )}
        {!!clientId && hasRoute && status === 'loading' && !authFailed && (
          <span className="text-[11px]" style={{ color: textDim }}>지도 불러오는 중…</span>
        )}
      </div>
    </div>
  );
}
