import { describe, expect, it } from 'vitest';
// @ts-expect-error — Vercel ESM JavaScript 공유 모듈
import {
  BUILT_IN_MOOD_QUOTE_PROFILE,
  calculateVehicleQuote,
  formatVehicleQuoteDocument,
  normalizeVehicleQuoteProfile,
  sanitizeQuoteStops,
  timeSpanMinutes,
  validateScheduleBasics,
} from '../../api/_shared/vehicle-quote.js';

describe('mood vehicle quote — server pricing SSOT', () => {
  it('MOOD 샘플 12시간·125km·실비 30,000원 = 508,500원', () => {
    const result = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 12 * 60,
      distanceMeters: 125000,
      routeTollKRW: 20000,
      manualParkingKRW: 10000,
    });
    expect(result).toMatchObject({
      ok: true,
      breakdown: {
        timeFeeKRW: 360000,
        distanceFeeKRW: 75000,
        taxableSupplyKRW: 435000,
        vatKRW: 43500,
        tollKRW: 20000,
        parkingKRW: 10000,
        incidentalsKRW: 30000,
        totalKRW: 508500,
      },
    });
  });

  it('50km 미만은 0원, 50km부터 전체 거리에 600원/km를 적용한다', () => {
    const below = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 180,
      distanceMeters: 49999,
    });
    const threshold = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 180,
      distanceMeters: 50000,
    });
    expect(below.breakdown.distanceFeeKRW).toBe(0);
    expect(threshold.breakdown.distanceFeeKRW).toBe(30000);
  });

  it('부가세는 공급가액에만 붙고 통행료·주차비에는 다시 붙지 않는다', () => {
    const result = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 180,
      distanceMeters: 0,
      routeTollKRW: 10000,
      manualParkingKRW: 20000,
    });
    expect(result.breakdown.taxableSupplyKRW).toBe(90000);
    expect(result.breakdown.vatKRW).toBe(9000);
    expect(result.breakdown.totalKRW).toBe(129000);
  });

  it('최소시간·분 단위 비례 계산·최대시간을 서버가 강제한다', () => {
    expect(calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 61,
      distanceMeters: 0,
    }).breakdown).toMatchObject({ billableMinutes: 180, timeFeeKRW: 90000 });
    expect(calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 181,
      distanceMeters: 0,
    }).breakdown).toMatchObject({ billableMinutes: 181, timeFeeKRW: 90500 });
    expect(calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 901,
      distanceMeters: 0,
    })).toEqual({ ok: false, error: 'MAX_TIME_EXCEEDED' });
  });

  it('업체 프로필에서 60분 단위 올림을 선택할 수 있다', () => {
    const profile = { ...BUILT_IN_MOOD_QUOTE_PROFILE, id: 'hourly-company', billingIncrementMinutes: 60 };
    const result = calculateVehicleQuote(profile, { timeMinutes: 181, distanceMeters: 0 });
    expect(result.breakdown).toMatchObject({ billableMinutes: 240, timeFeeKRW: 120000 });
  });

  it('업체별 초과 거리만 계산하는 요금제도 지원한다', () => {
    const normalized = normalizeVehicleQuoteProfile({
      ...BUILT_IN_MOOD_QUOTE_PROFILE,
      id: 'another-company',
      companyName: '다른 업체',
      distanceBillingMode: 'excess_only',
    });
    expect(normalized.ok).toBe(true);
    const result = calculateVehicleQuote(normalized.profile, {
      timeMinutes: 180,
      distanceMeters: 60000,
    });
    expect(result.breakdown.distanceFeeKRW).toBe(6000);
  });

  it('통행료는 3개 정책을 유지하되 주차비 route_estimate 프로필은 서버에서 거부한다', () => {
    expect(normalizeVehicleQuoteProfile({
      ...BUILT_IN_MOOD_QUOTE_PROFILE,
      tollPolicy: 'route_estimate',
      parkingPolicy: 'manual',
    }).ok).toBe(true);
    expect(normalizeVehicleQuoteProfile({
      ...BUILT_IN_MOOD_QUOTE_PROFILE,
      parkingPolicy: 'route_estimate',
    })).toEqual({ ok: false, error: 'INVALID_INCIDENTAL_POLICY' });
  });

  it.each([0, -1, 1.5, '', null, '1', 'invalid'])(
    '명시한 프로필 version이 잘못되면 기본 version으로 대체하지 않는다: %s',
    (version) => {
      expect(normalizeVehicleQuoteProfile({
        ...BUILT_IN_MOOD_QUOTE_PROFILE,
        version,
      })).toEqual({ ok: false, error: 'INVALID_PROFILE_VERSION' });
    },
  );

  it.each(['', null, '30000', [], [30000]])(
    '정수 프로필 필드는 number 정수 외 값을 0이나 숫자로 강제 변환하지 않는다: %j',
    (hourlyRateKRW) => {
      expect(normalizeVehicleQuoteProfile({
        ...BUILT_IN_MOOD_QUOTE_PROFILE,
        hourlyRateKRW,
      })).toEqual({ ok: false, error: 'INVALID_HOURLY_RATE' });
    },
  );

  it.each(['', null, '180', [], [180]])(
    '필수 계산 정수는 number 정수만 허용한다: %j',
    (timeMinutes) => {
      expect(calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
        timeMinutes,
        distanceMeters: 0,
      })).toEqual({ ok: false, error: 'INVALID_TIME_MINUTES' });
    },
  );

  it.each(['', null, '0', [], [0]])(
    '명시한 실비 값도 number 정수 외 값을 0으로 바꾸지 않는다: %j',
    (routeTollKRW) => {
      expect(calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
        timeMinutes: 180,
        distanceMeters: 0,
        routeTollKRW,
      })).toEqual({ ok: false, error: 'INVALID_INCIDENTAL_AMOUNT' });
    },
  );
});

