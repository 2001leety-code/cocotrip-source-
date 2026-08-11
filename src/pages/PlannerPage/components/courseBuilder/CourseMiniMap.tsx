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
import { pointsToSegments, type RoutePoint, type TransitStepLike } from '@/lib/routeSegments';

interface NearbyPlace { name: string; lat?: number; lng?: number; category?: string; reason?: string; }

interface CourseMiniMapProps {
  stops: CourseStop[];
  title: string; // 지도 헤더 라벨 (i18n 은 호출처가 넘김)
  nearby?: NearbyPlace[]; // AI 주변추천 — 코스 핀과 다른 색 마커로 "가볼만한 곳" 표시
  /** /api/course-route 응답의 segments — 있으면 실경로(노선색·승차핀·수단칩)로 그린다.
   *  `to` = 도착 지점 인덱스. 좌표가 없는 구간(도보 등)은 직선으로 메워진다. */
  routeSegments?: { to?: number; steps_detail?: TransitStepLike[] }[];
}

interface MapPoint { lat: number; lng: number; order: number; label: string; time?: string; }
interface NearbyPoint { lat: number; lng: number; name: string; category?: string; reason?: string; }

// 카테고리별 이모지(주변 마커 안에 표시).
const CAT_EMOJI: Record<string, string> = { food: '🍽', sight: '📷', show: '🎫', stay: '🛏', etc: '📍' };

/** 좌표 유효한 주변추천만. */
function toNearbyPoints(list: NearbyPlace[] | undefined): NearbyPoint[] {
  const out: NearbyPoint[] = [];
  for (const p of list || []) {
    if (!isFiniteNum(p.lat) || !isFiniteNum(p.lng)) continue;
    if ((p.lat as number) < -90 || (p.lat as number) > 90 || (p.lng as number) < -180 || (p.lng as number) > 180) continue;
    out.push({ lat: p.lat as number, lng: p.lng as number, name: p.name || '', category: p.category, reason: p.reason });
  }
  return out;
}

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

/** 팝업/hover title HTML — 마커 생성과 라벨/시간 갱신이 같은 문구를 쓰도록 단일 소스.
 *  Leaflet 팝업 말풍선은 leaflet.css 가 항상 흰 배경으로 그린다(페이지 테마와 무관) — 그래서
 *  이 안의 글자색은 리터럴 hex/var()로 남는다(지도 컴포넌트 예외). 브랜드색은 --ec-brand-hover
 *  변수를 그대로 참조해 토큰이 바뀌면 여기도 같이 바뀐다. */
function popupHtml(p: MapPoint): string {
  const timeHtml = p.time ? `<div style="color:var(--ec-brand-hover);font-size:11px;margin-top:2px;">${escapeHtml(p.time)}</div>` : '';
  return `<div style="font-weight:700;font-size:13px;color:#1a1024;">${p.order}. ${escapeHtml(p.label || `#${p.order}`)}</div>${timeHtml}`;
}

