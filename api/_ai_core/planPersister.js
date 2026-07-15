/**
 * T-money calculation + Firestore plan persistence.
 * Extracted verbatim from api/ai-planner-full.js L1074-1172.
 * Contains ?? at L1123/L1124 (body.adults ?? pax, body.children ?? 0).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { computeQualityScore } from './qualityMetrics.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { detectPaymentSource, isAdminBypassOrderId, isOperatorTestEmail } from '../_shared/admin-bypass-detector.js';
import { beginPlanCommit, finalizePlanIssuance } from '../_shared/plan-issuance.js';

/**
 * P112 (2026-05-20): end_time backfill. plan 4792076e dump 결과 29/29 stops 의
 * end_time = undefined. UI 가 "15:45-undefined" 류 표시 위험 + PDF/email/voucher
 * 같은 downstream surface 가 end_time 가정. start_time + stay_min 으로 자동
 * 계산. Gemini/RouteAgent 가 이미 채웠으면 (시간 stitching 결과) override X.
 *
 * stay_min 0 이면 end_time = start_time (transit-only stop). stay_min 음수/
 * NaN 이면 graceful skip (corruption 차단).
 *
 * @param {string} startHHMM  "HH:mm" 형식
 * @param {number} stayMin    체류 분
 * @returns {string|null}     "HH:mm" 또는 input 비정상이면 null
 */
