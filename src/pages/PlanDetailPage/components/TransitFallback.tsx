// 2026-05-10 (B10-4 part 2 phase 1): transit_from_prev 가 backend (RouteAgent) 에서
// attach 안 된 stops 사이의 fallback UI. 농어촌 / 부산 시외 / ODsay null 케이스 silent
// skip 회피.
//
// 흐름:
//   - 거리 < 2km → 도보 약 X분 또는 택시 권장 (한국 택시 기본료 ~₩4,800 안내)
//   - 거리 ≥ 2km → "네이버 지도에서 길찾기" deep link (transit 모드)
//   - 좌표 둘 다 없으면 → 컴포넌트 자체 미렌더 (silent)
//
// 향후 phase 2: backend 에 Tmap API 통합으로 step-by-step 진짜 표시 (별도 PR).
import { Footprints, MapPin, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  prevLat?: number | null;
  prevLng?: number | null;
  prevName?: string;
  currLat?: number | null;
  currLng?: number | null;
  currName?: string;
}

/** Haversine distance in km between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Naver 지도 directions deep link with transit mode preselected. */
function buildNaverTransitUrl(
  sLat: number, sLng: number, sName: string,
  eLat: number, eLng: number, eName: string,
): string {
  const enc = encodeURIComponent;
  // map.naver.com/v5/directions/<sX,sY,sName,id,type>/<eX,eY,...>/-/transit
  // sName/eName 한글 OK (encodeURIComponent).
  return `https://map.naver.com/v5/directions/${sLng},${sLat},${enc(sName)}/${eLng},${eLat},${enc(eName)}/-/transit?c=15`;
}

export function TransitFallback({
  prevLat, prevLng, prevName,
  currLat, currLng, currName,
}: Props) {
  const { t } = useLanguage();
  // i18n keys live under t.planner namespace (same as wizard / hotel labels).
  const tr = ((t as unknown) as { planner?: Record<string, string | undefined> }).planner || {};

  // 좌표 둘 다 있어야 거리 계산 + Naver link 빌드 가능. 하나라도 null 이면 silent.
  if (prevLat == null || prevLng == null || currLat == null || currLng == null) return null;

  const distKm = haversineKm(prevLat, prevLng, currLat, currLng);
  const distM = Math.round(distKm * 1000);

  // 거리 < 2km → 도보/택시 권장. ~70m/분 보행 속도, 택시 기본료 ₩4,800 + 거리당 추가
  // 한국 표준 택시 (1.6km 까지 기본 ₩4,800, 132m 당 ₩100 추가).
  if (distKm < 2) {
    const walkMin = Math.max(3, Math.round(distM / 70));
    const taxiKRW = 4800 + Math.max(0, Math.ceil((distM - 1600) / 132)) * 100;
    return (
      <div className="my-2 ml-4 flex items-center gap-2 border-l-2 border-ec-notice bg-ec-sunken px-3 py-2.5">
        <Footprints className="h-3.5 w-3.5 shrink-0 text-ec-notice" aria-hidden />
        <p className="text-[12px] leading-relaxed text-ec-ink-2">
          {(tr.transitFallbackWalkOrTaxi || '~{walk}min walk · or taxi ~₩{taxi} ({dist}m)')
            .replace('{walk}', String(walkMin))
            .replace('{taxi}', taxiKRW.toLocaleString('ko-KR'))
            .replace('{dist}', String(distM))}
        </p>
      </div>
    );
  }

  // 거리 ≥ 2km → 네이버 지도 길찾기 link
  const naverUrl = buildNaverTransitUrl(
    prevLat, prevLng, prevName || '',
    currLat, currLng, currName || '',
  );
  return (
    <div className="my-2 ml-4">
      <a
        href={naverUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ec-btn ec-btn-secondary inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[12px] text-ec-success"
      >
        <MapPin className="w-3 h-3" />
        <span>{(tr.transitFallbackNaverLink || 'View transit on Naver Map · {dist}km').replace('{dist}', distKm.toFixed(1))}</span>
        <ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </a>
    </div>
  );
}
