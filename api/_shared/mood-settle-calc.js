/**
 * MOOD 운행 종료 정산 — "실사용 거리/톨비" 순수 검증·계산 헬퍼.
 *
 * mood-settle.js(정산 확정) · mood-settle-preview.js(미리보기) · mood-settle-correct.js(정정)
 * 세 엔드포인트가 동일 규칙을 쓰도록 공유한다. 🔴 클라가 보낸 정산거리/톨비 합계는
 * 절대 신뢰하지 않는다 — 여기서 서버가 재계산한다 (billableKm, includedTollKRW).
 *
 * 순수 함수만 담는다 (Firestore/네트워크 없음) — mood-settle-handler-safety.test.ts 처럼
 * 소스 문자열을 검사하는 기존 테스트를 건드리지 않기 위해 mood-settle.js 자체는
 * 리팩터하지 않고, 신규 검증만 이 모듈에서 가져다 쓴다.
 */

import { createHash } from 'node:crypto';
import { computeMoodTotalKRW, fixedPriceFor, MOOD_MAX_DURATION_HOURS } from './mood-pricing.js';

/** 실사용 총 주행거리 상한(km) — 이상값(오타/단위 실수) 방지용 상식선. */
export const MOOD_SETTLE_MAX_ACTUAL_KM = 3000;

/** 톨비 항목 최대 개수 — 한 번의 정산에 비상식적으로 많은 행 방지. */
export const MOOD_SETTLE_MAX_TOLL_ENTRIES = 50;

/** 코스별 MOOD 부담률 문서 스키마. 예약/변경/정산 API가 같은 버전을 쓴다. */
export const MOOD_COURSE_SHARE_SCHEMA_VERSION = 2;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function routeStopCount(breakdown) {
  const value = breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown) ? breakdown : {};
  const origin = typeof value.origin === 'string' ? value.origin.trim() : '';
  const destination = typeof value.destination === 'string' ? value.destination.trim() : '';
  const waypoints = value.waypoints === undefined || value.waypoints === null ? [] : value.waypoints;
  if (!Array.isArray(waypoints) || waypoints.some((waypoint) => typeof waypoint !== 'string' || !waypoint.trim())) return null;
  if (!origin && !destination && waypoints.length === 0) return 0;
  if (!origin || !destination) return null;
  return waypoints.length + 2;
}

export function legacyMoodPayersForPercentages(percentages) {
  if (!percentages.every((percentage) => percentage === 0 || percentage === 100)) return null;
  return percentages.map((percentage) => percentage === 100 ? 'mood' : 'influencer');
}

/** 저장된 예약의 코스 부담률을 검증하고 레거시 coursePayers를 정규화한다. */
export function normalizeStoredMoodCourseShare(booking) {
  const value = booking && typeof booking === 'object' && !Array.isArray(booking) ? booking : {};
  const stopCount = routeStopCount(value.breakdown);
  if (stopCount === null) return { ok: false };
  const hasCanonicalField = hasOwn(value, 'courseMoodPercentages') || hasOwn(value, 'courseShareSchemaVersion');
  if (hasCanonicalField) {
    const percentages = value.courseMoodPercentages;
    if (
      value.courseShareSchemaVersion !== MOOD_COURSE_SHARE_SCHEMA_VERSION
      || !Array.isArray(percentages)
      || percentages.length !== stopCount
      || percentages.some((percentage) => !Number.isInteger(percentage) || percentage < 0 || percentage > 100)
    ) {
      return { ok: false };
    }
    return { ok: true, percentages: percentages.slice(), payers: legacyMoodPayersForPercentages(percentages) };
  }
  if (hasOwn(value, 'coursePayers') && value.coursePayers !== null) {
    const payers = value.coursePayers;
    if (
      !Array.isArray(payers)
      || payers.length !== stopCount
      || payers.some((payer) => payer !== 'mood' && payer !== 'influencer')
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      percentages: payers.map((payer) => payer === 'mood' ? 100 : 0),
      payers: payers.slice(),
    };
  }
  const percentages = Array.from({ length: stopCount }, (_, index) => index === 0 ? 100 : 0);
  return { ok: true, percentages, payers: legacyMoodPayersForPercentages(percentages) };
}

