// CourseMiniMap — 코스 빌더/공유용 미니 동선 지도 (번호핀 + 선).
//
// DayRouteMap(PlanDetailPage) 의 Leaflet 패턴을 CourseStop 전용으로 경량화한 것.
// PlanStop 전용 DayRouteMap 을 재사용하려면 타입 어댑터가 필요하고 그 파일은 완성
// 플랜 상세라 건드리기 위험 → 코스 전용 컴포넌트로 분리(플랜 무영향).
//
// - LAZY: leaflet(JS+CSS) 은 effect 안 dynamic import → 자체 async chunk(main 무관).
// - SAFE: 좌표(lat/lng) 없는 stop 은 건너뜀. 유효 좌표 <2 → null(지도 안 뜸).
// - 무료(CARTO dark basemap, 키 불필요).
import { useEffect, useId, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { CourseStop } from './courseOps';

interface CourseMiniMapProps {
  stops: CourseStop[];
  title: string; // 지도 헤더 라벨 (i18n 은 호출처가 넘김)
}

interface MapPoint { lat: number; lng: number; order: number; label: string; time?: string; }

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 좌표 있는 stop 만 방문순 번호와 함께 뽑음. 번호는 전체 리스트 기준(리스트와 핀 일치). */
function toMapPoints(stops: CourseStop[]): MapPoint[] {
  const points: MapPoint[] = [];
  let n = 0;
  for (const s of stops || []) {
    n += 1;
    if (!isFiniteNum(s.lat) || !isFiniteNum(s.lng)) continue;
    if ((s.lat as number) < -90 || (s.lat as number) > 90 || (s.lng as number) < -180 || (s.lng as number) > 180) continue;
    points.push({ lat: s.lat as number, lng: s.lng as number, order: n, label: s.title, time: s.time || undefined });
  }
  return points;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function CourseMiniMap({ stops, title }: CourseMiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const domId = useId().replace(/[:]/g, '');
  const [failed, setFailed] = useState(false);

  const points = toMapPoints(stops);
  const enoughPoints = points.length >= 2;

  useEffect(() => {
    if (!enoughPoints || !containerRef.current) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mapInstance: any = null;

    (async () => {
      try {
        await import('leaflet/dist/leaflet.css');
        const L = (await import('leaflet')).default;
        if (cancelled || !containerRef.current) return;

        const latLngs = points.map((p) => [p.lat, p.lng] as [number, number]);
        const map = L.map(containerRef.current, {
          zoomControl: true, attributionControl: true, scrollWheelZoom: false, dragging: true,
        });
        mapInstance = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          subdomains: 'abcd', maxZoom: 20,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        }).addTo(map);

        L.polyline(latLngs, { color: '#B668FC', weight: 3, opacity: 0.85, lineJoin: 'round' }).addTo(map);

        points.forEach((p) => {
          const icon = L.divIcon({
            className: 'cocotrip-course-pin',
            html: `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#7C5CFC,#EA537E);color:#fff;font-size:12px;font-weight:800;border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 6px rgba(0,0,0,0.5);">${p.order}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
          });
          const timeHtml = p.time ? `<div style="color:#B9A4FF;font-size:11px;margin-top:2px;">${escapeHtml(p.time)}</div>` : '';
          L.marker([p.lat, p.lng], { icon, title: p.label })
            .addTo(map)
            .bindPopup(`<div style="font-weight:700;font-size:13px;color:#1a1024;">${p.order}. ${escapeHtml(p.label || `#${p.order}`)}</div>${timeHtml}`, { closeButton: true });
        });

        map.fitBounds(L.latLngBounds(latLngs), { padding: [28, 28], maxZoom: 15 });
        setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 0);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstance) { try { mapInstance.remove(); } catch { /* disposed */ } mapInstance = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enoughPoints, JSON.stringify(points.map((p) => [p.lat, p.lng, p.order]))]);

  if (!enoughPoints || failed) return null;

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center gap-1.5 px-0.5">
        <MapIcon className="h-3.5 w-3.5 text-[#B9A4FF]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#B9A4FF]">{title}</span>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08]" style={{ background: 'rgba(10,4,18,0.6)' }}>
        <div id={`course-mini-map-${domId}`} ref={containerRef} className="w-full" style={{ height: 220, zIndex: 0 }} />
      </div>
    </div>
  );
}
