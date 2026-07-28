/**
 * MOOD AI 받아적기 파싱 코어 회귀 슬롯 (2026-07-03, PR #1046 소급 검증).
 *
 * 검증 시스템(Brain OS 협업 unit 하네스)에 신규 AI 예약 파싱 로직을 편입한다.
 * 아래 순수함수가 잘못 바뀌면 이 테스트가 터진다:
 *   1. matchPlacebook — 주소록 오매칭 방지('유진'이 '정유진'에 걸림 = 엉뚱 주소 → 잘못된 km/요금).
 *   2. looksLikeAirport — 공항 판정 누락/오판 (서비스 오분류).
 *   3. guessService — 서비스 추천 우선순위(airport>vehicle>manager). 항상 더블체크지만
 *      기본 추천이 틀리면 운영자 오확정 위험.
 *
 * 순수함수라 모킹 불필요 (api/_shared 핸들러 모킹 패턴과 달리 직접 호출).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { matchPlacebook, matchStopPlaces, looksLikeAirport, guessAirportCode, guessAirportDirection, normalizeTimeHint, guessService, norm, salvageStopsFromTruncatedJson, coordFromPlaceDoc } from '../../api/mood-parse-schedule.js';

// 주소록 인덱스 형태 { name, nameNorm, address, lat, lng, isDirector } — loadPlacebook 산출물과 동일.
function place(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    nameNorm: norm(name),
    address: `${name} 주소`,
    lat: 37.5,
    lng: 127.0,
    isDirector: false,
    ...extra,
  };
}

describe('matchPlacebook — 주소록 오매칭 방지', () => {
  const book = [
    place('정유진'),
    place('이사님', { isDirector: true }),
    place('헤메실장'),
  ];

  it('정확 일치(정규화)는 매칭한다', () => {
    expect(matchPlacebook('정유진', book)?.name).toBe('정유진');
    expect(matchPlacebook('  이사님  ', book)?.name).toBe('이사님'); // trim 정규화
  });

  it("'유진'은 '정유진'에 매칭되면 안 된다 (버그헌트 fix 잠금 — 짧은 파싱명이 긴 주소록명에 오매칭)", () => {
    // q⊇p 방향 금지: '유진'(q)이 '정유진'(p)을 포함하지 않고, p⊇q 만 허용하는데
    // '정유진'.includes('유진')=true 이므로 단일이면 매칭됨. 여기선 '정유진' 하나뿐이라
    // contains 후보 1 → 매칭. 하지만 오매칭 위험 케이스는 "다중 후보"에서 검증(아래).
    // 이 케이스는 실제로 '유진'→'정유진' 단일 포함이라 매칭이 맞다(주소록에 유진 본인 없을 때).
    expect(matchPlacebook('유진', book)?.name).toBe('정유진');
  });

  it('포함 후보가 2개 이상이면 모호 → 매칭 포기(null) → geocode 경로로 운영자 확인 강제', () => {
    const ambiguous = [place('정유진'), place('김유진'), place('유진식당')];
    expect(matchPlacebook('유진', ambiguous)).toBeNull();
  });

  it('1글자 질의는 오매칭 위험이 커 포함 매칭에서 제외(null)', () => {
    expect(matchPlacebook('김', book)).toBeNull();
  });

  it('빈 문자열/공백은 null', () => {
    expect(matchPlacebook('', book)).toBeNull();
    expect(matchPlacebook('   ', book)).toBeNull();
  });

  it('주소록에 없는 이름은 null (→ geocode 경로)', () => {
    expect(matchPlacebook('강남 코엑스', book)).toBeNull();
  });
});

describe('looksLikeAirport — 공항 판정', () => {
  it('공항 키워드(한/영/약어/터미널)는 true', () => {
    expect(looksLikeAirport('인천공항 T2')).toBe(true);
    expect(looksLikeAirport('김포공항')).toBe(true);
    expect(looksLikeAirport('ICN')).toBe(true);
    expect(looksLikeAirport('GMP terminal 1')).toBe(true);
    expect(looksLikeAirport('제주공항')).toBe(true);
  });

  it('여러 파트 중 하나라도 공항이면 true (이름/주소힌트/매칭주소 합산)', () => {
    expect(looksLikeAirport('픽업', '', '', '인천국제공항 제2여객터미널')).toBe(true);
  });

  it('일반 장소는 false', () => {
    expect(looksLikeAirport('강남 코엑스')).toBe(false);
    expect(looksLikeAirport('트리지움 서문', '서울 송파구')).toBe(false);
  });

  it('빈 입력은 false', () => {
    expect(looksLikeAirport()).toBe(false);
    expect(looksLikeAirport('', null, undefined)).toBe(false);
  });
});

// 💰 공항 정액이 공항마다 다름(ICN 110,000 / GMP 80,000, 2026-07-27) → 오판정 = 금액 오차 3만원.
describe('guessAirportCode — 어느 공항인지 (정액 결정)', () => {
  it('김포 신호(한글/약어)는 GMP', () => {
    expect(guessAirportCode('김포공항')).toBe('GMP');
    expect(guessAirportCode('GMP terminal 1')).toBe('GMP');
    expect(guessAirportCode('픽업', '', '', '서울 강서구 김포공항로')).toBe('GMP');
  });

  it('그 외 공항은 전부 ICN (애매하면 비싼 쪽 = 과소청구 방지)', () => {
    expect(guessAirportCode('인천공항 T2')).toBe('ICN');
    expect(guessAirportCode('ICN')).toBe('ICN');
    expect(guessAirportCode('제주공항')).toBe('ICN'); // 미지원 공항도 기본가로
  });

  it('공항 신호가 없으면 null (공항 서비스 아님)', () => {
    expect(guessAirportCode('강남 코엑스')).toBe(null);
    expect(guessAirportCode()).toBe(null);
    expect(guessAirportCode('', null, undefined)).toBe(null);
  });
});

// 🕘 AI 가 뽑은 시각을 버려서 운영자가 손으로 다시 치던 것 (2026-07-27).
describe('normalizeTimeHint — 시각 힌트 → HH:mm', () => {
  it('숫자 표기', () => {
    expect(normalizeTimeHint('9:30')).toBe('09:30');
    expect(normalizeTimeHint('09:30')).toBe('09:30');
    expect(normalizeTimeHint('15:05')).toBe('15:05');
    expect(normalizeTimeHint('7')).toBe('07:00');
  });

  it('한글 오전/오후', () => {
    expect(normalizeTimeHint('오후 3시')).toBe('15:00');
    expect(normalizeTimeHint('오후 3시 30분')).toBe('15:30');
    expect(normalizeTimeHint('오전 10시')).toBe('10:00');
    expect(normalizeTimeHint('오전 12시')).toBe('00:00'); // 자정
    expect(normalizeTimeHint('오후 12시')).toBe('12:00'); // 정오 — 24시로 넘기면 안 됨
    expect(normalizeTimeHint('9시')).toBe('09:00');
  });

  it('해석 불가/무효는 빈 문자열 (억지 추측 금지)', () => {
    expect(normalizeTimeHint('')).toBe('');
    expect(normalizeTimeHint(null)).toBe('');
    expect(normalizeTimeHint('아침 일찍')).toBe('');
    expect(normalizeTimeHint('25:00')).toBe('');
    expect(normalizeTimeHint('10:99')).toBe('');
  });
});

// ✈️ AI 예약이 방향을 아예 안 보내 전부 'pickup' 으로 저장되던 실버그 (2026-07-27).
describe('guessAirportDirection — 픽업/샌딩', () => {
  it('action 이 명시되면 그걸 따른다 (가장 강한 신호)', () => {
    expect(guessAirportDirection([{ isAirport: true, action: 'pickup' }, { isAirport: false, action: 'arrive' }])).toBe('pickup');
    expect(guessAirportDirection([{ isAirport: false, action: 'pickup' }, { isAirport: true, action: 'dropoff' }])).toBe('sending');
  });

  it('action 이 모호하면 위치로 — 뒤쪽이면 샌딩, 앞쪽이면 픽업', () => {
    // 공항이 마지막 = 공항으로 가는 것 = 샌딩
    expect(guessAirportDirection([{ isAirport: false, action: 'via' }, { isAirport: true, action: 'via' }])).toBe('sending');
    // 공항이 처음 = 공항에서 오는 것 = 픽업
    expect(guessAirportDirection([{ isAirport: true, action: 'via' }, { isAirport: false, action: 'via' }])).toBe('pickup');
  });

  it('공항 지점이 없으면 null', () => {
    expect(guessAirportDirection([{ isAirport: false, action: 'via' }])).toBe(null);
    expect(guessAirportDirection([])).toBe(null);
    expect(guessAirportDirection(null)).toBe(null);
  });
});

describe('guessService — 서비스 추천 우선순위 (airport>vehicle>manager)', () => {
  it('공항 포함이면 airport (vehicle보다 우선)', () => {
    expect(guessService(true, false)).toBe('airport');
    expect(guessService(true, true)).toBe('airport'); // 공항+이사님 동시라도 airport 우선
  });

  it('이사님 포함(공항 없음)이면 vehicle', () => {
    expect(guessService(false, true)).toBe('vehicle');
  });

  it('둘 다 없으면 manager (기본)', () => {
    expect(guessService(false, false)).toBe('manager');
  });
});

describe('salvageStopsFromTruncatedJson — 잘린 AI 응답 부분 회수 (2026-07-03 prod fix)', () => {
  // prod 재현: thinking 토큰이 maxOutputTokens 를 먹어 JSON 이 문자열 중간에서 잘림
  // → "SyntaxError: Unterminated string in JSON at position 156".
  const full = (stops: string) => `{"stops":[${stops}]}`;
  const s1 = '{"order":1,"rawText":"9:30 이사님 픽업","personOrPlace":"이사님","addressHint":"인천 강화군","action":"pickup","timeHint":"09:30"}';
  const s2 = '{"order":2,"rawText":"김포공항 드랍","personOrPlace":"김포공항","addressHint":"","action":"dropoff","timeHint":""}';

  it('문자열 중간에서 잘린 응답 → 완성된 앞쪽 stop 만 회수 (prod 케이스)', () => {
    const truncatedMidString = `{"stops":[${s1},{"order":2,"rawText":"서울시 영등포구 국제금융로 108-6(유진`;
    const out = salvageStopsFromTruncatedJson(truncatedMidString);
    expect(out).toHaveLength(1);
    expect(out[0].personOrPlace).toBe('이사님');
  });

  it('객체 경계에서 잘린 응답 → 완성된 stop 전부 회수', () => {
    const truncatedAtBoundary = `{"stops":[${s1},${s2},`;
    const out = salvageStopsFromTruncatedJson(truncatedAtBoundary);
    expect(out).toHaveLength(2);
    expect(out[1].personOrPlace).toBe('김포공항');
  });

  it('정상 완결 JSON 도 전체 회수 (배열 종료 인지)', () => {
    const out = salvageStopsFromTruncatedJson(full(`${s1},${s2}`));
    expect(out).toHaveLength(2);
  });

  it('문자열 안의 중괄호/이스케이프에 안 속는다', () => {
    const tricky = `{"stops":[{"order":1,"rawText":"괄호 {테스트} \\"인용\\"","personOrPlace":"강남역","addressHint":"","action":"via","timeHint":""}]}`;
    const out = salvageStopsFromTruncatedJson(tricky);
    expect(out).toHaveLength(1);
    expect(out[0].personOrPlace).toBe('강남역');
  });

  it('stops 배열이 없거나 쓰레기 입력이면 빈 배열', () => {
    expect(salvageStopsFromTruncatedJson('')).toEqual([]);
    expect(salvageStopsFromTruncatedJson('not json at all')).toEqual([]);
    expect(salvageStopsFromTruncatedJson('{"other":[1,2]}')).toEqual([]);
  });
});

// 🔴 2026-07-27 prod 사고: 파서가 NCP 키 목록을 복붙해 두고 VITE_NAVER_CLIENT_* 를 빠뜨려
//    geocodeConfigured=false → 주소 지오코딩을 아예 호출조차 안 함 → 완전한 도로명주소까지
//    전부 "주소 못 찾음"(5/5). mood-route 는 같은 주소를 정상 처리해 원인이 가려져 있었다.
//    키 해석은 mood-route 의 resolveNcpKeys 하나만 SSOT — 복제 금지.
describe('지오코딩 키 해석 SSOT — 키 목록 복제 금지 (2026-07-27 사고 잠금)', () => {
  const parseSrc = readFileSync(resolve(__dirname, '../../api/mood-parse-schedule.js'), 'utf8');

  it('파서는 process.env 로 NCP/NAVER 키를 직접 읽지 않는다', () => {
    // 주석 제외한 실제 코드 라인만 검사 (설명용 주석엔 키 이름이 등장한다).
    const code = parseSrc
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
      .join('\n');
    expect(code).not.toMatch(/process\.env\.(NCP|NAVER|VITE_NAVER)_CLIENT_(ID|SECRET)/);
  });

  it('파서는 키 해석이 내장된 geocodeAddress 를 쓴다', () => {
    expect(parseSrc).toMatch(/import\s*\{[^}]*geocodeAddress[^}]*\}\s*from\s*'\.\/_shared\/mood-route\.js'/);
    expect(parseSrc).toMatch(/await geocodeAddress\(/);
  });

  it('mood-route 의 키 폴백에 VITE_NAVER_CLIENT_* 가 살아 있다 (prod 유일 생존 키)', () => {
    const routeSrc = readFileSync(resolve(__dirname, '../../api/_shared/mood-route.js'), 'utf8');
    expect(routeSrc).toContain('VITE_NAVER_CLIENT_ID');
    expect(routeSrc).toContain('VITE_NAVER_CLIENT_SECRET');
  });
});

describe('thinkingBudget 소스 불변식 — truncation 근본원인 재발 방지', () => {
  // gemini-2.5-flash 는 thinking 토큰이 maxOutputTokens 에서 차감된다.
  // thinkingConfig 를 지우면 이 잠금이 터진다 (2026-07-03 prod "일정 해석 실패" 재발 방지).
  it('mood-parse-schedule 은 thinkingBudget: 0 을 유지해야 한다', () => {
    const src = readFileSync(resolve(__dirname, '../../api/mood-parse-schedule.js'), 'utf8');
    expect(src).toMatch(/thinkingConfig:\s*\{\s*thinkingBudget:\s*0\s*\}/);
  });

  it('ai-planner-quick 도 thinkingBudget: 0 을 유지해야 한다 (동일 잠복버그)', () => {
    const src = readFileSync(resolve(__dirname, '../../api/ai-planner-quick.js'), 'utf8');
    expect(src).toMatch(/thinkingConfig:\s*\{\s*thinkingBudget:\s*0\s*\}/);
  });
});

describe('matchStopPlaces — 명시 장소 > 사람 우선순위 (2026-07-03 주소록 오위치 돈버그 방지)', () => {
  // 실사례: "9:50am 르픽(정유진 픽업)" — 정유진을 '르픽에서' 태움.
  // 사람 매칭이 이기면 픽업 위치가 정유진 집으로 잡혀 km·요금 오계산.
  const book = [
    { name: '정유진', nameNorm: '정유진', address: '서울시 영등포구 국제금융로 108-6', lat: null, lng: null, isDirector: false },
    { name: '르픽', nameNorm: '르픽', address: '서울특별시 강남구 도산대로78길 14 2층', lat: 37.5230867, lng: 127.0468013, isDirector: false },
    { name: '이사님', nameNorm: '이사님', address: '인천 강화군 불은면', lat: 37.6, lng: 126.4, isDirector: true },
    { name: '김포공항', nameNorm: '김포공항', address: '서울특별시 강서구 하늘길 38', lat: 37.5668999, lng: 126.8012509, isDirector: false },
    { name: '김포공항 국내선', nameNorm: '김포공항 국내선', address: '서울특별시 강서구 하늘길 111', lat: 37.5587816, lng: 126.803009, isDirector: false },
  ];
  const m = (person: string, hint: string) => matchStopPlaces(person, hint, book);

  it("'르픽(정유진 픽업)' → 위치는 르픽 (사람 집 아님)", () => {
    const { matched } = m('정유진', '르픽');
    expect(matched?.name).toBe('르픽');
    expect(matched?.lat).toBe(37.5230867);
  });

  it('장소힌트 없으면 사람 매칭 → 집 주소 (기존 동작 보존)', () => {
    const { matched } = m('정유진', '');
    expect(matched?.name).toBe('정유진');
  });

  it("'르픽(이사님 픽업)' → 위치=르픽 이지만 이사님 신호(차량 판별)는 유지", () => {
    const { matched, directorSignal } = m('이사님', '르픽');
    expect(matched?.name).toBe('르픽');
    expect(directorSignal).toBe(true);
  });

  it('이사님 단독(장소힌트 미등록 주소)이면 이사님 매칭 + 신호', () => {
    const { matched, directorSignal } = m('이사님', '인천 강화군 불은면 어딘가');
    expect(matched?.name).toBe('이사님');
    expect(directorSignal).toBe(true);
  });

  it("plain '김포공항' 힌트는 국내선/국제선 모호성 없이 정확 일치 (대표 항목)", () => {
    const { matched } = m('헤메실장님', '김포공항');
    expect(matched?.name).toBe('김포공항');
  });

  it('둘 다 미매칭이면 matched=null (→ geocode 경로)', () => {
    const { matched, directorSignal } = m('강남 코엑스', '');
    expect(matched).toBeNull();
    expect(directorSignal).toBe(false);
  });
});

describe('coordFromPlaceDoc — 손상 좌표 무효화 (2026-07-03 null-island 돈버그 방지)', () => {
  it('정상 한국 좌표는 그대로', () => {
    expect(coordFromPlaceDoc({ lat: 37.5230867, lng: 127.0468013 })).toEqual({ lat: 37.5230867, lng: 127.0468013 });
  });

  it('🔴 (0,0) null-island 은 무효 → {null,null} (geocode 경로로)', () => {
    expect(coordFromPlaceDoc({ lat: 0, lng: 0 })).toEqual({ lat: null, lng: null });
  });

  it('lat/lng null·undefined·누락 → {null,null} (Number(null)=0 함정 차단)', () => {
    expect(coordFromPlaceDoc({ lat: null, lng: null })).toEqual({ lat: null, lng: null });
    expect(coordFromPlaceDoc({ address: 'x' })).toEqual({ lat: null, lng: null });
    expect(coordFromPlaceDoc({})).toEqual({ lat: null, lng: null });
    expect(coordFromPlaceDoc(null)).toEqual({ lat: null, lng: null });
  });

  it('문자열 좌표("37.5")도 무효 — number 타입만 신뢰', () => {
    expect(coordFromPlaceDoc({ lat: '37.5', lng: '127.0' })).toEqual({ lat: null, lng: null });
  });

  it('한국 범위 밖(해외·NaN)은 무효', () => {
    expect(coordFromPlaceDoc({ lat: 48.85, lng: 2.35 })).toEqual({ lat: null, lng: null }); // 파리
    expect(coordFromPlaceDoc({ lat: NaN, lng: 127 })).toEqual({ lat: null, lng: null });
    expect(coordFromPlaceDoc({ lat: 37.5, lng: null })).toEqual({ lat: null, lng: null }); // 한쪽만
  });
});

describe('별칭 매칭 — expandPlaceEntries + key 기반 모호성 (2026-07-04 PR1-B)', () => {
  it('별칭 각각이 같은 장소(대표명·주소·key)로 매칭', async () => {
    const { expandPlaceEntries, matchPlacebook } = await import('../../api/mood-parse-schedule.js');
    const entries = expandPlaceEntries('doc-t2', {
      name: '인천공항 T2', address: '인천 영종구 제2터미널대로 446', lat: 37.4689, lng: 126.4333,
      aliases: ['인천공항 터미널2', '제2여객터미널'],
    });
    expect(entries).toHaveLength(3);
    const m = matchPlacebook('인천공항 터미널2', entries);
    expect(m?.name).toBe('인천공항 T2'); // 표시는 대표명
    expect(m?.lat).toBe(37.4689);
  });

  it('같은 장소의 별칭 여러 개가 포함매칭에 걸려도 모호 아님 (key 판정)', async () => {
    const { expandPlaceEntries, matchPlacebook } = await import('../../api/mood-parse-schedule.js');
    const entries = expandPlaceEntries('doc-cs', {
      name: '최수현', address: '서울 송파구 잠실로 62', lat: 37.5099, lng: 127.0872,
      aliases: ['트리지움아파트', '트리지움아파트 서문'],
    });
    // q='트리지움아파트' → 별칭 2개(트리지움아파트·트리지움아파트 서문)가 p⊇q 로 걸리지만 같은 doc → 매칭 OK
    const m = matchPlacebook('트리지움아파트', entries);
    expect(m?.name).toBe('최수현');
  });

  it('서로 다른 장소 2곳이면 여전히 모호 → null (기존 안전규칙 보존)', async () => {
    const { expandPlaceEntries, matchPlacebook } = await import('../../api/mood-parse-schedule.js');
    const a = expandPlaceEntries('doc-a', { name: '정유진', address: 'x', lat: 37.5, lng: 127 });
    const b = expandPlaceEntries('doc-b', { name: '김유진', address: 'y', lat: 37.6, lng: 127.1 });
    expect(matchPlacebook('유진', [...a, ...b])).toBeNull();
  });

  it('인천공항 시나리오 — 대표 항목 + T1/T2 별칭으로 스샷 3케이스 전부 매칭', async () => {
    const { expandPlaceEntries, matchPlacebook } = await import('../../api/mood-parse-schedule.js');
    const book = [
      ...expandPlaceEntries('rep', { name: '인천공항', address: 'T1주소', lat: 37.44, lng: 126.45, aliases: ['인천국제공항', 'ICN'] }),
      ...expandPlaceEntries('t1', { name: '인천공항 T1', address: 'T1주소', lat: 37.44, lng: 126.45, aliases: ['인천공항 터미널1', '제1여객터미널'] }),
      ...expandPlaceEntries('t2', { name: '인천공항 T2', address: 'T2주소', lat: 37.46, lng: 126.43, aliases: ['인천공항 터미널2', '제2여객터미널'] }),
    ];
    expect(matchPlacebook('인천공항', book)?.name).toBe('인천공항');      // 정확 일치 — T1/T2 모호성 안 탐
    expect(matchPlacebook('인천공항 터미널2', book)?.name).toBe('인천공항 T2');
    expect(matchPlacebook('인천공항 터미널1', book)?.name).toBe('인천공항 T1');
  });

  it('searchGuessed 배선 소스 불변식 — 폴백 성공 시 플래그+주소 채움', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/mood-parse-schedule.js'), 'utf8');
    expect(src).toMatch(/searchPlaceFallback/);
    expect(src).toMatch(/searchGuessed = true;/);
    expect(src).toMatch(/resolveCredentialCandidates/);
  });
});

describe('날짜 해석 resolveDateHint (2026-07-05 PR3)', () => {
  it('다양한 표기 → ISO', async () => {
    const { resolveDateHint } = await import('../../api/mood-parse-schedule.js');
    const today = '2026-07-05';
    expect(resolveDateHint('7/15', today)).toBe('2026-07-15');
    expect(resolveDateHint('7월 15일', today)).toBe('2026-07-15');
    expect(resolveDateHint('7월15일', today)).toBe('2026-07-15');
    expect(resolveDateHint('07.15', today)).toBe('2026-07-15');
    expect(resolveDateHint('2027-01-05', today)).toBe('2027-01-05');
  });

  it('연도 추론 — 90일 넘게 과거면 내년 (12월에 받은 1/5 = 내년 1월)', async () => {
    const { resolveDateHint } = await import('../../api/mood-parse-schedule.js');
    expect(resolveDateHint('1/5', '2026-12-20')).toBe('2027-01-05');
    // 어제(같은 달) 는 올해 그대로 — 지난 날짜 기록도 정확히
    expect(resolveDateHint('7/4', '2026-07-05')).toBe('2026-07-04');
  });

  it('해석 불가/무효 날짜 → null (기존 단일날짜 흐름 유지)', async () => {
    const { resolveDateHint } = await import('../../api/mood-parse-schedule.js');
    expect(resolveDateHint('', '2026-07-05')).toBeNull();
    expect(resolveDateHint('다음주 화요일', '2026-07-05')).toBeNull();
    expect(resolveDateHint('2/30', '2026-07-05')).toBeNull();
    expect(resolveDateHint('13/40', '2026-07-05')).toBeNull();
  });
});

describe('항공편 정제 sanitizeFlights (2026-07-05 PR3)', () => {
  it('유효 편명만 통과 (대문자화·공백제거·중복제거·상한 8)', async () => {
    const { sanitizeFlights } = await import('../../api/mood-parse-schedule.js');
    const out = sanitizeFlights([
      { flightNo: 'ke765', timeHint: '15:10', dateHint: '7/15' },
      { flightNo: 'KE 765', timeHint: '15:10', dateHint: '7/15' }, // 중복 (공백 제거 후)
      { flightNo: '7C1301', timeHint: '', dateHint: '' },
      { flightNo: '무효편명', timeHint: '', dateHint: '' },
      { flightNo: '12345', timeHint: '', dateHint: '' }, // 숫자만 = 무효
    ]);
    expect(out.map((f: { flightNo: string }) => f.flightNo)).toEqual(['KE765', '7C1301']);
  });

  it('배열 아님/빈 입력 → []', async () => {
    const { sanitizeFlights } = await import('../../api/mood-parse-schedule.js');
    expect(sanitizeFlights(null)).toEqual([]);
    expect(sanitizeFlights('KE765')).toEqual([]);
  });
});
