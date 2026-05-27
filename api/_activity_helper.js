/**
 * _activity_helper.js — CocoTrip
 *
 * P241 (2026-05-27): 특수 활동 DB helpers.
 * Kbeauty / DMZ / Haenyeo / Jjimjilbang / HangangBike 5개 영역 통합.
 *
 * handlerCore.js 의 styles 배열에 해당 옵션 포함 시 주입.
 * 각 영역은 별도 index JSON 파일에서 lazy-load.
 *
 * Usage (handlerCore.js):
 *   import { getActivityContextForPrompt } from '../_activity_helper.js';
 *   const activityContext = getActivityContextForPrompt({ styles, city, language });
 *
 * Supported styles: 'Kbeauty', 'Dmz', 'Haenyeo', 'Jjimjilbang', 'HangangBike'
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lazy-load indexes ────────────────────────────────────────────────────────
const _indexes = {};

function loadIndex(name) {
  if (!_indexes[name]) {
    try {
      const raw = readFileSync(join(__dirname, `_${name}_index.json`), 'utf-8');
      _indexes[name] = JSON.parse(raw);
      console.log(`[activity-helper] Loaded ${_indexes[name].length} items from ${name} index`);
    } catch (err) {
      console.warn(`[activity-helper] Failed to load _${name}_index.json:`, err.message);
      _indexes[name] = [];
    }
  }
  return _indexes[name];
}

// ── City normalization ───────────────────────────────────────────────────────
const CITY_MAP = {
  seoul: 'seoul', '서울': 'seoul', incheon: 'seoul', '인천': 'seoul',
  busan: 'busan', '부산': 'busan',
  jeju: 'jeju', '제주': 'jeju', '제주도': 'jeju',
  paju: 'paju', '파주': 'paju',
};

function normCity(dest) {
  if (!dest) return 'seoul';
  const d = dest.toLowerCase().trim();
  return CITY_MAP[d] ||
    (d.includes('seoul') ? 'seoul' :
     d.includes('busan') ? 'busan' :
     d.includes('jeju')  ? 'jeju'  :
     d.includes('paju')  ? 'paju'  : 'seoul');
}

// ── Style → index mapping ────────────────────────────────────────────────────
const STYLE_INDEX_MAP = {
  Kbeauty:     'kbeauty',
  Dmz:         'dmz',
  Haenyeo:     'haenyeo',
  Jjimjilbang: 'jjimjilbang',
  HangangBike: 'hangang_bike',
};

// ── Format helpers ───────────────────────────────────────────────────────────

function formatKbeautyItem(item, lang) {
  const name = item.name?.[lang] || item.name?.en || '';
  const address = item.address?.[lang] || item.address?.en || '';
  const tip = item.foreigner_tips?.[lang] || item.foreigner_tips?.en || '';
  return `  • ${name} | Area: ${item.area} | Hours: ${item.hours}${item.tax_refund ? ' | Tax refund ✓' : ''}\n    ${address}\n    Tip: ${tip}`;
}

function formatDmzItem(item, lang) {
  const name = item.name?.[lang] || item.name?.en || '';
  const address = item.address?.[lang] || item.address?.en || '';
  const fee = item.entry_fee?.adult_krw === 0
    ? (lang === 'ko' ? '무료' : lang === 'ja' ? '無料' : lang === 'zh' ? '免费' : 'Free')
    : `₩${item.entry_fee?.adult_krw?.toLocaleString()}`;
  const tip = item.foreigner_tips?.[lang] || item.foreigner_tips?.en || '';
  const safety = item.safety_note?.[lang] || item.safety_note?.en || '';
  const reservation = item.reservation_required
    ? (lang === 'ko' ? '🔴 사전예약 필수' : lang === 'ja' ? '🔴 事前予約必須' : lang === 'zh' ? '🔴 须提前预约' : '🔴 ADVANCE RESERVATION REQUIRED')
    : '';
  return [
    `  • ${name} | Entry: ${fee} | Duration: ~${item.duration_min}min`,
    `    Address: ${address}`,
    reservation ? `    ${reservation}` : '',
    `    Tip: ${tip}`,
    safety ? `    ⚠️ ${safety}` : '',
  ].filter(Boolean).join('\n');
}

function formatHaenyeoItem(item, lang) {
  const name = item.name?.[lang] || item.name?.en || '';
  const address = item.address?.[lang] || item.address?.en || '';
  const fee = item.entry_fee?.adult_krw === 0
    ? (lang === 'ko' ? '무료' : lang === 'ja' ? '無料' : lang === 'zh' ? '免费' : 'Free')
    : `₩${item.entry_fee?.adult_krw?.toLocaleString()}`;
  const tip = item.foreigner_tips?.[lang] || item.foreigner_tips?.en || '';
  const reservation = item.reservation_required
    ? (lang === 'ko' ? '🔴 사전예약 필수' : lang === 'ja' ? '🔴 事前予約必須' : lang === 'zh' ? '🔴 须提前预约' : '🔴 ADVANCE RESERVATION REQUIRED')
    : '';
  const food = item.food_highlights?.[lang] || item.food_highlights?.en || '';
  return [
    `  • ${name} | Type: ${item.type} | Entry: ${fee} | Duration: ~${item.duration_min}min`,
    `    ${address}`,
    reservation ? `    ${reservation}` : '',
    `    Tip: ${tip}`,
    food ? `    Food: ${food}` : '',
  ].filter(Boolean).join('\n');
}

function formatJjimjilbangItem(item, lang) {
  const name = item.name?.[lang] || item.name?.en || '';
  const address = item.address?.[lang] || item.address?.en || '';
  const tip = item.foreigner_tips?.[lang] || item.foreigner_tips?.en || '';
  const genderPolicy = item.gender_policy?.[lang] || item.gender_policy?.en || '';
  return [
    `  • ${name} | ★${item.rating} | Entry: ₩${item.entry_fee?.adult_krw?.toLocaleString()} | Hours: ${item.hours}`,
    `    ${address}`,
    `    Tip: ${tip}`,
    genderPolicy ? `    Gender policy: ${genderPolicy}` : '',
  ].filter(Boolean).join('\n');
}

function formatHangangBikeItem(item, lang) {
  const name = item.name?.[lang] || item.name?.en || '';
  const address = item.address?.[lang] || item.address?.en || '';
  const fee = item.rental_fee?.['1h_krw'];
  const route = item.route_highlights?.[lang] || item.route_highlights?.en || '';
  const tip = item.foreigner_tips?.[lang] || item.foreigner_tips?.en || '';
  return [
    `  • ${name} | ₩${fee}/hr | ~${item.distance_km}km route | ~${item.duration_min}min`,
    `    ${address}`,
    `    Route: ${route}`,
    `    Tip: ${tip}`,
  ].filter(Boolean).join('\n');
}

// ── Section headers by style + language ─────────────────────────────────────
const SECTION_HEADERS = {
  Kbeauty: {
    en: '## VERIFIED K-BEAUTY DATABASE (foreigner-friendly beauty stores)',
    ja: '## 検証済みK-beautyデータベース（外国人向けビューティーショップ）',
    zh: '## 已验证K-beauty数据库（外国人友好型美妆店）',
    ko: '## 검증된 K-뷰티 데이터베이스 (외국인 친화 뷰티 스토어)',
  },
  Dmz: {
    en: '## VERIFIED DMZ TOUR DATABASE (advance booking for some sites required)',
    ja: '## 検証済みDMZツアーデータベース（一部施設は事前予約必須）',
    zh: '## 已验证DMZ游览数据库（部分景点须提前预约）',
    ko: '## 검증된 DMZ 투어 데이터베이스 (일부 시설 사전예약 필수)',
  },
  Haenyeo: {
    en: '## VERIFIED HAENYEO EXPERIENCE DATABASE (UNESCO Intangible Cultural Heritage)',
    ja: '## 検証済み海女体験データベース（ユネスコ無形文化遺産）',
    zh: '## 已验证海女体验数据库（联合国教科文组织非物质文化遗产）',
    ko: '## 검증된 해녀 체험 데이터베이스 (유네스코 무형문화유산)',
  },
  Jjimjilbang: {
    en: '## VERIFIED JJIMJILBANG DATABASE (Korean sauna/bathhouse — cultural experience)',
    ja: '## 検証済み찜질방データベース（韓国式サウナ/浴場 — 文化体験）',
    zh: '## 已验证汗蒸幕数据库（韩式桑拿/浴室——文化体验）',
    ko: '## 검증된 찜질방 데이터베이스 (한국식 사우나/목욕탕 — 문화 체험)',
  },
  HangangBike: {
    en: '## VERIFIED HANGANG BIKE RENTAL DATABASE (Ttareungi — Seoul public bike)',
    ja: '## 検証済み漢江自転車レンタルデータベース（タレンギ — ソウル公共自転車）',
    zh: '## 已验证汉江自行车租借数据库（首尔公共自行车따릉이）',
    ko: '## 검증된 한강 따릉이 데이터베이스 (서울 공공자전거)',
  },
};

const SECTION_FOOTERS = {
  Kbeauty: {
    en: 'Use EXACT store names from above. All support tax refund for foreign visitors. Schedule ~2h for K-beauty shopping.',
    ja: '上記の正確な店舗名を使用してください。すべて外国人向け税金還付対応。K-beautyショッピングには約2時間を確保。',
    zh: '请使用上方准确的店铺名称。所有店铺均支持外国游客退税。K-beauty购物约预留2小时。',
    ko: '위 목록의 정확한 스토어명 사용. 모두 외국인 세금환급 지원. K-뷰티 쇼핑 약 2시간 배정 권장.',
  },
  Dmz: {
    en: 'IMPORTANT: Schedule DMZ as a FULL DAY trip from Seoul (~8h). Some sites REQUIRE advance booking — include booking reminders. Bring passport.',
    ja: '重要: DMZはソウルからの1日旅行として計画（約8時間）。一部施設は事前予約必須 — 予約リマインダーを含めること。パスポート持参。',
    zh: '重要：将DMZ安排为从首尔出发的全天游（约8小时）。部分景点须提前预约——请包含预约提醒。携带护照。',
    ko: '중요: DMZ는 서울 발 하루 여행으로 계획 (~8h). 일부 시설 사전예약 필수 — 예약 안내 포함. 여권 지참 안내.',
  },
  Haenyeo: {
    en: 'Schedule haenyeo experience as a dedicated ~2-3h activity. Combine with nearby Seongsan or coast visit. For reservation-required experiences, include booking reminder.',
    ja: '海女体験は専用の2〜3時間のアクティビティとして計画。近隣の城山や海岸訪問と組み合わせ。要予約体験には予約リマインダーを含めること。',
    zh: '将海女体验安排为专门的2-3小时活动。可与附近的城山或海岸游览结合。须预约的体验请包含预约提醒。',
    ko: '해녀 체험은 2-3시간 전담 활동으로 배정. 인근 성산 또는 해안 방문과 조합. 예약 필요 체험 시 예약 안내 포함.',
  },
  Jjimjilbang: {
    en: 'Use EXACT names from above. Schedule jjimjilbang as evening/night activity (2-3h). Note gender-separate bathing rules — keep gowns on in common areas.',
    ja: '上記の正確な名称を使用してください。찜질방は夜間アクティビティとして計画（2〜3時間）。男女別入浴ルールに注意 — 共用エリアではガウン着用維持。',
    zh: '请使用上方准确的名称。将汗蒸幕安排为晚间活动（2-3小时）。注意男女分浴规定——在公共区域保持穿着睡衣。',
    ko: '위 목록의 정확한 명칭 사용. 찜질방은 저녁/야간 활동으로 배정 (2-3h). 남녀 목욕 분리 규정 안내 — 공용 구역 가운 착용 유지.',
  },
  HangangBike: {
    en: 'Use 따릉이 app (iOS/Android). ₩1,000/hr. Bike paths are safe and dedicated. Schedule 1.5-2h for a proper river ride.',
    ja: '따릉이アプリ（iOS/Android）使用。₩1,000/時間。自転車専用道は安全。本格的な川沿いライドには1.5〜2時間を確保。',
    zh: '使用따릉이 APP（iOS/Android）。₩1,000/小时。专用自行车道安全。正式沿河骑行约1.5-2小时。',
    ko: '따릉이 앱 (iOS/Android) 사용. ₩1,000/시간. 전용 자전거 도로 안전. 제대로 된 강변 라이딩 1.5-2h 배정.',
  },
};

// ── City filter for each activity type ──────────────────────────────────────
// DMZ → paju only / Haenyeo → jeju only / others have city variants
const CITY_AGNOSTIC = new Set(['Dmz', 'Haenyeo', 'HangangBike']); // these don't filter by user's city

/**
 * Get items for a style, filtered by city where applicable.
 */
