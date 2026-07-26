// profilePrefill — 가입 프로필(users/{uid}) → 예약 폼 기본값 채우기 (순수 함수). 2026-06-11.
//
// 운영자 비전: "가입할 때 넣은 정보가 차터·투어 예약 때 기본으로 채워져야". fable 워크플로우 종합+적대검증.
// 🔴 핵심 원칙 (fill-only-empty + one-shot): 현재 값이 "빈" 필드만 프로필로 채운다. 사용자가 친 값/
//    localStorage 직전입력은 절대 안 덮음. 돈 코어 무관(폼 기본값만, 전부 수정 가능). 실패=현행(빈칸).
//
// critique fix:
//  #2 "빈" 정의 = null/undefined/공백 (charter customerName/Phone 은 키 자체가 undefined 로 시작 — '' 만 보면 누락).
//     프로필 쪽 빈 값(phone 미저장 / 기존 회원 nickname 부재)도 주입 금지(controlled-input 경고 방지).
//  #3 trunk-zero(선행 0) strip 을 KR 특례가 아닌 전 국가 공통(JP 090→+8190 등 — 나이브 prepend 시 오번호가 기사 배차에 들어감).

import { isValidInternationalPhone } from '@/lib/phone-validation';

// 프로필 countryCode → 국제 다이얼 코드.
const DIAL_CODE: Record<string, string> = {
  KR: '+82', US: '+1', JP: '+81', CN: '+86', SG: '+65',
  TH: '+66', VN: '+84', MY: '+60', PH: '+63',
};

/** 값이 "빈" 인지 — null/undefined/공백 문자열. (charter 필드는 undefined 로 시작하므로 필수.) */
export function isEmptyVal(v: unknown): boolean {
  return v == null || String(v).trim() === '';
}

/**
 * 국제전화 형식 보정. '+' 로 시작하면 그대로. 아니면 선행 0(trunk prefix) 하나 제거 후 countryCode
 * 다이얼코드 prepend. countryCode 미상/OTHER 면 원본 유지(보정 안 함 — 사용자 수정 + 기존 검증이 막음).
 * @example normalizeProfilePhone('010-1234-5678','KR') → '+821012345678'
 * @example normalizeProfilePhone('09012345678','JP')  → '+819012345678'  // 전 국가 trunk-0 strip
 * @example normalizeProfilePhone('+6591234567','SG')  → '+6591234567'    // 이미 국제형식
 */
export function normalizeProfilePhone(phone: string | null | undefined, countryCode?: string | null): string {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  const dial = countryCode ? DIAL_CODE[countryCode] : undefined;
  if (!dial) return raw; // 미상/OTHER → 보정 스킵, 원본 주입
  const digits = raw.replace(/[^\d]/g, '').replace(/^0/, ''); // 비숫자 제거 + 선행 trunk 0 하나 제거(전 국가)
  return digits ? `${dial}${digits}` : raw;
}

/**
 * current 의 "빈" 필드만 source 의 "비지 않은" 값으로 채운 새 객체 반환. 채울 게 없으면 current 그대로(===).
 * 사용자 입력/localStorage 우선 보장 + 프로필 빈 값 주입 차단.
 */
export function mergeProfileDefaults<T extends object>(
  current: T,
  source: Partial<Record<keyof T, unknown>>,
  fields: (keyof T)[],
): T {
  let next: T | null = null;
  for (const f of fields) {
    const cur = (current as Record<string, unknown>)[f as string];
    if (isEmptyVal(cur) && !isEmptyVal(source[f])) {
      if (!next) next = { ...current };
      (next as Record<string, unknown>)[f as string] = source[f];
    }
  }
  return next || current;
}

/**
 * 프로필에 저장할 전화번호를 결정한다. 저장 안 함이면 null.
 * useProfileContactSync 의 유일한 분기 로직 — 여기(firebase-free 모듈)에 둔 이유는
 * 훅이 lib/firebase 를 import 하는데 CI 는 FIREBASE_* env 가 없어 getAuth() 가 throw 하고,
 * 그러면 테스트 파일이 **수집 단계에서 통째로 죽기** 때문이다(tourBookingValidation.ts 와 동일 사유).
 *
 * @param raw   폼이 들고 있는 전화번호 (미입력/부분입력 가능)
 * @param saved 이 세션에서 이미 저장한 값 (없으면 null)
 */
export function nextPhoneToPersist(
  raw: string | null | undefined,
  saved: string | null,
): string | null {
  // 레포 pre-commit 가드가 nullish coalescing 을 막는다 → || 사용.
  // 여기선 빈 문자열도 "미입력"이라 동치라 의미 차이가 없다.
  const v = (raw || '').trim();
  if (!v) return null;                             // 미입력 — 기존 값 덮어쓰지 않음
  if (!isValidInternationalPhone(v)) return null;  // 입력 중(부분 문자열) 저장 방지
  if (v === saved) return null;                    // 같은 값 재쓰기 차단
  return v;
}
