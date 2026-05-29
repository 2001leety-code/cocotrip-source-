/**
 * Shared constants for ai-planner-full pipeline.
 * Extracted verbatim from api/ai-planner-full.js L22-109, L172-199.
 */

// ── 환경변수 trim — Naver API 헤더 오류 방지 (개행/공백 제거) ──────────
['NAVER_CLIENT_ID','NAVER_CLIENT_SECRET','NCP_CLIENT_ID','NCP_CLIENT_SECRET'].forEach(k => {
  if (process.env[k]) process.env[k] = process.env[k].trim();
});

// ── CORS 헤더 ─────────────────────────────────────────────────────────────
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── 공항 주소 매핑 ─────────────────────────────────────────────────────────
export const AIRPORT_ADDRESSES = {
  ICN_T1: '인천광역시 중구 공항로272번길 43 (제1여객터미널)',
  ICN_T2: '인천광역시 중구 제2터미널대로 (제2여객터미널)',
  ICN: '인천광역시 중구 공항로272번길 43 (인천국제공항)',
  GMP: '서울특별시 강서구 하늘길 77',
  PUS: '부산광역시 강서구 공항진입로 108',
  CJU: '제주특별자치도 제주시 공항로 2',
  TAE: '대구광역시 동구 공항로 221',
  KWJ: '광주광역시 광산구 상무대로 420',
  MWX: '전라남도 무안군 망운면 공항로 970-260',
  YNY: '강원특별자치도 양양군 손양면 공항로 201',
  ALREADY: null,
};

export const AIRPORT_NAMES = {
  ICN_T1: 'Incheon Airport Terminal 1',
  ICN_T2: 'Incheon Airport Terminal 2',
  GMP: 'Gimpo Airport',
  PUS: 'Gimhae Airport (Busan)',
  CJU: 'Jeju Airport',
  TAE: 'Daegu Airport',
  KWJ: 'Gwangju Airport',
  MWX: 'Muan Airport',
  YNY: 'Yangyang Airport',
  ALREADY: null,
};

// ── 공항 좌표 (lat/lng) — RouteAgent의 ODsay 호출용 ────────────────────────
// 출처: 각 공항 운영사 공식 좌표. Terminal별 좌표가 다르면 도보 5분+ 차이.
export const AIRPORT_COORDS = {
  ICN_T1: { lat: 37.4602, lng: 126.4407 },
  ICN_T2: { lat: 37.4583, lng: 126.4424 },
  ICN:    { lat: 37.4602, lng: 126.4407 },
  GMP:    { lat: 37.5587, lng: 126.7905 },
  PUS:    { lat: 35.1795, lng: 128.9381 },
  CJU:    { lat: 33.5113, lng: 126.4928 },
  TAE:    { lat: 35.8941, lng: 128.6588 },
  KWJ:    { lat: 35.1264, lng: 126.8089 },
  MWX:    { lat: 34.9914, lng: 126.3829 },
  YNY:    { lat: 38.0613, lng: 128.6694 },
  ALREADY: null,
};

// ── 도시 중심 좌표 (Hotel/Zone 좌표 모두 없을 때 fallback) ─────────────────
// 호텔→공항 경로를 무조건 표시하기 위한 last-resort fallback. 정확하진 않지만
// "공항 가는 길" 카드를 끝까지 비우지 않도록 ODsay 호출은 가능하게 한다.
// 사용자에게는 "도시 중심 기준 추정"이라고 안내한다 (CITY_CENTER source 표시).
export const CITY_CENTER_COORDS = {
  seoul: { lat: 37.5665, lng: 126.9780, label: 'Seoul City Center' },
  seoul_city: { lat: 37.5665, lng: 126.9780, label: 'Seoul City Center' },
  seoul_suburb: { lat: 37.5665, lng: 126.9780, label: 'Seoul City Center' },
  incheon: { lat: 37.4563, lng: 126.7052, label: 'Incheon City Center' },
  busan: { lat: 35.1796, lng: 129.0756, label: 'Busan City Center' },
  yeosu: { lat: 34.7604, lng: 127.6622, label: 'Yeosu City Center' },
  daegu: { lat: 35.8714, lng: 128.6014, label: 'Daegu City Center' },
  jeju: { lat: 33.4996, lng: 126.5312, label: 'Jeju City Center' },
  gyeongju: { lat: 35.8562, lng: 129.2247, label: 'Gyeongju City Center' },
  jeonju: { lat: 35.8242, lng: 127.1480, label: 'Jeonju City Center' },
  gangneung: { lat: 37.7519, lng: 128.8761, label: 'Gangneung City Center' },
  chuncheon: { lat: 37.8813, lng: 127.7298, label: 'Chuncheon City Center' },
  gangwon: { lat: 37.8228, lng: 128.1555, label: 'Gangwon Region' },
  pyeongchang: { lat: 37.3705, lng: 128.3902, label: 'Pyeongchang' },
  suwon: { lat: 37.2636, lng: 127.0286, label: 'Suwon City Center' },
  dmz: { lat: 37.9558, lng: 126.6748, label: 'DMZ Imjingak' },
};

