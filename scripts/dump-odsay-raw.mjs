// Dump raw ODsay response to see every field we might not be using.
// Goal: find subway exit numbers, transfer stations, exact stop names, etc.
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

const apiKey = (process.env.ODSAY_API_KEY || '').trim();
// 강남역 → 잠실역 (2호선 직통, 지하철 최적)
const sx = 127.0276, sy = 37.4979, ex = 127.1000, ey = 37.5133;
const url = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}&output=json`;

const res = await fetch(url, { headers: { Referer: 'https://cocotripkr.com' } });
const data = await res.json();

console.log('=== Top-level keys ===');
console.log(Object.keys(data.result || {}));
console.log('\n=== path[0] keys ===');
console.log(Object.keys(data.result.path[0]));
console.log('\n=== path[0].info ===');
console.log(JSON.stringify(data.result.path[0].info, null, 2));
console.log('\n=== path[0].subPath[] structure ===');
for (const sub of data.result.path[0].subPath) {
  console.log('\n--- subPath (trafficType:', sub.trafficType, ') keys:', Object.keys(sub).join(', '));
  // Dump everything except huge fields
  const clean = { ...sub };
  if (clean.passStopList) clean.passStopList = `[${(clean.passStopList.stations || []).length} stations]`;
  console.log(JSON.stringify(clean, null, 2));
}
// Show first passStopList in detail
const firstTransit = data.result.path[0].subPath.find(s => s.trafficType !== 3);
if (firstTransit?.passStopList?.stations) {
  console.log('\n=== Sample passStopList stations (first 3) ===');
  console.log(JSON.stringify(firstTransit.passStopList.stations.slice(0, 3), null, 2));
}
process.exit(0);