/** 경로 재측정 요청의 코스 부담률을 preview/commit 공통 규칙으로 검증한다. */
export function normalizeRequestedMoodCourseShare({ courseMoodPercentages, courseShareSchemaVersion, stopCount }) {
  if (
    !Array.isArray(courseMoodPercentages)
    || courseMoodPercentages.length !== stopCount
    || courseMoodPercentages.some((percentage) => !Number.isInteger(percentage) || percentage < 0 || percentage > 100)
  ) {
    return { ok: false, error: 'INVALID_COURSE_MOOD_PERCENTAGES' };
  }
  if (
    courseShareSchemaVersion !== undefined
    && courseShareSchemaVersion !== MOOD_COURSE_SHARE_SCHEMA_VERSION
  ) {
    return { ok: false, error: 'INVALID_COURSE_SHARE_SCHEMA_VERSION' };
  }
  return { ok: true, percentages: courseMoodPercentages.slice() };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 미리보기와 확정 요청이 같은 예약 revision·같은 서버 계산값인지 묶는 지문.
 * 보안 토큰이 아니라, 관리자가 미리보기 뒤 입력을 바꾸고 예전 금액으로 확정하는 실수를
 * 막는 일관성 표식이다. 실제 금액은 확정 API가 다시 계산한다.
 */
export function buildSettlementPreviewHash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

/**
 * 실사용 거리 — 총 주행거리에서 픽업 전/비과금 구간을 뺀 정산거리(billableKm)를
 * 서버가 직접 계산한다. 클라가 billableKm/정산거리를 보내도 무시.
 *
 * @param {{ actualTotalKm: unknown, excludedKm: unknown }} input
 * @returns {{ ok: true, actualTotalKm: number, excludedKm: number, billableKm: number } | { ok: false, error: string }}
 */
export function validateActualDistance({ actualTotalKm, excludedKm }) {
  if (typeof actualTotalKm === 'string' && !actualTotalKm.trim()) {
    return { ok: false, error: 'INVALID_ACTUAL_TOTAL_KM' };
  }
  const total = Number(actualTotalKm);
  if (!Number.isFinite(total) || total < 0 || total > MOOD_SETTLE_MAX_ACTUAL_KM) {
    return { ok: false, error: 'INVALID_ACTUAL_TOTAL_KM' };
  }
  if (typeof excludedKm === 'string' && !excludedKm.trim()) {
    return { ok: false, error: 'INVALID_EXCLUDED_KM' };
  }
  const excluded = Number(excludedKm === undefined || excludedKm === null ? 0 : excludedKm);
  if (!Number.isFinite(excluded) || excluded < 0) {
    return { ok: false, error: 'INVALID_EXCLUDED_KM' };
  }
  if (excluded > total) {
    return { ok: false, error: 'EXCLUDED_KM_EXCEEDS_TOTAL' };
  }
  const billableKm = Math.round((total - excluded) * 10) / 10;
  return { ok: true, actualTotalKm: total, excludedKm: excluded, billableKm };
}

/**
 * 항목별 톨비(evidence rows) 정규화 + 서버 합산.
 * includedInSettlement=true 인 행만 정산에 포함 — 카드 충전 등 톨비가 아닌 항목은
 * includedInSettlement=false 로 표시해 합계에서 제외한다(삭제하지 않고 기록은 남긴다).
 *
 * @param {unknown} raw - body.tollEntries
 * @returns {{ ok: true, entries: Array<object>, includedTollKRW: number, pendingIncludedCount: number } | { ok: false, error: string }}
 */
export function normalizeTollEntries(raw) {
  if (raw === undefined || raw === null) return { ok: true, entries: [], includedTollKRW: 0, pendingIncludedCount: 0 };
  if (!Array.isArray(raw)) return { ok: false, error: 'INVALID_TOLL_ENTRIES' };
  if (raw.length > MOOD_SETTLE_MAX_TOLL_ENTRIES) return { ok: false, error: 'TOO_MANY_TOLL_ENTRIES' };

  const entries = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'INVALID_TOLL_ENTRY' };
    }
    const amountKRW = Number(item.amountKRW);
    if (!Number.isInteger(amountKRW) || amountKRW < 0 || amountKRW > 1000000) {
      return { ok: false, error: 'INVALID_TOLL_ENTRY_AMOUNT' };
    }
    const status = item.status === 'confirmed' ? 'confirmed' : item.status === 'pending' ? 'pending' : null;
    if (!status) return { ok: false, error: 'INVALID_TOLL_ENTRY_STATUS' };
    const label = String(item.label || '').trim().slice(0, 200);
    if (!label) return { ok: false, error: 'INVALID_TOLL_ENTRY_LABEL' };
    const dateLabel = String(item.date || '').trim().slice(0, 40);
    const evidenceRefRaw = String(item.evidenceRef || '').trim().slice(0, 300);
    entries.push({
      label,
      date: dateLabel || null,
      amountKRW,
      status,
      includedInSettlement: item.includedInSettlement === true,
      evidenceRef: evidenceRefRaw || null,
    });
  }
  const includedTollKRW = entries
    .filter((entry) => entry.includedInSettlement)
    .reduce((sum, entry) => sum + entry.amountKRW, 0);
  if (!Number.isSafeInteger(includedTollKRW)) return { ok: false, error: 'INVALID_TOLL_TOTAL' };
  if (includedTollKRW > 1000000) return { ok: false, error: 'INVALID_TOLL_TOTAL' };
  const pendingIncludedCount = entries.filter((entry) => entry.includedInSettlement && entry.status === 'pending').length;
  return { ok: true, entries, includedTollKRW, pendingIncludedCount };
}