function getItemsForStyle(style, cityCode, maxItems = 4) {
  const indexName = STYLE_INDEX_MAP[style];
  if (!indexName) return [];
  const index = loadIndex(indexName);
  if (!index.length) return [];

  // City-agnostic styles: return top items regardless of city
  if (CITY_AGNOSTIC.has(style)) {
    return index.slice(0, maxItems);
  }

  // City-filtered: try city first, fall back to all
  const filtered = index.filter(item => item.city === cityCode);
  if (filtered.length > 0) return filtered.slice(0, maxItems);
  return index.slice(0, maxItems); // fallback to all
}

/**
 * formatItem — dispatch to per-style formatter.
 */
function formatItem(style, item, lang) {
  switch (style) {
    case 'Kbeauty':     return formatKbeautyItem(item, lang);
    case 'Dmz':         return formatDmzItem(item, lang);
    case 'Haenyeo':     return formatHaenyeoItem(item, lang);
    case 'Jjimjilbang': return formatJjimjilbangItem(item, lang);
    case 'HangangBike': return formatHangangBikeItem(item, lang);
    default:            return '';
  }
}

/**
 * getActivityContextForPrompt — handlerCore.js 주입용 통합 헬퍼.
 *
 * @param {object} opts
 * @param {string[]} opts.styles - WizardForm styles 배열
 * @param {string}   opts.city   - plan 주 도시 key
 * @param {string}   [opts.language='en']
 * @param {number}   [opts.maxItemsPerStyle=3]
 * @returns {string} '' 이면 주입 skip
 */
