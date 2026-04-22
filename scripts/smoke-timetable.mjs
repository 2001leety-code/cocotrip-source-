import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1).replace(/\\n/g, '\n');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
const { getSubwayTimetable } = await import('../api/_odsay_helper.js');
const cache = {};
// 강남 2호선 (stationID=222), 평일(dayOfWeek=3 for Wed)
const tt = await getSubwayTimetable(222, 3, cache);
console.log('강남 2호선 평일:', JSON.stringify(tt, null, 2));
const tt2 = await getSubwayTimetable(222, 3, cache);
console.log('Cache hit:', tt === tt2);
const tt3 = await getSubwayTimetable(222, 6, cache);  // 토
console.log('\n강남 2호선 토:', JSON.stringify(tt3, null, 2));
process.exit(0);
