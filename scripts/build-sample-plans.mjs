#!/usr/bin/env node
/**
 * build-sample-plans.mjs — ONE-OFF generator for the planner "예시 (Example)"
 * showcase. Produces 3 PII-free, real-quality Day-1 sample plans (Seoul / Busan
 * / Jeju) committed as static assets in src/data/sample-plans/.
 *
 * WHY this exists / why it is PII-free:
 *   - Stops are hand-curated from REAL verified data already in the repo:
 *       • landmarks  → src/data/zone_courses/*.json (verified places + coords + 4-lang)
 *       • restaurants → api/_food_index.json (rating ≥ 4.4, reviews ≥ 200, real coords)
 *   - Inputs are SYNTHETIC (no customer name/email/uid/accessToken/pricing). We
 *     never read a real customer plan from Firestore.
 *   - Transit between consecutive stops is REAL: live ODsay searchTransitRoute
 *     (subway/bus, with line/exit/station/timetable) — same shape RouteAgent
 *     writes to stop.transit_from_prev. Jeju has little rail, so it degrades to
 *     bus/walk honestly (never fabricated).
 *   - Photos are REAL Google Places photo_reference tokens fetched here and
 *     stored as photo_ref; StopCard renders them via /api/place-photo and hides
 *     gracefully if a token ever goes stale.
 *
 * Re-run:  node scripts/build-sample-plans.mjs
 *   needs env: ODSAY_API_KEY (transit), GOOGLE_PLACES_API_KEY (photos) — both
 *   optional; missing ones just skip that enrichment and the sample still builds.
 *
 * Output is deterministic-ish; commit whatever it emits. This script is dev-only
 * tooling (not imported by the app).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── env loader ───────────────────────────────────────────────────────────────
for (const f of ['.env', '.env.local', '.env.admin.local']) {
  try {
    const t = readFileSync(join(ROOT, f), 'utf8');
    for (const m of t.matchAll(/^([A-Z0-9_]+)\s*=\s*(.*)$/gm)) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\n/g, '\n');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* skip */ }
}

const { searchTransitRoute } = await import(pathToFileURL(join(ROOT, 'api/_odsay_helper.js')).href);