// ── 동(neighborhood) 단위 zone → 좌표 직매핑 (B9-15/16/25, 2026-05-09) ──────
// **목적**: 운영자가 호텔 주소("명동 롯데호텔") 또는 zone key("myeongdong") /
// 한국어 명("명동")만 입력해도 RouteAgent 가 정확한 좌표를 즉시 잡도록 한다.
// Naver Geocoding 은 도로명/지번에 강하지만 "명동" 같은 단일 동 명에 약하고,
// NCP 키 401/timeout 으로 silent fail 시 city center 로 떨어짐 → 시청→노량진→
// 김포 우회 routing (사용자 신고). 이 테이블은 Naver 호출 전 첫 번째 fallback.
//
// 키는 **소문자 영문 zone key** (zoneData.ts 와 동일) **+ 한국어 표기**.
// 한국어 표기는 정확한 매칭만 — RouteAgent 는 String(zone).trim() 후 정확 비교.
// 추가 시 zoneData.ts anchorAddress 와 좌표 일관성 확인.
//
// 좌표 기준: 각 zone 의 대표 지하철역 (네이버 검색 좌표). ±100m 이내.
export const ZONE_COORDS = {
  // ── Seoul ─────────────────────────────────────────
  myeongdong: { lat: 37.5635, lng: 126.9821, label: '명동' },
  '명동': { lat: 37.5635, lng: 126.9821, label: '명동' },
  hongdae: { lat: 37.5571, lng: 126.9240, label: '홍대' },
  '홍대': { lat: 37.5571, lng: 126.9240, label: '홍대' },
  '홍익대학교': { lat: 37.5571, lng: 126.9240, label: '홍대' },
  gangnam: { lat: 37.4979, lng: 127.0276, label: '강남' },
  '강남': { lat: 37.4979, lng: 127.0276, label: '강남' },
  itaewon: { lat: 37.5345, lng: 126.9947, label: '이태원' },
  '이태원': { lat: 37.5345, lng: 126.9947, label: '이태원' },
  jongno: { lat: 37.5704, lng: 126.9826, label: '종로' },
  '종로': { lat: 37.5704, lng: 126.9826, label: '종로' },
  '종각': { lat: 37.5704, lng: 126.9826, label: '종로' },
  jamsil: { lat: 37.5133, lng: 127.1000, label: '잠실' },
  '잠실': { lat: 37.5133, lng: 127.1000, label: '잠실' },
  gwanghwamun: { lat: 37.5759, lng: 126.9769, label: '광화문' },
  '광화문': { lat: 37.5759, lng: 126.9769, label: '광화문' },
  dongdaemun: { lat: 37.5713, lng: 127.0098, label: '동대문' },
  '동대문': { lat: 37.5713, lng: 127.0098, label: '동대문' },
  sinchon: { lat: 37.5559, lng: 126.9366, label: '신촌' },
  '신촌': { lat: 37.5559, lng: 126.9366, label: '신촌' },
  ichon: { lat: 37.5223, lng: 126.9748, label: '이촌' },
  '이촌': { lat: 37.5223, lng: 126.9748, label: '이촌' },
  hannam: { lat: 37.5374, lng: 127.0085, label: '한남' },
  '한남': { lat: 37.5374, lng: 127.0085, label: '한남' },
  // ── Busan ─────────────────────────────────────────
  haeundae: { lat: 35.1631, lng: 129.1635, label: '해운대' },
  '해운대': { lat: 35.1631, lng: 129.1635, label: '해운대' },
  gwangalli: { lat: 35.1532, lng: 129.1186, label: '광안리' },
  '광안리': { lat: 35.1532, lng: 129.1186, label: '광안리' },
  seomyeon: { lat: 35.1577, lng: 129.0594, label: '서면' },
  '서면': { lat: 35.1577, lng: 129.0594, label: '서면' },
  nampo: { lat: 35.0974, lng: 129.0289, label: '남포동' },
  '남포동': { lat: 35.0974, lng: 129.0289, label: '남포동' },
  '남포': { lat: 35.0974, lng: 129.0289, label: '남포동' },
  // ── Jeju ──────────────────────────────────────────
  jeju_city: { lat: 33.5070, lng: 126.4922, label: '제주시' },
  '제주시': { lat: 33.5070, lng: 126.4922, label: '제주시' },
  seogwipo: { lat: 33.2541, lng: 126.4129, label: '서귀포' },
  '서귀포': { lat: 33.2541, lng: 126.4129, label: '서귀포' },
  aewol: { lat: 33.4641, lng: 126.3313, label: '애월' },
  '애월': { lat: 33.4641, lng: 126.3313, label: '애월' },
};