/**
 * 완료 예약 정정의 서버 계산 SSOT. 미리보기와 확정이 이 함수를 함께 써 같은 금액·검증을 보장한다.
 */
export function calculateMoodCorrection({
  booking,
  bookingId,
  expectedRevision,
  reason,
  hasActualHours,
  actualHours,
  hasManualDistance,
  manualDistance,
  hasTollMode,
  tollMode,
  actualTollKRW,
  tollEntries,
  itemizedTollKRW,
  acknowledgedPendingTolls,
  hasManualAdjustment,
  manualAdjustmentKRW,
}) {
  const b = booking && typeof booking === 'object' && !Array.isArray(booking) ? booking : {};
  if (fixedPriceFor(b.serviceType) !== null) return { ok: false, status: 400, error: 'AIRPORT_NO_SETTLE' };

  const hasStoredRate = b.ratePerHour !== undefined && b.ratePerHour !== null;
  if (hasStoredRate && (!Number.isSafeInteger(b.ratePerHour) || b.ratePerHour <= 0)) {
    return { ok: false, status: 409, error: 'INVALID_BOOKING_RATE' };
  }

  const existingBd = b.finalBreakdown && typeof b.finalBreakdown === 'object' && !Array.isArray(b.finalBreakdown)
    ? b.finalBreakdown
    : {};
  const effectiveActualHours = hasActualHours ? actualHours : b.actualHours;
  if (
    typeof effectiveActualHours !== 'number'
    || !Number.isFinite(effectiveActualHours)
    || effectiveActualHours <= 0
    || effectiveActualHours > MOOD_MAX_DURATION_HOURS
  ) {
    return { ok: false, status: 409, error: 'INVALID_STORED_ACTUAL_HOURS' };
  }

  let km = existingBd.km;
  let distanceSource = existingBd.distanceSource || (existingBd.recomputed ? 'route' : 'booked');
  let effectiveActualTotalKm = existingBd.actualTotalKm === undefined ? null : existingBd.actualTotalKm;
  let effectiveExcludedKm = existingBd.excludedKm === undefined ? null : existingBd.excludedKm;
  if (hasManualDistance) {
    km = manualDistance.billableKm;
    distanceSource = 'manual';
    effectiveActualTotalKm = manualDistance.actualTotalKm;
    effectiveExcludedKm = manualDistance.excludedKm;
  }
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) {
    return { ok: false, status: 409, error: 'INVALID_STORED_KM' };
  }
  if (!['manual', 'route', 'booked'].includes(distanceSource)) {
    return { ok: false, status: 409, error: 'INVALID_STORED_DISTANCE_SOURCE' };
  }
  if (distanceSource === 'manual' && !hasManualDistance) {
    const storedDistance = validateActualDistance({
      actualTotalKm: effectiveActualTotalKm,
      excludedKm: effectiveExcludedKm,
    });
    if (!storedDistance.ok || storedDistance.billableKm !== Math.round(km * 10) / 10) {
      return { ok: false, status: 409, error: 'INVALID_STORED_MANUAL_DISTANCE' };
    }
    effectiveActualTotalKm = storedDistance.actualTotalKm;
    effectiveExcludedKm = storedDistance.excludedKm;
  }

  const existingTollKRW = existingBd.tollKRW;
  if (!Number.isSafeInteger(existingTollKRW) || existingTollKRW < 0) {
    return { ok: false, status: 409, error: 'INVALID_STORED_TOLL' };
  }
  const estimatedTollKRW = b.estimatedTollKRW === undefined || b.estimatedTollKRW === null
    ? existingTollKRW
    : b.estimatedTollKRW;
  if (!Number.isSafeInteger(estimatedTollKRW) || estimatedTollKRW < 0) {
    return { ok: false, status: 409, error: 'INVALID_STORED_TOLL' };
  }

  const storedTollMode = b.tollMode === undefined || b.tollMode === null || b.tollMode === ''
    ? 'estimated'
    : b.tollMode;
  const effectiveTollMode = hasTollMode ? tollMode : storedTollMode;
  if (!['estimated', 'none', 'actual', 'itemized'].includes(effectiveTollMode)) {
    return { ok: false, status: 409, error: 'INVALID_STORED_TOLL_MODE' };
  }
  let tollKRW = existingTollKRW;
  let effectiveTollEntries = null;
  if (effectiveTollMode === 'none') {
    tollKRW = 0;
  } else if (effectiveTollMode === 'actual') {
    if (hasTollMode) tollKRW = actualTollKRW;
  } else if (effectiveTollMode === 'estimated') {
    tollKRW = estimatedTollKRW;
  } else if (hasTollMode) {
    tollKRW = itemizedTollKRW;
    effectiveTollEntries = tollEntries;
  } else {
    const normalizedStoredEntries = normalizeTollEntries(b.tollEntries);
    if (!normalizedStoredEntries.ok) {
      return { ok: false, status: 409, error: 'INVALID_STORED_TOLL_ENTRIES' };
    }
    tollKRW = normalizedStoredEntries.includedTollKRW;
    effectiveTollEntries = normalizedStoredEntries.entries;
    if (normalizedStoredEntries.pendingIncludedCount > 0 && !acknowledgedPendingTolls) {
      return { ok: false, status: 400, error: 'PENDING_TOLL_ACK_REQUIRED' };
    }
  }

  const finalPriced = computeMoodTotalKRW({
    serviceType: b.serviceType,
    durationHours: effectiveActualHours,
    km,
    tollKRW,
    ratePerHourOverride: hasStoredRate ? b.ratePerHour : undefined,
  });
  if (!finalPriced.ok) return { ok: false, status: 400, error: finalPriced.error };

  const storedManualAdjustmentKRW = b.manualAdjustmentKRW === undefined || b.manualAdjustmentKRW === null
    ? 0
    : b.manualAdjustmentKRW;
  if (!Number.isSafeInteger(storedManualAdjustmentKRW) || Math.abs(storedManualAdjustmentKRW) > 10000000) {
    return { ok: false, status: 409, error: 'INVALID_STORED_MANUAL_ADJUSTMENT' };
  }
  const effectiveManualAdjustmentKRW = hasManualAdjustment ? manualAdjustmentKRW : storedManualAdjustmentKRW;
  const newFinalAmount = finalPriced.amountKRW + effectiveManualAdjustmentKRW;
  if (!Number.isSafeInteger(newFinalAmount) || newFinalAmount < 0) {
    return { ok: false, status: 400, error: 'INVALID_FINAL_AMOUNT' };
  }
  const currentFinalAmount = b.finalAmountKRW;
  const originalAmount = b.amountKRW;
  if (!Number.isSafeInteger(currentFinalAmount) || currentFinalAmount < 0) {
    return { ok: false, status: 409, error: 'INVALID_BOOKING_AMOUNT' };
  }
  if (!Number.isSafeInteger(originalAmount) || originalAmount < 0) {
    return { ok: false, status: 409, error: 'INVALID_BOOKING_AMOUNT' };
  }

  const newBreakdown = {
    ...existingBd,
    baseKRW: finalPriced.baseKRW,
    distanceSurchargeKRW: finalPriced.distanceSurchargeKRW,
    tollKRW: finalPriced.tollKRW,
    estimatedTollKRW,
    km: finalPriced.km,
    distanceSource,
    ...(distanceSource === 'manual' ? {
      actualTotalKm: effectiveActualTotalKm,
      excludedKm: effectiveExcludedKm,
    } : {}),
  };
  const previewPayload = {
    mode: 'correction',
    bookingId,
    revision: expectedRevision,
    actualHours: effectiveActualHours,
    km: finalPriced.km,
    distanceSource,
    actualTotalKm: effectiveActualTotalKm,
    excludedKm: effectiveExcludedKm,
    tollMode: effectiveTollMode,
    tollKRW: finalPriced.tollKRW,
    tollEntries: effectiveTollMode === 'itemized' ? effectiveTollEntries : null,
    acknowledgedPendingTolls,
    manualAdjustmentKRW: effectiveManualAdjustmentKRW,
    correctionReason: reason,
    bookedAmountKRW: originalAmount,
    previousFinalAmountKRW: currentFinalAmount,
    finalAmountKRW: newFinalAmount,
  };
  const previewHash = buildSettlementPreviewHash(previewPayload);

  return {
    ok: true,
    value: {
      existingBd,
      effectiveActualHours,
      effectiveActualTotalKm,
      effectiveExcludedKm,
      distanceSource,
      estimatedTollKRW,
      effectiveTollMode,
      effectiveTollEntries,
      finalPriced,
      storedManualAdjustmentKRW,
      effectiveManualAdjustmentKRW,
      currentFinalAmount,
      originalAmount,
      newFinalAmount,
      deltaKRW: newFinalAmount - currentFinalAmount,
      newBreakdown,
      previewPayload,
      previewHash,
    },
  };
}
