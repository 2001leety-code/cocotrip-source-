/** zone_courses 블록 지리 정합 감사 — 각 블록의 stops 동선 km 측정해 zigzag 블록 flag.
 *  사용: node scripts/audit-zone-courses-geo.mjs
 *  routeQuality.computeDayRouteMetrics 재사용. 결정적·prod 무관·비용 0.
 *  근거: 2026-06-10 block_mode 다도시 plan 의 Day2 26km zigzag = 블록 데이터가
 *  지리 아닌 테마(사찰/박물관)로 묶여 도시 횡단. 어느 블록이 그런지 전수 파악. */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { computeDayRouteMetrics, isExcessiveDayRoute } from '../api/_ai_core/routeQuality.js';

const DIR = 'src/data/zone_courses';
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.includes('/templates/'));

const rows = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  if (!Array.isArray(j.stops)) continue;
  // running 코스(5km/10km)는 의도적으로 거리 있는 코스라 제외.
  const isRunning = /running|olle/i.test(f) || /running/i.test(j.block_type || '');
  // 좌표 누락(lat/lng 0,0 placeholder)은 한국 밖(위도<30)이라 13000km false-positive →
  // 한국 좌표(위도 33-39)만 측정 대상으로. 도심 블록은 좌표 박힌 명소 stop 만 본다.
  const koreaStops = j.stops.filter((s) => s && typeof s.lat === 'number' && s.lat > 30 && s.lat < 40);
  const m = computeDayRouteMetrics(koreaStops);
  rows.push({
    file: f, id: j.id, zone: j.zone || '', coord: m.coordCount,
    pathKm: m.pathKm, spanKm: m.spanKm, ratio: m.pathPerSpan,
    longest: m.longestLeg ? `${m.longestLeg.from}→${m.longestLeg.to} ${m.longestLeg.km}km` : '',
    flag: !isRunning && isExcessiveDayRoute(m, { maxPathKm: 14, maxRatio: 3.0 }),
    isRunning,
  });
}

rows.sort((a, b) => b.pathKm - a.pathKm);
const flagged = rows.filter((r) => r.flag);
console.log(`\n총 ${rows.length}개 블록 | 🔴 zigzag flag ${flagged.length}개 (running 제외, path>14km 또는 ratio>3.0)\n`);
console.log('=== 🔴 FLAGGED (지리 횡단 의심) ===');
for (const r of flagged) {
  console.log(`  ${r.pathKm}km (span ${r.spanKm}, ratio ${r.ratio}) | ${r.id}`);
  console.log(`      zone="${r.zone}" | 최장구간: ${r.longest}`);
}
console.log('\n=== 상위 10 (참고, flag 무관) ===');
for (const r of rows.slice(0, 10)) {
  console.log(`  ${r.flag ? '🔴' : '  '} ${r.pathKm}km ${r.isRunning ? '(run)' : ''} | ${r.id} | ${r.zone}`);
}
