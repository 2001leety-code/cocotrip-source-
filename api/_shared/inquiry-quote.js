/**
 * PlanDetail 차터 문의용 서버 견적 정본.
 *
 * 클라이언트의 금액·투어명·시간·일정 문맥은 신뢰하지 않는다. plans/{planId}
 * 원본과 api/_pricing_spec.json만으로 추천 키와 참고견적을 다시 만든다.
 * 결제 함수가 아니며 주문·승인·청구를 일으키지 않는다.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CHARTER_MAP, resolveKrwAmount } from './resolve-line-item.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCT_TYPE_BY_TOUR_KEY = Object.fromEntries(
  Object.entries(CHARTER_MAP).map(([productType, tourKey]) => [tourKey, productType]),
);

let pricingSpec = null;
let pricingSpecError = null;

export function loadInquiryPricingSpec() {
  if (pricingSpec) return pricingSpec;
  if (pricingSpecError) return null;
  try {
    pricingSpec = JSON.parse(readFileSync(join(__dirname, '..', '_pricing_spec.json'), 'utf-8'));
    return pricingSpec;
  } catch (err) {
    pricingSpecError = err instanceof Error ? err.message : String(err);
    console.error('[inquiry-quote] pricing spec load failed:', pricingSpecError);
    return null;
  }
}

function planDays(plan) {
  const itineraryDays = plan && plan.itinerary && plan.itinerary.days;
  if (Array.isArray(itineraryDays)) return itineraryDays;
  return Array.isArray(plan && plan.days) ? plan.days : [];
}

function stopSearchText(stop) {
  if (!stop || typeof stop !== 'object') return '';
  return [stop.name, stop.display_name, stop['name_en'], stop['name_ko']]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

const TOUR_KEYS_BY_REGION = {
  seoul: ['seoul-city', 'seoul-suburb', 'dmz', 'gangwon', 'ski-resort'],
  busan: ['busan-day'],
  gyeongju: ['gyeongju-jeonju'],
  jeonju: ['gyeongju-jeonju'],
  gangneung: ['gangwon'],
  jeju: [],
};

function normalizeRegionKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('busan') || normalized.includes('부산') || normalized.includes('釜山')) return 'busan';
  if (normalized.includes('gyeongju') || normalized.includes('경주') || normalized.includes('慶州') || normalized.includes('庆州')) return 'gyeongju';
  if (normalized.includes('jeonju') || normalized.includes('전주') || normalized.includes('全州')) return 'jeonju';
  if (normalized.includes('gangneung') || normalized.includes('강릉') || normalized.includes('江陵')) return 'gangneung';
  if (normalized.includes('jeju') || normalized.includes('제주') || normalized.includes('済州') || normalized.includes('濟州') || normalized.includes('济州')) return 'jeju';
  if (normalized.includes('seoul') || normalized.includes('서울') || normalized.includes('ソウル') || normalized.includes('首尔') || normalized.includes('首爾')) return 'seoul';
  return null;
}

export function planPrimaryTourKeys(plan) {
  const input = plan && plan.input && typeof plan.input === 'object' ? plan.input : {};
  const regions = Array.isArray(input.regions) ? input.regions : [];
  const regionKey = normalizeRegionKey(regions[0] || input.destination || input.area || input.region);
  return regionKey ? TOUR_KEYS_BY_REGION[regionKey] || null : null;
}

export function detectPlanTourKey(plan, spec = loadInquiryPricingSpec()) {
  if (!spec || !spec.daily_tour_prices) return null;
  const allText = planDays(plan)
    .flatMap((day) => (day && Array.isArray(day.stops) ? day.stops : []))
    .map(stopSearchText)
    .join(' ')
    .toLowerCase();
  if (!allText) return null;

  const allowedTourKeys = planPrimaryTourKeys(plan);
  const allowedSet = allowedTourKeys ? new Set(allowedTourKeys) : null;
  const candidates = Object.entries(spec.daily_tour_prices)
    .filter(([tourKey, entry]) => (
      tourKey !== 'comment'
      && entry
      && Array.isArray(entry.keywords)
      && (!allowedSet || allowedSet.has(tourKey))
      && entry.keywords.some((keyword) => {
        const normalized = String(keyword || '').trim().toLowerCase();
        return normalized && allText.includes(normalized);
      })
    ))
    .sort(([, left], [, right]) => Number(right.priceKRW || 0) - Number(left.priceKRW || 0));

  return candidates.length > 0 ? candidates[0][0] : null;
}

export function resolveInquiryQuoteByTourKey(tourKey, spec = loadInquiryPricingSpec()) {
  if (!spec) return { ok: false, code: 'PRICING_UNAVAILABLE' };
  const normalizedTourKey = String(tourKey || '').trim();
  const productType = PRODUCT_TYPE_BY_TOUR_KEY[normalizedTourKey];
  const entry = spec.daily_tour_prices && spec.daily_tour_prices[normalizedTourKey];
  if (!productType || !entry) return { ok: false, code: 'INVALID_QUOTE_KEY' };

  // PlanDetail 배너와 동일한 의미: 1회 일일투어 참고가, 차량 추가금 미선택.
  const amountKRW = resolveKrwAmount(spec, productType, 1, 1, undefined);
  const hours = Number(entry.hours);
  if (!Number.isSafeInteger(amountKRW) || amountKRW <= 0 || !Number.isFinite(hours) || hours <= 0) {
    return { ok: false, code: 'PRICING_INVALID' };
  }

  return {
    ok: true,
    tourKey: normalizedTourKey,
    productType,
    amountKRW,
    currency: 'KRW',
    hours,
    recommendedTour: String(entry.name_en || entry.name_ko || normalizedTourKey),
    pricingVersion: String(spec.version || 'unknown'),
    provenance: 'server_pricing_spec',
  };
}

export function resolvePlanInquiryQuote(plan, spec = loadInquiryPricingSpec()) {
  if (!spec) return { ok: false, code: 'PRICING_UNAVAILABLE' };
  const tourKey = detectPlanTourKey(plan, spec);
  if (!tourKey) return { ok: false, code: 'NO_CHARTER_RECOMMENDATION' };
  return resolveInquiryQuoteByTourKey(tourKey, spec);
}

export function buildPlanInquiryContext(plan) {
  const days = planDays(plan);
  const input = plan && plan.input && typeof plan.input === 'object' ? plan.input : {};
  const rawPax = Number(input.adults || input.pax);
  const pax = Number.isFinite(rawPax) && rawPax >= 1 && rawPax <= 999
    ? Math.floor(rawPax)
    : null;
  // startDate is a single point value; no inclusive/exclusive date-range calculation occurs here.
  const startDate = String(input.startDate || '').trim().slice(0, 40) || null;
  const itinerarySummary = days.slice(0, 7).map((day, index) => ({
    day: Number(day && day.day) || index + 1,
    theme: String((day && day.theme) || '').trim().slice(0, 200),
    stopCount: day && Array.isArray(day.stops) ? day.stops.length : 0,
  }));
  return {
    startDate,
    eventDate: startDate,
    pax,
    dayCount: days.length,
    itinerarySummary,
  };
}

export function canAccessPlanForInquiry(plan, userId, accessToken) {
  if (!plan || typeof plan !== 'object') return false;
  if (userId && plan.uid && String(plan.uid) === String(userId)) return true;
  if (accessToken && plan.accessToken && String(plan.accessToken) === String(accessToken)) return true;
  return plan.isPublic === true;
}
