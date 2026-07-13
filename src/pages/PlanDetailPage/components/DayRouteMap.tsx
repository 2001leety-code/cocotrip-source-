// DayRouteMap — per-day interactive route map (ulruru-style: numbered pins +
// polyline connecting stops in visit order). Rendered at the TOP of each day in
// DayTimeline, above the stop list.
//
// ── DESIGN NOTES ────────────────────────────────────────────────────────────
// • LAZY-LOADED: Leaflet (JS + CSS) is pulled in via dynamic import() inside an
//   effect, so the ~140KB map library lives in its own async chunk and never
//   touches the main bundle or any page that doesn't render a plan day.
// • PROVIDER-ISOLATED: every Leaflet-specific symbol is confined to this file,
//   inside the `// ===== MAP PROVIDER (Leaflet) =====` region below. Swapping to
//   Google Maps later = replace that region only (see header comment block at
//   the bottom of this file for the exact steps). The public component API
//   (props + the surrounding dark card) stays identical.
// • SAFE: stops without finite lat/lng are skipped; <2 valid stops → renders
//   nothing (return null). Never crashes on missing / NaN coordinates.
//
// No API key required (CARTO dark basemap, free). Theme: dark purple/pink to
// match the rest of PlanDetailPage.
import { useEffect, useId, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { PlanStop } from '../types';
import { useLanguage } from '@/hooks/useLanguage';

interface DayRouteMapProps {
  stops: PlanStop[];
}

/** A stop reduced to the minimum the map needs. */
interface MapPoint {
  lat: number;
  lng: number;
  order: number;        // 1-based visit order (the pin number)
  label: string;        // display name for the popup
  time?: string;        // start_time for the popup, if present
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Pull display name with the project's standard fallback chain. */
function stopLabel(stop: PlanStop): string {
  const s = stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string };
  return s.display_name || s.name || s.name_en || s.name_ko || '';
}

/** Reduce stops to finite-coordinate map points in visit order. */
function toMapPoints(stops: PlanStop[]): MapPoint[] {
  const points: MapPoint[] = [];
  let n = 0;
  for (const stop of stops || []) {
    n += 1; // visit order counts every stop so pin numbers match the list
    const lat = (stop as { lat?: number | null }).lat;
    const lng = (stop as { lng?: number | null }).lng;
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) continue; // skip stops without coords
    // Guard against obviously invalid coordinates (off-globe).
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    points.push({
      lat,
      lng,
      order: n,
      label: stopLabel(stop),
      time: typeof stop.start_time === 'string' ? stop.start_time : undefined,
    });
  }
  return points;
}

function mapLabels(language: string): { title: string } {
  switch (language) {
    case 'ko': return { title: '오늘의 동선' };
    case 'ja': return { title: '本日のルート' };
    case 'zh': return { title: '今日路线' };
    default: return { title: "Today's Route" };
  }
}

