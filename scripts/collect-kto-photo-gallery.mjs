#!/usr/bin/env node
/**
 * Collect Korea Tourism Organization Photo Gallery images.
 *
 * Source:
 *   https://apis.data.go.kr/B551011/PhotoGalleryService1/galleryList1
 *
 * Output:
 *   public/kto-photo-gallery/<region>/<season>/<primaryTheme>/<contentId>-<hash>.<ext>
 *   public/kto-photo-gallery/manifest.json
 */

import { createHash } from 'crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { classifyRegion } from './lib/kto-region.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'public', 'kto-photo-gallery');
const MANIFEST_PATH = join(OUTPUT_DIR, 'manifest.json');
const API_BASE = 'https://apis.data.go.kr/B551011/PhotoGalleryService1/galleryList1';


const THEME_KEYWORDS = {
  palace: ['궁', '경복궁', '창덕궁', '덕수궁', '궁궐', 'palace'],
  temple: ['사찰', '절', '불국사', '용궁사', 'temple'],
  hanok: ['한옥', '북촌', '전주한옥', '민속마을', 'hanok'],
  market: ['시장', '야시장', '장터', 'market'],
  food: ['음식', '김치', '카페', '맛', 'food', 'coffee'],
  nature: ['산', '숲', '공원', '섬', '강', '호수', '계곡', '자연', 'nature'],
  beach: ['해변', '해수욕장', '바다', 'beach', 'sea'],
  night: ['야경', '밤', '조명', '빛', 'night', 'light'],
  shopping: ['쇼핑', '거리', '로드', 'shopping'],
  museum: ['박물관', '미술관', '전시', 'museum', 'gallery'],
  festival: ['축제', '페스티벌', 'festival'],
  flower: ['꽃', '벚꽃', '유채', '철쭉', '튤립', '매화', 'flower', 'blossom'],
  snow: ['눈', '설경', '겨울', 'snow', 'winter'],
  photoSpot: ['전망', '스카이워크', '일출', '일몰', '풍경', 'view', 'sunrise', 'sunset'],
};

function parseArgs(argv) {
  const args = {
    maxImages: 500,
    rows: 100,
    startPage: 1,
    maxPages: 10,
    arrange: 'A',
    delayMs: 180,
    dryRun: false,
    verboseErrors: false,
  };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw.startsWith('--')) {
      const [key, value = ''] = raw.slice(2).split('=');
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[camel] = value;
    }
  }
  args.maxImages = Number(args.maxImages || 500);
  args.rows = Number(args.rows || 100);
  args.startPage = Number(args.startPage || 1);
  args.maxPages = Number(args.maxPages || 10);
  args.delayMs = Number(args.delayMs || 180);
  args.verboseErrors = args.verboseErrors === true || args.verboseErrors === 'true';
  return args;
}

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let value = m[2].trim();
    if (!value || value.startsWith('#')) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, '\n');
    }
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(input, size = 10) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, size);
}

function keyParam(key) {
  return key.includes('%') ? key : encodeURIComponent(key);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      generatedAt: null,
      source: 'Korea Tourism Organization PhotoGalleryService1',
      outputDir: 'public/kto-photo-gallery',
      photos: [],
      indexes: {},
    };
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function textOf(item) {
  return [
    item.galTitle,
    item.galPhotographyLocation,
    item.galSearchKeyword,
    item.galPhotographer,
  ].filter(Boolean).join(' ');
}

// 지역 분류는 scripts/lib/kto-region.mjs 로 분리(2026-07-28) — 잠금 테스트를 붙이기 위해서.
// 🔴 거기서 고친 것: KTO 신표기 `전남광주통합특별시 여수시` 때문에 광역 '광주'가 먼저
//    걸려 여수 사진 48장이 gwangju/ 로 들어가 있었다(= "여수 사진 0장" 오판의 원인).

