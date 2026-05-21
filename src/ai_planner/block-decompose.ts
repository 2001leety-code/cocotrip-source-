/**
 * block-decompose.ts — Zone course block 의 fine-grained 수정 helper (PR-A).
 *
 * 2026-05-21. 사용자가 block 1개의 stop 1-2개만 수정하려 할 때, 전체 block 을 새로
 * 생성하지 않고 stop 단위로 add/remove/swap. order + start_time_offset_min 자동
 * 재계산. transit_matrix 재생성은 별도 (ai-planner-full 의 RouteAgent 가 처리).
 *
 * 핵심 원칙 (사용자 강조 — "오류 없이 진행할 수 있는 시스템"):
 *   - 모든 helper 가 invalid input 에 throw X. null/원본 block 반환.
 *   - order/start_time_offset_min 일관성 자동 유지.
 *   - transit_matrix 는 보존하되 stop 추가/제거 시 invalid key 제거.
 */

import type {
  ZoneCourseBlock,
  ZoneCourseStop,
  ZoneCourseTransit,
  BlockType,
  ZoneCourseCity,
  ZoneCourseIntensity,
} from '@/data/zone_courses/types';

/** decompose 결과 — stops + block metadata */
export interface DecomposedBlock {
  stops: ZoneCourseStop[];
  metadata: {
    id: string;
    city: ZoneCourseCity;
    zone: string;
    theme: string;
    block_type: BlockType;
    intensity: ZoneCourseIntensity;
  };
}

/** Block 을 stops 배열 + metadata 로 분해 — fine-grained 수정 준비 */
export function decomposeBlock(block: ZoneCourseBlock | null | undefined): DecomposedBlock | null {
  if (!block || typeof block !== 'object') return null;
  if (!Array.isArray(block.stops)) return null;

  return {
    stops: block.stops.slice(), // shallow copy
    metadata: {
      id: block.id,
      city: block.city,
      zone: block.zone,
      theme: block.theme,
      block_type: block.block_type ?? 'city_day', // backward compat default
      intensity: block.intensity,
    },
  };
}

/**
 * 수정된 stops 배열을 block 형태로 재조합. order/start_time_offset 만 재계산.
 * transit_matrix 는 무효화 (ai-planner-full RouteAgent 가 재생성).
 *
 * NOTE: metadata 는 partial 허용 (사용자가 일부만 변경 가능). 변경 안 된 필드는
 * 호출자가 책임지고 보존.
 */
export function recomposeBlock(
  stops: ZoneCourseStop[] | null | undefined,
  metadata: Partial<DecomposedBlock['metadata']> | null | undefined,
): Partial<ZoneCourseBlock> | null {
  if (!Array.isArray(stops) || !metadata) return null;

  // order 재할당 (1-based)
  const reordered = stops.map((s, idx) => ({ ...s, order: idx + 1 }));

  // start_time_offset_min cumulative — transit_matrix 부재이므로 stay_min 만
  // 기본 reset. ai-planner-full 의 RouteAgent 가 transit 추가 후 다시 stitch.
  let cumulative = 0;
  for (const s of reordered) {
    s.start_time_offset_min = cumulative;
    cumulative += s.stay_min || 0;
  }

  return {
    id: metadata.id,
    city: metadata.city,
    zone: metadata.zone,
    theme: metadata.theme,
    block_type: metadata.block_type,
    intensity: metadata.intensity,
    stops: reordered,
    duration_min: cumulative,
    // transit_matrix 는 의도적 누락 — 호출자 (ai-planner) 가 재생성
  };
}

/**
 * Stop 추가 — order/start_time_offset_min 자동 재계산.
 * position 0-based 인덱스. invalid 시 원본 block 반환.
 */
