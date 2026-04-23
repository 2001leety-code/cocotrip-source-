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
