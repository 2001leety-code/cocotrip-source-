// ─────────────────────────────────────────────────────────────────────────────
// zone-course-publish-validation.ts — A1-7-2 SAFETY publish gate
//
// 문제 (pre-fix):
//   AdminZoneCourseEditor.handlePublish 가 id/city/zone/theme/stops>=2 만 검증.
//   block_type='trekking' 인 코스를 trekking_meta 빈 채로 publish 가능 →
//   AI 플래너가 등산 안내 (거리/난이도/장비/위험) 없이 추천 →
//   운동화 사용자가 등산 코스 선택 → 안전 사고 위험.
//
//   비유: "등산이라면서 등산화 권고/위험 안내 없이 메뉴 발행 → 손님이
//   운동화로 가서 다침."
//
// Post-fix:
//   block_type ↔ meta 매트릭스 (BLOCK_TYPE_META_REQUIREMENTS) 정의.
//   validateZoneCoursePublish(draft) helper 가 누락 필드를 정확히 한국어
//   라벨과 함께 반환. AdminZoneCourseEditor 가 결과 보고 alert + 해당 탭
//   자동 이동.
//
// 제약 (운영자 의도):
//   - city_day / cafe_hop / cycling / guided_tour / dmz_tour 등은 meta 요구 X
//     (운영자 의도에 추가 검증 강제 금지)
//   - SAFETY-CRITICAL 은 trekking / running_route 만
//
// 참조:
//   - CLAUDE.md J 섹션 (SAFETY-CRITICAL 패턴)
//   - DietaryTab 의 amber SAFETY 경고 박스 패턴
//   - feedback_systemize_over_fix.md (3종 세트)
// ─────────────────────────────────────────────────────────────────────────────
import type { ZoneCourseDoc } from './zone-courses-firestore';

/**
 * 매트릭스: block_type → 필수 meta 필드.
 *
 * 운영자 의도 (확장 시 주의):
 *   - 새 block_type 이 안전 영역 (등산/러닝/암벽/스쿠버 등) 이면 추가.
 *   - 도심형 / 라이트 액티비티 (cafe_hop / city_day / cycling) 는 추가 금지.
 */
export const BLOCK_TYPE_META_REQUIREMENTS: Record<
  string,
  {
    metaField: 'trekking_meta' | 'running_meta';
    /**
     * 필수 키 + 한국어 라벨 (사용자에게 보일 메시지).
     * 0 / 빈 문자열 / 빈 배열 / null / undefined 는 모두 "누락" 으로 판정.
     *
     * "0 도 누락" 인 이유: 등산 코스의 거리 0km / 난이도 미설정 / 장비 0개
     * 는 운영자 작성 누락이 거의 확실 (실제 도보 0km 코스 자체가 비논리).
     * False positive 보다 false negative 가 SAFETY 측면에서 훨씬 위험.
     */
    requiredKeys: { key: string; label: string }[];
    safetyLabel: string;
    safetyReason: string;
  }
> = {
  trekking: {
    metaField: 'trekking_meta',
    requiredKeys: [
      { key: 'total_distance_km',      label: '총 거리 (km)' },
      { key: 'elevation_gain_m',       label: '누적 고도 (m)' },
      { key: 'difficulty',             label: '난이도' },
      { key: 'trail_type',             label: '트레일 유형' },
      { key: 'estimated_duration_min', label: '예상 소요 시간 (분)' },
      { key: 'recommended_gear',       label: '권장 장비' },
      { key: 'hazards',                label: '위험 요소' },
      { key: 'trailhead_address',      label: '트레일헤드 주소' },
    ],
    safetyLabel: '등산',
    safetyReason:
      '등산 코스는 거리·고도·난이도·장비·위험 안내 없이 발행 시 AI 플래너가\n' +
      '운동화/반바지 사용자에게도 추천하여 안전 사고 (탈진/추락/저체온증) 위험.',
  },
  running_route: {
    metaField: 'running_meta',
    requiredKeys: [
      { key: 'total_km',             label: '총 거리 (km)' },
      { key: 'surface_type',         label: '노면 종류' },
      { key: 'elevation_gain_m',     label: '누적 고도 (m)' },
      { key: 'loop_or_out_and_back', label: '코스 형태' },
      { key: 'recommended_time',    label: '권장 시간대' },
      { key: 'lighting_quality',     label: '야간 조명 품질' },
      { key: 'difficulty',           label: '난이도' },
    ],
    safetyLabel: '러닝',
    safetyReason:
      '러닝 코스는 거리·노면·권장 시간대·조명·난이도 안내 없이 발행 시 AI 플래너가\n' +
      '초보 사용자에게 야간 어두운 코스·새벽 시간대를 추천하여 안전 사고 위험.',
  },
};

