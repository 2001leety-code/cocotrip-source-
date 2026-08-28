import { describe, expect, it } from 'vitest';
import {
  createVehicleQuoteStop,
  durationHoursFromTimes,
  durationInputToMinutes,
  isVehicleQuoteStopRouteReady,
  moveVehicleQuoteStop,
  normalizeVehicleQuoteConflicts,
  normalizeVehicleQuoteStops,
  parseVehicleQuoteManualDistanceInput,
  parseVehicleQuoteProfileNumericInput,
  toVehicleQuotePreviewStops,
  vehicleQuoteBasisPointsToPercentInput,
  vehicleQuoteMetersToKilometersInput,
  vehicleQuoteMinutesToHoursInput,
  vehicleQuoteRoutePoints,
} from '../../src/lib/vehicleQuote';
import { getMoodQuoteText } from '../../src/components/mood/moodQuoteI18n';

describe('mood vehicle quote client domain', () => {
  it('keeps the duration field as raw text so replacing 9 with 6 becomes six hours', () => {
    expect(durationInputToMinutes('9')).toBe(540);
    expect(durationInputToMinutes('')).toBeNull();
    expect(durationInputToMinutes('6')).toBe(360);
    expect(durationInputToMinutes('16')).toBe(960);
  });

  it('derives a duration from explicit times including one midnight crossing', () => {
    expect(durationHoursFromTimes('08:00', '20:00')).toBe('12');
    expect(durationHoursFromTimes('22:30', '01:00')).toBe('2.5');
    expect(durationHoursFromTimes('', '20:00')).toBe('');
  });

  it('accepts only plain decimal manual distances within the supported range', () => {
    expect(parseVehicleQuoteManualDistanceInput('0')).toBe(0);
    expect(parseVehicleQuoteManualDistanceInput('125')).toBe(125);
    expect(parseVehicleQuoteManualDistanceInput('125.5')).toBe(125.5);

    for (const invalid of ['', '0x10', '1e2', '+1', '1 2', 'Infinity', '-1', '.5', '125.', '3000.1']) {
      expect(parseVehicleQuoteManualDistanceInput(invalid)).toBeNull();
    }
  });

  it('preserves road and jibun addresses and an explicit route exclusion', () => {
    const [stop] = normalizeVehicleQuoteStops([{
      order: 4,
      name: '더 루프',
      sourceRegion: '서울',
      roadAddress: '서울특별시 용산구 독서당로35길 4',
      jibunAddress: '서울특별시 용산구 한남동 60-24',
      includeInRoute: false,
      addressVerified: true,
    }]);

    expect(stop).toMatchObject({
      order: 1,
      sourceRegion: '서울',
      roadAddress: '서울특별시 용산구 독서당로35길 4',
      jibunAddress: '서울특별시 용산구 한남동 60-24',
      includeInRoute: false,
      addressVerified: true,
    });
    expect(isVehicleQuoteStopRouteReady(stop)).toBe(true);
  });

  it('moves the full stop object and strips only the React client id for preview', () => {
    const first = createVehicleQuoteStop({ order: 1, name: '첫 장소', purpose: '첫 일정', sourceRegion: '부산' });
    const second = createVehicleQuoteStop({ order: 2, name: '둘째 장소', purpose: '둘째 일정', sourceRegion: '서울' });
    const moved = moveVehicleQuoteStop([first, second], 0, 1);

    expect(moved.map((stop) => [stop.order, stop.name, stop.purpose, stop.sourceRegion])).toEqual([
      [1, '둘째 장소', '둘째 일정', '서울'],
      [2, '첫 장소', '첫 일정', '부산'],
    ]);
    expect(toVehicleQuotePreviewStops(moved)[0]).not.toHaveProperty('clientId');
    expect(toVehicleQuotePreviewStops(moved).map((stop) => stop.sourceRegion)).toEqual(['서울', '부산']);
  });

  it('counts departure, included stops, and return as usable route points', () => {
    const included = createVehicleQuoteStop({
      roadAddress: '남양주 방문지',
      includeInRoute: true,
      addressVerified: false,
    });
    const excluded = createVehicleQuoteStop({
      roadAddress: '경로 제외 장소',
      includeInRoute: false,
      addressVerified: true,
    });

    expect(vehicleQuoteRoutePoints({
      departureAddress: '서울 출발지',
      stops: [included, excluded],
      returnAddress: '서울 출발지',
    })).toEqual(['서울 출발지', '남양주 방문지', '서울 출발지']);
    expect(isVehicleQuoteStopRouteReady(included)).toBe(false);
  });

  it('preserves only typed parser conflicts and never turns warning strings into conflicts', () => {
    expect(normalizeVehicleQuoteConflicts([
      {
        type: 'REGION_ADDRESS_MISMATCH',
        stopOrder: 2,
        sourceRegion: '부산',
        addressRegion: '서울',
        addressField: 'roadAddress',
      },
      '지역이 다릅니다',
      { type: 'FREE_FORM_WARNING', message: '임의 경고' },
    ])).toEqual([{
      type: 'REGION_ADDRESS_MISMATCH',
      stopOrder: 2,
      sourceRegion: '부산',
      addressRegion: '서울',
      addressField: 'roadAddress',
    }]);
  });

  it('converts human rate units to exact server integers and back', () => {
    expect(vehicleQuoteMinutesToHoursInput(180)).toBe('3');
    expect(vehicleQuoteMinutesToHoursInput(900)).toBe('15');
    expect(vehicleQuoteMetersToKilometersInput(50000)).toBe('50');
    expect(vehicleQuoteBasisPointsToPercentInput(1000)).toBe('10');

    expect(parseVehicleQuoteProfileNumericInput({
      hourlyRateKRW: '30000',
      minHours: '3.5',
      maxHours: '15.5',
      billingIncrementMinutes: '30',
      distanceThresholdKm: '50.25',
      distanceRateKRWPerKm: '600',
      vatPercent: '10.25',
      overtimeRateKRW: '33000',
    })).toEqual({
      hourlyRateKRW: 30000,
      minMinutes: 210,
      maxMinutes: 930,
      billingIncrementMinutes: 30,
      distanceThresholdMeters: 50250,
      distanceRateKRWPerKm: 600,
      vatBasisPoints: 1025,
      overtimeRateKRW: 33000,
    });
  });

  it('fails closed when any required profile number is blank or invalid', () => {
    const valid = {
      hourlyRateKRW: '30000',
      minHours: '3',
      maxHours: '15',
      billingIncrementMinutes: '1',
      distanceThresholdKm: '50',
      distanceRateKRWPerKm: '600',
      vatPercent: '10',
      overtimeRateKRW: '33000',
    };
    const fields = Object.keys(valid) as Array<keyof typeof valid>;
    for (const field of fields) {
      expect(parseVehicleQuoteProfileNumericInput({ ...valid, [field]: '' })).toBeNull();
    }
    expect(parseVehicleQuoteProfileNumericInput({ ...valid, minHours: '16', maxHours: '15' })).toBeNull();
    expect(parseVehicleQuoteProfileNumericInput({ ...valid, billingIncrementMinutes: '7' })).toBeNull();
    expect(parseVehicleQuoteProfileNumericInput({ ...valid, vatPercent: '10.001' })).toBeNull();
  });
});

describe('mood vehicle quote local translations', () => {
  it('keeps every quote UI key in Korean, English, Japanese, and Chinese', () => {
    const languages = ['ko', 'en', 'ja', 'zh'] as const;
    const koreanKeys = Object.keys(getMoodQuoteText('ko')).sort();
    for (const language of languages) {
      const translated = getMoodQuoteText(language);
      expect(Object.keys(translated).sort()).toEqual(koreanKeys);
      for (const key of koreanKeys) {
        expect(String(translated[key as keyof typeof translated]).trim()).not.toBe('');
      }
    }
  });
});
