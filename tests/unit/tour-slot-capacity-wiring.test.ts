/**
 * 투어 슬롯 정원(capacity) 배선 — 죽어 있던 오버부킹 방지 활성화 (2026-08-08).
 *
 * 🔴 고친 문제
 *   - 백엔드는 완성돼 있었다: `api/_shared/slot-capacity.js` 의 acquireSlotLock/confirmSlotLock 가
 *     트랜잭션으로 pending/confirmed 를 세고 정원 초과면 SLOT_FULL 로 주문 생성 자체를 막는다.
 *   - 그런데 두 endpoint 는 **body 에 tourId·tourSlotId·bookingDate·slotCapacity 4개가 전부
 *     있을 때만** 그 잠금을 호출하고, 없으면 조용히 스킵한다.
 *   - 프론트(TourBookingDialog)는 고른 슬롯을 결제 메모 문자열에만 넣고 4필드를 안 보냈다
 *     (`// TODO: slot id forward to backend`) → 정원 강제가 한 번도 걸린 적이 없다 = 오버부킹 가능.
 *
 * 검증 방식
 *   - 순수 로직(tourSlotBody · resolveSlotCapacity · 4언어 라벨)은 firebase-free 모듈
 *     `src/lib/tourSlotBooking.ts` 를 직접 호출해 실행 검증한다.
 *   - 컴포넌트 배선(create/capture body 스프레드 · SLOT_FULL 분기 위치 · dialog 4필드 전달)은
 *     **소스 단언**으로 검증한다. 컴포넌트를 import 하면 CI(firebase 키 없음)에서 getAuth() throw
 *     → 스위트 통째 "0 test" crash (lint R_Phase1_testNoFirebaseClientImport, PR-B/PR-F 재발 class).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tourSlotBody, resolveSlotCapacity, SLOT_REJECT_LABELS } from '../../src/lib/tourSlotBooking';

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** 백엔드가 읽는 이름 — 이 배열이 곧 계약이다. */
const BACKEND_KEYS = ['bookingDate', 'slotCapacity', 'tourId', 'tourSlotId'] as const;

const SLOT_FIELDS = {
  tourId: 'tour_admin_abc',
  tourSlotId: 'slot_am',
  bookingDate: '2026-09-01',
  slotCapacity: 8,
};

describe('tourSlotBody — 4필드 all-or-nothing (백엔드 게이트와 동형)', () => {
  it('4개 전부 유효하면 그대로 실어 보낸다', () => {
    expect(tourSlotBody(SLOT_FIELDS)).toEqual(SLOT_FIELDS);
  });

  it('반환 키는 백엔드가 읽는 이름과 정확히 일치한다', () => {
    expect(Object.keys(tourSlotBody(SLOT_FIELDS)).sort()).toEqual([...BACKEND_KEYS]);
  });

  it('하나라도 없으면 빈 객체 — 반쪽 전송 금지(백엔드가 조용히 스킵하는 상태를 만들지 않는다)', () => {
    for (const k of BACKEND_KEYS) {
      const partial: Record<string, unknown> = { ...SLOT_FIELDS };
      delete partial[k];
      expect(tourSlotBody(partial), `${k} 없을 때 빈 객체여야 한다`).toEqual({});
    }
    expect(tourSlotBody(undefined)).toEqual({});
    expect(tourSlotBody({})).toEqual({});
  });

  it('capacity 가 0·음수·NaN 이면 보내지 않는다 (0 = 백엔드에서 전원 차단)', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(tourSlotBody({ ...SLOT_FIELDS, slotCapacity: bad })).toEqual({});
    }
  });

  it('공백 문자열은 값이 아니다', () => {
    expect(tourSlotBody({ ...SLOT_FIELDS, tourSlotId: '   ' })).toEqual({});
    expect(tourSlotBody({ ...SLOT_FIELDS, bookingDate: '' })).toEqual({});
  });

  it('슬롯 없는 상품(AI 플래너·차터)은 빈 객체 = 기존 동작 보존', () => {
    expect(tourSlotBody({ bookingDate: '2026-09-01' })).toEqual({});
  });
});

describe('resolveSlotCapacity — 슬롯 정원 출처', () => {
  it('슬롯에 capacity 가 있으면 그 값', () => {
    expect(resolveSlotCapacity(4, 7)).toBe(4);
  });

  it('슬롯 capacity 미설정이면 tour.maxPax 폴백 (slot-capacity.js·validateSlotNumeric 이 명시한 규칙)', () => {
    expect(resolveSlotCapacity(undefined, 7)).toBe(7);
    expect(resolveSlotCapacity(null, 7)).toBe(7);
  });

  it('둘 다 없으면 undefined — tourSlotBody 가 전송을 막는다', () => {
    expect(resolveSlotCapacity(undefined, undefined)).toBeUndefined();
    expect(resolveSlotCapacity(0, 0)).toBeUndefined();
  });
});

