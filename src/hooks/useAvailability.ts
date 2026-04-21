/**
 * useAvailability — 실시간 예약 가능 여부 확인 훅
 *
 * 날짜 + 차량 타입 선택 시 즉시 가용 체크
 * GET /api/check-availability?date=YYYY-MM-DD&vehicle=staria
 */
import { useState, useCallback } from 'react';

export interface AvailabilityInfo {
  available: boolean;
  remaining: number;
  total: number;
  message?: string;
}

export function useAvailability() {
  const [status, setStatus] = useState<AvailabilityInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async (date: string, vehicleType: string) => {
    if (!date || !vehicleType) {
      setStatus(null);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/check-availability?date=${date}&vehicle=${vehicleType}`
      );
      const json = await res.json();
      const d = json.data;
      setStatus(d);
    } catch {
      setStatus({
        available: false,
        remaining: 0,
        total: 0,
        message: 'Unable to check availability',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const reserve = useCallback(async (
    date: string,
    vehicleType: string,
    userId: string,
  ): Promise<{ success: boolean; reservationId?: string; message?: string }> => {
    try {
      const res = await fetch('/api/reserve-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, vehicleType, userId }),
      });
      const json = await res.json();
      // 표준 응답: { ok, data: { reserved, reservationId } }
      if (json.ok) {
        return { success: true, reservationId: json.data?.reservationId, message: json.data?.message };
      }
      // 에러 응답: { ok: false, error, code }
      if (json.ok === false) {
        return { success: false, message: json.error };
      }
      // 레거시 폴백
      return json;
    } catch {
      return { success: false, message: 'Network error' };
    }
  }, []);

  return { status, loading, check, reserve };
}