export function DayRouteMap({ stops }: DayRouteMapProps) {
  const { language } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Stable id so multiple day maps on one page never collide.
  const domId = useId().replace(/[:]/g, '');
  const [failed, setFailed] = useState(false);

  // Compute points once per render — cheap, and we need the count to decide
  // whether to render at all *before* hooks run conditionally.
  const points = toMapPoints(stops);
  const enoughPoints = points.length >= 2;

  useEffect(() => {
    if (!enoughPoints || !containerRef.current) return;

    let cancelled = false;
    // Holds the live map instance so cleanup can dispose it. `any` is scoped to
    // this provider region only (Leaflet's namespace type is loaded lazily).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mapInstance: any = null;

    // ===== MAP PROVIDER (Leaflet) ============================================
    // Everything Leaflet-specific is inside this async IIFE. To migrate to
    // Google Maps, replace this block (and the CSS import) — nothing outside it
    // references Leaflet.
    (async () => {
      try {
        // Lazy-load CSS + JS together. Both become part of this file's async
        // chunk, so the main bundle is unaffected.
        await import('leaflet/dist/leaflet.css');
        const L = (await import('leaflet')).default;
        if (cancelled || !containerRef.current) return;

        const latLngs = points.map((p) => [p.lat, p.lng] as [number, number]);

        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
          // Touch-friendly but not greedy: scroll the page, not the map, on wheel.
          scrollWheelZoom: false,
          dragging: true,
        });
        mapInstance = map;

        // CARTO voyager basemap — free, no key, English labels. 밝은 컬러라 핀·동선·주변 상점이 잘 보임
        // (기존 dark_all 은 너무 어두워 동선/핀이 묻혔음).
        L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
          {
            subdomains: 'abcd',
            maxZoom: 20,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          },
        ).addTo(map);

        // Route polyline connecting stops in visit order.
        L.polyline(latLngs, {
          color: '#B668FC',
          weight: 3,
          opacity: 0.85,
          lineJoin: 'round',
        }).addTo(map);

        // Numbered markers (1, 2, 3 … in visit order).
        points.forEach((p) => {
          const icon = L.divIcon({
            className: 'cocotrip-route-pin',
            html:
              `<div style="` +
              `width:26px;height:26px;border-radius:50%;` +
              `display:flex;align-items:center;justify-content:center;` +
              `background:linear-gradient(135deg,#7C5CFC,#EA537E);` +
              `color:#fff;font-size:12px;font-weight:800;` +
              `border:2px solid rgba(255,255,255,0.9);` +
              `box-shadow:0 2px 6px rgba(0,0,0,0.5);` +
              `">${p.order}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -14],
          });
          const safeLabel = escapeHtml(p.label || `#${p.order}`);
          const timeHtml = p.time
            ? `<div style="color:#B9A4FF;font-size:11px;margin-top:2px;">${escapeHtml(p.time)}</div>`
            : '';
          L.marker([p.lat, p.lng], { icon, title: p.label })
            .addTo(map)
            .bindPopup(
              `<div style="font-weight:700;font-size:13px;color:#1a1024;">` +
              `${p.order}. ${safeLabel}</div>${timeHtml}`,
              { closeButton: true },
            );
        });

        // Auto fit-bounds to all markers with a little padding.
        const bounds = L.latLngBounds(latLngs);
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });

        // Tiles can render before the container has its final size (it lives in
        // a swipeable slide). Nudge Leaflet to recompute once mounted.
        setTimeout(() => {
          if (!cancelled) map.invalidateSize();
        }, 0);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstance) {
        try { mapInstance.remove(); } catch { /* already disposed */ }
        mapInstance = null;
      }
    };
    // points is derived from stops; re-init when the stop set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enoughPoints, JSON.stringify(points.map((p) => [p.lat, p.lng, p.order]))]);

  // Graceful no-op: fewer than 2 mappable stops, or the map library failed.
  if (!enoughPoints || failed) return null;

  const labels = mapLabels(language);

  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <MapIcon className="w-3.5 h-3.5 text-[#B9A4FF]" />
        <span className="text-[12px] font-bold uppercase tracking-wider text-[#B9A4FF]">
          {labels.title}
        </span>
      </div>
      <div
        className="relative overflow-hidden rounded-2xl border border-white/[0.08]"
        style={{ background: 'rgba(10,4,18,0.6)' }}
      >
        <div
          id={`day-route-map-${domId}`}
          ref={containerRef}
          className="w-full"
          style={{ height: 240, zIndex: 0 }}
        />
      </div>
      {/* 번호 정거장 리스트 (가이드 P4) — 지도 핀 번호(order)와 1:1 매칭. toMapPoints 재사용(좌표 없는 stop 은 자동 skip). */}
      <ol className="mt-2 space-y-1">
        {points.map((p) => (
          <li
            key={p.order}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
              style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
            >
              {p.order}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/85">{p.label}</span>
            {p.time && <span className="shrink-0 text-[11px] font-medium text-white/45">{p.time}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Minimal HTML escape for popup text (stop names may contain &, <, etc.). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── HOW TO SWAP TO GOOGLE MAPS LATER ────────────────────────────────────────
// 1. In Google Cloud Console, enable the "Maps JavaScript API" for the project.
// 2. Create a browser API key and RESTRICT it: Application restriction =
//    "HTTP referrers", allow `https://cocotripkr.com/*` and
//    `https://*.vercel.app/*` (preview). API restriction = Maps JavaScript API.
// 3. Add the key to Vercel env as `VITE_GOOGLE_MAPS_API_KEY` (Production +
//    Preview), then redeploy with a fresh commit (Vercel "Redeploy" reuses the
//    old env snapshot).
// 4. In THIS file, replace the `// ===== MAP PROVIDER (Leaflet) =====` IIFE:
//    lazy-load the Google loader (e.g. `@googlemaps/js-api-loader`) with
//    `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`, create a `google.maps.Map`,
//    add a dark-styled basemap (mapId or `styles`), draw a
//    `google.maps.Polyline` over `latLngs`, add `AdvancedMarkerElement`s with
//    the same numbered HTML, and `map.fitBounds(new LatLngBounds(...))`.
//    Remove the `import('leaflet/dist/leaflet.css')` + `import('leaflet')` lines
//    and the leaflet deps from package.json. Nothing OUTSIDE this region needs
//    to change — the component props and the dark card wrapper are unchanged.
