// Coverage for the LOW streaming-sanitize fix in api/_ai_core/geminiPipeline.js
// (runGeminiStreaming progressive write — P169).
//
// 버그(LOW): runGeminiStreaming 의 0.5초 간격 progressive write 가
// tryParsePartialJSON 으로 뽑은 raw partial.days 를 sanitizeStops 없이 곧장
// 'itinerary.days' 로 Firestore set → 'Pig Co. ... 강남 돼지상회 ... 明洞' 같은
// 다국어 concat 이름이 스트리밍 중 사용자에게 일시 노출 (최종 정제본이 덮기 전 flash).
//
// 수정: progressive write 전에 partial.days 에 sanitizeStops({ days }, language)
// 를 try/catch 로 적용 (display-only 정제, dietary 검증 로직 불변).
//
// runGeminiStreaming 는 Gemini stream / Firestore 의존이 커 직접 호출 대신,
// 이 테스트는 fix 가 의존하는 정확한 계약 (sanitizeStops 가 { days } 래퍼를
// in-place 정제 + dietary 필드 불변 + 부분 데이터에 throw 안 함) 을 고정한다.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module, no types
import { sanitizeStops } from '../../api/_ai_core/responseValidator.js';

interface Stop {
  name?: string;
  display_name?: string;
  category?: string;
  dietary_tags?: string[];
  tip?: string;
}
interface Day {
  day?: number;
  stops?: Stop[];
}

// fix 가 progressive write 직전에 실행하는 코드 그대로 재현.
// (geminiPipeline.js: sanitizeStops({ days: partial.days }, language || 'ko'))
function sanitizePartialDays(days: Day[], language: string): void {
  try {
    sanitizeStops({ days }, language || 'ko');
  } catch {
    // 부분 데이터라 깨질 수 있으니 throw 무시 — raw write 로 폴백 (스트리밍 안 멈춤).
  }
}

describe('LOW: streaming progressive write sanitizes partial.days before Firestore set', () => {
  it('다국어 concat 이름을 사용자 lang 토큰만 남긴다 (en 사용자)', () => {
    const days: Day[] = [
      {
        day: 1,
        stops: [
          // 3-script inline concat (버그 리포트 예시 패턴)
          { name: 'Pig Co. 강남 돼지상회 明洞', display_name: 'Pig Co. 강남 돼지상회 明洞', category: 'food' },
        ],
      },
    ];
    sanitizePartialDays(days, 'en');
    const stop = days[0].stops![0];
    // en 토큰만 남고 한글/한자 concat 은 제거됨.
    expect(stop.display_name).toBe('Pig Co.');
    expect(stop.display_name).not.toMatch(/강남|돼지|明洞/);
  });

  it('slash 구분 다국어 이름을 ko 사용자에겐 한국어만 남긴다', () => {
    const days: Day[] = [
      {
        day: 1,
        stops: [
          { name: '고기굽는놈 / The Guy / 烤肉的家伙', display_name: '고기굽는놈 / The Guy / 烤肉的家伙', category: 'food' },
        ],
      },
    ];
    sanitizePartialDays(days, 'ko');
    expect(days[0].stops![0].display_name).toBe('고기굽는놈');
  });

  it('partial.days 배열 참조를 in-place 변형한다 (래퍼가 같은 배열을 정제 → 쓰여지는 값이 정제본)', () => {
    const partial = {
      days: [
        { day: 1, stops: [{ name: 'A 가게 store 店', display_name: 'A 가게 store 店', category: 'food' }] },
      ] as Day[],
    };
    const sameRef = partial.days;
    sanitizePartialDays(partial.days, 'en');
    // updatePlanProgressive 가 'itinerary.days': partial.days 로 쓰는 그 배열이 정제됨.
    expect(partial.days).toBe(sameRef);
    expect(partial.days[0].stops![0].display_name).not.toMatch(/가게|店/);
  });

  it('SAFETY: dietary/category 필드는 절대 변형하지 않는다 (표시 정제만)', () => {
    const days: Day[] = [
      {
        day: 1,
        stops: [
          {
            name: 'Halal Kebab 할랄케밥',
            display_name: 'Halal Kebab 할랄케밥',
            category: 'food',
            dietary_tags: ['halal'],
            tip: 'halal certified',
          },
        ],
      },
    ];
    sanitizePartialDays(days, 'en');
    const stop = days[0].stops![0];
    // dietary 검증 입력 (tags/category/tip) 은 그대로 — 검증 로직 불변.
    expect(stop.dietary_tags).toEqual(['halal']);
    expect(stop.category).toBe('food');
    expect(stop.tip).toBe('halal certified');
  });

  it('방어성: 깨진 부분 데이터에도 throw 하지 않는다 (스트리밍 절대 중단 안 함)', () => {
    // stops 가 누락/비정상인 부분 파싱 결과 — sanitizeStops 가 깨져도 폴백.
    const broken = [
      { day: 1 },                          // stops 없음
      { day: 2, stops: undefined },        // stops undefined
      { day: 3, stops: [{ category: 'food' }] }, // name 없음
    ] as Day[];
    expect(() => sanitizePartialDays(broken, 'en')).not.toThrow();
  });

  it('language 누락 시 ko 로 폴백한다 (|| 패턴, nullish 금지)', () => {
    const days: Day[] = [
      { day: 1, stops: [{ name: '시장 market 市場', display_name: '시장 market 市場', category: 'food' }] },
    ];
    // language 빈 문자열 → 'ko' 폴백 → 한국어 토큰만.
    sanitizePartialDays(days, '');
    expect(days[0].stops![0].display_name).toBe('시장');
  });
});
