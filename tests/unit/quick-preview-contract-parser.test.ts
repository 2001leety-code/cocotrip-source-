/**
 * `parseQuickPreviewResponse` / `buildGoogleMapsUrl` (2026-08-24,
 * planner-trust-course, client hardening A/B) — the single pure contract
 * `usePlannerHandlers` gates `quickSuccess` on and `QuickPreviewCard` renders
 * from. Pure, dependency-free module — tested directly rather than through a
 * component or hook.
 */
import { describe, it, expect } from 'vitest';
import { parseQuickPreviewResponse, buildGoogleMapsUrl } from '../../src/pages/PlannerPage/lib/quickPreviewContract';

function validTable(): string {
  return (
    '| Time | Spot | Transit | Insider Tip |\n' +
    '|---|---|---|---|\n' +
    '| 10:00 | Gamcheon Culture Village | Start point | Go early for photos |\n' +
    '| 12:30 | Jagalchi Market | Subway Line 1, 10 min | Try the fresh sashimi |\n' +
    '| 15:00 | Haeundae Beach | Bus 100, 15 min | Sunset spot |'
  );
}

function validData(): Record<string, unknown> {
  return {
    marketingNarrative: 'A great first day exploring Busan with beaches and food.',
    themes: ['Food', 'Coast'],
    day1MarkdownTable: validTable(),
    spotDetails: [
      { spot: 'Gamcheon Culture Village', type: 'attraction', candidateId: 'attr-1', key: 'gamcheon', lat: 35.0975, lng: 129.0107 },
      { spot: 'Jagalchi Market', type: 'food', candidateId: 'food-1', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', address: 'Busan, South Korea' },
      { spot: 'Haeundae Beach', type: 'spot', candidateId: 'spot-1', name: 'Haeundae Beach', address: 'Busan, South Korea' },
    ],
    deferredCategories: ['Kpop'],
    reflectedConditions: ['Your travel dates'],
  };
}

describe('parseQuickPreviewResponse — happy path', () => {
  it('parses a fully valid en response', () => {
    const parsed = parseQuickPreviewResponse(validData(), 'en');
    expect(parsed).not.toBeNull();
    expect(parsed?.stops).toHaveLength(3);
    expect(parsed?.stops.map((s) => s.spot)).toEqual(['Gamcheon Culture Village', 'Jagalchi Market', 'Haeundae Beach']);
    expect(parsed?.stops[0].detail.type).toBe('attraction');
    expect(parsed?.stops[1].detail.type).toBe('food');
    expect(parsed?.stops[2].detail.type).toBe('spot');
  });

  it('parses ko/ja/zh with their own exact header text', () => {
    const koData = validData();
    koData.day1MarkdownTable =
      '| 시간 | 명소 | 교통 | 팁 |\n|---|---|---|---|\n' +
      '| 10:00 | Gamcheon Culture Village | 출발지 | 팁1 |\n' +
      '| 12:30 | Jagalchi Market | 지하철 1호선 10분 | 팁2 |\n' +
      '| 15:00 | Haeundae Beach | 버스 100번 15분 | 팁3 |';
    expect(parseQuickPreviewResponse(koData, 'ko')).not.toBeNull();

    const zhData = validData();
    zhData.day1MarkdownTable =
      '| 时间 | 地点 | 交通 | 贴士 |\n|---|---|---|---|\n' +
      '| 10:00 | Gamcheon Culture Village | 出发地 | 提示1 |\n' +
      '| 12:30 | Jagalchi Market | 地铁1号线10分钟 | 提示2 |\n' +
      '| 15:00 | Haeundae Beach | 100路公交15分钟 | 提示3 |';
    expect(parseQuickPreviewResponse(zhData, 'zh')).not.toBeNull();
  });
});

describe('parseQuickPreviewResponse — rejects malformed shapes', () => {
  it('rejects non-object / array / null', () => {
    expect(parseQuickPreviewResponse(null, 'en')).toBeNull();
    expect(parseQuickPreviewResponse('a string', 'en')).toBeNull();
    expect(parseQuickPreviewResponse([], 'en')).toBeNull();
  });

  it('rejects empty/whitespace narrative', () => {
    const d = validData();
    d.marketingNarrative = '   ';
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects themes outside 1-5 or containing an empty string', () => {
    const empty = validData();
    empty.themes = [];
    expect(parseQuickPreviewResponse(empty, 'en')).toBeNull();

    const six = validData();
    six.themes = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(parseQuickPreviewResponse(six, 'en')).toBeNull();

    const blank = validData();
    blank.themes = ['Food', '  '];
    expect(parseQuickPreviewResponse(blank, 'en')).toBeNull();
  });

  it('rejects a table with the wrong header language', () => {
    const d = validData();
    d.day1MarkdownTable = d.day1MarkdownTable!.toString().replace('Insider Tip', 'Tip');
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects a table with an empty cell', () => {
    const d = validData();
    d.day1MarkdownTable = d.day1MarkdownTable!.toString().replace('Try the fresh sashimi', '');
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects a non-canonical time format', () => {
    const d = validData();
    d.day1MarkdownTable = d.day1MarkdownTable!.toString().replace('10:00', '9:00 AM');
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects non-ascending times', () => {
    const d = validData();
    d.day1MarkdownTable = d.day1MarkdownTable!.toString().replace('| 15:00 | Haeundae Beach', '| 11:00 | Haeundae Beach');
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects duplicate displayed spot names', () => {
    const d = validData();
    d.day1MarkdownTable = d.day1MarkdownTable!.toString().replace('Haeundae Beach', 'Jagalchi Market');
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects reflectedConditions/deferredCategories containing a non-string', () => {
    const bad1 = validData();
    bad1.reflectedConditions = ['ok', 5];
    expect(parseQuickPreviewResponse(bad1, 'en')).toBeNull();

    const bad2 = validData();
    bad2.deferredCategories = [{ not: 'a string' }];
    expect(parseQuickPreviewResponse(bad2, 'en')).toBeNull();
  });

  it('rejects spotDetails with the wrong length', () => {
    const d = validData();
    (d.spotDetails as unknown[]).pop();
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects a spotDetails entry whose spot does not match its row (index correspondence)', () => {
    const d = validData();
    (d.spotDetails as Array<Record<string, unknown>>)[0].spot = 'Some Other Place';
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects missing candidateId', () => {
    const d = validData();
    delete (d.spotDetails as Array<Record<string, unknown>>)[0].candidateId;
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects duplicate candidateId across entries', () => {
    const d = validData();
    const details = d.spotDetails as Array<Record<string, unknown>>;
    details[1].candidateId = details[0].candidateId;
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects type "start" and type "unknown"', () => {
    for (const badType of ['start', 'unknown']) {
      const d = validData();
      const details = d.spotDetails as Array<Record<string, unknown>>;
      details[0] = { spot: details[0].spot, type: badType, candidateId: 'attr-1' };
      expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
    }
  });

  it('rejects a food detail with no placeId, no coords, and no address', () => {
    const d = validData();
    const details = d.spotDetails as Array<Record<string, unknown>>;
    details[1] = { spot: details[1].spot, type: 'food', candidateId: 'food-1' };
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('accepts a food detail identified by coords alone (no placeId/address)', () => {
    const d = validData();
    const details = d.spotDetails as Array<Record<string, unknown>>;
    details[1] = { spot: details[1].spot, type: 'food', candidateId: 'food-1', lat: 35.0979, lng: 129.0403 };
    expect(parseQuickPreviewResponse(d, 'en')).not.toBeNull();
  });

  it('rejects an attraction detail missing coords', () => {
    const d = validData();
    const details = d.spotDetails as Array<Record<string, unknown>>;
    details[0] = { spot: details[0].spot, type: 'attraction', candidateId: 'attr-1', key: 'gamcheon' };
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects coordinates outside Korea', () => {
    const d = validData();
    const details = d.spotDetails as Array<Record<string, unknown>>;
    details[0] = { spot: details[0].spot, type: 'attraction', candidateId: 'attr-1', key: 'gamcheon', lat: 48.85, lng: 2.35 }; // Paris
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });

  it('rejects a spot detail missing name or address', () => {
    const d = validData();
    const details = d.spotDetails as Array<Record<string, unknown>>;
    details[2] = { spot: details[2].spot, type: 'spot', candidateId: 'spot-1', name: 'Haeundae Beach' };
    expect(parseQuickPreviewResponse(d, 'en')).toBeNull();
  });
});

describe('buildGoogleMapsUrl — server-owned identity only', () => {
  it('food: prefers a valid placeId token', () => {
    const url = buildGoogleMapsUrl({ type: 'food', spot: 'x', candidateId: 'c', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', lat: 35.1, lng: 129.0, address: 'addr' });
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Google&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4');
  });

  it('food: falls back to finite Korea coordinates when placeId is absent', () => {
    const url = buildGoogleMapsUrl({ type: 'food', spot: 'x', candidateId: 'c', lat: 35.1, lng: 129.0, address: 'addr' });
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=35.1,129');
  });

  it('food: falls back to the canonical address alone (never the model-authored spot name)', () => {
    const url = buildGoogleMapsUrl({ type: 'food', spot: 'Model Invented Name', candidateId: 'c', address: 'Busan, South Korea' });
    expect(url).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Busan, South Korea')}`);
    expect(url).not.toContain('Model');
  });

  it('attraction: uses finite Korea coordinates', () => {
    const url = buildGoogleMapsUrl({ type: 'attraction', spot: 'x', candidateId: 'c', key: 'gamcheon', lat: 35.0975, lng: 129.0107 });
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=35.0975,129.0107');
  });

  it('spot: uses canonical name + address, never the displayed spot alone', () => {
    const url = buildGoogleMapsUrl({ type: 'spot', spot: 'Model Invented Name', candidateId: 'c', name: 'Haeundae Beach', address: 'Busan, South Korea' });
    expect(url).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Haeundae Beach Busan, South Korea')}`);
    expect(url).not.toContain('Model');
  });
});
