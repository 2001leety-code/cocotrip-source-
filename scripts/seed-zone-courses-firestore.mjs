#!/usr/bin/env node
/**
 * seed-zone-courses-firestore.mjs
 *
 * zone_courses JSON (src/data/zone_courses/*.json) → Firestore zone_courses 컬렉션 시드.
 *
 * 역할:
 *   1. 지정 도시의 JSON 파일 읽기
 *   2. stops[].lat/lng=0 인 경우 Naver Geocoding 으로 실측 채우기
 *   3. transit_matrix 없거나 mock 인 경우 ODsay 실측 (ENV 있을 때만)
 *   4. Firestore 에 status:'published' + seeded_at 로 upsert
 *
 * Usage:
 *   node scripts/seed-zone-courses-firestore.mjs [--cities seoul,busan,jeju] [--dry-run] [--force]
 *
 * ENV (필수):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   NCP_CLIENT_ID, NCP_CLIENT_SECRET  — Naver Geocoding (없으면 lat/lng=0 유지)
 *   ODSAY_API_KEY                      — ODsay Transit (없으면 mock 유지)
 *
 * --dry-run  : Firestore 기록하지 않고 결과만 출력
 * --force    : 이미 status=published 인 문서도 덮어쓰기 (기본: 스킵)
 * --cities   : 쉼표 구분 도시 (기본: seoul,busan,jeju)
 *
 * 규칙:
 *   - NCP_CLIENT_ID.trim() 필수 (CLAUDE.md I)
 *   - FIREBASE_PRIVATE_KEY .replace 만 사용, trim 금지 (CLAUDE.md I)
 *   - Naver/ODsay rate limit: 200ms sleep per call
 *   - SAFETY-CRITICAL: dietary 필드 절대 변경 금지 (원본 그대로)
 *   - _food_index.json 건드리지 않음
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const ZONE_DIR = join(ROOT, 'src', 'data', 'zone_courses');

const NAVER_GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
const ODSAY_BASE = 'https://api.odsay.com/v1/api';

// ── CLI 파싱 ────────────────────────────────────────────────────────
function parseArgs(args) {
  const opts = {
    cities: ['seoul', 'busan', 'jeju'],
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--force') opts.force = true;
    else if (args[i] === '--cities' && args[i + 1]) {
      opts.cities = args[++i].split(',').map((c) => c.trim().toLowerCase());
    }
  }
  return opts;
}

// ── 200ms sleep (rate limit 준수) ────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Naver Geocoding ──────────────────────────────────────────────────
async function geocodeNaver(query, clientId, clientSecret) {
  const url = new URL(NAVER_GEOCODE_URL);
  url.searchParams.set('query', query);
  const res = await fetch(url.toString(), {
    headers: {
      // CLAUDE.md I: NCP_CLIENT_ID.trim() 의무
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Naver Geocode HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.addresses?.length) return null;
  const a = data.addresses[0];
  return { lat: parseFloat(a.y), lng: parseFloat(a.x) };
}

// ── ODsay Transit ────────────────────────────────────────────────────
async function searchOdsay(sx, sy, ex, ey, apiKey) {
  const url =
    `${ODSAY_BASE}/searchPubTransPathT` +
    `?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}` +
    `&apiKey=${encodeURIComponent(apiKey)}&output=json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Referer: 'https://cocotripkr.com' },
  });
  if (!res.ok) throw new Error(`ODsay HTTP ${res.status}`);
  const data = await res.json();
  if (data.error || !data.result?.path?.length) return null;
  const best = data.result.path[0];
  const info = best.info;
  return {
    pathType: info.pathType,
    totalTime: info.totalTime,
    payment: info.payment,
    distance: info.totalDistance,
  };
}

function pathTypeToMode(pt) {
  if (pt === 1) return 'subway';
  if (pt === 2) return 'bus';
  return 'mixed';
}

function buildNaverRouteUrl(fromName, fromLat, fromLng, toName, toLat, toLng) {
  const ef = encodeURIComponent(fromName);
  const et = encodeURIComponent(toName);
  return `https://map.naver.com/p/directions/${fromLng},${fromLat},${ef},,/${toLng},${toLat},${et},,/-/transit`;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Firestore admin 초기화 ────────────────────────────────────────────
async function initFirestore() {
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (env.FIREBASE_CLIENT_EMAIL || '').trim();
  // CLAUDE.md I: FIREBASE_PRIVATE_KEY — trim 금지, replace 만 허용
  const privateKey = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      '[seed] ERROR: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY 미설정.'
    );
    console.error('[seed] Firestore 초기화 불가 — 스크립트 종료.');
    exit(1);
  }

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  const adminApp = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const db = getFirestore(adminApp);
  db.settings({ ignoreUndefinedProperties: true });
  console.log('[seed] Firestore 초기화 OK (project:', projectId, ')');
  return db;
}

// ── 단일 블록 보강 (Geocoding + Transit) ────────────────────────────
async function enrichBlock(block, { ncpId, ncpSecret, odsayKey, stats }) {
  const today = new Date().toISOString().slice(0, 10);
  const hasNaver = !!(ncpId && ncpSecret);
  const hasOdsay = !!odsayKey;

  // 1. stops[].lat/lng 채우기
  const stops = [];
  for (const raw of block.stops || []) {
    const stop = { ...raw };
    if ((stop.lat === 0 || !stop.lat) && stop.address && hasNaver) {
      try {
        await sleep(200); // rate limit
        const geo = await geocodeNaver(stop.address, ncpId, ncpSecret);
        if (geo) {
          stop.lat = geo.lat;
          stop.lng = geo.lng;
          stats.geocodeSuccess++;
          console.log(
            `  [geo] OK: "${stop.name || stop.address}" → ${stop.lat},${stop.lng}`
          );
        } else {
          stats.geocodeFail++;
          console.warn(`  [geo] no-match: "${stop.name || stop.address}"`);
        }
      } catch (e) {
        stats.geocodeFail++;
        console.warn(`  [geo] error: "${stop.name || stop.address}" — ${e.message}`);
      }
    } else if (stop.lat && stop.lat !== 0) {
      stats.geocodeAlreadyOk++;
    }
    stops.push(stop);
  }

  // 2. transit_matrix 채우기
  const existingTM = block.transit_matrix || {};
  const transitMatrix = { ...existingTM };
  const needsTransit =
    !existingTM || Object.keys(existingTM).length === 0 ||
    Object.values(existingTM).every((v) => v.source === 'mock');

  if (needsTransit) {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      const key = `${a.order}->${b.order}`;
      // 이미 실측 데이터 있으면 스킵
      if (transitMatrix[key] && transitMatrix[key].source !== 'mock') continue;

      let entry = null;
      if (hasOdsay && hasNaver && a.lat && a.lat !== 0 && b.lat && b.lat !== 0) {
        try {
          await sleep(200); // rate limit
          const od = await searchOdsay(a.lng, a.lat, b.lng, b.lat, odsayKey);
          if (od) {
            const fromName = a.name || a.address;
            const toName = b.name || b.address;
            entry = {
              from_order: a.order,
              to_order: b.order,
              mode: pathTypeToMode(od.pathType),
              duration_min: od.totalTime,
              distance_m: od.distance,
              cost_krw: od.payment,
              naver_route_url: buildNaverRouteUrl(
                fromName, a.lat, a.lng, toName, b.lat, b.lng
              ),
              source: 'odsay_api',
              fetched_at: today,
            };
            entry.base = {
              mode: entry.mode,
              duration_min: entry.duration_min,
              distance_m: entry.distance_m,
              cost_krw: entry.cost_krw,
            };
            stats.transitReal++;
            console.log(
              `  [transit] OK: ${key} (${entry.mode}, ${entry.duration_min}분)`
            );
          }
        } catch (e) {
          console.warn(`  [transit] error: ${key} — ${e.message}`);
        }
      }

      if (!entry) {
        // mock fallback
        const dist =
          a.lat && a.lat !== 0 && b.lat && b.lat !== 0
            ? haversineMeters(a.lat, a.lng, b.lat, b.lng)
            : 1000;
        const fromName = a.name || a.address;
        const toName = b.name || b.address;
        entry = {
          from_order: a.order,
          to_order: b.order,
          mode: 'mixed',
          duration_min: 15,
          distance_m: Math.round(dist),
          cost_krw: 1500,
          source: 'mock',
          fetched_at: today,
          notes: 'ODsay/Naver ENV 부재 — 운영자 Phase 3 재빌드 필요',
        };
        entry.base = {
          mode: entry.mode,
          duration_min: entry.duration_min,
          distance_m: entry.distance_m,
          cost_krw: entry.cost_krw,
        };
        stats.transitMock++;
      }
      transitMatrix[key] = entry;
    }
  }

  return { stops, transitMatrix };
}

// ── Firestore upsert ─────────────────────────────────────────────────
async function upsertBlock(db, docId, payload, { dryRun, force }) {
  if (dryRun) {
    console.log(`  [dry-run] SKIP Firestore write: ${docId}`);
    return 'dry-run';
  }
  const ref = db.collection('zone_courses').doc(docId);
  const snap = await ref.get();
  if (snap.exists && snap.data()?.status === 'published' && !force) {
    console.log(`  [skip] 이미 published: ${docId}`);
    return 'skipped';
  }
  await ref.set(payload, { merge: true });
  return snap.exists ? 'updated' : 'created';
}

// ── 메인 ─────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(argv.slice(2));
  console.log('[seed] 옵션:', JSON.stringify(opts));

  // ENV
  // CLAUDE.md I: NCP_CLIENT_ID.trim() 필수
  const ncpId = (env.NCP_CLIENT_ID || '').trim();
  const ncpSecret = (env.NCP_CLIENT_SECRET || '').trim();
  const odsayKey = (env.ODSAY_API_KEY || '').trim();

  if (!ncpId) console.warn('[seed] WARN: NCP_CLIENT_ID 미설정 — lat/lng=0 유지');
  if (!odsayKey) console.warn('[seed] WARN: ODSAY_API_KEY 미설정 — transit mock 유지');

  // Firestore 초기화
  let db;
  if (!opts.dryRun) {
    db = await initFirestore();
  } else {
    console.log('[seed] dry-run 모드 — Firestore 미초기화');
  }

  // zone_courses 디렉토리 스캔
  const allFiles = (await readdir(ZONE_DIR)).filter(
    (f) => f.endsWith('.json') && statSync(join(ZONE_DIR, f)).isFile()
  );

  // 대상 도시 필터
  const targetFiles = allFiles.filter((f) => {
    const city = opts.cities.find((c) => f.startsWith(c + '_'));
    return !!city;
  });

  console.log(
    `[seed] 대상 도시: ${opts.cities.join(', ')} → ${targetFiles.length}개 파일`
  );

  const stats = {
    geocodeSuccess: 0,
    geocodeFail: 0,
    geocodeAlreadyOk: 0,
    transitReal: 0,
    transitMock: 0,
    seeded: 0,
    skipped: 0,
    updated: 0,
    errors: 0,
  };

  const today = new Date().toISOString().slice(0, 10);

  for (const file of targetFiles) {
    const filePath = join(ZONE_DIR, file);
    let block;
    try {
      block = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (e) {
      console.error(`[seed] JSON 파싱 실패: ${file} — ${e.message}`);
      stats.errors++;
      continue;
    }

    console.log(`\n[seed] 처리: ${file} (${block.id})`);

    // 보강 (geocoding + transit)
    let enriched;
    try {
      enriched = await enrichBlock(block, {
        ncpId,
        ncpSecret,
        odsayKey,
        stats,
      });
    } catch (e) {
      console.error(`[seed] enrichBlock 실패: ${file} — ${e.message}`);
      stats.errors++;
      continue;
    }

    // Firestore payload 조립
    // SAFETY-CRITICAL: dietary_options / unsuitable_for 원본 그대로
    const payload = {
      ...block,
      stops: enriched.stops,
      transit_matrix: enriched.transitMatrix,
      status: 'published',
      seeded_at: today,
      seeded_by: 'seed-zone-courses-firestore.mjs',
    };

    // Firestore upsert
    try {
      const result = await upsertBlock(db, block.id, payload, {
        dryRun: opts.dryRun,
        force: opts.force,
      });
      if (result === 'created') stats.seeded++;
      else if (result === 'updated') stats.updated++;
      else if (result === 'skipped') stats.skipped++;
      console.log(`  [firestore] ${result}: ${block.id}`);
    } catch (e) {
      console.error(`  [firestore] 실패: ${block.id} — ${e.message}`);
      stats.errors++;
    }
  }

  // 최종 통계
  console.log('\n=== 시드 결과 ===');
  console.log(`대상 파일: ${targetFiles.length}`);
  console.log(`Geocoding 성공: ${stats.geocodeSuccess} / 실패: ${stats.geocodeFail} / 이미OK: ${stats.geocodeAlreadyOk}`);
  console.log(`Transit 실측: ${stats.transitReal} / mock: ${stats.transitMock}`);
  console.log(`Firestore 신규: ${stats.seeded} / 업데이트: ${stats.updated} / 스킵: ${stats.skipped} / 오류: ${stats.errors}`);

  const latSuccessRate =
    stats.geocodeSuccess + stats.geocodeAlreadyOk > 0
      ? Math.round(
          ((stats.geocodeSuccess + stats.geocodeAlreadyOk) /
            (stats.geocodeSuccess + stats.geocodeFail + stats.geocodeAlreadyOk)) *
            100
        )
      : 0;
  console.log(`lat/lng 채워진 비율: ${latSuccessRate}%`);

  const transitRealRate =
    stats.transitReal + stats.transitMock > 0
      ? Math.round((stats.transitReal / (stats.transitReal + stats.transitMock)) * 100)
      : 0;
  console.log(`transit 실측 비율: ${transitRealRate}%`);

  if (stats.errors > 0) {
    console.error(`\n[seed] ${stats.errors}건 오류 발생 — 위 로그 확인 필요`);
    exit(1);
  }
  console.log('\n[seed] 완료.');
}

main().catch((e) => {
  console.error('[seed] FATAL:', e.message);
  console.error(e.stack);
  exit(1);
});
