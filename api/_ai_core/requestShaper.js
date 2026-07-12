/**
 * Request body parsing + normalization for ai-planner-full.
 *
 * Extracted from api/ai-planner-full.js L206-370 (P129, 2026-05-21).
 * Behavior-preserving — all defaults / fallbacks / caps unchanged.
 *
 * 입력: body (이미 JSON.parse 된 객체) + authenticatedEmail (verifyUserToken
 * 결과). 출력: 정규화된 request shape — handlerCore 가 destructure 해서 사용.
 *
 * 이 모듈은 순수 함수 — adminDb / Gemini 호출 없음. 부수효과 없음.
 */
import { AIRPORT_ADDRESSES } from './constants.js';
import { inferDepartureAirport } from './airportInference.js';
import { selectVehicle } from './vehicleAndPrice.js';

export function shapeRequest(body, authenticatedEmail, guestCheckoutAllowed = false) {
  // ── 입력 파싱 ──────────────────────────────────────────────────────────
  const guestName = body.guest_name || body.guestName || 'Guest';
  const paxRaw = Number(body.pax) || Number(body.guest_count) || 2;
  const pax = Math.max(1, Math.min(50, isFinite(paxRaw) ? paxRaw : 2));
  const styles = Array.isArray(body.styles) ? body.styles : body.preferences ? [body.preferences] : ['culture'];
  const area = body.area || body.destination || body.region || 'seoul_city';
  // 2026-05-10 (P0-1 launch blocker): regions array 추출 — 다도시 plan 처리 핵심.
  // PR #331 의 _enrichMultiCityDays 가 regions.length>=2 시 작동. 누락 시 dead code.
  //
  // 2026-05-13 PR (Critical C2 — Agent X audit): 빈 regions 또는 빈 region 문자열 차단.
  // 기존: body.regions=[] → body.region 빈 문자열 → [""] → regionToCityKey null →
  // pickRecommendedRestaurantsByStyle 빈 객체 반환 → recommended_restaurants 0건 (silent).
  // 사용자 결제 후 "must-visit" 섹션 빈칸 — 신고 패턴.
  const _safeRegions = Array.isArray(body.regions) && body.regions.length > 0
    ? body.regions.filter((r) => typeof r === 'string' && r.trim()).slice(0, 5)
    : null;
  const _safeRegion = body.region && typeof body.region === 'string' && body.region.trim()
    ? [body.region.trim()]
    : null;
  const _safeArea = area && typeof area === 'string' && area.trim()
    ? [area.trim()]
    : null;
  const regions = _safeRegions || _safeRegion || _safeArea || ['Seoul'];
  const duration = body.duration || 'full_day';
  const durationDays = body.durationDays || (duration === 'multi_day' ? 2 : 1);
  // startDate convention: inclusive day-1 of the plan (YYYY-MM-DD KST).
  // durationDays is also inclusive — 1박2일 = durationDays:2 (Day 1 + Day 2).
  // RouteAgent/buildPrompt 가 동일 inclusive 컨벤션 가정 (P10 lesson).
  const startDate = body.date || body.startDate || new Date().toISOString().split('T')[0];
  // Audit P0-#2: email은 인증된 값 (authenticatedEmail). body.email 무시(스푸핑 차단).
  // 🔴 #8 (버그헌트 2026-06-19): 단 게스트 결제(authenticatedEmail null + guestCheckoutAllowed)는
  //   본인 입력 body.email 을 알림 전용으로 사용 — UI "준비되면 이메일로 보내드려요" 약속 이행.
  //   결제 게이트는 authenticatedEmail 별도 사용(handlerCore L171)이라 P0-#2 스푸핑 영향 없음.
  const email = authenticatedEmail || (guestCheckoutAllowed ? ((body.email || '').toLowerCase().trim() || null) : null);
  // 2026-05-13 PR (Critical C1 — Agent X audit): special_request 길이 cap 1000자.
  // 기존: 무제한 → Gemini 32K maxOutputTokens 도달 → JSON truncation → days 누락 →
  // Firestore 900KB 한계 트리거 → 사용자 결제 후 plan 짧음/실패.
  // 다른 free-text field (revisionNote 300, avoidList 1000, bucketDishes 10) 와 일관.
  const specialRequest = body.special_request || body.message
    ? String(body.special_request || body.message || '').slice(0, 1000)
    : '';
  const vehicleOverride = body.vehicle || 'auto';
  const vehicle = selectVehicle(pax, vehicleOverride);
  const language = body.language || 'en';

  const arrival_airport = body.arrival_airport || '';
  // PDF-issue-4 fix (2026-05-14): 다도시 plan 의 마지막 도시가 도착 도시와 다르면
  // 그 도시 기본 공항으로 inference. 이전: arrival_airport 그대로 fallback →
  // 부산 도착 → 서울 이동 plan 에서 wrap-up "PUS 출발" 표시 (잘못).
  // 운영자 명시 departure_airport 가 있으면 그 값 우선.
  const departure_airport = body.departure_airport
    || inferDepartureAirport(arrival_airport, body.regions, body.cities)
    || arrival_airport
    || '';
  const hotel_address = body.hotel_address || '';
  // P123 (2026-05-20): 다도시 plan 도시별 호텔 Record. Wizard Step2 가
  // hotelByCity = { seoul: "명동 호텔...", busan: "해운대 호텔..." } 입력받음.
  // 이전: backend 가 받기만 하고 buildPrompt 에 inject X → Gemini 가 단일
  // hotel_address (첫 도시) 만 모든 day 에 박음 (plan 209de47b 회귀).
  const hotelByCity = (() => {
    const raw = body.hotelByCity;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
          out[k.trim().toLowerCase()] = v.trim();
        }
      }
      return out;
    }
    return {};
  })();
  // P125 (2026-05-21): 사용자 명시적 입국/출국 도시 (Wizard cycle UI). 다도시 plan 의
  // Day 1 city = arrival_city, Day N city = departure_city 강제. 단도시 plan 은
  // 두 값 동일 또는 미입력 — buildPrompt 가 기존 entry_city / MULTI-CITY HANDLING 로 폴백.
  const arrivalCity = String(body.arrival_city || body.arrivalCity || '').trim().toLowerCase();
  const departureCity = String(body.departure_city || body.departureCity || '').trim().toLowerCase();
  const mobility = body.mobility || 'ok';
  const uid = body.uid || null;

  // Sprint 2 #5: zone hint (string key like 'myeongdong'). Used as a soft
  // anchor for hub-and-spoke when no hotel_address provided. Ignored when
  // hotel_address present (hotel coords win).
  // 2026-05-11 (B-2 fix): recommended_zones (Record<city, zone>) 도 함께 처리.
  // 다도시 plan 시 도시별 zone hint. 단도시 plan 도 동일 형식이지만 backward
  // compat — recommended_zone (string) 만 받아도 작동. recommended_zones 우선.
  const recommendedZone = body.recommended_zone || '';
  const recommendedZones = (() => {
    const raw = body.recommended_zones;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
          out[k.trim()] = v.trim();
        }
      }
      if (Object.keys(out).length > 0) return out;
    }
    // fallback: legacy recommended_zone + area → single-entry Record
    // (단도시 plan 또는 client 가 recommended_zones 안 보낸 케이스).
    if (recommendedZone && area) {
      // area 는 'seoul_city' 형태. zone Record key 는 frontend zoneData key
      // (e.g. 'seoul'). 안전한 매핑 — area startsWith 로 첫 도시 추출.
      const cityKey = String(area).split('_')[0].toLowerCase();
      return { [cityKey]: recommendedZone };
    }
    return {};
  })();
  // 2026-05-03: zone의 대표 주소 (예: "서울 마포구 홍익대학교"). RouteAgent에는
  // hotel_address fallback으로 사용 (공항↔zone 환승 경로 계산). Firestore 저장 시
  // 사용자가 입력한 hotel_address는 빈 문자열 그대로 유지 — "호텔 미정" 의미.
  const recommendedZoneAddress = body.recommended_zone_address || '';
  // RouteAgent용 effective hotel address: 사용자가 호텔 직접 입력하면 그것 우선,
  // 안 했으면 zone anchor 사용. 둘 다 없으면 빈 문자열 (route_to_hotel 생성 안 됨).
  const routeHotelAddress = hotel_address || recommendedZoneAddress;

  // SAFETY (CLAUDE.md J): 식이/알레르기는 silent 빈배열 폴백 금지. 키가 "있는데 비배열"(전송 손상)
  // 이면 throw — 알레르기 누락이 "제한 없음"으로 처리돼 위반 plan 이 가는 것을 차단(누락 자체가 에러).
  // 키 부재(미선택)는 정상 → []. (정상 프론트는 array-or-absent 보장. throw 는 handlerCore catch→500:
  // 위험 plan 대신 명시적 실패가 안전.)
  if (body.dietPrefs != null && !Array.isArray(body.dietPrefs)) {
    const e = new Error('INVALID_DIETARY_PAYLOAD: dietPrefs must be an array'); e.code = 'INVALID_DIETARY_PAYLOAD'; throw e;
  }
  if (body.allergies != null && !Array.isArray(body.allergies)) {
    const e = new Error('INVALID_DIETARY_PAYLOAD: allergies must be an array'); e.code = 'INVALID_DIETARY_PAYLOAD'; throw e;
  }
  const dietPrefs = Array.isArray(body.dietPrefs) ? body.dietPrefs : [];
  const allergies = Array.isArray(body.allergies) ? body.allergies : [];
  const priceRange = body.priceRange || 'Any';
  // W4 (2026-05-08): revision reason chips + free note + previous plan stop names
  const revisionReason = typeof body.revisionReason === 'string' ? body.revisionReason.slice(0, 200) : '';
  const revisionNote   = typeof body.revisionNote   === 'string' ? body.revisionNote.slice(0, 300)   : '';
  const avoidListBody  = typeof body.avoidList      === 'string' ? body.avoidList.slice(0, 1000)     : '';
  const wantAccom = !!body.wantAccom;
  const accomBudget = body.accomBudget || 'moderate';
  // 2026-05-10 (P1 launch blocker): WizardForm 누락 필드들 추출 — RouteAgent
  // late-night/heavy-luggage 분기 + Gemini prompt 정확도 개선용.
  // P254 (2026-05-27): snake_case fallback 추가 — verify script / admin tool 이 arrival_time
  // (snake_case) 로 직접 전달 시에도 처리. frontend(usePlannerHandlers) 는 camelCase 변환 정상.
  const _rawArrivalTime = typeof body.arrivalTime === 'string' ? body.arrivalTime
    : typeof body.arrival_time === 'string' ? body.arrival_time : '';
  const arrivalTime = _rawArrivalTime.slice(0, 5);
  const _rawDepartureTime = typeof body.departureTime === 'string' ? body.departureTime
    : typeof body.departure_time === 'string' ? body.departure_time : '';
  const departureTime = _rawDepartureTime.slice(0, 5);
  // P239 (2026-05-27): tourStartTime — 운영자 architectural fix. arrival_time 무관하게
  // Day1 stops 시작 시각 고정. body 미입력 (옛 client) 시 '09:00' default 폴백 (R-P239 lint).
  // HH:MM 형식 검증 (잘못된 입력 시 default '09:00' 폴백 — silent fail 방지).
  // root cause level 해결: P159 새벽 stops / P136 RouteAgent 24h wrap / B-13 false positive.
  const _rawTourStart = typeof body.tourStartTime === 'string' ? body.tourStartTime.slice(0, 5) : '';
  const tourStartTime = /^\d{2}:\d{2}$/.test(_rawTourStart) ? _rawTourStart : '09:00';
  // #tour-end (2026-06-05, 운영자): tourEndTime — 매일 관광 종료 시각 cap. body 미입력 (옛 client) 시
  // '21:00' default 폴백. HH:MM 형식 검증 (잘못된 입력 시 default — silent fail 방지). tourStartTime 와 대칭.
  const _rawTourEnd = typeof body.tourEndTime === 'string' ? body.tourEndTime.slice(0, 5) : '';
  const tourEndTime = /^\d{2}:\d{2}$/.test(_rawTourEnd) ? _rawTourEnd : '21:00';
  const luggage = (body.luggage && typeof body.luggage === 'object') ? {
    small: Number(body.luggage.small) || 0,
    medium: Number(body.luggage.medium) || 0,
    large: Number(body.luggage.large) || 0,
  } : null;
  const spiceLevel = typeof body.spiceLevel === 'string' ? body.spiceLevel : '';
  // UIUX 가이드 P3 (2026-07-13, 운영자 승인): 동행 유형 4옵션 — 미선택('') = 기존 동작 byte-identical.
  // 프롬프트에는 userInput JSON 필드로만 주입(system prompt 불변 = Gemini 캐시 prefix 무손상, P166/P273).
  const companions = ['solo', 'couple', 'family', 'friends'].includes(body.companions) ? body.companions : '';
  const bucketDishes = Array.isArray(body.bucketDishes)
    ? body.bucketDishes.filter((d) => typeof d === 'string').slice(0, 10)
    : [];
  // 이동 강도 — 명시 pace 우선, 없으면 기존 tourPace에서 derive (UI 변경 최소화).
  const pace = ['relaxed', 'standard', 'packed'].includes(body.pace) ? body.pace
    : (body.tourPace === 'half' || body.tourPace === 'short') ? 'relaxed'
    : (body.tourPace === 'action') ? 'packed' : 'standard';

  const arrivalAddress = AIRPORT_ADDRESSES[arrival_airport] || '';
  const departureAddress = AIRPORT_ADDRESSES[departure_airport] || AIRPORT_ADDRESSES[arrival_airport] || '';

  // sessionId 는 client 가 보낼 수 있는 anonymous 식별자 (현재 미사용이지만 향후
  // 비로그인 게스트 결제 흐름 대비). Phase 4 A/B test decidePlannerMode 입력.
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;

  return {
    guestName, pax, styles, area, regions, duration, durationDays, startDate,
    email, specialRequest, vehicle, language,
    arrival_airport, departure_airport, hotel_address, hotelByCity,
    arrivalCity, departureCity, mobility, uid,
    recommendedZone, recommendedZones, recommendedZoneAddress, routeHotelAddress,
    dietPrefs, allergies, priceRange,
    revisionReason, revisionNote, avoidListBody,
    wantAccom, accomBudget,
    arrivalTime, departureTime, luggage, spiceLevel, bucketDishes, pace, companions,
    // P239 (2026-05-27): tourStartTime export — handlerCore destructure + userMessageBuilder
    // inject + buildPrompt 의 tourStartTime instruction 분기. default '09:00' (옛 client 호환).
    tourStartTime,
    // #tour-end (2026-06-05): tourEndTime export — handlerCore destructure + userMessageBuilder inject + blockMode cap.
    tourEndTime,
    arrivalAddress, departureAddress, sessionId,
  };
}
