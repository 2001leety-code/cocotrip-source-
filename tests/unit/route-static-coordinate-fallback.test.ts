import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — ESM JavaScript production modules have no declaration files.
import { finiteCoordPair } from '../../api/_ai_core/agents/RouteAgent.js';
// @ts-expect-error — ESM JavaScript production modules have no declaration files.
import {
  expandBlocksToItinerary,
  expandBlocksToItineraryMultiCity,
} from '../../api/_ai_core/blockMode.js';

const routeAgentSource = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'),
  'utf8',
);

const namedStop = {
  order: 1,
  name: '경복궁',
  category: 'culture',
  start_time_offset_min: 0,
  stay_min: 60,
  lat: 37.5796,
  lng: 126.977,
};

const block = {
  id: 'seoul-static-coordinates',
  city: 'seoul',
  zone: '종로',
  theme: 'static coordinate fallback',
  stops: [namedStop],
};

const selection = {
  day_selections: [{ day: 1, block_id: block.id, city: 'seoul' }],
};

describe('Google fallback 제거 후 static/Naver 좌표 연속성', () => {
  it('RouteAgent가 유효한 기존 pair만 fallback으로 받아들인다', () => {
    expect(finiteCoordPair('37.5796', '126.977')).toEqual({ lat: 37.5796, lng: 126.977 });
    expect(finiteCoordPair('37.5796', undefined)).toBeNull();
    expect(finiteCoordPair('not-a-number', '126.977')).toBeNull();
    expect(finiteCoordPair(0, 0)).toBeNull();
  });

  it('Naver 성공은 갱신하고 실패 시 기존 pair를 보존하도록 초기화한다', () => {
    expect(routeAgentSource).toMatch(/const existingCoord = finiteCoordPair\(place\.lat, place\.lng\)/);
    expect(routeAgentSource).toMatch(/let lat = existingCoord \? existingCoord\.lat : null/);
    expect(routeAgentSource).toMatch(/let lng = existingCoord \? existingCoord\.lng : null/);
    expect(routeAgentSource).toMatch(/lng = px;\s*lat = py;\s*break;/);
  });

  it('단도시 block의 검증된 seed 좌표를 최종 stop에 전달한다', () => {
    const itinerary = expandBlocksToItinerary(selection, [block], {
      durationDays: 1,
      language: 'ko',
      area: 'seoul',
      startDate: '2026-09-01',
    });

    expect(itinerary.days[0].stops[0]).toMatchObject({
      name: '경복궁',
      lat: 37.5796,
      lng: 126.977,
    });
  });

  it('검증 식당 매칭은 placeholder가 아니라 실제 식당 좌표를 우선한다', () => {
    const foodBlock = {
      ...block,
      id: 'seoul-food-coordinate',
      stops: [{
        order: 1,
        placeholder: 'verified_lunch',
        category: 'food',
        start_time_offset_min: 0,
        stay_min: 60,
        lat: 37.57,
        lng: 126.98,
      }],
    };
    const itinerary = expandBlocksToItinerary(
      { day_selections: [{ day: 1, block_id: foodBlock.id }] },
      [foodBlock],
      {
        durationDays: 1,
        language: 'ko',
        area: 'seoul',
        foodIndex: [{
          name: '검증 식당',
          city: 'seoul',
          cuisine: 'Korean',
          rating: 4.8,
          reviewCount: 500,
          address: '서울 종로구 테스트로 1',
          lat: 37.5811,
          lng: 126.9912,
          tag: 'general',
        }],
      },
    );

    expect(itinerary.days[0].stops[0]).toMatchObject({
      name: '검증 식당',
      lat: 37.5811,
      lng: 126.9912,
    });
  });

  it('다도시 block도 seed 좌표를 최종 stop에 전달한다', () => {
    const itinerary = expandBlocksToItineraryMultiCity(
      selection,
      [{ city: 'seoul', blocks: [block] }],
      {
        durationDays: 1,
        language: 'ko',
        regions: ['seoul'],
        startDate: '2026-09-01',
      },
    );

    expect(itinerary.days[0].stops[0]).toMatchObject({
      name: '경복궁',
      lat: 37.5796,
      lng: 126.977,
    });
  });
});
