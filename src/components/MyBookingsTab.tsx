// MyBookingsTab — MyPage의 "My Bookings" 탭 콘텐츠 · i18n
import { useState, useEffect, useCallback } from 'react';
import { Package, Clock, XCircle, Edit, Check, X, Star } from 'lucide-react';
import { getWizardI18n } from '@/components/charter/wizard-i18n';
import { ReviewSubmitModal } from '@/components/ReviewSubmitModal';
import { useAuth } from '@/hooks/useAuth';

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
  airport?: {
    terminal?: 'T1' | 'T2';
    flightNumber?: string;
    luggage?: { small?: number; medium?: number; large?: number };
  };
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
        <div key={b.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-[#7C5CFC]/20 transition-all">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status={b.status} i18n={i18n} />
                <span className="text-[11px] text-white/55 font-mono">{b.bookingRef}</span>
              </div>
              <p className="text-white text-sm font-medium">{b.productType}</p>
              <p className="text-white/50 text-xs mt-0.5">
                {b.tourDate} · {b.paxCount}{i18n.maxUnit} · {b.vehicleType}
              </p>
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
            <div className="flex gap-2 mt-3">
              {b.canModify && (
                <button
                  type="button"
                  onClick={() => setModifyTarget(b)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-[11px] hover:bg-white/5"
                >
                  <Edit size={12} /> {i18n.mbModifyBtn}
                </button>
              )}
              {b.canRefund && (
                <button
                  type="button"
                  disabled={cancelingId === b.id}
                  onClick={() => handleCancel(b)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/25 text-red-300 text-[11px] hover:bg-red-500/10 disabled:opacity-40"
                >
                  {cancelingId === b.id ? i18n.mbProcessing : <><XCircle size={12} /> {i18n.mbCancelBtn}</>}
                </button>
              )}
            </div>
          )}

          {/* Review CTA — only for completed bookings, hidden once submitted
              this session. Server enforces one-review-per-product so the
              client-side guard is just UX. */}
          {b.status === 'COMPLETED' && user?.uid && !reviewedBookingIds.has(b.id) && (
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setReviewTarget(b)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-yellow-500/25 text-yellow-200 text-[11px] hover:bg-yellow-500/10 transition-colors"
              >
                <Star size={12} className="fill-yellow-400 text-yellow-400" /> {i18n.mbReviewBtn || 'Write a review · +50 coins'}
              </button>
            </div>
          )}
        </div>
      ))}

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