describe('mood vehicle quote — deterministic customer document', () => {
  it('일정 검증과 자정 넘김 시간 계산이 minute 정수로 동작한다', () => {
    expect(timeSpanMinutes('23:00', '01:30')).toBe(150);
    expect(validateScheduleBasics({
      serviceDate: '2026-09-01',
      startTime: '08:00',
      endTime: '20:00',
      stops: [],
    })).toMatchObject({ ok: true, schedule: { timeMinutes: 720 } });
    expect(validateScheduleBasics({
      serviceDate: '2026-09-01junk',
      startTime: '08:00junk',
      endTime: '20:00junk',
      stops: [],
    })).toEqual({ ok: false, error: 'INVALID_SERVICE_DATE' });
    expect(timeSpanMinutes('08:00junk', '11:00')).toBeNull();
    expect(timeSpanMinutes(['08:00'], ['11:00'])).toBeNull();
    expect(sanitizeQuoteStops([{
      order: 1,
      arrivalTime: '09:00junk',
      departureTime: '10:00junk',
    }])[0]).toMatchObject({ arrivalTime: '', departureTime: '' });
    expect(sanitizeQuoteStops([{
      order: 1,
      arrivalTime: ['09:00'],
      departureTime: ['10:00'],
    }])[0]).toMatchObject({ arrivalTime: '', departureTime: '' });
    expect(validateScheduleBasics({
      serviceDate: ['2026-09-01'],
      startTime: ['08:00'],
      endTime: ['20:00'],
      stops: [],
    })).toEqual({ ok: false, error: 'INVALID_SERVICE_DATE' });
  });

  it('문서·가격이 같은 breakdown snapshot을 사용한다', () => {
    const quote = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 720,
      distanceMeters: 125000,
      routeTollKRW: 20000,
      manualParkingKRW: 10000,
    });
    const documentText = formatVehicleQuoteDocument({
      profile: BUILT_IN_MOOD_QUOTE_PROFILE,
      schedule: {
        serviceDate: '2026-09-01', startTime: '08:00', endTime: '20:00',
        departureAddress: '서울특별시 강남구 신사동 643-18',
        returnAddress: '서울특별시 강남구 신사동 643-18',
        stops: [{
          order: 1, arrivalTime: '10:00', name: '기원 위스키 증류소',
          purpose: '위스키 협업 관련 조사 및 미팅',
          roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
          jibunAddress: '경기도 남양주시 화도읍 녹촌리 384-20',
          naverMapUrl: 'https://naver.me/Fx2gIj9B',
          addressVerified: true,
        }],
      },
      route: { source: 'manual' },
      breakdown: quote.breakdown,
      warnings: [],
    });
    expect(documentText).toContain('부가세·통행료·주차비 포함 최종 예상 금액:\n508,500원');
    expect(documentText).toContain('통행료 (경로 기반 예상액): 20,000원');
    expect(documentText).toContain('주차비 (관리자 입력 예상액): 10,000원');
    expect(documentText).toContain('서울특별시 강남구 신사동 643-18');
    expect(documentText).toContain('지번 주소: 경기도 남양주시 화도읍 녹촌리 384-20');
    expect(documentText).toContain('https://naver.me/Fx2gIj9B');
  });

  it('UTC 환경에서도 한국 날짜의 요일을 전날로 계산하지 않는다', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const quote = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
        timeMinutes: 180,
        distanceMeters: 0,
      });
      const documentText = formatVehicleQuoteDocument({
        profile: BUILT_IN_MOOD_QUOTE_PROFILE,
        schedule: {
          serviceDate: '2026-09-01', startTime: '08:00', endTime: '11:00', stops: [],
        },
        route: { source: 'manual' },
        breakdown: quote.breakdown,
        warnings: [],
      });
      expect(documentText).toContain('이용일: 2026년 9월 1일 화요일');
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('거리 요금 설명은 경계 미만·초과분·미적용 모드를 실제 계산과 똑같이 쓴다', () => {
    const cases = [
      {
        profile: BUILT_IN_MOOD_QUOTE_PROFILE,
        distanceMeters: 49999,
        expected: '49.999km는 적용 기준 50km 미만 = 0원',
      },
      {
        profile: { ...BUILT_IN_MOOD_QUOTE_PROFILE, distanceBillingMode: 'excess_only' },
        distanceMeters: 49999,
        expected: '49.999km는 적용 기준 50km 미만 = 0원',
      },
      {
        profile: { ...BUILT_IN_MOOD_QUOTE_PROFILE, distanceBillingMode: 'excess_only' },
        distanceMeters: 60000,
        expected: '초과 10km × 600원 = 6,000원 (총 60km - 기준 50km)',
      },
      {
        profile: { ...BUILT_IN_MOOD_QUOTE_PROFILE, distanceBillingMode: 'none' },
        distanceMeters: 60000,
        expected: '거리 요금 미적용 = 0원',
      },
    ];
    for (const item of cases) {
      const quote = calculateVehicleQuote(item.profile, {
        timeMinutes: 180,
        distanceMeters: item.distanceMeters,
      });
      const documentText = formatVehicleQuoteDocument({
        profile: item.profile,
        schedule: {
          serviceDate: '2026-09-01', startTime: '08:00', endTime: '11:00', stops: [],
        },
        route: { source: 'manual' },
        breakdown: quote.breakdown,
        warnings: [],
      });
      expect(documentText).toContain(item.expected);
    }
  });

  it('41개 방문지는 자르지 않고 TOO_MANY_STOPS로 명시적으로 거부한다', () => {
    const stops = Array.from({ length: 41 }, (_, index) => ({ order: index + 1, name: `장소 ${index + 1}` }));
    expect(validateScheduleBasics({
      serviceDate: '2026-09-01', startTime: '08:00', endTime: '11:00', stops,
    })).toEqual({ ok: false, error: 'TOO_MANY_STOPS' });
    expect(() => sanitizeQuoteStops(stops)).toThrowError('TOO_MANY_STOPS');
  });

  it('footer의 안전한 줄바꿈을 보존한다', () => {
    const normalized = normalizeVehicleQuoteProfile({
      ...BUILT_IN_MOOD_QUOTE_PROFILE,
      footer: '첫째 줄\r\n둘째 줄\n\n셋째 줄',
    });
    expect(normalized.profile.footer).toBe('첫째 줄\n둘째 줄\n\n셋째 줄');
  });

  it('최종 문서의 네이버 링크는 허용된 host만 남긴다', () => {
    const stops = sanitizeQuoteStops([
      { order: 1, naverMapUrl: 'https://naver.me/allowed' },
      { order: 2, naverMapUrl: 'https://naver.me.evil.example/phishing' },
      { order: 3, naverMapUrl: 'https://m.map.naver.com/place/1' },
    ]);
    expect(stops.map((stop) => stop.naverMapUrl)).toEqual([
      'https://naver.me/allowed',
      '',
      'https://m.map.naver.com/place/1',
    ]);
  });

  it('통행료·주차비가 모두 포함 정책이면 0원 예상액 없이 포함 문구만 쓴다', () => {
    const profile = {
      ...BUILT_IN_MOOD_QUOTE_PROFILE,
      id: 'all-included-company',
      tollPolicy: 'included',
      parkingPolicy: 'included',
    };
    const quote = calculateVehicleQuote(profile, {
      timeMinutes: 180,
      distanceMeters: 10000,
      routeTollKRW: 12000,
      manualParkingKRW: 8000,
    });
    expect(quote.breakdown).toMatchObject({ tollKRW: 0, parkingKRW: 0, incidentalsKRW: 0 });
    const documentText = formatVehicleQuoteDocument({
      profile,
      schedule: {
        serviceDate: '2026-09-01', startTime: '08:00', endTime: '11:00', stops: [],
      },
      route: { source: 'manual' },
      breakdown: quote.breakdown,
      warnings: [],
    });
    expect(documentText).toContain('통행료: 요금에 포함 · 별도 청구 없음');
    expect(documentText).toContain('주차비: 요금에 포함 · 별도 청구 없음');
    expect(documentText).toContain('부가세 포함 최종 예상 금액:');
    expect(documentText).toContain('※ 위 금액은 약 10km 운행을 기준으로 계산한 예상 견적입니다.');
    expect(documentText).toContain('※ 실제 이용시간 또는 운행거리가 예상 범위를 초과하면 추가 금액이 발생할 수 있습니다.');
    expect(documentText).not.toContain('통행료 0원');
    expect(documentText).not.toContain('주차비 0원');
    expect(documentText).not.toContain('통행료 또는 주차비');
  });

  it.each([
    {
      tollPolicy: 'route_estimate',
      parkingPolicy: 'included',
      tollKRW: 12000,
      parkingKRW: 0,
      expectedToll: '통행료 (경로 기반 예상액): 12,000원',
      expectedParking: '주차비: 요금에 포함 · 별도 청구 없음',
      expectedFinal: '부가세·통행료 포함 최종 예상 금액:',
      expectedBasis: '통행료 12,000원',
      excludedVariation: '주차비가 예상 범위를',
    },
    {
      tollPolicy: 'included',
      parkingPolicy: 'manual',
      tollKRW: 0,
      parkingKRW: 8000,
      expectedToll: '통행료: 요금에 포함 · 별도 청구 없음',
      expectedParking: '주차비 (관리자 입력 예상액): 8,000원',
      expectedFinal: '부가세·주차비 포함 최종 예상 금액:',
      expectedBasis: '주차비 8,000원',
      excludedVariation: '통행료가 예상 범위를',
    },
  ])('혼합 실비 정책은 실제 금액과 산정 성격만 표시한다', (item) => {
    const profile = {
      ...BUILT_IN_MOOD_QUOTE_PROFILE,
      id: 'mixed-policy-company',
      tollPolicy: item.tollPolicy,
      parkingPolicy: item.parkingPolicy,
    };
    const quote = calculateVehicleQuote(profile, {
      timeMinutes: 180,
      distanceMeters: 10000,
      routeTollKRW: 12000,
      manualParkingKRW: 8000,
    });
    expect(quote.breakdown).toMatchObject({ tollKRW: item.tollKRW, parkingKRW: item.parkingKRW });
    const documentText = formatVehicleQuoteDocument({
      profile,
      schedule: {
        serviceDate: '2026-09-01', startTime: '08:00', endTime: '11:00', stops: [],
      },
      route: { source: 'manual' },
      breakdown: quote.breakdown,
      warnings: [],
    });
    expect(documentText).toContain(item.expectedToll);
    expect(documentText).toContain(item.expectedParking);
    expect(documentText).toContain(item.expectedFinal);
    expect(documentText).toContain(item.expectedBasis);
    expect(documentText).not.toContain(item.excludedVariation);
  });

  it('includeInRoute=false라도 고객 일정 문서에서는 제거하지 않는다', () => {
    const stops = sanitizeQuoteStops([{
      order: 1,
      name: '사진 촬영',
      sourceRegion: '  Guri  ',
      includeInRoute: false,
    }]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      name: '사진 촬영',
      sourceRegion: 'Guri',
      includeInRoute: false,
    });
  });

  it('마지막 방문지에서 나올 때는 다음 장소가 아니라 복귀 장소로 출발한다고 쓴다', () => {
    const quote = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 180,
      distanceMeters: 0,
    });
    const documentText = formatVehicleQuoteDocument({
      profile: BUILT_IN_MOOD_QUOTE_PROFILE,
      schedule: {
        serviceDate: '2026-09-01',
        startTime: '08:00',
        endTime: '12:00',
        returnAddress: '서울특별시 강남구',
        stops: [{
          order: 1,
          arrivalTime: '09:00',
          departureTime: '11:00',
          name: '기원 위스키 증류소',
        }],
      },
      route: { source: 'manual' },
      breakdown: quote.breakdown,
      warnings: [],
    });

    expect(documentText).toContain('오전 11시 – 기원 위스키 증류소에서 복귀 장소로 출발');
    expect(documentText).not.toContain('오전 11시 – 다음 장소로 출발');
  });

  it('각 이동의 현재·다음 장소와 도착-출발 사이 체류·대기 시간을 쓴다', () => {
    const quote = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 240,
      distanceMeters: 0,
    });
    const documentText = formatVehicleQuoteDocument({
      profile: BUILT_IN_MOOD_QUOTE_PROFILE,
      schedule: {
        serviceDate: '2026-09-01',
        startTime: '08:00',
        endTime: '12:00',
        departureAddress: '서울 출발지',
        returnAddress: '서울 복귀지',
        stops: [
          { order: 1, arrivalTime: '09:00', departureTime: '09:45', name: '첫 장소' },
          { order: 2, arrivalTime: '10:30', departureTime: '11:00', name: '둘째 장소' },
        ],
      },
      route: { source: 'manual' },
      breakdown: quote.breakdown,
      warnings: [],
    });
    expect(documentText).toContain('오전 8시 – 출발지에서 첫 장소로 출발');
    expect(documentText).toContain('체류·대기 시간: 45분');
    expect(documentText).toContain('오전 9시 45분 – 첫 장소에서 둘째 장소로 출발');
    expect(documentText).toContain('오전 11시 – 둘째 장소에서 복귀 장소로 출발');
  });

  it('경로 제외 일정은 표시하되 차량 이동 문장은 포함 장소만 건너뛰어 연결한다', () => {
    const quote = calculateVehicleQuote(BUILT_IN_MOOD_QUOTE_PROFILE, {
      timeMinutes: 240,
      distanceMeters: 0,
    });
    const documentText = formatVehicleQuoteDocument({
      profile: BUILT_IN_MOOD_QUOTE_PROFILE,
      schedule: {
        serviceDate: '2026-09-01',
        startTime: '08:00',
        endTime: '12:00',
        departureAddress: '서울 출발지',
        returnAddress: '서울 복귀지',
        stops: [
          { order: 1, arrivalTime: '08:10', departureTime: '08:20', name: '제외 첫 장소', includeInRoute: false },
          { order: 2, arrivalTime: '09:00', departureTime: '09:30', name: '포함 첫 장소', includeInRoute: true },
          { order: 3, arrivalTime: '10:00', departureTime: '10:10', name: '제외 중간 장소', includeInRoute: false },
          { order: 4, arrivalTime: '10:40', departureTime: '11:00', name: '포함 마지막 장소', includeInRoute: true },
        ],
      },
      route: { source: 'manual' },
      breakdown: quote.breakdown,
      warnings: [],
    });
    expect(documentText.match(/차량 운행거리 산정 제외/g)).toHaveLength(2);
    expect(documentText).toContain('오전 8시 – 출발지에서 포함 첫 장소로 출발');
    expect(documentText).toContain('오전 9시 30분 – 포함 첫 장소에서 포함 마지막 장소로 출발');
    expect(documentText).toContain('오전 11시 – 포함 마지막 장소에서 복귀 장소로 출발');
    expect(documentText).not.toContain('출발지에서 제외 첫 장소로 출발');
    expect(documentText).not.toContain('제외 첫 장소에서');
    expect(documentText).not.toContain('제외 중간 장소에서');
    expect(documentText).not.toContain('포함 첫 장소에서 제외 중간 장소로 출발');
  });
});
