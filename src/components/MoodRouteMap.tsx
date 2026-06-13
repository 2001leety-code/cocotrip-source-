/**
 * MoodRouteMap — MOOD 경로 미니맵 (주소 맞는지 시각 확인).
 *
 * 2단 동작:
 *   1) VITE_NCP_MAP_CLIENT_ID 설정 시 → Naver Dynamic Map 인라인 임베드(출발/경유/도착 핀).
 *   2) 키 없음/로드 실패 시 → "네이버 지도에서 보기" 링크 폴백(키 불필요, 항상 동작).
 *
 * 지오코딩은 디바운스(800ms) — 타이핑 중 매 키마다 호출(쿼터) 방지.
 * 🔴 훅은 전부 early-return 위에서 호출(rules-of-hooks).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadNaverMaps, geocodeAddress, getNaver, naverMapSearchUrl } from '@/lib/naverMap';

interface MoodRouteMapProps {
  origin: string;
  waypoints: string[];
  destination: string;
  accent: string;
  inputBg: string;
  inputBorder: string;
  textDim: string;
}

type Coord = { lat: number; lng: number };

export function MoodRouteMap({ origin, waypoints, destination, accent, inputBg, inputBorder, textDim }: MoodRouteMapProps) {
  const clientId = import.meta.env.VITE_NCP_MAP_CLIENT_ID as string | undefined;
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const points = useMemo(
    () => [origin, ...waypoints, destination].map((s) => String(s || '').trim()).filter(Boolean),
    [origin, waypoints, destination],
  );

  useEffect(() => {
    if (!clientId || points.length === 0) { setStatus('idle'); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setStatus('loading');
      try {
        await loadNaverMaps(clientId);
        if (cancelled || !mapRef.current) return;
        const coords = (await Promise.all(points.map((p) => geocodeAddress(p))))
          .filter((c): c is Coord => !!c);
        if (cancelled) return;
        const naver = getNaver();
        if (!naver || coords.length === 0 || !mapRef.current) { setStatus('error'); return; }

        const map = new naver.maps.Map(mapRef.current, {
          center: new naver.maps.LatLng(coords[0].lat, coords[0].lng),
          zoom: 11,
        });
        const bounds = new naver.maps.LatLngBounds();
        const markers: unknown[] = [];
        for (const c of coords) {
          const ll = new naver.maps.LatLng(c.lat, c.lng);
          markers.push(new naver.maps.Marker({ position: ll, map }));
          bounds.extend(ll);
        }
        if (coords.length > 1) (map as { fitBounds?: (b: unknown) => void }).fitBounds?.(bounds);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }, 800);
    return () => { cancelled = true; clearTimeout(t); };
  }, [clientId, points]);

  if (points.length === 0) return null;

  const linkUrl = naverMapSearchUrl(destination.trim() || origin.trim() || points[0]);
  const showEmbed = !!clientId && status !== 'error';

  return (
    <div className="flex flex-col gap-1.5">
      {showEmbed && (
        <div
          ref={mapRef}
          className="w-full rounded-xl overflow-hidden"
          style={{ height: 200, border: inputBorder, background: inputBg }}
        />
      )}
      <div className="flex items-center gap-2">
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] underline"
          style={{ color: accent }}
        >
          📍 네이버 지도에서 보기
        </a>
        {showEmbed && status === 'loading' && (
          <span className="text-[11px]" style={{ color: textDim }}>지도 불러오는 중…</span>
        )}
      </div>
    </div>
  );
}
