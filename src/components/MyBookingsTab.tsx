// MyBookingsTab — MyPage의 "My Bookings" 탭 콘텐츠 · i18n
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Package, Clock, XCircle, Edit, Check, X, Star, ExternalLink, Download } from 'lucide-react';
import { getWizardI18n } from '@/components/charter/wizard-i18n';
import { ReviewSubmitModal } from '@/components/ReviewSubmitModal';
import { useAuth } from '@/hooks/useAuth';
import { translations, type Language } from '@/i18n';

interface Booking {
  id: string;
  bookingRef: string;
  status: 'CONFIRMED' | 'CANCELED' | 'MODIFIED' | 'COMPLETED' | string;
  productType: string;
  tourDate: string;
  pickupLocation: string;
  dropoffLocation: string;
  paxCount: number;
  vehicleType: string;
  amountKRW: number;
  amountUSD: string;
  createdAt: unknown;
  canceledAt: unknown;
  refundedAmount: number;
  canRefund: boolean;
  canModify: boolean;
  refundPercent: number;
  hoursUntilTour: number | null;
  // 2026-05-04: charter_custom_estimate booking — 사후 정산 대기 표식
  requiresReconciliation?: boolean;
  airport?: {
    terminal?: 'T1' | 'T2';
    flightNumber?: string;
    luggage?: { small?: number; medium?: number; large?: number };
  };
}

// 2026-05-04: productType 키 → 사용자 친화 라벨. 4-lang 사전은 i18n 중앙(`mypage.productLabels`)
// 으로 이전됨 (refactor C3, 2026-05-04). raw 키가 그대로 노출되던 wart 정리.
function prettyProductLabel(productType: string | undefined, lang: Language): string {
  if (!productType) return '-';
  const norm = String(productType).replace(/-/g, '_');
  const t = translations[lang].mypage;
  const enLabels = translations.en.mypage.productLabels as Record<string, string>;
  const labels = t.productLabels as Record<string, string>;
  if (labels[norm]) return labels[norm] || enLabels[norm] || productType;
  // airport_<key> 같은 동적 키는 일반화
  if (norm.startsWith('airport_')) {
    const dest = norm.slice(8).replace(/_/g, ' ');
    return `${t.airportPrefix}${dest}`;
  }
  if (norm.startsWith('combo_')) {
    return t.comboPackage;
  }
  return productType;
}

function airportSummary(airport?: Booking['airport']): string | null {
  if (!airport) return null;
  const lug = airport.luggage || {};
  const total = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const parts: string[] = [];
  if (airport.terminal) parts.push(`✈ ${airport.terminal}`);
  if (airport.flightNumber) parts.push(airport.flightNumber);
  if (total > 0) parts.push(`수하물 ${total}`);
  return parts.length ? parts.join(' · ') : null;
}

