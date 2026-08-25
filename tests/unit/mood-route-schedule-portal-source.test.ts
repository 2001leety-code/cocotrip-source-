import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/MoodPortal.tsx'), 'utf8');

describe('MoodPortal 경로 일정 표면 배선', () => {
  it('수기 예약에서 주소 추가·삭제와 routeSchedule을 함께 갱신하고 예약 payload에 넣는다', () => {
    expect(source).toContain('const [manualRouteSchedule, setManualRouteSchedule]');
    expect(source).toContain("setManualRouteSchedule((current) => current.filter((_, idx) => idx !== i + 1))");
    expect(source).toContain('const routeSchedule = hasCompleteRoute');
    expect(source).toContain('routeSchedule,');
    expect(source).toContain('validateMoodRouteSchedule(routeSchedule, wp.length + 2, startTime)');
  });

  it('예약 목록·영수증 공유 데이터에도 같은 routeSchedule을 전달한다', () => {
    expect(source).toContain('routeSchedule: booking.routeSchedule');
    expect(source).toContain('const bookingRouteSchedule = Array.isArray(b.routeSchedule)');
    expect(source).toContain('formatMoodRouteScheduleStopSummary(bookingRouteSchedule[i], i, stops.length)');
  });

  it('모바일 조작 UI에 도착·재출발·대기 입력과 44px 터치 크기를 둔다', () => {
    expect(source).toContain('상세 일정 <span');
    expect(source).toContain('재출발(픽업)');
    expect(source).toContain('[30, 60, 120]');
    expect(source).toContain('min-h-11');
  });
});