describe('정원 거절 안내 — 4개 언어 (서버 진단 영어 노출 금지)', () => {
  it('ko/en/ja/zh 두 코드 모두 비어 있지 않다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const l = SLOT_REJECT_LABELS[lang];
      expect(l, `${lang} 라벨 없음`).toBeTruthy();
      expect(l.SLOT_FULL.length, `${lang} SLOT_FULL 문구 부실`).toBeGreaterThan(10);
      expect(l.DATE_UNAVAILABLE.length, `${lang} DATE_UNAVAILABLE 문구 부실`).toBeGreaterThan(10);
    }
  });

  it('서버 진단 문구를 그대로 베끼지 않았다 (손님이 읽을 말이어야 한다)', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const l = SLOT_REJECT_LABELS[lang];
      expect(l.SLOT_FULL).not.toContain('requested=');
      expect(l.SLOT_FULL).not.toContain('capacity=');
      expect(l.DATE_UNAVAILABLE).not.toContain('fully_booked');
    }
  });

  it('언어별로 서로 다른 문구다 (한 언어를 복붙해 4개를 채우지 않았다)', () => {
    const full = (['ko', 'en', 'ja', 'zh'] as const).map((l) => SLOT_REJECT_LABELS[l].SLOT_FULL);
    expect(new Set(full).size).toBe(4);
  });

  it('한국어는 "마감", 영어는 재선택을 안내한다', () => {
    expect(SLOT_REJECT_LABELS.ko.SLOT_FULL).toContain('마감');
    expect(SLOT_REJECT_LABELS.en.SLOT_FULL.toLowerCase()).toContain('choose another');
  });
});

