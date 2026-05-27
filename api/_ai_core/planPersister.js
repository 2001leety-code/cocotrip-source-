/**
 * T-money calculation + Firestore plan persistence.
 * Extracted verbatim from api/ai-planner-full.js L1074-1172.
 * Contains ?? at L1123/L1124 (body.adults ?? pax, body.children ?? 0).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { computeQualityScore } from './qualityMetrics.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

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
      day.lodging = { name: null, address: hbc[dayCityLc].trim() };
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
export function selfHealDailyBudget(itinerary) {
  if (!itinerary || typeof itinerary !== 'object') return 0;
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  let healed = 0;
  for (const day of days) {
    const existing = day.daily_budget_summary || day.daily_budget || {};
    const existingTotal =
      (Number(existing.food) || 0) +
      (Number(existing.transport) || 0) +
      (Number(existing.attraction) || 0) +
      (Number(existing.misc) || 0) +
      (Number(existing.total) || 0);
    if (existingTotal > 0) continue; // 이미 채워짐 — skip

    const stops = Array.isArray(day.stops) ? day.stops : [];
    let foodCount = 0;
    let attrCount = 0;
    for (const s of stops) {
      const cat = String(s?.category || '').toLowerCase();
      if (cat === 'food') foodCount++;
      else if (cat === 'attraction') attrCount++;
    }
    const food = foodCount * 15000;
    const attraction = attrCount * 10000;
    const transport = 0; // server 가 T-money + ODsay 로 채움
    const misc = 10000;
    const total = food + attraction + transport + misc;
    day.daily_budget_summary = {
      food, transport, attraction, misc, total,
      _self_healed: true,
    };
    healed++;
  }
  if (healed > 0) {
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    itinerary.quality_warnings.push({
      kind: 'daily_budget_self_healed',
      severity: 'low',
      message: `daily_budget_summary 누락 ${healed} 일 → stop count 기반 추정값 자동 생성 (P162)`,
      healed_days: healed,
    });
    console.log(`[planPersister] P162 daily_budget self-healed: ${healed} days`);
  }
  return healed;
}

// ── P152 (2026-05-22): cross-city lodging 강제 교정용 도시 메타 ────────────────
const CITY_KOR_MAP_FULL = {
  seoul: '서울', busan: '부산', jeju: '제주', gyeongju: '경주',
  jeonju: '전주', gangneung: '강릉', sokcho: '속초',
  incheon: '인천', daegu: '대구', daejeon: '대전', gwangju: '광주',
};

const CITY_LODGING_DEFAULT = {
  seoul:     { defaultZone: '명동',     placeholder: '명동 호텔 (위치 미정)' },
  busan:     { defaultZone: '해운대',   placeholder: '해운대 호텔 (위치 미정)' },
  jeju:      { defaultZone: '제주시',   placeholder: '제주시 호텔 (위치 미정)' },
  gyeongju:  { defaultZone: '보문',     placeholder: '보문 호텔 (위치 미정)' },
  jeonju:    { defaultZone: '한옥마을', placeholder: '한옥마을 호텔 (위치 미정)' },
  gangneung: { defaultZone: '경포',     placeholder: '경포 호텔 (위치 미정)' },
  sokcho:    { defaultZone: '속초해변', placeholder: '속초해변 호텔 (위치 미정)' },
};

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
        newAddress = hbc[dayCityLc].trim();
        newName    = `${dayCityKor || dayCityLc} 호텔`;
      } else if (rz[dayCityLc]) {
        const zone = String(rz[dayCityLc]).trim();
        newName    = `${zone} 일대 호텔 (위치 미정)`;
        newAddress = `${dayCityKor || dayCityLc} ${zone}`;
      } else if (defaultMeta) {
        newName    = defaultMeta.placeholder;
        newAddress = `${dayCityKor || dayCityLc} ${defaultMeta.defaultZone}`;
      } else {
        newName    = `${dayCityKor || dayCityLc} 호텔 (위치 미정)`;
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
 * @returns {Array<object>} prepend/append 이력
 */