function classifySeason(item) {
  const raw = String(item.galPhotographyMonth || '').replace(/[^0-9]/g, '');
  const month = raw.length >= 6 ? Number(raw.slice(4, 6)) : Number(raw);
  if ([3, 4, 5].includes(month)) return 'spring';
  if ([6, 7, 8].includes(month)) return 'summer';
  if ([9, 10, 11].includes(month)) return 'autumn';
  if ([12, 1, 2].includes(month)) return 'winter';

  const text = textOf(item).toLowerCase();
  if (['벚꽃', '유채', '봄', 'flower', 'blossom'].some((v) => text.includes(v))) return 'spring';
  if (['해변', '바다', '여름', 'beach', 'summer'].some((v) => text.includes(v))) return 'summer';
  if (['단풍', '가을', 'autumn', 'fall'].some((v) => text.includes(v))) return 'autumn';
  if (['눈', '설경', '겨울', 'snow', 'winter'].some((v) => text.includes(v))) return 'winter';
  return 'all-season';
}

function classifyThemes(item) {
  const text = textOf(item).toLowerCase();
  const themes = [];
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) themes.push(theme);
  }
  if (!themes.length) themes.push('travel-scene');
  return [...new Set(themes)];
}

function campaignBuckets({ region, season, themes }) {
  const buckets = [];
  if (['seoul', 'busan', 'jeju', 'gyeongbuk', 'gangwon'].includes(region)) buckets.push('first-korea-trip');
  if (themes.some((t) => ['palace', 'temple', 'hanok'].includes(t))) buckets.push('classic-korea');
  if (themes.some((t) => ['market', 'food', 'shopping'].includes(t))) buckets.push('food-shopping');
  if (themes.some((t) => ['nature', 'beach', 'photoSpot', 'flower', 'snow'].includes(t))) buckets.push('scenic-b-roll');
  if (themes.some((t) => ['night', 'festival'].includes(t))) buckets.push('night-festival');
  if (season !== 'all-season') buckets.push(`${season}-season`);
  if (!buckets.length) buckets.push('general-travel');
  return [...new Set(buckets)];
}

function extensionFor(url, contentType = '') {
  const fromPath = extname(new URL(url).pathname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(fromPath)) return fromPath;
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  return '.jpg';
}

async function fetchPage({ key, pageNo, args }) {
  const qs = new URLSearchParams({
    MobileOS: 'ETC',
    MobileApp: 'cocotrip',
    _type: 'json',
    numOfRows: String(args.rows),
    pageNo: String(pageNo),
    arrange: String(args.arrange || 'A'),
  });
  const url = `${API_BASE}?serviceKey=${keyParam(key)}&${qs.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 120)}`);
  const data = JSON.parse(raw);
  const header = data?.response?.header || {};
  if (header.resultCode !== '0000') throw new Error(`API ${header.resultCode}: ${header.resultMsg}`);
  const body = data?.response?.body || {};
  return {
    total: Number(body.totalCount || 0),
    items: asArray(body.items?.item),
  };
}

