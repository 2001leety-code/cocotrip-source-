import { describe, it, expect } from 'vitest';
import { isEmptyVal, normalizeProfilePhone, mergeProfileDefaults } from '../../src/lib/profilePrefill';

// 2026-06-11 가입 프로필 → 예약 폼 prefill 코어. fill-only-empty(사용자 입력 안 덮음) + phone 보정.
describe('isEmptyVal — null/undefined/공백', () => {
  it('빈 = null/undefined/공백', () => {
    expect(isEmptyVal(null)).toBe(true);
    expect(isEmptyVal(undefined)).toBe(true);
    expect(isEmptyVal('')).toBe(true);
    expect(isEmptyVal('   ')).toBe(true);
  });
  it('값 있으면 false', () => {
    expect(isEmptyVal('x')).toBe(false);
    expect(isEmptyVal('010')).toBe(false);
  });
});

describe('normalizeProfilePhone — 전 국가 trunk-0 strip (critique #3)', () => {
  it('KR 010 → +8210 (선행 0 제거)', () => {
    expect(normalizeProfilePhone('010-1234-5678', 'KR')).toBe('+821012345678');
  });
  it('JP 090 → +8190 (KR 특례 아닌 공통 — 오번호 방지)', () => {
    expect(normalizeProfilePhone('09012345678', 'JP')).toBe('+819012345678');
  });
  it('VN 0912 → +84912', () => {
    expect(normalizeProfilePhone('0912345678', 'VN')).toBe('+84912345678');
  });
  it('이미 + 로 시작 → 그대로', () => {
    expect(normalizeProfilePhone('+6591234567', 'SG')).toBe('+6591234567');
  });
  it('countryCode 미상/OTHER → 원본 (보정 스킵)', () => {
    expect(normalizeProfilePhone('1012345678', 'OTHER')).toBe('1012345678');
    expect(normalizeProfilePhone('1012345678', undefined)).toBe('1012345678');
  });
  it('빈 phone → ""', () => {
    expect(normalizeProfilePhone(null, 'KR')).toBe('');
    expect(normalizeProfilePhone('  ', 'KR')).toBe('');
  });
});

describe('mergeProfileDefaults — fill-only-empty (사용자 입력 보존)', () => {
  it('빈 필드만 채움', () => {
    const r = mergeProfileDefaults({ name: '', phone: '' }, { name: '홍길동', phone: '+8210' }, ['name', 'phone']);
    expect(r).toEqual({ name: '홍길동', phone: '+8210' });
  });
  it('기존 값(사용자 입력/snapshot)은 절대 안 덮음', () => {
    const r = mergeProfileDefaults({ name: '내가친이름', phone: '' }, { name: '프로필이름', phone: '+8210' }, ['name', 'phone']);
    expect(r.name).toBe('내가친이름'); // 프로필이 못 덮음
    expect(r.phone).toBe('+8210');     // 빈 거만 채움
  });
  it('undefined 시작 필드도 채움 (charter customerName/Phone)', () => {
    const r = mergeProfileDefaults({ customerName: undefined, customerPhone: undefined } as Record<string, unknown>, { customerName: '김', customerPhone: '+82' }, ['customerName', 'customerPhone']);
    expect(r).toEqual({ customerName: '김', customerPhone: '+82' });
  });
  it('프로필 쪽이 빈 값이면 주입 안 함 (controlled-input 경고 방지)', () => {
    const cur = { name: '', phone: '' };
    const r = mergeProfileDefaults(cur, { name: null, phone: '   ' }, ['name', 'phone']);
    expect(r).toBe(cur); // 채울 게 없으면 동일 참조
  });
  it('채울 게 없으면 동일 참조 반환', () => {
    const cur = { name: '있음', phone: '있음' };
    expect(mergeProfileDefaults(cur, { name: 'x', phone: 'y' }, ['name', 'phone'])).toBe(cur);
  });
});
