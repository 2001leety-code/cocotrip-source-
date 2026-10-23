/**
 * /admin/all-bookings — 통합 예약 뷰 (무드 + 코코트립 한 곳에)
 *
 * 운영자 요청: "총 토탈 예약사항이 '무드 - OOO 예약', '코코트립 - OOO 예약' 이렇게
 * 한눈에 떠야 함." → 두 사업의 예약을 한 리스트로.
 *
 * 데이터: GET /api/admin-all-bookings (admin SDK 가 pending_bookings + mood_bookings
 * 둘 다 읽어 출처 라벨 붙여 합침). mood_bookings 는 firestore.rules client read:false
 * 라 반드시 백엔드 엔드포인트 경유.
 *
 * 2026-07-28: "배차실패 취소" 버튼 추가 — 차량·기사를 못 구했을 때 운영자가 사유를 남기고
 * 전액 환불로 취소한다(POST /api/admin-booking-action, action=dispatch-cancel).
 * 2026-10-23: PayPal 직접 결제 예약(bookings, kind='paypal')도 목록에 포함 — "취소 + 전액 환불 (PayPal)"
 * 버튼(action=refund-booking). 환불할 수 없는 행(refundable=false)은 버튼 대신 이유를 보여준다.
 * 2026-10-23 (PR-3): 게스트 PayPal 예약에 "관리 링크 재발송"(action=resend-manage-link) — 저장된 결제자
 * 이메일로만 보내고, 응답엔 마스킹된 주소만 온다(토큰·링크는 이 화면에 오지 않는다).
 * 그 외에는 여전히 읽기 전용.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Calendar, Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { usePageMeta } from '@/hooks/usePageMeta';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Source = 'cocotrip' | 'mood';
type SourceFilter = Source | 'all';
/** pending = pending_bookings(수동·QR 흐름), paypal = bookings(PayPal 직접 결제), mood = mood_bookings. */
type Kind = 'pending' | 'paypal' | 'mood';

interface BookingItem {
  source: Source;
  kind: Kind;
  id: string;
  bookingRef: string;
  label: string;
  date: string;
  amountKRW: number;
  priceUSD: number | string | null;
  status: string;
  detail: string;
  createdAtMs: number;
  isTest: boolean;
  // kind === 'paypal' 전용
  captureID?: string | null;
  parentOrderID?: string | null;
  refundable?: boolean;
  linkLookupFailed?: boolean;
  /** 게스트 관리 대상(회원·cart 자식 아님) — 관리 링크 재발송 버튼 노출 조건. */
  guestManaged?: boolean;
  /** 날짜 변경 뒤 새 관리 링크 메일 실패(또는 pending 삭제 실패) — 전달 여부 확인 필요. */
  manageLinkPending?: boolean;
  manageLinkResentAt?: number | null;
}

interface Counts { cocotrip: number; mood: number; paypal?: number }

interface ApiResponse {
  ok: boolean;
  data?: {
    items: BookingItem[];
    total: number;
    counts: Counts;
    partialErrors?: Record<string, string>;
  };
  error?: string;
}

async function fetchAllBookings(user: { getIdToken(): Promise<string> }): Promise<NonNullable<ApiResponse['data']>> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/admin-all-bookings?limit=200', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const json: ApiResponse = await res.json();
  if (!res.ok || !json.ok || !json.data) throw new Error(json.error || '불러오기 실패');
  return json.data;
}

// 출처별 라벨 + 색 (DESIGN.md: 코코트립=보라 #7C5CFC, 무드=핑크 그라데이션 계열).
const SOURCE_META: Record<Source, { label: string; badgeClass: string }> = {
  cocotrip: { label: '코코트립', badgeClass: 'bg-[#7C5CFC]/18 text-[#B9A4FF] border-[#7C5CFC]/40' },
  mood: { label: '무드', badgeClass: 'bg-pink-500/15 text-pink-300 border-pink-500/40' },
};

