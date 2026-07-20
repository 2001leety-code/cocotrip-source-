// ─────────────────────────────────────────────────────────────────────────────
// placeSearch.ts — `/api/place-search`(네이버 지역검색) 공용 클라이언트 + 결과 정렬.
//
// 원래 charter/AddressAutocomplete 안에만 있던 로직을 꺼냈다. 어드민 상품등록(투어 stop
// 좌표 채우기)도 같은 검색을 쓰는데, AddressAutocomplete 은 차터 위저드 전용 다크 UI 이고
// 확인 카드에서 **네이버 Maps JS SDK(유료)** 를 로드한다. 어드민에 그대로 재사용하면
// 테마도 깨지고 지도 과금도 붙어서, 검색 부분만 공유하고 UI 는 각자 만든다.
//
// ⚠️ 네이버 지역검색은 **업소 디렉터리**다. 랜드마크 이름을 넣으면 동명 상점이 먼저 나올 수
//    있다("경복궁" → 사당동 한정식집). rankByQueryMatch 가 순서를 보정하지만 완벽하지 않으니
//    최종 선택은 사람이 한다.
// ─────────────────────────────────────────────────────────────────────────────

/** `/api/place-search` 응답 item 의 공통 부분 (번역 필드는 호출부에서 확장). */
export interface PlaceSearchItem {
  name: string;
  address: string;
  roadAddress: string;
  category: string;
  tel: string;
  lat: number;
  lng: number;
  /** 외국어 응답일 때 보존되는 한글 원문 (lang='ko' 면 없음). */
  originalName?: string;
}

/**
 * 결과 재정렬 — Naver Local Search 가 가끔 엉뚱한 첫 결과(예: "Seoul Station" → 인근 EV충전소)를
 * 반환한다. 쿼리 구문이 이름/원문에 포함된 결과를 앞으로 **안정 정렬**한다. 결과를 버리거나 좌표를
 * 바꾸지 않고 순서만 개선 — 사용자는 여전히 전체 후보에서 최종 선택.
 * 차터 출발/도착/경유·MOOD·어드민 stop 좌표 공용.
 */
export function rankByQueryMatch<T extends PlaceSearchItem>(items: T[], query: string): T[] {
  const q = (query || '').trim().toLowerCase();
  if (!q || items.length < 2) return items;
  const score = (it: T): number => {
    const name = (it.name || '').toLowerCase();
    const orig = (it.originalName || '').toLowerCase();
    const addr = (it.roadAddress || it.address || '').toLowerCase();
    if (name.includes(q) || orig.includes(q)) return 0; // 이름에 쿼리 구문 포함 = 최우선
    if (addr.includes(q)) return 1;                      // 주소 포함 = 차선
    return 2;                                            // 그 외 = Naver 원래 순서 유지
  };
  return items
    .map((it, i) => ({ it, i, s: score(it) }))
    .sort((a, b) => (a.s - b.s) || (a.i - b.i)) // 동점은 원래 순서 유지(stable)
    .map((o) => o.it);
}

/**
 * 투어 stop 이름 → 검색어 정리.
 * "점심 — 마늘정식", "12:30 점심(삼계탕)" 같은 일정 표기는 그대로 넣으면 검색이 안 된다.
 * 시간·구분자·괄호를 털어 실제 장소명만 남긴다. 그래도 식당 미지정 stop 은 결과가 엉뚱할 수
 * 있으므로 최종 판단은 운영자가 한다(자동 확정하지 않는다).
 */
export function toPlaceQuery(rawName: string): string {
  return (rawName || '')
    .replace(/^\s*\d{1,2}:\d{2}\s*/, '')      // 앞머리 "09:30 "
    .replace(/\s*[—–\-−]\s*/g, ' ')            // 대시류 구분자 → 공백
    .replace(/[()[\]]/g, ' ')                  // 괄호 제거
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PlaceSearchResult {
  items: PlaceSearchItem[];
  error?: 'REQUEST_FAILED';
}

/**
 * `/api/place-search` 호출 + 정렬까지. 실패해도 throw 하지 않고 빈 목록 + error 를 돌려준다
 * (어드민 편집 중 검색 실패가 폼 전체를 죽이면 안 된다).
 */
export async function searchPlaces(
  query: string,
  opts: { limit?: number; lang?: 'ko' | 'en' | 'ja' | 'zh'; signal?: AbortSignal } = {},
): Promise<PlaceSearchResult> {
  const q = query.trim();
  if (q.length < 2) return { items: [] };
  const { limit = 5, lang = 'ko', signal } = opts;
  const url = `/api/place-search?query=${encodeURIComponent(q)}&limit=${limit}&lang=${lang}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      console.warn('[placeSearch] api error', res.status);
      return { items: [], error: 'REQUEST_FAILED' };
    }
    const data = await res.json();
    const items: PlaceSearchItem[] = Array.isArray(data?.items) ? data.items : [];
    return { items: rankByQueryMatch(items, q) };
  } catch (e) {
    if (signal?.aborted) return { items: [] };
    console.error('[placeSearch] fetch err:', e);
    return { items: [], error: 'REQUEST_FAILED' };
  }
}
