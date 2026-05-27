/**
 * transitCache.js — zone_courses Firestore transit_matrix DB 캐시 조회 (Phase 3, 2026-05-27).
 *
 * 운영자 의도: ODsay 매번 호출 대신 DB 에서 복붙 = 빠르고 안정.
 *
 * 동작:
 *   1. RouteAgent._getTransitData() 호출 전 lookupTransitCache(zoneId, fromOrder, toOrder) 로 확인.
 *   2. Firestore zone_courses/{zoneId}.transit_matrix 에 source='odsay_api' 인 real 데이터 있으면
 *      formatCacheHit() 로 ODsay 호환 publicTransit 객체 반환.
 *   3. miss 또는 source='mock' 이면 null 반환 → 기존 ODsay 실측 경로 진행.
 *
 * 캐시 전략:
 *   - in-memory LRU (Map, 최대 50 zone): Vercel serverless warm instance 재사용 최적화.
 *     cold start 시 첫 plan 에서 Firestore 조회 → 이후 같은 instance plan 들 100% hit.
 *   - TTL 없음 (zone_courses 변경 빈도 낮음 — 운영자 재시드 시 새 instance 자동 갱신).
 *
 * 안전망:
 *   - Firestore 실패 → null 반환 (ODsay 폴백 보장, plan 깨지지 않음).
 *   - mock 데이터 (source='mock') → miss 처리 (품질 보호).
 *   - ROUTE_TRANSIT_CACHE_ENABLED='false' ENV → 전체 비활성 (비상 circuit breaker).
 *
 * zoneId 규칙:
 *   zone_courses 컬렉션의 doc ID = 예) "SEOUL_DAY_MYEONGDONG_STANDARD".
 *   RouteAgent 는 blockMode 로 block 선택 시 block.id 로 zoneId 전달.
 *   Legacy path 에서는 zoneId = null → miss.
 *
 * @module transitCache
 */

import { initAdminDb } from './firestoreAdmin.js';
import { logger } from '../_shared/log.js';

// ── ENV circuit breaker ───────────────────────────────────────────────────────
export function isTransitCacheEnabled() {
  const raw = String(process.env.ROUTE_TRANSIT_CACHE_ENABLED || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'disabled') return false;
  return true; // default: enabled
}

// ── In-memory LRU (최대 50 zone, key: zoneId) ────────────────────────────────
const MAX_CACHE_ZONES = 50;
const _zoneCache = new Map(); // zoneId → { transit_matrix: {...}, fetchedAt: Date }

function _evictIfNeeded() {
  if (_zoneCache.size >= MAX_CACHE_ZONES) {
    // LRU: 가장 오래된 항목 1개 삭제
    const firstKey = _zoneCache.keys().next().value;
    _zoneCache.delete(firstKey);
    logger.info(`[transitCache] LRU evict: ${firstKey}`);
  }
}

/**
 * Firestore zone_courses/{zoneId} 의 transit_matrix 를 in-memory 로 로드.
 * 이미 캐시 있으면 그대로 반환. 실패 시 null.
 *
 * @param {string} zoneId — Firestore doc ID (예: "SEOUL_DAY_MYEONGDONG_STANDARD")
 * @returns {Promise<object|null>} transit_matrix 객체 또는 null
 */
async function _loadZone(zoneId) {
  if (!zoneId) return null;

  // in-memory hit
  if (_zoneCache.has(zoneId)) {
    return _zoneCache.get(zoneId).transit_matrix;
  }

  // Firestore fetch
  try {
    const db = initAdminDb();
    if (!db) {
      logger.warn('[transitCache] Firestore unavailable — cache disabled');
      return null;
    }
    const snap = await db.collection('zone_courses').doc(zoneId).get();
    if (!snap.exists) {
      logger.info(`[transitCache] zone not found: ${zoneId}`);
      return null;
    }
    const data = snap.data();
    const tm = data?.transit_matrix;
    if (!tm || typeof tm !== 'object') {
      logger.info(`[transitCache] zone has no transit_matrix: ${zoneId}`);
      return null;
    }
    _evictIfNeeded();
    _zoneCache.set(zoneId, { transit_matrix: tm, fetchedAt: new Date() });
    logger.info(`[transitCache] loaded: ${zoneId} (${Object.keys(tm).length} entries)`);
    return tm;
  } catch (e) {
    logger.warn(`[transitCache] Firestore fetch failed for ${zoneId}: ${e.message}`);
    return null;
  }
}