export function insertStop(
  block: ZoneCourseBlock | null | undefined,
  position: number,
  newStop: ZoneCourseStop | null | undefined,
): ZoneCourseBlock {
  if (!block) {
    // throw X — 빈 block 같은 placeholder 가 의미 없으므로 호출자가 책임
    throw new Error('insertStop: block must not be null');
  }
  if (!newStop || typeof newStop !== 'object') {
    return block;
  }
  if (!Number.isInteger(position) || position < 0) {
    return block;
  }
  if (!Array.isArray(block.stops)) {
    return block;
  }

  const clamped = Math.min(position, block.stops.length);
  const stops = [
    ...block.stops.slice(0, clamped),
    { ...newStop },
    ...block.stops.slice(clamped),
  ];
  return rebuildBlockMetrics(block, stops);
}

/**
 * Stop 제거 — order/start_time_offset_min 자동 재계산.
 * stopOrder 1-based. 매칭 안 되면 원본 block 반환.
 */
export function removeStop(
  block: ZoneCourseBlock | null | undefined,
  stopOrder: number,
): ZoneCourseBlock {
  if (!block) {
    throw new Error('removeStop: block must not be null');
  }
  if (!Number.isInteger(stopOrder) || stopOrder < 1) {
    return block;
  }
  if (!Array.isArray(block.stops)) {
    return block;
  }

  const idx = block.stops.findIndex((s) => s.order === stopOrder);
  if (idx === -1) {
    return block; // 매칭 안 됨
  }
  const stops = [...block.stops.slice(0, idx), ...block.stops.slice(idx + 1)];
  return rebuildBlockMetrics(block, stops);
}

/**
 * Stop 교체 — order 보존, start_time_offset_min 재계산.
 * stopOrder 1-based. 매칭 안 되면 원본 block 반환.
 */
export function swapStop(
  block: ZoneCourseBlock | null | undefined,
  stopOrder: number,
  newStop: ZoneCourseStop | null | undefined,
): ZoneCourseBlock {
  if (!block) {
    throw new Error('swapStop: block must not be null');
  }
  if (!newStop || typeof newStop !== 'object') {
    return block;
  }
  if (!Number.isInteger(stopOrder) || stopOrder < 1) {
    return block;
  }
  if (!Array.isArray(block.stops)) {
    return block;
  }

  const idx = block.stops.findIndex((s) => s.order === stopOrder);
  if (idx === -1) {
    return block;
  }
  const stops = block.stops.slice();
  stops[idx] = { ...newStop, order: stopOrder };
  return rebuildBlockMetrics(block, stops);
}

// ─────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────

/**
 * stops 배열을 받아 block 의 order/start_time_offset_min/duration_min 재계산.
 * transit_matrix 의 invalid key 제거 (없어진 stop 참조 끊기).
 */
function rebuildBlockMetrics(
  original: ZoneCourseBlock,
  stops: ZoneCourseStop[],
): ZoneCourseBlock {
  // order 재할당 + start_time_offset_min cumulative
  let cumulative = 0;
  const renumbered: ZoneCourseStop[] = stops.map((s, idx) => {
    const order = idx + 1;
    const start = cumulative;
    cumulative += s.stay_min || 0;
    // 다음 transit 의 duration 더하려면 transit_matrix 가 정확해야 — 일단 skip
    // (호출자 / ai-planner 가 RouteAgent 로 재빌드 후 정확한 offset stitch)
    return { ...s, order, start_time_offset_min: start };
  });

  // transit_matrix 정리 — invalid key 제거
  const validOrders = new Set(renumbered.map((s) => s.order));
  const cleanedTransit: Record<string, ZoneCourseTransit> = {};
  for (const [key, val] of Object.entries(original.transit_matrix ?? {})) {
    if (!val || typeof val !== 'object') continue;
    if (validOrders.has(val.from_order) && validOrders.has(val.to_order)) {
      cleanedTransit[key] = val;
    }
  }

  return {
    ...original,
    stops: renumbered,
    duration_min: cumulative,
    transit_matrix: cleanedTransit,
  };
}
