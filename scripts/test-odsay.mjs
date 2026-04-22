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
console.log('API key length:', apiKey.length);
console.log('API key prefix:', apiKey.slice(0, 8) + '...');

// 서울시청(37.5665, 126.9780) → 강남역(37.4979, 127.0276) — 대중교통 100% 존재
const sx = 126.9780, sy = 37.5665, ex = 127.0276, ey = 37.4979;
const url = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}&output=json`;

async function probe(label, extraHeaders) {
  console.log(`\n→ ${label}`);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: extraHeaders,
    });
    const data = await res.json();
    if (data.error) {
      console.log('  ❌', JSON.stringify(data.error).slice(0, 200));
    } else if (!data.result?.path?.length) {
      console.log('  ⚠️  No routes');
    } else {
      const best = data.result.path[0];
      console.log('  ✅ OK —', data.result.path.length, 'paths, best:',
        { pathType: best.info.pathType, totalTime: best.info.totalTime, payment: best.info.payment });
    }
  } catch (e) {
    console.log('  ❌ Fetch failed:', e.message);
  }
}

await probe('No headers (baseline)', {});
await probe('Referer: https://cocotripkr.com', { Referer: 'https://cocotripkr.com' });
await probe('Referer: https://cocotripkr.com/', { Referer: 'https://cocotripkr.com/' });
await probe('Origin: https://cocotripkr.com', { Origin: 'https://cocotripkr.com' });
await probe('Referer: http://localhost:5173', { Referer: 'http://localhost:5173' });
process.exit(0);
