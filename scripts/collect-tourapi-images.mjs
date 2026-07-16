#!/usr/bin/env node
/**
 * Collect reusable VisitKorea/TourAPI photos for CocoTrip.
 *
 * Output:
 *   public/tourapi-images/<lang>/<area>/<contentId>-<hash>.<ext>
 *   public/tourapi-images/manifest.json
 *
 * Examples:
 *   node scripts/collect-tourapi-images.mjs --dry-run --max-items=30
 *   node scripts/collect-tourapi-images.mjs --lang=kor --max-items=300 --max-images=600
 *   node scripts/collect-tourapi-images.mjs --lang=eng --areas=1,6,39 --max-items=150
 */

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  statSync,
} from 'fs';
import { dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'public', 'tourapi-images');
const MANIFEST_PATH = join(OUTPUT_DIR, 'manifest.json');
const BASE_URL = 'http://apis.data.go.kr/B551011';

const AREA_MAP = {
  1: 'seoul',
  2: 'incheon',
  3: 'daejeon',
  4: 'daegu',
  5: 'gwangju',
  6: 'busan',
  7: 'ulsan',
  8: 'sejong',
  31: 'gyeonggi',
  32: 'gangwon',
  33: 'chungbuk',
  34: 'chungnam',
  35: 'gyeongbuk',
  36: 'gyeongnam',
  37: 'jeonbuk',
  38: 'jeonnam',
  39: 'jeju',
};

const SERVICE_BY_LANG = {
  kor: 'KorService2',
  eng: 'EngService2',
  jpn: 'JpnService2',
  chs: 'ChsService2',
  cht: 'ChtService2',
};

const CONTENT_TYPE_LABELS = {
  12: 'attraction',
  14: 'culture',
  15: 'festival',
  25: 'course',
  28: 'leports',
  32: 'accommodation',
  38: 'shopping',
  39: 'food',
};

const SEASON_KEYWORDS = {
  spring: [
    'spring', 'flower', 'blossom', 'cherry', 'azalea', 'tulip', 'canola',
    '봄', '꽃', '벚꽃', '유채', '철쭉', '진달래', '튤립', '매화',
    '桜', '花', '春', '樱', '花海', '春季',
  ],
  summer: [
    'summer', 'beach', 'water', 'sea', 'surf', 'night market',
    '여름', '해수욕장', '바다', '해변', '물놀이', '야시장',
    '夏', '海', '海水浴', '夜市', '夏季',
  ],
  autumn: [
    'autumn', 'fall', 'foliage', 'maple', 'ginkgo', 'reed', 'pink muhly',
    '가을', '단풍', '은행', '억새', '갈대', '핑크뮬리',
    '秋', '紅葉', '银杏', '枫叶', '秋季',
  ],
  winter: [
    'winter', 'snow', 'ski', 'ice', 'light festival',
    '겨울', '눈', '설경', '스키', '얼음', '빛축제',
    '冬', '雪', 'スキー', '冰雪', '冬季',
  ],
};