// 상태 한글 뱃지 (코코트립 pending_bookings + 무드 confirmed 공통).
function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    AWAITING_VERIFICATION: { label: '입금 대기', className: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
    CONFIRMED: { label: '결제완료', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
    confirmed: { label: '확정', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
    REFUNDED: { label: '환불완료', className: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
    CANCELED: { label: '취소', className: 'bg-white/[0.05] text-white/55 border-white/[0.15]' },
  };
  if (!status) return null;
  const s = map[status] || { label: status, className: 'bg-white/[0.05] text-white/55 border-white/[0.15]' };
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold border ${s.className}`}>{s.label}</span>;
}

function formatKRW(n: number): string {
  return `₩${(Number(n) || 0).toLocaleString('ko-KR')}`;
}

/** 배차 실패 취소 사유 분류 — 값은 백엔드 DISPATCH_CANCEL_CATEGORIES 와 1:1. */
type CancelCategory = 'no_vehicle' | 'no_driver' | 'customer_request' | 'other';
const CANCEL_CATEGORY_OPTIONS: { key: CancelCategory; label: string }[] = [
  { key: 'no_vehicle', label: '차량 미확보' },
  { key: 'no_driver', label: '기사 미확보' },
  { key: 'other', label: '기타' },
];
/** PayPal 전액 환불 사유 분류 — 값은 백엔드 REFUND_BOOKING_CATEGORIES 와 1:1 (고객 요청 포함). */
const REFUND_CATEGORY_OPTIONS: { key: CancelCategory; label: string }[] = [
  { key: 'customer_request', label: '고객 요청' },
  { key: 'no_vehicle', label: '차량 미확보' },
  { key: 'no_driver', label: '기사 미확보' },
  { key: 'other', label: '기타' },
];

function formatUSD(v: number | string | null): string | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : null;
}

/** PayPal 행이 환불 불가일 때 버튼 대신 보여줄 이유. 결제완료가 아니면 상태 뱃지로 충분하다. */
function paypalRefundBlockReason(b: BookingItem): string {
  if (b.linkLookupFailed) return '연결 예약 확인 실패 — 환불 보류';
  if (b.status !== 'CONFIRMED') return '';
  if (b.parentOrderID) return '장바구니 항목 — 수동 환불';
  if (b.isTest) return '테스트 결제 — 자동 환불 불가';
  if (!b.captureID) return 'capture 없음 — 수동 환불';
  return '미검증·수동 결제 또는 환불 이력 — 자동 환불 불가';
}

export default function AdminAllBookings() {
  // 2026-07-28: 관리자 화면마다 브라우저 탭 제목이 일반 CocoTrip 제목으로 같아
  //   탭을 여러 개 띄우면 구분이 안 됐다.
  usePageMeta({ title: '통합 예약 (관리자)', description: 'All CocoTrip and MOOD bookings in one list.' });
  const { user } = useAuth();
  const [items, setItems] = useState<BookingItem[] | null>(null);
  const [counts, setCounts] = useState<Counts>({ cocotrip: 0, mood: 0, paypal: 0 });
  const [partialErrors, setPartialErrors] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [hideTest, setHideTest] = useState(true);
  // 배차 실패 취소 대상 (모달) — 읽기 전용이던 화면에 유일하게 추가된 쓰기 동작.
  const [cancelTarget, setCancelTarget] = useState<BookingItem | null>(null);
  const [previousUser, setPreviousUser] = useState(user);
  if (previousUser !== user) {
    setPreviousUser(user);
    if (user) {
      setLoading(true);
      setError(null);
    }
  }

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllBookings(user);
      setItems(data.items);
      setCounts(data.counts);
      setPartialErrors(data.partialErrors || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchAllBookings(user)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setCounts(data.counts);
        setPartialErrors(data.partialErrors || null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '오류');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  const filtered = useMemo(() => {
    let r = items || [];
    if (hideTest) r = r.filter((b) => !b.isTest);
    if (filter !== 'all') r = r.filter((b) => b.source === filter);
    return r;
  }, [items, filter, hideTest]);

  const testCount = useMemo(() => (items || []).filter((b) => b.isTest).length, [items]);

  // 게스트 관리 링크 재발송 — 저장된 payerEmail 로만, 현재 버전 링크(기존 링크도 유효).
  //   확인창(ResendLinkConfirmModal) → 요청. 잠금은 화면 전체 하나 — 진행 중엔 모든 행의 재발송이 막힌다.
  const [resendTarget, setResendTarget] = useState<BookingItem | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  // 확인창이 닫히면 초점을 그 행의 재발송 버튼으로 돌려준다(트리거 없이 여므로 Radix 기본 복귀가 없다).
  const resendBtnRefs = useRef(new Map<string, HTMLButtonElement>());
  const resendManageLink = async (b: BookingItem) => {
    if (!user || resendingId !== null) return;
    setResendingId(b.id);
    try {
      // 이 화면의 기존 관례(DispatchCancelModal 과 같은 Bearer 첨부) — useAuth 의 user 토큰.
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-booking-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ bookingRef: b.bookingRef, action: 'resend-manage-link' }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        toast.success(`${json.data.recipientMasked} 로 관리 링크를 보냈습니다`);
        void reload();
      } else if (res.status === 429) {
        toast.error('방금 재발송했습니다 — 1분 뒤 다시 시도하세요');
      } else {
        // 502 MAIL_FAILED(미발송) / MAIL_RESULT_UNKNOWN(수동 확인) · 409 만료·환경 — 서버 문구 그대로.
        toast.error(json?.error || `재발송 실패 (HTTP ${res.status})`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '재발송 실패');
    } finally {
      setResendingId(null);
      setResendTarget(null);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: '#080b14' }}>
      <Toaster position="top-center" richColors />
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-[#0c1220]/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 sm:px-5 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <Link to="/admin" className="flex items-center gap-2 text-white/60 hover:text-white text-sm min-h-[44px]">
            <ArrowLeft className="w-4 h-4" />
            관리자 홈
          </Link>
          <div className="flex items-center gap-2 order-3 sm:order-2 w-full sm:w-auto justify-center">
            <Calendar className="w-5 h-5 text-[#B9A4FF]" />
            <h1 className="text-sm sm:text-base font-bold text-white">통합 예약 (무드 + 코코트립)</h1>
          </div>
          <button
            onClick={reload}
            disabled={loading}
            className="text-[11px] text-white/45 hover:text-white inline-flex items-center gap-1.5 order-2 sm:order-3 min-h-[36px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            갱신
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {/* 출처별 합계 */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2.5 text-center">
            <p className="text-[10px] text-white/45 uppercase tracking-wider mb-0.5">전체</p>
            <p className="text-lg font-extrabold text-white">{(items || []).length}</p>
          </div>
          <div className="bg-[#7C5CFC]/[0.08] border border-[#7C5CFC]/25 rounded-xl px-3 py-2.5 text-center">
            <p className="text-[10px] text-[#B9A4FF]/70 uppercase tracking-wider mb-0.5">코코트립</p>
            <p className="text-lg font-extrabold text-[#B9A4FF]">{counts.cocotrip}</p>
            {Number(counts.paypal) > 0 && (
              <p className="text-[10px] text-[#B9A4FF]/60">PayPal {counts.paypal}</p>
            )}
          </div>
          <div className="bg-pink-500/[0.08] border border-pink-500/25 rounded-xl px-3 py-2.5 text-center">
            <p className="text-[10px] text-pink-300/70 uppercase tracking-wider mb-0.5">무드</p>
            <p className="text-lg font-extrabold text-pink-300">{counts.mood}</p>
          </div>
        </div>

        {/* 필터 + 테스트 토글 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {([
              { key: 'all', label: '전체' },
              { key: 'cocotrip', label: '코코트립' },
              { key: 'mood', label: '무드' },
            ] as { key: SourceFilter; label: string }[]).map(({ key, label }) => {
              const sel = filter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold border transition-all min-h-[40px] ${
                    sel
                      ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white'
                      : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {testCount > 0 && (
            <button
              onClick={() => setHideTest((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all min-h-[36px] ${
                hideTest
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
              }`}
            >
              {hideTest ? `✓ 실결제만 (테스트 ${testCount} 숨김)` : '테스트 숨기기'}
            </button>
          )}
        </div>

        {/* 부분 오류 안내 (한쪽 컬렉션 읽기 실패해도 다른 쪽 표시) */}
        {partialErrors && (
          <div className="bg-amber-500/[0.08] border border-amber-500/25 rounded-xl px-3 py-2.5 text-[12px] text-amber-100/80">
            ⚠ 일부 데이터를 불러오지 못했습니다: {Object.keys(partialErrors).join(', ')}
          </div>
        )}

        {/* 리스트 */}
        {error ? (
          <div className="text-center py-12">
            <p className="text-rose-300/80 text-sm">{error}</p>
          </div>
        ) : loading && !items ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-white/55" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-white/45 text-sm">표시할 예약이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((b) => {
              const meta = SOURCE_META[b.source];
              const isPaypal = b.kind === 'paypal';
              const usd = formatUSD(b.priceUSD);
              const blockReason = isPaypal && !b.refundable ? paypalRefundBlockReason(b) : '';
              return (
                <article
                  key={`${b.kind}:${b.id}`}
                  className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4"
                >
                  {/* 출처 뱃지 + 라벨 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className={`shrink-0 inline-block px-2 py-1 rounded-md text-[11px] font-bold border ${meta.badgeClass}`}>
                      {meta.label}
                    </span>
                    {isPaypal && (
                      <span className="shrink-0 inline-block px-2 py-1 rounded-md text-[11px] font-bold border bg-sky-500/15 text-sky-300 border-sky-500/40">
                        PayPal
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm truncate">
                        {b.label}
                        {b.isTest && <span className="ml-1.5 text-[10px] font-bold text-amber-300">🧪</span>}
                      </p>
                      {b.detail && <p className="text-[11px] text-white/45 truncate">{b.detail}</p>}
                    </div>
                  </div>

                  {/* 날짜 + 금액 + 상태 */}
                  <div className="flex items-center gap-3 sm:gap-4 shrink-0 flex-wrap">
                    {b.date && (
                      <span className="text-[12px] text-white/55 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {b.date}
                      </span>
                    )}
                    {isPaypal && usd ? (
                      <span className="text-sm font-bold text-white">
                        {usd}
                        <span className="text-[10px] text-white/40 ml-1">{formatKRW(b.amountKRW)}</span>
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-white">
                        {formatKRW(b.amountKRW)}
                        {usd && <span className="text-[10px] text-white/40 ml-1">{usd}</span>}
                      </span>
                    )}
                    {statusBadge(b.status)}
                    {/* 배차 실패 취소 — 수동·QR 흐름(pending) 결제완료 건에만. 무드는 별도 정산 체계라 제외. */}
                    {b.kind === 'pending' && b.status === 'CONFIRMED' && (
                      <button
                        onClick={() => setCancelTarget(b)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors min-h-[36px]"
                      >
                        배차실패 취소
                      </button>
                    )}
                    {/* PayPal 직접 결제 — 환불 가능할 때만 버튼, 아니면 이유. */}
                    {isPaypal && b.refundable && (
                      <button
                        onClick={() => setCancelTarget(b)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors min-h-[36px]"
                      >
                        취소 + 전액 환불
                      </button>
                    )}
                    {blockReason && <span className="text-[10px] text-white/40">{blockReason}</span>}
                    {/* 게스트 예약 — 관리 링크 재발송. pending = 날짜 변경 뒤 새 링크 메일 실패(또는 삭제 실패)로 남은 표시. */}
                    {b.guestManaged && b.status === 'CONFIRMED' && (
                      <>
                        {b.manageLinkPending && (
                          <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold border bg-amber-500/15 text-amber-300 border-amber-500/40">
                            링크 전달 확인 필요
                          </span>
                        )}
                        <button
                          ref={(el) => { if (el) resendBtnRefs.current.set(b.id, el); else resendBtnRefs.current.delete(b.id); }}
                          onClick={() => setResendTarget(b)}
                          disabled={resendingId !== null}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-colors min-h-[36px] disabled:opacity-50"
                        >
                          {resendingId === b.id ? '보내는 중…' : '관리 링크 재발송'}
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {cancelTarget && (
        <DispatchCancelModal
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); void reload(); }}
          getIdToken={() => user!.getIdToken()}
        />
      )}

      {resendTarget && (
        <ResendLinkConfirmModal
          booking={resendTarget}
          busy={resendingId !== null}
          onClose={() => { if (resendingId === null) setResendTarget(null); }}
          onConfirm={() => { void resendManageLink(resendTarget); }}
          returnFocusTo={() => resendBtnRefs.current.get(resendTarget.id)}
        />
      )}
    </div>
  );
}

/**
 * 관리 링크 재발송 확인창 (2026-10-23, PR-3) — Radix AlertDialog(ui/alert-dialog.tsx).
 * 초점: 열리면 창 안(닫기 버튼), Tab 은 창 안에서만 돈다, 닫히면 그 행의 재발송 버튼으로 복귀(returnFocusTo).
 * 요청 중에는 확인·닫기 비활성 + Esc 무시(바깥 클릭은 AlertDialog 가 원래 막는다). 결과는 토스트로 알리고 창은 닫힌다.
 */
function ResendLinkConfirmModal({
  booking, busy, onClose, onConfirm, returnFocusTo,
}: {
  booking: BookingItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  returnFocusTo: () => HTMLElement | null | undefined;
}) {
  const blockWhileBusy = (e: Event) => { if (busy) e.preventDefault(); };
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <AlertDialogContent
        onEscapeKeyDown={blockWhileBusy}
        onCloseAutoFocus={(e) => {
          // 닫힘·언마운트 때 FocusScope 가 부른다 — Radix 의 triggerRef(없음) 복귀 대신 연 행의 버튼으로.
          e.preventDefault();
          const el = returnFocusTo();
          if (el) el.focus();
        }}
        className="max-w-md gap-3.5 rounded-2xl border-white/[0.10] bg-[#0c1220] p-4 sm:p-5 text-white"
      >
        <AlertDialogHeader className="gap-1 text-left">
          <AlertDialogTitle className="text-white font-bold text-[15px]">관리 링크 재발송</AlertDialogTitle>
          <AlertDialogDescription className="text-[11px] text-white/45">{booking.label} · {booking.bookingRef}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-[12px] text-sky-100 space-y-1">
          <p>예약에 <b>저장된 결제자 이메일로만</b> 보냅니다(다른 주소로 보낼 수 없음). 보낸 주소는 마스킹해서 알려드립니다.</p>
          <p>이전 메일의 링크도 계속 유효합니다(버전 유지).</p>
        </div>

        <div className="flex gap-2 pt-1">
          <AlertDialogCancel
            disabled={busy}
            className="flex-1 h-auto px-3 py-2.5 rounded-xl text-[13px] font-semibold border border-white/[0.10] bg-transparent text-white/60 hover:bg-transparent hover:text-white min-h-[44px] disabled:opacity-50"
          >
            닫기
          </AlertDialogCancel>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-bold border border-sky-500/50 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30 min-h-[44px] disabled:opacity-40"
          >
            {busy ? '보내는 중…' : '확인'}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 배차 실패 취소 모달 (2026-07-28).
 * 우리 귀책 취소라 **항상 전액 환불**이고 사유가 필수다 — 입력한 문장이 그대로
 * 고객 이메일에 실린다. 그래서 확인 단계에서 환불액과 문구를 다시 보여준다.
 */
function DispatchCancelModal({
  booking, onClose, onDone, getIdToken,
}: {
  booking: BookingItem;
  onClose: () => void;
  onDone: () => void;
  getIdToken: () => Promise<string>;
}) {
  // 2026-10-23: PayPal 직접 결제 예약은 같은 모달로 refund-booking(전액 환불)을 보낸다.
  const isPaypal = booking.kind === 'paypal';
  const categoryOptions = isPaypal ? REFUND_CATEGORY_OPTIONS : CANCEL_CATEGORY_OPTIONS;
  const [category, setCategory] = useState<CancelCategory>(isPaypal ? 'customer_request' : 'no_vehicle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const usd = formatUSD(booking.priceUSD);

  const submit = async () => {
    if (!reason.trim()) { setErr('사유를 입력해주세요 (고객에게 그대로 전달됩니다)'); return; }
    setBusy(true);
    setErr(null);
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/admin-booking-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          bookingRef: booking.bookingRef,
          action: isPaypal ? 'refund-booking' : 'dispatch-cancel',
          cancelCategory: category,
          reason: reason.trim(),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `취소 실패 (HTTP ${res.status})`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '오류');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl border border-white/[0.10] p-4 sm:p-5 space-y-3.5" style={{ background: '#0c1220' }}>
        <div>
          <h2 className="text-white font-bold text-[15px]">{isPaypal ? '취소 + 전액 환불 (PayPal)' : '배차 실패 취소'}</h2>
          <p className="text-[11px] text-white/45 mt-1">
            {booking.label} · {booking.bookingRef} · {isPaypal && usd ? `${usd} (${formatKRW(booking.amountKRW)})` : formatKRW(booking.amountKRW)}
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-200">
          {isPaypal ? (
            <>PayPal 결제 <b>전액 환불</b> · 사유는 <b>고객에게 전달</b>됩니다.</>
          ) : (
            <>
              우리 쪽 사정으로 인한 취소이므로 <b>취소정책과 무관하게 전액 환불</b>됩니다.
              입력한 사유는 <b>고객 이메일에 그대로</b> 실립니다.
            </>
          )}
        </div>

        <div>
          <label className="block text-[11px] text-white/50 mb-1.5">사유 분류</label>
          <div className={`grid ${isPaypal ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
            {categoryOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setCategory(opt.key)}
                className={`px-2 py-2 rounded-xl text-[12px] font-semibold border transition-all min-h-[40px] ${
                  category === opt.key
                    ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-white/50 mb-1.5">고객에게 전달할 사유 (필수)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="예: 당일 폭설로 배정 예정이던 차량이 운행 불가해졌습니다. 불편을 드려 죄송합니다."
            className="w-full rounded-xl bg-white/[0.04] border border-white/[0.10] px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:border-[#7C5CFC]/50"
          />
        </div>

        {err && <p className="text-[12px] text-rose-300">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-semibold border border-white/[0.10] text-white/60 hover:text-white min-h-[44px] disabled:opacity-50"
          >
            닫기
          </button>
          <button
            onClick={() => { void submit(); }}
            disabled={busy || !reason.trim()}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-bold border border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 min-h-[44px] disabled:opacity-40"
          >
            {busy ? '처리 중…' : '취소 + 전액 환불'}
          </button>
        </div>
      </div>
    </div>
  );
}
