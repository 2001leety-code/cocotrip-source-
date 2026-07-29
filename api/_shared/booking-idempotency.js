/**
 * booking-processor 멱등 가드 — retry/replay 중복(시트 row·로열티 포인트·확인메일) 방지.
 *
 * 배경: booking-processor 는 비멱등 — 같은 orderID 로 2회 호출되면(retry 큐 sweep,
 * admin-replay-booking-notifications, cart fan-out 재시도) Sheets append·로열티 적립·
 * voucher 메일이 매번 다시 실행돼 중복. bookings/{orderID} 의 단계별 완료 마커를 읽어
 * "이미 끝낸 단계는 스킵" 결정한다.
 *
 * ⚠️ 안전 기본: 마커 읽기 실패/없음 → 전부 처리(스킵 0). 즉 첫 처리는 항상 전 단계 실행
 *    (기존 단일상품 동작 100% 불변). 마커는 각 단계 "성공 후"에만 set → 첫 호출엔 없음.
 *    orderID 는 고유(PayPal order / ADMIN-BYPASS-)라 다른 예약 마커 오염 없음.
 *
 * 마커 필드 (bookings/{orderID}):
 *  - sheetsAppendedAt   : Google Sheets row append 성공
 *  - loyaltyEarnedAt    : 로열티 포인트 적립 성공
 *  - voucherSentAt      : 확인메일(+voucher) 발송 성공 (기존 필드 재사용)
 *
 * 🔴 2026-07-29 (2단계 상태): 마커를 "선점"과 "완료" 두 단계로 나눈다.
 *   이전에는 작업 **전에** 마커를 박고(선점) 실패 시 지웠다. 그래서 선점과 해제 사이에
 *   함수가 죽으면(타임아웃·콜드스타트 종료·배포 중단) 마커가 남아 **retry 가 영원히 스킵**했다.
 *   실제로는 시트 row 도 메일도 바우처도 안 나갔는데 "완료"로 보였다.
 *   → 선점은 `<field>State = 'in_progress'` + 시각으로 기록하고,
 *     **성공했을 때만** `<field>` 타임스탬프 + `<field>State='completed'` 를 쓴다.
 *     스킵 판정은 `completed` 만 본다. 오래된 in_progress 는 좀비로 보고 재선점을 허용한다.
 */

/** 선점 상태 필드명 = 완료 필드명 + 'State' (예: sheetsAppendedAtState). */
export const stepStateField = (field) => `${field}State`;

/** 좀비 선점 판정 시간 — 함수 최대 실행시간(60s)의 여유 배수. */
export const STEP_CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * 이 단계가 **실제로 완료**됐는가? (선점만 된 것은 완료가 아니다)
 * 레거시 문서 호환: State 필드가 없고 완료 타임스탬프만 있으면 완료로 본다.
 */
export function isStepCompleted(markers, field) {
  const m = markers || {};
  const state = m[stepStateField(field)];
  if (state === 'completed') return true;
  if (state === 'in_progress') return false;
  return Boolean(m[field]);   // 레거시(State 없음)
}

/**
 * @param {object|null|undefined} priorMarkers  bookings/{orderID} 문서 데이터 (없으면 {}/null)
 * @returns {{skipSheets:boolean, skipLoyalty:boolean, skipVoucher:boolean}}
 */
export function bookingStepGuards(priorMarkers) {
  const m = priorMarkers || {};
  // 🔴 completed 만 스킵한다. in_progress(선점 후 죽은 경우)는 다시 처리해야 한다.
  return {
    skipSheets:  isStepCompleted(m, 'sheetsAppendedAt'),
    skipLoyalty: isStepCompleted(m, 'loyaltyEarnedAt'),
    skipVoucher: isStepCompleted(m, 'voucherSentAt'),
  };
}

/** 멱등 마커 필드명 상수 (booking-processor 가 set 시 사용). */
export const BOOKING_STEP_MARKERS = {
  sheets: 'sheetsAppendedAt',
  loyalty: 'loyaltyEarnedAt',
  voucher: 'voucherSentAt',
};

/**
 * 🔴 2026-07-29 (좀비 선점 정책): "선점만 하고 죽은" 단계를 어떻게 다룰지는 단계마다 다르다.
 *
 *   reclaim    — 다시 실행해도 안전한 단계. **외부 쪽에도 중복 방지 키가 있어야만** 이걸 쓴다.
 *                sheets  = 시트에 orderID 로 조회 후 없을 때만 추가 (아래 appendBooking)
 *                loyalty = 원장 문서 ID 가 orderID 로 고정 (api/loyalty.js)
 *   quarantine — 다시 실행하면 **손님에게 두 번 간다**. 자동 재시도 금지.
 *                voucher = SMTP 는 멱등 키가 없다. 보냈는지 확신할 수 없으면 보내지 않고
 *                          outcome_unknown 으로 격리해 운영자가 판단하게 한다.
 *
 * "확실치 않으면 한 번 더 보낸다" 는 결제 확인 메일에서 최악의 기본값이다.
 */
export const STEP_ZOMBIE_POLICY = {
  sheetsAppendedAt: 'reclaim',
  loyaltyEarnedAt: 'reclaim',
  voucherSentAt: 'quarantine',
};