export function computeEndTime(startHHMM, stayMin) {
  if (typeof startHHMM !== 'string' || !/^\d{1,2}:\d{2}$/.test(startHHMM)) return null;
  // 명시적 null/undefined reject — Number(null) === 0 통과 차단.
  if (stayMin === null || stayMin === undefined) return null;
  const stay = Number(stayMin);
  if (!Number.isFinite(stay) || stay < 0) return null;
  const [h, m] = startHHMM.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  const totalMin = h * 60 + m + Math.floor(stay);
  // 24h+ wrap-around (예: Day 5 의 새벽 stop) — modulo 24h.
  const wrapped = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const eh = Math.floor(wrapped / 60);
  const em = wrapped % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

/**
 * P112: 모든 stop 에 end_time 채우기 (없는 경우만). Gemini 또는 RouteAgent 가
 * 이미 채웠으면 override X (timeline stitching 결과 존중).
 */
export function backfillStopEndTimes(itinerary) {
  let filled = 0;
  for (const day of (itinerary?.days || [])) {
    for (const stop of (day?.stops || [])) {
      if (stop.end_time && /^\d{1,2}:\d{2}$/.test(stop.end_time)) continue;
      const computed = computeEndTime(stop.start_time, stop.stay_min);
      if (computed) {
        stop.end_time = computed;
        filled += 1;
      }
    }
  }
  if (filled > 0) console.log(`[planPersister] end_time backfilled: ${filled} stops`);
  return filled;
}

/**
 * P119 (2026-05-20): day.lodging 필드 backfill. plan 4792076e dump 결과 모든
 * day 의 day.lodging = undefined. RouteAgent Phase 2.4 의 prevDayHotelCoord null
 * → KTX intercity bookend 누락 silent fail (P111 alert 대상). buildPrompt 보강
 * (day.lodging 명시 지시) 의 안전망 — Gemini 비결정성으로 day.lodging 누락 시
 * stops[] 의 lodging category stops 로 자동 채우기.
 *
 * 선택 logic (5/20 plan 4792076e 검증 결과 정정):
 *   - city-change arrival day (intercity_transit 있고 to_city === day.city 이며
 *     lodgings >= 2): **마지막 lodging** (도착 city check-in 호텔) — Day3 Seoul→Busan
 *     의 경우 stops[0]=명동(checkout) / stops[last]=해운대(check-in). 의도된
 *     day.lodging = 해운대 (Busan).
 *   - 그 외 (일반 day, 출국 day, lodging 부족): **첫 lodging** (시작 호텔) —
 *     일반 day 는 first=last 동일. 출국 day 는 checkout 호텔.
 *
 * 이미 day.lodging.name 또는 address 있으면 override X.
 */
export function backfillDayLodging(itinerary, hotelByCity = {}) {
  let filled = 0;
  // P123 (2026-05-20): hotelByCity Record (사용자 wizard 도시별 호텔 input) 우선.
  // Gemini 응답이 wrong-city 호텔 박았을 때 사용자가 직접 명시한 도시별 호텔로 override.
  const hbc = (hotelByCity && typeof hotelByCity === 'object') ? hotelByCity : {};
  for (const day of (itinerary?.days || [])) {
    if (day?.lodging && (day.lodging.name || day.lodging.address)) continue;
    const dayCityLc = String(day?.city || '').trim().toLowerCase();
    // P123: 사용자 명시 hotelByCity 우선 — Gemini stops 보다 신뢰.
    if (dayCityLc && hbc[dayCityLc] && typeof hbc[dayCityLc] === 'string' && hbc[dayCityLc].trim()) {
      // P322 (2026-05-31): name 도 도시 호텔로 세팅 (기존 name:null → selfHealLodgingBookend 이
      // 전역 ctx.hotel_address[첫도시] 로 fallback → 부산 day 에 서울 호텔명 박히는 자가모순).
      // block_mode 다도시 SAFETY: name=address=해당 도시 호텔. legacy 는 day.lodging 존재로 skip(L83).
      const _cityHotel = hbc[dayCityLc].trim();
      day.lodging = { name: _cityHotel, address: _cityHotel };
      filled += 1;
      continue;
    }
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    const lodgingStops = stops.filter((s) => s?.category === 'lodging');
    if (lodgingStops.length === 0) continue;

    const toCity = String(day?.intercity_transit?.to_city || '').trim().toLowerCase();
    const dayCity = String(day?.city || '').trim().toLowerCase();
    const isArrivalDay =
      !!day?.intercity_transit && toCity && dayCity && toCity === dayCity &&
      lodgingStops.length >= 2;

    const target = isArrivalDay ? lodgingStops[lodgingStops.length - 1] : lodgingStops[0];

    // P122 (2026-05-20): city mismatch 가드. Gemini 가 wrong-city 호텔 stop 을
    // 첫 lodging 으로 박은 경우 (예: Day 4 city=Busan 인데 stops[0]="명동 호텔")
    // backfill 하면 사용자에게 wrong city 호텔 노출. day.lodging 미설정이 더 안전
    // (UI / RouteAgent 가 graceful fallback).
    const targetName = String(target.name || target.display_name || '').toLowerCase();
    const targetAddr = String(target.address || '').toLowerCase();
    const CITY_KOR = {
      seoul: '서울', busan: '부산', jeju: '제주', gyeongju: '경주',
      jeonju: '전주', gangneung: '강릉', sokcho: '속초', incheon: '인천',
      daegu: '대구', daejeon: '대전', gwangju: '광주', suwon: '수원',
    };
    const kor = dayCity ? CITY_KOR[dayCity] : '';
    const cityMatched = !dayCity || (targetName + ' ' + targetAddr).includes(dayCity) ||
      (kor && (targetName.includes(kor) || targetAddr.includes(kor)));

    if (!cityMatched) {
      console.warn(`[planPersister] day.lodging skip (P122 city mismatch): day.city=${day.city}, target.name="${target.name || target.display_name}"`);
      continue;
    }

    day.lodging = {
      name: String(target.name || target.display_name || '').trim() || null,
      address: String(target.address || '').trim() || null,
    };
    if (day.lodging.name || day.lodging.address) {
      filled += 1;
    }
  }
  if (filled > 0) console.log(`[planPersister] day.lodging backfilled: ${filled} days`);
  return filled;
}

/**
 * P162 (2026-05-23): daily_budget_summary self-heal.
 *
 * Gemini 가 daily_budget_summary 전부 빈 객체로 출력하는 회귀 (plan 36c12df2).
 * 사용자 화면에서 일별 예산 카드 빈 칸 → 결제 후 가치 체감 저하.
 *
 * 전략 (stop 데이터 기반 추정):
 *   - food per day = food stop 수 × 15,000 KRW
 *   - attraction per day = attraction stop 수 × 10,000 KRW (입장료 추정)
 *   - transport per day = 0 (server T-money + ODsay 가 별도 계산)
 *   - misc per day = 10,000 KRW (잡비)
 *   - total = food + attraction + transport + misc
 *
 * 이미 daily_budget_summary 가 채워진 day 는 skip (Gemini 응답 존중).
 *
 * @param {object} itinerary - mutated in-place
 * @returns {number} heal 된 day 수
 */
export function selfHealDailyBudget(itinerary, ctx = {}) {
  if (!itinerary || typeof itinerary !== 'object') return 0;
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  if (days.length === 0) return 0;
  // P289 (2026-05-29): pax 기반 personalize — generic 추정 → 인원 곱셈. cache miss risk 0.
  const pax = Math.max(1, Math.min(20, Number(ctx?.pax) || 2));

  // P299/B2 (2026-05-29) — SSOT = root level itinerary.daily_budget_summary 배열.
  //   BudgetTable.tsx:9-15 + pdfGenerator:392 + OutroSlide:72 모두 root array 를 읽음.
  //   필드명 = transport_krw / entry_fees_krw / meals_krw / total_krw (BudgetTable + Gemini P291 schema 일치).
  //   기존 P162/P289 가 per-day day.daily_budget_summary 에 food/transport (suffix 없음) 채워
  //   frontend 가 못 읽고 예산표 전부 0원 (6월 상용화 audit B2). → root array + 필드명 통일.
  //   Gemini (P291 schema) 가 root array 를 이미 유효하게 채웠으면 skip (덮어쓰기 금지 — P196 역효과 회피).
  const existingRoot = Array.isArray(itinerary.daily_budget_summary) ? itinerary.daily_budget_summary : null;
  const rootValid = !!existingRoot && existingRoot.length > 0 &&
    existingRoot.some((b) => ((Number(b?.total_krw) || 0) + (Number(b?.meals_krw) || 0) + (Number(b?.transport_krw) || 0) + (Number(b?.entry_fees_krw) || 0)) > 0);
  if (rootValid) return 0;

  // root array 생성 (stop count 기반 추정 + pax 곱셈).
  const rows = days.map((day) => {
    const stops = Array.isArray(day.stops) ? day.stops : [];
    let foodCount = 0;
    let attrCount = 0;
    for (const s of stops) {
      const cat = String(s?.category || '').toLowerCase();
      if (cat === 'food') foodCount++;
      else if (cat === 'attraction') attrCount++;
    }
    // pax 곱셈 — 식사/입장료/잡비 인원 비례. transport 만 server T-money + ODsay 별도 계산.
    const meals_krw = foodCount * 15000 * pax;
    const entry_fees_krw = attrCount * 10000 * pax;
    // [#2 HIGH] intercity_transit (KTX/항공/버스) 요금을 예산표 transport_krw 에 반영.
    //   서울↔부산 KTX(~₩59,800)·제주 항공 등은 day.intercity_transit.est_fare_krw 에 1인당
    //   요금이 들어있는데(RouteAgent intercity 채움) 기존 하드코딩 0 으로 예산표에 빠져 있었다.
    //   est_fare_krw = 1인 요금 → ×pax. 시내 대중교통(T-money)·ODsay 는 server 별도이므로 여기 미포함.
    //   nullish ?? 금지 → || 사용 (intercity 없는 day 는 0 유지 = 기존 동작 byte-identical).
    const intercityFarePerPax = Number(day?.intercity_transit?.est_fare_krw) || 0;
    const transport_krw = intercityFarePerPax * pax;
    const misc_krw = 10000 * pax; // 잡비 — BudgetTable 미표시, total 합산만.
    const total_krw = meals_krw + entry_fees_krw + transport_krw + misc_krw;
    return {
      day: day.day,
      transport_krw, entry_fees_krw, meals_krw, total_krw,
      activities_krw: 0, shopping_estimate_krw: 0,
      _self_healed: true,
      _pax: pax, // P289: admin panel 추적용
    };
  });
  itinerary.daily_budget_summary = rows;
  itinerary.quality_warnings = itinerary.quality_warnings || [];
  itinerary.quality_warnings.push({
    kind: 'daily_budget_self_healed',
    type: 'daily_budget_self_healed',
    severity: 'low',
    message: `daily_budget_summary 누락 → ${rows.length}일 root array 추정값 자동 생성 (P162/B2, pax=${pax})`,
    healed_days: rows.length,
  });
  console.log(`[planPersister] P162/B2 daily_budget self-healed (root array): ${rows.length} days, pax=${pax}`);
  return rows.length;
}

// ── P152 (2026-05-22): cross-city lodging 강제 교정용 도시 메타 ────────────────
const CITY_KOR_MAP_FULL = {
  seoul: '서울', busan: '부산', jeju: '제주', gyeongju: '경주',
  jeonju: '전주', gangneung: '강릉', sokcho: '속초',
  incheon: '인천', daegu: '대구', daejeon: '대전', gwangju: '광주',
};

const CITY_LODGING_DEFAULT = {
  seoul:     { defaultZone: '명동',     placeholder: '명동 지역 숙소' },
  busan:     { defaultZone: '해운대',   placeholder: '해운대 지역 숙소' },
  jeju:      { defaultZone: '제주시',   placeholder: '제주시 지역 숙소' },
  gyeongju:  { defaultZone: '보문',     placeholder: '보문 지역 숙소' },
  jeonju:    { defaultZone: '한옥마을', placeholder: '한옥마을 지역 숙소' },
  gangneung: { defaultZone: '경포',     placeholder: '경포 지역 숙소' },
  sokcho:    { defaultZone: '속초해변', placeholder: '속초해변 지역 숙소' },
};

// P-launch (2026-05-31): 합성 lodging bookend stop 용 4개국어 generic tip.
// block_mode 는 zone_courses 블록에 lodging stop 이 없어 backend 가 호텔 bookend 를 합성하는데,
// 합성 stop 에 tip 이 없어 호텔 카드가 빈약해 보였다(plan a8b96f91 호텔 10 stop tip 0). 정적 generic
// tip 으로 채움 (venue-specific 주장 없음 = 사실 오류 위험 0, buildPrompt 변경 0 = cache-safe).
const LODGING_BOOKEND_TIP = {
  depart: {
    ko: '체크아웃 후 짐은 호텔 프런트에 맡기면 당일 일정이 한결 가볍습니다.',
    en: 'Leave your luggage at the front desk after check-out to explore the day lighter.',
    ja: 'チェックアウト後、荷物はフロントに預けると当日の観光が身軽になります。',
    zh: '退房后可将行李寄存在前台，当天行程更轻松。',
  },
  return: {
    ko: '늦게 도착할 예정이면 호텔에 체크인 시간을 미리 알려두면 편합니다.',
    en: 'If you expect to arrive late, let the hotel know your check-in time in advance.',
    ja: '遅い到着の場合は、ホテルにチェックイン時間を事前に伝えておくと安心です。',
    zh: '若预计较晚到达，建议提前告知酒店入住时间。',
  },
};
function lodgingBookendTip(role, lang) {
  const t = LODGING_BOOKEND_TIP[role] || LODGING_BOOKEND_TIP.return;
  return t[lang] || t.en;
}

// P156 (2026-05-22): 동네/랜드마크 → 도시 매핑. P152 의 도시명 매칭이 못 잡는
// "황리단길 호텔" (Gyeongju 동네명만 있고 "경주" 미명시) 같은 케이스 보강.
// prod 시뮬레이션 잔여 B-13 fail 2건의 원인.
const NEIGHBORHOOD_TO_CITY = {
  // Seoul
  '명동': 'seoul', '홍대': 'seoul', '강남': 'seoul', '이태원': 'seoul',
  '잠실': 'seoul', '종로': 'seoul', '익선동': 'seoul', '성수동': 'seoul',
  '한남동': 'seoul', '망원동': 'seoul', '연남동': 'seoul', '북촌': 'seoul',
  '인사동': 'seoul', '광화문': 'seoul', '서울역': 'seoul', '동대문': 'seoul',
  // Busan
  '해운대': 'busan', '광안리': 'busan', '서면': 'busan', '남포동': 'busan',
  '송도': 'busan', '자갈치': 'busan', '기장': 'busan', '센텀시티': 'busan',
  // Jeju
  '중문': 'jeju', '노형': 'jeju', '성산': 'jeju', '서귀포': 'jeju',
  '함덕': 'jeju', '협재': 'jeju',
  // Gyeongju
  '황리단길': 'gyeongju', '황남동': 'gyeongju', '보문': 'gyeongju',
  '대릉원': 'gyeongju', '동궁': 'gyeongju', '안압지': 'gyeongju',
  // Jeonju
  '한옥마을': 'jeonju', '객사': 'jeonju', '풍남동': 'jeonju',
  // Gangneung
  '경포': 'gangneung', '안목해변': 'gangneung', '주문진': 'gangneung',
  // Sokcho
  '속초해변': 'sokcho', '설악산': 'sokcho', '대포항': 'sokcho',
};

/**
 * P152 (2026-05-22): cross-city lodging stops 강제 교정.
 *
 * 9-시나리오 시뮬레이션 결과 7/9 실패 (D2(Busan):"서울역 호텔" / D4(Seoul):"제주시
 * 호텔" 등). buildPrompt + userMessageBuilder layer 만으로는 Gemini 비결정성을 못 잡음.
 *
 * 본 함수: 각 day 의 lodging stops 의 name/address 가 day.city 와 다른 도시를 명시적
 * 언급하면 도시 적절 placeholder 로 강제 override. 사용자 hotelByCity > recommendedZones
 * > default placeholder 순으로 fallback. 모든 교정 이력은 quality_warnings 에 박제 →
 * 운영자 UI panel (P121) 즉시 노출.
 *
 * stops[i].name/address override + `_corrected_cross_city: true` flag set.
 *
 * @param {object} itinerary
 * @param {object} hotelByCity        { seoul: "명동 호텔...", busan: "해운대..." } 사용자 입력
 * @param {object} recommendedZones   { seoul: "myeongdong", busan: "haeundae" } 사용자 zone
 * @returns {Array<object>} 교정 이력
 */
export function correctCrossCityLodgingStops(itinerary, hotelByCity = {}, recommendedZones = {}) {
  const violations = [];
  const hbc = (hotelByCity && typeof hotelByCity === 'object') ? hotelByCity : {};
  const rz  = (recommendedZones && typeof recommendedZones === 'object') ? recommendedZones : {};

  for (const day of (itinerary?.days || [])) {
    const dayCityLc = String(day?.city || '').trim().toLowerCase();
    if (!dayCityLc) continue;
    const dayCityKor = CITY_KOR_MAP_FULL[dayCityLc] || '';
    const otherCities = Object.keys(CITY_KOR_MAP_FULL).filter((c) => c !== dayCityLc);
    const stops = Array.isArray(day?.stops) ? day.stops : [];

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      if (stop?.category !== 'lodging') continue;
      const textRaw = `${stop.name || ''} ${stop.address || ''} ${stop.display_name || ''}`;
      const text = textRaw.toLowerCase();

      // 다른 도시 명시적 언급 detect — substring false positive 차단.
      // 예: "해운대구" 안에 "대구" substring 매칭 X. "광역시" suffix 또는
      //     word-boundary 컨텍스트만 인정.
      const conflictingCity = otherCities.find((other) => {
        // 1) English: word boundary
        const enRegex = new RegExp(`\\b${other}\\b`, 'i');
        if (enRegex.test(textRaw)) return true;
        const otherKor = CITY_KOR_MAP_FULL[other];
        if (!otherKor) return false;
        // 2) Korean: 명시적 행정구역 suffix (광역시/특별시/특별자치도/특별자치시/시/도)
        if (text.includes(`${otherKor}광역시`)) return true;
        if (text.includes(`${otherKor}특별시`)) return true;
        if (text.includes(`${otherKor}특별자치도`)) return true;
        if (text.includes(`${otherKor}특별자치시`)) return true;
        // P156: 일반 "시" suffix — 경주시 / 전주시 / 강릉시 / 속초시 등.
        if (text.includes(`${otherKor}시`)) return true;
        // 3) standalone (preceded/followed by space, start, end, or punctuation)
        const korStandaloneRegex = new RegExp(`(^|[\\s,，.()\\[\\]])${otherKor}($|[\\s,，.()\\[\\]])`);
        if (korStandaloneRegex.test(textRaw)) return true;
        return false;
      });
      // P156 (2026-05-22): 동네/랜드마크 sweep — "황리단길 호텔" 처럼 도시명 없이
      // 동네명만 있는 케이스. day.city 와 다른 도시의 동네명이 있으면 violation.
      let detectedConflict = conflictingCity;
      if (!detectedConflict) {
        for (const [nbhd, ownerCity] of Object.entries(NEIGHBORHOOD_TO_CITY)) {
          if (ownerCity === dayCityLc) continue; // same city — OK
          if (text.includes(nbhd.toLowerCase())) {
            detectedConflict = ownerCity;
            break;
          }
        }
      }
      if (!detectedConflict) continue;
      // Re-assign so downstream `conflictingCity` references work uniformly.
      // eslint-disable-next-line no-const-assign
      const _conflictAsKey = detectedConflict;

      // 교정 placeholder 결정 (사용자 hotelByCity > zone > default 순)
      let newName, newAddress;
      const defaultMeta = CITY_LODGING_DEFAULT[dayCityLc];
      if (hbc[dayCityLc] && typeof hbc[dayCityLc] === 'string' && hbc[dayCityLc].trim()) {
        // P297 (2026-05-29): personalize — 사용자 입력 호텔명/주소를 name 에도 사용.
        //   기존엔 newName 을 generic "서울 호텔" 로 박아 plan 03cac32d Day 5 처럼
        //   addr="명동 신라스테이" 인데 name="서울 호텔" 자가 불일치 발생 (P290 패턴 누락).
        //   사용자가 "명동 신라스테이" 입력 → cross-city 교정 후에도 그 호텔명 유지.
        const userHotel = hbc[dayCityLc].trim();
        newAddress = userHotel;
        newName    = userHotel;
      } else if (rz[dayCityLc]) {
        const zone = String(rz[dayCityLc]).trim();
        newName    = `${zone} 일대 숙소`;
        newAddress = `${dayCityKor || dayCityLc} ${zone}`;
      } else if (defaultMeta) {
        newName    = defaultMeta.placeholder;
        newAddress = `${dayCityKor || dayCityLc} ${defaultMeta.defaultZone}`;
      } else {
        newName    = `${dayCityKor || dayCityLc} 지역 숙소`;
        newAddress = dayCityKor || dayCityLc;
      }

      const originalName = stop.name;
      const originalAddr = stop.address;
      stop.name = newName;
      stop.address = newAddress;
      stop._corrected_cross_city = true;

      violations.push({
        day: day?.day || day?.day_index || 0,
        stop_index: i,
        day_city: day.city,
        conflicting_city: _conflictAsKey,
        original_name: originalName,
        original_address: originalAddr,
        corrected_name: newName,
        corrected_address: newAddress,
      });
    }
  }

  if (violations.length > 0) {
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    for (const v of violations) {
      itinerary.quality_warnings.push({
        kind: 'cross_city_lodging_corrected',
        // P161 (2026-05-23): UI panel (QualityWarningsPanel) heading 은 w.type 읽음 →
        // 누락 시 undefined 노출. kind/type 양쪽 mirror 로 panel + JSON dump 양쪽 호환.
        type: 'cross_city_lodging_corrected',
        severity: 'medium',
        message: `Day ${v.day} (${v.day_city}): "${v.original_name}" → "${v.corrected_name}" (다른 도시 "${v.conflicting_city}" 호텔 자동 교정)`,
        ...v,
      });
    }
    console.log(`[planPersister] P152 cross-city lodging corrected: ${violations.length} stops`);
  }

  return violations;
}

