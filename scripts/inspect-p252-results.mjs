import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g, '')]; }));
const apiKey = env.VITE_FIREBASE_API_KEY;
const pw = env.HEALTH_CHECK_PASSWORD;
const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '2001leety@gmail.com', password: pw, returnSecureToken: true }) });
const auth = await authRes.json();
const token = auth.idToken;

const plans = [
  { id: '0e20dbb7-b9c4-46d0-8f98-48214bcabcb2', label: 'P245-arrival14' },
  { id: '9d28e88b-668b-4c52-b66c-1891611c1b7a', label: 'P246-DMZ-seoul' },
  { id: '0d6f0cf1-2679-49d7-8e8e-739c8c5406bf', label: 'P248-Haenyeo-seoul' },
  { id: 'eed93095-9fa5-4356-a8b8-5f82d16c3f76', label: 'P251-cache' },
];

function valOf(f) {
  if (!f) return null;
  if ('nullValue' in f) return null; // P254 fix: { nullValue: null } → null (이전: [object Object])
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.arrayValue) return (f.arrayValue.values || []).map(v => valOf(v));
  if (f.mapValue) {
    const out = {};
    for (const [k, v] of Object.entries(f.mapValue.fields || {})) out[k] = valOf(v);
    return out;
  }
  return f;
}

for (const p of plans) {
  console.log(`\n=== ${p.label} (${p.id.slice(0,8)}) ===`);
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/planning-with-ai-a0801/databases/(default)/documents/plans/${p.id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) { console.log(`HTTP ${r.status}`); continue; }
  const d = await r.json();
  const f = d.fields || {};
  const itin = valOf(f.itinerary);
  const tour_title = itin?.tour_title;
  const days = itin?.days || [];
  const status = valOf(f.status);
  const tourStartTime = valOf(f.input)?.tour_start_time;
  const arrivalTime = valOf(f.input)?.arrival_time;
  const styles = valOf(f.input)?.styles;
  const area = valOf(f.input)?.area;
  const blocksUsed = valOf(f.blocksUsed);
  const inngestStatus = valOf(f._inngest_status);
  const minimalFallback = valOf(f.__repair_minimal_fallback);

  console.log(`status: ${status} / inngest: ${inngestStatus} / minimal_fallback: ${minimalFallback}`);
  console.log(`input: area=${area} arrival=${arrivalTime} tour_start=${tourStartTime} styles=${JSON.stringify(styles)}`);
  console.log(`tour_title: ${tour_title?.slice(0,60)}`);
  console.log(`days: ${days.length}, blocksUsed: ${blocksUsed?.length || 0}`);

  // Day1 stops 분석
  const day1 = days[0];
  if (day1) {
    const day1Stops = day1.stops || [];
    console.log(`Day1.city: ${day1.city || '-'} / stops: ${day1Stops.length}`);
    day1Stops.slice(0, 4).forEach((s, i) => {
      const name = s.name || s.display_name;
      const start = s.start_time;
      console.log(`  Day1[${i}]: ${start} | ${name?.slice(0, 35)}`);
    });
  }

  // P246/P248 city-mismatch check (Day1 only)
  if (p.label.includes('DMZ') || p.label.includes('Haenyeo')) {
    const allStops = days.flatMap(d => d?.stops || []);
    const jejuKeywords = ['제주', 'jeju', '한림', '성산', '서귀포', '협재', '곽지', '애월'];
    const gyeonggiKeywords = ['파주', 'paju', '임진', 'dmz', '도라', '오두', '연천'];
    const jejuStops = allStops.filter(s => jejuKeywords.some(k => (s.name || '').toLowerCase().includes(k.toLowerCase()) || (s.address || '').toLowerCase().includes(k.toLowerCase())));
    const gyeonggiStops = allStops.filter(s => gyeonggiKeywords.some(k => (s.name || '').toLowerCase().includes(k.toLowerCase()) || (s.address || '').toLowerCase().includes(k.toLowerCase())));
    console.log(`city-check: jeju stops=${jejuStops.length} / gyeonggi/DMZ stops=${gyeonggiStops.length}`);
    if (p.label.includes('DMZ') && jejuStops.length > 0) console.log(`  🚨 P246 회귀: DMZ plan 에 jeju stops 발견 (${jejuStops.length})`);
    if (p.label.includes('Haenyeo') && jejuStops.length === 0) console.log(`  ⚠️ P248 검증: Haenyeo plan 에 jeju stops 0 (옵션 무시 또는 alert 작동 확인 필요)`);
  }
}

console.log('\n\n=== P251 cache 효과 (transit-cache-stats.mjs 재실행 필요) ===');
console.log('node --env-file=.env.local scripts/transit-cache-stats.mjs');