/** 선점 결과. 호출부는 claimed 가 true 일 때만 외부 작업을 실행해야 한다. */
export const CLAIM = {
  CLAIMED: 'claimed',
  ALREADY_COMPLETED: 'already_completed',
  IN_FLIGHT: 'in_flight',
  OUTCOME_UNKNOWN: 'outcome_unknown',
  STORE_UNAVAILABLE: 'store_unavailable',
};

/**
 * 단계 선점 — transaction 안에서 원자적으로.
 *
 * 🔴 이전 구현의 치명적 기본값: Firestore 가 없거나 transaction 이 실패하면 `true` 를 돌려
 *   **외부 작업을 그냥 진행**했다(fail-open). 중복 방지 장치가 죽었는데 중복 위험이 있는
 *   작업은 계속 나가는 구조라, Firestore 장애 시 확인 메일이 손님에게 여러 번 갔다.
 *   → 이제 선점 저장소가 불능이면 외부 작업을 **멈추고** 재시도 상태로 남긴다.
 *
 * @param {{db: object, FieldValue?: object, orderID: string, field: string, nowMs?: number}} args
 * @returns {Promise<{claimed: boolean, reason: string}>}
 */
export async function claimStep({ db, orderID, field, nowMs } = {}) {
  if (!db || !orderID || !field) {
    return { claimed: false, reason: CLAIM.STORE_UNAVAILABLE };
  }
  const now = Number(nowMs) || Date.now();
  const stateField = stepStateField(field);
  const policy = STEP_ZOMBIE_POLICY[field] || 'quarantine';
  const ref = db.collection('bookings').doc(orderID);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};

    if (isStepCompleted(data, field)) {
      return { claimed: false, reason: CLAIM.ALREADY_COMPLETED };
    }
    const state = data[stateField];
    if (state === CLAIM.OUTCOME_UNKNOWN) {
      return { claimed: false, reason: CLAIM.OUTCOME_UNKNOWN };
    }
    if (state === 'in_progress') {
      const startedMs = Number(data[`${stateField}At`]) || 0;
      if (startedMs && now - startedMs < STEP_CLAIM_STALE_MS) {
        return { claimed: false, reason: CLAIM.IN_FLIGHT };
      }
      if (policy === 'quarantine') {
        // 보냈는지 알 수 없다 → 다시 보내지 않고 운영자 검토 대기로 격리.
        tx.set(ref, {
          [stateField]: CLAIM.OUTCOME_UNKNOWN,
          [`${stateField}UnknownAtMs`]: now,
          [`${stateField}UnknownReason`]: 'claim_expired_without_completion',
        }, { merge: true });
        return { claimed: false, reason: CLAIM.OUTCOME_UNKNOWN };
      }
      // reclaim — 외부 쪽 중복 방지 키가 있으므로 재실행해도 결과는 1건이다.
    }

    tx.set(ref, {
      [stateField]: 'in_progress',
      [`${stateField}At`]: now,
      [`${stateField}Attempts`]: (Number(data[`${stateField}Attempts`]) || 0) + 1,
    }, { merge: true });
    return { claimed: true, reason: CLAIM.CLAIMED };
  });
}

/**
 * claimStep 의 예외까지 흡수한 버전 — **실패는 절대 "진행" 으로 해석하지 않는다.**
 * (이 함수가 true 를 돌려주는 유일한 경우는 transaction 이 실제로 커밋된 때다.)
 */
export async function claimStepSafe(args) {
  try {
    return await claimStep(args);
  } catch (e) {
    console.error(`[booking-idempotency] 선점 실패 — 외부 작업 중단(재시도 대기): ${e.message}`);
    return { claimed: false, reason: CLAIM.STORE_UNAVAILABLE };
  }
}

/** 단계 완료 확정 — **외부 작업이 실제로 성공한 뒤에만** 호출한다. */
export async function completeStep({ db, FieldValue, orderID, field, detail } = {}) {
  if (!db || !orderID || !field) throw new Error('completeStep: db/orderID/field required');
  const patch = {
    [field]: FieldValue ? FieldValue.serverTimestamp() : Date.now(),
    [stepStateField(field)]: 'completed',
  };
  if (detail && typeof detail === 'object') {
    patch[`${field}Detail`] = detail;
  }
  await db.collection('bookings').doc(orderID).set(patch, { merge: true });
}

/**
 * 외부 작업은 성공했는데 완료 기록을 못 남긴 상태 — 자동 재시도가 아니라 **검토 대기**.
 * (이 쓰기마저 실패하면 in_progress 로 남고, 다음 실행의 quarantine 정책이 같은 결론을 낸다.)
 */
export async function markOutcomeUnknown({ db, orderID, field, reason, nowMs } = {}) {
  if (!db || !orderID || !field) return false;
  const stateField = stepStateField(field);
  try {
    await db.collection('bookings').doc(orderID).set({
      [stateField]: CLAIM.OUTCOME_UNKNOWN,
      [`${stateField}UnknownAtMs`]: Number(nowMs) || Date.now(),
      [`${stateField}UnknownReason`]: String(reason || 'unknown').slice(0, 300),
    }, { merge: true });
    return true;
  } catch {
    return false;
  }
}
