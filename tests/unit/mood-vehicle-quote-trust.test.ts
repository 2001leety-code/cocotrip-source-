import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
vi.mock('axios', () => {
  const get = vi.fn();
  return { default: { get }, get };
});
import axios from 'axios';
// @ts-expect-error — Vercel ESM JavaScript API 모듈
import { sanitizeParsedQuoteSchedule } from '../../api/mood-quote-parse.js';
// @ts-expect-error — Vercel ESM JavaScript API 모듈
import { buildQuoteRouteAddresses } from '../../api/mood-quote-preview.js';
// @ts-expect-error — Vercel ESM JavaScript 공유 모듈
import { computeRoute } from '../../api/_shared/mood-route.js';
// @ts-expect-error — Vercel ESM JavaScript 공유 모듈
import { detectQuoteRegionConflicts } from '../../api/_shared/vehicle-quote-region.js';

const axiosGetMock = (axios as unknown as { get: ReturnType<typeof vi.fn> }).get;

describe('mood vehicle quote parse — untrusted AI output', () => {
  it('원문에 없는 주소·지도 링크와 가격 필드를 제거한다', () => {
    const source = `2026년 9월 1일\n오전 10시 기원 위스키 증류소\n경기도 남양주시 화도읍 녹촌로 259-18\nhttps://naver.me/Fx2gIj9B`;
    const parsed = sanitizeParsedQuoteSchedule({
      serviceDate: '2026-09-01',
      startTime: '08:00',
      endTime: '20:00',
      totalKRW: 1,
      stops: [{
        order: 1,
        arrivalTime: '10:00',
        name: '기원 위스키 증류소',
        roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
        jibunAddress: '서울특별시 강남구 가짜주소 1',
        naverMapUrl: 'https://evil.example/discount',
        quotedPrice: 1,
      }],
    }, source);
    expect(parsed.stops[0].roadAddress).toBe('경기도 남양주시 화도읍 녹촌로 259-18');
    expect(parsed.stops[0].jibunAddress).toBe('');
    expect(parsed.stops[0].naverMapUrl).toBe('');
    expect(parsed.stops[0]).not.toHaveProperty('quotedPrice');
    expect(parsed).not.toHaveProperty('totalKRW');
    expect(parsed.needsConfirm).toBe(true);
  });

  it('유효한 원문 Naver 단축 링크만 보존하고 주소는 미확인 상태로 둔다', () => {
    const source = '기원 증류소 경기도 남양주시 화도읍 녹촌로 259-18 https://naver.me/Fx2gIj9B';
    const parsed = sanitizeParsedQuoteSchedule({
      stops: [{
        order: 1,
        name: '기원 증류소',
        roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
        naverMapUrl: 'https://naver.me/Fx2gIj9B',
      }],
    }, source);
    expect(parsed.stops[0].naverMapUrl).toContain('naver.me');
    expect(parsed.stops[0].addressVerified).toBe(false);
  });

  it('AI가 원문에 없는 장소명과 방문 목적을 만들면 제거하고 경고한다', () => {
    const parsed = sanitizeParsedQuoteSchedule({
      stops: [{
        order: 1,
        name: 'AI가 만든 VIP 증류소',
        purpose: '특별 할인 협상',
      }],
    }, '오전 10시 업체 미팅');

    expect(parsed.stops[0]).toMatchObject({ name: '', purpose: '' });
    expect(parsed.warnings).toContain('1번 장소에서 원문에 없는 장소명을 제거했습니다.');
    expect(parsed.warnings).toContain('1번 장소에서 원문에 없는 방문 목적을 제거했습니다.');
  });

  it('원문의 지역 설명과 명시 주소가 충돌하면 주소를 유지하고 구조화된 충돌·최종확인 경고를 남긴다', () => {
    const source = '지역 설명: 충남\n명시 주소: 경기도 남양주시 화도읍 녹촌로 259-18';
    const parsed = sanitizeParsedQuoteSchedule({
      stops: [{
        order: 2,
        sourceRegion: '충남',
        roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
      }],
    }, source);

    expect(parsed.stops[0].roadAddress).toBe('경기도 남양주시 화도읍 녹촌로 259-18');
    expect(parsed.stops[0].sourceRegion).toBe('충남');
    expect(parsed.conflicts).toEqual([{
      type: 'REGION_ADDRESS_MISMATCH',
      stopOrder: 2,
      sourceRegion: '충남',
      addressRegion: '경기도',
      addressField: 'roadAddress',
    }]);
    expect(parsed.warnings).toContain(
      '2번 장소의 지역 설명(충남)과 명시 주소의 지역(경기도)이 다릅니다. 명시 주소를 유지했으며 견적 전 최종 확인이 필요합니다.',
    );
  });

  it('영문 Guri 지역 설명과 맨 뒤에 Seoul이 있는 영문 명시 주소의 충돌도 감지한다', () => {
    const address = '123 Wangsimni-ro, Haengdang-dong, Seongdong-gu, Seoul';
    const source = `A partner distillery in Guri\n${address}`;
    const parsed = sanitizeParsedQuoteSchedule({
      stops: [{
        order: 1,
        sourceRegion: 'Guri',
        roadAddress: address,
      }],
    }, source);

    expect(parsed.stops[0].roadAddress).toBe(address);
    expect(parsed.stops[0].sourceRegion).toBe('Guri');
    expect(parsed.conflicts).toEqual([{
      type: 'REGION_ADDRESS_MISMATCH',
      stopOrder: 1,
      sourceRegion: 'Guri',
      addressRegion: 'Seoul',
      addressField: 'roadAddress',
    }]);
    expect(parsed.warnings.some((warning: string) => (
      warning.includes('지역 설명(Guri)') && warning.includes('명시 주소의 지역(Seoul)')
    ))).toBe(true);
  });

  it('AI가 원문 근거 없이 includeInRoute=false·optional=true를 만들어도 경로 포함·필수 일정으로 되돌린다', () => {
    const parsed = sanitizeParsedQuoteSchedule({
      stops: [{
        order: 1,
        name: '기원 증류소',
        optional: true,
        optionalEvidence: 'optional',
        includeInRoute: false,
        routeExclusionEvidence: 'not part of the vehicle route',
      }],
    }, '기원 증류소 방문');

    expect(parsed.stops[0]).toMatchObject({ optional: false, includeInRoute: true });
    expect(parsed.warnings).toContain('1번 장소의 선택 일정 표시에 원문 근거가 없어 필수 일정으로 되돌렸습니다.');
    expect(parsed.warnings).toContain('1번 장소의 AI 경로 제외 표시를 적용하지 않았습니다. 관리자가 확인한 뒤 수동으로 제외해야 합니다.');
  });

  it('AI 날짜·시간은 원문의 정확한 근거가 같은 값으로 변환될 때만 채택한다', () => {
    const source = '이용일 2026년 9월 1일, 오전 8시 출발, 오후 8시 종료';
    const parsed = sanitizeParsedQuoteSchedule({
      serviceDate: '2026-09-01',
      serviceDateEvidence: '2026년 9월 1일',
      startTime: '08:00',
      startTimeEvidence: '오전 8시',
      endTime: '20:00',
      endTimeEvidence: '오후 8시',
      stops: [],
    }, source);
    expect(parsed).toMatchObject({ serviceDate: '2026-09-01', startTime: '08:00', endTime: '20:00' });
  });

  it('AI 날짜·시간의 근거가 없거나 다른 값이면 빈값과 경고로 fail-closed 처리한다', () => {
    const source = '이용일 2026년 9월 1일, 오전 8시 출발, 오후 8시 종료';
    const parsed = sanitizeParsedQuoteSchedule({
      serviceDate: '2026-09-02',
      serviceDateEvidence: '2026년 9월 1일',
      startTime: '08:00',
      startTimeEvidence: '',
      endTime: '19:00',
      endTimeEvidence: '오후 8시',
      stops: [],
    }, source);
    expect(parsed).toMatchObject({ serviceDate: '', startTime: '', endTime: '' });
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      '이용일은 원문 근거와 일치하지 않아 제거했습니다.',
      '시작 시각은 원문 근거와 일치하지 않아 제거했습니다.',
      '종료 시각은 원문 근거와 일치하지 않아 제거했습니다.',
    ]));
  });

  it('AI 날짜·시간 값이나 근거가 배열이면 문자열로 강제 변환하지 않는다', () => {
    const parsed = sanitizeParsedQuoteSchedule({
      serviceDate: ['2026-09-01'],
      serviceDateEvidence: ['2026년 9월 1일'],
      startTime: ['08:00'],
      startTimeEvidence: ['오전 8시'],
      stops: [],
    }, '2026년 9월 1일 오전 8시');
    expect(parsed).toMatchObject({ serviceDate: '', startTime: '' });
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      '이용일은 원문 근거와 일치하지 않아 제거했습니다.',
      '시작 시각은 원문 근거와 일치하지 않아 제거했습니다.',
    ]));
  });

  it('AI 날짜·시간 후보의 정상 접두사 뒤에 문자가 붙어도 잘라서 채택하지 않는다', () => {
    const parsed = sanitizeParsedQuoteSchedule({
      serviceDate: '2026-09-01INVENTED',
      serviceDateEvidence: '2026년 9월 1일',
      startTime: '08:00INVENTED',
      startTimeEvidence: '오전 8시',
      stops: [{
        order: 1,
        arrivalTime: '10:00INVENTED',
        arrivalTimeEvidence: '오전 10시',
      }],
    }, '2026년 9월 1일 오전 8시 출발, 오전 10시 도착');
    expect(parsed).toMatchObject({ serviceDate: '', startTime: '' });
    expect(parsed.stops[0].arrivalTime).toBe('');
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      '이용일은 원문 근거와 일치하지 않아 제거했습니다.',
      '시작 시각은 원문 근거와 일치하지 않아 제거했습니다.',
      '1번 장소 도착 시각은 원문 근거와 일치하지 않아 제거했습니다.',
    ]));
  });

  it('장소별 시각은 정확한 근거를 요구하고 같은 원문 근거를 다른 장소에 재사용하지 못한다', () => {
    const source = '오전 10시 첫 장소 도착, 오전 11시 첫 장소 출발, 둘째 장소 방문';
    const parsed = sanitizeParsedQuoteSchedule({
      stops: [
        {
          order: 1,
          name: '첫 장소',
          arrivalTime: '10:00',
          arrivalTimeEvidence: '오전 10시',
          departureTime: '11:00',
          departureTimeEvidence: '오전 11시',
        },
        {
          order: 2,
          name: '둘째 장소',
          arrivalTime: '10:00',
          arrivalTimeEvidence: '오전 10시',
        },
      ],
    }, source);
    expect(parsed.stops[0]).toMatchObject({ arrivalTime: '10:00', departureTime: '11:00' });
    expect(parsed.stops[1].arrivalTime).toBe('');
    expect(parsed.warnings).toContain('2번 장소 도착 시각은 다른 장소와 같은 원문 근거를 재사용해 제거했습니다.');
  });

  it('AI가 41개 장소를 반환하면 일부만 쓰지 않고 TOO_MANY_STOPS로 거부한다', () => {
    const stops = Array.from({ length: 41 }, (_, index) => ({ order: index + 1 }));
    expect(() => sanitizeParsedQuoteSchedule({ stops }, '일정 원문')).toThrowError('TOO_MANY_STOPS');
  });
});

