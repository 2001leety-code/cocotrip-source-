// Probe ODsay subwayStationInfo — we want first/last train times.
// Uses 강남역 stationID which we know from prior dump: 222 (line 2).
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
const url = `https://api.odsay.com/v1/api/subwayStationInfo?stationID=222&apiKey=${encodeURIComponent(apiKey)}&output=json`;

const res = await fetch(url, { headers: { Referer: 'https://cocotripkr.com' } });
const data = await res.json();

console.log('=== Top-level ===');
console.log(JSON.stringify(Object.keys(data.result || data), null, 2));
console.log('\n=== Full response (first 3000 chars) ===');
console.log(JSON.stringify(data, null, 2).slice(0, 3000));
process.exit(0);