/**
 * P160 (2026-05-22): B-10 lodging bookend self-heal.
 *
 * 상용화 D-day prod alert: "Day 3: stops[0].category='food' expected 'lodging' (B-10)".
 * Gemini 가 lodging bookend 룰을 가끔 어김 → customer path 면 throw 500.
 *
 * Self-heal 전략:
 *   - 첫 stop 이 lodging 아니면 day.lodging 정보로 synthetic lodging stop 을 stops[0] 앞에 prepend.
 *   - day.lodging 없으면 city-default placeholder 사용 (해운대 호텔 / 명동 호텔 등).
 *   - 마지막 stop 도 lodging|travel|airport 아니면 (단 출국일 제외) 동일하게 append.
 *
 * Quality_warnings 박제 — 운영자 가 Gemini 누락 빈도 추적 가능.
 *
 * P290 (2026-05-29): ctx personalize — P288/P289 패턴 동일. 단일 도시 plan +
 *   사용자 hotel_address / recommendedZone 입력 시 placeholder 대신 user input 사용.
 *   day.lodging?.name 우선 (multi-city plan 의 city-별 호텔 보존). day.lodging
 *   없을 때만 ctx fallback. Gemini prompt 변경 0 = cache miss risk 0.
 *
 * @param {object} itinerary - mutated in-place
 * @param {object} ctx - { hotel_address, recommendedZone } (optional)
 * @returns {Array<object>} prepend/append 이력
 */
export function selfHealLodgingBookend(itinerary, ctx = {}) {
  const healed = [];
  const days = itinerary?.days || [];
  // P-launch (2026-05-31): 합성 호텔 stop tip 언어 + block_mode 정상 bookend 표시.
  const language = (ctx.language && ['ko', 'en', 'ja', 'zh'].includes(ctx.language)) ? ctx.language : 'ko';
  const isBlockMode = !!ctx.blockMode;
  // P290 (2026-05-29): ctx fallback — day.lodging 없을 때 사용. day.lodging?.name
  //   우선 (multi-city 보존). hotel_address 가 정확 주소 형태이므로 synName/synAddress
  //   둘 다 사용 (placeholder "해운대 호텔" 보다 "OO 호텔" 이 user-meaningful).
  //   recommendedZone (예: "Myeongdong") 은 synName 만 "{zone} 지역 숙소" 형태.
  const ctxHotelLabel = (ctx.hotel_address && String(ctx.hotel_address).trim()) || '';
  const ctxZoneLabel = (ctx.recommendedZone && String(ctx.recommendedZone).trim()) || '';
  // P-multicity-lodging (2026-06-02): ctx.hotel_address / recommendedZone 은 trip-level 단일값
  //   (첫 도시 기준 1개). 다도시 plan 의 다른 도시 day 에 그대로 쓰면 "부산인데 서울 중구 명동역"
  //   지리 파탄 (운영자 신고 plan 4d214e83: D4·D5 busan 인데 lodging=서울 명동역). → trip-level
  //   단일 ctx 는 첫 도시(days[0].city) day 에만 적용하고, 다른 도시 day 는 day.city 별
  //   CITY_LODGING_DEFAULT(도시별 한국어 zone, 예: busan→해운대) 로 폴백. 좌표/transit 은
  //   RouteAgent.getDayHotelCoord 가 이미 도시별 → 이름만 정합시키면 일관.
  //   legacy(day.city 없음)/단도시 plan → 전 day 가 첫 도시로 판정 = 기존 동작 byte-identical(회귀 0).
  const firstCityLc = String(days[0]?.city || '').trim().toLowerCase();
  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    if (stops.length === 0) continue;

    const dayCityLc = String(day?.city || '').trim().toLowerCase();
    const defaultMeta = CITY_LODGING_DEFAULT[dayCityLc];
    const dayCityKor = CITY_KOR_MAP_FULL[dayCityLc] || '';
    // trip-level 단일 ctx(hotel/zone)는 첫 도시 day 에만. 다른 도시 day 는 CITY_LODGING_DEFAULT.
    const isFirstCityDay = !firstCityLc || !dayCityLc || dayCityLc === firstCityLc;
    const tripCtxHotel = isFirstCityDay ? ctxHotelLabel : '';
    const tripCtxZone = isFirstCityDay ? ctxZoneLabel : '';
    // P290 fallback chain (day.lodging 없을 때만 발동):
    //   1. tripCtxHotel (사용자 입력 호텔 — 첫 도시 day 만)
    //   2. tripCtxZone 가공 → "{zone} 지역 숙소" (첫 도시 day 만)
    //   3. defaultMeta.placeholder (CITY_LODGING_DEFAULT — day.city 별, 다도시 다른 도시 핵심 경로)
    //   4. generic "{city} 지역 숙소"
    const ctxFallbackName = tripCtxHotel
      || (tripCtxZone ? `${tripCtxZone} 지역 숙소` : '');
    const ctxFallbackAddress = tripCtxHotel
      || (tripCtxZone ? `${dayCityKor || dayCityLc} ${tripCtxZone}` : '');

    // 첫 stop 이 lodging 이 아니면 prepend
    if (stops[0]?.category !== 'lodging') {
      const synName    = day?.lodging?.name    || ctxFallbackName    || (defaultMeta ? defaultMeta.placeholder : `${dayCityKor || dayCityLc || '여행지'} 지역 숙소`);
      const synAddress = day?.lodging?.address || ctxFallbackAddress || (defaultMeta ? `${dayCityKor || dayCityLc} ${defaultMeta.defaultZone}` : (dayCityKor || dayCityLc || ''));
      // 첫 stop start_time 보다 1시간 이르게 설정 (logical 출발 시각)
      let synStart = '09:00';
      const firstTimeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(stops[0]?.start_time || ''));
      if (firstTimeMatch) {
        const fh = parseInt(firstTimeMatch[1], 10);
        const fm = parseInt(firstTimeMatch[2], 10);
        let earlierMin = fh * 60 + fm - 60;
        if (earlierMin < 9 * 60) earlierMin = 9 * 60; // 09:00 floor
        synStart = `${String(Math.floor(earlierMin / 60)).padStart(2, '0')}:${String(earlierMin % 60).padStart(2, '0')}`;
      }
      stops.unshift({
        category: 'lodging',
        name: synName,
        display_name: synName,
        address: synAddress,
        start_time: synStart,
        stay_min: 0,
        order: 0,
        tip: lodgingBookendTip('depart', language),
        _self_healed: true,
      });
      // 후속 order 재매핑
      for (let i = 0; i < stops.length; i++) {
        if (typeof stops[i].order === 'number') stops[i].order = i + 1;
      }
      healed.push({ day: day?.day || d + 1, kind: 'prepend_first_lodging', synthesized_name: synName });
    }

    // 마지막 stop 이 lodging/travel/airport 가 아니면 append (lodging)
    const last = stops[stops.length - 1];
    if (last && !['lodging', 'travel', 'airport'].includes(last.category)) {
      const synName    = day?.lodging?.name    || ctxFallbackName    || (defaultMeta ? defaultMeta.placeholder : `${dayCityKor || dayCityLc || '여행지'} 지역 숙소`);
      const synAddress = day?.lodging?.address || ctxFallbackAddress || (defaultMeta ? `${dayCityKor || dayCityLc} ${defaultMeta.defaultZone}` : (dayCityKor || dayCityLc || ''));
      // 마지막 stop end_time 또는 start_time 후 1시간
      let synStart = '21:00';
      const lastTimeStr = String(last.end_time || last.start_time || '');
      const lastTimeMatch = /^(\d{1,2}):(\d{2})$/.exec(lastTimeStr);
      if (lastTimeMatch) {
        const lh = parseInt(lastTimeMatch[1], 10);
        const lm = parseInt(lastTimeMatch[2], 10);
        let laterMin = lh * 60 + lm + 60;
        if (laterMin > 23 * 60 + 30) laterMin = 23 * 60 + 30; // 23:30 ceiling
        synStart = `${String(Math.floor(laterMin / 60)).padStart(2, '0')}:${String(laterMin % 60).padStart(2, '0')}`;
      }
      stops.push({
        category: 'lodging',
        name: synName,
        display_name: synName,
        address: synAddress,
        start_time: synStart,
        stay_min: 0,
        order: stops.length + 1,
        tip: lodgingBookendTip('return', language),
        _self_healed: true,
      });
      healed.push({ day: day?.day || d + 1, kind: 'append_last_lodging', synthesized_name: synName });
    }
  }

  if (healed.length > 0) {
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    for (const h of healed) {
      itinerary.quality_warnings.push({
        ...h,
        kind: 'lodging_bookend_self_healed',
        // P161 (2026-05-23): UI panel (QualityWarningsPanel) heading 은 w.type 읽음.
        type: 'lodging_bookend_self_healed',
        sub_kind: h.kind,
        severity: 'low',
        // P-launch (2026-05-31): block_mode 는 zone_courses 블록에 lodging 이 없어 호텔 bookend
        //   추가가 정상 동작 → 손님 패널(UserPlanNoticesPanel)에서 숨김. 관리자 패널엔 유지.
        //   legacy/Gemini plan 의 bookend 누락(expected_block_mode 미설정)은 진짜 이슈 → 노출.
        expected_block_mode: isBlockMode,
        message: `Day ${h.day}: ${h.kind === 'prepend_first_lodging' ? '첫' : '마지막'} stop lodging 누락 → "${h.synthesized_name}" 자동 prepend/append (P160)`,
      });
    }
    console.log(`[planPersister] P160 lodging bookend self-healed: ${healed.length} stops`);
  }
  return healed;
}

/**
 * P161 (2026-05-23): arrival_guide self-heal — Gemini 비결정성으로 통째 누락 시 5-step skeleton 생성.
 *
 * 사용자 신고 (plan 8e767d9c, 2026-05-23): "도착하면 어떻게 한국 입국하는 안내가 없어".
 * Gemini 가 가끔 arrival_guide 자체를 응답 root level 에 안 만들어 PDF/UI 의 Intro 다음
 * 빈 영역 발생. arrival_airport 가 있고 ALREADY 아닌데 itinerary.arrival_guide 가 falsy 면
 * 기본 5-step (Immigration / SIM / T-money / Currency / Get-to-Hotel) 합성 + quality_warnings 박제.
 *
 * P160 selfHealLodgingBookend 패턴과 동일 — postResponsePipeline.runRouteEnrichment 진입
 * 직후 (delete itinerary.arrival_guide 분기 다음) 호출. RouteAgent 가 step 5 의
 * transport_to_hotel 을 실제 데이터로 덮어씀.
 *
 * @param {object} itinerary - mutated in-place
 * @param {string} arrival_airport - "ICN T1" / "ICN T2" / "GMP" / "PUS" 등 (ALREADY 아님)
 * @returns {boolean} true = self-healed, false = no-op
 */
