/**
 * Event payload 의 전체 ctx 검사 (특히 P266 cacheMetadata)
 */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local']) {
  try {
    const t = readFileSync(file, 'utf8');
    for (const m of t.matchAll(/^([A-Z0-9_]+)\s*=\s*(.*)$/gm)) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1).replace(/\\n/g,'\n');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}
const KEY = process.env.INNGEST_API_KEY.trim();
const eventId = process.argv[2];
if (!eventId) { console.error('usage: node script.mjs <eventId>'); process.exit(1); }

// /v1/events 가 list — single event ID 로 직접 fetch
const res = await fetch(`https://api.inngest.com/v1/events?limit=200`, { headers: { Authorization: `Bearer ${KEY}` }});
const data = await res.json();
const event = (data.data || []).find(e => e.id === eventId);
if (!event) { console.error(`event ${eventId} not in last 200`); process.exit(1); }

console.log('=== Event payload ctx ===');
const ctx = event.data?.ctx || {};
console.log('ctx keys:', Object.keys(ctx).sort().join(', '));
console.log('');
console.log('cacheMetadata in ctx?', 'cacheMetadata' in ctx);
if ('cacheMetadata' in ctx) {
  console.log('  value:', JSON.stringify(ctx.cacheMetadata));
}
console.log('');
console.log('itinerary._cache_metadata?', JSON.stringify(event.data?.itinerary?._cache_metadata));
console.log('');
console.log('plannerMode:', ctx.plannerMode);
console.log('abReason:', ctx.abReason);
console.log('blocksUsed:', JSON.stringify(ctx.blocksUsed));
console.log('streamingPlanId:', ctx.streamingPlanId);
console.log('');
console.log('itinerary.days.length:', event.data?.itinerary?.days?.length);
console.log('itinerary keys:', Object.keys(event.data?.itinerary || {}).sort().join(', '));