interface Props {
  userEmail: string;
  tier?: string;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

export function MyBookingsTab({ userEmail, tier = 'Bronze', language = 'en' }: Props) {
  const i18n = getWizardI18n(language);
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [modifyTarget, setModifyTarget] = useState<Booking | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Booking | null>(null);
  // 2026-05-04 P0 fix: 예약 카드 클릭 시 상세 모달 표시. 이전엔 카드 클릭 시 아무 동작도 없어
  // 사용자가 PNR/세부 정보를 볼 수 없었음 (사용자 신고: "들어가볼 수도 없음").
  const [detailTarget, setDetailTarget] = useState<Booking | null>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ userEmail, tier }).toString();
      const res = await fetch(`/api/my-bookings?${qs}`);
      const json = await res.json();
      if (json.ok) setBookings(json.data.bookings || []);
      else setError(json.error || 'Failed to load bookings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [userEmail, tier]);

  useEffect(() => { if (userEmail) load(); }, [userEmail, load]);

  const handleCancel = async (b: Booking) => {
    const reason = prompt(i18n.mbCancelReasonPrompt) ?? '';
    const amountStr = Math.round((b.amountKRW * b.refundPercent) / 100).toLocaleString('ko-KR');
    const ok = confirm(`${b.bookingRef}\n${i18n.mbCancelConfirm(b.refundPercent, amountStr)}`);
    if (!ok) return;
    setCancelingId(b.id);
    try {
      const res = await fetch('/api/cancelBooking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingID: b.id, userEmail, reason, tier }),
      });
      const json = await res.json();
      if (json.ok) await load();
      else alert(json.error || 'Error');
    } finally {
      setCancelingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-red-400 text-sm">⚠ {error}</div>;
  }

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/55">
        <Package size={36} className="mb-3 opacity-30" />
        <p className="text-sm">{i18n.mbEmpty}</p>
        <p className="text-xs mt-1 text-white/15">{i18n.mbEmptySub}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white font-bold text-lg">{i18n.mbHeader}</h3>
        <span className="text-white/55 text-sm">{bookings.length}</span>
      </div>
      {bookings.map(b => (
        <div
          key={b.id}
          role="button"
          tabIndex={0}
          onClick={() => setDetailTarget(b)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailTarget(b); } }}
          className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-[#7C5CFC]/20 transition-all cursor-pointer focus:outline-none focus:border-[#7C5CFC]/50"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status={b.status} i18n={i18n} />
                <span className="text-[11px] text-white/55 font-mono">{b.bookingRef}</span>
              </div>
              <p className="text-white text-sm font-medium">{prettyProductLabel(b.productType, language)}</p>
              <p className="text-white/50 text-xs mt-0.5">
                {b.tourDate} · {b.paxCount}{i18n.maxUnit} · {b.vehicleType}
              </p>
              {/* 2026-05-03: AI 플래너는 디지털 상품 — 환불 불가 명시 (사용자 혼동 방지) */}
              {(b.productType || '').toString().startsWith('ai-planner') && (
                <p className="text-amber-300/70 text-[10px] mt-1 italic">
                  {i18n.mbDigitalNoRefund || 'Digital product · non-refundable'}
                </p>
              )}
              {/* 2026-05-04: charter_custom_estimate booking — 추정가 정산 대기 배지 */}
              {b.requiresReconciliation && (
                <p className="text-amber-300/70 text-[10px] mt-1 italic">
                  ⚠ {translations[language].mypage.estimateBadge || translations.en.mypage.estimateBadge}
                </p>
              )}
              {airportSummary(b.airport) && (
                <p className="text-[#B668FC]/80 text-[11px] mt-0.5">{airportSummary(b.airport)}</p>
              )}
              {b.hoursUntilTour != null && b.status === 'CONFIRMED' && (
                <p className="text-white/55 text-[11px] mt-1.5 flex items-center gap-1">
                  <Clock size={10} />
                  {b.hoursUntilTour >= 24 ? i18n.mbDaysAway(Math.round(b.hoursUntilTour / 24)) : i18n.mbHoursAway(b.hoursUntilTour)}
                  {b.canRefund && <span className="text-emerald-400/70 ml-1">{i18n.mbRefundBadge(b.refundPercent)}</span>}
                </p>
              )}
              {b.status === 'CANCELED' && b.refundedAmount > 0 && (
                <p className="text-white/55 text-[11px] mt-1.5">
                  {i18n.mbRefundedAmount} ₩{b.refundedAmount.toLocaleString('ko-KR')}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-white font-bold text-sm">${b.amountUSD}</p>
              <p className="text-white/55 text-[10px]">₩{b.amountKRW.toLocaleString('ko-KR')}</p>
            </div>
          </div>

          {b.status === 'CONFIRMED' && (
            <div className="flex gap-2 mt-3 items-center flex-wrap" onClick={(e) => e.stopPropagation()}>
              {b.canModify && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setModifyTarget(b); }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-[11px] hover:bg-white/5"
                >
                  <Edit size={12} /> {i18n.mbModifyBtn}
                </button>
              )}
              {b.canRefund && (
                <button
                  type="button"
                  disabled={cancelingId === b.id}
                  onClick={(e) => { e.stopPropagation(); handleCancel(b); }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/25 text-red-300 text-[11px] hover:bg-red-500/10 disabled:opacity-40"
                >
                  {cancelingId === b.id ? i18n.mbProcessing : <><XCircle size={12} /> {i18n.mbCancelBtn}</>}
                </button>
              )}

              {/* 2026-05-03 P1 fix: AI 플래너 booking은 환불 X — 대신 /my-plans 링크 노출.
                  사용자 신고: "어떤 예약 했는지 들어가볼 수도 없음". */}
              {(b.productType || '').toString().startsWith('ai-planner') && (
                <Link
                  to="/my-plans"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#7C5CFC]/40 text-[#B668FC] text-[11px] hover:bg-[#7C5CFC]/10"
                >
                  <ExternalLink size={12} /> {i18n.mbViewPlanBtn || 'View Plan'}
                </Link>
              )}

              {/* 2026-05-03 P1 fix: 환불 가능 시간 지났을 때 명확한 안내. canRefund=false
                  + canModify=false 조합인데 status=CONFIRMED 면 정책상 거부. AI 플래너는
                  위에서 라벨 따로 노출되므로 제외. */}
              {!b.canRefund && !b.canModify && !(b.productType || '').toString().startsWith('ai-planner') && (
                <span className="text-[10px] text-white/45 italic">
                  {i18n.mbRefundWindowClosed || 'Refund/modify window closed'}
                </span>
              )}
            </div>
          )}

          {/* Review CTA — only for completed bookings, hidden once submitted
              this session. Server enforces one-review-per-product so the
              client-side guard is just UX. */}
          {b.status === 'COMPLETED' && user?.uid && !reviewedBookingIds.has(b.id) && (
            <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setReviewTarget(b); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-yellow-500/25 text-yellow-200 text-[11px] hover:bg-yellow-500/10 transition-colors"
              >
                <Star size={12} className="fill-yellow-400 text-yellow-400" /> {i18n.mbReviewBtn || 'Write a review · +50 coins'}
              </button>
            </div>
          )}
        </div>
      ))}

      {detailTarget && (
        <BookingDetailModal
          booking={detailTarget}
          language={language}
          userEmail={userEmail}
          onClose={() => setDetailTarget(null)}
          onCancel={async () => {
            const b = detailTarget;
            setDetailTarget(null);
            await handleCancel(b);
          }}
          onModify={() => {
            setModifyTarget(detailTarget);
            setDetailTarget(null);
          }}
          cancelingId={cancelingId}
        />
      )}

      {modifyTarget && (
        <ModifyModal
          booking={modifyTarget}
          userEmail={userEmail}
          tier={tier}
          language={language}
          onClose={() => setModifyTarget(null)}
          onSaved={async () => { setModifyTarget(null); await load(); }}
        />
      )}

      {reviewTarget && user?.uid && (
        <ReviewSubmitModal
          open={true}
          onClose={() => setReviewTarget(null)}
          userId={user.uid}
          authorName={user.displayName || ''}
          authorPhotoURL={user.photoURL || ''}
          targetType={reviewTarget.productType.startsWith('charter') ? 'charter' : 'tour'}
          targetId={reviewTarget.productType}
          productLabel={`${reviewTarget.productType} · ${reviewTarget.tourDate}`}
          onSuccess={() => {
            setReviewedBookingIds(prev => new Set(prev).add(reviewTarget.id));
          }}
        />
      )}
    </div>
  );
}

