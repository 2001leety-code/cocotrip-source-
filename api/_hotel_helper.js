/**
 * _hotel_helper.js — CocoTrip
 *
 * P241 (2026-05-27): 15 row 외국인 인기 호텔 DB (서울/부산/제주/경주/전주).
 * Trip.com 어필리에이트 연동 구조 — src/data/hotels.ts 와 다름 (백엔드 프롬프트 주입용).
 *
 * handlerCore.js 의 hotel 옵션 또는 hotel_address 비어있을 때 주입.
 * Gemini hallucination (없는 호텔명 생성) → 검증 DB 주입 방식 전환.
 *
 * Usage:
 *   import {
 *     getHotelsForCity,
 *     getHotelsForRegion,
 *     formatHotelForPrompt,
 *     getHotelContextForPrompt,
 *   } from './_hotel_helper.js';
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lazy-load hotel index ────────────────────────────────────────────────────
let _hotelIndex = null;

function getHotelIndex() {
  if (!_hotelIndex) {
    try {
      const raw = readFileSync(join(__dirname, '_hotel_index.json'), 'utf-8');
      _hotelIndex = JSON.parse(raw);
      console.log(`[hotel-helper] Loaded ${_hotelIndex.length} hotels from index`);
    } catch (err) {
      console.warn('[hotel-helper] Failed to load _hotel_index.json:', err.message);
      _hotelIndex = [];
    }
  }
  return _hotelIndex;
}

// ── City / region mapping ───────────────────────────────────────────────────
const CITY_MAP = {
  // 서울
  seoul: 'seoul', '서울': 'seoul', seoul_city: 'seoul',
  incheon: 'seoul', '인천': 'seoul', suwon: 'seoul', '수원': 'seoul',
  // 부산
  busan: 'busan', '부산': 'busan',
  // 제주
  jeju: 'jeju', '제주': 'jeju', 'jeju island': 'jeju', '제주도': 'jeju',
  // 경주
  gyeongju: 'gyeongju', '경주': 'gyeongju',
  // 전주
  jeonju: 'jeonju', '전주': 'jeonju',
};

function normCity(dest) {
  if (!dest) return null;
  const d = dest.toLowerCase().trim();
  return CITY_MAP[d] ||
    (d.includes('seoul')    ? 'seoul'    :
     d.includes('busan')    ? 'busan'    :
     d.includes('jeju')     ? 'jeju'     :
     d.includes('gyeongju') ? 'gyeongju' :
     d.includes('jeonju')   ? 'jeonju'   : null);
}

// ── Price tier labels ───────────────────────────────────────────────────────
const PRICE_TIER_LABELS = {
  budget:       { en: 'Budget', ja: 'エコノミー', zh: '经济型', ko: '저가' },
  mid_range:    { en: 'Mid-range', ja: 'ミドルクラス', zh: '中档', ko: '중가' },
  luxury:       { en: 'Luxury', ja: 'ラグジュアリー', zh: '豪华型', ko: '럭셔리' },
  ultra_luxury: { en: 'Ultra Luxury', ja: 'ウルトララグジュアリー', zh: '超豪华', ko: '최고급' },
};

/**
 * getHotelsForCity — city 필터로 호텔 목록 반환.
 *
 * @param {string} city - 도시 key (예: 'seoul', 'busan', 'jeju', 'gyeongju', 'jeonju')
 * @param {object} [opts]
 * @param {string} [opts.priceTier] - 'budget' | 'mid_range' | 'luxury' | 'ultra_luxury'
 * @param {number} [opts.minRating] - 최소 rating (기본 0)
 * @param {number} [opts.maxItems] - 최대 개수 (기본 5)
 * @returns {Array<object>}
 */
export function getHotelsForCity(city, { priceTier, minRating = 0, maxItems = 5 } = {}) {
  const index = getHotelIndex();
  if (!index.length) return [];

  const cityCode = normCity(city);
  if (!cityCode) return [];

  let results = index.filter(h => h.city === cityCode);
  if (results.length === 0) return [];

  if (priceTier) {
    const filtered = results.filter(h => h.price_tier === priceTier);
    if (filtered.length > 0) results = filtered;
  }

  if (minRating > 0) {
    const filtered = results.filter(h => h.rating >= minRating);
    if (filtered.length > 0) results = filtered;
  }

  // rating 내림차순
  return results
    .sort((a, b) => b.rating - a.rating)
    .slice(0, maxItems);
}

