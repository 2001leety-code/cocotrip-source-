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
import { segmentTiringReasons } from '../lib/routeInsight';
import { stepsToSegments, type RouteSegment, type TransitStepLike } from '@/lib/routeSegments';

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
  hard: boolean;        // 이 stop 으로의 이동(transit_from_prev)이 힘든 대중교통 구간인지 (P5 범례)
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
      // 이 stop 으로의 대중교통 이동이 힘든 구간(환승2+/도보900m+/60분+)이면 hard.
      // routeInsight 와 동일 판정(RouteAgent 실측 필드만) — 추정·환각 없음.
      hard: segmentTiringReasons((stop as { transit_from_prev?: unknown }).transit_from_prev as never).length > 0,
    });
  }
  return points;
}

// ── (2026-07-19) 실경로 세그먼트 ──────────────────────────────────────────────
// RouteAgent 가 저장한 steps_detail[].path (TMAP passShape 실좌표)를 그대로 그린다.
// 없으면(구형 플랜·ODsay 경로) stop→stop 직선으로 폴백 — 절대 빈 지도가 되지 않게.
// 변환 로직은 코스 빌더(CourseMiniMap)와 공유한다 → src/lib/routeSegments.ts

/** stops → 실경로 세그먼트. 각 stop 의 transit_from_prev.steps_detail 을 펼친다. */
function toRouteSegments(stops: PlanStop[]): RouteSegment[] {
  const segs: RouteSegment[] = [];
  for (const stop of stops || []) {
    const t = (stop as { transit_from_prev?: { steps_detail?: TransitStepLike[] } }).transit_from_prev;
    segs.push(...stepsToSegments(t?.steps_detail));
  }
  return segs;
}

function mapLabels(language: string): { title: string; easy: string; hard: string } {
  switch (language) {
    case 'ko': return { title: '오늘의 동선', easy: '쉬운 이동', hard: '힘든 구간' };
    case 'ja': return { title: '本日のルート', easy: '楽な移動', hard: '大変な区間' };
    case 'zh': return { title: '今日路线', easy: '轻松路段', hard: '较累路段' };
    default: return { title: "Today's Route", easy: 'Easy', hard: 'Challenging' };
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
  // 실경로 세그먼트(TMAP passShape). 없으면 빈 배열 → effect 안에서 직선 폴백.
  const segments = toRouteSegments(stops);
  // effect 의존성용 서명 — 좌표 배열을 그대로 넣으면 매 렌더 재실행된다.
  const segmentsKey = `${segments.length}:${segments.reduce((n, s) => n + s.path.length, 0)}`;

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

        // Route polylines.
        // (2026-07-19) 실경로 우선: TMAP passShape 좌표가 있으면 도로·철도를 따라 그리고
        // 노선 공식 색을 쓴다. 좌표가 없는 구형 플랜은 기존 stop→stop 직선으로 폴백해
        // 지도가 비지 않게 한다(난이도 styling = P5 범례 유지).
        if (segments.length > 0) {
          for (const seg of segments) {
            L.polyline(seg.path, {
              color: seg.color,
              weight: seg.dashed ? 3 : 5,
              opacity: seg.dashed ? 0.75 : 0.9,
              lineJoin: 'round',
              lineCap: 'round',
              ...(seg.dashed ? { dashArray: '4, 8' } : {}),
            }).addTo(map);

            // 승차 지점 — "여기서 탄다". 작은 흰 점 + 정류장/역 이름 팝업.
            if (seg.board) {
              L.marker([seg.board.lat, seg.board.lng], {
                icon: L.divIcon({
                  className: 'cocotrip-board-pin',
                  html:
                    `<div style="width:11px;height:11px;border-radius:50%;background:#fff;` +
                    `border:3px solid ${seg.color};box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
                  iconSize: [11, 11],
                  iconAnchor: [5.5, 5.5],
                }),
                title: seg.board.name,
                zIndexOffset: -100,
              })
                .addTo(map)
                .bindPopup(
                  `<div style="font-size:12px;color:#1a1024;"><b>${escapeHtml(seg.label || '')}</b><br/>` +
                  `${escapeHtml(seg.board.name)}</div>`,
                  { closeButton: true },
                );
            }

            // 수단 칩 — 경로 중간에 "🚇 2호선" 을 얹어 지도만 봐도 뭘 타는지 읽히게.
            // 번호핀(26px)과 겹쳐 잘리지 않도록 중앙 정렬 + 위로 살짝 띄운다.
            if (seg.label && seg.path.length >= 2) {
              const mid = seg.path[Math.floor(seg.path.length / 2)];
              const chipW = seg.label.length * 7 + 20;
              L.marker(mid, {
                icon: L.divIcon({
                  className: 'cocotrip-mode-chip',
                  html:
                    `<div style="white-space:nowrap;padding:3px 8px;border-radius:999px;` +
                    `background:${seg.color};color:#fff;font-size:10px;font-weight:800;` +
                    `line-height:1.1;text-align:center;` +
                    `border:1.5px solid rgba(255,255,255,0.95);box-shadow:0 2px 6px rgba(0,0,0,0.35);` +
                    `">${escapeHtml(seg.label)}</div>`,
                  iconSize: [chipW, 18],
                  iconAnchor: [chipW / 2, 26], // 경로 위쪽으로 띄워 핀과 충돌 완화
                }),
                interactive: false,
                zIndexOffset: 200, // 폴리라인·승차핀 위, 번호핀과는 위치로 분리
              }).addTo(map);
            }
          }
        } else {
          // 폴백: 구형 플랜 — stop→stop 직선 + 난이도 styling.
          for (let k = 1; k < points.length; k++) {
            const a = points[k - 1];
            const b = points[k];
            L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
              color: b.hard ? '#FFB020' : '#B668FC',
              weight: 3,
              opacity: 0.85,
              lineJoin: 'round',
              ...(b.hard ? { dashArray: '6, 9' } : {}),
            }).addTo(map);
          }
        }

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
        // 실경로가 있으면 경로 좌표까지 포함해야 노선이 화면 밖으로 잘리지 않는다.
        const bounds = L.latLngBounds(latLngs);
        for (const seg of segments) for (const pt of seg.path) bounds.extend(pt);
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
  }, [enoughPoints, JSON.stringify(points.map((p) => [p.lat, p.lng, p.order])), segmentsKey]);

  // Graceful no-op: fewer than 2 mappable stops, or the map library failed.
  if (!enoughPoints || failed) return null;

  const labels = mapLabels(language);
  // 힘든 구간이 하나라도 있을 때만 범례 노출(전부 쉬우면 단일 스타일이라 불필요).
  const hasHard = points.some((p) => p.hard);

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
      {/* 지도 범례 (가이드 P5) — 실선=쉬운 이동 / 점선=힘든 대중교통 구간(routeInsight 실판정). 힘든 구간 있을 때만. */}
      {hasHard && (
        <div className="mt-2 flex items-center gap-4 px-0.5 text-[11px] text-white/55">
          <span className="flex items-center gap-1.5">
            <span style={{ width: 18, height: 0, borderTop: '3px solid #B668FC', borderRadius: 2 }} aria-hidden />
            {labels.easy}
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 18, height: 0, borderTop: '3px dashed #FFB020' }} aria-hidden />
            {labels.hard}
          </span>
        </div>
      )}
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
