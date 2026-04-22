// Identify what SUBWAY_REALTIME_KEY and BUS_REALTIME_KEY actually unlock.
// Hypothesis:
//  - SUBWAY_REALTIME_KEY (30 chars) = Seoul Open Data Plaza (swopenapi.seoul.go.kr)
//  - BUS_REALTIME_KEY (64 chars) = data.go.kr general auth key
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

const subwayKey = (process.env.SUBWAY_REALTIME_KEY || '').trim();
const busKey = (process.env.BUS_REALTIME_KEY || '').trim();

async function probe(label, url) {
  console.log(`\n→ ${label}`);
  console.log(`  ${url.replace(/KEY=[^&]+/, 'KEY=...')}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    console.log(`  HTTP ${res.status} — ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`  ❌ ${e.message}`); }
}

// Subway: Seoul Open Data "realtimeStationArrival" — realtime arrival info
await probe(
  'SUBWAY_REALTIME_KEY @ Seoul OpenAPI realtimeStationArrival (강남)',
  `http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(subwayKey)}/json/realtimeStationArrival/0/5/%EA%B0%95%EB%82%A8`
);

// Subway: Seoul Open Data timetable (SearchSTNTimeTableByIDService) — first/last train
await probe(
  'SUBWAY_REALTIME_KEY @ Seoul OpenAPI SearchSTNTimeTableByIDService (0222 line2 강남)',
  `http://openapi.seoul.go.kr:8088/${encodeURIComponent(subwayKey)}/json/SearchSTNTimeTableByIDService/1/5/0222/1/1/1`
);

// Bus: data.go.kr 실시간 버스도착정보
await probe(
  'BUS_REALTIME_KEY @ data.go.kr getArrInfoByRouteAll',
  `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${encodeURIComponent(busKey)}&busRouteId=100100002`
);

process.exit(0);
