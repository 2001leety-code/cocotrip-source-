/**
 * /booking/manage — 게스트 예약 관리(취소) 페이지 (2026-10-23, 후속 ②a).
 *
 * 확인 메일 링크 `/booking/manage#t=<token>` 로 들어온다. 토큰은 프래그먼트에서 한 번 읽어 state 에만 두고
 * 주소창에서 즉시 지운다(history.replaceState) — 쿼리·로그·Referer·분석에 남기지 않는다.
 * 서버 호출은 manageFetch(Bearer 없음, 본문 manageToken) 만 쓴다 — 로그인 여부와 무관.
 * 날짜 변경(②b): canModify 면 BookingDateChangeModal(auth guest). 성공 응답(복구 응답 포함)의 새 manageToken 으로
 * state 토큰을 교체한다(해시·URL 에는 다시 쓰지 않는다) — 날짜 변경이 버전을 올려 옛 토큰은 더 이상 통하지 않는다.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { manageFetch } from '@/lib/manageFetch';
import { BookingDateChangeModal, type DateChangeResult } from '@/components/BookingDateChangeModal';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ManagedBooking = {
  bookingID: string;
  bookingRef: string;
  label: string;
  tourDate: string;
  tourTime: string;
  paxCount: number;
  pickupLocation: string;
  vehicleType: string;
  amountUSD: string;
  currency: string;
  status: string;
  canRefund: boolean;
  canModify?: boolean;
  refundPercent: number;
  maskedEmail: string;
};

type Phase = 'loading' | 'invalid' | 'ready' | 'canceled' | 'pending' | 'error';

type Lookup = { kind: 'ready'; booking: ManagedBooking } | { kind: 'invalid' } | { kind: 'error' };

/** `#t=<token>` 에서 토큰만. 다른 프래그먼트 키는 무시. */
function readHashToken(): string {
  if (typeof window === 'undefined') return '';
  const m = /(?:^#|&)t=([^&]+)/.exec(window.location.hash || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

/** 예약 조회(마운트·"다시 조회"·취소 거부 뒤 재조회 공용). 401 = 링크 무효, 그 외 실패 = 일시 오류. */
async function loadBooking(manageToken: string): Promise<Lookup> {
  try {
    const res = await manageFetch('/api/booking-manage', { manageToken });
    const json = await res.json().catch(() => null);
    if (res.ok && json && json.ok && json.data) return { kind: 'ready', booking: json.data as ManagedBooking };
    return { kind: res.status === 401 ? 'invalid' : 'error' };
  } catch {
    return { kind: 'error' };
  }
}

export default function BookingManagePage() {
  const { language, t, changeLanguage } = useLanguage();
  const copy = t.bookingManage;
  // 렌더 중 1회 읽기 — 아래 effect 가 해시를 지운 뒤(StrictMode 재실행 포함)에도 state 가 토큰을 들고 있다.
  const [manageToken, setManageToken] = useState(readHashToken);
  const [phase, setPhase] = useState<Phase>(() => (manageToken ? 'loading' : 'invalid'));
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 취소가 업무 사유(이미 처리됨·취소 가능 시간 경과 등)로 거부돼 최신 상태를 다시 불러왔다는 안내.
  const [conflictNotice, setConflictNotice] = useState(false);
  const [dateChangeOpen, setDateChangeOpen] = useState(false);
  const [dateNotice, setDateNotice] = useState('');

  usePageMeta({ title: copy.bmTitle, description: copy.bmTitle, robots: 'noindex, nofollow' });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (!manageToken) return undefined;
    let cancelled = false;
    loadBooking(manageToken).then((r) => {
      if (cancelled) return;
      if (r.kind === 'ready') setBooking(r.booking);
      setPhase(r.kind);
    });
    return () => { cancelled = true; };
  }, [manageToken]);

  async function refreshBooking() {
    setPhase('loading');
    const r = await loadBooking(manageToken);
    if (r.kind === 'ready') setBooking(r.booking);
    setPhase(r.kind);
  }

  async function submitCancel() {
    if (!booking || submitting) return;
    setSubmitting(true);
    setConflictNotice(false);
    let refresh = false;
    try {
      const res = await manageFetch('/api/cancelBooking', {
        manageToken,
        body: { bookingID: booking.bookingID, reason: reason.trim().slice(0, 500) },
      });
      const json = await res.json().catch(() => null);
      const code = json && typeof json.code === 'string' ? json.code : '';
      if (res.status === 200) setPhase('canceled');
      else if (res.status === 202) setPhase('pending');
      else if (res.status === 401) setPhase('invalid');
      else if (res.status === 409 || code === 'NO_REFUND_DIGITAL') {
        // 업무 거부(CANCEL_IN_PROGRESS·INVALID_STATE·NO_REFUND …) — 오류로 끝내지 않고 최신 상태를 다시 보여 준다.
        setConflictNotice(true);
        refresh = true;
      } else setPhase('error');
    } catch {
      setPhase('error');
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
    if (refresh) await refreshBooking();
  }

  function onDateChanged(result: DateChangeResult) {
    setDateChangeOpen(false);
    setConflictNotice(false);
    const dc = t.bookingDateChange;
    // recovered = 서버 복구 응답(앞선 요청이 이미 반영) — 메일 결과를 모르므로 성공/실패 어느 쪽도 단정하지 않는다.
    const msg = result.recovered ? dc.bdcSavedRecovered
      : (result.emailSent ? dc.bdcSavedGuestMailSent : dc.bdcSavedGuestMailFailed);
    setDateNotice(msg.replace('{date}', result.tourDate));
    // 새 토큰으로 교체 → 위 effect 가 같은 토큰으로 다시 조회한다. 토큰이 없으면(이론상 없음) 현재 토큰으로 재조회.
    if (result.manageToken && result.manageToken !== manageToken) setManageToken(result.manageToken);
    else void refreshBooking();
  }

  const statusLabel = (status: string) => {
    if (status === 'CONFIRMED') return copy.bmStatusConfirmed;
    if (status === 'CANCELED' || status === 'REFUNDED') return copy.bmStatusCanceled;
    return copy.bmStatusProcessing;
  };

  const rows: [string, string][] = booking ? [
    [copy.bmBookingRef, booking.bookingRef],
    [copy.bmTour, booking.label],
    [copy.bmDate, [booking.tourDate, booking.tourTime].filter(Boolean).join(' ')],
    [copy.bmPax, String(booking.paxCount || '')],
    [copy.bmPickup, booking.pickupLocation],
    [copy.bmVehicle, booking.vehicleType],
    [copy.bmAmount, booking.amountUSD ? `${booking.currency} ${booking.amountUSD}` : ''],
    [copy.bmStatus, statusLabel(booking.status)],
    [copy.bmEmail, booking.maskedEmail],
  ].filter(([, v]) => Boolean(v)) as [string, string][] : [];

  return (
    <div className="ec-root min-h-screen">
      <meta name="referrer" content="no-referrer" />
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <main>
        <section className="border-b border-ec-line">
          <div className="ec-container-wide py-10 md:py-14">
            <h1 className="ec-h2 max-w-[24ch] text-[clamp(26px,3.4vw,40px)]">{copy.bmTitle}</h1>
          </div>
        </section>

        <section className="border-b border-ec-line bg-ec-sunken">
          <div className="ec-container-wide py-10 md:py-14">
            <div className="max-w-2xl rounded-ec-md border border-ec-line-2 bg-ec-raised p-5 md:p-7" aria-live="polite">
              {phase === 'loading' && <p className="ec-body">{copy.bmLoading}</p>}
              {phase === 'invalid' && <p className="ec-body">{copy.bmInvalid}</p>}
              {phase === 'error' && (
                <>
                  <p className="ec-body">{copy.bmResultError}</p>
                  {/* 조회만 다시 — 취소 요청을 재전송하지 않는다. */}
                  <button
                    type="button"
                    className="ec-btn ec-btn-secondary mt-4 min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ec-brand"
                    onClick={() => { void refreshBooking(); }}
                  >
                    {copy.bmRetryLookup}
                  </button>
                </>
              )}
              {phase === 'ready' && conflictNotice && (
                <p className="ec-body-sm mb-4 text-ec-ink-2" role="status">{copy.bmCancelConflict}</p>
              )}
              {phase === 'ready' && dateNotice && (
                <p className="ec-body-sm mb-4 text-ec-ink-2" role="status">{dateNotice}</p>
              )}
              {phase === 'canceled' && <p className="ec-body">{copy.bmResultCanceled}</p>}
              {phase === 'pending' && <p className="ec-body">{copy.bmResultPending}</p>}

              {phase === 'ready' && booking && (
                <>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
                    {rows.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="ec-body-sm text-ec-ink-2">{k}</dt>
                        <dd className="ec-body break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  {booking.canRefund ? (
                    <button
                      type="button"
                      className="ec-btn ec-btn-secondary mt-6 min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ec-brand"
                      onClick={() => setConfirmOpen(true)}
                    >
                      {copy.bmCancelCta}
                    </button>
                  ) : (
                    booking.status === 'CONFIRMED' && <p className="ec-body-sm mt-6 text-ec-ink-2">{copy.bmNoRefund}</p>
                  )}
                  {booking.canModify && (
                    <button
                      type="button"
                      className="ec-btn ec-btn-secondary mt-3 ml-0 sm:ml-3 min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ec-brand"
                      onClick={() => { setDateNotice(''); setDateChangeOpen(true); }}
                    >
                      {t.bookingDateChange.bdcButton}
                    </button>
                  )}
                </>
              )}

              <p className="ec-body-sm mt-6 text-ec-ink-2">{copy.bmContact}</p>
            </div>
          </div>
        </section>
      </main>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!submitting) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.bmConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.bmConfirmBody.replace('{percent}', String(booking ? booking.refundPercent : 0))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="ec-body-sm text-ec-ink-2">{copy.bmPolicy}</p>
          <label className="ec-body-sm mt-2 block" htmlFor="bm-reason">{copy.bmReasonLabel}</label>
          <textarea
            id="bm-reason"
            className="mt-1 w-full rounded-ec-md border border-ec-line-2 bg-transparent p-2 text-[15px]"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{copy.bmBack}</AlertDialogCancel>
            <button
              type="button"
              className="ec-btn ec-btn-primary min-h-[44px]"
              disabled={submitting}
              onClick={submitCancel}
            >
              {submitting ? copy.bmCanceling : copy.bmConfirmCta}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dateChangeOpen && booking && (
        <BookingDateChangeModal
          bookingID={booking.bookingID}
          bookingRef={booking.bookingRef}
          currentDate={booking.tourDate}
          tourTime={booking.tourTime}
          language={language}
          auth={{ kind: 'guest', manageToken }}
          onClose={() => setDateChangeOpen(false)}
          onSaved={onDateChanged}
          onReload={() => { setDateChangeOpen(false); void refreshBooking(); }}
        />
      )}

      <Footer t={t} />
    </div>
  );
}
