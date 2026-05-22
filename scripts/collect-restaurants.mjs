#!/usr/bin/env node
/**
 * CocoTrip — Restaurant Collection Script (Naver Local Search API)
 *
 * Collects restaurant data for cities missing from _food_index.json:
 * Jeju (150 target), Gyeongju (100), Jeonju (100)
 *
 * Usage:
 *   node scripts/collect-restaurants.mjs jeju
 *   node scripts/collect-restaurants.mjs gyeongju
 *   node scripts/collect-restaurants.mjs jeonju
 *   node scripts/collect-restaurants.mjs all
 *
 * Rate limit: 5,000 requests/city/day (Naver 25,000/day total)
 *
 * Output: food_data/restaurants_{city}_collected.json
 * Then run: node scripts/build-food-index.js to rebuild _food_index.json
 *
 * Requires: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET env vars
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FOOD_DATA_DIR = join(ROOT, '..', '..', 'food_data');

// ── Config ──────────────────────────────────────────────────────────────
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
  console.error('❌ NAVER_CLIENT_ID and NAVER_CLIENT_SECRET required');
  console.error('   Set them in .env or export them before running');
  process.exit(1);
}

const BATCH_LIMIT = 5000; // per city per day
const DELAY_MS = 200;     // between API calls (5 req/sec)

// ── City configurations ─────────────────────────────────────────────────
// NOTE: Naver Local Search API returns max 5 results per query.
// We must use MANY unique, specific queries to accumulate data.
// Each query yields ~3-5 unique results after dedup.
const CITY_CONFIG = {
  jeju: {
    target: 150,
    city: 'jeju',
    searchQueries: [
      // ── 한식 (지역별 세분화) ──
      { q: '제주시 한식 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '서귀포시 한식 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 흑돼지 구이', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 돼지고기 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 고기국수 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 갈치조림 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 보말칼국수', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 몸국 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주시 국수 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '서귀포 한식 식당', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 한정식', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 백반 식당', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주시 중앙로 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 탑동 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '제주 연동 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '제주 노형동 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '제주 애월 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '제주 함덕 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '제주 성산 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '제주 중문 맛집', tag: 'general', category: 'general', target: 5 },
      // ── 해산물 ──
      { q: '제주 회 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '제주 해산물 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '서귀포 해산물 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '제주 전복죽 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '제주 해녀 식당', tag: 'general', category: 'seafood', target: 5 },
      { q: '제주 성게 요리', tag: 'general', category: 'seafood', target: 5 },
      { q: '제주 물회 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '제주 횟집 추천', tag: 'general', category: 'seafood', target: 5 },
      { q: '서귀포 회 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '제주 해물탕 맛집', tag: 'general', category: 'seafood', target: 5 },
      // ── 카페/디저트 ──
      { q: '제주 카페 인기', tag: 'general', category: 'cafe', target: 5 },
      { q: '서귀포 카페 맛집', tag: 'general', category: 'cafe', target: 5 },
      { q: '제주 애월 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '제주 함덕 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '제주 오션뷰 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '제주 디저트 맛집', tag: 'general', category: 'cafe', target: 5 },
      { q: '제주 베이커리 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '제주 브런치 카페', tag: 'general', category: 'cafe', target: 5 },
      // ── 기타 요리 ──
      { q: '제주 일식 맛집', tag: 'general', category: 'japanese', target: 5 },
      { q: '제주 초밥 맛집', tag: 'general', category: 'japanese', target: 5 },
      { q: '제주 라멘 맛집', tag: 'general', category: 'japanese', target: 5 },
      { q: '제주 중식 맛집', tag: 'general', category: 'chinese', target: 5 },
      { q: '제주 양식 맛집', tag: 'general', category: 'western', target: 5 },
      { q: '제주 파스타 맛집', tag: 'general', category: 'western', target: 5 },
      { q: '제주 피자 맛집', tag: 'general', category: 'western', target: 5 },
      { q: '제주 스테이크 맛집', tag: 'general', category: 'western', target: 5 },
      { q: '제주 버거 맛집', tag: 'general', category: 'western', target: 5 },
      // ── 비건 ──
      { q: '제주 비건 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '제주 채식 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '제주 비건 카페', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '제주 샐러드 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '제주 채식 뷔페', tag: 'vegan', category: 'vegan', target: 5 },
      // ── 채식 (vegetarian) — PR #282 재작성 (2026-05-22), dietary 0건 → 보강 ──
      { q: '제주 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '제주 콩요리 식당', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '제주 자연식 식당', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '제주 두부 전문점', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      // ── 할랄 — PR #282 재작성, halal 데이터 0건 → 보강 ──
      { q: '제주 할랄 식당', tag: 'halal', category: 'halal', target: 5 },
      { q: '제주 무슬림 친화 식당', tag: 'halal', category: 'halal', target: 5 },
      { q: '제주 터키 음식', tag: 'halal', category: 'halal', target: 5 },
      { q: '제주 아랍 음식', tag: 'halal', category: 'halal', target: 5 },
      { q: '제주 인도 음식', tag: 'halal', category: 'halal', target: 5 },
    ],
  },
  gyeongju: {
    target: 100,
    city: 'gyeongju',
    searchQueries: [
      // ── 한식 (지역/메뉴 세분화) ──
      { q: '경주 한식 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주시 맛집 추천', tag: 'general', category: 'general', target: 5 },
      { q: '경주 한정식 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 국밥 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 찜닭 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 삼겹살 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 콩국수 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 떡갈비', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 수제비 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 손두부 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '경주 쌈밥 맛집', tag: 'general', category: 'hansik', target: 5 },
      // ── 관광지별 ──
      { q: '경주 불국사 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '경주 보문단지 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '경주 황남동 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '경주 교동 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '경주 대릉원 근처 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '경주 황리단길 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '경주 동궁과월지 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '경주 첨성대 맛집', tag: 'general', category: 'general', target: 5 },
      // ── 해산물 ──
      { q: '경주 해산물 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '경주 회 맛집', tag: 'general', category: 'seafood', target: 5 },
      { q: '경주 감포 횟집', tag: 'general', category: 'seafood', target: 5 },
      // ── 카페/디저트 ──
      { q: '경주 카페 인기', tag: 'general', category: 'cafe', target: 5 },
      { q: '경주 황리단길 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '경주 디저트 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '경주 한옥 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '경주 브런치 카페', tag: 'general', category: 'cafe', target: 5 },
      // ── 기타 ──
      { q: '경주 양식 맛집', tag: 'general', category: 'western', target: 5 },
      { q: '경주 일식 맛집', tag: 'general', category: 'japanese', target: 5 },
      { q: '경주 중식 맛집', tag: 'general', category: 'chinese', target: 5 },
      { q: '경주 파스타 맛집', tag: 'general', category: 'western', target: 5 },
      // ── Dietary — PR #282 재작성 (2026-05-22), halal/vegan/vegetarian 모두 0건 → 보강 ──
      { q: '경주 비건 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '경주 채식 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '경주 샐러드 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '경주 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '경주 두부 전문점', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '경주 콩요리', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '경주 할랄 식당', tag: 'halal', category: 'halal', target: 5 },
      { q: '경주 무슬림 친화 식당', tag: 'halal', category: 'halal', target: 5 },
      { q: '경주 터키 음식', tag: 'halal', category: 'halal', target: 5 },
      { q: '경주 인도 음식', tag: 'halal', category: 'halal', target: 5 },
    ],
  },
  jeonju: {
    target: 100,
    city: 'jeonju',
    searchQueries: [
      // ── 대표 요리 ──
      { q: '전주 비빔밥 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 콩나물국밥 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 한정식 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 백반 식당', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 막걸리 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 꼬막비빔밥', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 삼겹살 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 국밥 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 한식 식당', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 떡갈비 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 갈비 맛집', tag: 'general', category: 'hansik', target: 5 },
      { q: '전주 칼국수 맛집', tag: 'general', category: 'hansik', target: 5 },
      // ── 관광지별 ──
      { q: '전주 한옥마을 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '전주 한옥마을 식당', tag: 'general', category: 'general', target: 5 },
      { q: '전주 객사 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '전주 남부시장 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '전주 덕진공원 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '전주역 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '전주 풍남동 맛집', tag: 'general', category: 'general', target: 5 },
      { q: '전주 효자동 맛집', tag: 'general', category: 'general', target: 5 },
      // ── 카페/디저트 ──
      { q: '전주 카페 인기', tag: 'general', category: 'cafe', target: 5 },
      { q: '전주 한옥 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '전주 디저트 카페', tag: 'general', category: 'cafe', target: 5 },
      { q: '전주 베이커리 맛집', tag: 'general', category: 'cafe', target: 5 },
      { q: '전주 초코파이 가게', tag: 'general', category: 'cafe', target: 5 },
      // ── 기타 요리 ──
      { q: '전주 일식 맛집', tag: 'general', category: 'japanese', target: 5 },
      { q: '전주 양식 맛집', tag: 'general', category: 'western', target: 5 },
      { q: '전주 중식 맛집', tag: 'general', category: 'chinese', target: 5 },
      { q: '전주 파스타 맛집', tag: 'general', category: 'western', target: 5 },
      { q: '전주 피자 맛집', tag: 'general', category: 'western', target: 5 },
      // ── Dietary — PR #282 재작성 (2026-05-22), halal/vegan/vegetarian 모두 0건 → 보강 ──
      { q: '전주 비건 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '전주 채식 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '전주 비건 카페', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '전주 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '전주 두부 전문점', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '전주 자연식 식당', tag: 'vegetarian', category: 'vegetarian', target: 5 },
      { q: '전주 할랄 식당', tag: 'halal', category: 'halal', target: 5 },
      { q: '전주 무슬림 친화 식당', tag: 'halal', category: 'halal', target: 5 },
      { q: '전주 터키 음식', tag: 'halal', category: 'halal', target: 5 },
      { q: '전주 인도 음식', tag: 'halal', category: 'halal', target: 5 },
    ],
  },
  // ── 2026-05-22 추가: 20 도시 (Phase E #2 + 광역 확장) ──
  gangneung: { target: 100, city: 'gangneung', searchQueries: [
    { q: '강릉 초당두부', tag: 'general', category: 'hansik', target: 5 },
    { q: '강릉 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '강릉 안목 커피', tag: 'general', category: 'cafe', target: 5 },
    { q: '강릉 막국수', tag: 'general', category: 'hansik', target: 5 },
    { q: '강릉 짬뽕', tag: 'general', category: 'chinese', target: 5 },
    { q: '강릉 비건 식당', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '강릉 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
    { q: '강릉 할랄 식당', tag: 'halal', category: 'halal', target: 5 },
  ]},
  sokcho: { target: 100, city: 'sokcho', searchQueries: [
    { q: '속초 닭강정', tag: 'general', category: 'hansik', target: 5 },
    { q: '속초 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '속초 물회', tag: 'general', category: 'seafood', target: 5 },
    { q: '속초 오징어순대', tag: 'general', category: 'hansik', target: 5 },
    { q: '속초 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '속초 비건 식당', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '속초 채식 식당', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  daegu: { target: 100, city: 'daegu', searchQueries: [
    { q: '대구 막창', tag: 'general', category: 'hansik', target: 5 },
    { q: '대구 따로국밥', tag: 'general', category: 'hansik', target: 5 },
    { q: '대구 동성로 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '대구 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '대구 일식', tag: 'general', category: 'japanese', target: 5 },
    { q: '대구 양식', tag: 'general', category: 'western', target: 5 },
    { q: '대구 비건 식당', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '대구 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
    { q: '대구 할랄 식당', tag: 'halal', category: 'halal', target: 5 },
  ]},
  daejeon: { target: 100, city: 'daejeon', searchQueries: [
    { q: '대전 칼국수', tag: 'general', category: 'hansik', target: 5 },
    { q: '대전 성심당', tag: 'general', category: 'cafe', target: 5 },
    { q: '대전 유성 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '대전 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '대전 일식', tag: 'general', category: 'japanese', target: 5 },
    { q: '대전 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '대전 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
    { q: '대전 할랄', tag: 'halal', category: 'halal', target: 5 },
  ]},
  gwangju: { target: 100, city: 'gwangju', searchQueries: [
    { q: '광주 송정떡갈비', tag: 'general', category: 'hansik', target: 5 },
    { q: '광주 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '광주 충장로 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '광주 양림동 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '광주 무등산 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '광주 일식', tag: 'general', category: 'japanese', target: 5 },
    { q: '광주 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '광주 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
    { q: '광주 할랄', tag: 'halal', category: 'halal', target: 5 },
  ]},
  incheon: { target: 100, city: 'incheon', searchQueries: [
    { q: '인천 차이나타운 짜장면', tag: 'general', category: 'chinese', target: 5 },
    { q: '인천 송도 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '인천 화수동', tag: 'general', category: 'general', target: 5 },
    { q: '인천 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '인천 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '인천 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '인천 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '인천 할랄', tag: 'halal', category: 'halal', target: 5 },
    { q: '인천 무슬림 친화', tag: 'halal', category: 'halal', target: 5 },
  ]},
  ulsan: { target: 100, city: 'ulsan', searchQueries: [
    { q: '울산 짬뽕', tag: 'general', category: 'chinese', target: 5 },
    { q: '울산 고래고기', tag: 'general', category: 'hansik', target: 5 },
    { q: '울산 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '울산 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '울산 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '울산 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '울산 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  changwon: { target: 100, city: 'changwon', searchQueries: [
    { q: '창원 마산 아구찜', tag: 'general', category: 'hansik', target: 5 },
    { q: '창원 진해 회', tag: 'general', category: 'seafood', target: 5 },
    { q: '창원 상남 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '창원 일식', tag: 'general', category: 'japanese', target: 5 },
    { q: '창원 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '창원 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '창원 할랄', tag: 'halal', category: 'halal', target: 5 },
  ]},
  pohang: { target: 100, city: 'pohang', searchQueries: [
    { q: '포항 물회', tag: 'general', category: 'seafood', target: 5 },
    { q: '포항 과메기', tag: 'general', category: 'seafood', target: 5 },
    { q: '포항 죽도시장 회', tag: 'general', category: 'seafood', target: 5 },
    { q: '포항 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '포항 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '포항 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '포항 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  andong: { target: 100, city: 'andong', searchQueries: [
    { q: '안동 찜닭', tag: 'general', category: 'hansik', target: 5 },
    { q: '안동 간고등어', tag: 'general', category: 'hansik', target: 5 },
    { q: '안동 헛제사밥', tag: 'general', category: 'hansik', target: 5 },
    { q: '안동 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '안동 한옥 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '안동 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '안동 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  tongyeong: { target: 100, city: 'tongyeong', searchQueries: [
    { q: '통영 충무김밥', tag: 'general', category: 'hansik', target: 5 },
    { q: '통영 굴구이', tag: 'general', category: 'seafood', target: 5 },
    { q: '통영 다찌집', tag: 'general', category: 'hansik', target: 5 },
    { q: '통영 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '통영 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '통영 비건', tag: 'vegan', category: 'vegan', target: 5 },
  ]},
  geoje: { target: 100, city: 'geoje', searchQueries: [
    { q: '거제 멍게비빔밥', tag: 'general', category: 'hansik', target: 5 },
    { q: '거제 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '거제 외도 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '거제 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '거제 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '거제 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  yeosu: { target: 100, city: 'yeosu', searchQueries: [
    { q: '여수 게장', tag: 'general', category: 'hansik', target: 5 },
    { q: '여수 돌게장', tag: 'general', category: 'hansik', target: 5 },
    { q: '여수 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '여수 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '여수 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '여수 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '여수 할랄', tag: 'halal', category: 'halal', target: 5 },
  ]},
  suncheon: { target: 100, city: 'suncheon', searchQueries: [
    { q: '순천 짱뚱어탕', tag: 'general', category: 'hansik', target: 5 },
    { q: '순천 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '순천 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '순천 만 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '순천 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '순천 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  mokpo: { target: 100, city: 'mokpo', searchQueries: [
    { q: '목포 세발낙지', tag: 'general', category: 'hansik', target: 5 },
    { q: '목포 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '목포 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '목포 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '목포 비건', tag: 'vegan', category: 'vegan', target: 5 },
  ]},
  gunsan: { target: 100, city: 'gunsan', searchQueries: [
    { q: '군산 짬뽕', tag: 'general', category: 'chinese', target: 5 },
    { q: '군산 이성당 빵', tag: 'general', category: 'cafe', target: 5 },
    { q: '군산 회 맛집', tag: 'general', category: 'seafood', target: 5 },
    { q: '군산 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '군산 비건', tag: 'vegan', category: 'vegan', target: 5 },
  ]},
  iksan: { target: 100, city: 'iksan', searchQueries: [
    { q: '익산 황등 비빔밥', tag: 'general', category: 'hansik', target: 5 },
    { q: '익산 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '익산 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '익산 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '익산 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  cheongju: { target: 100, city: 'cheongju', searchQueries: [
    { q: '청주 올갱이국', tag: 'general', category: 'hansik', target: 5 },
    { q: '청주 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '청주 닭갈비', tag: 'general', category: 'hansik', target: 5 },
    { q: '청주 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '청주 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '청주 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  wonju: { target: 100, city: 'wonju', searchQueries: [
    { q: '원주 추어탕', tag: 'general', category: 'hansik', target: 5 },
    { q: '원주 닭갈비', tag: 'general', category: 'hansik', target: 5 },
    { q: '원주 한정식', tag: 'general', category: 'hansik', target: 5 },
    { q: '원주 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '원주 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '원주 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
  chuncheon: { target: 100, city: 'chuncheon', searchQueries: [
    { q: '춘천 닭갈비', tag: 'general', category: 'hansik', target: 5 },
    { q: '춘천 막국수', tag: 'general', category: 'hansik', target: 5 },
    { q: '춘천 명동 맛집', tag: 'general', category: 'general', target: 5 },
    { q: '춘천 카페', tag: 'general', category: 'cafe', target: 5 },
    { q: '춘천 비건', tag: 'vegan', category: 'vegan', target: 5 },
    { q: '춘천 사찰음식', tag: 'vegetarian', category: 'vegetarian', target: 5 },
  ]},
};

// ── Naver Local Search API ──────────────────────────────────────────────
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

// ── Parse Naver result → our restaurant format ──────────────────────────
function parseNaverResult(item, city, tag, category) {
  // Strip HTML tags from title
  const name = (item.title || '').replace(/<[^>]*>/g, '').trim();
  if (!name) return null;

  // Address
  const address = item.roadAddress || item.address || '';
  if (!address) return null;

  // Validate address starts with Korean city name
  const validPrefixes = ['서울', '부산', '제주', '인천', '경기', '강원', '충청',
    '전라', '경상', '울산', '대구', '대전', '광주', '세종', '전북', '경북',
    '충남', '충북', '경남', '전남', '강원특별자치도', '전북특별자치도', '제주특별자치도'];
  const startsWithCity = validPrefixes.some(p => address.startsWith(p));
  if (!startsWithCity) return null;

  // Coordinates (Naver uses katec → convert)
  const mapx = parseInt(item.mapx, 10);
  const mapy = parseInt(item.mapy, 10);
  let lat = null, lng = null;
  if (mapx && mapy) {
    // Naver Local API returns coordinates in KATECH format (단위: 1/10000000초)
    // Simple approximation for Korea region
    lng = mapx / 10000000;
    lat = mapy / 10000000;
  }

  // Category from Naver
  const naverCategory = item.category || '';

  return {
    name,
    nameEn: '', // Will need manual translation or separate API
    address,
    lat,
    lng,
    rating: 0, // Naver doesn't provide rating in search API
    reviewCount: 0,
    cuisine: naverCategory,
    cuisineKo: naverCategory,
    tag,
    category: category || 'general',
    city,
    dong: extractDong(address),
    source: 'naver_local',
    collectedAt: new Date().toISOString(),
    naverLink: item.link || '',
  };
}

function extractDong(address) {
  // Extract dong/ri from Korean address
  const match = address.match(/([가-힣]+[동리읍면])\b/);
  return match ? match[1] : '';
}

// ── Rate-limited batch search ───────────────────────────────────────────
async function collectForCity(cityKey) {
  const config = CITY_CONFIG[cityKey];
  if (!config) {
    console.error(`❌ Unknown city: ${cityKey}. Available: ${Object.keys(CITY_CONFIG).join(', ')}`);
    return [];
  }

  console.log(`\n🏙️  Collecting restaurants for: ${cityKey.toUpperCase()}`);
  console.log(`   Target: ${config.target} restaurants`);
  console.log(`   Queries: ${config.searchQueries.length}`);

  const allResults = [];
  const seenNames = new Set();
  let apiCalls = 0;

  for (const sq of config.searchQueries) {
    if (apiCalls >= BATCH_LIMIT) {
      console.warn(`⚠️ Batch limit reached (${BATCH_LIMIT}). Resume tomorrow.`);
      break;
    }

    console.log(`\n  🔍 "${sq.q}" (target: ${sq.target}, tag: ${sq.tag})`);
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

          // Dedup by name
          const key = parsed.name.replace(/\s+/g, '');
          if (seenNames.has(key)) continue;
          seenNames.add(key);

          allResults.push(parsed);
          collected++;
        }
      }

      // Rate limiting
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

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const targetCity = process.argv[2] || 'all';
  const cities = targetCity === 'all'
    ? Object.keys(CITY_CONFIG)
    : [targetCity];

  for (const city of cities) {
    if (!CITY_CONFIG[city]) {
      console.error(`❌ Unknown city: ${city}`);
      continue;
    }

    const results = await collectForCity(city);

    if (results.length === 0) {
      console.log(`⚠️ No results for ${city}. Check API keys.`);
      continue;
    }

    // Save to file
    const outPath = join(FOOD_DATA_DIR, `restaurants_${city}_collected.json`);
    writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`💾 Saved: ${outPath} (${results.length} restaurants)`);

    // Stats
    const tagCounts = {};
    const catCounts = {};
    for (const r of results) {
      tagCounts[r.tag] = (tagCounts[r.tag] || 0) + 1;
      catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    }
    console.log(`  📊 By tag: ${JSON.stringify(tagCounts)}`);
    console.log(`  📊 By category: ${JSON.stringify(catCounts)}`);
  }

  console.log('\n✅ Collection complete!');
  console.log('Next step: Merge into food_data/restaurants_general.json and run:');
  console.log('  node scripts/build-food-index.js');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