export function CourseMiniMap({ stops, title, nearby, routeSegments }: CourseMiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const domId = useId().replace(/[:]/g, '');
  const [failed, setFailed] = useState(false);
  // 방문순서(order) → Leaflet marker. 좌표/순서 불변인 제목·시간 편집 시 지도 전체를
  // 재구성(타일 refetch flicker)하지 않고 이 ref 로 팝업/title 만 갱신하려고 보관.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<number, any>>(new Map());

  const points = toMapPoints(stops);
  const nearbyPoints = toNearbyPoints(nearby);
  const enoughPoints = points.length >= 2;
  // 실경로 세그먼트(플랜 상세와 동일 변환·폴백 — src/lib/routeSegments).
  // (2026-07-28) 좌표 없는 구간(도보 등)은 직선으로 메운다 — 이전에는 실경로가 하나라도
  // 있으면 그것만 그려서 도보 구간이 지도에서 통째로 사라졌다.
  const legSteps: Record<number, TransitStepLike[]> = {};
  for (const s of routeSegments || []) {
    if (typeof s?.to === 'number' && Array.isArray(s.steps_detail)) legSteps[s.to] = s.steps_detail;
  }
  const routePoints: RoutePoint[] = points.map((p, i) => ({ lat: p.lat, lng: p.lng, legSteps: legSteps[i] }));
  const { segments } = pointsToSegments(routePoints);
  const segmentsKey = `${segments.length}:${segments.reduce((n, s) => n + s.path.length, 0)}`;

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

        // voyager = 밝은 컬러 타일(주변 상점·지명 보임). dark_all 은 너무 어두워 핀·동선 안 보였음.
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          subdomains: 'abcd', maxZoom: 20,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        }).addTo(map);

        // (2026-07-19) 실경로 우선 — /api/course-route 가 준 TMAP 좌표가 있으면
        // 도로·철도를 따라 노선 공식 색으로 그린다. (2026-07-28) 좌표 없는 구간은
        // pointsToSegments 가 이미 직선으로 메워 넘겨준다 — 여기선 그리기만.
        {
          for (const seg of segments) {
            L.polyline(seg.path, {
              color: seg.color,
              weight: seg.dashed ? 3 : 5,
              opacity: seg.dashed ? 0.75 : 0.9,
              lineJoin: 'round', lineCap: 'round',
              ...(seg.dashed ? { dashArray: '4, 8' } : {}),
            }).addTo(map);
            if (seg.board) {
              L.marker([seg.board.lat, seg.board.lng], {
                icon: L.divIcon({
                  className: 'cocotrip-board-pin',
                  html: `<div style="width:11px;height:11px;border-radius:50%;background:#fff;border:3px solid ${seg.color};box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
                  iconSize: [11, 11], iconAnchor: [5.5, 5.5],
                }),
                title: seg.board.name, zIndexOffset: -100,
              }).addTo(map).bindPopup(
                `<div style="font-size:12px;color:#1a1024;"><b>${escapeHtml(seg.label || '')}</b><br/>${escapeHtml(seg.board.name)}</div>`,
                { closeButton: true },
              );
            }
            if (seg.label && seg.path.length >= 2) {
              const mid = seg.path[Math.floor(seg.path.length / 2)];
              const chipW = seg.label.length * 7 + 20;
              L.marker(mid, {
                icon: L.divIcon({
                  className: 'cocotrip-mode-chip',
                  html: `<div style="white-space:nowrap;padding:3px 8px;border-radius:999px;background:${seg.color};color:#fff;font-size:10px;font-weight:800;line-height:1.1;text-align:center;border:1.5px solid rgba(255,255,255,0.95);box-shadow:0 2px 6px rgba(0,0,0,0.35);">${escapeHtml(seg.label)}</div>`,
                  iconSize: [chipW, 18], iconAnchor: [chipW / 2, 26],
                }),
                interactive: false, zIndexOffset: 200,
              }).addTo(map);
            }
          }
        }

        markersRef.current.clear();
        points.forEach((p) => {
          // 코스 번호핀 — 예전엔 보라→핑크 그라디언트였다. Korea Editorial Concierge 는 액센트가
          // 하나(브랜드 보라)뿐이라 평면 채움으로 바꾼다. var() 는 이 div 가 실제 document 에
          // 붙으므로 :root 값을 정상 상속받는다(지도 컴포넌트 예외 — 그라디언트만 제거, 마커
          // 색 자체는 여기서만 리터럴/변수 사용 허용).
          const icon = L.divIcon({
            className: 'cocotrip-course-pin',
            html: `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--ec-brand);color:#fff;font-size:12px;font-weight:800;border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 6px rgba(0,0,0,0.5);">${p.order}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
          });
          const marker = L.marker([p.lat, p.lng], { icon, title: p.label })
            .addTo(map)
            .bindPopup(popupHtml(p), { closeButton: true });
          markersRef.current.set(p.order, marker);
        });

        // 주변추천 마커 — 코스 번호핀(브랜드 보라 원)과 구분되는 앰버 물방울핀 + 카테고리 이모지.
        // "가볼만한 곳"을 지도에서 바로 보이게. 좌표는 course-ai 응답(nearby)에서.
        // 앰버는 --ec-notice 토큰 그대로(지도 예외 — var() 는 실제 document 에 붙어 정상 상속).
        nearbyPoints.forEach((p) => {
          const emoji = CAT_EMOJI[p.category || 'etc'] || CAT_EMOJI.etc;
          const icon = L.divIcon({
            className: 'cocotrip-nearby-pin',
            html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;background:var(--ec-notice);border:2px solid rgba(255,255,255,0.92);box-shadow:0 2px 5px rgba(0,0,0,0.4);"><span style="transform:rotate(45deg);font-size:11px;line-height:1;">${emoji}</span></div>`,
            iconSize: [24, 24], iconAnchor: [12, 22], popupAnchor: [0, -18],
          });
          const reasonHtml = p.reason ? `<div style="color:var(--ec-notice);font-size:11px;margin-top:2px;">${escapeHtml(p.reason)}</div>` : '';
          const html = `<div style="font-weight:700;font-size:12px;color:#1a1024;">${escapeHtml(p.name || '')}</div>${reasonHtml}`;
          L.marker([p.lat, p.lng], { icon, title: p.name }).addTo(map).bindPopup(html, { closeButton: true });
        });

        // 실경로가 있으면 경로 좌표까지 포함해야 노선이 화면 밖으로 잘리지 않는다.
        const bounds = L.latLngBounds(latLngs);
        for (const seg of segments) for (const pt of seg.path) bounds.extend(pt);
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
        setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 0);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      markersRef.current.clear();
      if (mapInstance) { try { mapInstance.remove(); } catch { /* disposed */ } mapInstance = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enoughPoints, JSON.stringify(points.map((p) => [p.lat, p.lng, p.order])), JSON.stringify(nearbyPoints.map((p) => [p.lat, p.lng])), segmentsKey]);

  // 제목/시간만 바뀐 경우(좌표·순서 불변 → 위 effect 미실행) 지도 재구성 없이 팝업·hover
  // title 텍스트만 갱신 → 편집 중 타일 refetch flicker 없이 stale 표시 방지.
  useEffect(() => {
    for (const p of points) {
      const m = markersRef.current.get(p.order);
      if (!m) continue;
      try {
        m.setPopupContent(popupHtml(p));
        const el = typeof m.getElement === 'function' ? m.getElement() : null;
        if (el) el.setAttribute('title', p.label || `#${p.order}`);
      } catch { /* marker disposed mid-rebuild — 다음 렌더에 반영 */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points.map((p) => [p.order, p.label, p.time]))]);

  if (!enoughPoints || failed) return null;

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center gap-1.5 px-0.5">
        <MapIcon className="h-3.5 w-3.5 text-ec-brand" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-ec-brand">{title}</span>
      </div>
      <div className="relative overflow-hidden rounded-ec-md border border-ec-line bg-ec-sunken">
        <div id={`course-mini-map-${domId}`} ref={containerRef} className="w-full" style={{ height: 220, zIndex: 0 }} />
      </div>
    </div>
  );
}