const THEME_KEYWORDS = {
  palace: ['palace', '궁', '경복궁', '창덕궁', '덕수궁', '昌德宮', '景福宫'],
  temple: ['temple', '사찰', '절', '불국사', '용궁사', '寺', '仏閣'],
  hanok: ['hanok', '한옥', '북촌', '전주', '韓屋', '韩屋'],
  market: ['market', '시장', '야시장', '광장시장', '자갈치', '市', '市场', '夜市'],
  food: ['food', 'restaurant', '맛집', '음식', '김치', '카페', '美食', 'グルメ'],
  nature: ['nature', 'park', 'mountain', 'forest', 'island', '공원', '산', '숲', '섬', '自然'],
  beach: ['beach', 'sea', '해수욕장', '해변', '바다', '海'],
  night: ['night', 'light', '야경', '밤', '빛', '夜景', '夜'],
  shopping: ['shopping', '쇼핑', '거리', '로드', 'mall', '商店街', '购物'],
  museum: ['museum', 'gallery', '박물관', '미술관', '전시', '博物館', '美術館'],
  festival: ['festival', '축제', 'フェス', '祭', '节'],
  photoSpot: ['photo', 'view', 'skywalk', '전망', '스카이워크', '포토', '展望', '打卡'],
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function matchesKeyword(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
}

function classifyPhoto({ item, image, contentTypeId, areaCode }) {
  const text = [
    item.title,
    item.addr1,
    item.addr2,
    item.cat1,
    item.cat2,
    item.cat3,
    image.imageName,
    CONTENT_TYPE_LABELS[contentTypeId],
    AREA_MAP[Number(areaCode || item.areacode)],
  ].filter(Boolean).join(' ');

  const seasonTags = Object.entries(SEASON_KEYWORDS)
    .filter(([, keywords]) => matchesKeyword(text, keywords))
    .map(([season]) => season);

  const themeTags = Object.entries(THEME_KEYWORDS)
    .filter(([, keywords]) => matchesKeyword(text, keywords))
    .map(([theme]) => theme);

  const contentType = CONTENT_TYPE_LABELS[contentTypeId] || String(contentTypeId || '');
  if (contentType === 'festival') themeTags.push('festival');
  if (contentType === 'shopping') themeTags.push('shopping');
  if (contentType === 'food') themeTags.push('food');
  if (contentType === 'culture') themeTags.push('museum');
  if (contentType === 'leports') themeTags.push('activity');
  if (!themeTags.length && contentType === 'attraction') themeTags.push('landmark');

  const campaignBuckets = [];
  if (themeTags.includes('palace') || themeTags.includes('hanok') || themeTags.includes('temple')) {
    campaignBuckets.push('classic-korea');
  }
  if (themeTags.includes('market') || themeTags.includes('food') || themeTags.includes('shopping')) {
    campaignBuckets.push('food-shopping');
  }
  if (themeTags.includes('nature') || themeTags.includes('beach') || themeTags.includes('photoSpot')) {
    campaignBuckets.push('scenic-b-roll');
  }
  if (themeTags.includes('night') || themeTags.includes('festival')) {
    campaignBuckets.push('night-festival');
  }
  if (['seoul', 'busan', 'jeju', 'gyeongju'].includes(AREA_MAP[Number(areaCode || item.areacode)])) {
    campaignBuckets.push('first-korea-trip');
  }
  if (seasonTags.length) {
    campaignBuckets.push(...seasonTags.map((season) => `${season}-season`));
  }

  return {
    regionGroup: AREA_MAP[Number(areaCode || item.areacode)] || 'unknown-region',
    contentType,
    seasonTags: unique(seasonTags.length ? seasonTags : ['all-season']),
    themeTags: unique(themeTags),
    campaignBuckets: unique(campaignBuckets.length ? campaignBuckets : ['general-travel']),
  };
}

function parseArgs(argv) {
  const args = {
    lang: 'kor',
    areas: Object.keys(AREA_MAP).join(','),
    contentTypes: '12,14,15,25,28,38,39',
    maxPages: 2,
    maxItems: 250,
    maxImages: 500,
    rows: 100,
    delayMs: 220,
    detailImages: true,
    dryRun: false,
  };

  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--no-detail') args.detailImages = false;
    else if (raw.startsWith('--')) {
      const [key, value = ''] = raw.slice(2).split('=');
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[camel] = value;
    }
  }

  args.maxPages = Number(args.maxPages || 1);
  args.maxItems = Number(args.maxItems || 100);
  args.maxImages = Number(args.maxImages || 200);
  args.rows = Number(args.rows || 100);
  args.delayMs = Number(args.delayMs || 220);
  args.detailImages = args.detailImages !== 'false' && args.detailImages !== false;
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

function serviceKeyParam(serviceKey) {
  return serviceKey.includes('%') ? serviceKey : encodeURIComponent(serviceKey);
}

function buildApiUrl({ service, operation, serviceKey, params }) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  return `${BASE_URL}/${service}/${operation}?serviceKey=${serviceKeyParam(serviceKey)}&${qs.toString()}`;
}

