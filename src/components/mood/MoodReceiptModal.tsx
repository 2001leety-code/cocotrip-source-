/**
 * MoodReceiptModal — MOOD 예약 영수증 모달 (운영자 전용)
 *
 * mood-data 가 내려준 예약 doc(booking) 을 영수증 카드로 보여준다:
 *   - 경로(출발 → 경유들 → 도착) · 서비스 종류 · 총 km · 톨비(breakdown)
 *   - 요금 내역: 기본요금 + 거리추가 + 톨비 = amountKRW
 *   - 차감 후 잔액(runningBalanceKRW) — null 이면 '기록 없음'(레거시 예약)
 *   - 정산 완료(finalAmountKRW) 시: 실제 시간 · 최종 금액 · 조정액
 *
 * booking 이 null 이면 아무것도 렌더하지 않음(모달 닫힘 상태).
 * 다크 톤(#0a0412 / #181b22, 포인트 #EA537E · #7C5CFC). 운영자 한국어 단일.
 */
import { formatKRW, type MoodServiceType } from '@/lib/moodPricing';

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

export function MoodReceiptModal({ booking, onClose }: MoodReceiptModalProps) {
  if (!booking) return null;

  const bd = booking.breakdown || {};
  const stops = stopsFrom(bd);
  const serviceLabel = SERVICE_LABEL[String(booking.serviceType)] || String(booking.serviceType || '서비스');
  const settled = booking.finalAmountKRW != null;

  const baseKRW = Number(bd.baseKRW || 0);
  const distanceSurchargeKRW = Number(bd.distanceSurchargeKRW || 0);
  const tollKRW = Number(bd.tollKRW || 0);
  const km = Number(bd.km || 0);
  const amountKRW = Number(booking.amountKRW || 0);

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

        {/* 요금 내역 */}
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: C.chip, border: C.chipBorder }}>
          <p className="text-[11px] font-bold" style={{ color: C.textDim }}>요금 내역</p>

          {baseKRW > 0 && (
            <div className={rowStyle} style={{ color: C.textDim }}>
              <span>
                기본요금
                {booking.serviceType !== 'airport' && booking.durationHours ? ` (${booking.durationHours}시간)` : ' (정액)'}
              </span>
              <span style={{ color: C.text }}>{formatKRW(baseKRW)}</span>
            </div>
          )}
          {distanceSurchargeKRW > 0 && (
            <div className={rowStyle} style={{ color: C.textDim }}>
              <span>거리 추가요금{km > 0 ? ` (${km.toLocaleString('ko-KR')}km)` : ''}</span>
              <span style={{ color: C.text }}>+{formatKRW(distanceSurchargeKRW)}</span>
            </div>
          )}
          {tollKRW > 0 && (
            <div className={rowStyle} style={{ color: C.textDim }}>
              <span>톨비</span>
              <span style={{ color: C.text }}>+{formatKRW(tollKRW)}</span>
            </div>
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