/**
 * transit_matrix 항목을 RouteAgent._getTransitData() 호환 publicTransit 객체로 변환.
 * ODsay formatTransitSummary() 출력 형식과 동일 구조.
 *
 * @param {object} entry — transit_matrix 의 단일 항목 (예: transit_matrix["1->2"])
 * @returns {object} publicTransit 호환 객체
 */
function _formatCacheHit(entry) {
  const mode = entry.mode || 'mixed';
  // ODsay method → RouteAgent 가 methodToMode() 로 정규화하는 형식 맞춤.
  // 'subway', 'bus', 'mixed' → 그대로. 'walk' → 그대로.
  const method = mode === 'mixed' ? 'subway+bus' : mode;
  const durationMin = entry.duration_min ?? entry.base?.duration_min ?? 15;
  const fare = entry.cost_krw ?? entry.base?.cost_krw ?? 0;
  const distM = entry.distance_m ?? entry.base?.distance_m ?? 0;

  return {
    method,
    duration: durationMin,
    fare,
    transfers: 0,
    totalWalk: 0,
    firstStation: null,
    lastStation: null,
    steps: [],
    summary: `DB cached: ${method} ${durationMin}min (zone_courses)`,
    distance_m: distM,
    _fromCache: true,
    _cacheSource: entry.source || 'zone_courses',
    _naverRouteUrl: entry.naver_route_url || null,
  };
}

/**
 * 메인 lookup 함수 — RouteAgent._getTransitData() 앞에 호출.
 *
 * key 형식: zone_courses transit_matrix 의 key = "${fromOrder}->${toOrder}"
 * 예: "1->2", "2->3".
 *
 * @param {string|null} zoneId — block mode 시 block.id, legacy path 시 null
 * @param {number} fromOrder — 출발 stop 의 order 필드
 * @param {number} toOrder — 도착 stop 의 order 필드
 * @returns {Promise<{publicTransit: object, durationMin: number, distanceKm: number} | null>}
 *   cache hit = _getTransitData 호환 결과. miss = null.
 */
export async function lookupTransitCache(zoneId, fromOrder, toOrder) {
  if (!isTransitCacheEnabled()) return null;
  if (!zoneId) return null;
  if (fromOrder == null || toOrder == null) return null;

  const tm = await _loadZone(zoneId);
  if (!tm) return null;

  const key = `${fromOrder}->${toOrder}`;
  const entry = tm[key];
  if (!entry) return null;

  // mock 데이터는 miss 처리 — 품질 보호 (15분 기본값 쓰레기 차단)
  if (entry.source === 'mock') {
    logger.info(`[transitCache] key=${key} source=mock → miss (ODsay fallback)`);
    return null;
  }

  const publicTransit = _formatCacheHit(entry);
  const durationMin = entry.duration_min ?? entry.base?.duration_min ?? 15;
  const distanceKm = entry.distance_m
    ? Math.round((entry.distance_m / 1000) * 10) / 10
    : 0;

  logger.info(`[transitCache] HIT: ${zoneId} ${key} → ${publicTransit.method} ${durationMin}min (source=${entry.source})`);
  return {
    publicTransit,
    durationMin,
    distanceKm,
    drivingMin: null, // cache 는 transit 전용, Naver driving 없음
  };
}

/**
 * 캐시 통계 반환 (디버깅 / 로그용).
 * @returns {{ zoneCount: number, zones: string[] }}
 */
export function getTransitCacheStats() {
  return {
    zoneCount: _zoneCache.size,
    zones: Array.from(_zoneCache.keys()),
    enabled: isTransitCacheEnabled(),
  };
}

/**
 * 특정 zone 또는 전체 in-memory cache 무효화.
 * 운영자가 zone_courses 재시드 후 강제 갱신 시 사용.
 * @param {string|null} zoneId null = 전체 flush
 */
export function invalidateTransitCache(zoneId) {
  if (zoneId) {
    _zoneCache.delete(zoneId);
    logger.info(`[transitCache] invalidated: ${zoneId}`);
  } else {
    _zoneCache.clear();
    logger.info('[transitCache] full flush');
  }
}