/** 누락 detail — UI 가 alert + 탭 이동에 사용. */
export interface MissingMetaDetail {
  metaField: 'trekking_meta' | 'running_meta';
  safetyLabel: string;
  safetyReason: string;
  missingKeys: { key: string; label: string }[];
}

export type ZoneCoursePublishValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'missing_basic' | 'insufficient_stops' | 'missing_meta';
      /** 한국어 alert 메시지 — UI 가 그대로 alert() 에 전달. */
      message: string;
      /** missing_meta 시 어느 탭으로 이동할지 결정용. */
      missingMeta?: MissingMetaDetail;
    };

/**
 * 필드 값이 "누락" 인지 판정.
 *
 * 누락 정의:
 *   - null / undefined
 *   - 빈 문자열 (trim 후)
 *   - 빈 배열
 *   - 숫자 0 (등산/러닝 거리·고도가 0 인 코스는 작성 누락이 거의 확실)
 *   - NaN / Infinity 같은 비정상 숫자
 *
 * 주의: false / 0 을 의도적으로 허용해야 하는 필드는 BLOCK_TYPE_META_REQUIREMENTS
 * 에 포함하지 말 것 (예: parking_available boolean 같은 optional 필드).
 */
export function isMissingMetaValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return true;
    if (value === 0) return true;
  }
  return false;
}

/**
 * publish validation 메인 함수.
 *
 * 검증 순서:
 *   1. basic — id / city / zone / theme 누락 → reason='missing_basic'
 *   2. stops — < 2 개 → reason='insufficient_stops'
 *   3. block_type ↔ meta 매트릭스 — 누락 → reason='missing_meta'
 *
 * 운영자 의도:
 *   - basic / stops 검증 통과 후에만 meta 검증 (사용자 혼란 방지: "id 먼저 채워")
 *   - 매트릭스에 없는 block_type 은 meta 요구 X (city_day / cycling 등)
 */
export function validateZoneCoursePublish(
  draft: Partial<ZoneCourseDoc>,
): ZoneCoursePublishValidationResult {
  // 1. Basic 필수
  if (!draft.id || !draft.city || !draft.zone || !draft.theme) {
    return {
      ok: false,
      reason: 'missing_basic',
      message: 'Basic 탭의 id / city / zone / theme 가 필수입니다.',
    };
  }

  // 2. Stops 2개 이상
  if (!draft.stops || draft.stops.length < 2) {
    return {
      ok: false,
      reason: 'insufficient_stops',
      message: 'Stops 2 개 이상 필요합니다.',
    };
  }

  // 3. block_type ↔ meta 매트릭스 (SAFETY)
  const blockType = draft.block_type;
  // 매트릭스 미등록 block_type (city_day / cycling / guided_tour / dmz_tour 등) 은
  // 추가 meta 요구 X — 운영자 의도 명시적 제약.
  if (!blockType) return { ok: true };
  const requirement = BLOCK_TYPE_META_REQUIREMENTS[blockType];
  if (!requirement) return { ok: true };

  const meta = (draft as Record<string, unknown>)[requirement.metaField] as
    | Record<string, unknown>
    | undefined;
  const missingKeys = requirement.requiredKeys.filter((r) => {
    if (meta == null) return true;
    return isMissingMetaValue(meta[r.key]);
  });

  if (missingKeys.length === 0) {
    return { ok: true };
  }

  const missingList = missingKeys.map((k) => `  - ${k.label} (${k.key})`).join('\n');
  const message =
    `🛑 ${requirement.safetyLabel} 코스 발행 차단 (SAFETY-CRITICAL)\n\n` +
    `block_type='${blockType}' 인데 ${requirement.metaField} 의 필수 필드가 누락되었습니다:\n` +
    `${missingList}\n\n` +
    `사유: ${requirement.safetyReason}\n\n` +
    `${requirement.metaField === 'trekking_meta' ? '⑩ Trekking Meta' : '⑩ Running Meta'} ` +
    `탭으로 이동해서 필수 필드를 모두 채워주세요.`;

  return {
    ok: false,
    reason: 'missing_meta',
    message,
    missingMeta: {
      metaField: requirement.metaField,
      safetyLabel: requirement.safetyLabel,
      safetyReason: requirement.safetyReason,
      missingKeys,
    },
  };
}
