/**
 * _mountain_helper.js — CocoTrip
 *
 * P191 (2026-05-25): 60 row 외국인 등산 안전 데이터 활용.
 * SAFETY-CRITICAL — 잘못된 코스 길이/난이도 = 외국인 visitor 사고 위험.
 *
 * buildPrompt.js 의 Trekking / Hallasan 분기에서 import 해서 사용.
 * Gemini 100% 생성(hallucination) → 검증 DB 주입 방식으로 전환.
 *
 * Usage:
 *   import {
 *     getMountainsByRegion,
 *     getMountainsForBeginner,
 *     getMountainsForHallasan,
 *     formatTrailWarning,
 *   } from './_mountain_helper.js';
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lazy-load mountain index ────────────────────────────────────────────────
let _mountainIndex = null;

function getMountainIndex() {
  if (!_mountainIndex) {
    try {
      const raw = readFileSync(join(__dirname, '_mountain_index.json'), 'utf-8');
      _mountainIndex = JSON.parse(raw);
      console.log(`[mountain-helper] Loaded ${_mountainIndex.length} mountains from index`);
    } catch (err) {
      console.warn('[mountain-helper] Failed to load _mountain_index.json:', err.message);
      _mountainIndex = [];
    }
  }
  return _mountainIndex;
}

// ── Region mapping ──────────────────────────────────────────────────────────
// plan_region / city key → mountain region 코드로 변환
const REGION_MAP = {
  // 강원
  gangwon: ['gangwon'],
  sokcho: ['gangwon'],
  gangneung: ['gangwon'],
  wonju: ['gangwon'],
  pyeongchang: ['gangwon'],
  taebaek: ['gangwon'],
  chuncheon: ['gangwon'],
  inje: ['gangwon'],
  samcheok: ['gangwon'],
  donghae: ['gangwon'],
  yangyang: ['gangwon'],
  hongcheon: ['gangwon'],
  cheorwon: ['gangwon'],

  // 경상
  gyeongsang: ['gyeongsang_nam', 'gyeongsang_buk'],
  gyeongsang_nam: ['gyeongsang_nam'],
  gyeongsang_buk: ['gyeongsang_buk'],
  busan: ['gyeongsang_nam'],
  daegu: ['gyeongsang_buk'],
  gyeongju: ['gyeongsang_buk'],
  sancheong: ['gyeongsang_nam'],
  hapcheon: ['gyeongsang_nam'],
  geochang: ['gyeongsang_nam'],
  miryang: ['gyeongsang_nam'],
  andong: ['gyeongsang_buk'],
  gumi: ['gyeongsang_buk'],
  uljin: ['gyeongsang_buk'],
  bonghwa: ['gyeongsang_buk'],
  yeongyang: ['gyeongsang_buk'],

  // 전라 + 제주
  jeolla: ['jeolla_nam', 'jeolla_buk'],
  jeolla_nam: ['jeolla_nam'],
  jeolla_buk: ['jeolla_buk'],
  gwangju: ['jeolla_nam'],
  jeonju: ['jeolla_buk'],
  suncheon: ['jeolla_nam'],
  gurye: ['jeolla_nam'],
  goheung: ['jeolla_nam'],
  wando: ['jeolla_nam'],
  damyang: ['jeolla_nam'],
  yeosu: ['jeolla_nam'],
  jangseong: ['jeolla_nam'],
  namwon: ['jeolla_buk'],
  muju: ['jeolla_buk'],
  imsil: ['jeolla_buk'],
  jeju: ['jeju'],

  // 충청
  chungcheong: ['chungcheong_buk', 'chungcheong_nam'],
  chungcheong_buk: ['chungcheong_buk'],
  chungcheong_nam: ['chungcheong_nam'],
  danyang: ['chungcheong_buk'],
  boeun: ['chungcheong_buk'],
  chungju: ['chungcheong_buk'],
  jecheon: ['chungcheong_buk'],
  goesan: ['chungcheong_buk'],
  seosan: ['chungcheong_nam'],

  // 서울/수도권 → 가장 가까운 강원 + 경기 (북한산/관악산/인왕산은 별도 key)
  seoul: ['gangwon'],
  incheon: ['gangwon'],
  suwon: ['gangwon'],
};

/**
 * getMountainsByRegion — region + difficulty 필터로 산 목록 반환.
 *
 * @param {object} opts
 * @param {string} opts.region - 도시 또는 region 코드 (소문자)
 * @param {'beginner'|'intermediate'|'advanced'|undefined} opts.difficulty - 필터 (미지정 = 전체)
 * @param {string} [opts.language] - 언어 코드 (현재 미사용, 확장용)
 * @returns {Array<object>} 산 목록
 */
