// Probe SearchSTNTimeTableByIDService to figure out:
//   1. STATION_CD format (is it subwayCode + stationID?)
//   2. WEEK_TAG values (1/2/3)
//   3. INOUT_TAG values (1/2)
//   4. Response shape and how to extract first/last train
//
// Plan: try 강남역 2호선 (ODsay stationID=222) with STATION_CD='0222' first,
// then inspect response row[] for ARRIVETIME min/max.
import { readFileSync } from 'fs';

for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\n/g, '\n');
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

const key = (process.env.SUBWAY_REALTIME_KEY || '').trim();

async function query(STATION_CD, WEEK_TAG, INOUT_TAG, start = 1, end = 1000) {
  const url = `http://openapi.seoul.go.kr:8088/${key}/json/SearchSTNTimeTableByIDService/${start}/${end}/${STATION_CD}/${WEEK_TAG}/${INOUT_TAG}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}

// 1) 강남 2호선 평일 상행 — full list, derive first/last
console.log('=== 강남역 2호선 (STATION_CD=0222, WEEK=1 평일, INOUT=1 상행) ===');
// First page to check ordering + total
const data = await query('0222', 1, 1, 1, 10);
const rows = data?.SearchSTNTimeTableByIDService?.row || [];
const total = data?.SearchSTNTimeTableByIDService?.list_total_count || 0;
console.log('Total trains:', total, '| First 10 rows fetched:', rows.length);
console.log('First 3 ARRIVETIME (default order):', rows.slice(0, 3).map(r => r.ARRIVETIME).join(' / '));
// Fetch last page to find last train
if (total > 10) {
  const lastPage = await query('0222', 1, 1, Math.max(1, total - 9), total);
  const lastRows = lastPage?.SearchSTNTimeTableByIDService?.row || [];
  console.log('Last 3 ARRIVETIME:', lastRows.slice(-3).map(r => r.ARRIVETIME).join(' / '));
  // Explicit first/last by sorting entire fetched set
  const all = [...rows, ...lastRows].sort((a, b) => (a.ARRIVETIME || '').localeCompare(b.ARRIVETIME || ''));
  console.log('Earliest ARRIVETIME:', all[0]?.ARRIVETIME);
  console.log('Latest ARRIVETIME:', all[all.length - 1]?.ARRIVETIME);
  console.log('Sample last train:', JSON.stringify(all[all.length - 1], null, 2).slice(0, 400));
}

// 2) Test padding variations (잠실 2호선 = ODsay stationID=216)
console.log('\n=== 잠실역 2호선 — test STATION_CD formats ===');
for (const cd of ['216', '0216', '00216']) {
  const d = await query(cd, 1, 1, 1, 5);
  const total = d?.SearchSTNTimeTableByIDService?.list_total_count;
  const code = d?.SearchSTNTimeTableByIDService?.RESULT?.CODE || d?.RESULT?.CODE;
  console.log(`  STATION_CD='${cd}' → total=${total}, code=${code}`);
}

// 3) Test INOUT_TAG both directions on 강남 weekday
console.log('\n=== 강남 2호선 방향별 막차 (평일) ===');
for (const dir of [1, 2]) {
  const d = await query('0222', 1, dir, 1, 1000);
  const r = d?.SearchSTNTimeTableByIDService?.row || [];
  if (r.length) {
    const sorted = [...r].sort((a, b) => (a.ARRIVETIME || '').localeCompare(b.ARRIVETIME || ''));
    const last = sorted[sorted.length - 1];
    console.log(`  INOUT=${dir}: 막차 ${last.ARRIVETIME} 종점 ${last.DESTSTATION}`);
  }
}

// 4) Weekend behaviour
console.log('\n=== 강남 2호선 토/일 첫차·막차 ===');
for (const wk of [2, 3]) {
  const d = await query('0222', wk, 1, 1, 1000);
  const r = d?.SearchSTNTimeTableByIDService?.row || [];
  if (r.length) {
    const sorted = [...r].sort((a, b) => (a.ARRIVETIME || '').localeCompare(b.ARRIVETIME || ''));
    console.log(`  WEEK=${wk}: 첫 ${sorted[0].ARRIVETIME} / 막 ${sorted[sorted.length - 1].ARRIVETIME}`);
  } else {
    console.log(`  WEEK=${wk}: no data`);
  }
}

process.exit(0);
