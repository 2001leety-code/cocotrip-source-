/**
 * MOOD 경로 스냅샷 코덱 — Firestore 저장형 ↔ 공개 API 형 (2026-08-13 핫픽스).
 *
 * 🔴 왜 있는가 (prod 장애 2026-08-13 11:13~11:15 KST, POST /api/mood-book 500 ×4):
 *   `3 INVALID_ARGUMENT: Property routeSnapshot contains an invalid nested entity.`
 *   computeRoute 는 폴리라인을 `[[lng,lat], ...]` 로 준다. **Firestore 는 배열 안에
 *   배열을 저장하지 못한다** — 트랜잭션 commit 이 통째로 깨져 예약 생성도 잔액 차감도
 *   되지 않았다(다행히 돈은 안 나갔다). mood-book·mood-change·mood-settle 세 곳이
 *   같은 compactPath 를 복붙해 쓰고 있어 셋 다 같은 결함이었다.
 *
 * ⇒ 저장형(canonical) = `[{ lng, lat }, ...]` (평범한 map 배열 — 중첩 배열 없음).
 *   공개 API 형 = 기존 그대로 `[[lng,lat], ...]` (프론트 지도/공유 카드 계약 불변).
 *   변환은 이 파일이 SSOT. 새 쓰기 경로는 반드시 buildRouteSnapshot 을 쓸 것.
 *
 * 🔴 디코드는 **Firestore 저장이 끝난 뒤 HTTP 경계에서만** 한다. mood-change 는
 *   저장용 응답을 멱등 doc 에 넣고, 전송할 복사본만 공개형으로 바꾼다. 저장 전에
 *   공개형으로 바꾸면 중첩 배열이 다시 Firestore 로 들어가 같은 장애가 난다.
 *
 * 잠금 테스트: tests/unit/mood-route-snapshot.test.ts
 */

/** 폴리라인 저장 상한 — 원본 그대로 넣으면 doc 이 비대해진다(기존 의도 유지). */
export const ROUTE_PATH_LIMIT = 600;

/** 좌표 유효성 — 유한수 + 실제 위경도 범위. (위경도 뒤바뀐 데이터도 대부분 여기서 걸린다.) */
function isCoord(lng, lat) {
  return typeof lng === 'number' && typeof lat === 'number'
    && Number.isFinite(lng) && Number.isFinite(lat)
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
}

function isNonNegativeFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** 원본 path 를 limit 개로 균등 샘플링 (기존 compactPath 와 동일 알고리즘). */
function compact(path, limit) {
  if (path.length <= limit) return path;
  const step = (path.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => path[Math.round(index * step)]);
}

/**
 * 한 점 읽기 — 공개형 `[lng,lat]` / 저장형 `{lng,lat}` 둘 다 받는다.
 * 좌표가 아니면 null (호출자가 통째로 버린다).
 */
function readPoint(entry) {
  if (Array.isArray(entry)) {
    if (entry.length !== 2) return null;
    const lng = entry[0];
    const lat = entry[1];
    return isCoord(lng, lat) ? { lng, lat } : null;
  }
  if (entry && typeof entry === 'object') {
    const lng = entry.lng;
    const lat = entry.lat;
    return isCoord(lng, lat) ? { lng, lat } : null;
  }
  return null;
}

const ROUTE_POINT_ROLES = new Set(['origin', 'waypoint', 'destination']);

/** 마커도 화이트리스트 map 배열로 다시 만들어 예상 밖 중첩 배열·undefined 저장을 막는다. */
export function encodeRoutePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const encoded = [];
  for (const entry of points) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    if (!isCoord(entry.lng, entry.lat) || !ROUTE_POINT_ROLES.has(entry.role)) return [];
    if (entry.role === 'waypoint' && (!Number.isSafeInteger(entry.index) || entry.index < 0)) return [];
    encoded.push({
      lat: entry.lat,
      lng: entry.lng,
      role: entry.role,
      ...(entry.role === 'waypoint' ? { index: entry.index } : {}),
    });
  }
  return encoded;
}

/**
 * 쓰기 코덱 — 어떤 입력이 와도 Firestore 안전한 `[{lng,lat}]` 로만 저장한다.
 *
 * 🟡 한 점이라도 깨져 있으면 **경로 전체를 버린다**(부분 저장 금지). 중간 점을
 *   건너뛴 선은 실제로 가지 않은 지름길을 그려 운영자에게 거짓 동선을 보여준다.
 *   빈 배열이면 프론트가 /api/mood-route 로 다시 그린다(기존 폴백 경로).
 *   경로는 표시 전용이라 금액(km·톨비는 Naver summary)엔 영향이 없다.
 */
export function encodeRoutePath(path, limit = ROUTE_PATH_LIMIT) {
  if (!Array.isArray(path) || path.length === 0) return [];
  const encoded = [];
  for (const entry of path) {
    const point = readPoint(entry);
    if (!point) return [];
    encoded.push({ lng: point.lng, lat: point.lat });
  }
  return compact(encoded, limit);
}

/**
 * 읽기 코덱 — 저장형 → 공개 API 형 `[[lng,lat], ...]`.
 * 구 데이터가 이미 공개형(쌍 배열)이어도 그대로 통과시킨다.
 * 손상된 값은 조용히 다른 좌표로 둔갑시키지 않고 경로 전체를 버린다.
 */
export function decodeRoutePath(stored) {
  if (!Array.isArray(stored) || stored.length === 0) return [];
  const decoded = [];
  for (const entry of stored) {
    const point = readPoint(entry);
    if (!point) return [];
    decoded.push([point.lng, point.lat]);
  }
  return decoded;
}

/**
 * 세 쓰기 경로(mood-book / mood-change / mood-settle) 공통 스냅샷 빌더.
 * 호출 전에 각 핸들러가 이미 route 를 검증하므로 clamp 는 방어용(값 변화 없음).
 */
export function buildRouteSnapshot(route, calculatedAt = Date.now()) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) {
    throw new TypeError('INVALID_ROUTE_SNAPSHOT');
  }
  if (
    !isNonNegativeFinite(route.km)
    || !isNonNegativeSafeInteger(route.tollKRW)
    || !isNonNegativeFinite(route.durationMin)
    || !Number.isSafeInteger(calculatedAt)
    || calculatedAt < 0
  ) {
    throw new TypeError('INVALID_ROUTE_SNAPSHOT');
  }
  return {
    km: route.km,
    tollKRW: route.tollKRW,
    durationMin: route.durationMin,
    path: encodeRoutePath(route.path),
    points: encodeRoutePoints(route.points),
    calculatedAt,
  };
}

/** HTTP 읽기 경계 — 저장된 스냅샷을 공개 계약으로 되돌린다. 없거나 손상되면 null. */
export function decodeRouteSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  if (
    !isNonNegativeFinite(snapshot.km)
    || !isNonNegativeSafeInteger(snapshot.tollKRW)
    || !isNonNegativeFinite(snapshot.durationMin)
    || !Number.isSafeInteger(snapshot.calculatedAt)
    || snapshot.calculatedAt < 0
    || !Array.isArray(snapshot.path)
    || !Array.isArray(snapshot.points)
  ) return null;
  const path = decodeRoutePath(snapshot.path);
  if (snapshot.path.length > 0 && path.length === 0) return null;
  const points = encodeRoutePoints(snapshot.points);
  if (snapshot.points.length > 0 && points.length === 0) return null;
  return {
    km: snapshot.km,
    tollKRW: snapshot.tollKRW,
    durationMin: snapshot.durationMin,
    path,
    points,
    calculatedAt: snapshot.calculatedAt,
  };
}