export function getMountainsByRegion({ region, difficulty, language } = {}) {
  const index = getMountainIndex();
  if (!index.length) return [];

  const regionKey = (region || '').toLowerCase().trim();
  const targetRegions = REGION_MAP[regionKey] || [];

  let candidates = targetRegions.length > 0
    ? index.filter((m) => targetRegions.includes(m.region))
    : index; // 매핑 없으면 전체 fallback

  if (difficulty) {
    const filtered = candidates.filter((m) => m.difficulty === difficulty);
    // difficulty 필터로 결과가 너무 적으면 relaxed (난이도별 최소 1개 보장)
    if (filtered.length === 0 && difficulty === 'beginner') {
      // beginner 코스가 포함된 산 (trails 중 beginner 있는 것)
      const withBeginnerTrail = candidates.filter((m) =>
        Array.isArray(m.trails) && m.trails.some((t) => t.difficulty === 'beginner')
      );
      return withBeginnerTrail.length > 0 ? withBeginnerTrail : candidates;
    }
    return filtered.length > 0 ? filtered : candidates;
  }

  return candidates;
}

/**
 * getMountainsForBeginner — difficulty='beginner' 인 산 전체 반환.
 * + 산 전체에서 beginner 코스가 포함된 산도 포함.
 *
 * @returns {Array<object>}
 */
export function getMountainsForBeginner() {
  const index = getMountainIndex();
  if (!index.length) return [];

  return index.filter((m) =>
    m.difficulty === 'beginner' ||
    (Array.isArray(m.trails) && m.trails.some((t) => t.difficulty === 'beginner'))
  );
}

/**
 * getMountainsForHallasan — 한라산 직접 lookup.
 * 위자드 Hallasan 옵션 전용. key='hallasan' 고정.
 *
 * @returns {object|null} 한라산 row (없으면 null)
 */
export function getMountainsForHallasan() {
  const index = getMountainIndex();
  return index.find((m) => m.key === 'hallasan') || null;
}

// ── Trail warning 언어 템플릿 ────────────────────────────────────────────────
const DIFFICULTY_LABELS = {
  beginner: { en: 'Beginner', ja: '初級', zh: '初级', ko: '초급' },
  intermediate: { en: 'Intermediate', ja: '中級', zh: '中级', ko: '중급' },
  advanced: { en: 'Advanced', ja: '上級', zh: '高级', ko: '고급' },
};

const SEASON_LABELS = {
  spring: { en: 'spring', ja: '春', zh: '春季', ko: '봄' },
  summer: { en: 'summer', ja: '夏', zh: '夏季', ko: '여름' },
  autumn: { en: 'autumn', ja: '秋', zh: '秋季', ko: '가을' },
  winter: { en: 'winter', ja: '冬', zh: '冬季', ko: '겨울' },
  all: { en: 'all year', ja: '通年', zh: '全年', ko: '연중' },
};

/**
 * formatTrailWarning — 산 안전 경고 메시지 자동 생성.
 * SAFETY-CRITICAL: 정확한 distance / elevation_gain / hours 표기 의무.
 *
 * @param {object} mountain - getMountainsByRegion / getMountainsForHallasan 결과 row
 * @param {string} [language='en'] - 'en' | 'ja' | 'zh' | 'ko'
 * @returns {string} 안전 경고 메시지 (Gemini prompt 주입용)
 */
