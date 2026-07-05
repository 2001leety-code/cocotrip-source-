/**
 * 다음 우편번호 주소 검색 — formatDaumAddress 순수 변환 + MoodPortal 경유지 배열 배선 (2026-06-13).
 *
 * MOOD 경로 입력에 무료 다음 우편번호(주소검색) + 네이버 지도식 경유지 추가/삭제 도입.
 * 키 불필요·읽기 전용. 장소(POI)/거리요금은 NCP 키 필요(별도).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatDaumAddress, type DaumPostcodeData } from '../../src/lib/daumPostcode';

function mk(over: Partial<DaumPostcodeData>): DaumPostcodeData {
  return {
    userSelectedType: 'R',
    roadAddress: '',
    jibunAddress: '',
    zonecode: '',
    buildingName: '',
    sido: '',
    sigungu: '',
    ...over,
  };
}

describe('formatDaumAddress — 도로명/지번 선택 + 건물명', () => {
  it('도로명 선택(R) → 도로명 주소 사용', () => {
    expect(formatDaumAddress(mk({ userSelectedType: 'R', roadAddress: '서울 강남구 테헤란로 1', jibunAddress: '서울 강남구 역삼동 1' })))
      .toBe('서울 강남구 테헤란로 1');
  });

  it('지번 선택(J) → 지번 주소 사용', () => {
    expect(formatDaumAddress(mk({ userSelectedType: 'J', roadAddress: '서울 강남구 테헤란로 1', jibunAddress: '서울 강남구 역삼동 1' })))
      .toBe('서울 강남구 역삼동 1');
  });

  it('건물명 있으면 괄호로 부가', () => {
    expect(formatDaumAddress(mk({ userSelectedType: 'R', roadAddress: '서울 중구 한강대로 81길 30', buildingName: '코코트립빌딩' })))
      .toBe('서울 중구 한강대로 81길 30 (코코트립빌딩)');
  });

  it('선택 표기 주소 없으면 다른 표기로 폴백', () => {
    expect(formatDaumAddress(mk({ userSelectedType: 'R', roadAddress: '', jibunAddress: '서울 강남구 역삼동 1' })))
      .toBe('서울 강남구 역삼동 1');
  });

  it('둘 다 없으면 빈 문자열', () => {
    expect(formatDaumAddress(mk({ userSelectedType: 'R' }))).toBe('');
  });
});

describe('MoodPortal — 경유지 배열 + 주소검색 배선 (소스가드)', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/pages/MoodPortal.tsx'), 'utf8');

  it('waypoints 상태가 string[] 배열', () => {
    expect(src).toMatch(/useState<string\[\]>\(\[\]\)/);
  });

  it('경유지 추가/삭제/수정 헬퍼 존재', () => {
    expect(src).toMatch(/addWaypoint/);
    expect(src).toMatch(/removeWaypoint/);
    expect(src).toMatch(/setWaypointAt/);
  });

  it('최대 5개 한도(백엔드 computeRoute 한도와 일치)', () => {
    expect(src).toMatch(/w\.length >= 5/);
  });

  it('다음 우편번호 주소검색(openDaumPostcode) 연결', () => {
    expect(src).toMatch(/openDaumPostcode/);
    expect(src).toMatch(/searchAddress/);
  });

  it('경유지를 | 로 join 해 백엔드 전달(split 잔재 없음)', () => {
    // 배열 → filter(Boolean) 로 빈칸 제거 후 join('|') 전달. 과거 split('|') 단일문자열 방식 제거 확인.
    // (2026-07-05: 공항 우회거리 계산 위해 wpList 변수로 분리 — filter/join 연속 체인은 아니지만 의도 동일.)
    expect(src).toMatch(/\.filter\(Boolean\)/);
    expect(src).toMatch(/\.join\('\|'\)/);
    expect(src).not.toMatch(/waypoints[\s.]*\.split\('\|'\)/);
  });
});