describe('mood vehicle quote route — fail closed confirmation', () => {
  it('지역 또는 주소를 인식할 수 없거나 같은 지역이면 충돌을 만들지 않는다', () => {
    expect(detectQuoteRegionConflicts([
      { order: 1, sourceRegion: 'Guri', roadAddress: 'Gyeonggi-do, Guri-si', jibunAddress: '' },
      { order: 2, sourceRegion: '알 수 없는 지역', roadAddress: 'Seoul', jibunAddress: '' },
      { order: 3, sourceRegion: 'Guri', roadAddress: '주소 미정', jibunAddress: '' },
    ])).toEqual([]);
  });

  it('도로명 주소 지역이 없으면 현재 지번 주소 지역과 현재 order로 충돌을 만든다', () => {
    expect(detectQuoteRegionConflicts([{
      order: 4,
      sourceRegion: 'Guri',
      roadAddress: '주소 미정',
      jibunAddress: '서울특별시 성동구 행당동',
    }])).toEqual([{
      type: 'REGION_ADDRESS_MISMATCH',
      stopOrder: 4,
      sourceRegion: 'Guri',
      addressRegion: '서울특별시',
      addressField: 'jibunAddress',
    }]);
  });

  it('includeInRoute=false 장소는 경로에서만 제외한다', () => {
    const result = buildQuoteRouteAddresses({
      departureAddress: '서울 출발지',
      returnAddress: '서울 복귀지',
      stops: [
        { order: 1, roadAddress: '', jibunAddress: '', includeInRoute: false, addressVerified: false },
        { order: 2, roadAddress: '남양주 목적지', jibunAddress: '', includeInRoute: true, addressVerified: true },
      ],
    });
    expect(result).toEqual({ ok: true, addresses: ['서울 출발지', '남양주 목적지', '서울 복귀지'] });
  });

  it('경로 포함 주소가 없거나 미확인이면 계산을 차단한다', () => {
    expect(buildQuoteRouteAddresses({
      departureAddress: '서울 출발지', returnAddress: '',
      stops: [{ order: 3, roadAddress: '', jibunAddress: '', includeInRoute: true, addressVerified: true }],
    })).toMatchObject({ ok: false, error: 'ROUTE_ADDRESS_REQUIRED', stopOrder: 3 });
    expect(buildQuoteRouteAddresses({
      departureAddress: '서울 출발지', returnAddress: '',
      stops: [{ order: 4, roadAddress: '남양주', jibunAddress: '', includeInRoute: true, addressVerified: false }],
    })).toMatchObject({ ok: false, error: 'ROUTE_ADDRESS_NOT_CONFIRMED', stopOrder: 4 });
  });
});