/**
 * Zone key/한국어 명 → 좌표 lookup (RouteAgent fallback chain 1단계).
 * Returns { lat, lng, label } or null. Case-insensitive on Latin keys; exact on Korean.
 */
export function lookupZoneCoord(zone) {
  if (!zone || typeof zone !== 'string') return null;
  const trimmed = zone.trim();
  if (!trimmed) return null;
  // 정확 매칭 (한국어)
  if (ZONE_COORDS[trimmed]) return ZONE_COORDS[trimmed];
  // lowercase 매칭 (영문 zone key)
  const lower = trimmed.toLowerCase();
  if (ZONE_COORDS[lower]) return ZONE_COORDS[lower];
  // 한국어 substring fallback — "명동 롯데호텔", "명동역", "홍대입구역" 등
  // 등록된 한국어 zone 명이 입력 문자열에 포함돼 있으면 매핑.
  for (const k of Object.keys(ZONE_COORDS)) {
    // 한국어 키 (Hangul 만 포함) 만 substring 검사 — 영문 키는 false-positive 위험
    if (/^[가-힯]+$/.test(k) && trimmed.includes(k)) {
      return ZONE_COORDS[k];
    }
  }
  return null;
}

// ── Rich System Prompt Language Instructions ──────────────────────────────
export const LANG_INSTRUCTION = {
  en: `Write ALL narrative text fields in English.
Field-by-field rules:
- "name" → ALWAYS Korean (e.g. 경복궁) — used for Korean map API, never translate
- "display_name" → English (e.g. Gyeongbokgung Palace) — shown to user
- "tip", tour_title, theme → English
- address → Korean road address (for geocoding)
- recommended_items.name → user language (English)
NEVER mix languages within a single string value.`,
  ko: `모든 사용자 대면 텍스트를 자연스러운 한국어로 작성하세요.
필드별 규칙:
- "name" → 반드시 한국어 장소명 (예: 경복궁) — 네이버맵 검색용
- "display_name" → 한국어 (예: 경복궁)
- "tip", tour_title, theme → 한국어
- address → 한국어 도로명 주소
- recommended_items.name → 한국어 (예: 삼계탕)
- 번역투 금지. 자연스럽고 친근한 톤 사용.`,
  ja: `すべてのテキストフィールドを自然な日本語で記述してください。
- "name" → 常に韓国語 (ネイバーマップ検索用)
- "display_name" → 日本語
- "tip" → 日本語
- address → 韓国語の道路名住所`,
  zh: `请用自然流畅的中文填写所有文本字段。
- "name" → 始终韩文 (用于韩国地图搜索)
- "display_name" → 中文
- "tip" → 中文
- address → 韩文道路名地址`,
};
