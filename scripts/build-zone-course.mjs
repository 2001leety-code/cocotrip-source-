#!/usr/bin/env node
/**
 * build-zone-course.mjs — zone_courses block builder
 *
 * Input: template JSON (stops minimal — name/category/address/stay_min/...)
 * Output: ZoneCourseBlock JSON with:
 *   - lat/lng (via Naver Geocoding NCP API)
 *   - transit_matrix (via ODsay searchPubTransPathT)
 *   - start_time_offset_min (cumulative)
 *   - duration_min (total)
 *   - verified_at / source = 'cocotrip_curated'
 *
 * Usage:
 *   node scripts/build-zone-course.mjs \
 *     --input src/data/zone_courses/templates/seoul_jongno.json \
 *     --output src/data/zone_courses/seoul_jongno_standard.json
 *
 *   cat template.json | node scripts/build-zone-course.mjs > output.json
 *
 * ENV (optional — 부재 시 mock fallback + notes 명시):
 *   NCP_CLIENT_ID, NCP_CLIENT_SECRET — Naver Geocoding
 *   ODSAY_API_KEY                    — ODsay Transit
 *
 * 운영자 액션: ENV 부재 빌드 후 prod 환경에서 재실행 권장.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, stdin, stdout, exit, env } from 'node:process';
// NCP Maps 키 해석 SSOT — 키 목록 복제 금지 (api/_shared/mood-route.js:45~ 주석).
import { resolveNcpKeys } from '../api/_shared/mood-route.js';

const NAVER_GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
const ODSAY_BASE = 'https://api.odsay.com/v1/api';

// ── CLI argument parsing ─────────────────────────────────────────
function parseArgs(args) {
  const out = { input: null, output: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input' || a === '-i') out.input = args[++i];
    else if (a === '--output' || a === '-o') out.output = args[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/build-zone-course.mjs --input <template.json> [--output <out.json>]'
      );
      exit(0);
    }
  }
  return out;
}

async function readJsonInput(path) {
  if (path) {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  }
  // stdin
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

// ── Naver Geocoding ──────────────────────────────────────────────
async function geocodeNaver(query, clientId, clientSecret) {
  const url = new URL(NAVER_GEOCODE_URL);
  url.searchParams.set('query', query);
  const res = await fetch(url.toString(), {
    headers: {
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Naver Geocode HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data?.addresses?.length) return null;
  const a = data.addresses[0];
  return {
    lat: parseFloat(a.y),
    lng: parseFloat(a.x),
    matched_address: a.roadAddress || a.jibunAddress || query,
  };
}

// ── ODsay Transit ────────────────────────────────────────────────
async function searchOdsay(sx, sy, ex, ey, apiKey) {
  const url = `${ODSAY_BASE}/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}&output=json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Referer: 'https://cocotripkr.com' },
  });
  if (!res.ok) {
    throw new Error(`ODsay HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error || !data.result?.path?.length) {
    return null;
  }
  const best = data.result.path[0];
  const info = best.info;
  return {
    pathType: info.pathType, // 1=subway 2=bus 3=mixed
    totalTime: info.totalTime,
    payment: info.payment,
    distance: info.totalDistance,
  };
}

// ── Haversine fallback (mock 거리) ───────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ── pathType → mode ─────────────────────────────────────────────
function pathTypeToMode(pathType) {
  if (pathType === 1) return 'subway';
  if (pathType === 2) return 'bus';
  return 'mixed';
}

// ── Build naver route deep link ─────────────────────────────────
function buildNaverRouteUrl(fromName, fromLat, fromLng, toName, toLat, toLng) {
  // map.naver.com/p/directions/<fromLng>,<fromLat>,<fromName>/<toLng>,<toLat>,<toName>/-/transit
  const encFrom = encodeURIComponent(fromName);
  const encTo = encodeURIComponent(toName);
  return `https://map.naver.com/p/directions/${fromLng},${fromLat},${encFrom},,/${toLng},${toLat},${encTo},,/-/transit`;
}

// ── Main build flow ─────────────────────────────────────────────
async function buildBlock(template) {
  const today = new Date().toISOString().slice(0, 10);
  // 키 해석 = resolveNcpKeys (SSOT). NCP_CLIENT_* 만 읽으면 살아있는 NCP Maps 키가
  //   VITE_NAVER_CLIENT_* 에 있는 환경에서 조용히 lat/lng=0 placeholder 로 떨어진다 (2026-07-27).
  const { clientId: NCP_ID, clientSecret: NCP_SECRET } = resolveNcpKeys();
  const ODSAY_KEY = (env.ODSAY_API_KEY || '').trim();
  const hasNaver = NCP_ID && NCP_SECRET;
  const hasOdsay = !!ODSAY_KEY;

  const warnings = [];
  if (!hasNaver) {
    warnings.push(
      'NCP Maps key not set (NCP_CLIENT_* / VITE_NAVER_CLIENT_* / NAVER_CLIENT_* all empty) — lat/lng will be 0 placeholders. Re-run in prod env.'
    );
    console.warn(`[build-zone-course] WARN: ${warnings[warnings.length - 1]}`);
  }
  if (!hasOdsay) {
    warnings.push(
      'ODSAY_API_KEY not set — transit_matrix entries will use mock data. Re-run in prod env.'
    );
    console.warn(`[build-zone-course] WARN: ${warnings[warnings.length - 1]}`);
  }

  // 1. Geocode each stop
  const stops = [];
  for (const raw of template.stops) {
    const stop = { ...raw };
    if (hasNaver && stop.address) {
      try {
        const geo = await geocodeNaver(stop.address, NCP_ID, NCP_SECRET);
        if (geo) {
          stop.lat = geo.lat;
          stop.lng = geo.lng;
        } else {
          stop.lat = 0;
          stop.lng = 0;
          warnings.push(`Geocode no-match for stop ${stop.order} "${stop.name || stop.address}"`);
        }
      } catch (err) {
        stop.lat = 0;
        stop.lng = 0;
        warnings.push(
          `Geocode failed for stop ${stop.order} "${stop.name || stop.address}": ${err.message}`
        );
        console.warn(`[build-zone-course] geocode error: ${err.message}`);
      }
    } else {
      // Mock: lat/lng 0 placeholders. Prod 재빌드 시 채워짐.
      stop.lat = typeof stop.lat === 'number' ? stop.lat : 0;
      stop.lng = typeof stop.lng === 'number' ? stop.lng : 0;
    }
    stops.push(stop);
  }

  // 1.5. Geocode waypoints (2026-05-21 PR-A — trek/run 보조 지점).
  const waypoints = [];
  if (Array.isArray(template.waypoints)) {
    for (const raw of template.waypoints) {
      const wp = { ...raw };
      if (hasNaver && wp.address) {
        try {
          const geo = await geocodeNaver(wp.address, NCP_ID, NCP_SECRET);
          if (geo) {
            wp.lat = geo.lat;
            wp.lng = geo.lng;
          } else {
            wp.lat = 0;
            wp.lng = 0;
            warnings.push(`Waypoint geocode no-match for "${wp.name || wp.address}"`);
          }
        } catch (err) {
          wp.lat = 0;
          wp.lng = 0;
          warnings.push(
            `Waypoint geocode failed for "${wp.name || wp.address}": ${err.message}`
          );
        }
      } else {
        wp.lat = typeof wp.lat === 'number' ? wp.lat : 0;
        wp.lng = typeof wp.lng === 'number' ? wp.lng : 0;
      }
      waypoints.push(wp);
    }
  }

  // 2. Build transit matrix (1->2, 2->3, ...)
  const transitMatrix = {};
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const key = `${a.order}->${b.order}`;
    const fromName = a.name || a.address;
    const toName = b.name || b.address;

    let entry = null;
    if (hasOdsay && hasNaver && a.lat && a.lng && b.lat && b.lng) {
      try {
        const od = await searchOdsay(a.lng, a.lat, b.lng, b.lat, ODSAY_KEY);
        if (od) {
          entry = {
            from_order: a.order,
            to_order: b.order,
            mode: pathTypeToMode(od.pathType),
            duration_min: od.totalTime,
            distance_m: od.distance,
            cost_krw: od.payment,
            naver_route_url: buildNaverRouteUrl(fromName, a.lat, a.lng, toName, b.lat, b.lng),
            source: 'odsay_api',
            fetched_at: today,
          };
        }
      } catch (err) {
        warnings.push(
          `ODsay failed for ${key} (${fromName} → ${toName}): ${err.message}`
        );
        console.warn(`[build-zone-course] odsay error: ${err.message}`);
      }
    }

    if (!entry) {
      // Mock fallback — haversine 거리 기반 15분 default
      const dist = a.lat && b.lat ? haversineMeters(a.lat, a.lng, b.lat, b.lng) : 1000;
      entry = {
        from_order: a.order,
        to_order: b.order,
        mode: 'mixed',
        duration_min: 15,
        distance_m: Math.round(dist),
        cost_krw: 1500,
        source: 'mock',
        fetched_at: today,
        notes: 'API call skipped, manual verification needed',
      };
    }
    // 2026-05-21 schema 확장 (PR-A): base variant 동기화. mode/duration_min/
    // distance_m/cost_krw 는 backward compat 거울. base 는 명시적 표준 variant.
    // peak_hour/late_night/rain 은 운영자가 후속 입력 (운영자 admin UI 에서).
    if (!entry.base) {
      entry.base = {
        mode: entry.mode,
        duration_min: entry.duration_min,
        distance_m: entry.distance_m,
        cost_krw: entry.cost_krw,
      };
    }
    transitMatrix[key] = entry;
  }

  // 3. start_time_offset_min cumulative
  let cumulative = 0;
  for (let i = 0; i < stops.length; i++) {
    stops[i].start_time_offset_min = cumulative;
    cumulative += stops[i].stay_min || 0;
    const nextKey = `${stops[i].order}->${stops[i + 1]?.order}`;
    if (transitMatrix[nextKey]) cumulative += transitMatrix[nextKey].duration_min;
  }
  const totalDuration = cumulative;

  // 4. Compose block
  const block = {
    id: template.id,
    city: template.city,
    zone: template.zone,
    theme: template.theme,
    theme_i18n: template.theme_i18n,
    intensity: template.intensity,
    duration_min: totalDuration,
    stops,
    transit_matrix: transitMatrix,
    best_for: template.best_for || [],
    unsuitable_for: template.unsuitable_for || [],
    dietary_options: template.dietary_options || [],
    passport_required: template.passport_required ?? false,
    requires_advance_booking: template.requires_advance_booking ?? false,
    source: template.source || 'cocotrip_curated',
    verified_at: today,
    verified_by: template.verified_by || '',
    last_review_date: today,
  };

  // 2026-05-21 PR-A schema 확장 — block_type / trekking_meta / running_meta / waypoints.
  // 누락 시 'city_day' default (backward compat). trek/run 은 meta 필수 (consistency check).
  block.block_type = template.block_type || 'city_day';
  if (template.trekking_meta) block.trekking_meta = template.trekking_meta;
  if (template.running_meta) block.running_meta = template.running_meta;
  if (waypoints.length > 0) block.waypoints = waypoints;

  // 일관성 가드 — block_type/meta mismatch 경고 누적.
  if (block.block_type === 'trekking' && !block.trekking_meta) {
    warnings.push("block_type='trekking' 이지만 trekking_meta 누락");
  }
  if (block.block_type === 'running_route' && !block.running_meta) {
    warnings.push("block_type='running_route' 이지만 running_meta 누락");
  }
  if (block.block_type === 'city_day' && (block.trekking_meta || block.running_meta)) {
    warnings.push("block_type='city_day' 이지만 trekking/running meta 가 있음 — 정리 필요");
  }

  if (template.notes || warnings.length > 0) {
    const merged = [template.notes, ...warnings].filter(Boolean).join(' | ');
    block.notes = merged;
  }

  return block;
}

// ── Entry ───────────────────────────────────────────────────────
async function main() {
  const { input, output } = parseArgs(argv.slice(2));
  const template = await readJsonInput(input);
  const block = await buildBlock(template);
  const json = JSON.stringify(block, null, 2) + '\n';
  if (output) {
    await writeFile(output, json, 'utf8');
    console.warn(`[build-zone-course] Wrote ${output}`);
  } else {
    stdout.write(json);
  }
}

main().catch((err) => {
  console.error(`[build-zone-course] FATAL: ${err.message}`);
  console.error(err.stack);
  exit(1);
});
