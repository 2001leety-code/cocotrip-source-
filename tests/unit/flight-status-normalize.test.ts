/**
 * flight-status — 편명 canonical 정규화 + 예약일 조회창 판정 회귀 가드 (2026-07-18 검색 미작동 fix).
 *
 * prod 실증 재현 케이스: KE082 found / KE82·KE0082·LO97·LO0097 miss (완전일치 비교) —
 * 인천공항 데이터 canonical(3자리 zero-pad)과 구글/항공권 표기(비패딩·4자리 패딩) 불일치.
 */
import { describe, it, expect } from 'vitest';
import { canonicalFlightId, kstTodayYmd, addDaysYmd, classifyDate } from '../../api/flight-status.js';

describe('canonicalFlightId — 표기 변형 전부 canonical 로 수렴', () => {
  it('prod 실증 6종: KE82/KE 82/KE0082 → KE082, LO97/LO 097/LO0097 → LO097', () => {
    for (const v of ['KE82', 'ke82', 'KE 82', 'KE082', 'KE0082']) expect(canonicalFlightId(v), v).toBe('KE082');
    for (const v of ['LO97', 'LO 97', 'LO097', 'LO0097']) expect(canonicalFlightId(v), v).toBe('LO097');
  });
  it('4자리 편명은 그대로 (KE5760, 7C1403 — 숫자 포함 캐리어코드)', () => {
    expect(canonicalFlightId('KE5760')).toBe('KE5760');
    expect(canonicalFlightId('ke 5760')).toBe('KE5760');
    expect(canonicalFlightId('7C1403')).toBe('7C1403');
    expect(canonicalFlightId('7c 140')).toBe('7C140');
  });
  it('접미문자(운항 변형 suffix) 보존', () => {
    expect(canonicalFlightId('KE82A')).toBe('KE082A');
  });
  it('선행 0 제거 후 재패딩 — 멱등성', () => {
    for (const v of ['KE082', 'LO097', 'KE5760']) expect(canonicalFlightId(canonicalFlightId(v))).toBe(canonicalFlightId(v));
  });
  it('비표준 입력은 대문자·공백제거 원문 유지 (방어)', () => {
    expect(canonicalFlightId('대한항공82')).toBe('대한항공82');
    expect(canonicalFlightId('')).toBe('');
    expect(canonicalFlightId(null as unknown as string)).toBe('');
  });
});

describe('classifyDate — 예약일 vs 조회창(오늘~D+6)', () => {
  const TODAY = '2026-07-18';
  it('창 내: 오늘~6일 후', () => {
    expect(classifyDate('2026-07-18', TODAY)).toBe('in_window');
    expect(classifyDate('2026-07-24', TODAY)).toBe('in_window'); // D+6 경계 포함
  });
  it('창 밖: 7일 후부터 beyond (차터 통상 예약 시점 — 이전엔 "편명 없음" 오답)', () => {
    expect(classifyDate('2026-07-25', TODAY)).toBe('beyond'); // D+7
    expect(classifyDate('2026-09-01', TODAY)).toBe('beyond');
  });
  it('과거 날짜 → past', () => {
    expect(classifyDate('2026-07-17', TODAY)).toBe('past');
  });
  it('월말 경계 넘는 D+6 계산 (addDaysYmd)', () => {
    expect(addDaysYmd('2026-07-28', 6)).toBe('2026-08-03');
    expect(classifyDate('2026-08-03', '2026-07-28')).toBe('in_window');
    expect(classifyDate('2026-08-04', '2026-07-28')).toBe('beyond');
  });
});

describe('kstTodayYmd — KST 앵커 (서버 TZ 무관)', () => {
  it('UTC 15:00 = KST 자정 경계 — UTC 2026-07-18T15:00 → KST 2026-07-19', () => {
    expect(kstTodayYmd(Date.UTC(2026, 6, 18, 14, 59))).toBe('2026-07-18');
    expect(kstTodayYmd(Date.UTC(2026, 6, 18, 15, 0))).toBe('2026-07-19');
  });
});
