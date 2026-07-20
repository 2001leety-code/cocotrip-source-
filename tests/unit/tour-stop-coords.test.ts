// 투어 stop 좌표 데이터 무결성 (2026-07-20).
// 9개 정적 투어의 stop 좌표가 온전한지 — 한국 안, 인접 stop 과 합리적 거리, 채움률.
import { describe, it, expect } from 'vitest';
import { TOURS } from '@/data/tours';

const STATIC_IDS = [
  'tour-seoul-city', 'tour-seoul-night', 'tour-danyang', 'tour-ganghwa', 'tour-dmz',
  'tour-nami-chuncheon', 'tour-gyeongju', 'tour-busan-day', 'tour-multicity-3d',
];

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

describe('정적 투어 stop 좌표', () => {
  const staticTours = STATIC_IDS.map((id) => TOURS.find((t) => t.id === id)).filter(Boolean);

  it('9개 정적 투어를 전부 찾는다', () => {
    expect(staticTours.length).toBe(9);
  });

  it('모든 stop 이 좌표를 갖는다 (지도 완전 커버)', () => {
    const missing: string[] = [];
    for (const t of staticTours) {
      for (const s of t!.stops || []) {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) missing.push(`${t!.id}: ${s.name.ko}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('모든 좌표가 한국 영역 안이다 (경위도 뒤바뀜·오타 방지)', () => {
    const bad: string[] = [];
    for (const t of staticTours) {
      for (const s of t!.stops || []) {
        if (s.lat == null || s.lng == null) continue;
        if (s.lat < 33 || s.lat > 39 || s.lng < 124 || s.lng > 132) bad.push(`${t!.id}: ${s.name.ko} (${s.lat},${s.lng})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('단일 도시 투어는 인접 stop 이 25km 이내다 (엉뚱한 좌표 탐지)', () => {
    // 멀티시티는 도시 간 이동이 있어 제외. 나머지는 도심/근교라 인접 stop 이 붙어 있어야 한다.
    // (가평→춘천 27.7km 같은 실제 장거리 구간이 있는 nami 투어는 상한을 넉넉히 둔다.)
    const LIMIT: Record<string, number> = { 'tour-nami-chuncheon': 30 };
    const flags: string[] = [];
    for (const t of staticTours) {
      if (t!.id === 'tour-multicity-3d') continue;
      const limit = LIMIT[t!.id] || 25;
      const stops = (t!.stops || []).filter((s) => s.lat != null && s.lng != null);
      for (let i = 1; i < stops.length; i++) {
        const d = haversineKm(stops[i - 1].lat!, stops[i - 1].lng!, stops[i].lat!, stops[i].lng!);
        if (d > limit) flags.push(`${t!.id}: ${stops[i - 1].name.ko}→${stops[i].name.ko} = ${d.toFixed(1)}km`);
      }
    }
    expect(flags).toEqual([]);
  });

  it('좌표가 그 stop 의 지역과 대략 맞는다 (표본 검증)', () => {
    const find = (tid: string, ko: string) => TOURS.find((t) => t.id === tid)?.stops?.find((s) => s.name.ko === ko);
    const near = (s: { lat?: number; lng?: number } | undefined, lat: number, lng: number, km = 3) =>
      s?.lat != null && haversineKm(s.lat, s.lng!, lat, lng) <= km;
    expect(near(find('tour-seoul-city', '경복궁'), 37.5786, 126.9772)).toBe(true);
    expect(near(find('tour-busan-day', '해운대'), 35.1608, 129.1639)).toBe(true);
    expect(near(find('tour-nami-chuncheon', '남이섬'), 37.7917, 127.5251)).toBe(true);
    expect(near(find('tour-gyeongju', '불국사'), 35.7903, 129.3319)).toBe(true);
  });
});
