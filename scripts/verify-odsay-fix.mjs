// End-to-end verify: imports the actual production _odsay_helper.js module
// and calls searchTransitRoute/formatTransitSummary to confirm real subway/bus
// data flows back — no more ApiKeyAuthFailed.
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

const { searchTransitRoute, formatTransitSummary, getSubwayStationInfo } = await import('../api/_odsay_helper.js');

// Gangnam → Jamsil (pure subway line 2)
const result = await searchTransitRoute(127.0276, 37.4979, 127.1000, 37.5133);
if (!result) {
  console.log('❌ searchTransitRoute returned null — fix did not work');
  process.exit(1);
}

const summary = formatTransitSummary(result);
console.log('✅ searchTransitRoute returned:', {
  type: result.type,
  totalTime: result.totalTime,
  fare: result.fare,
  transfers: result.transfers,
  stepCount: result.steps.length,
});
console.log('\nformatTransitSummary output:');
console.log({ method: summary.method, duration: summary.duration, fare: summary.fare });
console.log('summary text:', summary.summary);
console.log('\nSteps (with new rich fields):');
for (const s of result.steps) {
  console.log('  mode:', s.mode);
  if (s.mode === 'subway') {
    console.log('    line:', s.line, '→ KO:', s.lineKo, '/ EN:', s.lineEn);
    console.log('    from:', s.from, `(${s.fromRoman || 'no roman'})`, 'exit', s.fromExit, '| to:', s.to, `(${s.toRoman || 'no roman'})`, 'exit', s.toExit);
    console.log('    way:', s.way, `(${s.wayRoman || 'no roman'})`, '| stations:', s.stationCount, '| interval:', s.intervalMin, 'min');
    console.log('    passStops:', s.passStops?.slice(0, 4));
  }
  if (s.mode === 'bus') console.log('    bus:', s.busNo, s.busType, '| from:', s.from, `(ARS ${s.fromArs})`, '| to:', s.to, `(ARS ${s.toArs})`, '| interval:', s.intervalMin);
  if (s.mode === 'walk') console.log('    walk:', s.distance, 'm,', s.duration, 'min');
}
console.log('\nTotal walk:', result.totalWalk, 'm | firstStation:', result.firstStation, '| lastStation:', result.lastStation);

// Also exercise getSubwayStationInfo with cache
const cache = {};
const info1 = await getSubwayStationInfo(222, cache);  // 강남역 2호선
const info2 = await getSubwayStationInfo(222, cache);  // cached hit
console.log('\nsubwayStationInfo for 강남 (stationID=222):');
console.log(JSON.stringify(info1, null, 2));
console.log('Cache hit returned same object:', info1 === info2);
process.exit(0);