function ModifyModal({ booking, userEmail, tier, language, onClose, onSaved }: {
  booking: Booking; userEmail: string; tier: string; language: 'ko'|'en'|'ja'|'zh';
  onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const i18n = getWizardI18n(language);
  const [tourDate, setTourDate] = useState(booking.tourDate);
  const [paxCount, setPaxCount] = useState(booking.paxCount);
  const [pickupLocation, setPickupLocation] = useState(booking.pickupLocation);
  const [terminal, setTerminal] = useState<'T1' | 'T2' | ''>(booking.airport?.terminal ?? '');
  const [flightNumber, setFlightNumber] = useState(booking.airport?.flightNumber ?? '');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasAirport = !!booking.airport;

  const handleSave = async () => {
    setSaving(true); setErr(null);
    const changes: Record<string, unknown> = {};
    if (tourDate !== booking.tourDate) changes.tourDate = tourDate;
    if (paxCount !== booking.paxCount) changes.paxCount = paxCount;
    if (pickupLocation !== booking.pickupLocation) changes.pickupLocation = pickupLocation;
    if (memo) changes.memo = memo;
    if (hasAirport && (terminal !== booking.airport?.terminal || flightNumber !== booking.airport?.flightNumber)) {
      changes.airport = { ...booking.airport, terminal: terminal || undefined, flightNumber: flightNumber || undefined };
    }
    if (Object.keys(changes).length === 0) { setErr(i18n.modifyNoChanges); setSaving(false); return; }
    try {
      const res = await fetch('/api/modifyBooking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingID: booking.id, userEmail, tier, changes }),
      });
      const json = await res.json();
      if (json.ok) await onSaved();
      else setErr(json.error || i18n.modifyNetworkError);
    } catch (e) {
      setErr(e instanceof Error ? e.message : i18n.modifyNetworkError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-[#0f1628] rounded-2xl border border-[#7C5CFC]/30 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-bold">{i18n.modifyModalTitle} · {booking.bookingRef}</h3>
          <button onClick={onClose} className="text-white/55 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <Field label={i18n.modifyFieldDate}>
            <input type="date" value={tourDate} onChange={e => setTourDate(e.target.value)} className={modalInput} min={new Date().toISOString().slice(0,10)} />
          </Field>
          <Field label={i18n.modifyFieldPax}>
            <input type="number" min={1} max={30} value={paxCount} onChange={e => setPaxCount(parseInt(e.target.value, 10) || 1)} className={modalInput} />
          </Field>
          <Field label={i18n.modifyFieldPickup}>
            <input type="text" value={pickupLocation} onChange={e => setPickupLocation(e.target.value)} className={modalInput} />
          </Field>
          {hasAirport && (
            <>
              <Field label={i18n.terminal}>
                <div className="grid grid-cols-3 gap-2">
                  {(['T1', 'T2', ''] as const).map(t => (
                    <button key={t || 'none'} type="button"
                      onClick={() => setTerminal(t)}
                      className={`py-2 rounded-lg text-xs font-bold border ${terminal === t ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>
                      {t || i18n.modifyUndefined}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={i18n.flightNo}>
                <input type="text" value={flightNumber} onChange={e => setFlightNumber(e.target.value.toUpperCase())} placeholder={i18n.flightPlaceholder} className={modalInput} maxLength={10} />
              </Field>
            </>
          )}
          <Field label={i18n.modifyFieldReason}>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={1} className={`${modalInput} resize-none`} />
          </Field>
          {err && <p className="text-red-400 text-xs">⚠ {err}</p>}
        </div>
        <div className="px-5 py-4 border-t border-white/5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm">{i18n.modifyCancelBtn}</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
            {saving ? i18n.modifySaving : i18n.modifySaveBtn}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalInput = 'w-full px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-white/85 text-sm outline-none focus:border-[#B668FC]/50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">{label}</p>
      {children}
    </div>
  );
}

// 2026-05-04 P0 fix: 예약 상세 모달. 사용자 신고 — 카드 클릭 시 아무 일도 안 일어났음.
// 이 모달은 booking 데이터 (서비스/날짜/차량/인원/금액/이메일/항공편/수하물 등) + 환불 가능 여부 +
// CTA (취소 가능시 취소 버튼 / 불가시 약관 링크 + 문의 안내) 노출. 백엔드 추가 호출 없음 —
// 기존 my-bookings 응답으로 모두 표시.
function BookingDetailModal({
  booking, language, userEmail, onClose, onCancel, onModify, cancelingId,
}: {
  booking: Booking;
  language: 'ko' | 'en' | 'ja' | 'zh';
  userEmail: string;
  onClose: () => void;
  onCancel: () => void | Promise<void>;
  onModify: () => void;
  cancelingId: string | null;
}) {
  const i18n = getWizardI18n(language);
  const lug = booking.airport?.luggage || {};
  const luggageStr = (() => {
    const parts: string[] = [];
    if (lug.small) parts.push(`S:${lug.small}`);
    if (lug.medium) parts.push(`M:${lug.medium}`);
    if (lug.large) parts.push(`L:${lug.large}`);
    return parts.length ? parts.join(' · ') : '-';
  })();

  const isCanceled = booking.status === 'CANCELED';
  const isCompleted = booking.status === 'COMPLETED';
  const showCancelBtn = booking.status === 'CONFIRMED' && booking.canRefund;
  const showRefundClosedNote = booking.status === 'CONFIRMED' && !booking.canRefund && !booking.canModify
    && !(booking.productType || '').toString().startsWith('ai-planner');
  // 2026-05-04: voucher PDF 다운로드 — 취소된 booking + AI 플래너 (디지털 상품, voucher 없음)
  // 은 hide. CONFIRMED / MODIFIED / COMPLETED 모두 발급 가능 (백엔드 api/voucher.js 동일 정책).
  const isAiPlanner = (booking.productType || '').toString().startsWith('ai-planner');
  const showVoucherBtn = !isCanceled && !isAiPlanner;
  const voucherUrl = `/api/voucher?bookingID=${encodeURIComponent(booking.id)}&userEmail=${encodeURIComponent(userEmail)}`;

  const fallback = {
    title: i18n.mbDetailTitle || 'Booking Details',
    bookingRef: i18n.mbDetailBookingRef || 'Booking Ref',
    service: i18n.mbDetailService || 'Service',
    date: i18n.mbDetailDate || 'Tour Date',
    pickup: i18n.mbDetailPickup || 'Pickup',
    dropoff: i18n.mbDetailDropoff || 'Drop-off',
    vehicle: i18n.mbDetailVehicle || 'Vehicle',
    pax: i18n.mbDetailPax || 'Passengers',
    amount: i18n.mbDetailAmount || 'Amount Paid',
    email: i18n.mbDetailEmail || 'Email',
    flight: i18n.mbDetailFlight || 'Flight',
    terminal: i18n.mbDetailTerminal || 'Terminal',
    luggage: i18n.mbDetailLuggage || 'Luggage',
    refundEligible: i18n.mbDetailRefundEligible || 'This booking is eligible for refund.',
    refundClosed: i18n.mbDetailRefundClosed || 'Refund window has passed. See terms for our policy.',
    viewTerms: i18n.mbDetailViewTerms || 'View travel terms',
    close: i18n.mbDetailClose || 'Close',
    contact: i18n.mbDetailContact || 'Support: cocotripkr@gmail.com or use 1:1 chat (top-right)',
    canceledNote: i18n.mbDetailCanceledNote || 'This booking has been canceled.',
    completedNote: i18n.mbDetailCompletedNote || 'Tour completed. Hope you enjoyed it!',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md bg-[#0f1628] rounded-2xl border border-[#7C5CFC]/30 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Package size={16} className="text-[#B668FC]" />
            {fallback.title}
          </h3>
          <button onClick={onClose} className="text-white/55 hover:text-white" aria-label={fallback.close}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-2.5 text-sm overflow-y-auto">
          <DetailRow label={fallback.bookingRef} value={<code className="text-[#C4956A] font-mono text-xs">{booking.bookingRef}</code>} />
          <DetailRow label="Status" value={<StatusBadge status={booking.status} i18n={i18n} />} />
          <DetailRow label={fallback.service} value={prettyProductLabel(booking.productType, language)} />
          <DetailRow label={fallback.date} value={booking.tourDate || '-'} />
          {booking.pickupLocation && <DetailRow label={fallback.pickup} value={booking.pickupLocation} />}
          {booking.dropoffLocation && <DetailRow label={fallback.dropoff} value={booking.dropoffLocation} />}
          {booking.vehicleType && <DetailRow label={fallback.vehicle} value={booking.vehicleType} />}
          <DetailRow label={fallback.pax} value={`${booking.paxCount}${i18n.maxUnit || ''}`} />
          <DetailRow
            label={fallback.amount}
            value={
              <span className="text-white">
                <span className="font-bold">${booking.amountUSD}</span>
                <span className="text-white/55 text-xs"> · ₩{booking.amountKRW.toLocaleString('ko-KR')}</span>
              </span>
            }
          />
          {userEmail && <DetailRow label={fallback.email} value={<span className="text-white/80 text-xs break-all">{userEmail}</span>} />}
          {booking.airport?.terminal && <DetailRow label={fallback.terminal} value={booking.airport.terminal} />}
          {booking.airport?.flightNumber && <DetailRow label={fallback.flight} value={booking.airport.flightNumber} />}
          {booking.airport && (lug.small || lug.medium || lug.large) && <DetailRow label={fallback.luggage} value={luggageStr} />}
          {booking.status === 'CANCELED' && booking.refundedAmount > 0 && (
            <DetailRow label={i18n.mbRefundedAmount} value={`₩${booking.refundedAmount.toLocaleString('ko-KR')}`} />
          )}

          {/* 환불 정책 메시지 */}
          <div className="pt-3 mt-2 border-t border-white/5">
            {isCanceled && (
              <p className="text-red-300/80 text-xs">{fallback.canceledNote}</p>
            )}
            {isCompleted && (
              <p className="text-emerald-300/80 text-xs">{fallback.completedNote}</p>
            )}
            {showCancelBtn && (
              <p className="text-emerald-300/80 text-xs">
                {fallback.refundEligible}
                {' '}
                <span className="text-emerald-400 font-semibold">{i18n.mbRefundBadge(booking.refundPercent)}</span>
              </p>
            )}
            {showRefundClosedNote && (
              <div className="space-y-1.5">
                <p className="text-amber-300/80 text-xs italic">{fallback.refundClosed}</p>
                <Link
                  to="/travel-terms"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 text-[11px] text-[#B668FC] hover:text-[#FF6B9D] underline"
                >
                  <ExternalLink size={11} /> {fallback.viewTerms}
                </Link>
              </div>
            )}
            {(booking.productType || '').toString().startsWith('ai-planner') && (
              <p className="text-amber-300/70 text-[11px] italic mt-1">
                {i18n.mbDigitalNoRefund || 'Digital product · non-refundable'}
              </p>
            )}
          </div>

          {/* Voucher PDF 다운로드 — bookingID + userEmail 매칭 후 백엔드에서 PDF 스트리밍.
              api/voucher.js 가 booking-processor 와 동일 _generate-voucher.js 사용. */}
          {showVoucherBtn && (
            <a
              href={voucherUrl}
              download={`voucher_${booking.bookingRef}.pdf`}
              className="mt-3 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#C4956A]/40 text-[#C4956A] text-xs font-semibold hover:bg-[#C4956A]/10 transition-colors"
            >
              <Download size={13} />
              {i18n.mbDetailDownloadVoucher || 'Download Voucher'}
            </a>
          )}

          {/* 문의 안내 — 환불 정책에 막힌 사용자에게 사람과 연결 가능한 채널 안내. */}
          <p className="text-[11px] text-white/45 pt-2">{fallback.contact}</p>
        </div>

        <div className="px-5 py-4 border-t border-white/5 flex gap-2 flex-wrap">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm hover:bg-white/[0.05]"
          >
            {fallback.close}
          </button>
          {booking.status === 'CONFIRMED' && booking.canModify && (
            <button
              onClick={onModify}
              className="flex-1 py-2.5 rounded-xl border border-[#7C5CFC]/40 text-[#B668FC] text-sm font-semibold hover:bg-[#7C5CFC]/10 flex items-center justify-center gap-1.5"
            >
              <Edit size={14} /> {i18n.mbModifyBtn}
            </button>
          )}
          {showCancelBtn && (
            <button
              onClick={onCancel}
              disabled={cancelingId === booking.id}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-1.5"
              style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
            >
              {cancelingId === booking.id
                ? i18n.mbProcessing
                : <><XCircle size={14} /> {i18n.mbCancelBtn}</>}
            </button>
          )}
          {/* 2026-05-04 사용자 신고: 환불 윈도우 지난 booking에서 [취소] 버튼이 아예 사라져 있어
              "환불 버튼이 어디 있냐"는 혼란 발생. disabled 버튼으로 명시적으로 보여주되 클릭 시
              사유 안내 + 약관 링크 유도. AI 플래너는 디지털 상품이라 별도 처리. */}
          {showRefundClosedNote && (
            <button
              type="button"
              onClick={() => alert(`${fallback.refundClosed}\n\n${fallback.contact}`)}
              className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/35 text-sm font-semibold cursor-not-allowed flex items-center justify-center gap-1.5"
              title={fallback.refundClosed}
            >
              <XCircle size={14} /> {i18n.mbCancelBtn}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wider text-white/45 font-semibold shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-white/85 text-right break-words min-w-0">{value}</span>
    </div>
  );
}

function StatusBadge({ status, i18n }: { status: string; i18n: ReturnType<typeof getWizardI18n> }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    CONFIRMED: { label: i18n.statusConfirmed, color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/25' },
    MODIFIED:  { label: i18n.statusModified,  color: 'text-amber-300',   bg: 'bg-amber-500/10 border-amber-500/25' },
    CANCELED:  { label: i18n.statusCanceled,  color: 'text-red-300',     bg: 'bg-red-500/10 border-red-500/25' },
    COMPLETED: { label: i18n.statusCompleted, color: 'text-white/60',    bg: 'bg-white/5 border-white/10' },
  };
  const entry = map[status] ?? { label: status, color: 'text-white/50', bg: 'bg-white/5 border-white/10' };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${entry.color} ${entry.bg}`}>
      {status === 'CONFIRMED' && <Check size={9} />}
      {entry.label}
    </span>
  );
}