export function formatTrailWarning(mountain, language = 'en') {
  if (!mountain) return '';

  const lang = ['en', 'ja', 'zh', 'ko'].includes(language) ? language : 'en';
  const name = mountain.name[lang] || mountain.name.en;
  const trails = Array.isArray(mountain.trails) ? mountain.trails : [];
  const bestSeasons = (mountain.best_season || [])
    .map((s) => SEASON_LABELS[s]?.[lang] || s)
    .join(', ');
  const isReservationRequired = Array.isArray(mountain.tags) && mountain.tags.includes('reservation_required');
  const diffLabel = DIFFICULTY_LABELS[mountain.difficulty]?.[lang] || mountain.difficulty;

  const templates = {
    en: () => {
      const trailLines = trails.map((t) => {
        const tName = typeof t.name === 'object' ? (t.name.en || t.name.ko) : t.name;
        const tDiff = DIFFICULTY_LABELS[t.difficulty]?.[lang] || t.difficulty;
        return `    • ${tName}: ${t.distance_km}km / +${t.elevation_gain_m}m / ~${t.hours}h [${tDiff}]`;
      });
      return [
        `⚠️ SAFETY-CRITICAL — ${name} (${mountain.elevation_m}m, overall: ${diffLabel})`,
        `Best season: ${bestSeasons}`,
        ...(isReservationRequired ? ['🔴 ADVANCE RESERVATION REQUIRED (online booking mandatory — summit trail closes if quota full)'] : []),
        'Verified trails (use EXACT distances and times in the plan):',
        ...trailLines,
        `Safety note: Confirm current trail conditions before visit. Start early — trails may close before sunset.`,
      ].join('\n');
    },
    ja: () => {
      const trailLines = trails.map((t) => {
        const tName = typeof t.name === 'object' ? (t.name.ja || t.name.en || t.name.ko) : t.name;
        const tDiff = DIFFICULTY_LABELS[t.difficulty]?.ja || t.difficulty;
        return `    • ${tName}: ${t.distance_km}km / +${t.elevation_gain_m}m / 約${t.hours}時間 [${tDiff}]`;
      });
      return [
        `⚠️ 安全注意 — ${name} (${mountain.elevation_m}m, 難易度: ${diffLabel})`,
        `ベストシーズン: ${bestSeasons}`,
        ...(isReservationRequired ? ['🔴 事前予約必須（オンライン予約 — 定員に達した場合は山頂コース閉鎖）'] : []),
        '検証済みコース（プランには必ず正確な距離・時間を使用）:',
        ...trailLines,
        '安全のため: 訪問前に現在のコース状況を確認してください。早朝出発推奨。',
      ].join('\n');
    },
    zh: () => {
      const trailLines = trails.map((t) => {
        const tName = typeof t.name === 'object' ? (t.name.zh || t.name.en || t.name.ko) : t.name;
        const tDiff = DIFFICULTY_LABELS[t.difficulty]?.zh || t.difficulty;
        return `    • ${tName}: ${t.distance_km}km / +${t.elevation_gain_m}m / 约${t.hours}小时 [${tDiff}]`;
      });
      return [
        `⚠️ 安全提示 — ${name} (${mountain.elevation_m}m, 整体难度: ${diffLabel})`,
        `最佳季节: ${bestSeasons}`,
        ...(isReservationRequired ? ['🔴 须提前预约（在线预订 — 名额已满时封闭山顶路线）'] : []),
        '已验证路线（请在计划中使用精确的距离和时间）:',
        ...trailLines,
        '安全提示：出发前请确认当前路况。建议早出发——路线可能在日落前关闭。',
      ].join('\n');
    },
    ko: () => {
      const trailLines = trails.map((t) => {
        const tName = typeof t.name === 'object' ? (t.name.ko || t.name.en) : t.name;
        const tDiff = DIFFICULTY_LABELS[t.difficulty]?.ko || t.difficulty;
        return `    • ${tName}: ${t.distance_km}km / +${t.elevation_gain_m}m / 약${t.hours}시간 [${tDiff}]`;
      });
      return [
        `⚠️ 안전 주의 — ${name} (${mountain.elevation_m}m, 전반 난이도: ${diffLabel})`,
        `추천 시즌: ${bestSeasons}`,
        ...(isReservationRequired ? ['🔴 사전 예약 필수 (온라인 예약 — 정원 초과 시 정상 코스 입산 불가)'] : []),
        '검증된 등산로 (플랜에 아래 정확한 거리/시간 사용 의무):',
        ...trailLines,
        '안전 안내: 방문 전 현재 탐방로 상황 확인. 일출 직후 출발 권장.',
      ].join('\n');
    },
  };

  return templates[lang]();
}

