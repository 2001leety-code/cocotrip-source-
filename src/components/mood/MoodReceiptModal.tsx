/**
 * MoodReceiptModal — MOOD 예약 영수증 모달 (운영자 전용)
 *
 * mood-data 가 내려준 예약 doc(booking) 을 영수증 카드로 보여준다:
 *   - 동선 지도(2026-07-04 운영자 요청) — breakdown 주소로 /api/mood-route 재조회해
 *     경로선+번호핀 렌더. 지도는 시각화 전용, 요금·km 은 저장된 breakdown(SSOT)만 표시.
 *   - 경로(출발 → 경유들 → 도착) · 서비스 종류 · 총 km
 *   - 요금 내역 + 산식(2026-07-04): 기본요금(시간당 단가 × 시간), 거리 추가요금
 *     (km × 660원/50km 이상), 톨비는 0원이어도 항상 표시("통행료 없는 경로"와
 *     "기록 없음"을 구분 — 운영자가 '톨비가 안 보인다' 오해했던 원인).
 *   - 차감 후 잔액(runningBalanceKRW) — null 이면 '기록 없음'(레거시 예약)
 *   - 정산 완료(finalAmountKRW) 시: 실제 시간 · 최종 금액 · 조정액
 *
 * booking 이 null 이면 아무것도 렌더하지 않음(모달 닫힘 상태).
 * 다크 톤(#0a0412 / #181b22, 포인트 #EA537E · #7C5CFC). 운영자 한국어 단일.
 */
import { useEffect, useRef, useState } from 'react';

import { authFetch } from '@/lib/authFetch';
import { MoodRouteMap } from '@/components/MoodRouteMap';
import { formatKRW, MOOD_SURCHARGE_PER_KM, type MoodServiceType } from '@/lib/moodPricing';

const C = {
  overlay: 'rgba(5,2,12,0.72)',
  card: '#181b22',
  cardBorder: '1px solid rgba(124,92,252,0.22)',
  accent: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
  accentSolid: '#B668FC',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.55)',
  danger: '#f87171',
  ok: '#6ee7b7',
  line: 'rgba(124,92,252,0.16)',
  chip: 'rgba(124,92,252,0.08)',
  chipBorder: '1px solid rgba(124,92,252,0.16)',
};

const SERVICE_LABEL: Record<string, string> = { vehicle: '차량', airport: '공항', manager: '매니저' };

/** breakdown — mood-book/mood-data 가 예약 doc 에 저장하는 금액 분해. */
interface MoodBreakdownLike {
  baseKRW?: number | null;
  distanceSurchargeKRW?: number | null;
  tollKRW?: number | null;
  km?: number | null;
  origin?: string | null;
  destination?: string | null;
  waypoints?: string[] | null;
}

/** 영수증에 필요한 예약 필드 (mood-data 응답 booking). */
export interface MoodBookingLike {
  id?: string;
  date?: string;
  startTime?: string;
  durationHours?: number;
  serviceType?: MoodServiceType | string;
  amountKRW?: number;
  ratePerHour?: number | null;
  breakdown?: MoodBreakdownLike | null;
  runningBalanceKRW?: number | null;
  finalAmountKRW?: number | null;
  actualHours?: number | null;
  adjustmentKRW?: number | null;
}

interface MoodReceiptModalProps {
  booking: MoodBookingLike | null;
  onClose: () => void;
}

/** 음수 대응 금액 표기 — "-123,000원". */
function fmtBalance(n: number): string {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `-${Math.abs(v).toLocaleString('ko-KR')}원` : `${v.toLocaleString('ko-KR')}원`;
}