/**
 * getHotelsForRegion — region 필터로 호텔 목록 반환.
 * 부산+경주 같은 경우 region='gyeongsang_buk' 로 묶어서 조회.
 *
 * @param {string} region - 'seoul' | 'busan' | 'jeju' | 'gyeongsang_buk' | 'jeolla_buk'
 * @param {number} [maxItems=5]
 * @returns {Array<object>}
 */
export function getHotelsForRegion(region, maxItems = 5) {
  const index = getHotelIndex();
  if (!index.length) return [];
  const regionKey = (region || '').toLowerCase().trim();
  return index
    .filter(h => h.region === regionKey)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, maxItems);
}

/**
 * formatHotelForPrompt — 단일 호텔 row → Gemini 주입용 텍스트.
 *
 * @param {object} hotel - getHotelsForCity 결과 row
 * @param {string} [language='en'] - 'en' | 'ja' | 'zh' | 'ko'
 * @returns {string}
 */
export function formatHotelForPrompt(hotel, language = 'en') {
  if (!hotel) return '';
  const lang = ['en', 'ja', 'zh', 'ko'].includes(language) ? language : 'en';
  const name = hotel.name?.[lang] || hotel.name?.en || '';
  const address = hotel.address?.[lang] || hotel.address?.en || '';
  const tierLabel = PRICE_TIER_LABELS[hotel.price_tier]?.[lang] || hotel.price_tier;
  const nearby = Array.isArray(hotel.nearby) ? hotel.nearby.slice(0, 3).join(', ') : '';

  const templates = {
    en: `  • ${name} ★${hotel.stars} | Rating: ${hotel.rating}/10 | From $${hotel.price_usd_min}/night (${tierLabel})\n    Address: ${address}\n    Nearby: ${nearby}`,
    ja: `  • ${name} ★${hotel.stars} | 評価: ${hotel.rating}/10 | $${hotel.price_usd_min}/泊〜 (${tierLabel})\n    住所: ${address}\n    周辺: ${nearby}`,
    zh: `  • ${name} ★${hotel.stars} | 评分: ${hotel.rating}/10 | $${hotel.price_usd_min}/晚起 (${tierLabel})\n    地址: ${address}\n    周边: ${nearby}`,
    ko: `  • ${name} ★${hotel.stars} | 평점: ${hotel.rating}/10 | $${hotel.price_usd_min}/박~ (${tierLabel})\n    주소: ${address}\n    주변: ${nearby}`,
  };
  return templates[lang] || templates.en;
}

/**
 * getHotelContextForPrompt — handlerCore.js 주입용 통합 헬퍼.
 * hotel_address 비어있고 사용자가 hotel 미결정일 때 호출.
 *
 * @param {object} opts
 * @param {string}   opts.city - plan 주 도시 key
 * @param {string}   [opts.priceTier] - 사용자 선택 price tier
 * @param {string}   [opts.language='en']
 * @param {number}   [opts.maxItems=4]
 * @returns {string} '' 이면 주입 skip
 */
export function getHotelContextForPrompt({ city, priceTier, language = 'en', maxItems = 4 } = {}) {
  const hotels = getHotelsForCity(city, { priceTier, maxItems });
  if (!hotels.length) return '';

  const lang = ['en', 'ja', 'zh', 'ko'].includes(language) ? language : 'en';
  const header = {
    en: '## VERIFIED HOTEL DATABASE (foreigner-friendly hotels with Trip.com booking)',
    ja: '## 検証済みホテルデータベース（外国人に優しいホテル）',
    zh: '## 已验证酒店数据库（外国人友好型酒店）',
    ko: '## 검증된 호텔 데이터베이스 (외국인 친화 호텔)',
  }[lang] || '## VERIFIED HOTEL DATABASE';

  const footer = {
    en: 'When suggesting hotels, use EXACT hotel names from above. These are foreigner-friendly with English service. Always include the address.',
    ja: 'ホテルを提案する際は、上記の正確なホテル名を使用してください。すべて英語サービス対応です。必ず住所を含めてください。',
    zh: '建议酒店时，请使用上方的准确酒店名称。这些都是提供英语服务的外国人友好型酒店。请务必包含地址。',
    ko: '호텔 추천 시 위 목록의 정확한 호텔명 사용. 모두 영어 서비스 제공 외국인 친화 호텔. 반드시 주소 포함.',
  }[lang] || 'Use EXACT hotel names from above list.';

  const lines = hotels.map(h => formatHotelForPrompt(h, lang));

  return `\n\n--- VERIFIED HOTEL DATABASE ---\n${header}\n\n${lines.join('\n')}\n\n${footer}\n---`;
}
