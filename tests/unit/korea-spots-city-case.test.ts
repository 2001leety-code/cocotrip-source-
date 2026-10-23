/**
 * 2026-10-10 — api/_korea_spots.json has groups whose city key is "Seoul"/"Busan" (capitalised). Every reader in
 * api/_spots_helper.js filters with `s.city === 'seoul'`, so those 20 places were silently unreachable. The helper now
 * lower-cases city at load; this pins both the data shape and the reader behaviour. Offline, real JSON.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSpotContext, getExactCitySpotCandidates, getExactCitySpotsContext, groupToUiCityKey } from '../../api/_spots_helper.js';
import { buildMockPlan } from '../../api/_shared/llm/mock.js';

type Group = { city: string; district: string; dongEn: string; places?: { name?: string; nameEn?: string }[] };
const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_korea_spots.json'), 'utf8')) as Group[];

describe('korea_spots city key casing', () => {
  it('the shipped file still has mixed-case city keys (documented data debt) …', () => {
    const mixed = raw.filter((s) => s.city !== s.city.toLowerCase());
    expect(mixed.length).toBeGreaterThan(0);
  });

  it('… but every mixed-case group is reachable through the city filter after load-time normalisation', () => {
    const mixed = raw.filter((s) => s.city !== s.city.toLowerCase());
    for (const group of mixed) {
      const ctx = getSpotContext(group.city.toLowerCase(), 500);
      expect(ctx, `${group.city}/${group.dongEn} missing from "${group.city.toLowerCase()}" context`).toContain(group.dongEn);
    }
  });
});

/**
 * 2026-10-24 — 엄격 도시 조회(getExactCitySpotCandidates)가 district 만 봐서 {city:"seoul", district:"Mapo-gu"}·
 * {city:"busan", district:"Haeundae-gu"} 그룹이 전부 0건이었다(구 이름은 도시 별칭이 아니다). 이제 city 가 UI 도시면
 * 그것을, "gyeonggi" 등이면 district 를 본다 — 경기 묶음(수원·인천·파주·가평…)을 뭉개지 않는 의도는 그대로.
 */
const keysOfGroups = (groups: Group[], cityKey: string) => new Set(groups.flatMap((g) => (g.places || [])
  .filter((p) => p.nameEn || p.name)
  .map((p) => `spot_${cityKey}_${String(p.nameEn || p.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)}`)));

describe('getExactCitySpotCandidates — group → UI city', () => {
  it.each(['seoul', 'busan'])('%s: candidates exist and come only from that city\'s groups', (cityKey) => {
    const candidates = getExactCitySpotCandidates(cityKey);
    expect(candidates.length).toBeGreaterThan(0);
    const own = keysOfGroups(raw.filter((g) => g.city.toLowerCase() === cityKey), cityKey);
    for (const c of candidates) expect(own.has(c.key), c.key).toBe(true);
    expect(candidates.every((c) => c.key.startsWith(`spot_${cityKey}_`))).toBe(true);
  });

  it('seoul includes a Mapo-gu place and busan a Haeundae-gu place (district is not a city alias)', () => {
    const mapo = raw.find((g) => g.city.toLowerCase() === 'seoul' && g.district === 'Mapo-gu')!;
    const haeundae = raw.find((g) => g.city.toLowerCase() === 'busan' && g.district === 'Haeundae-gu')!;
    expect(getExactCitySpotCandidates('seoul').map((c) => c.name.en)).toContain(mapo.places![0].nameEn || mapo.places![0].name);
    expect(getExactCitySpotCandidates('busan').map((c) => c.name.en)).toContain(haeundae.places![0].nameEn || haeundae.places![0].name);
  });

  it.each([['suwon', 'Suwon-si'], ['incheon', 'Incheon']])('%s stays split out of the gyeonggi bucket by district', (cityKey, district) => {
    const candidates = getExactCitySpotCandidates(cityKey);
    expect(candidates.length).toBeGreaterThan(0);
    const own = keysOfGroups(raw.filter((g) => g.city === 'gyeonggi' && g.district === district), cityKey);
    for (const c of candidates) expect(own.has(c.key), c.key).toBe(true);
  });

  it('gyeonggi groups whose district is not a UI city (Paju/Gapyeong/Chuncheon/Daejeon) appear in no city', () => {
    for (const district of ['Paju-si', 'Gapyeong-gun', 'Chuncheon-si', 'Daejeon']) {
      expect(groupToUiCityKey({ city: 'gyeonggi', district })).toBeNull();
    }
    const paju = raw.find((g) => g.city === 'gyeonggi' && g.district === 'Paju-si')!;
    const pajuNames = new Set((paju.places || []).map((p) => p.nameEn || p.name));
    for (const cityKey of ['seoul', 'busan', 'jeju', 'gyeongju', 'jeonju', 'gangneung', 'incheon', 'suwon', 'yeosu', 'daegu']) {
      for (const c of getExactCitySpotCandidates(cityKey)) expect(pajuNames.has(c.name.en), `${cityKey}: ${c.name.en}`).toBe(false);
    }
  });

  it('group → key rules (synthetic groups)', () => {
    expect(groupToUiCityKey({ city: 'seoul', district: 'Mapo-gu' })).toBe('seoul');
    expect(groupToUiCityKey({ city: 'Seoul', district: 'Jongno-gu' })).toBe('seoul'); // 대소문자
    expect(groupToUiCityKey({ city: 'gyeonggi', district: 'Suwon-si' })).toBe('suwon');
    expect(groupToUiCityKey({ city: '', district: 'Incheon' })).toBe('incheon');
    expect(groupToUiCityKey({ city: 'unknown-token', district: 'Busan' })).toBe('busan');
    // 모순 — city 도 district 도 서로 다른 UI 도시로 풀린다 → 어느 쪽에도 넣지 않는다.
    expect(groupToUiCityKey({ city: 'seoul', district: 'Haeundae-gu' })).toBe('seoul'); // Haeundae 는 별칭 아님 → 모순 아님
    expect(groupToUiCityKey({ city: 'seoul', district: 'Busan' })).toBeNull();
    expect(groupToUiCityKey({ city: 'busan', district: 'Incheon' })).toBeNull();
    expect(groupToUiCityKey({ city: 'seoul', district: 'Seoul' })).toBe('seoul'); // 같은 도시면 모순 아님
  });

  it('output shape and key prefix unchanged; empty / unknown city → nothing', () => {
    const { contextString, candidates } = getExactCitySpotsContext({ cityKey: 'busan', maxItems: 3 });
    expect(candidates).toHaveLength(3);
    expect(Object.keys(candidates[0]).sort()).toEqual(['address', 'category', 'key', 'name']);
    expect(contextString).toContain('VERIFIED BUSAN PLACES (exact-city only');
    expect(getExactCitySpotCandidates('')).toEqual([]);
    expect(getExactCitySpotCandidates('gyeonggi')).toEqual([]);
  });

  it('the mock provider plan uses real spots for seoul and busan', () => {
    for (const area of ['seoul', 'busan']) {
      const json = JSON.stringify({ duration_days: 2, area, regions: [area], diet_preferences: [], tour_start_time: '09:00', tour_end_time: '21:00' });
      const plan = buildMockPlan({ userText: 'X\n' + json + '\n=== VARIATION ===' });
      const names = new Set(getExactCitySpotCandidates(area).flatMap((c) => [c.name.en, c.name.ko]));
      const used = plan.days.flatMap((d: { stops: { name: string }[] }) => d.stops).filter((s: { name: string }) => names.has(s.name));
      expect(used.length, area).toBeGreaterThan(0);
    }
  });
});