/** breakdown → 순서 있는 경유지 리스트(출발 … 도착). */
function stopsFrom(bd?: MoodBreakdownLike | null): string[] {
  if (!bd) return [];
  return [bd.origin, ...(Array.isArray(bd.waypoints) ? bd.waypoints : []), bd.destination]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

/** /api/mood-route 응답 data — 지도 렌더용 (MoodPortal 과 동일 계약). */
interface ReceiptRouteData {
  km: number;
  durationMin: number;
  path: [number, number][];
  points: Array<{ lat: number; lng: number; role: 'origin' | 'waypoint' | 'destination'; index?: number }>;
}

export function MoodReceiptModal({ booking, onClose }: MoodReceiptModalProps) {
  const bd = booking?.breakdown || {};
  const bdOrigin = String(bd.origin || '').trim();
  const bdDest = String(bd.destination || '').trim();
  const bdWaypoints = (Array.isArray(bd.waypoints) ? bd.waypoints : []).map((s) => String(s || '').trim()).filter(Boolean);

  // ── 동선 지도 (2026-07-04) — 저장된 주소로 경로 재조회(시각화 전용, 요금은 breakdown SSOT) ──
  const [route, setRoute] = useState<ReceiptRouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  const bookingId = booking?.id || null;
  useEffect(() => {
    if (!bookingId || !bdOrigin || !bdDest) { setRoute(null); return; }
    if (fetchedFor.current === bookingId) return; // 같은 예약 재열람 시 재호출 방지
    fetchedFor.current = bookingId;
    setRoute(null);
    setRouteLoading(true);
    let alive = true;
    (async () => {
      try {
        const params = new URLSearchParams({ origin: bdOrigin, destination: bdDest });
        if (bdWaypoints.length) params.set('waypoints', bdWaypoints.join('|'));
        const res = await authFetch(`/api/mood-route?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        const d = json?.ok ? json.data : null;
        if (d && Array.isArray(d.path) && Array.isArray(d.points)) {
          setRoute({ km: Number(d.km || 0), durationMin: Number(d.durationMin || 0), path: d.path, points: d.points });
        }
      } catch { /* 지도는 부가 정보 — 실패해도 영수증 텍스트는 그대로 */ } finally {
        if (alive) setRouteLoading(false);
      }
    })();
    return () => { alive = false; };
    // bdWaypoints 는 booking 파생이라 bookingId 로 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, bdOrigin, bdDest]);

  if (!booking) return null;

  const stops = stopsFrom(bd);
  const serviceLabel = SERVICE_LABEL[String(booking.serviceType)] || String(booking.serviceType || '서비스');
  const settled = booking.finalAmountKRW != null;

  const baseKRW = Number(bd.baseKRW || 0);
  const distanceSurchargeKRW = Number(bd.distanceSurchargeKRW || 0);
  const tollKRW = Number(bd.tollKRW || 0);
  const hasBreakdown = bd.baseKRW != null || bd.km != null; // 레거시(상세 미기록) 구분
  const km = Number(bd.km || 0);
  const amountKRW = Number(booking.amountKRW || 0);
  const ratePerHour = Number(booking.ratePerHour || 0);
  // 거리 단가 — 저장된 breakdown 에서 유도(요율 개정 전 660·후 600 예약 각각 정확 표기). 유도 불가 시 현행 상수.
  const perKm = km > 0 && distanceSurchargeKRW > 0 ? Math.round(distanceSurchargeKRW / km) : MOOD_SURCHARGE_PER_KM;
  const isAirport = booking.serviceType === 'airport';

  const hasRunningBalance = typeof booking.runningBalanceKRW === 'number';
  const runningBalance = Number(booking.runningBalanceKRW || 0);

  const rowStyle = 'flex items-center justify-between text-xs';

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      style={{ background: C.overlay }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="예약 영수증"
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
        style={{ background: C.card, border: C.cardBorder }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold" style={{ color: C.text }}>
              예약 영수증
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
              {booking.date || '-'}
              {booking.startTime ? ` · ${booking.startTime}` : ''} · {serviceLabel}
              {settled && <span style={{ color: C.ok }}> · 정산 완료</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="h-8 w-8 shrink-0 rounded-full text-sm font-bold"
            style={{ background: C.chip, border: C.chipBorder, color: C.textDim }}
          >
            ✕
          </button>
        </div>

        {/* 경로 (출발 → 경유 → 도착) */}
        {stops.length > 0 && (
          <div className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: C.chip, border: C.chipBorder }}>
            <p className="text-[11px] font-bold" style={{ color: C.textDim }}>동선</p>
            {stops.map((stop, i) => (
              <div key={`${stop}-${i}`} className="flex gap-2">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{
                    background: i === 0 ? '#22c55e' : i === stops.length - 1 ? '#ef4444' : C.accentSolid,
                    color: '#fff',
                  }}
                >
                  {i + 1}
                </span>
                <p className="min-w-0 text-xs font-semibold" style={{ color: C.text }}>{stop}</p>
              </div>
            ))}
            {km > 0 && (
              <p className="text-[11px] pt-1" style={{ color: C.textDim }}>
                총 {km.toLocaleString('ko-KR')}km{tollKRW > 0 ? ` · 톨비 ${formatKRW(tollKRW)}` : ''}
              </p>
            )}
          </div>
        )}

        {/* 동선 지도 (2026-07-04) — 경로 재조회 성공 시 표시, 실패는 조용히 생략 */}
        {routeLoading && (
          <p className="text-[11px]" style={{ color: C.textDim }}>동선 지도 불러오는 중…</p>
        )}
        {route && (
          <MoodRouteMap
            origin={bdOrigin}
            waypoints={bdWaypoints}
            destination={bdDest}
            route={route}
            accent={C.accentSolid}
            inputBg={C.chip}
            inputBorder={C.chipBorder}
            textDim={C.textDim}
          />
        )}

        {/* 요금 내역 — 산식 포함 (2026-07-04: 어떻게 계산됐는지 + 톨비 0원도 명시) */}
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: C.chip, border: C.chipBorder }}>
          <p className="text-[11px] font-bold" style={{ color: C.textDim }}>요금 내역</p>

          {baseKRW > 0 && (
            <div className={rowStyle} style={{ color: C.textDim }}>
              <span>
                기본요금
                {!isAirport && booking.durationHours
                  ? (ratePerHour > 0
                      ? ` (${formatKRW(ratePerHour)}/시간 × ${booking.durationHours}시간)`
                      : ` (${booking.durationHours}시간)`)
                  : ' (공항 정액)'}
              </span>
              <span style={{ color: C.text }}>{formatKRW(baseKRW)}</span>
            </div>
          )}
          {!isAirport && (distanceSurchargeKRW > 0 || km > 0) && (
            <div className={rowStyle} style={{ color: C.textDim }}>
              <span>
                거리 추가요금
                {distanceSurchargeKRW > 0
                  ? ` (${km.toLocaleString('ko-KR')}km × ${perKm}원)`
                  : ` (${km.toLocaleString('ko-KR')}km — 50km 미만 무료)`}
              </span>
              <span style={{ color: C.text }}>+{formatKRW(distanceSurchargeKRW)}</span>
            </div>
          )}
          {/* 톨비 — 0원도 항상 표시: '통행료 없는 경로'와 '기록 없음'을 구분 */}
          {hasBreakdown && !isAirport && (
            <div className={rowStyle} style={{ color: C.textDim }}>
              <span>톨비{tollKRW <= 0 ? ' (통행료 없는 경로)' : ''}</span>
              <span style={{ color: C.text }}>+{formatKRW(tollKRW)}</span>
            </div>
          )}
          {!hasBreakdown && (
            <p className="text-[10px]" style={{ color: C.textDim }}>상세 내역 미기록 예약(레거시) — 합계만 표시</p>
          )}

          <div className="h-px my-0.5" style={{ background: C.line }} />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: C.textDim }}>합계</span>
            <span className="text-lg font-bold" style={{ color: C.accentSolid }}>{formatKRW(amountKRW)}</span>
          </div>
        </div>

        {/* 잔액 (차감 후) */}
        <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: C.chip, border: C.chipBorder }}>
          <span className="text-xs" style={{ color: C.textDim }}>차감 후 잔액</span>
          {hasRunningBalance ? (
            <span className="text-sm font-bold" style={{ color: runningBalance < 0 ? C.danger : C.text }}>
              {fmtBalance(runningBalance)}
              {runningBalance < 0 && <span className="text-[10px] font-normal" style={{ color: C.danger }}> (외상)</span>}
            </span>
          ) : (
            <span className="text-sm" style={{ color: C.textDim }}>기록 없음</span>
          )}
        </div>

        {/* 정산 완료 시 — 실제 시간 · 최종 금액 · 조정액 */}
        {settled && (
          <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(110,231,183,0.08)', border: '1px solid rgba(110,231,183,0.22)' }}>
            <p className="text-[11px] font-bold" style={{ color: C.ok }}>✓ 정산 완료</p>
            {booking.actualHours != null && (
              <div className={rowStyle} style={{ color: C.textDim }}>
                <span>실제 이용 시간</span>
                <span style={{ color: C.text }}>{booking.actualHours}시간</span>
              </div>
            )}
            <div className={rowStyle} style={{ color: C.textDim }}>
              <span>최종 금액</span>
              <span className="font-bold" style={{ color: C.text }}>{formatKRW(Number(booking.finalAmountKRW || 0))}</span>
            </div>
            {typeof booking.adjustmentKRW === 'number' && booking.adjustmentKRW !== 0 && (
              <div className={rowStyle} style={{ color: C.textDim }}>
                <span>{booking.adjustmentKRW > 0 ? '추가 청구' : '환원'}</span>
                <span style={{ color: booking.adjustmentKRW > 0 ? C.danger : C.ok }}>
                  {booking.adjustmentKRW > 0 ? '+' : '−'}{formatKRW(Math.abs(booking.adjustmentKRW))}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 닫기 */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl font-bold transition-all hover:scale-[1.01]"
          style={{ background: C.accent, color: '#fff' }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}

export default MoodReceiptModal;
