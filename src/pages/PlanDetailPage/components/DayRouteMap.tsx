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
import { pointsToSegments, type RoutePoint, type TransitStepLike } from '@/lib/routeSegments';
import { naverMapDirectionsUrl, NAVER_DIRECTIONS_MAX_STOPS } from '@/lib/naverMap';

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
  /** 이 stop 으로 오는 구간의 실경로 step 들 (없으면 직선 폴백 — pointsToSegments 가 처리). */
  legSteps?: TransitStepLike[];
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
      legSteps: (stop as { transit_from_prev?: { steps_detail?: TransitStepLike[] } }).transit_from_prev?.steps_detail,
    });
  }
  return points;
}

// ── (2026-07-19) 실경로 세그먼트 ──────────────────────────────────────────────
// RouteAgent 가 저장한 steps_detail[].path (TMAP passShape 실좌표)를 그대로 그린다.
// 좌표가 없는 구간은 stop→stop 직선으로 폴백 — 절대 선이 끊기지 않게.
// (2026-07-28) 폴백을 **구간 단위**로 내림 — 지하철+도보가 섞인 날 도보 구간만
// 통째로 안 그려지던 구멍 제거. 변환·폴백 로직은 코스 빌더와 공유 → lib/routeSegments.

type MapLabels = {
  title: string; easy: string; hard: string; showRoute: string; loading: string;
  none: string; openNaver: string; naverCapped: string;
};

