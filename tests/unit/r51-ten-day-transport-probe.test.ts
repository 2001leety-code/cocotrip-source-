import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('offline'); }), post: vi.fn(async () => { throw new Error('offline'); }) } }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no paid LLM'); }, resolveLlmModel: () => 'mock' }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { planToMarkdown } from '../../src/pages/PlanDetailPage/lib/planToMarkdown';
type AnyRec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const cities = ['seoul','seoul','seoul','seoul','busan','busan','busan','gyeongju','gyeongju','gyeongju'];
const coords: Record<string, number[]> = { seoul:[37.5665,126.978],busan:[35.16,129.16],gyeongju:[35.856,129.224] };
const minute = (s: string) => Number(s.slice(0,2))*60+Number(s.slice(3,5));
function fixture() { return { language:'en',area:'seoul',regions:['seoul','busan','gyeongju'],arrival_airport:'ALREADY',arrival_time:'09:00',tour_start_time:'09:00',tour_end_time:'21:00',durationDays:10,itinerary:{ days:cities.map((city,i)=>({day:i+1,date:`2026-12-${String(i+1).padStart(2,'0')}`,city,lodging_city:city,stops:[['lodging','Hotel','09:00',0],['food','Lunch','12:00',60],['culture','Museum','14:00',60],['food','Dinner','18:00',60],['lodging','Hotel','20:00',0]].map(([category,name,start_time,stay_min],j)=>({order:j+1,category,name:`${city} ${name}`,display_name:`${city} ${name}`,start_time,stay_min,lat:coords[city][0]+j*.001,lng:coords[city][1]+j*.001}))}))} }; }
afterEach(()=>vi.restoreAllMocks());
describe('offline ten-day three-city transport probe (no live timetable evidence)',()=>{
 it.each([true,false])('provider route available=%s',async(available)=>{
  vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'));
  for(const key of ['log','info','warn','error'] as const) vi.spyOn(console,key).mockImplementation(()=>{});
  const local = vi.spyOn(RouteAgent.prototype as AnyRec,'_getTransitData').mockImplementation(async()=>({durationMin:20,verifiedRouteDurationMin:20,verifiedRouteSegment:{method:'bus'},distanceKm:2,drivingMin:15,publicTransit:available?{method:'bus',duration:20,fare:1500,summary:'MOCK local connection',steps:[]}:null}));
  vi.spyOn(RouteAgent.prototype as AnyRec,'_routeAirportHotel').mockResolvedValue(null);
  const input:AnyRec=fixture(); if(available){ input.itinerary.days[4].intercity_transit={mode:'KTX',from_city:'Seoul',to_city:'Busan',est_min:165,recommended_depart:'09:00',arrival_at:'11:45',depart_estimated:false}; input.itinerary.days[7].intercity_transit={mode:'Bus',from_city:'Busan',to_city:'Gyeongju',est_min:60,recommended_depart:'09:00',arrival_at:'10:00'}; } const result=await new RouteAgent('mock').call(JSON.stringify(input)); const out=JSON.parse(result.rawOutput);
  writeFileSync(`E:/ai에이젼시만들기/handoff-local/r53-ten-day-${available?'available':'unavailable'}.json`,JSON.stringify(out,null,2));
  expect(out.itinerary.days).toHaveLength(10); expect(out.itinerary.days.map((d:AnyRec)=>d.city)).toEqual(cities);
  expect(out.itinerary.days.filter((d:AnyRec)=>d.intercity_transit)).toHaveLength(2);
  for(const index of [4,7]){ const day=out.itinerary.days[index], t=day.intercity_transit;
   expect(t.from_city.toLowerCase()).toBe(cities[index-1]); expect(t.to_city.toLowerCase()).toBe(cities[index]);
   expect(t.depart_estimated).toBe(true); expect(t.mode).toBeTruthy(); expect(t.from_station).toBeTruthy(); expect(t.to_station).toBeTruthy();
   expect(t.lodging_to_station).toBeTruthy(); expect(t.station_to_lodging).toBeTruthy();
   expect(minute(t.arrival_at)-minute(t.recommended_depart)).toBe(t.est_min);
   expect(day.stops.map((s:AnyRec)=>s.name)).toEqual(input.itinerary.days[index].stops.map(s=>s.name));
   const firstActivity=day.stops.find((s:AnyRec)=>s.category!=='lodging');
   expect(minute(firstActivity.start_time)).toBeGreaterThanOrEqual(minute(t.arrival_at)+t.station_to_lodging.est_min);
  }
  const md=planToMarkdown({itinerary:out.itinerary,input:{language:'en'}} as never,{language:'en'});
  expect(md).toContain('KTX'); expect(md.toLowerCase()).toContain('busan'); expect(md.toLowerCase()).toContain('gyeongju');
  expect(local).toHaveBeenCalled();
 });
});

it('missing station coordinates do not fabricate lodging-to-station links', async()=>{
 vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'));
 for(const key of ['log','info','warn','error'] as const) vi.spyOn(console,key).mockImplementation(()=>{});
 vi.spyOn(RouteAgent.prototype as AnyRec,'_getTransitData').mockResolvedValue({durationMin:20,distanceKm:2,publicTransit:null,drivingMin:15});
 vi.spyOn(RouteAgent.prototype as AnyRec,'_routeAirportHotel').mockResolvedValue(null);
 const input:AnyRec=fixture(); input.itinerary.days[4].intercity_transit={mode:'KTX',from_city:'Seoul',to_city:'Busan',from_station:'UNREGISTERED_SOURCE_STATION',to_station:'UNREGISTERED_TARGET_STATION',est_min:165,recommended_depart:'09:00',arrival_at:'11:45',depart_estimated:true};
 const out=JSON.parse((await new RouteAgent('mock').call(JSON.stringify(input))).rawOutput);
 writeFileSync('E:/ai에이젼시만들기/handoff-local/r53-ten-day-missing-stations.json',JSON.stringify(out,null,2));
 expect(out.itinerary.days).toHaveLength(10);
 expect(out.itinerary.days[4].intercity_transit.lodging_to_station).toBeUndefined();
 expect(out.itinerary.days[4].intercity_transit.station_to_lodging).toBeUndefined();
 expect(out.itinerary.days[4].intercity_transit.depart_estimated).toBe(true);
});
