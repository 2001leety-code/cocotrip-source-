/**
 * 캡처 카드용 밝은 동선 지도.
 * 실제 도로 path와 번호 핀을 그리되, 좌표나 지도 모듈이 없으면 안내 상자만 보여 준다.
 * 주소 목록과 비용은 상위 카드가 별도로 렌더하므로 지도 실패가 공유 내용을 가리지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPinned } from 'lucide-react';

import type {
  MoodBookingShareRoute,
  MoodBookingShareStop,
} from '@/lib/moodBookingShare';

export interface MoodShareRouteMapProps {
  stops: MoodBookingShareStop[];
  route?: MoodBookingShareRoute | null;
  className?: string;
}

interface ShareMapPoint {
  lat: number;
  lng: number;
  order: number;
}

interface ShareMapData {
  markers: ShareMapPoint[];
  path: Array<[number, number]>;
}

function validLatLng(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number'
    && Number.isFinite(lat)
    && typeof lng === 'number'
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

function toShareMapData(stops: MoodBookingShareStop[], route?: MoodBookingShareRoute | null): ShareMapData {
  const routePoints = Array.isArray(route?.points) ? route.points : [];
  const markers: ShareMapPoint[] = [];
  (stops || []).forEach((stop, index) => {
    const fallback = routePoints[index];
    const lat = validLatLng(stop.lat, stop.lng) ? stop.lat : fallback?.lat;
    const lng = validLatLng(stop.lat, stop.lng) ? stop.lng : fallback?.lng;
    if (!validLatLng(lat, lng)) return;
    markers.push({ lat, lng: Number(lng), order: index + 1 });
  });

  const path: Array<[number, number]> = [];
  for (const pair of (Array.isArray(route?.path) ? route.path : [])) {
    const lng = pair?.[0];
    const lat = pair?.[1];
    if (validLatLng(lat, lng)) path.push([lat, Number(lng)]);
  }
  return { markers, path };
}

function MapUnavailable({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex min-h-[164px] items-center justify-center rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-pink-50 px-6 text-center ${className}`}
      data-testid="mood-share-map-fallback"
    >
      <div>
        <MapPinned className="mx-auto mb-2 h-6 w-6 text-violet-500" aria-hidden="true" />
        <p className="text-xs font-bold text-slate-700">동선 지도를 표시하지 못했어요</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">아래 번호와 주소 순서로 동선을 확인해 주세요.</p>
      </div>
    </div>
  );
}

export function MoodShareRouteMap({ stops, route, className = '' }: MoodShareRouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const mapData = useMemo(() => toShareMapData(stops, route), [stops, route]);
  const canRenderMap = mapData.path.length > 1 && mapData.markers.length >= 2;

  useEffect(() => {
    if (!canRenderMap || !containerRef.current) return;
    let cancelled = false;
    let mapInstance: { remove: () => void } | null = null;
    setFailed(false);

    (async () => {
      try {
        await import('leaflet/dist/leaflet.css');
        const L = (await import('leaflet')).default;
        if (cancelled || !containerRef.current) return;

        const map = L.map(containerRef.current, {
          attributionControl: true,
          zoomControl: false,
          dragging: false,
          touchZoom: false,
          doubleClickZoom: false,
          scrollWheelZoom: false,
          boxZoom: false,
          keyboard: false,
        });
        mapInstance = map;

        L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
          {
            subdomains: 'abcd',
            maxZoom: 20,
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
        ).addTo(map);

        // 밝은 지도 위에서도 실제 도로선이 또렷하도록 흰색 테두리 뒤에 보라색 선을 겹친다.
        L.polyline(mapData.path, {
          color: '#ffffff',
          weight: 9,
          opacity: 0.92,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(map);
        L.polyline(mapData.path, {
          color: '#7C5CFC',
          weight: 5,
          opacity: 0.96,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(map);

        for (const point of mapData.markers) {
          const icon = L.divIcon({
            className: 'mood-share-route-pin',
            html:
              '<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;' +
              'justify-content:center;background:linear-gradient(135deg,#7C5CFC,#EA537E);' +
              'color:#fff;font-size:12px;font-weight:900;border:2px solid #fff;' +
              'box-shadow:0 3px 9px rgba(76,29,149,.35)">' + point.order + '</div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });
          L.marker([point.lat, point.lng], { icon, interactive: false }).addTo(map);
        }

        const bounds = L.latLngBounds(mapData.path);
        for (const point of mapData.markers) bounds.extend([point.lat, point.lng]);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        window.requestAnimationFrame(() => {
          if (!cancelled) map.invalidateSize();
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstance) {
        try { mapInstance.remove(); } catch { /* 이미 정리된 지도 */ }
        mapInstance = null;
      }
    };
  }, [canRenderMap, mapData]);

  if (!canRenderMap || failed) return <MapUnavailable className={className} />;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="출발지부터 도착지까지 실제 도로 동선 지도"
      data-testid="mood-share-route-map"
      className={`h-[248px] w-full overflow-hidden rounded-2xl border border-violet-200 bg-violet-50 ${className}`}
      style={{ zIndex: 0 }}
    />
  );
}

export default MoodShareRouteMap;