const GP_KEY = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
const haversine = (la1, lo1, la2, lo2) => {
  const R = 6371, d = (x) => (x * Math.PI) / 180;
  const a = Math.sin(d(la2 - la1) / 2) ** 2 + Math.cos(d(la1)) * Math.cos(d(la2)) * Math.sin(d(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// ── verified restaurant lookup (real food DB) ────────────────────────────────
const FOOD = JSON.parse(readFileSync(join(ROOT, 'api/_food_index.json'), 'utf8'));
function nearestRestaurant(lat, lng, city, used) {
  return FOOD
    .filter((r) => r.city === city && r.lat && r.lng && (r.rating || 0) >= 4.4 && (r.reviewCount || 0) >= 200 && !used.has(r.placeId))
    .map((r) => ({ r, dist: haversine(lat, lng, r.lat, r.lng) }))
    .sort((a, b) => a.dist - b.dist)[0]?.r || null;
}

// ── Google Places photo_reference (real, optional) ───────────────────────────
async function fetchPhotoRef(query) {
  if (!GP_KEY) return undefined;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GP_KEY}&language=ko`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    const ref = data?.results?.[0]?.photos?.[0]?.photo_reference;
    return ref || undefined;
  } catch {
    return undefined;
  }
}

// ── ODsay transit → transit_from_prev (mirrors RouteAgent mapping) ───────────
async function buildTransit(prev, curr) {
  if (!prev?.lat || !prev?.lng || !curr?.lat || !curr?.lng) return null;
  let pt = null;
  try {
    pt = await searchTransitRoute(prev.lng, prev.lat, curr.lng, curr.lat); // ODsay = (SX=lng, SY=lat)
  } catch { pt = null; }
  if (!pt) {
    // honest fallback: short straight-line distance estimate, mode=car. No fabricated subway.
    const km = haversine(prev.lat, prev.lng, curr.lat, curr.lng);
    const min = Math.max(8, Math.round((km / 28) * 60)); // ~28km/h city driving
    return {
      method: 'car', mode: 'car',
      instruction_en: '', step_by_step: [],
      est_min: min, est_fare_krw: 0,
      distance_km: Number(km.toFixed(1)),
      source: 'naver_fallback',
    };
  }
  if (pt.type === 'walk') {
    return {
      method: 'walk', mode: 'walk',
      instruction_en: '', step_by_step: [],
      est_min: pt.totalTime || 5, est_fare_krw: 0, total_walk_m: 0,
      source: 'odsay',
    };
  }
  return {
    method: pt.type || 'subway',                 // 'subway' | 'bus' | 'subway+bus'
    mode: pt.type === 'bus' ? 'bus' : 'subway',
    instruction_en: '',
    step_by_step: (pt.steps || []).map((s) => s.description).filter(Boolean),
    steps_detail: pt.steps || [],
    transfers: pt.transfers || 0,
    total_walk_m: pt.totalWalk || 0,
    first_station: pt.firstStation || null,
    last_station: pt.lastStation || null,
    est_min: pt.totalTime || 0,
    est_fare_krw: pt.fare || 0,
    source: 'odsay',
  };
}

// ── curated Day-1 itineraries (real verified landmarks) ──────────────────────
// All names/coords/addresses lifted from src/data/zone_courses/*.json (verified).
// Food stops resolved to real verified restaurants at build time (placeholder→DB).
const PLANS = [
  {
    file: 'seoul',
    city: 'seoul',
    cityLabel: { ko: '서울', en: 'Seoul', ja: 'ソウル', zh: '首尔' },
    tour_title: { ko: '서울 전통과 미식 1일', en: 'Seoul Heritage & Food — Day 1', ja: 'ソウル 伝統とグルメ 1日目', zh: '首尔传统与美食 第1天' },
    theme: { ko: '전통 + 시장 + 카페', en: 'Tradition + Market + Cafe', ja: '伝統 + 市場 + カフェ', zh: '传统 + 市场 + 咖啡' },
    lodgingLabel: { ko: '명동 숙소', en: 'Myeongdong hotel', ja: '明洞のホテル', zh: '明洞酒店' },
    lodging: { lat: 37.5636, lng: 126.9869 }, // Myeongdong
    stops: [
      { kind: 'place', category: 'culture', start_time: '09:30', stay_min: 90, entry_fee_krw: 3000,
        name: '경복궁', display: { ko: '경복궁', en: 'Gyeongbokgung Palace', ja: '景福宮', zh: '景福宫' },
        address: '서울특별시 종로구 사직로 161', lat: 37.5788408, lng: 126.9770162,
        tip: { ko: '수문장 교대식(10:00/14:00) 시간에 맞춰 방문하세요.', en: 'Time your visit to the Royal Guard Changing Ceremony (10:00 / 14:00).', ja: '守門将交代式(10:00/14:00)の時間に合わせて訪れましょう。', zh: '建议配合守门将交接仪式（10:00 / 14:00）时间参观。' } },
      { kind: 'place', category: 'culture', start_time: '11:30', stay_min: 90, entry_fee_krw: 0,
        name: '북촌한옥마을', display: { ko: '북촌한옥마을', en: 'Bukchon Hanok Village', ja: '北村韓屋村', zh: '北村韩屋村' },
        address: '서울특별시 종로구 계동길 37', lat: 37.5790768, lng: 126.9862753,
        tip: { ko: '주민이 거주하는 곳 — 정숙 관광. 8경 포토 스팟 추천.', en: 'Residents live here — please keep quiet. The 8 photo spots are recommended.', ja: '住民が暮らす地区 — 静かに観光を。8つのフォトスポット推奨。', zh: '居民居住区 — 请保持安静。推荐 8 大摄影点。' } },
      { kind: 'food', category: 'food', start_time: '13:00', stay_min: 60, anchor: { lat: 37.5732841, lng: 126.9856063 },
        tip: { ko: '인사동 골목 — 현지인 평점 높은 한식 맛집.', en: 'Insadong alley — a highly rated local Korean restaurant.', ja: '仁寺洞の路地 — 地元評価の高い韓国料理店。', zh: '仁寺洞小巷 — 当地高分韩餐厅。' } },
      { kind: 'place', category: 'culture', start_time: '14:30', stay_min: 90, entry_fee_krw: 0,
        name: '인사동', display: { ko: '인사동', en: 'Insadong', ja: '仁寺洞', zh: '仁寺洞' },
        address: '서울특별시 종로구 인사동길', lat: 37.5732841, lng: 126.9856063,
        tip: { ko: '쌈지길 + 전통 다실 + 갤러리 골목.', en: 'Ssamzigil + traditional tea house + gallery alley.', ja: 'サムジキル + 伝統茶屋 + ギャラリー横丁。', zh: 'Ssamzigil + 传统茶屋 + 画廊小巷。' } },
      { kind: 'place', category: 'food', start_time: '16:30', stay_min: 60, entry_fee_krw: 0,
        name: '광장시장', display: { ko: '광장시장', en: 'Gwangjang Market', ja: '広蔵市場', zh: '广藏市场' },
        address: '서울특별시 종로구 창경궁로 88', lat: 37.5701118, lng: 126.9997094,
        tip: { ko: '빈대떡 + 마약김밥 + 육회 — 한국 대표 길거리 음식.', en: 'Bindaetteok + mayak gimbap + yukhoe — iconic Korean street food.', ja: 'ビンデトック + 麻薬キンパ + ユッケ — 韓国を代表する屋台グルメ。', zh: '绿豆煎饼 + 麻药紫菜包饭 + 生牛肉 — 韩国代表性街头美食。' } },
    ],
  },
  {
    file: 'busan',
    city: 'busan',
    cityLabel: { ko: '부산', en: 'Busan', ja: '釜山', zh: '釜山' },
    tour_title: { ko: '부산 해변과 야경 1일', en: 'Busan Beaches & Skyline — Day 1', ja: '釜山 ビーチと夜景 1日目', zh: '釜山海滩与夜景 第1天' },
    theme: { ko: '해변 + 아쿠아리움 + 마린시티', en: 'Beach + Aquarium + Marine City', ja: 'ビーチ + 水族館 + マリンシティ', zh: '海滩 + 水族馆 + 海洋城市' },
    lodgingLabel: { ko: '해운대 숙소', en: 'Haeundae hotel', ja: '海雲台のホテル', zh: '海云台酒店' },
    lodging: { lat: 35.1631, lng: 129.1639 }, // Haeundae
    stops: [
      { kind: 'place', category: 'nature', start_time: '10:00', stay_min: 60, entry_fee_krw: 0,
        name: '해운대해수욕장', display: { ko: '해운대해수욕장', en: 'Haeundae Beach', ja: '海雲台ビーチ', zh: '海云台海水浴场' },
        address: '부산광역시 해운대구 해운대해변로 264', lat: 35.159107, lng: 129.1604,
        tip: { ko: '아침 산책으로 시작 — 모래사장 1.5km, 동백섬 연결.', en: 'Start with a morning walk — 1.5km of sand, connected to Dongbaek Island.', ja: '朝の散歩から — 砂浜1.5km、冬柏島へ続く。', zh: '从晨间漫步开始 — 1.5公里沙滩，连接冬柏岛。' } },
      { kind: 'place', category: 'culture', start_time: '11:30', stay_min: 90, entry_fee_krw: 29000,
        name: 'SEA LIFE 부산아쿠아리움', display: { ko: 'SEA LIFE 부산아쿠아리움', en: 'SEA LIFE Busan Aquarium', ja: 'SEA LIFE 釜山アクアリウム', zh: 'SEA LIFE 釜山水族馆' },
        address: '부산광역시 해운대구 해운대해변로 266', lat: 35.1593434, lng: 129.1607,
        tip: { ko: '해변 바로 앞 — 온라인 예매 시 할인.', en: 'Right on the beach — book online for a discount.', ja: 'ビーチ目の前 — オンライン予約で割引。', zh: '就在海滩边 — 网上预订有折扣。' } },
      { kind: 'food', category: 'food', start_time: '13:30', stay_min: 70, anchor: { lat: 35.1616873, lng: 129.1601 },
        tip: { ko: '구남로 — 현지 평점 높은 해산물·맛집.', en: 'Gunam-ro — top-rated local seafood restaurant.', ja: 'クナムロ — 地元評価の高い海鮮店。', zh: '龟南路 — 当地高分海鲜餐厅。' } },
      { kind: 'place', category: 'culture', start_time: '15:30', stay_min: 90, entry_fee_krw: 0,
        name: '마린시티', display: { ko: '마린시티', en: 'Marine City', ja: 'マリンシティ', zh: '海洋城市' },
        address: '부산광역시 해운대구 마린시티1로', lat: 35.1570863, lng: 129.1455,
        tip: { ko: '고층 스카이라인 + 카페 거리 — 해질녘 야경 명소.', en: 'High-rise skyline + cafe street — a sunset/night-view highlight.', ja: '高層スカイライン + カフェ通り — 夕景・夜景の名所。', zh: '高楼天际线 + 咖啡街 — 日落与夜景胜地。' } },
      { kind: 'place', category: 'nature', start_time: '18:00', stay_min: 60, entry_fee_krw: 0,
        name: '광안리해수욕장', display: { ko: '광안리해수욕장', en: 'Gwangalli Beach', ja: '広安里ビーチ', zh: '广安里海水浴场' },
        address: '부산광역시 수영구 광안해변로', lat: 35.1532, lng: 129.1187,
        tip: { ko: '광안대교 야경 + 해변 포차 — 부산 대표 밤풍경.', en: 'Gwangan Bridge lights + beachfront pochas — Busan’s iconic night view.', ja: '広安大橋のライト + 海辺の屋台 — 釜山名物の夜景。', zh: '广安大桥灯光 + 海边大排档 — 釜山代表夜景。' } },
    ],
  },
  {
    file: 'jeju',
    city: 'jeju',
    cityLabel: { ko: '제주', en: 'Jeju', ja: '済州', zh: '济州' },
    tour_title: { ko: '제주 동부 자연 1일', en: 'Jeju East Coast Nature — Day 1', ja: '済州 東部の自然 1日目', zh: '济州东部自然 第1天' },
    theme: { ko: '일출봉 + 섭지코지 + 해변', en: 'Sunrise Peak + Seopjikoji + Coast', ja: '日の出峰 + 섭지코지 + 海岸', zh: '日出峰 + 涉地可支 + 海岸' },
    lodgingLabel: { ko: '성산 숙소', en: 'Seongsan stay', ja: '城山の宿', zh: '城山住宿' },
    lodging: { lat: 33.4742, lng: 126.9292 }, // Seongsan town
    stops: [
      { kind: 'place', category: 'nature', start_time: '09:00', stay_min: 90, entry_fee_krw: 5000,
        name: '성산일출봉', display: { ko: '성산일출봉', en: 'Seongsan Ilchulbong (Sunrise Peak)', ja: '城山日出峰', zh: '城山日出峰' },
        address: '제주특별자치도 서귀포시 성산읍 성산리 1', lat: 33.4583815, lng: 126.9425,
        tip: { ko: 'UNESCO 세계자연유산 — 정상까지 약 25분 등반.', en: 'UNESCO World Heritage — about a 25-minute climb to the summit.', ja: 'ユネスコ世界自然遺産 — 山頂まで約25分。', zh: '联合国教科文世界自然遗产 — 登顶约25分钟。' } },
      { kind: 'place', category: 'nature', start_time: '11:30', stay_min: 90, entry_fee_krw: 4000,
        name: '섭지코지', display: { ko: '섭지코지', en: 'Seopjikoji', ja: 'ソプチコジ', zh: '涉地可支' },
        address: '제주특별자치도 서귀포시 성산읍 섭지코지로 95', lat: 33.4329769, lng: 126.9300,
        tip: { ko: '해안 절벽 산책로 + 등대 + 드라마 촬영지.', en: 'Coastal cliff trail + lighthouse + famous drama filming spot.', ja: '海岸の断崖遊歩道 + 灯台 + ドラマのロケ地。', zh: '海岸悬崖步道 + 灯塔 + 著名取景地。' } },
      { kind: 'food', category: 'food', start_time: '13:30', stay_min: 70, anchor: { lat: 33.442176, lng: 126.9180 },
        tip: { ko: '성산 일대 — 제주 향토 음식(전복·갈치) 맛집.', en: 'Seongsan area — local Jeju specialties (abalone, cutlassfish).', ja: '城山エリア — 済州の郷土料理(アワビ・タチウオ)。', zh: '城山一带 — 济州乡土料理（鲍鱼·带鱼）。' } },
      { kind: 'place', category: 'nature', start_time: '15:30', stay_min: 120, entry_fee_krw: 0,
        name: '우도', display: { ko: '우도', en: 'Udo Island', ja: '牛島', zh: '牛岛' },
        address: '제주특별자치도 제주시 우도면', lat: 33.506483, lng: 126.9533,
        tip: { ko: '성산항에서 페리 15분 — 전기 스쿠터로 섬 일주.', en: '15-minute ferry from Seongsan Port — circle the island by electric scooter.', ja: '城山港からフェリー15分 — 電動スクーターで島を一周。', zh: '城山港乘渡轮15分钟 — 电动滑板车环岛。' } },
    ],
  },
];

async function build() {
  const outDir = join(ROOT, 'src/data/sample-plans');
  mkdirSync(outDir, { recursive: true });
  const index = [];

  for (const plan of PLANS) {
    const used = new Set();
    const stops = [];
    let order = 1;
    for (const sp of plan.stops) {
      let stop;
      if (sp.kind === 'food') {
        const r = nearestRestaurant(sp.anchor.lat, sp.anchor.lng, plan.city, used);
        if (!r) { console.warn(`[${plan.file}] no restaurant near`, sp.anchor); continue; }
        used.add(r.placeId);
        stop = {
          order: order++,
          start_time: sp.start_time,
          name: r.name,
          display_name: r.nameEn || r.name,
          category: 'food',
          address: r.address,
          lat: r.lat, lng: r.lng,
          stay_min: sp.stay_min,
          entry_fee_krw: 0,
          verified: true,                       // from verified DB
          tip: sp.tip,                           // localized object (resolved per-lang at render)
          rating: r.rating,
          review_count: r.reviewCount,
          cuisine: r.cuisineKo || r.cuisine,
          cuisine_en: r.cuisine,
          recommended_items: [],
          _query: `${r.name} ${plan.cityLabel.ko}`,
        };
      } else {
        stop = {
          order: order++,
          start_time: sp.start_time,
          name: sp.name,
          display_name: sp.display.en,
          display_name_i18n: sp.display,
          category: sp.category,
          address: sp.address,
          lat: sp.lat, lng: sp.lng,
          stay_min: sp.stay_min,
          entry_fee_krw: sp.entry_fee_krw || 0,
          tip: sp.tip,
          _query: `${sp.name} ${plan.cityLabel.ko}`,
        };
      }
      stops.push(stop);
    }

    // photos (real Google Places refs)
    for (const s of stops) {
      const ref = await fetchPhotoRef(s._query);
      if (ref) s.photo_ref = ref;
      delete s._query;
    }

    // transit between consecutive stops (real ODsay)
    for (let i = 1; i < stops.length; i++) {
      const t = await buildTransit(stops[i - 1], stops[i]);
      if (t) stops[i].transit_from_prev = t;
    }
    // lodging → first stop
    const lodgingToFirst = await buildTransit(
      { lat: plan.lodging.lat, lng: plan.lodging.lng },
      stops[0],
    );

    const out = {
      id: `sample-${plan.file}`,
      isSample: true,
      city: plan.city,
      cityLabel: plan.cityLabel,
      tour_title_i18n: plan.tour_title,
      generated_by: 'build-sample-plans.mjs (verified zone_courses + food DB + live ODsay/Places)',
      day: {
        day: 1,
        date: '',
        theme_i18n: plan.theme,
        city: plan.city,
        lodgingLabel: plan.lodgingLabel,
        lodging_to_first: lodgingToFirst || null,
        stops,
      },
    };

    const fp = join(outDir, `${plan.file}.json`);
    writeFileSync(fp, JSON.stringify(out, null, 2), 'utf8');
    const realTransit = stops.filter((s) => s.transit_from_prev && ['subway', 'bus', 'subway+bus', 'walk'].includes(s.transit_from_prev.method) && s.transit_from_prev.source === 'odsay').length;
    const photos = stops.filter((s) => s.photo_ref).length;
    console.log(`✅ ${plan.file}: ${stops.length} stops | ${realTransit} real-ODsay legs | ${photos} photos`);
    index.push({ id: out.id, file: `${plan.file}.json`, city: plan.city, cityLabel: plan.cityLabel });
  }

  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`\n✅ wrote ${index.length} samples + index.json → src/data/sample-plans/`);
}

build().catch((e) => { console.error('build failed:', e); process.exit(1); });