export function getActivityContextForPrompt({ styles = [], city, language = 'en', maxItemsPerStyle = 3 } = {}) {
  const lang = ['en', 'ja', 'zh', 'ko'].includes(language) ? language : 'en';
  const cityCode = normCity(city);

  const supportedStyles = styles.filter(s => STYLE_INDEX_MAP[s]);
  if (supportedStyles.length === 0) return '';

  const sections = [];

  for (const style of supportedStyles) {
    const items = getItemsForStyle(style, cityCode, maxItemsPerStyle);
    if (items.length === 0) continue;

    const header = SECTION_HEADERS[style]?.[lang] || SECTION_HEADERS[style]?.en || '';
    const footer = SECTION_FOOTERS[style]?.[lang] || SECTION_FOOTERS[style]?.en || '';
    const lines = items.map(item => formatItem(style, item, lang));

    sections.push(`${header}\n\n${lines.join('\n\n')}\n\n${footer}`);
  }

  if (sections.length === 0) return '';
  return `\n\n--- VERIFIED ACTIVITY DATABASE ---\n${sections.join('\n\n---\n\n')}\n---`;
}

/**
 * getKbeautyContext — Kbeauty 전용 헬퍼 (단독 호출용).
 * @param {string} city
 * @param {string} [language='en']
 * @returns {string}
 */
