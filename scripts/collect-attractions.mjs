#!/usr/bin/env node
/**
 * CocoTrip — Attraction Collection Script (Naver Local Search API)
 *
 * Collects tourist attraction data for Korean cities, validated via the
 * Naver Local Search API. Produces per-city JSON files in food_data/ that
 * can be merged into a static attraction catalog.
 *
 * Categories collected:
 *   palace        — 궁궐, 왕릉
 *   temple        — 사찰
 *   museum        — 박물관, 미술관
 *   market        — 전통시장
 *   viewpoint     — 전망대, 뷰포인트
 *   nature        — 해변, 공원, 호수
 *   theme_park    — 테마파크, 놀이공원
 *   cultural_site — 문화재, 유적지
 *
 * Usage:
 *   node scripts/collect-attractions.mjs seoul
 *   node scripts/collect-attractions.mjs busan
 *   node scripts/collect-attractions.mjs all
 *
 * Rate limit: 200 ms delay between API calls (~5 req/sec)
 *
 * Output: food_data/attractions_{city}_collected.json
 *
 * Requires: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET env vars
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FOOD_DATA_DIR = join(ROOT, '..', '..', 'food_data');

// ── Config ──────────────────────────────────────────────────────────────────
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
  console.error('❌ NAVER_CLIENT_ID and NAVER_CLIENT_SECRET required');
  console.error('   Set them in .env or export them before running');
  process.exit(1);
}

const BATCH_LIMIT = 5000; // per city per day (Naver 25,000/day total)
const DELAY_MS = 200;     // 200 ms between API calls (5 req/sec)

// ── City configurations ─────────────────────────────────────────────────────
// NOTE: Naver Local Search API returns max 5 results per query.
// We use many unique, specific queries to accumulate ~100 results per city.
// Each query yields ~3-5 unique results after dedup.
const CITY_CONFIG = {
  // ── Seoul ─────────────────────────────────────────────────────────────────
  seoul: {
    target: 100,
    city: 'seoul',
    searchQueries: [
      // palace
      { q: '서울 경복궁', tag: 'palace', category: 'palace', target: 5 },
      { q: '서울 창덕궁', tag: 'palace', category: 'palace', target: 5 },
      { q: '서울 창경궁', tag: 'palace', category: 'palace', target: 5 },
      { q: '서울 덕수궁', tag: 'palace', category: 'palace', target: 5 },
      { q: '서울 궁궐 관광', tag: 'palace', category: 'palace', target: 5 },
      // temple
      { q: '서울 조계사', tag: 'temple', category: 'temple', target: 5 },
      { q: '서울 봉은사', tag: 'temple', category: 'temple', target: 5 },
      { q: '서울 유명 사찰', tag: 'temple', category: 'temple', target: 5 },
      // museum
      { q: '서울 국립중앙박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '서울 국립민속박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '서울 미술관 관광', tag: 'museum', category: 'museum', target: 5 },
      { q: '서울 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '서울 전쟁기념관', tag: 'museum', category: 'museum', target: 5 },
      // market
      { q: '서울 광장시장', tag: 'market', category: 'market', target: 5 },
      { q: '서울 남대문시장', tag: 'market', category: 'market', target: 5 },
      { q: '서울 동대문시장', tag: 'market', category: 'market', target: 5 },
      { q: '서울 전통시장 관광', tag: 'market', category: 'market', target: 5 },
      // viewpoint
      { q: '서울 남산타워', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '서울 전망대 추천', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '서울 북악스카이웨이', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '서울 인왕산 뷰포인트', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      // nature
      { q: '서울 한강공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '서울 북한산', tag: 'nature', category: 'nature', target: 5 },
      { q: '서울 올림픽공원', tag: 'nature', category: 'nature', target: 5 },
      // cultural_site
      { q: '서울 북촌한옥마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '서울 인사동 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '서울 익선동', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '서울 문화재 유적지', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      // theme_park
      { q: '서울 롯데월드', tag: 'theme_park', category: 'theme_park', target: 5 },
      { q: '서울 에버랜드', tag: 'theme_park', category: 'theme_park', target: 5 },
      { q: '서울 어린이대공원', tag: 'theme_park', category: 'theme_park', target: 5 },
      // general sightseeing
      { q: '서울 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '서울 홍대 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '서울 이태원 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '서울 성수동 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
    ],
  },

  // ── Busan ─────────────────────────────────────────────────────────────────
  busan: {
    target: 100,
    city: 'busan',
    searchQueries: [
      // nature / beach
      { q: '부산 해운대 해수욕장', tag: 'nature', category: 'nature', target: 5 },
      { q: '부산 광안리 해수욕장', tag: 'nature', category: 'nature', target: 5 },
      { q: '부산 송정 해수욕장', tag: 'nature', category: 'nature', target: 5 },
      { q: '부산 다대포 해수욕장', tag: 'nature', category: 'nature', target: 5 },
      { q: '부산 태종대', tag: 'nature', category: 'nature', target: 5 },
      { q: '부산 이기대 공원', tag: 'nature', category: 'nature', target: 5 },
      // viewpoint
      { q: '부산 감천문화마을', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '부산 전망대 추천', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '부산 스카이캡슐', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      // temple
      { q: '부산 범어사', tag: 'temple', category: 'temple', target: 5 },
      { q: '부산 해동용궁사', tag: 'temple', category: 'temple', target: 5 },
      { q: '부산 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      // museum
      { q: '부산 국립해양박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '부산 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '부산 영화의전당', tag: 'museum', category: 'museum', target: 5 },
      // market
      { q: '부산 자갈치시장', tag: 'market', category: 'market', target: 5 },
      { q: '부산 국제시장', tag: 'market', category: 'market', target: 5 },
      { q: '부산 부평깡통시장', tag: 'market', category: 'market', target: 5 },
      // cultural_site
      { q: '부산 영도다리 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '부산 흰여울마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '부산 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '부산 남포동 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      // theme_park
      { q: '부산 롯데월드 어드벤처', tag: 'theme_park', category: 'theme_park', target: 5 },
      { q: '부산 씨라이프 아쿠아리움', tag: 'theme_park', category: 'theme_park', target: 5 },
    ],
  },

  // ── Jeju ──────────────────────────────────────────────────────────────────
  jeju: {
    target: 100,
    city: 'jeju',
    searchQueries: [
      // nature
      { q: '제주 성산일출봉', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 한라산', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 천지연폭포', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 만장굴', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 협재해수욕장', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 함덕해수욕장', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 용두암', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 산굼부리', tag: 'nature', category: 'nature', target: 5 },
      { q: '제주 올레길 관광', tag: 'nature', category: 'nature', target: 5 },
      // viewpoint
      { q: '제주 성산 전망대', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '제주 전망대 추천', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '제주 서우봉 전망', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      // temple
      { q: '제주 관음사', tag: 'temple', category: 'temple', target: 5 },
      { q: '제주 약천사', tag: 'temple', category: 'temple', target: 5 },
      { q: '제주 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      // museum
      { q: '제주 국립제주박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '제주 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '제주 테디베어뮤지엄', tag: 'museum', category: 'museum', target: 5 },
      // market
      { q: '제주 동문시장', tag: 'market', category: 'market', target: 5 },
      { q: '제주 전통시장 관광', tag: 'market', category: 'market', target: 5 },
      // cultural_site
      { q: '제주 민속촌', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '제주 성읍민속마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '제주 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      // theme_park
      { q: '제주 에코랜드', tag: 'theme_park', category: 'theme_park', target: 5 },
      { q: '제주 아쿠아플라넷', tag: 'theme_park', category: 'theme_park', target: 5 },
      { q: '제주 형제해안로', tag: 'nature', category: 'nature', target: 5 },
    ],
  },

  // ── Gyeongju ──────────────────────────────────────────────────────────────
  gyeongju: {
    target: 100,
    city: 'gyeongju',
    searchQueries: [
      // palace / cultural_site (Silla heritage)
      { q: '경주 불국사', tag: 'temple', category: 'temple', target: 5 },
      { q: '경주 석굴암', tag: 'temple', category: 'temple', target: 5 },
      { q: '경주 유명 사찰', tag: 'temple', category: 'temple', target: 5 },
      { q: '경주 대릉원', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '경주 첨성대', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '경주 동궁과월지', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '경주 황리단길 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '경주 교촌마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '경주 문화재 유적지', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '경주 신라역사공원', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      // museum
      { q: '경주 국립경주박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '경주 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      // nature
      { q: '경주 보문단지 공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '경주 토함산', tag: 'nature', category: 'nature', target: 5 },
      { q: '경주 양동마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      // viewpoint
      { q: '경주 전망대 추천', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      // market
      { q: '경주 성동시장', tag: 'market', category: 'market', target: 5 },
      { q: '경주 중앙시장 관광', tag: 'market', category: 'market', target: 5 },
      // general
      { q: '경주 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '경주 보문 관광단지', tag: 'cultural_site', category: 'cultural_site', target: 5 },
    ],
  },

  // ── Jeonju ────────────────────────────────────────────────────────────────
  jeonju: {
    target: 100,
    city: 'jeonju',
    searchQueries: [
      // cultural_site
      { q: '전주 한옥마을 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '전주 경기전', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '전주 풍남문', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '전주 오목대', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '전주 향교 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '전주 전동성당', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '전주 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      // temple
      { q: '전주 완주 송광사', tag: 'temple', category: 'temple', target: 5 },
      { q: '전주 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      // museum
      { q: '전주 국립전주박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '전주 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      // market
      { q: '전주 남부시장', tag: 'market', category: 'market', target: 5 },
      { q: '전주 전통시장 관광', tag: 'market', category: 'market', target: 5 },
      // nature
      { q: '전주 덕진공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '전주 모악산', tag: 'nature', category: 'nature', target: 5 },
      // viewpoint
      { q: '전주 전망 명소', tag: 'viewpoint', category: 'viewpoint', target: 5 },
    ],
  },

  // ── Gangneung ─────────────────────────────────────────────────────────────
  gangneung: {
    target: 100,
    city: 'gangneung',
    searchQueries: [
      { q: '강릉 경포대 해수욕장', tag: 'nature', category: 'nature', target: 5 },
      { q: '강릉 경포호수', tag: 'nature', category: 'nature', target: 5 },
      { q: '강릉 정동진', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '강릉 오죽헌', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '강릉 선교장', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '강릉 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '강릉 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '강릉 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      { q: '강릉 주문진 항구', tag: 'nature', category: 'nature', target: 5 },
      { q: '강릉 전통시장', tag: 'market', category: 'market', target: 5 },
      { q: '강릉 헌화로 드라이브', tag: 'viewpoint', category: 'viewpoint', target: 5 },
    ],
  },

  // ── Sokcho ────────────────────────────────────────────────────────────────
  sokcho: {
    target: 100,
    city: 'sokcho',
    searchQueries: [
      { q: '속초 설악산 국립공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '속초 울산바위', tag: 'nature', category: 'nature', target: 5 },
      { q: '속초 권금성', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '속초 영랑호', tag: 'nature', category: 'nature', target: 5 },
      { q: '속초 청초호 수변공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '속초 아바이마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '속초 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '속초 중앙시장', tag: 'market', category: 'market', target: 5 },
      { q: '속초 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
    ],
  },

  // ── Daegu ─────────────────────────────────────────────────────────────────
  daegu: {
    target: 100,
    city: 'daegu',
    searchQueries: [
      { q: '대구 팔공산', tag: 'nature', category: 'nature', target: 5 },
      { q: '대구 동화사', tag: 'temple', category: 'temple', target: 5 },
      { q: '대구 서문시장', tag: 'market', category: 'market', target: 5 },
      { q: '대구 근대골목 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '대구 국채보상운동기념공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '대구 수성못', tag: 'nature', category: 'nature', target: 5 },
      { q: '대구 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '대구 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '대구 전망대', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '대구 이월드', tag: 'theme_park', category: 'theme_park', target: 5 },
    ],
  },

  // ── Daejeon ───────────────────────────────────────────────────────────────
  daejeon: {
    target: 100,
    city: 'daejeon',
    searchQueries: [
      { q: '대전 엑스포 과학공원', tag: 'theme_park', category: 'theme_park', target: 5 },
      { q: '대전 계족산', tag: 'nature', category: 'nature', target: 5 },
      { q: '대전 유성 온천', tag: 'nature', category: 'nature', target: 5 },
      { q: '대전 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '대전 국립중앙과학관', tag: 'museum', category: 'museum', target: 5 },
      { q: '대전 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '대전 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      { q: '대전 전통시장', tag: 'market', category: 'market', target: 5 },
    ],
  },

  // ── Gwangju ───────────────────────────────────────────────────────────────
  gwangju: {
    target: 100,
    city: 'gwangju',
    searchQueries: [
      { q: '광주 무등산 국립공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '광주 국립광주박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '광주 5·18 기념공원', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '광주 양림동 역사마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '광주 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '광주 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      { q: '광주 전통시장', tag: 'market', category: 'market', target: 5 },
      { q: '광주 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '광주 아시아문화전당', tag: 'museum', category: 'museum', target: 5 },
    ],
  },

  // ── Incheon ───────────────────────────────────────────────────────────────
  incheon: {
    target: 100,
    city: 'incheon',
    searchQueries: [
      { q: '인천 차이나타운 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '인천 월미도', tag: 'nature', category: 'nature', target: 5 },
      { q: '인천 강화도 관광', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '인천 강화 고인돌', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '인천 개항장 근대 거리', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '인천 송도 센트럴파크', tag: 'nature', category: 'nature', target: 5 },
      { q: '인천 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '인천 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '인천 전망대', tag: 'viewpoint', category: 'viewpoint', target: 5 },
    ],
  },

  // ── Ulsan ─────────────────────────────────────────────────────────────────
  ulsan: {
    target: 100,
    city: 'ulsan',
    searchQueries: [
      { q: '울산 간절곶', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '울산 대왕암공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '울산 태화강 국가정원', tag: 'nature', category: 'nature', target: 5 },
      { q: '울산 반구대 암각화', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '울산 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '울산 박물관 추천', tag: 'museum', category: 'museum', target: 5 },
      { q: '울산 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      { q: '울산 전통시장', tag: 'market', category: 'market', target: 5 },
    ],
  },

  // ── Andong ────────────────────────────────────────────────────────────────
  andong: {
    target: 100,
    city: 'andong',
    searchQueries: [
      { q: '안동 하회마을', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '안동 도산서원', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '안동 봉정사', tag: 'temple', category: 'temple', target: 5 },
      { q: '안동 민속박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '안동 탈춤공원', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '안동 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '안동 전통시장', tag: 'market', category: 'market', target: 5 },
      { q: '안동 호수 공원', tag: 'nature', category: 'nature', target: 5 },
    ],
  },

  // ── Yeosu ─────────────────────────────────────────────────────────────────
  yeosu: {
    target: 100,
    city: 'yeosu',
    searchQueries: [
      { q: '여수 오동도', tag: 'nature', category: 'nature', target: 5 },
      { q: '여수 돌산도', tag: 'nature', category: 'nature', target: 5 },
      { q: '여수 향일암', tag: 'temple', category: 'temple', target: 5 },
      { q: '여수 이순신광장', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '여수 엑스포 해양공원', tag: 'theme_park', category: 'theme_park', target: 5 },
      { q: '여수 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '여수 낭만포차거리', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '여수 전망대', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '여수 박물관', tag: 'museum', category: 'museum', target: 5 },
    ],
  },

  // ── Tongyeong ─────────────────────────────────────────────────────────────
  tongyeong: {
    target: 100,
    city: 'tongyeong',
    searchQueries: [
      { q: '통영 한려해상국립공원', tag: 'nature', category: 'nature', target: 5 },
      { q: '통영 미륵산 케이블카', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '통영 남망산 조각공원', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '통영 세병관', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '통영 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '통영 전통시장', tag: 'market', category: 'market', target: 5 },
      { q: '통영 박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '통영 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
    ],
  },

  // ── Suncheon ──────────────────────────────────────────────────────────────
  suncheon: {
    target: 100,
    city: 'suncheon',
    searchQueries: [
      { q: '순천 순천만 습지', tag: 'nature', category: 'nature', target: 5 },
      { q: '순천 순천만 국가정원', tag: 'nature', category: 'nature', target: 5 },
      { q: '순천 낙안읍성', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '순천 선암사', tag: 'temple', category: 'temple', target: 5 },
      { q: '순천 송광사', tag: 'temple', category: 'temple', target: 5 },
      { q: '순천 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '순천 전통시장', tag: 'market', category: 'market', target: 5 },
      { q: '순천 박물관', tag: 'museum', category: 'museum', target: 5 },
    ],
  },

  // ── Mokpo ─────────────────────────────────────────────────────────────────
  mokpo: {
    target: 100,
    city: 'mokpo',
    searchQueries: [
      { q: '목포 유달산', tag: 'nature', category: 'nature', target: 5 },
      { q: '목포 해상케이블카', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '목포 근대역사거리', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '목포 국립해양유물전시관', tag: 'museum', category: 'museum', target: 5 },
      { q: '목포 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '목포 전통시장', tag: 'market', category: 'market', target: 5 },
      { q: '목포 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
    ],
  },

  // ── Chuncheon ─────────────────────────────────────────────────────────────
  chuncheon: {
    target: 100,
    city: 'chuncheon',
    searchQueries: [
      { q: '춘천 남이섬', tag: 'nature', category: 'nature', target: 5 },
      { q: '춘천 소양강댐', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '춘천 의암호', tag: 'nature', category: 'nature', target: 5 },
      { q: '춘천 김유정문학촌', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '춘천 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '춘천 박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '춘천 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
      { q: '춘천 전통시장', tag: 'market', category: 'market', target: 5 },
    ],
  },

  // ── Pohang ────────────────────────────────────────────────────────────────
  pohang: {
    target: 100,
    city: 'pohang',
    searchQueries: [
      { q: '포항 호미곶', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '포항 보경사', tag: 'temple', category: 'temple', target: 5 },
      { q: '포항 내연산 폭포', tag: 'nature', category: 'nature', target: 5 },
      { q: '포항 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '포항 죽도시장', tag: 'market', category: 'market', target: 5 },
      { q: '포항 박물관', tag: 'museum', category: 'museum', target: 5 },
      { q: '포항 환호해맞이공원', tag: 'nature', category: 'nature', target: 5 },
    ],
  },

  // ── Geoje ─────────────────────────────────────────────────────────────────
  geoje: {
    target: 100,
    city: 'geoje',
    searchQueries: [
      { q: '거제 외도 보태니아', tag: 'nature', category: 'nature', target: 5 },
      { q: '거제 해금강', tag: 'nature', category: 'nature', target: 5 },
      { q: '거제 바람의언덕', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '거제 신선대', tag: 'viewpoint', category: 'viewpoint', target: 5 },
      { q: '거제 관광명소 추천', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '거제 포로수용소 유적공원', tag: 'cultural_site', category: 'cultural_site', target: 5 },
      { q: '거제 사찰 관광', tag: 'temple', category: 'temple', target: 5 },
    ],
  },
};

// ── Naver Local Search API ───────────────────────────────────────────────────
async function naverLocalSearch(query, start = 1, display = 5) {
  const url = new URL('https://openapi.naver.com/v1/search/local.json');
  url.searchParams.set('query', query);
  url.searchParams.set('display', String(display));
  url.searchParams.set('start', String(start));
  url.searchParams.set('sort', 'comment'); // sort by review count

  const res = await fetch(url.toString(), {
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID.trim(),
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET.trim(),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Naver API ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Parse Naver result → attraction record ───────────────────────────────────
function parseNaverResult(item, city, tag, category) {
  // Strip HTML tags from title
  const name = (item.title || '').replace(/<[^>]*>/g, '').trim();
  if (!name) return null;

  // Address
  const address = item.roadAddress || item.address || '';
  if (!address) return null;

  // Validate address starts with Korean administrative prefix
  const validPrefixes = [
    '서울', '부산', '제주', '인천', '경기', '강원', '충청',
    '전라', '경상', '울산', '대구', '대전', '광주', '세종',
    '전북', '경북', '충남', '충북', '경남', '전남',
    '강원특별자치도', '전북특별자치도', '제주특별자치도',
  ];
  const startsWithCity = validPrefixes.some(p => address.startsWith(p));
  if (!startsWithCity) return null;

  // Coordinates (Naver uses KATECH integer encoding)
  const mapx = parseInt(item.mapx, 10);
  const mapy = parseInt(item.mapy, 10);
  let lat = null, lng = null;
  if (mapx && mapy) {
    // Naver Local API returns coordinates in 1/10,000,000 degree units
    lng = mapx / 10000000;
    lat = mapy / 10000000;
  }

  return {
    name,
    nameEn: '', // Requires separate translation step
    address,
    lat,
    lng,
    category,
    tag,
    city,
    dong: extractDong(address),
    naverCategory: item.category || '',
    source: 'naver_local',
    naverLink: item.link || '',
    collectedAt: new Date().toISOString(),
  };
}

function extractDong(address) {
  // Extract dong/ri from Korean address
  const match = address.match(/([가-힣]+[동리읍면])\b/);
  return match ? match[1] : '';
}

// ── Rate-limited batch search ────────────────────────────────────────────────
async function collectForCity(cityKey) {
  const config = CITY_CONFIG[cityKey];
  if (!config) {
    console.error(`❌ Unknown city: ${cityKey}. Available: ${Object.keys(CITY_CONFIG).join(', ')}`);
    return [];
  }

  console.log(`\n🏙️  Collecting attractions for: ${cityKey.toUpperCase()}`);
  console.log(`   Target: ${config.target} attractions`);
  console.log(`   Queries: ${config.searchQueries.length}`);

  const allResults = [];
  const seenNames = new Set();
  let apiCalls = 0;

  for (const sq of config.searchQueries) {
    if (apiCalls >= BATCH_LIMIT) {
      console.warn(`⚠️ Batch limit reached (${BATCH_LIMIT}). Resume tomorrow.`);
      break;
    }

    console.log(`\n  🔍 "${sq.q}" (category: ${sq.category})`);
    let collected = 0;

    // Naver Local API returns max 5 unique results per query.
    // Pagination (start > 1) returns duplicates, so we do ONE call per query.
    try {
      const data = await naverLocalSearch(sq.q, 1, 5);
      apiCalls++;

      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          const parsed = parseNaverResult(item, config.city, sq.tag, sq.category);
          if (!parsed) continue;

          // Dedup by name (normalised: collapse whitespace)
          const key = parsed.name.replace(/\s+/g, '');
          if (seenNames.has(key)) continue;
          seenNames.add(key);

          allResults.push(parsed);
          collected++;
        }
      }

      // Rate limiting: 200 ms between calls
      await new Promise(r => setTimeout(r, DELAY_MS));

    } catch (err) {
      console.error(`  ❌ API error: ${err.message}`);
      await new Promise(r => setTimeout(r, 1000)); // Back off on error
    }

    console.log(`     → collected: ${collected}`);
  }

  console.log(`\n  📊 Total collected for ${cityKey}: ${allResults.length} (API calls: ${apiCalls})`);
  return allResults;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const targetCity = process.argv[2] || 'all';
  const cities = targetCity === 'all'
    ? Object.keys(CITY_CONFIG)
    : [targetCity];

  for (const city of cities) {
    if (!CITY_CONFIG[city]) {
      console.error(`❌ Unknown city: ${city}. Available: ${Object.keys(CITY_CONFIG).join(', ')}`);
      continue;
    }

    const results = await collectForCity(city);

    if (results.length === 0) {
      console.log(`⚠️ No results for ${city}. Check API keys.`);
      continue;
    }

    // Save to food_data/ alongside restaurant files
    const outPath = join(FOOD_DATA_DIR, `attractions_${city}_collected.json`);
    writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`💾 Saved: ${outPath} (${results.length} attractions)`);

    // Stats
    const catCounts = {};
    for (const r of results) {
      catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    }
    console.log(`  📊 By category: ${JSON.stringify(catCounts)}`);
  }

  console.log('\n✅ Collection complete!');
  console.log('Next steps:');
  console.log('  - Review food_data/attractions_{city}_collected.json');
  console.log('  - Merge into a master attractions catalog as needed');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
