/**
 * charter-extras.js — 차터 옵션(면허가이드·픽켓·카시트)·야간할증 청구 SSOT.
 *
 * 🔴 돈버그 fix (2026-07-18, 차터 전체점검): 위저드 Step5/Step6 는 옵션·야간할증을 표시
 * 총액(quote.subtotalKRW)에 포함했지만, 실제 청구(createPaypalOrder / resolve-line-item)는
 * 코어 상품가만 계산해 옵션 금액이 통째로 미청구됐다(표시 ₩424,800 vs 청구 ₩124,800 —
 * 면허가이드 예약당 ₩300,000 과소청구). 본 모듈이 청구 측 옵션 가산의 단일 정본이다.
 *
 * 프론트 미러 = src/lib/charterExtras.ts (useQuoteCalculator / resolveProductType 소비).
 * 변경 시 두 곳 동기 필수 — tests/unit/charter-extras-parity.test.ts 가 가드.
 *
 * 계산 규칙 (useQuoteCalculator 의 기존 표시 로직과 동일):
 *   - sprinter: 면허 가이드 동행이 법적 필수 → guide 요금 자동 가산, licensedGuide 옵션은 무시(중복 방지).
 *   - staria/staria_9: licensedGuide 옵션 선택 시 english_guide_per_day 가산.
 *   - airportPicket / childSeat: 선택 시 정액 가산.
 *   - night: (코어 + 옵션합) × night_surcharge_percent% 반올림.
 *   - 옵션 값은 boolean 만 신뢰 (문자열 'true' 등 위조 입력은 false 취급 — 과청구 방지 방향).
 */

/** 옵션 가산이 적용되는 차터 결제 상품군. combo/ai_planner/charter_custom_estimate 제외
 *  (custom_estimate 는 customAmountKRW 가 이미 위저드 견적 총액=옵션 포함이라 이중가산 금지). */
export function isCharterExtrasProduct(productType) {
  const pt = String(productType || '').replace(/-/g, '_');
  return (
    pt.startsWith('airport_') ||
    pt.startsWith('charter_seoul_') ||
    pt === 'charter_dmz' || pt === 'charter_gangwon' || pt === 'charter_ski' ||
    pt === 'charter_gyeongju' || pt === 'charter_busan' ||
    pt === 'tour_hourly' || pt === 'charter_transfer' || pt === 'charter_multiday' ||
    pt === 'kpop_shuttle_oneway' || pt === 'kpop_shuttle_roundtrip'
  );
}

/** 픽업시각(HH:mm) → 야간 여부 (18:00~05:59). 프론트 Step5DateOptions 자동 파생과 동일 규칙.
 *  유효한 시각이 아니면 null (판정 불가 — 클라 flag 사용). 서버가 직접 파생해 night flag
 *  위조(야간 예약을 night:false 로 보내 20% 할증 우회)를 차단한다. */
export function deriveNightFromPickup(pickupTime) {
  const m = String(pickupTime || '').match(/^([01]\d|2[0-3]):[0-5]\d/);
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 18 || h < 6;
}

/** body.options 위생 처리 — boolean true 만 통과. */
export function sanitizeCharterOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    licensedGuide: o.licensedGuide === true,
    airportPicket: o.airportPicket === true,
    childSeat: o.childSeat === true,
    night: o.night === true,
  };
}

/**
 * 옵션·야간할증 KRW 산출.
 * @param {object} SPEC     pricing_spec.json
 * @param {number} coreKrw  코어 상품가 (야간할증 기준액에 포함)
 * @param {{vehicle?:string, options?:object}} input
 * @returns {{addons:Array<{key:string, amountKRW:number}>, addonsKRW:number, surchargeKRW:number, totalKRW:number}}
 */
export function charterExtrasKrw(SPEC, coreKrw, input) {
  const empty = { addons: [], addonsKRW: 0, surchargeKRW: 0, totalKRW: 0 };
  if (!SPEC || !SPEC.extra_charges) return empty;
  const core = Number(coreKrw);
  if (!Number.isFinite(core) || core <= 0) return empty;

  const ec = SPEC.extra_charges;
  const vehicle = typeof (input && input.vehicle) === 'string' ? input.vehicle : '';
  const opt = sanitizeCharterOptions(input && input.options);

  const addons = [];
  if (vehicle === 'sprinter') {
    // 법적 필수 가이드 — 옵션 여부와 무관하게 자동 가산 (licensedGuide 무시 = 이중가산 방지).
    const sprinterGuide = (SPEC.vehicles && SPEC.vehicles.sprinter && SPEC.vehicles.sprinter.guide_daily_fee)
      || ec.licensed_guide_per_day || 300000;
    addons.push({ key: 'guide_required', amountKRW: sprinterGuide });
  } else if (opt.licensedGuide) {
    addons.push({ key: 'licensed_guide', amountKRW: ec.english_guide_per_day || 300000 });
  }
  if (opt.airportPicket) addons.push({ key: 'airport_picket', amountKRW: ec.airport_picket_service || 20000 });
  if (opt.childSeat) addons.push({ key: 'child_seat', amountKRW: ec.child_seat_per_trip || 20000 });

  const addonsKRW = addons.reduce((s, a) => s + a.amountKRW, 0);
  const nightPct = ec.night_surcharge_percent || 20;
  const surchargeKRW = opt.night ? Math.round((core + addonsKRW) * (nightPct / 100)) : 0;

  return { addons, addonsKRW, surchargeKRW, totalKRW: addonsKRW + surchargeKRW };
}
