/**
 * AdminPayments — PayPal 수동 결제 + pending_bookings 관리.
 *
 * Route: /admin/payments (gated by AdminRoute)
 *
 * 운영자 흐름:
 *   1. 사용자가 한국 체류 중 PayPal QR 결제 후 [결제 완료 신고] 클릭
 *   2. 텔레그램 booking 채널 #1 알림 도착
 *   3. 운영자 PayPal 거래내역에서 입금자명 (= booking ref) 매칭 확인
 *   4. 본 페이지에서 해당 카드 → [입금 확인] 클릭 → CONFIRMED + 영수증 자동 발송
 *   5. (필요 시) [환불 처리됨] 또는 [취소] 클릭
 *
 * Firestore: pending_bookings 컬렉션 실시간 구독.
 * Server: /api/admin-booking-action 호출.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, type DocumentData } from 'firebase/firestore';
import { RuntimeFlagsPanel } from '@/components/admin/RuntimeFlagsPanel';
import {
  Wallet, ArrowLeft, CheckCircle2, XCircle, RefreshCw, Loader2, ExternalLink,
  Mail, Phone, Calendar, Users, Tag, Copy, Check,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

type StatusFilter = 'AWAITING_VERIFICATION' | 'CONFIRMED' | 'REFUNDED' | 'CANCELED' | 'all';

interface PendingBooking {
  id: string;
  bookingRef: string;
  productType: string;
  passengers: number;
  dateStart: string;
  dateEnd: string;
  priceKRW: number;
  priceUSD: string | null;
  customerEmail: string;
  customerPhone: string | null;
  pickupLocation: string;
  dropoffLocation: string;
  vehicleType: string;
  memo: string;
  paymentMethod: string;
  paypalMeUrl: string | null;
  language: string;
  userId: string | null;
  status: 'AWAITING_VERIFICATION' | 'CONFIRMED' | 'REFUNDED' | 'CANCELED' | string;
  createdAt?: { toMillis(): number };
  confirmedAt?: { toMillis(): number };
  refundedAt?: { toMillis(): number };
  paypalTransactionId?: string;
  refundedKRW?: number;
  refundReason?: string;
  cancelReason?: string;
  // Smart Buttons capture 응답 일부 (capturePaypalOrder.js 가 동일 doc 에 머지 시 노출).
  rawCapturePayload?: {
    payer?: { email_address?: string };
    amount?: { value?: string; currency_code?: string };
    captureID?: string;
    status?: string;
    create_time?: string;
  };
}

function formatTs(ts?: { toMillis(): number }): string {
  if (!ts) return '';
  const d = new Date(ts.toMillis());
  return d.toLocaleString('ko-KR', { hour12: false });
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    AWAITING_VERIFICATION: { label: '입금 확인 대기', className: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
    CONFIRMED: { label: '결제완료', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
    REFUNDED: { label: '환불완료', className: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
    CANCELED: { label: '취소', className: 'bg-white/[0.05] text-white/60 border-white/[0.15]' },
  };
  const s = map[status] || { label: status, className: 'bg-white/[0.05] text-white/60 border-white/[0.15]' };
  return <span className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-semibold border ${s.className}`}>{s.label}</span>;
}

// 어드민 테스트 예약(결제 우회) vs 실결제 구분 (2026-06-05) — booking-processor 가 ADMIN-BYPASS- orderID 에
// paymentMethod:'admin-bypass' 기록. 다중 신호로 robust 감지 (기존 예약 호환).
function isTestBooking(b: PendingBooking): boolean {
  return b.paymentMethod === 'admin-bypass'
    || String(b.paypalTransactionId || '').startsWith('ADMIN-BYPASS-')
    || String(b.id || '').startsWith('ADMIN-BYPASS-');
}

export default function AdminPayments() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('AWAITING_VERIFICATION');
  const [rows, setRows] = useState<PendingBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hideTest, setHideTest] = useState(false); // 테스트(결제우회) 예약 숨기기 토글

  const isAdmin = user?.email === (import.meta.env.VITE_ADMIN_EMAIL || '2001leety@gmail.com');

  // Firestore 실시간 구독
  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    const q = query(collection(db, 'pending_bookings'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })) as PendingBooking[];
        setRows(list);
        setLoading(false);
      },
      (err) => {
        console.error('[admin-payments] subscribe failed:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [isAdmin]);

  const filtered = useMemo(() => {
    let r = hideTest ? rows.filter((b) => !isTestBooking(b)) : rows;
    if (filter !== 'all') r = r.filter((b) => b.status === filter);
    return r;
  }, [rows, filter, hideTest]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const callAction = useCallback(async (
    bookingRef: string,
    action: 'mark-paid' | 'mark-refunded' | 'mark-canceled',
    extra: { paypalTransactionId?: string; refundedKRW?: number; reason?: string } = {},
  ) => {
    if (!user) return;
    setBusyId(bookingRef);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-booking-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ bookingRef, action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `${action} failed`);
      }
      // 성공 시 onSnapshot 이 자동 갱신해서 별도 setState 불필요
    } catch (e) {
      console.error(`[admin-payments] ${action} failed:`, e);
      alert(`작업 실패: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusyId(null);
    }
  }, [user]);

  async function handleMarkPaid(b: PendingBooking) {
    const txId = window.prompt(
      `💳 PayPal 거래내역에서 transaction ID 입력 (선택, 없으면 빈칸):\n\n예약번호: ${b.bookingRef}\n금액: ₩${b.priceKRW.toLocaleString('ko-KR')}\n이메일: ${b.customerEmail}`,
      '',
    );
    if (txId === null) return; // cancel
    if (!confirm(`✅ ${b.bookingRef} 입금 확인 처리하시겠습니까?\n\n• status → CONFIRMED\n• 영수증/플랜 자동 이메일 발송\n• 텔레그램 매칭 알림`)) return;
    await callAction(b.bookingRef, 'mark-paid', { paypalTransactionId: txId.trim() || undefined });
  }

  async function handleRefund(b: PendingBooking) {
    const amountStr = window.prompt(
      `💸 환불 금액 입력 (KRW, 비우면 전액 ₩${b.priceKRW.toLocaleString('ko-KR')}):`,
      String(b.priceKRW),
    );
    if (amountStr === null) return;
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('금액이 올바르지 않습니다');
      return;
    }
    const reason = window.prompt('환불 사유 (옵션):', '');
    if (reason === null) return;
    if (!confirm(`💸 ${b.bookingRef} 환불 ₩${amount.toLocaleString('ko-KR')} 처리하시겠습니까?\n\nPayPal 수동 환불은 별도로 운영자가 진행한 후, 본 작업은 시스템 동기화 + 사용자 안내만 처리합니다.`)) return;
    await callAction(b.bookingRef, 'mark-refunded', { refundedKRW: amount, reason: reason.trim() || undefined });
  }

  async function handleCancel(b: PendingBooking) {
    const reason = window.prompt(`❌ ${b.bookingRef} 취소 사유 (옵션):`, '');
    if (reason === null) return;
    if (!confirm(`예약을 취소 처리하시겠습니까?\n\n사용자에겐 결제 미완료로 처리되며, 환불은 발생하지 않습니다.`)) return;
    await callAction(b.bookingRef, 'mark-canceled', { reason: reason.trim() || undefined });
  }

  function copyRef(b: PendingBooking) {
    void navigator.clipboard.writeText(b.bookingRef).then(() => {
      setCopiedId(b.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#080b14' }}>
        <p className="text-white/60">관리자 전용 페이지입니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: '#080b14' }}>
      {/* Header — 모바일에서 wrap 가능 */}
      <div className="border-b border-white/[0.06] bg-[#0c1220]/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-5 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <Link to="/admin" className="flex items-center gap-2 text-white/60 hover:text-white text-sm min-h-[44px]">
            <ArrowLeft className="w-4 h-4" />
            관리자 홈
          </Link>
          <div className="flex items-center gap-2 order-3 sm:order-2 w-full sm:w-auto justify-center">
            <Wallet className="w-5 h-5 text-amber-300" />
            <h1 className="text-sm sm:text-base font-bold text-white">결제 관리 (PayPal 수동)</h1>
          </div>
          <div className="text-[11px] text-white/45 order-2 sm:order-3">
            총 {counts.all || 0}건
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {/* 어드민 조종석 런타임 토글 (2026-06-06) */}
        <RuntimeFlagsPanel />

        {/* 필터 탭 — 모바일 가로 스크롤 가능 */}
        <div className="flex gap-2 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0 pb-1 flex-nowrap sm:flex-wrap">
          {([
            { key: 'AWAITING_VERIFICATION', label: '입금 확인 대기' },
            { key: 'CONFIRMED', label: '결제완료' },
            { key: 'REFUNDED', label: '환불완료' },
            { key: 'CANCELED', label: '취소' },
            { key: 'all', label: '전체' },
          ] as { key: StatusFilter; label: string }[]).map(({ key, label }) => {
            const sel = filter === key;
            const cnt = counts[key] ?? (key === 'all' ? counts.all : 0);
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3.5 py-2 rounded-xl text-sm sm:text-[12px] font-semibold border transition-all min-h-[44px] shrink-0 whitespace-nowrap ${
                  sel
                    ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
                }`}
              >
                {label}
                {cnt > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] ${sel ? 'bg-[#7C5CFC]/40' : 'bg-white/[0.08]'}`}>
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 테스트/실결제 구분 토글 (2026-06-05: 어드민 테스트 예약 vs 실결제 나누기) */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-white/45">
            실결제 <b className="text-emerald-300">{rows.filter((b) => !isTestBooking(b)).length}</b>건 · 테스트 <b className="text-amber-300">{rows.filter(isTestBooking).length}</b>건
          </p>
          <button
            onClick={() => setHideTest((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all min-h-[36px] ${
              hideTest
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
            }`}
          >
            {hideTest ? '✓ 실결제만 보는 중' : '테스트 숨기기'}
          </button>
        </div>

        {/* 안내 */}
        <div className="bg-amber-500/[0.08] border border-amber-500/25 rounded-xl px-3 sm:px-4 py-3 text-[12px] sm:text-[12px] text-amber-100/80 leading-relaxed">
          <strong className="text-amber-200">운영 안내</strong>: 사용자 PayPal 결제 후 [결제 완료 신고] 누르면 여기 표시됩니다.
          PayPal 거래내역에서 입금자명 (=예약번호) 또는 이메일로 매칭 후 [입금 확인] 클릭하세요.
          확인 시 영수증/플랜이 자동 발송됩니다.
        </div>

        {/* 리스트 */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-white/55" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-white/45 text-sm">
              {filter === 'AWAITING_VERIFICATION' ? '입금 확인 대기 중인 예약이 없습니다' : '해당 상태의 예약이 없습니다.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => (
              <article key={b.id} className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 sm:p-5">
                {/* Top row: ref + status — 모바일에서는 수직 스택 */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-2 sm:gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <button
                      onClick={() => copyRef(b)}
                      className="font-mono text-sm font-bold text-white hover:text-[#B9A4FF] flex items-center gap-1.5 min-h-[44px]"
                      title="복사"
                    >
                      {b.bookingRef}
                      {copiedId === b.id ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3 text-white/40" />}
                    </button>
                    {statusBadge(b.status)}
                    {isTestBooking(b)
                      ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">🧪 테스트</span>
                      : <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">💳 실결제</span>}
                  </div>
                  <div className="text-[11px] text-white/45 shrink-0">
                    신고: {formatTs(b.createdAt)}
                  </div>
                </div>

                {/* Info grid — 모바일 1열, 태블릿 2열, 데스크톱 4열 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 mb-3 text-sm sm:text-[12px]">
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
                    <p className="text-[10px] text-white/45 uppercase tracking-wider mb-0.5">상품</p>
                    <p className="text-white font-mono text-[11px] truncate">{b.productType}</p>
                  </div>
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
                    <p className="text-[10px] text-white/45 uppercase tracking-wider mb-0.5">금액</p>
                    <p className="text-white font-bold">₩{b.priceKRW.toLocaleString('ko-KR')}</p>
                    {b.priceUSD && <p className="text-[10px] text-white/45">${b.priceUSD}</p>}
                  </div>
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 sm:col-span-2">
                    <p className="text-[10px] text-white/45 uppercase tracking-wider mb-0.5 flex items-center gap-1">
                      <Mail className="w-2.5 h-2.5" /> 이메일
                    </p>
                    <p className="text-white text-[12px] truncate">{b.customerEmail}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 sm:gap-3 mb-3 text-sm sm:text-[11px] text-white/55">
                  {b.passengers > 0 && (<span className="flex items-center gap-1"><Users className="w-3 h-3" /> {b.passengers}인</span>)}
                  {b.dateStart && (<span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {b.dateStart}{b.dateEnd && b.dateEnd !== b.dateStart ? ` ~ ${b.dateEnd}` : ''}</span>)}
                  {b.customerPhone && (<span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {b.customerPhone}</span>)}
                  {b.pickupLocation && (<span className="flex items-center gap-1 break-all"><Tag className="w-3 h-3 shrink-0" /> {b.pickupLocation}</span>)}
                  {b.language && b.language !== 'ko' && (<span className="px-1.5 py-0.5 rounded bg-[#7C5CFC]/15 text-[#B9A4FF] uppercase">{b.language}</span>)}
                </div>

                {/* Confirmed/refunded/canceled meta */}
                {b.status === 'CONFIRMED' && (
                  <div className="text-sm sm:text-[11px] text-emerald-300/80 mb-3 bg-emerald-500/[0.04] border border-emerald-500/20 rounded-lg px-3 py-2 break-words">
                    결제완료: {formatTs(b.confirmedAt)}{b.paypalTransactionId ? ` · PayPal TX: ${b.paypalTransactionId}` : ''}
                  </div>
                )}
                {/* PayPal Smart Buttons capture 응답 — 모바일에서는 collapse 토글 */}
                {b.rawCapturePayload && (
                  <details className="mb-3">
                    <summary className="text-[11px] text-white/45 cursor-pointer hover:text-white/70 min-h-[44px] flex items-center sm:min-h-0 sm:py-1">
                      결제 디버깅 정보 (PayPal capture)
                    </summary>
                    <div className="text-[10px] text-white/45 mt-1 bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2 font-mono leading-relaxed break-all">
                      <span className="text-white/55">capture:</span>{' '}
                      {b.rawCapturePayload.payer?.email_address || '—'}
                      {b.rawCapturePayload.amount?.value ? ` · $${b.rawCapturePayload.amount.value}` : ''}
                      {b.rawCapturePayload.captureID ? ` · ${b.rawCapturePayload.captureID}` : ''}
                    </div>
                  </details>
                )}
                {b.status === 'REFUNDED' && (
                  <div className="text-sm sm:text-[11px] text-rose-300/80 mb-3 bg-rose-500/[0.04] border border-rose-500/20 rounded-lg px-3 py-2 break-words">
                    환불완료: {formatTs(b.refundedAt)} · ₩{(b.refundedKRW || 0).toLocaleString('ko-KR')}
                    {b.refundReason ? ` · 사유: ${b.refundReason}` : ''}
                  </div>
                )}
                {b.status === 'CANCELED' && b.cancelReason && (
                  <div className="text-sm sm:text-[11px] text-white/55 mb-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2">
                    취소 사유: {b.cancelReason}
                  </div>
                )}

                {/* Actions — 모바일에서는 수직 스택, 데스크톱은 가로 */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 pt-1">
                  {b.paypalMeUrl && (
                    <a
                      href={b.paypalMeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-lg text-sm sm:text-[11px] font-semibold text-white/70 border border-white/[0.15] hover:bg-white/[0.05] flex items-center justify-center sm:justify-start gap-1 min-h-[44px]"
                    >
                      <ExternalLink className="w-4 h-4 sm:w-3 sm:h-3" />
                      PayPal 링크
                    </a>
                  )}
                  {b.status === 'AWAITING_VERIFICATION' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleMarkPaid(b)}
                        disabled={busyId === b.bookingRef}
                        className="px-3 py-2 rounded-lg text-sm sm:text-[11px] font-bold text-white flex items-center justify-center sm:justify-start gap-1 disabled:opacity-50 min-h-[44px]"
                        style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                      >
                        {busyId === b.bookingRef ? <Loader2 className="w-4 h-4 sm:w-3 sm:h-3 animate-spin" /> : <CheckCircle2 className="w-4 h-4 sm:w-3 sm:h-3" />}
                        입금 확인
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancel(b)}
                        disabled={busyId === b.bookingRef}
                        className="px-3 py-2 rounded-lg text-sm sm:text-[11px] font-bold text-white/80 border border-white/[0.15] hover:bg-white/[0.05] flex items-center justify-center sm:justify-start gap-1 disabled:opacity-50 min-h-[44px]"
                      >
                        <XCircle className="w-4 h-4 sm:w-3 sm:h-3" />
                        취소
                      </button>
                    </>
                  )}
                  {b.status === 'CONFIRMED' && (
                    <button
                      type="button"
                      onClick={() => handleRefund(b)}
                      disabled={busyId === b.bookingRef}
                      className="px-3 py-2 rounded-lg text-sm sm:text-[11px] font-bold text-white flex items-center justify-center sm:justify-start gap-1 disabled:opacity-50 min-h-[44px]"
                      style={{ background: 'linear-gradient(135deg, #f43f5e, #be123c)' }}
                    >
                      {busyId === b.bookingRef ? <Loader2 className="w-4 h-4 sm:w-3 sm:h-3 animate-spin" /> : <RefreshCw className="w-4 h-4 sm:w-3 sm:h-3" />}
                      환불 처리 (PayPal 수동 후)
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
