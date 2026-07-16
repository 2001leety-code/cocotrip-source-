#!/usr/bin/env node
/**
 * Audit KTO photo-gallery assets before using them on tour pages.
 *
 * This does not delete files. It creates review lists:
 *   outputs/tourapi-photo-harvest-2026-07-12/photo-quality-audit.json
 *   outputs/tourapi-photo-harvest-2026-07-12/photo-quality-audit.csv
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'public', 'kto-photo-gallery', 'manifest.json');
const OUT_DIR = join(ROOT, 'outputs', 'tourapi-photo-harvest-2026-07-12');

const REGION_ALIASES = {
  seoul: ['서울', '서울특별시', '종로구', '중구', '강남구', '마포구', '용산구'],
  busan: ['부산', '부산광역시', '해운대', '광안리', '수영구', '기장'],
  jeju: ['제주', '제주특별자치도', '제주시', '서귀포', '한림', '조천', '구좌'],
  incheon: ['인천', '인천광역시', '강화', '송도', '월미도'],
  gyeonggi: ['경기', '경기도', '수원', '파주', '가평', '양평', '포천', '용인'],
  gangwon: ['강원', '강원도', '강원특별자치도', '춘천', '속초', '강릉', '평창', '양양', '정선', '화천'],
  chungbuk: ['충북', '충청북도', '단양', '제천', '청주'],
  chungnam: ['충남', '충청남도', '공주', '부여', '천안', '태안'],
  daejeon: ['대전', '대전광역시'],
  sejong: ['세종', '세종특별자치시'],
  daegu: ['대구', '대구광역시'],
  gyeongbuk: ['경북', '경상북도', '경주', '안동', '포항', '문경'],
  gyeongnam: ['경남', '경상남도', '통영', '거제', '진주', '남해', '창원', '진해'],
  ulsan: ['울산', '울산광역시'],
  gwangju: ['광주광역시'],
  jeonbuk: ['전북', '전라북도', '전북특별자치도', '전주', '군산', '고창', '남원'],
  jeonnam: ['전남', '전라남도', '여수', '순천', '목포', '담양', '완도', '화순', '강진', '진도'],
};

const GENERIC_LOCATION_VALUES = new Set([
  '대한민국',
  '대한민국(한국)',
  '한국',
  'korea',
]);

function textOf(photo) {
  return [
    photo.title,
    photo.photographyLocation,
    photo.searchKeyword,
  ].filter(Boolean).join(' ').toLowerCase();
}

function inferRegion(photo) {
  const text = textOf(photo);
  const hits = [];
  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    const count = aliases.filter((alias) => text.includes(alias.toLowerCase())).length;
    if (count) hits.push({ region, count });
  }

  // KTO sometimes returns legacy/combined strings such as "전남광주통합특별시 여수시".
  // Prefer specific Jeonnam city names over the broad "광주" fragment.
  if (/전남광주통합/.test(text)) {
    const jeonnamCityHit = REGION_ALIASES.jeonnam.some((alias) => text.includes(alias.toLowerCase()));
    if (jeonnamCityHit) return { region: 'jeonnam', hits };
  }

  hits.sort((a, b) => b.count - a.count);
  return {
    region: hits[0]?.region || 'unknown-region',
    hits,
  };
}

function auditPhoto(photo) {
  const flags = [];
  let score = 100;
  const inferred = inferRegion(photo);
  const location = String(photo.photographyLocation || '').trim();
  const themes = photo.themeTags || [];

  if (!location) {
    flags.push('missing_location');
    score -= 35;
  } else if (GENERIC_LOCATION_VALUES.has(location.toLowerCase())) {
    flags.push('generic_location');
    score -= 25;
  }

  if (!photo.region || photo.region === 'unknown-region') {
    flags.push('unknown_region');
    score -= 35;
  }

  if (inferred.region !== 'unknown-region' && photo.region && photo.region !== inferred.region) {
    flags.push(`region_mismatch:${photo.region}->${inferred.region}`);
    score -= 45;
  }

  if (inferred.hits.length > 1) {
    const top = inferred.hits[0]?.count || 0;
    const tied = inferred.hits.filter((hit) => hit.count === top);
    if (tied.length > 1) {
      flags.push(`ambiguous_region:${tied.map((hit) => hit.region).join('|')}`);
      score -= 20;
    }
  }

  if (!photo.searchKeyword) {
    flags.push('missing_keywords');
    score -= 20;
  }

  if (!themes.length || (themes.length === 1 && themes[0] === 'travel-scene')) {
    flags.push('weak_theme');
    score -= 15;
  }

  if (Number(photo.bytes || 0) < 120_000) {
    flags.push('small_file_review');
    score -= 15;
  }

  if (!photo.publicUrl || !photo.sourceUrl) {
    flags.push('missing_url');
    score -= 30;
  }

  let status = 'approved';
  if (score < 55 || flags.some((flag) => flag.startsWith('region_mismatch'))) status = 'review';
  if (score < 35 || flags.includes('missing_url')) status = 'reject';

  return {
    id: photo.id,
    status,
    score: Math.max(0, Math.round(score)),
    flags,
    suggestedRegion: inferred.region,
    currentRegion: photo.region,
    title: photo.title,
    season: photo.season,
    themeTags: themes,
    campaignBuckets: photo.campaignBuckets || [],
    photographyLocation: photo.photographyLocation || '',
    photographyMonth: photo.photographyMonth || '',
    photographer: photo.photographer || '',
    publicUrl: photo.publicUrl,
    sourceUrl: photo.sourceUrl,
  };
}

function csvEscape(value) {
  // (레포 규약: nullish 연산자 금지. || 로 바꾸면 0 이 '' 가 되어 CSV 에서 0 값이 사라진다 — null 검사로 동치 유지.)
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(rows) {
  const headers = [
    'status',
    'score',
    'flags',
    'currentRegion',
    'suggestedRegion',
    'season',
    'themeTags',
    'title',
    'photographyLocation',
    'photographyMonth',
    'photographer',
    'publicUrl',
  ];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => {
      const value = Array.isArray(row[header]) ? row[header].join('|') : row[header];
      return csvEscape(value);
    }).join(',')),
  ].join('\n');
}

if (!existsSync(MANIFEST_PATH)) {
  console.error(`Missing manifest: ${MANIFEST_PATH}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const rows = manifest.photos.map(auditPhoto);
const summary = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});
const flagCounts = {};
for (const row of rows) {
  for (const flag of row.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
}

const result = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  summary,
  flagCounts: Object.fromEntries(Object.entries(flagCounts).sort((a, b) => b[1] - a[1])),
  policy: {
    approved: 'Safe for automatic candidate pools.',
    review: 'Keep as candidate, but do not publish to a tour page until manually checked.',
    reject: 'Do not use.',
  },
  rows,
};

writeFileSync(join(OUT_DIR, 'photo-quality-audit.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
writeFileSync(join(OUT_DIR, 'photo-quality-audit.csv'), `${toCsv(rows)}\n`, 'utf8');

console.log(JSON.stringify({
  total: result.total,
  summary: result.summary,
  topFlags: Object.fromEntries(Object.entries(result.flagCounts).slice(0, 12)),
  json: join(OUT_DIR, 'photo-quality-audit.json'),
  csv: join(OUT_DIR, 'photo-quality-audit.csv'),
}, null, 2));
