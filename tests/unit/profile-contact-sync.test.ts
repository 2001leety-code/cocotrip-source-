// nextPhoneToPersist — 프로필 연락처 저장 판단 (useProfileContactSync 의 유일한 분기 로직).
//
// 이 가드가 깨지면 실제로 나는 사고:
//  - 형식 검증이 빠지면 사용자가 타이핑하는 중간 문자열("+8210", "+82101")마다 Firestore
//    쓰기가 발생한다(글자당 1 write).
//  - 중복 차단이 빠지면 리렌더마다 같은 값을 다시 쓴다.
//  - 빈 값 가드가 빠지면 폼을 비운 사용자의 기존 프로필 번호가 지워진다.
import { describe, it, expect } from 'vitest';
// 🔴 훅(useProfileContactSync)이 아니라 firebase-free 모듈에서 import 한다.
//    훅은 lib/firebase 를 끌어오는데 CI 는 FIREBASE_* env 가 없어 getAuth() 가 throw →
//    테스트 파일이 수집 단계에서 통째로 죽는다(2026-07-26 CI 실패로 실측).
import { nextPhoneToPersist } from '@/lib/profilePrefill';

const VALID = '+821012345678';

describe('nextPhoneToPersist', () => {
  it('유효한 국제번호 + 미저장 → 저장한다', () => {
    expect(nextPhoneToPersist(VALID, null)).toBe(VALID);
  });

  it('같은 값이 이미 저장돼 있으면 재쓰기 안 한다', () => {
    expect(nextPhoneToPersist(VALID, VALID)).toBeNull();
  });

  it('값이 바뀌면 다시 저장한다', () => {
    expect(nextPhoneToPersist('+819012345678', VALID)).toBe('+819012345678');
  });

  it('빈 값/공백/null 은 저장 안 한다 — 기존 프로필 번호를 지우면 안 됨', () => {
    expect(nextPhoneToPersist('', null)).toBeNull();
    expect(nextPhoneToPersist('   ', null)).toBeNull();
    expect(nextPhoneToPersist(null, VALID)).toBeNull();
    expect(nextPhoneToPersist(undefined, VALID)).toBeNull();
  });

  it('입력 중인 부분 문자열은 저장 안 한다 — 글자당 write 방지', () => {
    expect(nextPhoneToPersist('+', null)).toBeNull();
    expect(nextPhoneToPersist('+82', null)).toBeNull();
    expect(nextPhoneToPersist('+821', null)).toBeNull();
    expect(nextPhoneToPersist('010', null)).toBeNull();
  });

  it('앞뒤 공백은 trim 해서 저장한다', () => {
    expect(nextPhoneToPersist(`  ${VALID}  `, null)).toBe(VALID);
  });
});
