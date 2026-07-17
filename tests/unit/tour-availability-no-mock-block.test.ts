/**
 * 투어 가용성 mock 차단 제거 회귀 (2026-07-17)
 * - P2-A 시절 mock 룰(토요일 + 매월 25일 이후 = fully_booked)이 실예약 게이트에 물려
 *   prod 예약을 차단하던 사고의 재발 방지. checkAvailability 는 이제
 *   과거 날짜 + 정적 blackout 만 차단한다. 만석/휴무는 Firestore 가 SSOT.
 * - 이 테스트가 깨지면 = 누군가 클라이언트에 요일/날짜 기반 하드코딩 차단을 되살린 것.
 */
import { describe, it, expect } from 'vitest';
import { checkAvailability } from '../../src/data/tour-availability';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('checkAvailability — mock 차단 제거 회귀', () => {
  it('미래 60일 전부 선택 가능 (토요일·매월 25일 이후 포함)', () => {
    let saturdays = 0;
    let monthEnds = 0;
    for (let i = 1; i <= 60; i++) {
      const iso = isoDaysFromNow(i);
      const d = new Date(iso + 'T00:00:00');
      if (d.getDay() === 6) saturdays++;
      if (d.getDate() >= 25) monthEnds++;
      const result = checkAvailability('tour-seoul-city', iso);
      expect(result.available, `${iso} (dow=${d.getDay()}, dom=${d.getDate()}) 가 차단됨`).toBe(true);
    }
    // 60일 창에 토요일·월말이 실제로 포함됐는지 (테스트 자체의 무의미화 방지)
    expect(saturdays).toBeGreaterThanOrEqual(8);
    expect(monthEnds).toBeGreaterThanOrEqual(10);
  });

  it('과거 날짜는 차단 (reason=past)', () => {
    const result = checkAvailability('tour-seoul-city', isoDaysFromNow(-1));
    expect(result.available).toBe(false);
    expect(result.reason).toBe('past');
  });

  it('빈 날짜 문자열은 통과 (미선택 상태)', () => {
    expect(checkAvailability('tour-seoul-city', '').available).toBe(true);
  });

  it('소스에 요일/월말 하드코딩 차단이 재도입되지 않음 (정적 검사)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(__dirname, '../../src/data/tour-availability.ts'), 'utf8');
    expect(src).not.toMatch(/getDay\(\)\s*===?\s*6/);
    expect(src).not.toMatch(/getDate\(\)\s*>=?\s*25/);
  });
});
