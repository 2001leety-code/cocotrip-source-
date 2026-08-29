import type { MoodBookingAvailability } from '../../src/lib/moodBookingAvailability';

/**
 * 예약 가능 여부가 이 테스트의 관심사가 아닐 때 쓰는 명시적인 전 시간 개방 설정.
 *
 * 운영 코드는 설정 누락 시 fail-closed 해야 하므로, 테스트 대역도 undefined 에 기대지
 * 않고 Firestore/컴포넌트 경계에 실제 공개 계약을 넣는다.
 */
export function openMoodBookingAvailabilityFixture(): MoodBookingAvailability {
  return {
    schemaVersion: 1,
    revision: 0,
    rules: [],
    exceptions: [],
  };
}