export function selfHealArrivalGuide(itinerary, arrival_airport, ctx = {}) {
  if (!itinerary || typeof itinerary !== 'object') return false;
  if (!arrival_airport || arrival_airport === 'ALREADY' || arrival_airport === 'already_in_korea') {
    return false;
  }
  // P288 (2026-05-29): ctx 활용 — Gemini prompt 변경 0 (cache miss risk 0).
  // P276+P277 (buildPrompt 강화) 의 대안: backend self_heal 시 user input 으로 step 5 personalize.
  const { hotel_address, recommendedZone, arrival_time } = ctx;
  const hotelLabel = (hotel_address && String(hotel_address).trim())
    || (recommendedZone && String(recommendedZone).trim())
    || 'your hotel';
  // late-night arrival (>=23:00) hint
  const arrivalHour = arrival_time && /^\d{1,2}:/.test(arrival_time) ? parseInt(String(arrival_time).slice(0, 2), 10) : null;
  const lateNightHint = arrivalHour !== null && (arrivalHour >= 23 || arrivalHour < 5)
    ? ' Late-night arrival — recommend taxi (no AREX after 23:00).'
    : '';
  // P205 (2026-05-26): arrival_guide 있는데 airport nested field 누락 시 self-heal.
  //   5/26 measure 5/5 sample 모두 arrival_guide.airport 정상이었지만 departure 누락.
  //   대칭 안전성 — Gemini 가 airport nested 누락 시 입력값으로 채움 (B-16 SAFETY 보장).
  const existing = itinerary.arrival_guide;
  if (existing && typeof existing === 'object' && !existing.airport) {
    existing.airport = arrival_airport;
    // steps 가 있으면 skeleton 재합성 불요 — airport 만 보충 후 return.
    if (Array.isArray(existing.steps) && existing.steps.length > 0) return true;
  }
  // 이미 arrival_guide 있고 steps 1개 이상이면 skeleton 재합성 불필요.
  if (existing && Array.isArray(existing.steps) && existing.steps.length > 0) {
    return false;
  }
  // 기본 5-step skeleton. RouteAgent 가 step 5 transport_to_hotel 덮어씀.
  itinerary.arrival_guide = {
    airport: arrival_airport,
    steps: [
      {
        step: 1,
        title: 'Immigration & Baggage',
        description: 'Pass immigration with arrival card + collect baggage at carousel.',
        est_min: 35,
      },
      {
        step: 2,
        title: 'Get Connected (SIM / Wi-Fi)',
        description: 'Pick up SIM card or portable Wi-Fi at airport kiosks.',
        est_min: 10,
        options: [
          { name: 'Physical SIM (KT/SKT)', price_krw: 33000, note: '5-day unlimited data' },
          { name: 'Portable Wi-Fi', price_krw: 5500, note: 'per day rental' },
          { name: 'eSIM (Klook)', price_krw: 15000, note: 'pre-purchase recommended' },
        ],
      },
      {
        step: 3,
        title: 'Get a T-money Card',
        description: 'Buy at CU/GS25 convenience store inside airport. Load amount calculated by server.',
        est_min: 5,
        t_money_card_cost_krw: 4000,
        t_money_recommended_load_krw: 0,
      },
      {
        step: 4,
        title: 'Currency & Payment Tips',
        description: 'Withdraw initial cash from ATM (Citi/KEB Hana ATMs accept foreign cards). Most stores accept card.',
        est_min: 5,
        recommended_cash_krw: 50000,
      },
      {
        step: 5,
        title: 'Get to Your Hotel',
        // P288 personalize: hotel/zone 명 + late-night hint 추가 (P276+P277 buildPrompt 대안).
        description: `Best transport option from ${arrival_airport} to ${hotelLabel}, based on group size + luggage.${lateNightHint} Backend RouteAgent populates transport_to_hotel with ODsay step-by-step routes.`,
        est_min: 0,
        transport_to_hotel: {
          arex_express: { price_krw: 9500, duration_min: 43, instruction: '' },
          arex_all_stop: { price_krw: 4150, duration_min: 66, instruction: '' },
          limousine_bus: { price_krw: 17000, duration_min: 70, instruction: '' },
          taxi: { est_price_krw: 75000, duration_min: 60, instruction: '' },
        },
        recommendation: 'Based on group size and luggage',
      },
    ],
    _self_healed: true,
  };
  // quality_warnings 박제
  itinerary.quality_warnings = itinerary.quality_warnings || [];
  itinerary.quality_warnings.push({
    kind: 'arrival_guide_self_healed',
    type: 'arrival_guide_self_healed',
    severity: 'medium',
    message: `arrival_guide 누락 (Gemini 응답에 없음) → ${arrival_airport} 기본 5-step skeleton 자동 합성. RouteAgent 가 transport_to_hotel 채움.`,
    airport: arrival_airport,
  });
  console.log(`[planPersister] P161 arrival_guide self-healed: airport=${arrival_airport}`);
  return true;
}

/**
 * P323 (2026-05-31): departure_guide 6필드 self-heal — block_mode 가 Gemini itinerary 를
 * 안 거쳐 departure_guide 가 airport(+route_to_airport)만 있고 나머지 6필드 누락 → 프론트
 * DepartureGuide.tsx 의 짐보관/세금환급/권장출발/막판쇼핑 카드가 안 보임 (prod plan b3ade000 = 1/7).
 * selfHealArrivalGuide(P161/P288) 대칭 — postResponsePipeline 의 departure_airport 보장 직후 호출.
 * RouteAgent 의 route_to_airport 는 보존(spread). Gemini prompt 변경 0 = cache miss 0 (P288/P289/P290 패턴).
 *
 * shape = 프론트 DepartureGuide.tsx 실제 렌더 필드 기준 (types.ts 는 일부 stale):
 *   luggage_storage.{available,location}, tax_refund.{location,threshold_krw}.
 *
 * @param {object} itinerary - mutated in-place
 * @param {string} departure_airport - "ICN T2" 등 (ALREADY 아님)
 * @param {object} ctx - { hotel_address, recommendedZone }
 * @returns {boolean} true = self-healed
 */
export function selfHealDepartureGuide(itinerary, departure_airport, ctx = {}) {
  if (!itinerary || typeof itinerary !== 'object') return false;
  if (!departure_airport || departure_airport === 'ALREADY' || departure_airport === 'already_in_korea') {
    return false;
  }
  const { hotel_address, recommendedZone, departureHotelLabel } = ctx;
  // P-launch (2026-05-31): 멀티시티 departure 는 마지막 도시 호텔 우선 (부산서 끝나면 "부산 호텔에서
  //   출발", 첫 도시 "명동" X — route_to_airport 와 일치). 단도시면 departureHotelLabel 없어 기존 동작.
  const hotelLabel = (departureHotelLabel && String(departureHotelLabel).trim())
    || (hotel_address && String(hotel_address).trim())
    || (recommendedZone && String(recommendedZone).trim())
    || 'your hotel';
  const existing = (itinerary.departure_guide && typeof itinerary.departure_guide === 'object')
    ? itinerary.departure_guide : {};
  // 이미 6필드 풍부 (recommended_departure_time + tax_refund) → no-op (Gemini legacy 응답 보존).
  if (existing.recommended_departure_time && existing.tax_refund) return false;
  // route_to_airport (RouteAgent attach) + airport 보존하며 6필드 합성.
  itinerary.departure_guide = {
    ...existing,
    airport: existing.airport || departure_airport,
    recommended_departure_time: existing.recommended_departure_time || '3 hours before your international flight',
    latest_leave_hotel: existing.latest_leave_hotel
      || `Leave ${hotelLabel} about 3.5 hours before departure (airport transit + check-in + security buffer).`,
    luggage_storage: existing.luggage_storage || {
      available: true,
      location: `${hotelLabel} front desk, or paid storage at ${departure_airport}.`,
    },
    tax_refund: existing.tax_refund || {
      location: `Tax refund kiosks at ${departure_airport} (before security / near check-in).`,
      threshold_krw: 30000,
    },
    last_minute_shopping: existing.last_minute_shopping
      || `Duty-free shopping at ${departure_airport} — Korean snacks, K-beauty, and gifts.`,
    _self_healed: true,
  };
  // quality_warnings 박제 (arrival 대칭, admin trace).
  itinerary.quality_warnings = itinerary.quality_warnings || [];
  itinerary.quality_warnings.push({
    kind: 'departure_guide_self_healed',
    type: 'departure_guide_self_healed',
    severity: 'medium',
    message: `departure_guide 6필드 누락 (block_mode/Gemini 미생성) → ${departure_airport} 기본 정보 자동 합성 (짐보관/세금환급/권장출발/막판쇼핑).`,
    airport: departure_airport,
  });
  console.log(`[planPersister] P323 departure_guide self-healed: airport=${departure_airport}`);
  return true;
}

/**
 * P120 (2026-05-20): 새벽 시간대 stops detect. plan 4792076e 의 Day3 00:31,
 * Day4 01:24, 03:26 같은 start_time = 사용자 실현 불가능 (새벽 관광 X). 회귀의
 * root cause 는 RouteAgent Phase 2.5/2.6 시간 stitching 의 transit time 누적
 * 검증 부재 — 24h modulo wrap-around 가 새벽 시각 silent 생성.
 *
 * 1차 fix (본 함수): 합리 시간대 [05:00, 23:59] 밖의 stop 발견 시 admin telegram
 * alert (P83 dedup 패턴). plan 저장은 non-blocking (사용자 영향 없음). root cause
 * fix 는 별도 후속 (RouteAgent stitching 검증 강화).
 *
 * @param {object} itinerary
 * @returns {Array<{day:number, stop:string, start_time:string, reason:string}>}
 */
export function detectUnreasonableStopTimes(itinerary) {
  const alerts = [];
  for (const day of (itinerary?.days || [])) {
    const dayNum = day?.day || day?.day_index || 0;
    for (const stop of (day?.stops || [])) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(stop?.start_time || ''));
      if (!m) continue;
      const hour = parseInt(m[1], 10);
      const minute = parseInt(m[2], 10);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
      // 합리 범위: 05:00 ~ 23:59 (24h 자체는 invalid time 이므로 별도 처리 X).
      // 새벽 0~4 시 = pre-dawn (관광/식사 불가).
      if (hour < 5) {
        alerts.push({
          day: dayNum,
          stop: String(stop?.name || stop?.display_name || '').slice(0, 80),
          start_time: stop.start_time,
          reason: 'pre-dawn (< 05:00) — 사용자 실현 불가',
        });
      }
    }
  }
  return alerts;
}

/**
 * P159 (2026-05-22): pre-dawn stops auto-correct.
 *
 * 상용화 D-day prod alert: customer 결제 후 UNREASONABLE_STOP_TIMES throw 500.
 * P120 detector 가 throw 로 사용자 결제 막던 회귀 — auto-fix 로 전환.
 *
 * 전략:
 *   - 첫 stop (lodging) 의 pre-dawn 시각 → 09:00 으로 push (관광 시작 표준 시각).
 *   - 후속 stops 는 (이전 stop end + 30min buffer) 로 cascade 재계산.
 *   - 마지막 lodging stop (복귀) 은 pre-dawn 이라도 그대로 (호텔 체크인 늦은 도착 가능).
 *
 * @param {object} itinerary - mutated in-place
 * @returns {number} 교정된 stop 수
 */