function mapLabels(language: string): MapLabels {
  switch (language) {
    case 'ko': return { title: '오늘의 동선', easy: '쉬운 이동', hard: '힘든 구간', showRoute: '실제 경로 보기', loading: '경로 찾는 중…', none: '이 동선의 대중교통 경로를 찾지 못했어요.', openNaver: '네이버 지도', naverCapped: `네이버 지도는 한 번에 ${NAVER_DIRECTIONS_MAX_STOPS}곳까지 안내해요. 앞의 ${NAVER_DIRECTIONS_MAX_STOPS}곳만 표시합니다.` };
    case 'ja': return { title: '今日のルート', easy: '移動しやすい区間', hard: '負担の大きい区間', showRoute: '実際の経路を見る', loading: '経路を検索中…', none: 'この日の公共交通ルートを見つけられませんでした。', openNaver: 'NAVERマップ', naverCapped: `NAVERマップは1ルートにつき${NAVER_DIRECTIONS_MAX_STOPS}か所まで案内できます。最初の${NAVER_DIRECTIONS_MAX_STOPS}か所を表示します。` };
    case 'zh': return { title: '今日路线', easy: '轻松路段', hard: '较累路段', showRoute: '查看实际路线', loading: '正在查找路线…', none: '未找到当天的公共交通路线。', openNaver: 'NAVER地图', naverCapped: `NAVER地图每条路线最多支持${NAVER_DIRECTIONS_MAX_STOPS}个地点。现显示前${NAVER_DIRECTIONS_MAX_STOPS}个。` };
    default: return { title: "Today's route", easy: 'Easy', hard: 'Challenging', showRoute: 'Show transit route', loading: 'Finding route…', none: 'No transit route was found for this day.', openNaver: 'Naver Map', naverCapped: `Naver Map supports up to ${NAVER_DIRECTIONS_MAX_STOPS} places per route. Showing the first ${NAVER_DIRECTIONS_MAX_STOPS}.` };
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
  const labels = mapLabels(language);
  const points = toMapPoints(stops);
  const enoughPoints = points.length >= 2;
  // (2026-07-19) 구형 플랜 구제 — 저장된 경로가 없으면 버튼으로 course-route 를 불러
  // 지도만 실경로로 바꾼다. Firestore 는 건드리지 않는다(읽기 전용 개선).
  // 응답의 segment.to = points 인덱스 → 구간별로 꽂아 폴백 로직을 그대로 태운다.
  const [fetchedLegs, setFetchedLegs] = useState<Record<number, TransitStepLike[]>>({});
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeMsg, setRouteMsg] = useState<string | null>(null);

  const routePoints: RoutePoint[] = points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    legSteps: p.legSteps?.length ? p.legSteps : fetchedLegs[i],
    legHard: p.hard,
  }));
  const { segments, realLegs } = pointsToSegments(routePoints);
  const canFetchRoute = realLegs === 0 && enoughPoints;

  const fetchRoute = async () => {
    setRouteBusy(true);
    setRouteMsg(null);
    try {
      const res = await fetch('/api/course-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops: points.map((p) => ({ lat: p.lat, lng: p.lng, name: p.label })) }),
      });
      const json = await res.json().catch(() => null);
      const legs: Record<number, TransitStepLike[]> = {};
      for (const s of (Array.isArray(json?.segments) ? json.segments : []) as Array<{ to?: number; steps_detail?: TransitStepLike[] }>) {
        if (typeof s?.to === 'number' && Array.isArray(s.steps_detail)) legs[s.to] = s.steps_detail;
      }
      setFetchedLegs(legs);
      if (!Object.keys(legs).length) setRouteMsg(labels.none);
    } catch {
      setRouteMsg(labels.none);
    } finally {
      setRouteBusy(false);
    }
  };

  // 네이버 지도 딥링크 — 하루 동선을 경유지로 묶어 앱/웹에서 연다.
  // 네이버는 경유지를 **자동차 길찾기에서만** 지원한다(대중교통 길찾기는 2점만) → mode='car'.
  const naverCapped = points.length > NAVER_DIRECTIONS_MAX_STOPS;
  const naverUrl = naverMapDirectionsUrl(
    points.slice(0, NAVER_DIRECTIONS_MAX_STOPS).map((p) => ({ lat: p.lat, lng: p.lng, name: p.label })),
  );
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
        // 노선 공식 색을 쓴다. (2026-07-28) 좌표 없는 구간(도보 등)은 pointsToSegments 가
        // 이미 직선 세그먼트로 메워 넘겨준다 — 여기선 분기 없이 전부 그리기만 한다.
        {
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
                  `<div style="font-size:12px;color:var(--ec-text-primary);"><b>${escapeHtml(seg.label || '')}</b><br/>` +
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
        }

        // Numbered markers (1, 2, 3 … in visit order).
        points.forEach((p) => {
          const icon = L.divIcon({
            className: 'cocotrip-route-pin',
            html:
              `<div style="` +
              `width:26px;height:26px;border-radius:50%;` +
              `display:flex;align-items:center;justify-content:center;` +
              `background:var(--ec-brand);` +
              `color:var(--ec-text-on-brand);font-size:12px;font-weight:800;` +
              `border:2px solid var(--ec-surface-raised);` +
              `box-shadow:0 2px 6px rgba(0,0,0,0.5);` +
              `">${p.order}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -14],
          });
          const safeLabel = escapeHtml(p.label || `#${p.order}`);
          const timeHtml = p.time
            ? `<div style="color:var(--ec-brand);font-size:11px;margin-top:2px;">${escapeHtml(p.time)}</div>`
            : '';
          L.marker([p.lat, p.lng], { icon, title: p.label })
            .addTo(map)
            .bindPopup(
              `<div style="font-weight:700;font-size:13px;color:var(--ec-text-primary);">` +
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

  // 힘든 구간이 하나라도 있을 때만 범례 노출(전부 쉬우면 단일 스타일이라 불필요).
  const hasHard = points.some((p) => p.hard);

  return (
    <section className="mb-6" data-testid="day-route-map" aria-labelledby={`day-route-title-${domId}`}>
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <MapIcon className="h-4 w-4 text-ec-brand" aria-hidden />
        <h3 id={`day-route-title-${domId}`} className="ec-eyebrow text-ec-brand">
          {labels.title}
        </h3>
        {/* (2026-07-19) 구형 플랜 구제 — 저장된 실경로가 없을 때만 노출.
            누르면 course-route 로 실제 대중교통 경로를 받아 지도를 갈아끼운다.
            Firestore 는 수정하지 않는다(이 화면 한정 개선). 자동 호출 안 함 = 비용 방어. */}
        <div className="ml-auto flex items-center gap-1.5">
          {canFetchRoute && (
            <button
              type="button"
              data-route-map-control
              onClick={() => { void fetchRoute(); }}
              disabled={routeBusy}
              className="ec-btn ec-btn-secondary min-h-[44px] px-3 text-[12px] disabled:opacity-50"
            >
              {routeBusy ? labels.loading : labels.showRoute}
            </button>
          )}
          {/* (2026-07-28) 하루 동선을 네이버 지도로 — 핀 여러 개 + 경유 동선.
              네이버는 경유지를 자동차 길찾기에서만 지원한다(대중교통은 2점 전용). */}
          {naverUrl && (
            <a
              href={naverUrl}
              data-route-map-control
              target="_blank"
              rel="noopener noreferrer"
              className="ec-btn ec-btn-secondary min-h-[44px] px-3 text-[12px] text-ec-success"
            >
              {labels.openNaver}
            </a>
          )}
        </div>
      </div>
      <div
        className="relative overflow-hidden rounded-ec-md border border-ec-line bg-ec-raised"
      >
        <div
          id={`day-route-map-${domId}`}
          ref={containerRef}
          className="w-full"
          style={{ height: 240, zIndex: 0 }}
        />
      </div>
      {routeMsg && <p className="mt-2 px-0.5 text-[12px] text-ec-ink-2">{routeMsg}</p>}
      {/* 잘라낸 사실을 숨기지 않는다 — 네이버 경유지 상한을 넘긴 날은 명시. */}
      {naverCapped && naverUrl && (
        <p className="mt-2 px-0.5 text-[12px] text-ec-ink-3">{labels.naverCapped}</p>
      )}
      {/* 지도 범례 (가이드 P5) — 실선=쉬운 이동 / 점선=힘든 대중교통 구간(routeInsight 실판정). 힘든 구간 있을 때만. */}
      {hasHard && (
        <div className="mt-2 flex items-center gap-4 px-0.5 text-[12px] text-ec-ink-2">
          <span className="flex items-center gap-1.5">
            <span style={{ width: 18, height: 0, borderTop: '3px solid var(--ec-brand)', borderRadius: 2 }} aria-hidden />
            {labels.easy}
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 18, height: 0, borderTop: '3px dashed var(--ec-notice)' }} aria-hidden />
            {labels.hard}
          </span>
        </div>
      )}
      {/* 번호 정거장 리스트 (가이드 P4) — 지도 핀 번호(order)와 1:1 매칭. toMapPoints 재사용(좌표 없는 stop 은 자동 skip). */}
      <ol className="mt-2 space-y-1">
        {points.map((p) => (
          <li
            key={p.order}
            className="flex min-h-[40px] items-center gap-2.5 border-b border-ec-line px-2 py-2 last:border-b-0"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ec-brand text-[11px] font-bold text-ec-on-brand"
            >
              {p.order}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ec-ink">{p.label}</span>
            {p.time && <span className="ec-figure shrink-0 text-[12px] text-ec-ink-3">{p.time}</span>}
          </li>
        ))}
      </ol>
    </section>
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