async function downloadPhoto(url, targetPath) {
  const res = await fetch(url, {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      'User-Agent': 'CocoTrip photo gallery collector',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok || !res.body) throw new Error(`image HTTP ${res.status}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  await pipeline(res.body, createWriteStream(targetPath));
  return {
    bytes: statSync(targetPath).size,
    contentType: res.headers.get('content-type') || '',
  };
}

function addToIndex(index, key, id) {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(id);
}

function buildIndexes(photos) {
  const indexes = {
    byRegion: {},
    bySeason: {},
    byTheme: {},
    byCampaign: {},
    byPhotographer: {},
  };
  for (const photo of photos) {
    addToIndex(indexes.byRegion, photo.region, photo.id);
    addToIndex(indexes.bySeason, photo.season, photo.id);
    addToIndex(indexes.byPhotographer, photo.photographer, photo.id);
    for (const theme of photo.themeTags || []) addToIndex(indexes.byTheme, theme, photo.id);
    for (const bucket of photo.campaignBuckets || []) addToIndex(indexes.byCampaign, bucket, photo.id);
  }
  return indexes;
}

function makeRecord({ item, targetPath, bytes, contentType }) {
  const region = classifyRegion(item);
  const season = classifySeason(item);
  const themeTags = classifyThemes(item);
  const primaryTheme = themeTags[0] || 'travel-scene';
  const localPath = relative(ROOT, targetPath).replace(/\\/g, '/');
  const id = `${item.galContentId}-${hash(item.galWebImageUrl, 8)}`;
  return {
    id,
    source: 'PhotoGalleryService1',
    contentId: String(item.galContentId || ''),
    contentTypeId: String(item.galContentTypeId || ''),
    title: item.galTitle || '',
    region,
    season,
    themeTags,
    primaryTheme,
    campaignBuckets: campaignBuckets({ region, season, themes: themeTags }),
    photographyMonth: item.galPhotographyMonth || '',
    photographyLocation: item.galPhotographyLocation || '',
    photographer: item.galPhotographer || '',
    searchKeyword: item.galSearchKeyword || '',
    createdTime: item.galCreatedtime || '',
    modifiedTime: item.galModifiedtime || '',
    sourceUrl: item.galWebImageUrl || '',
    localPath,
    publicUrl: `/${localPath.replace(/^public\//, '')}`,
    bytes,
    contentTypeHeader: contentType || '',
  };
}

async function main() {
  loadDotEnv(join(ROOT, '.env'));
  loadDotEnv(join(ROOT, '.env.local'));
  loadDotEnv(join(ROOT, '.env.admin.local'));

  const args = parseArgs(process.argv.slice(2));
  const key = (
    process.env.KTO_PHOTO_SERVICE_KEY ||
    process.env.PHOTO_GALLERY_SERVICE_KEY ||
    process.env.VISITKOREA_SERVICE_KEY ||
    process.env.TOURAPI_SERVICE_KEY ||
    ''
  ).trim();

  if (!key) {
    console.error('KTO_PHOTO_SERVICE_KEY or PHOTO_GALLERY_SERVICE_KEY is missing.');
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifest = readManifest();
  const seen = new Set(manifest.photos.map((photo) => photo.sourceUrl).filter(Boolean));
  const newPhotos = [];
  let apiCalls = 0;
  let errors = 0;
  let totalAvailable = 0;

  console.log(`[kto-photo] start maxImages=${args.maxImages} rows=${args.rows} pages=${args.startPage}-${args.startPage + args.maxPages - 1} dryRun=${args.dryRun}`);

  for (let pageNo = args.startPage; pageNo < args.startPage + args.maxPages; pageNo += 1) {
    if (newPhotos.length >= args.maxImages) break;
    let page;
    try {
      page = await fetchPage({ key, pageNo, args });
      apiCalls += 1;
      totalAvailable = page.total;
    } catch (err) {
      errors += 1;
      console.warn(`[kto-photo] page failed page=${pageNo}: ${err.message}`);
      break;
    }

    if (!page.items.length) break;
    for (const item of page.items) {
      if (newPhotos.length >= args.maxImages) break;
      const url = item.galWebImageUrl || '';
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const region = classifyRegion(item);
      const season = classifySeason(item);
      const primaryTheme = classifyThemes(item)[0] || 'travel-scene';
      const ext = extensionFor(url);
      const targetPath = join(OUTPUT_DIR, region, season, primaryTheme, `${item.galContentId}-${hash(url, 8)}${ext}`);

      let bytes = 0;
      let contentType = '';
      if (!args.dryRun) {
        try {
          const result = await downloadPhoto(url, targetPath);
          bytes = result.bytes;
          contentType = result.contentType;
          await sleep(args.delayMs);
        } catch (err) {
          errors += 1;
          if (args.verboseErrors || errors <= 10 || errors % 100 === 0) {
            console.warn(`[kto-photo] download failed content=${item.galContentId}: ${err.message} errors=${errors}`);
          }
          continue;
        }
      }

      newPhotos.push(makeRecord({ item, targetPath, bytes, contentType }));
      if (newPhotos.length % 25 === 0) {
        console.log(`[kto-photo] photos=${newPhotos.length} page=${pageNo} errors=${errors}`);
      }
    }
    await sleep(args.delayMs);
  }

  const photos = args.dryRun ? manifest.photos : [...manifest.photos, ...newPhotos];
  const merged = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    source: 'Korea Tourism Organization PhotoGalleryService1',
    outputDir: 'public/kto-photo-gallery',
    stats: {
      totalAvailable,
      totalPhotos: photos.length,
      addedPhotos: newPhotos.length,
      apiCalls,
      errors,
      dryRun: args.dryRun,
    },
    photos,
    indexes: buildIndexes(photos),
    dryRunPhotos: args.dryRun ? newPhotos : undefined,
  };

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  console.log(`[kto-photo] done added=${newPhotos.length} total=${photos.length} available=${totalAvailable} errors=${errors}`);
  console.log(`[kto-photo] manifest=${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(`[kto-photo] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