async function fetchJson(url, label) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  try {
    const data = JSON.parse(text);
    const header = data?.response?.header;
    if (header?.resultCode && header.resultCode !== '0000') {
      throw new Error(`${label} API ${header.resultCode}: ${header.resultMsg || 'unknown error'}`);
    }
    return data;
  } catch (err) {
    throw new Error(`${label} JSON parse failed: ${err.message} / ${text.slice(0, 160)}`);
  }
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      generatedAt: null,
      source: 'Korea Tourism Organization TourAPI',
      outputDir: 'public/tourapi-images',
      photos: [],
    };
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function extensionFor({ url, contentType }) {
  const fromPath = extname(new URL(url).pathname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(fromPath)) return fromPath;
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  return '.jpg';
}

async function downloadPhoto({ url, targetPath }) {
  const res = await fetch(url, {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      'User-Agent': 'CocoTrip photo collector',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`image HTTP ${res.status}`);
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  await pipeline(res.body, createWriteStream(targetPath));
  return {
    bytes: statSync(targetPath).size,
    contentType: res.headers.get('content-type') || '',
  };
}

function photoUrlCandidates(item) {
  const urls = [];
  if (item.firstimage) urls.push({ url: item.firstimage, sourceType: 'firstimage' });
  if (item.firstimage2 && item.firstimage2 !== item.firstimage) {
    urls.push({ url: item.firstimage2, sourceType: 'firstimage2' });
  }
  return urls;
}

async function fetchAreaItems({ lang, areaCode, contentTypeId, pageNo, args, serviceKey }) {
  const service = SERVICE_BY_LANG[lang];
  const url = buildApiUrl({
    service,
    operation: 'areaBasedList2',
    serviceKey,
    params: {
      MobileOS: 'ETC',
      MobileApp: 'cocotrip',
      _type: 'json',
      numOfRows: args.rows,
      pageNo,
      arrange: 'Q',
      areaCode,
      contentTypeId,
    },
  });
  const data = await fetchJson(url, `area ${lang}/${areaCode}/${contentTypeId}/${pageNo}`);
  const body = data?.response?.body || {};
  return {
    total: Number(body.totalCount || 0),
    items: asArray(body.items?.item),
  };
}

async function fetchDetailImages({ lang, contentId, args, serviceKey }) {
  const service = SERVICE_BY_LANG[lang];
  const url = buildApiUrl({
    service,
    operation: 'detailImage2',
    serviceKey,
    params: {
      MobileOS: 'ETC',
      MobileApp: 'cocotrip',
      _type: 'json',
      numOfRows: 30,
      pageNo: 1,
      contentId,
      imageYN: 'Y',
      subImageYN: 'Y',
    },
  });
  const data = await fetchJson(url, `detailImage ${lang}/${contentId}`);
  const items = asArray(data?.response?.body?.items?.item);
  return items
    .map((img) => ({
      url: img.originimgurl || img.smallimageurl || '',
      sourceType: 'detailImage',
      imageName: img.imgname || '',
      serialnum: img.serialnum || '',
      cpyrhtDivCd: img.cpyrhtDivCd || '',
    }))
    .filter((img) => img.url);
}

function makePhotoRecord({ lang, areaCode, contentTypeId, item, image, index, targetPath, bytes, contentType }) {
  const localPath = relative(ROOT, targetPath).replace(/\\/g, '/');
  const classification = classifyPhoto({ item, image, contentTypeId, areaCode });
  return {
    id: `${item.contentid}-${hash(image.url, 8)}`,
    contentId: String(item.contentid || ''),
    contentTypeId: String(contentTypeId || item.contenttypeid || ''),
    contentType: classification.contentType,
    lang,
    areaCode: String(areaCode || item.areacode || ''),
    area: classification.regionGroup,
    title: item.title || '',
    address: item.addr1 || '',
    lat: item.mapy ? Number(item.mapy) : null,
    lng: item.mapx ? Number(item.mapx) : null,
    seasonTags: classification.seasonTags,
    themeTags: classification.themeTags,
    campaignBuckets: classification.campaignBuckets,
    sourceType: image.sourceType,
    imageName: image.imageName || '',
    serialnum: image.serialnum || '',
    cpyrhtDivCd: image.cpyrhtDivCd || '',
    sourceUrl: image.url,
    localPath,
    publicUrl: `/${localPath.replace(/^public\//, '')}`,
    bytes,
    contentTypeHeader: contentType || '',
    sortIndex: index,
  };
}

function addToIndex(index, key, id) {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(id);
}

function buildManifestIndexes(photos) {
  const indexes = {
    byLang: {},
    byArea: {},
    byContentType: {},
    bySeason: {},
    byTheme: {},
    byCampaign: {},
  };

  for (const photo of photos) {
    addToIndex(indexes.byLang, photo.lang, photo.id);
    addToIndex(indexes.byArea, photo.area, photo.id);
    addToIndex(indexes.byContentType, photo.contentType, photo.id);
    for (const season of photo.seasonTags || []) addToIndex(indexes.bySeason, season, photo.id);
    for (const theme of photo.themeTags || []) addToIndex(indexes.byTheme, theme, photo.id);
    for (const bucket of photo.campaignBuckets || []) addToIndex(indexes.byCampaign, bucket, photo.id);
  }

  return indexes;
}

async function main() {
  loadDotEnv(join(ROOT, '.env'));
  loadDotEnv(join(ROOT, '.env.local'));
  loadDotEnv(join(ROOT, '.env.admin.local'));

  const args = parseArgs(process.argv.slice(2));
  const serviceKey = (
    process.env.VISITKOREA_SERVICE_KEY ||
    process.env.VISITKORAE_SERVICE_KEY ||
    process.env.TOURAPI_SERVICE_KEY ||
    ''
  ).trim();

  if (!serviceKey) {
    console.error('VISITKOREA_SERVICE_KEY is missing.');
    console.error('Set VISITKOREA_SERVICE_KEY in .env, then rerun this script.');
    process.exit(1);
  }

  const langs = args.lang === 'all'
    ? Object.keys(SERVICE_BY_LANG)
    : String(args.lang).split(',').map((v) => v.trim()).filter(Boolean);
  const areaCodes = String(args.areas).split(',').map(Number).filter((v) => AREA_MAP[v]);
  const contentTypes = String(args.contentTypes).split(',').map(Number).filter(Boolean);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifest = readManifest();
  const seenSourceUrls = new Set(manifest.photos.map((photo) => photo.sourceUrl).filter(Boolean));
  const seenContentLang = new Set();
  const newPhotos = [];
  let fetchedItems = 0;
  let apiCalls = 0;
  let errors = 0;

  console.log(`[tourapi] start lang=${langs.join(',')} areas=${areaCodes.length} contentTypes=${contentTypes.join(',')}`);
  console.log(`[tourapi] limits maxItems=${args.maxItems} maxImages=${args.maxImages} maxPages=${args.maxPages} dryRun=${args.dryRun}`);

  outer:
  for (const lang of langs) {
    if (!SERVICE_BY_LANG[lang]) {
      console.warn(`[tourapi] skip unknown lang: ${lang}`);
      continue;
    }
    for (const areaCode of areaCodes) {
      for (const contentTypeId of contentTypes) {
        for (let pageNo = 1; pageNo <= args.maxPages; pageNo += 1) {
          if (fetchedItems >= args.maxItems || newPhotos.length >= args.maxImages) break outer;
          try {
            const { items } = await fetchAreaItems({ lang, areaCode, contentTypeId, pageNo, args, serviceKey });
            apiCalls += 1;
            if (!items.length) break;

            for (const item of items) {
              if (fetchedItems >= args.maxItems || newPhotos.length >= args.maxImages) break outer;
              const contentId = String(item.contentid || '').trim();
              if (!contentId) continue;
              const contentKey = `${lang}:${contentId}`;
              if (seenContentLang.has(contentKey)) continue;
              seenContentLang.add(contentKey);
              fetchedItems += 1;

              const candidates = photoUrlCandidates(item);
              if (args.detailImages) {
                try {
                  const detailImages = await fetchDetailImages({ lang, contentId, args, serviceKey });
                  apiCalls += 1;
                  candidates.push(...detailImages);
                  await sleep(args.delayMs);
                } catch (err) {
                  errors += 1;
                  console.warn(`[tourapi] detail image failed contentId=${contentId}: ${err.message}`);
                }
              }

              let imageIndex = 0;
              for (const image of candidates) {
                if (newPhotos.length >= args.maxImages) break outer;
                if (!image.url || seenSourceUrls.has(image.url)) continue;
                seenSourceUrls.add(image.url);
                imageIndex += 1;

                const ext = extensionFor({ url: image.url, contentType: '' });
                const area = AREA_MAP[areaCode] || `area-${areaCode}`;
                const fileCategory = CONTENT_TYPE_LABELS[contentTypeId] || `type-${contentTypeId}`;
                const targetPath = join(
                  OUTPUT_DIR,
                  lang,
                  area,
                  fileCategory,
                  `${contentId}-${hash(image.url, 8)}${ext}`
                );

                let bytes = 0;
                let contentType = '';
                if (!args.dryRun) {
                  try {
                    const result = await downloadPhoto({ url: image.url, targetPath });
                    bytes = result.bytes;
                    contentType = result.contentType;
                    await sleep(args.delayMs);
                  } catch (err) {
                    errors += 1;
                    console.warn(`[tourapi] download failed ${image.url}: ${err.message}`);
                    continue;
                  }
                }

                newPhotos.push(makePhotoRecord({
                  lang,
                  areaCode,
                  contentTypeId,
                  item,
                  image,
                  index: imageIndex,
                  targetPath,
                  bytes,
                  contentType,
                }));
                if (newPhotos.length % 25 === 0) {
                  console.log(`[tourapi] photos=${newPhotos.length} items=${fetchedItems} apiCalls=${apiCalls}`);
                }
              }
            }

            await sleep(args.delayMs);
            if (items.length < args.rows) break;
          } catch (err) {
            errors += 1;
            console.warn(`[tourapi] area page failed lang=${lang} area=${areaCode} type=${contentTypeId} page=${pageNo}: ${err.message}`);
            await sleep(args.delayMs);
            break;
          }
        }
      }
    }
  }

  const photos = args.dryRun ? [...manifest.photos] : [...manifest.photos, ...newPhotos];
  const merged = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    source: 'Korea Tourism Organization TourAPI',
    outputDir: 'public/tourapi-images',
    stats: {
      totalPhotos: manifest.photos.length + newPhotos.length,
      addedPhotos: newPhotos.length,
      fetchedItems,
      apiCalls,
      errors,
      dryRun: args.dryRun,
      lang: langs,
      areas: areaCodes,
      contentTypes,
    },
    photos,
    indexes: buildManifestIndexes(photos),
    dryRunPhotos: args.dryRun ? newPhotos : undefined,
  };

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  console.log(`[tourapi] done added=${newPhotos.length} existing=${manifest.photos.length} errors=${errors}`);
  console.log(`[tourapi] manifest=${MANIFEST_PATH}`);
  if (args.dryRun) {
    console.log('[tourapi] dry run only: files were not downloaded, and photos were written to dryRunPhotos.');
  }
}

main().catch((err) => {
  console.error(`[tourapi] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