export function correctPreDawnStopTimes(itinerary) {
  let corrected = 0;
  const STANDARD_START_MIN = 9 * 60; // 09:00 KST 표준 관광 시작
  const STAY_BUFFER_MIN = 30;        // 이동 + 다음 stop 버퍼

  for (const day of (itinerary?.days || [])) {
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    if (stops.length === 0) continue;

    // 첫 stop pre-dawn detect
    const firstStop = stops[0];
    const firstTimeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(firstStop?.start_time || ''));
    if (!firstTimeMatch) continue;
    const firstHour = parseInt(firstTimeMatch[1], 10);
    if (!Number.isFinite(firstHour) || firstHour >= 5) continue;

    // 첫 stop pre-dawn → 09:00 reset + 후속 stops cascade
    const origFirst = firstStop.start_time;
    let currentMin = STANDARD_START_MIN;

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (i === 0) {
        s.start_time = formatMinAsHHMM(currentMin);
      } else {
        // 이전 stop end + buffer. ?? 로 0 을 0 으로 보존 (|| 는 0 → 60 falsy fall-through).
        const prevStop = stops[i - 1];
        const prevStayRaw = prevStop?.stay_min;
        const prevStayMin = (prevStayRaw === undefined || prevStayRaw === null || !Number.isFinite(Number(prevStayRaw)))
          ? 60
          : Number(prevStayRaw);
        currentMin += prevStayMin + STAY_BUFFER_MIN;
        if (currentMin >= 24 * 60) currentMin = 23 * 60 + 30; // 23:30 cap
        s.start_time = formatMinAsHHMM(currentMin);
      }
      // end_time 도 동기화 (있는 경우)
      if (s.stay_min !== undefined && s.stay_min !== null) {
        const stayMin = Number.isFinite(Number(s.stay_min)) ? Number(s.stay_min) : 0;
        const endMin = Math.min(currentMin + stayMin, 23 * 60 + 59);
        s.end_time = formatMinAsHHMM(endMin);
      }
      corrected++;
    }

    // quality_warnings 박제
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    itinerary.quality_warnings.push({
      kind: 'predawn_auto_corrected',
      // P161 (2026-05-23): UI panel (QualityWarningsPanel) heading 은 w.type 읽음.
      type: 'predawn_auto_corrected',
      severity: 'medium',
      day: day?.day || day?.day_index || 0,
      original_first_start_time: origFirst,
      corrected_first_start_time: stops[0].start_time,
      stops_recalculated: stops.length,
      message: `Day ${day?.day || '?'}: 첫 stop ${origFirst} → ${stops[0].start_time} 으로 auto-correct + ${stops.length} stops cascade 재계산`,
    });
  }

  if (corrected > 0) console.log(`[planPersister] P159 pre-dawn stops auto-corrected: ${corrected} stops`);
  return corrected;
}

function formatMinAsHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * P143 (2026-05-22): intercity_transit.arrival_at 와 day 첫 stop start_time 사이
 * 큰 공백 (> 90 min) detect. plan 209de47b (Seoul→Busan KTX 12:15 도착 → 첫 Busan
 * stop 17:43, 5h+ 공백) 같은 케이스: 사용자가 "서울에서 부산가는 과정이 엉터리야"
 * 신고. RouteAgent Phase 2.4 stitch 가 lodging_to_station null 일 때 동작 안 함
 * → Gemini 임의 값 그대로 통과. 이를 quality_warning 으로 박제 + admin UI 노출.
 *
 * @param {object} itinerary
 * @returns {Array<{day:number, intercity_arrival_at:string, first_stop_start:string, gap_min:number}>}
 */
export function detectIntercityFirstStopGap(itinerary) {
  const out = [];
  const GAP_THRESHOLD_MIN = 90;
  for (const day of (itinerary?.days || [])) {
    const it = day?.intercity_transit;
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    if (!it || !it.arrival_at || stops.length === 0) continue;
    // 첫 stop 의 start_time. lodging stop (도착 직후 호텔 체크인) 은 자연스러우니
    // 첫 non-lodging stop 도 함께 검사. lodging-only 첫 stop 도 30min+ buffer 까진 OK.
    const firstStop = stops[0];
    const firstStart = String(firstStop?.start_time || '');
    const arrM = /^(\d{1,2}):(\d{2})$/.exec(String(it.arrival_at));
    const stopM = /^(\d{1,2}):(\d{2})$/.exec(firstStart);
    if (!arrM || !stopM) continue;
    const arrMin = parseInt(arrM[1], 10) * 60 + parseInt(arrM[2], 10);
    const stopMin = parseInt(stopM[1], 10) * 60 + parseInt(stopM[2], 10);
    if (!Number.isFinite(arrMin) || !Number.isFinite(stopMin)) continue;
    if (stopMin <= arrMin) continue; // 첫 stop 이 KTX 도착 전 (= 이전 city stop) → 별도 회귀
    const gap = stopMin - arrMin;
    if (gap > GAP_THRESHOLD_MIN) {
      out.push({
        day: day?.day || 0,
        intercity_arrival_at: it.arrival_at,
        first_stop_start: firstStart,
        first_stop_name: String(firstStop?.name || firstStop?.display_name || '').slice(0, 80),
        gap_min: gap,
      });
    }
  }
  return out;
}

/**
 * P143: detectIntercityFirstStopGap → itinerary.quality_warnings push (UI 운영자 노출).
 * 운영자 plan 진단 panel (P121) 에서 즉시 보임. non-blocking (plan 저장 진행).
 *
 * P161 (2026-05-23): plan 8e767d9c quality_warnings[0]={kind:undefined,message:undefined}
 * 회귀 fix — 본 함수가 type/items 만 push 했지만 UI panel + 다른 self-heal 함수들은
 * kind/message 시그니처. 양쪽 호환을 위해 kind + type + message 동시 출력. items[].message
 * 도 그대로 유지 (UI panel detail).
 *
 * @param {object} itinerary - mutated: quality_warnings 추가
 * @returns {number} 감지 건수
 */
export function pushIntercityGapWarnings(itinerary) {
  const gaps = detectIntercityFirstStopGap(itinerary);
  if (gaps.length === 0) return 0;
  itinerary.quality_warnings = itinerary.quality_warnings || [];
  const summary = gaps.map((g) => `Day ${g.day} ${g.intercity_arrival_at}→${g.first_stop_start} (${g.gap_min}min)`).join(', ');
  itinerary.quality_warnings.push({
    kind: 'intercity_first_stop_gap',
    type: 'intercity_first_stop_gap',
    anchor: 'route-agent-stitch',
    severity: 'low',
    message: `Intercity 도착 후 첫 stop 까지 90분 이상 공백 ${gaps.length}건: ${summary}`,
    items: gaps.map((g) => ({
      day: g.day,
      message: `Day ${g.day}: KTX/intercity 도착 ${g.intercity_arrival_at} → 첫 stop ${g.first_stop_start} (${g.first_stop_name}) — ${g.gap_min}분 공백`,
    })),
  });
  console.warn(`[planPersister] P143 intercity gap detected: ${gaps.length} day(s)`);
  return gaps.length;
}

/**
 * P120/P136: detectUnreasonableStopTimes + admin/customer 분기 (P101 패턴).
 * - admin (ADMIN-BYPASS-* orderId 또는 adminBypass:true): telegram alert + return count (plan 저장 진행).
 * - customer: throw UNREASONABLE_STOP_TIMES → ai-planner-full 500.
 *
 * ai-planner-full.js 가 1줄 호출만 하도록 (P1 lock — per-file line limit 보호).
 *
 * @param {object} itinerary
 * @param {object} body - request body ({ orderId, adminBypass, regions })
 * @returns {number} unreasonable stop count (0 = clean, >0 = admin soft alert only)
 * @throws {Error} UNREASONABLE_STOP_TIMES — customer path only
 */
export function runUnreasonableStopTimesCheck(itinerary, body) {
  const stops = detectUnreasonableStopTimes(itinerary);
  if (stops.length === 0) return 0;

  const isAdminBypass = String(body?.orderId || '').startsWith('ADMIN-BYPASS-')
    || body?.adminBypass === true;

  const regionsKey = Array.isArray(body?.regions) && body.regions.length > 0
    ? body.regions.slice(0, 2).join('+')
    : 'unknown';
  const sample = stops.slice(0, 5)
    .map((u) => `Day${u.day} ${u.start_time} "${u.stop}"`).join(' / ');

  // P159 (2026-05-22): customer + admin 모두 auto-correct.
  // 이전: customer throw 500 → 결제 후 plan 못 받음 → 환불 분쟁.
  // 이후: pre-dawn 시각 09:00 cascade 재계산 + telegram alert + quality_warning 박제.
  const corrected = correctPreDawnStopTimes(itinerary);

  throttledTelegramAlert({
    key: `unreasonable-stop-times:${regionsKey}:${isAdminBypass ? 'admin' : 'customer'}`,
    channel: 'admin',
    severity: isAdminBypass ? 'low' : 'medium',
    message: [
      `⚠️ <b>새벽 시간 stops auto-corrected (P159)</b>`,
      ``,
      `<b>모드:</b> ${isAdminBypass ? 'admin bypass' : '🔴 customer 결제'}`,
      `<b>건수:</b> ${stops.length} stops detect → ${corrected} stops 재계산`,
      `<b>샘플:</b> ${sample}`,
      ``,
      `→ root cause: RouteAgent stitching 24h wrap.`,
      `→ 사용자 영향: plan 정상 저장 (시각 강제 09:00 cascade).`,
    ].join('\n'),
    context: { count: stops.length, corrected, stops: stops.slice(0, 10), regions: body?.regions || null, mode: isAdminBypass ? 'admin' : 'customer' },
  });
  console.log(`[planner] P159 unreasonable stops auto-corrected (${isAdminBypass ? 'admin' : 'customer'}): ${stops.length} detected → ${corrected} fixed`);
  return stops.length;
}

/**
 * P168 (2026-05-23): Pass3 background enrichment Firestore update.
 *
 * triggerPass3Background 이 pass3Enrich 완료 후 호출. set merge 로 tip/recommended_items
 * 만 덮어씀 — plan 전체 덮어쓰기 X (다른 backfill 결과 보호).
 * _pass3_pending = false / _pass3_completed_at = ISO 타임스탬프 로 완료 표시.
 * PlanDetailPage 의 onSnapshot listener 가 Firestore 변경 감지 → 자동 화면 갱신.
 *
 * @param {object} adminDb - initAdminDb() 반환값
 * @param {string} planId - Firestore plans/{planId}
 * @param {object} enrichedItinerary - pass3Enrich 반환값 (tip/recommended_items 포함)
 */
export async function updatePlanEnrichment(adminDb, planId, enrichedItinerary) {
  if (!adminDb || !planId || !enrichedItinerary) {
    throw new Error('[updatePlanEnrichment] adminDb / planId / enrichedItinerary 필수');
  }
  await adminDb.collection('plans').doc(planId).set(
    {
      'itinerary.days': enrichedItinerary.days,
      'itinerary._pass3_pending': false,
      'itinerary._pass3_completed_at': new Date().toISOString(),
    },
    { merge: true },
  );
  console.log(`[planPersister] P168 updatePlanEnrichment: planId=${planId}, days=${(enrichedItinerary.days || []).length}`);
}

/**
 * Calculate T-money recommended load from ODsay fares + arrival/departure costs.
 */
export function calculateTmoney(itinerary) {
  const totalTransitFare = (itinerary.days || [])
    .flatMap(d => d.stops || [])
    .reduce((sum, s) => {
      // ODsay 실제 요금이 있으면 우선 사용
      const odsayFare = s.travelFromPrev?.transitOptions?.publicTransit?.fare;
      const geminiFare = s.transit_from_prev?.est_fare_krw;
      return sum + (odsayFare || geminiFare || 0);
    }, 0);

  // [#5 MED] 도착/출발 last-mile 대중교통 요금을 T-money 충전 권장액에 포함.
  //   기존 코드는 RouteAgent 가 저장하지 않는 경로(arrival_guide.steps[].transport_to_hotel.
  //   arex_all_stop.price_krw / departure_guide.to_airport.cost_krw)를 읽어 항상 0 →
  //   인천 AREX·부산 김해 등 공항↔호텔 대중교통 요금이 충전 권장액에서 통째로 빠졌다.
  //   실제 RouteAgent 저장 필드 = arrival_guide.route_to_hotel.est_fare_krw /
  //   departure_guide.route_to_airport.est_fare_krw (RouteAgent.js L862/L983, _failed 객체는 est_fare_krw 없음 → 0).
  //   KTX 등 intercity 요금은 T-money 대상 아니므로 여기 미포함(예산표 transport_krw 에서 별도 반영).
  //   nullish ?? 금지 → || 사용.
  const arrivalTransitCost =
    Number(itinerary.arrival_guide?.route_to_hotel?.est_fare_krw) || 0;

  const departureTransitCost =
    Number(itinerary.departure_guide?.route_to_airport?.est_fare_krw) || 0;

  const rawTotal = totalTransitFare + arrivalTransitCost + departureTransitCost;
  itinerary.t_money_recommended_load = Math.ceil(rawTotal * 1.1 / 5000) * 5000;

  if (itinerary.arrival_guide?.steps) {
    const tmStep = itinerary.arrival_guide.steps.find(s => s.t_money_recommended_load_krw !== undefined);
    if (tmStep) tmStep.t_money_recommended_load_krw = itinerary.t_money_recommended_load;
  }
}