export function selfHealLodgingBookend(itinerary) {
  const healed = [];
  const days = itinerary?.days || [];
  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    if (stops.length === 0) continue;

    const dayCityLc = String(day?.city || '').trim().toLowerCase();
    const defaultMeta = CITY_LODGING_DEFAULT[dayCityLc];
    const dayCityKor = CITY_KOR_MAP_FULL[dayCityLc] || '';

    // 첫 stop 이 lodging 이 아니면 prepend
    if (stops[0]?.category !== 'lodging') {
      const synName    = day?.lodging?.name    || (defaultMeta ? defaultMeta.placeholder : `${dayCityKor || dayCityLc || '여행지'} 호텔 (위치 미정)`);
      const synAddress = day?.lodging?.address || (defaultMeta ? `${dayCityKor || dayCityLc} ${defaultMeta.defaultZone}` : (dayCityKor || dayCityLc || ''));
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
      const synName    = day?.lodging?.name    || (defaultMeta ? defaultMeta.placeholder : `${dayCityKor || dayCityLc || '여행지'} 호텔 (위치 미정)`);
      const synAddress = day?.lodging?.address || (defaultMeta ? `${dayCityKor || dayCityLc} ${defaultMeta.defaultZone}` : (dayCityKor || dayCityLc || ''));
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
export function selfHealArrivalGuide(itinerary, arrival_airport) {
  if (!itinerary || typeof itinerary !== 'object') return false;
  if (!arrival_airport || arrival_airport === 'ALREADY' || arrival_airport === 'already_in_korea') {
    return false;
  }
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
        description: 'Best transport option depends on group size + luggage. Backend RouteAgent will populate transport_to_hotel with ODsay step-by-step routes.',
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

  const arrivalTransitCost =
    itinerary.arrival_guide?.steps
      ?.find(s => s.transport_to_hotel)
      ?.transport_to_hotel?.arex_all_stop?.price_krw || 0;

  const departureTransitCost =
    itinerary.departure_guide?.to_airport?.cost_krw || 0;

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
}) {
  if (!adminDb) throw new Error('[P169] Firebase not configured — cannot save skeleton');

  const planId = randomUUID();
  const accessToken = uid ? null : randomUUID();

  const skeletonDoc = {
    planId,
    status: 'streaming',
    _streaming_in_progress: true,
    _streaming_started_at: Date.now(),
    isPublic: false,
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
}) {
  if (!adminDb) {
    throw new Error('Firebase not configured — cannot save plan');
  }

  const planId = planIdOverride || randomUUID();
  const accessToken = uid ? null : randomUUID();

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
      // 2026-05-10 (P1): 도착/출발 시각 — PlanDetailPage 시각 분기 + revision prefill.
      arrival_time: body.arrivalTime || null,
      departure_time: body.departureTime || null,
      // P245 (2026-05-27): tour_start_time persist — P239 architectural fix 가 prod 에서
      // 효과 미완료였던 근본 원인 = 본 필드 미저장 + block_mode 가 arrival+9h 룰 그대로 사용.
      // PDF/UI/admin debug 분기 + 회귀 검증 (R-P245 lint regex) 용도.
      tour_start_time: body.tourStartTime || null,
      // 2026-05-10 (P1): luggage — AirportToLodgingGuide heavyLoad 자동 추천 핵심.
      luggage: (body.luggage && typeof body.luggage === 'object') ? body.luggage : null,
      // 2026-05-10 (P1): 매운맛 / bucket 음식 — 식당 추천 정확도.
      spice_level: body.spiceLevel || null,
      bucket_dishes: Array.isArray(body.bucketDishes) ? body.bucketDishes : null,
      tour_pace: body.tourPace || null,
      // 2026-05-08: zone-only 사용자도 PlanDetailPage 가 라벨링할 수 있도록 보존.
      // hotel_address 가 null/빈 값인데 zone 만 골랐을 때, LodgingBookend 가
      // "Stay" 가 아니라 zone 명("명동" 등) 을 보여주려면 이 필드가 필수.
      recommended_zone: body.recommended_zone || null,
      recommended_zone_address: body.recommended_zone_address || null,
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

  try {
    await adminDb.collection('plans').doc(planId).set(docToSave);
  } catch (saveErr) {
    // Firestore set() 실패 시 마지막 안전망 — 사용자 결제 후 plan loss 회피.
    // throw 시 ai-planner-full handler 가 catch 해서 사용자에게 명확한 에러 + 환불 안내.
    console.error('[planPersister] Firestore set failed:', saveErr.message);
    throw new Error(`Plan save failed (${saveErr.code || saveErr.name}). Contact WhatsApp for refund.`);
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

  // ── Loyalty 포인트 적립 (non-blocking — uid가 있는 로그인 사용자만) ────
  if (uid) {
    (async () => {
      try {
        const userRef = adminDb.collection('users').doc(uid);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const userData = userSnap.data() || {};
          const currentCoins = userData.tripCoins || 0;
          const newSpent = (userData.totalSpentUSD || 0) + priceUSD;
          const newCount = (userData.bookingCount || 0) + 1;

          // 등급 + 적립률 계산
          let earnRate = 0.01, tierName = 'Bronze';
          if (newSpent >= 1000 || newCount >= 15) { earnRate = 0.03; tierName = 'Platinum'; }
          else if (newSpent >= 500 || newCount >= 7) { earnRate = 0.02; tierName = 'Gold'; }
          else if (newSpent >= 200 || newCount >= 3) { earnRate = 0.015; tierName = 'Silver'; }

          const earnedCoins = Math.round(priceUSD * 100 * earnRate);
          const newBalance = currentCoins + earnedCoins;

          await userRef.update({
            tripCoins: newBalance,
            totalSpentUSD: newSpent,
            bookingCount: newCount,
            tier: tierName,
            tierUpdatedAt: new Date().toISOString(),
          });

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
