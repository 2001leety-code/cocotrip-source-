/**
 * _running_helper.js — CocoTrip
 *
 * P237 (2026-05-27): Running 코스 16개 (zone_courses 추출) → Gemini 프롬프트 주입.
 * Wizard Step 1 'HangangRun' / 'Running' 옵션 선택 시 검증된 코스 정보 주입.
 *
 * 패턴: api/_mountain_helper.js (P191 2026-05-25) 와 동일 구조.
 *
 * Usage:
 *   import { getRunningContextForPrompt } from './_running_helper.js';
 *   const ctx = getRunningContextForPrompt({ cities: ['seoul'], language: 'en' });
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lazy-load running index ────────────────────────────────────────────────
let _runningIndex = null;

function getRunningIndex() {
  if (!_runningIndex) {
    try {
      const raw = readFileSync(join(__dirname, '_running_index.json'), 'utf-8');
      _runningIndex = JSON.parse(raw);
      console.log(`[running-helper] Loaded ${_runningIndex.length} running courses from index`);
    } catch (err) {
      console.warn('[running-helper] Failed to load _running_index.json:', err.message);
      _runningIndex = [];
    }
  }
  return _runningIndex;
}

// ── City key → running index city 코드 매핑 ────────────────────────────────
const CITY_MAP = {
  seoul: 'seoul', '서울': 'seoul', incheon: 'seoul', suwon: 'seoul', '인천': 'seoul',
  busan: 'busan', '부산': 'busan',
  jeju: 'jeju', '제주': 'jeju', 'jeju island': 'jeju',
  gyeongju: 'gyeongju', '경주': 'gyeongju',
  jeonju: 'jeonju', '전주': 'jeonju',
  gangneung: 'gangneung', '강릉': 'gangneung',
  sokcho: 'sokcho', '속초': 'sokcho',
  daegu: 'daegu', '대구': 'daegu',
  gwangju: 'gwangju', '광주': 'gwangju',
  yeosu: 'yeosu', '여수': 'yeosu',
  suncheon: 'suncheon', '순천': 'suncheon',
  pohang: 'pohang', '포항': 'pohang',
};

/**
 * getRunningCoursesByCity — 도시별 러닝 코스 반환.
 *
 * @param {string} cityKey - 소문자 도시 코드 또는 한국어명
 * @returns {Array<object>}
 */
export function getRunningCoursesByCity(cityKey) {
  const index = getRunningIndex();
  if (!index.length) return [];
  const code = (cityKey || '').toLowerCase().trim();
  const mapped = CITY_MAP[code] || code;
  const results = index.filter(c => c.city === mapped);
  return results.length > 0 ? results : [];
}

// ── 언어별 intensity 라벨 ────────────────────────────────────────────────────
const INTENSITY_LABELS = {
  relaxed: { en: 'Easy/Leisure', ja: '散歩・軽めコース', zh: '轻松休闲', ko: '산책/가벼운 러닝' },
  short:   { en: '5km Run',      ja: '5kmラン',          zh: '5km跑步',    ko: '5km 러닝' },
  half:    { en: '7.5km Run',    ja: '7.5kmラン',         zh: '7.5km跑步',  ko: '7.5km 러닝' },
  action:  { en: '10km+ Run',    ja: '10km以上ラン',       zh: '10km以上跑步', ko: '10km+ 러닝' },
};

/**
 * formatRunningCourse — Gemini 프롬프트 주입용 단일 코스 문자열.
 *
 * @param {object} course - getRunningIndex row
 * @param {string} [language='en']
 * @returns {string}
 */
export function formatRunningCourse(course, language = 'en') {
  if (!course) return '';
  const lang = ['en', 'ja', 'zh', 'ko'].includes(language) ? language : 'en';
  const themeName = typeof course.theme === 'object'
    ? (course.theme[lang] || course.theme.en || '')
    : course.theme || '';
  const intensityLabel = INTENSITY_LABELS[course.intensity]?.[lang] || course.intensity;
  const distStr = course.distance_km ? `${course.distance_km}km` : '';
  const durationStr = course.duration_min ? `~${course.duration_min}min` : '';

  return `  • ${themeName} (${course.zone}) — ${distStr} / ${durationStr} [${intensityLabel}]`;
}

/**
 * getRunningContextForPrompt — handlerCore.js 주입용 통합 헬퍼.
 * HangangRun / Running 옵션 선택 시 호출.
 *
 * @param {object} opts
 * @param {string[]} opts.cities - plan 의 도시 배열 (소문자)
 * @param {string} [opts.language='en'] - 코스 설명 언어
 * @param {number} [opts.maxItems=5] - 최대 코스 수
 * @returns {string} Gemini prompt 주입 문자열 ('' 이면 주입 skip)
 */
export function getRunningContextForPrompt({ cities = [], language = 'en', maxItems = 5 } = {}) {
  const index = getRunningIndex();
  if (!index.length) return '';

  const lang = ['en', 'ja', 'zh', 'ko'].includes(language) ? language : 'en';

  // 도시 목록에서 코스 수집
  let courses = [];
  const seen = new Set();
  for (const city of cities) {
    const cityResults = getRunningCoursesByCity(city);
    for (const c of cityResults) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        courses.push(c);
      }
    }
  }

  // 해당 도시 코스 없으면 서울 fallback (HangangRun = 서울 대표 활동)
  if (courses.length === 0) {
    courses = index.filter(c => c.city === 'seoul');
  }

  if (courses.length === 0) return '';

  const selected = courses.slice(0, maxItems);
  const lines = selected.map(c => formatRunningCourse(c, lang));

  const headers = {
    en: '## VERIFIED RUNNING COURSES (use EXACT course names and distances in the plan)',
    ja: '## 検証済みランニングコース（プランには正確なコース名・距離を使用してください）',
    zh: '## 已验证跑步路线（请在计划中使用准确的路线名称和距离）',
    ko: '## 검증된 러닝 코스 (아래 정확한 코스명 + 거리 사용 의무)',
  };
  const footers = {
    en: 'IMPORTANT: Use EXACT course names and distances from the above list. Set "verified": true on each running stop from this list.',
    ja: '重要: 上記リストの正確なコース名・距離を使用してください。',
    zh: '重要：使用上述列表中的准确路线名称和距离。',
    ko: '중요: 위 목록의 정확한 코스명과 거리를 사용하세요. 임의 추측 금지.',
  };

  const header = headers[lang] || headers.en;
  const footer = footers[lang] || footers.en;

  return `\n\n--- VERIFIED RUNNING DATABASE (use EXACT course names/distances) ---\n${header}\n${lines.join('\n')}\n\n${footer}\n---`;
}