/**
 * P169 (2026-05-23): Streaming 모드에서 planId 먼저 생성 + 빈 skeleton plan Firestore 저장.
 * Streaming response 를 handlerCore 가 즉시 반환할 수 있도록 planId 를 먼저 확보.
 * 사용자는 PlanDetailPage 로 redirect 되어 onSnapshot 으로 점진 업데이트 수신.
 *
 * @param {object} adminDb - Firebase Admin Firestore instance
 * @param {object} ctx     - { uid, email, area, startDate, guestName, pax, language, vehicle, priceKRW, priceUSD, body }
 * @returns {{ planId: string, planUrl: string }}
 */
export async function savePlanSkeleton(adminDb, {
  uid, email, area, startDate, guestName, pax, language, vehicle, priceKRW, priceUSD, body,
  // FEATURE_GUEST_ANON_AUTH: 게스트 익명 소유자 uid 가 부여된 경우 true. non-null uid 라도
  // accessToken 을 발급해 기존 게스트 공유 링크 흐름 유지. 플래그 OFF 시 항상 false 로 전달
  // → accessToken 식이 기존 (uid ? null : random) 과 동일 (byte-identical).
  forceGuestToken = false,
  // P0 원자 발급 (2026-07-15): claim 이 예약한 planId. 유료 PayPal 경로만 값이 있다.
  //   skeleton 과 최종 persistPlan 이 같은 문서를 써야 claim 이 그 planId 로 완성 여부를 직접
  //   읽어 복구할 수 있다. null/undefined = 기존 randomUUID 동작 byte-identical.
  planIdOverride = null,
}) {
  if (!adminDb) throw new Error('[P169] Firebase not configured — cannot save skeleton');

  const planId = planIdOverride || randomUUID();
  // forceGuestToken=true → uid 있어도 token 발급. false → 기존 (uid ? null : random). nullish 금지, OR 사용.
  const accessToken = (forceGuestToken || !uid) ? randomUUID() : null;

  const skeletonDoc = {
    planId,
    status: 'streaming',
    _streaming_in_progress: true,
    _streaming_started_at: Date.now(),
    isPublic: false,
    // #payment-separation (2026-06-05): streaming/에러 단계에서도 테스트/실결제 구분 보존.
    // P1-②(여름 이벤트): AI 무료 쿠폰 0원 결제 = 'ai-coupon'(매출 0 구분). paypalOrderId 없어서 보정.
    paymentSource: body?.aiCouponCode ? 'ai-coupon' : detectPaymentSource(body?.paypalOrderId),
    isFreeCoupon: !!body?.aiCouponCode,
    isAdminBypass: isAdminBypassOrderId(body?.paypalOrderId),
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    uid: uid || null,
    accessToken,
    guestEmail: email || null,
    input: {
      guestName: guestName || 'Guest',
      pax: pax || 2,
      styles: Array.isArray(body?.styles) ? body.styles : [],
      area: area || null,
      startDate: startDate || null,
      language: language || 'en',
      vehicle: vehicle || null,
      regions: Array.isArray(body?.regions) && body.regions.length > 0 ? body.regions : (area ? [area] : []),
    },
    pricing: { vehicle, priceKRW: priceKRW || 0, priceUSD: priceUSD || 0 },
    revisionCredits: 2,
    revisionCount: 0,
    // 빈 itinerary — streaming 완료 전 PlanDetailPage 가 로딩 인디케이터 표시용
    itinerary: {
      tour_title: null,
      days: [],
      _streaming_skeleton: true,
    },
  };

  try {
    await adminDb.collection('plans').doc(planId).set(skeletonDoc);
  } catch (saveErr) {
    console.error('[planPersister P169] skeleton save failed:', saveErr.message);
    throw new Error(`Skeleton save failed (${saveErr.code || saveErr.name})`);
  }

  console.log('[planPersister P169] skeleton saved:', planId);
  const planUrl = `/my-plans/${planId}`;
  return { planId, planUrl };
}

/**
 * P169 (2026-05-23): Streaming 진행 중 Firestore 에 partial plan 업데이트.
 * best-effort — 실패해도 streaming 은 계속. catch 는 호출자가 처리.
 *
 * @param {object} adminDb
 * @param {string} planId
 * @param {object} partial - { days: [], _streaming_progress: N, ... }
 */
export async function updatePlanProgressive(adminDb, planId, partial) {
  if (!adminDb || !planId) return;
  await adminDb.collection('plans').doc(planId).set(
    {
      ...partial,
      _streaming_in_progress: true,
      _streaming_last_update: Date.now(),
    },
    { merge: true },
  );
}

/**
 * P169 (2026-05-23): Streaming 완료 후 skeleton → 완성 plan 으로 교체.
 * skeleton 시 저장했던 docToSave 에 _streaming_in_progress: false 마킹.
 *
 * @param {object} adminDb
 * @param {string} planId
 * @param {object} finalDoc - persistPlan 에서 생성한 docToSave (planId 포함)
 */
export async function finalizeStreamingPlan(adminDb, planId, finalDoc) {
  if (!adminDb || !planId) throw new Error('[P169] finalizeStreamingPlan: missing adminDb or planId');
  const doc = {
    ...finalDoc,
    planId,
    status: 'ready',
    _streaming_in_progress: false,
    _streaming_completed_at: Date.now(),
  };
  try {
    await adminDb.collection('plans').doc(planId).set(doc);
  } catch (err) {
    console.error('[planPersister P169] finalizeStreamingPlan failed:', err.message);
    // mark error so PlanDetailPage can show fallback
    await adminDb.collection('plans').doc(planId).set(
      { _streaming_in_progress: false, _streaming_error: err.message, status: 'error' },
      { merge: true },
    ).catch(() => {});
    throw err;
  }
  console.log('[planPersister P169] streaming finalized:', planId);
}

/**
 * plan 발급 멱등성 마킹 (P311 / P790) — **레거시 폴백. 유료 PayPal 경로는 더 이상 여기로 오지 않는다.**
 *
 * ⚠️ 2026-07-15 (P0 원자 발급): 유료 PayPal 발급 확정은 finalizePlanIssuance 가 담당한다
 * (_shared/plan-issuance.js). 이 함수의 **non-fatal `.catch()` → `return true`** 가 바로 P0 의
 * 원인 절반이었다 — 마커가 안 박히면 플랜은 저장됐는데 결제 ID 는 다시 쓸 수 있었다.
 * persistPlan 은 issuanceClaim 이 있으면 이 함수를 호출하지 않는다.
 *
 * 남은 도달 경로: 사실상 없다. prefix 3종은 아래에서 스스로 걸러지고, revision 요청은 body 에
 * paypalOrderId 를 보내지 않으며(프론트 실측 2026-07-15), 그 외 유료 주문은 전부 claim 을 가진다.
 * 호출 계약과 P790 회귀 가드(plan-issued-mark-p790.test.ts)를 깨지 않으려고 남겨둔 폴백이다.
 * **이 함수를 유료 경로로 되돌리지 말 것.**
 *
 * P790 (2026-06-03): await 가능하도록 추출 — 기존 fire-and-forget 은 serverless 응답 후 instance
 * freeze(P222/P319) 시 마킹 미완 → 재시도 plan 중복발급. 호출자가 plan set 성공 후 await → persist 보장.
 *
 * @param {object} adminDb
 * @param {string} ppOrderId — body.paypalOrderId
 * @param {{planId?: string, uid?: string}} fields
 * @returns {Promise<boolean>} 마킹 시도 여부 (prefix 제외/빈값 시 false)
 */
export async function markPlanIssued(adminDb, ppOrderId, { planId, uid } = {}) {
  if (!ppOrderId || /^(ADMIN-BYPASS-|TEST-|MANUAL-)/.test(ppOrderId)) return false;
  await adminDb.collection('plan_issued_orders').doc(ppOrderId).set({
    planId: planId || null,
    issuedAt: new Date().toISOString(),
    uid: uid || null,
    provider: 'paypal',
  }).catch((e) => console.warn('[planPersister] plan_issued_orders mark failed (non-fatal):', e.message));
  return true;
}

/**
 * Persist plan to Firestore + update user subcollection + API stats + loyalty.
 * Returns { planId, planUrl }.
 */