export function getKbeautyContext(city, language = 'en') {
  return getActivityContextForPrompt({ styles: ['Kbeauty'], city, language });
}

/**
 * getDmzContext — DMZ 전용 헬퍼.
 * @param {string} [language='en']
 * @returns {string}
 */
export function getDmzContext(language = 'en') {
  return getActivityContextForPrompt({ styles: ['Dmz'], city: 'paju', language });
}

/**
 * getHaenyeoContext — Haenyeo 전용 헬퍼.
 * @param {string} [language='en']
 * @returns {string}
 */
export function getHaenyeoContext(language = 'en') {
  return getActivityContextForPrompt({ styles: ['Haenyeo'], city: 'jeju', language });
}

/**
 * getJjimjilbangContext — Jjimjilbang 전용 헬퍼.
 * @param {string} city
 * @param {string} [language='en']
 * @returns {string}
 */
export function getJjimjilbangContext(city, language = 'en') {
  return getActivityContextForPrompt({ styles: ['Jjimjilbang'], city, language });
}

/**
 * getHangangBikeContext — HangangBike 전용 헬퍼.
 * @param {string} [language='en']
 * @returns {string}
 */
export function getHangangBikeContext(language = 'en') {
  return getActivityContextForPrompt({ styles: ['HangangBike'], city: 'seoul', language });
}