describe('필드명 파리티 — 프론트 키 == 백엔드가 읽는 이름', () => {
  const createSrc = src('api/createPaypalOrder.js');
  const captureSrc = src('api/capturePaypalOrder.js');

  it('createPaypalOrder 가 body 에서 같은 이름으로 읽는다', () => {
    for (const k of Object.keys(tourSlotBody(SLOT_FIELDS))) {
      expect(createSrc, `createPaypalOrder 가 body.${k} 를 읽지 않는다`).toContain(`body.${k}`);
    }
  });

  it('capturePaypalOrder 가 body 에서 같은 이름으로 구조분해한다', () => {
    expect(captureSrc).toMatch(/tourId,\s*tourSlotId,\s*bookingDate,\s*slotCapacity,/);
    for (const k of Object.keys(tourSlotBody(SLOT_FIELDS))) {
      expect(captureSrc, `capturePaypalOrder 가 ${k} 를 안 읽는다`).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it('백엔드 잠금 호출이 살아 있다 (헬퍼만 남고 호출이 사라지면 다시 죽은 배선)', () => {
    expect(createSrc).toMatch(/await acquireSlotLock\(/);
    expect(captureSrc).toMatch(/await confirmSlotLock\(/);
  });
});

describe('PayPalBookingButton 배선 (소스 잠금 — 컴포넌트 import 금지 규칙 때문)', () => {
  const btn = src('src/components/PayPalBookingButton.tsx');

  it('4필드를 props 로 받아 firebase-free 헬퍼로 한 번만 조립한다', () => {
    expect(btn).toMatch(/options,\s*tourId,\s*tourSlotId,\s*bookingDate,\s*slotCapacity\s*\}: Props/);
    expect(btn).toMatch(
      /const slotFields = tourSlotBody\(\{ tourId, tourSlotId, bookingDate, slotCapacity \}\)/,
    );
  });

  it('🔴 create 와 capture **두 요청 모두**에 실린다 (한쪽만이면 pending 이 confirmed 로 안 넘어간다)', () => {
    const spreads = btn.match(/\.\.\.slotFields/g) || [];
    expect(spreads.length, '...slotFields 는 정확히 2곳(capture body · create body)').toBe(2);

    // 이 파일에서 capture body(onApprove) 가 create body(handleBookClick) 보다 앞에 온다.
    const captureUrl = btn.indexOf("'/api/capturePaypalOrder'");
    const createUrl = btn.indexOf("'/api/createPaypalOrder'");
    expect(captureUrl).toBeGreaterThan(-1);
    expect(createUrl).toBeGreaterThan(captureUrl);

    const first = btn.indexOf('...slotFields');
    const second = btn.indexOf('...slotFields', first + 1);
    expect(first, 'capture body 안에 없다').toBeGreaterThan(captureUrl);
    expect(first, 'capture 요청 밖으로 새어 나갔다').toBeLessThan(createUrl);
    expect(second, 'create body 안에 없다').toBeGreaterThan(createUrl);
  });

  it('🔴 SLOT_FULL/DATE_UNAVAILABLE 분기가 generic throw 보다 **앞**에 있다 (뒤면 서버 영어가 이긴다)', () => {
    const branch = btn.indexOf("json.code === 'SLOT_FULL'");
    const genericThrow = btn.indexOf("throw new Error(json.error");
    expect(branch, 'SLOT_FULL 분기 없음').toBeGreaterThan(-1);
    expect(btn).toContain("json.code === 'DATE_UNAVAILABLE'");
    expect(genericThrow).toBeGreaterThan(-1);
    expect(branch, '분기가 generic throw 뒤에 있으면 손님이 진단 영어를 본다').toBeLessThan(genericThrow);
  });

  it('안내 문구는 firebase-free 모듈에서 가져온다 (테스트가 컴포넌트 없이 4언어를 검증 가능)', () => {
    expect(btn).toMatch(/import \{ tourSlotBody, SLOT_REJECT_LABELS \} from '@\/lib\/tourSlotBooking'/);
    expect(btn).toMatch(/SLOT_REJECT_LABELS\[lang\] \|\| SLOT_REJECT_LABELS\.en/);
  });
});

describe('서버 정원 재확인 배선 — createPaypalOrder (소스 잠금, 2026-08-08)', () => {
  // body.slotCapacity 는 클라이언트 출처 — 부풀린 정원(999)이 그대로 잠금 기준이 되던
  // 신뢰모델을 제거한다. 원본 = tours/{tourId}.slots[] (+maxPax 폴백). cart 형제 경로는
  // cart-slot-capacity-wiring.test.ts 가 같은 계약을 잠근다(한쪽만 고침 금지).
  const create = src('api/createPaypalOrder.js');

  it('공유 헬퍼 fetchServerSlotCapacity 를 잠금 **전**에 호출한다 (사본 금지)', () => {
    expect(create).toMatch(/import \{[^}]*fetchServerSlotCapacity[^}]*\} from '\.\/_shared\/slot-capacity\.js'/);
    const verify = create.indexOf('await fetchServerSlotCapacity(');
    const acquire = create.indexOf('await acquireSlotLock(');
    expect(verify, '서버 재확인 호출 없음').toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(-1);
    expect(verify, '검증이 잠금보다 뒤면 부풀린 정원으로 잠근다').toBeLessThan(acquire);
  });

  it('🔴 잠금에 쓰는 정원 = 서버 검증값 (body 값 그대로 전달 금지)', () => {
    expect(create).toMatch(/capacity: effectiveCapacity/);
    expect(create).not.toMatch(/capacity: slotCapacity,/);
  });

  it('결정적 검증 실패(투어/슬롯 없음·꺼짐·정원 미설정)는 PayPal 주문 생성 전에 거부한다', () => {
    const verify = create.indexOf('await fetchServerSlotCapacity(');
    const reject = create.indexOf('slot capacity verify rejected', verify);
    expect(reject, 'fail-closed 거부 경로 없음').toBeGreaterThan(-1);
    expect(reject).toBeLessThan(create.indexOf('/v2/checkout/orders'));
  });

  it('Firestore 조회 장애만 body 값으로 후퇴한다 (결정적 거부와 구분 — 오늘보다 나빠지지 않음)', () => {
    expect(create).toContain('body 값으로 후퇴');
  });
});

describe('TourBookingDialog 배선 (소스 잠금)', () => {
  const dialog = src('src/components/tours/TourBookingDialog.tsx');

  it('죽은 TODO 가 사라졌다', () => {
    expect(dialog).not.toContain('TODO: slot id forward to backend');
  });

  it('슬롯이 선택됐고 정원이 해석됐을 때만 4필드를 넘긴다', () => {
    expect(dialog).toMatch(/selectedSlot\s*&&\s*slotCapacityForOrder\s*!==\s*undefined/);
    expect(dialog).toContain('tourId: tour.id');
    expect(dialog).toContain('tourSlotId: selectedSlot.id');
    expect(dialog).toContain('bookingDate: date');
    expect(dialog).toContain('slotCapacity: slotCapacityForOrder');
  });

  it('정원은 헬퍼로 해석한다 (capacity 미설정 슬롯의 maxPax 폴백을 인라인 재구현 금지)', () => {
    expect(dialog).toMatch(/resolveSlotCapacity\(selectedSlot\?\.capacity, tour\.maxPax\)/);
    expect(dialog).toMatch(/from '@\/lib\/tourSlotBooking'/);
  });
});