describe('mood vehicle quote API — admin/auth/audit invariants', () => {
  const files = [
    'api/mood-quote-profiles.js',
    'api/mood-quote-preview.js',
    'api/mood-quote-parse.js',
  ];

  it.each(files)('%s 는 token+emailVerified+allowlist admin 서버 게이트를 사용한다', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).toMatch(/verifyUserToken/);
    expect(source).toMatch(/emailVerified/);
    expect(source).toMatch(/getMoodAllowlist/);
    expect(source).toMatch(/isAdminEmail/);
    expect(source).not.toMatch(/verifyAdminToken/);
  });

  it('프로필 저장은 version snapshot과 audit을 같은 transaction에 기록한다', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/mood-quote-profiles.js'), 'utf8');
    expect(source).toMatch(/runTransaction/);
    expect(source).toMatch(/collection\('versions'\)/);
    expect(source).toContain('mood_quote_profile_audit');
    expect(source).toMatch(/previousVersion/);
    expect(source).toMatch(/newVersion/);
  });

  it('프로필 목록은 100개 선조회 제한으로 활성 프로필을 숨기지 않는다', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/mood-quote-profiles.js'), 'utf8');
    expect(source).toContain('db.collection(COLLECTION).get()');
    expect(source).not.toContain('.limit(100)');
  });

  it('인쇄 CSS는 관리 화면 전체를 숨기고 서버 고객 문서만 다시 보이게 한다', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(source).toMatch(/body:has\(\[data-mood-quote-print-document\]\) \*\s*\{[^}]*visibility:\s*hidden !important/s);
    expect(source).toMatch(/body:has\(\[data-mood-quote-print-document\]\) \[data-mood-quote-print-document\]\s*\{[^}]*visibility:\s*visible !important/s);
  });

  it('경로 공유 모듈은 기존 km와 함께 정확한 원본 meter 정수도 반환한다', async () => {
    const previousId = process.env.NCP_CLIENT_ID;
    const previousSecret = process.env.NCP_CLIENT_SECRET;
    process.env.NCP_CLIENT_ID = 'test-id';
    process.env.NCP_CLIENT_SECRET = 'test-secret';
    axiosGetMock.mockReset();
    axiosGetMock
      .mockResolvedValueOnce({ status: 200, data: { addresses: [{ y: '37.5', x: '127.0' }] } })
      .mockResolvedValueOnce({ status: 200, data: { addresses: [{ y: '37.4', x: '127.1' }] } })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          code: 0,
          route: { traoptimal: [{ summary: { distance: 12345, duration: 1800000, tollFare: 4500 } }] },
        },
      });
    try {
      const result = await computeRoute({ origin: '출발지', destination: '도착지' });
      expect(result).toMatchObject({ ok: true, distanceMeters: 12345, km: 12.3 });
    } finally {
      if (previousId === undefined) delete process.env.NCP_CLIENT_ID;
      else process.env.NCP_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.NCP_CLIENT_SECRET;
      else process.env.NCP_CLIENT_SECRET = previousSecret;
    }
  });

  it('AI parser는 중앙 모델 resolver와 usage recorder를 함께 사용한다', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/mood-quote-parse.js'), 'utf8');
    expect(source).toMatch(/resolveGeminiModel\('classifier'\)/);
    expect(source).toMatch(/recordUsageFromResponse\('mood-quote-parse'/);
    expect(source).not.toMatch(/computeMoodTotalKRW/);
  });
});
