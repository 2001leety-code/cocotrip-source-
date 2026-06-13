/**
 * Naver Maps JS v3 (NCP) — lazy 로더 + 지오코딩 헬퍼.
 *
 * MOOD 경로 미니맵(주소 맞는지 시각 확인)용. 스크립트는 최초 호출 시 1회 로드.
 *
 * 스크립트: https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=<ID>&submodules=geocoder
 *   - ncpClientId = NCP Application 의 Client ID(공개값, Referer 허용목록으로 보호).
 *     Web 서비스 URL 허용목록에 cocotripkr.com/mood + *.vercel.app 등록돼 있어야 로드됨.
 *   - 클라이언트 ID 미설정(VITE_NCP_MAP_CLIENT_ID 없음) 시 호출부가 링크 폴백으로 우아하게 저하.
 */

interface NaverLatLng { lat(): number; lng(): number; }
interface NaverMapsService {
  geocode(
    opts: { query: string },
    cb: (status: string, res: { v2?: { addresses?: Array<{ x: string; y: string }> } }) => void,
  ): void;
  Status: { OK: string };
}
interface NaverMapsNamespace {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => unknown;
  Marker: new (opts: Record<string, unknown>) => unknown;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  LatLngBounds: new () => { extend(c: NaverLatLng): void };
  Service: NaverMapsService;
}
type NaverGlobal = { maps: NaverMapsNamespace };

export function getNaver(): NaverGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { naver?: NaverGlobal }).naver;
}

let loadPromise: Promise<NaverGlobal> | null = null;

export function loadNaverMaps(clientId: string): Promise<NaverGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const existing = getNaver();
  if (existing?.maps?.Service) return Promise.resolve(existing);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<NaverGlobal>((resolve, reject) => {
    const src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${encodeURIComponent(clientId)}&submodules=geocoder`;
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      // geocoder 서브모듈까지 준비됐는지 확인 (간헐적으로 maps 만 먼저 뜨는 케이스 가드).
      const n = getNaver();
      if (n?.maps?.Service) resolve(n);
      else { loadPromise = null; reject(new Error('naver.maps.Service 미로드')); }
    };
    s.onerror = () => { loadPromise = null; reject(new Error('Naver Maps 스크립트 로드 실패')); };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/** 주소/장소명 → { lat, lng } | null (실패·결과없음). */
export function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  const n = getNaver();
  const q = String(query || '').trim();
  if (!n?.maps?.Service || !q) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      n.maps.Service.geocode({ query: q }, (status, res) => {
        const addr = status === n.maps.Service.Status.OK ? res?.v2?.addresses?.[0] : null;
        if (addr && addr.x && addr.y) resolve({ lat: parseFloat(addr.y), lng: parseFloat(addr.x) });
        else resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** 네이버 지도 검색 딥링크 (키 불필요 폴백). 새 탭에서 주소 확인. */
export function naverMapSearchUrl(query: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(String(query || '').trim())}`;
}