/**
 * getMountainContextForPrompt — buildPrompt.js 주입용 통합 헬퍼.
 * Trekking 또는 Hallasan 선택 시 호출.
 *
 * @param {object} opts
 * @param {string[]} opts.regions - plan 의 도시/region 배열 (예: ['gangwon', 'sokcho'])
 * @param {string} [opts.difficulty] - 'beginner' | 'intermediate' | 'advanced'
 * @param {boolean} [opts.hallaOnly] - true 이면 Hallasan lookup 전용
 * @param {string} [opts.language='en'] - 안전 경고 언어
 * @param {number} [opts.maxItems=5] - 최대 산 개수
 * @returns {string} Gemini prompt 주입용 문자열 ('' 이면 주입 skip)
 */
export function getMountainContextForPrompt({ regions = [], difficulty, hallaOnly = false, language = 'en', maxItems = 5 } = {}) {
  if (hallaOnly) {
    const hallasan = getMountainsForHallasan();
    if (!hallasan) return '';
    const warning = formatTrailWarning(hallasan, language);
    return `\n\n--- VERIFIED MOUNTAIN DATABASE (SAFETY-CRITICAL — use EXACT distances/times) ---\n${warning}\n---`;
  }

  // 여러 region 에서 산 수집
  let mountains = [];
  const seen = new Set();
  for (const region of regions) {
    const results = getMountainsByRegion({ region, difficulty, language });
    for (const m of results) {
      if (!seen.has(m.key)) {
        seen.add(m.key);
        mountains.push(m);
      }
    }
  }

  // 빈 경우 전국 beginner/intermediate fallback
  if (mountains.length === 0) {
    mountains = difficulty === 'beginner'
      ? getMountainsForBeginner()
      : getMountainIndex().filter((m) => m.difficulty !== 'advanced').slice(0, maxItems);
  }

  if (mountains.length === 0) return '';

  // rank_100 정렬 (null 은 뒤로)
  mountains.sort((a, b) => {
    if (a.rank_100 === null && b.rank_100 === null) return 0;
    if (a.rank_100 === null) return 1;
    if (b.rank_100 === null) return -1;
    return a.rank_100 - b.rank_100;
  });

  const selected = mountains.slice(0, maxItems);
  const warnings = selected.map((m) => formatTrailWarning(m, language));

  const lang = language;
  const header = {
    en: '## VERIFIED MOUNTAIN DATABASE (SAFETY-CRITICAL — use EXACT distances/times/difficulties from this list)',
    ja: '## 検証済み山岳データベース（安全重要 — このリストの正確な距離/時間/難易度を使用してください）',
    zh: '## 已验证山岳数据库（安全关键 — 使用此列表中的精确距离/时间/难度）',
    ko: '## 검증된 등산 데이터베이스 (SAFETY-CRITICAL — 아래 정확한 거리/시간/난이도 사용 의무)',
  }[lang] || '## VERIFIED MOUNTAIN DATABASE (SAFETY-CRITICAL)';

  const footer = {
    en: 'IMPORTANT: Use EXACT mountain names, trail distances, and hours from the above list. Set "verified": true on each mountain stop from this list. NEVER invent or estimate trail distances — this is SAFETY-CRITICAL data.',
    ja: '重要: 上記リストの正確な山名・トレイル距離・時間を使用してください。NEVER invent 推定値 — 安全性に関わるデータです。',
    zh: '重要：使用上述列表中的准确山名、路线距离和时间。禁止编造或估算——这是安全关键数据。',
    ko: '중요: 위 목록의 정확한 산 이름, 코스 거리, 시간을 사용하세요. 임의 추측 절대 금지 — 외국인 사고 위험 SAFETY-CRITICAL 데이터.',
  }[lang] || 'IMPORTANT: Use EXACT data from the above list. NEVER invent trail distances.';

  return `\n\n--- VERIFIED MOUNTAIN DATABASE (SAFETY-CRITICAL — use EXACT distances/times) ---\n${header}\n\n${warnings.join('\n\n')}\n\n${footer}\n---`;
}