export async function persistPlan(adminDb, {
  body, itinerary, uid, vehicle, priceKRW, priceUSD,
  guestName, pax, styles, area, duration, startDate, email,
  specialRequest, arrival_airport, departure_airport,
  hotel_address, mobility, language,
  dietary, foodIndex,
  // Phase 4 A/B test (2026-05-13): plannerMode / abReason / abBucket persisted
  // alongside qualityScore so admin can compare legacy vs 3-pass score
  // distribution. Absent on legacy revision paths that don't pass the field
  // (back-compat — silent skip when undefined).
  plannerMode, abReason, abBucket,
  // P128 (2026-05-21): block-mode trace — block IDs that drove block-mode plan.
  // null for legacy/3-pass plans (backward compat).
  blocksUsed,
  // P169 (2026-05-23): streaming 모드에서 skeleton 에서 미리 생성한 planId 재사용.
  // undefined 시 기존 randomUUID() 생성 (비스트리밍 호환).
  planIdOverride,
  // P0 원자 발급 (2026-07-15): paymentGate 가 선점한 { orderId, attemptId, planId }.
  //   유료 PayPal 경로에서만 존재한다(revision/무료쿠폰/ADMIN-BYPASS-/TEST-/MANUAL- 은 null).
  //   있으면 plans 저장 직전 beginPlanCommit 으로 fencing 하고, 저장 성공 후 finalize 로 확정한다.
  //   ⚠️ 구조분해 시그니처다 — 여기 명시하지 않으면 ctx 에 담아 보내도 에러 없이 조용히 버려진다.
  issuanceClaim,
  // P266 (2026-05-28): P195 cache instrumentation persistence — explicit cacheMetadata 인자.
  //   기존: itinerary._cache_metadata hidden mutation 의존 → worker dispatch path 에서 80% 손실
  //         (5/25~5/28 100 plans inspect: legacy 51 plans 중 10 plans 만 저장).
  //   변경: 호출자 (handlerCore / processPlanAfterAI worker) 가 explicit cacheMetadata 전달
  //         → docToSave._debug = { cacheMetrics } root field 로 persist. P265 measurement script path 일치.
  //   값 = null → block_mode / 3pass / non-Gemini path (의도적 미생성) — _debug 미포함 (silent skip).
  //   값 = { cached, total, output } → legacy / streaming legacy / 1-pass — _debug.cacheMetrics 저장.
  //   P266 (R-lint): savePlan 호출 site 가 cacheMetadata 인자 누락 시 grep 알람.
  cacheMetadata,
  // FEATURE_GUEST_ANON_AUTH: 게스트 익명 소유자 uid 가 부여된 plan 이면 true. non-null uid
  // (격리된 익명 uid) 라도 accessToken 발급 — 게스트는 로그인 세션이 없어 공유 링크/접근 토큰
  // 필요. 플래그 OFF 시 항상 false → accessToken 식이 기존 (uid ? null : random) 과 동일.
  forceGuestToken = false,
}) {
  if (!adminDb) {
    throw new Error('Firebase not configured — cannot save plan');
  }

  // P0 원자 발급 (2026-07-15): claim 이 있으면 **claim 이 예약한 planId 가 진실**이다.
  //   inline/worker/skeleton 이 서로 다른 plan 문서를 만들면 복구가 불가능해진다(claim 은
  //   예약 planId 로 plans 를 직접 읽어 완성 여부를 판정한다).
  //   ⚠️ planIdOverride 는 `||` 폴백이라 빈 문자열이 오면 조용히 새 UUID 가 생겨 고아 plan +
  //      이중 발급이 된다. claim 경로에서는 소리나게 실패시킨다.
  if (issuanceClaim) {
    if (!issuanceClaim.planId) throw new Error('Plan issuance claim has no reserved planId');
    if (planIdOverride && planIdOverride !== issuanceClaim.planId) {
      throw new Error('Plan issuance claim planId does not match planIdOverride');
    }
    // gate 가 검증한 orderId 와 persister 가 보는 body 가 다르면 두 소스가 드리프트한 것이다.
    if (issuanceClaim.orderId !== body?.paypalOrderId) {
      throw new Error('Plan issuance claim orderId does not match request');
    }
  }
  const planId = (issuanceClaim && issuanceClaim.planId) || planIdOverride || randomUUID();
  // forceGuestToken=true → uid 있어도 token 발급. false → 기존 (uid ? null : random). nullish 금지, OR 사용.
  const accessToken = (forceGuestToken || !uid) ? randomUUID() : null;

  // ── Tier 2-D: 9-metric quality score (admin-only, not user-visible) ────
  // P0-3 (2026-05-10, CLAUDE.md J): 빈 배열 fallback 제거.
  // 이전: `dietary || body?.dietPrefs || body?.dietary || []` — 누락 시 silent default
  //       → 사용자 식이제한이 잘못 전달돼도 plan 그대로 저장됐음 (J 룰 위반).
  // 변경: 명시적 array check + 누락이면 null 로 전달 (computeQualityScore 가
  //       buildDietaryChecker 에서 빈 배열로 graceful 처리).
  // Note: 식이제한 차단은 이미 geminiPipeline 단계에서 throw 처리 — 여기까지 도달했다는 건
  //       (a) 사용자 식이제한 없거나 (b) violation 통과한 plan. qualityScore 는
  //       admin 모니터링용이므로 dietary null 도 안전.
  const dietaryRaw = dietary ?? body?.dietPrefs;
  if (dietaryRaw !== undefined && dietaryRaw !== null && !Array.isArray(dietaryRaw)) {
    // 명시적 throw 대신 logging — qualityScore 는 non-blocking 이므로 plan 저장은 진행.
    // Telemetry only — 호출 체인 어딘가에서 잘못된 type 이 넘어왔다는 신호.
    console.error('[planPersister] dietary must be array, got:', typeof dietaryRaw, dietaryRaw);
  }
  const dietaryForScore = Array.isArray(dietaryRaw) ? dietaryRaw : null;

  let qualityScore = null;
  try {
    qualityScore = computeQualityScore(
      itinerary,
      dietaryForScore,
      area,
      foodIndex || [],
      { lang: language || 'ko' },
    );
    console.log(
      `[planner] qualityScore: ${qualityScore.score}/100 ` +
      `(diet=${qualityScore.metrics.dietary_violation.count}, ` +
      `unv=${qualityScore.metrics.unverified_restaurant.count}, ` +
      `lang=${qualityScore.metrics.language_mismatch.count}, ` +
      `route=${qualityScore.metrics.route_failure.count})`,
    );
  } catch (e) {
    // Non-blocking — never fail plan persist on metric computation error.
    console.warn('[planner] qualityScore compute failed:', e.message);
  }

  // 2026-05-10 (P1): WizardForm 의 추가 필드들도 Firestore input 에 보존.
  // PlanDetailPage 의 region 인식 (PR #323 PreTripSlide regions[0] 우선) +
  // AirportToLodgingGuide luggage 분기 (heavyLoad 자동 추천) + revision prefill
  // (PR #323) 모두 input.* 필드 의존. 누락 시 silent UX 저하 (audit P1).
  const docToSave = {
    planId,
    status: 'ready',
    isPublic: false,
    // #payment-separation (2026-06-05): 어드민 테스트 vs 실결제 명시 구분 — admin 쿼리/필터용.
    // paypalOrderId prefix SSOT 분류. used_paypal_orders/capture 멱등성(P311)과 무관 = 표시 전용.
    // P1-②(여름 이벤트): AI 무료 쿠폰 0원 결제 = 'ai-coupon'(매출 0 구분). paypalOrderId 없어서 보정.
    paymentSource: body.aiCouponCode ? 'ai-coupon' : detectPaymentSource(body.paypalOrderId), // +ai-coupon|test|admin-bypass|manual|paypal
    isFreeCoupon: !!body.aiCouponCode, // AI 무료 쿠폰 0원 결제
    isAdminBypass: isAdminBypassOrderId(body.paypalOrderId), // true = 운영자 테스트(매출 제외 대상)
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    uid: uid || null,
    accessToken,
    guestEmail: email || null,
    input: {
      guestName, pax, styles, area, duration, startDate,
      // 2026-05-10 (P0-1): regions array 보존 — PlanDetailPage 다도시 인식.
      regions: Array.isArray(body.regions) && body.regions.length > 0
        ? body.regions
        : (area ? [area] : []),
      adults: body.adults ?? pax,
      children: body.children ?? 0,
      vehicle, language, specialRequest,
      arrival_airport: arrival_airport || null,
      departure_airport: departure_airport || null,
      hotel_address: hotel_address || null,
      mobility: mobility || null,
      // P304 (2026-05-30): dietary + allergies persist (admin AdminPlans 가시성 + 미래
      // 시각검증). P298 SAFETY 작동은 입증 완료 → 본 필드는 admin 표시 + audit 용도.
      // dietaryRaw 는 위 L1085-1091 에서 dietPrefs/dietary 정규화 완료. body.allergies
      // 는 wizard ALLERGY_KEYS (Halal/Vegan/Nuts/Shellfish/Gluten/Dairy/None).
      dietary: Array.isArray(dietaryRaw) ? dietaryRaw : null,
      allergies: Array.isArray(body.allergies) ? body.allergies : null,
      // B3 S0 (P311, 2026-05-30): paypalOrderId persist — plan-발급 멱등성 추적 + 재시도
      // 식별. 실패한 plan 재시도 시 같은 orderId 로 기존 ready plan 조회 가능. PayPal 17자
      // orderId / ADMIN-BYPASS-/TEST-/MANUAL- prefix 모두 보존 (audit 용도).
      paypalOrderId: body.paypalOrderId || null,
      // 2026-05-10 (P1): 도착/출발 시각 — PlanDetailPage 시각 분기 + revision prefill.
      arrival_time: body.arrivalTime || null,
      departure_time: body.departureTime || null,
      // P245 (2026-05-27): tour_start_time persist — P239 architectural fix 가 prod 에서
      // 효과 미완료였던 근본 원인 = 본 필드 미저장 + block_mode 가 arrival+9h 룰 그대로 사용.
      // PDF/UI/admin debug 분기 + 회귀 검증 (R-P245 lint regex) 용도.
      tour_start_time: body.tourStartTime || null,
      // #tour-end (2026-06-05): tour_end_time persist — 매일 관광 종료 cap. PDF/UI/admin debug + 회귀 검증용.
      tour_end_time: body.tourEndTime || null,
      // 2026-05-10 (P1): luggage — AirportToLodgingGuide heavyLoad 자동 추천 핵심.
      luggage: (body.luggage && typeof body.luggage === 'object') ? body.luggage : null,
      // 2026-05-10 (P1): 매운맛 / bucket 음식 — 식당 추천 정확도.
      spice_level: body.spiceLevel || null,
      bucket_dishes: Array.isArray(body.bucketDishes) ? body.bucketDishes : null,
      tour_pace: body.tourPace || null,
      // UIUX P3 (2026-07-13): 동행 유형 — retryOf 재생성·어드민 조회용 입력 보존.
      companions: body.companions || null,
      // 2026-05-08: zone-only 사용자도 PlanDetailPage 가 라벨링할 수 있도록 보존.
      // hotel_address 가 null/빈 값인데 zone 만 골랐을 때, LodgingBookend 가
      // "Stay" 가 아니라 zone 명("명동" 등) 을 보여주려면 이 필드가 필수.
      recommended_zone: body.recommended_zone || null,
      recommended_zone_address: body.recommended_zone_address || null,
      // B3 S2-b 선행 (P313, 2026-05-30): 재시도(retryOf) 시 plan.input 만으로 정확 재생성
      // 하려면 전체 wizard 입력 보존 필요. 특히 다도시 — durationDays/hotelByCity/
      // recommended_zones/arrival_city/departure_city/want_accom 누락 시 재시도 plan 이
      // 원본과 달라짐 (deep-search 확인). admin AdminPlans 가시성에도 유용. 결제 무관 데이터.
      durationDays: body.durationDays || null,
      hotelByCity: (body.hotelByCity && typeof body.hotelByCity === 'object') ? body.hotelByCity : null,
      recommended_zones: (body.recommended_zones && typeof body.recommended_zones === 'object') ? body.recommended_zones : null,
      arrival_city: body.arrival_city || null,
      departure_city: body.departure_city || null,
      entry_city: body.entry_city || null,
      price_range: body.priceRange || null,
      want_accom: !!body.wantAccom,
      accom_budget: body.accomBudget || null,
    },
    itinerary,
    pricing: { vehicle, priceKRW, priceUSD },
    revisionCredits: 2,  // 무료 재생성 2회 (결제 시 포함)
    revisionCount: 0,    // 현재까지 재생성 횟수
    ...(qualityScore ? { qualityScore } : {}),
    // Phase 4 A/B test (2026-05-13): per-plan mode trace. Used by admin
    // quality-summary endpoint (Tier 2-D) to bucket scores by pipeline.
    // Absent fields skip safely (legacy plans pre-PR have no plannerMode).
    ...(plannerMode ? { plannerMode } : {}),
    ...(abReason ? { abReason } : {}),
    ...(typeof abBucket === 'number' ? { abBucket } : {}),
    // P128 (2026-05-21): block-mode trace. Only persisted on block-mode plans.
    ...(Array.isArray(blocksUsed) && blocksUsed.length > 0 ? { blocksUsed } : {}),
    // P266 (2026-05-28): P195 cache instrumentation root field. P265 measurement script path 일치.
    //   값이 numeric 객체일 때만 persist (block_mode / 3pass 미생성 = silent skip).
    //   total=0 은 Gemini 호출 자체 미발생 → silent skip. >0 = legacy 1-pass measurement.
    //   _debug.modelMain 은 buildAdminDebug 호출자가 별도 추가 가능 (admin-bypass response 노출과 동일 key prefix).
    ...(cacheMetadata && typeof cacheMetadata === 'object' && cacheMetadata.total > 0
      ? {
          _debug: {
            cacheMetrics: {
              cached: Number(cacheMetadata.cached) || 0,
              total: Number(cacheMetadata.total) || 0,
              output: Number(cacheMetadata.output) || 0,
              cacheHitRate: cacheMetadata.total > 0
                ? Math.round((Number(cacheMetadata.cached) / Number(cacheMetadata.total)) * 1000) / 10
                : 0,
              persistedAt: Date.now(),
            },
          },
        }
      : {}),
  };

  // 2026-05-10 (P0-5 launch blocker): Firestore 1MB doc size 가드.
  // 14+ 일 다도시 plan 시 itinerary 가 1MB 초과 → set() throw → 사용자 결제 후
  // 데이터 loss. pre-check 후 day 마지막부터 truncate (Sentry alert + 운영자 수동
  // 복구 가능). 사용자에게는 plan 일부 손실 — 보수적으로 truncate 표시 stop 추가.
  //
  // PR #460 (Audit X-H1 — 2026-05-16): truncation 이 silent 였음.
  // - console.error 만 → 운영자가 Vercel 로그 보지 않으면 모름
  // - `_truncated_days` 가 itinerary 안에 묻혀있어 UI 가 surface 하기 어려움
  // 변경:
  // 1. root-level `__truncated: true` + `__truncated_days_count` 추가 →
  //    PlanDetailPage 가 즉시 banner 표시 가능 (itinerary 깊이 탐색 불필요)
  // 2. throttledTelegramAlert (admin channel) — region+duration dedup
  //    (한 사용자가 다도시 14일 반복 시도해도 5분당 1회)
  // 3. 기존 `itinerary._truncated_days/_truncation_note` 유지 (legacy 호환)
  const SIZE_LIMIT_BYTES = 900_000; // Firestore 한계 1,048,576 의 안전 margin
  const initialSize = Buffer.byteLength(JSON.stringify(docToSave), 'utf8');
  let docSize = initialSize;
  if (docSize > SIZE_LIMIT_BYTES) {
    console.error(`[planPersister] Document size ${docSize}B exceeds ${SIZE_LIMIT_BYTES}B — truncating days`);
    let truncatedCount = 0;
    const originalDayCount = docToSave.itinerary?.days?.length || 0;
    while (docSize > SIZE_LIMIT_BYTES && docToSave.itinerary?.days?.length > 1) {
      docToSave.itinerary.days.pop();
      truncatedCount += 1;
      docSize = Buffer.byteLength(JSON.stringify(docToSave), 'utf8');
    }
    // Legacy fields (itinerary-deep) — UI 의 기존 탐색 경로 지원.
    docToSave.itinerary._truncated_days = truncatedCount;
    docToSave.itinerary._truncation_note = 'Plan size exceeded Firestore limit — last days removed for safety. Contact support for full plan.';
    // Root-level flags (PR #460) — PlanDetailPage / banner UI 가 즉시 감지.
    docToSave.__truncated = true;
    docToSave.__truncated_days_count = truncatedCount;
    docToSave.__truncated_original_days = originalDayCount;
    docToSave.__truncated_initial_size_bytes = initialSize;
    console.warn(`[planPersister] Truncated ${truncatedCount} days. Final size: ${docSize}B`);

    // PR #460 (X-H1): operator alert — 사용자는 plan 받지만 일부 day 누락.
    // dedup key: region+duration → 같은 다도시 14일 사용자 반복 시도해도 5분 1회.
    // fire-and-forget — Telegram fail 이 plan 저장 latency 영향 X.
    const regionKey = Array.isArray(body?.regions) && body.regions.length > 0
      ? body.regions.slice(0, 3).join('+')
      : (area || 'unknown');
    const durationKey = String(duration ?? originalDayCount ?? 'unknown');
    throttledTelegramAlert({
      key: `plan-persister-truncate:${regionKey}:${durationKey}`,
      channel: 'admin',
      severity: 'high',
      message: [
        `⚠️ <b>Plan truncated — Firestore 1MB 초과로 마지막 ${truncatedCount}일 제거</b>`,
        ``,
        `<b>planId:</b> <code>${planId}</code>`,
        `<b>regions:</b> ${regionKey}`,
        `<b>duration:</b> ${durationKey} days`,
        `<b>원본 days:</b> ${originalDayCount} → <b>저장:</b> ${originalDayCount - truncatedCount}`,
        `<b>초기 크기:</b> ${initialSize.toLocaleString()}B / 한계 ${SIZE_LIMIT_BYTES.toLocaleString()}B`,
        `<b>최종 크기:</b> ${docSize.toLocaleString()}B`,
        ``,
        `→ user 가 plan 받았지만 day ${originalDayCount - truncatedCount + 1}~${originalDayCount} 누락.`,
        `→ uid: <code>${uid || 'guest'}</code> · email: <code>${(email || 'none').slice(0, 80)}</code>`,
      ].join('\n'),
      context: {
        planId,
        region: regionKey,
        durationDays: Number(durationKey) || originalDayCount,
        uid: uid || 'guest',
        email: email || null,
      },
    }).catch(() => {});
  }

  // 🔴 P0 fencing (2026-07-15): plans 대용량 저장 **직전**에 COMMITTING 을 원자 선점한다.
  //   여기까지 오는 사이 lease 가 만료돼 다른 attempt 가 takeover 했을 수 있다. 그 경우 이 attempt 는
  //   발급권을 잃었으므로 **plan 을 저장하면 안 된다**(저장하면 완성 plan 이 2개가 된다).
  //   plans 문서 자체를 트랜잭션에 넣지 못하는 이유는 _shared/plan-issuance.js 헤더 참조
  //   (900KB + 저장 직전 truncation 이 days.pop() 으로 in-place mutate → tx 재시도 시 손상).
  if (issuanceClaim) {
    const begun = await beginPlanCommit(adminDb, issuanceClaim);
    if (!begun.ok) {
      console.error('[planPersister] 발급권 상실 → plan 저장 중단:', begun.code, begun.detail);
      throw new Error(`Plan issuance claim lost before save (${begun.code}). This payment is being processed by another attempt.`);
    }
  }

  try {
    await adminDb.collection('plans').doc(planId).set(docToSave);
  } catch (saveErr) {
    // Firestore set() 실패 시 마지막 안전망 — 사용자 결제 후 plan loss 회피.
    // throw 시 ai-planner-full handler 가 catch 해서 사용자에게 명확한 에러 + 환불 안내.
    // ⚠️ claim 은 COMMITTING 으로 남는다 — 일부러 해제하지 않는다. 저장이 부분 성공했을 수 있고,
    //    재요청 시 claim 이 예약 planId 로 완성 여부를 대조해 복구하거나 IN_PROGRESS 로 잠근다.
    console.error('[planPersister] Firestore set failed:', saveErr.message);
    throw new Error(`Plan save failed (${saveErr.code || saveErr.name}). Contact WhatsApp for refund.`);
  }

  if (issuanceClaim) {
    // 🔴 유료 PayPal 경로의 발급 확정. **실패를 삼키지 않는다** — 구 markPlanIssued 의
    //   .set().catch() → return true 가 P0 의 원인 절반이었다(마커 실패 시 결제 ID 재사용).
    const finalized = await finalizePlanIssuance(adminDb, issuanceClaim);
    if (!finalized.ok) {
      console.error('[planPersister] 발급 확정 실패:', finalized.code, finalized.detail);
      throw new Error(`Plan issuance finalize failed (${finalized.code}).`);
    }
  } else {
    // claim 없는 경로 전용 레거시 마킹.
    // B3 S1-b (P311) + P790 (2026-06-03): plan 발급 성공 후 plan_issued_orders 마킹.
    //   markPlanIssued 는 ADMIN-BYPASS-/TEST-/MANUAL- prefix 와 빈 orderId 를 스스로 걸러내고,
    //   revision 요청은 body 에 paypalOrderId 를 아예 보내지 않는다(프론트 실측 2026-07-15).
    //   즉 유료 PayPal 경로가 claim 으로 이관된 지금 이 분기는 사실상 도달하지 않는다 —
    //   호출 계약을 깨지 않으려고 남겨둔 폴백이다.
    await markPlanIssued(adminDb, body?.paypalOrderId, { planId, uid });
  }

  if (uid) {
    await adminDb
      .collection('users').doc(uid)
      .collection('plans').doc(planId)
      .set({
        planId,
        createdAt: new Date().toISOString(),
        status: 'ready',
        tourTitle: itinerary.tour_title || `${guestName}'s Korea Itinerary`,
        startDate,
        area,
        pax,
      });
  }

  console.log('[ai-planner-full] Firestore saved:', planId);

  // ── API 사용량 카운터 (non-blocking) ────────────────────────────────
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthKey = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}`;
  const dayKey = `${monthKey}-${String(kst.getDate()).padStart(2, '0')}`;
  // 2026-06-09: admin-bypass(운영자 테스트) 결제는 매출 카운터에서 제외 — 실매출만 집계.
  //   AdminPayments isTestBooking(#846) 과 동일한 테스트/실결제 분리. 테스트 plan 이 fullCount/
  //   fullRevenue 를 부풀려 모닝 리포트 "AI 매출"이 과대 표시되던 문제 fix (priceUSD=추정 여행가).
  //   2026-06-09 v2: 운영자 테스트 이메일도 제외(실 PayPal 로 테스트하면 접두사 미매칭, dlxodbs147 사고).
  //   실고객 = (admin-bypass/test 아님) AND (운영자 이메일 아님). MANUAL-/일반 PayPal = 실매출 유지.
  if (!isAdminBypassOrderId(body?.paypalOrderId) && !isOperatorTestEmail(email)) {
    const inc = FieldValue.increment(1);
    const incRevenue = FieldValue.increment(priceUSD);
    // 월별
    adminDb.collection('api_stats').doc(monthKey).set(
      { fullCount: inc, fullRevenue: incRevenue, lastUpdated: new Date().toISOString() },
      { merge: true }
    ).catch(e => console.warn('[full] counter error:', e.message));
    // 일별
    adminDb.collection('api_stats').doc(monthKey)
      .collection('daily').doc(dayKey).set(
        { fullCount: inc, fullRevenue: incRevenue, lastUpdated: new Date().toISOString() },
        { merge: true }
      ).catch(e => console.warn('[full] daily counter error:', e.message));
  }

  // ── Loyalty 포인트 적립 (non-blocking — uid가 있는 로그인 사용자만) ────
  if (uid) {
    (async () => {
      try {
        const userRef = adminDb.collection('users').doc(uid);
        // 🔴 동시성 fix (버그헌트 2026-06-19): read-modify-write 비트랜잭션 → 동일 uid 동시구매 시
        //   last-writer-wins 로 tripCoins/totalSpentUSD/bookingCount/등급 유실. loyalty.js 처럼
        //   트랜잭션으로 재읽기→계산→쓰기 원자화. (등급이 새 합계 의존이라 increment 단독 불가)
        let earnRate = 0.01, tierName = 'Bronze', earnedCoins = 0, newBalance = 0, applied = false;
        await adminDb.runTransaction(async (tx) => {
          const userSnap = await tx.get(userRef);
          if (!userSnap.exists) return;
          const userData = userSnap.data() || {};
          const currentCoins = userData.tripCoins || 0;
          const newSpent = (userData.totalSpentUSD || 0) + priceUSD;
          const newCount = (userData.bookingCount || 0) + 1;
          earnRate = 0.01; tierName = 'Bronze';
          if (newSpent >= 1000 || newCount >= 15) { earnRate = 0.03; tierName = 'Platinum'; }
          else if (newSpent >= 500 || newCount >= 7) { earnRate = 0.02; tierName = 'Gold'; }
          else if (newSpent >= 200 || newCount >= 3) { earnRate = 0.015; tierName = 'Silver'; }
          earnedCoins = Math.round(priceUSD * 100 * earnRate);
          newBalance = currentCoins + earnedCoins;
          tx.update(userRef, {
            tripCoins: newBalance,
            totalSpentUSD: newSpent,
            bookingCount: newCount,
            tier: tierName,
            tierUpdatedAt: new Date().toISOString(),
          });
          applied = true;
        });
        if (applied) {

          // 포인트 이력 기록
          await adminDb.collection('users').doc(uid).collection('pointHistory').doc().set({
            type: 'earn',
            amount: earnedCoins,
            balance: newBalance,
            description: `AI Plan: ${itinerary.tour_title || 'Korea Itinerary'} ($${priceUSD})`,
            bookingRef: planId,
            createdAt: Date.now(),
          });

          console.log(`[planner] Loyalty: +${earnedCoins} coins (${tierName} ${(earnRate * 100).toFixed(1)}%) → total ${newBalance}`);
        }
      } catch (e) { console.warn('[planner] Loyalty earn error:', e.message); }
    })();
  }

  const planUrl = accessToken
    ? `/my-plans/${planId}?token=${accessToken}`
    : `/my-plans/${planId}`;

  return { planId, planUrl, accessToken };
}
